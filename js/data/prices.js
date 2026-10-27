// Planned launch prices · credits · excluding VAT · may change before launch
// CONTRACT: this is the ONE place for prices. Every rate card, estimate, offer line and call cost reads from
// here — never type a price into a screen or a dictionary; pass it as a {var} formatted with fmt.rate().
// Every rate card must also show t('common.plannedPrices').

import { nowMs } from './clock.js';

export const PRICES = Object.freeze({
  outbound: 1.29,              // per minute, Thai mobile and fixed, first minute in full then per minute
  plans: Object.freeze([       // volume plans: 12-month commitment, outbound Thai minutes per month
    Object.freeze({ id: 'plan50k', minMinutes: 50000, rate: 0.99 }),
    Object.freeze({ id: 'plan100k', minMinutes: 100000, rate: 0.89 }),
  ]),
  planMonths: 12,
  plansContactSalesFrom: 200000, // from here: "Contact sales" (no published price)
  otpPerAnsweredCall: 0.99,    // OTP / notification call up to 1 minute
  otpMaxSec: 60,
  inbound: 0.25,               // per minute
  number: 99,                  // Thai number 02 / 0xx per month
  numberBulk: 79,              // per number per month from numberBulkFrom numbers
  numberBulkFrom: 20,
  trunkMonthly: 0,             // SIP trunk from your PBX, per month
  trunkIncludedCalls: 10,      // concurrent calls included per trunk
  extraConcurrentCall: 199,    // per extra concurrent call per month
  cpsDefault: 2,               // calls per second (default pacing, not a price)
  international: 2.6,          // per minute, on request
  standardVoice: 0,            // standard voice TH / EN / ZH included
  premiumVoice: 0.9,           // per minute on top of the call
  transcription: 0.5,          // per minute
  recording: 0.1,              // per minute
  recordingDays: 90,
  platform: 0,                 // console, API, campaigns, phone menus, reports, sandbox — per month
  offers: Object.freeze({ firstTopUpPct: 10, firstTopUpCap: 2000, firstTopUpUntil: '2027-03-31', annualTopUpPct: 5 }),
  trial: Object.freeze({ minutes: 50, otpCallUses: 0.5, verifiedNumbers: 3, days: 30 }),
});

/**
 * Billing: per started minute from answer (talk seconds, rounded up; the first minute in full). The rate cards say
 * it in one line (billing.rates.increment, connect.prices.line): "Calls are billed per started minute from answer.
 * OTP and notification calls up to 1 minute are one price per answered call. Unanswered calls are free." —
 * callCost() below is what makes that line true (otp ≤ otpMaxSec → otpPerAnsweredCall; !answered → 0).
 */
export function billedMinutes(sec) {
  const s = Math.max(0, Number(sec) || 0);
  return s <= 0 ? 0 : Math.ceil(s / 60);
}

/** Pay-as-you-go cost of outbound minutes. */
export const paygCost = (minutes) => Math.round((Number(minutes) || 0) * PRICES.outbound);

/**
 * Volume plans. No monthly minimum or shortfall rule is published: the terms are confirmed with sales. A plan is
 * open from its entry volume (minMinutes) and is then priced per minute, so below the entry volume pay as you go
 * is the only option shown. Screens show the plan rate, the 12-month commitment and "terms confirmed with sales".
 */
export const planEligible = (minutes, plan) => (Number(minutes) || 0) >= plan.minMinutes;

/** Plan cost for a month at the plan rate, or null below the plan's entry volume. */
export const planCost = (minutes, plan) => (planEligible(minutes, plan) ? Math.round((Number(minutes) || 0) * plan.rate) : null);

/** Minutes a month from which a plan is open (and saves money, as its rate is below pay as you go). */
export const planBreakEven = (plan) => plan.minMinutes;

/** @deprecated No monthly minimum is published. Kept only so older imports still load; do not display it. */
export const planMinimum = (plan) => plan.minMinutes;

/**
 * Compare pay as you go with the plans open at this volume.
 * Returns { contactSales, options, plans, best, suggestPlan, nextPlan }:
 *   options     — pay as you go plus every plan open at this volume: [{ id, cost, rate, plan? }]
 *   plans       — every plan with { id, rate, minMinutes, eligible } (to say "plans start at 50,000 minutes")
 *   suggestPlan — the cheapest open plan when it beats pay as you go, else null (show a plan line only then)
 *   nextPlan    — the first plan not yet open at this volume, or null
 */
export function comparePlans(minutes) {
  const m = Number(minutes) || 0;
  const plans = PRICES.plans.map((p) => ({ id: p.id, rate: p.rate, minMinutes: p.minMinutes, eligible: planEligible(m, p), plan: p }));
  if (m >= PRICES.plansContactSalesFrom) return { contactSales: true, options: [], plans, best: null, suggestPlan: null, nextPlan: null };
  const options = [{ id: 'payg', cost: paygCost(m), rate: PRICES.outbound }, ...PRICES.plans.filter((p) => planEligible(m, p)).map((p) => ({ id: p.id, cost: planCost(m, p), rate: p.rate, plan: p }))];
  const best = options.reduce((a, b) => (b.cost < a.cost ? b : a));
  const next = plans.find((p) => !p.eligible) || null;
  return { contactSales: false, options, plans, best, suggestPlan: best.id === 'payg' ? null : best, nextPlan: next };
}

/** Monthly price of Thai numbers (bulk price from numberBulkFrom numbers). */
export function numbersMonthly(count) {
  const n = Math.max(0, Number(count) || 0);
  return n * (n >= PRICES.numberBulkFrom ? PRICES.numberBulk : PRICES.number);
}

/** Bangkok calendar day (YYYY-MM-DD) of an ISO date, ISO date-time or epoch ms. */
export function bkkDay(d) {
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const ms = typeof d === 'number' ? d : Date.parse(d);
  return new Date(ms + 7 * 3600000).toISOString().slice(0, 10);
}

/**
 * A Thai number's first month: on the order day it is charged for the days left in that calendar month (the
 * order day included), then the full monthly fee on the 1st of each month.
 * numberFirstMonth(99, '2026-10-27') → { days: 5, cycleDays: 31, each: 15.97, from: '2026-10-27', to: '2026-10-31', next: '2026-11-01' }
 */
export function numberFirstMonth(monthly, start) {
  const day = bkkDay(start);
  const p = prorate(monthly, { start: day, cycleStartDay: 1 });
  const [y, m] = day.split('-').map(Number);
  return { days: p.days, cycleDays: p.cycleDays, each: p.value, from: day, to: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10), next: new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10) };
}

/**
 * What one number costs in a calendar month (period 'YYYY-MM'). The fee runs from `feeFrom` (null = not charged
 * yet, e.g. ordered in Sandbox), else the order day, else the day it became active.
 * → { credits, kind: 'full' | 'first' | 'none', …numberFirstMonth() for 'first' }
 */
export function numberFeeInMonth(n, period) {
  if (!n || n.monthly == null) return { credits: 0, kind: 'none' };
  const start = n.feeFrom !== undefined ? n.feeFrom : n.orderedAt || n.since;
  if (!start) return { credits: 0, kind: 'none' };
  const from = bkkDay(start);
  if (from.slice(0, 7) > period) return { credits: 0, kind: 'none' };
  if (from.slice(0, 7) < period) return { credits: n.monthly, kind: 'full' };
  return { credits: numberFirstMonth(n.monthly, from).each, kind: 'first', ...numberFirstMonth(n.monthly, from) };
}

/** Number fees of a list of numbers in a month → { credits, count, full, first, price }. */
export function numberFees(numbers, period) {
  let credits = 0; let full = 0; let first = 0;
  for (const n of numbers || []) {
    const f = numberFeeInMonth(n, period);
    if (f.kind === 'full') full++;
    if (f.kind === 'first') first++;
    credits += f.credits;
  }
  return { credits: Math.round(credits * 100) / 100, count: full + first, full, first, price: PRICES.number };
}

/** SIP trunk monthly fee for a number of concurrent calls. */
export function trunkMonthly(concurrent) {
  const extra = Math.max(0, (Number(concurrent) || 0) - PRICES.trunkIncludedCalls);
  const extraCost = extra * PRICES.extraConcurrentCall;
  return { base: PRICES.trunkMonthly, extra, extraCost, total: PRICES.trunkMonthly + extraCost };
}

/**
 * Cost of one call in credits.
 * kind: 'outbound' | 'inbound' | 'otp' | 'international'. Sandbox calls cost 0 (they use trial minutes);
 * calls that were not answered cost 0.
 */
export function callCost({ kind = 'outbound', sec = 0, answered = true, premium = false, recording = false, transcription = false, env = 'live' } = {}) {
  if (env === 'sandbox' || !answered) return 0;
  const min = billedMinutes(sec);
  let c;
  if (kind === 'otp') c = sec <= PRICES.otpMaxSec ? PRICES.otpPerAnsweredCall : min * PRICES.outbound;
  else if (kind === 'inbound') c = min * PRICES.inbound;
  else if (kind === 'international') c = min * PRICES.international;
  else c = min * PRICES.outbound;
  if (premium) c += min * PRICES.premiumVoice;
  if (recording) c += min * PRICES.recording;
  if (transcription) c += min * PRICES.transcription;
  return Math.round(c * 100) / 100;
}

/** Trial minutes a sandbox call uses (an OTP call uses half a minute). */
export function trialMinutesUsed({ kind = 'outbound', sec = 0, answered = true } = {}) {
  if (!answered) return 0;
  return kind === 'otp' ? PRICES.trial.otpCallUses : billedMinutes(sec);
}

/** Is the first top-up offer still running on this date? Defaults to the demo clock, never the visitor's clock. */
export function firstTopUpOfferActive(date = new Date(nowMs())) {
  return date <= new Date(PRICES.offers.firstTopUpUntil + 'T23:59:59+07:00');
}

/** Top-up bonus: offers are never combined — the best single one applies. */
export function topUpBonus(amount, { firstTopUp = false, annual = false } = {}) {
  const a = Math.max(0, Number(amount) || 0);
  const options = [];
  if (firstTopUp && firstTopUpOfferActive()) options.push({ id: 'firstTopUp', bonus: Math.min(PRICES.offers.firstTopUpCap, Math.round(a * PRICES.offers.firstTopUpPct / 100)) });
  if (annual) options.push({ id: 'annual', bonus: Math.round(a * PRICES.offers.annualTopUpPct / 100) });
  options.sort((x, y) => y.bonus - x.bonus);
  return options[0] || { id: null, bonus: 0 };
}

/**
 * Monthly estimate (SIP trunk or API). Always priced pay as you go; `plans` tells the screen whether a plan
 * would save money (show "On a 50,000-minute plan: X" only when plans.suggestPlan is set).
 */
export function estimateMonthly({ minutes = 0, concurrent = PRICES.trunkIncludedCalls, numbers = 0, trunk = true } = {}) {
  const tr = trunk ? trunkMonthly(concurrent) : { base: 0, extra: 0, extraCost: 0, total: 0 };
  const num = numbersMonthly(numbers);
  const plans = comparePlans(minutes);
  const minuteCost = paygCost(minutes);
  return { trunk: tr, numbers: num, minuteCost, total: tr.total + num + minuteCost, plans };
}

// ---------- billing modes: credit rate, commitment plans, proration (pure — no store) ----------
// Every price above is in credits. Money = credits × rate.thb ÷ rate.credits, with the account's rate
// (store org.creditRate). The demo uses 1 credit = 1.00 THB; a real account's rate is set in its contract.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export const DEMO_CREDIT_RATE = Object.freeze({ credits: 1, thb: 1, currency: 'THB', effectiveFrom: '2026-09-01' });

/** Credits → money at a credit rate ({ credits, thb }). */
export const creditsToThb = (credits, rate = DEMO_CREDIT_RATE) => r2(((Number(credits) || 0) * rate.thb) / rate.credits);
/** Money → credits at a credit rate. */
export const thbToCredits = (thb, rate = DEMO_CREDIT_RATE) => r2(((Number(thb) || 0) * rate.credits) / rate.thb);

/**
 * A monthly commitment plan. The contract sets it (sales confirms it; the customer only requests one):
 *   committedMinutes × rate = monthlyCharge, charged on cycleStartDay; it buys the plan minutes, a balance kept
 *   apart from the credits (only outbound calls draw it — SMS, LINE, Email and other charges use credits);
 *   outbound minutes are drawn at the plan rate; minutes beyond the commitment are overage at the same rate;
 *   unused minutes follow the contract's unusedPolicy: 'expire' | 'rollover' (next month only) | 'carry' (carryMonths).
 */
export function makePlan(id, { cycleStartDay = 1, usedMinutes = 0, unusedPolicy = 'expire', carryMonths = 0, carriedMinutes = 0, startedAt = null, months = PRICES.planMonths } = {}) {
  const p = PRICES.plans.find((x) => x.id === id) || PRICES.plans[0];
  const plan = {
    id: p.id, committedMinutes: p.minMinutes, rate: p.rate, monthlyCharge: r2(p.minMinutes * p.rate), cycleStartDay,
    usedMinutes: 0, includedCreditsAdded: r2(p.minMinutes * p.rate), overageMinutes: 0,
    unusedPolicy, carryMonths: unusedPolicy === 'carry' ? carryMonths || 3 : 0, carriedMinutes, startedAt, months,
  };
  return { ...plan, ...planUsage(plan, usedMinutes) };
}

/** Minutes this cycle → what the plan covers. Included = commitment + minutes carried over from earlier cycles. */
export function planUsage(plan, usedMinutes) {
  const used = Math.max(0, Math.round(Number(usedMinutes) || 0));
  const included = plan.committedMinutes + (plan.carriedMinutes || 0);
  const overageMinutes = Math.max(0, used - included);
  return { usedMinutes: used, overageMinutes, leftMinutes: Math.max(0, included - used), overageCredits: r2(overageMinutes * plan.rate) };
}

/** Cost of outbound minutes on a plan (the plan rate, inside or beyond the commitment). */
export const planMinutesCost = (minutes, plan) => r2((Number(minutes) || 0) * plan.rate);

/** Unused minutes at the end of a cycle → minutes carried into the next one, by the contract's policy. */
export function carryOver(plan) {
  const unused = Math.max(0, plan.committedMinutes - plan.usedMinutes);
  if (plan.unusedPolicy === 'rollover' || plan.unusedPolicy === 'carry') return unused;
  return 0;
}

/**
 * Proration for a plan that starts (or a mode that changes) mid-cycle: the share of the cycle that is left.
 * prorate(49500, { start: '2026-10-27', cycleStartDay: 1 }) → { days: 5, cycleDays: 31, fraction, value: 7983.87 }
 */
export function prorate(value, { start, cycleStartDay = 1 } = {}) {
  const [y, m, d] = String(start).slice(0, 10).split('-').map(Number);
  const cycleStart = d >= cycleStartDay ? Date.UTC(y, m - 1, cycleStartDay) : Date.UTC(y, m - 2, cycleStartDay);
  const next = new Date(cycleStart); next.setUTCMonth(next.getUTCMonth() + 1);
  const cycleDays = Math.round((next - cycleStart) / 86400000);
  const days = Math.max(0, Math.round((next - Date.UTC(y, m - 1, d)) / 86400000));
  const fraction = cycleDays ? days / cycleDays : 0;
  return { days, cycleDays, fraction, value: r2((Number(value) || 0) * fraction) };
}
