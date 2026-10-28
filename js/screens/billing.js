// Billing & Credits — #/billing   (query: ?panel=topup|auto|limits|compare · ?section=prices|usage|limits|offers|statements|invoices)
// Balance and burn, top-up (ui.topup, best single offer), the rate card with "Planned launch prices", volume plans
// (request only — never a one-click switch), the "Which price fits you?" calculator, usage by product, statements
// and invoices (generated CSV / printable HTML), spending limits (the daily limit blocks new calls).
// Every price comes from js/data/prices.js; every total from the store (js/data/active.js) so Overview = Billing = Reports.

import { html as h, raw, on, reducedMotion } from '../core/dom.js';
import { isActive, balance, addSalesRequest, describeProfile, isPostpaid, postpaidInvoices, creditRate, prepaidPlanAdjust, planMinutesBalance, numberFeesMonth, sessionNumberFees, planAlerts, setPlanAlert, PLAN_ALERT_LEVELS, sessionUsage, sessionPlanMinutes, usageToday, usageMonth } from '../core/actions.js';
import { nowMs } from '../data/clock.js';
import { PRICES, comparePlans, paygCost, firstTopUpOfferActive } from '../data/prices.js';

export const id = 'billing';
export const nav = { group: 'account', icon: 'card', labelKey: 'nav.billing' };
export const titleKey = 'nav.billing';
export const skeleton = 'dashboard';
export const css = true;
export const initialState = { stmt: 'all', planHiddenAt: null, fresh: null, _raw: null };

export const commands = [
  { id: 'compare', labelKey: 'cmd.compare', icon: 'chart', keywords: ['volume plan compare price calculator which price'], run: ({ go }) => go('billing?panel=compare') },
  { id: 'invoices', labelKey: 'cmd.invoices', icon: 'file-text', keywords: ['invoice statement download'], run: ({ go }) => go('billing?section=invoices') },
];

// The statement month on screen (demo clock: October 2026). September is closed; its voice/other split is a
// sample value (September is not shown on any other screen).
const CUR_PERIOD = '2026-10';
const SEP_VOICE_USED = 47180;
// Other channels (SMS · LINE · Email) per day, sample: the 7 days 21–27 Oct add up to 3,290 (Billing 7-day average).
const OTHER_PER_DAY = { '2026-10-14': 520, '2026-10-15': 480, '2026-10-16': 470, '2026-10-17': 310, '2026-10-18': 260, '2026-10-19': 610, '2026-10-20': 500, '2026-10-21': 590, '2026-10-22': 560, '2026-10-23': 330, '2026-10-24': 390, '2026-10-25': 300, '2026-10-26': 830, '2026-10-27': 290 };
const VOICE_ITEMS = ['outbound', 'otp', 'inbound', 'recording', 'numbers', 'extraConcurrent'];
const SECTIONS = ['prices', 'usage', 'limits', 'offers', 'statements', 'invoices', 'mode', 'plan', 'upcoming'];
const r2 = (n) => Math.round(n * 100) / 100;

// ---------- data helpers ----------
const live = (ctx) => isActive() && ctx.store.get('env') === 'live';
const invoices = (ctx) => ctx.list('billing.invoices');
/** Demo top-ups made in this session (credits incl. bonus). */
function demoTopUps(ctx) {
  return invoices(ctx).filter((i) => i.demo).reduce((s, i) => s + i.credits + (i.bonus || 0), 0);
}
/** Statements with the current month kept live: closing = the balance now, used = opening + top-ups − closing. */
function statements(ctx) {
  const list = ctx.list('billing.statements');
  const demoInv = invoices(ctx).filter((i) => i.demo);
  const demoCredits = demoInv.reduce((s, i) => s + i.credits, 0);
  const demoBonus = demoInv.reduce((s, i) => s + (i.bonus || 0), 0);
  // Prepaid + plan: the plan charge (its own invoice) is part of this month's money in. It bought the plan minutes,
  // a separate balance from the credits, so the month closes on both: credits + unused plan minutes at the plan rate.
  const adj = prepaidPlanAdjust();
  const planCredits = adj ? adj.planCredits : 0;
  const pm = adj ? planMinutesBalance() : null;
  const planLeft = pm ? pm.credits : 0;
  // …and "used" is two parts as well: the credits charged (= Used this month) and the plan minutes used (at the plan rate).
  const planUsedMin = pm ? Math.max(0, pm.included - pm.minutes) : 0;
  const split = () => ({ credits: balance(), planLeft, planMin: pm ? pm.minutes : 0, closing: r2(balance() + planLeft), planUsedMin, planUsedValue: pm ? r2(planUsedMin * pm.rate) : 0 });
  if (!list.length) {
    if (!demoInv.length && !adj) return [];
    const sp = split();
    const used = Math.max(0, r2(demoCredits + demoBonus + planCredits - sp.closing));
    return [{ period: CUR_PERIOD, status: 'current', opening: 0, topUps: demoCredits, bonus: demoBonus, planCredits, used, ...sp, usedVoice: used }];
  }
  return list.map((s) => {
    if (s.status !== 'current') return { ...s, usedVoice: SEP_VOICE_USED };
    const topUps = s.topUps + demoCredits;
    const bonus = s.bonus + demoBonus;
    const sp = split();
    const used = r2(s.opening + topUps + bonus + planCredits - sp.closing);
    const usedVoice = r2(used - ((ctx.store.get('billing.usedMonth') || {}).other || 0));
    return { ...s, topUps, bonus, planCredits, ...sp, used, usedVoice };
  });
}
/** Prepaid + plan: the plan minutes shown as their own balance (null otherwise, and in Sandbox). */
const prepaidPlanMinutes = (ctx) => (!postpaid() && ctx.store.get('env') !== 'sandbox' ? planMinutesBalance() : null);
/** The rule for unused plan minutes at the end of this cycle, in words. */
function planExpiryLine(ctx, pm) {
  const { t, fmt } = ctx;
  if (pm.policy === 'rollover') return t('mode.planMin.rollover', { date: fmt.dateProse(pm.expires), next: fmt.dateProse(pm.renews) });
  if (pm.policy === 'carry') return t('mode.planMin.carry', { date: fmt.dateProse(pm.expires), count: pm.carryMonths || 1 });
  return t('mode.planMin.expire', { date: fmt.dateProse(pm.expires) });
}
/** Session usage other than number fees (those are in the "Numbers" line, live from the numbers list). The same in every billing mode. */
const demoCalls = () => Math.max(0, r2(sessionUsage() - sessionNumberFees()));
/**
 * Usage rows this month: the sample usage with the number fees taken live from the numbers list (the same figure
 * as Numbers › "Number fees this month", the statement and the invoice), plus calls made in this demo session.
 */
function usageRows(ctx) {
  const fees = numberFeesMonth();
  const rows = ctx.list('billing.usage').map((u) => (u.item === 'numbers' ? { ...u, quantity: fees.count, credits: fees.credits, fees } : u));
  if (fees.credits && !rows.some((u) => u.item === 'numbers')) rows.unshift({ product: 'voice', item: 'numbers', quantity: fees.count, unit: 'number', credits: fees.credits, fees });
  return rows;
}
/** Used today / this month: one definition for every billing mode (actions.js usageToday / usageMonth). */
function usedToday(ctx) {
  const u = usageToday();
  if (u) return u;
  const used = (statements(ctx)[0] || {}).used || 0;
  return { total: used, voice: used, other: 0, planMin: 0 };
}
function usedMonth(ctx) {
  const u = usageMonth();
  if (u) return u;
  const used = (statements(ctx)[0] || {}).used || 0;
  return { total: used, voice: used, other: 0, planMin: 0 };
}
/** Outbound minutes in the last 30 days: the one figure the plan banner, the calculator and a plan request use. */
function last30(ctx) {
  return (ctx.store.get('series') || []).slice(-30).reduce((s, d) => s + d.outMin, 0);
}
const planRequest = (ctx) => ctx.list('sales.requests').filter((r) => r.kind === 'plan').slice(-1)[0];
const hiddenNudge = (ctx) => ctx.state.planHiddenAt && nowMs() - ctx.state.planHiddenAt < 30 * 86400000;
/** The plan nudge: only in the live busy account, only when a plan is open at the last 30 days' volume, never in Sandbox. */
function nudge(ctx) {
  if (!live(ctx) || hiddenNudge(ctx) || planRequest(ctx) || profile().plan) return null;
  const minutes = last30(ctx);
  const c = comparePlans(minutes);
  if (c.contactSales || !c.suggestPlan) return null;
  const payg = c.options.find((o) => o.id === 'payg').cost;
  return { minutes, plan: c.suggestPlan, payg, planCost: c.suggestPlan.cost, save: payg - c.suggestPlan.cost };
}

// ---------- how the account pays (store billing.profile via describeProfile(); prepaid when it is missing) ----------
const isoDay = (d) => d.toISOString().slice(0, 10);
/** The billing set-up in the shape the cards use. */
function profile() {
  const d = describeProfile();
  const p = d.plan;
  let plan = null;
  if (p) {
    const next = new Date(`${p.nextCycle}T00:00:00Z`);
    const start = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() - 1, next.getUTCDate()));
    plan = {
      id: p.id, committed: p.committedMinutes, rate: p.rate, day: p.cycleStartDay, used: p.usedMinutes, remaining: p.leftMinutes || 0,
      overage: p.overageMinutes || 0, overageCredits: p.overageCredits || 0, monthlyCharge: p.monthlyCharge, pct: p.pctUsed,
      policy: p.unusedPolicy, carryMonths: p.carryMonths || 0, carried: p.carriedMinutes || 0, added: p.includedCreditsAdded,
      next: p.nextCycle, start: isoDay(start), end: isoDay(new Date(next.getTime() - 86400000)),
    };
  }
  return {
    mode: d.mode, creditLimit: d.creditLimit || 0, termsDays: d.paymentTermsDays || 30, used: d.usedThisMonth || 0, pct: d.pctOfLimit || 0,
    available: d.available, openInvoice: d.openInvoice, plan, limitBy: d.limitBy, monthlyLimit: d.monthlyLimit, creditLeft: d.creditLeft,
  };
}
const postpaid = () => isPostpaid();
const modeRequest = (ctx) => ctx.list('sales.requests').filter((r) => r.kind === 'billing-mode' || r.kind === 'plan-change').slice(-1)[0];
/** Postpaid monthly invoices, newest first (the open month recalculated from live usage). */
function monthlyInvoices() {
  return postpaidInvoices().map((x) => ({
    id: x.id, period: x.period, status: x.status, amount: Number(x.credits) || 0, issued: x.issuedAt || null, due: x.dueAt || null, paid: x.paidAt || null,
    lines: x.lines || [], net: x.net, vat: x.vat, total: x.total, plan: ((x.lines || []).find((l) => l.kind === 'plan') || {}).credits ?? null,
  }));
}

/** Busy button for a simulated server call. */
function busy(btn, ms = 600) {
  return new Promise((resolve) => {
    const prev = btn ? btn.innerHTML : '';
    if (btn) {
      btn.setAttribute('aria-busy', 'true');
      const ico = btn.querySelector('svg.ico');
      const sp = document.createElement('span');
      sp.className = 'spin';
      if (ico) ico.replaceWith(sp); else btn.prepend(sp);
    }
    setTimeout(() => {
      if (btn && btn.isConnected) { btn.removeAttribute('aria-busy'); btn.innerHTML = prev; }
      resolve();
    }, reducedMotion() ? Math.min(ms, 300) : ms);
  });
}

// ---------- pieces ----------
/** The subtitle names how this account pays: prepaid · postpaid · either one with a monthly commitment plan. */
function subtitle(ctx) {
  const d = describeProfile();
  const vars = { platform: ctx.fmt.int(PRICES.platform) };
  if (d.plan) Object.assign(vars, { min: ctx.fmt.int(d.plan.committedMinutes), rate: ctx.fmt.rate(d.plan.rate) });
  const key = d.mode === 'postpaid' ? (d.plan ? 'subPostpaidPlan' : 'subPostpaid') : d.plan ? 'subPrepaidPlan' : 'sub';
  return ctx.t(key, vars);
}
function header(ctx) {
  const { t, icon } = ctx;
  const req = planRequest(ctx);
  return h`<div class="page-head">
    <div class="titles"><h1>${t('title')}${ctx.pageHelp()}</h1><span class="sub">${subtitle(ctx)}</span></div>
    <div class="tools">
      ${req ? h`<span class="chip chip-warn" tabindex="0" data-tip-key="billing.planReqTip">${icon('clock')}${t('planReq', { ref: req.ref })}</span>` : ''}
      <button type="button" class="btn" data-action="bl.export">${icon('download')}${t('exportUsage')}</button>
      ${postpaid() ? h`<button type="button" class="btn btn-navy" data-action="bl.goinvoices">${icon('file-text')}${t('mode.invoicesBtn')}</button>`
        : h`<button type="button" class="btn btn-primary" data-action="bl.topup">${icon('plus')}${t('topup')}</button>`}
    </div></div>`;
}

function nudgeBanner(ctx) {
  const n = nudge(ctx);
  if (!n) return '';
  const { t, fmt, icon } = ctx;
  return h`<div class="note note-brand bl-nudge" role="status">${icon('sparkles')}
    <div class="grow"><strong>${t('nudge.title', { save: fmt.int(n.save) })}</strong>
      <div>${t('nudge.body', { minutes: fmt.int(n.minutes), rate: fmt.rate(n.plan.rate), min: fmt.int(n.plan.plan.minMinutes), plan: fmt.int(n.planCost), payg: fmt.int(n.payg) })}</div>
      <div class="hint-xs">${t('nudge.terms', { months: PRICES.planMonths })}</div></div>
    <div class="row"><button type="button" class="btn btn-sm btn-navy" data-action="bl.plan.banner">${t('nudge.compare')}</button>
    <button type="button" class="btn btn-sm btn-ghost" data-action="bl.plan.notnow">${t('nudge.notNow')}</button></div></div>`;
}

function tiles(ctx) {
  const { t, fmt, icon } = ctx;
  const sandbox = ctx.store.get('env') === 'sandbox';
  const avg = ctx.store.get('billing.avgPerDay7');
  const lim = ctx.store.get('limits') || {};
  const today = usedToday(ctx);
  const month = usedMonth(ctx);
  const auto = ctx.store.get('billing.autoTopUp');
  const autoOn = auto && typeof auto === 'object' && auto.on;
  const pct = lim.daily ? Math.round((today.total / lim.daily) * 100) : 0;
  const pf = profile();
  const onPlan = !!pf.plan;
  const plus = (n) => ctx.ui.describe.plusPlanMin(n);
  const pm = prepaidPlanMinutes(ctx);
  const credLine = sandbox
    ? t('tile.creditsTrial', { left: fmt.num(Math.max(0, (ctx.store.get('credits.trialTotal') || 0) - (ctx.store.get('credits.trialUsed') || 0)), 1), total: fmt.int(PRICES.trial.minutes) })
    : pm ? t('tile.creditsPlanMin', { n: fmt.int(pm.minutes), date: fmt.dayMonth(pm.expires) })
    : avg && isActive() ? t('tile.creditsRunway', { days: fmt.int(Math.floor(balance() / avg)) }) : t('tile.creditsLine');
  return h`<div class="grid g-5 bl-tiles">
    ${pf.mode === 'postpaid'
      ? h`<div class="card tile" data-bl="left"><span class="t">${t('tile.available')}</span><span class="v">${fmt.credits2(pf.available)}</span><span class="h">${pf.limitBy === 'safety' ? t('tile.availableSafety', { limit: fmt.int(pf.monthlyLimit), cap: fmt.int(pf.creditLimit) }) : t('tile.availableCredit', { cap: fmt.int(pf.creditLimit), used: fmt.credits2(pf.used) })}</span></div>`
      : h`<div class="card tile"><span class="t">${ctx.term(t('tile.credits'), 'credits')}</span><span class="v">${fmt.credits2(balance())}</span><span class="h">${credLine}</span></div>`}
    <a class="card tile tile-link" href="#/reports?range=today" data-action="bl.tile.today"><span class="t">${t('tile.today')}</span><span class="v">${fmt.credits2(today.total)}</span><span class="h">${onPlan ? t('tile.todayLinePlan', { plan: plus(today.planMin), voice: fmt.credits2(today.voice), other: fmt.credits2(today.other) }) : t('tile.todayLine', { voice: fmt.credits2(today.voice), other: fmt.credits2(today.other) })}</span></a>
    <button type="button" class="card tile tile-link bl-tilebtn" data-action="bl.tile.month"><span class="t">${t('tile.month')}</span><span class="v">${fmt.credits2(month.total)}</span><span class="h">${onPlan ? t('tile.monthLinePlan', { plan: plus(month.planMin), voice: fmt.credits2(month.voice), other: fmt.credits2(month.other) }) : t('tile.monthLine', { voice: fmt.credits2(month.voice), other: fmt.credits2(month.other) })}${lim.monthly ? h` · ${t('tile.ofMonthly', { pct: Math.round((month.total / lim.monthly) * 100), limit: fmt.int(lim.monthly) })}` : ''}</span></button>
    <button type="button" class="card tile tile-link bl-tilebtn" data-action="bl.tile.limit"><span class="t">${t('tile.limit')}</span><span class="v">${fmt.int(lim.daily || 0)}</span><span class="h">${t(onPlan ? 'tile.limitLinePlan' : 'tile.limitLine', { pct })}</span></button>
    ${pf.mode === 'postpaid' ? h`<button type="button" class="card tile tile-link bl-tilebtn" data-action="bl.goinvoices"><span class="t">${t('tile.terms')}</span><span class="v">${t('mode.termsDays', { count: pf.termsDays })}</span><span class="h">${pf.openInvoice && pf.openInvoice.issuedAt ? t('tile.termsLine', { date: fmt.dayMonth(pf.openInvoice.issuedAt) }) : t('tile.termsLineNone')}</span></button>` : h`<button type="button" class="card tile tile-link bl-tilebtn" data-action="bl.tile.auto" data-inv="bl.auto"><span class="t">${t('tile.auto')}</span><span class="v">${autoOn ? t('auto.on') : t('auto.off')}</span><span class="h">${autoOn ? t('tile.autoLine', { below: fmt.int(auto.below), add: fmt.int(auto.add) }) : t('tile.autoOff')}</span>
      <span class="toggle bl-toggle-ro" aria-hidden="true" ${raw(autoOn ? 'data-on="true"' : '')}></span></button>`}
  </div>`;
}

function chartCard(ctx) {
  const { t, fmt } = ctx;
  const series = (ctx.store.get('series') || []).slice(-14);
  if (!series.length) {
    return h`<div class="card bl-chart" data-inv="bl.chart"><div class="card-head"><h2>${t('chart.title')}</h2></div>
      <div class="empty empty-center"><span class="art">${ctx.icon('chart')}</span><strong>${t('chart.empty')}</strong><span class="hint">${t('chart.emptyHint')}</span>
      <a class="btn btn-sm btn-navy" href="#/test-call" data-action="bl.chart.empty">${ctx.icon('phone')}${t('chart.emptyBtn')}</a></div></div>`;
  }
  // Today also counts what this demo session charged and drew, so "Today so far" = Used today.
  const todayKey = new Date(nowMs() + 7 * 3600000).toISOString().slice(0, 10);
  const onPlan = !!profile().plan;
  const rows = series.map((d) => {
    const isToday = d.date === todayKey && isActive();
    return { date: d.date, voice: r2(d.credits + (isToday ? sessionUsage() : 0)), other: OTHER_PER_DAY[d.date] || 0, planMin: (d.planMin || 0) + (isToday ? sessionPlanMinutes() : 0) };
  });
  const tip = (r) => (onPlan ? t('chart.tipPlan', { day: fmt.dayMonth(r.date), voice: fmt.credits2(r.voice), other: fmt.int(r.other), plan: ctx.ui.describe.plusPlanMin(r.planMin) }) : t('chart.tip', { day: fmt.dayMonth(r.date), voice: fmt.credits2(r.voice), other: fmt.int(r.other) }));
  const max = Math.max(...rows.map((r) => r.voice + r.other));
  const scale = max * 1.08;
  const total = rows.reduce((s, r) => s + r.voice + r.other, 0);
  return h`<div class="card bl-chart" data-inv="bl.chart"><div class="card-head"><h2>${t('chart.title')}</h2><span class="hint">${t('chart.range', { from: fmt.dayMonth(rows[0].date), to: fmt.dayMonth(rows[rows.length - 1].date) })}</span>
      <span class="bl-legend"><span><i class="sw sw-voice"></i>${t('chart.voice')}</span><span><i class="sw sw-other"></i>${t('chart.other')}</span></span></div>
    <div class="card-body"><div class="bl-bars" role="img" aria-label="${t('chart.aria', { from: fmt.dayMonth(rows[0].date), to: fmt.dayMonth(rows[rows.length - 1].date), total: fmt.int(total) })}">
      ${rows.map((r, i) => {
        const last = i === rows.length - 1;
        return h`<span class="bl-bar ${last ? 'is-last' : ''}" tabindex="0" data-tip="${tip(r)}" aria-label="${tip(r)}">
          <span class="bl-stack" style="height:${((r.voice + r.other) / scale * 100).toFixed(1)}%"><i class="o" style="flex:${r.other}"></i><i class="v" style="flex:${r.voice.toFixed(0)}"></i></span>
          <span class="bl-day"><b>${Number(r.date.slice(8))}</b><span class="wd">${weekdayLabel(ctx, r.date, false)}</span><span class="wdn" aria-hidden="true">${weekdayLabel(ctx, r.date, true)}</span></span></span>`;
      })}</div>
      ${chartSummary(ctx, rows)}
      <p class="hint-xs bl-chart-note">${onPlan ? h`${t('chart.notePlan')} ` : ''}${t('chart.note')}</p></div></div>`;
}

/** Three figures under the chart: the 7-day average (the same pace the top bar uses), the highest day, today so far. */
function chartSummary(ctx, rows) {
  const { t, fmt } = ctx;
  const sum = (r) => r.voice + r.other;
  const full = rows.slice(-7);
  const avg = full.length ? full.reduce((s, r) => s + sum(r), 0) / full.length : 0;
  const top = rows.reduce((a, r) => (sum(r) > sum(a) ? r : a), rows[0]);
  const today = rows[rows.length - 1];
  const item = (label, value, line) => h`<div class="bl-sum"><span class="hint-xs">${label}</span><strong class="tnum">${value}</strong><span class="hint-xs">${line}</span></div>`;
  return h`<div class="bl-sums">
    ${item(t('chart.avg'), fmt.credits2(avg), full.length ? t('chart.range', { from: fmt.dayMonth(full[0].date), to: fmt.dayMonth(full[full.length - 1].date) }) : '')}
    ${item(t('chart.top'), fmt.credits2(sum(top)), fmt.dayMonth(top.date))}
    ${item(t('chart.today'), fmt.credits2(sum(today)), t('chart.todayLine', { time: fmt.timeShort(nowMs()) }))}</div>`;
}

function usageCard(ctx) {
  const { t, fmt, icon } = ctx;
  const usage = usageRows(ctx);
  const d = demoCalls(ctx);
  if (!usage.length && !d && !sessionPlanMinutes()) {
    return h`<section class="card bl-usage" id="bl-usage" aria-labelledby="bl-usage-h"><div class="card-head"><h2 id="bl-usage-h">${t('usage.title')}</h2></div>
      <div class="empty"><span class="art">${icon('list')}</span><strong>${t('usage.empty')}</strong><span class="hint">${t('usage.emptyHint')}</span>
      <a class="btn btn-sm" href="#/help/article/billing-credits" data-action="bl.usage.learn">${icon('book')}${t('usage.learn')}</a></div></section>`;
  }
  const voice = usage.filter((u) => u.product === 'voice');
  const others = usage.filter((u) => u.product !== 'voice');
  const voiceSum = r2(voice.reduce((s, u) => s + u.credits, 0) + d);
  const total = r2(voiceSum + others.reduce((s, u) => s + u.credits, 0));
  const row = (u) => h`<tr class="bl-click" data-action="bl.usage.row" data-value="${u.product}" tabindex="0">
      <td><span class="strong">${t(`usage.item.${u.item}`)}</span>${u.product === 'voice' ? h` <span class="hint-xs">· ${t('usage.voice')}</span>` : ''}${u.fees && u.fees.first ? h`<span class="hint-xs bl-block">${t('up.numbersSub', { full: fmt.int(u.fees.full), first: fmt.int(u.fees.first) })}</span>` : ''}</td>
      <td class="num mono">${u.product === 'voice' ? h`${fmt.int(u.quantity)} ${t(`usage.unit.${u.unit}`, { count: u.quantity })}${u.planMin ? h`<span class="hint-xs bl-block">${t('usage.planQty')}</span>` : ''}` : h`<span class="hint-xs" title="${t('usage.otherQty')}">—</span>`}</td><td class="num mono">${fmt.credits2(u.credits)}</td></tr>`;
  const sessMin = sessionPlanMinutes();
  return h`<section class="card bl-usage" id="bl-usage" aria-labelledby="bl-usage-h"><div class="card-head"><h2 id="bl-usage-h">${t('usage.title')}</h2><span class="hint">${t('usage.range', { to: fmt.dayMonth(nowMs()) })}</span></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>${t('usage.product')}</th><th class="num">${t('usage.qty')}</th><th class="num">${t('usage.credits')}</th></tr></thead>
    <tbody>${voice.map(row)}
      ${d || sessMin ? h`<tr class="bl-click" data-action="bl.usage.row" data-value="voice" tabindex="0"><td><span class="strong">${t('usage.item.demo')}</span> <span class="chip chip-navy">${t('common.demoTag')}</span></td><td class="num mono">${sessMin ? h`<span class="hint-xs">${ctx.ui.describe.plusPlanMin(sessMin)}</span>` : '—'}</td><td class="num mono">${fmt.credits2(d)}</td></tr>` : ''}
      <tr class="bl-sub"><td>${t('usage.voiceSub')}</td><td></td><td class="num mono">${fmt.credits2(voiceSum)}</td></tr>
      ${others.map(row)}
      <tr class="bl-total"><td>${t('usage.total')}</td><td></td><td class="num mono">${fmt.credits2(total)}</td></tr></tbody></table></div>
    <div class="card-foot hint-xs">${profile().plan ? h`<span class="strong" data-bl="planline">${t('usage.planLine', { n: fmt.int(usedMonth(ctx).planMin || 0), min: fmt.int(profile().plan.committed + (profile().plan.carried || 0)) })}</span><br>${t('usage.planNote', { rate: fmt.rate(profile().plan.rate) })}<br>` : ''}${t('usage.foot')}</div></section>`;
}

function rateCard(ctx) {
  const { t, fmt, icon } = ctx;
  const p = PRICES;
  const [p1, p2] = p.plans;
  const req = planRequest(ctx);
  const cur = profile().plan;
  const mine = (pl) => (cur && cur.id === pl.id ? h`<span class="chip chip-ok">${t('plans.yours')}</span>` : '');
  const row = (label, value, unit, opts = {}) => h`<tr ${raw(opts.cls ? `class="${opts.cls}"` : '')}><td>${label}</td><td class="num ${typeof value === 'string' ? 'mono' : ''} strong nowrap">${value}</td><td class="hint">${unit}</td></tr>`;
  const sales = (label) => h`<a class="linkbtn" href="#/help/contact?topic=sales" data-action="bl.rates.sales">${label}</a>`;
  return h`<section class="card bl-rates" id="bl-prices" aria-labelledby="bl-prices-h">
    <div class="card-head"><h2 id="bl-prices-h">${t('rates.title')} <span class="hint">· ${t('common.credits')}</span></h2>
      <span class="chip chip-warn" tabindex="0" data-tip-key="common.plannedPricesTip">${t('common.plannedPrices')}</span></div>
    <div class="tbl-wrap"><table class="tbl bl-rate-tbl"><thead><tr><th>${t('rates.item')}</th><th class="num">${t('rates.credits')}</th><th>${t('rates.unit')}</th></tr></thead><tbody>
      ${row(t('rates.platform'), fmt.int(p.platform), t('rates.platformUnit'))}
      ${row(t('rates.outbound'), fmt.rate(p.outbound), h`${t('rates.outboundUnit')} · ${ctx.term(t('rates.firstMinute'), 'billing_minute')}`)}
      <tr class="bl-plans-row"><td colspan="3"><div class="bl-plans">
        <div class="row" style="justify-content:space-between"><strong>${ctx.term(t('plans.title', { months: p.planMonths }), 'volume_plan')}</strong>${req ? h`<span class="chip chip-warn">${t('planReq', { ref: req.ref })}</span>` : ''}</div>
        <div class="bl-plan-grid">
          <div class="bl-plan ${cur && cur.id === p1.id ? 'is-mine' : ''}"><span class="hint-xs">${t('plans.from', { min: fmt.int(p1.minMinutes) })}</span><span class="bl-plan-rate">${fmt.rate(p1.rate)}</span><span class="hint-xs">${t('plans.perMin')}</span>${mine(p1)}</div>
          <div class="bl-plan ${cur && cur.id === p2.id ? 'is-mine' : ''}"><span class="hint-xs">${t('plans.from', { min: fmt.int(p2.minMinutes) })}</span><span class="bl-plan-rate">${fmt.rate(p2.rate)}</span><span class="hint-xs">${t('plans.perMin')}</span>${mine(p2)}</div>
          <div class="bl-plan bl-plan-sales"><span class="hint-xs">${t('plans.bigger', { min: fmt.int(p.plansContactSalesFrom) })}</span><span class="bl-plan-rate">${sales(t('plans.contactSales'))}</span><span class="hint-xs">${t('plans.custom')}</span></div>
        </div>
        <p class="hint-xs">${t('plans.foot', { months: p.planMonths })}</p>
        <div class="row"><button type="button" class="btn btn-sm btn-navy" data-action="bl.plan.compare">${icon('chart')}${t('plans.compare')}</button>
          ${cur ? h`<button type="button" class="btn btn-sm" data-action="bl.plan.change">${icon('send')}${t('commit.change')}</button>` : h`<button type="button" class="btn btn-sm" data-action="bl.plan.request">${icon('send')}${t('plans.request')}</button>`}</div>
      </div></td></tr>
      ${row(t('rates.partner'), sales(t('plans.contactSales')), t('rates.partnerUnit'))}
      ${row(t('rates.otp'), fmt.rate(p.otpPerAnsweredCall), t('rates.otpUnit'))}
      ${row(t('rates.inbound'), fmt.rate(p.inbound), t('rates.perMin'))}
      ${row(t('rates.number'), fmt.int(p.number), t('rates.numberUnit', { bulk: fmt.int(p.numberBulk), from: p.numberBulkFrom }))}
      ${row(t('rates.numberRq'), h`<span class="hint">${t('rates.byQuote')}</span>`, t('rates.numberRqUnit'))}
      ${row(ctx.term(t('rates.trunk'), 'sip_trunk'), fmt.int(p.trunkMonthly), t('rates.trunkUnit', { inc: p.trunkIncludedCalls, extra: fmt.int(p.extraConcurrentCall) }))}
      ${row(t('rates.intl'), fmt.rate(p.international), t('rates.intlUnit'))}
      ${row(ctx.term(t('rates.voiceStd'), 'voice_tier'), t('rates.included'), t('rates.voiceStdUnit'))}
      ${row(t('rates.voicePrem'), `+${fmt.rate(p.premiumVoice)}`, t('rates.voicePremUnit'))}
      ${row(h`${ctx.term(t('rates.transcription'), 'transcription')} <span class="chip chip-info">${t('common.beta')}</span>`, fmt.rate(p.transcription), t('rates.perMin'))}
      ${row(ctx.term(t('rates.recording'), 'retention'), fmt.rate(p.recording), t('rates.recordingUnit', { days: p.recordingDays }))}
    </tbody></table></div>
    <p class="bl-increment" data-rates="increment">${icon('clock')}<span>${t('rates.increment')}</span></p>
    <div class="card-foot stack" style="gap:8px"><div class="row"><span class="chip">${t('rates.soon')}</span><span class="hint-xs">${t('rates.soonList')}</span></div>
      <div class="row" style="justify-content:space-between"><span class="hint-xs">${t('rates.foot')}</span>
      <button type="button" class="btn btn-sm" data-action="bl.rates.download">${icon('download')}${t('rates.download')}</button></div></div></section>`;
}

function limitsCard(ctx) {
  const { t, fmt, icon } = ctx;
  const lim = ctx.store.get('limits') || {};
  const today = usedToday(ctx);
  const month = usedMonth(ctx);
  const bar = (used, max) => {
    const pct = max ? Math.min(100, Math.round((used / max) * 100)) : 0;
    return h`<span class="progress ${pct >= 80 ? 'bl-prog-warn' : 'bl-prog'}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></span>`;
  };
  const chans = (lim.channels || []).map((c) => t(`limits.ch.${c}`)).join(' + ') || t('limits.ch.none');
  const subs = ctx.list('subAccounts').filter((s) => !s.main && s.dailyLimit);
  return h`<section class="card bl-limits" id="bl-limits" aria-labelledby="bl-limits-h"><div class="card-head"><h2 id="bl-limits-h">${t('limits.title')}</h2><span class="hint">${t('limits.sub')}</span>
      <button type="button" class="btn btn-sm" data-action="bl.limits.edit">${icon('edit')}${t('limits.edit')}</button></div>
    <div class="card-body bl-limits-body"><div class="stack-3">
      <div class="stack" style="gap:6px"><div class="row" style="justify-content:space-between"><strong>${t('limits.daily')}</strong><span class="mono">${fmt.credits2(today.total)} / ${fmt.int(lim.daily || 0)}</span></div>${bar(today.total, lim.daily)}
        <span class="hint-xs">${t('limits.dailyHint', { channels: chans })}</span></div>
      <div class="stack" style="gap:6px"><div class="row" style="justify-content:space-between"><strong>${t('limits.monthly')}</strong><span class="mono">${lim.monthly ? h`${fmt.credits2(month.total)} / ${fmt.int(lim.monthly)}` : t('limits.none')}</span></div>${lim.monthly ? bar(month.total, lim.monthly) : ''}
        <span class="hint-xs">${postpaid() ? t('limits.monthlyHintPostpaid', { limit: fmt.int(profile().creditLimit) }) : t('limits.monthlyHint')}</span></div>
      <div class="note note-info">${icon('shield')}<span>${t('limits.blocks')}${profile().plan ? h` ${t('limits.planNote')}` : ''}</span></div>
      </div><div class="stack-3"><div class="bl-kv"><span class="k">${t('limits.dest')}</span><span class="v stack" style="gap:6px;align-items:flex-end">
        <span class="row-tight"><span class="chip chip-ok">${icon('check')}${t('limits.destThai')}</span></span>
        <span class="row-tight"><span class="chip chip-err" tabindex="0" data-inv="bl.dest.premium" data-tip-key="billing.limits.premiumTip">${icon('x-circle')}${t('limits.destPremium')}</span></span>
        <span class="row-tight"><span class="chip">${t('limits.destIntl')}</span><a class="btn btn-sm" href="#/help/contact?topic=international" data-action="bl.dest.request">${t('limits.request', { rate: fmt.rate(PRICES.international) })}</a></span></span></div>
      <div class="bl-kv"><span class="k">${ctx.term(t('limits.perSub'), 'subaccount')}</span><span class="v">${subs.length ? h`<span class="hint-xs">${subs.map((s) => `${ctx.loc(s.name)} ${fmt.int(s.dailyLimit)}`).join(' · ')}</span><br>` : ''}<a class="linkbtn" href="#/users?tab=subaccounts" data-action="bl.sublimits">${t('limits.setInUsers')}</a></span></div>
      <div class="bl-kv"><span class="k">${t('limits.reached')}</span><span class="v">${t('limits.reachedText')} <code class="inline" translate="no">VOICE_4206</code></span></div>
    </div></div></section>`;
}

function offersCard(ctx) {
  const { t, fmt } = ctx;
  const usedAt = ctx.store.get('credits.firstTopUpUsedAt');
  const firstRun = ctx.store.get('mode') === 'firstRun';
  const trialLeftMin = Math.max(0, (ctx.store.get('credits.trialTotal') || 0) - (ctx.store.get('credits.trialUsed') || 0));
  const o = PRICES.offers;
  const pp = postpaid();
  const prepaidOnly = h`<span class="chip" tabindex="0" data-tip="${t('offers.prepaidOnlyTip')}">${t('offers.prepaidOnly')}</span>`;
  const launch = pp ? prepaidOnly : usedAt
    ? h`<span class="chip">${t('offers.usedOn', { date: fmt.dayMonth(usedAt) })}</span>`
    : firstTopUpOfferActive(new Date(nowMs())) ? h`<button type="button" class="btn btn-sm" data-action="bl.offer.row" data-value="launch">${t('offers.topUpNow')}</button>` : h`<span class="chip">${t('offers.ended')}</span>`;
  return h`<section class="card bl-offers" id="bl-offers" aria-labelledby="bl-offers-h"><div class="card-head"><h2 id="bl-offers-h">${t('offers.title')}</h2><span class="hint">${t('offers.sub')}</span></div>
    <ul class="bl-offer-list">
      <li><div class="grow"><strong>${t('offers.launch', { pct: o.firstTopUpPct })}</strong><span class="hint-xs">${t('offers.launchText', { cap: fmt.int(o.firstTopUpCap), until: fmt.dateProse(o.firstTopUpUntil) })}</span></div>${launch}</li>
      <li><div class="grow"><strong>${t('offers.annual', { pct: o.annualTopUpPct })}</strong><span class="hint-xs">${t('offers.annualText')}</span></div>
        ${pp ? prepaidOnly : h`<button type="button" class="btn btn-sm" data-action="bl.offer.row" data-value="annual"><span class="dot dot-ok"></span>${t('offers.available')}</button>`}</li>
      <li><div class="grow"><strong>${t('offers.partner')}</strong><span class="hint-xs">${t('offers.partnerText')}</span></div>
        <a class="btn btn-sm" href="#/help/contact?topic=sales" data-action="bl.offer.row" data-value="partner">${t('plans.contactSales')}</a></li>
      <li><div class="grow"><strong>${t('offers.trial')}</strong><span class="hint-xs">${t('offers.trialText', { min: PRICES.trial.minutes, n: PRICES.trial.verifiedNumbers })}</span></div>
        ${firstRun && !isActive() ? h`<span class="chip chip-info">${t('offers.trialLeft', { left: fmt.num(trialLeftMin, 1) })}</span>` : h`<span class="chip">${t('offers.trialUsed', { date: fmt.dayMonth(ctx.store.get('credits.trialEnds') || nowMs()) })}</span>`}</li>
    </ul><div class="card-foot hint-xs">${t('topup.noStack')}</div></section>`;
}

/** "How you pay": prepaid (top up, auto top-up, low-balance alert) or postpaid (credit limit, used, terms, invoice). */
function modeCard(ctx) {
  const { t, fmt, icon } = ctx;
  const pf = profile();
  const req = modeRequest(ctx);
  const fact = (k, v, line) => h`<div class="bl-fact"><span class="k">${k}</span><span class="v">${v}</span>${line ? h`<span class="hint-xs">${line}</span>` : ''}</div>`;
  let facts;
  if (pf.mode === 'postpaid') {
    const used = pf.used;
    const pct = pf.pct;
    const inv = pf.openInvoice;
    facts = h`${fact(t('mode.limit'), fmt.int(pf.creditLimit), t('mode.limitLine'))}
      <div class="bl-fact"><span class="k">${t('mode.used')}</span><span class="v">${fmt.credits2(used)} <span class="hint-xs">(${pct}%)</span></span>
        <span class="progress ${pct >= 80 ? 'bl-prog-warn' : 'bl-prog'}" role="progressbar" aria-label="${t('mode.used')}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></span>
        ${pf.plan ? h`<span class="hint-xs">${t('mode.usedPlanLine', { charge: fmt.credits2(pf.plan.monthlyCharge) })}</span>` : ''}</div>
      ${fact(t('mode.left'), fmt.credits2(pf.available), pf.limitBy === 'safety' ? t('mode.leftSafety', { limit: fmt.int(pf.monthlyLimit), used: fmt.credits2(usedMonth(ctx).total) }) : t('mode.leftCredit'))}
      ${fact(t('mode.terms'), t('mode.termsDays', { count: pf.termsDays }), inv && inv.issuedAt ? t('mode.termsLine', { date: fmt.dateProse(inv.issuedAt), due: inv.dueAt ? fmt.dateProse(inv.dueAt) : '—' }) : '')}`;
  } else {
    const auto = ctx.store.get('billing.autoTopUp');
    const autoOn = auto && typeof auto === 'object' && auto.on;
    const low = ctx.list('alertRules').find((r) => r.type === 'low-credits');
    // Prepaid + plan: two balances side by side — credits (everything else) and plan minutes (outbound calls only).
    const pm = prepaidPlanMinutes(ctx);
    const balances = pm
      ? h`<div class="bl-fact is-credits" data-bal="credits"><span class="k">${t('mode.creditsBal')}</span><span class="v">${fmt.credits2(balance())}</span><span class="hint-xs">${t('mode.creditsBalLine')}</span></div>
        <div class="bl-fact is-plan" data-bal="plan"><span class="k">${t('mode.planMin.title')}</span><span class="v">${t('mode.planMin.value', { n: fmt.int(pm.minutes), min: fmt.int(pm.included) })}</span>
          <span class="progress bl-prog" role="progressbar" aria-label="${t('mode.planMin.title')}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round((pm.minutes / Math.max(1, pm.included)) * 100)}"><i style="width:${Math.min(100, Math.round((pm.minutes / Math.max(1, pm.included)) * 100))}%"></i></span>
          <span class="hint-xs strong" data-bal="expiry">${planExpiryLine(ctx, pm)}</span><span class="hint-xs">${t('mode.planMin.only')}</span></div>`
      : fact(t('mode.balance'), fmt.credits2(balance()), t('mode.balanceLine'));
    facts = h`${balances}
      ${fact(t('tile.auto'), h`${autoOn ? t('auto.on') : t('auto.off')} <button type="button" class="linkbtn hint-xs" data-action="bl.mode.auto">${t(autoOn ? 'mode.change' : 'mode.setUp')}</button>`, autoOn ? t('tile.autoLine', { below: fmt.int(auto.below), add: fmt.int(auto.add) }) : t('tile.autoOff'))}
      ${fact(t('mode.low'), h`${low && low.on ? t('mode.lowOn', { n: fmt.int((low.condition || {}).below || 0) }) : t('mode.lowOff')} <a class="linkbtn hint-xs" href="#/alerts${low ? `?rule=${low.id}` : ''}" data-action="bl.mode.low">${t('mode.change')}</a>`, t('mode.lowLine'))}`;
  }
  const other = pf.mode === 'postpaid' ? 'prepaid' : 'postpaid';
  return h`<section class="card bl-mode" id="bl-mode" aria-labelledby="bl-mode-h"><div class="card-head"><h2 id="bl-mode-h">${t('mode.title')}</h2>
      <span class="chip ${pf.mode === 'postpaid' ? 'chip-navy' : 'chip-ok'}">${t(`mode.${pf.mode}`)}${pf.plan ? ` + ${t('mode.withPlan', { min: fmt.int(pf.plan.committed) })}` : ''}</span></div>
    <div class="card-body stack-3"><p class="hint bl-mode-what">${t(pf.mode === 'prepaid' && prepaidPlanMinutes(ctx) ? 'mode.prepaidPlanWhat' : `mode.${pf.mode}What`)}</p>
      <div class="bl-facts ${pf.mode === 'prepaid' && prepaidPlanMinutes(ctx) ? 'is-split' : pf.mode === 'postpaid' ? 'is-four' : ''}">${facts}</div>
      <div class="row">${pf.mode === 'prepaid' ? h`<button type="button" class="btn btn-sm btn-primary" data-action="bl.topup">${icon('plus')}${t('topup')}</button>` : ''}
        ${req ? h`<span class="chip chip-warn">${icon('clock')}${t('mode.requested', { ref: req.ref })}</span>`
          : h`<button type="button" class="btn btn-sm" data-action="bl.mode.request" data-value="${other}">${icon('send')}${t('mode.request', { to: t(`mode.${other}`) })}</button>`}
        <a class="linkbtn hint-xs" href="#/help/contact?topic=sales" data-action="bl.mode.sales">${t('plans.contactSales')}</a></div>
      <p class="hint-xs">${t('mode.changeNote')}</p></div></section>`;
}

// ---------- commitment plan: burn-down, month-end projection, usage alerts ----------
const DAY = 86400000;
const bkkMidnight = (ymd) => Date.parse(`${ymd}T00:00:00+07:00`);
/**
 * The plan's minutes over the cycle, from the store: cumulative outbound minutes per day (series; today also counts
 * the calls made in this demo), the ideal straight line to the commitment, and the month-end projection at this
 * cycle's pace (minutes so far ÷ days so far × days in the cycle).
 */
function planBurn(store, p, now = nowMs()) {
  const start = bkkMidnight(p.start);
  const end = bkkMidnight(p.next);
  const cycleDays = Math.round((end - start) / DAY);
  const elapsed = Math.min(cycleDays, Math.max(1 / 24, (now - start) / DAY));
  const included = p.committed + (p.carried || 0);
  const today = new Date(now + 7 * 3600000).toISOString().slice(0, 10);
  const days = (store.get('series') || []).filter((d) => d.date >= p.start && d.date < p.next && d.date <= today);
  const seriesSum = days.reduce((a, d) => a + d.outMin, 0);
  const extra = Math.max(0, p.used - seriesSum);
  let acc = 0;
  const pts = [{ x: 0, y: 0, date: p.start }];
  for (const d of days) {
    acc += d.outMin;
    const isToday = d.date === today;
    pts.push({ x: isToday ? elapsed : (bkkMidnight(d.date) - start) / DAY + 1, y: isToday ? acc + extra : acc, date: d.date });
  }
  if (!days.some((d) => d.date === today)) pts.push({ x: elapsed, y: p.used, date: today });
  const pace = p.used / elapsed;
  const projected = Math.round((pace * cycleDays) / 10) * 10;
  const ideal = Math.round((included * elapsed) / cycleDays);
  const crossed = (min) => (pts.find((q) => q.y >= min) || {}).date || null;
  const reach = (min) => {
    if (p.used >= min) return { reached: crossed(min) || today };
    const at = pace > 0 ? start + (min / pace) * DAY : Infinity;
    return at < end ? { expected: new Date(at + 7 * 3600000).toISOString().slice(0, 10) } : {};
  };
  return { cycleDays, elapsed, included, pts, pace, projected, ideal, over: projected - included, reach, today };
}

function niceTop(v) {
  const p = 10 ** Math.floor(Math.log10(Math.max(1, v)));
  const n = v / p;
  return ([1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((s) => n <= s) || 10) * p;
}

/** Burn-down chart (SVG): used minutes vs the ideal line, the projection to the cycle end and the commitment. */
function burnChart(ctx, p, b) {
  const { t, fmt, esc } = ctx;
  const W = 640, H = 230, L = 56, R = 18, T = 14, B = 30;
  const top = niceTop(Math.max(b.included, b.projected, b.pts[b.pts.length - 1].y) * 1.06);
  const x = (d) => L + (d / b.cycleDays) * (W - L - R);
  const y = (v) => T + (1 - v / top) * (H - T - B);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => top * f);
  const now = b.pts[b.pts.length - 1];
  const used = b.pts.map((q) => `${x(q.x).toFixed(1)},${y(q.y).toFixed(1)}`).join(' ');
  const area = `${x(0)},${y(0)} ${used} ${x(now.x).toFixed(1)},${y(0)}`;
  const xt = [0, 7, 14, 21, 28].filter((d) => d < b.cycleDays - 4);
  const dayLabel = (d) => fmt.dayMonth(new Date(bkkMidnight(p.start) + d * DAY + 12 * 3600000));
  const at80 = Math.round(p.committed * 0.8);
  const aria = t('burn.aria', { used: fmt.int(p.used), min: fmt.int(b.included), now: fmt.dayMonth(nowMs()), ideal: fmt.int(b.ideal), proj: fmt.int(b.projected), end: fmt.dayMonth(p.end) });
  return raw(`<svg class="bl-burn-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}">
    ${ticks.map((v) => `<line class="g" x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="ax" x="${L - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${esc(fmt.compact(v))}</text>`).join('')}
    ${xt.map((d, i) => `<text class="ax${i % 2 ? ' ax-odd' : ''}" x="${x(d).toFixed(1)}" y="${H - 9}" text-anchor="${d === 0 ? 'start' : 'middle'}">${esc(dayLabel(d))}</text>`).join('')}
    <text class="ax" x="${W - R}" y="${H - 9}" text-anchor="end">${esc(fmt.dayMonth(p.end))}</text>
    <line class="lim80" x1="${L}" x2="${W - R}" y1="${y(at80).toFixed(1)}" y2="${y(at80).toFixed(1)}"/><text class="lbl" x="${L + 6}" y="${(y(at80) - 5).toFixed(1)}">80%</text>
    <line class="lim" x1="${L}" x2="${W - R}" y1="${y(b.included).toFixed(1)}" y2="${y(b.included).toFixed(1)}"/><text class="lbl strong" x="${L + 6}" y="${(y(b.included) - 5).toFixed(1)}">${esc(t('burn.planLine', { min: fmt.int(b.included) }))}</text>
    <line class="ideal" x1="${x(0)}" y1="${y(0)}" x2="${x(b.cycleDays).toFixed(1)}" y2="${y(b.included).toFixed(1)}"/>
    <polygon class="area" points="${area}"/>
    <polyline class="used" points="${used}"/>
    <line class="proj" x1="${x(now.x).toFixed(1)}" y1="${y(now.y).toFixed(1)}" x2="${x(b.cycleDays).toFixed(1)}" y2="${y(b.projected).toFixed(1)}"/>
    <circle class="end" cx="${x(b.cycleDays).toFixed(1)}" cy="${y(b.projected).toFixed(1)}" r="4"/>
    <circle class="now" cx="${x(now.x).toFixed(1)}" cy="${y(now.y).toFixed(1)}" r="5"/></svg>`);
}

/** Commitment plan › burn-down, the month-end projection and the 80 % / 100 % alerts you can switch on. */
function burnSection(ctx, p, policy) {
  const { t, fmt } = ctx;
  const b = planBurn(ctx.store, p);
  const rate = p.rate;
  const alerts = planAlerts();
  const chans = ((ctx.store.get('limits') || {}).channels || []).map((c) => t(`limits.ch.${c}`)).join(' + ') || t('limits.ch.none');
  const ahead = p.used - b.ideal;
  const alertRow = (level) => {
    const min = Math.round((p.committed * level) / 100);
    const r = b.reach(min);
    const status = r.reached ? t('burn.reached', { date: fmt.dayMonth(r.reached) }) : r.expected ? t('burn.expected', { date: fmt.dayMonth(r.expected) }) : t('burn.notExpected');
    const id = `bl-al-${level}`;
    return h`<div class="bl-alert-row"><button type="button" class="toggle" role="switch" aria-checked="${!!alerts[level]}" aria-labelledby="${id}" data-action="bl.plan.alert" data-value="${level}"></button>
      <span class="grow"><span class="strong" id="${id}">${t('burn.alertLabel', { pct: level, min: fmt.int(min) })}</span><span class="hint-xs bl-block">${status}</span></span></div>`;
  };
  return h`<div class="bl-burn" data-inv="bl.burn">
    <div class="bl-burn-chart"><div class="row bl-burn-h"><strong>${t('burn.title')}</strong>
      <span class="bl-legend"><span><i class="ln ln-used"></i>${t('burn.legend.used')}</span><span><i class="ln ln-ideal"></i>${t('burn.legend.ideal')}</span><span><i class="ln ln-proj"></i>${t('burn.legend.proj')}</span><span><i class="ln ln-plan"></i>${t('burn.legend.plan')}</span></span></div>
      ${burnChart(ctx, p, b)}</div>
    <div class="bl-burn-side stack-3">
      <div class="bl-proj" role="status"><span class="hint-xs">${t('burn.projTitle', { date: fmt.dayMonth(p.end) })}</span>
        <strong class="tnum" data-burn="projected">${t('burn.projValue', { proj: fmt.int(b.projected), min: fmt.int(b.included) })}</strong>
        <span class="${b.over > 0 ? 'bl-over' : 'bl-unused'}" data-burn="${b.over > 0 ? 'over' : 'unused'}">${b.over > 0
          ? t('burn.over', { n: fmt.int(b.over), credits: fmt.int(b.over * rate), rate: fmt.rate(rate) })
          : t('burn.unused', { n: fmt.int(-b.over), policy })}</span>
        <span class="hint-xs">${t('burn.basis', { pace: fmt.int(b.pace), used: fmt.int(p.used), days: fmt.num(b.elapsed, 1) })}</span>
        <span class="hint-xs">${t(ahead >= 0 ? 'burn.ahead' : 'burn.behind', { ideal: fmt.int(b.ideal), n: fmt.int(Math.abs(ahead)) })}</span></div>
      <div class="bl-alerts"><div class="row bl-burn-h"><strong>${t('burn.alerts')}</strong><span class="hint-xs">${t('burn.alertsHint', { channels: chans })}</span></div>
        ${PLAN_ALERT_LEVELS.map(alertRow)}</div></div></div>`;
}

/** The commitment plan, when the contract has one: monthly charge, use this cycle, overage, unused minutes, next charge. */
function commitCard(ctx) {
  const { t, fmt, icon } = ctx;
  const pf = profile();
  const p = pf.plan;
  if (!p) return '';
  const pct = Math.min(100, Math.round((p.used / p.committed) * 100));
  const policy = p.policy === 'carry' ? t('commit.policy.carry', { count: p.carryMonths || 1 }) : t(`commit.policy.${p.policy}`);
  const fig = (k, v, line, extra = '') => h`<div class="bl-fig"><span class="hint-xs">${k}</span><strong class="tnum">${v}</strong>${extra}${line ? h`<span class="hint-xs">${line}</span>` : ''}</div>`;
  return h`<section class="card bl-commit" id="bl-plan" aria-labelledby="bl-plan-h"><div class="card-head"><h2 id="bl-plan-h">${ctx.term(t('commit.title'), 'volume_plan')}</h2>
      <span class="chip chip-navy">${t('calc.plan', { min: fmt.int(p.committed) })}</span><span class="hint">${t('commit.cycle', { from: fmt.dayMonth(p.start), to: fmt.dayMonth(p.end) })}</span></div>
    <div class="card-body"><div class="bl-figs">
      ${fig(t('commit.committed'), t('commit.committedValue', { min: fmt.int(p.committed) }), t('commit.rateLine', { rate: fmt.rate(p.rate) }))}
      ${fig(t('commit.charge'), fmt.credits2(p.monthlyCharge), t(pf.mode === 'postpaid' ? 'commit.chargePostpaid' : 'commit.chargePrepaid', { day: p.day }))}
      ${fig(t('commit.used'), t('commit.usedValue', { used: fmt.int(p.used), min: fmt.int(p.committed) }), t('commit.left', { n: fmt.int(p.remaining) }),
        h`<span class="progress ${pct >= 90 ? 'bl-prog-warn' : 'bl-prog'}" role="progressbar" aria-label="${t('commit.used')}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></span>`)}
      ${fig(t('commit.overage'), p.overage ? t('commit.overageValue', { n: fmt.int(p.overage), credits: fmt.credits2(p.overageCredits) }) : t('commit.overageNone'), t('commit.overageLine', { min: fmt.int(p.committed), rate: fmt.rate(p.rate) }))}
      ${fig(t('commit.unused'), t('commit.perContract'), policy)}
      ${fig(t('commit.next'), fmt.dateProse(p.next), t('commit.nextLine', { amount: fmt.credits2(p.monthlyCharge) }))}
    </div>
    ${p.added != null || p.carried ? h`<p class="hint-xs bl-commit-note">${p.added != null ? t('commit.added', { min: fmt.int(p.committed), n: fmt.credits2(p.added) }) : ''}${p.added != null && p.carried ? ' · ' : ''}${p.carried ? t('commit.carried', { n: fmt.int(p.carried) }) : ''}</p>` : ''}
    ${burnSection(ctx, p, policy)}</div>
    <div class="card-foot row bl-commit-foot"><span class="hint-xs grow">${t('commit.foot')}</span>
      ${modeRequest(ctx) ? h`<span class="chip chip-warn">${icon('clock')}${t('mode.requested', { ref: modeRequest(ctx).ref })}</span>` : h`<button type="button" class="btn btn-sm" data-action="bl.plan.change">${icon('send')}${t('commit.change')}</button>`}</div></section>`;
}

/** Quantity of an invoice line: "44,726 min", "5,078 answered calls", "6 numbers"; with the rate when asked (printable). */
function lineQty(ctx, l, withRate = false) {
  const { t, fmt } = ctx;
  if (l.quantity == null) return '';
  const unit = l.unit === 'min' ? t('usage.unit.min') : l.unit ? t(`usage.unit.${l.unit}`, { count: l.quantity }) : '';
  const q = `${fmt.int(l.quantity)} ${unit}`.trim();
  return withRate && l.rate != null && l.kind !== 'numbers' ? `${q} × ${fmt.rate(l.rate)}` : q;
}
/** Rate column of the upcoming invoice. */
function lineRate(ctx, l) {
  const { t, fmt } = ctx;
  if (l.kind === 'planMinutes') return t('up.included');
  if (l.kind === 'numbers') return t('up.numbersRate', { price: fmt.int(l.rate) });
  if (l.kind === 'extraConcurrent') return t('up.monthly', { price: fmt.int(l.rate) });
  return l.rate != null ? fmt.rate(l.rate) : '—';
}

/**
 * Postpaid: the invoice that will be issued on the 1st, line by line (Stripe "Upcoming invoice"). The lines come from
 * actions.postpaidInvoices() (live usage + number fees + plan) and add up to "Used this month"; VAT 7 % on top.
 */
function upcomingCard(ctx) {
  const { t, fmt, icon } = ctx;
  const x = monthlyInvoices().find((i) => i.status === 'open');
  if (!x) return '';
  const rate = creditRate().thb || 1;
  // Phones: quantity and rate move under the item name (the two middle columns are hidden), so nothing scrolls sideways.
  const line = (l) => h`<tr><td><span class="strong">${t(`minv.line.${l.kind}`)}</span>${l.kind === 'numbers' && l.first ? h`<span class="hint-xs bl-block">${t('up.numbersSub', { full: fmt.int(l.full), first: fmt.int(l.first) })}</span>` : ''}
      <span class="hint-xs bl-block bl-m-only">${[lineQty(ctx, l), lineRate(ctx, l)].filter((v) => v && v !== '—').join(' · ')}</span></td>
    <td class="num tnum nowrap bl-d-only">${lineQty(ctx, l) || '—'}</td><td class="num tnum bl-d-only">${lineRate(ctx, l)}</td><td class="num mono">${fmt.credits2(l.credits)}</td></tr>`;
  const foot = (label, value, key, cls = '') => h`<tr class="${cls}"><td>${label}</td><td class="bl-d-only"></td><td class="bl-d-only"></td><td class="num mono" data-up="${key}">${value}</td></tr>`;
  // The subtotal says what it is made of, and claims "= Used this month" only when that is the same figure:
  // with a plan, the fixed plan charge + the credits used this month; without one, the credits used this month.
  const usedNow = (usageMonth() || {}).total;
  const planCharge = x.plan || 0;
  const usagePart = r2(x.amount - planCharge);
  const same = usedNow != null && Math.abs(usagePart - usedNow) < 0.005;
  const subLabel = !same ? t('up.subtotalPlain') : x.plan != null ? t('up.subtotalPlan', { plan: fmt.credits2(planCharge), used: fmt.credits2(usagePart) }) : t('up.subtotal');
  return h`<section class="card bl-up" id="bl-upcoming" aria-labelledby="bl-up-h"><div class="card-head"><h2 id="bl-up-h">${t('up.title', { date: fmt.dayMonth(x.issued) })}</h2>
      <span class="chip chip-info" tabindex="0" data-tip="${t('up.draftTip')}">${t('up.draft')}</span>
      <span class="hint">${t('up.sub', { month: monthLabel(ctx, x.period), due: fmt.dateProse(x.due) })}</span></div>
    ${x.lines.length ? h`<div class="tbl-wrap" data-pin="none"><table class="tbl bl-up-tbl"><thead><tr><th>${t('up.item')}</th><th class="num bl-d-only">${t('up.qty')}</th><th class="num bl-d-only">${t('up.rate')}</th><th class="num">${t('up.amount')}</th></tr></thead>
      <tbody>${x.lines.map(line)}
        ${foot(subLabel, fmt.credits2(x.amount), 'subtotal', 'bl-sub')}
        ${foot(t('up.vat'), fmt.credits2(x.vat), 'vat')}
        ${foot(t('up.total'), fmt.credits2(x.total), 'total', 'bl-total')}</tbody></table></div>`
    : h`<div class="empty"><span class="art">${icon('file-text')}</span><strong>${t('up.empty')}</strong></div>`}
    <div class="card-foot row bl-up-foot"><span class="hint-xs grow">${t('up.foot', { thb: fmt.rate(rate), end: fmt.dayMonth(x.issued) })}</span>
      <button type="button" class="btn btn-sm" data-action="bl.up.preview">${icon('file-text')}${t('up.preview')}</button>
      <button type="button" class="btn btn-sm" data-action="bl.stmt.csv" data-value="${x.period}">${icon('download')}${t('stmt.csv')}</button></div></section>`;
}

/** Postpaid: one invoice a month, each with a printable invoice and the calls of that month as CSV. */
function monthlyInvoicesCard(ctx) {
  const { t, fmt, icon } = ctx;
  const list = monthlyInvoices();
  const rate = creditRate().thb || 1;
  const chip = (x) => (x.status === 'open' ? h`<span class="chip chip-info">${t('minv.draft')}</span>` : x.status === 'paid' ? h`<span class="chip chip-ok">${t('minv.paid')}${x.paid ? ` ${fmt.dayMonth(x.paid)}` : ''}</span>` : h`<span class="chip chip-warn">${t('minv.due', { date: x.due ? fmt.dayMonth(x.due) : '' })}</span>`);
  return h`<section class="card bl-stmt" id="bl-statements" aria-labelledby="bl-minv-h"><div class="card-head"><h2 id="bl-minv-h">${t('minv.title')}</h2><span class="hint">${t('minv.sub')}</span></div>
    ${list.length ? h`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>${t('stmt.period')}</th><th>${t('stmt.status')}</th><th>${t('minv.issued')}</th><th>${t('minv.dueOn')}</th><th class="num">${t('minv.amount')}</th></tr></thead>
      <tbody>${list.map((x) => h`<tr><td><span class="strong nowrap">${monthLabel(ctx, x.period)}</span> <span class="mono hint-xs" translate="no">${x.id}</span>
          <span class="row-tight bl-files"><button type="button" class="linkbtn hint-xs" data-action="bl.minv.pdf" data-value="${x.id}">${icon('file-text', 'ico-xs')}${t('minv.invoice')}</button><button type="button" class="linkbtn hint-xs" data-action="bl.stmt.csv" data-value="${x.period}">${icon('download', 'ico-xs')}${t('stmt.csv')}</button></span></td>
        <td>${chip(x)}</td><td class="nowrap">${x.issued ? tableDate(ctx, x.issued) : '—'}</td><td class="nowrap">${x.due ? tableDate(ctx, x.due) : '—'}</td>
        <td class="num mono strong">${fmt.credits2(x.amount)}${x.plan != null ? h`<span class="hint-xs bl-block">${t('minv.planPart', { n: fmt.credits2(x.plan) })}</span>` : ''}</td></tr>`)}</tbody></table></div>
      <div class="card-foot hint-xs">${t('minv.foot', { thb: fmt.rate(rate) })} <span data-inv="taxlang">${t('print.taxLang')}</span></div>`
    : h`<div class="empty"><span class="art">${icon('file-text')}</span><strong>${t('minv.empty')}</strong></div>`}</section>`;
}

function statementsCard(ctx) {
  const { t, fmt, icon } = ctx;
  const list = statements(ctx);
  const voiceOnly = ctx.state.stmt === 'voice';
  const adj = prepaidPlanAdjust();
  const withPlan = list.some((s) => s.planCredits);
  // Prepaid + plan: the closing is two balances — credits and the unused plan minutes (at the plan rate).
  const cur = list.find((s) => s.status === 'current');
  const pm = adj ? planMinutesBalance() : null;
  const splitFoot = cur && pm ? h`<br><span data-stmt="usedfoot">${t('stmt.usedPlanLine', { used: fmt.credits2(cur.used), credits: fmt.credits2(r2(cur.used - cur.planUsedValue)), n: fmt.int(cur.planUsedMin), rate: fmt.rate(pm.rate), value: fmt.credits2(cur.planUsedValue) })}</span>
    <br><span data-stmt="splitfoot">${t('stmt.footSplit', { closing: fmt.credits2(cur.closing), credits: fmt.credits2(cur.credits), n: fmt.int(pm.minutes), plan: fmt.credits2(cur.planLeft), rate: fmt.rate(pm.rate), date: tableDate(ctx, pm.expires) })}</span>` : '';
  return h`<section class="card bl-stmt" id="bl-statements" aria-labelledby="bl-stmt-h"><div class="card-head"><h2 id="bl-stmt-h">${t('stmt.title')}</h2>
      <div class="seg seg-sm" role="group" aria-label="${t('stmt.title')}">${['all', 'voice'].map((s) => h`<button type="button" data-action="bl.stmt.seg" data-value="${s}" aria-pressed="${ctx.state.stmt === s}">${t(`stmt.seg.${s}`)}</button>`)}</div></div>
    ${list.length ? h`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>${t('stmt.period')}</th><th>${t('stmt.status')}</th><th class="num">${t('stmt.opening')}</th><th class="num">${t('stmt.topups')}</th><th class="num">${t('stmt.bonus')}</th>${withPlan ? h`<th class="num">${t('stmt.planCredits')}</th>` : ''}<th class="num">${voiceOnly ? t('stmt.usedVoice') : t('stmt.used')}</th><th class="num">${t('stmt.closing')}</th></tr></thead>
      <tbody>${list.map((s) => h`<tr><td><span class="strong nowrap">${monthLabel(ctx, s.period)}</span>
          <span class="row-tight bl-files"><button type="button" class="linkbtn hint-xs" data-action="bl.stmt.csv" data-value="${s.period}">${icon('download', 'ico-xs')}${t('stmt.csv')}</button><button type="button" class="linkbtn hint-xs" data-action="bl.stmt.pdf" data-value="${s.period}">${icon('file-text', 'ico-xs')}${t('stmt.pdf')}</button></span></td>
        <td>${s.status === 'current' ? h`<span class="chip chip-warn">${t('stmt.current')}</span>` : h`<span class="chip">${t('stmt.closed')}</span>`}</td>
        <td class="num mono">${fmt.credits2(s.opening)}</td><td class="num mono">${fmt.credits2(s.topUps)}</td><td class="num mono">${s.bonus ? `+${fmt.credits2(s.bonus)}` : '0.00'}</td>${withPlan ? h`<td class="num mono">${s.planCredits ? `+${fmt.credits2(s.planCredits)}` : '0.00'}</td>` : ''}
        <td class="num mono">${fmt.credits2(voiceOnly ? s.usedVoice : s.used)}${s.status === 'current' && s.planCredits ? h`<span class="hint-xs bl-block bl-d-only bl-closing-split" data-stmt="usedsplit"><span class="bl-block">${t('stmt.usedSplitCredits', { credits: fmt.credits2(r2((voiceOnly ? s.usedVoice : s.used) - s.planUsedValue)) })}</span><span class="bl-block">${t('stmt.usedSplitPlan', { n: fmt.int(s.planUsedMin) })}</span><span class="bl-block">${t('stmt.usedSplitValue', { value: fmt.credits2(s.planUsedValue) })}</span></span>` : ''}</td><td class="num mono strong">${fmt.credits2(s.closing)}${s.status === 'current' && s.planCredits ? h`<span class="hint-xs bl-block bl-d-only bl-closing-split" data-stmt="split"><span class="bl-block">${t('stmt.splitCredits', { credits: fmt.credits2(s.credits) })}</span><span class="bl-block">${t('stmt.splitPlan', { plan: fmt.credits2(s.planLeft) })}</span></span>` : ''}</td></tr>`)}</tbody></table></div>
      <div class="card-foot hint-xs">${voiceOnly ? t('stmt.footVoice') : withPlan ? t('stmt.footWithPlan') : t('stmt.foot')}${adj ? h`<br>${t('stmt.footPlan', { min: fmt.int(profile().plan.committed + (profile().plan.carried || 0)), id: adj.invoice.id, date: tableDate(ctx, adj.invoice.date) })}
        ${splitFoot}
        <button type="button" class="linkbtn hint-xs" data-action="bl.stmt.planinv" data-value="${adj.invoice.id}">${t('stmt.openPlanInv', { id: adj.invoice.id })}</button>` : ''}</div>`
    : h`<div class="empty"><span class="art">${icon('file-text')}</span><strong>${t('stmt.empty')}</strong><span class="hint">${t('stmt.emptyHint')}</span></div>`}
  </section>`;
}

/** Chart axis weekday. Thai uses the narrow form (อา, จ …) because the short form is the whole word; phones use narrow in every language. */
function weekdayLabel(ctx, date, narrow) {
  const loc = ctx.lang === 'th' ? 'th-TH' : ctx.lang === 'zh' ? 'zh-CN' : 'en-GB';
  return new Intl.DateTimeFormat(loc, { weekday: narrow || ctx.lang === 'th' ? 'narrow' : 'short', timeZone: 'Asia/Bangkok' }).format(new Date(`${date}T12:00:00+07:00`));
}

/** Billing table date: Thai shows the Buddhist year like the statements and documents (12 ต.ค. 2569). */
function tableDate(ctx, d) {
  if (ctx.lang !== 'th') return ctx.fmt.date(d);
  const dt = typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T12:00:00+07:00`) : new Date(d);
  return new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' }).format(dt);
}

function monthLabel(ctx, period) {
  const d = new Date(`${period}-15T12:00:00+07:00`);
  const loc = ctx.lang === 'th' ? 'th-TH' : ctx.lang === 'zh' ? 'zh-CN' : 'en-GB';
  return new Intl.DateTimeFormat(loc, { month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok' }).format(d);
}

/** Invoice type: a top-up, or the commitment plan charge ("Plan · 50,000 min"). */
function invType(ctx, i) {
  if (!i.plan) return ctx.t('inv.typeTopup');
  const pl = PRICES.plans.find((x) => x.id === i.plan);
  return ctx.t('inv.typePlan', { min: ctx.fmt.int(i.minutes || (pl ? pl.minMinutes : 0)) });
}

function invoicesCard(ctx) {
  const { t, fmt, icon } = ctx;
  const list = invoices(ctx);
  return h`<section class="card bl-inv" id="bl-invoices" aria-labelledby="bl-inv-h"><div class="card-head"><h2 id="bl-inv-h">${t('inv.title')}</h2><span class="hint">${t('inv.sub')}</span></div>
    ${list.length ? h`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>${t('inv.no')}</th><th class="bl-d-only">${t('inv.type')}</th><th>${t('inv.date')}</th><th class="num">${t('inv.credits')}</th><th class="num">${t('inv.net')}</th><th class="num">${t('inv.vat')}</th><th class="num">${t('inv.total')}</th><th><span class="sr-only">${t('stmt.files')}</span></th></tr></thead>
      <tbody>${list.map((i) => h`<tr class="${ctx.state.fresh === i.id || ctx.state.flashInv === i.id ? 'new-row' : ''}" data-inv-row="${i.id}"><td class="mono strong nowrap" translate="no">${i.id}${i.demo ? h` <span class="chip chip-navy">${t('common.demoTag')}</span>` : ''}<span class="hint-xs bl-block bl-m-only">${invType(ctx, i)}</span></td>
        <td class="nowrap bl-d-only">${i.plan ? h`<span class="chip chip-info">${invType(ctx, i)}</span>` : invType(ctx, i)}</td><td class="nowrap">${tableDate(ctx, i.date)}</td>
        <td class="num mono">${fmt.int(i.credits)}${i.bonus ? h` <span class="hint-xs">+${fmt.int(i.bonus)} ${t('inv.bonus')}</span>` : ''}</td><td class="num mono">${fmt.credits2(i.net)}</td><td class="num mono">${fmt.credits2(i.vat)}</td><td class="num mono strong">${fmt.credits2(i.total)}</td>
        <td class="num nowrap"><button type="button" class="btn btn-sm" data-action="bl.inv.download" data-value="${i.id}">${icon('file-text')}${t('inv.download')}</button>
          <button type="button" class="btn btn-sm" data-action="bl.inv.csv" data-value="${i.id}">${icon('download')}${t('inv.csv')}</button></td></tr>`)}</tbody></table></div>
      <div class="card-foot hint-xs">${t('inv.foot')} <span data-inv="taxlang">${t('print.taxLang')}</span></div>`
    : h`<div class="empty"><span class="art">${icon('file-text')}</span><strong>${t('inv.empty')}</strong><span class="hint">${t('inv.emptyHint')}</span>
      <button type="button" class="btn btn-sm btn-navy" data-action="bl.inv.topup">${icon('plus')}${t('topup')}</button></div>`}</section>`;
}

// ---------- screen contract ----------
export function render(ctx) {
  if (ctx.state._raw !== ctx.params.raw) { ctx.state._raw = ctx.params.raw; ctx.state._handled = false; }
  const pp = postpaid();
  return h`<div class="page bl"><span class="sr-only" aria-live="polite" data-bl-live></span>${header(ctx)}${nudgeBanner(ctx)}${tiles(ctx)}
    ${pp ? upcomingCard(ctx) : ''}
    ${commitCard(ctx)}
    <div class="grid g-2 bl-row2">${modeCard(ctx)}${offersCard(ctx)}</div>
    <div class="grid bl-row1">${chartCard(ctx)}${usageCard(ctx)}</div>
    ${rateCard(ctx)}
    ${limitsCard(ctx)}
    ${pp ? monthlyInvoicesCard(ctx) : statementsCard(ctx)}${pp ? '' : invoicesCard(ctx)}</div>`;
}

// ---------- files ----------
function rateCardCsv(ctx) {
  const { t } = ctx;
  const p = PRICES;
  const rows = [
    { item: 'platform', unit: 'month', credits: p.platform, note: 'console, API, campaigns, phone menus, reports, sandbox' },
    { item: 'outbound_thai', unit: 'minute', credits: p.outbound, note: 'pay as you go; first minute in full, then per minute' },
    ...p.plans.map((pl) => ({ item: `volume_plan_${pl.minMinutes}`, unit: 'minute', credits: pl.rate, note: `${p.planMonths}-month commitment from ${pl.minMinutes} min/month; terms confirmed with sales` })),
    { item: `volume_plan_${p.plansContactSalesFrom}_plus`, unit: 'minute', credits: '', note: 'contact sales' },
    { item: 'partner_wholesale', unit: '', credits: '', note: 'contact sales' },
    { item: 'otp_notification_call', unit: 'answered call', credits: p.otpPerAnsweredCall, note: `up to ${p.otpMaxSec} s; unanswered calls are free` },
    { item: 'inbound', unit: 'minute', credits: p.inbound, note: '' },
    { item: 'thai_number', unit: 'number per month', credits: p.number, note: `${p.numberBulk} each from ${p.numberBulkFrom} numbers` },
    { item: 'thai_number_by_request', unit: 'number per month', credits: '', note: 'mobile 06/08/09, toll-free 1800, 4-digit 1xxx: by quote; no fee until the number is live; toll-free: you pay every inbound minute; 4-digit: plus the NBTC fee' },
    { item: 'sip_trunk', unit: 'month', credits: p.trunkMonthly, note: `${p.trunkIncludedCalls} concurrent calls included` },
    { item: 'extra_concurrent_call', unit: 'call per month', credits: p.extraConcurrentCall, note: '' },
    { item: 'international', unit: 'minute', credits: p.international, note: 'on request' },
    { item: 'standard_voice', unit: 'minute', credits: p.standardVoice, note: 'included (TH / EN / ZH)' },
    { item: 'premium_voice', unit: 'minute', credits: p.premiumVoice, note: 'on top of the call' },
    { item: 'transcription', unit: 'minute', credits: p.transcription, note: 'optional, beta' },
    { item: 'recording', unit: 'minute', credits: p.recording, note: `kept ${p.recordingDays} days` },
  ].map((r) => ({ ...r, credits: r.credits === '' ? '' : Number(r.credits).toFixed(2) }));
  rows.push({ item: '#', unit: '', credits: '', note: t('rates.increment') });
  rows.push({ item: '#', unit: '', credits: '', note: `${t('common.plannedPrices')} · ${t('common.exVat')}` });
  ctx.ui.csv('ants-voice-prices.csv', rows, ['item', 'unit', 'credits', 'note']);
}

function usageCsv(ctx) {
  const usage = usageRows(ctx);
  // SMS, LINE and Email show credits only: their unit prices belong to their own consoles, not to this demo.
  const rows = usage.map((u) => (u.product === 'voice' ? { product: `voice:${u.item}`, quantity: u.quantity, unit: u.unit, credits: u.credits.toFixed(2) } : { product: u.product, quantity: '', unit: '', credits: u.credits.toFixed(2) }));
  const d = demoCalls(ctx);
  if (d) rows.push({ product: 'voice:demo-session', quantity: '', unit: '', credits: d.toFixed(2) });
  if (!rows.length) rows.push({ product: '', quantity: 0, unit: '', credits: '0.00' });
  ctx.ui.csv(`ants-usage_${CUR_PERIOD}.csv`, rows, ['product', 'quantity', 'unit', 'credits']);
}

const CALL_COLS = ['call_id', 'started_at', 'direction', 'source', 'subaccount', 'from', 'to', 'status', 'sip_code', 'q850', 'talk_seconds', 'billed', 'credits', 'recording', 'route', 'campaign_id', 'dtmf', 'reason_text'];
function statementCsv(ctx, period, opts) {
  const { fmt } = ctx;
  const calls = ctx.list('calls').filter((c) => fmt.isoDate(c.ts).startsWith(period));
  const rows = calls.map((c) => ({
    call_id: c.id, started_at: fmt.iso(c.ts), direction: c.direction, source: c.source ? c.source.type : '', subaccount: c.sub || '', from: c.from, to: c.to, status: c.status,
    sip_code: c.sip ?? '', q850: c.q850 ?? '', talk_seconds: c.sec || 0, billed: c.billedMin || 0, credits: (c.credits || 0).toFixed(2), recording: c.recorded ? 'yes' : 'no', route: c.route || '',
    campaign_id: c.source && c.source.type === 'campaign' ? c.source.ref : '', dtmf: c.keys || '', reason_text: c.reason ? ctx.loc(c.reason) : '',
  }));
  const usage = usageRows(ctx);
  const fee = (item) => usage.find((u) => u.item === item);
  if (period === CUR_PERIOD) {
    for (const item of ['numbers', 'extraConcurrent']) {
      const u = fee(item);
      if (u) rows.push({ call_id: `fee:${item}`, started_at: `${period}-01T00:00:00+07:00`, direction: '', source: 'fee', subaccount: '', from: '', to: '', status: '', sip_code: '', q850: '', talk_seconds: '', billed: u.quantity, credits: u.credits.toFixed(2), recording: '', route: '', campaign_id: '', dtmf: '', reason_text: ctx.t(`usage.item.${item}`) });
    }
  }
  if (!rows.length) rows.push(Object.fromEntries(CALL_COLS.map((k) => [k, k === 'reason_text' ? ctx.t('stmt.noCalls') : ''])));
  ctx.ui.csv(`ants-statement-${period}-calls.csv`, rows, CALL_COLS, opts);
}

const printCss = `body{font:14px/1.5 Inter,"Noto Sans Thai","Noto Sans SC",system-ui,sans-serif;color:#1B2B4D;margin:0;padding:40px;background:#fff}
.sheet{max-width:760px;margin:0 auto;position:relative}h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:24px 0 8px}
.wm{position:fixed;top:40%;left:50%;transform:translate(-50%,-50%) rotate(-24deg);font-size:54px;font-weight:800;color:rgba(201,74,18,.13);white-space:nowrap;pointer-events:none}
table{width:100%;border-collapse:collapse;margin-top:8px}th,td{text-align:left;padding:8px;border-bottom:1px solid #E7ECF4}th{font-size:12px;color:#5B6781}
.num{text-align:right;font-variant-numeric:tabular-nums}.muted{color:#5B6781;font-size:12px}.tot td{font-weight:700;border-top:2px solid #14274A}
.cols{display:flex;gap:40px;margin-top:16px}.cols div{flex:1}.bar{height:6px;background:#14274A;border-radius:3px;margin-bottom:16px}
.bk{display:block;margin-top:2px}.tl{margin:16px 0 0;padding:8px 10px;border:1px solid #E7ECF4;border-left:3px solid #14274A;border-radius:4px;font-size:13px}
@media print{body{padding:0}}`;

/** Billing contact on the sample invoice: the account's admin (invented cast), else the owner. */
function billingContact(ctx) {
  const members = ctx.list('members');
  const m = members.find((x) => x.role === 'admin' && x.name && !x.pending) || members.find((x) => x.role === 'owner') || ctx.store.get('user') || {};
  return [m.name, m.email].filter(Boolean).join(' · ') || '—';
}

/**
 * Printable sample (opens the print dialog). `invoice: true` adds what a Thai tax invoice carries for a business
 * buyer — head office / branch no., PO number (optional), billing contact — and the note that tax invoices are
 * issued in Thai or English, in baht (the same note in the Chinese UI: the tax invoice itself is never in Chinese).
 */
function printable(ctx, { title, filename, lines, meta, totals, note, invoice = false }, opts) {
  const { t, esc } = ctx;
  const org = ctx.loc(ctx.store.get('org.name'));
  const buyerRows = [`${esc(t('print.taxId'))} 0-0000-00000-00-0`, `${esc(t('print.branch'))}: ${esc(t('print.headOffice'))}`];
  if (invoice) buyerRows.push(`${esc(t('print.contact'))}: ${esc(billingContact(ctx))}`);
  const metaRows = invoice ? [...meta, [t('print.po'), t('print.poNone')]] : meta;
  const doc = `<!doctype html><html lang="${ctx.lang === 'zh' ? 'zh-Hans' : ctx.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)}</title><style>${printCss}</style></head><body><div class="wm">${esc(t('print.watermark'))}</div><div class="sheet"><div class="bar"></div>
<h1>${esc(title)}</h1><div class="muted">${esc(t('print.sampleNote'))}</div>
<div class="cols"><div><strong>${esc(t('print.seller'))}</strong><br>${esc(t('print.sellerName'))}<br><span class="muted">${esc(t('print.sellerNote'))}</span></div>
<div data-print="buyer"><strong>${esc(t('print.buyer'))}</strong><br>${esc(org)}${buyerRows.map((r) => `<span class="muted bk">${r}</span>`).join('')}</div></div>
<table>${metaRows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>
<h2>${esc(t('print.lines'))}</h2><table><tr><th>${esc(t('print.item'))}</th><th class="num">${esc(t('print.qty'))}</th><th class="num">${esc(t('print.amount'))}</th></tr>
${lines.map(([a, b, c]) => `<tr><td>${esc(a)}</td><td class="num">${esc(b)}</td><td class="num">${esc(c)}</td></tr>`).join('')}
${totals.map(([a, c], i) => `<tr class="${i === totals.length - 1 ? 'tot' : ''}"><td>${esc(a)}</td><td></td><td class="num">${esc(c)}</td></tr>`).join('')}</table>
${invoice ? `<p class="tl" data-print="taxlang">${esc(t('print.taxLang'))}</p>` : ''}
<p class="muted">${esc(note)}</p><p class="muted">${esc(t('common.plannedPrices'))} · ${esc(t('app.demoShort'))}</p></div>
<script>window.addEventListener('load',function(){setTimeout(function(){window.print()},300)});</script></body></html>`;
  ctx.ui.download(filename, doc, 'text/html;charset=utf-8', opts);
}

function invoiceHtml(ctx, inv, opts) {
  const { t, fmt } = ctx;
  const plan = inv.plan ? { min: fmt.int(inv.minutes || inv.credits), rate: fmt.rate(inv.rate || 0), month: monthLabel(ctx, inv.period || String(inv.date).slice(0, 7)) } : null;
  printable(ctx, {
    title: t('print.invoiceTitle', { id: inv.id }),
    filename: `${inv.id}-sample.html`,
    meta: [[t('inv.no'), inv.id], [t('inv.type'), invType(ctx, inv)], [t('inv.date'), fmt.dateProse(inv.date)], [t('print.payment'), t('print.paid')]],
    lines: plan ? [[t('print.planLine', plan), `${plan.min} ${t('minv.min')}`, fmt.credits2(inv.net)]]
      : [[t('print.creditsLine'), fmt.int(inv.credits), fmt.credits2(inv.net)], ...(inv.bonus ? [[t('print.bonusLine'), fmt.int(inv.bonus), '0.00']] : [])],
    totals: [[t('inv.net'), fmt.credits2(inv.net)], [t('inv.vat'), fmt.credits2(inv.vat)], [t('print.totalThb'), fmt.credits2(inv.total)]],
    note: plan ? t('print.planNote') : t('print.creditUnit'),
    invoice: true,
  }, opts);
}
function invoiceCsv(ctx, inv, opts) {
  const row = inv.plan
    ? { invoice: inv.id, date: inv.date, item: `commitment_plan_${inv.minutes || ''}`, quantity: inv.minutes || '', unit: 'minute', rate: (inv.rate || 0).toFixed(2), credits: inv.credits, bonus_credits: 0 }
    : { invoice: inv.id, date: inv.date, item: 'credits_topup', quantity: inv.credits, unit: 'credit', rate: '1.00', credits: inv.credits, bonus_credits: inv.bonus || 0 };
  ctx.ui.csv(`${inv.id}-sample.csv`, [{ ...row, amount_before_vat: inv.net.toFixed(2), vat_7: inv.vat.toFixed(2), total_thb: inv.total.toFixed(2), note: 'SAMPLE - not a tax invoice' }], undefined, opts);
}

function monthlyInvoiceHtml(ctx, x, opts) {
  const { t, fmt } = ctx;
  const rate = creditRate().thb || 1;
  const line = (l) => [t(`minv.line.${l.kind}`), lineQty(ctx, l, true), fmt.credits2(l.credits)];
  printable(ctx, {
    title: t('minv.printTitle', { id: x.id, month: monthLabel(ctx, x.period) }),
    filename: `${x.id}-sample.html`,
    meta: [[t('minv.no'), x.id], [t('stmt.period'), monthLabel(ctx, x.period)], [t('minv.issued'), x.issued ? fmt.dateProse(x.issued) : '—'], [t('minv.dueOn'), x.due ? fmt.dateProse(x.due) : '—']],
    lines: (x.lines.length ? x.lines : [{ kind: 'usage', credits: x.amount }]).filter((l) => l.credits || ['plan', 'planMinutes', 'usage'].includes(l.kind)).map(line),
    totals: [[t('minv.credits'), fmt.credits2(x.amount)], [t('inv.net'), fmt.credits2(x.net ?? x.amount * rate)], [t('inv.vat'), fmt.credits2(x.vat ?? 0)], [t('print.totalThb'), fmt.credits2(x.total ?? 0)]],
    note: t('minv.printNote', { thb: fmt.rate(rate) }),
    invoice: true,
  }, opts);
}

function statementHtml(ctx, period, opts) {
  const { t, fmt } = ctx;
  const s = statements(ctx).find((x) => x.period === period);
  if (!s) return;
  const voiceOnly = ctx.state.stmt === 'voice';
  const pm = s.status === 'current' && s.planCredits ? planMinutesBalance() : null;
  const splitLines = pm ? [[t('stmt.closingCredits'), '', fmt.credits2(s.credits)], [t('stmt.closingPlan', { date: fmt.dateProse(pm.expires) }), `${fmt.int(pm.minutes)} ${t('usage.unit.min')}`, fmt.credits2(s.planLeft)]] : [];
  const usedSplit = pm ? [[`· ${t('common.credits')}`, '', fmt.credits2(r2((voiceOnly ? s.usedVoice : s.used) - s.planUsedValue))], [`· ${t('mode.planMin.title')}`, `${fmt.int(s.planUsedMin)} ${t('usage.unit.min')}`, fmt.credits2(s.planUsedValue)]] : [];
  printable(ctx, {
    title: t('print.stmtTitle', { month: monthLabel(ctx, period) }),
    filename: `ants-statement-${period}-sample.html`,
    meta: [[t('stmt.period'), monthLabel(ctx, period)], [t('stmt.status'), s.status === 'current' ? t('stmt.current') : t('stmt.closed')], [t('print.scope'), t(`stmt.seg.${voiceOnly ? 'voice' : 'all'}`)]],
    lines: [[t('stmt.opening'), '', fmt.credits2(s.opening)], [t('stmt.topups'), '', fmt.credits2(s.topUps)], [t('stmt.bonus'), '', fmt.credits2(s.bonus)], ...(s.planCredits ? [[t('stmt.planCredits'), '', fmt.credits2(s.planCredits)]] : []), [voiceOnly ? t('stmt.usedVoice') : t('stmt.used'), '', `−${fmt.credits2(voiceOnly ? s.usedVoice : s.used)}`], ...usedSplit,
      // The current month itemises "used" with the same rows as Billing › Usage (number fees live from Numbers).
      ...(s.status === 'current' ? usageRows(ctx).filter((u) => !voiceOnly || u.product === 'voice').map((u) => [`· ${t(`usage.item.${u.item}`)}`, u.product === 'voice' ? lineQty(ctx, { quantity: u.quantity, unit: u.unit }) : '', fmt.credits2(u.credits)])
        .concat(demoCalls(ctx) ? [[`· ${t('usage.item.demo')}`, '', fmt.credits2(demoCalls(ctx))]] : []) : []),
      // Prepaid + plan: the closing is two balances — credits and the unused plan minutes (at the plan rate).
      ...splitLines],
    totals: [[t('stmt.closing'), fmt.credits2(s.closing)]],
    note: t('print.stmtNote'),
  }, opts);
}

// ---------- dialogs ----------
function autoTopUp(ctx) {
  const { t, fmt, icon } = ctx;
  const cur = ctx.store.get('billing.autoTopUp');
  const st = cur && typeof cur === 'object' ? { ...cur } : { on: false, below: 5000, add: 20000 };
  const body = h`<div class="stack-3">
    <div class="row bl-switchrow"><button type="button" class="toggle" role="switch" data-a="on" aria-checked="${!!st.on}" aria-labelledby="bl-auto-lbl"></button><span class="strong" id="bl-auto-lbl">${t('auto.enable')}</span></div>
    <div class="grid g-2"><label class="field"><span class="label">${t('auto.below')}</span><input class="input tnum" data-a="below" inputmode="numeric" value="${fmt.int(st.below)}"></label>
      <label class="field"><span class="label">${t('auto.add')}</span><input class="input tnum" data-a="add" inputmode="numeric" value="${fmt.int(st.add)}"></label></div>
    <span class="field-err" data-a="err" hidden>${t('auto.min', { min: fmt.int(2000) })}</span>
    <div class="note">${icon('card')}<span>${t('auto.method')}</span></div>
    <p class="hint-xs">${t('auto.note')}</p></div>`;
  const m = ctx.ui.modal({
    title: t('auto.title'),
    body,
    buttons: [{ label: t('common.cancel') }, {
      label: t('common.save'), kind: 'navy', onClick: (hh, btn) => {
        const num = (k) => Number(String(hh.el.querySelector(`[data-a="${k}"]`).value).replace(/[^\d]/g, '')) || 0;
        const add = num('add');
        if (add < 2000) { hh.el.querySelector('[data-a="err"]').hidden = false; return false; }
        const next = { on: hh.el.querySelector('[data-a="on"]').getAttribute('aria-checked') === 'true', below: num('below'), add };
        busy(btn, 500).then(() => { ctx.store.set('billing.autoTopUp', next); ctx.ui.toast(t('toast.T02'), { kind: 'success' }); hh.close(); });
        return false;
      },
    }],
  });
  on(m.el, 'click', '[data-a="on"]', (ev, el) => { el.setAttribute('aria-checked', el.getAttribute('aria-checked') === 'true' ? 'false' : 'true'); });
  return m;
}

function calculator(ctx, startMinutes) {
  const { t, fmt, icon } = ctx;
  const usage30 = last30(ctx);
  const sandboxOrNew = !isActive();
  const MAX = 250000;
  let minutes = Math.min(MAX, Math.max(0, startMinutes != null ? startMinutes : usage30));
  const results = () => {
    const c = comparePlans(minutes);
    if (c.contactSales) {
      return h`<div class="note note-brand">${icon('building')}<div><strong>${t('calc.salesTitle', { min: fmt.int(PRICES.plansContactSalesFrom) })}</strong><div class="hint-xs">${t('calc.salesBody')}</div></div></div>`;
    }
    // Only the plans open at this volume are listed (comparePlans); each is priced minutes × plan rate.
    const card = (o) => {
      const best = c.best.id === o.id;
      const plan = o.plan;
      return h`<div class="bl-calc-card ${best ? 'is-best' : ''}"><div class="row" style="justify-content:space-between"><strong>${o.id === 'payg' ? t('calc.payg') : t('calc.plan', { min: fmt.int(plan.minMinutes) })}</strong>${best ? h`<span class="chip chip-ok">${t('calc.best')}</span>` : ''}</div>
        <span class="bl-calc-cost tnum">${fmt.int(o.cost)}</span><span class="hint-xs">${t('calc.perMonth')}</span>
        <span class="hint-xs">${o.id === 'payg' ? t('calc.paygLine', { rate: fmt.rate(o.rate) }) : t('calc.planLine', { rate: fmt.rate(o.rate), min: fmt.int(plan.minMinutes), months: PRICES.planMonths })}</span></div>`;
    };
    const next = c.nextPlan;
    const nextLine = next ? t('calc.nextPlan', { rate: fmt.rate(next.rate), min: fmt.int(next.minMinutes) }) : '';
    const verdict = c.suggestPlan
      ? h`${t('calc.saves', { save: fmt.int(c.options[0].cost - c.suggestPlan.cost), min: fmt.int(c.suggestPlan.plan.minMinutes) })}${next ? h` ${nextLine}` : ''}`
      : h`${t('calc.paygBest')} ${nextLine}`;
    return h`<div class="bl-calc-grid">${c.options.map(card)}</div>
      <div class="note ${c.suggestPlan ? 'note-ok' : 'note-info'}" style="margin-top:12px" role="status" aria-live="polite">${icon(c.suggestPlan ? 'check-circle' : 'info')}<span>${verdict}</span></div>`;
  };
  const buttons = () => {
    const c = comparePlans(minutes);
    const list = [{ label: t('common.close') }];
    if (c.contactSales) list.push({ label: t('plans.contactSales'), kind: 'primary', onClick: () => { setTimeout(() => ctx.go('help/contact?topic=sales'), 120); } });
    else if (c.suggestPlan) list.push({ label: t('calc.request', { min: fmt.int(c.suggestPlan.plan.minMinutes) }), kind: 'primary', onClick: () => { setTimeout(() => ctx.ui.sales.requestPlan({ planId: c.suggestPlan.id, minutes }), 200); } });
    return list;
  };
  const body = h`<div class="stack-3">
    <label class="field"><span class="label">${t('calc.minutes')}</span>
      <div class="bl-calc-input"><input type="range" class="bl-range" min="0" max="${MAX}" step="500" value="${minutes}" data-c="range" aria-label="${t('calc.minutes')}" aria-valuetext="${fmt.int(minutes)}">
      <input class="input tnum bl-calc-num" data-c="num" inputmode="numeric" value="${fmt.int(minutes)}" aria-label="${t('calc.minutes')}"></div>
      <span class="hint-xs">${sandboxOrNew ? t('calc.noUsage') : t('calc.last30', { min: fmt.int(usage30) })}</span></label>
    <div data-c="out">${results()}</div>
    <p class="hint-xs">${t('calc.foot')} · ${t('common.plannedPrices')}</p></div>`;
  const d = ctx.ui.drawer({ title: t('calc.title'), sub: t('calc.sub'), body, buttons: buttons() });
  const update = (from) => {
    const out = d.el.querySelector('[data-c="out"]');
    if (out) out.innerHTML = String(results());
    const r = d.el.querySelector('[data-c="range"]');
    const n = d.el.querySelector('[data-c="num"]');
    if (from !== 'range' && r) r.value = String(minutes);
    if (r) r.setAttribute('aria-valuetext', fmt.int(minutes));
    if (from !== 'num' && n) n.value = fmt.int(minutes);
    d.setButtons(buttons());
  };
  on(d.el, 'input', '[data-c="range"]', (ev, el) => { minutes = Number(el.value) || 0; update('range'); });
  on(d.el, 'input', '[data-c="num"]', (ev, el) => { minutes = Math.min(MAX, Number(String(el.value).replace(/[^\d]/g, '')) || 0); update('num'); });
  on(d.el, 'change', '[data-c="num"]', (ev, el) => { el.value = fmt.int(minutes); });
  return d;
}

// ---------- behaviour ----------
// Row-level files (statements, invoices) confirm on the button itself — icon → check and "Downloaded <file>" for
// screen readers — instead of one toast per row: a pile of toasts sits bottom-right, exactly over the next rows'
// buttons. Page-level downloads (usage CSV, rate card, invoice preview) keep the generic "Downloaded" toast.
const QUIET = Object.freeze({ toast: false });
const fileState = new WeakMap();
function fileDone(ctx, el, file) {
  if (!el) return;
  const live = el.closest('.page') && el.closest('.page').querySelector('[data-bl-live]');
  if (live) { live.textContent = ''; live.textContent = ctx.t('common.downloaded', { file }); }
  if (!fileState.has(el)) {
    fileState.set(el, el.innerHTML);
    const ico = el.querySelector('svg.ico');
    if (ico) ico.outerHTML = String(ctx.icon('check', (ico.getAttribute('class') || '').replace(/^ico\s*/, '')));
    el.classList.add('is-done');
  }
  ctx.later(() => { if (el.isConnected && fileState.has(el)) { el.innerHTML = fileState.get(el); fileState.delete(el); el.classList.remove('is-done'); } }, 1600);
}

export function mount(root, ctx) {
  const { t } = ctx;
  const refreshFresh = () => {
    const first = invoices(ctx)[0];
    if (first && first.demo && ctx.state.fresh !== first.id) {
      ctx.setState({ fresh: first.id }, { render: false });
      setTimeout(() => { if (ctx.state.fresh === first.id) ctx.state.fresh = null; }, 2000);
    }
  };
  ctx.actions(root, {
    'bl.topup': () => ctx.ui.topup({ source: 'billing' }),
    'bl.inv.topup': () => ctx.ui.topup({ source: 'billing' }),
    'bl.export': () => usageCsv(ctx),
    'bl.tile.month': () => scrollTo(root, postpaid() ? 'upcoming' : 'usage'),
    'bl.tile.limit': () => ctx.ui.spendingLimits(),
    'bl.tile.auto': () => autoTopUp(ctx),
    'bl.limits.edit': () => ctx.ui.spendingLimits(),
    'bl.plan.banner': () => calculator(ctx, last30(ctx)),
    'bl.plan.compare': () => calculator(ctx),
    'bl.plan.request': () => {
      const minutes = isActive() ? last30(ctx) : 0;
      const c = comparePlans(minutes);
      ctx.ui.sales.requestPlan({ planId: c.suggestPlan ? c.suggestPlan.id : PRICES.plans[0].id, minutes: c.suggestPlan ? minutes : undefined });
    },
    'bl.plan.notnow': () => {
      ctx.setState({ planHiddenAt: nowMs() });
      ctx.ui.toast(t('nudge.hidden'), { kind: 'info', action: { label: t('common.undo'), onClick: () => ctx.setState({ planHiddenAt: null }) }, timeout: 10000 });
    },
    'bl.usage.row': (el) => {
      const p = el.dataset.value;
      if (p === 'voice') ctx.go('reports');
      else ctx.ui.toast(t('toast.T36', { ch: t(`product.${p}`) }), { kind: 'info', demo: true });
    },
    'bl.rates.download': () => rateCardCsv(ctx),
    'bl.goinvoices': () => scrollTo(root, 'statements'),
    'bl.mode.auto': () => autoTopUp(ctx),
    'bl.mode.request': (el) => {
      const to = el.dataset.value;
      const ref = addSalesRequest('billing-mode', { from: profile().mode, to });
      ctx.ui.toast(t('mode.requestedToast', { ref, to: t(`mode.${to}`) }), { kind: 'success', demo: true });
    },
    'bl.plan.change': () => {
      const p = profile().plan;
      const ref = addSalesRequest('plan-change', { plan: p ? p.id : null });
      ctx.ui.toast(t('commit.changeToast', { ref }), { kind: 'success', demo: true });
    },
    'bl.minv.pdf': (el) => { const x = monthlyInvoices().find((i) => i.id === el.dataset.value); if (x) { monthlyInvoiceHtml(ctx, x, QUIET); fileDone(ctx, el, `${x.id}-sample.html`); } },
    'bl.offer.row': (el) => {
      const v = el.dataset.value;
      if (v === 'annual') ctx.ui.topup({ annual: true, source: 'billing-offer' });
      else if (v === 'launch') ctx.ui.topup({ source: 'billing-offer' });
    },
    'bl.stmt.seg': (el) => ctx.setState({ stmt: el.dataset.value }),
    'bl.stmt.csv': (el) => { statementCsv(ctx, el.dataset.value, QUIET); fileDone(ctx, el, `ants-statement-${el.dataset.value}-calls.csv`); },
    'bl.stmt.pdf': (el) => { statementHtml(ctx, el.dataset.value, QUIET); fileDone(ctx, el, `ants-statement-${el.dataset.value}-sample.html`); },
    'bl.inv.download': (el) => { const inv = invoices(ctx).find((i) => i.id === el.dataset.value); if (inv) { invoiceHtml(ctx, inv, QUIET); fileDone(ctx, el, `${inv.id}-sample.html`); } },
    'bl.inv.csv': (el) => { const inv = invoices(ctx).find((i) => i.id === el.dataset.value); if (inv) { invoiceCsv(ctx, inv, QUIET); fileDone(ctx, el, `${inv.id}-sample.csv`); } },
    'bl.stmt.planinv': (el) => {
      const id = el.dataset.value;
      ctx.setState({ flashInv: id });
      scrollTo(root, 'invoices');
      const row = root.querySelector(`[data-inv-row="${id}"]`);
      if (row) row.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
      setTimeout(() => { if (ctx.state.flashInv === id) ctx.state.flashInv = null; }, 2000);
    },
    'bl.up.preview': () => { const x = monthlyInvoices().find((i) => i.status === 'open'); if (x) monthlyInvoiceHtml(ctx, x); },
    'bl.plan.alert': (el) => {
      const level = Number(el.dataset.value);
      const on = !planAlerts()[level];
      const r = setPlanAlert(level, on);
      ctx.ui.toast(on ? t(r.sent ? 'burn.alertSent' : 'burn.alertOn', { pct: level }) : t('burn.alertOff', { pct: level }), { kind: on ? 'success' : 'info', demo: true });
    },
  });
  // Keyboard: Enter / Space on a clickable usage row.
  ctx.on(root, 'keydown', 'tr.bl-click', (ev, tr) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); tr.click(); } });
  ctx.watch('credits', 'billing', 'limits', 'env', 'mode', 'sales', 'calls', 'subAccounts');
  ctx.subscribe('billing.invoices', () => refreshFresh());

  // Deep links (once per address): ?panel= opens a dialog, ?section= scrolls to a card.
  if (!ctx.state._handled) {
    const { panel, section } = ctx.params.query;
    if (!panel && !section) ctx.state._handled = true;
    if (panel) {
      ctx.later(() => {
        ctx.state._handled = true;
        ctx.go('billing', { replace: true });
        if (panel === 'topup') ctx.ui.topup({ source: 'deeplink' });
        else if (panel === 'auto') autoTopUp(ctx);
        else if (panel === 'limits') ctx.ui.spendingLimits();
        else if (panel === 'compare') calculator(ctx);
      }, 60);
    } else if (section && SECTIONS.includes(section)) {
      const target = section === 'invoices' && postpaid() ? 'statements' : section;
      ctx.later(() => { ctx.state._handled = true; scrollTo(root, target); }, 80);
    }
  }
}

function scrollTo(root, section) {
  const el = root.querySelector(`#bl-${section}`);
  if (!el) return;
  el.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
  el.classList.remove('bl-flash');
  void el.offsetWidth;
  el.classList.add('bl-flash');
  const head = el.querySelector('h2');
  if (head) { head.setAttribute('tabindex', '-1'); head.focus({ preventScroll: true }); }
}
