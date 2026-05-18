(function () {
  'use strict';

  const isTouch = (() => {
    try {
      return window.matchMedia('(pointer: coarse)').matches
        || navigator.maxTouchPoints > 0
        || ('ontouchstart' in window);
    } catch (_) {
      return false;
    }
  })();

  const state = {
    left: false,
    right: false,
    up: false,
    down: false,
    interact: false,
  };

  window.__DenizenTouchState = state;

  if (!isTouch) return;

  function setDir(next) {
    state.left = !!next.left;
    state.right = !!next.right;
    state.up = !!next.up;
    state.down = !!next.down;
  }

  function clearDir() {
    setDir({ left: false, right: false, up: false, down: false });
  }
  function setInteractPulse(ms = 120) {
    state.interact = true;
    window.setTimeout(() => { state.interact = false; }, ms);
  }

  function updateDirFromDelta(dx, dy, dead = 10) {
    if (Math.abs(dx) < dead && Math.abs(dy) < dead) {
      clearDir();
      return;
    }
    const mag = Math.hypot(dx, dy) || 1;
    const nx = dx / mag;
    const ny = dy / mag;
    setDir({
      left: nx < -0.35,
      right: nx > 0.35,
      up: ny < -0.35,
      down: ny > 0.35,
    });
  }

  function isUiTarget(target) {
    if (!target || typeof target.closest !== 'function') return false;
    return Boolean(
      target.closest('#player-chat-panel') ||
      target.closest('#openclaw-ui-panel') ||
      target.closest('#editor-ui') ||
      target.closest('input, textarea, button, select, [contenteditable="true"]')
    );
  }

  function installTouchGestures() {
    let moveId = null;
    let startX = 0;
    let startY = 0;

    const moveZoneThreshold = () => Math.round(window.innerWidth * 0.7);

    window.addEventListener('touchstart', (e) => {
      if (!e.touches || e.touches.length === 0) return;
      const t = e.changedTouches && e.changedTouches[0];
      if (!t) return;
      if (isUiTarget(e.target)) return;

      if (t.clientX > moveZoneThreshold()) {
        setInteractPulse(140);
        e.preventDefault();
        return;
      }

      moveId = t.identifier;
      startX = t.clientX;
      startY = t.clientY;
      clearDir();
      e.preventDefault();
    }, { passive: false });

    window.addEventListener('touchmove', (e) => {
      if (moveId == null) return;
      const touches = Array.from(e.touches || []);
      const t = touches.find((x) => x.identifier === moveId);
      if (!t) return;
      updateDirFromDelta(t.clientX - startX, t.clientY - startY, 12);
      e.preventDefault();
    }, { passive: false });

    const endTouch = (e) => {
      if (moveId == null) return;
      const changed = Array.from(e.changedTouches || []);
      if (changed.some((x) => x.identifier === moveId)) {
        moveId = null;
        clearDir();
      }
    };

    window.addEventListener('touchend', endTouch, { passive: true });
    window.addEventListener('touchcancel', endTouch, { passive: true });

    window.addEventListener('blur', () => {
      moveId = null;
      clearDir();
      state.interact = false;
    });
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', installTouchGestures);
  } else {
    installTouchGestures();
  }
})();
