// Shared renderers for records, so every screen shows a call, a status or a sub-account the same way.
// CONTRACT: ui.describe.statusChip('no-answer') · ui.describe.source(call) · ui.describe.sub(subId)
//           ui.describe.direction(call) · ui.describe.party(call)

import { html } from '../core/dom.js';
import { t, loc } from '../core/i18n.js';
import { store } from '../core/store.js';
import { STATUS_TONE } from '../data/reference.js';
import { icon } from './icons.js';

const STATUS_ICON = { completed: 'check-circle', 'no-answer': 'phone-off', busy: 'minus', failed: 'alert', rejected: 'x-circle', canceled: 'x', ringing: 'phone', queued: 'clock', 'in-progress': 'phone-call', playing: 'wave' };

/** One-word chip; the API code is in the tooltip (focusable so keyboard users can read it). */
export function statusChip(status) {
  const tone = STATUS_TONE[status];
  return html`<span class="chip ${tone ? 'chip-' + tone : ''}" tabindex="0" data-tip-key="statusTip.${status}">${icon(STATUS_ICON[status] || 'dot')}${t(`status.${status}`)}</span>`;
}

export function sub(subId) {
  const s = (store.get('subAccounts') || []).find((x) => x.id === subId);
  return s ? loc(s.name) : '—';
}

/** "Campaign · Delivery slot confirmation · 27 Oct", "API · otp-login", "Flow · Main menu" … */
export function source(call) {
  const src = call.source || {};
  if (src.type === 'campaign') {
    const c = (store.get('campaigns') || []).find((x) => x.id === src.ref);
    return t('src.campaign', { name: c ? loc(c.name) : src.ref });
  }
  if (src.type === 'flow' || src.type === 'flow-fallback') {
    const f = (store.get('flows') || []).find((x) => x.id === src.ref);
    return t(src.type === 'flow' ? 'src.flow' : 'src.flowFallback', { name: f ? loc(f.name) : src.ref });
  }
  if (src.type === 'otp' || src.type === 'notification' || src.type === 'api') return t('src.api', { name: src.ref });
  if (src.type === 'trunk') return t('src.trunk', { name: src.ref });
  if (src.type === 'click-to-call') return t('src.c2c', { name: src.ref });
  if (src.type === 'test-call') return t('src.test');
  return src.ref || '—';
}

export function direction(call) {
  const inbound = call.direction === 'inbound';
  return html`<span class="row-tight nowrap">${icon(inbound ? 'arrow-down-left' : 'arrow-up-right', 'ico-xs')}${t(inbound ? 'dir.inbound' : 'dir.outbound')}</span>`;
}

/** The customer's side of a call (masked). */
export const party = (call) => (call.direction === 'inbound' ? call.from : call.to);

export const describe = { statusChip, sub, source, direction, party };
