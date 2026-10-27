// Toasts. CONTRACT: ui.toast(message, { kind: 'info'|'success'|'warn'|'error', sub, demo: true, action: { label, onClick }, reqId })
// reqId: 'req_…' (or true = derive one from the route + message). Every error toast gets one automatically: it shows
// "Request ID req_… [Copy]" (see reqid.js) and, like all errors, stays until closed.
// Bottom right on desktop — top centre while a modal or drawer is open, so it never sits on the dialog's own
// buttons — and top on a phone. Max 3 stacked. Auto-dismiss after max(4 s, 500 ms per word), capped at 8 s,
// paused while the pointer really moves over it (not when it simply appears under a resting pointer) or it has focus. Toasts with an action, and all errors, stay until closed — except an
// Undo toast: { action, timeout: 10000 } closes after 10 s and shows the countdown on its button.
// role=status (polite) for success/info, role=alert for errors. Copy actions never toast (see clipboard.js).
// Phone (≤ 767 px, toasts at the top): a plain confirmation lets taps through to the page under it and closes on the
// next tap anywhere, so it never blocks a drawer's buttons; only Undo/action buttons and an error's close take taps.

import { html, el as toEl, on, effect } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { icon } from './icons.js';
import { reqId as makeReqId, reqIdLine } from './reqid.js';

let wrap = null;
// Last real pointer position: a toast that opens under a resting pointer must not count as "hovered".
let lastPt = { x: -1, y: -1 };
document.addEventListener('pointermove', (ev) => { lastPt = { x: ev.clientX, y: ev.clientY }; }, { capture: true, passive: true });
const ICON = { info: 'info', success: 'check-circle', warn: 'alert', error: 'alert-circle' };

function container() {
  if (wrap && document.body.contains(wrap)) return wrap;
  wrap = document.createElement('div');
  wrap.className = 'toasts';
  document.body.appendChild(wrap);
  return wrap;
}

export function toast(message, { kind = 'info', sub = '', action = null, demo = false, timeout, reqId = null } = {}) {
  const c = container();
  const rid = typeof reqId === 'string' ? reqId : (reqId || kind === 'error') ? makeReqId(`${location.hash.replace(/^#\/?/, '').split('?')[0]}|${message}`) : null;
  while (c.children.length >= 3) c.firstElementChild.remove();
  const node = toEl(html`<div class="toast toast-${kind}${action ? ' has-action' : ''}${rid ? ' has-req' : ''}" role="${kind === 'error' ? 'alert' : 'status'}" aria-live="${kind === 'error' ? 'assertive' : 'polite'}">
    ${icon(ICON[kind] || 'info')}
    <div class="tt">${message}${demo ? html` <span class="chip chip-navy" style="margin-left:4px;background:rgba(255,255,255,.14);color:#fff">${t('common.demoTag')}</span>` : ''}${sub ? html`<small>${sub}</small>` : ''}${rid ? html`<small class="rq-toast">${reqIdLine(rid)}</small>` : ''}</div>
    ${action ? html`<button type="button" class="ta">${action.label}</button>` : ''}
    <button type="button" class="tx" aria-label="${t('common.close')}">${icon('x')}</button>
  </div>`);
  c.appendChild(node);
  requestAnimationFrame(() => requestAnimationFrame(() => node.classList.add('is-open')));
  let timer = null;
  let offTap = null;
  const close = () => {
    clearTimeout(timer);
    if (offTap) offTap();
    node.classList.remove('is-open');
    setTimeout(() => node.remove(), 170);
  };
  const words = String(message).split(/\s+/).length + String(sub).split(/\s+/).length;
  const ms = timeout ?? Math.min(8000, Math.max(4000, words * 500));
  // An action toast stays until closed — unless the caller passes a timeout (Undo: 10 s with a visible countdown).
  const sticky = (!!action && timeout == null) || kind === 'error' || !!rid;
  if (action && timeout != null) {
    const cd = document.createElement('span');
    cd.className = 'tcd';
    cd.setAttribute('aria-hidden', 'true');
    node.querySelector('.ta').appendChild(cd);
    const end = Date.now() + timeout;
    const tickCd = () => { const n = Math.max(0, Math.ceil((end - Date.now()) / 1000)); cd.textContent = ` ${n}`; if (n > 0 && node.isConnected) setTimeout(tickCd, 250); };
    tickCd();
  }
  const arm = () => { clearTimeout(timer); if (!sticky) timer = setTimeout(close, ms); };
  arm();
  const startPt = { ...lastPt };
  let paused = false;
  if (!sticky && !action && matchMedia('(max-width: 767px)').matches) {
    const onTap = () => close();
    setTimeout(() => { if (node.isConnected) document.addEventListener('pointerdown', onTap, true); }, 0);
    offTap = () => document.removeEventListener('pointerdown', onTap, true);
  }
  on(node, 'pointermove', (ev) => {
    if (paused || (ev.clientX === startPt.x && ev.clientY === startPt.y)) return;
    paused = true;
    clearTimeout(timer);
  });
  on(node, 'pointerleave', () => { if (paused) { paused = false; arm(); } });
  on(node, 'focusin', () => clearTimeout(timer));
  on(node, 'focusout', () => { if (!paused) arm(); });
  on(node, 'click', '.tx', (ev) => { ev.__handled = true; close(); });
  if (action) on(node, 'click', '.ta', (ev) => { ev.__handled = true; close(); action.onClick && action.onClick(); });
  effect('toast', { message: String(message) });
  return { close, el: node, reqId: rid };
}
