// Press guard — keeps the first click after a re-render.
// A browser fires `click` only when mousedown and mouseup land on the same element. Pressing a button moves focus,
// so blur/focusout validation (and any store watcher or ticker) can re-render the region while the mouse button is
// still down: the button under the pointer is replaced by a copy, mouseup lands on the copy and the click is lost —
// the user corrects a field, clicks Create once and nothing happens.
//
// replaceSafely(container, fn): runs fn now, unless a press on a clickable control inside `container` is in
// progress; then fn waits until that click has been handled (the latest fn per container wins). The router's
// re-render and the modal/drawer setBody/setButtons go through it, so every screen and dialog gets this for free.

const CLICKABLE = 'button, a[href], [data-action], [role="button"], [role="tab"], [role="radio"], [role="switch"], [role="menuitem"], [role="option"], [role="checkbox"], label, summary, input[type="checkbox"], input[type="radio"], input[type="submit"], input[type="button"]';
const SAFETY_MS = 2000; // a mouseup that never arrives (window lost focus mid-press) must not freeze the screen

let pressed = null; // the clickable control under the current press
const pending = new Map(); // container → fn
let safety = 0;

function flush() {
  if (pressed) return; // a new press started before the queue ran: wait for its click
  clearTimeout(safety);
  const fns = [...pending.values()];
  pending.clear();
  for (const fn of fns) {
    try { fn(); } catch (e) { console.error(e); }
  }
}

function down(ev) {
  if (ev.button) return; // primary button / touch / pen contact only
  pressed = ev.target instanceof Element ? ev.target.closest(CLICKABLE) : null;
}

function release() {
  pressed = null;
  // mouseup and click are dispatched in the same task, so this runs right after the click handlers.
  if (pending.size) setTimeout(flush, 0);
}

if (typeof document !== 'undefined' && !window.__pressGuard) {
  window.__pressGuard = true;
  document.addEventListener('pointerdown', down, true);
  document.addEventListener('mousedown', down, true); // touch taps send their compatibility mousedown later
  document.addEventListener('mouseup', release, true);
  document.addEventListener('pointerup', (ev) => { if (ev.pointerType !== 'mouse') release(); }, true);
  document.addEventListener('pointercancel', release, true);
  document.addEventListener('dragend', release, true);
}

/** True while the pointer is pressing a clickable control inside `container` (whole document when omitted). */
export function pressingIn(container) {
  return !!pressed && pressed.isConnected && (!container || container.contains(pressed));
}

/**
 * Replace the content of `container` (via fn) without stealing a click that is half-way through.
 * Returns true when fn ran now, false when it was queued behind the press.
 */
export function replaceSafely(container, fn) {
  if (pressingIn(container)) {
    pending.set(container, fn);
    clearTimeout(safety);
    safety = setTimeout(() => { pressed = null; flush(); }, SAFETY_MS);
    return false;
  }
  pending.delete(container); // this update supersedes one that was waiting
  fn();
  return true;
}
