// Logs — #/logs (filters in the query: range · dir · status · number · src · sub · q · date · from · to) · drawer ?call=<id>
// Every call with its status chip (API code in the tooltip), a plain-language reason and next step, the SIP event
// timeline (+ message ladder), the cost line, a recording player that plays synthesised audio and a transcript that
// streams word by word with playback (Intl.Segmenter for Thai and Chinese). The player has no seek bar.
// New calls (dialer, OTP console, campaign runs) are added with actions.addCall and appear at the top live.

import { raw, reducedMotion } from '../core/dom.js';
import { tIn, getLang, LANGS, loc } from '../core/i18n.js';
import { store } from '../core/store.js';
import { nowMs, at as atToday, DEMO_NOW } from '../data/clock.js';
import { PRICES, billedMinutes } from '../data/prices.js';
import { ERRORS } from '../data/reference.js';
import { SUBS } from '../data/active.js';
import { activePlan, outboundRate } from '../core/actions.js';

export const id = 'logs';
export const nav = { group: 'operate', icon: 'list', labelKey: 'nav.logs' };
export const titleKey = 'nav.logs';
export const skeleton = 'table';
export const css = true;

const DEF = { range: '24h', dir: 'all', status: 'all', number: 'all', src: 'all', sub: 'all', q: '', date: null, from: null, to: null };
const KEYS = Object.keys(DEF);
export const initialState = () => ({ f: { ...DEF }, qParams: null, page: 0, dtab: 'summary', ladder: false, resent: {}, trRun: {}, knownTop: null, focusCall: null });

export function crumb(params) {
  return params.query.call ? params.query.call : '';
}

export const commands = [
  { id: 'failed', labelKey: 'cmd.failed', icon: 'alert', keywords: ['failed calls errors logs'], run: ({ go }) => go('logs?status=failed') },
  { id: 'export', labelKey: 'cmd.export', icon: 'download', keywords: ['export calls csv logs'], run: ({ go }) => go('logs?export=1') },
];

const STATUS_FILTERS = ['all', 'completed', 'no-answer', 'busy', 'failed', 'rejected', 'canceled'];
const RANGES = ['24h', 'today', '7d', '30d', 'custom'];
const PER_PAGE = 20;
const SAMPLE_CALL = 'call_01JBKZ4Q21Q0';
const HQ_PBX = 'pbx-hq.example.com:5061';

/** Plain reason per sample row: key → logs.reason.<key>, with vars. Records made in the demo carry reasonKey. */
const REASONS = {
  call_01JBK053QGBY: ['keyConfirm'], call_01JBKJEYSH16: ['codeTwice'], call_01JBKVBHSJYX: ['flowAgentRec', { key: '1', ext: '201' }],
  call_01JBK6FKP4QW: ['noAnswerRetry', { time: '15:03' }], call_01JBKZ7BZA24: ['busyRetry', { time: '15:03' }], call_01JBKVW8BVD2: ['otpRepeat'],
  call_01JBKFTM96AF: ['transferred'], call_01JBK358F6XM: ['agentCall', { ext: '204' }], call_01JBK9AYP962: ['dnc'],
  call_01JBKMRSV1H2: ['phoneOffOtp'], call_01JBKR01XBPM: ['transferred'], call_01JBKBZVT6JQ: ['cmClosed'], call_01JBKFRMPXVF: ['keyConfirm'],
  call_01JBKB8C8C2F: ['codeTwice'], call_01JBKQNVMADS: ['keyConfirm'], call_01JBKS4WMEPG: ['intlOff'], call_01JBKH5A4FVW: ['optOut'],
  call_01JBKEGBQ5TZ: ['notInService'], call_01JBKZ4Q21Q0: ['flowAgentTr', { key: '1', ext: '205' }], call_01JBK2Y53F8B: ['keyConfirm'],
  call_01JBKWY6X6T9: ['c2c', { a: 190, b: 172 }], call_01JBKT3B8RF6: ['etaPlayed'], call_01JBK8J8YE9V: ['declinedRetry', { time: '14:55' }],
  call_01JBKJP1PZVW: ['codeTwice'], call_01JBK41Y9GBP: ['clinicCounter'], call_01JBK985JJ1K: ['noKey4s'], call_01JBK4YVKDN2: ['agentCanceled'],
  call_01JBK0CKQJY1: ['net503', { time: '14:53' }], call_01JBKWYC2M5J: ['codeTwice'], call_01JBK1DVXGPK: ['phoneOffRetry', { time: '14:52' }],
  call_01JBKXV8VZRG: ['flowAgentRec', { key: '1', ext: '202' }], call_01JBKDK8SYE8: ['net503', { time: '14:51' }], call_01JBKXAEZJRR: ['codeTwice'],
  call_01JBK429RJ8B: ['noKey'], call_01JBKNVFPBYT: ['cmClosed'], call_01JBKF2HHAYY: ['agentCallRec', { ext: '201' }], call_01JBK8TRXFSH: ['codeTwice'],
  call_01JBK2RKVGVP: ['apiCanceled'], call_01JBKVX844K0: ['operator'], call_01JBK7G88YYQ: ['codeTwice'],
};
/** Sample calls whose code is not verified (876 of 914 answered OTP calls are, 2.6). */
const NOT_VERIFIED = new Set(['call_01JBKWYC2M5J']);

// ---------- helpers ----------
const hash = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const pad2 = (n) => String(n).padStart(2, '0');
const isLogs = () => /^#\/logs(\?|$|\/)/.test(location.hash);
const bkkDayStart = (ms) => { const d = new Date(ms + 7 * 3600000); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - 7 * 3600000; };
const ymd = (ms) => { const d = new Date(ms + 7 * 3600000); return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`; };
const tsOf = (c) => Date.parse(c.ts || c.startedAt);
const subKeyOf = (subId) => Object.keys(SUBS).find((k) => SUBS[k] === subId) || subId;
const subIdOf = (key) => SUBS[key] || key;
const party = (c) => (c.direction === 'inbound' ? c.from : c.to);
const isLive = (c) => !!c.live;
const offsetLabel = (s) => `+${Math.floor(s / 60) ? `${Math.floor(s / 60)}:${pad2(Math.floor(s % 60))}` : Math.floor(s)}.${String(Math.round((s % 1) * 1000)).padStart(3, '0')}`;
const mmss = (s) => `${pad2(Math.floor(s / 60))}:${pad2(Math.floor(s % 60))}`;

/** Calls on screen: the dataset's log for the current environment, plus live calls when asked for. */
function allCalls(ctx) {
  const envNow = ctx.store.get('env');
  return ctx.list('calls').filter((c) => (c.env || 'live') === envNow);
}
function liveCalls(ctx) {
  if (ctx.store.get('env') !== 'live') return [];
  return ctx.list('liveCalls').map((lc) => ({ id: lc.id, ts: lc.startedAt, live: true, direction: lc.direction, source: lc.source, sub: lc.sub, from: lc.direction === 'inbound' ? lc.party : null, to: lc.direction === 'inbound' ? null : lc.party, party: lc.party, status: lc.state === 'playing' ? 'playing' : lc.state, liveState: lc.state, sec: 0, credits: 0, env: 'live' }));
}
function findCall(ctx, cid) {
  return ctx.list('calls').find((c) => c.id === cid) || liveCalls(ctx).find((c) => c.id === cid) || null;
}

function sourceKey(c) {
  const s = c.source || {};
  if (s.type === 'test-call') return 'test-call';
  if (s.type === 'click-to-call') return 'click-to-call';
  return s.ref || s.type;
}

function matches(ctx, c, f, { ignoreStatus = false } = {}) {
  const t = tsOf(c);
  const now = nowMs();
  if (f.date) { if (ymd(t) !== f.date) return false; }
  else if (f.range === '24h') { if (t < now - 86400000) return false; }
  else if (f.range === 'today') { if (t < bkkDayStart(now)) return false; }
  else if (f.range === '7d') { if (t < now - 7 * 86400000) return false; }
  else if (f.range === '30d') { if (t < now - 30 * 86400000) return false; }
  else if (f.range === 'custom' && f.from && f.to) { const a = Date.parse(`${f.from}T00:00:00+07:00`); const b = Date.parse(`${f.to}T23:59:59+07:00`); if (t < a || t > b) return false; }
  if (f.dir !== 'all' && c.direction !== f.dir) return false;
  if (!ignoreStatus && f.status !== 'all') {
    if (f.status === 'in-progress') { if (!isLive(c)) return false; }
    else if (c.status !== f.status) return false;
  }
  if (f.number !== 'all' && c.from !== f.number && c.to !== f.number && c.party !== f.number) return false;
  if (f.src !== 'all' && sourceKey(c) !== f.src && (c.source || {}).type !== f.src) return false;
  if (f.sub !== 'all' && c.sub !== subIdOf(f.sub)) return false;
  if (f.q) {
    const q = f.q.trim().toLowerCase();
    const digits = q.replace(/\D/g, '');
    const hay = `${c.id} ${c.from || ''} ${c.to || ''} ${ctx.ui.describe.source(c)}`.toLowerCase();
    if (!(hay.includes(q) || (digits.length >= 3 && `${c.from || ''}${c.to || ''}`.replace(/\D/g, '').includes(digits)))) return false;
  }
  return true;
}

function filtered(ctx, opts) {
  const f = ctx.state.f;
  const base = f.status === 'in-progress' && !(opts && opts.ignoreStatus) ? liveCalls(ctx) : allCalls(ctx);
  return base.filter((c) => matches(ctx, c, f, opts)).sort((a, b) => tsOf(b) - tsOf(a));
}

const active = (f) => KEYS.some((k) => k !== 'range' && f[k] !== DEF[k] && f[k] != null && f[k] !== '') || f.range !== DEF.range;

function qsOf(f, extra = {}) {
  const p = new URLSearchParams();
  for (const k of KEYS) if (f[k] != null && f[k] !== '' && f[k] !== DEF[k]) p.set(k, f[k]);
  for (const [k, v] of Object.entries(extra)) if (v != null) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Filters live in the address (linkable); a bare #/logs restores the filters remembered for this session. */
function syncQuery(ctx) {
  if (ctx.state.qParams === ctx.params) return;
  ctx.state.qParams = ctx.params;
  const q = ctx.params.query;
  const has = KEYS.some((k) => q[k] != null);
  if (has) {
    const f = { ...DEF };
    for (const k of KEYS) if (q[k] != null) f[k] = q[k];
    if (f.status === 'all' && q.status == null) f.status = 'all';
    if (!RANGES.includes(f.range)) f.range = '24h';
    ctx.state.f = f;
    ctx.state.page = 0;
  } else if (active(ctx.state.f)) {
    history.replaceState(history.state, '', `#/logs${qsOf(ctx.state.f, { call: q.call })}`);
  }
}
function setFilters(ctx, patch) {
  ctx.state.f = { ...ctx.state.f, ...patch };
  ctx.state.page = 0;
  history.replaceState(history.state, '', `#/logs${qsOf(ctx.state.f, { call: DR.callId || null })}`);
  ctx.rerender();
}

// ---------- reasons, costs, timelines ----------
function reasonText(ctx, c) {
  const { t } = ctx;
  if (isLive(c)) return t('reason.live');
  const r = REASONS[c.id];
  if (r) return t(`reason.${r[0]}`, r[1] || {});
  if (c.reasonKey) return t(`reason.${c.reasonKey}`, c.reasonVars || {});
  // Fail closed: a Thai caller ID is never sent over a non-Thai route — the call is not placed and not charged.
  if (c.status === 'rejected' && c.code === 'VOICE_4213') return t('reason.thaiRoute');
  if (c.source && c.source.type === 'test-call') return c.status === 'completed' ? t('reason.test') : t('reason.testOther', { status: t(`status.${c.status}`) });
  const e = errorFor(c);
  if (e) return loc(e.text);
  return c.reason ? loc(c.reason) : t(`status.${c.status}`);
}
function errorFor(c) {
  let code = null;
  if (c.status === 'rejected') code = c.code || 'VOICE_4204';
  else if (c.sip === 480) code = `SIP 480 · Q.850 ${c.q850 === 20 ? 20 : 19}`;
  else if (c.sip === 486) code = 'SIP 486 · Q.850 17';
  else if (c.sip === 603) code = 'SIP 603 · Q.850 21';
  else if (c.sip === 404) code = 'SIP 404 · Q.850 1';
  else if (c.sip === 503) code = 'SIP 503 · Q.850 34';
  else if (c.sip === 487) code = 'SIP 487';
  return code ? ERRORS.find((e) => e.code === code) || null : null;
}
const errorSlug = (code) => String(code).toLowerCase().replace(/ · q\.850 /, '-q').replace(/[\s_]+/g, '-');
const retryTime = (c) => { const r = REASONS[c.id]; return r && r[1] && r[1].time ? r[1].time : null; };
const supportCode = (c) => c.code || (c.sip === 503 ? 'VOICE_5003' : c.sip === 404 ? 'VOICE_4040' : null);

/** The cost line, built from prices.js — it always adds up to the credits on the record. */
function costLines(ctx, c) {
  const { t, fmt } = ctx;
  const lines = [];
  if (isLive(c)) return { lines: [t('cost.live')], total: null };
  if (c.env === 'sandbox') return { lines: [t('cost.sandbox', { min: fmt.num(c.trialMinutes || 0, 1) })], total: 0 };
  if (c.wizardTest) return { lines: [t('cost.wizardTest')], total: 0 };
  if (c.status !== 'completed' || (!c.credits && !c.planMin)) return { lines: [t('cost.notCharged')], total: 0 };
  const mins = c.billedMin || billedMinutes(c.sec);
  const kind = c.source && c.source.type;
  if ((kind === 'otp' || kind === 'notification') && c.sec <= PRICES.otpMaxSec) lines.push(t('cost.otp', { price: fmt.rate(PRICES.otpPerAnsweredCall) }));
  else if (c.legs) lines.push(t('cost.legs', { a: c.legs[0], b: c.legs[1], n: c.legs[0] + c.legs[1], rate: fmt.rate(PRICES.outbound), total: fmt.credits2((c.legs[0] + c.legs[1]) * PRICES.outbound) }));
  else if (c.direction === 'inbound') lines.push(t('cost.inbound', { n: mins, rate: fmt.rate(PRICES.inbound), total: fmt.credits2(mins * PRICES.inbound) }));
  else if (c.planMin) {
    // On a plan: the minutes come from the plan minutes (their own unit, no credits); minutes beyond them at the plan rate.
    lines.push(t('cost.planMin', { count: c.planMin, n: fmt.int(c.planMin) }));
    const over = Math.max(0, mins - c.planMin);
    if (over) lines.push(t('cost.planOver', { n: over, rate: fmt.rate(outboundRate()), total: fmt.credits2(over * outboundRate()) }));
  } else lines.push(t('cost.outbound', { n: mins, rate: fmt.rate(PRICES.outbound), total: fmt.credits2(mins * PRICES.outbound) }));
  if (c.voice === 'premium') lines.push(t('cost.premium', { n: mins, rate: fmt.rate(PRICES.premiumVoice), total: fmt.credits2(mins * PRICES.premiumVoice) }));
  if (c.recorded) lines.push(t('cost.recording', { n: mins, rate: fmt.rate(PRICES.recording), total: fmt.credits2(mins * PRICES.recording) }));
  if (c.transcribed) lines.push(t('cost.transcription', { n: mins, rate: fmt.rate(PRICES.transcription), total: fmt.credits2(mins * PRICES.transcription) }));
  return { lines, total: c.credits, planMin: c.planMin || 0 };
}

/** SIP event timeline for a call. Each event: { s, label, sip, from, to, tone }. */
function timeline(ctx, c) {
  const { t } = ctx;
  const ev = [];
  const add = (s, key, vars, sip, from, to, tone) => ev.push({ s, label: t(`ev.${key}`, vars || {}), sip: sip || null, from: from || null, to: to || null, tone: tone || '' });
  const pdd = (c.pddMs || 2400) / 1000;
  const src = (c.source || {}).type;
  if (isLive(c)) {
    const el = Math.max(0, (nowMs() - tsOf(c)) / 1000);
    if (c.direction === 'inbound') { add(0, 'inInvite', null, 'INVITE', 'net', 'ants'); add(0.04, 'flowAnswered', null, '200 OK', 'ants', 'net', 'ok'); add(Math.min(el, 9.6), 'toPbx', { host: HQ_PBX }, 'INVITE', 'ants', 'pbx'); }
    else { add(0, 'queued'); add(0.18, 'invite', null, 'INVITE', 'ants', 'net'); add(0.26, 'trying', null, '100 Trying', 'net', 'ants'); add(Math.min(el, pdd), 'ringing', null, '180 Ringing', 'net', 'ants', 'wait'); if (c.liveState !== 'ringing') add(Math.min(el, pdd + 2.6), 'answered', null, '200 OK', 'net', 'ants', 'ok'); }
    add(el, 'inProgress', null, null, null, null, 'wait');
    return ev;
  }
  if (c.events && c.events.length) {
    const t0 = Date.parse(c.events[0].at);
    for (const e of c.events) ev.push({ s: (Date.parse(e.at) - t0) / 1000, label: t(`dialer.ev.${e.event}`, { key: c.keys || '' }), sip: e.sip ? String(e.sip).split(' · ')[0] : null, from: 'ants', to: 'net', tone: e.event === 'completed' || e.event === 'answered' ? 'ok' : ['busy', 'noanswer', 'failed', 'canceled'].includes(e.event) ? 'err' : '' });
    if (c.webhook) ev.push({ s: ev.length ? ev[ev.length - 1].s + 0.2 : 0, label: t('ev.webhook', { event: c.webhook.event, code: c.webhook.code, ms: c.webhook.ms }), sip: null, tone: 'ok' });
    return ev;
  }
  if (c.status === 'rejected') { add(0, 'policy', { code: c.code || 'VOICE_4204' }, null, null, null, 'err'); add(0.01, 'noSip'); return ev; }
  if (c.direction === 'inbound') {
    add(0, 'inInvite', null, 'INVITE', 'net', 'ants');
    if (src === 'flow-fallback') {
      add(0.03, 'toPbxDown', { host: 'cm-branch-pbx · 198.51.100.40' }, 'INVITE', 'ants', 'pbx');
      add(4.03, 'pbxNoReply', null, null, null, null, 'err');
      add(4.1, 'fallback', null, '200 OK', 'ants', 'net', 'ok');
      add(4.1 + c.sec, 'byeAnts', null, 'BYE', 'ants', 'net');
    } else {
      add(0.04, 'flowAnswered', null, '200 OK', 'ants', 'net', 'ok');
      if (c.recorded) add(0.3, 'recNotice');
      add(4.0, 'menu');
      if (c.keys) add(9.5, 'dtmf', { key: c.keys }, 'DTMF', 'net', 'ants');
      add(9.6, 'toPbx', { host: HQ_PBX }, 'INVITE', 'ants', 'pbx');
      add(9.8, 'ringing', null, '180 Ringing', 'pbx', 'ants', 'wait');
      add(13.2, 'agent', null, '200 OK', 'pbx', 'ants', 'ok');
      add(13.2 + c.sec, 'byeCaller', null, 'BYE', 'net', 'ants');
    }
    const end = ev[ev.length - 1].s;
    add(end + 0.02, 'completed', { n: c.billedMin || billedMinutes(c.sec) }, '200 OK', 'ants', 'net', 'ok');
    add(end + 0.2, 'webhook', { event: 'call.completed', code: 200, ms: 182 }, null, null, null, 'ok');
    return ev;
  }
  add(0, 'queued');
  if (c.status === 'canceled') {
    add(0.18, 'invite', null, 'INVITE', 'ants', 'net'); add(pdd, 'ringing', null, '180 Ringing', 'net', 'ants', 'wait');
    add(pdd + 22, src === 'trunk' ? 'cancelPbx' : 'cancelApi', null, 'CANCEL', 'ants', 'net', 'err'); add(pdd + 22.05, 'terminated', null, '487', 'net', 'ants');
    return ev;
  }
  add(0.18, 'invite', null, 'INVITE', 'ants', 'net');
  add(0.26, 'trying', null, '100 Trying', 'net', 'ants');
  const rt = retryTime(c);
  if (c.status === 'failed') {
    if (c.sip === 503) { add(1.9, 'f503', null, '503', 'net', 'ants', 'err'); add(1.95, 'retryBackup', { time: rt || '—' }); }
    else { add(pdd, 'f404', null, '404', 'net', 'ants', 'err'); add(pdd + 0.05, 'removeNumber'); }
    return ev;
  }
  if (c.status === 'busy') { add(pdd, c.sip === 603 ? 'declined' : 'busy', null, c.sip === 603 ? '603' : '486', 'net', 'ants', 'err'); add(pdd + 0.05, 'retry', { time: rt || '—' }); return ev; }
  if (c.status === 'no-answer') {
    if (c.q850 === 20) { add(pdd + 3, 'unavailable', null, '480', 'net', 'ants', 'err'); add(pdd + 3.05, rt ? 'retry' : 'retry90', { time: rt || '' }); }
    else { add(pdd, 'ringing', null, '180 Ringing', 'net', 'ants', 'wait'); add(pdd + 30, 'timeout', null, 'CANCEL', 'ants', 'net', 'err'); add(pdd + 30.05, 'terminated', null, '487', 'net', 'ants'); add(pdd + 30.1, 'retry', { time: rt || '—' }); }
    return ev;
  }
  // completed outbound
  const ans = pdd + 2.6;
  add(pdd, 'ringing', null, '180 Ringing', 'net', 'ants', 'wait');
  add(ans, 'answered', null, '200 OK', 'net', 'ants', 'ok');
  add(ans + 0.02, 'ack', null, 'ACK', 'ants', 'net');
  if (src === 'trunk' || src === 'click-to-call') add(ans + 0.3, 'connected');
  else add(ans + 0.3, src === 'otp' ? 'codePlay' : 'message');
  if (c.keys) add(ans + Math.min(12.4, Math.max(1, c.sec - 1)), 'dtmf', { key: c.keys }, 'DTMF', 'net', 'ants');
  if (c.keys === '2' && src === 'campaign' && c.sec > 60) add(ans + Math.min(12.8, c.sec - 0.5), 'transfer', { host: 'hq-pbx queue' }, 'INVITE', 'ants', 'pbx');
  const byeKey = src === 'trunk' ? 'byeAgent' : (c.sec < 10 && !c.keys) ? 'byeRecipient' : src === 'click-to-call' ? 'byeRecipient' : 'byeAnts';
  add(ans + c.sec, byeKey, null, 'BYE', byeKey === 'byeAnts' ? 'ants' : 'net', byeKey === 'byeAnts' ? 'net' : 'ants');
  add(ans + c.sec + 0.02, 'completed', { n: c.billedMin || billedMinutes(c.sec) }, '200 OK', null, null, 'ok');
  add(ans + c.sec + 0.2, 'webhook', { event: src === 'otp' ? 'otp.answered' : 'call.completed', code: 200, ms: 182 }, null, null, null, 'ok');
  return ev;
}

function whoHungUp(ctx, c) {
  const src = (c.source || {}).type;
  if (c.direction === 'inbound') return src === 'flow-fallback' ? ctx.t('q.whoAnts') : ctx.t('q.whoCaller');
  if (src === 'trunk') return ctx.t('q.whoAgent');
  if (src === 'test-call') return ctx.t('q.whoYou');
  return c.sec < 10 && !c.keys ? ctx.t('q.whoRecipient') : ctx.t('q.whoAnts');
}

/** Webhook deliveries for this call: hooks.example.com gets everything, crm.example.com the Home delivery calls. */
function webhookAttempts(ctx, c) {
  if (isLive(c)) return [];
  const end = tsOf(c) + ((c.sec || 0) + 4) * 1000;
  const src = (c.source || {}).type;
  const event = src === 'otp' ? (c.status === 'completed' ? 'otp.answered' : 'otp.not_answered') : 'call.completed';
  const list = [{ id: `whd_${c.id.slice(-6)}a`, host: 'hooks.example.com', url: 'https://hooks.example.com/ants/voice', event, code: c.webhook ? c.webhook.code : 200, ms: c.webhook ? c.webhook.ms : 182, at: end }];
  if (c.sub === SUBS.dv && event === 'call.completed' && c.env !== 'sandbox') {
    const failing = tsOf(c) >= atToday('14:30:00');
    list.push({ id: `whd_${c.id.slice(-6)}b`, host: 'crm.example.com', url: 'https://crm.example.com/ants/webhook', event, code: failing ? 503 : 200, ms: failing ? null : 240, at: end + 200, attempts: failing ? 6 : 1 });
  }
  return [...list, ...(ctx.state.resent[c.id] || [])];
}

function payloadFor(ctx, c, a) {
  const e164 = (n) => (n ? String(n).replace(/^0/, '+66').replace(/-/g, '') : null);
  return {
    event: a.event, event_id: `evt_01JBKY${String(hash(a.id) % 10000).padStart(4, '0')}`, created_at: ctx.fmt.iso(a.at),
    data: {
      id: c.id, direction: c.direction, from: e164(c.from), to: e164(c.to), status: c.status, sip_code: c.sip || null, q850: c.q850 || null,
      talk_seconds: c.sec || 0, billed_minutes: c.billedMin || 0, price: c.credits || 0, price_unit: 'credits',
      campaign_id: c.source && c.source.type === 'campaign' ? c.source.ref : null, dtmf: c.keys || null, subaccount_id: c.sub || null,
      route: c.route || 'primary', recording_url: c.recorded ? `https://api.voice.example/v1/recordings/${c.id}` : null,
    },
  };
}

// ---------- audio: recording / message / two-speaker transcript ----------
/** Segments of what can be played for a call: [{ start, end, who: 'agent'|'customer'|'system', text }] (display language). */
function segmentsFor(ctx, c, lang = getLang()) {
  if (c.id === SAMPLE_CALL) {
    return (tIn(lang, 'logs.tr.sample') || []).map((row) => {
      const [a, b, who, text] = String(row).split('|');
      const sec = (v) => { const [m, s] = v.split(':'); return Number(m) * 60 + Number(s); };
      return { start: sec(a), end: sec(b), who, text };
    });
  }
  const src = (c.source || {}).type;
  const sys = (text, start = 0) => ({ start, end: start + 4, who: 'system', text });
  if (c.status !== 'completed') return [];
  if (c.direction === 'inbound') {
    const out = [];
    if (c.recorded) out.push(sys(tIn(lang, 'logs.audio.recNotice')));
    out.push(sys(tIn(lang, src === 'flow-fallback' ? 'logs.audio.closed' : (c.source.ref === 'flw_01JB5CKN02' ? 'logs.audio.clinicMenu' : 'logs.audio.greeting')), out.length ? 6 : 0));
    return out;
  }
  if (src === 'trunk') return c.recorded ? [sys(tIn(lang, 'logs.audio.recNotice'))] : [];
  if (c.tts && c.tts.text) return [sys(c.tts.text)]; // what the dialer or the OTP console really spoke
  const tpl = src === 'otp' ? 'dialer.tpl.otp.speak' : src === 'notification' ? 'dialer.tpl.delivery.speak' : null;
  if (tpl) return [sys((tIn(lang, tpl) || []).join(' '))];
  if (src === 'campaign') {
    const camp = (store.get('campaigns') || []).find((x) => x.id === c.source.ref);
    const kind = (camp && camp.script && camp.script.kind) || (c.source.ref === 'bc_01JBK7C1Q2' || /^bc_01JB[HF]D2/.test(c.source.ref) ? 'delivery' : 'reminder');
    const key = kind === 'reminder' ? 'dialer.tpl.reminder.speak' : `campaigns.script.${kind}.speak`;
    return [sys((tIn(lang, key) || []).join(' '))];
  }
  return [];
}
const PL = { callId: null, playing: false, seg: 0, word: -1, speed: 1, t0: 0, base: 0, speech: null, timer: null, kind: null, token: 0 };

function playerStop() {
  PL.token += 1;
  PL.playing = false;
  if (PL.speech) { try { PL.speech.stop(); } catch { /* ignore */ } PL.speech = null; }
  clearInterval(PL.timer);
  PL.timer = null;
}
function playerElapsed() {
  return PL.playing ? PL.base + ((performance.now() - PL.t0) / 1000) * PL.speed : PL.base;
}
function playerStart(ctx, c, { restart = false } = {}) {
  const tts = ctx.ui.audio.tts;
  ctx.ui.audio.unlock();
  const segs = segmentsFor(ctx, c);
  if (!segs.length) return;
  if (PL.callId !== c.id || restart) { playerStop(); PL.callId = c.id; PL.seg = 0; PL.word = -1; PL.base = 0; }
  playerStop();
  PL.callId = c.id;
  PL.playing = true;
  PL.t0 = performance.now();
  const tok = PL.token;
  const lang = getLang();
  const pick = tts.pick(LANGS[lang].tts);
  PL.note = !tts.supported() || pick.match === 'none' ? ctx.t('pl.noVoice') : pick.match !== 'exact' && lang !== 'en' ? ctx.t('pl.fallbackVoice', { lang: LANGS[lang].label }) : null;
  PL.timer = setInterval(() => paintPlayer(ctx), 200);
  const playSeg = (i) => {
    if (tok !== PL.token) return;
    if (i >= segs.length) { PL.playing = false; PL.base = segs[segs.length - 1].end; PL.seg = segs.length; clearInterval(PL.timer); PL.timer = null; refreshDrawer(); return; }
    const s = segs[i];
    PL.seg = i;
    PL.word = -1;
    const wait = Math.max(0, ((s.start - playerElapsed()) / PL.speed) * 1000);
    setTimeout(() => {
      if (tok !== PL.token) return;
      PL.base = Math.max(PL.base, s.start);
      PL.t0 = performance.now();
      paintPlayer(ctx);
      // Two voices: the customer is read by a second voice (or the premium preset of the same one).
      PL.speech = tts.speak([{ text: s.text, rate: PL.speed }], { lang: LANGS[lang].tts, premium: s.who === 'customer', onWord: (w) => { if (tok === PL.token) { PL.word = w; paintWords(ctx); } } });
      PL.speech.done.then(() => { if (tok !== PL.token) return; PL.base = Math.max(playerElapsed(), s.end); PL.t0 = performance.now(); playSeg(i + 1); });
    }, wait);
  };
  playSeg(PL.seg >= segs.length ? 0 : PL.seg);
  refreshDrawer();
}

function paintPlayer(ctx) {
  const el = DR.handle && DR.handle.el;
  if (!el) return;
  const c = findCall(ctx, DR.callId);
  if (!c || PL.callId !== c.id) return;
  const segs = segmentsFor(ctx, c);
  const total = segs.length ? segs[segs.length - 1].end : 1;
  const e = Math.min(total, playerElapsed());
  el.querySelectorAll('[data-pl-time]').forEach((x) => { x.textContent = `${mmss(e)} / ${mmss(total)}`; });
  el.querySelectorAll('[data-pl-bar]').forEach((x) => { x.style.width = `${Math.round((e / total) * 100)}%`; });
  el.querySelectorAll('[data-pl-who]').forEach((x) => { const s = segs[Math.min(PL.seg, segs.length - 1)]; x.textContent = s ? speaker(ctx, s.who) : ''; });
}
function paintWords(ctx) {
  const el = DR.handle && DR.handle.el;
  if (!el) return;
  el.querySelectorAll('[data-seg]').forEach((segEl) => {
    const si = Number(segEl.dataset.seg);
    segEl.classList.toggle('is-cur', PL.playing && si === PL.seg);
    segEl.querySelectorAll('.w').forEach((w, k) => {
      const past = si < PL.seg || (si === PL.seg && k <= PL.word);
      w.classList.toggle('on', past);
      w.classList.toggle('cur', si === PL.seg && k === PL.word);
      w.classList.toggle('future', PL.playing && !past);
    });
  });
}
const speaker = (ctx, who) => ctx.t(`tr.${who}`);

// ---------- drawer (module level: it survives the list re-rendering underneath it) ----------
const DR = { handle: null, callId: null, programmatic: false };
let CTX = null;

function closeDrawer() {
  if (!DR.handle) return;
  DR.programmatic = true;
  const h = DR.handle;
  DR.handle = null;
  DR.callId = null;
  playerStop();
  h.close();
  DR.programmatic = false;
}

function refreshDrawer() {
  if (!DR.handle || !CTX) return;
  const c = findCall(CTX, DR.callId);
  if (!c) return;
  const focused = document.activeElement && DR.handle.el.contains(document.activeElement) ? { a: document.activeElement.dataset.action, v: document.activeElement.dataset.value } : null;
  const scroller = DR.handle.el.querySelector('.modal-body');
  const y = scroller ? scroller.scrollTop : 0;
  DR.handle.setTitle(drawerTitle(CTX, c));
  DR.handle.setBody(drawerBody(CTX, c));
  const sc2 = DR.handle.el.querySelector('.modal-body'); if (sc2) sc2.scrollTop = y;
  if (focused && focused.a) {
    const el = DR.handle.el.querySelector(`[data-action="${focused.a}"]${focused.v != null ? `[data-value="${focused.v}"]` : ''}`);
    if (el) el.focus({ preventScroll: true });
  }
  paintPlayer(CTX);
  paintWords(CTX);
}

const drawerTitle = (ctx, c) => ctx.t('dr.title', { time: ctx.fmt.time(c.ts), party: party(c) || c.party || '' });

function openDrawer(ctx, c) {
  if (DR.handle) { if (DR.callId !== c.id) { playerStop(); ctx.state.dtab = 'summary'; ctx.state.ladder = false; } DR.callId = c.id; refreshDrawer(); return; }
  DR.callId = c.id;
  const handle = ctx.ui.drawer({
    title: drawerTitle(ctx, c), wide: true, className: 'lg-drawer',
    body: drawerBody(ctx, c),
    actions: drawerActions(),
    onClose: () => {
      playerStop();
      if (DR.programmatic) return;
      const was = DR.callId;
      DR.handle = null;
      DR.callId = null;
      if (CTX && isLogs()) { CTX.state.focusCall = was; CTX.go(`logs${qsOf(CTX.state.f)}`, { replace: true }); }
    },
  });
  DR.handle = handle;
  // ↑ / ↓ move between calls of the current list while the drawer is open.
  handle.el.addEventListener('keydown', (ev) => {
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
    if (ev.target.closest('input, textarea, select, [role="tablist"]')) return;
    const list = filtered(CTX);
    const i = list.findIndex((x) => x.id === DR.callId);
    const next = list[i + (ev.key === 'ArrowDown' ? 1 : -1)];
    if (!next) return;
    ev.preventDefault();
    CTX.go(`logs${qsOf(CTX.state.f, { call: next.id })}`, { replace: true });
  });
}

function drawerActions() {
  const C = () => CTX;
  const call = () => findCall(C(), DR.callId);
  return {
    'lg.d.copyid': (el) => C().ui.copy(DR.callId, el),
    'lg.d.share': (el) => C().ui.copy(`${location.origin}${location.pathname}#/logs?call=${DR.callId}`, el),
    'lg.d.report': () => C().go(`help/contact?topic=calls&call=${DR.callId}`),
    'lg.d.tab': (el) => { C().state.dtab = el.dataset.value; refreshDrawer(); const b = DR.handle && DR.handle.el.querySelector(`[data-action="lg.d.tab"][data-value="${el.dataset.value}"]`); if (b) b.focus(); },
    'lg.d.reason.more': () => {},
    'lg.d.status': () => {},
    'lg.d.incident': () => {},
    'lg.d.ladder': () => { C().state.ladder = !C().state.ladder; refreshDrawer(); },
    'lg.d.rec.play': () => { const c = call(); if (!c) return; if (PL.playing && PL.callId === c.id) { PL.base = playerElapsed(); playerStop(); refreshDrawer(); } else playerStart(C(), c); },
    'lg.d.rec.restart': () => { const c = call(); if (c) playerStart(C(), c, { restart: true }); },
    'lg.d.rec.speed': () => { PL.speed = PL.speed === 1 ? 1.5 : 1; const c = call(); if (PL.playing && c) { PL.base = playerElapsed(); playerStart(C(), c); } else refreshDrawer(); },
    'lg.d.rec.download': () => C().ui.toast(C().t('toast.T41'), { kind: 'info', demo: true }),
    'lg.d.rec.settings': () => {},
    'lg.d.tr.play': () => { const c = call(); if (!c) return; if (PL.playing && PL.callId === c.id) { PL.base = playerElapsed(); playerStop(); refreshDrawer(); } else playerStart(C(), c, { restart: !PL.base || PL.callId !== c.id }); },
    'lg.d.tr.run': (el) => {
      const ctx = C();
      const cid = DR.callId;
      ctx.state.trRun[cid] = 'run';
      refreshDrawer();
      setTimeout(() => { if (!ctx.state || !ctx.state.trRun) return; ctx.state.trRun[cid] = 'done'; if (DR.callId === cid) refreshDrawer(); }, reducedMotion() ? 300 : 1500);
    },
    'lg.d.tr.open': () => { C().state.dtab = 'transcript'; C().go(`logs${qsOf(C().state.f, { call: SAMPLE_CALL })}`); },
    'lg.d.tr.copy': (el) => { const c = call(); if (c) C().ui.copy(transcriptText(C(), c), el); },
    'lg.d.tr.download': () => { const c = call(); if (c) C().ui.download(`call_${c.id}_transcript.txt`, transcriptText(C(), c)); },
    'lg.d.wh.view': (el) => { const c = call(); if (c) viewWebhook(C(), c, el.dataset.value); },
    'lg.d.wh.resend': (el) => {
      const ctx = C();
      const c = call();
      if (!c) return;
      const src = webhookAttempts(ctx, c).find((a) => a.id === el.dataset.value);
      el.setAttribute('aria-busy', 'true');
      setTimeout(() => {
        const list = ctx.state.resent[c.id] || [];
        ctx.state.resent[c.id] = [...list, { ...(src || {}), id: `${(src || {}).id || 'whd'}_r${list.length + 1}`, code: 200, ms: 190, at: nowMs(), attempts: 1, resend: true }];
        ctx.ui.toast(ctx.t('toast.T11'), { kind: 'success' });
        refreshDrawer();
      }, 500);
    },
    'lg.d.link.campaign': () => {}, 'lg.d.link.trunk': () => {}, 'lg.d.link.number': () => {}, 'lg.d.link.template': () => {}, 'lg.d.link.flow': () => {},
    'lg.d.close': () => { if (DR.handle) DR.handle.close(); },
  };
}

function transcriptText(ctx, c) {
  return segmentsFor(ctx, c).map((s) => `[${mmss(s.start)}] ${speaker(ctx, s.who)}: ${s.text}`).join('\n');
}

function viewWebhook(ctx, c, aid) {
  const { t, html: h, fmt } = ctx;
  const a = webhookAttempts(ctx, c).find((x) => x.id === aid);
  if (!a) return;
  const body = JSON.stringify(payloadFor(ctx, c, a), null, 2);
  const ts = Math.floor(a.at / 1000);
  const resp = a.code === 200 ? '{"received": true}' : '<html><body>503 Service Unavailable</body></html>';
  ctx.ui.modal({
    title: t('wh.title', { event: a.event }), sub: a.url, size: 'lg',
    body: h`<div class="stack-3"><span class="label">${t('wh.request')}</span>
      <pre class="code" translate="no">POST ${a.url}
Content-Type: application/json
X-ANTS-Timestamp: ${ts}
X-ANTS-Signature: v1=demo0000signature0000not0real</pre>
      <pre class="code lg-json" translate="no">${body}</pre>
      <span class="label">${t('wh.response')}</span>
      <div class="note ${a.code === 200 ? 'note-ok' : 'note-err'}">${ctx.icon(a.code === 200 ? 'check-circle' : 'alert-circle')}<span><strong class="mono">${a.code}${a.ms ? ` · ${a.ms} ms` : ''}</strong> · ${a.code === 200 ? t('wh.ok') : t('wh.fail', { n: a.attempts || 1 })} ${t('wh.simulated')}</span></div>
      <pre class="code" translate="no">${resp}</pre>
      <p class="hint-xs">${t('wh.retryRule')} <a class="linkbtn" href="#/help/article/webhooks-signature" data-action="lg.wh.sig">${t('wh.sig')}</a></p></div>`,
    actions: { 'lg.wh.sig': (el, ev, hd) => hd.close() },
    buttons: [{ label: t('wh.copy'), icon: 'copy', onClick: (hd, btn) => { ctx.ui.copy(body, btn); return false; } }, { label: t('common.close'), kind: 'navy' }],
  });
}

function relatedLinks(ctx, c) {
  const { t, html: h, icon } = ctx;
  const out = [];
  const s = c.source || {};
  if (s.type === 'campaign') out.push(h`<a class="btn btn-sm" href="#/campaigns/${s.ref}" data-action="lg.d.link.campaign">${icon('megaphone', 'ico-sm')}${t('link.campaign')}</a>`);
  if (s.type === 'trunk') out.push(h`<a class="btn btn-sm" href="#/trunks/${s.ref}" data-action="lg.d.link.trunk">${icon('server', 'ico-sm')}${t('link.trunk', { name: s.ref })}</a>`);
  if (s.type === 'flow-fallback') out.push(h`<a class="btn btn-sm" href="#/trunks/cm-branch-pbx" data-action="lg.d.link.trunk">${icon('server', 'ico-sm')}${t('link.trunk', { name: 'cm-branch-pbx' })}</a>`);
  if (s.type === 'flow' || s.type === 'flow-fallback') out.push(h`<a class="btn btn-sm" href="#/flows/${s.ref}" data-action="lg.d.link.flow">${icon('flow', 'ico-sm')}${t('link.flow')}</a>`);
  if (s.type === 'otp' || s.type === 'notification' || s.type === 'api') out.push(h`<a class="btn btn-sm" href="#/otp?template=${s.ref}" data-action="lg.d.link.template">${icon('shield-check', 'ico-sm')}${t('link.template', { name: s.ref })}</a>`);
  const own = (ctx.store.get('numbers') || []).find((n) => n.number === c.from || n.number === c.to);
  if (own) out.push(h`<a class="btn btn-sm" href="#/numbers?n=${own.id}" data-action="lg.d.link.number">${icon('hash', 'ico-sm')}${t('link.number', { number: own.number })}</a>`);
  return out;
}

function drawerBody(ctx, c) {
  const { t, html: h, icon } = ctx;
  const tab = ctx.state.dtab || 'summary';
  const tabs = ['summary', 'timeline', 'recording', 'transcript', 'webhooks'];
  return h`<div class="lg-d" data-call="${c.id}">
    <div class="lg-d-top"><div class="row-tight lg-d-status">${ctx.ui.describe.statusChip(c.status)}<strong>${reasonText(ctx, c)}</strong></div>
      <div class="row-tight lg-d-id"><code class="mono" translate="no">${c.id}</code>
        <button type="button" class="copybtn" data-action="lg.d.copyid" aria-label="${t('dr.copyId')}" data-tip-key="logs.dr.copyId">${icon('copy', 'ico-sm')}</button>
        <button type="button" class="btn btn-sm btn-ghost" data-action="lg.d.share">${icon('link', 'ico-sm')}${t('dr.copyLink')}</button>
        <button type="button" class="btn btn-sm" data-action="lg.d.report">${icon('lifebuoy', 'ico-sm')}${t('dr.report')}</button></div></div>
    <div class="seg lg-tabs" role="tablist" aria-label="${t('dr.tabsAria')}">${tabs.map((k) => h`<button type="button" role="tab" id="lg-tab-${k}" aria-controls="lg-panel" aria-selected="${tab === k}" tabindex="${tab === k ? 0 : -1}" data-action="lg.d.tab" data-value="${k}">${t(`tab.${k}`)}${k === 'transcript' ? h` <span class="chip chip-info lg-beta">${t('common.beta')}</span>` : ''}</button>`)}</div>
    <div class="lg-panel" id="lg-panel" role="tabpanel" aria-labelledby="lg-tab-${tab}" tabindex="0">${tab === 'summary' ? summaryTab(ctx, c) : tab === 'timeline' ? timelineTab(ctx, c) : tab === 'recording' ? recordingTab(ctx, c) : tab === 'transcript' ? transcriptTab(ctx, c) : webhooksTab(ctx, c)}</div>
  </div>`;
}

function summaryTab(ctx, c) {
  const { t, html: h, icon, fmt } = ctx;
  const e = errorFor(c);
  const cost = costLines(ctx, c);
  const answered = c.status === 'completed';
  const rt = retryTime(c);
  const sc = supportCode(c);
  const failedView = !answered && !isLive(c) && e ? h`<section class="lg-reason lg-reason-${c.status}" aria-labelledby="lg-reason-h">
      <h3 id="lg-reason-h">${icon(c.status === 'failed' || c.status === 'rejected' ? 'alert-circle' : 'info')}${t('dr.whatHappened')}</h3>
      <p><span class="mono lg-code" translate="no">${e.code}</span> — ${loc(e.text)}</p>
      <p class="lg-next"><strong>${t('dr.next')}</strong> ${t(nextKey(c), { time: rt || '', price: fmt.rate(PRICES.international) })}</p>
      <div class="row-tight">${sc ? h`<span class="hint-xs">${t('dr.supportCode')} <span class="mono" translate="no">${sc}</span></span>` : ''}
        <a class="linkbtn" href="#/help/errors?code=${errorSlug(e.code)}" data-action="lg.d.reason.more">${t('dr.whatMeans')}</a></div>
      ${c.sip === 503 ? h`<div class="note note-info lg-inc">${icon('activity')}<span class="grow">${t('dr.incident')}</span><a class="btn btn-sm" href="#/help/status?inc=20261027" data-action="lg.d.incident">${t('dr.viewStatus')}</a></div>` : ''}
    </section>` : '';
  const fact = (k, v, term) => h`<div class="kv"><span class="k">${term ? ctx.term(t(k), term) : t(k)}</span><span class="v">${v}</span></div>`;
  return h`<div class="stack-4">${failedView}
    ${isLive(c) ? h`<div class="note note-info">${raw('<span class="dot dot-ok dot-live" aria-hidden="true"></span>')}<span>${t('dr.liveNote', { elapsed: fmt.duration((nowMs() - tsOf(c)) / 1000) })}</span></div>` : ''}
    <div class="grid g-2 lg-facts">
      <div class="card card-pad">
        ${fact('f.started', t('dt', { date: fmt.dateProse(c.ts), time: fmt.time(c.ts) }))}
        ${fact('f.direction', ctx.ui.describe.direction(c))}
        ${fact('f.from', h`<span class="mono" translate="no">${c.from || '—'}</span>`, 'caller_id')}
        ${fact('f.to', h`<span class="mono" translate="no">${c.to || '—'}</span>`)}
        ${fact('f.source', ctx.ui.describe.source(c))}
        ${fact('f.sub', ctx.ui.describe.sub(c.sub), 'subaccount')}
      </div>
      <div class="card card-pad">
        ${fact('f.status', h`${ctx.ui.describe.statusChip(c.status)} <span class="mono hint-xs" translate="no">${c.sip ? `SIP ${c.sip}` : ''}${c.q850 ? ` · Q.850 ${c.q850}` : ''}</span>`, 'sip_code')}
        ${fact('f.talk', c.sec ? h`<span class="mono">${fmt.duration(c.sec)}</span>` : '—')}
        ${fact('f.billed', c.billedMin ? t('f.billedV', { count: c.billedMin }) : '—', 'billing_minute')}
        ${fact('f.pdd', c.pddMs ? t('f.pddV', { s: fmt.num(c.pddMs / 1000, 1) }) : '—', 'pdd')}
        ${fact('f.keys', c.keys ? h`<span class="lg-keycap">${c.keys}</span>` : '—', 'dtmf')}
        ${fact('f.route', c.route ? t(`route.${c.route}`) : '—', 'route')}
      </div></div>
    <section class="card card-pad lg-cost" aria-labelledby="lg-cost-h"><div class="row" style="justify-content:space-between"><h3 id="lg-cost-h">${t('f.cost')}</h3><span class="chip chip-warn" tabindex="0" data-tip-key="common.plannedPricesTip">${t('plannedShort')}</span></div>
      <ul class="lg-costlines">${cost.lines.map((l) => h`<li>${l}</li>`)}</ul>
      ${cost.total != null ? h`<div class="kv kv-total"><span class="k">${t('f.total')}</span><span class="v">${cost.planMin ? ctx.ui.describe.used(cost.total, cost.planMin) : t('f.totalV', { n: fmt.credits2(cost.total) })}</span></div>` : ''}</section>
    ${answered ? qualityBlock(ctx, c) : ''}
    ${relatedLinks(ctx, c).length ? h`<div class="stack" style="gap:8px"><span class="label">${t('dr.related')}</span><div class="row">${relatedLinks(ctx, c)}</div></div>` : ''}
    <p class="hint-xs">${icon('shield', 'ico-xs')} ${t('dr.dataNote')}</p>
  </div>`;
}
function nextKey(c) {
  if (c.status === 'rejected') return c.code === 'VOICE_4202' ? 'next.intl' : c.code === 'VOICE_4213' ? 'next.thaiRoute' : 'next.dnc';
  if (c.sip === 503) return 'next.503';
  if (c.sip === 404) return 'next.404';
  if (c.sip === 603) return 'next.declined';
  if (c.status === 'busy') return 'next.busy';
  if (c.status === 'canceled') return 'next.canceled';
  if (c.q850 === 20) return retryTime(c) ? 'next.off' : 'next.off90';
  return 'next.noAnswer';
}

function qualityBlock(ctx, c) {
  const { t, html: h, fmt } = ctx;
  const dip = c.id === 'call_01JBKXV8VZRG';
  const q = dip ? { jitter: 4, jmax: 38, loss: 0.6, mos: 3.9 } : { jitter: 4, jmax: 11, loss: 0, mos: 4.3 };
  return h`<section class="card card-pad lg-quality" aria-labelledby="lg-q-h" data-inv="lg.d.quality"><h3 id="lg-q-h">${ctx.term(t('q.title'), 'quality')}</h3>
    <div class="grid g-2 lg-qgrid">
      <div class="kv"><span class="k">${t('q.who')}</span><span class="v">${whoHungUp(ctx, c)}</span></div>
      <div class="kv"><span class="k">${ctx.term(t('q.last'), 'sip_code')}</span><span class="v mono" translate="no">${c.direction === 'inbound' ? 'BYE · 200 OK' : '200 OK'}</span></div>
      <div class="kv"><span class="k">${ctx.term(t('q.codec'), 'codec')}</span><span class="v mono">PCMA</span></div>
      <div class="kv"><span class="k">${t('q.jitter')}</span><span class="v">${t('q.jitterV', { avg: q.jitter, max: q.jmax })}</span></div>
      <div class="kv"><span class="k">${t('q.loss')}</span><span class="v">${fmt.pct(q.loss)}</span></div>
      <div class="kv"><span class="k">${t('q.mos')}</span><span class="v ${q.mos >= 4 ? 'ok-text' : 'warn-text'}">${fmt.num(q.mos, 1)}</span></div></div>
    ${dip ? h`<p class="note note-warn">${ctx.icon('alert')}<span>${t('q.dip', { at: '02:10' })}</span></p>` : ''}</section>`;
}

function timelineTab(ctx, c) {
  const { t, html: h, icon } = ctx;
  const ev = timeline(ctx, c);
  const sipEv = ev.filter((e) => e.sip && e.from);
  const party = c.direction === 'inbound' || (c.source && c.source.type === 'trunk') ? 'pbx' : 'net';
  return h`<div class="stack-4">
    ${c.sip === 503 ? h`<div class="note note-info">${icon('activity')}<span class="grow">${t('dr.incidentShort')}</span><a class="btn btn-sm" href="#/help/status?inc=20261027" data-action="lg.d.incident">${t('dr.viewStatus')}</a></div>` : ''}
    <ol class="lg-tl">${ev.map((e) => h`<li class="${e.tone ? 'is-' + e.tone : ''}"><span class="lg-tl-t mono">${offsetLabel(e.s)} s</span><span class="lg-tl-dot" aria-hidden="true"></span>
      <span class="lg-tl-l">${e.label}${e.sip ? h` <code class="mono lg-sip" translate="no">${e.sip}</code>` : ''}</span></li>`)}</ol>
    ${sipEv.length ? h`<div><button type="button" class="btn btn-sm" data-action="lg.d.ladder" aria-expanded="${!!ctx.state.ladder}">${icon(ctx.state.ladder ? 'chevron-up' : 'chevron-down', 'ico-sm')}${ctx.state.ladder ? t('tl.hideSip') : t('tl.showSip')}</button></div>
      ${ctx.state.ladder ? h`<div class="lg-ladder" role="table" aria-label="${t('tl.ladderAria')}">
        <div class="lg-lad-h" role="row"><span role="columnheader">ANTS</span><span role="columnheader"></span><span role="columnheader">${t(`tl.party.${party}`)}</span><span role="columnheader" class="num">ms</span></div>
        ${sipEv.map((e) => { const right = e.from === 'ants'; return h`<div class="lg-lad-r" role="row"><span role="cell"></span><span role="cell" class="lg-arrow ${right ? 'to-right' : 'to-left'}"><code class="mono" translate="no">${e.sip}</code></span><span role="cell"></span><span role="cell" class="num mono">${Math.round(e.s * 1000)}</span></div>`; })}
      </div>` : ''}` : h`<p class="hint">${t('tl.noSip')}</p>`}
  </div>`;
}

function playerHTML(ctx, c, { compact = false } = {}) {
  const { t, html: h, icon } = ctx;
  const segs = segmentsFor(ctx, c);
  const total = segs.length ? segs[segs.length - 1].end : 0;
  const mine = PL.callId === c.id;
  const playing = mine && PL.playing;
  const e = mine ? Math.min(total, playerElapsed()) : 0;
  return h`<div class="lg-player ${playing ? 'is-playing' : ''}" role="group" aria-label="${t('pl.aria')}">
    <button type="button" class="btn btn-navy lg-play" data-action="${compact ? 'lg.d.tr.play' : 'lg.d.rec.play'}" aria-pressed="${playing}">${icon(playing ? 'pause' : 'play', 'ico-sm')}${playing ? t('pl.pause') : compact ? t('pl.playTr') : t('pl.play')}</button>
    ${compact ? '' : h`<button type="button" class="btn btn-sm btn-ghost btn-icon" data-action="lg.d.rec.restart" aria-label="${t('pl.restart')}" data-tip-key="logs.pl.restart">${icon('refresh', 'ico-sm')}</button>
      <button type="button" class="btn btn-sm" data-action="lg.d.rec.speed" aria-label="${t('pl.speedAria')}">${PL.speed === 1 ? '1×' : '1.5×'}</button>`}
    <div class="grow stack lg-pl-track"><span class="progress" aria-hidden="true"><i data-pl-bar style="width:${total ? Math.round((e / total) * 100) : 0}%"></i></span>
      <span class="row-tight hint-xs"><span class="mono" data-pl-time>${mmss(e)} / ${mmss(total)}</span>${playing ? h`<span>·</span><span data-pl-who>${speaker(ctx, segs[Math.min(PL.seg, segs.length - 1)].who)}</span>` : ''}<span class="grow"></span><span>${t('pl.noSeek')}</span></span></div>
    ${mine && PL.note ? h`<p class="hint-xs lg-pl-note" role="status">${PL.note}</p>` : ''}
  </div>`;
}

function recordingTab(ctx, c) {
  const { t, html: h, icon, fmt } = ctx;
  if (isLive(c)) return h`<div class="empty"><span class="art">${icon('mic')}</span><strong>${t('rec.liveTitle')}</strong><span class="hint">${t('rec.liveBody')}</span></div>`;
  const segs = segmentsFor(ctx, c);
  if (c.recorded) {
    return h`<div class="stack-4"><div class="row-tight"><span class="chip chip-ok" tabindex="0" data-tip-key="logs.rec.storedTip">${icon('shield')}${t('rec.stored')}</span><span class="hint-xs">${t('rec.kept', { days: PRICES.recordingDays, until: fmt.dateProse(tsOf(c) + PRICES.recordingDays * 86400000) })}</span></div>
      ${playerHTML(ctx, c)}
      <p class="hint-xs">${c.id === SAMPLE_CALL ? t('rec.sampleNote') : t('rec.simNote')}</p>
      <div class="row"><button type="button" class="btn btn-sm" data-action="lg.d.rec.download">${icon('download', 'ico-sm')}${t('rec.download')}</button>
        ${c.transcribed ? h`<button type="button" class="btn btn-sm btn-ghost" data-action="lg.d.tab" data-value="transcript">${icon('file-text', 'ico-sm')}${t('rec.toTranscript')}</button>` : ''}</div></div>`;
  }
  if (segs.length) {
    return h`<div class="stack-4"><div class="note note-info">${icon('info')}<span>${t('rec.heard')}</span></div>${playerHTML(ctx, c)}
      <p class="hint-xs">${t('rec.offHint', { rate: fmt.rate(PRICES.recording), days: PRICES.recordingDays })}</p></div>`;
  }
  return h`<div class="empty"><span class="art">${icon('mic')}</span><strong>${c.status === 'completed' ? t('rec.none') : t('rec.notAnswered')}</strong>
    <span class="hint">${c.status === 'completed' ? t('rec.offHint', { rate: fmt.rate(PRICES.recording), days: PRICES.recordingDays }) : t('rec.notAnsweredHint')}</span>
    ${c.status === 'completed' ? h`<a class="btn btn-sm" href="#/help/article/recording-pdpa" data-action="lg.d.rec.settings">${t('rec.howTo')}</a>` : ''}</div>`;
}

function transcriptTab(ctx, c) {
  const { t, html: h, icon, fmt } = ctx;
  if (c.transcribed) {
    const lang = getLang();
    const segs = segmentsFor(ctx, c, lang);
    const mine = PL.callId === c.id;
    return h`<div class="stack-4"><div class="row-tight"><span class="chip chip-info">${t('tr.detected', { lang: LANGS[lang].label })}</span><span class="chip">${t('tr.simulated')}</span></div>
      ${playerHTML(ctx, c, { compact: true })}
      <ol class="lg-tr" aria-live="off">${segs.map((s, i) => h`<li class="lg-seg lg-${s.who}" data-seg="${i}"><span class="lg-seg-h"><strong>${speaker(ctx, s.who)}</strong> <span class="mono hint-xs">${mmss(s.start)}</span></span>
        <span class="lg-seg-t" lang="${LANGS[lang].html}">${raw(ctx.ui.audio.words(s.text, lang).map((w, k) => `<span class="w${mine && PL.playing && (i > PL.seg || (i === PL.seg && k > PL.word)) ? ' future' : ''}">${ctx.esc(w.text)}</span>`).join(''))}</span></li>`)}</ol>
      <div class="card card-sunken card-pad stack"><span class="label">${t('tr.summary')} <span class="chip chip-info">${t('common.beta')}</span></span><p class="hint">${t('tr.summaryText')}</p></div>
      <p class="hint-xs">${t('tr.cost', { rate: fmt.rate(PRICES.transcription), total: fmt.credits2(PRICES.transcription) })}</p>
      <div class="row"><button type="button" class="btn btn-sm" data-action="lg.d.tr.copy">${icon('copy', 'ico-sm')}${t('tr.copy')}</button>
        <button type="button" class="btn btn-sm" data-action="lg.d.tr.download">${icon('download', 'ico-sm')}${t('tr.download')}</button></div></div>`;
  }
  if (c.status !== 'completed' || isLive(c)) return h`<div class="empty"><span class="art">${icon('file-text')}</span><strong>${t('tr.nothing')}</strong><span class="hint">${t('tr.nothingHint')}</span></div>`;
  const st = ctx.state.trRun[c.id];
  return h`<div class="empty" aria-live="polite"><span class="art">${icon('file-text')}</span><strong>${t('tr.noneTitle')}</strong><span class="hint">${t('tr.noneBody')}</span>
    ${st === 'done' ? h`<div class="note note-info">${icon('info')}<span class="grow">${t('tr.demoOnly', { time: '14:27:02' })}</span><button type="button" class="btn btn-sm btn-navy" data-action="lg.d.tr.open">${t('tr.openIt')}</button></div>`
      : h`<button type="button" class="btn btn-sm" data-action="lg.d.tr.run" ${raw(st === 'run' ? 'aria-busy="true"' : '')}>${st === 'run' ? raw('<span class="spin" aria-hidden="true"></span>') : icon('sparkles', 'ico-sm')}${t('tr.run', { rate: fmt.rate(PRICES.transcription) })}</button>`}
    <span class="hint-xs">${t('tr.external')}</span></div>`;
}

function webhooksTab(ctx, c) {
  const { t, html: h, icon, fmt } = ctx;
  const list = webhookAttempts(ctx, c);
  if (!list.length) return h`<div class="empty"><span class="art">${icon('send')}</span><strong>${t('wh.none')}</strong><span class="hint">${t('wh.noneHint')}</span></div>`;
  return h`<div class="stack-3"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>${ctx.term(t('wh.event'), 'webhook')}</th><th>${t('wh.endpoint')}</th><th>${t('wh.result')}</th><th>${t('wh.time')}</th><th><span class="sr-only">${t('wh.actions')}</span></th></tr></thead>
    <tbody>${list.map((a) => h`<tr class="${a.resend ? 'new-row' : ''}"><td class="mono" translate="no">${a.event}</td><td class="mono clip" translate="no" style="max-width:180px">${a.host}</td>
      <td>${a.code === 200 ? h`<span class="chip chip-ok">${a.code} · ${a.ms} ms</span>` : h`<span class="chip chip-err" tabindex="0" data-tip-key="logs.wh.failTip">${a.code}</span> <span class="hint-xs">${t('wh.attempts', { n: a.attempts || 1 })}</span>`}${a.resend ? h` <span class="hint-xs">${t('wh.resent')}</span>` : ''}</td>
      <td class="mono">${fmt.time(a.at)}</td>
      <td class="num nowrap"><button type="button" class="btn btn-sm btn-ghost" data-action="lg.d.wh.view" data-value="${a.id}">${t('wh.view')}</button>
        <button type="button" class="btn btn-sm" data-action="lg.d.wh.resend" data-value="${a.id}">${t('wh.resend')}</button></td></tr>`)}</tbody></table></div>
    <p class="hint-xs">${t('wh.retryRule')}</p></div>`;
}

// ---------- page ----------
function header(ctx, rows) {
  const { t, html: h, icon, fmt } = ctx;
  return h`<div class="page-head"><div class="titles"><h1>${t('title')}${ctx.pageHelp()}</h1><span class="sub">${t('sub')}</span></div>
    <div class="tools"><button type="button" class="btn" data-action="lg.export" data-tip-key="logs.exportTip" data-tip-vars='${JSON.stringify({ n: fmt.int(rows.length) })}' ${raw(rows.length ? '' : 'aria-disabled="true" aria-describedby="lg-exp-help"')}>${icon('download', 'ico-sm')}${t('export')}</button>
      ${rows.length ? '' : h`<span class="hint-xs" id="lg-exp-help">${t('exportNone')}</span>`}</div></div>`;
}

function filterBar(ctx) {
  const { t, html: h, icon, fmt } = ctx;
  const f = ctx.state.f;
  const base = allCalls(ctx).filter((c) => matches(ctx, c, f, { ignoreStatus: true }));
  const cnt = (s) => (s === 'all' ? base.length : base.filter((c) => c.status === s).length);
  const live = liveCalls(ctx);
  const numbers = [...new Set([...(ctx.store.get('numbers') || []).map((n) => n.number), ...allCalls(ctx).map((c) => (c.direction === 'inbound' ? c.to : c.from))].filter(Boolean))];
  const srcs = new Map();
  for (const c of allCalls(ctx)) { const k = sourceKey(c); if (!srcs.has(k)) srcs.set(k, ctx.ui.describe.source(c)); }
  const subs = ctx.store.get('subAccounts') || [];
  return h`<div class="card lg-filters">
    <div class="lg-frow">
      <div class="seg" role="group" aria-label="${t('f.rangeAria')}">${RANGES.map((r) => h`<button type="button" data-action="lg.range" data-value="${r}" aria-pressed="${!f.date && f.range === r}">${r === 'custom' && f.range === 'custom' && f.from ? t('range.customV', { from: fmt.dayMonth(f.from), to: fmt.dayMonth(f.to) }) : t(`range.${r}`)}</button>`)}</div>
      ${f.date ? h`<span class="chip chip-navy">${icon('calendar')}${fmt.date(f.date)}<button type="button" class="chip-x" data-action="lg.date.clear" aria-label="${t('f.dateClear')}">${icon('x', 'ico-xs')}</button></span>` : ''}
      <div class="seg" role="group" aria-label="${t('f.dirAria')}">${['all', 'outbound', 'inbound'].map((d) => h`<button type="button" data-action="lg.dir" data-value="${d}" aria-pressed="${f.dir === d}">${d === 'all' ? t('f.dirAll') : t(`dir.${d}`)}</button>`)}</div>
      <label class="lg-search">${icon('search', 'ico-sm')}<input class="input" type="search" data-field="q" value="${f.q}" placeholder="${t('f.searchPh')}" aria-label="${t('f.searchPh')}" data-action="lg.search" spellcheck="false"></label>
    </div>
    <div class="lg-frow">
      <div class="lg-chips" role="group" aria-label="${t('f.statusAria')}">${STATUS_FILTERS.map((s) => h`<button type="button" class="lg-chip ${s !== 'all' ? 'lg-chip-' + s : ''}" data-action="lg.status" data-value="${s}" aria-pressed="${f.status === s}">${s === 'all' ? t('f.statusAll') : t(`status.${s}`)} <span class="mono">${fmt.int(cnt(s))}</span></button>`)}
        ${live.length ? h`<button type="button" class="lg-chip lg-chip-live" data-action="lg.live" data-value="in-progress" aria-pressed="${f.status === 'in-progress'}">${raw('<span class="dot dot-ok dot-live" aria-hidden="true"></span>')}${t('f.liveNow', { n: fmt.int(ctx.store.get('today.liveTotal') || live.length) })}</button>` : ''}</div>
      <div class="lg-selects">
        <select class="select" data-field="number" aria-label="${t('f.number')}" data-action="lg.number"><option value="all">${t('f.numberAll')}</option>${numbers.map((n) => h`<option value="${n}" ${raw(f.number === n ? 'selected' : '')}>${n}</option>`)}</select>
        <select class="select" data-field="src" aria-label="${t('f.source')}" data-action="lg.src"><option value="all">${t('f.sourceAll')}</option>${[...srcs.entries()].map(([k, v]) => h`<option value="${k}" ${raw(f.src === k ? 'selected' : '')}>${v}</option>`)}${f.src !== 'all' && !srcs.has(f.src) ? h`<option value="${f.src}" selected>${f.src}</option>` : ''}</select>
        ${subs.length > 1 ? h`<select class="select" data-field="sub" aria-label="${t('f.sub')}" data-action="lg.sub"><option value="all">${t('f.subAll')}</option>${subs.map((s) => h`<option value="${subKeyOf(s.id)}" ${raw(f.sub === subKeyOf(s.id) || f.sub === s.id ? 'selected' : '')}>${loc(s.name)}</option>`)}</select>` : ''}
        ${active(f) ? h`<button type="button" class="btn btn-sm btn-ghost" data-action="lg.clear">${icon('x', 'ico-sm')}${t('f.clear')}</button>` : ''}
      </div></div></div>`;
}

function table(ctx, rows) {
  const { t, html: h, icon, fmt } = ctx;
  const f = ctx.state.f;
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  ctx.state.page = Math.min(ctx.state.page, pages - 1);
  const p = ctx.state.page;
  const slice = rows.slice(p * PER_PAGE, p * PER_PAGE + PER_PAGE);
  const sel = DR.callId || ctx.params.query.call;
  const knownTop = ctx.state.knownTop;
  const topTs = knownTop ? (findCall(ctx, knownTop) ? tsOf(findCall(ctx, knownTop)) : 0) : Infinity;
  const live = f.status === 'in-progress';
  const last = p >= pages - 1;
  return h`<div class="card lg-list"><div class="tbl-wrap"><table class="tbl lg-tbl">
    <thead><tr><th>${t('c.time')}</th><th>${t('c.number')}</th><th>${t('c.dir')}</th><th>${t('c.source')}</th><th>${t('c.sub')}</th><th>${t('c.status')}</th><th class="num">${t('c.talk')}</th><th class="num">${ctx.term(t('c.credits'), 'billing_minute')}</th><th><span class="sr-only">${t('c.open')}</span></th></tr></thead>
    <tbody>${slice.map((c) => {
      const fresh = !live && tsOf(c) > topTs && c.id !== knownTop;
      return h`<tr class="${c.id === sel ? 'is-sel' : ''} ${fresh ? 'new-row' : ''}" data-call="${c.id}">
        <td class="mono lg-time"><a href="#/logs${qsOf(f, { call: c.id })}" data-action="lg.row" data-value="${c.id}" aria-label="${t('c.openAria', { time: fmt.time(c.ts), party: party(c) || c.party || '' })}">${fmt.time(c.ts)}</a></td>
        <td class="mono" translate="no">${party(c) || c.party || '—'}</td>
        <td>${ctx.ui.describe.direction(c)}</td>
        <td class="clip lg-src">${ctx.ui.describe.source(c)}</td>
        <td class="nowrap lg-subcol">${ctx.ui.describe.sub(c.sub)}</td>
        <td class="lg-stcol">${ctx.ui.describe.statusChip(c.status)}</td>
        <td class="num mono" ${raw(live ? `data-live-start="${tsOf(c)}"` : '')}>${live ? fmt.duration((nowMs() - tsOf(c)) / 1000) : c.sec ? fmt.duration(c.sec) : '—'}</td>
        <td class="num mono">${live ? '—' : fmt.credits2(c.credits || 0)}${!live && c.planMin ? h`<span class="hint-xs lg-block">${ctx.ui.describe.plusPlanMin(c.planMin)}</span>` : ''}</td>
        <td class="num lg-chev">${icon('chevron-right', 'ico-sm')}</td></tr>`;
    })}</tbody></table></div>
    <div class="card-foot row lg-pager"><span class="hint-xs grow">${live ? t('page.live', { shown: fmt.int(rows.length), total: fmt.int(ctx.store.get('today.liveTotal') || rows.length) }) : t('page.line', { from: fmt.int(p * PER_PAGE + 1), to: fmt.int(p * PER_PAGE + slice.length), total: fmt.int(rows.length) })} ${!live && ctx.store.get('mode') === 'active' ? t('page.keeps') : ''}</span>
      ${p > 0 ? h`<button type="button" class="btn btn-sm" data-action="lg.page.prev">${icon('chevron-left', 'ico-sm')}${t('page.prev')}</button>` : ''}
      ${!last ? h`<button type="button" class="btn btn-sm" data-action="lg.page.next">${t('page.next')}${icon('chevron-right', 'ico-sm')}</button>` : pages > 1 ? h`<span class="hint-xs">${t('page.end')}</span>` : ''}</div></div>`;
}

function emptyState(ctx) {
  const { t, html: h, icon } = ctx;
  const sandbox = ctx.store.get('env') === 'sandbox';
  return h`<div class="card"><div class="empty lg-empty"><span class="art">${icon('list')}</span><h2>${sandbox && ctx.store.get('mode') === 'active' ? t('empty.sandboxTitle') : t('empty.title')}</h2><p class="hint">${t('empty.body')}</p>
    <div class="steps"><div><span class="stepnum">1</span>${t('empty.s1')}</div><div><span class="stepnum">2</span>${t('empty.s2')}</div><div><span class="stepnum">3</span>${t('empty.s3')}</div></div>
    <div class="row"><a class="btn btn-navy" href="#/connect" data-action="lg.empty.connect">${icon('plug', 'ico-sm')}${t('empty.connect')}</a>
    <button type="button" class="btn btn-primary" data-action="lg.empty.call">${icon('phone', 'ico-sm')}${t('empty.call')}</button></div></div></div>`;
}

function noResults(ctx) {
  const { t, html: h, icon, fmt } = ctx;
  const f = ctx.state.f;
  const old = f.date && f.date < '2026-10-27';
  return h`<div class="card"><div class="empty empty-center lg-nores" role="status"><span class="art">${icon('filter')}</span><strong>${t('nores.title')}</strong>
    <span class="hint">${old ? t('nores.old', { date: fmt.dateProse(f.date) }) : t('nores.body')}</span>
    <div class="row" style="justify-content:center"><button type="button" class="btn btn-sm btn-navy" data-action="lg.nores.clear">${t('f.clear')}</button>
    ${old ? h`<a class="btn btn-sm" href="#/reports" data-action="lg.nores.reports">${icon('chart', 'ico-sm')}${t('nores.reports')}</a>` : ''}</div></div></div>`;
}

export function render(ctx) {
  const { html: h } = ctx;
  syncQuery(ctx);
  const rows = filtered(ctx);
  const anyCalls = allCalls(ctx).length > 0;
  return h`<div class="page lg">${header(ctx, rows)}
    ${anyCalls || liveCalls(ctx).length ? h`${filterBar(ctx)}${rows.length ? table(ctx, rows) : noResults(ctx)}` : emptyState(ctx)}</div>`;
}

function exportCsv(ctx) {
  const { t, fmt } = ctx;
  const rows = filtered(ctx).filter((c) => !isLive(c));
  if (!rows.length) return;
  const f = ctx.state.f;
  const slug = [f.status !== 'all' ? f.status : null, f.src !== 'all' ? f.src : null, f.dir !== 'all' ? f.dir : null, f.q ? 'search' : null].filter(Boolean).join('-') || 'all';
  ctx.ui.csv(`ants-voice-calls_${ymd(DEMO_NOW)}_${slug}.csv`, rows, [
    { key: 'call_id', label: 'call_id', value: (c) => c.id },
    { key: 'started_at', label: 'started_at', value: (c) => fmt.iso(c.ts) },
    { key: 'direction', label: 'direction', value: (c) => c.direction },
    { key: 'source', label: 'source', value: (c) => `${(c.source || {}).type || ''}:${(c.source || {}).ref || ''}` },
    { key: 'subaccount', label: 'subaccount', value: (c) => c.sub || '' },
    { key: 'from', label: 'from', value: (c) => c.from || '' },
    { key: 'to', label: 'to', value: (c) => c.to || '' },
    { key: 'status', label: 'status', value: (c) => c.status },
    { key: 'sip_code', label: 'sip_code', value: (c) => c.sip || '' },
    { key: 'q850', label: 'q850', value: (c) => c.q850 || '' },
    { key: 'talk_seconds', label: 'talk_seconds', value: (c) => c.sec || 0 },
    { key: 'billed', label: 'billed', value: (c) => c.billedMin || 0 },
    { key: 'credits', label: 'credits', value: (c) => (c.credits || 0).toFixed(2) },
    ...(activePlan() ? [{ key: 'plan_minutes', label: 'plan_minutes', value: (c) => c.planMin || 0 }] : []),
    { key: 'recording', label: 'recording', value: (c) => (c.recorded ? 'yes' : 'no') },
    { key: 'route', label: 'route', value: (c) => c.route || '' },
    { key: 'campaign_id', label: 'campaign_id', value: (c) => ((c.source || {}).type === 'campaign' ? c.source.ref : '') },
    { key: 'dtmf', label: 'dtmf', value: (c) => c.keys || '' },
    { key: 'reason_text', label: 'reason_text', value: (c) => reasonText(ctx, c) },
  ]);
  ctx.ui.toast(t('toast.T05', { n: fmt.int(rows.length) }), { kind: 'success' });
}

function customRange(ctx) {
  const { t, html: h } = ctx;
  const f = ctx.state.f;
  const today = ymd(nowMs());
  const min = ymd(nowMs() - 89 * 86400000);
  const m = ctx.ui.modal({
    title: t('custom.title'), size: 'sm',
    body: h`<div class="grid g-2"><label class="field"><span class="label">${t('custom.from')}</span><input class="input" type="date" data-c="from" min="${min}" max="${today}" value="${f.from || ymd(nowMs() - 6 * 86400000)}"></label>
      <label class="field"><span class="label">${t('custom.to')}</span><input class="input" type="date" data-c="to" min="${min}" max="${today}" value="${f.to || today}"></label></div>
      <p class="hint-xs lg-custom-max">${t('custom.max')}</p><p class="field-err" data-c="err" hidden>${t('custom.err')}</p>`,
    buttons: [{ label: t('common.cancel') }, { label: t('custom.apply'), kind: 'navy', onClick: (hd) => {
      const a = hd.el.querySelector('[data-c="from"]').value;
      const b = hd.el.querySelector('[data-c="to"]').value;
      const days = (Date.parse(b) - Date.parse(a)) / 86400000;
      if (!a || !b || days < 0 || days > 89) { hd.el.querySelector('[data-c="err"]').hidden = false; return false; }
      setFilters(ctx, { range: 'custom', from: a, to: b, date: null });
      return true;
    } }],
  });
  return m;
}

export function mount(root, ctx) {
  const { t } = ctx;
  CTX = ctx;
  ctx.ui.audio.tts.ready();
  // Top of the list when this screen was last drawn: newer rows flash once (a test call just made, a campaign run).
  const top = allCalls(ctx).slice().sort((a, b) => tsOf(b) - tsOf(a))[0];
  if (top && ctx.state.knownTop !== top.id) ctx.later(() => { ctx.state.knownTop = top.id; }, 1600);

  ctx.actions(root, {
    'lg.range': (el) => { if (el.dataset.value === 'custom') customRange(ctx); else setFilters(ctx, { range: el.dataset.value, date: null, from: null, to: null }); },
    'lg.date.clear': () => setFilters(ctx, { date: null }),
    'lg.dir': (el) => setFilters(ctx, { dir: el.dataset.value }),
    'lg.status': (el) => setFilters(ctx, { status: el.dataset.value }),
    'lg.live': () => setFilters(ctx, { status: ctx.state.f.status === 'in-progress' ? 'all' : 'in-progress' }),
    'lg.search': () => {}, 'lg.number': () => {}, 'lg.src': () => {}, 'lg.sub': () => {},
    'lg.clear': () => { ctx.state.f = { ...DEF }; ctx.state.page = 0; history.replaceState(history.state, '', `#/logs${qsOf(DEF, { call: DR.callId })}`); ctx.rerender(); },
    'lg.nores.clear': () => { ctx.state.f = { ...DEF }; ctx.state.page = 0; history.replaceState(history.state, '', '#/logs'); ctx.rerender(); },
    'lg.nores.reports': () => {},
    'lg.export': () => exportCsv(ctx),
    'lg.row': (el, ev) => { ev.preventDefault(); ctx.go(`logs${qsOf(ctx.state.f, { call: el.dataset.value })}`); },
    'lg.page.prev': () => { ctx.state.page = Math.max(0, ctx.state.page - 1); ctx.rerender(); root.querySelector('.lg-list')?.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' }); },
    'lg.page.next': () => { ctx.state.page += 1; ctx.rerender(); root.querySelector('.lg-list')?.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' }); },
    'lg.empty.connect': () => {},
    'lg.empty.call': () => ctx.ui.dialer.open({ source: 'logs' }),
  });
  ctx.inputs(root, {
    q: (v) => { ctx.state.f = { ...ctx.state.f, q: v }; ctx.state.page = 0; history.replaceState(history.state, '', `#/logs${qsOf(ctx.state.f, { call: DR.callId })}`); ctx.rerender(); },
    number: (v) => setFilters(ctx, { number: v }),
    src: (v) => setFilters(ctx, { src: v }),
    sub: (v) => setFilters(ctx, { sub: v }),
  });
  // `call_…` + Enter opens that call straight away (IME-safe).
  ctx.on(root, 'keydown', '[data-field="q"]', (ev, el) => {
    if (ev.key !== 'Enter' || ev.isComposing || ev.keyCode === 229) return;
    const v = el.value.trim();
    if (/^call_/i.test(v)) { const c = ctx.list('calls').find((x) => x.id.toLowerCase().startsWith(v.toLowerCase())); if (c) { ev.preventDefault(); ctx.go(`logs${qsOf({ ...ctx.state.f, q: '' }, { call: c.id })}`); } }
  });
  // Click anywhere on a row opens it (the time link is the keyboard target).
  ctx.on(root, 'click', '.lg-tbl tbody tr', (ev, tr) => {
    if (ev.target.closest('a, button, .term, .chip')) return;
    ev.__handled = true;
    ctx.go(`logs${qsOf(ctx.state.f, { call: tr.dataset.call })}`);
  });
  ctx.watch('calls', 'env', 'mode', 'liveCalls', 'campaigns');
  // Live calls tick from the demo clock.
  ctx.every(() => { root.querySelectorAll('[data-live-start]').forEach((td) => { td.textContent = ctx.fmt.duration((nowMs() - Number(td.dataset.liveStart)) / 1000); }); }, 1000);
  if (ctx.params.query.export === '1' && ctx.state.exported !== ctx.params) { ctx.state.exported = ctx.params; ctx.later(() => { exportCsv(ctx); history.replaceState(history.state, '', `#/logs${qsOf(ctx.state.f)}`); }, 200); }

  // Drawer follows ?call= (linkable, survives reload and the browser back button).
  const want = ctx.params.query.call;
  const call = want ? findCall(ctx, want) : null;
  if (call) openDrawer(ctx, call);
  else if (DR.handle) closeDrawer();
  if (want && !call && ctx.state.missing !== ctx.params) { ctx.state.missing = ctx.params; ctx.later(() => ctx.ui.toast(t('dr.notFound', { id: want }), { kind: 'warn', reqId: true }), 50); }
  // Focus back on the row the drawer was opened from.
  if (!call && ctx.state.focusCall) {
    const fc = ctx.state.focusCall;
    ctx.state.focusCall = null;
    ctx.later(() => { const a = root.querySelector(`[data-action="lg.row"][data-value="${fc}"]`); if (a) a.focus({ preventScroll: true }); }, 30);
  }
  ctx.cleanup(() => { if (!isLogs()) { closeDrawer(); } });
  // Arrow keys move between drawer tabs (WAI-ARIA tabs pattern).
  if (DR.handle) {
    const el = DR.handle.el;
    if (!el.__lgTabs) {
      el.__lgTabs = true;
      el.addEventListener('keydown', (ev) => {
        if (!ev.target.matches('[role="tab"]') || (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft')) return;
        const tabs = ['summary', 'timeline', 'recording', 'transcript', 'webhooks'];
        const i = tabs.indexOf(CTX.state.dtab || 'summary');
        CTX.state.dtab = tabs[(i + (ev.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        refreshDrawer();
        const b = DR.handle && DR.handle.el.querySelector(`[role="tab"][data-value="${CTX.state.dtab}"]`);
        if (b) b.focus();
        ev.preventDefault();
      });
    }
  }
}
