// ACTIVE demo account — "Example Trading Co., Ltd. (demo)", Tue 27 Oct 2026 at 14:35 (see clock.js).
// Every total reconciles across screens
// (Overview = Billing = Reports); if you change a number, change the totals that depend on it.
// Fictional only: masked numbers (last 4 digits), *.example.com hosts, RFC 5737 IPs, invented people.
// Localised record names are { en, th, zh } (render with ctx.loc). Machine names (trunks, keys, templates,
// hosts) stay ASCII in every language.

import { PRICES } from './prices.js';
import { isoAt, isoOn } from './clock.js';

export const SUBS = {
  hq: 'sub_01JB2HQ000',
  app: 'sub_01JB2APP4K',
  dv: 'sub_01JB2DV7RX',
  ck: 'sub_01JB2CKN9S',
};

export const ORG_NAME = { en: 'Example Trading Co., Ltd. (demo)', th: 'บริษัท ตัวอย่างเทรดดิ้ง จำกัด (เดโม)', zh: '示例贸易有限公司（演示）' };
export const TEST_WORKSPACE_NAME = { en: 'Example Trading test workspace (demo)', th: 'พื้นที่ทดสอบ ตัวอย่างเทรดดิ้ง (เดโม)', zh: '示例贸易测试工作区（演示）' };
/** Brand names spoken in calls. */
export const BRAND = { en: 'Example Trading', th: 'ตัวอย่างเทรดดิ้ง', zh: '示例贸易' };
export const CLINIC = { en: 'Example Clinic, Sukhumvit branch', th: 'คลินิกตัวอย่าง สาขาสุขุมวิท', zh: '示例诊所素坤逸分店' };

// ---------- daily series ----------
// Answer rates vary a few points from day to day (63–69 % outbound). Fixed: 21–27 Oct = 5,548 answered of 8,367
// outbound, the 27 Oct row, and answered = outAnswered + otpAnswered + inAnswered on every row.
// [date, calls, answered, outCalls, outAnswered, otpSent, otpAnswered, inCalls, inAnswered, outMin, inMin, recMin]
const SERIES_14 = [
  ['2026-10-14', 2171, 1505, 1737, 1113, 279, 243, 155, 149, 2137, 387, 725],
  ['2026-10-15', 2023, 1464, 1619, 1099, 260, 227, 144, 138, 1992, 359, 675],
  ['2026-10-16', 2043, 1500, 1635, 1132, 262, 228, 146, 140, 2015, 364, 682],
  ['2026-10-17', 1171, 819, 937, 608, 150, 130, 84, 81, 1154, 211, 393],
  ['2026-10-18', 879, 631, 703, 472, 113, 99, 63, 60, 865, 156, 292],
  ['2026-10-19', 2119, 1463, 1696, 1081, 272, 237, 151, 145, 2090, 377, 708],
  ['2026-10-20', 2079, 1496, 1664, 1121, 267, 233, 148, 142, 2049, 369, 693],
  ['2026-10-21', 2202, 1607, 1762, 1210, 283, 246, 157, 151, 2168, 393, 735],
  ['2026-10-22', 2006, 1395, 1606, 1034, 257, 224, 143, 137, 1979, 356, 669],
  ['2026-10-23', 980, 673, 784, 496, 126, 110, 70, 67, 967, 174, 327, true],
  ['2026-10-24', 1132, 820, 906, 615, 145, 127, 81, 78, 1117, 203, 380],
  ['2026-10-25', 811, 595, 649, 448, 104, 91, 58, 56, 798, 146, 272],
  ['2026-10-26', 2021, 1418, 1617, 1053, 260, 227, 144, 138, 1989, 359, 673],
  ['2026-10-27', 1303, 927, 1043, 692, 167, 146, 93, 89, 1287, 231, 435],
];

/** Voice credits for a day = outbound min × 1.29 + answered OTP/notification × 0.99 + inbound min × 0.25 + recorded min × 0.10 */
export const dayCredits = (d) => Math.round((d.outMin * PRICES.outbound + d.otpAnswered * PRICES.otpPerAnsweredCall + d.inMin * PRICES.inbound + d.recMin * PRICES.recording) * 100) / 100;

const toDay = ([date, calls, answered, outCalls, outAnswered, otpSent, otpAnswered, inCalls, inAnswered, outMin, inMin, recMin, holiday]) => {
  const d = { date, calls, answered, outCalls, outAnswered, otpSent, otpAnswered, inCalls, inAnswered, outMin, inMin, recMin, holiday: !!holiday };
  d.credits = dayCredits(d);
  return d;
};

/** Month to date (1–27 Oct, to 14:35). */
export const MTD = { outMin: 44726, otpAnswered: 5078, inMin: 8078, recMin: 15151, numbers: 5 /* charged this month: 3 full + 2 first months (from the day they went live) */, extraConcurrent: 10 };

// 28 Sep – 13 Oct are synthesised from the Mon 26 Oct row with a weekday pattern, then corrected so that
// 1–13 Oct + the 14 rows above = the month-to-date totals exactly (Billing reconciles with Reports).
function synthDays() {
  const tpl = toDay(SERIES_14[12]); // Mon 26 Oct
  const dates = [];
  for (let d = new Date(Date.UTC(2026, 8, 28)); d < new Date(Date.UTC(2026, 9, 14)); d.setUTCDate(d.getUTCDate() + 1)) dates.push(new Date(d));
  const weight = (dt) => { const w = dt.getUTCDay(); return w === 0 ? 0.42 : w === 6 ? 0.56 : 1; };
  const sum14 = (k) => SERIES_14.map(toDay).reduce((s, x) => s + x[k], 0);
  const octDates = dates.filter((d) => d.getUTCMonth() === 9);
  const wOct = octDates.reduce((s, d) => s + weight(d), 0);
  const target = { outMin: MTD.outMin - sum14('outMin'), otpAnswered: MTD.otpAnswered - sum14('otpAnswered'), inMin: MTD.inMin - sum14('inMin'), recMin: MTD.recMin - sum14('recMin') };
  const rows = dates.map((dt) => {
    const w = weight(dt) * (1 + (((dt.getUTCDate() * 37) % 11) - 5) / 200); // ±2.5% deterministic wiggle
    const k = (field) => Math.round(tpl[field] * w);
    return { date: dt.toISOString().slice(0, 10), calls: k('calls'), answered: k('answered'), outCalls: k('outCalls'), outAnswered: k('outAnswered'), otpSent: k('otpSent'), otpAnswered: k('otpAnswered'), inCalls: k('inCalls'), inAnswered: k('inAnswered'), outMin: k('outMin'), inMin: k('inMin'), recMin: k('recMin'), holiday: false, _w: weight(dt) };
  });
  // Exact month-to-date: distribute the October targets by weight, remainder on 13 Oct.
  const oct = rows.filter((r) => r.date >= '2026-10-01');
  for (const field of ['outMin', 'otpAnswered', 'inMin', 'recMin']) {
    let acc = 0;
    oct.forEach((r, i) => {
      const v = i === oct.length - 1 ? target[field] - acc : Math.round(target[field] * (r._w / wOct));
      r[field] = v;
      acc += v;
    });
  }
  // Answer rates wiggle ±3 points around the template day, and answered stays the sum of its three parts.
  const tplRate = tpl.outAnswered / tpl.outCalls;
  for (const r of rows) {
    const n = Number(r.date.slice(8, 10)) + Number(r.date.slice(5, 7)) * 31;
    r.outAnswered = Math.round(r.outCalls * (tplRate + (((n * 5) % 13) - 6) / 200));
    r.answered = Math.min(r.calls, r.outAnswered + r.otpAnswered + r.inAnswered);
  }
  return rows.map(({ _w, ...r }) => ({ ...r, credits: dayCredits(r) }));
}

export function buildSeries() {
  return [...synthDays(), ...SERIES_14.map(toDay)];
}

// ---------- today ----------
export const TODAY = {
  calls: 1303, outbound: 1043, otpNotif: 167, inbound: 93,
  answered: 927, answerRatePct: 71.1,
  creditsUsedVoice: 1906.02, creditsUsedOther: 290, monthVoice: 68660.32, monthAll: 81270.32,
  failed: 74, failedPct: 5.7, failed503: 26,
  notConnected: { total: 376, noAnswer: 181, phoneOff: 48, busy: 82, failed: 74, failed503: 26, failed404: 31, failedOther: 17, notDialled: 39, dnc: 24, hours: 9, intl: 6 },
  liveTotal: 14,
  alert: { id: 'alr_20261027_1423', pct: 27, failed: 26, of: 96, from: '14:08', to: '14:23', campaign: 'bc_01JBK7C1Q2', threshold: 10, resolvedAt: '14:24', acknowledged: false },
};

// ---------- organisation, sub-accounts, members ----------
export const SUB_ACCOUNTS = [
  { id: SUBS.hq, key: 'hq', name: { en: 'Head office', th: 'สำนักงานใหญ่', zh: '总部' }, main: true, dailyLimit: null, numbers: ['02-xxx-1000', '053-xxx-120', '02-xxx-7788'], keys: [], owner: 'Somchai Jaidee' },
  { id: SUBS.app, key: 'app', name: { en: 'Online store app', th: 'ร้านค้าออนไลน์', zh: '网店应用' }, dailyLimit: 1500, numbers: ['02-xxx-1003'], keys: ['app-backend'], owner: 'Tawan Pattana' },
  { id: SUBS.dv, key: 'dv', name: { en: 'Home delivery', th: 'ส่งสินค้าถึงบ้าน', zh: '送货上门' }, dailyLimit: 5000, numbers: ['02-xxx-1001'], keys: ['delivery-system'], owner: 'Kamol Rakngan' },
  { id: SUBS.ck, key: 'ck', name: { en: 'Clinic', th: 'คลินิก', zh: '诊所' }, dailyLimit: 2000, ownAllocation: { left: 1195.36, moved: 2000, movedOn: '2026-10-15' }, numbers: ['02-xxx-1002', '02-xxx-1004'], keys: [], owner: 'Preecha Mongkol' },
];

export const MEMBERS = [
  { id: 'user_01JB1SJ', name: 'Somchai Jaidee', email: 'somchai@example.com', role: 'owner', access: 'all', twoFactor: true, lastSignIn: isoAt('14:10') },
  { id: 'user_01JB1WS', name: 'Wipa Srisuk', email: 'wipa@example.com', role: 'admin', access: 'all', twoFactor: true, lastSignIn: isoAt('13:59') },
  { id: 'user_01JB1TP', name: 'Tawan Pattana', email: 'tawan@example.com', role: 'developer', access: SUBS.app, twoFactor: false, lastSignIn: isoOn('2026-10-26', '18:05') },
  { id: 'user_01JB1KR', name: 'Kamol Rakngan', email: 'kamol@example.com', role: 'operator', access: SUBS.dv, twoFactor: true, lastSignIn: isoAt('12:25') },
  { id: 'user_01JB1PM', name: 'Preecha Mongkol', email: 'preecha@example.com', role: 'viewer', access: SUBS.ck, twoFactor: false, lastSignIn: isoOn('2026-10-20', '11:40') },
  { id: 'user_01JB1NK', name: null, email: 'nok@example.com', role: 'operator', access: SUBS.ck, twoFactor: false, pending: true, invitedAt: isoOn('2026-10-26', '16:20') },
];

// ---------- numbers ----------
// Number fees (prices.js numberFeeInMonth): a number is charged from the day it goes live, for the days left in
// that month, then the full fee on the 1st; a number in review is never charged. October: 3 × 99 (live since
// September) + 2 × 57.48 (ordered 4 Oct, live 14 Oct after the documents were approved: 18 of 31 days) = 411.96 —
// the "numbers" usage line below. 02-xxx-1004 (ordered 26 Oct, documents in review) and the LOA number cost nothing.
export const NUMBERS = [
  { id: 'num_01JB3A1000', number: '02-xxx-1000', e164: '+662xxx1000', type: 'local', area: '02', sub: SUBS.hq, routing: { type: 'flow', ref: 'flw_01JB5MAIN1' }, callerIdFor: 'agents', status: 'active', since: '2026-09-14', monthly: PRICES.number },
  { id: 'num_01JB3A1001', number: '02-xxx-1001', e164: '+662xxx1001', type: 'local', area: '02', sub: SUBS.dv, routing: { type: 'webhook', ref: 'https://crm.example.com/ants/webhook' }, callerIdFor: 'campaigns', status: 'active', since: '2026-09-14', monthly: PRICES.number },
  { id: 'num_01JB3A1002', number: '02-xxx-1002', e164: '+662xxx1002', type: 'local', area: '02', sub: SUBS.ck, routing: { type: 'flow', ref: 'flw_01JB5CKN02' }, callerIdFor: 'campaigns', status: 'active', orderedAt: isoOn('2026-10-04', '09:40'), since: '2026-10-14', monthly: PRICES.number },
  { id: 'num_01JB3A1003', number: '02-xxx-1003', e164: '+662xxx1003', type: 'local', area: '02', sub: SUBS.app, routing: { type: 'message', ref: 'otp-only' }, callerIdFor: 'otp', status: 'active', since: '2026-09-14', monthly: PRICES.number },
  { id: 'num_01JB3B0120', number: '053-xxx-120', e164: '+6653xxx120', type: 'regional', area: '053', sub: SUBS.hq, routing: { type: 'trunk', ref: 'cm-branch-pbx', fallback: 'flw_01JB5CLSD2' }, status: 'active', orderedAt: isoOn('2026-10-04', '09:40'), since: '2026-10-14', monthly: PRICES.number },
  { id: 'num_01JB3A1004', number: '02-xxx-1004', e164: '+662xxx1004', type: 'local', area: '02', sub: SUBS.ck, routing: null, status: 'in-review', orderedAt: isoOn('2026-10-26', '10:15'), monthly: PRICES.number },
  { id: 'num_01JB3C7788', number: '02-xxx-7788', e164: '+662xxx7788', type: 'loa', area: '02', sub: SUBS.hq, routing: null, status: 'in-review', letterSentAt: '2026-10-20', monthly: null },
];
// ---------- number requests: mobile 06/08/09 · toll-free 1800 · 4-digit 1xxx ----------
// Sold by quote (prices.js BY_QUOTE_TYPES): no price is shown and nothing is charged until a number is active, so
// these never reach the number fees (Numbers tile = Billing usage = statement = invoice stay at 411.96).
// Lifecycle: requested → quoted (accepted in the console) → in_review → active; 4-digit: preparing →
// submitted_to_nbtc → allocated → active. Preferred numbers are masked like every other number in the demo.
// Toll-free numbers are 10 digits (1800-xxx-xxx). The quote itself is a SAMPLE without amounts (public demo).
export const NUMBER_REQUESTS = [
  {
    id: 'nrq_01JB7TF241', type: 'toll_free', quantity: 1, preferred: ['241'], number: '1800-xxx-241', sub: SUBS.ck, status: 'quoted',
    requestedAt: isoOn('2026-10-20', '10:20'), quotedAt: isoOn('2026-10-22', '15:05'), quoteRef: 'Q-2610-0418', docs: ['tfForm'],
    use: { purpose: 'orders', who: { en: 'Patients booking or moving an appointment', th: 'ผู้ป่วยที่โทรจองหรือเลื่อนนัด', zh: '预约或改约的患者' }, perDay: '150' },
  },
  {
    id: 'nrq_01JB7SC4D1', type: 'short_code', quantity: 1, preferred: ['1xx7', '1xx8', '1xx9'], number: null, sub: SUBS.hq, status: 'submitted_to_nbtc',
    requestedAt: isoOn('2026-10-05', '11:10'), submittedAt: isoOn('2026-10-09', '14:30'), docs: ['nbtcForm', 'profile'],
    use: { purpose: 'service', who: { en: 'Customers of all our services across Thailand', th: 'ลูกค้าทุกบริการของเราทั่วประเทศ', zh: '全国各项服务的客户' }, perMonth: '20000' },
  },
];
/** Buy-flow search results for Local 02 "contains 24". */
export const NUMBER_SEARCH_24 = ['02-xxx-2401', '02-xxx-2412', '02-xxx-2424', '02-xxx-2438', '02-xxx-2440', '02-xxx-2457', '02-xxx-2468', '02-xxx-2490'];

// ---------- SIP trunks ----------
export const TRUNKS = [
  {
    id: 'trk_01JB4HQPBX', name: 'hq-pbx', pbx: 'FreePBX', sub: SUBS.hq, auth: 'both', ips: ['198.51.100.22'], transport: 'tls', srtp: true,
    concurrent: 20, included: 10, inUse: 7, monthly: 10 * PRICES.extraConcurrentCall, status: 'active', availability: 100,
    last24h: { calls: 412, outbound: 291, inbound: 121, answerRatePct: 70.0, pddSec: 2.9, credits: 783.10 },
    uris: [
      { priority: 10, uri: 'sip:pbx-hq.example.com:5061', weight: 10, status: 'healthy', replyMs: 12 },
      { priority: 20, uri: 'sip:pbx-backup.example.com:5061', weight: 10, status: 'healthy', replyMs: 15 },
      { priority: 30, uri: 'sip:198.51.100.22:5061', weight: 10, status: 'off', replyMs: null },
    ],
    failoverSec: 4, allDown: 'flw_01JB5CLSD2', failovers24h: [{ from: '03:30', to: '03:52', target: 'pbx-backup' }], username: 'trk_hq_pbx_DEMO',
  },
  {
    id: 'trk_01JB4CMPBX', name: 'cm-branch-pbx', pbx: 'Yeastar', sub: SUBS.hq, auth: 'credentials', ips: [], transport: 'tls', srtp: true,
    concurrent: 10, included: 10, inUse: 0, monthly: 0, status: 'down', downSince: isoAt('13:58'), lastReply: isoAt('13:56'), pbxIp: '198.51.100.40', availability: 97.4,
    uris: [{ priority: 10, uri: 'sip:198.51.100.40:5061', weight: 10, status: 'down', replyMs: null }], failoverSec: 4, allDown: 'flw_01JB5CLSD2', username: 'trk_cm_branch_DEMO',
  },
];

// ---------- API keys, webhooks, failed deliveries ----------
export const API_KEYS = [
  { id: 'key_01JB6APPBE', name: 'app-backend', prefix: 'ak_live_', last4: '9c2f', env: 'live', scopes: ['calls:write', 'otp:write', 'read'], sub: SUBS.app, allowedIps: ['203.0.113.10', '203.0.113.11'], createdAt: '2026-10-01', createdBy: 'Tawan Pattana', lastUsed: isoAt('14:34'), status: 'active' },
  { id: 'key_01JB6DLVRY', name: 'delivery-system', prefix: 'ak_live_', last4: '4b7e', env: 'live', scopes: ['calls:write', 'broadcasts:write', 'read'], sub: SUBS.dv, allowedIps: [], createdAt: '2026-10-03', createdBy: 'Tawan Pattana', lastUsed: isoAt('14:33'), status: 'active' },
  { id: 'key_01JB6SBXTS', name: 'sandbox-tests', prefix: 'ak_test_', last4: '7q2x', env: 'sandbox', scopes: ['calls:write', 'numbers:write', 'read'], sub: SUBS.hq, allowedIps: [], createdAt: '2026-09-24', createdBy: 'Tawan Pattana', lastUsed: isoOn('2026-10-24', '11:20'), status: 'active' },
  { id: 'key_01JB6OLDPS', name: 'old-pos', prefix: 'ak_live_', last4: '02aa', env: 'live', scopes: ['read'], sub: SUBS.hq, allowedIps: [], createdAt: '2026-09-02', createdBy: 'Wipa Srisuk', lastUsed: '2026-09-15', status: 'revoked', revokedAt: '2026-09-15' },
];
export const KEY_TILES = { activeKeys: 3, requests24h: 14820, error4xxPct: 0.3, webhookDeliveryPct: 99.6, webhookEvents24h: 12104, retried24h: 48, failedDeliveries: 3 };

export const WEBHOOKS = [
  { id: 'wh_01JB7Q9V', url: 'https://hooks.example.com/ants/voice', events: ['call.*', 'otp.*', 'recording.ready'], secretLast4: 'a9f1', status: 'active', failuresInRow: 0, lastDelivery: { at: isoAt('14:34:59'), code: 200, ms: 182 } },
  { id: 'wh_01JB7CRM', url: 'https://crm.example.com/ants/webhook', events: ['call.completed', 'broadcast.*'], secretLast4: '77c0', status: 'failing', failuresInRow: 6, lastDelivery: { at: isoAt('14:31:02'), code: 503 } },
  { id: 'wh_01JB7OLD', url: 'https://old-pos.example.com/hook', events: ['call.*'], secretLast4: '3e2b', status: 'off', failuresInRow: 100, lastDelivery: { at: isoOn('2026-10-20', '08:12'), code: null, timeout: true } },
];
export const WEBHOOK_RETRY = [1, 5, 30, 120, 600]; // seconds, then "failed"
export const FAILED_EVENTS = [
  { id: 'evt_01JBKX5A2Q', event: 'call.completed', endpoint: 'crm.example.com', attempts: 6, window: '14:31–14:41', reason: 'HTTP 503 Service Unavailable' },
  { id: 'evt_01JBKX59XM', event: 'call.completed', endpoint: 'crm.example.com', attempts: 6, window: '14:30–14:40', reason: 'HTTP 503 Service Unavailable' },
  { id: 'evt_01JBKX58MT', event: 'broadcast.progress', endpoint: 'crm.example.com', attempts: 6, window: '14:25–14:35', reason: 'Timed out after 5 seconds' },
];

// ---------- flows ----------
export const FLOWS = [
  { id: 'flw_01JB5MAIN1', name: { en: 'Main menu', th: 'เมนูหลัก', zh: '主菜单' }, live: 3, draft: 4, versions: [{ v: 4, status: 'draft', at: '2026-10-26', by: 'Tawan Pattana', note: 'option 3 added, greeting edited' }, { v: 3, status: 'live', at: '2026-10-20', by: 'Wipa Srisuk' }, { v: 2, at: '2026-10-15' }, { v: 1, at: '2026-10-10' }], linked: ['02-xxx-1000'], calls7d: 597 },
  { id: 'flw_01JB5CKN02', name: { en: 'Clinic menu', th: 'เมนูคลินิก', zh: '诊所菜单' }, live: 2, versions: [{ v: 2, status: 'live' }], linked: ['02-xxx-1002'], calls7d: 149 },
  { id: 'flw_01JB5CLSD2', name: { en: 'Closed', th: 'ปิดทำการ', zh: '非营业时间' }, live: 2, versions: [{ v: 2, status: 'live' }], linked: ['fallback:hq-pbx', 'fallback:cm-branch-pbx'], calls7d: 41 },
  { id: 'flw_01JB5MSG01', name: { en: 'Leave a message', th: 'ฝากข้อความ', zh: '留言' }, live: null, draft: 1, versions: [{ v: 1, status: 'draft' }], linked: [], calls7d: 0 },
];

// ---------- OTP & notification templates and stats ----------
export const OTP_TEMPLATES = [
  { id: 'otp-login', type: 'otp', sub: SUBS.app, languages: ['th', 'en', 'zh'], voice: 'standard-th-female', rate: 0.9, settings: { digits: 6, expiresMin: 5, repeatKey: 1, repeats: 2, lockAfterWrong: 3, smsFallbackSec: 30 }, status: 'live', version: 5, sent7d: 812 },
  { id: 'otp-payment-confirm', type: 'otp', sub: SUBS.app, languages: ['th', 'en'], voice: 'standard-th-female', rate: 0.9, settings: { digits: 6, expiresMin: 5 }, status: 'live', version: 2, sent7d: 232 },
  { id: 'notify-delivery-eta', type: 'alert', sub: SUBS.dv, languages: ['th', 'en', 'zh'], voice: 'standard-th-male', rate: 1.0, settings: { repeatKey: 1 }, status: 'live', version: 3, sent7d: 298 },
  { id: 'appointment-reminder', type: 'alert', sub: SUBS.ck, languages: ['th'], voice: 'standard-th-female', rate: 1.0, settings: { confirmKey: 1, smsKey: 2 }, status: 'draft', version: 1, sent7d: 0 },
];
export const OTP_STATS_7D = {
  sent: 1342, otpSent: 1044, notifSent: 298, answered: 1171, answeredPct: 87.3, otpAnswered: 914, otpAnsweredPct: 87.5, notifAnswered: 257, notifAnsweredPct: 86.2,
  verified: 876, verifiedPct: 95.8, smsFallback: 318, notAnswered: 171, credits: 1159.29, today: { otpSent: 130, otpAnswered: 114, notifSent: 37, notifAnswered: 32 },
};

// ---------- campaigns ----------
export const CAMPAIGNS = [
  {
    id: 'bc_01JBK7C1Q2', code: 'C1', name: { en: 'Delivery slot confirmation · 27 Oct', th: 'ยืนยันเวลาส่งสินค้า · 27 ต.ค.', zh: '确认送货时段 · 10月27日' },
    sub: SUBS.dv, callerId: '02-xxx-1001', purpose: 'service', status: 'running', progressPct: 62, startedAt: isoAt('12:30'), startedBy: 'Kamol Rakngan', expectedFinish: isoAt('15:40'),
    file: 'delivery_slots_27oct.csv', rows: 1208, duplicates: 37, dnc: 21, toCall: 1150, messageSec: 22, keys: { 1: 'confirm', 2: 'staff', 9: 'opt-out' },
    hours: 'Mon–Sat 09:00–18:00', retries: 2, retryAfterMin: 30, cps: 2, concurrent: 20, concurrentNow: 16,
    // Expected at launch = the last similar campaign (26 Oct): 55.5 % answered × 2.09 credits per answered call.
    estimate: { max: 1483.5, expected: 1333.94, expectedPct: 55.5 },
    // So far 387 of 704 finished = 55.0 % answered; transfers (key 2) carry the extra minutes: 593 billed min = 764.97.
    progress: { dialled: 713, answered: 387, noAnswer: 212, phoneOff: 40, busy: 58, failed: 47, failed503: 26, failed404: 21, inProgress: 9, queued: 437, retriesWaiting: 219 },
    keysPressed: { 1: 270, 2: 44, 9: 6, none: 67 }, billedMin: 593, credits: 764.97,
    recipients: [
      { phone: '081-xxx-4821', name: 'Waraporn', status: 'completed', key: '1', sec: 38, credits: 1.29 },
      { phone: '087-xxx-8156', name: 'Pim', status: 'completed', key: '2', transferred: true, sec: 205, credits: 5.16 },
      { phone: '092-xxx-2287', name: 'Mana', status: 'failed', sip: 503, attempt: 1, retryAt: '14:53' },
      { phone: '089-xxx-9034', name: 'Somsak', status: 'completed', key: '1', sec: 35, credits: 1.29 },
      { phone: '095-xxx-6632', name: 'Napa', status: 'busy', retryAt: '15:03' },
      { phone: '091-xxx-4470', name: 'Thana', status: 'completed', key: '9', optedOut: true, sec: 29, credits: 1.29 },
      { phone: '097-xxx-7421', name: 'Orathai', status: 'completed', key: null, sec: 4, credits: 1.29 },
      { phone: '090-xxx-1132', name: 'Kanya', status: 'ringing' },
    ],
  },
  {
    id: 'bc_01JBJ9HC2W', code: 'C2', name: { en: 'Health check reminder · Oct wk 4', th: 'แจ้งเตือนนัดตรวจสุขภาพ · ต.ค. สัปดาห์ 4', zh: '体检预约提醒 · 10月第4周' },
    sub: SUBS.ck, callerId: '02-xxx-1002', purpose: 'reminder', status: 'completed', startedAt: isoOn('2026-10-26', '10:00'), finishedAt: isoOn('2026-10-26', '11:42'),
    rows: 433, duplicates: 16, dnc: 7, toCall: 410, messageSec: 24, keys: { 1: 'confirm', 2: 'sms-link', 9: 'opt-out' },
    hours: 'Mon–Sat 09:00–18:00', retries: 2, retryAfterMin: 30, cps: 2, concurrent: 20,
    estimate: { max: 528.9, expected: 290.9, expectedPct: 55 }, result: { answered: 226, answeredPct: 55.1, noAnswer: 146, busy: 28, failed: 10 },
    keysPressed: { 1: 178, 2: 35, 9: 2, none: 11 }, billedMin: 226, credits: 291.54,
  },
  {
    id: 'bc_01JBKR28XP', code: 'C3', name: { en: 'Prescription ready for pickup · 28 Oct', th: 'แจ้งรับยา · 28 ต.ค.', zh: '取药通知 · 10月28日' },
    sub: SUBS.ck, callerId: '02-xxx-1002', purpose: 'service', status: 'scheduled', scheduledFor: isoOn('2026-10-28', '10:00'),
    rows: 146, duplicates: 3, dnc: 1, toCall: 142, messageSec: 15, keys: { 1: 'repeat' }, hours: 'Mon–Sat 09:00–18:00', retries: 2, retryAfterMin: 30, cps: 2, concurrent: 10,
    estimate: { max: 183.18, expected: 100.93, expectedPct: 55.1 },
  },
  {
    id: 'bc_01JBKF7V3N', code: 'C4', name: { en: 'Flu vaccine appointment reminder · Nov', th: 'แจ้งเตือนนัดฉีดวัคซีนไข้หวัดใหญ่ · พ.ย.', zh: '流感疫苗预约提醒 · 11月' },
    sub: SUBS.ck, callerId: '02-xxx-1002', purpose: 'reminder', status: 'draft', savedAt: '2026-10-26', savedBy: 'Preecha Mongkol',
    file: 'flu_vaccine_nov.csv', rows: 2000, duplicates: 86, dnc: 40, toCall: 1874, messageSec: 26, keys: { 1: 'confirm', 2: 'sms-link', 9: 'opt-out' },
    hours: 'Mon–Sat 09:00–18:00', retries: 2, retryAfterMin: 30, cps: 2, concurrent: 20,
    // Launch: up to 2,417.46 · expected ≈ 1,332.02 (55.1% = C2's answer rate) · typed token "1874"
    estimate: { max: 2417.46, expected: 1332.02, expectedPct: 55.1, balanceAfter: 20347.66, balanceAfterMax: 19262.22, dailyAfter: 4613.48 },
    simulatedResult: { answered: 1033, answeredPct: 55.1, noAnswer: 657, busy: 122, failed: 62, keysPressed: { 1: 816, 2: 163, 9: 8, none: 46 }, credits: 1332.57, balanceAfter: 20347.11 },
    confirmToken: '1874',
  },
  { id: 'bc_01JBHD26OC', name: { en: 'Delivery slot confirmation · 26 Oct', th: 'ยืนยันเวลาส่งสินค้า · 26 ต.ค.', zh: '确认送货时段 · 10月26日' }, sub: SUBS.dv, callerId: '02-xxx-1001', purpose: 'service', status: 'completed', toCall: 696, result: { answered: 386, answeredPct: 55.5 }, credits: 804.96, startedAt: isoOn('2026-10-26', '12:30') },
  { id: 'bc_01JBFD24OC', name: { en: 'Delivery slot confirmation · 24 Oct', th: 'ยืนยันเวลาส่งสินค้า · 24 ต.ค.', zh: '确认送货时段 · 10月24日' }, sub: SUBS.dv, callerId: '02-xxx-1001', purpose: 'service', status: 'completed', toCall: 619, result: { answered: 350, answeredPct: 56.5 }, credits: 664.35, startedAt: isoOn('2026-10-24', '12:30') },
];

// ---------- live calls (14 live, 6 shown) ----------
export const LIVE_CALLS = [
  { id: 'call_01JBKL1V0TP1', startedAt: isoAt('14:34:50'), direction: 'outbound', source: { type: 'api', ref: 'otp-login' }, sub: SUBS.app, party: '097-xxx-6613', state: 'ringing' },
  { id: 'call_01JBKL1V0C1A', startedAt: isoAt('14:34:41'), direction: 'outbound', source: { type: 'campaign', ref: 'bc_01JBK7C1Q2' }, sub: SUBS.dv, party: '090-xxx-1132', state: 'ringing' },
  { id: 'call_01JBKL1V0C1B', startedAt: isoAt('14:34:20'), direction: 'outbound', source: { type: 'campaign', ref: 'bc_01JBK7C1Q2' }, sub: SUBS.dv, party: '081-xxx-9920', state: 'playing' },
  { id: 'call_01JBKL1V0FM1', startedAt: isoAt('14:33:02'), direction: 'inbound', source: { type: 'flow', ref: 'flw_01JB5MAIN1', detail: { en: 'hq-pbx ext 203', th: 'hq-pbx เบอร์ภายใน 203', zh: 'hq-pbx 分机 203' } }, sub: SUBS.hq, party: '089-xxx-7004', state: 'in-progress' },
  { id: 'call_01JBKL1V0TK1', startedAt: isoAt('14:32:10'), direction: 'outbound', source: { type: 'trunk', ref: 'hq-pbx', detail: { en: 'ext 206', th: 'เบอร์ภายใน 206', zh: '分机 206' } }, sub: SUBS.hq, party: '084-xxx-5521', state: 'in-progress' },
  { id: 'call_01JBKL1V0C1C', startedAt: isoAt('14:31:15'), direction: 'outbound', source: { type: 'campaign', ref: 'bc_01JBK7C1Q2', detail: { en: 'transferred to the hq-pbx queue', th: 'โอนไปคิวของ hq-pbx', zh: '已转接到 hq-pbx 队列' } }, sub: SUBS.dv, party: '086-xxx-2290', state: 'in-progress' },
];

// ---------- call log: the latest 40 calls — they add up to 52.48 credits ----------
// [id, time, dir, srcType, srcRef, sub, from, to, status, sip, q850, talkSec, billedMin, pddSec, keys, rec, route, credits, reasonEN]
const S = SUBS;
const C1 = 'bc_01JBK7C1Q2';
const ROWS = [
  ['call_01JBK053QGBY', '14:34:52', 'out', 'campaign', C1, S.dv, '02-xxx-1001', '081-xxx-4821', 'completed', 200, 16, 38, 1, 2.4, '1', false, 'primary', 1.29, 'Answered · pressed 1 (slot confirmed)'],
  ['call_01JBKJEYSH16', '14:34:31', 'out', 'otp', 'otp-login', S.app, '02-xxx-1003', '089-xxx-2210', 'completed', 200, 16, 24, 1, 2.1, null, false, 'primary', 0.99, 'Answered · code read twice'],
  ['call_01JBKVBHSJYX', '14:34:05', 'in', 'flow', 'flw_01JB5MAIN1', S.hq, '086-xxx-5519', '02-xxx-1000', 'completed', 200, 16, 212, 4, null, '1', true, 'primary', 1.40, 'Caller chose 1 → hq-pbx ext 201 · recorded'],
  ['call_01JBK6FKP4QW', '14:33:48', 'out', 'campaign', C1, S.dv, '02-xxx-1001', '092-xxx-7781', 'no-answer', 480, 19, 0, 0, 2.9, null, false, 'primary', 0, 'Rang 30 s, no answer · retry at 15:03'],
  ['call_01JBKZ7BZA24', '14:33:20', 'out', 'campaign', C1, S.dv, '02-xxx-1001', '095-xxx-6632', 'busy', 486, 17, 0, 0, 2.2, null, false, 'primary', 0, 'Line busy · retry at 15:03'],
  ['call_01JBKVW8BVD2', '14:32:58', 'out', 'otp', 'otp-login', S.app, '02-xxx-1003', '081-xxx-8812', 'completed', 200, 16, 41, 1, 2.0, '1', false, 'primary', 0.99, 'Answered · pressed 1 to repeat'],
  ['call_01JBKFTM96AF', '14:32:31', 'out', 'campaign', C1, S.dv, '02-xxx-1001', '087-xxx-8156', 'completed', 200, 16, 205, 4, 2.6, '2', false, 'primary', 5.16, 'Answered · pressed 2 → transferred to hq-pbx queue'],
  ['call_01JBK358F6XM', '14:32:02', 'out', 'trunk', 'hq-pbx', S.hq, '02-xxx-1000', '083-xxx-1908', 'completed', 200, 16, 96, 2, 3.1, null, false, 'primary', 2.58, 'Agent call from ext 204'],
  ['call_01JBK9AYP962', '14:31:44', 'out', 'campaign', C1, S.dv, '02-xxx-1001', '098-xxx-3345', 'rejected', null, null, 0, 0, null, null, false, null, 0, 'Not dialled: number is on your Do-Not-Call list (VOICE_4204)', 'VOICE_4204'],
  ['call_01JBKMRSV1H2', '14:31:10', 'out', 'otp', 'otp-payment-confirm', S.app, '02-xxx-1003', '096-xxx-9981', 'no-answer', 480, 20, 0, 0, 4.8, null, false, 'primary', 0, 'Phone switched off or out of coverage · one retry in 90 s'],
  ['call_01JBKR01XBPM', '14:30:44', 'out', 'campaign', C1, S.dv, '02-xxx-1001', '088-xxx-3092', 'completed', 200, 16, 140, 3, 2.3, '2', false, 'primary', 3.87, 'Answered · pressed 2 → transferred to hq-pbx queue'],
  ['call_01JBKBZVT6JQ', '14:30:21', 'in', 'flow-fallback', 'flw_01JB5CLSD2', S.hq, '081-xxx-7710', '053-xxx-120', 'completed', 200, 16, 19, 1, null, null, false, 'primary', 0.25, 'Chiang Mai PBX unreachable → played "Closed" message'],
  ['call_01JBKFRMPXVF', '14:29:58', 'out', 'campaign', C1, S.dv, '02-xxx-1001', '089-xxx-9034', 'completed', 200, 16, 35, 1, 2.3, '1', false, 'primary', 1.29, 'Answered · pressed 1 (slot confirmed)'],
  ['call_01JBKB8C8C2F', '14:29:30', 'out', 'otp', 'otp-login', S.app, '02-xxx-1003', '093-xxx-1177', 'completed', 200, 16, 22, 1, 1.9, null, false, 'primary', 0.99, 'Answered · code read twice'],
  ['call_01JBKQNVMADS', '14:29:05', 'out', 'campaign', C1, S.dv, '02-xxx-1001', '086-xxx-9921', 'completed', 200, 16, 36, 1, 2.4, '1', false, 'primary', 1.29, 'Answered · pressed 1 (slot confirmed)'],
  ['call_01JBKS4WMEPG', '14:28:41', 'out', 'trunk', 'hq-pbx', S.hq, '02-xxx-1000', '+65 xxxx 2210', 'rejected', null, null, 0, 0, null, null, false, null, 0, 'International calling is off for this account (VOICE_4202)', 'VOICE_4202'],
  ['call_01JBKH5A4FVW', '14:28:12', 'out', 'campaign', C1, S.dv, '02-xxx-1001', '091-xxx-4470', 'completed', 200, 16, 29, 1, 2.5, '9', false, 'primary', 1.29, 'Answered · pressed 9 (opted out → added to Do-Not-Call)'],
  ['call_01JBKEGBQ5TZ', '14:27:36', 'out', 'otp', 'otp-login', S.app, '02-xxx-1003', '096-xxx-3310', 'failed', 404, 1, 0, 0, 1.7, null, false, 'backup', 0, 'Number not in service · check the number'],
  ['call_01JBKZ4Q21Q0', '14:27:02', 'in', 'flow', 'flw_01JB5MAIN1', S.hq, '094-xxx-2210', '02-xxx-1000', 'completed', 200, 16, 49, 1, null, '1', true, 'primary', 0.85, 'Caller chose 1 → hq-pbx ext 205 · recorded · transcribed', null, true],
  ['call_01JBK2Y53F8B', '14:26:40', 'out', 'campaign', C1, S.dv, '02-xxx-1001', '084-xxx-6120', 'completed', 200, 16, 37, 1, 2.2, '1', false, 'backup', 1.29, 'Answered · pressed 1 (slot confirmed)'],
  ['call_01JBKWY6X6T9', '14:26:12', 'out', 'click-to-call', 'Delivery CRM', S.dv, '02-xxx-1001', '082-xxx-3391', 'completed', 200, 16, 172, 7, 2.8, null, false, 'backup', 9.03, 'Staff leg 190 s + customer leg 172 s', null, false, [4, 3]],
  ['call_01JBKT3B8RF6', '14:25:47', 'out', 'notification', 'notify-delivery-eta', S.dv, '02-xxx-1001', '085-xxx-7004', 'completed', 200, 16, 21, 1, 2.0, null, false, 'backup', 0.99, 'Delivery ETA message played'],
  ['call_01JBK8J8YE9V', '14:25:15', 'out', 'campaign', C1, S.dv, '02-xxx-1001', '080-xxx-5813', 'busy', 603, 21, 0, 0, 2.4, null, false, 'backup', 0, 'Recipient declined the call · retry at 14:55'],
  ['call_01JBKJP1PZVW', '14:24:50', 'out', 'otp', 'otp-login', S.app, '02-xxx-1003', '061-xxx-2045', 'completed', 200, 16, 23, 1, 2.1, null, false, 'backup', 0.99, 'Answered · code read twice'],
  ['call_01JBK41Y9GBP', '14:24:18', 'in', 'flow', 'flw_01JB5CKN02', S.ck, '090-xxx-6718', '02-xxx-1002', 'completed', 200, 16, 148, 3, null, '1', true, 'primary', 1.05, 'Clinic menu → transferred to clinic counter (hq-pbx ext 310) · recorded'],
  ['call_01JBK985JJ1K', '14:23:51', 'out', 'campaign', C1, S.dv, '02-xxx-1001', '097-xxx-7421', 'completed', 200, 16, 4, 1, 2.7, null, false, 'primary', 1.29, 'Answered · hung up after 4 s · no key pressed'],
  ['call_01JBK4YVKDN2', '14:23:26', 'out', 'trunk', 'hq-pbx', S.hq, '02-xxx-1000', '081-xxx-2765', 'canceled', 487, null, 0, 0, 3.0, null, false, 'primary', 0, 'Your agent hung up after 22 s of ringing (PBX sent CANCEL)'],
  ['call_01JBK0CKQJY1', '14:22:59', 'out', 'campaign', C1, S.dv, '02-xxx-1001', '092-xxx-2287', 'failed', 503, 34, 0, 0, null, null, false, 'primary', 0, 'Mobile network temporarily unavailable on the primary route · not charged · automatic retry at 14:53', 'VOICE_5003'],
  ['call_01JBKWYC2M5J', '14:22:31', 'out', 'otp', 'otp-login', S.app, '02-xxx-1003', '062-xxx-8840', 'completed', 200, 16, 25, 1, 2.0, null, false, 'primary', 0.99, 'Answered · code read twice'],
  ['call_01JBK1DVXGPK', '14:22:05', 'out', 'campaign', C1, S.dv, '02-xxx-1001', '092-xxx-1186', 'no-answer', 480, 20, 0, 0, 5.2, null, false, 'primary', 0, 'Phone switched off or out of coverage · retry at 14:52'],
  ['call_01JBKXV8VZRG', '14:21:40', 'in', 'flow', 'flw_01JB5MAIN1', S.hq, '089-xxx-4416', '02-xxx-1000', 'completed', 200, 16, 387, 7, null, '1', true, 'primary', 2.45, 'Caller chose 1 → hq-pbx ext 202 · recorded'],
  ['call_01JBKDK8SYE8', '14:21:12', 'out', 'campaign', C1, S.dv, '02-xxx-1001', '086-xxx-0452', 'failed', 503, 34, 0, 0, null, null, false, 'primary', 0, 'Mobile network temporarily unavailable on the primary route · not charged · automatic retry at 14:51', 'VOICE_5003'],
  ['call_01JBKXAEZJRR', '14:20:47', 'out', 'otp', 'otp-payment-confirm', S.app, '02-xxx-1003', '081-xxx-6604', 'completed', 200, 16, 26, 1, 2.2, null, false, 'primary', 0.99, 'Answered · code read twice'],
  ['call_01JBK429RJ8B', '14:20:20', 'out', 'campaign', C1, S.dv, '02-xxx-1001', '095-xxx-0377', 'completed', 200, 16, 31, 1, 2.5, null, false, 'primary', 1.29, 'Answered · no key pressed'],
  ['call_01JBKNVFPBYT', '14:19:52', 'in', 'flow-fallback', 'flw_01JB5CLSD2', S.hq, '080-xxx-1458', '053-xxx-120', 'completed', 200, 16, 18, 1, null, null, false, 'primary', 0.25, 'Chiang Mai PBX unreachable → played "Closed" message'],
  ['call_01JBKF2HHAYY', '14:19:25', 'out', 'trunk', 'hq-pbx', S.hq, '02-xxx-1000', '093-xxx-5587', 'completed', 200, 16, 254, 5, 2.9, null, true, 'primary', 6.95, 'Agent call from ext 201 · recorded'],
  ['call_01JBK8TRXFSH', '14:18:58', 'out', 'otp', 'otp-login', S.app, '02-xxx-1003', '098-xxx-7741', 'completed', 200, 16, 24, 1, 2.0, null, false, 'primary', 0.99, 'Answered · code read twice'],
  ['call_01JBK2RKVGVP', '14:18:30', 'out', 'notification', 'notify-delivery-eta', S.dv, '02-xxx-1001', '083-xxx-6650', 'canceled', 487, null, 0, 0, 2.6, null, false, 'primary', 0, 'Canceled by your API request before answer (order already delivered)'],
  ['call_01JBKVX844K0', '14:18:02', 'in', 'flow', 'flw_01JB5MAIN1', S.hq, '091-xxx-2283', '02-xxx-1000', 'completed', 200, 16, 96, 2, null, '0', true, 'primary', 0.70, 'Caller chose 0 → hq-pbx operator · recorded'],
  ['call_01JBK7G88YYQ', '14:17:35', 'out', 'otp', 'otp-login', S.app, '02-xxx-1003', '087-xxx-1149', 'completed', 200, 16, 23, 1, 2.1, null, false, 'primary', 0.99, 'Answered · code read twice'],
];

const KIND = { campaign: 'outbound', trunk: 'outbound', 'click-to-call': 'click-to-call', otp: 'otp', notification: 'notification', flow: 'inbound', 'flow-fallback': 'inbound' };

export function buildCalls() {
  return ROWS.map(([id, time, dir, srcType, srcRef, sub, from, to, status, sip, q850, sec, billedMin, pdd, keys, rec, route, credits, reason, code, transcribed, legs]) => ({
    id, ts: isoAt(time), env: 'live', direction: dir === 'in' ? 'inbound' : 'outbound', kind: KIND[srcType],
    source: { type: srcType, ref: srcRef }, sub, from, to, status, sip, q850, sec, billedMin, legs: legs || null,
    pddMs: pdd == null ? null : Math.round(pdd * 1000), keys, recorded: !!rec, transcribed: !!transcribed, route, credits,
    reason: { en: reason }, code: code || null,
  }));
}

// ---------- reports: last 7 days, 21–27 Oct to 14:35 ----------
export const REPORTS_7D = {
  answerRateOutPct: 66.3, outAnswered: 5548, outCalls: 8367, avgTalkSec: 91, avgTalkInboundSec: 142, pddSec: 2.6, pddPeak: { sec: 4.1, at: isoAt('14:10') },
  calls: 10455, otpNotif: 1342, inbound: 746, credits: 15267.34, prev7Credits: 18225.16, otpAnswerPct: 87.3, inboundAnswerPct: 96.0, inboundAnswered: 716,
  notConnectedTotal: 3020,
  reasons: [
    { key: 'noAnswer', code: 'SIP 480 / 487 · Q.850 19', calls: 1322, pct: 12.6 },
    { key: 'busy', code: 'SIP 486', calls: 548, pct: 5.2 },
    { key: 'phoneOff', code: 'SIP 480 · Q.850 20', calls: 486, pct: 4.6 },
    { key: 'notInService', code: 'SIP 404', calls: 198, pct: 1.9 },
    { key: 'declined', code: 'SIP 603', calls: 176, pct: 1.7 },
    { key: 'networkUnavailable', code: 'SIP 503', calls: 103, pct: 1.0 },
    { key: 'dnc', code: 'VOICE_4204', calls: 88, pct: 0.8 },
    { key: 'hours', code: 'VOICE_4205', calls: 41, pct: 0.4 },
    { key: 'callerHungUp', code: 'SIP 487', calls: 30, pct: 0.3 },
    { key: 'canceled', code: 'SIP 487', calls: 22, pct: 0.2 },
    { key: 'intlOff', code: 'VOICE_4202', calls: 6, pct: 0.1 },
  ],
  bySub: [
    { sub: S.dv, calls: 5968, billedMin: 6007, notifCalls: 257, credits: 8003.46, share: 52 },
    { sub: S.hq, calls: 2884, billedMin: 5562, credits: 5944.68, share: 39 },
    { sub: S.app, calls: 1044, billedMin: null, otpAnswered: 914, credits: 904.86, share: 6 },
    // Clinic = health check campaign C2 (410 calls · 226 billed min · 291.54) + the clinic menu (149 inbound calls).
    { sub: S.ck, calls: 559, billedMin: 598, credits: 414.34, share: 3 },
  ],
};

// ---------- billing ----------
/** Account balance at 14:35. CONTRACT: the live value is store credits.balance (top-ups and calls change it). */
export const BALANCE = 21679.68;
export const BILLING = {
  avgPerDay7: 2651, usedToday: { total: 2196.02, voice: 1906.02, other: 290 }, usedMonth: { total: 81270.32, voice: 68660.32, other: 12610 },
  autoTopUp: false,
  usage: [
    { product: 'voice', item: 'outbound', quantity: MTD.outMin, unit: 'min', credits: 57696.54 },
    { product: 'voice', item: 'otp', quantity: MTD.otpAnswered, unit: 'answered-call', credits: 5027.22 },
    { product: 'voice', item: 'inbound', quantity: MTD.inMin, unit: 'min', credits: 2019.5 },
    { product: 'voice', item: 'recording', quantity: MTD.recMin, unit: 'min', credits: 1515.1 },
    { product: 'voice', item: 'numbers', quantity: MTD.numbers, unit: 'number', credits: 411.96 },
    { product: 'voice', item: 'extraConcurrent', quantity: MTD.extraConcurrent, unit: 'call', credits: 1990 },
    { product: 'sms', item: 'sms', quantity: 18400, unit: 'message', credits: 9860 },
    { product: 'line', item: 'line', quantity: 6100, unit: 'message', credits: 2140 },
    { product: 'email', item: 'email', quantity: 40500, unit: 'email', credits: 610 },
  ],
  statements: [
    { period: '2026-10', status: 'current', opening: 2950, topUps: 100000, topUpList: [['2026-10-01', 40000], ['2026-10-12', 40000], ['2026-10-22', 20000]], bonus: 0, used: 81270.32, closing: 21679.68 },
    { period: '2026-09', status: 'closed', opening: 0, topUps: 60000, topUpList: [['2026-09-02', 20000], ['2026-09-16', 40000]], bonus: 2000, used: 59050, closing: 2950 },
  ],
  invoices: [
    { id: 'INV-2610-0671', date: '2026-10-22', credits: 20000, net: 20000, vat: 1400, total: 21400 },
    { id: 'INV-2610-0398', date: '2026-10-12', credits: 40000, net: 40000, vat: 2800, total: 42800 },
    { id: 'INV-2610-0105', date: '2026-10-01', credits: 40000, net: 40000, vat: 2800, total: 42800 },
    { id: 'INV-2609-0731', date: '2026-09-16', credits: 40000, net: 40000, vat: 2800, total: 42800 },
    { id: 'INV-2609-0412', date: '2026-09-02', credits: 20000, bonus: 2000, net: 20000, vat: 1400, total: 21400 },
  ],
  nextInvoiceNo: 702,
  offers: { firstTopUpUsedAt: '2026-09-02', annual: 'available', trialUsedUntil: '2026-10-02' },
  // Billing mode (see actions.js "billing modes"). The busy account starts on prepaid credits; the Demo panel
  // switches it to postpaid and/or a 50,000-minute commitment plan.
  profile: { mode: 'prepaid', creditLimit: null, paymentTermsDays: null, usedThisMonth: null, plan: null, invoices: [] },
};
/** Credit exchange rate. In the demo 1 credit = 1.00 THB; a real account's rate is set in its contract. */
export const CREDIT_RATE = { credits: 1, thb: 1, currency: 'THB', effectiveFrom: '2026-09-01', label: { en: '1 credit = 1.00 THB', th: '1 เครดิต = 1.00 บาท', zh: '1 点数 = 1.00 泰铢' } };
export const LIMITS = { daily: 8000, monthly: 120000, action: 'block-and-notify', channels: ['email', 'line'], international: false, premiumRate: 'blocked', perSub: { [S.app]: 1500, [S.dv]: 5000, [S.ck]: 2000 } };
/** Sample pace this month: ≈ 52,100 outbound min → a volume plan really would save money. */
export const PACE_OUT_MIN = 52100;

// ---------- alerts + notifications ----------
export const ALERT_RULES = [
  { id: 'rule_spend', type: 'spend-near-limit', condition: { pct: 80 }, channels: ['email', 'line'], on: true, lastFired: null },
  { id: 'rule_fail', type: 'failure-rate', condition: { pct: 10, windowMin: 15, minCalls: 50 }, channels: ['email', 'line'], on: true, lastFired: isoAt('14:23') },
  { id: 'rule_trunk', type: 'trunk-down', condition: { misses: 3 }, channels: ['email', 'webhook'], on: true, lastFired: isoAt('13:58') },
  { id: 'rule_answer', type: 'answer-rate-drop', condition: { pct: 50, windowMin: 30 }, channels: ['email'], on: true, lastFired: isoOn('2026-10-23', '10:40') },
  { id: 'rule_credits', type: 'low-credits', condition: { below: 5000 }, channels: ['email', 'line'], on: true, lastFired: isoOn('2026-09-30', '16:40') },
  { id: 'rule_pattern', type: 'unusual-pattern', condition: { newNumbersPerHour: 300 }, channels: ['email', 'line'], on: false, recommended: true, lastFired: null },
];
export const ALERT_CHANNELS = { emails: ['ops@example.com', 'somchai@example.com'], lineGroup: 'Example Trading ops', webhook: 'https://hooks.example.com/ants/alerts' };
export const ALERT_HISTORY = [
  { id: 'alr_20261027_1423', at: isoAt('14:23'), rule: 'failure-rate', ref: C1, details: { pct: 27, failed: 26, of: 96, sip: 503, movedAt: '14:24' }, sentTo: ['email', 'line'], status: 'open' },
  { id: 'alr_20261027_1358', at: isoAt('13:58'), rule: 'trunk-down', ref: 'cm-branch-pbx', details: {}, sentTo: ['email', 'webhook'], status: 'acknowledged', by: 'Wipa Srisuk', byAt: '14:05' },
  { id: 'alr_20261023_1040', at: isoOn('2026-10-23', '10:40'), rule: 'answer-rate-drop', ref: 'Delivery slot confirmation · 23 Oct', details: { pct: 44, windowMin: 30 }, sentTo: ['email'], status: 'resolved', resolvedAt: '11:40' },
  { id: 'alr_20260930_1640', at: isoOn('2026-09-30', '16:40'), rule: 'low-credits', details: { balance: 4880 }, sentTo: ['email', 'line'], status: 'resolved' },
];
/** Bell: 8 items, 4 unread (+ the pinned announcement on top). Text keys: notif.<type>.title / .body */
export const NOTIFICATIONS = [
  { id: 'ntf_inc', type: 'incidentResolved', at: isoAt('14:33'), read: false, href: 'help/status?inc=20261027' },
  { id: 'ntf_fail', type: 'failureRate', at: isoAt('14:23'), read: false, href: 'alerts', vars: { pct: 27, window: 15, campaign: C1 } },
  { id: 'ntf_ticket', type: 'ticketReply', at: isoAt('14:20'), read: false, href: 'help/tickets/SUP-10452', vars: { ticket: 'SUP-10452' } },
  { id: 'ntf_trunk', type: 'trunkDown', at: isoAt('13:58'), read: false, href: 'trunks/cm-branch-pbx', vars: { trunk: 'cm-branch-pbx' } },
  { id: 'ntf_camp', type: 'campaignFinished', at: isoOn('2026-10-26', '11:42'), read: true, href: 'campaigns/bc_01JBJ9HC2W', vars: { campaign: 'bc_01JBJ9HC2W', pct: 55 } },
  { id: 'ntf_order', type: 'numberOrdered', at: isoOn('2026-10-26', '10:15'), read: true, href: 'numbers?n=num_01JB3A1004', vars: { number: '02-xxx-1004' } },
  { id: 'ntf_wh', type: 'webhookFailing', at: isoOn('2026-10-24', '16:41'), read: true, href: 'keys?section=webhooks', vars: { host: 'crm.example.com', n: 6 } },
  { id: 'ntf_plans', type: 'plansNew', at: isoOn('2026-10-20', '09:00'), read: true, href: 'help/whats-new' },
];

// ---------- audit log ----------
export const AUDIT = [
  { at: isoAt('14:23'), who: 'system', what: 'alert.sent', detail: { rule: 'failure-rate', channels: ['email', 'line'] }, target: C1, ip: null, via: 'system' },
  { at: isoAt('14:05'), who: 'Wipa Srisuk', what: 'alert.acknowledged', detail: { rule: 'trunk-down', trunk: 'cm-branch-pbx' }, target: 'trk_01JB4CMPBX', ip: '203.0.113.25', via: 'console' },
  { at: isoAt('14:02'), who: 'Wipa Srisuk', what: 'ticket.opened', detail: { ticket: 'SUP-10452' }, target: 'SUP-10452', ip: '203.0.113.25', via: 'console' },
  { at: isoAt('12:30'), who: 'Kamol Rakngan', what: 'campaign.launched', detail: { numbers: 1150, max: 1483.5, token: '1150' }, target: C1, ip: '203.0.113.26', via: 'console' },
  { at: isoAt('09:00'), until: isoAt('14:00'), who: 'key:app-backend', what: 'otp.sent.grouped', detail: { calls: 104 }, target: '/v1/voice/otp', ip: '203.0.113.10', via: 'api' },
  { at: isoOn('2026-10-26', '18:05'), who: 'Tawan Pattana', what: 'flow.draft.saved', detail: { flow: 'flw_01JB5MAIN1', v: 4 }, target: 'flw_01JB5MAIN1', ip: '198.51.100.9', via: 'console' },
  { at: isoOn('2026-10-26', '16:20'), who: 'Somchai Jaidee', what: 'member.invited', detail: { email: 'nok@example.com', role: 'operator' }, target: null, ip: '198.51.100.7', via: 'console' },
  { at: isoOn('2026-10-26', '10:15'), who: 'Somchai Jaidee', what: 'number.ordered', detail: { number: '02-xxx-1004', monthly: PRICES.number }, target: 'num_01JB3A1004', ip: '198.51.100.7', via: 'console' },
  { at: isoOn('2026-10-25', '17:12'), who: 'Wipa Srisuk', what: 'member.role.changed', detail: { member: 'Preecha Mongkol', from: 'operator', to: 'viewer' }, target: 'user_01JB1PM', ip: '203.0.113.25', via: 'console' },
  { at: isoOn('2026-10-22', '08:58'), who: 'Somchai Jaidee', what: 'credits.topped-up', detail: { credits: 20000, invoice: 'INV-2610-0671' }, target: null, ip: '198.51.100.7', via: 'console' },
  { at: isoOn('2026-10-20', '11:48'), who: 'Tawan Pattana', what: 'webhook.secret.rotated', detail: { host: 'hooks.example.com' }, target: 'wh_01JB7Q9V', ip: '198.51.100.9', via: 'console' },
  { at: isoOn('2026-10-15', '09:30'), who: 'Somchai Jaidee', what: 'limit.daily.raised', detail: { from: 5000, to: 8000 }, target: null, ip: '198.51.100.7', via: 'console' },
];

// ---------- support tickets ----------
export const TICKETS = [
  { id: 'SUP-10452', priority: 'P2', topic: 'trunk', subject: { en: 'cm-branch-pbx stopped answering OPTIONS after a router change', th: 'ตู้สาขาเชียงใหม่ไม่ตอบ OPTIONS หลังเปลี่ยนเราเตอร์', zh: '更换路由器后清迈 PBX 不再响应 OPTIONS' }, openedAt: isoAt('14:02'), openedBy: 'Wipa Srisuk', status: 'waiting-for-you', lastMessage: { at: isoAt('14:20'), from: 'ANTS support', text: 'We have seen no OPTIONS from 198.51.100.40 since 13:56. If the router changed, check that TCP 5061 is forwarded to the PBX and that the new public IP is in the trunk\'s allow-list. Could you send the PBX SIP log from 13:50 to 14:00?' } },
  { id: 'SUP-10418', priority: 'P3', topic: 'campaigns', subject: { en: 'Raise calls per second to 5 for delivery campaigns', th: 'ขอเพิ่มจำนวนสายต่อวินาทีเป็น 5 สำหรับแคมเปญจัดส่ง', zh: '将配送活动的每秒呼叫数提高到 5' }, openedAt: isoOn('2026-10-20', '10:05'), openedBy: 'Kamol Rakngan', status: 'solved', solvedAt: '2026-10-21', lastMessage: { text: 'Calls per second stay at 2 per trunk during early access. We\'ve noted your request and will tell you when 5 is available.' } },
];
export const NEXT_TICKET_NO = 10473;

// ---------- status page incidents (story) ----------
export const INCIDENTS = [
  { id: 'inc-20261027', date: '2026-10-27', component: 'mobile', title: { en: 'Some calls to one Thai mobile network failed (sample)', th: 'สายไปเครือข่ายมือถือหนึ่งในไทยล้มเหลวบางส่วน (ตัวอย่าง)', zh: '部分呼叫泰国某移动网络的通话失败（示例）' }, from: '14:06', to: '14:24', updates: [['14:09', 'investigating'], ['14:15', 'identified'], ['14:24', 'monitoring'], ['14:33', 'resolved']], status: 'resolved' },
];
