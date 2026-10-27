// Builds the demo state: two complete datasets — the FIRST-RUN account (new sign-up, Sandbox) and the
// ACTIVE account (a month of traffic) — and which one is showing. store.reset() calls seed() again.
// CONTRACT: screens read the CURRENT dataset with plain paths (store.get('calls'), store.get('numbers')…).
// The other dataset is parked in state.parked and swapped in by actions.setMode(). First-run actions are
// never merged into the active dataset.

import { persist, KEYS } from '../core/persist.js';
import { PRICES } from './prices.js';
import { DEMO_NOW, isoAt } from './clock.js';
import * as A from './active.js';

const clone = (x) => JSON.parse(JSON.stringify(x));

/** Keys that belong to a dataset (swapped on mode change). Everything else in state is global. */
export const DATASET_KEYS = [
  'org', 'user', 'env', 'credits', 'limits', 'verifiedNumbers', 'onboarding', 'subAccounts', 'members', 'calls', 'liveCalls',
  'series', 'today', 'numbers', 'numberSearch', 'trunks', 'apiKeys', 'keyTiles', 'webhooks', 'failedEvents', 'flows', 'otpTemplates', 'otpStats',
  'campaigns', 'reports', 'billing', 'alertRules', 'alertChannels', 'alertHistory', 'notifications', 'audit', 'tickets', 'incidents', 'sales', 'pace',
];

const user = () => ({ id: 'user_01JB1SJ', name: 'Somchai Jaidee', initials: 'S', role: 'owner', email: 'somchai@example.com' });

export function activeDataset() {
  return clone({
    org: { id: 'org_01JB0EXTR', name: A.ORG_NAME, voiceSince: '2026-09-02', kycApproved: '2026-10-12', creditRate: A.CREDIT_RATE },
    user: user(),
    env: 'live',
    credits: { balance: A.BALANCE, trialTotal: PRICES.trial.minutes, trialUsed: PRICES.trial.minutes, trialEnds: '2026-10-02' /* the day the busy account used up its trial */, firstTopUpUsedAt: A.BILLING.offers.firstTopUpUsedAt },
    limits: A.LIMITS,
    verifiedNumbers: ['081-xxx-0101'],
    onboarding: { open: false, role: 'api', steps: { verify: 'done', connect: 'done', testCall: 'done', number: 'done', cap: 'done', live: 'done' }, cardDismissed: true },
    subAccounts: A.SUB_ACCOUNTS,
    members: A.MEMBERS,
    calls: A.buildCalls(),
    liveCalls: A.LIVE_CALLS,
    series: A.buildSeries(),
    today: A.TODAY,
    numbers: A.NUMBERS,
    numberSearch: A.NUMBER_SEARCH_24,
    trunks: A.TRUNKS,
    apiKeys: A.API_KEYS,
    keyTiles: A.KEY_TILES,
    webhooks: A.WEBHOOKS,
    failedEvents: A.FAILED_EVENTS,
    flows: A.FLOWS,
    otpTemplates: A.OTP_TEMPLATES,
    otpStats: A.OTP_STATS_7D,
    campaigns: A.CAMPAIGNS,
    reports: A.REPORTS_7D,
    billing: A.BILLING,
    alertRules: A.ALERT_RULES,
    alertChannels: A.ALERT_CHANNELS,
    alertHistory: A.ALERT_HISTORY,
    notifications: A.NOTIFICATIONS,
    audit: A.AUDIT,
    tickets: A.TICKETS,
    incidents: A.INCIDENTS,
    sales: { requests: [] },
    pace: { outMin: A.PACE_OUT_MIN },
  });
}

/** First-run account: created today, Owner only, Sandbox, 0 credits, trial 50 of 50 min, checklist 1/6. */
export function firstRunDataset(orgName = A.ORG_NAME) {
  return clone({
    org: { id: 'org_01JBNEW0', name: orgName, createdAt: new Date(DEMO_NOW - 25 * 60000).toISOString(), creditRate: { ...A.CREDIT_RATE, effectiveFrom: '2026-10-27' } },
    user: user(),
    env: 'sandbox',
    credits: { balance: 0, trialTotal: PRICES.trial.minutes, trialUsed: 0, firstTopUpUsedAt: null },
    limits: { daily: 5000, monthly: null, action: 'block-and-notify', channels: ['email', 'line'], international: false, premiumRate: 'blocked', perSub: {} },
    verifiedNumbers: ['081-xxx-0101'],
    onboarding: { open: true, role: 'api', steps: { verify: 'done', connect: 'todo', testCall: 'todo', number: 'todo', cap: 'todo', live: 'todo' }, cardDismissed: false },
    subAccounts: [{ id: A.SUBS.hq, key: 'hq', name: { en: 'Head office', th: 'สำนักงานใหญ่', zh: '总部' }, main: true }],
    members: [{ ...A.MEMBERS[0], lastSignIn: isoAt('14:10') }],
    calls: [],
    liveCalls: [],
    series: [],
    today: null,
    numbers: [],
    numberSearch: A.NUMBER_SEARCH_24,
    trunks: [],
    apiKeys: [],
    keyTiles: null,
    webhooks: [],
    failedEvents: [],
    flows: [],
    otpTemplates: [],
    otpStats: null,
    campaigns: [],
    reports: null,
    billing: { usage: [], statements: [], invoices: [], nextInvoiceNo: 703, offers: { firstTopUpUsedAt: null, annual: 'available' }, profile: { ...A.BILLING.profile } },
    alertRules: [],
    alertChannels: { emails: ['somchai@example.com'], lineGroup: null, webhook: null },
    alertHistory: [],
    notifications: [
      { id: 'ntf_welcome', type: 'welcome', at: isoAt('14:12'), read: false, href: 'overview?focus=checklist' },
      { id: 'ntf_verified', type: 'numberVerified', at: isoAt('14:11'), read: true, href: 'test-call', vars: { number: '081-xxx-0101' } },
    ],
    audit: [{ at: isoAt('14:10'), who: 'Somchai Jaidee', what: 'account.created', detail: {}, target: null, ip: '198.51.100.7', via: 'console' }],
    tickets: [],
    incidents: A.INCIDENTS,
    sales: { requests: [] },
    pace: { outMin: 0 },
  });
}

export function seed() {
  const done = !!persist.get(KEYS.onboardingDone);
  const mode = done ? 'active' : 'firstRun';
  const current = mode === 'active' ? activeDataset() : firstRunDataset();
  const parked = mode === 'active' ? { firstRun: firstRunDataset() } : { active: activeDataset() };
  return {
    mode,                       // 'firstRun' | 'active'
    ...current,
    parked,                     // the dataset that is not showing
    demo: { errorScreen: null, outcome: 'answered' },
  };
}

