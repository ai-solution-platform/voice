// Shared money flows:
//   ui.topup({ annual, goLive, source })   Top-up drawer → demo checkout (no card fields) → success · toast T12
//   ui.goLive()                             Go-live modal → top-up → "Switch to Live?" → Live
//   ui.goLivePopover(anchor)                First-run: the aria-disabled "Live" button explains what is needed
//   ui.spendingLimits({ onSaved })          Daily / monthly limits · block new calls + notify · toast T32
// Demo: nothing is charged. Offers never combine — the best single one applies (prices.js topUpBonus).

import { html, raw, on, effect, reducedMotion } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { fmt } from '../core/format.js';
import { store } from '../core/store.js';
import { go } from '../core/router.js';
import { topUp, setEnv, setStep, balance, audit } from '../core/actions.js';
import { PRICES, topUpBonus, firstTopUpOfferActive } from '../data/prices.js';
import { modal, drawer } from './modal.js';
import { popover } from './popover.js';
import { confirm } from './confirm.js';
import { toast } from './toast.js';
import { icon } from './icons.js';

const AMOUNTS = [2000, 5000, 10000, 20000, 50000];
const POPULAR = 20000;
export const MIN_TOPUP = 2000;

export function openTopUp({ goLive = false, annual = false, source = '' } = {}) {
  // first: the drawer opens with focus on the selected amount (never on "Other", which would read as choosing it).
  const st = { amount: store.get('mode') === 'active' ? POPULAR : 5000, other: '', otherOn: false, annual, method: 'card', view: 'pick', busy: false, first: true };
  const firstTopUp = !store.get('credits.firstTopUpUsedAt');
  const amount = () => (st.other ? Number(String(st.other).replace(/[^\d]/g, '')) || 0 : st.amount);
  const bonusNow = () => topUpBonus(amount(), { firstTopUp, annual: st.annual });

  const offerLine = () => {
    const b = bonusNow();
    if (b.id === 'firstTopUp') return t('topup.offerFirst', { pct: PRICES.offers.firstTopUpPct, cap: fmt.int(PRICES.offers.firstTopUpCap), until: fmt.dateProse(PRICES.offers.firstTopUpUntil) });
    if (b.id === 'annual') return t('topup.offerAnnual', { pct: PRICES.offers.annualTopUpPct });
    if (!firstTopUp) return t('topup.offerUsed', { date: fmt.dateProse(store.get('credits.firstTopUpUsedAt')), pct: PRICES.offers.annualTopUpPct });
    return t('topup.offerNone');
  };

  const pickBody = () => {
    const a = amount();
    const b = bonusNow();
    const valid = a >= MIN_TOPUP;
    return html`
      ${goLive ? html`<div class="note note-info" style="margin-bottom:12px">${icon('rocket')}<div>${t('topup.goLiveNote', { rate: fmt.rate(PRICES.outbound) })}</div></div>` : ''}
      <div class="field"><span class="label">${t('topup.amount')}</span>
        <div class="grid g-3" style="gap:8px">${AMOUNTS.map((v) => html`<button type="button" class="optcard" data-action="tu.amt" data-value="${v}" aria-pressed="${!st.otherOn && !st.other && st.amount === v}" ${raw(st.first && st.amount === v ? 'autofocus' : '')}><span class="t tnum">${fmt.int(v)}</span><span class="h">${v === POPULAR ? t('topup.popular') : t('common.credits')}</span></button>`)}
          <label class="optcard" style="cursor:text" aria-pressed="${st.otherOn || !!st.other}"><span class="t">${t('topup.other')}</span><input class="input tnum" data-tu="other" inputmode="numeric" value="${st.other}" placeholder="${fmt.int(MIN_TOPUP)}" aria-label="${t('topup.otherAria', { min: fmt.int(MIN_TOPUP) })}" style="min-height:30px;padding:4px 8px;margin-top:2px"></label></div>
        ${st.other && !valid ? html`<span class="field-err">${t('topup.min', { min: fmt.int(MIN_TOPUP) })}</span>` : ''}
      </div>
      <div class="note ${b.bonus ? 'note-brand' : ''}" style="margin-top:12px">${icon('sparkles')}<div><strong>${offerLine()}</strong><div class="hint-xs" style="margin-top:2px">${t('topup.noStack')}</div></div></div>
      <label class="check" style="margin-top:10px"><input type="checkbox" data-tu="annual" ${raw(st.annual ? 'checked' : '')}>${t('topup.annual', { pct: PRICES.offers.annualTopUpPct })}</label>
      <div class="field" style="margin-top:12px"><span class="label">${t('topup.method')}</span>
        <div class="row">${['card', 'transfer', 'invoice'].map((m) => html`<label class="radio"><input type="radio" name="tu-method" data-tu="method" value="${m}" ${raw(st.method === m ? 'checked' : '')}>${t(`topup.m.${m}`)}</label>`)}</div></div>
      <div class="card card-sunken" style="margin-top:14px;padding:12px 14px">
        <div class="kv"><span class="k">${t('topup.sumCredits')}</span><span class="v">${fmt.int(a)}</span></div>
        <div class="kv"><span class="k">${t('topup.sumBonus')}</span><span class="v">+${fmt.int(b.bonus)}</span></div>
        <div class="kv kv-total"><span class="k">${t('topup.sumTotal')}</span><span class="v tnum">${fmt.int(a + b.bonus)}</span></div>
        <div class="kv"><span class="k">${t('topup.sumAfter')}</span><span class="v">${fmt.credits2(balance() + a + b.bonus)}</span></div>
        <span class="hint-xs">${t('topup.creditUnit')} · ${t('common.plannedPrices')}</span>
      </div>`;
  };

  const checkoutBody = () => {
    const a = amount();
    const thb = Math.round(a * 107) / 100;
    return html`<div class="note note-info">${icon('lock')}<div><strong>${t('topup.checkoutTitle')}</strong><div class="hint-xs">${t('topup.checkoutNote')}</div></div></div>
      <div class="card card-sunken" style="margin-top:14px;padding:14px">
        <div class="kv"><span class="k">${t('topup.sumCredits')}</span><span class="v">${fmt.int(a)}</span></div>
        <div class="kv"><span class="k">${t('topup.method')}</span><span class="v">${t(`topup.m.${st.method}`)}</span></div>
        <div class="kv kv-total"><span class="k">${t('topup.amountThb')}</span><span class="v tnum">${t('topup.thbIncl', { amount: fmt.credits2(thb) })}</span></div>
      </div>`;
  };

  const doneBody = (r) => html`<div class="empty empty-center" style="padding:24px 8px">
      <svg class="ico ico-xl check-draw" style="width:52px;height:52px;color:var(--green-700)" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.8 2.8L16.2 9.5"/></svg>
      <h3 style="font-size:var(--fs-lg)">${t('topup.done', { total: fmt.int(r.total) })}</h3>
      <p class="hint">${r.bonus ? t('topup.doneBonus', { bonus: fmt.int(r.bonus) }) : t('topup.doneNoBonus')}</p>
      <p class="hint-xs">${t('topup.invoice', { id: r.invoice.id })}</p></div>`;

  const buttons = () => {
    if (st.view === 'checkout') {
      return [
        { label: t('common.back'), action: 'tu.back', onClick: (h) => { st.view = 'pick'; refresh(h); return false; } },
        { label: t('topup.pay'), kind: 'primary', action: 'tu.pay', onClick: (h, btn) => {
          if (st.busy) return false;
          st.busy = true;
          btn.setAttribute('aria-busy', 'true');
          btn.innerHTML = String(html`<span class="spin"></span>${t('topup.processing')}`);
          setTimeout(() => {
            const r = topUp(amount(), { annual: st.annual });
            st.view = 'done';
            h.setTitle(t('topup.title'));
            h.setBody(doneBody(r));
            h.setButtons([{ label: t('common.done'), kind: 'navy', action: 'tu.done', onClick: () => { if (goLive) setTimeout(askSwitchLive, 220); } }]);
            toast(t('toast.T12', { total: fmt.int(r.total), bonus: fmt.int(r.bonus) }), { kind: 'success', demo: true });
            effect('topup', { total: r.total, source });
          }, reducedMotion() ? 300 : 1200);
          return false;
        } },
      ];
    }
    return [
      { label: t('common.cancel'), action: 'tu.cancel' },
      { label: t('topup.checkout'), kind: 'primary', action: 'tu.checkout', disabled: amount() < MIN_TOPUP, onClick: (h) => { st.view = 'checkout'; refresh(h); return false; } },
    ];
  };

  const refresh = (h) => {
    const f = document.activeElement && document.activeElement.dataset.tu ? `[data-tu="${document.activeElement.dataset.tu}"]` : null;
    const caret = document.activeElement && document.activeElement.selectionStart;
    h.setBody(st.view === 'checkout' ? checkoutBody() : pickBody());
    h.setButtons(buttons());
    h.setTitle(st.view === 'checkout' ? t('topup.checkoutHead') : goLive ? t('topup.titleGoLive') : t('topup.title'));
    if (f) { const el = h.el.querySelector(f); if (el) { el.focus(); try { el.setSelectionRange(caret, caret); } catch { /* radio */ } } }
  };

  const d = drawer({
    title: goLive ? t('topup.titleGoLive') : t('topup.title'),
    sub: t('topup.sub'),
    body: pickBody(),
    buttons: buttons(),
    actions: { 'tu.amt': (el, ev, h) => { st.amount = Number(el.dataset.value); st.other = ''; st.otherOn = false; refresh(h); } },
  });
  st.first = false;
  // Only a real pointer press or key press counts as choosing "Other" — not focus moved there by code.
  let userAt = 0;
  const mark = () => { userAt = Date.now(); };
  on(d.el, 'pointerdown', mark);
  on(d.el, 'keydown', mark);
  on(d.el, 'input', '[data-tu="other"]', (ev, el) => { st.other = el.value; refresh(d); });
  // Clicking "Other" selects it at once (the amount buttons un-press), before anything is typed. The choice lives in
  // st.otherOn, so it survives re-renders (annual toggle, payment method) and a second click reads as "already selected".
  on(d.el, 'focusin', '[data-tu="other"]', (ev, el) => {
    if (Date.now() - userAt > 600) return;
    st.otherOn = true;
    d.el.querySelectorAll('[data-action="tu.amt"]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    el.closest('.optcard').setAttribute('aria-pressed', 'true');
  });
  on(d.el, 'change', '[data-tu]', (ev, el) => {
    if (el.dataset.tu === 'annual') { st.annual = el.checked; refresh(d); }
    if (el.dataset.tu === 'method') st.method = el.value;
  });
  return d;
}

async function askSwitchLive() {
  const ok = await confirm({ title: t('golive.confirmTitle'), body: t('golive.confirmBody', { rate: fmt.rate(PRICES.outbound), limit: fmt.int(store.get('limits.daily') || 0) }), confirmLabel: t('golive.confirmYes'), cancelLabel: t('golive.stay') });
  if (!ok) return;
  setEnv('live');
  setStep('live', 'done');
  toast(t('toast.T37', { env: t('top.live') }), { kind: 'success' });
}

/** Go-live modal. With enough credits it goes straight to the confirm. */
export function goLive() {
  if (store.get('env') === 'live') { toast(t('golive.already'), { kind: 'info' }); return null; }
  if (balance() >= MIN_TOPUP) { askSwitchLive(); return null; }
  return modal({
    title: t('golive.title'),
    body: html`<ol class="stack" style="margin:0;padding-left:20px;color:var(--text-2)">
        <li>${t('golive.step1')}</li>
        <li>${t('golive.step2')} <span class="chip chip-ok">${t('golive.docsSample')}</span></li>
      </ol>
      <p class="hint" style="margin-top:12px">${t('golive.price', { rate: fmt.rate(PRICES.outbound) })}</p>
      <p class="hint" style="margin-top:6px">${t('golive.limit', { limit: fmt.int(store.get('limits.daily') || 5000) })}</p>
      <p class="hint-xs" style="margin-top:10px">${t('golive.carryOver')}</p>
      ${firstTopUpOfferActive() && !store.get('credits.firstTopUpUsedAt') ? html`<p class="hint-xs" style="margin-top:4px">${t('golive.bonusLine', { pct: PRICES.offers.firstTopUpPct })}</p>` : ''}`,
    buttons: [
      { label: t('golive.stay'), action: 'gl.stay' },
      { label: t('golive.topup'), kind: 'primary', action: 'gl.topup', onClick: () => { setTimeout(() => openTopUp({ goLive: true, source: 'golive' }), 180); } },
    ],
  });
}

/** First-run: "Live" is aria-disabled; clicking it explains what is needed. */
export function goLivePopover(anchor) {
  const h = popover(anchor, {
    label: t('golive.title'),
    className: 'golive-pop',
    content: html`<div style="padding:8px 10px;max-width:300px" class="stack">
      <strong style="font-size:var(--fs-sm)">${t('golive.popTitle')}</strong>
      <span class="hint">${t('golive.popBody', { rate: fmt.rate(PRICES.outbound) })}</span>
      <div class="row"><button type="button" class="btn btn-primary btn-sm" data-action="glp.topup">${t('top.topup')}</button>
      <a class="btn btn-sm" href="#/help/article/sandbox-rules" data-action="glp.learn">${t('common.learnMore')}</a></div></div>`,
    actions: {
      'glp.topup': (el, ev, hh) => { hh.close(); goLive(); },
      'glp.learn': (el, ev, hh) => { hh.close(); go('help/article/sandbox-rules'); },
    },
  });
  return h;
}

/** Spending-limits modal (bl.limits.edit · ov.chk.5 · ov.spend.edit). */
export function spendingLimits({ onSaved } = {}) {
  const lim = store.get('limits') || {};
  const today = store.get('mode') === 'active' ? (store.get('today.creditsUsedVoice') || 0) + (store.get('today.creditsUsedOther') || 0) : 0;
  const body = html`<div class="stack-3">
      <label class="field"><span class="label">${t('limits.daily')}</span><input class="input tnum" data-lim="daily" inputmode="numeric" value="${lim.daily || 5000}"><span class="hint-xs">${t('limits.dailyHint')}</span></label>
      <label class="field"><span class="label">${t('limits.monthly')} <span class="opt">${t('common.optional')}</span></span><input class="input tnum" data-lim="monthly" inputmode="numeric" value="${lim.monthly || ''}"></label>
      <span class="field-err" data-lim="warn" hidden>${t('limits.belowToday', { today: fmt.credits2(today) })}</span>
      <div class="field"><span class="label">${t('limits.whenReached')}</span><div class="note">${icon('shield')}<span>${t('limits.blockFixed')}</span></div></div>
      <div class="field"><span class="label">${t('limits.notify')}</span><div class="row">
        <label class="check"><input type="checkbox" data-lim="email" ${raw((lim.channels || []).includes('email') ? 'checked' : '')}>${t('limits.email')}</label>
        <label class="check"><input type="checkbox" data-lim="line" ${raw((lim.channels || []).includes('line') ? 'checked' : '')}>LINE</label></div></div>
      <p class="hint-xs">${t('limits.note')}</p></div>`;
  const m = modal({
    title: t('limits.title'),
    body,
    buttons: [
      { label: t('common.cancel'), action: 'lm.cancel' },
      { label: t('common.save'), kind: 'navy', action: 'lm.save', onClick: (h, btn) => {
        const num = (k) => Number(String(h.el.querySelector(`[data-lim="${k}"]`).value).replace(/[^\d]/g, '')) || null;
        const daily = num('daily') || 5000;
        const channels = ['email', 'line'].filter((c) => h.el.querySelector(`[data-lim="${c}"]`).checked);
        btn.setAttribute('aria-busy', 'true');
        btn.innerHTML = String(html`<span class="spin"></span>${t('common.save')}`);
        setTimeout(() => {
          store.set('limits', { ...lim, daily, monthly: num('monthly'), channels });
          audit('limit.daily.set', { to: daily });
          setStep('cap', 'done');
          toast(t('toast.T32'), { kind: 'success' });
          h.close();
          if (onSaved) onSaved();
        }, 500);
        return false;
      } },
    ],
  });
  on(m.el, 'input', '[data-lim="daily"]', (ev, el) => {
    const v = Number(String(el.value).replace(/[^\d]/g, '')) || 0;
    m.el.querySelector('[data-lim="warn"]').hidden = !(v && v < today);
  });
  return m;
}
