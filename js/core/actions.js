// Shared domain actions: state changes used by more than one screen or by the shell, so they behave the
// same everywhere (a test call ticks the checklist, spends trial minutes, adds a Logs row and a bell item).
// Screen-only changes stay inside the screen module.

import { store } from './store.js';
import { persist, KEYS } from './persist.js';
import { PRICES, topUpBonus } from '../data/prices.js';
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

export const balance = () => store.get('credits.balance') || 0;
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
  if (rec.env === 'live' && rec.credits) spend(rec.credits);
  return rec;
}

export function spend(amount) {
  store.update('credits.balance', (b) => Math.max(0, Math.round((b - amount) * 100) / 100));
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
