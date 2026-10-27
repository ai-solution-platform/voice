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

/** Billing: the first minute is charged in full, then per started minute (round up). */
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
