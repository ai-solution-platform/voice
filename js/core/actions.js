// Shared domain actions: state changes used by more than one screen or by the shell, so they behave the
// same everywhere (a test call ticks the checklist, spends trial minutes, adds a Logs row and a bell item).
// Screen-only changes stay inside the screen module.

import { store } from './store.js';
import { persist, KEYS } from './persist.js';
import { PRICES, topUpBonus, makePlan, planUsage, creditsToThb, DEMO_CREDIT_RATE, numberFees, bkkDay } from '../data/prices.js';
import { nowMs } from '../data/clock.js';
import { DATASET_KEYS, activeDataset, firstRunDataset } from '../data/seed.js';

const iso = () => new Date(nowMs()).toISOString();
let seq = 0;
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford: no I, L, O, U
/** ULID-style id with a type prefix: newId('call') → call_01JBKT… */
export function newId(prefix) {
  let n = nowMs() * 1000 + (++seq % 1000);
  let s = '';
  for (let i = 0; i < 9; i++) { s = B32[n % 32] + s; n = Math.floor(n / 32); }
  return `${prefix}_01JB${s.slice(-8)}`;
}

/**
 * What the account can still spend, in credits. Prepaid: the credit balance. Postpaid: what is left of the
 * credit limit this month. Screens use this for "can this call / campaign run?" checks in both modes.
 */
export const balance = () => {
  const p = store.get('billing.profile');
  if (p && p.mode === 'postpaid') return Math.max(0, Math.round(((p.creditLimit || 0) - (p.usedThisMonth || 0)) * 100) / 100);
  return store.get('credits.balance') || 0;
};
export const isActive = () => store.get('mode') === 'active';
export const trialLeft = () => {
  const c = store.get('credits');
  return Math.max(0, Math.round((c.trialTotal - c.trialUsed) * 10) / 10);
};

/** Switch the dataset on screen: 'firstRun' (new account) or 'active' (busy account). */
export function setMode(mode, { fresh = false, orgName } = {}) {
  const st = store.get();
  const cur = st.mode;
  if (cur === mode && !fresh) return;
  const snapshot = {};
  for (const k of DATASET_KEYS) snapshot[k] = st[k];
  const parked = { ...(st.parked || {}) };
  if (cur !== mode) parked[cur] = snapshot;
  let next = fresh ? null : parked[mode];
  if (!next) next = mode === 'active' ? activeDataset() : firstRunDataset(orgName);
  delete parked[mode];
  store.replace({ ...st, ...next, mode, parked });
}

export function setEnv(env) {
  store.set('env', env);
}

/** Bell item. `type` maps to notif.<type>.title / .body in the dictionaries (translated live). */
export function notify(type, { vars, href } = {}) {
  store.push('notifications', { id: newId('ntf'), type, at: iso(), read: false, vars: vars || {}, href: href || null }, { prepend: true });
}
export function markAllRead() {
  store.update('notifications', (list) => list.map((n) => ({ ...n, read: true })));
}
export function markRead(id) {
  store.update('notifications', (list) => list.map((n) => (n.id === id ? { ...n, read: true } : n)));
}

/** Audit-log row (Users › Audit log). */
export function audit(what, detail = {}, target = null) {
  store.push('audit', { at: iso(), who: store.get('user.name'), what, detail, target, ip: '198.51.100.7', via: 'console' }, { prepend: true });
}

/**
 * Add a call record at the top of Logs. Fills id/ts/env; spends trial minutes (sandbox) or credits (live).
 * Shape: see js/data/active.js buildCalls() — { kind, direction, from, to, status, sec, billedMin, credits, source, sub, … }
 */
export function addCall(record) {
  const rec = { id: newId('call'), ts: iso(), env: store.get('env'), route: 'primary', ...record };
  store.push('calls', rec, { prepend: true });
  if (rec.env === 'sandbox' && rec.trialMinutes) {
    store.update('credits.trialUsed', (u) => Math.min(store.get('credits.trialTotal'), Math.round((u + rec.trialMinutes) * 10) / 10));
  }
  let charge = rec.credits;
  if (rec.env === 'live' && rec.billedMin && (rec.kind || 'outbound') === 'outbound' && activePlan()) charge = drawPlanMinutes(rec);
  if (rec.env === 'live' && charge) spend(charge);
  return rec;
}

/** Spend credits: prepaid lowers the balance; postpaid adds to this month's usage (invoiced at month end). */
export function spend(amount) {
  if (isPostpaid()) store.update('billing.profile.usedThisMonth', (u) => Math.round(((u || 0) + amount) * 100) / 100);
  else store.update('credits.balance', (b) => Math.max(0, Math.round((b - amount) * 100) / 100));
}

/**
 * Top up (demo — nothing is charged). The best single offer applies. Adds an invoice and a bell item.
 * Returns { amount, bonus, offer, total, invoice }.
 */
export function topUp(amount, { annual = false } = {}) {
  const firstTopUp = !store.get('credits.firstTopUpUsedAt');
  const b = topUpBonus(amount, { firstTopUp, annual });
  const total = amount + b.bonus;
  store.update('credits.balance', (x) => Math.round((x + total) * 100) / 100);
  if (b.id === 'firstTopUp') store.set('credits.firstTopUpUsedAt', iso());
  const no = store.get('billing.nextInvoiceNo') || 702;
  const invoice = { id: `INV-2610-${String(no).padStart(4, '0')}`, date: iso().slice(0, 10), credits: amount, bonus: b.bonus || undefined, net: amount, vat: Math.round(amount * 7) / 100, total: Math.round(amount * 107) / 100, demo: true };
  store.update('billing.invoices', (l) => [invoice, ...(l || [])]);
  store.set('billing.nextInvoiceNo', no + 1);
  notify('topUp', { vars: { total, bonus: b.bonus }, href: 'billing' });
  audit('credits.topped-up', { credits: amount, invoice: invoice.id });
  return { amount, bonus: b.bonus, offer: b.id, total, invoice };
}

/** Onboarding checklist. step: verify | connect | testCall | number | cap | live · state: done | progress | todo */
export function setStep(step, state = 'done') {
  if (store.get('mode') !== 'firstRun') return;
  if (store.get(`onboarding.steps.${step}`) === state) return;
  store.set(`onboarding.steps.${step}`, state);
  if (stepsDone() === 6) persist.set(KEYS.onboardingDone, true);
}
export const stepsDone = () => Object.values(store.get('onboarding.steps') || {}).filter((s) => s === 'done').length;

export function addVerifiedNumber(number) {
  store.update('verifiedNumbers', (list) => (list.includes(number) ? list : [...list, number]));
}
export const canAddVerified = () => store.get('verifiedNumbers').length < PRICES.trial.verifiedNumbers;

/** Sales request (plan / contact) → reference number SR-xxxxx. */
export function addSalesRequest(kind, data) {
  const ref = `SR-${10428 + (store.get('sales.requests') || []).length}`;
  store.push('sales.requests', { ref, kind, data, at: iso(), status: 'waiting' });
  return ref;
}

// ---------- billing modes (prepaid · postpaid · monthly commitment plan) ----------
// CONTRACT (see CONTRACT.md "Billing modes"): store billing.profile = {
//   mode: 'prepaid' | 'postpaid',
//   creditLimit, paymentTermsDays, usedThisMonth   — postpaid only (null when prepaid)
//   plan: null | { id, committedMinutes, rate, monthlyCharge, cycleStartDay, usedMinutes, includedCreditsAdded,
//                  overageMinutes, leftMinutes, overageCredits, unusedPolicy: 'expire'|'rollover'|'carry',
//                  carryMonths, carriedMinutes, startedAt, months }
//   invoices: [postpaid monthly invoices: { id, period, status: 'open'|'issued'|'paid', issuedAt, dueAt, paidAt,
//              lines: [{ kind, quantity, unit, rate, credits }], credits, net, vat, total }]
//              line kinds: plan · planMinutes · overage · outbound · otp · inbound · recording · numbers ·
//              extraConcurrent · channels · session (open month, see openLines) · usage (closed months)
// } and store org.creditRate = { credits, thb, currency, effectiveFrom, label: { en, th, zh } }.
// A plan is agreed with sales (ui.sales.requestPlan); only the Demo panel switches one on.

const PROFILE_PREPAID = () => ({ mode: 'prepaid', creditLimit: null, paymentTermsDays: null, usedThisMonth: null, plan: null, invoices: [] });

export const billingProfile = () => store.get('billing.profile') || PROFILE_PREPAID();
export const isPostpaid = () => billingProfile().mode === 'postpaid';
export const activePlan = () => billingProfile().plan || null;
/** Outbound credits per minute for this account: the plan rate when a plan is on, else pay as you go. */
export const outboundRate = () => (activePlan() ? activePlan().rate : PRICES.outbound);
/** The account's credit exchange rate (1 credit = 1.00 THB in the demo; set per contract in production). */
export const creditRate = () => store.get('org.creditRate') || DEMO_CREDIT_RATE;
export const toThb = (credits) => creditsToThb(credits, creditRate());

/**
 * An outbound call on a plan: re-price its minutes at the plan rate and count them against the commitment.
 * Returns what to spend now. Prepaid: the whole call (the plan credits were added to the balance on the cycle
 * day). Postpaid: only the overage part and extras — the commitment is already a fixed line on the invoice.
 */
function drawPlanMinutes(rec) {
  const plan = activePlan();
  const diff = Math.round((rec.billedMin * (PRICES.outbound - plan.rate)) * 100) / 100;
  rec.credits = Math.max(0, Math.round((rec.credits - diff) * 100) / 100);
  rec.plan = plan.id;
  const included = plan.committedMinutes + (plan.carriedMinutes || 0);
  const inside = Math.max(0, Math.min(plan.usedMinutes + rec.billedMin, included) - plan.usedMinutes);
  store.set('billing.profile.plan', { ...plan, ...planUsage(plan, plan.usedMinutes + rec.billedMin) });
  planAlertCheck(plan.usedMinutes, plan.usedMinutes + rec.billedMin, plan);
  if (!isPostpaid()) return rec.credits;
  return Math.max(0, Math.round((rec.credits - inside * plan.rate) * 100) / 100);
}

const monthMinutes = () => (store.get('series') || []).filter((d) => d.date >= iso().slice(0, 8) + '01').reduce((a, d) => a + d.outMin, 0);

// ---------- number fees (one rule everywhere: Numbers tile = Billing usage = statement = invoice) ----------
/** The calendar month on the demo clock, Bangkok time: 'YYYY-MM'. */
export const currentPeriod = () => bkkDay(nowMs()).slice(0, 7);
/** Number fees this month from the numbers list (prices.js numberFeeInMonth) → { credits, count, full, first, price }. */
export const numberFeesMonth = () => numberFees(store.get('numbers') || [], currentPeriod());
/** The number fees already inside the month's sample usage (billing.usage "numbers"). */
const seededNumberFees = () => ((store.get('billing.usage') || []).find((u) => u.item === 'numbers') || {}).credits || 0;
/** Number fees charged in this demo session (orders placed since the page loaded), on top of the sample month. */
export const sessionNumberFees = () => Math.max(0, Math.round((numberFeesMonth().credits - seededNumberFees()) * 100) / 100);

const monthUsed = () => Math.round(((store.get('billing.usedMonth.total') || 0) + sessionNumberFees()) * 100) / 100;
/** This month's usage other than outbound minutes (OTP, inbound, recording, numbers, trunks, other channels). */
const monthOtherUsage = () => {
  const out = ((store.get('billing.usage') || []).find((u) => u.item === 'outbound') || {}).credits || 0;
  return Math.max(0, Math.round((monthUsed() - out) * 100) / 100);
};

/** Money totals of an invoice from its lines (credits → THB at the account's credit rate, VAT 7 %). */
function invoiceTotals(lines) {
  const credits = Math.round(lines.reduce((a, l) => a + (l.credits || 0), 0) * 100) / 100;
  const net = creditsToThb(credits, creditRate());
  const vat = Math.round(net * 7) / 100;
  return { credits, net, vat, total: Math.round((net + vat) * 100) / 100 };
}

const VOICE_RATE = () => ({ outbound: PRICES.outbound, otp: PRICES.otpPerAnsweredCall, inbound: PRICES.inbound, recording: PRICES.recording, extraConcurrent: PRICES.extraConcurrentCall });
/**
 * This month's usage as invoice lines at the listed prices: the sample usage (store billing.usage) with the number
 * fees taken live from the numbers list, and SMS · LINE · Email as one line. Kinds: outbound · otp · inbound ·
 * recording · numbers · extraConcurrent · channels. Each line: { kind, quantity, unit, rate, credits } (+ numbers: full, first).
 */
export function usageLines() {
  const usage = store.get('billing.usage') || [];
  const rate = VOICE_RATE();
  const lines = usage.filter((u) => u.product === 'voice' && u.item !== 'numbers')
    .map((u) => ({ kind: u.item, quantity: u.quantity, unit: u.unit, rate: rate[u.item] ?? null, credits: u.credits }));
  const fees = numberFeesMonth();
  if (fees.credits || usage.some((u) => u.item === 'numbers')) {
    const at = lines.findIndex((l) => l.kind === 'extraConcurrent');
    lines.splice(at < 0 ? lines.length : at, 0, { kind: 'numbers', quantity: fees.count, unit: 'number', rate: fees.price, credits: fees.credits, full: fees.full, first: fees.first });
  }
  const other = usage.filter((u) => u.product !== 'voice');
  if (other.length) lines.push({ kind: 'channels', quantity: null, unit: null, rate: null, credits: Math.round(other.reduce((a, u) => a + u.credits, 0) * 100) / 100 });
  return lines;
}

/**
 * Lines of this month's open postpaid invoice (the "Upcoming invoice"): the usage lines, with outbound minutes
 * replaced by the plan when there is one, and calls made in this demo session as the last line. The lines always
 * add up to usedThisMonth ("Used this month"); VAT 7 % is added on top (invoiceTotals).
 */
function openLines(profile) {
  const plan = profile.plan;
  const base = usageLines();
  const lines = plan ? [
    { kind: 'plan', quantity: plan.committedMinutes, unit: 'min', rate: plan.rate, credits: plan.monthlyCharge },
    { kind: 'planMinutes', quantity: Math.min(plan.usedMinutes, plan.committedMinutes + (plan.carriedMinutes || 0)), unit: 'min', rate: null, credits: 0 },
    { kind: 'overage', quantity: plan.overageMinutes, unit: 'min', rate: plan.rate, credits: plan.overageCredits },
    ...base.filter((l) => l.kind !== 'outbound'),
  ] : base;
  const sum = lines.reduce((a, l) => a + (l.credits || 0), 0);
  const rest = Math.round(((profile.usedThisMonth || 0) - sum) * 100) / 100;
  if (Math.abs(rest) >= 0.01) lines.push({ kind: 'session', quantity: null, unit: null, rate: null, credits: rest });
  return lines;
}

/** Sample postpaid invoices: last month issued and paid, this month open (accruing). */
function sampleInvoices(profile) {
  // The open month on the demo clock: issued on the 1st of next month, due after the payment terms.
  const period = currentPeriod();
  const [y, m] = period.split('-').map(Number);
  const day = (yy, mm, dd) => new Date(Date.UTC(yy, mm - 1, dd)).toISOString().slice(0, 10);
  const issuedAt = day(y, m + 1, 1);
  const due = (issued) => new Date(Date.parse(`${issued}T00:00:00Z`) + (profile.paymentTermsDays || 30) * 86400000).toISOString().slice(0, 10);
  const no = (p) => `INV-PP-${p.slice(2, 4)}${p.slice(5, 7)}`;
  const open = { id: no(period), period, status: 'open', issuedAt, dueAt: due(issuedAt), paidAt: null, lines: openLines(profile), ...invoiceTotals(openLines(profile)) };
  if (!isActive()) return [open];
  const prev = day(y, m - 1, 1).slice(0, 7);
  const prevUsed = ((store.get('billing.statements') || []).find((x) => x.period === prev) || {}).used || 0;
  const prevLines = [{ kind: 'usage', quantity: null, unit: null, rate: null, credits: prevUsed }];
  return [open, { id: no(prev), period: prev, status: 'paid', issuedAt: day(y, m, 1), dueAt: due(day(y, m, 1)), paidAt: day(y, m, 15), lines: prevLines, ...invoiceTotals(prevLines) }];
}

/** Postpaid invoices, newest first, with the open one recalculated from the live usage. */
export function postpaidInvoices(profile = billingProfile()) {
  return (profile.invoices || []).map((inv) => (inv.status === 'open' ? { ...inv, lines: openLines(profile), ...invoiceTotals(openLines(profile)) } : inv));
}

/**
 * Demo panel only: put the account on a billing mode.
 * preset: 'prepaid' | 'postpaid' | 'prepaid-plan' | 'postpaid-plan' (plan = the 50,000-minute plan).
 * A plan starts on the 1st of this month (cycle day 1) with this month's outbound minutes already counted.
 */
export function setBillingPreset(preset, { planId = 'plan50k' } = {}) {
  // Leaving prepaid + plan: take back what switching it on changed (plan credits, repriced minutes, plan invoice).
  const prevAdj = prepaidPlanAdjust();
  if (prevAdj) shiftPrepaidPlan(prevAdj, -1);
  const postpaid = preset.startsWith('postpaid');
  const withPlan = preset.endsWith('-plan');
  const plan = withPlan ? makePlan(planId, { cycleStartDay: 1, usedMinutes: monthMinutes(), unusedPolicy: 'expire', startedAt: '2026-10-01' }) : null;
  const profile = {
    ...PROFILE_PREPAID(),
    mode: postpaid ? 'postpaid' : 'prepaid',
    creditLimit: postpaid ? (isActive() ? 150000 : 20000) : null,
    paymentTermsDays: postpaid ? 30 : null,
    // Postpaid "used this month" = what the invoice says so far. On a plan: the monthly commitment (a fixed line)
    // + overage at the plan rate + all other usage; without a plan: all usage at the listed prices.
    usedThisMonth: postpaid ? (plan ? Math.round((plan.monthlyCharge + plan.overageCredits + monthOtherUsage()) * 100) / 100 : monthUsed()) : null,
    plan,
  };
  profile.invoices = postpaid ? sampleInvoices(profile) : [];
  if (!postpaid && plan) {
    // Prepaid + plan: the plan charge is paid (an invoice) and added as plan credits on the cycle day, and this
    // month's outbound minutes are drawn at the plan rate — so the balance, usage and statement all move with it.
    const r2 = (x) => Math.round(x * 100) / 100;
    const today = (store.get('series') || []).find((d) => d.date === iso().slice(0, 10));
    const net = creditsToThb(plan.monthlyCharge, creditRate());
    plan.prepaidAdj = {
      planCredits: plan.monthlyCharge, minutes: monthMinutes(), date: plan.startedAt,
      reprice: r2(monthMinutes() * (PRICES.outbound - plan.rate)), repriceToday: r2((today ? today.outMin : 0) * (PRICES.outbound - plan.rate)),
      invoice: { id: 'INV-2610-0100', kind: 'plan', date: plan.startedAt || iso().slice(0, 10), period: (plan.startedAt || iso()).slice(0, 7), credits: plan.monthlyCharge, plan: plan.id, minutes: plan.committedMinutes, rate: plan.rate, net, vat: Math.round(net * 7) / 100, total: Math.round(net * 107) / 100 },
    };
    shiftPrepaidPlan(plan.prepaidAdj, 1);
  }
  store.set('billing.profile', profile);
  audit('billing.mode-changed', { mode: profile.mode, plan: plan ? plan.id : null });
  return profile;
}

/** Prepaid + plan (demo): what switching the plan on added to this month — { planCredits, reprice, repriceToday, minutes, invoice } or null. */
export function prepaidPlanAdjust(profile = billingProfile()) {
  return (profile.mode === 'prepaid' && profile.plan && profile.plan.prepaidAdj) || null;
}
/** Apply (sign 1) or take back (sign −1) a prepaid plan's effect on the balance, this month's usage and the invoices. */
function shiftPrepaidPlan(adj, sign) {
  const r2 = (x) => Math.round(x * 100) / 100;
  store.update('credits.balance', (b) => Math.max(0, r2((b || 0) + sign * (adj.planCredits + adj.reprice))));
  const um = store.get('billing.usedMonth');
  if (um) store.set('billing.usedMonth', { ...um, total: r2(um.total - sign * adj.reprice), voice: r2(um.voice - sign * adj.reprice) });
  const ut = store.get('billing.usedToday');
  if (ut) store.set('billing.usedToday', { ...ut, total: r2(ut.total - sign * adj.repriceToday), voice: r2(ut.voice - sign * adj.repriceToday) });
  const us = store.get('billing.usage');
  if (us) store.set('billing.usage', us.map((u) => (u.item === 'outbound' ? { ...u, credits: r2(u.credits - sign * adj.reprice) } : u)));
  store.update('billing.invoices', (l) => {
    const rest = (l || []).filter((i) => i.id !== adj.invoice.id);
    return sign > 0 ? [...rest, adj.invoice].sort((a, b) => String(b.date).localeCompare(String(a.date))) : rest;
  });
}

/**
 * Plain facts about the account's billing set-up, for the shell chip, Billing and Settings (screens translate
 * with the bm.* keys). Numbers are credits unless the name ends in Thb.
 */
export function describeProfile(profile = billingProfile()) {
  const plan = profile.plan;
  const postpaid = profile.mode === 'postpaid';
  const used = postpaid ? profile.usedThisMonth || 0 : null;
  return {
    mode: profile.mode,
    modeKey: `bm.mode.${profile.mode}${plan ? 'Plan' : ''}`,   // bm.mode.prepaid | prepaidPlan | postpaid | postpaidPlan
    balance: postpaid ? null : store.get('credits.balance') || 0,
    available: balance(),
    creditLimit: postpaid ? profile.creditLimit : null,
    usedThisMonth: used,
    pctOfLimit: postpaid && profile.creditLimit ? Math.min(100, Math.round((used / profile.creditLimit) * 100)) : null,
    paymentTermsDays: postpaid ? profile.paymentTermsDays : null,
    openInvoice: postpaid ? postpaidInvoices(profile).find((i) => i.status === 'open') || null : null,
    plan: plan ? {
      ...plan,
      pctUsed: Math.min(100, Math.round((plan.usedMinutes / plan.committedMinutes) * 100)),
      policyKey: `bm.policy.${plan.unusedPolicy}`,                // bm.policy.expire | rollover | carry ({months})
      nextCycle: nextCycleDate(plan.cycleStartDay),
    } : null,
    rate: creditRate(),
    outboundRate: outboundRate(),
  };
}

// ---------- commitment plan alerts (80 % and 100 % of the minutes; switched on in Billing › Commitment plan) ----------
export const PLAN_ALERT_LEVELS = [80, 100];
const grp = (n) => Math.round(n).toLocaleString('en-US'); // en / th / zh all group digits with ','
/** Which plan alerts are on: { 80: bool, 100: bool } (store billing.planAlerts). */
export const planAlerts = () => ({ 80: false, 100: false, ...(store.get('billing.planAlerts') || {}) });
/** Switch a plan alert on or off. Switching on a level the plan has already passed sends it at once. Returns { on, sent }. */
export function setPlanAlert(level, on) {
  store.set('billing.planAlerts', { ...planAlerts(), [level]: !!on });
  audit('billing.plan-alert', { level, on: !!on });
  const plan = activePlan();
  if (!on || !plan) return { on: !!on, sent: false };
  const at = Math.round((plan.committedMinutes * level) / 100);
  if (plan.usedMinutes < at) return { on: true, sent: false };
  notify('planThreshold', { vars: { pct: level, used: grp(plan.usedMinutes), min: grp(plan.committedMinutes) }, href: 'billing?section=plan' });
  return { on: true, sent: true };
}
/** A call moved the plan from `before` to `after` minutes: send the alerts that are on and were just crossed. */
function planAlertCheck(before, after, plan) {
  const on = planAlerts();
  for (const level of PLAN_ALERT_LEVELS) {
    const at = Math.round((plan.committedMinutes * level) / 100);
    if (on[level] && before < at && after >= at) notify('planThreshold', { vars: { pct: level, used: grp(after), min: grp(plan.committedMinutes) }, href: 'billing?section=plan' });
  }
}

function nextCycleDate(day) {
  const [y, m, d] = iso().slice(0, 10).split('-').map(Number);
  const next = d < day ? Date.UTC(y, m - 1, day) : Date.UTC(y, m, day);
  return new Date(next).toISOString().slice(0, 10);
}

/**
 * Demo (prepaid plans): run the plan's cycle day now — add the monthly commitment as plan credits and start a
 * new cycle; unused minutes follow the contract's policy. On postpaid the commitment is a fixed line on each
 * monthly invoice (postpaidInvoices()), so there is nothing to run.
 */
export function runPlanCycle() {
  const profile = billingProfile();
  const plan = profile.plan;
  if (!plan || profile.mode !== 'prepaid') return null;
  const carried = plan.unusedPolicy === 'expire' ? 0 : Math.max(0, plan.committedMinutes - plan.usedMinutes);
  const next = { ...plan, carriedMinutes: carried, includedCreditsAdded: plan.monthlyCharge, ...planUsage({ ...plan, carriedMinutes: carried }, 0) };
  store.set('billing.profile.plan', next);
  store.update('credits.balance', (b) => Math.round((b + plan.monthlyCharge) * 100) / 100);
  notify('planCycle', { vars: { min: plan.committedMinutes, credits: plan.monthlyCharge }, href: 'billing' });
  audit('billing.plan-cycle', { plan: plan.id, credits: plan.monthlyCharge, carriedMinutes: carried });
  return next;
}
