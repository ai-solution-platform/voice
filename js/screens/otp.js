// OTP & Notifications — #/otp (?template=<id> opens the editor)
// API test console (number, template, language → POST /v1/voice/otp → animated status: accepted → calling → ringing →
// answered → code read twice by TTS → completed → webhook), templates in three languages with a TTS preview and an
// editor (modal), delivery stats (tiles, chart, funnel), the latest deliveries and OTP protection (abuse limits).
// Numbers reconcile with the OTP stats and
// the daily series in js/data/active.js (7 days: 1,342 sent · 1,171 answered · 1,159.29 credits).

import { raw, reducedMotion } from '../core/dom.js';
import { replaceSafely } from '../core/press.js';
import { addCall, newId, audit } from '../core/actions.js';
import { tIn, getLang, LANGS, LANG_ORDER, loc } from '../core/i18n.js';
import { store } from '../core/store.js';
import { nowMs } from '../data/clock.js';
import { PRICES, callCost } from '../data/prices.js';
import { API_BASE, SANDBOX_CALLER } from '../data/edge.js';
import { BRAND, CLINIC, SUBS } from '../data/active.js';
import { reqId as makeReqId, reqIdLine } from '../ui/reqid.js';

export const id = 'otp';
export const nav = { group: 'build', icon: 'shield-check', labelKey: 'nav.otp' };
export const titleKey = 'nav.otp';
export const skeleton = 'form';
export const css = true;
export const initialState = () => ({
  range: '7d', delivTpl: 'all', qParams: null,
  con: { to: null, toInput: '081-xxx-0101', tpl: null, lang: null, code: '', outcome: 'answered', body: null, bodyErr: null, verifyIn: '' },
  protect: { rate: true, rateN: 3, rateMin: 10, daily: true, dailyN: 10, hook: false, hookUrl: 'https://hooks.example.com/ants/otp-check', dirty: false },
  sends: [],
});

export const commands = [
  { id: 'console', labelKey: 'cmd.console', icon: 'terminal', keywords: ['otp api console send code verify'], run: ({ go }) => go('otp?focus=console') },
];

const BUILTIN = { id: 'otp-default', type: 'otp', sub: null, languages: ['th', 'en', 'zh'], voice: 'standard-th-female', rate: 0.9, settings: { digits: 6, expiresMin: 5, repeatKey: 1, repeats: 2, lockAfterWrong: 3, smsFallbackSec: null }, status: 'live', version: 1, sent7d: 0, builtin: true };
const DIGITS = {
  en: ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'],
  th: ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'],
  zh: ['零', '幺', '二', '三', '四', '五', '六', '七', '八', '九'],
};
const SAMPLE_CODE = '408913';
const NAME_RE = /^[a-z0-9-]{3,40}$/;
const RANGES = ['today', '7d', '30d'];

// ---------- helpers ----------
const isOtp = () => /^#\/otp(\?|$)/.test(location.hash);
const env = () => store.get('env');
const templates = (ctx) => (ctx.list('otpTemplates').length ? ctx.list('otpTemplates') : [BUILTIN]);
const findTpl = (ctx, tid) => templates(ctx).find((x) => x.id === tid) || null;
const voiceOf = (v) => { const p = String(v || 'standard-th-female').split('-'); return { tier: p[0] === 'premium' ? 'premium' : 'standard', gender: p[p.length - 1] === 'male' ? 'male' : 'female' }; };
const groups = (code) => { const d = String(code).replace(/\D/g, ''); const half = Math.ceil(d.length / 2); return [d.slice(0, half), d.slice(half)].filter(Boolean); };
const showCode = (code) => groups(code).join(' ');
const spokenGroup = (g, lang) => g.split('').map((d) => DIGITS[lang][Number(d)]).join(lang === 'en' ? ', ' : lang === 'zh' ? '，' : ' ');
const toE164 = (n) => String(n || '').replace(/^0/, '+66').replace(/-/g, '');
const normDigits = (s) => String(s || '').replace(/[๐-๙]/g, (d) => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(d))).replace(/\D/g, '');
let codeSeq = 0;
function nextCode() {
  codeSeq += 1;
  if (codeSeq === 1) return SAMPLE_CODE;
  let x = (Math.floor(nowMs() / 1000) * 2654435761 + codeSeq * 40503) >>> 0;
  return String(100000 + (x % 900000));
}
const sampleVars = (lang, code = SAMPLE_CODE) => ({ brand: BRAND[lang] || BRAND.en, code: showCode(code), name: tIn(lang, 'otp.sample.name'), order_id: '5120', window: tIn(lang, 'otp.sample.window'), clinic: CLINIC[lang] || CLINIC.en, date: tIn(lang, 'otp.sample.date'), time: tIn(lang, 'otp.sample.time') });
const fillVars = (text, vars) => String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
const dictText = (tid, lang) => tIn(lang, `otp.tpl.${tid === 'otp-default' ? 'otp-login' : tid}.text`);
const dictKey = (tid) => (tid === 'otp-default' ? 'otp-login' : tid);
const hasDict = (tid) => ['otp-login', 'otp-payment-confirm', 'notify-delivery-eta', 'appointment-reminder', 'otp-default'].includes(tid);
/** Display text of a template in a language, or null when that language is not set. */
function textOf(tpl, lang) {
  if (tpl.texts && tpl.texts[lang] != null) return tpl.texts[lang];
  if (tpl.languages && tpl.languages.includes(lang) && hasDict(tpl.id)) return dictText(tpl.id, lang);
  return null;
}
/** The language a call really uses: the requested one, or English when the template has no text in it. */
const callLang = (tpl, lang) => (textOf(tpl, lang) != null ? lang : textOf(tpl, 'en') != null ? 'en' : (tpl.languages || ['th'])[0]);
/** Speak parts: built-in scripts come from the dictionary (codes as their own parts at rate 0.8). */
function speakParts(tpl, lang, code) {
  const edited = tpl.texts && tpl.texts[lang] != null && tpl.texts[lang] !== (hasDict(tpl.id) ? dictText(tpl.id, lang) : null);
  const codeParts = groups(code).map((g) => ({ text: spokenGroup(g, lang), rate: 0.8, code: true }));
  if (!edited && hasDict(tpl.id)) {
    const arr = tIn(lang, `otp.tpl.${dictKey(tpl.id)}.speak`) || [];
    const out = [];
    let n = 0;
    for (const p of arr) { if (p === '#CODE') { n += 1; out.push(...codeParts.map((c) => ({ ...c, codeRead: n }))); } else out.push({ text: p }); }
    return { parts: out, edited: false };
  }
  const text = textOf(tpl, lang) || '';
  const pieces = text.split('{code}');
  const vars = sampleVars(lang, code);
  const out = [];
  pieces.forEach((p, i) => {
    const s = fillVars(p, vars).trim();
    if (s) out.push({ text: s });
    if (i < pieces.length - 1) out.push(...codeParts.map((c) => ({ ...c, codeRead: i + 1 })));
  });
  return { parts: out, edited: true };
}
function genderIssue(lang, gender, text) {
  if (lang !== 'th' || !text) return null;
  if (gender === 'female' && /ครับ/.test(text)) return 'female';
  if (gender === 'male' && /ค่ะ|คะ/.test(text)) return 'male';
  return null;
}
const fixParticles = (gender, text) => (gender === 'female' ? String(text).replace(/ครับ/g, 'ค่ะ') : String(text).replace(/ค่ะ|คะ/g, 'ครับ'));

// Anti-scam line (T2 audit #3): every built-in and new template says it; the editor flags a text without it.
const scamLine = (type, lang) => tIn(lang, type === 'otp' ? 'otp.scam.otp' : 'otp.scam.alert');
/** Does the text (in a language) contain the anti-scam line? {brand} or {clinic} both count as the sender. */
function hasScamLine(type, text, lang) {
  if (text == null) return true;
  const vars = sampleVars(lang);
  const flat = (s) => String(s).replace(/\s+/g, ' ');
  const filled = flat(fillVars(text, vars));
  const lines = type === 'otp' ? [scamLine('otp', lang)] : [scamLine('alert', lang), scamLine('otp', lang)];
  return lines.some((l) => [l, l.replace(/\{brand\}/g, '{clinic}')].some((x) => filled.includes(flat(fillVars(x, vars)))));
}
const newText = (type, lang) => tIn(lang, type === 'otp' ? 'otp.tpl.newOtp' : 'otp.tpl.newAlert');

/** Pick the voice and decide what may be spoken: typed text only by an on-device voice. */
function planVoice(ctx, lang, premium, edited) {
  const tts = ctx.ui.audio.tts;
  const pick = tts.pick(LANGS[lang].tts, { premium });
  let note = null;
  let use = lang;
  if (!tts.supported() || pick.match === 'none') note = ctx.t('voice.none');
  else if (pick.match !== 'exact' && lang !== 'en') { note = ctx.t('dialer.fallbackVoiceNote', { lang: LANGS[lang].label }); use = 'en'; }
  const builtinOnly = edited && pick.voice && !pick.local;
  if (builtinOnly) note = ctx.t('dialer.remoteVoiceNote');
  return { lang: use, note, builtinOnly };
}

// ---------- stats (7-day totals + the daily series) ----------
function stats(ctx, range) {
  const s7 = ctx.store.get('otpStats');
  const extra = consoleExtra(ctx, range);
  if (!s7) return { sent: extra.sent, otpSent: extra.otpSent, answered: extra.answered, otpAnswered: extra.otpAnswered, verified: extra.verified, smsFallback: 0, notAnswered: extra.sent - extra.answered, credits: extra.credits, days: [], empty: !extra.sent };
  let base;
  if (range === '7d') base = { ...s7 };
  else {
    const series = ctx.store.get('series') || [];
    const days = range === 'today' ? series.slice(-1) : series.slice(-30);
    const sent = days.reduce((s, d) => s + d.otpSent, 0);
    const answered = days.reduce((s, d) => s + d.otpAnswered, 0);
    if (range === 'today') {
      const td = s7.today;
      base = { sent: td.otpSent + td.notifSent, otpSent: td.otpSent, notifSent: td.notifSent, answered: td.otpAnswered + td.notifAnswered, otpAnswered: td.otpAnswered, notifAnswered: td.notifAnswered };
    } else {
      const otpShare = s7.otpSent / s7.sent;
      const otpSent = Math.round(sent * otpShare);
      const otpAnswered = Math.round(answered * (s7.otpAnswered / s7.answered));
      base = { sent, otpSent, notifSent: sent - otpSent, answered, otpAnswered, notifAnswered: answered - otpAnswered };
    }
    base.verified = Math.round(base.otpAnswered * (s7.verified / s7.otpAnswered));
    base.smsFallback = Math.round(base.otpSent * (s7.smsFallback / s7.otpSent));
    base.notAnswered = base.sent - base.answered;
    base.credits = Math.round(base.answered * PRICES.otpPerAnsweredCall * 100) / 100;
  }
  const series = ctx.store.get('series') || [];
  const days = range === '30d' ? series.slice(-30) : series.slice(-7);
  return {
    ...base, sent: base.sent + extra.sent, otpSent: base.otpSent + extra.otpSent, answered: base.answered + extra.answered, otpAnswered: base.otpAnswered + extra.otpAnswered,
    verified: base.verified + extra.verified, notAnswered: base.notAnswered + (extra.sent - extra.answered), credits: Math.round((base.credits + extra.credits) * 100) / 100,
    days: days.map((d) => ({ date: d.date, sent: d.otpSent, answered: d.otpAnswered })), empty: false,
  };
}
/** Calls sent from this console during the demo (they count in every range: they happened just now). */
function consoleExtra(ctx) {
  const list = ctx.list('calls').filter((c) => c.byOtpConsole && c.env === env());
  const otp = list.filter((c) => c.source.type === 'otp');
  const ans = list.filter((c) => c.status === 'completed');
  return { sent: list.length, otpSent: otp.length, answered: ans.length, otpAnswered: otp.filter((c) => c.status === 'completed').length, verified: list.filter((c) => c.verifiedAt).length, credits: list.reduce((s, c) => s + (c.credits || 0), 0) };
}

// ---------- the API console run (module level: survives re-renders, language switches) ----------
let RUN = null; // { tok, steps, code, to, tpl, lang, outcome, response, done, callId, otpId, verify, startedAt, expiresAt, target: 'console'|'editor' }
let CTX = null;
let speech = null;
let stopRing = null;
function stopAudio() {
  if (speech) { try { speech.stop(); } catch { /* ignore */ } speech = null; }
  if (stopRing) { try { stopRing(); } catch { /* ignore */ } stopRing = null; }
}

function step(run, key, state, vars) {
  const s = run.steps.find((x) => x.key === key);
  if (s) { if (s.state !== state) s.at = nowMs(); s.state = state; if (vars) s.vars = { ...s.vars, ...vars }; }
  else run.steps.push({ key, state, vars: vars || {}, at: nowMs() });
  paintRun();
}
function paintRun() {
  if (!CTX || !RUN) return;
  const box = document.querySelector(RUN.target === 'editor' ? '[data-ed-run]' : '[data-run]');
  if (box) box.innerHTML = String(runHTML(CTX, RUN));
  const v = document.querySelector('[data-verify]');
  if (v && RUN.target === 'console') v.outerHTML = String(verifyHTML(CTX));
}

/**
 * Send a request through the simulated API. opts: { tpl, to, lang, code, outcome, target }.
 * Writes a Logs row (actions.addCall) when a call was placed.
 */
function sendOtp(ctx, opts) {
  const { t } = ctx;
  stopAudio();
  ctx.ui.audio.unlock(); // inside the click handler: browsers block audio that starts later
  const tpl = opts.tpl;
  const isOtpType = tpl.type === 'otp';
  const code = isOtpType ? (opts.code ? normDigits(opts.code) : nextCode()) : null;
  const lang = callLang(tpl, opts.lang);
  const run = { tok: Date.now() + Math.random(), steps: [], code, to: opts.to, tpl: tpl.id, tplType: tpl.type, lang, langAsked: opts.lang, outcome: opts.outcome, response: null, done: false, callId: null, otpId: newId(isOtpType ? 'otp' : 'call'), verify: { attempts: 0, locked: false, valid: false, last: null }, startedAt: nowMs(), expiresAt: nowMs() + ((tpl.settings && tpl.settings.expiresMin) || 5) * 60000, target: opts.target || 'console' };
  RUN = run;
  const live = () => RUN === run;
  const later = (fn, ms) => setTimeout(() => { if (live()) fn(); }, reducedMotion() ? Math.min(ms, 250) : ms);
  const p = ctx.state.protect;
  // OTP protection: limits are checked before any call is placed.
  const recent = ctx.state.sends.filter((s) => s.to === opts.to && nowMs() - s.at < p.rateMin * 60000).length;
  const today = ctx.state.sends.filter((s) => s.to === opts.to).length;
  const blocked = isOtpType && ((p.rate && recent >= p.rateN) ? 'rate' : (p.daily && today >= p.dailyN) ? 'daily' : null);
  step(run, 'request', 'run');
  later(() => {
    if (blocked) {
      run.response = { code: 429, body: { error: blocked === 'rate' ? 'otp_rate_limited' : 'otp_daily_cap', detail: blocked === 'rate' ? `max ${p.rateN} calls per number in ${p.rateMin} minutes` : `max ${p.dailyN} calls per number per day` } };
      step(run, 'request', 'err');
      step(run, blocked === 'rate' ? 'blockedRate' : 'blockedDaily', 'err', { n: blocked === 'rate' ? p.rateN : p.dailyN, m: p.rateMin });
      run.done = true;
      paintRun();
      return;
    }
    run.response = { code: 201, body: isOtpType ? { id: run.otpId, status: 'queued', expires_at: ctx.fmt.iso(run.expiresAt) } : { id: run.otpId, status: 'queued' } };
    step(run, 'request', 'ok');
    ctx.state.sends.push({ to: opts.to, at: nowMs() });
    let tNext = 0;
    if (p.hook && isOtpType) { step(run, 'hook', 'run'); tNext = 600; later(() => step(run, 'hook', 'ok', { ms: 34 }), 600); }
    later(() => {
      step(run, 'calling', 'run', { to: opts.to, from: callerFor(ctx, tpl) });
      later(() => {
        step(run, 'calling', 'ok');
        step(run, 'ringing', 'run');
        stopRing = ctx.ui.audio.tones.ringback(2);
        const ringMs = opts.outcome === 'busy' ? 1000 : opts.outcome === 'no-answer' ? 6000 : 2100;
        later(() => {
          if (stopRing) { stopRing(); stopRing = null; }
          ctx.ui.audio.tones.stop();
          if (opts.outcome !== 'answered') {
            step(run, 'ringing', 'err');
            step(run, opts.outcome === 'busy' ? 'busy' : 'noanswer', 'err');
            if (opts.outcome === 'busy') ctx.ui.audio.tones.busy(3);
            finish(ctx, run, tpl, { status: opts.outcome, sec: 0 });
            return;
          }
          step(run, 'ringing', 'ok');
          step(run, 'answered', 'ok');
          speakRun(ctx, run, tpl, code, lang);
        }, ringMs);
      }, 700);
    }, tNext + 500);
  }, 450);
  return run;
}

function callerFor(ctx, tpl) {
  if (env() === 'sandbox') return SANDBOX_CALLER;
  const n = (ctx.store.get('numbers') || []).find((x) => x.status === 'active' && x.sub === tpl.sub) || (ctx.store.get('numbers') || []).find((x) => x.status === 'active');
  return n ? n.number : SANDBOX_CALLER;
}

function speakRun(ctx, run, tpl, code, lang) {
  const tts = ctx.ui.audio.tts;
  const isOtpType = tpl.type === 'otp';
  const vv = voiceOf(tpl.voice);
  const sp = speakParts(tpl, lang, code || SAMPLE_CODE);
  const plan = planVoice(ctx, lang, vv.tier === 'premium', sp.edited);
  let parts = plan.builtinOnly || plan.lang !== lang ? speakParts({ ...tpl, texts: null, languages: [plan.lang] }, plan.lang, code || SAMPLE_CODE).parts : sp.parts;
  if (env() === 'sandbox') parts = [{ text: tIn(plan.lang, 'dialer.sandboxLine') }, ...parts];
  parts = parts.map((x) => ({ ...x, rate: (x.rate || 1) * (tpl.rate || 1) }));
  run.note = plan.note;
  run.spoken = { lang: LANGS[plan.lang].tts, text: parts.map((x) => x.text).join(' ') };
  step(run, isOtpType ? 'code1' : 'message', 'run');
  // Map word indexes to code reads, so "Code read (1 of 2)" ticks when the voice reaches it.
  const ranges = [];
  let w = 0;
  for (const x of parts) { const n = ctx.ui.audio.words(x.text + ' ', plan.lang).length; if (x.codeRead) ranges.push({ read: x.codeRead, from: w, to: w + n - 1 }); w += n; }
  const seen = new Set();
  run.t0 = Date.now();
  speech = tts.speak(parts, {
    lang: LANGS[plan.lang].tts, premium: vv.tier === 'premium',
    onWord: (i) => {
      if (RUN !== run || !isOtpType) return;
      for (const r of ranges) {
        if (i >= r.to && !seen.has(r.read)) {
          seen.add(r.read);
          if (r.read === 1) { step(run, 'code1', 'ok'); step(run, 'code2', 'run'); } else step(run, 'code2', 'ok');
        }
      }
    },
  });
  speech.done.then(() => {
    if (RUN !== run) return;
    if (isOtpType) { step(run, 'code1', 'ok'); step(run, 'code2', 'ok'); } else step(run, 'message', 'ok');
    finish(ctx, run, tpl, { status: 'completed', sec: Math.max(18, Math.min(55, Math.round((Date.now() - run.t0) / 1000) + 2)) });
  });
}

function finish(ctx, run, tpl, { status, sec }) {
  const { t, fmt } = ctx;
  const isOtpType = tpl.type === 'otp';
  const answered = status === 'completed';
  const e = env();
  const credits = callCost({ kind: 'otp', sec, answered, env: e });
  const sip = { completed: 200, busy: 486, 'no-answer': 480 }[status];
  const q850 = { completed: 16, busy: 17, 'no-answer': 19 }[status];
  const t0 = new Date(run.startedAt);
  const ev = (event, ms, s) => ({ event, sip: s || null, at: new Date(t0.getTime() + ms).toISOString() });
  const events = [ev('created', 0, '201'), ev('queued', 300), ev('initiated', 900, '100 Trying'), ev('ringing', 1600, '180 Ringing')];
  if (answered) events.push(ev('answered', 3700, '200 OK'), ev('completed', 3700 + sec * 1000, 'BYE'));
  else events.push(ev(status === 'busy' ? 'busy' : 'noanswer', status === 'busy' ? 2600 : 7600, status === 'busy' ? '486' : '480'));
  const rec = addCall({
    kind: 'otp', direction: 'outbound', env: e, from: callerFor(ctx, tpl), to: run.to, status, sip, q850, sec: answered ? sec : 0, billedMin: answered ? 1 : 0, credits,
    trialMinutes: e === 'sandbox' && answered ? PRICES.trial.otpCallUses : 0,
    source: { type: isOtpType ? 'otp' : 'notification', ref: tpl.id }, sub: tpl.sub || ((ctx.store.get('subAccounts') || [])[0] || {}).id || null,
    pddMs: 2100, keys: null, recorded: false, route: 'primary', byOtpConsole: true, otpId: run.otpId,
    reasonKey: answered ? (isOtpType ? 'codeTwice' : 'messagePlayed') : status === 'busy' ? 'busySim' : 'otpNoAnswer',
    reason: { en: answered ? (isOtpType ? 'Answered · code read twice' : 'Message played') : `OTP call · ${status}` },
    tts: run.spoken || { lang: LANGS[run.lang].tts, text: '' }, events,
    webhook: { event: isOtpType ? (answered ? 'otp.answered' : 'otp.not_answered') : 'call.completed', host: 'hooks.example.com', code: 200, ms: 182 },
  });
  run.callId = rec.id;
  run.credits = credits;
  step(run, answered ? (e === 'sandbox' ? 'completedTrial' : 'completed') : 'notCharged', answered ? 'ok' : 'warn', { credits: fmt.credits2(credits), trial: fmt.num(PRICES.trial.otpCallUses, 1) });
  step(run, 'webhook', 'ok', { event: isOtpType ? (answered ? 'otp.answered' : 'otp.not_answered') : 'call.completed' });
  run.done = true;
  paintRun();
  if (answered && isOtpType) ctx.ui.toast(t('toast.T42', { code: showCode(run.code) }), { kind: 'info', demo: true, timeout: 8000, action: { label: t('con.viewLogs'), onClick: () => ctx.go(`logs?call=${rec.id}`) } });
  else ctx.ui.toast(answered ? t('con.doneToast') : status === 'busy' ? t('con.busyToast') : t('con.notAnsweredToast'), { kind: answered ? 'success' : 'info', timeout: 8000, action: { label: t('con.viewLogs'), onClick: () => ctx.go(`logs?call=${rec.id}`) } });
}

function runHTML(ctx, run) {
  const { t, html: h, icon } = ctx;
  if (!run) return h`<p class="hint ot-idle">${t('con.idle')}</p>`;
  const ICON = { ok: 'check-circle', err: 'x-circle', warn: 'alert', run: null };
  return h`${run.response ? h`<div class="ot-resp ${run.response.code < 300 ? 'is-ok' : 'is-err'}"><span class="mono strong" translate="no">${run.response.code} ${run.response.code === 201 ? 'Created' : run.response.code === 429 ? 'Too Many Requests' : run.response.code === 400 ? 'Bad Request' : run.response.code === 403 ? 'Forbidden' : ''}</span>
      <code class="mono" translate="no">${JSON.stringify(run.response.body)}</code>${run.response.code >= 400 ? reqIdLine(makeReqId(`otp|${run.response.code}|${(run.response.body && run.response.body.error) || ''}|${run.to || ''}`)) : ''}</div>` : ''}
    <ol class="ot-tl" aria-label="${t('con.tlAria')}">${run.steps.map((s) => h`<li class="is-${s.state}">${s.state === 'run' ? raw('<span class="spin" aria-hidden="true"></span>') : icon(ICON[s.state] || 'dot', 'ico-sm')}
      <span class="grow">${t(`st.${s.key}`, { ...s.vars, tpl: run.tpl, to: run.to })}</span><span class="mono hint-xs">${ctx.fmt.time(s.at)}</span></li>`)}</ol>
    ${run.note ? h`<p class="hint-xs" role="status">${run.note}</p>` : ''}
    ${run.lang !== run.langAsked ? h`<p class="hint-xs">${t('con.langFallback', { lang: LANGS[run.langAsked].label })}</p>` : ''}
    ${run.done && run.callId ? h`<div class="row-tight"><a class="btn btn-sm" href="#/logs?call=${run.callId}" data-action="ot.console.logs">${icon('list', 'ico-sm')}${t('con.openLogs')}</a>
      ${run.code ? h`<span class="hint-xs">${t('con.demoCode', { code: showCode(run.code) })}</span>` : ''}</div>` : ''}`;
}

function verifyHTML(ctx) {
  const { t, html: h, icon } = ctx;
  const run = RUN && RUN.target === 'console' ? RUN : null;
  const can = run && run.code && run.callId;
  const v = run ? run.verify : null;
  return h`<div class="ot-verify" data-verify aria-live="polite">
    <span class="label">${t('ver.title')} <code class="mono hint-xs" translate="no">POST /v1/voice/otp/${run && run.otpId ? run.otpId : '{id}'}/verify</code></span>
    <div class="row"><input class="input mono ot-verify-in" data-field="verifyIn" inputmode="numeric" maxlength="9" autocomplete="one-time-code" placeholder="408 913" value="${ctx.state.con.verifyIn}" aria-label="${t('ver.input')}" ${raw(can && !v.locked ? '' : 'aria-describedby="ot-ver-help"')}>
      <button type="button" class="btn btn-navy" data-action="ot.console.verify" ${raw(can && !v.locked && !v.valid ? '' : 'aria-disabled="true" aria-describedby="ot-ver-help"')}>${icon('check', 'ico-sm')}${t('ver.btn')}</button></div>
    ${v && v.last ? h`<div class="ot-resp ${v.last.code === 200 && v.last.body.valid ? 'is-ok' : 'is-err'}"><span class="mono strong" translate="no">${v.last.code}</span><code class="mono" translate="no">${JSON.stringify(v.last.body)}</code></div>` : ''}
    <span class="hint-xs" id="ot-ver-help">${!can ? t('ver.first') : v.locked ? t('ver.locked') : v.valid ? t('ver.validDone') : t('ver.hint', { n: 3 - v.attempts })}</span></div>`;
}

// ---------- page pieces ----------
function header(ctx) {
  const { t, html: h, icon } = ctx;
  return h`<div class="page-head"><div class="titles"><h1>${t('title')}${ctx.pageHelp()}</h1><span class="sub">${t('sub')}</span></div>
    <div class="tools"><div class="seg" role="group" aria-label="${t('rangeAria')}">${RANGES.map((r) => h`<button type="button" data-action="ot.range" data-value="${r}" aria-pressed="${ctx.state.range === r}">${t(`range.${r}`)}</button>`)}</div>
      <button type="button" class="btn btn-primary" data-action="ot.new">${icon('plus')}${t('newTpl')}</button></div></div>`;
}

function priceStrip(ctx) {
  const { t, html: h, fmt, icon } = ctx;
  return h`<div class="note ot-price">${icon('coin')}<span class="grow">${t('priceLine', { price: fmt.rate(PRICES.otpPerAnsweredCall), sec: PRICES.otpMaxSec })}</span><span class="chip chip-warn" tabindex="0" data-tip-key="common.plannedPricesTip">${t('common.plannedPrices')}</span></div>`;
}

function tiles(ctx, s) {
  const { t, html: h, fmt } = ctx;
  const pct = (a, b) => (b ? fmt.pct((a / b) * 100) : '—');
  const tile = (key, v, line, term, href) => {
    const inner = h`<span class="t">${term ? ctx.term(t(`tile.${key}`), term) : t(`tile.${key}`)}</span><span class="v">${v}</span><span class="h clamp-2">${line}</span>`;
    return href ? h`<a class="card tile tile-link" href="${href}" data-action="ot.tile.${key}">${inner}</a>` : h`<div class="card tile">${inner}</div>`;
  };
  return h`<div class="grid g-5 ot-tiles">
    ${tile('sent', fmt.int(s.sent), t('tile.sentLine', { otp: fmt.int(s.otpSent), notif: fmt.int(s.sent - s.otpSent) }), null, '#/logs?src=otp-login')}
    ${tile('answered', pct(s.answered, s.sent), t('tile.answeredLine', { a: fmt.int(s.answered), b: fmt.int(s.sent) }), 'answer_rate')}
    ${tile('verified', pct(s.verified, s.otpAnswered), t('tile.verifiedLine', { a: fmt.int(s.verified), b: fmt.int(s.otpAnswered) }))}
    ${tile('fallback', fmt.int(s.smsFallback || 0), t('tile.fallbackLine', { n: fmt.int(s.otpSent) }))}
    ${tile('credits', fmt.credits2(s.credits), t('tile.creditsLine', { n: fmt.int(s.notAnswered), price: fmt.rate(PRICES.otpPerAnsweredCall) }), null, '#/billing?section=usage')}
  </div>`;
}

function chartCard(ctx, s) {
  const { t, html: h, fmt } = ctx;
  const days = s.days || [];
  if (!days.length) {
    return h`<div class="card span-2 ot-chart"><div class="card-head"><h2>${t('chart.title')}</h2></div><div class="empty"><span class="hint">${t('chart.empty')}</span></div></div>`;
  }
  const W = 640; const H = 210; const L = 44; const R = 12; const T = 16; const B = 30;
  const max = Math.max(1, ...days.map((d) => d.sent));
  const nice = max <= 100 ? 100 : max <= 200 ? 200 : max <= 300 ? 300 : max <= 400 ? 400 : Math.ceil(max / 100) * 100;
  const bw = (W - L - R) / days.length;
  const y = (v) => T + (1 - v / nice) * (H - T - B);
  const isToday = ctx.state.range === 'today';
  const bars = days.map((d, i) => {
    const x = L + i * bw;
    const w = Math.max(2, bw * 0.34);
    const last = i === days.length - 1;
    const lbl = days.length > 10 ? (i % 5 === 0 || last ? fmt.dayMonth(d.date) : '') : fmt.weekdayDay(d.date);
    return `<g><rect x="${(x + bw * 0.14).toFixed(1)}" y="${y(d.sent).toFixed(1)}" width="${w.toFixed(1)}" height="${(H - B - y(d.sent)).toFixed(1)}" rx="2" fill="${last && isToday ? '#F2B35C' : '#C9D3E3'}"><title>${ctx.esc(t('chart.tipSent', { day: fmt.dayMonth(d.date), n: fmt.int(d.sent) }))}</title></rect>
      <rect x="${(x + bw * 0.14 + w + 2).toFixed(1)}" y="${y(d.answered).toFixed(1)}" width="${w.toFixed(1)}" height="${(H - B - y(d.answered)).toFixed(1)}" rx="2" fill="${last && isToday ? '#F26322' : '#14274A'}"><title>${ctx.esc(t('chart.tipAns', { day: fmt.dayMonth(d.date), n: fmt.int(d.answered) }))}</title></rect>
      ${lbl ? `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 9}" text-anchor="middle" ${last ? 'fill="#C94A12" font-weight="600"' : ''}>${ctx.esc(lbl)}</text>` : ''}</g>`;
  }).join('');
  const grid = [0, 0.5, 1].map((f) => `<line x1="${L}" x2="${W - R}" y1="${y(nice * f)}" y2="${y(nice * f)}" stroke="#E7ECF4"/><text x="${L - 8}" y="${y(nice * f) + 4}" text-anchor="end">${ctx.esc(fmt.int(nice * f))}</text>`).join('');
  const sum = days.reduce((a, d) => ({ s: a.s + d.sent, a: a.a + d.answered }), { s: 0, a: 0 });
  return h`<div class="card span-2 ot-chart"><div class="card-head"><h2>${t('chart.title')}</h2>
      <span class="row-tight hint-xs"><span class="ot-sw" style="background:#C9D3E3"></span>${t('chart.sent')} <span class="ot-sw" style="background:#14274A"></span>${t('chart.answered')}</span></div>
    <div class="card-body">${raw(`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${ctx.esc(t('chart.aria', { from: fmt.dayMonth(days[0].date), to: fmt.dayMonth(days[days.length - 1].date), sent: fmt.int(sum.s), answered: fmt.int(sum.a) }))}" style="width:100%;height:auto;display:block;font-size:12px" fill="#5B6781">${grid}${bars}</svg>`)}
      ${isToday ? h`<p class="hint-xs">${t('chart.todayNote', { sent: fmt.int(s.sent), answered: fmt.int(s.answered) })}</p>` : ''}</div></div>`;
}

function funnelCard(ctx, s) {
  const { t, html: h, fmt } = ctx;
  const rows = [['requested', s.otpSent], ['answered', s.otpAnswered], ['verified', s.verified]];
  const max = Math.max(1, s.otpSent);
  return h`<div class="card ot-funnel"><div class="card-head"><h2>${t('fun.title')}</h2></div>
    <div class="card-body stack-3">${rows.map(([k, v], i) => h`<div><div class="row" style="justify-content:space-between;flex-wrap:nowrap;gap:8px"><span>${t(`fun.${k}`)}</span><span class="mono">${fmt.int(v)}${i ? h` · ${rows[i - 1][1] ? fmt.pct((v / rows[i - 1][1]) * 100) : '—'}` : ''}</span></div>
      <span class="progress ot-fbar" aria-hidden="true"><i style="width:${Math.round((v / max) * 100)}%;background:${i === 2 ? 'var(--green)' : i === 1 ? 'var(--navy)' : 'var(--border-strong)'}"></i></span></div>`)}
      <p class="hint-xs">${t('fun.note', { n: fmt.int(s.notAnswered) })}</p></div></div>`;
}

function consoleCard(ctx) {
  const { t, html: h, icon, fmt } = ctx;
  const con = ctx.state.con;
  const tpls = templates(ctx);
  const tpl = findTpl(ctx, con.tpl) || tpls.find((x) => x.status === 'live') || tpls[0];
  const lang = con.lang || 'th';
  const sandbox = env() === 'sandbox';
  const verified = ctx.store.get('verifiedNumbers') || [];
  const to = sandbox ? (con.to && verified.includes(con.to) ? con.to : verified[0]) : con.toInput;
  const body = con.body != null ? con.body : bodyFor(tpl, to, lang, con.code);
  const running = RUN && RUN.target === 'console' && !RUN.done;
  const missing = textOf(tpl, lang) == null;
  return h`<section class="card ot-console" id="ot-console" aria-labelledby="ot-con-h">
    <div class="card-head"><h2 id="ot-con-h">${icon('terminal')}${t('con.title')}</h2><span class="hint-xs">${t('con.sub')}</span></div>
    <div class="card-body ot-con-grid">
      <div class="stack-3">
        ${sandbox ? h`<label class="field"><span class="label">${t('con.to')} <span class="chip chip-info" tabindex="0" data-tip-key="term.sandbox">${t('top.sandbox')}</span></span>
            <select class="select mono" data-field="conTo">${verified.map((n) => h`<option value="${n}" ${raw(n === to ? 'selected' : '')}>${n}</option>`)}</select>
            <span class="hint-xs">${t('con.toSandbox', { max: PRICES.trial.verifiedNumbers })} <button type="button" class="linkbtn" data-action="ot.console.verifynum">${t('con.verifyNum')}</button></span></label>`
          : h`<label class="field"><span class="label">${t('con.toLive')}</span><input class="input mono" data-field="conToInput" value="${con.toInput}" inputmode="tel" translate="no" placeholder="081-xxx-1234" aria-describedby="ot-to-help"><span class="hint-xs" id="ot-to-help">${t('con.toLiveHint')}</span></label>`}
        <div class="grid g-2">
          <label class="field"><span class="label">${t('con.tpl')}</span><select class="select mono" data-field="conTpl">${tpls.map((x) => h`<option value="${x.id}" ${raw(x.id === tpl.id ? 'selected' : '')}>${x.id}${x.status === 'draft' ? ` · ${t('tplst.draft')}` : ''}</option>`)}</select></label>
          <label class="field"><span class="label">${t('con.code')} <span class="opt">${t('common.optional')}</span></span><input class="input mono" data-field="conCode" value="${con.code}" inputmode="numeric" maxlength="8" placeholder="${t('con.codeAuto')}" ${raw(tpl.type === 'otp' ? '' : 'aria-disabled="true" readonly aria-describedby="ot-code-help"')}>${tpl.type === 'otp' ? '' : h`<span class="hint-xs" id="ot-code-help">${t('con.codeAlert')}</span>`}</label></div>
        <div class="field"><span class="label">${t('con.lang')}</span><div class="seg" role="group" aria-label="${t('con.lang')}">${LANG_ORDER.map((l) => h`<button type="button" data-action="ot.console.lang" data-value="${l}" aria-pressed="${lang === l}" lang="${LANGS[l].html}">${LANGS[l].label}${textOf(tpl, l) == null ? '*' : ''}</button>`)}</div>
          ${missing ? h`<span class="hint-xs">${t('con.langMissing', { lang: LANGS[lang].label })}</span>` : ''}</div>
        <label class="field"><span class="label">${t('con.outcome')} <span class="chip chip-navy">${t('common.demoTag')}</span></span><select class="select" data-field="conOutcome">${['answered', 'no-answer', 'busy'].map((o) => h`<option value="${o}" ${raw(con.outcome === o ? 'selected' : '')}>${t(`dialer.out.${o}`)}</option>`)}</select></label>
        <p class="hint-xs ot-cost">${sandbox ? t('con.costSandbox', { min: fmt.num(PRICES.trial.otpCallUses, 1) }) : t('con.costLive', { price: fmt.rate(PRICES.otpPerAnsweredCall) })}</p>
      </div>
      <div class="stack-3">
        <div class="row ot-req-head"><span class="label grow"><code class="mono" translate="no">POST ${API_BASE}/voice/${tpl.type === 'otp' ? 'otp' : 'calls'}</code></span>
          <button type="button" class="btn btn-sm" data-action="ot.console.copy">${icon('copy', 'ico-sm')}${t('con.copyCurl')}</button></div>
        <textarea class="textarea mono ot-body" rows="6" data-field="conBody" spellcheck="false" translate="no" aria-label="${t('con.bodyAria')}" aria-invalid="${con.bodyErr ? 'true' : 'false'}" data-action="ot.console.body">${body}</textarea>
        ${con.bodyErr ? h`<span class="field-err" role="alert">${con.bodyErr}</span>` : h`<span class="hint-xs">${t('con.bodyHint')}${con.body != null ? h` · <button type="button" class="linkbtn" data-action="ot.console.resetbody">${t('con.resetBody')}</button>` : ''}</span>`}
        <div class="row"><button type="button" class="btn btn-primary" data-action="ot.console.send" ${raw(running ? 'aria-busy="true"' : '')}>${running ? raw('<span class="spin" aria-hidden="true"></span>') : icon('send', 'ico-sm')}${t('con.send')}</button>
          <span class="hint-xs">${t('con.sample')}</span></div>
      </div>
    </div>
    <div class="card-body ot-run-wrap"><div class="ot-run" data-run aria-live="polite">${RUN && RUN.target === 'console' ? runHTML(ctx, RUN) : runHTML(ctx, null)}</div>${verifyHTML(ctx)}</div>
  </section>`;
}

function bodyFor(tpl, to, lang, code) {
  const o = { to: toE164(to), template: tpl.id, lang: LANGS[lang].tts };
  if (tpl.type === 'otp' && code) o.code = normDigits(code);
  if (tpl.type !== 'otp') o.variables = tpl.id === 'notify-delivery-eta' ? { order_id: '5120', window: '13:00-15:00' } : { name: 'Waraporn', date: '2026-11-02', time: '10:30' };
  return JSON.stringify(o, null, 2);
}
function curlFor(tpl, body) {
  let compact = body;
  try { compact = JSON.stringify(JSON.parse(body)); } catch { /* keep as typed */ }
  return `curl -X POST ${API_BASE}/voice/${tpl.type === 'otp' ? 'otp' : 'calls'} \\\n  -H "Authorization: Bearer $ANTS_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '${compact}'`;
}

function protectCard(ctx) {
  const { t, html: h, icon } = ctx;
  const p = ctx.state.protect;
  const sw = (key, on, label, sub, extra = '') => h`<div class="ot-prow"><button type="button" class="toggle" role="switch" aria-checked="${on}" data-action="ot.protect" data-value="${key}" aria-labelledby="ot-p-${key}"></button>
    <div class="grow stack" style="gap:2px"><span id="ot-p-${key}" class="strong">${label}</span><span class="hint-xs">${sub}</span>${extra}</div></div>`;
  return h`<section class="card ot-protect" aria-labelledby="ot-pr-h"><div class="card-head"><h2 id="ot-pr-h">${icon('shield')}${t('pr.title')}</h2></div>
    <div class="card-body stack-3"><p class="hint-xs">${t('pr.intro')}</p>
      ${sw('rate', p.rate, t('pr.rate', { n: p.rateN, m: p.rateMin }), t('pr.rateH'), p.rate ? h`<div class="row ot-pnums"><label class="row-tight hint-xs">${t('pr.calls')}<input class="input input-sm ot-num" type="number" min="1" max="10" value="${p.rateN}" data-field="prRateN"></label><label class="row-tight hint-xs">${t('pr.minutes')}<input class="input input-sm ot-num" type="number" min="1" max="60" value="${p.rateMin}" data-field="prRateMin"></label></div>` : '')}
      ${sw('daily', p.daily, t('pr.daily', { n: p.dailyN }), t('pr.dailyH'), p.daily ? h`<div class="row ot-pnums"><label class="row-tight hint-xs">${t('pr.perDay')}<input class="input input-sm ot-num" type="number" min="1" max="50" value="${p.dailyN}" data-field="prDailyN"></label></div>` : '')}
      ${sw('hook', p.hook, h`${t('pr.hook')} <code class="mono hint-xs" translate="no">otp.requested</code>`, t('pr.hookH'), p.hook ? h`<input class="input mono input-sm" data-field="prHookUrl" value="${p.hookUrl}" inputmode="url" translate="no" aria-label="${t('pr.hookUrl')}">` : '')}
      <div class="ot-prow is-locked">${icon('lock', 'ico-sm')}<div class="grow stack" style="gap:2px"><span class="strong">${t('pr.thai')}</span><span class="hint-xs">${t('pr.thaiH')} <a class="linkbtn" href="#/billing" data-action="ot.protect.billing">${t('pr.thaiLink')}</a></span></div></div>
      <div class="row"><button type="button" class="btn btn-navy btn-sm" data-action="ot.protect.save" ${raw(p.dirty ? '' : 'aria-disabled="true" aria-describedby="ot-pr-help"')}>${t('pr.save')}</button>${p.dirty ? '' : h`<span class="hint-xs" id="ot-pr-help">${t('pr.saved')}</span>`}</div>
    </div></section>`;
}

function templatesCard(ctx) {
  const { t, html: h, icon, fmt } = ctx;
  const list = ctx.list('otpTemplates');
  if (!list.length) {
    return h`<section class="card ot-tpls"><div class="card-head"><h2>${t('tpl.title')}</h2></div>
      <div class="empty"><span class="art">${icon('file-text')}</span><strong>${t('tpl.emptyTitle')}</strong><span class="hint">${t('tpl.emptyBody')}</span>
      <div class="row"><button type="button" class="btn btn-sm btn-navy" data-action="ot.tpl.empty">${icon('plus', 'ico-sm')}${t('newTpl')}</button>
      <button type="button" class="btn btn-sm" data-action="ot.tpl.builtin">${icon('play', 'ico-sm')}${t('tpl.playBuiltin')}</button></div></div></section>`;
  }
  return h`<section class="card ot-tpls" aria-labelledby="ot-tpl-h"><div class="card-head"><h2 id="ot-tpl-h">${t('tpl.title')}</h2><span class="hint-xs">${t('tpl.sub')}</span></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>${t('tpl.c.name')}</th><th>${t('tpl.c.type')}</th><th>${t('tpl.c.langs')}</th><th>${ctx.term(t('tpl.c.voice'), 'voice_tier')}</th><th>${t('tpl.c.settings')}</th><th>${t('tpl.c.status')}</th><th class="num">${t('tpl.c.sent')}</th><th><span class="sr-only">${t('tpl.c.play')}</span></th></tr></thead>
    <tbody>${list.map((x) => {
      const vv = voiceOf(x.voice);
      return h`<tr class="${x.fresh ? 'new-row' : ''}"><td><button type="button" class="linkbtn mono strong" data-action="ot.tpl.row" data-value="${x.id}" translate="no">${x.id}</button></td>
      <td><span class="chip ${x.type === 'otp' ? 'chip-navy' : 'chip-info'}">${t(`type.${x.type}`)}</span></td>
      <td class="nowrap">${LANG_ORDER.map((l) => h`<span class="ot-lang ${textOf(x, l) != null ? 'is-set' : ''}" tabindex="0" data-tip-key="${textOf(x, l) != null ? 'otp.tpl.langSet' : 'otp.tpl.langNotSet'}" data-tip-vars='${JSON.stringify({ lang: LANGS[l].label })}'>${LANGS[l].short}</span>`)}</td>
      <td class="nowrap">${t(`voice.${vv.tier}`)} · ${t(`gender.${vv.gender}`)}</td>
      <td class="hint-xs ot-set">${settingsLine(ctx, x)}</td>
      <td>${x.status === 'live' ? h`<span class="chip chip-ok">${t('tplst.live', { v: x.version })}</span>` : h`<span class="chip">${t('tplst.draftV', { v: x.version })}</span>`}</td>
      <td class="num mono">${fmt.int(x.sent7d || 0)}</td>
      <td class="num"><button type="button" class="btn btn-ghost btn-sm btn-icon" data-action="ot.tpl.play" data-value="${x.id}" aria-label="${t('tpl.playAria', { name: x.id })}" data-tip-key="otp.tpl.playTip">${icon('play', 'ico-sm')}</button></td></tr>`;
    })}</tbody></table></div></section>`;
}
function settingsLine(ctx, x) {
  const { t } = ctx;
  const s = x.settings || {};
  const parts = [];
  if (s.digits) parts.push(t('set.digits', { n: s.digits, m: s.expiresMin || 5 }));
  if (s.repeatKey) parts.push(t('set.repeat', { key: s.repeatKey }));
  if (s.lockAfterWrong) parts.push(t('set.lock', { n: s.lockAfterWrong }));
  if (s.smsFallbackSec) parts.push(t('set.fallback', { n: s.smsFallbackSec }));
  if (s.confirmKey) parts.push(t('set.confirm', { key: s.confirmKey }));
  if (s.smsKey) parts.push(t('set.sms', { key: s.smsKey }));
  return parts.join(' · ') || '—';
}

function deliveriesCard(ctx) {
  const { t, html: h, icon, fmt } = ctx;
  const all = ctx.list('calls').filter((c) => c.env === env() && c.source && ['otp', 'notification', 'api'].includes(c.source.type)).sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
  const f = ctx.state.delivTpl;
  const rows = all.filter((c) => f === 'all' || c.source.ref === f);
  const shown = rows.slice(0, 10);
  const refs = [...new Set(all.map((c) => c.source.ref))];
  return h`<section class="card ot-deliv" aria-labelledby="ot-dl-h"><div class="card-head"><h2 id="ot-dl-h">${t('dl.title')}</h2>
      <select class="select ot-dl-filter" data-field="delivTpl" aria-label="${t('dl.filterAria')}" data-action="ot.deliv.filter"><option value="all">${t('dl.all')}</option>${refs.map((r) => h`<option value="${r}" ${raw(f === r ? 'selected' : '')}>${r}</option>`)}</select>
      <button type="button" class="btn btn-sm" data-action="ot.deliv.export" ${raw(rows.length ? '' : 'aria-disabled="true" aria-describedby="ot-dl-empty"')}>${icon('download', 'ico-sm')}${t('dl.export')}</button></div>
    ${shown.length ? h`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>${t('dl.c.time')}</th><th>${t('dl.c.tpl')}</th><th>${t('dl.c.to')}</th><th>${t('dl.c.status')}</th><th>${t('dl.c.verified')}</th><th class="num">${t('dl.c.credits')}</th></tr></thead>
      <tbody>${shown.map((c) => h`<tr><td class="mono"><a href="#/logs?call=${c.id}" data-action="ot.deliv.row" data-value="${c.id}">${fmt.time(c.ts)}</a></td><td class="mono" translate="no">${c.source.ref}</td><td class="mono" translate="no">${c.to}</td>
        <td>${ctx.ui.describe.statusChip(c.status)}</td><td class="mono">${verifiedAt(c) ? fmt.time(verifiedAt(c)) : '—'}</td><td class="num mono">${fmt.credits2(c.credits || 0)}</td></tr>`)}</tbody></table></div>
      <div class="card-foot row"><span class="hint-xs grow">${t('dl.shown', { n: fmt.int(shown.length), total: fmt.int(rows.length) })}</span><a class="linkbtn" href="#/logs${f === 'all' ? '' : `?src=${f}`}" data-action="ot.deliv.all">${t('dl.allLogs')}</a></div>`
      : h`<div class="empty"><span class="hint" id="ot-dl-empty">${t('dl.empty')}</span></div>`}</section>`;
}
/** "Verified at" = call time + 25–40 s for answered OTP calls; console calls keep the real verify time. */
function verifiedAt(c) {
  if (c.verifiedAt) return c.verifiedAt;
  if (c.byOtpConsole || c.status !== 'completed' || c.source.type !== 'otp' || c.id === 'call_01JBKWYC2M5J') return null;
  let hsh = 0;
  for (const ch of c.id) hsh = (hsh * 31 + ch.charCodeAt(0)) >>> 0;
  return Date.parse(c.ts) + (25 + (hsh % 16)) * 1000;
}

export function render(ctx) {
  const { html: h } = ctx;
  const s = stats(ctx, ctx.state.range);
  const first = !ctx.store.get('otpStats');
  return h`<div class="page ot">${header(ctx)}${priceStrip(ctx)}
    ${first && s.empty ? h`<div class="note note-info ot-first">${ctx.icon('info')}<span>${ctx.t('firstRun')}</span></div>` : ''}
    ${tiles(ctx, s)}
    <div class="grid g-3">${chartCard(ctx, s)}${funnelCard(ctx, s)}</div>
    <div class="grid g-3 ot-mid"><div class="span-2">${consoleCard(ctx)}</div>${protectCard(ctx)}</div>
    ${templatesCard(ctx)}
    ${deliveriesCard(ctx)}
  </div>`;
}

// ---------- template editor (modal) ----------

let ED = null; // editor state
/** Unsaved editor states kept after closing (per template; 'new' for a new one), so closing never loses work. */
const KEPT = new Map();
const keptKey = (id) => id || 'new';
function openEditor(ctx, tplId, { restore = null } = {}) {
  const { t } = ctx;
  const src = tplId ? findTpl(ctx, tplId) : null;
  if (tplId && !src) return;
  if (!restore && KEPT.has(keptKey(tplId))) { restore = KEPT.get(keptKey(tplId)); restore.restored = true; }
  if (!restore) {
    const vv = voiceOf(src ? src.voice : 'standard-th-female');
    ED = {
      id: src ? src.id : null, isNew: !src, builtin: !!(src && src.builtin), name: src ? src.id : '', nameErr: null, type: src ? src.type : 'otp', sub: src ? src.sub : (ctx.store.get('subAccounts') || [])[0]?.id || null,
      lang: src ? (textOf(src, getLang()) != null ? getLang() : (src.languages && src.languages[0]) || 'th') : getLang(),
      texts: Object.fromEntries(LANG_ORDER.map((l) => [l, src ? textOf(src, l) : l === getLang() ? tIn(l, 'otp.tpl.newOtp') : null])),
      tier: vv.tier, gender: vv.gender, rate: src ? src.rate : 0.9,
      repeatKey: src && src.settings ? src.settings.repeatKey || null : 1, repeats: src && src.settings ? src.settings.repeats || 2 : 2,
      digits: src && src.settings ? src.settings.digits || 6 : 6, expires: src && src.settings ? src.settings.expiresMin || 5 : 5,
      lock: src && src.settings ? src.settings.lockAfterWrong || 3 : 3, fallback: src && src.settings && src.settings.smsFallbackSec ? 'sms30' : 'none',
      testTo: (ctx.store.get('verifiedNumbers') || [])[0] || '081-xxx-0101', dirty: false, playing: false, note: null, version: src ? src.version : 0, status: src ? src.status : 'draft',
    };
  } else ED = restore;
  const m = ctx.ui.modal({
    title: ED.isNew ? t('ed.newTitle') : t('ed.title', { name: ED.name }), sub: ED.builtin ? t('ed.builtinSub') : ED.isNew ? t('ed.newSub') : t('ed.sub', { status: t(ED.status === 'live' ? 'tplst.live' : 'tplst.draftV', { v: ED.version }) }),
    size: 'xl', className: 'ot-editor',
    body: editorBody(ctx),
    actions: editorActions(ctx),
    buttons: editorButtons(ctx),
    onClose: () => {
      stopAudio();
      if (RUN && RUN.target === 'editor') RUN = null;
      const ed = ED;
      ED = null;
      if (ed && ed.dirty && !ed.saved) {
        // Closing keeps the edits (no blocking "discard?" question): reopening the template restores them.
        ed.handle = null;
        KEPT.set(keptKey(ed.id), ed);
        ctx.ui.toast(t('ed.keptToast', { name: ed.name || t('ed.newTitle') }), { kind: 'info', timeout: 6000, action: { label: t('ed.reopen'), onClick: () => openEditor(ctx, ed.id) } });
      }
    },
  });
  ED.handle = m;
  tagEditorButtons(m);
  m.el.addEventListener('input', (ev) => onEditorInput(ctx, ev));
  m.el.addEventListener('change', (ev) => onEditorInput(ctx, ev, true));
  // Variable chips insert at the caret on the first click (the chip never takes focus from the text; leaving the
  // text for a chip by keyboard keeps the caret and skips the redraw that would replace the chip mid-click).
  m.el.addEventListener('mousedown', (ev) => { if (ev.target.closest && ev.target.closest('.ot-var')) ev.preventDefault(); });
  m.el.addEventListener('focusout', (ev) => {
    if (!ED) return;
    if (ev.target.matches('[data-ed="text"]')) ED.caret = { start: ev.target.selectionStart, end: ev.target.selectionEnd, lang: ED.lang };
    if (ev.relatedTarget && ev.relatedTarget.closest && ev.relatedTarget.closest('.ot-var')) return;
    if (!ev.target.matches('[data-ed="text"], [data-ed="name"]')) return;
    redrawEditor(ctx);
  });
  return m;
}

/** Footer buttons carry the inventory ids too (the modal renders them without data-action). */
function tagEditorButtons(m) {
  if (!ED || ED.builtin) return;
  const b = m.el.querySelectorAll('.modal-foot [data-mbtn]');
  if (b[1]) b[1].dataset.action = 'ot.ed.draft';
  if (b[2]) b[2].dataset.action = 'ot.ed.publish';
}

function editorButtons(ctx) {
  const { t } = ctx;
  if (ED.builtin) return [{ label: t('common.close'), kind: 'navy' }];
  return [
    { label: t('common.cancel') },
    { label: t('ed.draft'), kind: '', onClick: () => { if (!validateEditor(ctx)) { redrawEditor(ctx); return false; } saveTemplate(ctx, 'draft'); return true; } },
    { label: t('ed.publish'), kind: 'primary', icon: 'check', onClick: () => {
      if (!validateEditor(ctx)) { redrawEditor(ctx); return false; }
      const next = (ED.status === 'live' ? ED.version + 1 : Math.max(1, ED.version || 1));
      ctx.ui.confirm({ title: t('ed.pubTitle', { name: ED.name, v: next }), body: t('ed.pubBody'), confirmLabel: t('ed.pubYes', { v: next }), cancelLabel: t('ed.keepEditing') }).then((ok) => {
        if (!ok) return;
        saveTemplate(ctx, 'live', next);
        if (ED && ED.handle) ED.handle.close();
      });
      return false;
    } },
  ];
}

function validateEditor(ctx) {
  const { t } = ctx;
  ED.nameErr = null;
  if (ED.isNew) {
    if (!NAME_RE.test(ED.name)) ED.nameErr = t('ed.nameErr');
    else if (templates(ctx).some((x) => x.id === ED.name)) ED.nameErr = t('ed.nameTaken');
  }
  const anyText = LANG_ORDER.some((l) => ED.texts[l] && ED.texts[l].trim());
  ED.textErr = anyText ? null : t('ed.textErr');
  if (ED.type === 'otp' && anyText && !LANG_ORDER.some((l) => ED.texts[l] && ED.texts[l].includes('{code}'))) ED.textErr = t('ed.codeErr');
  return !ED.nameErr && !ED.textErr;
}

function saveTemplate(ctx, status, version) {
  const { t } = ctx;
  const languages = LANG_ORDER.filter((l) => ED.texts[l] && ED.texts[l].trim());
  const rec = {
    ...(ED.isNew ? { sent7d: 0 } : findTpl(ctx, ED.id)), id: ED.isNew ? ED.name : ED.id, type: ED.type, sub: ED.sub, languages, texts: { ...ED.texts },
    voice: `${ED.tier}-th-${ED.gender}`, rate: ED.rate, status, version: status === 'live' ? version : (ED.version || 1), fresh: true, builtin: undefined,
    settings: ED.type === 'otp' ? { digits: ED.digits, expiresMin: ED.expires, repeatKey: ED.repeatKey, repeats: ED.repeats, lockAfterWrong: ED.lock, smsFallbackSec: ED.fallback === 'sms30' ? 30 : null } : { repeatKey: ED.repeatKey },
  };
  if (status === 'draft' && !ED.isNew) { rec.status = ED.status === 'live' ? 'live' : 'draft'; rec.draftChanges = true; }
  const list = ctx.list('otpTemplates');
  ctx.store.set('otpTemplates', list.some((x) => x.id === rec.id) ? list.map((x) => (x.id === rec.id ? rec : x)) : [rec, ...list]);
  audit(status === 'live' ? 'otp.template.published' : 'otp.template.saved', { template: rec.id, v: rec.version }, rec.id);
  ED.saved = true;
  KEPT.delete(keptKey(ED.id));
  if (ED.isNew) KEPT.delete('new');
  ctx.ui.toast(status === 'live' ? t('toast.T25', { name: rec.id, v: rec.version }) : t('toast.T03'), { kind: 'success' });
}

function redrawEditor(ctx) {
  // Re-entrancy: replacing the body blurs the focused field, whose focusout would redraw again mid-replace.
  if (!ED || !ED.handle || ED.redrawing) return;
  // A redraw asked for while a control of the editor is being pressed waits for its click (core/press.js).
  const h = ED.handle;
  replaceSafely(h.body, () => {
    if (!ED || ED.handle !== h || ED.redrawing) return;
    ED.redrawing = true;
    try { redrawEditorNow(ctx); } finally { if (ED) ED.redrawing = false; }
  });
}
function redrawEditorNow(ctx) {
  const focus = document.activeElement && ED.handle.el.contains(document.activeElement) ? { sel: document.activeElement.dataset.ed ? `[data-ed="${document.activeElement.dataset.ed}"]` : document.activeElement.dataset.action ? `[data-action="${document.activeElement.dataset.action}"]${document.activeElement.dataset.value != null ? `[data-value="${document.activeElement.dataset.value}"]` : ''}` : null, caret: document.activeElement.selectionStart } : null;
  ED.handle.setBody(editorBody(ctx));
  if (focus && focus.sel) { const el = ED.handle.el.querySelector(focus.sel); if (el) { el.focus({ preventScroll: true }); if (focus.caret != null && el.setSelectionRange) { try { el.setSelectionRange(focus.caret, focus.caret); } catch { /* not text */ } } } }
}

function onEditorInput(ctx, ev, isChange) {
  const el = ev.target;
  const k = el.dataset && el.dataset.ed;
  if (!k || !ED) return;
  ED.dirty = true;
  if (k === 'name') ED.name = el.value.trim().toLowerCase();
  else if (k === 'text') ED.texts[ED.lang] = el.value;
  else if (k === 'rate') { ED.rate = Number(el.value) || 1; const o = ED.handle.el.querySelector('[data-ed-rate]'); if (o) o.textContent = `${ctx.fmt.num(ED.rate, 2)}×`; }
  else if (k === 'testTo') ED.testTo = el.value;
  else if (isChange) {
    if (k === 'sub') ED.sub = el.value;
    if (k === 'voice') { const [tier, gender] = el.value.split('-'); ED.tier = tier; ED.gender = gender; }
    if (k === 'repeat') ED.repeatKey = el.value === 'none' ? null : el.value;
    if (k === 'digits') ED.digits = Number(el.value);
    if (k === 'expires') ED.expires = Number(el.value);
    if (k === 'lock') ED.lock = Number(el.value);
    if (k === 'fallback') ED.fallback = el.value;
    redrawEditor(ctx);
  }
}

function editorBody(ctx) {
  const { t, html: h, icon, fmt } = ctx;
  const e = ED;
  const text = e.texts[e.lang];
  const gi = genderIssue(e.lang, e.gender, text);
  const sandbox = env() === 'sandbox';
  const ro = e.builtin;
  const preview = text != null ? fillVars(text, sampleVars(e.lang)) : '';
  const numbers = sandbox ? (ctx.store.get('verifiedNumbers') || []) : [...new Set([...(ctx.store.get('verifiedNumbers') || []), '081-xxx-0101'])];
  return h`<div class="ot-ed">
    <div class="ot-ed-main stack-4">
      ${e.restored ? h`<div class="note note-info" role="status">${icon('info')}<span class="grow">${t('ed.restored')}</span><button type="button" class="btn btn-sm" data-action="ot.ed.discard">${t('ed.discardEdits')}</button></div>` : ''}
      <div class="grid g-3 ot-ed-head">
        <label class="field"><span class="label">${t('ed.name')}</span>${e.isNew ? h`<input class="input mono" data-ed="name" value="${e.name}" placeholder="otp-signup" autocomplete="off" spellcheck="false" translate="no" aria-invalid="${e.nameErr ? 'true' : 'false'}" aria-describedby="ot-ed-name-h" autofocus>` : h`<code class="mono ot-ro" translate="no">${e.name}</code>`}
          ${e.nameErr ? h`<span class="field-err" id="ot-ed-name-h">${e.nameErr}</span>` : h`<span class="hint-xs" id="ot-ed-name-h">${t('ed.nameHint')}</span>`}</label>
        <div class="field"><span class="label">${t('ed.type')}</span>${e.isNew ? h`<div class="seg" role="group" aria-label="${t('ed.type')}">${['otp', 'alert'].map((ty) => h`<button type="button" data-action="ot.ed.type" data-value="${ty}" aria-pressed="${e.type === ty}">${t(`type.${ty}`)}</button>`)}</div>` : h`<span class="chip ${e.type === 'otp' ? 'chip-navy' : 'chip-info'}">${t(`type.${e.type}`)}</span>`}</div>
        <div class="field"><span class="label" id="ot-ed-sub-l">${ctx.term(t('ed.subAcct'), 'subaccount')}</span><select class="select" data-ed="sub" aria-labelledby="ot-ed-sub-l" ${raw(ro ? 'disabled' : '')}>${(ctx.store.get('subAccounts') || []).map((s) => h`<option value="${s.id}" ${raw(s.id === e.sub ? 'selected' : '')}>${loc(s.name)}</option>`)}</select></div>
      </div>
      <div class="ot-langtabs" role="tablist" aria-label="${t('ed.langAria')}">${LANG_ORDER.map((l) => h`<button type="button" role="tab" aria-selected="${e.lang === l}" tabindex="${e.lang === l ? 0 : -1}" data-action="ot.ed.lang" data-value="${l}" lang="${LANGS[l].html}"><span class="dot ${e.texts[l] != null ? 'dot-ok' : ''}" aria-hidden="true"></span>${LANGS[l].label}</button>`)}</div>
      ${text == null ? h`<div class="note note-warn">${icon('alert')}<div class="grow stack" style="gap:6px"><span>${e.lang === 'en' ? t('ed.notSetEn', { lang: LANGS[LANG_ORDER.find((l) => e.texts[l] != null) || 'th'].label }) : t('ed.notSet', { lang: LANGS[e.lang].label })}</span>
          ${ro ? '' : h`<div><button type="button" class="btn btn-sm btn-navy" data-action="ot.ed.addlang">${icon('plus', 'ico-sm')}${t('ed.addLang', { lang: LANGS[e.lang].label })}</button></div>`}</div></div>`
        : h`<label class="field"><span class="label">${t('ed.text')}</span><textarea class="textarea" rows="6" data-ed="text" data-action="ot.ed.text" lang="${LANGS[e.lang].html}" ${raw(ro ? 'readonly' : '')} aria-describedby="ot-ed-text-h">${text}</textarea></label>
        ${ro ? '' : h`<div class="row-tight" role="group" aria-label="${t('ed.varsAria')}"><span class="hint-xs">${t('ed.vars')}</span>${['code', 'name', 'brand'].map((v) => h`<button type="button" class="chip chip-navy ot-var" data-action="ot.ed.var.${v}" translate="no">{${v}}</button>`)}</div>`}
        <span class="hint-xs" id="ot-ed-text-h">${t('ed.textHint')}</span>
        ${e.textErr ? h`<span class="field-err" role="alert">${e.textErr}</span>` : ''}
        ${gi ? h`<div class="note note-warn" role="status">${icon('alert')}<span class="grow">${t(gi === 'female' ? 'ed.genderF' : 'ed.genderM')}</span>${ro ? '' : h`<button type="button" class="btn btn-sm" data-action="ot.ed.fix">${t('ed.fix')}</button>`}</div>` : ''}
        <div class="card card-sunken card-pad stack" style="gap:6px"><span class="label">${t('ed.preview')}</span><p class="ot-say" lang="${LANGS[e.lang].html}" data-ed-say>${preview}</p>
          <div class="row"><button type="button" class="btn btn-sm ${e.playing ? '' : 'btn-navy'}" data-action="ot.ed.play">${icon(e.playing ? 'stop' : 'play', 'ico-sm')}${e.playing ? t('ed.stop') : t('ed.play')}</button>
          ${e.note ? h`<span class="hint-xs" role="status">${e.note}</span>` : ''}</div>
          ${hasScamLine(e.type, text, e.lang) ? h`<div><span class="chip chip-ok ot-scam is-ok" tabindex="0" data-tip-key="otp.ed.scamTip">${icon('shield-check', 'ico-sm')}${t('ed.scamOk')}</span></div>`
            : h`<div class="note note-warn ot-scam is-missing" role="status">${icon('alert')}<span class="grow">${t('ed.scamMissing')} <q lang="${LANGS[e.lang].html}">${fillVars(scamLine(e.type, e.lang), sampleVars(e.lang))}</q></span>${ro ? '' : h`<button type="button" class="btn btn-sm" data-action="ot.ed.scam">${t('ed.scamAdd')}</button>`}</div>`}</div>`}
    </div>
    <aside class="ot-ed-side stack-3">
      <div class="field"><span class="label" id="ot-ed-voice-l">${ctx.term(t('ed.voice'), 'voice_tier')}</span><select class="select" data-ed="voice" data-action="ot.ed.voice" aria-labelledby="ot-ed-voice-l" ${raw(ro ? 'disabled' : '')}>${['standard-female', 'standard-male', 'premium-female', 'premium-male'].map((v) => { const [tier, g] = v.split('-'); return h`<option value="${v}" ${raw(e.tier === tier && e.gender === g ? 'selected' : '')}>${t(`voice.${tier}`)} · ${t(`gender.${g}`)}${tier === 'premium' ? ` ${t('ed.premiumOpt', { rate: fmt.rate(PRICES.premiumVoice) })}` : ''}</option>`; })}</select>
        ${e.tier === 'premium' ? h`<span class="hint-xs">${t('ed.premiumLine', { rate: fmt.rate(PRICES.premiumVoice) })}</span>` : h`<span class="hint-xs">${t('ed.standardLine')}</span>`}</div>
      <div class="field"><span class="label"><span id="ot-ed-rate-l">${t('ed.rate')}</span> <output class="mono" data-ed-rate for="ot-ed-rate">${fmt.num(e.rate, 2)}×</output></span><input type="range" id="ot-ed-rate" min="0.8" max="1.2" step="0.05" value="${e.rate}" data-ed="rate" data-action="ot.ed.rate" aria-labelledby="ot-ed-rate-l" aria-describedby="ot-ed-rate-h" ${raw(ro ? 'disabled' : '')}><span class="hint-xs" id="ot-ed-rate-h">${t('ed.rateHint')}</span></div>
      <label class="field"><span class="label">${t('ed.repeat')}</span><select class="select" data-ed="repeat" data-action="ot.ed.repeat" ${raw(ro ? 'disabled' : '')}>${['none', '1', '2', '#'].map((k) => h`<option value="${k}" ${raw(String(e.repeatKey || 'none') === k ? 'selected' : '')}>${k === 'none' ? t('ed.repeatNone') : t('ed.repeatKey', { key: k })}</option>`)}</select></label>
      ${e.type === 'otp' ? h`<div class="grid g-2"><label class="field"><span class="label">${t('ed.len')}</span><select class="select" data-ed="digits" data-action="ot.ed.len" ${raw(ro ? 'disabled' : '')}>${[4, 6, 8].map((n) => h`<option value="${n}" ${raw(e.digits === n ? 'selected' : '')}>${t('ed.digitsN', { n })}</option>`)}</select></label>
        <label class="field"><span class="label">${t('ed.expires')}</span><select class="select" data-ed="expires" data-action="ot.ed.len" ${raw(ro ? 'disabled' : '')}>${[2, 5, 10].map((n) => h`<option value="${n}" ${raw(e.expires === n ? 'selected' : '')}>${t('ed.minN', { n })}</option>`)}</select></label></div>
        <label class="field"><span class="label">${t('ed.attempts')}</span><select class="select" data-ed="lock" data-action="ot.ed.attempts" ${raw(ro ? 'disabled' : '')}>${[3, 5].map((n) => h`<option value="${n}" ${raw(e.lock === n ? 'selected' : '')}>${t('ed.lockN', { n })}</option>`)}</select></label>
        <label class="field"><span class="label">${t('ed.fallback')}</span><select class="select" data-ed="fallback" data-action="ot.ed.fallback" ${raw(ro ? 'disabled' : '')}><option value="sms30" ${raw(e.fallback === 'sms30' ? 'selected' : '')}>${t('ed.fallbackSms', { n: 30 })}</option><option value="none" ${raw(e.fallback === 'none' ? 'selected' : '')}>${t('ed.fallbackNone')}</option></select>
          <span class="hint-xs">${t('ed.fallbackHint')}</span></label>` : ''}
      <div class="card card-pad stack-3 ot-ed-test"><span class="label">${t('ed.test')}</span>
        <select class="select mono" data-ed="testTo" aria-label="${t('ed.testTo')}" data-action="ot.ed.testnum">${numbers.map((n) => h`<option value="${n}" ${raw(n === e.testTo ? 'selected' : '')}>${n}</option>`)}</select>
        <button type="button" class="btn btn-primary btn-sm" data-action="ot.ed.send" ${raw(RUN && RUN.target === 'editor' && !RUN.done ? 'aria-busy="true"' : '')}>${icon('send', 'ico-sm')}${sandbox ? t('ed.sendFree') : t('ed.send', { price: fmt.rate(PRICES.otpPerAnsweredCall) })}</button>
        <div class="ot-run ot-run-sm" data-ed-run aria-live="polite">${RUN && RUN.target === 'editor' ? runHTML(ctx, RUN) : ''}</div></div>
    </aside></div>`;
}

function editorActions(ctx) {
  const { t } = ctx;
  return {
    'ot.ed.type': (el) => {
      const was = ED.type;
      ED.type = el.dataset.value;
      // A new template still holding the starting text of the other type gets this type's starting text.
      if (ED.isNew && was !== ED.type) for (const l of LANG_ORDER) if (ED.texts[l] != null && ED.texts[l] === newText(was, l)) ED.texts[l] = newText(ED.type, l);
      ED.dirty = true; redrawEditor(ctx);
    },
    'ot.ed.scam': () => {
      const cur = String(ED.texts[ED.lang] || '').trim();
      const line = scamLine(ED.type, ED.lang);
      ED.texts[ED.lang] = cur ? `${cur}${ED.lang === 'zh' ? '' : ' '}${line}` : line;
      ED.dirty = true;
      redrawEditor(ctx);
    },
    'ot.ed.lang': (el) => { stopAudio(); ED.playing = false; ED.lang = el.dataset.value; redrawEditor(ctx); },
    'ot.ed.addlang': () => {
      const l = ED.lang;
      const dict = ED.id && hasDict(ED.id) ? dictText(ED.id, l) : null;
      ED.texts[l] = dict || (ED.texts.en != null ? ED.texts.en : tIn(l, ED.type === 'otp' ? 'otp.tpl.newOtp' : 'otp.tpl.newAlert'));
      ED.dirty = true;
      redrawEditor(ctx);
      const ta = ED.handle.el.querySelector('[data-ed="text"]'); if (ta) ta.focus();
    },
    'ot.ed.var.code': (el) => insertVar(ctx, 'code'),
    'ot.ed.var.name': (el) => insertVar(ctx, 'name'),
    'ot.ed.var.brand': (el) => insertVar(ctx, 'brand'),
    'ot.ed.fix': () => { ED.texts[ED.lang] = fixParticles(ED.gender, ED.texts[ED.lang]); ED.dirty = true; redrawEditor(ctx); },
    'ot.ed.play': () => editorPlay(ctx),
    'ot.ed.testnum': () => {},
    'ot.ed.discard': () => {
      const id = ED.id;
      KEPT.delete(keptKey(id));
      ED.saved = true; // closing now must not keep these edits again
      ED.handle.close();
      setTimeout(() => openEditor(ctx, id), 0);
    },
    // fields: their changes are read by onEditorInput; the ids mark them for QA
    'ot.ed.text': () => {}, 'ot.ed.voice': () => {}, 'ot.ed.rate': () => {}, 'ot.ed.repeat': () => {}, 'ot.ed.len': () => {}, 'ot.ed.attempts': () => {}, 'ot.ed.fallback': () => {},
    'ot.ed.draft': () => {}, 'ot.ed.publish': () => {}, // footer buttons: their onClick runs through the modal
    'ot.ed.send': () => {
      if (RUN && RUN.target === 'editor' && !RUN.done) return;
      const tpl = { id: ED.id || ED.name || 'otp-new', type: ED.type, sub: ED.sub, languages: LANG_ORDER.filter((l) => ED.texts[l] != null), texts: { ...ED.texts }, voice: `${ED.tier}-th-${ED.gender}`, rate: ED.rate, settings: { expiresMin: ED.expires } };
      if (!tpl.languages.length) { ED.textErr = t('ed.textErr'); redrawEditor(ctx); return; }
      sendOtp(ctx, { tpl, to: ED.testTo, lang: ED.lang, code: '', outcome: 'answered', target: 'editor' });
      redrawEditor(ctx);
    },
  };
}
function insertVar(ctx, v) {
  const ta = ED.handle.el.querySelector('[data-ed="text"]');
  const cur = ED.texts[ED.lang] || '';
  const ins = `{${v}}`;
  const focused = ta && document.activeElement === ta;
  const saved = ED.caret && ED.caret.lang === ED.lang ? ED.caret : null;
  const a = Math.min(cur.length, focused ? ta.selectionStart : saved ? saved.start : cur.length);
  const b = Math.min(cur.length, Math.max(a, focused ? ta.selectionEnd : saved ? saved.end : a));
  ED.texts[ED.lang] = cur.slice(0, a) + ins + cur.slice(b);
  ED.caret = { start: a + ins.length, end: a + ins.length, lang: ED.lang };
  ED.dirty = true;
  redrawEditor(ctx);
  const nt = ED.handle.el.querySelector('[data-ed="text"]');
  if (nt) { nt.focus(); nt.setSelectionRange(a + ins.length, a + ins.length); }
}
function editorPlay(ctx) {
  const tts = ctx.ui.audio.tts;
  if (ED.playing) { stopAudio(); ED.playing = false; redrawEditor(ctx); return; }
  ctx.ui.audio.unlock();
  const tpl = { id: ED.id || 'otp-new', type: ED.type, languages: LANG_ORDER.filter((l) => ED.texts[l] != null), texts: { ...ED.texts } };
  const sp = speakParts(tpl, ED.lang, SAMPLE_CODE);
  const plan = planVoice(ctx, ED.lang, ED.tier === 'premium', sp.edited);
  let parts = sp.parts;
  if (plan.builtinOnly || plan.lang !== ED.lang) parts = hasDict(ED.id) ? speakParts({ id: ED.id, type: ED.type, languages: [plan.lang] }, plan.lang, SAMPLE_CODE).parts : [{ text: tIn(plan.lang, 'otp.tpl.builtinOnly') }];
  parts = parts.map((x) => ({ ...x, rate: (x.rate || 1) * (ED.rate || 1) }));
  ED.note = plan.note;
  ED.playing = true;
  redrawEditor(ctx);
  const say = ED.handle.el.querySelector('[data-ed-say]');
  const ws = ctx.ui.audio.words(parts.map((x) => x.text).join(' ') + ' ', plan.lang);
  if (say) { say.lang = LANGS[plan.lang].html; say.innerHTML = ws.map((x, i) => `<span class="w" data-w="${i}">${ctx.esc(x.text)}</span>`).join(''); }
  stopAudio();
  speech = tts.speak(parts, { lang: LANGS[plan.lang].tts, premium: ED.tier === 'premium', onWord: (i) => { if (!ED || !ED.handle) return; ED.handle.el.querySelectorAll('[data-ed-say] .w').forEach((sp2, k) => { sp2.classList.toggle('on', k <= i); sp2.classList.toggle('cur', k === i); }); } });
  const mine = speech;
  speech.done.then(() => { if (speech !== mine && speech) return; if (ED) { ED.playing = false; redrawEditor(ctx); } });
}

// ---------- template quick play (table) ----------
function quickPlay(ctx, tid) {
  const tpl = findTpl(ctx, tid);
  if (!tpl) return;
  const tts = ctx.ui.audio.tts;
  ctx.ui.audio.unlock();
  stopAudio();
  const want = getLang();
  const lang = callLang(tpl, want);
  const sp = speakParts(tpl, lang, SAMPLE_CODE);
  const plan = planVoice(ctx, lang, voiceOf(tpl.voice).tier === 'premium', sp.edited);
  const parts = (plan.builtinOnly || plan.lang !== lang ? speakParts({ ...tpl, texts: null, languages: [plan.lang] }, plan.lang, SAMPLE_CODE).parts : sp.parts).map((x) => ({ ...x, rate: (x.rate || 1) * (tpl.rate || 1) }));
  speech = tts.speak(parts, { lang: LANGS[plan.lang].tts, premium: voiceOf(tpl.voice).tier === 'premium' });
  ctx.ui.toast(plan.note || (lang !== want ? ctx.t('tpl.playingFallback', { name: tid, lang: LANGS[lang].label }) : ctx.t('tpl.playing', { name: tid })), { kind: 'info', demo: true, timeout: 8000, action: { label: ctx.t('tpl.stop'), onClick: () => stopAudio() } });
}

// ---------- mount ----------
export function mount(root, ctx) {
  const { t } = ctx;
  CTX = ctx;
  ctx.ui.audio.tts.ready();
  const con = ctx.state.con;
  const curTpl = () => findTpl(ctx, con.tpl) || templates(ctx).find((x) => x.status === 'live') || templates(ctx)[0];
  const currentTo = () => { const v = ctx.store.get('verifiedNumbers') || []; return env() === 'sandbox' ? (con.to && v.includes(con.to) ? con.to : v[0]) : con.toInput; };
  ctx.actions(root, {
    'ot.range': (el) => ctx.setState({ range: el.dataset.value }),
    'ot.new': () => openEditor(ctx, null),
    'ot.tpl.empty': () => openEditor(ctx, null),
    'ot.tpl.builtin': () => quickPlay(ctx, 'otp-default'),
    'ot.tpl.row': (el) => openEditor(ctx, el.dataset.value),
    'ot.tpl.play': (el) => quickPlay(ctx, el.dataset.value),
    'ot.tile.sent': () => {}, 'ot.tile.credits': () => {},
    'ot.console.lang': (el) => { con.lang = el.dataset.value; con.body = null; con.bodyErr = null; ctx.rerender(); },
    'ot.console.body': () => {},
    'ot.console.resetbody': () => { con.body = null; con.bodyErr = null; ctx.rerender(); },
    'ot.console.copy': (el) => { const tpl = curTpl(); ctx.ui.copy(curlFor(tpl, con.body != null ? con.body : bodyFor(tpl, currentTo(), con.lang || 'th', con.code)), el); },
    'ot.console.verifynum': () => ctx.ui.dialer.verifyNumber().then(() => isOtp() && ctx.rerender()),
    'ot.console.logs': () => {},
    'ot.console.send': () => {
      if (RUN && RUN.target === 'console' && !RUN.done) return;
      con.bodyErr = null;
      const tplDefault = curTpl();
      let body;
      try { body = JSON.parse(con.body != null ? con.body : bodyFor(tplDefault, currentTo(), con.lang || 'th', con.code)); } catch { con.bodyErr = t('con.badJson'); ctx.rerender(); return; }
      const tpl = findTpl(ctx, body.template);
      if (!tpl) { con.bodyErr = t('con.noTemplate', { name: String(body.template || '') }); ctx.rerender(); return; }
      const toMasked = String(body.to || '').replace(/^\+66/, '0').replace(/^0(\d{1,2})x{3}(\d{3,4})$/i, (m, a, b) => `0${a}-xxx-${b}`);
      const verified = ctx.store.get('verifiedNumbers') || [];
      if (env() === 'sandbox' && !verified.includes(toMasked)) { RUN = { target: 'console', steps: [{ key: 'unverified', state: 'err', vars: {}, at: nowMs() }], response: { code: 403, body: { error: 'VOICE_4203', detail: 'number not verified in sandbox' } }, done: true, tpl: tpl.id, to: toMasked, lang: con.lang || 'th', langAsked: con.lang || 'th', verify: { attempts: 0 } }; ctx.rerender(); return; }
      if (env() === 'live' && !/^0\d{1,2}-?[\dx]{3,4}-?\d{3,4}$/i.test(toMasked)) { con.bodyErr = t('con.badNumber'); ctx.rerender(); return; }
      const lang = Object.keys(LANGS).find((l) => LANGS[l].tts === body.lang || l === body.lang) || con.lang || 'th';
      if (body.code != null && tpl.type === 'otp' && !/^\d{4,8}$/.test(normDigits(body.code))) { con.bodyErr = t('con.badCode'); ctx.rerender(); return; }
      con.verifyIn = '';
      sendOtp(ctx, { tpl, to: toMasked, lang, code: body.code != null ? String(body.code) : '', outcome: con.outcome, target: 'console' });
      ctx.rerender();
    },
    'ot.console.verify': () => {
      const run = RUN;
      if (!run || run.target !== 'console' || !run.code || run.verify.locked || run.verify.valid) return;
      const v = normDigits(con.verifyIn);
      run.verify.attempts += 1;
      if (nowMs() > run.expiresAt) run.verify.last = { code: 410, body: { error: 'expired' } };
      else if (v === run.code) {
        run.verify.valid = true;
        run.verify.last = { code: 200, body: { valid: true, verified_at: ctx.fmt.iso(nowMs()) } };
        if (run.callId) ctx.store.update('calls', (l) => l.map((c) => (c.id === run.callId ? { ...c, verifiedAt: nowMs() } : c)));
        ctx.ui.toast(t('ver.validToast'), { kind: 'success' });
      } else if (run.verify.attempts >= 3) { run.verify.locked = true; run.verify.last = { code: 423, body: { valid: false, error: 'locked' } }; }
      else run.verify.last = { code: 200, body: { valid: false, attempts_left: 3 - run.verify.attempts } };
      const box = root.querySelector('[data-verify]');
      if (box) box.outerHTML = String(verifyHTML(ctx));
      const inp = root.querySelector('[data-field="verifyIn"]'); if (inp) inp.focus();
    },
    'ot.deliv.filter': () => {},
    'ot.deliv.row': () => {},
    'ot.deliv.all': () => {},
    'ot.deliv.export': () => {
      const f = ctx.state.delivTpl;
      const rows = ctx.list('calls').filter((c) => c.env === env() && c.source && ['otp', 'notification', 'api'].includes(c.source.type) && (f === 'all' || c.source.ref === f)).sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
      ctx.ui.csv(`ants-voice-otp_${ctx.fmt.isoDate(nowMs())}_${f}.csv`, rows, [
        { key: 'call_id', label: 'call_id', value: (c) => c.id }, { key: 'started_at', label: 'started_at', value: (c) => ctx.fmt.iso(c.ts) },
        { key: 'template', label: 'template', value: (c) => c.source.ref }, { key: 'to', label: 'to', value: (c) => c.to }, { key: 'status', label: 'status', value: (c) => c.status },
        { key: 'verified_at', label: 'verified_at', value: (c) => (verifiedAt(c) ? ctx.fmt.iso(verifiedAt(c)) : '') }, { key: 'credits', label: 'credits', value: (c) => (c.credits || 0).toFixed(2) },
      ]);
      ctx.ui.toast(t('toast.T05', { n: ctx.fmt.int(rows.length) }), { kind: 'success' });
    },
    'ot.protect': (el) => {
      const k = el.dataset.value;
      const p = ctx.state.protect;
      p[k] = !p[k];
      p.dirty = true;
      const name = k === 'rate' ? t('pr.rateName') : k === 'daily' ? t('pr.dailyName') : t('pr.hookName');
      ctx.rerender();
      ctx.ui.toast(p[k] ? t('toast.T29', { name }) : t('toast.T29off', { name }), { kind: p[k] ? 'success' : 'info' });
    },
    'ot.protect.billing': () => {},
    'ot.protect.save': () => { ctx.state.protect.dirty = false; audit('otp.protection.saved', { ...ctx.state.protect }); ctx.rerender(); ctx.ui.toast(t('toast.T02'), { kind: 'success' }); },
  });
  ctx.inputs(root, {
    conTo: (v) => { con.to = v; con.body = null; ctx.rerender(); },
    conToInput: (v) => { con.toInput = v; if (con.body == null) { const ta = root.querySelector('[data-field="conBody"]'); if (ta) ta.value = bodyFor(curTpl(), v, con.lang || 'th', con.code); } },
    conTpl: (v) => { con.tpl = v; con.body = null; con.bodyErr = null; const tpl = findTpl(ctx, v); if (tpl && con.lang && textOf(tpl, con.lang) == null) con.lang = callLang(tpl, con.lang); ctx.rerender(); },
    conCode: (v) => { con.code = v.replace(/[^\d๐-๙]/g, ''); if (con.body == null) { const ta = root.querySelector('[data-field="conBody"]'); if (ta) ta.value = bodyFor(curTpl(), currentTo(), con.lang || 'th', con.code); } },
    conOutcome: (v) => { con.outcome = v; },
    conBody: (v) => { con.body = v; },
    verifyIn: (v) => { con.verifyIn = v; },
    delivTpl: (v) => ctx.setState({ delivTpl: v }),
    prRateN: (v) => { ctx.state.protect.rateN = Math.max(1, Math.min(10, Number(v) || 3)); ctx.state.protect.dirty = true; },
    prRateMin: (v) => { ctx.state.protect.rateMin = Math.max(1, Math.min(60, Number(v) || 10)); ctx.state.protect.dirty = true; },
    prDailyN: (v) => { ctx.state.protect.dailyN = Math.max(1, Math.min(50, Number(v) || 10)); ctx.state.protect.dirty = true; },
    prHookUrl: (v) => { ctx.state.protect.hookUrl = v; ctx.state.protect.dirty = true; },
  });
  // The Save button reflects changes made in the number fields.
  ctx.on(root, 'focusout', '[data-field^="pr"]', () => ctx.rerender());
  ctx.on(root, 'keydown', '[data-field="verifyIn"]', (ev) => {
    if (ev.key !== 'Enter' || ev.isComposing || ev.keyCode === 229) return;
    ev.preventDefault();
    const b = root.querySelector('[data-action="ot.console.verify"]');
    if (b && b.getAttribute('aria-disabled') !== 'true') b.click();
  });
  ctx.watch('calls', 'env', 'mode', 'otpTemplates', 'verifiedNumbers', 'otpStats');
  ctx.cleanup(() => { if (!isOtp()) { stopAudio(); } });
  // Deep links: ?template=<id> opens the editor (palette results) · ?focus=console scrolls to the console.
  if (ctx.state.qParams !== ctx.params) {
    ctx.state.qParams = ctx.params;
    const q = ctx.params.query;
    if (q.template && findTpl(ctx, q.template)) ctx.later(() => openEditor(ctx, q.template), 60);
    if (q.focus === 'console') ctx.later(() => { const c = root.querySelector('#ot-console'); if (c) c.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' }); }, 60);
  }
  // Fresh-row flash only once.
  ctx.later(() => { const l = ctx.list('otpTemplates'); if (l.some((x) => x.fresh)) ctx.store.set('otpTemplates', l.map((x) => (x.fresh ? { ...x, fresh: false } : x))); }, 1700);
}
