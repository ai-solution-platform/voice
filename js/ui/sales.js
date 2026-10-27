// Sales flows. A volume plan is a 12-month agreement, so it is NEVER one click: the console sends a request
// and sales confirms. Partner / wholesale / 200,000+ minutes have no published price — "Contact sales" only.
// CONTRACT: ui.sales.requestPlan({ planId: 'plan50k'|'plan100k', minutes }) · ui.sales.contact({ volume, use })
// Both end with a toast carrying a reference number ("Demo: nothing was sent").

import { html, raw } from '../core/dom.js';
import { t, loc, getLang } from '../core/i18n.js';
import { fmt } from '../core/format.js';
import { store } from '../core/store.js';
import { addSalesRequest, notify } from '../core/actions.js';
import { PRICES } from '../data/prices.js';
import { nowMs } from '../data/clock.js';
import { drawer } from './modal.js';
import { toast } from './toast.js';
import { icon } from './icons.js';

/** First day of next month on the demo clock (Bangkok), at noon so no time zone moves the date. */
function nextMonthStart() {
  const [y, m] = new Date(nowMs() + 7 * 3600000).toISOString().slice(0, 7).split('-').map(Number);
  return new Date(Date.UTC(y, m, 1, 5));
}

const field = (label, inner, hint = '') => html`<label class="field"><span class="label">${label}</span>${inner}${hint ? html`<span class="hint-xs">${hint}</span>` : ''}</label>`;

export function requestPlan({ planId = 'plan50k', minutes } = {}) {
  const plan = PRICES.plans.find((p) => p.id === planId) || PRICES.plans[0];
  const start = nextMonthStart();
  const company = loc(store.get('org.name'));
  const body = html`
    <div class="note note-brand">${icon('calendar')}<div><strong>${t('sales.planSummary', { rate: fmt.rate(plan.rate), min: fmt.int(plan.minMinutes), months: PRICES.planMonths, start: fmt.dateProse(start) })}</strong>
      <div class="hint-xs" style="margin-top:2px">${t('common.plannedPrices')} · ${t('common.exVat')}</div></div></div>
    <div class="stack-3" style="margin-top:14px">
      ${field(t('sales.company'), html`<input class="input" data-s="company" value="${company}">`)}
      <div class="grid g-2">
        ${field(t('sales.startMonth'), html`<input class="input" data-s="start" value="${fmt.dateProse(start)}">`)}
        ${field(t('sales.minutes'), html`<input class="input tnum" data-s="minutes" inputmode="numeric" value="${fmt.int(minutes || plan.minMinutes)}">`)}
      </div>
      <div class="grid g-2">
        ${field(t('sales.contactPerson'), html`<input class="input" data-s="name" value="${store.get('user.name')}">`)}
        ${field(t('sales.phoneOrLine'), html`<input class="input" data-s="phone" placeholder="081-xxx-1234 · LINE ID">`)}
      </div>
      ${field(t('sales.note'), html`<textarea class="textarea" data-s="note" rows="2"></textarea>`)}
      <label class="check"><input type="checkbox" data-s="ack">${t('sales.ack', { months: PRICES.planMonths })}</label>
      <span class="field-err" data-s="err" hidden>${t('sales.ackRequired')}</span>
      <p class="hint-xs">${t('sales.planFoot')}</p>
    </div>`;
  const d = drawer({
    title: t('sales.planTitle', { min: fmt.int(plan.minMinutes) }),
    sub: t('sales.planSub'),
    body,
    buttons: [
      { label: t('common.cancel'), action: 'sl.plan.cancel' },
      {
        label: t('sales.send'), kind: 'primary', action: 'sl.plan.send', onClick: (h) => {
          if (!h.el.querySelector('[data-s="ack"]').checked) { h.el.querySelector('[data-s="err"]').hidden = false; return false; }
          const ref = addSalesRequest('plan', { planId: plan.id, minutes: h.el.querySelector('[data-s="minutes"]').value });
          notify('planRequest', { vars: { ref, min: fmt.int(plan.minMinutes) }, href: 'billing' });
          toast(t('sales.sentPlan', { ref }), { kind: 'success', demo: true });
          return true;
        },
      },
    ],
  });
  return d;
}

const VOLUMES = ['lt50', '50to100', '100to200', 'gt200', 'partner'];
const USES = ['otp', 'reminders', 'campaigns', 'pbx', 'resell', 'other'];

export function contact({ volume = 'lt50', use = null } = {}) {
  const volVars = { a: fmt.int(PRICES.plans[0].minMinutes), b: fmt.int(PRICES.plans[1].minMinutes), c: fmt.int(PRICES.plansContactSalesFrom) };
  const body = html`
    <div class="note">${icon('lifebuoy')}<div>${t('sales.contactSub')}</div></div>
    <div class="stack-3" style="margin-top:14px">
      <div class="grid g-2">
        ${field(t('sales.name'), html`<input class="input" data-s="name" value="${store.get('user.name')}" autocomplete="off">`)}
        ${field(t('sales.company'), html`<input class="input" data-s="company" value="${loc(store.get('org.name'))}">`)}
      </div>
      <div class="grid g-2">
        ${field(t('sales.phoneOrLine'), html`<input class="input" data-s="phone" placeholder="081-xxx-1234 · LINE ID">`)}
        ${field(t('sales.email'), html`<input class="input" data-s="email" type="email" placeholder="name@example.com">`)}
      </div>
      ${field(t('sales.volume'), html`<select class="select" data-s="volume">${VOLUMES.map((v) => html`<option value="${v}" ${raw(v === volume ? 'selected' : '')}>${t(`sales.vol.${v}`, volVars)}</option>`)}</select>`)}
      <div class="field"><span class="label">${t('sales.use')}</span><div class="row">${USES.map((u) => html`<label class="check"><input type="checkbox" data-s="use" value="${u}" ${raw(u === use ? 'checked' : '')}>${t(`sales.use.${u}`)}</label>`)}</div></div>
      ${field(t('sales.prefLang'), html`<select class="select" data-s="lang">${['en', 'th', 'zh'].map((l) => html`<option value="${l}" ${raw(l === getLang() ? 'selected' : '')}>${{ en: 'English', th: 'ไทย', zh: '中文' }[l]}</option>`)}</select>`)}
      <p class="hint-xs">${t('sales.hours')}</p>
    </div>`;
  return drawer({
    title: t('sales.contactTitle'),
    body,
    buttons: [
      { label: t('common.cancel'), action: 'sl.contact.cancel' },
      {
        label: t('sales.send'), kind: 'primary', action: 'sl.contact.send', onClick: (h) => {
          const ref = addSalesRequest('contact', { volume: h.el.querySelector('[data-s="volume"]').value });
          toast(t('sales.sentContact', { ref }), { kind: 'success', demo: true });
          return true;
        },
      },
    ],
  });
}

export const sales = { requestPlan, contact };
