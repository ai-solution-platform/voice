// Layer stack shared by modal, drawer, popover, palette and tour: Esc closes the top layer, Tab is trapped
// inside modal layers, focus returns to the opener, page scroll is locked while a modal layer is open.

import { focusables, reducedMotion, focusQuiet } from '../core/dom.js';

const stack = [];

export const layersRoot = () => document.getElementById('layers') || document.body;
export const topLayer = () => stack[stack.length - 1] || null;
export const hasModalLayer = () => stack.some((l) => l.modal);

function syncScrollLock() {
  const m = hasModalLayer();
  const root = document.documentElement;
  root.style.overflow = m ? 'hidden' : '';
  root.classList.toggle('has-modal', m); // toasts move off the dialog's footer (app.css)
  // A drawer: toasts sit beside it, or below its header when there is no room (app.css), never on the header.
  const top = [...stack].reverse().find((l) => l.modal);
  const drawer = top && top.el && top.el.classList && top.el.classList.contains('drawer') ? top.el : null;
  root.classList.toggle('has-drawer', !!drawer);
  root.classList.toggle('has-drawer-wide', !!drawer && drawer.classList.contains('drawer-wide'));
  if (drawer) {
    const head = drawer.querySelector('.modal-head');
    root.style.setProperty('--drawer-head', `${Math.round(head ? head.getBoundingClientRect().height : 72)}px`);
  }
  window.dispatchEvent(new CustomEvent('demo:layers')); // tooltip.js hides its tooltip
}

/**
 * Register a layer. layer = { el, close(), modal: bool, escClose: bool (default true), trapEl?: Element,
 *   persistent?: bool — survives a change of screen (the router closes every other layer then) }
 * Returns an unregister function (call it from close()).
 */
export function pushLayer(layer) {
  layer.prevFocus = document.activeElement;
  stack.push(layer);
  syncScrollLock();
  return () => {
    const i = stack.indexOf(layer);
    if (i >= 0) stack.splice(i, 1);
    syncScrollLock();
    const pf = layer.prevFocus;
    if (layer.restoreFocus !== false && pf && document.contains(pf)) focusQuiet(pf);
  };
}

/** Animate an element in (adds .is-open next frame). */
export function animateIn(el) {
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('is-open')));
}

/** Animate out then remove. */
export function animateOut(el, ms = 160) {
  el.classList.remove('is-open');
  setTimeout(() => el.remove(), reducedMotion() ? 0 : ms);
}

document.addEventListener('keydown', (ev) => {
  const top = topLayer();
  if (!top) return;
  if (ev.key === 'Escape') {
    if (top.escClose === false) return;
    ev.preventDefault();
    ev.stopPropagation();
    top.close();
    return;
  }
  if (ev.key === 'Tab' && top.modal) {
    const root = top.trapEl || top.el;
    const f = focusables(root);
    if (!f.length) { ev.preventDefault(); root.focus(); return; }
    const first = f[0];
    const last = f[f.length - 1];
    if (ev.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) { ev.preventDefault(); first.focus(); }
  }
}, true);

/** Close every open layer (route change, reset demo). */
/** Close every layer. { keepPersistent: true } spares layers that live across pages (dialer, tour). */
export function closeAll({ keepPersistent = false } = {}) {
  for (const l of stack.slice().reverse()) {
    if (keepPersistent && l.persistent) continue;
    try { l.close(); } catch { /* ignore */ }
  }
}
