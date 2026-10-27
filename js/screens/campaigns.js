// Campaigns — #/campaigns · #/campaigns/new (?draft=<id>&step=n) · #/campaigns/<id>
// List (running / scheduled / draft / completed), the 4-step wizard (audience CSV → message with a TTS preview →
// schedule, calling hours and Do-Not-Call removal → cost estimate before spend → typed recipient count) and the
// campaign detail (live progress, answer rate, retries, pause / resume / stop, export CSV).
// Industry presets (planned) in step 1; Payment reminder and Insurance sales lock the calling window, and every
// window uses the shared Thai public-holiday list (js/data/holidays.js: a weekday holiday ends at 18:00).
// Answer rates of the sample campaigns sit at about 55 % (Thai scam-call fear: many people do not pick up unknown
// numbers). Every count and credit amount reconciles with js/data/active.js: C1 so far 387 of 704 answered (55.0 %),
// 593 billed min = 764.97 · C2 226 of 410 (55.1 %) = 291.54 · C4 launch up to 2,417.46, expected ≈ 1,332.02
// (55.1 % = C2), result 1,033 × 1.29 = 1,332.57.

import { raw, reducedMotion } from '../core/dom.js';
import { newId, audit, notify, chargeCalls, minutesCost, activePlan, balance, usageToday } from '../core/actions.js';
import { tIn, getLang, LANGS, LANG_ORDER, loc } from '../core/i18n.js';
import { store } from '../core/store.js';
import { nowMs, at as atToday, on as onDay, TZ } from '../data/clock.js';
import { PRICES, billedMinutes, comparePlans } from '../data/prices.js';
import { CLINIC, BRAND, SUBS } from '../data/active.js';
import { holidayOn, ymdOf } from '../data/holidays.js';
import { SANDBOX_CALLER } from '../data/edge.js';
import { normalizeTyped } from '../ui/confirm.js';
import { fmt as FMT } from '../core/format.js';

export const id = 'campaigns';
export const nav = { group: 'build', icon: 'megaphone', labelKey: 'nav.campaigns' };
export const titleKey = 'nav.campaigns';
export const skeleton = 'table';
export const css = true;
export const initialState = () => ({ filter: 'all', q: '', wz: null, det: {} });

/** Third crumb: "New campaign" or the campaign name. */
export function crumb(params, { t }) {
  const p = params.path[0];
  if (!p) return '';
  if (p === 'new') {
    const d = params.query.draft && (store.get('campaigns') || []).find((c) => c.id === params.query.draft);
    return d ? loc(d.name) : t('crumb.new');
  }
  const c = (store.get('campaigns') || []).find((x) => x.id === p);
  return c ? loc(c.name) : p;
}

export const commands = [
  { id: 'drafts', labelKey: 'cmd.drafts', icon: 'megaphone', keywords: ['campaign drafts draft broadcast'], run: ({ go }) => go('campaigns?status=draft') },
];

// ---------- constants ----------
/** Recipients show first names only. Index 0–7 are the C1 sample rows; {name} sample = index 0. */
const NAMES = [
  { en: 'Waraporn', th: 'วราภรณ์', zh: '林女士' }, { en: 'Pim', th: 'พิม', zh: '陈小姐' }, { en: 'Mana', th: 'มานะ', zh: '王先生' },
  { en: 'Somsak', th: 'สมศักดิ์', zh: '张先生' }, { en: 'Napa', th: 'นภา', zh: '李女士' }, { en: 'Thana', th: 'ธนา', zh: '刘先生' },
  { en: 'Orathai', th: 'อรทัย', zh: '黄女士' }, { en: 'Kanya', th: 'กัญญา', zh: '赵小姐' }, { en: 'Suda', th: 'สุดา', zh: '周女士' },
  { en: 'Anan', th: 'อนันต์', zh: '吴先生' }, { en: 'Malee', th: 'มาลี', zh: '郑女士' }, { en: 'Prasert', th: 'ประเสริฐ', zh: '孙先生' },
  { en: 'Wilai', th: 'วิไล', zh: '马女士' }, { en: 'Chai', th: 'ชัย', zh: '胡先生' }, { en: 'Ratana', th: 'รัตนา', zh: '郭女士' },
  { en: 'Somporn', th: 'สมพร', zh: '何女士' }, { en: 'Niran', th: 'นิรันดร์', zh: '罗先生' }, { en: 'Sunee', th: 'สุนีย์', zh: '梁女士' },
  { en: 'Boonmee', th: 'บุญมี', zh: '宋先生' }, { en: 'Jintana', th: 'จินตนา', zh: '谢女士' }, { en: 'Arun', th: 'อรุณ', zh: '韩先生' },
  { en: 'Kanok', th: 'กนก', zh: '唐女士' }, { en: 'Pornthip', th: 'พรทิพย์', zh: '冯女士' }, { en: 'Ekachai', th: 'เอกชัย', zh: '许先生' },
];
const PREFIX = ['081', '082', '083', '084', '085', '086', '087', '088', '089', '090', '091', '092', '093', '094', '095', '096', '097', '098', '061', '062', '063', '064', '065'];
/** Numbers already on the account's Do-Not-Call list (they pressed 9 or were added by hand). */
const DNC_SET = new Set(['098-xxx-3345', '091-xxx-4470', '080-xxx-0099']);
const FILTERS = ['all', 'running', 'scheduled', 'draft', 'completed'];
const FILTER_OF = { running: 'running', paused: 'running', scheduled: 'scheduled', draft: 'draft', completed: 'completed', canceled: 'completed' };
const PURPOSES = ['reminder', 'service', 'payment', 'marketing'];
/** Industry presets (planned): each sets hours, retries and recording rules together. Rules shown per preset. */
const PRESETS = ['general', 'payment', 'healthcare', 'insurance'];
const PRESET_RULES = { general: 2, payment: 4, healthcare: 3, insurance: 4 };
const KEY_ACTIONS = ['confirm', 'sms-link', 'transfer', 'repeat', 'opt-out'];
const STEPS = 4;
const COLUMNS = ['phone', 'name', 'date', 'time', 'clinic', 'slot', 'person_id'];
const WEEKEND_END = 18 * 60; // weekends and public holidays end at 18:00 (Settings › Compliance)
const SCRIPT_OF = { bc_01JBK7C1Q2: 'delivery', bc_01JBJ9HC2W: 'reminder', bc_01JBKR28XP: 'pickup', bc_01JBKF7V3N: 'reminder', bc_01JBHD26OC: 'delivery', bc_01JBFD24OC: 'delivery' };
const DAY_KEYS = [1, 2, 3, 4, 5, 6, 0];          // Mon … Sun (Date.getDay values)
// The customer's own, optional limit on talk time after a transfer to their staff (0 = no limit, the default).
// With no limit a campaign that can transfer has no ceiling: transferred calls are billed for their full length.
const TRANSFER_MINUTES = [0, 3, 5, 10];
const MAX_REPEATS = 2;
const RUN_TICKS = 90;                            // 90 × 500 ms ≈ 45 s for the whole list
const TICK_MS = 500;

// ---------- small utilities ----------
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let x = Math.imul(a ^ (a >>> 15), 1 | a); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}
const hash = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
function shuffle(arr, r) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
const round2 = (n) => Math.round(n * 100) / 100;
const pad2 = (n) => String(n).padStart(2, '0');
const hhmmOf = (ms) => { const d = new Date(ms + 7 * 3600000); return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`; };
const toMin = (hhmm) => { const [h, m] = String(hhmm || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const bkkDay = (ms) => new Date(ms + 7 * 3600000).getUTCDay();
const bkkMinutes = (ms) => { const d = new Date(ms + 7 * 3600000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
function phoneGen(r, used) {
  for (;;) {
    const p = `${PREFIX[Math.floor(r() * PREFIX.length)]}-xxx-${String(Math.floor(r() * 10000)).padStart(4, '0')}`;
    if (!used.has(p) && !DNC_SET.has(p)) { used.add(p); return p; }
  }
}
const nameOf = (n) => loc(NAMES[((n % NAMES.length) + NAMES.length) % NAMES.length]);
const onRoute = (re) => re.test(location.hash);
const isList = () => /^#\/campaigns(\?|$)/.test(location.hash);
const isWizard = () => /^#\/campaigns\/new/.test(location.hash);
const findCamp = (cid) => (store.get('campaigns') || []).find((c) => c.id === cid);
const firstRun = () => store.get('mode') === 'firstRun';
const env = () => store.get('env');

/** A timer that survives in-place re-renders (ctx.later is cleared on each one); skipped when the token moved on. */
function soon(ctx, fn, ms) {
  const tok = (ctx.state.tok = (ctx.state.tok || 0) + 1);
  setTimeout(() => { if (ctx.state && ctx.state.tok === tok) fn(); }, reducedMotion() ? Math.min(ms, 250) : ms);
}


// ---------- recipients (generated deterministically so every total reconciles) ----------
const OUTCOME = {
  completed: { status: 'completed', sip: 200, q850: 16 },
  noAnswer: { status: 'no-answer', sip: 480, q850: 19 },
  phoneOff: { status: 'no-answer', sip: 480, q850: 20 },
  busy: { status: 'busy', sip: 486, q850: 17 },
  declined: { status: 'busy', sip: 603, q850: 21 },
  f503: { status: 'failed', sip: 503, q850: 34 },
  f404: { status: 'failed', sip: 404, q850: 1 },
  ringing: { status: 'ringing', sip: 180, q850: null },
  inCall: { status: 'in-progress', sip: 200, q850: null },
  queued: { status: 'queued', sip: null, q850: null },
};

/** Spread `n` attempt times between from and to (ms), newest first. */
const spreadTimes = (n, from, to, r) => Array.from({ length: n }, () => Math.round(from + r() * (to - from))).sort((a, b) => b - a);

function fillGenerated(out, spec, r, used, from, to, rate) {
  // spec: { completed: { keys: { '1': n, … }, billedMin, transferKey }, noAnswer, phoneOff, busy, declined, f503, f404, ringing, inCall, queued, retries }
  const cats = [];
  for (const k of ['noAnswer', 'phoneOff', 'busy', 'declined', 'f503', 'f404']) for (let i = 0; i < (spec[k] || 0); i++) cats.push(k);
  const keyList = [];
  for (const [k, n] of Object.entries((spec.completed && spec.completed.keys) || {})) for (let i = 0; i < n; i++) keyList.push(k === 'none' ? null : k);
  for (let i = 0; i < keyList.length; i++) cats.push('completed');
  shuffle(cats, r);
  shuffle(keyList, r);
  const times = spreadTimes(cats.length, from, to, r);
  // Extra billed minutes go to transferred calls (key 2 → staff), so the sum of minutes matches the campaign.
  const transferKey = spec.completed && spec.completed.transferKey;
  const nTransfer = transferKey ? keyList.filter((k) => k === transferKey).length : 0;
  let extra = spec.completed && spec.completed.billedMin != null ? spec.completed.billedMin - keyList.length : 0;
  const extraPer = new Array(nTransfer).fill(0);
  for (let i = 0; i < nTransfer && extra > 0; i++) { extraPer[i] = 1; extra -= 1; }
  let guard = 0;
  while (extra > 0 && nTransfer && guard < 100000) { const j = Math.floor(r() * nTransfer); if (extraPer[j] < 9) { extraPer[j] += 1; extra -= 1; } guard++; }
  let ki = 0;
  let ti = 0;
  let retryLeft = spec.retries || 0;
  cats.forEach((cat, i) => {
    const o = OUTCOME[cat];
    const rec = { phone: phoneGen(r, used), n: 8 + Math.floor(r() * (NAMES.length - 8)), status: o.status, sip: o.sip, q850: o.q850, attempt: 1, at: times[i], key: null, sec: 0, credits: 0 };
    if (cat === 'completed') {
      rec.key = keyList[ki++];
      if (rec.key && rec.key === transferKey) { const mins = 1 + (extraPer[ti++] || 0); rec.transferred = true; rec.sec = mins * 60 - 5 - Math.floor(r() * 40); rec.billed = mins; } else { rec.sec = 18 + Math.floor(r() * 22); rec.billed = 1; }
      if (rec.key === '9') rec.optedOut = true;
      rec.credits = round2(rec.billed * rate);
    } else {
      if (r() < 0.25) rec.attempt = 2;
      if (cat !== 'f404' && retryLeft > 0) { rec.retryAt = rec.at + (spec.retryAfterMin || 30) * 60000; retryLeft -= 1; }
    }
    out.push(rec);
  });
  for (let i = 0; i < (spec.ringing || 0); i++) out.push({ phone: phoneGen(r, used), n: 8 + Math.floor(r() * 16), ...OUTCOME.ringing, status: 'ringing', attempt: 1, at: atToday('14:34:30') - Math.floor(r() * 60000), sec: 0, credits: 0 });
  for (let i = 0; i < (spec.inCall || 0); i++) out.push({ phone: phoneGen(r, used), n: 8 + Math.floor(r() * 16), ...OUTCOME.inCall, status: 'in-progress', attempt: 1, at: atToday('14:33:40') - Math.floor(r() * 90000), sec: 0, credits: 0 });
  for (let i = 0; i < (spec.queued || 0); i++) out.push({ phone: phoneGen(r, used), n: 8 + Math.floor(r() * 16), ...OUTCOME.queued, status: 'queued', attempt: 0, at: null, sec: 0, credits: 0 });
}

/** C1 (running): log-backed rows first (they open in Logs), then generated rows to match the seed counts exactly. */
function buildC1(c) {
  const r = rng(hash(c.id));
  const used = new Set();
  const out = [];
  const given = c.recipients || [];
  const givenIdx = (phone) => given.findIndex((g) => g.phone === phone);
  const calls = (store.get('calls') || []).filter((x) => x.source && x.source.ref === c.id && x.status !== 'rejected' && !x.byCampaignRun);
  const tally = { completed: 0, keys: { 1: 0, 2: 0, 9: 0, none: 0 }, billed: 0, noAnswer: 0, phoneOff: 0, busy: 0, declined: 0, f503: 0, f404: 0, live: 0 };
  for (const x of calls) {
    used.add(x.to);
    const gi = givenIdx(x.to);
    const rec = { phone: x.to, n: gi >= 0 ? gi : 8 + (hash(x.to) % 16), status: x.status, sip: x.sip, q850: x.q850, attempt: 1, at: Date.parse(x.ts), key: x.keys || null, sec: x.sec || 0, credits: x.credits || 0, callId: x.id };
    if (x.status === 'completed') { tally.completed++; tally.keys[x.keys || 'none']++; tally.billed += x.billedMin || 1; rec.billed = x.billedMin || 1; if (x.keys === '2') rec.transferred = true; if (x.keys === '9') rec.optedOut = true; }
    else if (x.status === 'no-answer') { if (x.q850 === 20) tally.phoneOff++; else tally.noAnswer++; rec.retryAt = Date.parse(x.ts) + 30 * 60000; }
    else if (x.status === 'busy') { if (x.sip === 603) tally.declined++; else tally.busy++; rec.retryAt = Date.parse(x.ts) + 30 * 60000; }
    else if (x.status === 'failed') { if (x.sip === 404) tally.f404++; else { tally.f503++; rec.retryAt = Date.parse(x.ts) + 30 * 60000; } }
    out.push(rec);
  }
  for (const lc of (store.get('liveCalls') || []).filter((x) => x.source && x.source.ref === c.id)) {
    used.add(lc.party);
    const gi = givenIdx(lc.party);
    out.push({ phone: lc.party, n: gi >= 0 ? gi : 8 + (hash(lc.party) % 16), status: lc.state === 'ringing' ? 'ringing' : 'in-progress', sip: null, attempt: 1, at: Date.parse(lc.startedAt), sec: 0, credits: 0, callId: lc.id, live: true });
    tally.live++;
  }
  const p = c.progress;
  const keys = c.keysPressed;
  const spec = {
    completed: { keys: { 1: keys[1] - tally.keys[1], 2: keys[2] - tally.keys[2], 9: keys[9] - tally.keys[9], none: keys.none - tally.keys.none }, billedMin: c.billedMin - tally.billed, transferKey: '2' },
    noAnswer: Math.max(0, p.noAnswer - p.phoneOff - tally.noAnswer), phoneOff: Math.max(0, p.phoneOff - tally.phoneOff),
    busy: Math.max(0, Math.round(p.busy * 0.8) - tally.busy), declined: Math.max(0, p.busy - Math.round(p.busy * 0.8) - tally.declined),
    f503: Math.max(0, p.failed503 - tally.f503), f404: Math.max(0, p.failed404 - tally.f404),
    ringing: 0, inCall: Math.max(0, p.inProgress - tally.live), queued: p.queued, retries: p.retriesWaiting - out.filter((x) => x.retryAt).length,
  };
  fillGenerated(out, spec, r, used, Date.parse(c.startedAt), atToday('14:17:00'), PRICES.outbound);
  return out;
}

function buildFromResult(c, { answered, keys, billedMin, transferKey, noAnswer, phoneOff = 0, busy, declined = 0, f503 = 0, f404 = 0, from, to }) {
  const r = rng(hash(c.id));
  const out = [];
  fillGenerated(out, { completed: { keys, billedMin, transferKey }, noAnswer, phoneOff, busy, declined, f503, f404 }, r, new Set(), from, to, PRICES.outbound);
  return out;
}

const recipientCache = new Map();
/** The recipient list of a campaign with the status of each recipient right now. */
function recipientsOf(c) {
  const run = RUNS.get(c.id);
  if (c.list && (run && c.status !== 'draft' && c.status !== 'scheduled')) {
    return c.list.map((x, i) => runRecipient(run, x, i));
  }
  if (c.list) return c.list.map((x) => ({ phone: x.phone, n: x.n, status: c.status === 'canceled' ? 'canceled' : 'queued', attempt: 0, at: null, sec: 0, credits: 0 }));
  const sig = `${c.id}:${c.status}:${(store.get('calls') || []).length > 0}`;
  if (recipientCache.has(sig)) return applyStop(c, recipientCache.get(sig));
  let list;
  if (c.id === 'bc_01JBK7C1Q2') list = buildC1(c);
  // Completed samples answer at ≈ 55 %; transferred calls carry the extra billed minutes, so credits stay as billed.
  else if (c.id === 'bc_01JBJ9HC2W') list = buildFromResult(c, { answered: 226, keys: c.keysPressed, billedMin: 226, transferKey: null, noAnswer: 146, busy: 22, declined: 6, f503: 4, f404: 6, from: onDay('2026-10-26', '10:00'), to: onDay('2026-10-26', '11:42') });
  else if (c.id === 'bc_01JBHD26OC') list = buildFromResult(c, { answered: 386, keys: { 1: 272, 2: 37, 9: 5, none: 72 }, billedMin: 624, transferKey: '2', noAnswer: 186, phoneOff: 30, busy: 48, declined: 12, f503: 14, f404: 20, from: onDay('2026-10-26', '12:30'), to: onDay('2026-10-26', '15:10') });
  else if (c.id === 'bc_01JBFD24OC') list = buildFromResult(c, { answered: 350, keys: { 1: 247, 2: 34, 9: 4, none: 65 }, billedMin: 515, transferKey: '2', noAnswer: 171, phoneOff: 25, busy: 40, declined: 8, f503: 10, f404: 15, from: onDay('2026-10-24', '12:30'), to: onDay('2026-10-24', '14:58') });
  else {
    const r = rng(hash(c.id));
    const used = new Set();
    list = Array.from({ length: c.toCall || 0 }, () => ({ phone: phoneGen(r, used), n: Math.floor(r() * NAMES.length), status: 'queued', attempt: 0, at: null, sec: 0, credits: 0 }));
  }
  recipientCache.set(sig, list);
  return applyStop(c, list);
}
/** A stopped campaign: recipients that were still waiting are not called. */
const applyStop = (c, list) => (c.status === 'canceled' ? list.map((x) => (x.status === 'queued' ? { ...x, status: 'canceled' } : x)) : list);

// ---------- sample audience (flu_vaccine_nov.csv, generated in memory) ----------
const SAMPLE_FILE = 'flu_vaccine_nov.csv';
const SAMPLE_ROWS = 2000;
const SAMPLE_DUP = 86;
const SAMPLE_DNC = 40;
const SAMPLE_SHARED = 38; // people with two numbers in the sample list (person_id column)
let sampleCache = null;
function sampleAudience() {
  if (sampleCache) return sampleCache;
  const r = rng(20261102);
  const used = new Set(['081-xxx-4821']);
  const rows = [];
  const dates = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'];
  const times = ['09:00', '09:30', '10:00', '10:30', '11:00', '13:30', '14:00', '14:30', '15:00', '16:00'];
  rows.push({ row: 1, phone: '081-xxx-4821', n: 0, date: '2026-11-02', time: '10:30', problem: null });
  for (let i = 2; i <= SAMPLE_ROWS - SAMPLE_DUP - SAMPLE_DNC; i++) rows.push({ row: 0, phone: phoneGen(r, used), n: 8 + Math.floor(r() * 16), date: dates[Math.floor(r() * 5)], time: times[Math.floor(r() * 10)], problem: null });
  // Optional person_id column: SAMPLE_SHARED people have a second number in the list (the row right after theirs).
  // A separate random stream, so the numbers and names above stay exactly as before.
  rows.forEach((x, i) => { x.pid = `P-${10001 + i}`; });
  const rp = rng(20261210);
  const second = new Set([2]); // rows 2 and 3 of the file: one person, two numbers (visible in the preview)
  for (let guard = 0; second.size < SAMPLE_SHARED && guard < 10000; guard++) {
    const i = 2 + Math.floor(rp() * (rows.length - 2));
    if (!second.has(i) && !second.has(i - 1) && !second.has(i + 1)) second.add(i);
  }
  for (const i of second) Object.assign(rows[i], { pid: rows[i - 1].pid, n: rows[i - 1].n, date: rows[i - 1].date, time: rows[i - 1].time });
  const clean = rows.slice();
  const dnc = Array.from({ length: SAMPLE_DNC }, (_, i) => ({ row: 0, phone: i < 2 ? [...DNC_SET][i] : phoneGen(r, used), n: 8 + Math.floor(r() * 16), date: dates[i % 5], time: times[i % 10], problem: 'dnc', pid: `P-${30001 + i}` }));
  const dups = Array.from({ length: SAMPLE_DUP }, () => { const src = clean[1 + Math.floor(r() * (clean.length - 1))]; return { ...src, row: 0, problem: 'duplicate' }; });
  const extra = shuffle([...dnc, ...dups], r);
  // Mix the problem rows into the file (never before row 1).
  for (const x of extra) rows.splice(1 + Math.floor(r() * rows.length), 0, x);
  rows.forEach((x, i) => { x.row = i + 1; });
  sampleCache = { file: SAMPLE_FILE, source: 'sample', rows, total: rows.length, duplicates: SAMPLE_DUP, dnc: SAMPLE_DNC, invalid: 0, toCall: rows.filter((x) => !x.problem).length, people: peopleOf(rows), columns: COLUMNS };
  return sampleCache;
}
/** People in the rows that will be called (person_id column), or null when the list has no person_id. */
function peopleOf(rows) {
  const call = rows.filter((x) => !x.problem);
  if (!call.length || !call.some((x) => x.pid)) return null;
  return new Set(call.map((x) => x.pid || `#${x.phone}`)).size;
}

/** Paste box: one number per line → the same summary as a file (only the phone column). */
function parsePaste(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const seen = new Set();
  const rows = lines.map((raw, i) => {
    const compact = raw.replace(/[\s().-]/g, '');
    const masked = /^0\d{1,2}x{3}\d{3,4}$/i.test(compact);
    const full = /^(\+66|0)\d{8,9}$/.test(compact);
    let phone = raw;
    if (full) { const d = compact.replace(/^\+66/, '0'); phone = `${d.slice(0, 3)}-xxx-${d.slice(-4)}`; }
    else if (masked) phone = `${compact.slice(0, 3)}-xxx-${compact.slice(-4)}`;
    let problem = null;
    if (!full && !masked) problem = 'invalid';
    else if (seen.has(phone)) problem = 'duplicate';
    else if (DNC_SET.has(phone)) problem = 'dnc';
    seen.add(phone);
    return { row: i + 1, phone, n: null, date: null, time: null, problem, raw };
  });
  const count = (p) => rows.filter((x) => x.problem === p).length;
  return { file: null, source: 'paste', rows, total: rows.length, duplicates: count('duplicate'), dnc: count('dnc'), invalid: count('invalid'), toCall: rows.filter((x) => !x.problem).length, columns: ['phone'] };
}

// ---------- message script ----------
const sampleVars = (lang) => ({ name: tIn(lang, 'campaigns.sample.name'), date: tIn(lang, 'campaigns.sample.date'), time: tIn(lang, 'campaigns.sample.time'), clinic: CLINIC[lang] || CLINIC.en, slot: tIn(lang, 'campaigns.sample.slot') });
const builtinText = (lang, kind = 'reminder') => tIn(lang, `campaigns.script.${kind}.text`);
const fillVars = (text, vars) => String(text).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
const varsIn = (text) => [...new Set([...String(text || '').matchAll(/\{(\w+)\}/g)].map((m) => m[1]))];
/** Thai polite particle must follow the voice: female → ค่ะ / คะ, male → ครับ. */
function genderIssue(lang, gender, text) {
  if (lang !== 'th') return null;
  if (gender === 'female' && /ครับ/.test(text)) return 'female';
  if (gender === 'male' && /ค่ะ|คะ/.test(text)) return 'male';
  return null;
}
const fixParticles = (gender, text) => (gender === 'female' ? String(text).replace(/ครับ/g, 'ค่ะ') : String(text).replace(/ค่ะ|คะ/g, 'ครับ'));
/** Rough message length for the estimate: built-in scripts use the measured length, edited ones the TTS estimate. */
function messageSeconds(w) {
  if (w.mode === 'audio') return w.audioFile && w.audioFile.sec ? Math.round(w.audioFile.sec) : 30;
  if (w.text == null) return w.kind === 'pickup' ? 15 : w.kind === 'delivery' ? 22 : w.lang === 'zh' ? 24 : w.lang === 'en' ? 27 : 26;
  const ms = TTS ? TTS.estimateMs(fillVars(w.text, sampleVars(w.lang)), w.lang, w.rate || 1) : 26000;
  return Math.max(5, Math.round(ms / 1000));
}

// ---------- cost estimate (listed prices, then the account's rates) ----------
/**
 * An estimate worked out at the listed prices → at the account's rates, priced the way the run is charged
 * (actions.minutesCost / chargeCalls). Without a plan the listed figures come back unchanged. On a plan: credits at
 * the plan rate, plus the minutes (maxMin / expMin) and what the plan minutes cover (cMax / cExp: { credits, plan:
 * { left, fromPlan, over }, charge }). perMin: the listed price a minute the figures were made at (+ premium voice).
 */
function atAccountRate({ max, expected }, perMin, premium) {
  const maxMin = max == null ? null : max / perMin;
  const expMin = perMin ? (expected || 0) / perMin : 0;
  const cExp = minutesCost(expMin, { premium });
  if (!cExp.plan) return { max, expected, maxMin, expMin, cMax: null, cExp: null, onPlan: false, rate: PRICES.outbound };
  const cMax = maxMin == null ? null : minutesCost(maxMin, { premium });
  return { max: cMax ? cMax.credits : null, expected: cExp.credits, maxMin, expMin, cMax, cExp, onPlan: true, rate: cExp.rate };
}
/** "1,874 plan minutes" (long) or "1,874 plan min" (short). */
const planMinText = (ctx, m, short = false) => (short ? ctx.t('plan.minShort', { n: ctx.fmt.int(m) }) : ctx.t('plan.min', { count: Math.round(m), n: ctx.fmt.int(m) }));
/** The credits side of a plan estimate: "0.00 credits while plan minutes last", or the part beyond the plan minutes. */
const planCreditsText = (ctx, c) => (c.plan.over >= 0.5 ? ctx.t('plan.creditsOver', { charge: ctx.fmt.credits2(c.charge), over: ctx.fmt.int(c.plan.over) }) : ctx.t('plan.creditsInside', { charge: ctx.fmt.credits2(c.charge) }));

/** One answer-rate definition everywhere: answered ÷ finished attempts (answered + no answer + busy + failed). */
function answerRate(k) {
  const fin = (k.answered || 0) + (k.noAnswer || 0) + (k.busy || 0) + (k.failed || 0);
  return fin ? (k.answered / fin) * 100 : null;
}
const isTransfer = (a) => a === 'transfer' || a === 'staff';
/** Short date + time in the campaign list: Thai shows the Buddhist year (26 ต.ค. 2569 11:42), as the detail page does. */
let thaiShortFmt = null;
const dtShort = (ctx, d) => {
  if (getLang() !== 'th') return ctx.fmt.dateTime(d);
  if (!thaiShortFmt) thaiShortFmt = new Intl.DateTimeFormat('th-TH', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return thaiShortFmt.format(new Date(d));
};
/** Dates in sentences: Thai shows the Buddhist year. */
const dtProse = (ctx, d, long = false) => ctx.t('dt', { date: ctx.fmt.dateProse(d, long), time: ctx.fmt.timeShort(d) });
/**
 * The paths a call can take through the script: the message alone; the message repeated (at most MAX_REPEATS times);
 * or the message and a transfer to staff. "Up to" is a real ceiling only when every path is bounded, so a transfer
 * without the customer's talk-time limit makes the estimate unbounded (shown as "≈" with a note, never as "up to").
 */
function pathsOf({ sec, actions, transferMin }) {
  const baseSec = sec + 2;
  const hasRepeat = actions.includes('repeat');
  const hasTransfer = actions.some(isTransfer);
  const capMin = Number(transferMin) || 0;
  const unbounded = hasTransfer && !capMin;
  const maxSec = Math.max(baseSec, hasRepeat ? sec * (1 + MAX_REPEATS) + 2 : 0, hasTransfer && capMin ? baseSec + capMin * 60 : 0);
  return { baseSec, maxSec, hasRepeat, hasTransfer, hasSms: actions.includes('sms-link'), capMin, unbounded };
}
/** The last completed campaign of the same sub-account: its answer rate, credits per answered call and key shares. */
function lastSimilar(subId) {
  const done = (store.get('campaigns') || []).filter((c) => c.status === 'completed' && (c.result || c.progress));
  const same = done.find((c) => c.sub === subId) || done[0];
  if (!same) return { pct: 55, name: null, avg: null, c: null };
  const k = countsOf(same);
  const pct = Math.round((answerRate(k) || 0) * 10) / 10;
  // Credits per answered call at the listed price: from its billed minutes when known (a campaign run on a plan was
  // charged at the plan rate), else from its credits (the samples were billed at the listed price).
  const listed = same.billedMin != null ? same.billedMin * PRICES.outbound : same.credits;
  return { pct, name: same.name, avg: k.answered && same.credits ? listed / k.answered : null, c: same, k };
}
function estimateFor(w, subId) {
  const toCall = w.audience ? w.audience.toCall : 0;
  const sec = messageSeconds(w);
  const p = pathsOf({ sec, actions: w.keys.map((k) => k.action), transferMin: w.transferMin });
  const minutes = billedMinutes(p.baseSec);
  const maxMinutes = billedMinutes(p.maxSec);
  const premium = w.voice === 'premium';
  // The listed price a minute: the estimate is worked out at it, and the run prices each attempt at it too —
  // chargeCalls() re-prices at the plan rate on a plan (atAccountRate below does the same for the estimate).
  const perMin = PRICES.outbound + (premium ? PRICES.premiumVoice : 0);
  const perCall = round2(minutes * perMin);
  const perCallMax = round2(maxMinutes * perMin);
  const max = p.unbounded ? null : round2(toCall * perCallMax);
  const last = lastSimilar(subId);
  // Expected: the answer rate of the last similar campaign; when calls can run longer (transfer, repeat), its real
  // credits per answered call too (scaled to this campaign's per-minute price, never above the ceiling).
  const useAvg = (p.hasTransfer || p.hasRepeat) && last.avg;
  const scaled = useAvg ? Math.max(perCall, round2(last.avg * perMin / PRICES.outbound)) : perCall;
  const perAnswered = p.unbounded ? scaled : Math.min(perCallMax, scaled);
  const rawExpected = round2(toCall * (last.pct / 100) * perAnswered);
  const listExpected = max == null ? rawExpected : Math.min(max, rawExpected);
  // At the account's rates: unchanged without a plan; on a plan the plan rate, with the minutes from the plan minutes.
  const acc = atAccountRate({ max, expected: listExpected }, perMin, premium);
  const expected = acc.expected;
  // "head": the usage the confirmation, the button and the daily-limit check use — the ceiling, or ≈ expected
  // without one. "headCharge": what it takes from the balance (prepaid) or adds to the invoice (postpaid) — on a
  // plan only the minutes beyond the plan minutes and the premium voice.
  const head = acc.max == null ? expected : acc.max;
  const headCharge = acc.onPlan ? (acc.cMax || acc.cExp).charge : head;
  // SMS links: one per answered call at most; expected from the last campaign's share of that key.
  const smsKey = (w.keys.find((k) => k.action === 'sms-link') || {}).key;
  const lastShare = smsKey && last.c && last.c.keys && last.c.keys[smsKey] === 'sms-link' && last.k && last.k.keys && last.k.answered ? (last.k.keys[smsKey] || 0) / last.k.answered : null;
  const smsMax = smsKey ? toCall : 0;
  const smsExpected = smsKey && lastShare != null ? Math.round(toCall * (last.pct / 100) * lastShare) : null;
  // Fallback after the last retry: one SMS / LINE message to each number that ends as "No answer". Worst case every
  // number; expected from the last similar campaign's no-answer share. Counted, never priced (no published SMS rate).
  const fb = w.fb ? (w.fbChannel || 'sms') : null;
  const lastFin = last.k ? (last.k.answered || 0) + (last.k.noAnswer || 0) + (last.k.busy || 0) + (last.k.failed || 0) : 0;
  const noAnsShare = lastFin ? (last.k.noAnswer || 0) / lastFin : Math.max(0, 1 - last.pct / 100) * 0.6;
  const fbMax = fb ? toCall : 0;
  const fbExpected = fb ? Math.round(toCall * noAnsShare) : 0;
  // "Send an SMS first": one SMS to every number before its first call. Counted, never priced (as above).
  const preSms = w.preSms ? toCall : 0;
  const people = w.audience && w.audience.people != null ? w.audience.people : null;
  const bal = balance();
  const usedToday = store.get('mode') === 'active' ? ((usageToday() || {}).total || 0) : 0; // = Billing › Used today
  const daily = store.get('limits.daily') || 0;
  const chargeExp = acc.onPlan ? acc.cExp.charge : expected;
  const chargeMax = max == null ? null : acc.onPlan ? acc.cMax.charge : max;
  const avgAt = (v) => (acc.onPlan ? (v / perMin) * (acc.rate + (premium ? PRICES.premiumVoice : 0)) : v); // credits per answered call at the account's rate
  return { toCall, sec, minutes, maxMinutes, paths: p, perMin, perCall, perCallMax, max: acc.max, expected, listMax: max, listExpected, maxMin: acc.maxMin, expMin: acc.expMin, onPlan: acc.onPlan, rate: acc.rate, cMax: acc.cMax, cExp: acc.cExp, premium,
    usedAvg: !!useAvg && perAnswered > perCall, avg: useAvg ? round2(avgAt(perAnswered)) : null, smsMax, smsExpected, fb, fbMax, fbExpected, preSms, people, pct: last.pct, lastName: last.name, head, headCharge, unbounded: p.unbounded,
    balanceAfter: round2(bal - chargeExp), balanceAfterMax: chargeMax == null ? null : round2(bal - chargeMax), usedToday, daily, dailyAfter: round2(usedToday + head),
    short: headCharge > bal ? Math.ceil((headCharge - bal) / 100) * 100 : 0, overDaily: daily && usedToday + head > daily, plan: comparePlans(toCall * minutes) };
}

// ---------- the run engine (module level: a campaign keeps calling while you look at other screens) ----------

const RUNS = new Map();
let TTS = null; // ui.audio.tts, captured on mount (length estimates for edited scripts)
const runListeners = new Set();
let RT = null; // { t, ui } captured at launch so the finish toast speaks the current language anywhere
const emit = (kind, cid) => { for (const fn of Array.from(runListeners)) { try { fn(kind, cid); } catch (e) { console.error(e); } } };

function outcomeOrder(total, seed, pct = 55) {
  // The run answers at the estimate's rate (the last similar campaign), so the result matches the estimate.
  // C4 with the sample list: 55.1% (C2) → 1,033 answered · 657 no answer (35.1%) · 122 busy (6.5%) · 62 failed (3.3%);
  // keys 1 79% · 2 15.8% · 9 0.8% · none 4.5%.
  const answered = Math.min(total, Math.round(total * (Number(pct) || 0) / 100));
  const busy = Math.min(total - answered, Math.round(total * 0.065));
  const failed = Math.min(total - answered - busy, Math.round(total * 0.033));
  const noAnswer = total - answered - busy - failed;
  const k2 = Math.round(answered * 0.158);
  const k9 = Math.round(answered * 0.008);
  const kn = Math.round(answered * 0.045);
  const k1 = answered - k2 - k9 - kn;
  const r = rng(seed);
  const keys = shuffle([...Array(k1).fill('1'), ...Array(k2).fill('2'), ...Array(k9).fill('9'), ...Array(kn).fill(null)], r);
  const cats = shuffle([...Array(answered).fill('completed'), ...Array(noAnswer).fill('noAnswer'), ...Array(busy).fill('busy'), ...Array(failed).fill('f503')], r);
  let ki = 0;
  return cats.map((cat) => ({ cat, key: cat === 'completed' ? keys[ki++] : null, sec: cat === 'completed' ? 19 + Math.floor(r() * 21) : 0 }));
}

/**
 * What one attempt costs in the run at the listed price (run.perMin): transferred calls add talk time (capped),
 * repeats replay the message. settle() charges it like any call (chargeCalls: the plan rate and the plan minutes on
 * a plan) and keeps what was charged per recipient in run.cr.
 */
function attemptCost(run, o, i) {
  if (o.cat !== 'completed') return { sec: 0, billed: 0, credits: 0, act: null };
  const act = o.key ? run.actions[o.key] || null : null;
  let extra = 0;
  if (isTransfer(act)) extra = run.transferMin ? Math.min(run.transferMin * 60, 45 + ((i * 53) % 190)) : 45 + ((i * 53) % 190);
  else if (act === 'repeat' && i % 2) extra = run.msgSec;
  const billed = extra ? billedMinutes(run.baseSec + extra) : run.minutes;
  return { sec: o.sec + extra, billed, credits: round2(billed * run.perMin), act };
}
function reasonOf(run, o, act) {
  if (o.cat !== 'completed') return { key: o.cat === 'noAnswer' ? 'noAnswerSim' : o.cat === 'busy' ? 'busySim' : 'net503Sim' };
  if (!o.key) return { key: 'noKey' };
  if (act === 'confirm') return { key: run.kind === 'delivery' ? 'keyConfirm' : 'apptConfirmed' };
  if (act === 'sms-link') return { key: 'smsLinkSent' };
  if (act === 'opt-out') return { key: 'optOut' };
  if (isTransfer(act)) return { key: 'staffTransfer', vars: { key: o.key } };
  if (act === 'repeat') return { key: 'repeatPressed', vars: { key: o.key } };
  return { key: 'noKey' };
}

// Retries (step 3: "N retries, M min apart"). Every recipient's final outcome is fixed at launch (outcomeOrder), so the
// totals reconcile with the estimate; some numbers that end as answered pick up only on try 2, 3 or 4, and numbers
// that end as no answer / busy / network failure are tried 1 + N times. The demo dials the first try in about 45 s
// and compresses each M-minute wait into RETRY_GAP_MS — the detail page says so, with the real-pace times.
const RETRY_GAP_MS = 5000;
const RETRY_TICKS = 16;
const RETRY_ANSWER = [0, 0.104, 0.041, 0.015]; // share of the answered numbers that pick up on try 2 · 3 · 4
function retryPlan(order, retries, seed) {
  const r = rng(seed ^ 0x5bd1e995);
  const ans = order.map((o) => (o.cat === 'completed' ? 1 : 0)); // the try a number is answered on (0 = never)
  const answered = shuffle(order.map((o, i) => (o.cat === 'completed' ? i : -1)).filter((i) => i >= 0), r);
  let p = 0;
  for (let a = 2; a <= 1 + retries; a++) {
    const n = Math.round(answered.length * (RETRY_ANSWER[a - 1] || 0));
    for (let j = 0; j < n && p < answered.length; j++) ans[answered[p++]] = a;
  }
  const interim = order.map(() => (r() < 0.75 ? 'noAnswer' : 'busy')); // how the earlier tries of a late answer ended
  return { ans, interim };
}
/** Tries a number gets: up to the one it is answered on, else 1 + retries. */
const triesOf = (run, i) => (run.ans[i] ? run.ans[i] : run.maxAtt);
/** How try `a` of number i ends. */
const catOf = (run, i, a) => (run.order[i].cat === 'completed' ? (a >= run.ans[i] ? 'completed' : run.interim[i]) : run.order[i].cat);
/** Numbers to call on try `a` (try 1: the whole list in file order). */
function waveQueue(run, a) {
  if (a === 1) return run.order.map((_, i) => i);
  if (a > run.maxAtt) return [];
  const q = [];
  for (let i = 0; i < run.total; i++) if (run.att[i] === a - 1 && run.cat[i] !== 'completed' && triesOf(run, i) >= a) q.push(i);
  return q;
}
/** Real-pace length of the whole run (first try + each wait and retry), from the first try's expected length. */
function realRunMs(run) {
  let ms = run.firstPassMs;
  let left = run.order.map((_, i) => i);
  for (let a = 2; a <= run.maxAtt; a++) {
    left = left.filter((i) => catOf(run, i, a - 1) !== 'completed' && triesOf(run, i) >= a);
    if (!left.length) break;
    ms += run.wait * 60000 + run.firstPassMs * (left.length / run.total);
  }
  return ms;
}

function runRecipient(run, x, i) {
  const base = { phone: x.phone, n: x.n };
  if (run.fly[i]) return { ...base, status: i % 3 === 0 ? 'in-progress' : 'ringing', attempt: run.wave, at: run.dialAt[i] || nowMs(), sec: 0, credits: 0 };
  if (run.att[i] > 0) {
    const cat = run.cat[i];
    const oc = OUTCOME[cat];
    const answered = cat === 'completed';
    const o = run.order[i];
    const cost = answered ? attemptCost(run, o, i) : { sec: 0, credits: 0, act: null };
    const more = !answered && run.att[i] < triesOf(run, i) && !run.stopped;
    const last = !answered && !more;
    return { ...base, status: oc.status, sip: oc.sip, q850: oc.q850, attempt: run.att[i], at: run.lastAt[i], key: answered ? o.key : null, sec: cost.sec, credits: answered && run.cr[i] != null ? run.cr[i] : cost.credits,
      transferred: isTransfer(cost.act), optedOut: cost.act === 'opt-out', callId: run.callIds[i], retryIn: more ? run.wait : null,
      fbSent: run.fallback && last && !run.stopped && cat === 'noAnswer' ? run.fallback : null };
  }
  return { ...base, status: run.stopped ? 'canceled' : 'queued', attempt: 0, at: null, sec: 0, credits: 0 };
}

function runCounts(run) {
  const c = { dialled: run.dialled, finished: 0, answered: 0, noAnswer: 0, busy: 0, failed: 0, inProgress: 0, queued: 0, retrying: 0, keys: { 1: 0, 2: 0, 9: 0, none: 0 } };
  for (let i = 0; i < run.total; i++) {
    if (run.fly[i]) { c.inProgress++; continue; }
    if (!run.att[i]) { c.queued++; continue; }
    const cat = run.cat[i];
    c.finished++;
    if (cat === 'completed') { c.answered++; c.keys[run.order[i].key || 'none']++; } else {
      if (cat === 'noAnswer') c.noAnswer++; else if (cat === 'busy') c.busy++; else c.failed++;
      if (run.att[i] < triesOf(run, i) && !run.stopped) c.retrying++;
    }
  }
  return c;
}

function startRun(c, { est, ui, t }) {
  RT = { ui, t };
  const total = c.list.length;
  const order = outcomeOrder(total, hash(c.id) ^ total, est.pct);
  const retries = Math.max(0, Math.min(3, Number(c.retries) || 0));
  const plan = retryPlan(order, retries, hash(c.id));
  const firstPassMs = c.expectedFinish && c.startedAt ? Math.max(60000, Date.parse(c.expectedFinish) - Date.parse(c.startedAt)) : 60000;
  const run = {
    id: c.id, total, order, ans: plan.ans, interim: plan.interim, maxAtt: 1 + retries, wait: Number(c.retryAfterMin) || 30, firstPassMs,
    att: new Array(total).fill(0), cat: new Array(total).fill(null), lastAt: [], dialAt: [], fly: new Uint8Array(total), callIds: [], cr: [],
    wave: 1, queue: null, nextQueue: null, qd: 0, qf: 0, phase: 'dial', waitUntil: 0, dialledTries: 0, plannedTries: 0,
    // spent / due: usage credits at the account's rates · charged: credits charged now · planMin: minutes from the plan minutes
    dialled: 0, paused: false, stopped: false, spent: 0, due: 0, billed: 0, charged: 0, planMin: 0,
    timer: null, step: Math.max(1, Math.ceil(total / RUN_TICKS)), conc: Math.min(c.concurrent || 20, 20), sub: c.sub, callerId: c.callerId,
    minutes: est.minutes, perMin: est.perMin, msgSec: est.sec, baseSec: est.sec + 2, transferMin: Number(c.transferMin) || 0, actions: c.keys || {}, kind: (c.script && c.script.kind) || 'reminder',
    fallback: c.fallback ? c.fallback.channel || 'sms' : null, preSms: !!c.preSms, realStart: Date.now(), // real time, only to say how long the demo took
  };
  run.queue = waveQueue(run, 1);
  for (let i = 0; i < total; i++) run.plannedTries += triesOf(run, i);
  // The expected finish at the real pace includes the retries (each wait plus calling the numbers again).
  const realEnd = Date.parse(c.startedAt || new Date(nowMs()).toISOString()) + realRunMs(run);
  updateCamp(c.id, (x) => ({ ...x, expectedFinish: new Date(realEnd).toISOString(), retries, retryAfterMin: run.wait }));
  RUNS.set(c.id, run);
  run.timer = setInterval(() => tick(run), TICK_MS);
  emit('state', c.id);
  return run;
}

function tick(run) {
  const c = findCamp(run.id);
  if (!c) return; // another demo view is showing; carry on when it comes back
  if (c.status === 'draft' || c.status === 'scheduled') { clearInterval(run.timer); RUNS.delete(run.id); return; }
  if (run.stopped) { settle(run, c, run.qd); clearInterval(run.timer); emit('state', run.id); return; }
  if (c.status !== 'running' && c.status !== 'paused') { clearInterval(run.timer); return; }
  if (run.paused || c.status === 'paused') {
    // Paused: no new calls start (a waiting retry waits longer), and the calls already ringing or talking finish.
    if (run.phase === 'wait') { run.waitUntil += TICK_MS; return; }
    if (run.qf < run.qd) afterSettle(run, settle(run, c, run.qd));
    return;
  }
  if (run.phase === 'wait') {
    if (Date.now() < run.waitUntil) return;
    // The wait is over: call the numbers that are still not answered again (try run.wave + 1).
    run.wave += 1;
    run.queue = run.nextQueue;
    run.nextQueue = null;
    run.qd = 0; run.qf = 0; run.phase = 'dial';
    run.step = Math.max(run.step, Math.ceil(run.queue.length / RETRY_TICKS)); // a retry round plays in about 8 s
    updateCamp(c.id, (x) => ({ ...x, retry: { attempt: run.wave, of: run.maxAtt, n: run.queue.length, waiting: false } }));
    emit('state', run.id);
    return;
  }
  const now = nowMs();
  const n = run.queue.length;
  if (run.qd < n) {
    const next = Math.min(n, run.qd + run.step);
    for (let j = run.qd; j < next; j++) { const i = run.queue[j]; run.dialAt[i] = now; run.fly[i] = 1; }
    run.dialledTries += next - run.qd;
    run.qd = next;
    if (run.wave === 1) run.dialled = run.qd;
  }
  const target = run.qd >= n ? n : Math.max(run.qf, run.qd - Math.min(run.conc - 4, run.step * 2));
  afterSettle(run, settle(run, c, target));
}

/** After a tick: carry on, wait for the next retry, or finish (only after the last retry). */
function afterSettle(run, counts) {
  if (run.qf < run.queue.length) { emit('tick', run.id); return; }
  const next = run.stopped ? [] : waveQueue(run, run.wave + 1);
  if (!next.length) { finishRun(run, counts); return; }
  run.phase = 'wait';
  run.nextQueue = next;
  run.waitUntil = Date.now() + RETRY_GAP_MS;
  updateCamp(run.id, (x) => ({ ...x, retry: { attempt: run.wave + 1, of: run.maxAtt, n: next.length, waiting: true } }));
  emit('state', run.id);
}

/**
 * Finish the tries of this round up to queue position `target`: they land in Logs (newest first) and answered calls
 * are charged the way every call is (actions.chargeCalls — on a plan the plan rate, from the plan minutes first).
 */
function settle(run, c, target) {
  const before = run.qf;
  const now = nowMs();
  run.qf = Math.max(run.qf, Math.min(target, run.qd));
  const recs = [];
  const who = []; // recipient index of each record in recs
  for (let j = before; j < run.qf; j++) {
    const i = run.queue[j];
    const a = run.wave;
    const cat = catOf(run, i, a);
    const oc = OUTCOME[cat];
    const x = c.list[i];
    const cid = newId('call');
    const answered = cat === 'completed';
    const o = answered ? run.order[i] : { cat, key: null, sec: 0 };
    const cost = attemptCost(run, o, i);
    const why = reasonOf(run, o, cost.act);
    run.callIds[i] = cid; run.att[i] = a; run.cat[i] = cat; run.lastAt[i] = run.dialAt[i] || now; run.fly[i] = 0;
    run.billed += cost.billed;
    who.unshift(i);
    recs.unshift({
      id: cid, ts: new Date(run.lastAt[i]).toISOString(), env: store.get('env'), direction: 'outbound', kind: 'outbound', source: { type: 'campaign', ref: c.id }, sub: c.sub,
      from: c.callerId, to: x.phone, status: oc.status, sip: oc.sip, q850: oc.q850, sec: cost.sec, billedMin: cost.billed, pddMs: 2000 + (i % 9) * 110,
      keys: o.key, recorded: false, transcribed: false, route: 'primary', credits: cost.credits, byCampaignRun: true, attempt: a,
      reasonKey: why.key, reasonVars: why.vars,
      reason: { en: answered ? 'Answered' : oc.status },
    });
  }
  if (recs.length) {
    // In call order, so the plan minutes run out (if they do) at the right call. Re-prices the records in place.
    const bill = chargeCalls(recs.slice().reverse());
    run.charged = round2(run.charged + bill.charge);
    run.planMin += bill.planMinutes;
    recs.forEach((rec, j) => { run.cr[who[j]] = rec.credits; run.due = round2(run.due + (rec.credits || 0)); });
    store.set('calls', [...recs, ...(store.get('calls') || [])]);
  }
  if (store.get('env') === 'live') run.spent = run.due;
  const counts = runCounts(run);
  const pct = Math.min(100, Math.round((run.dialledTries / Math.max(1, run.plannedTries)) * 100));
  updateCamp(c.id, (x) => ({ ...x, progressPct: pct, progress: { dialled: counts.dialled, answered: counts.answered, noAnswer: counts.noAnswer, busy: counts.busy, failed: counts.failed, inProgress: counts.inProgress, queued: counts.queued, retriesWaiting: counts.retrying }, keysPressed: counts.keys, credits: run.spent, billedMin: run.billed, charged: run.charged, planMin: run.planMin }));
  return counts;
}

function finishRun(run, counts) {
  clearInterval(run.timer);
  const answeredPct = Math.round((answerRate(counts) || 0) * 10) / 10;
  // The demo plays the first try in about 45 s and each wait in a few seconds: the finish is the demo clock's time,
  // and the detail page says how long the demo took and when a real run would have ended.
  const demoRunSec = Math.max(1, Math.round((Date.now() - run.realStart) / 1000));
  updateCamp(run.id, (x) => ({ ...x, status: 'completed', finishedAt: new Date(nowMs()).toISOString(), realFinish: x.expectedFinish || null, triesRun: run.wave, demoRunSec, progressPct: 100, retry: null,
    result: { answered: counts.answered, answeredPct, noAnswer: counts.noAnswer, busy: counts.busy, failed: counts.failed, fallbackSent: run.fallback ? counts.noAnswer : undefined, preSmsSent: run.preSms ? run.dialled : undefined }, balanceAfter: balance() }));
  const c = findCamp(run.id);
  audit('campaign.finished', { answered: counts.answered, credits: run.spent, tries: run.wave }, run.id);
  notify('campaignFinished', { vars: { campaign: run.id, pct: Math.round(answeredPct) }, href: `campaigns/${run.id}` });
  emit('state', run.id);
  if (RT && c) {
    const { ui, t } = RT;
    // One Export CSV per page: the campaign page has it in its header, so the toast only links there from elsewhere.
    const here = location.hash.startsWith(`#/campaigns/${run.id}`);
    ui.toast(t('campaigns.toastDone', { name: loc(c.name), rate: FMT.pct(answeredPct) }), {
      kind: 'success', ...(here ? {} : { action: { label: t('campaigns.viewCampaign'), onClick: () => { location.hash = `#/campaigns/${run.id}`; } } }),
    });
  }
}

function updateCamp(cid, fn) {
  store.update('campaigns', (list) => (list || []).map((x) => (x.id === cid ? fn(x) : x)));
}

// ---------- CSV ----------
const REASON_OF = (r, t) => {
  if (r.status === 'completed') return r.key === '1' ? t('campaigns.reason.k1') : r.key === '2' ? (r.transferred ? t('campaigns.reason.k2t') : t('campaigns.reason.k2s')) : r.key === '9' ? t('campaigns.reason.k9') : t('campaigns.reason.none');
  if (r.status === 'no-answer') return r.q850 === 20 ? t('campaigns.reason.off') : t('campaigns.reason.noAnswer');
  if (r.status === 'busy') return r.sip === 603 ? t('campaigns.reason.declined') : t('campaigns.reason.busy');
  if (r.status === 'failed') return r.sip === 404 ? t('campaigns.reason.f404') : t('campaigns.reason.f503');
  if (r.status === 'canceled') return t('campaigns.reason.stopped');
  if (r.status === 'queued') return t('campaigns.reason.queued');
  return t('campaigns.reason.live');
};
function exportRecipients(c, { t, ui }, rowsIn) {
  if (!c) return;
  const rows = rowsIn || recipientsOf(c);
  const fmtIso = (ms) => {
    const d = new Date(ms + 7 * 3600000);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}+07:00`;
  };
  ui.csv(`ants-campaign_${c.id}_recipients.csv`, rows, [
    { key: 'phone', label: 'phone' },
    { key: 'name', label: 'name', value: (r) => (r.n == null ? '' : NAMES[r.n % NAMES.length].en) },
    { key: 'status', label: 'status' },
    { key: 'attempt', label: 'attempt' },
    { key: 'last_attempt_at', label: 'last_attempt_at', value: (r) => (r.at ? fmtIso(r.at) : '') },
    { key: 'keys', label: 'keys', value: (r) => r.key || '' },
    { key: 'talk_seconds', label: 'talk_seconds', value: (r) => r.sec || 0 },
    { key: 'credits', label: 'credits', value: (r) => (r.credits || 0).toFixed(2) },
    { key: 'reason_text', label: 'reason_text', value: (r) => REASON_OF(r, t) },
    ...(c.fallback ? [{ key: 'fallback_sent', label: 'fallback_sent', value: (r) => (r.fbSent || (r.status === 'no-answer' && c.status === 'completed' ? c.fallback.channel || 'sms' : '')) }] : []),
    ...(c.preSms ? [{ key: 'sms_before_call', label: 'sms_before_call', value: (r) => (r.attempt || r.status === 'ringing' || r.status === 'in-progress' ? 'sms' : '') }] : []),
  ]);
  return rows.length;
}
/** "Send an SMS first": one SMS per number whose first call has started (null when the option is off). */
function preSmsSent(c, k) {
  if (!c || !c.preSms) return null;
  if (c.result && c.result.preSmsSent != null) return c.result.preSmsSent;
  return (k || countsOf(c)).dialled || 0;
}

// ---------- shared bits ----------
/** "SMS" / "LINE" in the current language. */
const chName = (ctx, ch) => ctx.t(`fb.ch.${ch === 'line' ? 'line' : 'sms'}`);
/** Fallback messages sent so far: one per number that ended as "No answer" (null when the rule is off). */
function fallbackSent(c, k) {
  if (!c || !c.fallback) return null;
  if (c.result && c.result.fallbackSent != null) return c.result.fallbackSent;
  return (k || countsOf(c)).noAnswer || 0;
}
/** Step 3 rule: "If not answered after the last retry → send SMS / LINE" (off by default). */
function fallbackRule(ctx, w) {
  const { t, html: h } = ctx;
  return h`<div class="field cp-fb ${w.fb ? 'is-on' : ''}" data-inv="wc.3.fallback">
    <div class="row cp-fb-head"><div class="grow stack" style="gap:2px"><span class="label" id="cp-fb-l">${t('s3.fb.title')}</span>
      <span class="hint-xs">${w.fb ? (w.retries ? t('s3.fb.whenN', { count: w.retries, n: w.retries, total: w.retries + 1 }) : t('s3.fb.when0')) : t('s3.fb.offH')}</span></div>
      <button type="button" class="toggle" role="switch" data-action="wc.3.fb" aria-checked="${w.fb}" aria-labelledby="cp-fb-l"></button></div>
    ${w.fb ? h`<div class="row cp-fb-ch"><span class="hint-xs">${t('s3.fb.by')}</span><div class="seg seg-sm" role="group" aria-label="${t('s3.fb.by')}">${['sms', 'line'].map((ch) => h`<button type="button" data-action="wc.3.fbch" data-value="${ch}" aria-pressed="${w.fbChannel === ch}">${chName(ctx, ch)}</button>`)}</div></div>
      <span class="hint-xs">${t('s3.fb.what', { channel: chName(ctx, w.fbChannel) })}</span>` : ''}
    <span class="hint-xs cp-fb-price">${t('s3.fb.price')}</span></div>`;
}
/** The SMS text, in the message language: "Example Clinic: we will call you from 02-xxx-1002 …". */
function preSmsText(w) {
  const lang = LANGS[w.lang] ? w.lang : 'en';
  const brand = subOfCid(w.cid) === SUBS.ck ? CLINIC : BRAND;
  return tIn(lang, 'campaigns.s3.pre.text', { brand: brand[lang] || brand.en, cid: w.cid });
}
/** Step 3 option: "Send an SMS first" with the number that will call (off by default). */
function preSmsRule(ctx, w) {
  const { t, html: h } = ctx;
  return h`<div class="field cp-fb cp-pre ${w.preSms ? 'is-on' : ''}" data-inv="wc.3.presms">
    <div class="row cp-fb-head"><div class="grow stack" style="gap:2px"><span class="label" id="cp-pre-l">${t('s3.pre.title')}</span>
      <span class="hint-xs">${w.preSms ? t('s3.pre.onH') : t('s3.pre.offH')}</span></div>
      <button type="button" class="toggle" role="switch" data-action="wc.3.pre" aria-checked="${!!w.preSms}" aria-labelledby="cp-pre-l"></button></div>
    ${w.preSms ? h`<p class="cp-pre-text" lang="${LANGS[w.lang] ? LANGS[w.lang].html : 'en'}">“${preSmsText(w)}”</p>` : ''}
    <span class="hint-xs cp-fb-price">${t('s3.pre.price')}</span></div>`;
}
function statusChip(ctx, c) {
  const { t, html: h, icon } = ctx;
  const map = { draft: ['', 'edit'], scheduled: ['chip-info', 'calendar'], running: ['chip-ok', 'dot'], paused: ['chip-warn', 'pause'], completed: ['chip-navy', 'check-circle'], canceled: ['', 'x-circle'] };
  const [cls, ic] = map[c.status] || ['', 'dot'];
  const label = c.status === 'canceled' && c.stopped ? t('st.stopped') : t(`st.${c.status}`);
  return h`<span class="chip ${cls} cp-st" tabindex="0" data-tip-key="campaigns.stTip.${c.status}">${c.status === 'running' ? h`<span class="dot dot-ok dot-live"></span>` : icon(ic)}${label}</span>`;
}
const pctFmt = (ctx, v) => ctx.fmt.pct(v);
function countsOf(c) {
  const run = RUNS.get(c.id);
  if (run && c.status !== 'draft' && c.status !== 'scheduled') { const k = runCounts(run); return { ...k, total: run.total, credits: run.spent, retries: k.retrying || null }; }
  if (c.progress) { const p = c.progress; return { dialled: p.dialled, answered: p.answered, noAnswer: p.noAnswer, busy: p.busy, failed: p.failed, inProgress: p.inProgress, queued: p.queued, total: c.toCall, credits: c.credits || 0, keys: c.keysPressed, retries: p.retriesWaiting, phoneOff: p.phoneOff, f503: p.failed503, f404: p.failed404 }; }
  if (c.result) {
    const r = c.result;
    const total = c.toCall;
    if (r.noAnswer == null || !c.keysPressed) {
      // Older campaigns keep only their headline result: count the (reconciled) recipient list instead.
      const list = recipientsOf(c);
      const n = (s) => list.filter((x) => x.status === s).length;
      const keys = { 1: 0, 2: 0, 9: 0, none: 0 };
      list.forEach((x) => { if (x.status === 'completed') keys[x.key || 'none']++; });
      return { dialled: total, answered: n('completed'), noAnswer: n('no-answer'), busy: n('busy'), failed: n('failed'), inProgress: 0, queued: 0, total, credits: c.credits || 0, keys };
    }
    return { dialled: total, answered: r.answered, noAnswer: r.noAnswer, busy: r.busy || 0, failed: r.failed || 0, inProgress: 0, queued: 0, total, credits: c.credits || 0, keys: c.keysPressed || null };
  }
  return { dialled: 0, answered: 0, noAnswer: 0, busy: 0, failed: 0, inProgress: 0, queued: c.toCall || 0, total: c.toCall || 0, credits: 0, keys: null };
}
/**
 * A saved campaign's estimate at the account's rates. Stored estimates (and the samples) are at the listed price;
 * atAccountRate turns them into plan-rate credits and plan minutes on a plan, and leaves them as they are otherwise.
 */
function campaignEstimate(c) {
  const p = pathsOf({ sec: c.messageSec || 26, actions: Object.values(c.keys || {}), transferMin: c.transferMin });
  const premium = !!(c.script && c.script.premium);
  const perMin = PRICES.outbound + (premium ? PRICES.premiumVoice : 0);
  const ceiling = p.unbounded ? null : round2((c.toCall || 0) * billedMinutes(p.maxSec) * perMin);
  const seed = c.estimate && c.estimate.expected != null ? c.estimate : null;
  const listed = seed ? { max: ceiling == null ? null : Math.max(seed.max || 0, ceiling), expected: seed.expected }
    : { max: ceiling, expected: round2((c.toCall || 0) * (perMin * billedMinutes(p.baseSec)) * 0.55) };
  return { ...(seed || {}), ...atAccountRate(listed, perMin, premium), paths: p, longest: billedMinutes(p.maxSec) };
}

// ---------- LIST ----------
/** ?status=draft (palette, links) applies once per navigation; afterwards the visitor's own choice is kept. */
function syncListQuery(ctx) {
  if (ctx.state.qParams === ctx.params) return;
  ctx.state.qParams = ctx.params;
  const s = ctx.params.query.status;
  if (s && FILTERS.includes(s)) ctx.state.filter = s;
  if (ctx.params.query.q != null) ctx.state.q = ctx.params.query.q;
}
function listView(ctx) {
  const { t, html: h, fmt, icon } = ctx;
  syncListQuery(ctx);
  const all = ctx.list('campaigns');
  const st = ctx.state;
  const q = (st.q || '').trim().toLowerCase();
  const counts = Object.fromEntries(FILTERS.map((f) => [f, f === 'all' ? all.length : all.filter((c) => FILTER_OF[c.status] === f).length]));
  const rows = all.filter((c) => (st.filter === 'all' || FILTER_OF[c.status] === st.filter) && (!q || LANG_ORDER.some((l) => String((c.name && c.name[l]) || c.name).toLowerCase().includes(q)) || c.id.toLowerCase().includes(q)));
  const head = h`<div class="page-head"><div class="titles"><h1>${t('title')}${ctx.pageHelp()}</h1>
      <span class="sub">${activePlan() ? t('priceLinePlan', { rate: fmt.rate(activePlan().rate) }) : t('priceLine', { rate: fmt.rate(PRICES.outbound) })} <span class="chip chip-warn" tabindex="0" data-tip-key="common.plannedPricesTip">${t('common.plannedPrices')}</span></span></div>
    <div class="tools"><a class="btn btn-primary" href="#/campaigns/new" data-action="cp.new">${icon('plus')}${t('new')}</a></div></div>`;
  if (!all.length) {
    return h`<div class="page cp">${head}<div class="card"><div class="empty cp-empty"><span class="art">${icon('megaphone')}</span>
      <h2>${t('empty.title')}</h2><p class="hint">${t('empty.body')}</p>
      <div class="steps"><div><span class="stepnum">1</span>${t('empty.s1')}</div><div><span class="stepnum">2</span>${t('empty.s2')}</div><div><span class="stepnum">3</span>${t('empty.s3')}</div></div>
      <div class="row"><a class="btn btn-primary" href="#/campaigns/new" data-action="cp.empty.new">${icon('plus')}${t('new')}</a>
      <a class="linkbtn" href="#/help/article/campaign-guide" data-action="cp.empty.guide">${icon('book', 'ico-sm')}${t('empty.guide')}</a></div></div></div></div>`;
  }
  const running = all.find((c) => c.status === 'running');
  return h`<div class="page cp">${head}
    ${running ? h`<a class="card cp-live" href="#/campaigns/${running.id}" data-action="cp.live">${raw('<span class="dot dot-ok dot-live" aria-hidden="true"></span>')}
      <span class="grow"><strong>${loc(running.name)}</strong> <span class="hint">· ${t('live.line', { pct: running.progressPct || 0, dialled: fmt.int(countsOf(running).dialled), total: fmt.int(running.toCall) })}</span></span>
      <span class="progress cp-live-bar" aria-hidden="true"><i style="width:${running.progressPct || 0}%"></i></span>${icon('chevron-right', 'ico-sm')}</a>` : ''}
    <div class="card"><div class="card-head cp-filters">
      <div class="seg" role="group" aria-label="${t('filterAria')}">${FILTERS.map((f) => h`<button type="button" data-action="cp.filter" data-value="${f}" aria-pressed="${st.filter === f}">${t(`filter.${f}`)} <span class="cp-count">${counts[f]}</span></button>`)}</div>
      <label class="cp-search">${icon('search', 'ico-sm')}<input class="input" type="search" data-field="q" value="${st.q || ''}" placeholder="${t('searchPh')}" aria-label="${t('searchPh')}" data-action="cp.search"></label>
    </div>
    ${rows.length ? h`<div class="tbl-wrap"><table class="tbl cp-tbl"><thead><tr><th>${t('col.name')}</th><th>${t('col.status')}</th><th>${t('col.sub')}</th><th class="num">${t('col.recipients')}</th><th class="num">${ctx.term(t('col.answered'), 'answer_rate')}</th><th class="num">${ctx.term(t('col.credits'), 'billing_minute')}</th><th>${t('col.when')}</th><th><span class="sr-only">${t('col.actions')}</span></th></tr></thead>
      <tbody>${rows.map((c) => listRow(ctx, c))}</tbody></table></div>`
      : h`<div class="empty empty-center"><span class="art">${icon('filter')}</span><strong>${t('nores.title')}</strong><span class="hint">${t('nores.body')}</span>
        <button type="button" class="btn btn-sm" data-action="cp.nores.clear">${t('nores.clear')}</button></div>`}
    </div></div>`;
}

function listRow(ctx, c) {
  const { t, html: h, fmt, icon } = ctx;
  const k = countsOf(c);
  const est = campaignEstimate(c);
  const answeredPct = answerRate(k);
  let when;
  if (c.status === 'running' || c.status === 'paused') when = t('when.running', { start: fmt.timeShort(c.startedAt), end: c.expectedFinish ? fmt.timeShort(c.expectedFinish) : '—' });
  else if (c.status === 'scheduled') when = t('when.scheduled', { at: dtShort(ctx, c.scheduledFor) });
  else if (c.status === 'draft') when = t('when.draft', { date: fmt.dayMonth(c.savedAt || nowMs()), name: c.savedBy || '' });
  else when = dtShort(ctx, c.finishedAt || c.canceledAt || c.startedAt || nowMs());
  // Not started yet: the estimate — on a plan in plan minutes (+ the credits beyond them, if any).
  const planned = ['draft', 'scheduled'].includes(c.status);
  const credits = !planned ? fmt.credits2(k.credits || c.credits || 0)
    : est.onPlan ? h`${est.max == null ? t('credits.planAbout', { n: fmt.int(est.expMin) }) : t('credits.planUpTo', { n: fmt.int(est.maxMin) })}${(est.cMax || est.cExp).charge ? h`<span class="hint-xs cp-block">${t('credits.plus', { n: fmt.credits2((est.cMax || est.cExp).charge) })}</span>` : ''}`
    : est.max == null ? t('credits.about', { n: fmt.credits2(est.expected) }) : t('credits.upTo', { n: fmt.credits2(est.max) });
  return h`<tr class="${c.fresh ? 'new-row' : ''}">
    <td class="cp-name"><a href="#/campaigns/${['draft', 'scheduled'].includes(c.status) ? `new?draft=${c.id}` : c.id}" data-action="cp.row" data-value="${c.id}" class="strong">${loc(c.name)}</a>
      <span class="hint-xs mono" translate="no">${c.id}</span></td>
    <td><div class="stack cp-stcell">${statusChip(ctx, c)}${c.status === 'running' || c.status === 'paused' ? h`<span class="progress cp-minibar ${c.status === 'paused' ? 'is-paused' : ''}" role="progressbar" aria-valuenow="${c.progressPct || 0}" aria-valuemin="0" aria-valuemax="100" aria-label="${t('progressAria')}"><i style="width:${c.progressPct || 0}%"></i></span>` : ''}</div></td>
    <td class="nowrap">${ctx.ui.describe.sub(c.sub)}</td>
    <td class="num mono">${fmt.int(c.toCall || 0)}</td>
    <td class="num mono">${answeredPct == null ? '—' : fmt.pct(answeredPct)}</td>
    <td class="num mono nowrap">${credits}</td>
    <td class="hint-xs cp-when">${when}</td>
    <td class="num"><button type="button" class="btn btn-ghost btn-sm btn-icon" data-action="cp.menu" data-value="${c.id}" aria-label="${t('menuAria', { name: loc(c.name) })}" aria-haspopup="menu" aria-expanded="false">${icon('more')}</button></td></tr>`;
}

function openRowMenu(ctx, el) {
  const { t } = ctx;
  const c = findCamp(el.dataset.value);
  if (!c) return;
  const items = [];
  if (c.status === 'running') items.push({ id: 'cp.menu.pause', label: t('menu.pause'), icon: 'pause', onSelect: () => pauseCamp(ctx, c.id) });
  if (c.status === 'paused') items.push({ id: 'cp.menu.resume', label: t('menu.resume'), icon: 'play', onSelect: () => resumeCamp(ctx, c.id) });
  if (c.status === 'scheduled') items.push({ id: 'cp.menu.edit', label: t('menu.editSchedule'), icon: 'calendar', onSelect: () => ctx.go(`campaigns/new?draft=${c.id}&step=3`) });
  items.push({ id: 'cp.menu.duplicate', label: t('menu.duplicate'), icon: 'copy', onSelect: () => duplicate(ctx, c) });
  if (c.status !== 'draft' || c.list) items.push({ id: 'cp.menu.export', label: t('menu.export'), icon: 'download', onSelect: () => doExport(ctx, c) });
  if (['running', 'paused', 'scheduled'].includes(c.status)) items.push({ sep: true }, { id: 'cp.menu.cancel', label: c.status === 'scheduled' ? t('menu.cancelScheduled') : t('menu.stop'), icon: 'x-circle', danger: true, onSelect: () => (c.status === 'scheduled' ? cancelScheduled(ctx, c.id) : stopCamp(ctx, c.id)) });
  ctx.ui.menu(el, items, { label: t('menuAria', { name: loc(c.name) }) });
}

function duplicate(ctx, c) {
  const { t } = ctx;
  const name = typeof c.name === 'object' ? Object.fromEntries(LANG_ORDER.map((l) => [l, tIn(l, 'campaigns.copyName', { name: c.name[l] || c.name.en })])) : t('copyName', { name: c.name });
  const copy = { id: newId('bc'), name, sub: c.sub, callerId: c.callerId, purpose: c.purpose, preset: c.preset || null, preSms: c.preSms || null, people: c.people || null, status: 'draft', savedAt: new Date(nowMs()).toISOString(), savedBy: store.get('user.name'), toCall: c.list ? c.list.length : 0, list: c.list || null, script: c.script || { kind: SCRIPT_OF[c.id] || 'reminder', lang: 'th' }, keys: c.keys, hours: c.hours, retries: c.retries, retryAfterMin: c.retryAfterMin, fallback: c.fallback || null, cps: c.cps, concurrent: c.concurrent, file: c.file || null, rows: c.list ? c.list.length : 0, fresh: true, copyOf: c.id };
  store.update('campaigns', (l) => [copy, ...(l || [])]);
  ctx.ui.toast(t('toast.T03'), { kind: 'success', timeout: 8000, action: { label: t('openDraft'), onClick: () => ctx.go(`campaigns/new?draft=${copy.id}`) } });
}

function doExport(ctx, c, rows) {
  const n = exportRecipients(c, { t: ctx.t, ui: ctx.ui }, rows);
  if (rows) ctx.ui.toast(ctx.t('toast.T05', { n: ctx.fmt.int(n) }), { kind: 'success' });
}

function pauseCamp(ctx, cid) {
  updateCamp(cid, (x) => ({ ...x, status: 'paused', pausedAt: new Date(nowMs()).toISOString() }));
  const run = RUNS.get(cid);
  if (run) run.paused = true;
  audit('campaign.paused', {}, cid);
  ctx.ui.toast(ctx.t('toast.T21'), { kind: 'info' });
  emit('state', cid);
}
function resumeCamp(ctx, cid) {
  updateCamp(cid, (x) => ({ ...x, status: 'running' }));
  const run = RUNS.get(cid);
  if (run) run.paused = false;
  audit('campaign.resumed', {}, cid);
  ctx.ui.toast(ctx.t('toast.T22'), { kind: 'success' });
  emit('state', cid);
}
async function stopCamp(ctx, cid) {
  const { t, fmt } = ctx;
  const c = findCamp(cid);
  if (!c) return;
  const k = countsOf(c);
  const waitingRetries = k.retries || 0;
  const left = k.queued + waitingRetries; // calls that will not be made: numbers not called yet + retries waiting
  const ok = await ctx.ui.confirm({
    title: t('stop.title', { name: loc(c.name) }), danger: true, typed: String(left),
    consequences: [t('stop.c1', { n: fmt.int(k.queued) }), ...(waitingRetries ? [t('stop.cRetry', { n: fmt.int(waitingRetries) })] : []), t('stop.c2', { n: fmt.int(k.inProgress) }), t('stop.c3')],
    confirmLabel: t('stop.yes'), cancelLabel: t('stop.keep'),
  });
  if (!ok) return;
  const run = RUNS.get(cid);
  // A simulated run settles on its next tick: calls in progress finish (and land in Logs), the rest are not made.
  if (run) run.stopped = true;
  updateCamp(cid, (x) => ({ ...x, status: 'canceled', stopped: true, canceledAt: new Date(nowMs()).toISOString(), notCalled: left }));
  audit('campaign.stopped', { notCalled: left }, cid);
  ctx.ui.toast(t('toast.T23', { n: fmt.int(left) }), { kind: 'info' });
  emit('state', cid);
}
async function cancelScheduled(ctx, cid) {
  const { t, fmt } = ctx;
  const c = findCamp(cid);
  if (!c) return;
  const ok = await ctx.ui.confirm({ title: t('cancelSch.title', { name: loc(c.name) }), body: t('cancelSch.body', { at: dtProse(ctx, c.scheduledFor), n: fmt.int(c.toCall) }), danger: true, confirmLabel: t('cancelSch.yes'), cancelLabel: t('cancelSch.keep') });
  if (!ok) return;
  updateCamp(cid, (x) => ({ ...x, status: 'canceled', canceledAt: new Date(nowMs()).toISOString() }));
  audit('campaign.canceled', {}, cid);
  ctx.ui.toast(t('toast.T23', { n: fmt.int(c.toCall) }), { kind: 'info' });
  emit('state', cid);
}

// ---------- WIZARD ----------
function ownedCallerIds() {
  if (env() === 'sandbox' || firstRun() && !(store.get('numbers') || []).some((n) => n.status === 'active')) return [{ number: SANDBOX_CALLER, sub: (store.get('subAccounts') || [])[0]?.id || null, sandbox: true }];
  return (store.get('numbers') || []).filter((n) => n.status === 'active').map((n) => ({ number: n.number, sub: n.sub }));
}
function freshWizard(draft) {
  const cids = ownedCallerIds();
  const clinic = cids.find((x) => x.number === '02-xxx-1002') || cids[0];
  const reached = draft ? (draft.status === 'scheduled' ? STEPS : Math.max(1, Math.min(STEPS, draft.reached || 1))) : 1;
  const base = {
    key: draft ? draft.id : 'new', id: draft ? draft.id : null, step: reached, reached, dirty: false,
    kind: (draft && draft.script && draft.script.kind) || (draft && SCRIPT_OF[draft.id]) || 'reminder',
    name: draft ? draft.name : null, cid: draft ? draft.callerId : (clinic ? clinic.number : SANDBOX_CALLER), purpose: draft ? draft.purpose : 'reminder', consent: false,
    preset: draft ? (draft.preset || (draft.purpose === 'payment' ? 'payment' : 'general')) : 'general', preSms: !!(draft && draft.preSms),
    audience: draft && draft.list ? savedAudience(draft) : null,
    savedFile: draft && !draft.list ? draft.file : null, loading: null, awaiting: null, paste: '', pasteOpen: false, problemsOnly: false,
    mode: 'tts', audioFile: null, text: draft && draft.script && draft.script.text != null ? draft.script.text : null, lang: (draft && draft.script && draft.script.lang) || 'th', voice: (draft && draft.script && draft.script.premium) ? 'premium' : 'standard', gender: 'female', rate: 1,
    keys: draft && draft.keys ? Object.entries(draft.keys).map(([k, a]) => ({ key: k, action: a === 'staff' ? 'transfer' : a })) : [{ key: '1', action: 'confirm' }, { key: '2', action: 'sms-link' }, { key: '9', action: 'opt-out' }],
    start: draft && draft.status === 'scheduled' ? 'schedule' : 'now', date: draft && draft.scheduledFor ? isoDateOf(draft.scheduledFor) : '2026-10-28', time: draft && draft.scheduledFor ? hhmmOf(Date.parse(draft.scheduledFor)) : '10:00',
    hoursFrom: '09:00', hoursTo: '18:00', days: [1, 2, 3, 4, 5, 6], retries: draft && draft.retries != null ? draft.retries : 2, wait: draft && draft.retryAfterMin ? draft.retryAfterMin : 30,
    fb: !!(draft && draft.fallback), fbChannel: (draft && draft.fallback && draft.fallback.channel) || 'sms', // off unless the campaign has the rule
    cps: PRICES.cpsDefault, conc: draft && draft.concurrent ? draft.concurrent : 20, cap: 1, transferMin: (draft && Number(draft.transferMin)) || 0, dnc: 'idle', typed: '', launching: null, playing: false, scheduledStatus: draft ? draft.status : null,
  };
  return base;
}
const isoDateOf = (iso) => { const d = new Date(Date.parse(iso) + 7 * 3600000); return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`; };
/** A saved list (draft or duplicate) as the step 1 summary, person IDs included. */
function savedAudience(draft) {
  const rows = draft.list.map((x, i) => ({ row: i + 1, phone: x.phone, n: x.n, pid: x.pid || null, problem: null }));
  return { file: draft.file, source: 'saved', rows, total: draft.rows || draft.list.length, duplicates: draft.duplicates || 0, dnc: draft.dnc || 0, invalid: 0, toCall: draft.list.length, people: peopleOf(rows), columns: COLUMNS };
}

// ---------- industry presets and calling windows ----------
/** The preset that applies: Payment reminder whenever the purpose is payment; Insurance sales only for marketing. */
function presetOf(w) {
  if (w.purpose === 'payment') return 'payment';
  if (w.preset === 'insurance') return w.purpose === 'marketing' ? 'insurance' : 'general';
  if (w.preset === 'healthcare') return w.purpose === 'marketing' ? 'general' : 'healthcare';
  return 'general';
}
/** Payment reminder and Insurance sales lock the calling window (hours and days). */
const isLocked = (w) => ['payment', 'insurance'].includes(presetOf(w));
/** Marketing calls must offer key 9 = opt out. */
function marketingKeys(w) {
  if (!w.keys.some((k) => k.key === '9')) w.keys = [...w.keys, { key: '9', action: 'opt-out' }];
  w.keys = w.keys.map((k) => (k.key === '9' ? { ...k, action: 'opt-out' } : k));
}
/** Choosing a preset sets the purpose it needs (and keeps the purpose otherwise). */
function applyPreset(w, p) {
  w.preset = p;
  if (p === 'payment') w.purpose = 'payment';
  else if (p === 'insurance') { w.purpose = 'marketing'; marketingKeys(w); }
  else if (w.purpose === 'payment' || (p === 'healthcare' && w.purpose === 'marketing')) w.purpose = 'reminder';
}
/** Changing the purpose keeps the preset only where it still fits. */
function purposeChanged(w, v) {
  w.purpose = v;
  if (v === 'marketing') marketingKeys(w);
  if (v === 'payment') w.preset = 'payment';
  else if (w.preset === 'payment') w.preset = 'general';
  w.preset = presetOf(w);
}
const hhmm = (min) => `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
/**
 * Calling window on the Bangkok day of `ms`: { ok, from, to, usual, hol } in minutes. A Thai public holiday
 * (js/data/holidays.js) follows the weekend hours, so a weekday holiday ends at 18:00 — for the locked Debt
 * Collection Act and Insurance sales windows and for a campaign's own hours alike. `usual` = the end on a normal
 * weekday, to say "stops at 18:00, not 20:00".
 */
function windowFor(w, ms) {
  const day = bkkDay(ms);
  const hol = holidayOn(ymdOf(ms));
  const short = day === 0 || day === 6 || !!hol;
  const p = presetOf(w);
  if (p === 'payment') return { ok: true, from: 8 * 60, to: short ? WEEKEND_END : 20 * 60, usual: 20 * 60, hol };
  if (p === 'insurance') return { ok: day !== 0, from: 8 * 60 + 30, to: short ? WEEKEND_END : 19 * 60, usual: 19 * 60, hol };
  const from = toMin(w.hoursFrom);
  const usual = toMin(w.hoursTo);
  const to = hol ? Math.min(usual, WEEKEND_END) : usual;
  return { ok: (w.days || []).includes(day) && to > from, from, to, usual, hol };
}
/** The calling day's window in one line ("Thursday 10 December 2026 is a public holiday …: calls stop at 18:00, not 20:00"). */
function windowLine(ctx, w, ms) {
  const { t, fmt } = ctx;
  const win = windowFor(w, ms);
  const day = fmt.dateProse(ms, true);
  if (!win.hol) return t('s3.window', { day, from: hhmm(win.from), to: hhmm(win.to) });
  const vars = { day, name: loc(win.hol.name), to: hhmm(win.to), usual: hhmm(win.usual) };
  return win.usual > win.to && bkkDay(ms) !== 0 && bkkDay(ms) !== 6 ? t('s3.windowHol', vars) : t('s3.windowHolSame', vars);
}
/** A saved campaign as the fields windowFor reads (its hours are "HH:MM–HH:MM" or a locked window name). */
function wOfCamp(c) {
  const m = String(c.hours || '').match(/(\d{2}:\d{2})\s*[–-]\s*(\d{2}:\d{2})/);
  return { purpose: c.purpose, preset: c.preset, hoursFrom: m ? m[1] : '09:00', hoursTo: m ? m[2] : '18:00', days: c.days || [1, 2, 3, 4, 5, 6] };
}
function ensureWizard(ctx) {
  const draftId = ctx.params.query.draft || null;
  const key = draftId || 'new';
  if (!ctx.state.wz || ctx.state.wz.key !== key) {
    const draft = draftId ? findCamp(draftId) : null;
    ctx.state.wz = freshWizard(draft);
    if (draft && draft.status === 'scheduled') ctx.state.wz.audience = ctx.state.wz.audience || { ...sampleLike(draft), source: 'saved' };
    if (draft && draft.reached > 1 && !ctx.state.wz.audience && draft.list) ctx.state.wz.audience = { ...sampleLike(draft), source: 'saved' };
  }
  // The caller ID must be one this account can use right now (dataset, Sandbox/Live or numbers may have changed):
  // otherwise the select would show its first option while the launch used the stale value.
  const owned = ownedCallerIds();
  if (!owned.some((x) => x.number === ctx.state.wz.cid)) {
    const pick = owned.find((x) => x.number === '02-xxx-1002') || owned[0];
    ctx.state.wz.cid = pick ? pick.number : SANDBOX_CALLER;
  }
  const step = Number(ctx.params.query.step);
  if (step >= 1 && step <= STEPS && step <= ctx.state.wz.reached + 1 && ctx.state.wz.stepFromQuery !== step) { ctx.state.wz.step = step; ctx.state.wz.stepFromQuery = step; ctx.state.wz.reached = Math.max(ctx.state.wz.reached, step); }
  return ctx.state.wz;
}
/** A scheduled campaign from the seed has counts but no row list: show it as a loaded list. */
function sampleLike(c) {
  const r = rng(hash(c.id));
  const used = new Set();
  const rows = Array.from({ length: c.toCall }, (_, i) => ({ row: i + 1, phone: phoneGen(r, used), n: Math.floor(r() * NAMES.length), problem: null }));
  return { file: c.file || `${c.id}.csv`, rows, total: c.rows || c.toCall, duplicates: c.duplicates || 0, dnc: c.dnc || 0, invalid: 0, toCall: c.toCall, columns: COLUMNS };
}
const wzName = (ctx, w) => (w.name == null ? ctx.t('defaultName') : typeof w.name === 'object' ? loc(w.name) : w.name);
const subOfCid = (cid) => { const n = ownedCallerIds().find((x) => x.number === cid); return n ? n.sub : null; };
const scriptText = (w) => (w.text != null ? w.text : builtinText(w.lang, w.kind));
const speakKey = (kind) => (kind === 'reminder' ? 'dialer.tpl.reminder.speak' : `campaigns.script.${kind}.speak`);

function wizardView(ctx) {
  const { t, html: h, icon } = ctx;
  const w = ensureWizard(ctx);
  const labels = [1, 2, 3, 4].map((n) => t(`wz.s${n}`));
  return h`<div class="page cp cp-wz">
    <div class="page-head"><div class="titles"><h1>${w.id ? t('wz.editTitle') : t('wz.title')}${ctx.pageHelp()}</h1><span class="sub">${t('wz.sub')}</span></div>
      <div class="tools"><a class="btn btn-ghost" href="#/campaigns" data-action="wc.close">${icon('x', 'ico-sm')}${t('wz.close')}</a></div></div>
    <section class="card cp-wz-head" aria-label="${t('wz.headAria')}">
      <label class="field"><span class="label">${t('wz.name')}</span><input class="input" data-field="wcName" value="${wzName(ctx, w)}" maxlength="80" autocomplete="off" data-action="wc.name"></label>
      <div class="field"><span class="label" id="cp-cid-l">${ctx.term(t('wz.cid'), 'caller_id')}</span><select class="select" data-field="wcCid" data-action="wc.cid" aria-labelledby="cp-cid-l">${ownedCallerIds().map((n) => h`<option value="${n.number}" ${raw(n.number === w.cid ? 'selected' : '')}>${n.number}${n.sandbox ? ` · ${t('wz.sandboxCaller')}` : ` · ${ctx.ui.describe.sub(n.sub)}`}</option>`)}</select></div>
      <label class="field"><span class="label">${t('wz.purpose')}</span><select class="select" data-field="wcPurpose" data-action="wc.purpose">${PURPOSES.map((p) => h`<option value="${p}" ${raw(p === w.purpose ? 'selected' : '')}>${t(`purpose.${p}`)}</option>`)}</select></label>
      ${w.purpose === 'marketing' ? h`<label class="check cp-consent"><input type="checkbox" data-field="wcConsent" ${raw(w.consent ? 'checked' : '')}>${t('wz.consent')}</label>` : ''}
      ${w.purpose === 'payment' ? h`<p class="hint-xs cp-purpose-note">${icon('info', 'ico-xs')} ${t('wz.paymentNote')}</p>` : ''}
    </section>
    <ol class="cp-steps" aria-label="${t('wz.stepsAria')}">${labels.map((lbl, i) => {
      const n = i + 1;
      const state = n === w.step ? 'current' : n <= w.reached ? 'done' : 'todo';
      const reachable = n <= w.reached + 1 && n <= w.reached;
      return h`<li><button type="button" class="cp-step is-${state}" data-action="wc.step" data-value="${n}" ${raw(n === w.step ? 'aria-current="step"' : '')} ${raw(reachable || n === w.step ? '' : 'aria-disabled="true"')}>
        <span class="cp-circ">${state === 'done' ? icon('check', 'ico-xs') : n}</span><span class="cp-lbl">${lbl}</span>${reachable || n === w.step ? '' : h`<span class="sr-only"> · ${t('wz.finishFirst')}</span>`}</button></li>`;
    })}</ol>
    <section class="card cp-wz-body" aria-labelledby="cp-step-h">
      <div class="card-head"><h2 id="cp-step-h">${t(`wz.s${w.step}`)}<span class="hint"> · ${t('wz.stepOf', { n: w.step, total: STEPS })}</span></h2>
        <a class="linkbtn" href="#/help/article/${w.step === 3 ? 'calling-hours-dnc' : 'campaign-guide'}" data-action="wc.learn">${icon('book', 'ico-sm')}${t('common.learnMore')}</a></div>
      <div class="card-body">${w.step === 1 ? step1(ctx, w) : w.step === 2 ? step2(ctx, w) : w.step === 3 ? step3(ctx, w) : step4(ctx, w)}</div>
      <div class="card-foot cp-wz-foot">
        ${w.step > 1 ? h`<button type="button" class="btn" data-action="wc.back">${icon('arrow-left', 'ico-sm')}${t('common.back')}</button>` : ''}
        <span class="grow"></span>
        <button type="button" class="btn btn-ghost" data-action="wc.save">${t('wz.saveDraft')}</button>
        ${w.step < STEPS ? h`<button type="button" class="btn btn-navy" data-action="wc.next">${t('wz.next', { step: labels[w.step] })}${icon('arrow-right', 'ico-sm')}</button>` : launchButton(ctx, w)}
      </div>
    </section></div>`;
}

/** Step 1: "Industry presets (planned)" — General · Payment reminder · Healthcare · Insurance sales. */
function presetBlock(ctx, w) {
  const { t, html: h, icon } = ctx;
  const p = presetOf(w);
  const rules = Array.from({ length: PRESET_RULES[p] }, (_, i) => t(`pre.${p}.r${i + 1}`));
  return h`<section class="cp-preset" aria-labelledby="cp-preset-l" data-inv="wc.1.preset">
    <div class="stack" style="gap:2px"><span class="label" id="cp-preset-l">${t('pre.title')}</span><span class="hint-xs">${t('pre.intro')}</span></div>
    <div class="cp-presets" role="group" aria-labelledby="cp-preset-l">${PRESETS.map((x) => h`<button type="button" class="optcard" data-action="wc.1.preset" data-value="${x}" aria-pressed="${p === x}"><span class="t">${t(`pre.${x}.t`)}</span><span class="h">${t(`pre.${x}.h`)}</span></button>`)}</div>
    <div class="cp-preset-rules" aria-live="polite"><ul>${rules.map((r) => h`<li>${r}</li>`)}</ul>
      <p class="hint-xs cp-preset-check">${icon('alert', 'ico-xs')} ${t('pre.check')}</p></div>
  </section>`;
}

function step1(ctx, w) {
  const { t, html: h, icon, fmt } = ctx;
  const a = w.audience;
  const loading = w.loading;
  const tiles = a ? h`<div class="grid g-4 cp-aud-tiles" role="status" aria-live="polite">
      <div class="card tile"><span class="t">${t('s1.inFile')}</span><span class="v">${fmt.int(a.total)}</span><span class="h">${a.file ? h`<span class="mono" translate="no">${a.file}</span>` : t('s1.pasted')}</span></div>
      <div class="card tile cp-tile-main"><span class="t">${t('s1.toCall')}</span><span class="v">${fmt.int(a.toCall)}</span><span class="h">${t('s1.toCallH')}</span></div>
      <div class="card tile"><span class="t">${t('s1.dups')}</span><span class="v">${fmt.int(a.duplicates)}</span><span class="h">${t('s1.dupsH')}</span></div>
      <div class="card tile"><span class="t">${ctx.term(t('s1.dnc'), 'dnc')}</span><span class="v">${fmt.int(a.dnc)}</span><span class="h">${a.invalid ? t('s1.invalidH', { n: fmt.int(a.invalid) }) : t('s1.dncH')}</span></div></div>` : '';
  const rows = a ? a.rows.filter((r) => (w.problemsOnly ? !!r.problem : true)) : [];
  const shown = rows.slice(0, 12);
  const probChip = (p) => (p === 'duplicate' ? h`<span class="chip chip-warn">${t('s1.p.duplicate')}</span>` : p === 'dnc' ? h`<span class="chip chip-err" tabindex="0" data-tip-key="term.dnc">${t('s1.p.dnc')}</span>` : p === 'invalid' ? h`<span class="chip chip-err">${t('s1.p.invalid')}</span>` : h`<span class="chip chip-ok">${t('s1.p.ok')}</span>`);
  const pay = presetOf(w) === 'payment';
  const pidCol = !!(a && a.people != null);
  return h`<div class="stack-4">
    ${presetBlock(ctx, w)}
    <div class="cp-drop ${w.awaiting === 'csv' ? 'is-await' : ''}" data-drop="csv">
      <span class="cp-drop-ico">${icon('upload')}</span>
      <div class="grow stack" style="gap:2px"><strong>${t('s1.dropTitle')}</strong><span class="hint-xs">${w.awaiting === 'csv' ? t('s1.awaiting') : t('s1.dropHint')}</span></div>
      <div class="row">
        <button type="button" class="btn btn-navy" data-action="wc.1.upload">${icon('upload', 'ico-sm')}${t('s1.upload')}</button>
        <button type="button" class="btn" data-action="wc.1.sample">${icon('file-text', 'ico-sm')}${t('s1.sample')}</button>
        <button type="button" class="btn btn-ghost" data-action="wc.1.template">${icon('download', 'ico-sm')}${t('s1.template')}</button>
      </div>
      <input type="file" hidden data-file="csv" accept=".csv,.xlsx,.xls,text/csv">
    </div>
    ${w.savedFile && !a ? h`<p class="note note-info">${icon('info')}<span>${t('s1.savedFile', { file: w.savedFile })}</span></p>` : ''}
    <p class="hint-xs">${icon('shield', 'ico-xs')} ${t('s1.privacy')} <button type="button" class="linkbtn" data-action="wc.1.sampledl">${t('s1.sampleDl', { file: SAMPLE_FILE })}</button></p>
    ${loading ? h`<div class="cp-reading" role="status" aria-live="polite"><div class="row" style="justify-content:space-between"><span>${t('s1.reading', { n: fmt.int(loading.total) })}</span><span class="mono" data-read-pct>${loading.pct}%</span></div>
      <span class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${loading.pct}" aria-label="${t('s1.readingAria')}"><i data-read-bar style="width:${loading.pct}%"></i></span></div>` : ''}
    ${tiles}
    ${pidCol ? h`<p class="note ${pay ? 'note-info' : ''} cp-people" role="status">${icon('users')}<span>${t(pay ? 's1.peoplePay' : 's1.people', { n: fmt.int(a.toCall), people: fmt.int(a.people) })}</span></p>`
      : pay ? h`<p class="hint-xs cp-people-hint">${icon('info', 'ico-xs')} ${t('s1.pidHint')}</p>` : ''}
    <details class="cp-paste" ${raw(w.pasteOpen ? 'open' : '')}><summary data-action="wc.1.pastetoggle">${icon('edit', 'ico-sm')}${t('s1.pasteTitle')}</summary>
      ${w.pasteOpen ? h`<div class="stack-3 cp-paste-body"><textarea class="textarea mono" rows="4" data-field="wcPaste" placeholder="081-xxx-1234&#10;089-xxx-5678" aria-label="${t('s1.pasteTitle')}" spellcheck="false" translate="no">${w.paste}</textarea>
      <div class="row"><button type="button" class="btn btn-sm btn-navy" data-action="wc.1.paste">${t('s1.pasteUse')}</button><span class="hint-xs">${t('s1.pasteHint')}</span></div></div>` : ''}</details>
    ${a ? h`<div class="card cp-preview"><div class="card-head"><h3>${t('s1.preview')}</h3>
        <div class="row-tight cp-switch"><button type="button" class="toggle" role="switch" aria-checked="${w.problemsOnly}" data-action="wc.1.problems" aria-labelledby="cp-prob-l"></button><span id="cp-prob-l">${t('s1.problemsOnly')}</span></div></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th class="num">${t('s1.c.row')}</th><th>${t('s1.c.phone')}</th><th>${t('s1.c.name')}</th>${pidCol ? h`<th>${t('s1.c.pid')}</th>` : ''}${a.columns.includes('date') ? h`<th>${t('s1.c.date')}</th><th>${t('s1.c.time')}</th>` : ''}<th>${t('s1.c.check')}</th></tr></thead>
      <tbody>${shown.map((r) => h`<tr><td class="num mono">${r.row}</td><td class="mono" translate="no">${r.phone}</td><td>${r.n == null ? '—' : nameOf(r.n)}</td>${pidCol ? h`<td class="mono nowrap" translate="no">${r.pid || '—'}</td>` : ''}${a.columns.includes('date') ? h`<td class="nowrap">${r.date ? fmt.dayMonth(r.date) : '—'}</td><td class="mono">${r.time || '—'}</td>` : ''}<td>${probChip(r.problem)}</td></tr>`)}</tbody></table></div>
      <div class="card-foot hint-xs">${rows.length > shown.length ? t('s1.more', { shown: fmt.int(shown.length), total: fmt.int(rows.length) }) : t('s1.all', { total: fmt.int(rows.length) })}</div></div>` : ''}
    ${w.err1 ? h`<p class="field-err" role="alert">${w.err1}</p>` : ''}
  </div>`;
}

function step2(ctx, w) {
  const { t, html: h, icon, fmt } = ctx;
  const text = scriptText(w);
  const cols = w.audience ? w.audience.columns : COLUMNS;
  const unknown = varsIn(text).filter((v) => !cols.includes(v));
  const gi = w.mode === 'tts' ? genderIssue(w.lang, w.gender, text) : null;
  const preview = fillVars(text, sampleVars(w.lang));
  const est = estimateFor(w, subOfCid(w.cid));
  const free = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].filter((k) => !w.keys.some((x) => x.key === k));
  return h`<div class="cp-s2">
    <div class="stack-4">
      <div class="field"><span class="label">${t('s2.mode')}</span><div class="seg" role="group" aria-label="${t('s2.mode')}">
        <button type="button" data-action="wc.2.mode" data-value="tts" aria-pressed="${w.mode === 'tts'}">${icon('volume', 'ico-sm')}${t('s2.modeTts')}</button>
        <button type="button" data-action="wc.2.mode" data-value="audio" aria-pressed="${w.mode === 'audio'}">${icon('upload', 'ico-sm')}${t('s2.modeAudio')}</button></div></div>
      ${presetOf(w) === 'payment' || presetOf(w) === 'healthcare' ? h`<p class="note note-brand cp-tip" role="note">${icon('sparkles')}<span><strong>${t('s2.tip')}</strong> ${t(presetOf(w) === 'payment' ? 's2.tipPayment' : 's2.tipHealth')}</span></p>` : ''}
      ${w.mode === 'tts' ? h`
        <label class="field"><span class="label">${t('s2.script')}</span>
          <textarea class="textarea cp-script" rows="6" data-field="wcText" data-action="wc.2.text" lang="${LANGS[w.lang].html}" aria-describedby="cp-script-help" aria-invalid="${unknown.length ? 'true' : 'false'}">${text}</textarea></label>
        <div class="row-tight cp-vars" role="group" aria-label="${t('s2.varsAria')}"><span class="hint-xs">${t('s2.vars')}</span>${['name', 'date', 'time', 'clinic'].map((v) => h`<button type="button" class="chip chip-navy cp-var" data-action="wc.2.var.${v}" data-value="${v}" translate="no">{${v}}</button>`)}</div>
        <span class="hint-xs" id="cp-script-help">${t('s2.scriptHelp', { sec: est.sec, min: est.minutes })}</span>
        ${unknown.map((v) => h`<p class="field-err" role="alert">${t('s2.unknownVar', { col: `{${v}}` })}</p>`)}
        ${gi ? h`<div class="note note-warn" role="status">${icon('alert')}<div class="grow">${t(gi === 'female' ? 's2.genderF' : 's2.genderM')}</div><button type="button" class="btn btn-sm" data-action="wc.2.fix">${t('s2.fix')}</button></div>` : ''}
        ${w.purpose === 'marketing' && !w.keys.some((k) => k.key === '9' && k.action === 'opt-out') ? h`<p class="field-err">${t('s2.needOptOut')}</p>` : ''}`
      : h`<div class="cp-drop ${w.awaiting === 'audio' ? 'is-await' : ''}" data-drop="audio"><span class="cp-drop-ico">${icon('volume')}</span>
          <div class="grow stack" style="gap:2px"><strong>${w.audioFile ? w.audioFile.name : t('s2.audioTitle')}</strong><span class="hint-xs">${w.audioFile ? (w.audioFile.sec ? t('s2.audioLen', { dur: fmt.duration(w.audioFile.sec), size: fmt.num(w.audioFile.size / 1048576, 1) }) : t('s2.audioNoLen')) : w.awaiting === 'audio' ? t('s1.awaiting') : t('s2.audioHint')}</span></div>
          <button type="button" class="btn btn-navy" data-action="wc.2.audio">${icon('upload', 'ico-sm')}${w.audioFile ? t('s2.audioReplace') : t('s2.audioPick')}</button>
          <input type="file" hidden data-file="audio" accept="audio/mpeg,audio/wav,.mp3,.wav"></div>
        ${w.audioErr ? h`<p class="field-err" role="alert">${w.audioErr}</p>` : ''}`}
      <div class="field"><span class="label">${ctx.term(t('s2.keys'), 'dtmf')}</span>
        <div class="cp-keys">${w.keys.map((k, i) => h`<div class="cp-keyrow"><span class="cp-keycap" aria-hidden="true">${k.key}</span>
          <label class="sr-only" for="cp-key-${i}">${t('s2.keyAction', { key: k.key })}</label>
          <select class="select" id="cp-key-${i}" data-field="wcKey" data-index="${i}" ${raw(w.purpose === 'marketing' && k.key === '9' ? 'aria-describedby="cp-optout-lock"' : '')}>${KEY_ACTIONS.map((a) => h`<option value="${a}" ${raw(a === k.action ? 'selected' : '')}>${t(`key.${a}`, { key: k.key })}</option>`)}</select>
          ${w.purpose === 'marketing' && k.key === '9' ? h`<span class="hint-xs" id="cp-optout-lock">${t('s2.optOutLocked')}</span>` : h`<button type="button" class="btn btn-ghost btn-sm btn-icon" data-action="wc.2.keyremove" data-value="${i}" aria-label="${t('s2.keyRemove', { key: k.key })}">${icon('trash', 'ico-sm')}</button>`}</div>`)}
          ${w.keys.some((k) => k.action === 'sms-link') ? h`<p class="hint-xs">${t('s2.smsNote')}</p>` : ''}
          ${w.keys.some((k) => isTransfer(k.action)) ? h`<div class="row-tight cp-tcap"><label class="hint-xs" for="cp-tcap">${t('s2.transferCap')}</label>
            <select class="select cp-tcap-sel" id="cp-tcap" data-field="wcTransferMin" data-action="wc.2.transfermin" aria-describedby="cp-tcap-h">${TRANSFER_MINUTES.map((m) => h`<option value="${m}" ${raw(m === (Number(w.transferMin) || 0) ? 'selected' : '')}>${m ? t('s2.transferCapN', { n: m }) : t('s2.transferNoLimit')}</option>`)}</select></div>
            <p class="hint-xs" id="cp-tcap-h">${Number(w.transferMin) ? t('s2.transferNote', { n: w.transferMin }) : t('s2.transferNoLimitNote')}</p>` : ''}
          ${w.keys.some((k) => k.action === 'repeat') ? h`<p class="hint-xs">${t('s2.repeatNote', { n: MAX_REPEATS })}</p>` : ''}
          ${free.length ? h`<button type="button" class="btn btn-sm" data-action="wc.2.keys">${icon('plus', 'ico-sm')}${t('s2.keyAdd', { key: free[0] })}</button>` : ''}</div></div>
    </div>
    <aside class="card card-sunken cp-voice stack-3">
      <div class="field"><span class="label">${t('s2.lang')}</span><div class="seg" role="group" aria-label="${t('s2.lang')}">${LANG_ORDER.map((l) => h`<button type="button" data-action="wc.2.lang" data-value="${l}" aria-pressed="${w.lang === l}" lang="${LANGS[l].html}">${LANGS[l].label}</button>`)}</div></div>
      <div class="field"><span class="label">${ctx.term(t('s2.voice'), 'voice_tier')}</span>
        <div class="grid g-2 cp-tier">
          <button type="button" class="optcard" data-action="wc.2.voice" data-value="standard" aria-pressed="${w.voice === 'standard'}"><span class="t">${t('s2.standard')}</span><span class="h">${t('s2.included')}</span></button>
          <button type="button" class="optcard" data-action="wc.2.voice" data-value="premium" aria-pressed="${w.voice === 'premium'}"><span class="t">${t('s2.premium')}</span><span class="h">${t('s2.premiumH', { rate: fmt.rate(PRICES.premiumVoice) })}</span></button></div>
        ${w.voice === 'premium' ? h`<p class="hint-xs cp-price">${t('s2.premiumLine', { rate: fmt.rate(PRICES.premiumVoice) })}</p>` : ''}</div>
      <label class="field"><span class="label">${t('s2.gender')}</span><select class="select" data-field="wcGender"><option value="female" ${raw(w.gender === 'female' ? 'selected' : '')}>${t('s2.female', { lang: LANGS[w.lang].label })}</option><option value="male" ${raw(w.gender === 'male' ? 'selected' : '')}>${t('s2.male', { lang: LANGS[w.lang].label })}</option></select></label>
      <div class="field"><span class="label"><span id="cp-rate-l">${t('s2.rate')}</span> <output class="mono" data-rate-out for="cp-rate">${fmt.num(w.rate, 2)}×</output></span><input type="range" id="cp-rate" min="0.8" max="1.2" step="0.05" value="${w.rate}" data-field="wcRate" data-action="wc.2.rate" aria-labelledby="cp-rate-l" aria-valuetext="${fmt.num(w.rate, 2)}×"></div>
      <div class="stack" style="gap:6px"><span class="label">${t('s2.previewRow')}</span><p class="cp-say" lang="${LANGS[w.lang].html}" data-say>${w.mode === 'audio' ? (w.audioFile ? w.audioFile.name : '—') : preview}</p>
        <div class="row"><button type="button" class="btn ${w.playing ? '' : 'btn-navy'}" data-action="wc.2.play" ${raw(w.mode === 'audio' && !w.audioFile ? 'aria-disabled="true" aria-describedby="cp-play-help"' : '')}>${icon(w.playing ? 'stop' : 'play', 'ico-sm')}${w.playing ? t('s2.stop') : t('s2.play')}</button>
          ${w.mode === 'audio' && !w.audioFile ? h`<span class="hint-xs" id="cp-play-help">${t('s2.playNeedsFile')}</span>` : ''}</div>
        ${w.voiceNote ? h`<p class="hint-xs" role="status">${w.voiceNote}</p>` : ''}</div>
    </aside></div>`;
}

function step3(ctx, w) {
  const { t, html: h, icon, fmt } = ctx;
  const p = presetOf(w);
  const locked = isLocked(w);
  const err = hoursError(ctx, w);
  const startLine = startLineOf(ctx, w);
  const dur = runDuration(w);
  const startMs = startMoment(w).ms;
  const shownDays = p === 'payment' ? DAY_KEYS : p === 'insurance' ? [1, 2, 3, 4, 5, 6] : w.days;
  return h`<div class="cp-s3 stack-4">
    <div class="field"><span class="label">${t('s3.when')}</span><div class="grid g-2 cp-when-cards">
      <button type="button" class="optcard" data-action="wc.3.start" data-value="now" aria-pressed="${w.start === 'now'}"><span class="t">${t('s3.now')}</span><span class="h">${w.start === 'now' ? startLine : t('s3.nowH')}</span></button>
      <button type="button" class="optcard" data-action="wc.3.start" data-value="schedule" aria-pressed="${w.start === 'schedule'}"><span class="t">${t('s3.schedule')}</span><span class="h">${t('s3.scheduleH')}</span></button></div>
      ${w.start === 'schedule' ? h`<div class="row cp-sched"><label class="field"><span class="label">${t('s3.date')}</span><input class="input" type="date" min="2026-10-27" value="${w.date}" data-field="wcDate"></label>
        <label class="field"><span class="label">${t('s3.time')}</span><input class="input" type="time" step="900" value="${w.time}" data-field="wcTime"></label><span class="hint-xs">${t('s3.tz')}</span></div>` : ''}
      <p class="hint-xs" aria-live="polite">${startLine} · ${t('s3.duration', { min: fmt.int(dur) })}</p>
      <p class="cp-window ${windowFor(w, startMs).hol ? 'is-holiday' : ''}" data-window aria-live="polite">${icon(windowFor(w, startMs).hol ? 'calendar' : 'clock', 'ico-sm')}<span>${windowLine(ctx, w, startMs)}</span></p></div>
    <div class="grid g-2">
      <div class="field"><span class="label">${ctx.term(t('s3.hours'), 'calling_hours')}</span>
        ${locked ? h`<div class="note note-info">${icon('lock')}<span>${t(p === 'insurance' ? 's3.lockedHoursIns' : 's3.lockedHours')}</span></div>` : h`<div class="row cp-hours"><input class="input" type="time" step="900" value="${w.hoursFrom}" data-field="wcFrom" data-action="wc.3.hours" aria-label="${t('s3.from')}" aria-invalid="${err ? 'true' : 'false'}"><span>–</span><input class="input" type="time" step="900" value="${w.hoursTo}" data-field="wcTo" data-action="wc.3.hours" aria-label="${t('s3.to')}" aria-invalid="${err ? 'true' : 'false'}"></div>`}
        <div class="row-tight cp-days" role="group" aria-label="${t('s3.days')}">${DAY_KEYS.map((d) => h`<button type="button" class="cp-day" data-action="wc.3.days" data-value="${d}" aria-pressed="${shownDays.includes(d)}" ${raw(locked ? 'aria-disabled="true"' : '')}>${t(`day.${d}`)}</button>`)}</div>
        ${err ? h`<span class="field-err" role="alert">${err}</span>` : h`<span class="hint-xs">${t('s3.hoursHint')}</span>`}</div>
      <div class="stack-3">
        <div class="field"><span class="label">${t('s3.retries')}</span><div class="row"><div class="stepper">
          <button type="button" data-action="wc.3.retry" data-value="-1" aria-label="${t('s3.fewer')}" ${raw(w.retries <= 0 ? 'aria-disabled="true"' : '')}>${icon('minus', 'ico-sm')}</button><output aria-live="polite">${w.retries}</output>
          <button type="button" data-action="wc.3.retry" data-value="1" aria-label="${t('s3.more')}" ${raw(w.retries >= 3 ? 'aria-disabled="true"' : '')}>${icon('plus', 'ico-sm')}</button></div>
          <div class="seg seg-sm" role="group" aria-label="${t('s3.wait')}">${[15, 30, 60].map((m) => h`<button type="button" data-action="wc.3.wait" data-value="${m}" aria-pressed="${w.wait === m}" ${raw(w.retries ? '' : 'aria-disabled="true"')}>${t('s3.waitN', { n: m })}</button>`)}</div></div>
          <span class="hint-xs">${w.retries ? t('s3.retryHint', { n: w.retries, m: w.wait }) : t('s3.noRetry')}</span></div>
        ${preSmsRule(ctx, w)}
        ${fallbackRule(ctx, w)}
        <div class="grid g-2">
          <div class="field"><span class="label">${ctx.term(t('s3.cps'), 'cps')}</span><div class="stepper">
            <button type="button" data-action="wc.3.cps" data-value="-1" aria-label="${t('s3.fewer')}" ${raw(w.cps <= 1 ? 'aria-disabled="true"' : '')}>${icon('minus', 'ico-sm')}</button><output aria-live="polite">${w.cps}</output>
            <button type="button" data-action="wc.3.cps" data-value="1" aria-label="${t('s3.more')}" ${raw(w.cps >= PRICES.cpsDefault ? 'aria-disabled="true" aria-describedby="cp-cps-max"' : '')}>${icon('plus', 'ico-sm')}</button></div>
            <span class="hint-xs" id="cp-cps-max">${t('s3.cpsMax', { n: PRICES.cpsDefault })}</span></div>
          <div class="field"><span class="label">${ctx.term(t('s3.conc'), 'concurrent')}</span><div class="stepper">
            <button type="button" data-action="wc.3.conc" data-value="-5" aria-label="${t('s3.fewer')}" ${raw(w.conc <= 5 ? 'aria-disabled="true"' : '')}>${icon('minus', 'ico-sm')}</button><output aria-live="polite">${w.conc}</output>
            <button type="button" data-action="wc.3.conc" data-value="5" aria-label="${t('s3.more')}" ${raw(w.conc >= 20 ? 'aria-disabled="true" aria-describedby="cp-conc-max"' : '')}>${icon('plus', 'ico-sm')}</button></div>
            <span class="hint-xs" id="cp-conc-max">${t('s3.concMax', { n: 20 })}</span></div></div>
        ${p === 'payment' ? h`<div class="field"><span class="label">${t('s3.capPerson')}</span><span class="hint">${t('s3.capLocked')}</span></div>`
          : h`<label class="field"><span class="label">${t('s3.cap')}</span><select class="select" data-field="wcCap" data-action="wc.3.cap">${[1, 2, 3].map((n) => h`<option value="${n}" ${raw(n === w.cap ? 'selected' : '')}>${t('s3.capN', { count: n })}</option>`)}</select></label>`}
      </div></div>
    <div class="note ${w.dnc === 'done' ? 'note-ok' : ''} cp-dnc" role="status" aria-live="polite">${icon(w.dnc === 'done' ? 'check-circle' : 'shield')}
      <div class="grow stack" style="gap:2px"><strong>${t('s3.dncTitle')}</strong><span class="hint-xs">${w.dnc === 'done' ? t('s3.dncDone', { n: fmt.int(w.audience ? w.audience.dnc : 0) }) : t('s3.dncHint')}</span></div>
      <button type="button" class="btn btn-sm" data-action="wc.3.dnc" ${raw(w.dnc === 'run' ? 'aria-busy="true"' : '')}>${w.dnc === 'run' ? raw('<span class="spin" aria-hidden="true"></span>') : icon('refresh', 'ico-sm')}${t('s3.dncCheck')}</button></div>
  </div>`;
}

function hoursError(ctx, w) {
  const { t } = ctx;
  if (isLocked(w)) return null;
  if (!w.days.length) return t('s3.errDays');
  const f = toMin(w.hoursFrom);
  const to = toMin(w.hoursTo);
  if (to <= f) return t('s3.errOrder');
  if (f < 8 * 60 || to > 20 * 60) return t('s3.errWeekday');
  if (w.days.some((d) => d === 0 || d === 6) && to > 18 * 60) return t('s3.errWeekend');
  return null;
}
const dayStart = (ms) => { const d = new Date(ms + 7 * 3600000); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - 7 * 3600000; };
/** When calls really start: now (if inside the window), the next window, or the scheduled time. */
function startMoment(w) {
  let ms = w.start === 'schedule' ? onDay(w.date, `${w.time}:00`) : nowMs();
  let moved = false;
  for (let i = 0; i < 9; i++) {
    const min = bkkMinutes(ms);
    const win = windowFor(w, ms);
    if (win.ok && min >= win.from && min < win.to) return { ms, moved };
    if (win.ok && min < win.from) return { ms: dayStart(ms) + win.from * 60000, moved: true };
    ms = dayStart(ms) + 24 * 3600000;
    moved = true;
  }
  return { ms, moved: true };
}
function startLineOf(ctx, w) {
  const { t, fmt } = ctx;
  const s = startMoment(w);
  if (w.start === 'now' && !s.moved) return t('s3.startsNow', { time: fmt.timeShort(nowMs()) });
  return t('s3.startsAt', { when: dtProse(ctx, s.ms, true) });
}
function runDuration(w) {
  const n = w.audience ? w.audience.toCall : 0;
  const avg = messageSeconds(w) + 10;
  const perSec = Math.min(w.cps, w.conc / avg);
  return Math.max(1, Math.round(n / perSec / 60));
}

function step4(ctx, w) {
  const { t, html: h, icon, fmt } = ctx;
  const sub = subOfCid(w.cid);
  const e = estimateFor(w, sub);
  const a = w.audience;
  const sandbox = env() === 'sandbox';
  const token = String(e.toCall);
  const ok = normalizeTyped(w.typed) === normalizeTyped(token);
  const summary = (n, label, value) => h`<div class="cp-sum-row"><span class="k">${label}</span><span class="v">${value}</span><button type="button" class="linkbtn" data-action="wc.step" data-value="${n}">${t('s4.edit')}</button></div>`;
  const p = presetOf(w);
  const sw = windowFor(w, startMoment(w).ms);
  const hours = `${isLocked(w) ? `${t(p === 'insurance' ? 's3.lockedShortIns' : 's3.lockedShort')} ` : ''}${hhmm(sw.from)}–${hhmm(sw.to)}${sw.hol ? ` (${t('s4.holShort', { name: loc(sw.hol.name) })})` : ''}`;
  return h`<div class="cp-s4">
    <div class="stack-4">
      <div class="card cp-sum">${summary(1, t('s4.preset'), t(`pre.${p}.t`))}
        ${summary(1, t('s4.audience'), a ? (p === 'payment' && e.people != null ? t('s4.audienceVPeople', { n: fmt.int(a.toCall), people: fmt.int(e.people), file: a.file || t('s1.pasted') }) : t('s4.audienceV', { n: fmt.int(a.toCall), file: a.file || t('s1.pasted') })) : '—')}
        ${summary(2, t('s4.message'), w.mode === 'audio' ? (w.audioFile ? w.audioFile.name : '—') : t('s4.messageV', { lang: LANGS[w.lang].label, voice: w.voice === 'premium' ? t('s2.premium') : t('s2.standard'), sec: e.sec }))}
        ${summary(2, t('s4.keys'), w.keys.map((k) => `${k.key} ${t(`key.${k.action}`, { key: k.key })}`).join(' · '))}
        ${summary(3, t('s4.schedule'), h`<span data-sum-window>${startLineOf(ctx, w)} · ${hours}</span> · ${t('s4.retriesV', { n: w.retries, m: w.wait })}`)}
        ${summary(3, t('s4.pre'), w.preSms ? t('s4.preV', { count: e.toCall, n: fmt.int(e.toCall) }) : t('s4.preOff'))}
        ${summary(3, t('s4.fallback'), w.fb ? t('s4.fallbackV', { channel: chName(ctx, w.fbChannel) }) : t('s4.fallbackOff'))}</div>
      ${sandbox ? h`<div class="note note-warn" role="status">${icon('alert')}<div class="grow stack" style="gap:6px"><span>${t('s4.sandbox')}</span>
          <div class="row"><button type="button" class="btn btn-sm btn-primary" data-action="wc.golive">${t('top.goLive')}</button>
          <button type="button" class="btn btn-sm" data-action="wc.testme">${icon('phone', 'ico-sm')}${t('s4.testMe')}</button></div></div></div>` : ''}
      ${!sandbox ? h`<div class="card card-pad cp-confirm" id="cp-confirm">
        <label class="field"><span class="label">${e.onPlan
          ? (e.max == null ? t('s4.typeLabelPlanAbout', { token, n: fmt.int(e.toCall), min: planMinText(ctx, e.expMin), credits: planCreditsText(ctx, e.cExp) }) : t('s4.typeLabelPlan', { token, n: fmt.int(e.toCall), min: planMinText(ctx, e.maxMin), credits: planCreditsText(ctx, e.cMax) }))
          : e.max == null ? t('s4.typeLabelAbout', { token, n: fmt.int(e.toCall), exp: fmt.credits2(e.expected) }) : t('s4.typeLabel', { token, n: fmt.int(e.toCall), max: fmt.credits2(e.max) })}${e.preSms ? ` ${t('s4.typePre', { n: fmt.int(e.preSms) })}` : ''}${e.smsMax ? ` ${t('s4.typeSms', { sms: fmt.int(e.smsMax) })}` : ''}${e.fb ? ` ${t('s4.typeFb', { n: fmt.int(e.fbMax), channel: chName(ctx, e.fb) })}` : ''}</span>
          <input class="input mono cp-typed ${ok ? 'is-ok' : ''}" data-field="wcTyped" data-action="wc.4.confirm" value="${w.typed}" inputmode="numeric" autocomplete="off" spellcheck="false" aria-describedby="cp-typed-hint" placeholder="${token}"></label>
        <span class="hint-xs" id="cp-typed-hint">${ok ? t('s4.typedOk') : t('confirm.typedHint')}</span>
        ${w.launching != null ? h`<ol class="cp-launchseq" aria-live="polite">${['check', 'reserve', 'start'].map((k, i) => h`<li class="${i < w.launching ? 'is-done' : i === w.launching ? 'is-run' : ''}">${i < w.launching ? icon('check-circle', 'ico-sm') : i === w.launching ? raw('<span class="spin" aria-hidden="true"></span>') : icon('dot', 'ico-sm')}${t(`s4.seq.${k}`)}</li>`)}</ol>` : ''}
      </div>` : ''}
    </div>
    ${costCard(ctx, w, e)}
  </div>`;
}

function costCard(ctx, w, e) {
  const { t, html: h, icon, fmt } = ctx;
  const a = w.audience;
  return h`<aside class="card cp-cost" aria-labelledby="cp-cost-h" data-inv="wc.4.estimate"><div class="card-head"><h3 id="cp-cost-h">${t('cost.title')}</h3><span class="chip chip-warn" tabindex="0" data-tip-key="common.plannedPricesTip">${t('common.plannedPrices')}</span></div>
    <div class="card-body">
      <div class="kv"><span class="k">${t('cost.recipients')}</span><span class="v">${fmt.int(e.toCall)}</span></div>
      ${a ? h`<p class="hint-xs cp-cost-sub">${t('cost.removed', { dups: fmt.int(a.duplicates), dnc: fmt.int(a.dnc) })}</p>` : ''}
      ${presetOf(w) === 'payment' && e.people != null ? h`<p class="hint-xs cp-cost-sub">${t('cost.people', { people: fmt.int(e.people) })}</p>` : ''}
      <div class="kv"><span class="k">${ctx.term(t('cost.billed'), 'billing_minute')}</span><span class="v">${t('cost.billedV', { count: e.minutes, sec: e.sec })}</span></div>
      ${e.max != null && e.maxMinutes > e.minutes ? h`<div class="kv"><span class="k">${t('cost.longest')}</span><span class="v">${t('cost.longestV', { count: e.maxMinutes })}</span></div>
        <p class="hint-xs cp-cost-sub">${e.paths.hasTransfer && e.paths.capMin ? t('cost.longestTransfer', { n: e.paths.capMin }) : t('cost.longestRepeat', { n: MAX_REPEATS })}</p>` : ''}
      <div class="kv"><span class="k">${t('cost.rate')}</span><span class="v">${e.onPlan ? t('cost.rateVPlan', { rate: fmt.rate(e.rate), left: fmt.int(e.cExp.plan.left) }) : t('cost.rateV', { rate: fmt.rate(PRICES.outbound) })}${w.voice === 'premium' ? h`<br><span class="hint-xs">${t('cost.premium', { rate: fmt.rate(PRICES.premiumVoice) })}</span>` : ''}</span></div>
      ${e.onPlan ? planCostRows(ctx, e)
      : e.max == null ? h`<div class="kv kv-total"><span class="k">${t('cost.expected', { pct: fmt.pct(e.pct) })}</span><span class="v" data-cost-max>≈ ${fmt.credits2(e.expected)}</span></div>
        <p class="note note-warn cp-noceil" role="note">${icon('alert')}<span>${t('cost.noCeiling')}</span></p>`
      : h`<div class="kv kv-total"><span class="k">${e.maxMinutes > e.minutes ? t('cost.maxLong') : t('cost.max')}</span><span class="v" data-cost-max>${fmt.credits2(e.max)}</span></div>
      <div class="kv"><span class="k">${t('cost.expected', { pct: fmt.pct(e.pct) })}</span><span class="v">≈ ${fmt.credits2(e.expected)}</span></div>`}
      ${e.lastName ? h`<p class="hint-xs cp-cost-sub">${t('cost.expectedFrom', { name: loc(e.lastName) })}${e.usedAvg ? ` ${t('cost.expectedAvg', { avg: fmt.rate(e.avg) })}` : ''}</p>` : ''}
      ${e.preSms ? h`<div class="kv cp-pre-line" data-inv="wc.4.presms"><span class="k">${t('cost.pre')}</span><span class="v" data-pre-count>${fmt.int(e.preSms)}</span></div>
        <p class="hint-xs cp-cost-sub">${t('cost.preHint')}</p>` : ''}
      ${e.smsMax ? h`<div class="kv"><span class="k">${t('cost.sms')}</span><span class="v">${e.smsExpected != null ? t('cost.smsV', { max: fmt.int(e.smsMax), exp: fmt.int(e.smsExpected) }) : t('cost.smsVMax', { max: fmt.int(e.smsMax) })}</span></div>
        <p class="hint-xs cp-cost-sub">${t('cost.smsHint')}</p>` : ''}
      ${e.fb ? h`<div class="kv cp-fb-line" data-inv="wc.4.fallback"><span class="k">${t('cost.fb', { channel: chName(ctx, e.fb) })}</span><span class="v">${t('cost.fbV', { max: fmt.int(e.fbMax), exp: fmt.int(e.fbExpected) })}</span></div>
        <p class="hint-xs cp-cost-sub">${t('cost.fbHint', { channel: chName(ctx, e.fb) })}</p>` : ''}
      <div class="kv"><span class="k">${t('cost.balanceAfter')}</span><span class="v">≈ ${fmt.credits2(e.balanceAfter)}</span></div>
      ${e.balanceAfterMax != null ? h`<p class="hint-xs cp-cost-sub">${t('cost.balanceAfterMax', { n: fmt.credits2(e.balanceAfterMax) })}</p>` : ''}
      ${e.daily ? h`<div class="kv"><span class="k">${t('cost.daily', { limit: fmt.int(e.daily) })}</span><span class="v ${e.overDaily ? 'err-text' : 'ok-text'}">${e.overDaily ? t('cost.dailyOver') : t('cost.dailyOk')}</span></div>
        <p class="hint-xs cp-cost-sub">${t(e.max == null ? 'cost.dailyLineAbout' : 'cost.dailyLine', { today: fmt.credits2(e.usedToday), max: fmt.credits2(e.head), after: fmt.credits2(e.dailyAfter), limit: fmt.int(e.daily) })}</p>` : ''}
      ${e.short ? h`<div class="note note-err" role="alert">${icon('alert-circle')}<div class="grow">${t('cost.short', { n: fmt.int(e.short) })} <button type="button" class="linkbtn" data-action="wc.4.topup">${t('top.topup')}</button></div></div>` : ''}
      ${e.overDaily ? h`<div class="note note-warn">${icon('alert')}<div class="grow">${t('cost.overDaily', { limit: fmt.int(e.daily) })} <button type="button" class="linkbtn" data-action="wc.4.limits">${t('cost.raise')}</button></div></div>` : ''}
      ${e.plan.suggestPlan && env() === 'live' && !e.onPlan ? h`<p class="hint-xs">${t('cost.planLine', { min: fmt.int(e.plan.suggestPlan.plan.minMinutes), cost: fmt.int(e.plan.suggestPlan.cost) })}</p>` : ''}
      <p class="hint-xs cp-foot">${icon('info', 'ico-xs')} ${t('cost.foot')}</p>
    </div></aside>`;
}
/**
 * On a plan: the ceiling and the expected cost in plan minutes, each with its credits at the plan rate and what it
 * charges now ("0.00 credits while plan minutes last", or the minutes beyond them) — the way the run is charged.
 */
function planCostRows(ctx, e) {
  const { t, html: h, icon, fmt } = ctx;
  const sub = (c, about) => h`<p class="hint-xs cp-cost-sub">${t('cost.planSub', { credits: `${about ? '≈ ' : ''}${fmt.credits2(c.credits)}`, part: `${about ? '≈ ' : ''}${planCreditsText(ctx, c)}` })}</p>`;
  const exp = h`<div class="kv ${e.max == null ? 'kv-total' : ''}"><span class="k">${t('cost.expected', { pct: fmt.pct(e.pct) })}</span><span class="v" ${raw(e.max == null ? 'data-cost-max' : '')}>≈ ${planMinText(ctx, e.expMin)}</span></div>${sub(e.cExp, true)}`;
  if (e.max == null) return h`${exp}<p class="note note-warn cp-noceil" role="note">${icon('alert')}<span>${t('cost.noCeiling')}</span></p>`;
  return h`<div class="kv kv-total"><span class="k">${e.maxMinutes > e.minutes ? t('cost.maxLong') : t('cost.max')}</span><span class="v" data-cost-max>${planMinText(ctx, e.maxMin)}</span></div>${sub(e.cMax, false)}${exp}`;
}

/** "Launch · up to X credits", or "Launch · ≈ X credits, no ceiling" when transfers have no limit (+ SMS when links are sent). */
function btnLabel(ctx, e, kind) {
  const { t, fmt } = ctx;
  const sched = kind === 'schedule';
  // On a plan the button names the plan minutes (the cost card and the confirmation give the credits side).
  const base = e.onPlan
    ? (e.max == null ? t(sched ? 's4.scheduleBtnPlanAbout' : 's4.launchPlanAbout', { min: planMinText(ctx, e.expMin, true) }) : t(sched ? 's4.scheduleBtnPlan' : 's4.launchPlan', { min: planMinText(ctx, e.maxMin, true) }))
    : e.max == null ? t(sched ? 's4.scheduleBtnAbout' : 's4.launchAbout', { exp: fmt.credits2(e.expected) }) : t(sched ? 's4.scheduleBtn' : 's4.launch', { max: fmt.credits2(e.max) });
  const sms = e.smsMax || e.preSms || e.fb === 'sms';
  const line = e.fb === 'line';
  return sms && line ? `${base} ${t('s4.plusSmsLine')}` : sms ? `${base} ${t('s4.plusSms')}` : line ? `${base} ${t('s4.plusLine')}` : base;
}
function launchButton(ctx, w) {
  const { t, html: h, icon, fmt } = ctx;
  const e = estimateFor(w, subOfCid(w.cid));
  const sandbox = env() === 'sandbox';
  const ok = !sandbox && normalizeTyped(w.typed) === normalizeTyped(String(e.toCall)) && e.toCall > 0;
  if (w.start === 'schedule') {
    return h`<button type="button" class="btn btn-primary" data-action="wc.launch" ${raw(ok ? '' : 'aria-disabled="true" aria-describedby="cp-launch-help"')}>${icon('calendar', 'ico-sm')}${btnLabel(ctx, e, 'schedule')}</button>
      ${ok ? '' : h`<span class="hint-xs cp-launch-help" id="cp-launch-help">${sandbox ? t('s4.sandboxShort') : t('s4.typeFirst', { token: e.toCall })}</span>`}`;
  }
  return h`<button type="button" class="btn btn-primary cp-launch" data-action="wc.launch" ${raw(ok ? '' : 'aria-disabled="true" aria-describedby="cp-launch-help"')} ${raw(w.launching != null ? 'aria-busy="true"' : '')}>${w.launching != null ? raw('<span class="spin" aria-hidden="true"></span>') : icon('rocket', 'ico-sm')}${btnLabel(ctx, e, 'launch')}</button>
    ${ok ? '' : h`<span class="hint-xs cp-launch-help" id="cp-launch-help">${sandbox ? t('s4.sandboxShort') : t('s4.typeFirst', { token: e.toCall })}</span>`}`;
}

/** Build the store record from the wizard (draft, scheduled or running). */
function recordFromWizard(ctx, w, status) {
  const sub = subOfCid(w.cid);
  const e = estimateFor(w, sub);
  const existing = w.id ? findCamp(w.id) : null;
  const name = w.name == null ? Object.fromEntries(LANG_ORDER.map((l) => [l, tIn(l, 'campaigns.defaultName')])) : w.name;
  const list = w.audience ? w.audience.rows.filter((r) => !r.problem).map((r) => ({ phone: r.phone, n: r.n == null ? (hash(r.phone) % NAMES.length) : r.n, ...(r.pid ? { pid: r.pid } : {}) })) : null;
  const preset = presetOf(w);
  const rec = {
    ...(existing || {}), id: w.id || newId('bc'), name, sub, callerId: w.cid, purpose: w.purpose, preset, status,
    people: w.audience && w.audience.people != null ? w.audience.people : (existing && existing.people) || null,
    preSms: w.preSms ? { channel: 'sms', minutesBefore: 5 } : null,
    file: w.audience ? w.audience.file : (existing && existing.file) || null, rows: w.audience ? w.audience.total : (existing && existing.rows) || 0,
    duplicates: w.audience ? w.audience.duplicates : 0, dnc: w.audience ? w.audience.dnc : 0, toCall: w.audience ? w.audience.toCall : (existing && existing.toCall) || 0,
    list: list || (existing && existing.list) || null, messageSec: e.sec, minutes: e.minutes,
    keys: Object.fromEntries(w.keys.map((k) => [k.key, k.action])), hours: preset === 'payment' ? 'debt-collection' : preset === 'insurance' ? 'insurance-sales' : `${w.hoursFrom}–${w.hoursTo}`, days: w.days, retries: w.retries, retryAfterMin: w.wait, cps: w.cps, concurrent: w.conc, cap: w.cap, transferMin: w.transferMin,
    fallback: w.fb ? { channel: w.fbChannel || 'sms', after: 'last-retry', when: 'no-answer' } : null,
    script: { kind: w.kind, lang: w.lang, text: w.text, premium: w.voice === 'premium', mode: w.mode, audio: w.audioFile ? w.audioFile.name : null },
    // Kept at the listed price, as the samples are: campaignEstimate shows it at the account's rates (plan or not).
    estimate: { max: e.listMax, expected: e.listExpected, expectedPct: e.pct, balanceAfter: e.balanceAfter, balanceAfterMax: e.balanceAfterMax, dailyAfter: e.dailyAfter }, fresh: true,
  };
  rec.reached = w.reached;
  if (status === 'draft') { rec.savedAt = new Date(nowMs()).toISOString(); rec.savedBy = store.get('user.name'); }
  return rec;
}
function upsert(rec) {
  const list = store.get('campaigns') || [];
  store.set('campaigns', list.some((x) => x.id === rec.id) ? list.map((x) => (x.id === rec.id ? rec : x)) : [rec, ...list]);
}

function validate(ctx, w, step) {
  const { t } = ctx;
  if (step === 1) { w.err1 = w.audience && w.audience.toCall > 0 ? null : t('s1.need'); return !w.err1; }
  if (step === 2) {
    if (w.mode === 'audio') { if (!w.audioFile) { w.audioErr = t('s2.needAudio'); return false; } return true; }
    const text = scriptText(w);
    const cols = w.audience ? w.audience.columns : COLUMNS;
    if (!text.trim() || varsIn(text).some((v) => !cols.includes(v))) return false;
    if (w.purpose === 'marketing' && (!w.consent || !w.keys.some((k) => k.key === '9' && k.action === 'opt-out'))) { if (!w.consent) ctx.ui.toast(t('wz.consentNeeded'), { kind: 'warn' }); return false; }
    return true;
  }
  if (step === 3) return !hoursError(ctx, w);
  return true;
}

let preview = null; // the speaking sample (one at a time)
function stopPreview() { if (preview) { try { preview.stop(); } catch { /* ignore */ } preview = null; } }

function playSample(ctx, w) {
  const { t } = ctx;
  const tts = ctx.ui.audio.tts;
  if (w.playing) { stopPreview(); w.playing = false; ctx.rerender(); return; }
  ctx.ui.audio.unlock();
  if (w.mode === 'audio' && w.audioFile && w.audioFile.url) {
    try {
      const au = new Audio(w.audioFile.url);
      au.play().catch(() => {});
      preview = { stop: () => au.pause() };
      w.playing = true;
      au.onended = () => { w.playing = false; preview = null; if (isWizard()) ctx.rerender(); };
      ctx.rerender();
    } catch { /* ignore */ }
    return;
  }
  const tag = LANGS[w.lang].tts;
  const pick = tts.pick(tag, { premium: w.voice === 'premium' });
  let lang = w.lang;
  let note = null;
  if (!tts.supported() || pick.match === 'none') note = t('s2.noVoice');
  else if (pick.match !== 'exact' && lang !== 'en') { note = t('dialer.fallbackVoiceNote', { lang: LANGS[lang].label }); lang = 'en'; }
  let parts;
  const edited = w.text != null && w.text !== builtinText(w.lang, w.kind) && lang === w.lang;
  if (edited && pick.voice && pick.local) parts = [{ text: fillVars(w.text, sampleVars(lang)) }];
  else {
    if (edited) note = t('dialer.remoteVoiceNote');
    parts = (tIn(lang, speakKey(w.kind)) || []).map((p) => ({ text: p }));
  }
  parts = parts.map((p) => ({ ...p, rate: (p.rate || 1) * (w.rate || 1) }));
  w.voiceNote = note;
  w.playing = true;
  ctx.rerender();
  // Captions: what is spoken, word by word (Intl.Segmenter splits Thai and Chinese).
  const say = document.querySelector('[data-say]');
  const ws = ctx.ui.audio.words(parts.map((p) => p.text).join(' ') + ' ', lang);
  if (say) { say.lang = LANGS[lang].html; say.innerHTML = ws.map((x, i) => `<span class="w" data-w="${i}">${ctx.esc(x.text)}</span>`).join(''); say.classList.add('is-live'); }
  preview = tts.speak(parts, {
    lang: LANGS[lang].tts, premium: w.voice === 'premium',
    onWord: (i) => { document.querySelectorAll('[data-say] .w').forEach((sp, k) => { sp.classList.toggle('on', k <= i); sp.classList.toggle('cur', k === i); }); },
  });
  const mine = preview;
  preview.done.then(() => { if (preview !== mine && preview) return; w.playing = false; preview = null; if (isWizard()) ctx.rerender(); });
}

function launch(ctx, w) {
  const { t } = ctx;
  if (w.launching != null) return;
  const e = estimateFor(w, subOfCid(w.cid));
  if (normalizeTyped(w.typed) !== normalizeTyped(String(e.toCall))) return;
  const scheduled = w.start === 'schedule';
  w.launching = 0;
  ctx.rerender();
  // Busy 600 ms, then "Checking list → Reserving credits → Starting calls" (3 × 400 ms).
  const advance = (k) => soon(ctx, () => {
    w.launching = k;
    // Last step: nothing is left unsaved, so the re-render below mounts without a leave guard (each render
    // gets a fresh ctx, so clearing the guard on this captured ctx alone would not be enough).
    if (k === 3) w.dirty = false;
    if (isWizard()) ctx.rerender();
    if (k < 3) { advance(k + 1); return; }
    const rec = recordFromWizard(ctx, w, scheduled ? 'scheduled' : 'running');
    if (scheduled) { rec.scheduledFor = new Date(startMoment(w).ms).toISOString(); }
    else {
      rec.startedAt = new Date(nowMs()).toISOString(); rec.startedBy = store.get('user.name');
      rec.expectedFinish = new Date(nowMs() + runDuration(w) * 60000).toISOString(); rec.progressPct = 0; rec.credits = 0; rec.charged = 0; rec.planMin = 0;
      rec.progress = { dialled: 0, answered: 0, noAnswer: 0, busy: 0, failed: 0, inProgress: 0, queued: rec.toCall };
    }
    upsert(rec);
    audit(scheduled ? 'campaign.scheduled' : 'campaign.launched', { numbers: rec.toCall, max: e.max, expected: e.expected, token: String(rec.toCall) }, rec.id);
    if (!scheduled) startRun(findCamp(rec.id), { est: e, ui: ctx.ui, t: ctx.t });
    ctx.ui.toast(scheduled ? t('toastScheduled', { name: loc(rec.name), at: dtProse(ctx, rec.scheduledFor) }) : t('toast.T20', { name: loc(rec.name) }), { kind: 'success' });
    ctx.state.wz = null;
    ctx.guard(null);
    ctx.go(`campaigns/${rec.id}`);
  }, k === 1 ? 600 : 400);
  advance(1);
}

// ---------- DETAIL ----------
function detState(ctx, cid) {
  if (!ctx.state.det[cid]) ctx.state.det[cid] = { filter: 'all', q: '', page: 0 };
  return ctx.state.det[cid];
}
const REC_FILTERS = ['all', 'completed', 'no-answer', 'busy', 'failed', 'live', 'queued'];
const recGroup = (r) => (r.status === 'ringing' || r.status === 'in-progress' ? 'live' : r.status === 'canceled' ? 'queued' : r.status);

function detailView(ctx, c) {
  const { t, html: h, icon, fmt } = ctx;
  const k = countsOf(c);
  const est = campaignEstimate(c);
  const run = RUNS.get(c.id);
  const live = c.status === 'running';
  const paused = c.status === 'paused';
  const done = c.status === 'completed';
  const pct = c.status === 'completed' ? 100 : c.progressPct != null ? c.progressPct : Math.round((k.dialled / Math.max(1, k.total)) * 100);
  const finishedCalls = k.answered + k.noAnswer + k.busy + k.failed;
  const ansRate = answerRate(k);
  const waiting = !!(c.retry && c.retry.waiting && (live || paused));
  const head = h`<div class="page-head"><div class="titles"><h1 class="cp-dtitle">${loc(c.name)}${ctx.pageHelp()}</h1>
      <span class="sub row-tight cp-dmeta">${statusChip(ctx, c)}<span>${ctx.ui.describe.sub(c.sub)}</span><span>·</span><span class="mono" translate="no">${c.callerId}</span><span>·</span><span>${t(`purpose.${c.purpose}`)}</span>
      ${c.startedAt ? h`<span>·</span><span>${t('d.started', { time: dtProse(ctx, c.startedAt), name: c.startedBy || '' })}</span>` : ''}
      ${c.status === 'scheduled' ? h`<span>·</span><span>${t('d.startsAt', { at: dtProse(ctx, c.scheduledFor) })}</span><span>·</span><span data-sched-window>${schedWindow(ctx, c)}</span>` : ''}</span></div>
    <div class="tools">
      <button type="button" class="btn" data-action="cd.export">${icon('download', 'ico-sm')}${t('d.export')}</button>
      ${live ? h`<button type="button" class="btn" data-action="cd.pause">${icon('pause', 'ico-sm')}${t('d.pause')}</button>` : ''}
      ${paused ? h`<button type="button" class="btn btn-navy" data-action="cd.resume">${icon('play', 'ico-sm')}${t('d.resume')}</button>` : ''}
      ${live || paused ? h`<button type="button" class="btn btn-danger-ghost" data-action="cd.stop">${icon('x-circle', 'ico-sm')}${t('d.stop')}</button>` : ''}
      ${c.status === 'scheduled' ? h`<a class="btn btn-navy" href="#/campaigns/new?draft=${c.id}&step=3" data-action="cd.edit">${icon('calendar', 'ico-sm')}${t('d.edit')}</a>
        <button type="button" class="btn btn-danger-ghost" data-action="cd.cancel">${icon('x-circle', 'ico-sm')}${t('menu.cancelScheduled')}</button>` : ''}
      <button type="button" class="btn btn-ghost" data-action="cd.duplicate">${icon('copy', 'ico-sm')}${t('menu.duplicate')}</button>
    </div></div>`;
  const incident = c.id === 'bc_01JBK7C1Q2' ? h`<div class="note note-info cp-incident" role="status">${icon('info')}<div class="grow">${t('d.incident')}</div>
      <a class="btn btn-sm" href="#/help/status?inc=20261027" data-action="cd.incident">${t('d.viewStatus')}</a></div>` : '';
  const fbSent = fallbackSent(c, k);
  const tries = (c.triesRun || 1) - 1;
  const finLine = c.demoRunSec
    ? t('d.finishedDemo', { time: fmt.timeShort(c.realFinish || c.finishedAt), sec: fmt.int(c.demoRunSec), tries: tries ? t('d.triesMany', { count: tries }) : t('d.triesOne'), rate: fmt.pct(c.result ? c.result.answeredPct : 0), credits: fmt.credits2(c.credits || k.credits) })
    : t('d.finished', { time: dtProse(ctx, c.finishedAt || nowMs()), rate: fmt.pct(c.result ? c.result.answeredPct : 0), credits: fmt.credits2(c.credits || k.credits) });
  const preSent = preSmsSent(c, k);
  const finished = done && c.result ? h`<div class="note note-ok cp-finished" role="status">${icon('check-circle')}<div class="grow">${finLine}${preSent != null ? h` · <strong data-pre-line>${t('d.preSentLine', { n: fmt.int(preSent) })}</strong>` : ''}${fbSent != null ? h` · <strong data-fb-line>${t('d.fbSentLine', { channel: chName(ctx, c.fallback.channel), n: fmt.int(fbSent) })}</strong>` : ''}</div></div>` : '';
  const stopped = c.status === 'canceled' ? h`<div class="note note-warn" role="status">${icon('x-circle')}<span>${c.stopped ? t('d.stoppedLine', { time: dtProse(ctx, c.canceledAt), n: fmt.int(c.notCalled || 0) }) : t('d.canceledLine', { time: fmt.dateTime(c.canceledAt) })}</span></div>` : '';
  const lowRate = ansRate != null && ansRate < 50 && finishedCalls > 20 ? h`<p class="note note-brand">${icon('sparkles')}<span>${t('d.lowRate')} <a class="linkbtn" href="#/help/article/answer-rate-tips" data-action="cd.tips">${t('d.tips')}</a></span></p>` : '';
  const counters = [
    ['answered', k.answered, ansRate != null ? t('d.rate', { pct: fmt.pct(ansRate) }) : '', 'ok'],
    ['noAnswer', k.noAnswer, c.fallback ? t('d.fbSub', { n: fmt.int(fbSent || 0), channel: chName(ctx, c.fallback.channel) }) : k.phoneOff != null ? t('d.phoneOff', { n: fmt.int(k.phoneOff) }) : '', 'warn'],
    ['busy', k.busy, '', 'warn'],
    ['failed', k.failed, k.f503 != null ? t('d.failedSplit', { a: fmt.int(k.f503), b: fmt.int(k.f404) }) : '', 'err'],
    ['live', k.inProgress, '', 'info'],
    ['queued', k.queued, k.retries != null ? t('d.retries', { n: fmt.int(k.retries) }) : '', ''],
  ];
  return h`<div class="page cp cp-detail" data-cid="${c.id}">${head}${incident}${finished}${stopped}${lowRate}
    <section class="card cp-prog ${paused ? 'is-paused' : ''} ${done ? 'is-done' : ''}" aria-labelledby="cp-prog-h">
      <div class="card-head"><h2 id="cp-prog-h" class="row-tight">${live && !waiting ? raw('<span class="dot dot-ok dot-live" aria-hidden="true"></span>') : ''}${t('d.progress')}</h2>
        ${paused ? h`<span class="chip chip-warn">${icon('pause')}${t('st.paused')}</span>` : waiting ? h`<span class="chip chip-info">${icon('clock')}${t('d.retryChip')}</span>` : ''}
        <span class="hint tnum" data-prog-line>${progLine(ctx, c, k, run)}</span></div>
      <div class="card-body stack-3">
        <div class="row cp-bigbar-row"><span class="progress cp-bigbar ${paused ? 'is-paused' : ''} ${done ? 'progress-ok' : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="${t('progressAria')}" data-prog-bar><i style="width:${pct}%"></i></span><strong class="tnum cp-pct" data-prog-pct>${pct}%</strong></div>
        ${waiting ? h`<div class="note note-info cp-retrywait" role="status">${icon('clock')}<span>${t('d.retryWait', { n: fmt.int(c.retry.n), attempt: c.retry.attempt, of: c.retry.of, m: fmt.int(c.retryAfterMin || 30) })}</span></div>` : ''}
        ${(live || paused) && c.expectedFinish ? h`<span class="hint-xs">${c.retries ? t('d.expectedRetries', { time: fmt.timeShort(c.expectedFinish), count: c.retries, m: fmt.int(c.retryAfterMin || 30) }) : t('d.expected', { time: fmt.timeShort(c.expectedFinish) })}${run ? ` · ${t(c.retries ? 'd.demoPaceRetries' : 'd.demoPace')}` : ''}</span>` : ''}
        <div class="cp-counters" aria-live="off">${counters.map(([key, v, sub, tone]) => h`<div class="cp-ctr ${tone ? 'is-' + tone : ''}"><span class="t">${key === 'queued' && c.status === 'canceled' ? t('d.c.notCalled') : t(`d.c.${key}`)}</span><span class="v tnum" data-ctr="${key}" data-v="${v}">${fmt.int(v)}</span>${sub ? h`<span class="h" data-ctr-sub="${key}">${sub}</span>` : ''}</div>`)}</div>
      </div></section>
    <div class="grid g-3 cp-dgrid">
      ${donutCard(ctx, c, k)}
      ${keysCard(ctx, c, k)}
      ${costSummary(ctx, c, k, est)}
    </div>
    ${recipientsCard(ctx, c)}
  </div>`;
}

/** A scheduled campaign's first calling day: "calls stop at 18:00 (public holiday: Constitution Day)". */
function schedWindow(ctx, c) {
  const ms = Date.parse(c.scheduledFor);
  const win = windowFor(wOfCamp(c), ms);
  return win.hol ? ctx.t('d.windowHol', { to: hhmm(win.to), name: loc(win.hol.name) }) : ctx.t('d.window', { to: hhmm(win.to) });
}

function donutCard(ctx, c, k) {
  const { t, html: h, fmt } = ctx;
  const segs = [
    ['completed', k.answered, '#1FA971'], ['no-answer', k.noAnswer, '#E8941A'], ['busy', k.busy, '#F2B35C'], ['failed', k.failed, '#E5484D'], ['live', k.inProgress, '#2F6FEB'], ['queued', k.queued, '#D5DDEA'],
  ];
  const total = Math.max(1, segs.reduce((s, x) => s + x[1], 0));
  const R = 52;
  const C = 2 * Math.PI * R;
  let off = 0;
  const df = detState(ctx, c.id).filter;
  const arcs = segs.map(([key, v, col]) => {
    const len = (v / total) * C;
    const a = `<circle class="cp-arc ${df === key ? 'is-sel' : ''}" data-arc="${key}" cx="64" cy="64" r="${R}" fill="none" stroke="${col}" stroke-width="18" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" data-action="cd.donut" data-value="${key}"><title>${ctx.esc(t(`d.seg.${key}`))}: ${v}</title></circle>`;
    off += len;
    return a;
  }).join('');
  return h`<section class="card cp-donut" aria-labelledby="cp-donut-h"><div class="card-head"><h3 id="cp-donut-h">${t('d.outcomes')}</h3></div>
    <div class="card-body cp-donut-in"><svg viewBox="0 0 128 128" class="cp-donut-svg" role="img" aria-label="${t('d.donutAria', { a: k.answered, b: k.noAnswer, c: k.busy, d: k.failed })}" data-donut>${raw(`<g transform="rotate(-90 64 64)">${arcs}</g>`)}<text x="64" y="62" text-anchor="middle" class="cp-donut-v" data-donut-v>${fmt.int(k.answered)}</text><text x="64" y="80" text-anchor="middle" class="cp-donut-l">${t('d.c.answered')}</text></svg>
      <ul class="cp-legend">${segs.map(([key, v, col]) => h`<li><button type="button" class="cp-leg" data-action="cd.donut" data-value="${key}" aria-pressed="${df === key}"><span class="sw" style="background:${col}"></span><span class="grow">${t(`d.seg.${key}`)}</span><span class="mono" data-leg="${key}">${fmt.int(v)}</span></button></li>`)}</ul></div></section>`;
}

function keysCard(ctx, c, k) {
  const { t, html: h, fmt } = ctx;
  const keys = k.keys;
  const actions = c.keys || {};
  if (!keys || (!k.answered && !RUNS.get(c.id))) {
    return h`<section class="card cp-keyscard"><div class="card-head"><h3>${ctx.term(t('d.keys'), 'dtmf')}</h3></div><div class="empty"><span class="hint">${t('d.keysNone')}</span></div></section>`;
  }
  const items = [['1', keys[1]], ['2', keys[2]], ['9', keys[9]], ['none', keys.none]];
  const max = Math.max(1, ...items.map((x) => x[1] || 0));
  return h`<section class="card cp-keyscard" aria-labelledby="cp-keys-h"><div class="card-head"><h3 id="cp-keys-h">${ctx.term(t('d.keys'), 'dtmf')}</h3></div>
    <div class="card-body stack-3">${items.map(([key, v]) => h`<div><div class="row" style="justify-content:space-between;gap:8px;flex-wrap:nowrap"><span class="clip">${key === 'none' ? t('d.noKey') : t('d.keyLine', { key, action: t(`key.${actions[key] === 'staff' ? 'transfer' : actions[key] || 'confirm'}`, { key }) })}</span><span class="mono" data-key="${key}">${fmt.int(v || 0)}</span></div>
      <span class="progress cp-kbar" aria-hidden="true"><i data-keybar="${key}" style="width:${Math.round(((v || 0) / max) * 100)}%;background:${key === '9' ? 'var(--red)' : key === 'none' ? 'var(--muted)' : 'var(--navy)'}"></i></span></div>`)}
      ${keys[9] ? h`<p class="hint-xs">${ctx.term(t('d.optOutNote', { n: fmt.int(keys[9]) }), 'opt_out')}</p>` : ''}</div></section>`;
}

/** While a campaign runs: credits so far ÷ finished attempts × the whole list. */
function paceOf(c, k) {
  const fin = (k.answered || 0) + (k.noAnswer || 0) + (k.busy || 0) + (k.failed || 0);
  if (!['running', 'paused'].includes(c.status) || !fin || !k.total) return null;
  return round2(((k.credits != null ? k.credits : c.credits || 0) / fin) * k.total);
}
/** What the whole list should cost: the ceiling, or (no ceiling) the current pace, else the launch estimate. */
const wholeOf = (est, pace) => (est.max != null ? est.max : pace != null ? pace : est.expected || 0);
function costSummary(ctx, c, k, est) {
  const { t, html: h, fmt } = ctx;
  const used = k.credits != null ? k.credits : c.credits || 0;
  const pace = paceOf(c, k);
  const whole = wholeOf(est, pace);
  const pctUsed = whole ? Math.min(100, Math.round((used / whole) * 100)) : 0;
  // On a plan: the estimate at the plan rate with its plan minutes; a run made on the plan also shows the minutes it
  // took from the plan minutes and the credits it charged (only minutes beyond them and extras).
  const plan = est.onPlan ? activePlan() : null;
  const ran = plan && c.planMin != null;
  return h`<section class="card cp-costsum" aria-labelledby="cp-cs-h"><div class="card-head"><h3 id="cp-cs-h">${t('d.cost')}</h3><span class="chip chip-warn" tabindex="0" data-tip-key="common.plannedPricesTip">${t('plannedShort')}</span></div>
    <div class="card-body stack-3"><div class="row" style="align-items:baseline;gap:6px"><span class="cp-big tnum" data-used>${fmt.credits2(used)}</span><span class="hint" data-whole>/ ${est.max == null ? t('credits.aboutTotal', { n: fmt.credits2(whole) }) : plan ? t('credits.upToPlan', { n: fmt.credits2(est.max), min: planMinText(ctx, est.maxMin, true) }) : t('credits.upTo', { n: fmt.credits2(est.max) })}</span></div>
      <span class="progress" aria-hidden="true"><i data-used-bar style="width:${pctUsed}%"></i></span>
      <div class="kv"><span class="k">${ctx.term(t('d.billedMin'), 'billing_minute')}</span><span class="v tnum" data-billed>${fmt.int(c.billedMin != null ? c.billedMin : k.answered)}</span></div>
      ${ran ? h`<div class="kv"><span class="k">${t('d.planMin')}</span><span class="v tnum" data-planmin>${t('d.planMinV', { n: fmt.int(c.planMin) })}</span></div>
        <div class="kv"><span class="k">${t('d.charged')}</span><span class="v tnum" data-charged>${fmt.credits2(c.charged || 0)}</span></div>` : ''}
      ${est.expected ? h`<div class="kv"><span class="k">${t('d.expectedCost')}</span><span class="v tnum">≈ ${fmt.credits2(est.expected)}${plan ? h`<span class="hint-xs cp-block">≈ ${planMinText(ctx, est.expMin, true)}</span>` : ''}</span></div>` : ''}
      ${plan ? h`<p class="hint-xs">${t('d.planHint', { rate: fmt.rate(plan.rate) })}</p>` : ''}
      ${pace != null ? h`<div class="kv"><span class="k">${t('d.paceCost')}</span><span class="v tnum" data-pace>≈ ${fmt.credits2(pace)}</span></div>` : ''}
      ${est.paths && est.paths.unbounded ? h`<p class="hint-xs">${t('d.noCeiling')}</p>` : est.paths && est.paths.hasTransfer ? h`<p class="hint-xs">${t('d.transferNote', { n: est.paths.capMin })}</p>` : ''}
      ${c.preSms ? h`<div class="kv cp-pre-line"><span class="k">${t('d.preSentK')}</span><span class="v tnum" data-pre>${fmt.int(preSmsSent(c, k) || 0)}</span></div>
        <p class="hint-xs">${t('d.preHint')}</p>` : ''}
      ${c.fallback ? h`<div class="kv cp-fb-line"><span class="k">${t('d.fbSentK', { channel: chName(ctx, c.fallback.channel) })}</span><span class="v tnum" data-fb>${fmt.int(fallbackSent(c, k) || 0)}</span></div>
        <p class="hint-xs">${t('d.fbHint', { channel: chName(ctx, c.fallback.channel) })}</p>` : ''}
      <div class="kv"><span class="k">${t('d.settings')}</span><span class="v">${t('d.settingsV', { cps: c.cps || 2, conc: c.concurrent || 20, retries: c.retries != null ? c.retries : 2, wait: c.retryAfterMin || 30 })}</span></div>
      <p class="hint-xs">${t('cost.foot')}</p>
      <div><button type="button" class="btn btn-sm" data-action="cd.play">${ctx.icon('play', 'ico-sm')}${t('d.playMsg')}</button></div></div></section>`;
}

function recipientsCard(ctx, c) {
  const { t, html: h, icon, fmt } = ctx;
  const ds = detState(ctx, c.id);
  const all = recipientsOf(c);
  const q = ds.q.trim().toLowerCase().replace(/[\s-]/g, '');
  const sorted = all.slice().sort((a, b) => (b.at || 0) - (a.at || 0));
  const rows = sorted.filter((r) => (ds.filter === 'all' || recGroup(r) === ds.filter) && (!q || r.phone.replace(/[\s-]/g, '').toLowerCase().includes(q) || (r.n != null && nameOf(r.n).toLowerCase().includes(q))));
  const per = 20;
  const pages = Math.max(1, Math.ceil(rows.length / per));
  ds.page = Math.min(ds.page, pages - 1);
  const slice = rows.slice(ds.page * per, ds.page * per + per);
  const counts = Object.fromEntries(REC_FILTERS.map((f) => [f, f === 'all' ? all.length : all.filter((r) => recGroup(r) === f).length]));
  return h`<section class="card cp-recips" aria-labelledby="cp-rec-h">
    <div class="card-head cp-filters"><h3 id="cp-rec-h">${t('d.recipients')}</h3>
      <select class="select cp-recfilter" data-field="cdFilter" aria-label="${t('d.filterAria')}" data-action="cd.filter">${REC_FILTERS.map((f) => h`<option value="${f}" ${raw(ds.filter === f ? 'selected' : '')}>${t(`d.seg.${f}`)} (${fmt.int(counts[f])})</option>`)}</select>
      <label class="cp-search">${icon('search', 'ico-sm')}<input class="input" type="search" data-field="cdSearch" value="${ds.q}" placeholder="${t('d.searchPh')}" aria-label="${t('d.searchPh')}" data-action="cd.search"></label></div>
    ${slice.length ? h`<div class="tbl-wrap"><table class="tbl cp-rtbl"><thead><tr><th>${t('d.r.phone')}</th><th>${t('d.r.name')}</th><th>${t('d.r.status')}</th><th class="num">${t('d.r.attempt')}</th><th>${t('d.r.last')}</th><th>${ctx.term(t('d.r.key'), 'dtmf')}</th><th class="num">${t('d.r.talk')}</th><th class="num">${t('d.r.credits')}</th><th><span class="sr-only">${t('col.actions')}</span></th></tr></thead>
      <tbody data-rec-body>${slice.map((r, i) => recipientRow(ctx, c, r, ds.page * per + i))}</tbody></table></div>
      <div class="card-foot row cp-pager"><span class="hint-xs grow">${t('d.pageLine', { from: fmt.int(ds.page * per + 1), to: fmt.int(ds.page * per + slice.length), total: fmt.int(rows.length) })}</span>
        ${ds.page > 0 ? h`<button type="button" class="btn btn-sm" data-action="cd.page.prev">${icon('chevron-left', 'ico-sm')}${t('d.prev')}</button>` : ''}
        ${ds.page < pages - 1 ? h`<button type="button" class="btn btn-sm" data-action="cd.page.next">${t('d.next')}${icon('chevron-right', 'ico-sm')}</button>` : ''}</div>`
      : h`<div class="empty empty-center"><strong>${t('d.noRows')}</strong><button type="button" class="btn btn-sm" data-action="cd.clear">${t('nores.clear')}</button></div>`}
  </section>`;
}

function recipientRow(ctx, c, r, idx) {
  const { t, html: h, fmt, icon } = ctx;
  const retryable = r.status === 'failed' || r.status === 'no-answer' || r.status === 'busy';
  return h`<tr class="${r.fresh ? 'new-row' : ''}">
    <td class="mono"><button type="button" class="linkbtn mono" data-action="cd.row" data-value="${idx}" data-phone="${r.phone}" translate="no">${r.phone}</button></td>
    <td>${r.n == null ? '—' : nameOf(r.n)}</td>
    <td>${ctx.ui.describe.statusChip(r.status === 'canceled' ? 'canceled' : r.status)}${r.retryAt && retryable ? h` <span class="hint-xs nowrap">${t('d.retryAt', { time: hhmmOf(r.retryAt) })}</span>` : r.retryIn && retryable ? h` <span class="hint-xs nowrap">${t('d.retryIn', { m: r.retryIn })}</span>` : ''}${r.fbSent ? h` <span class="hint-xs nowrap">${t('d.fbRow', { channel: chName(ctx, r.fbSent) })}</span>` : ''}</td>
    <td class="num mono">${r.attempt || '—'}</td>
    <td class="mono">${r.at ? fmt.time(r.at) : '—'}</td>
    <td>${r.key ? h`<span class="cp-keycap sm">${r.key}</span>${r.transferred ? h` <span class="hint-xs">${t('d.transferred')}</span>` : ''}` : '—'}</td>
    <td class="num mono">${r.sec ? fmt.duration(r.sec) : '—'}</td>
    <td class="num mono">${fmt.credits2(r.credits || 0)}</td>
    <td class="num">${retryable && (c.status === 'running' || c.status === 'paused') ? h`<button type="button" class="btn btn-ghost btn-sm btn-icon" data-action="cd.row.menu" data-value="${idx}" data-phone="${r.phone}" aria-label="${t('d.rowMenu', { phone: r.phone })}" aria-haspopup="menu">${icon('more')}</button>` : ''}</td></tr>`;
}

/** Recipient detail: log-backed rows open the Logs drawer; older attempts open a summary here. */
function openRecipient(ctx, c, phone) {
  const { t, html: h, fmt } = ctx;
  const r = recipientsOf(c).find((x) => x.phone === phone);
  if (!r) return;
  if (r.callId && (store.get('calls') || []).some((x) => x.id === r.callId) || (r.callId && r.live)) { ctx.go(`logs?call=${r.callId}`); return; }
  ctx.ui.modal({
    title: t('att.title', { phone: r.phone }), size: 'sm',
    body: h`<div class="stack-3"><div class="row-tight">${ctx.ui.describe.statusChip(r.status)}<span class="hint">${REASON_OF(r, ctx.t)}</span></div>
      <div class="kv"><span class="k">${t('d.r.name')}</span><span class="v">${r.n == null ? '—' : nameOf(r.n)}</span></div>
      <div class="kv"><span class="k">${t('d.r.attempt')}</span><span class="v">${r.attempt || '—'}</span></div>
      <div class="kv"><span class="k">${t('d.r.last')}</span><span class="v">${r.at ? dtProse(ctx, r.at) : '—'}</span></div>
      ${r.sip ? h`<div class="kv"><span class="k">${ctx.term('SIP', 'sip_code')}</span><span class="v mono">${r.sip}${r.q850 ? ` · Q.850 ${r.q850}` : ''}</span></div>` : ''}
      <div class="kv"><span class="k">${t('d.r.credits')}</span><span class="v mono">${fmt.credits2(r.credits || 0)}</span></div>
      <p class="hint-xs">${t('att.note')}</p></div>`,
    buttons: [{ label: t('att.logs'), kind: '', onClick: () => ctx.go(`logs?src=${c.id}`) }, { label: t('common.close'), kind: 'navy' }],
  });
}

function playMessage(ctx, c) {
  const { t } = ctx;
  const tts = ctx.ui.audio.tts;
  ctx.ui.audio.unlock();
  stopPreview();
  const lang = getLang();
  const kind = (c.script && c.script.kind) || SCRIPT_OF[c.id] || 'reminder';
  const parts = (tIn(lang, speakKey(kind)) || []).map((p) => ({ text: p }));
  const pick = tts.pick(LANGS[lang].tts);
  const note = !tts.supported() || pick.match === 'none' ? t('s2.noVoice') : null;
  preview = tts.speak(parts, { lang: LANGS[lang].tts, premium: !!(c.script && c.script.premium) });
  ctx.ui.toast(note || t('d.playing'), { kind: 'info', demo: true });
}

// ---------- in-place updates while a campaign runs (no full re-render every 500 ms) ----------
/** "1,200 of 1,874 dialled", or on a retry "Try 2 of 3: 210 of 716 numbers called again". */
function progLine(ctx, c, k, run) {
  const { t, fmt } = ctx;
  if (run && run.wave > 1 && run.phase === 'dial' && (c.status === 'running' || c.status === 'paused')) return t('d.retryRun', { attempt: run.wave, of: run.maxAtt, dialled: fmt.int(run.qd), total: fmt.int(run.queue.length) });
  return t('d.progLine', { dialled: fmt.int(k.dialled), total: fmt.int(k.total) });
}
function patchDetail(root, ctx, c) {
  const k = countsOf(c);
  const fmt = ctx.fmt;
  const pct = c.progressPct || 0;
  const bar = root.querySelector('[data-prog-bar]');
  if (bar) { bar.setAttribute('aria-valuenow', pct); const i = bar.querySelector('i'); if (i) i.style.width = `${pct}%`; }
  const p = root.querySelector('[data-prog-pct]'); if (p) p.textContent = `${pct}%`;
  const line = root.querySelector('[data-prog-line]'); if (line) line.textContent = progLine(ctx, c, k, RUNS.get(c.id));
  const map = { answered: k.answered, noAnswer: k.noAnswer, busy: k.busy, failed: k.failed, live: k.inProgress, queued: k.queued };
  // Counters, donut and legend take the same numbers in the same tick (no count-up lag between them).
  for (const [key, v] of Object.entries(map)) { const el = root.querySelector(`[data-ctr="${key}"]`); if (el) { el.dataset.v = String(v); el.textContent = fmt.int(v); } }
  const fin = k.answered + k.noAnswer + k.busy + k.failed;
  const sub = root.querySelector('[data-ctr-sub="answered"]'); if (sub && fin) sub.textContent = ctx.t('d.rate', { pct: fmt.pct(answerRate(k)) });
  if (c.preSms) { const pv = root.querySelector('[data-pre]'); if (pv) pv.textContent = fmt.int(preSmsSent(c, k) || 0); }
  if (c.fallback) {
    const n = fallbackSent(c, k) || 0;
    const fbv = root.querySelector('[data-fb]'); if (fbv) fbv.textContent = fmt.int(n);
    const fbs = root.querySelector('[data-ctr-sub="noAnswer"]'); if (fbs) fbs.textContent = ctx.t('d.fbSub', { n: fmt.int(n), channel: chName(ctx, c.fallback.channel) });
  }
  // donut + legend
  const segs = [['completed', k.answered], ['no-answer', k.noAnswer], ['busy', k.busy], ['failed', k.failed], ['live', k.inProgress], ['queued', k.queued]];
  const total = Math.max(1, segs.reduce((s, x) => s + x[1], 0));
  const C = 2 * Math.PI * 52;
  let off = 0;
  for (const [key, v] of segs) {
    const arc = root.querySelector(`[data-arc="${key}"]`);
    const len = (v / total) * C;
    if (arc) { arc.setAttribute('stroke-dasharray', `${len.toFixed(2)} ${(C - len).toFixed(2)}`); arc.setAttribute('stroke-dashoffset', (-off).toFixed(2)); }
    off += len;
    const lg = root.querySelector(`[data-leg="${key}"]`); if (lg) lg.textContent = fmt.int(v);
  }
  const dv = root.querySelector('[data-donut-v]'); if (dv) dv.textContent = fmt.int(k.answered);
  if (k.keys) {
    const max = Math.max(1, k.keys[1], k.keys[2], k.keys[9], k.keys.none);
    for (const key of ['1', '2', '9', 'none']) {
      const el = root.querySelector(`[data-key="${key}"]`); if (el) el.textContent = fmt.int(k.keys[key] || 0);
      const b = root.querySelector(`[data-keybar="${key}"]`); if (b) b.style.width = `${Math.round(((k.keys[key] || 0) / max) * 100)}%`;
    }
  }
  const used = root.querySelector('[data-used]'); if (used) used.textContent = fmt.credits2(k.credits || 0);
  const est = campaignEstimate(c);
  const whole = wholeOf(est, paceOf(c, k));
  const ub = root.querySelector('[data-used-bar]'); if (ub && whole) ub.style.width = `${Math.min(100, Math.round(((k.credits || 0) / whole) * 100))}%`;
  const wh = root.querySelector('[data-whole]'); if (wh && est.max == null) wh.textContent = `/ ${ctx.t('credits.aboutTotal', { n: fmt.credits2(whole) })}`;
  const pc = root.querySelector('[data-pace]'); if (pc) { const v = paceOf(c, k); if (v != null) pc.textContent = `≈ ${fmt.credits2(v)}`; }
  const billed = root.querySelector('[data-billed]'); if (billed) billed.textContent = fmt.int(c.billedMin || k.answered);
  const pm = root.querySelector('[data-planmin]'); if (pm) pm.textContent = ctx.t('d.planMinV', { n: fmt.int(c.planMin || 0) });
  const ch = root.querySelector('[data-charged]'); if (ch) ch.textContent = fmt.credits2(c.charged || 0);
  // newest attempts slide into the table (first page, no filter)
  const ds = detState(ctx, c.id);
  const body = root.querySelector('[data-rec-body]');
  if (body && ds.page === 0 && ds.filter === 'all' && !ds.q) {
    const sorted = recipientsOf(c).slice().sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 20);
    body.innerHTML = sorted.map((r, i) => String(recipientRow(ctx, c, { ...r, fresh: r.at && nowMs() - r.at < TICK_MS * 1.5 }, i))).join('');
  }
  // The recipient filter counts follow the run too (not only when the campaign ends).
  const sel = root.querySelector('[data-field="cdFilter"]');
  if (sel) {
    const all = recipientsOf(c);
    for (const o of sel.options) {
      const n = o.value === 'all' ? all.length : all.filter((r) => recGroup(r) === o.value).length;
      const txt = `${ctx.t(`d.seg.${o.value}`)} (${fmt.int(n)})`;
      if (o.textContent !== txt) o.textContent = txt;
    }
  }
}

// ---------- screen contract ----------
export function render(ctx) {
  const p = ctx.params.path[0];
  if (!p) return listView(ctx);
  if (p === 'new') return wizardView(ctx);
  const c = findCamp(p);
  if (!c) {
    const { t, html: h, icon } = ctx;
    return h`<div class="page cp"><div class="card"><div class="empty empty-center"><span class="art">${icon('megaphone')}</span><h2>${t('notFound.title')}</h2><p class="hint">${t('notFound.body')}</p>
      <a class="btn btn-navy" href="#/campaigns" data-action="cp.back">${t('notFound.back')}</a></div></div></div>`;
  }
  if (c.status === 'draft') return wizardView(Object.assign(Object.create(ctx), { params: { ...ctx.params, query: { ...ctx.params.query, draft: c.id } } }));
  return detailView(ctx, c);
}

export function mount(root, ctx) {
  const { t } = ctx;
  TTS = ctx.ui.audio.tts;
  ctx.ui.audio.tts.ready();
  const p = ctx.params.path[0];
  RT = { ui: ctx.ui, t: ctx.t };
  // A deep link to a draft goes to the wizard address (linkable, survives reload).
  if (p && p !== 'new') { const c0 = findCamp(p); if (c0 && c0.status === 'draft') { ctx.later(() => ctx.go(`campaigns/new?draft=${c0.id}`, { replace: true }), 0); } }
  if (!p) mountList(root, ctx);
  else if (p === 'new') mountWizard(root, ctx);
  else { const c = findCamp(p); if (c && c.status !== 'draft') mountDetail(root, ctx, c); else ctx.actions(root, { 'cp.back': () => {} }); }
  ctx.cleanup(() => { if (!/^#\/campaigns\/new/.test(location.hash)) stopPreview(); });
  // Fresh-row flash only once.
  ctx.later(() => { const l = store.get('campaigns') || []; if (l.some((x) => x.fresh)) store.set('campaigns', l.map((x) => (x.fresh ? { ...x, fresh: false } : x))); }, 1700);
}

function mountList(root, ctx) {
  ctx.actions(root, {
    'cp.new': (el, ev) => { ev.preventDefault(); if (ctx.state.wz && ctx.state.wz.key === 'new' && !ctx.state.wz.dirty) ctx.state.wz = null; ctx.go('campaigns/new'); },
    'cp.empty.new': (el, ev) => { ev.preventDefault(); ctx.go('campaigns/new'); },
    'cp.empty.guide': () => {},
    'cp.live': () => {},
    'cp.search': () => {},
    'cp.filter': (el) => { ctx.setState({ filter: el.dataset.value }); history.replaceState(history.state, '', `${location.pathname}${location.search}#/campaigns${el.dataset.value === 'all' ? '' : `?status=${el.dataset.value}`}`); },
    'cp.nores.clear': () => { ctx.setState({ filter: 'all', q: '' }); history.replaceState(history.state, '', '#/campaigns'); },
    'cp.row': () => {},
    'cp.menu': (el) => openRowMenu(ctx, el),
  });
  ctx.inputs(root, { q: (v) => { ctx.state.q = v; ctx.rerender(); } });
  ctx.watch('campaigns', 'mode', 'env');
}

function mountWizard(root, ctx) {
  const { t } = ctx;
  const w = ensureWizard(ctx);
  if (w.dirty) ctx.guard(async () => {
    const ok = await ctx.ui.confirm({ title: t('wz.leaveTitle'), body: t('wz.leaveBody'), confirmLabel: t('wz.leaveYes'), cancelLabel: t('wz.leaveStay') });
    if (ok) { ctx.state.wz = null; stopPreview(); }
    return ok;
  });
  const dirty = () => { if (!w.dirty) { w.dirty = true; ctx.guard(async () => { const ok = await ctx.ui.confirm({ title: t('wz.leaveTitle'), body: t('wz.leaveBody'), confirmLabel: t('wz.leaveYes'), cancelLabel: t('wz.leaveStay') }); if (ok) { ctx.state.wz = null; stopPreview(); } return ok; }); } };
  const go = (n) => { w.step = n; w.reached = Math.max(w.reached, n); stopPreview(); w.playing = false; w.stepFromQuery = n; ctx.rerender(); const card = root.querySelector('.cp-steps'); if (card && card.getBoundingClientRect().top < 0) card.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' }); const hdr = root.querySelector('#cp-step-h'); if (hdr) { hdr.setAttribute('tabindex', '-1'); hdr.focus({ preventScroll: true }); } };
  const loadAudience = (fileName) => {
    const s = sampleAudience();
    w.awaiting = null;
    w.loading = { pct: 0, total: s.total };
    w.audience = null;
    dirty();
    ctx.rerender();
    const t0 = Date.now();
    const dur = reducedMotion() ? 300 : 1200;
    const tok = (w.loadTok = (w.loadTok || 0) + 1);
    const iv = setInterval(() => {
      if (w.loadTok !== tok || ctx.state.wz !== w) { clearInterval(iv); return; }
      const pct = Math.min(100, Math.round(((Date.now() - t0) / dur) * 100));
      w.loading.pct = pct;
      const bar = document.querySelector('[data-read-bar]'); if (bar) bar.style.width = `${pct}%`;
      const lbl = document.querySelector('[data-read-pct]'); if (lbl) lbl.textContent = `${pct}%`;
      if (pct >= 100) {
        clearInterval(iv);
        w.loading = null;
        w.audience = { ...s, file: fileName || s.file, source: fileName ? 'upload' : 'sample' };
        w.err1 = null;
        w.dnc = 'idle';
        if (isWizard()) ctx.rerender();
      }
    }, 60);
  };
  const pickFile = (kind) => {
    w.awaiting = kind;
    ctx.rerender();
    const inp = root.querySelector(`[data-file="${kind}"]`);
    if (inp) inp.click();
  };
  const acceptAudio = (file) => {
    w.awaiting = null;
    w.audioErr = null;
    if (!file) { ctx.rerender(); return; }
    if (!/\.(mp3|wav)$/i.test(file.name) && !/audio\/(mpeg|wav|x-wav)/.test(file.type)) { w.audioErr = t('s2.audioType'); ctx.rerender(); return; }
    if (file.size > 4 * 1048576) { w.audioErr = t('s2.audioBig'); ctx.rerender(); return; }
    const url = URL.createObjectURL(file);
    w.audioFile = { name: file.name, size: file.size, sec: null, url };
    dirty();
    try { const au = new Audio(); au.preload = 'metadata'; au.onloadedmetadata = () => { if (isFinite(au.duration)) { w.audioFile.sec = au.duration; if (isWizard()) ctx.rerender(); } }; au.src = url; } catch { /* duration unknown */ }
    ctx.rerender();
  };
  const insertVar = (el) => {
    const ta = root.querySelector('[data-field="wcText"]');
    const ins = `{${el.dataset.value}}`;
    const cur = scriptText(w);
    const focused = ta && document.activeElement === ta;
    const saved = w.caret && w.caret.lang === w.lang ? w.caret : null;
    const pos = Math.min(cur.length, focused ? ta.selectionStart : saved ? saved.start : cur.length);
    const end = Math.min(cur.length, Math.max(pos, focused ? ta.selectionEnd : saved ? saved.end : pos));
    w.text = cur.slice(0, pos) + ins + cur.slice(end);
    w.caret = { start: pos + ins.length, end: pos + ins.length, lang: w.lang };
    dirty();
    ctx.rerender();
    const nt = root.querySelector('[data-field="wcText"]');
    if (nt) { nt.focus(); nt.setSelectionRange(pos + ins.length, pos + ins.length); }
  };

  ctx.actions(root, {
    'wc.close': (el, ev) => { ev.preventDefault(); ctx.go('campaigns'); },
    'wc.learn': () => {},
    'wc.name': () => {}, 'wc.2.transfermin': () => {}, 'wc.cid': () => {}, 'wc.purpose': () => {}, 'wc.2.text': () => {}, 'wc.2.rate': () => {}, 'wc.3.hours': () => {}, 'wc.3.cap': () => {}, 'wc.4.confirm': () => {},
    'wc.step': (el) => { const n = Number(el.dataset.value); if (n <= w.reached && n !== w.step) go(n); },
    'wc.back': () => { if (w.step > 1) go(w.step - 1); },
    'wc.next': () => {
      if (!validate(ctx, w, w.step)) { ctx.rerender(); const e = root.querySelector('.field-err, [aria-invalid="true"]'); if (e) { e.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' }); if (e.focus) e.focus({ preventScroll: true }); } return; }
      go(w.step + 1);
    },
    'wc.save': () => {
      const status = w.scheduledStatus === 'scheduled' ? 'scheduled' : 'draft';
      const rec = recordFromWizard(ctx, w, status);
      if (status === 'scheduled') rec.scheduledFor = new Date(startMoment(w).ms).toISOString();
      upsert(rec);
      ctx.ui.toast(status === 'scheduled' ? t('toast.T02') : t('toast.T03'), { kind: 'success' });
      ctx.state.wz = null;
      ctx.guard(null);
      ctx.go('campaigns');
    },
    'wc.1.preset': (el) => { const v = el.dataset.value; if (!PRESETS.includes(v)) return; applyPreset(w, v); dirty(); ctx.rerender(); },
    'wc.3.pre': () => { w.preSms = !w.preSms; dirty(); ctx.rerender(); const b = root.querySelector('[data-action="wc.3.pre"]'); if (b) b.focus(); },
    'wc.1.upload': () => pickFile('csv'),
    'wc.1.sample': () => loadAudience(null),
    // person_id is optional: two numbers with the same person_id are one person (Payment reminder: 1 answered contact a day).
    'wc.1.template': () => ctx.ui.download('ants-campaign-template.csv', '﻿phone,name,date,time,clinic,person_id\r\n081-xxx-4821,Waraporn,2026-11-02,10:30,Example Clinic Sukhumvit,C-1001\r\n082-xxx-5150,Waraporn,2026-11-02,10:30,Example Clinic Sukhumvit,C-1001\r\n089-xxx-9034,Somsak,2026-11-02,11:00,Example Clinic Sukhumvit,C-1002\r\n095-xxx-6632,Napa,2026-11-03,09:30,Example Clinic Sukhumvit,C-1003\r\n', 'text/csv;charset=utf-8'),
    'wc.1.sampledl': () => {
      const s = sampleAudience();
      const lines = ['phone,name,date,time,clinic,person_id', ...s.rows.map((r) => `${r.phone},${NAMES[r.n % NAMES.length].en},${r.date},${r.time},Example Clinic Sukhumvit,${r.pid || ''}`)];
      ctx.ui.download(SAMPLE_FILE, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
    },
    'wc.1.pastetoggle': (el, ev) => { ev.preventDefault(); w.pasteOpen = !w.pasteOpen; ctx.rerender(); },
    'wc.1.paste': () => {
      const a = parsePaste(w.paste);
      if (!a.total) { w.err1 = t('s1.pasteEmpty'); ctx.rerender(); return; }
      w.audience = a; w.err1 = null; dirty(); ctx.rerender();
    },
    'wc.1.problems': () => { w.problemsOnly = !w.problemsOnly; ctx.rerender(); },
    'wc.2.mode': (el) => { w.mode = el.dataset.value; stopPreview(); w.playing = false; dirty(); ctx.rerender(); },
    'wc.2.audio': () => pickFile('audio'),
    'wc.2.var.name': (el) => insertVar(el), 'wc.2.var.date': (el) => insertVar(el), 'wc.2.var.time': (el) => insertVar(el), 'wc.2.var.clinic': (el) => insertVar(el),
    'wc.2.fix': () => { w.text = fixParticles(w.gender, scriptText(w)); dirty(); ctx.rerender(); },
    'wc.2.lang': (el) => { if (w.text != null && w.text === builtinText(w.lang, w.kind)) w.text = null; w.lang = el.dataset.value; stopPreview(); w.playing = false; w.voiceNote = null; dirty(); ctx.rerender(); },
    'wc.2.voice': (el) => { w.voice = el.dataset.value; dirty(); ctx.rerender(); },
    'wc.2.play': () => playSample(ctx, w),
    'wc.2.keys': () => {
      const free = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].find((k) => !w.keys.some((x) => x.key === k));
      if (!free) return;
      w.keys = [...w.keys, { key: free, action: free === '9' ? 'opt-out' : 'repeat' }].sort((a, b) => (a.key === '0' ? 10 : +a.key) - (b.key === '0' ? 10 : +b.key));
      dirty();
      ctx.rerender();
    },
    'wc.2.keyremove': (el) => {
      const i = Number(el.dataset.value);
      const row = w.keys[i];
      w.keys = w.keys.filter((_, k) => k !== i);
      dirty();
      ctx.rerender();
      ctx.ui.toast(t('s2.keyRemoved', { key: row.key }), { kind: 'info', timeout: 10000, action: { label: t('common.undo'), onClick: () => { w.keys = [...w.keys.slice(0, i), row, ...w.keys.slice(i)]; if (isWizard()) ctx.rerender(); } } });
    },
    'wc.3.start': (el) => { w.start = el.dataset.value; dirty(); ctx.rerender(); },
    'wc.3.days': (el) => { const d = Number(el.dataset.value); w.days = w.days.includes(d) ? w.days.filter((x) => x !== d) : [...w.days, d]; dirty(); ctx.rerender(); },
    'wc.3.fb': () => { w.fb = !w.fb; dirty(); ctx.rerender(); const b = root.querySelector('[data-action="wc.3.fb"]'); if (b) b.focus(); },
    'wc.3.fbch': (el) => { w.fbChannel = el.dataset.value === 'line' ? 'line' : 'sms'; dirty(); ctx.rerender(); },
    'wc.3.retry': (el) => { w.retries = Math.max(0, Math.min(3, w.retries + Number(el.dataset.value))); dirty(); ctx.rerender(); },
    'wc.3.wait': (el) => { w.wait = Number(el.dataset.value); dirty(); ctx.rerender(); },
    'wc.3.cps': (el) => { w.cps = Math.max(1, Math.min(PRICES.cpsDefault, w.cps + Number(el.dataset.value))); dirty(); ctx.rerender(); },
    'wc.3.conc': (el) => { w.conc = Math.max(5, Math.min(20, w.conc + Number(el.dataset.value))); dirty(); ctx.rerender(); },
    'wc.3.dnc': () => {
      if (w.dnc === 'run') return;
      w.dnc = 'run';
      ctx.rerender();
      soon(ctx, () => { w.dnc = 'done'; if (isWizard()) ctx.rerender(); }, 800);
    },
    'wc.4.topup': () => ctx.ui.topup(),
    'wc.4.limits': () => ctx.ui.spendingLimits({ onSaved: () => isWizard() && ctx.rerender() }),
    'wc.golive': () => ctx.ui.goLive(),
    'wc.testme': () => ctx.ui.dialer.open({ source: 'campaigns', template: 'reminder' }),
    'wc.launch': () => launch(ctx, w),
  });
  ctx.inputs(root, {
    wcName: (v) => { w.name = v; dirty(); },
    wcCid: (v) => { w.cid = v; dirty(); ctx.rerender(); },
    wcPurpose: (v) => {
      purposeChanged(w, v);
      dirty();
      ctx.rerender();
    },
    wcConsent: (v) => { w.consent = !!v; dirty(); },
    wcPaste: (v) => { w.paste = v; },
    wcText: (v) => { w.text = v; dirty(); },
    wcGender: (v) => { w.gender = v; dirty(); ctx.rerender(); },
    wcRate: (v, el) => { w.rate = Number(v) || 1; const o = root.querySelector('[data-rate-out]'); if (o) o.textContent = `${ctx.fmt.num(w.rate, 2)}×`; el.setAttribute('aria-valuetext', `${ctx.fmt.num(w.rate, 2)}×`); },
    wcTransferMin: (v) => { w.transferMin = Number(v) || 0; dirty(); ctx.rerender(); },
    wcKey: (v, el) => { const k = w.keys[Number(el.dataset.index)]; if (k) { k.action = v; dirty(); ctx.rerender(); } },
    wcDate: (v) => { w.date = v || w.date; dirty(); ctx.rerender(); },
    wcTime: (v) => { w.time = v || w.time; dirty(); ctx.rerender(); },
    wcFrom: (v) => { w.hoursFrom = v || w.hoursFrom; dirty(); },
    wcTo: (v) => { w.hoursTo = v || w.hoursTo; dirty(); },
    wcCap: (v) => { w.cap = Number(v) || 1; dirty(); },
    wcTyped: (v) => {
      w.typed = v;
      const e = estimateFor(w, subOfCid(w.cid));
      const ok = normalizeTyped(v) === normalizeTyped(String(e.toCall));
      const btn = root.querySelector('[data-action="wc.launch"]');
      const was = btn && btn.getAttribute('aria-disabled') !== 'true';
      if (ok !== was) ctx.rerender();
    },
  });
  // Re-render after text edits settle (unknown variables, gender check, length) and after the time fields change.
  // Variable chips insert at the caret on the first click: a chip never takes focus from the script (mousedown), and
  // leaving the script for a chip by keyboard keeps the caret and skips the re-render that would replace the chip.
  ctx.on(root, 'mousedown', '.cp-var', (ev) => ev.preventDefault());
  ctx.on(root, 'focusout', '[data-field="wcText"], [data-field="wcName"], [data-field="wcFrom"], [data-field="wcTo"]', (ev, el) => {
    if (el.dataset.field === 'wcText') w.caret = { start: el.selectionStart, end: el.selectionEnd, lang: w.lang };
    if (ev.relatedTarget && ev.relatedTarget.closest && ev.relatedTarget.closest('.cp-vars')) return;
    ctx.rerender(); // waits for a click that is half-way through (core/press.js)
  });
  ctx.on(root, 'change', 'input[data-file]', (ev, el) => {
    const f = el.files && el.files[0];
    if (el.dataset.file === 'csv') { if (f) loadAudience(f.name); else { w.awaiting = null; ctx.rerender(); } } else acceptAudio(f);
    el.value = '';
  });
  ctx.on(root, 'dragover', '[data-drop]', (ev, el) => { ev.preventDefault(); el.classList.add('is-over'); });
  ctx.on(root, 'dragleave', '[data-drop]', (ev, el) => el.classList.remove('is-over'));
  ctx.on(root, 'drop', '[data-drop]', (ev, el) => {
    ev.preventDefault();
    el.classList.remove('is-over');
    const f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
    if (!f) return;
    if (el.dataset.drop === 'csv') loadAudience(f.name); else acceptAudio(f);
  });
  ctx.on(root, 'keydown', '[data-field="wcTyped"]', (ev) => {
    if (ev.key !== 'Enter' || ev.isComposing || ev.keyCode === 229) return;
    ev.preventDefault();
    const b = root.querySelector('[data-action="wc.launch"]');
    if (b && b.getAttribute('aria-disabled') !== 'true') launch(ctx, w);
  });
  ctx.watch('mode', 'env', 'numbers', 'credits.balance', 'limits');
}

function mountDetail(root, ctx, c) {
  const { t } = ctx;
  const ds = detState(ctx, c.id);
  const rowsOf = () => recipientsOf(findCamp(c.id) || c);
  ctx.actions(root, {
    'cd.export': () => doExport(ctx, findCamp(c.id), ds.filter === 'all' && !ds.q ? null : filteredRecipients(ctx, findCamp(c.id))),
    'cd.pause': () => pauseCamp(ctx, c.id),
    'cd.resume': () => resumeCamp(ctx, c.id),
    'cd.stop': () => stopCamp(ctx, c.id),
    'cd.cancel': () => cancelScheduled(ctx, c.id),
    'cd.edit': (el, ev) => { ev.preventDefault(); ctx.state.wz = null; ctx.go(`campaigns/new?draft=${c.id}&step=3`); },
    'cd.duplicate': () => duplicate(ctx, findCamp(c.id)),
    'cd.incident': () => {},
    'cd.tips': () => {},
    'cd.filter': () => {},
    'cd.search': () => {},
    'cd.play': () => playMessage(ctx, findCamp(c.id)),
    'cd.donut': (el) => { const v = el.dataset.value; ds.filter = ds.filter === v ? 'all' : v; ds.page = 0; ctx.rerender(); },
    'cd.clear': () => { ds.filter = 'all'; ds.q = ''; ds.page = 0; ctx.rerender(); },
    'cd.page.prev': () => { ds.page = Math.max(0, ds.page - 1); ctx.rerender(); },
    'cd.page.next': () => { ds.page += 1; ctx.rerender(); },
    'cd.row': (el) => openRecipient(ctx, findCamp(c.id), el.dataset.phone),
    'cd.row.menu': (el) => {
      ctx.ui.menu(el, [{ id: 'cd.row.callnow', label: t('d.callNow'), icon: 'phone', onSelect: () => {
        const r = rowsOf().find((x) => x.phone === el.dataset.phone);
        ctx.ui.toast(t('d.queuedAttempt', { n: ((r && r.attempt) || 1) + 1 }), { kind: 'success', demo: true });
      } }], { label: t('d.rowMenu', { phone: el.dataset.phone }) });
    },
  });
  ctx.inputs(root, {
    cdFilter: (v) => { ds.filter = v; ds.page = 0; ctx.rerender(); },
    cdSearch: (v) => { ds.q = v; ds.page = 0; ctx.rerender(); },
  });
  const running = RUNS.get(c.id) && (c.status === 'running' || c.status === 'paused');
  if (running) {
    const fn = (kind, cid) => {
      if (cid !== c.id) return;
      if (!/^#\/campaigns\//.test(location.hash)) return;
      if (kind === 'tick') patchDetail(root, ctx, findCamp(c.id));
      else ctx.rerender();
    };
    runListeners.add(fn);
    ctx.cleanup(() => runListeners.delete(fn));
    ctx.watch('mode');
  } else {
    ctx.watch('campaigns', 'mode', 'calls');
  }
}

function filteredRecipients(ctx, c) {
  const ds = detState(ctx, c.id);
  const q = ds.q.trim().toLowerCase().replace(/[\s-]/g, '');
  return recipientsOf(c).filter((r) => (ds.filter === 'all' || recGroup(r) === ds.filter) && (!q || r.phone.replace(/[\s-]/g, '').toLowerCase().includes(q) || (r.n != null && nameOf(r.n).toLowerCase().includes(q))));
}
