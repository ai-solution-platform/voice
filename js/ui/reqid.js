// Request IDs — what a customer quotes to support (Stripe "Request ID", Twilio "Request SID").
// CONTRACT:
//   reqId(seed)          → 'req_01JB' + 10 letters/digits, the same for the same seed (route + code), e.g. reqId('logs|HTTP 503')
//   reqIdLine(id, opts)  → html: "Request ID  req_…  [Copy]"  · opts { hint: true } adds "Quote this ID if you contact support."
// The Copy button ([data-action="req.copy"], data-value = the ID) works anywhere — error states, toasts, drawers —
// through one capture-phase listener here: it copies the ID, the label turns into "Copied" for 1.6 s and screen
// readers hear it. Its accessible name is "Copy request ID req_…" in the current language.

import { html } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { icon } from './icons.js';
import { copy } from './io.js';

const ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base 32, like the other demo IDs (call_01JB…)

export function reqId(seed) {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (const ch of String(seed)) {
    const c = ch.codePointAt(0);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
    h2 = (h2 ^ (h2 >>> 13)) >>> 0;
  }
  let out = '';
  for (let i = 0; i < 10; i++) {
    const v = i < 5 ? (h1 >>> (i * 6)) : (h2 >>> ((i - 5) * 6));
    out += ALPHA[v & 31];
  }
  return `req_01JB${out}`;
}

export function reqIdLine(id, { hint = false, cls = '' } = {}) {
  return html`<span class="rq-line ${cls}"><span class="rq-k">${t('common.reqId')}</span> <code class="mono rq-id" translate="no">${id}</code>
    <button type="button" class="rq-copy" data-action="req.copy" data-value="${id}" aria-label="${t('common.reqIdCopy', { id })}">${icon('copy', 'ico-xs')}<span class="rq-lbl" aria-hidden="true">${t('common.copy')}</span></button>${hint ? html`<span class="rq-hint">${t('common.reqIdHint')}</span>` : ''}</span>`;
}

function onCopy(ev) {
  const b = ev.target && ev.target.closest ? ev.target.closest('[data-action="req.copy"]') : null;
  if (!b) return;
  ev.__handled = true;
  ev.preventDefault();
  const id = b.dataset.value || '';
  copy(id, b);
  const lbl = b.querySelector('.rq-lbl');
  b.classList.add('is-copied');
  if (lbl) lbl.textContent = t('common.copied');
  clearTimeout(b.__rqT);
  b.__rqT = setTimeout(() => {
    b.classList.remove('is-copied');
    if (lbl) lbl.textContent = t('common.copy');
  }, 1600);
}

if (typeof document !== 'undefined' && !window.__reqCopyWired) {
  window.__reqCopyWired = true;
  document.addEventListener('click', onCopy, true);
}
