/**
 * Proximity Audio — distance + facing + active-conversation volume gate.
 *
 * Why this exists: the office has up to 16 NPCs talking on autonomous
 * 30-45s think cycles. With every TTS call at full volume the audio
 * stack sounds like a crowd standing on top of you. This module
 * scales each utterance's volume by:
 *
 *   1. **Distance** from the player. Close → full; far → whisper.
 *   2. **Facing**.   Player looking at the NPC → full multiplier;
 *                    looking away → halved.
 *   3. **Active conversation mute**. If the player is mid-chat with
 *      NPC X (player-chat tags it via setActiveConvoNpc), every other
 *      NPC is hard-muted for the duration of that chat. The convo tag
 *      decays ~30s after the last player message.
 *
 * Exposed surface (window.DenizenProximityAudio):
 *
 *   computeVolumeForNpc(npcName) -> { volume: 0..1, muted: bool, reason }
 *     Called by elevenlabs-provider.js right before audio.play(), and
 *     by voice-gate.js for the speechSynthesis fallback.
 *
 *   setActiveConvoNpc(npcName, ttlMs=30000)
 *     Called by player-chat.js whenever the player sends a message.
 *     Mutes every other NPC for the TTL. Pass null to clear early.
 *
 *   getActiveConvoNpc() -> name | null
 *
 * Configuration via window.DenizenProximityConfig (all optional):
 *   { fullVolumeRadius, whisperRadius, minVolume, facingDotCutoff,
 *     facingPenalty, convoTtlMs }
 *
 * Reads the scene + npc state from window.__DenizenScene (set by
 * office-scene.js) and window.DenizenWorldState (set by the new
 * world_state_batch handler in agent-office-manager.js).
 */
(function () {
  'use strict';

  // --- tunable defaults ----------------------------------------------------
  const DEFAULTS = {
    // Pixel distances. Below `fullVolumeRadius` → 1.0 (subject to facing).
    fullVolumeRadius: 90,
    // Above `whisperRadius` → minVolume.
    whisperRadius: 320,
    minVolume: 0.12,
    // Facing cone: dot product of player-facing vs. (npc - player) > this
    // → "looking at." Otherwise the facing penalty multiplies the volume.
    facingDotCutoff: 0.25,
    facingPenalty: 0.5,
    // After this long without a player chat, the active-convo lock clears
    // and other NPCs are audible again.
    convoTtlMs: 30000,
  };

  function cfg() {
    return Object.assign({}, DEFAULTS, (typeof window !== 'undefined' ? window.DenizenProximityConfig : null) || {});
  }

  // --- active conversation state ------------------------------------------
  let _activeConvoNpc = null;     // display name like "Lucy"
  let _activeConvoUntil = 0;

  function setActiveConvoNpc(npcName, ttlMs) {
    const c = cfg();
    _activeConvoNpc = (typeof npcName === 'string' && npcName) ? npcName : null;
    _activeConvoUntil = _activeConvoNpc ? (Date.now() + (ttlMs || c.convoTtlMs)) : 0;
  }

  function getActiveConvoNpc() {
    if (_activeConvoNpc && Date.now() < _activeConvoUntil) return _activeConvoNpc;
    return null;
  }

  // --- single-speaker slot ------------------------------------------------
  // Real-world fix for "I hear two voices at once." Only one NPC can have
  // audio playing at any moment. New speakers during an active slot are
  // dropped silently — their bubble still renders (visual stays). We
  // estimate slot duration from text length (~75 ms/char + 600 ms tail)
  // so a stuck Audio.play() doesn't permanently silence the office.
  // Conversation lock-holder gets right-of-way: when the player is in
  // an active chat with X, X never gets dropped even if another NPC
  // arrived first.
  let _slotHolder = null;        // display name currently speaking
  let _slotUntil = 0;            // ms epoch — auto-expire deadline

  function _estimateSpeakDurationMs(text) {
    const len = String(text || '').length;
    // 75 ms/char ≈ 800 chars/min, matches typical TTS pacing for
    // English; clamp so even one-word lines hold the slot at least
    // 800 ms (otherwise rapid-fire decisions still overlap).
    return Math.max(800, Math.min(20000, len * 75 + 600));
  }

  /**
   * Try to claim the audio channel for `npcName` to speak `text`.
   * Returns true if the slot is free (or if this NPC is the active
   * convo partner, who gets priority). Returns false to mean "stay
   * silent for this line — someone else is talking."
   */
  function acquireSpeakerSlot(npcName, text) {
    const now = Date.now();
    if (_slotHolder && now < _slotUntil) {
      // Convo partner priority — if the player is mid-chat with this
      // NPC, kick whoever's holding the slot. That makes player chats
      // feel responsive even if Lucy started a line right before
      // Edward (the partner) replies.
      const convo = getActiveConvoNpc();
      if (convo && convo === npcName && _slotHolder !== convo) {
        _slotHolder = npcName;
        _slotUntil = now + _estimateSpeakDurationMs(text);
        return true;
      }
      return false;
    }
    _slotHolder = npcName;
    _slotUntil = now + _estimateSpeakDurationMs(text);
    return true;
  }

  function releaseSpeakerSlot(npcName) {
    // Only release if we still own it — late `ended` events from a
    // previous Audio object shouldn't free a newer speaker's slot.
    if (!npcName || _slotHolder === npcName) {
      _slotHolder = null;
      _slotUntil = 0;
    }
  }

  function getSlotHolder() {
    if (_slotHolder && Date.now() < _slotUntil) return _slotHolder;
    return null;
  }

  // --- npc-name → sprite resolution ---------------------------------------
  // The roster ships under window.DenizenNpcRoster.keyToDisplay
  // (npcKey -> displayName). We need the inverse for resolving by name.
  function _nameToKey(npcName) {
    const roster = (typeof window !== 'undefined' && window.DenizenNpcRoster) || null;
    if (!roster) return null;
    const map = roster.keyToDisplay || {};
    const want = String(npcName || '').toLowerCase();
    for (const k of Object.keys(map)) {
      if (String(map[k]).toLowerCase() === want) return k;
    }
    return null;
  }

  function _findNpcSprite(npcName) {
    const scene = (typeof window !== 'undefined' && window.__DenizenScene) || null;
    if (!scene || !Array.isArray(scene.npcs)) return null;
    const key = _nameToKey(npcName) || `xp_${String(npcName).toLowerCase()}`;
    return scene.npcs.find(n => n?.texture?.key === key) || null;
  }

  // --- player facing -------------------------------------------------------
  // Track the most recent non-zero velocity direction so we still have a
  // facing vector while the player is standing still. Updated lazily on
  // every computeVolumeForNpc call — no need for a separate animation
  // frame hook.
  let _facingX = 0;
  let _facingY = 1;   // default: facing down (matches initial sprite frame)

  function _updateFacingFromPlayer(player) {
    const v = player?.body?.velocity;
    if (!v) return;
    const mag = Math.hypot(v.x || 0, v.y || 0);
    if (mag > 8) {
      _facingX = v.x / mag;
      _facingY = v.y / mag;
    }
  }

  // --- core ---------------------------------------------------------------
  /**
   * @param {string} npcName  — display name (e.g. "Lucy")
   * @returns {{volume:number, muted:boolean, reason:string}}
   */
  function computeVolumeForNpc(npcName) {
    if (!npcName) return { volume: 0, muted: true, reason: 'no-name' };

    // 1. Active-convo gate
    const active = getActiveConvoNpc();
    if (active && active !== npcName) {
      return { volume: 0, muted: true, reason: `mid-chat with ${active}` };
    }

    const scene = (typeof window !== 'undefined' && window.__DenizenScene) || null;
    const player = scene?.player;
    if (!scene || !player) {
      // Scene not booted yet (early autonomous lines). Default to full
      // volume so we don't accidentally silence the first speech.
      return { volume: 1, muted: false, reason: 'no-scene' };
    }
    const npcSprite = _findNpcSprite(npcName);
    if (!npcSprite) {
      // Unknown NPC (could be a robber, the CTO, or an off-screen
      // visitor). Give it a medium volume so the player still hears it
      // but it's not dominating.
      return { volume: 0.5, muted: false, reason: 'no-sprite' };
    }

    _updateFacingFromPlayer(player);

    const c = cfg();
    const dx = npcSprite.x - player.x;
    const dy = npcSprite.y - player.y;
    const dist = Math.hypot(dx, dy);

    // 2. Distance falloff
    let volume;
    if (dist <= c.fullVolumeRadius) {
      volume = 1;
    } else if (dist >= c.whisperRadius) {
      volume = c.minVolume;
    } else {
      const t = (dist - c.fullVolumeRadius) / (c.whisperRadius - c.fullVolumeRadius);
      volume = 1 - t * (1 - c.minVolume);
    }

    // 3. Facing penalty — only matters once you're past the "right next
    // to them" radius. If the player is on top of an NPC we don't care
    // which way they're looking.
    if (dist > c.fullVolumeRadius) {
      const nx = dx / (dist || 1);
      const ny = dy / (dist || 1);
      const facingDot = _facingX * nx + _facingY * ny;
      if (facingDot < c.facingDotCutoff) {
        volume *= c.facingPenalty;
      }
    }

    return { volume: Math.max(0, Math.min(1, volume)), muted: false, reason: `dist=${Math.round(dist)}` };
  }

  // --- export -------------------------------------------------------------
  if (typeof window !== 'undefined') {
    window.DenizenProximityAudio = {
      computeVolumeForNpc,
      setActiveConvoNpc,
      getActiveConvoNpc,
      acquireSpeakerSlot,
      releaseSpeakerSlot,
      getSlotHolder,
    };
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      computeVolumeForNpc,
      setActiveConvoNpc,
      getActiveConvoNpc,
      acquireSpeakerSlot,
      releaseSpeakerSlot,
      getSlotHolder,
    };
  }
})();
