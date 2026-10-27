// Billing & Credits — #/billing   (query: ?panel=topup|auto|limits|compare · ?section=prices|usage|limits|offers|statements|invoices)
// Balance and burn, top-up (ui.topup, best single offer), the rate card with "Planned launch prices", volume plans
// (request only — never a one-click switch), the "Which price fits you?" calculator, usage by product, statements
// and invoices (generated CSV / printable HTML), spending limits (the daily limit blocks new calls).
// Every price comes from js/data/prices.js; every total from the store (js/data/active.js) so Overview = Billing = Reports.

import { html as h, raw, on, reducedMotion } from '../core/dom.js';
import { isActive, balance, addSalesRequest, describeProfile, isPostpaid, postpaidInvoices, creditRate, prepaidPlanAdjust } from '../core/actions.js';
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
const SECTIONS = ['prices', 'usage', 'limits', 'offers', 'statements', 'invoices', 'mode', 'plan'];
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
  // Prepaid + plan: the plan credits added on the cycle day are part of this month's money in.
  const adj = prepaidPlanAdjust();
  const planCredits = adj ? adj.planCredits : 0;
  if (!list.length) {
    if (!demoInv.length && !adj) return [];
    const used = Math.max(0, r2(demoCredits + demoBonus + planCredits - balance()));
    return [{ period: CUR_PERIOD, status: 'current', opening: 0, topUps: demoCredits, bonus: demoBonus, planCredits, used, closing: balance(), usedVoice: used }];
  }
  return list.map((s) => {
    if (s.status !== 'current') return { ...s, usedVoice: SEP_VOICE_USED };
    const topUps = s.topUps + demoCredits;
    const bonus = s.bonus + demoBonus;
    const closing = balance();
    const used = r2(s.opening + topUps + bonus + planCredits - closing);
    const usedVoice = r2(used - ((ctx.store.get('billing.usedMonth') || {}).other || 0));
    return { ...s, topUps, bonus, planCredits, closing, used, usedVoice };
  });
}
/** Credits spent by calls made in this demo session (live account), on top of the sample month. */
function demoSpend(ctx) {
  const cur = ctx.list('billing.statements').find((s) => s.status === 'current');
  if (!cur) return 0;
  const adj = prepaidPlanAdjust();
  return Math.max(0, r2(cur.closing + demoTopUps(ctx) + (adj ? adj.planCredits + adj.reprice : 0) - balance()));
}
function usedToday(ctx) {
  if (!ctx.store.get('billing.usedToday')) { const used = (statements(ctx)[0] || {}).used || 0; return { total: used, voice: used, other: 0 }; }
  const u = ctx.store.get('billing.usedToday');
  const d = demoSpend(ctx);
  return { total: r2(u.total + d), voice: r2(u.voice + d), other: u.other };
}
function usedMonth(ctx) {
  if (!ctx.store.get('billing.usedMonth')) { const used = (statements(ctx)[0] || {}).used || 0; return { total: used, voice: used, other: 0 }; }
  const u = ctx.store.get('billing.usedMonth');
  const d = demoSpend(ctx);
  return { total: r2(u.total + d), voice: r2(u.voice + d), other: u.other };
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
    available: d.available, openInvoice: d.openInvoice, plan,
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
  if (pf.mode === 'postpaid') month.total = pf.used;
  if (pf.mode === 'postpaid') month.voice = r2(Math.max(0, pf.used - month.other));
  const credLine = sandbox
    ? t('tile.creditsTrial', { left: fmt.num(Math.max(0, (ctx.store.get('credits.trialTotal') || 0) - (ctx.store.get('credits.trialUsed') || 0)), 1), total: fmt.int(PRICES.trial.minutes) })
    : avg && isActive() ? t('tile.creditsRunway', { days: fmt.int(Math.floor(balance() / avg)) }) : t('tile.creditsLine');
  return h`<div class="grid g-5 bl-tiles">
    ${pf.mode === 'postpaid'
      ? h`<div class="card tile"><span class="t">${t('tile.available')}</span><span class="v">${fmt.credits2(pf.available)}</span><span class="h">${t('tile.availableLine', { used: fmt.credits2(pf.used), limit: fmt.int(pf.creditLimit) })}</span></div>`
      : h`<div class="card tile"><span class="t">${ctx.term(t('tile.credits'), 'credits')}</span><span class="v">${fmt.credits2(balance())}</span><span class="h">${credLine}</span></div>`}
    <a class="card tile tile-link" href="#/reports?range=today" data-action="bl.tile.today"><span class="t">${t('tile.today')}</span><span class="v">${fmt.credits2(today.total)}</span><span class="h">${t('tile.todayLine', { voice: fmt.credits2(today.voice), other: fmt.credits2(today.other) })}</span></a>
    <button type="button" class="card tile tile-link bl-tilebtn" data-action="bl.tile.month"><span class="t">${t('tile.month')}</span><span class="v">${fmt.credits2(month.total)}</span><span class="h">${t('tile.monthLine', { voice: fmt.credits2(month.voice), other: fmt.credits2(month.other) })}${lim.monthly ? h` · ${t('tile.ofMonthly', { pct: Math.round((month.total / lim.monthly) * 100), limit: fmt.int(lim.monthly) })}` : ''}</span></button>
    <button type="button" class="card tile tile-link bl-tilebtn" data-action="bl.tile.limit"><span class="t">${t('tile.limit')}</span><span class="v">${fmt.int(lim.daily || 0)}</span><span class="h">${t('tile.limitLine', { pct })}</span></button>
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
  const rows = series.map((d) => ({ date: d.date, voice: d.credits, other: OTHER_PER_DAY[d.date] || 0 }));
  const max = Math.max(...rows.map((r) => r.voice + r.other));
  const scale = max * 1.08;
  const total = rows.reduce((s, r) => s + r.voice + r.other, 0);
  return h`<div class="card bl-chart" data-inv="bl.chart"><div class="card-head"><h2>${t('chart.title')}</h2><span class="hint">${t('chart.range', { from: fmt.dayMonth(rows[0].date), to: fmt.dayMonth(rows[rows.length - 1].date) })}</span>
      <span class="bl-legend"><span><i class="sw sw-voice"></i>${t('chart.voice')}</span><span><i class="sw sw-other"></i>${t('chart.other')}</span></span></div>
    <div class="card-body"><div class="bl-bars" role="img" aria-label="${t('chart.aria', { from: fmt.dayMonth(rows[0].date), to: fmt.dayMonth(rows[rows.length - 1].date), total: fmt.int(total) })}">
      ${rows.map((r, i) => {
        const last = i === rows.length - 1;
        return h`<span class="bl-bar ${last ? 'is-last' : ''}" tabindex="0" data-tip="${t('chart.tip', { day: fmt.dayMonth(r.date), voice: fmt.credits2(r.voice), other: fmt.int(r.other) })}" aria-label="${t('chart.tip', { day: fmt.dayMonth(r.date), voice: fmt.credits2(r.voice), other: fmt.int(r.other) })}">
          <span class="bl-stack" style="height:${((r.voice + r.other) / scale * 100).toFixed(1)}%"><i class="o" style="flex:${r.other}"></i><i class="v" style="flex:${r.voice.toFixed(0)}"></i></span>
          <span class="bl-day"><b>${Number(r.date.slice(8))}</b><span class="wd">${weekdayLabel(ctx, r.date, false)}</span><span class="wdn" aria-hidden="true">${weekdayLabel(ctx, r.date, true)}</span></span></span>`;
      })}</div>
      ${chartSummary(ctx, rows)}
      <p class="hint-xs bl-chart-note">${t('chart.note')}</p></div></div>`;
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
  const usage = ctx.list('billing.usage');
  const d = demoSpend(ctx);
  if (!usage.length && !d) {
    return h`<section class="card bl-usage" id="bl-usage" aria-labelledby="bl-usage-h"><div class="card-head"><h2 id="bl-usage-h">${t('usage.title')}</h2></div>
      <div class="empty"><span class="art">${icon('list')}</span><strong>${t('usage.empty')}</strong><span class="hint">${t('usage.emptyHint')}</span>
      <a class="btn btn-sm" href="#/help/article/billing-credits" data-action="bl.usage.learn">${icon('book')}${t('usage.learn')}</a></div></section>`;
  }
  const voice = usage.filter((u) => u.product === 'voice');
  const others = usage.filter((u) => u.product !== 'voice');
  const voiceSum = r2(voice.reduce((s, u) => s + u.credits, 0) + d);
  const total = r2(voiceSum + others.reduce((s, u) => s + u.credits, 0));
  const row = (u) => h`<tr class="bl-click" data-action="bl.usage.row" data-value="${u.product}" tabindex="0">
      <td><span class="strong">${t(`usage.item.${u.item}`)}</span>${u.product === 'voice' ? h` <span class="hint-xs">· ${t('usage.voice')}</span>` : ''}</td>
      <td class="num mono">${u.product === 'voice' ? h`${fmt.int(u.quantity)} ${t(`usage.unit.${u.unit}`, { count: u.quantity })}` : h`<span class="hint-xs" title="${t('usage.otherQty')}">—</span>`}</td><td class="num mono">${fmt.credits2(u.credits)}</td></tr>`;
  return h`<section class="card bl-usage" id="bl-usage" aria-labelledby="bl-usage-h"><div class="card-head"><h2 id="bl-usage-h">${t('usage.title')}</h2><span class="hint">${t('usage.range', { to: fmt.dayMonth(nowMs()) })}</span></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>${t('usage.product')}</th><th class="num">${t('usage.qty')}</th><th class="num">${t('usage.credits')}</th></tr></thead>
    <tbody>${voice.map(row)}
      ${d ? h`<tr class="bl-click" data-action="bl.usage.row" data-value="voice" tabindex="0"><td><span class="strong">${t('usage.item.demo')}</span> <span class="chip chip-navy">${t('common.demoTag')}</span></td><td class="num mono">—</td><td class="num mono">${fmt.credits2(d)}</td></tr>` : ''}
      <tr class="bl-sub"><td>${t('usage.voiceSub')}</td><td></td><td class="num mono">${fmt.credits2(voiceSum)}</td></tr>
      ${others.map(row)}
      <tr class="bl-total"><td>${t('usage.total')}</td><td></td><td class="num mono">${fmt.credits2(total)}</td></tr></tbody></table></div>
    <div class="card-foot hint-xs">${t('usage.foot')}${profile().plan ? h`<br>${t('usage.planNote', { rate: fmt.rate(profile().plan.rate) })}` : ''}</div></section>`;
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
      ${row(ctx.term(t('rates.trunk'), 'sip_trunk'), fmt.int(p.trunkMonthly), t('rates.trunkUnit', { inc: p.trunkIncludedCalls, extra: fmt.int(p.extraConcurrentCall) }))}
      ${row(t('rates.intl'), fmt.rate(p.international), t('rates.intlUnit'))}
      ${row(ctx.term(t('rates.voiceStd'), 'voice_tier'), t('rates.included'), t('rates.voiceStdUnit'))}
      ${row(t('rates.voicePrem'), `+${fmt.rate(p.premiumVoice)}`, t('rates.voicePremUnit'))}
      ${row(h`${ctx.term(t('rates.transcription'), 'transcription')} <span class="chip chip-info">${t('common.beta')}</span>`, fmt.rate(p.transcription), t('rates.perMin'))}
      ${row(ctx.term(t('rates.recording'), 'retention'), fmt.rate(p.recording), t('rates.recordingUnit', { days: p.recordingDays }))}
    </tbody></table></div>
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
        <span class="hint-xs">${t('limits.monthlyHint')}</span></div>
      <div class="note note-info">${icon('shield')}<span>${t('limits.blocks')}</span></div>
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
        <span class="progress ${pct >= 80 ? 'bl-prog-warn' : 'bl-prog'}" role="progressbar" aria-label="${t('mode.used')}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></span></div>
      ${fact(t('mode.terms'), t('mode.termsDays', { count: pf.termsDays }), inv && inv.issuedAt ? t('mode.termsLine', { date: fmt.dateProse(inv.issuedAt), due: inv.dueAt ? fmt.dateProse(inv.dueAt) : '—' }) : '')}`;
  } else {
    const auto = ctx.store.get('billing.autoTopUp');
    const autoOn = auto && typeof auto === 'object' && auto.on;
    const low = ctx.list('alertRules').find((r) => r.type === 'low-credits');
    facts = h`${fact(t('mode.balance'), fmt.credits2(balance()), t('mode.balanceLine'))}
      ${fact(t('tile.auto'), h`${autoOn ? t('auto.on') : t('auto.off')} <button type="button" class="linkbtn hint-xs" data-action="bl.mode.auto">${t(autoOn ? 'mode.change' : 'mode.setUp')}</button>`, autoOn ? t('tile.autoLine', { below: fmt.int(auto.below), add: fmt.int(auto.add) }) : t('tile.autoOff'))}
      ${fact(t('mode.low'), h`${low && low.on ? t('mode.lowOn', { n: fmt.int((low.condition || {}).below || 0) }) : t('mode.lowOff')} <a class="linkbtn hint-xs" href="#/alerts${low ? `?rule=${low.id}` : ''}" data-action="bl.mode.low">${t('mode.change')}</a>`, t('mode.lowLine'))}`;
  }
  const other = pf.mode === 'postpaid' ? 'prepaid' : 'postpaid';
  return h`<section class="card bl-mode" id="bl-mode" aria-labelledby="bl-mode-h"><div class="card-head"><h2 id="bl-mode-h">${t('mode.title')}</h2>
      <span class="chip ${pf.mode === 'postpaid' ? 'chip-navy' : 'chip-ok'}">${t(`mode.${pf.mode}`)}${pf.plan ? ` + ${t('mode.withPlan', { min: fmt.int(pf.plan.committed) })}` : ''}</span></div>
    <div class="card-body stack-3"><p class="hint bl-mode-what">${t(`mode.${pf.mode}What`)}</p>
      <div class="bl-facts">${facts}</div>
      <div class="row">${pf.mode === 'prepaid' ? h`<button type="button" class="btn btn-sm btn-primary" data-action="bl.topup">${icon('plus')}${t('topup')}</button>` : ''}
        ${req ? h`<span class="chip chip-warn">${icon('clock')}${t('mode.requested', { ref: req.ref })}</span>`
          : h`<button type="button" class="btn btn-sm" data-action="bl.mode.request" data-value="${other}">${icon('send')}${t('mode.request', { to: t(`mode.${other}`) })}</button>`}
        <a class="linkbtn hint-xs" href="#/help/contact?topic=sales" data-action="bl.mode.sales">${t('plans.contactSales')}</a></div>
      <p class="hint-xs">${t('mode.changeNote')}</p></div></section>`;
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
    ${p.added != null || p.carried ? h`<p class="hint-xs bl-commit-note">${p.added != null ? t('commit.added', { n: fmt.credits2(p.added) }) : ''}${p.added != null && p.carried ? ' · ' : ''}${p.carried ? t('commit.carried', { n: fmt.int(p.carried) }) : ''}</p>` : ''}</div>
    <div class="card-foot row bl-commit-foot"><span class="hint-xs grow">${t('commit.foot')}</span>
      ${modeRequest(ctx) ? h`<span class="chip chip-warn">${icon('clock')}${t('mode.requested', { ref: modeRequest(ctx).ref })}</span>` : h`<button type="button" class="btn btn-sm" data-action="bl.plan.change">${icon('send')}${t('commit.change')}</button>`}</div></section>`;
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
      <div class="card-foot hint-xs">${t('minv.foot', { thb: fmt.rate(rate) })}</div>`
    : h`<div class="empty"><span class="art">${icon('file-text')}</span><strong>${t('minv.empty')}</strong></div>`}</section>`;
}

function statementsCard(ctx) {
  const { t, fmt, icon } = ctx;
  const list = statements(ctx);
  const voiceOnly = ctx.state.stmt === 'voice';
  const adj = prepaidPlanAdjust();
  const withPlan = list.some((s) => s.planCredits);
  return h`<section class="card bl-stmt" id="bl-statements" aria-labelledby="bl-stmt-h"><div class="card-head"><h2 id="bl-stmt-h">${t('stmt.title')}</h2>
      <div class="seg seg-sm" role="group" aria-label="${t('stmt.title')}">${['all', 'voice'].map((s) => h`<button type="button" data-action="bl.stmt.seg" data-value="${s}" aria-pressed="${ctx.state.stmt === s}">${t(`stmt.seg.${s}`)}</button>`)}</div></div>
    ${list.length ? h`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>${t('stmt.period')}</th><th>${t('stmt.status')}</th><th class="num">${t('stmt.opening')}</th><th class="num">${t('stmt.topups')}</th><th class="num">${t('stmt.bonus')}</th>${withPlan ? h`<th class="num">${t('stmt.planCredits')}</th>` : ''}<th class="num">${voiceOnly ? t('stmt.usedVoice') : t('stmt.used')}</th><th class="num">${t('stmt.closing')}</th></tr></thead>
      <tbody>${list.map((s) => h`<tr><td><span class="strong nowrap">${monthLabel(ctx, s.period)}</span>
          <span class="row-tight bl-files"><button type="button" class="linkbtn hint-xs" data-action="bl.stmt.csv" data-value="${s.period}">${icon('download', 'ico-xs')}${t('stmt.csv')}</button><button type="button" class="linkbtn hint-xs" data-action="bl.stmt.pdf" data-value="${s.period}">${icon('file-text', 'ico-xs')}${t('stmt.pdf')}</button></span></td>
        <td>${s.status === 'current' ? h`<span class="chip chip-warn">${t('stmt.current')}</span>` : h`<span class="chip">${t('stmt.closed')}</span>`}</td>
        <td class="num mono">${fmt.credits2(s.opening)}</td><td class="num mono">${fmt.credits2(s.topUps)}</td><td class="num mono">${s.bonus ? `+${fmt.credits2(s.bonus)}` : '0.00'}</td>${withPlan ? h`<td class="num mono">${s.planCredits ? `+${fmt.credits2(s.planCredits)}` : '0.00'}</td>` : ''}
        <td class="num mono">${fmt.credits2(voiceOnly ? s.usedVoice : s.used)}</td><td class="num mono strong">${fmt.credits2(s.closing)}</td></tr>`)}</tbody></table></div>
      <div class="card-foot hint-xs">${voiceOnly ? t('stmt.footVoice') : withPlan ? t('stmt.footWithPlan') : t('stmt.foot')}${adj ? h`<br>${t('stmt.footPlan', { min: fmt.int(profile().plan.committed), id: adj.invoice.id, date: tableDate(ctx, adj.invoice.date), minutes: fmt.int(adj.minutes), rate: fmt.rate(profile().plan.rate) })}` : ''}</div>`
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

function invoicesCard(ctx) {
  const { t, fmt, icon } = ctx;
  const list = invoices(ctx);
  return h`<section class="card bl-inv" id="bl-invoices" aria-labelledby="bl-inv-h"><div class="card-head"><h2 id="bl-inv-h">${t('inv.title')}</h2><span class="hint">${t('inv.sub')}</span></div>
    ${list.length ? h`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>${t('inv.no')}</th><th>${t('inv.date')}</th><th class="num">${t('inv.credits')}</th><th class="num">${t('inv.net')}</th><th class="num">${t('inv.vat')}</th><th class="num">${t('inv.total')}</th><th><span class="sr-only">${t('stmt.files')}</span></th></tr></thead>
      <tbody>${list.map((i) => h`<tr class="${ctx.state.fresh === i.id ? 'new-row' : ''}"><td class="mono strong" translate="no">${i.id}${i.demo ? h` <span class="chip chip-navy">${t('common.demoTag')}</span>` : ''}${i.plan ? h` <span class="chip chip-info">${t('inv.plan')}</span>` : ''}</td><td class="nowrap">${tableDate(ctx, i.date)}</td>
        <td class="num mono">${fmt.int(i.credits)}${i.bonus ? h` <span class="hint-xs">+${fmt.int(i.bonus)} ${t('inv.bonus')}</span>` : ''}</td><td class="num mono">${fmt.credits2(i.net)}</td><td class="num mono">${fmt.credits2(i.vat)}</td><td class="num mono strong">${fmt.credits2(i.total)}</td>
        <td class="num nowrap"><button type="button" class="btn btn-sm" data-action="bl.inv.download" data-value="${i.id}">${icon('file-text')}${t('inv.download')}</button>
          <button type="button" class="btn btn-sm" data-action="bl.inv.csv" data-value="${i.id}">${icon('download')}${t('inv.csv')}</button></td></tr>`)}</tbody></table></div>
      <div class="card-foot hint-xs">${t('inv.foot')}</div>`
    : h`<div class="empty"><span class="art">${icon('file-text')}</span><strong>${t('inv.empty')}</strong><span class="hint">${t('inv.emptyHint')}</span>
      <button type="button" class="btn btn-sm btn-navy" data-action="bl.inv.topup">${icon('plus')}${t('topup')}</button></div>`}</section>`;
}

// ---------- screen contract ----------
export function render(ctx) {
  if (ctx.state._raw !== ctx.params.raw) { ctx.state._raw = ctx.params.raw; ctx.state._handled = false; }
  const pp = postpaid();
  return h`<div class="page bl">${header(ctx)}${nudgeBanner(ctx)}${tiles(ctx)}
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
    { item: 'sip_trunk', unit: 'month', credits: p.trunkMonthly, note: `${p.trunkIncludedCalls} concurrent calls included` },
    { item: 'extra_concurrent_call', unit: 'call per month', credits: p.extraConcurrentCall, note: '' },
    { item: 'international', unit: 'minute', credits: p.international, note: 'on request' },
    { item: 'standard_voice', unit: 'minute', credits: p.standardVoice, note: 'included (TH / EN / ZH)' },
    { item: 'premium_voice', unit: 'minute', credits: p.premiumVoice, note: 'on top of the call' },
    { item: 'transcription', unit: 'minute', credits: p.transcription, note: 'optional, beta' },
    { item: 'recording', unit: 'minute', credits: p.recording, note: `kept ${p.recordingDays} days` },
  ].map((r) => ({ ...r, credits: r.credits === '' ? '' : Number(r.credits).toFixed(2) }));
  rows.push({ item: '#', unit: '', credits: '', note: `${t('common.plannedPrices')} · ${t('common.exVat')}` });
  ctx.ui.csv('ants-voice-prices.csv', rows, ['item', 'unit', 'credits', 'note']);
}

function usageCsv(ctx) {
  const usage = ctx.list('billing.usage');
  // SMS, LINE and Email show credits only: their unit prices belong to their own consoles, not to this demo.
  const rows = usage.map((u) => (u.product === 'voice' ? { product: `voice:${u.item}`, quantity: u.quantity, unit: u.unit, credits: u.credits.toFixed(2) } : { product: u.product, quantity: '', unit: '', credits: u.credits.toFixed(2) }));
  const d = demoSpend(ctx);
  if (d) rows.push({ product: 'voice:demo-session', quantity: '', unit: '', credits: d.toFixed(2) });
  if (!rows.length) rows.push({ product: '', quantity: 0, unit: '', credits: '0.00' });
  ctx.ui.csv(`ants-usage_${CUR_PERIOD}.csv`, rows, ['product', 'quantity', 'unit', 'credits']);
}

const CALL_COLS = ['call_id', 'started_at', 'direction', 'source', 'subaccount', 'from', 'to', 'status', 'sip_code', 'q850', 'talk_seconds', 'billed', 'credits', 'recording', 'route', 'campaign_id', 'dtmf', 'reason_text'];
function statementCsv(ctx, period) {
  const { fmt } = ctx;
  const calls = ctx.list('calls').filter((c) => fmt.isoDate(c.ts).startsWith(period));
  const rows = calls.map((c) => ({
    call_id: c.id, started_at: fmt.iso(c.ts), direction: c.direction, source: c.source ? c.source.type : '', subaccount: c.sub || '', from: c.from, to: c.to, status: c.status,
    sip_code: c.sip ?? '', q850: c.q850 ?? '', talk_seconds: c.sec || 0, billed: c.billedMin || 0, credits: (c.credits || 0).toFixed(2), recording: c.recorded ? 'yes' : 'no', route: c.route || '',
    campaign_id: c.source && c.source.type === 'campaign' ? c.source.ref : '', dtmf: c.keys || '', reason_text: c.reason ? ctx.loc(c.reason) : '',
  }));
  const usage = ctx.list('billing.usage');
  const fee = (item) => usage.find((u) => u.item === item);
  if (period === CUR_PERIOD) {
    for (const item of ['numbers', 'extraConcurrent']) {
      const u = fee(item);
      if (u) rows.push({ call_id: `fee:${item}`, started_at: `${period}-01T00:00:00+07:00`, direction: '', source: 'fee', subaccount: '', from: '', to: '', status: '', sip_code: '', q850: '', talk_seconds: '', billed: u.quantity, credits: u.credits.toFixed(2), recording: '', route: '', campaign_id: '', dtmf: '', reason_text: ctx.t(`usage.item.${item}`) });
    }
  }
  if (!rows.length) rows.push(Object.fromEntries(CALL_COLS.map((k) => [k, k === 'reason_text' ? ctx.t('stmt.noCalls') : ''])));
  ctx.ui.csv(`ants-statement-${period}-calls.csv`, rows, CALL_COLS);
}

const printCss = `body{font:14px/1.5 Inter,"Noto Sans Thai","Noto Sans SC",system-ui,sans-serif;color:#1B2B4D;margin:0;padding:40px;background:#fff}
.sheet{max-width:760px;margin:0 auto;position:relative}h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:24px 0 8px}
.wm{position:fixed;top:40%;left:50%;transform:translate(-50%,-50%) rotate(-24deg);font-size:54px;font-weight:800;color:rgba(201,74,18,.13);white-space:nowrap;pointer-events:none}
table{width:100%;border-collapse:collapse;margin-top:8px}th,td{text-align:left;padding:8px;border-bottom:1px solid #E7ECF4}th{font-size:12px;color:#5B6781}
.num{text-align:right;font-variant-numeric:tabular-nums}.muted{color:#5B6781;font-size:12px}.tot td{font-weight:700;border-top:2px solid #14274A}
.cols{display:flex;gap:40px;margin-top:16px}.cols div{flex:1}.bar{height:6px;background:#14274A;border-radius:3px;margin-bottom:16px}
@media print{body{padding:0}}`;

function printable(ctx, { title, filename, lines, meta, totals, note }) {
  const { t, esc } = ctx;
  const org = ctx.loc(ctx.store.get('org.name'));
  const doc = `<!doctype html><html lang="${ctx.lang === 'zh' ? 'zh-Hans' : ctx.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)}</title><style>${printCss}</style></head><body><div class="wm">${esc(t('print.watermark'))}</div><div class="sheet"><div class="bar"></div>
<h1>${esc(title)}</h1><div class="muted">${esc(t('print.sampleNote'))}</div>
<div class="cols"><div><strong>${esc(t('print.seller'))}</strong><br>${esc(t('print.sellerName'))}<br><span class="muted">${esc(t('print.sellerNote'))}</span></div>
<div><strong>${esc(t('print.buyer'))}</strong><br>${esc(org)}<br><span class="muted">${esc(t('print.taxId'))} 0-0000-00000-00-0</span></div></div>
<table>${meta.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>
<h2>${esc(t('print.lines'))}</h2><table><tr><th>${esc(t('print.item'))}</th><th class="num">${esc(t('print.qty'))}</th><th class="num">${esc(t('print.amount'))}</th></tr>
${lines.map(([a, b, c]) => `<tr><td>${esc(a)}</td><td class="num">${esc(b)}</td><td class="num">${esc(c)}</td></tr>`).join('')}
${totals.map(([a, c], i) => `<tr class="${i === totals.length - 1 ? 'tot' : ''}"><td>${esc(a)}</td><td></td><td class="num">${esc(c)}</td></tr>`).join('')}</table>
<p class="muted">${esc(note)}</p><p class="muted">${esc(t('common.plannedPrices'))} · ${esc(t('app.demoShort'))}</p></div>
<script>window.addEventListener('load',function(){setTimeout(function(){window.print()},300)});</script></body></html>`;
  ctx.ui.download(filename, doc, 'text/html;charset=utf-8');
}

function invoiceHtml(ctx, inv) {
  const { t, fmt } = ctx;
  printable(ctx, {
    title: t('print.invoiceTitle', { id: inv.id }),
    filename: `${inv.id}-sample.html`,
    meta: [[t('inv.no'), inv.id], [t('inv.date'), fmt.dateProse(inv.date)], [t('print.payment'), t('print.paid')]],
    lines: [[t('print.creditsLine'), fmt.int(inv.credits), fmt.credits2(inv.net)], ...(inv.bonus ? [[t('print.bonusLine'), fmt.int(inv.bonus), '0.00']] : [])],
    totals: [[t('inv.net'), fmt.credits2(inv.net)], [t('inv.vat'), fmt.credits2(inv.vat)], [t('print.totalThb'), fmt.credits2(inv.total)]],
    note: t('print.creditUnit'),
  });
}

function monthlyInvoiceHtml(ctx, x) {
  const { t, fmt } = ctx;
  const rate = creditRate().thb || 1;
  const line = (l) => [t(`minv.line.${l.kind}`), l.quantity != null ? `${fmt.int(l.quantity)} ${l.unit === 'min' ? t('minv.min') : ''}`.trim() : '', fmt.credits2(l.credits)];
  printable(ctx, {
    title: t('minv.printTitle', { id: x.id, month: monthLabel(ctx, x.period) }),
    filename: `${x.id}-sample.html`,
    meta: [[t('minv.no'), x.id], [t('stmt.period'), monthLabel(ctx, x.period)], [t('minv.issued'), x.issued ? fmt.dateProse(x.issued) : '—'], [t('minv.dueOn'), x.due ? fmt.dateProse(x.due) : '—']],
    lines: (x.lines.length ? x.lines : [{ kind: 'usage', credits: x.amount }]).filter((l) => l.credits || l.kind === 'plan' || l.kind === 'usage').map(line),
    totals: [[t('minv.credits'), fmt.credits2(x.amount)], [t('inv.net'), fmt.credits2(x.net ?? x.amount * rate)], [t('inv.vat'), fmt.credits2(x.vat ?? 0)], [t('print.totalThb'), fmt.credits2(x.total ?? 0)]],
    note: t('minv.printNote', { thb: fmt.rate(rate) }),
  });
}

function statementHtml(ctx, period) {
  const { t, fmt } = ctx;
  const s = statements(ctx).find((x) => x.period === period);
  if (!s) return;
  const voiceOnly = ctx.state.stmt === 'voice';
  printable(ctx, {
    title: t('print.stmtTitle', { month: monthLabel(ctx, period) }),
    filename: `ants-statement-${period}-sample.html`,
    meta: [[t('stmt.period'), monthLabel(ctx, period)], [t('stmt.status'), s.status === 'current' ? t('stmt.current') : t('stmt.closed')], [t('print.scope'), t(`stmt.seg.${voiceOnly ? 'voice' : 'all'}`)]],
    lines: [[t('stmt.opening'), '', fmt.credits2(s.opening)], [t('stmt.topups'), '', fmt.credits2(s.topUps)], [t('stmt.bonus'), '', fmt.credits2(s.bonus)], ...(s.planCredits ? [[t('stmt.planCredits'), '', fmt.credits2(s.planCredits)]] : []), [voiceOnly ? t('stmt.usedVoice') : t('stmt.used'), '', `−${fmt.credits2(voiceOnly ? s.usedVoice : s.used)}`]],
    totals: [[t('stmt.closing'), fmt.credits2(s.closing)]],
    note: t('print.stmtNote'),
  });
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
    'bl.tile.month': () => scrollTo(root, 'usage'),
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
    'bl.minv.pdf': (el) => { const x = monthlyInvoices().find((i) => i.id === el.dataset.value); if (x) monthlyInvoiceHtml(ctx, x); },
    'bl.offer.row': (el) => {
      const v = el.dataset.value;
      if (v === 'annual') ctx.ui.topup({ annual: true, source: 'billing-offer' });
      else if (v === 'launch') ctx.ui.topup({ source: 'billing-offer' });
    },
    'bl.stmt.seg': (el) => ctx.setState({ stmt: el.dataset.value }),
    'bl.stmt.csv': (el) => statementCsv(ctx, el.dataset.value),
    'bl.stmt.pdf': (el) => statementHtml(ctx, el.dataset.value),
    'bl.inv.download': (el) => { const inv = invoices(ctx).find((i) => i.id === el.dataset.value); if (inv) invoiceHtml(ctx, inv); },
    'bl.inv.csv': (el) => {
      const inv = invoices(ctx).find((i) => i.id === el.dataset.value);
      if (!inv) return;
      ctx.ui.csv(`${inv.id}-sample.csv`, [{ invoice: inv.id, date: inv.date, item: 'credits_topup', credits: inv.credits, bonus_credits: inv.bonus || 0, amount_before_vat: inv.net.toFixed(2), vat_7: inv.vat.toFixed(2), total_thb: inv.total.toFixed(2), note: 'SAMPLE - not a tax invoice' }]);
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
