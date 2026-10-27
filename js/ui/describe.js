// Shared renderers for records, so every screen shows a call, a status or a sub-account the same way.
// CONTRACT: ui.describe.statusChip('no-answer') · ui.describe.source(call) · ui.describe.sub(subId)
//           ui.describe.direction(call) · ui.describe.party(call)

import { html } from '../core/dom.js';
import { t, loc } from '../core/i18n.js';
import { store } from '../core/store.js';
import { STATUS_TONE } from '../data/reference.js';
import { icon } from './icons.js';
import { fmt } from '../core/format.js';
import { activePlan } from '../core/actions.js';

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

/**
 * Usage in its own units — the one wording every screen uses: "1,022.67 credits", or on a plan
 * "0.00 credits · 1,033 plan minutes" (credits = what is charged; plan minutes are never counted as credits).
 * planMin: minutes taken from the plan minutes. The plan part shows when there are plan minutes, or always on a
 * plan account when { plan: true } (totals such as Used today).
 */
export function used(credits, planMin = 0, { plan = false } = {}) {
  const c = fmt.credits2(credits || 0);
  const n = Math.round(planMin || 0);
  if (n > 0 || (plan && activePlan())) return t('bm.used', { credits: c, n: fmt.int(n), count: n });
  return t('common.creditsN', { n: c });
}
/** "+ 1,287 plan minutes" under a credits figure (tiles), or '' when there is no plan and no plan minutes. */
export function plusPlanMin(planMin = 0, { plan = true } = {}) {
  const n = Math.round(planMin || 0);
  if (n > 0 || (plan && activePlan())) return t('bm.plusMin', { n: fmt.int(n), count: n });
  return '';
}

export const describe = { statusChip, sub, source, direction, party, used, plusPlanMin };
