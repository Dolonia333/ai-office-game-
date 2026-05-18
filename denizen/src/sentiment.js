'use strict';
/**
 * sentiment.js — cheap keyword-based mood classifier.
 *
 * Used by the awareness layer to tag an NPC's recent self-message with
 * a mood hint (e.g. "frustrated", "tired") so nearby NPCs can adjust
 * how they approach them. This is a HINT, not a verdict — peers see it
 * as one tag among many in the `Nearby:` line and the LLM decides what
 * to do with it.
 *
 * Limitation: keyword regex misses sarcasm, negation ("not happy"),
 * context ("happy hour"), and emoji-only sentiment. That's deliberate —
 * we want a sub-millisecond pass that runs on every message and never
 * costs tokens. A nuanced classifier is the LLM's job anyway; this is
 * just a coarse signal so peers don't walk into an obvious mood blind.
 *
 * No deps. Pure function.
 */

/**
 * Keyword sets per mood. Each set is matched as a whole-word regex
 * (case-insensitive). Order in `PRIORITY` is the tie-break order — the
 * earlier mood wins when two have the same hit count.
 *
 * Keep sets tight. Adding more words isn't free: a word that fits two
 * moods (e.g. "lost") creates noise. Prefer high-signal terms that
 * rarely appear except when the speaker actually feels that way.
 */
const MOODS = {
  // 'frustrated' first in priority because it's the highest-signal one
  // for our use case (peers backing off, offering help) and the word
  // set is the most unambiguous.
  frustrated: [
    'frustrated', 'frustrating', 'annoyed', 'annoying', 'irritated',
    'stuck', 'blocked', 'broken', 'ugh', 'argh', 'sigh',
    'wtf', 'damn', 'dammit', 'pissed', 'fed up', 'sick of',
    'why won\'t', 'why doesn\'t', 'keeps failing', 'never works',
  ],
  anxious: [
    'worried', 'nervous', 'anxious', 'stressed', 'stressing',
    'panicking', 'panic', 'concerned', 'scared', 'afraid',
    'uncertain', 'unsure', 'doubt', 'doubting', 'overwhelmed',
  ],
  tired: [
    'tired', 'exhausted', 'sleepy', 'drained', 'burnt out', 'burned out',
    'wiped', 'yawn', 'yawning', 'beat', 'fried',
    'need coffee', 'need a nap', 'long day',
  ],
  excited: [
    'excited', 'pumped', 'stoked', 'hyped', 'thrilled', 'amazing',
    'awesome', 'incredible', 'fantastic', 'let\'s go', 'lfg',
    'can\'t wait', 'ship it',
  ],
  happy: [
    'happy', 'glad', 'pleased', 'love it', 'love this', 'great work',
    'nice work', 'good job', 'well done', 'cheers', 'thanks',
    'thank you', 'appreciate', 'lol', 'haha', ':)', 'awesome',
  ],
};

/**
 * Priority order for tie-breaking. Highest-priority (earliest) mood
 * wins when hit-counts are tied. Picked to bias toward
 * "actionable for peers" moods — a frustrated coworker matters more
 * to social dynamics than a vaguely happy one.
 */
const PRIORITY = ['frustrated', 'anxious', 'tired', 'excited', 'happy'];

// Precompile keyword regexes once at load. Word-boundary on alphanumeric
// keywords; literal substring for phrases / symbols.
const _COMPILED = (() => {
  const out = {};
  for (const mood of Object.keys(MOODS)) {
    out[mood] = MOODS[mood].map(kw => {
      // Phrase or contains non-word chars → literal substring (escaped).
      if (/[^a-z0-9]/i.test(kw) || kw.includes(' ')) {
        return new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      }
      return new RegExp(`\\b${kw}\\b`, 'i');
    });
  }
  return out;
})();

/**
 * Classify a string into one of the supported moods, or null if no
 * keywords match.
 *
 * @param {string} text
 * @returns {null | 'happy' | 'frustrated' | 'tired' | 'excited' | 'anxious'}
 */
function classify(text) {
  if (!text || typeof text !== 'string') return null;
  const lower = text.toLowerCase();
  // Count hits per mood. Each keyword can fire at most once per text —
  // a paragraph full of "frustrated frustrated frustrated" should not
  // outvote a balanced "great work but also frustrated".
  const hits = {};
  for (const mood of PRIORITY) {
    let count = 0;
    for (const re of _COMPILED[mood]) {
      if (re.test(lower)) count++;
    }
    if (count > 0) hits[mood] = count;
  }
  const moods = Object.keys(hits);
  if (moods.length === 0) return null;
  // Pick the highest hit-count; on tie, the earliest in PRIORITY wins.
  let best = null;
  for (const mood of PRIORITY) {
    if (!(mood in hits)) continue;
    if (best === null || hits[mood] > hits[best]) best = mood;
  }
  return best;
}

module.exports = { classify, MOODS, PRIORITY };
