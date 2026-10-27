// Test-call dialer — one shared component used by Overview, Test call, Connect, Trunks, Numbers, OTP and Flows.
// CONTRACT:
//   ui.dialer.open({ mode, source, to, template, request, onEnd })   floating card, bottom right (sheet on a phone)
//   ui.dialer.mount(container, { source })  → cleanup                inline version (#/test-call)
//   ui.dialer.verifyNumber() → Promise<masked number|null>            "verify a number" flow (sandbox, max 3)
//   mode: 'test' (default) · 'api' (Connect: shows the request + 201 first) · 'trunk' · 'number' · 'otp' · 'flow'
//   onKey(key, call) lets Flows / OTP react to key presses. With onKey the call stays connected after the
//   message until the user hangs up or the screen calls call.hangup(); call.say(text, { after }) speaks a new
//   prompt (stops the current one without running its `after`) and returns a Promise<boolean finished>.
//   text / voiceLang / from / outcome preset the message, its language, the caller ID and the demo outcome.
// Phases: idle → connecting (0–0.7 s) → ringing (Thai ringback) → connected (timer, TTS + captions) → ended.
// Demo outcome: answered · busy · no-answer · failed (SIP 503). Esc never hangs up a live call — the red
// button or the H key does. The end writes a Logs row (source "test-call") and shows toast T06.

import { html, raw, el as toEl, on, effect, reducedMotion, focusQuiet } from '../core/dom.js';
import { t, tIn, getLang, LANGS, LANG_ORDER, onLangChange } from '../core/i18n.js';
import { fmt } from '../core/format.js';
import { store } from '../core/store.js';
import { go } from '../core/router.js';
import { addCall, setStep, notify, balance, trialLeft, addVerifiedNumber, canAddVerified } from '../core/actions.js';
import { PRICES, billedMinutes, callCost } from '../data/prices.js';
import { nowMs } from '../data/clock.js';
import { SANDBOX_CALLER, SANDBOX_CALLER_E164, API_BASE, DEFAULT_WEBHOOK } from '../data/edge.js';
import { tones, tts, words as splitWords, unlock, setMuted, isMuted } from './audio.js';
import { icon } from './icons.js';
import { toast } from './toast.js';
import { modal } from './modal.js';
import { copy } from './io.js';
import { pushLayer, layersRoot } from './overlay.js';

const TEMPLATES = ['test', 'otp', 'reminder', 'delivery'];
const OUTCOMES = ['answered', 'busy', 'no-answer', 'failed'];
const SIP = { completed: 200, busy: 486, 'no-answer': 480, failed: 503, canceled: 487 };
const Q850 = { completed: 16, busy: 17, 'no-answer': 19, failed: 34, canceled: null };
let activeCall = null;
let uidN = 0;

/** Speak parts for a template in a language: dictionary arrays, '#' prefix = code part read at rate 0.8. */
function speakParts(lang, tpl) {
  const raw = tIn(lang, `dialer.tpl.${tpl}.speak`);
  const list = Array.isArray(raw) ? raw : [String(raw)];
  return list.map((p) => (p.startsWith('#') ? { text: p.slice(1), rate: 0.8 } : { text: p }));
}

function createController(rootEl, opts) {
  const s = {
    phase: 'idle', result: null,
    from: opts.from || null,
    to: opts.to || store.get('verifiedNumbers')[0],
    toInput: '',
    tpl: opts.template || 'test',
    text: opts.text ?? null,    // edited display text (null = the template)
    voiceLang: opts.voiceLang && LANGS[opts.voiceLang] ? opts.voiceLang : getLang(),
    voice: 'standard',
    outcome: OUTCOMES.includes(opts.outcome) ? opts.outcome : store.get('demo.outcome') || 'answered', // opts.outcome: e.g. 'failed' for a down trunk
    keypad: false,
    keys: '',
    events: [],
    words: [],
    wordIdx: -1,
    answeredAt: 0, endedAt: 0,
    record: null,
    note: null,                 // { key, vars } — translated at render time, so a language switch updates it
    speaking: false,
    startedAt: 0, ringAt: 0,
    error: null,
    request: false,
  };
  const timers = new Set();
  const later = (fn, ms) => { const h = setTimeout(() => { timers.delete(h); fn(); }, ms); timers.add(h); return h; };
  let tick = null;
  let stopRing = null;
  let speech = null;
  let speakSeq = 0;
  const offs = [];
  const env = () => store.get('env');
  const inCall = () => ['connecting', 'ringing', 'connected'].includes(s.phase);
  const elapsed = () => (s.answeredAt ? Math.max(0, Math.round(((s.endedAt || nowMs()) - s.answeredAt) / 1000)) : 0);
  const noteText = () => (s.note ? t(s.note.key, s.note.vars) : '');
  const ownedNumbers = () => (store.get('numbers') || []).filter((n) => n.status === 'active').map((n) => n.number);
  const callerId = () => (env() === 'live' && ownedNumbers().length ? (s.from && ownedNumbers().includes(s.from) ? s.from : ownedNumbers()[0]) : SANDBOX_CALLER);
  const displayText = () => (s.text != null ? s.text : tIn(s.voiceLang, `dialer.tpl.${s.tpl}.text`));

  function costLine() {
    if (env() === 'sandbox') return t('dialer.costSandbox', { left: fmt.num(trialLeft(), 1), total: fmt.int(PRICES.trial.minutes) });
    const base = t('dialer.costLive', { rate: fmt.rate(PRICES.outbound) });
    return s.voice === 'premium' ? `${base} · ${t('dialer.costPremium', { rate: fmt.rate(PRICES.premiumVoice) })}` : base;
  }

  // ---------- templates ----------
  function chip() {
    if (s.phase === 'ended') {
      const r = s.result;
      const cls = r === 'completed' ? 'chip-ok' : r === 'failed' ? 'chip-err' : r === 'canceled' ? '' : 'chip-warn';
      return html`<span class="chip ${cls}" data-tip-key="statusTip.${r}" tabindex="0">${t(`status.${r}`)}</span>`;
    }
    const map = { idle: ['', 'dialer.phase.idle'], connecting: ['', 'dialer.phase.connecting'], ringing: ['chip-warn', 'dialer.phase.ringing'], connected: ['chip-ok', 'dialer.phase.connected'] };
    const [cls, key] = map[s.phase];
    return html`<span class="chip ${cls}">${t(key)}</span>`;
  }

  function toField() {
    const dis = inCall() ? raw('disabled') : '';
    if (env() === 'sandbox') {
      const list = store.get('verifiedNumbers');
      return html`<label class="ph-label" for="dl-to-${opts.uid}">${t('dialer.toVerified')}</label>
        <select class="ph-select" id="dl-to-${opts.uid}" data-dl="to" translate="no" ${dis}>${list.map((n) => html`<option value="${n}" ${raw(n === s.to ? 'selected' : '')}>${n}</option>`)}</select>
        ${!inCall() && canAddVerified() ? html`<button type="button" class="linkbtn" data-action="dl.verify" style="color:#FFC59E;font-size:var(--fs-xs);align-self:center">${t('dialer.verifyAnother', { max: PRICES.trial.verifiedNumbers })}</button>` : ''}`;
    }
    return html`<label class="ph-label" for="dl-to-${opts.uid}">${t('dialer.toLive')}</label>
      <input class="ph-input" id="dl-to-${opts.uid}" data-dl="to-input" inputmode="tel" translate="no" placeholder="081-xxx-1234" value="${s.toInput || s.to}" ${dis} aria-invalid="${s.error ? 'true' : 'false'}" aria-describedby="dl-err-${opts.uid}">
      ${s.error ? html`<span class="ph-sub" id="dl-err-${opts.uid}" style="color:#FFB4B6;text-align:center">${s.error}</span>` : ''}`;
  }

  function statusSub() {
    if (s.phase === 'connected' || (s.phase === 'ended' && s.answeredAt)) return html`<span class="ph-timer" data-dl-timer>${fmt.duration(elapsed())}</span>`;
    if (s.phase === 'ended' && s.result === 'failed') return html`<span class="ph-sub">${t('dialer.failedSub')}</span>`;
    return html`<span class="ph-sub" translate="no">${t('dialer.from', { number: callerId() })}</span>`;
  }

  function keypadHTML() {
    const keys = [['1', ''], ['2', 'ABC'], ['3', 'DEF'], ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'], ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'], ['*', ''], ['0', '+'], ['#', '']];
    return html`<div class="keypad" role="group" aria-label="${t('dialer.keypad')}">${keys.map(([k, l]) => html`<button type="button" data-action="dl.key" data-value="${k}" aria-label="${k}"><b>${k}</b><small>${l || ' '}</small></button>`)}</div>`;
  }

  function phoneHTML() {
    const muted = isMuted();
    return html`<div class="dl-phone">
      ${toField()}
      <div class="ph-stage" aria-hidden="true"><span class="ph-ring"></span><span class="ph-ring"></span>
        <div class="ph-avatar">${icon(s.phase === 'connected' ? 'phone-call' : s.phase === 'ended' ? 'phone-off' : 'phone')}</div>
        <div class="ph-indet"><i></i></div>
        <div class="ph-wave">${Array.from({ length: 24 }, () => raw('<i></i>'))}</div>
      </div>
      <div class="ph-status" aria-live="polite">${chip()}${statusSub()}<span class="ph-speaking">${t('dialer.speaking')}</span></div>
      ${s.keypad ? keypadHTML() : ''}
      <div class="ph-actions">
        <button type="button" class="ph-side" data-action="dl.mute" aria-pressed="${muted ? 'true' : 'false'}" aria-label="${t('dialer.mute')}" data-tip-key="dialer.muteTip">${icon(muted ? 'volume-x' : 'volume')}</button>
        ${inCall()
          ? html`<button type="button" class="callbtn hang" data-action="dl.hangup" aria-label="${t('dialer.hangup')}" data-tip-key="dialer.hangup" data-tip-kbd="H">${icon('phone-off')}</button>`
          : html`<button type="button" class="callbtn" data-action="dl.call" aria-label="${t('dialer.call')}" data-tip-key="dialer.call">${icon('phone')}</button>`}
        ${s.phase === 'connected'
          ? html`<button type="button" class="ph-side" data-action="dl.replay" aria-label="${t('dialer.replay')}" data-tip-key="dialer.replay">${icon('refresh')}</button>`
          : html`<button type="button" class="ph-side" data-action="dl.keypad" aria-pressed="${s.keypad ? 'true' : 'false'}" aria-label="${t('dialer.keypad')}" data-tip-key="dialer.keypad">${icon('dialpad')}</button>`}
      </div>
      ${s.phase === 'connected' ? html`<button type="button" class="linkbtn" data-action="dl.keypad" style="color:#B9C5DA;font-size:var(--fs-xs);align-self:center">${s.keypad ? t('dialer.hideKeypad') : t('dialer.showKeypad')}</button>` : ''}
    </div>`;
  }

  function evHTML(e) {
    const cls = e.kind === 'err' ? 'err' : e.kind === 'wait' ? 'wait' : '';
    return html`<li><span class="tdot ${cls}">${icon(e.kind === 'err' ? 'x' : e.kind === 'wait' ? 'clock' : 'check')}</span>
      <span><span>${t(`dialer.ev.${e.key}`, e.vars)}</span> ${e.sip ? html`<code translate="no">${e.sip}</code>` : ''}</span>
      <time>${fmt.time(e.at)}</time></li>`;
  }

  function timelineHTML() {
    if (!s.events.length) return '';
    return html`<div class="dl-section"><span class="label">${t('dialer.timeline')}</span><ol class="timeline" data-dl-timeline>${s.events.map(evHTML)}</ol></div>`;
  }

  function requestHTML() {
    if (!s.request) return '';
    const body = { from: SANDBOX_CALLER_E164, to: '+668XXXX0101', say: tIn(s.voiceLang, 'dialer.tpl.test.text'), webhook_url: DEFAULT_WEBHOOK };
    return html`<div class="dl-section"><span class="label">${t('dialer.request')}</span>
      <pre class="code" translate="no" style="font-size:11.5px;white-space:pre-wrap">POST ${API_BASE}/voice/calls
${JSON.stringify(body, null, 2)}</pre></div>`;
  }

  function captionsHTML() {
    if (!s.words.length) return '';
    return html`<div class="dl-section"><span class="label">${icon('wave', 'ico-sm')}${t('dialer.captions')}</span>
      <div class="captions" data-dl-captions lang="${LANGS[s.voiceLang].html}">${s.words.map((w, i) => html`<span class="w ${i <= s.wordIdx ? 'on' : ''} ${i === s.wordIdx && s.phase === 'connected' ? 'cur' : ''}">${w.text}</span>`)}</div>
      <span class="hint-xs">${t('dialer.captionsNote')}</span></div>`;
  }

  function summaryHTML() {
    if (s.phase !== 'ended' || !s.record) return '';
    const r = s.record;
    const good = r.status === 'completed';
    return html`<div class="dl-summary ${good ? '' : 'bad'}" role="status">
      <strong>${good ? t('dialer.sumDone') : t(`dialer.sum.${r.status}`)}</strong>
      <div class="kv"><span class="k">${t('dialer.sumDuration')}</span><span class="v tnum">${fmt.duration(r.sec)}</span></div>
      <div class="kv"><span class="k">${t('dialer.sumPdd')}</span><span class="v tnum">${r.pddMs == null ? '—' : t('common.seconds', { n: fmt.num(r.pddMs / 1000, 1) })}</span></div>
      <div class="kv"><span class="k">${t('dialer.sumCost')}</span><span class="v tnum">${r.env === 'sandbox' ? t('dialer.sumTrial', { min: fmt.num(r.trialMinutes || 0, 1) }) : t('common.creditsN', { n: fmt.credits2(r.credits) })}</span></div>
      <div class="kv"><span class="k">${t('dialer.callId')}</span><span class="v mono" translate="no" style="font-size:var(--fs-xs)">${r.id} <button type="button" class="copybtn" data-action="dl.sum.copy" aria-label="${t('common.copy')}" data-tip-key="common.copy" style="width:26px;height:26px;display:inline-grid;vertical-align:middle">${icon('copy', 'ico-xs')}</button></span></div>
      <div class="row" style="margin-top:6px"><button type="button" class="btn btn-primary btn-sm" data-action="dl.sum.logs">${icon('list')}${t('dialer.openLogs')}</button>
      <button type="button" class="btn btn-sm" data-action="dl.sum.again">${icon('refresh')}${t('dialer.again')}</button></div>
    </div>`;
  }

  function setupHTML() {
    if (inCall() || s.phase === 'ended') return '';
    const live = env() === 'live';
    const needTopUp = live && balance() <= 0;
    const owned = ownedNumbers();
    return html`
      <div class="dl-section"><label class="label" for="dl-from-${opts.uid}">${t('dialer.fromLabel')}</label>
        ${live && owned.length
          ? html`<select class="select" id="dl-from-${opts.uid}" data-dl="from" translate="no">${owned.map((n) => html`<option value="${n}" ${raw(n === callerId() ? 'selected' : '')}>${n}</option>`)}</select>`
          : html`<input class="input" id="dl-from-${opts.uid}" readonly value="${t('dialer.sandboxCaller', { number: SANDBOX_CALLER })}" translate="no">`}</div>
      <div class="dl-section"><label class="label" for="dl-tpl-${opts.uid}">${t('dialer.message')}</label>
        <div class="row" style="flex-wrap:nowrap">
          <select class="select grow" id="dl-tpl-${opts.uid}" data-dl="tpl">${TEMPLATES.map((id) => html`<option value="${id}" ${raw(id === s.tpl ? 'selected' : '')}>${t(`dialer.tpl.${id}.name`)}</option>`)}</select>
          <select class="select" style="width:auto" data-dl="lang" aria-label="${t('dialer.voiceLang')}">${LANG_ORDER.map((l) => html`<option value="${l}" ${raw(l === s.voiceLang ? 'selected' : '')}>${LANGS[l].label}</option>`)}</select>
        </div>
        <textarea class="textarea" data-dl="text" rows="3" lang="${LANGS[s.voiceLang].html}" aria-label="${t('dialer.messageText')}">${displayText()}</textarea>
        <div class="row"><button type="button" class="btn btn-sm" data-action="dl.preview">${icon('play')}${t('dialer.preview')}</button><span class="hint-xs">${t('dialer.voiceLangHint')}</span></div>
      </div>
      <div class="dl-section"><span class="label">${t('dialer.voice')}</span>
        <div class="voice-opts" role="radiogroup" aria-label="${t('dialer.voice')}">
          <button type="button" class="optcard" role="radio" data-action="dl.voice" data-value="standard" aria-checked="${s.voice === 'standard'}"><span class="t">${t('dialer.voiceStandard')}</span><span class="h">${t('dialer.voiceStandardH')}</span></button>
          <button type="button" class="optcard" role="radio" data-action="dl.voice" data-value="premium" aria-checked="${s.voice === 'premium'}"><span class="t">${t('dialer.voicePremium')}</span><span class="h">${t('dialer.voicePremiumH', { rate: fmt.rate(PRICES.premiumVoice) })}</span></button>
        </div></div>
      <div class="dl-section"><label class="label" for="dl-out-${opts.uid}">${t('dialer.outcome')} <span class="chip chip-navy">${t('common.demoTag')}</span></label>
        <select class="select" id="dl-out-${opts.uid}" data-dl="outcome" data-action="dl.outcome">${OUTCOMES.map((o) => html`<option value="${o}" ${raw(o === s.outcome ? 'selected' : '')}>${t(`dialer.out.${o}`)}</option>`)}</select></div>
      ${needTopUp ? html`<div class="note note-warn">${icon('alert')}<div class="grow">${t('dialer.needTopUp')} <button type="button" class="linkbtn" data-action="dl.topup">${t('top.topup')}</button></div></div>` : ''}
      ${s.note ? html`<div class="dl-note">${icon('info')}<span>${noteText()}</span></div>` : ''}`;
  }

  function render() {
    rootEl.innerHTML = String(html`<div class="dialer ${opts.inline ? 'is-inline' : ''}" data-phase="${s.phase}" data-result="${s.result || ''}" data-speaking="${s.speaking ? 'true' : 'false'}">
      ${phoneHTML()}
      <div class="dl-panel">${summaryHTML()}${setupHTML()}${requestHTML()}${captionsHTML()}${s.phase !== 'idle' && s.note && s.phase !== 'ended' ? html`<div class="dl-note">${icon('info')}<span>${noteText()}</span></div>` : ''}${timelineHTML()}</div>
    </div>`);
    if (opts.onRender) opts.onRender(s);
  }

  const dialerEl = () => rootEl.querySelector('.dialer');
  const setSpeaking = (v) => { s.speaking = !!v; const d = dialerEl(); if (d) d.dataset.speaking = v ? 'true' : 'false'; };

  function addEvent(key, sip, kind = 'ok', vars) {
    const e = { key, sip, kind, vars, at: nowMs() }; // demo clock, like every other time on screen
    if (key === 'ringing' && !s.ringAt) s.ringAt = e.at;
    s.events.push(e);
    const ol = rootEl.querySelector('[data-dl-timeline]');
    if (ol) ol.insertAdjacentHTML('beforeend', String(evHTML(e)));
    else render();
  }

  function setPhase(p) {
    s.phase = p;
    render();
    if (opts.onPhase) opts.onPhase(p);
  }

  function clearTimers() {
    for (const h of timers) clearTimeout(h);
    timers.clear();
    clearInterval(tick);
    tick = null;
    if (stopRing) { stopRing(); stopRing = null; }
    tones.stop();
  }

  /** What the call says: sandbox preamble first; codes read slower; Thai/Chinese fall back to English with a note. */
  function plan() {
    let lang = s.voiceLang;
    let note = null;
    const tag = LANGS[lang].tts;
    const pick = tts.pick(tag, { premium: s.voice === 'premium' });
    if (!tts.supported() || pick.match === 'none') note = { key: 'dialer.noVoiceNote' };
    else if (pick.match !== 'exact' && lang !== 'en') { note = { key: 'dialer.fallbackVoiceNote', vars: { lang: LANGS[lang].label } }; lang = 'en'; }
    const parts = [];
    if (env() === 'sandbox') parts.push({ text: tIn(lang, 'dialer.sandboxLine') });
    if (s.text != null && s.text !== tIn(s.voiceLang, `dialer.tpl.${s.tpl}.text`) && lang === s.voiceLang) {
      // Typed text is spoken only by an on-device voice; a network voice reads the built-in sample instead.
      if (pick.voice && !pick.local) { parts.push(...speakParts(lang, s.tpl)); note = { key: 'dialer.remoteVoiceNote' }; }
      else parts.push({ text: s.text });
    } else {
      parts.push(...speakParts(lang, s.tpl));
    }
    return { lang, tag: LANGS[lang].tts, parts, note };
  }

  function validLive(v) {
    const d = String(v || '').replace(/[\s-]/g, '');
    return /^(\+66|0)\d{1,2}[\dx]{3,4}\d{3,4}$/i.test(d);
  }

  function start() {
    if (activeCall && activeCall !== api) { toast(t('dialer.busyElsewhere'), { kind: 'warn' }); return; }
    unlock(); // inside the click handler: browsers block audio that starts later
    s.error = null;
    if (env() === 'live') {
      const v = (rootEl.querySelector('[data-dl="to-input"]') || {}).value || s.to;
      if (!validLive(v)) { s.error = t('dialer.badNumber'); render(); return; }
      if (balance() <= 0) { render(); return; }
      s.to = v;
    }
    activeCall = api;
    const p = plan();
    s.plan = p;
    s.note = p.note;
    s.events = [];
    s.words = splitWords(p.parts.map((x) => x.text).join(' ') + ' ', p.tag);
    s.wordIdx = -1;
    s.result = null; s.record = null; s.answeredAt = 0; s.endedAt = 0; s.keys = '';
    s.startedAt = nowMs(); s.ringAt = 0;
    s.keypad = false;
    s.request = opts.mode === 'api';
    const t0 = s.request ? 600 : 0;
    setPhase('connecting');
    if (s.request) later(() => addEvent('created', '201 Created'), 300);
    later(() => addEvent('queued', null, 'wait'), t0);
    later(() => addEvent('initiated', '100 Trying'), t0 + 260);
    if (s.outcome === 'failed') {
      later(() => { addEvent('failed', '503 Service Unavailable', 'err'); end('failed'); }, t0 + 1400);
      return;
    }
    later(() => {
      setPhase('ringing');
      addEvent('ringing', '180 Ringing', 'wait');
      stopRing = tones.ringback();
      if (s.outcome === 'busy') later(() => { if (stopRing) { stopRing(); stopRing = null; } addEvent('busy', '486 Busy Here', 'err'); tones.busy(3); end('busy'); }, 1200);
      else if (s.outcome === 'no-answer') later(() => { addEvent('noanswer', '480 Temporarily Unavailable', 'err'); end('no-answer'); }, 6000);
      else later(answer, 2700); // 1.7 s into the first silence of the ringback
    }, t0 + 700);
  }

  // After the message the call hangs up by itself — unless a screen listens for keys (Flows, OTP, Numbers):
  // then it stays open until the user hangs up or the screen calls call.hangup().
  function autoEnd() {
    if (s.phase === 'connected' && !opts.onKey) later(() => { if (s.phase === 'connected') end('completed'); }, 700);
  }

  function answer() {
    if (stopRing) { stopRing(); stopRing = null; }
    tones.stop();
    s.answeredAt = nowMs();
    setPhase('connected');
    addEvent('answered', '200 OK');
    const card = rootEl.closest('.dialer-float');
    if (card && !reducedMotion()) { card.classList.remove('bump'); void card.offsetWidth; card.classList.add('bump'); }
    tick = setInterval(() => { const el = rootEl.querySelector('[data-dl-timer]'); if (el) el.textContent = fmt.duration(elapsed()); }, 250);
    speakNow(s.plan.parts, autoEnd);
  }

  // Each prompt gets a sequence number: a prompt that was replaced (say) or cut off (hang up) never runs its
  // `after` callback. Resolves true when the prompt finished on its own.
  function speakNow(parts, after) {
    const my = ++speakSeq;
    if (speech) speech.stop();
    setSpeaking(true);
    const base = s.wordIdx < 0 ? 0 : 0;
    speech = tts.speak(parts, {
      lang: s.plan.tag,
      premium: s.voice === 'premium',
      onWord: (i) => {
        s.wordIdx = base + i;
        rootEl.querySelectorAll('[data-dl-captions] .w').forEach((sp, k) => { sp.classList.toggle('on', k <= s.wordIdx); sp.classList.toggle('cur', k === s.wordIdx); });
      },
    });
    effect('audio', { kind: 'tts' });
    return speech.done.then(() => {
      if (my !== speakSeq) return false;
      setSpeaking(false);
      if (after) after();
      return true;
    });
  }

  function end(result) {
    speakSeq += 1; // pending prompts must not run their `after` once the call is over
    clearTimers();
    if (speech) { speech.stop(); speech = null; }
    setSpeaking(false);
    s.endedAt = nowMs();
    s.result = result;
    if (result === 'completed') { addEvent('completed', 'BYE'); tones.hangup(); }
    if (result === 'canceled') addEvent('canceled', 'CANCEL · 487', 'err');
    const sec = elapsed();
    const answered = result === 'completed';
    const e = env();
    const rec = addCall({
      kind: 'outbound', direction: 'outbound', env: e, from: callerId(), to: s.to, status: result,
      sip: SIP[result], q850: Q850[result], sec, billedMin: answered ? billedMinutes(sec) : 0,
      credits: callCost({ kind: 'outbound', sec, answered, premium: s.voice === 'premium', env: e }),
      trialMinutes: e === 'sandbox' && answered ? billedMinutes(sec) : 0,
      source: { type: 'test-call', ref: opts.source || 'dialer' }, sub: store.get('subAccounts')[0] ? store.get('subAccounts')[0].id : null,
      pddMs: s.ringAt ? s.ringAt - s.startedAt : null, keys: s.keys || null, // time to 180 Ringing (none for a 503) recorded: false, route: 'primary', voice: s.voice,
      tts: { lang: s.plan ? s.plan.tag : LANGS[getLang()].tts, text: s.words.map((w) => w.text).join('').trim() },
      reason: { en: answered ? 'Test call from the dialer · message played' : `Test call · ${result}` },
      events: s.events.map((x) => ({ event: x.key, sip: x.sip, at: new Date(x.at).toISOString() })),
      webhook: answered ? { event: 'call.completed', host: 'hooks.example.com', code: 200, ms: 182 } : null,
    });
    s.record = rec;
    activeCall = null;
    setPhase('ended');
    if (answered) setStep('testCall', 'done');
    notify('testCall', { vars: { status: result, number: s.to }, href: `logs?call=${rec.id}` });
    const credits = e === 'sandbox' ? '0' : fmt.credits2(rec.credits);
    toast(answered ? t('toast.T06', { dur: fmt.duration(sec), credits }) : t('dialer.toastOther', { status: t(`status.${result}`) }), {
      kind: answered ? 'success' : 'info',
      action: { label: t('dialer.viewInLogs'), onClick: () => go(`logs?call=${rec.id}`) },
    });
    if (opts.onEnd) opts.onEnd(rec);
    effect('call', { status: result });
  }

  function hangup() {
    if (s.phase === 'connected') end('completed');
    else if (s.phase === 'ringing' || s.phase === 'connecting') end('canceled');
  }

  function preview(btn) {
    unlock();
    if (speech && s.phase === 'idle') { speech.stop(); speech = null; setSpeaking(false); btn.innerHTML = String(html`${icon('play')}${t('dialer.preview')}`); return; }
    const p = plan();
    s.plan = p;
    if (p.note) toast(t(p.note.key, p.note.vars), { kind: 'info' });
    btn.innerHTML = String(html`${icon('stop')}${t('dialer.stopPreview')}`);
    setSpeaking(true);
    speech = tts.speak(p.parts.filter((x, i) => !(env() === 'sandbox' && i === 0)), { lang: p.tag, premium: s.voice === 'premium' });
    effect('audio', { kind: 'preview' });
    speech.done.then(() => {
      speech = null;
      setSpeaking(false);
      const b = rootEl.querySelector('[data-action="dl.preview"]');
      if (b) b.innerHTML = String(html`${icon('play')}${t('dialer.preview')}`);
    });
  }

  // ---------- events ----------
  const A = {
    'dl.call': () => start(),
    'dl.outcome': () => {}, // the native list opens; the change handler below stores the choice
    'dl.hangup': () => hangup(),
    'dl.mute': (b) => { setMuted(!isMuted()); b.setAttribute('aria-pressed', isMuted() ? 'true' : 'false'); b.innerHTML = String(icon(isMuted() ? 'volume-x' : 'volume')); effect('audio', { muted: isMuted() }); },
    'dl.keypad': () => { s.keypad = !s.keypad; render(); },
    'dl.key': (b) => {
      unlock();
      const k = b.dataset.value;
      tones.dtmf(k);
      if (s.phase === 'connected') {
        s.keys += k;
        addEvent('dtmf', `DTMF ${k}`, 'ok', { key: k });
        if (opts.onKey) opts.onKey(k, api);
      }
      effect('audio', { dtmf: k });
    },
    'dl.replay': () => { if (s.phase === 'connected' && s.plan) { s.wordIdx = -1; speakNow(s.plan.parts.filter((x, i) => !(env() === 'sandbox' && i === 0)), autoEnd); } },
    'dl.preview': (b) => preview(b),
    'dl.voice': (b) => { s.voice = b.dataset.value; render(); if (opts.onRender) opts.onRender(s); },
    'dl.verify': () => verifyNumber().then((n) => { if (n) { s.to = n; render(); } }),
    'dl.topup': () => import('./topup.js').then((m) => m.openTopUp({ source: 'dialer' })),
    'dl.sum.logs': () => { go(`logs?call=${s.record.id}`); if (opts.onNavigate) opts.onNavigate(); },
    'dl.sum.again': () => { s.phase = 'idle'; s.result = null; s.events = []; s.words = []; s.record = null; s.answeredAt = 0; s.request = false; s.note = null; render(); },
    'dl.sum.copy': (b) => copy(s.record.id, b),
  };
  offs.push(on(rootEl, 'click', '[data-action]', (ev, b) => {
    const fn = A[b.dataset.action];
    if (!fn) return;
    ev.__handled = true;
    fn(b, ev);
  }));
  offs.push(on(rootEl, 'change', '[data-dl]', (ev, el) => {
    const k = el.dataset.dl;
    if (k === 'to') s.to = el.value;
    if (k === 'from') s.from = el.value;
    if (k === 'tpl') { s.tpl = el.value; s.text = null; render(); }
    if (k === 'lang') { s.voiceLang = el.value; s.text = null; render(); }
    if (k === 'outcome') { s.outcome = el.value; store.set('demo.outcome', el.value); }
  }));
  offs.push(on(rootEl, 'input', '[data-dl]', (ev, el) => {
    if (el.dataset.dl === 'text') s.text = el.value;
    if (el.dataset.dl === 'to-input') s.toInput = el.value;
  }));
  const onKey = (ev) => {
    if ((ev.key === 'h' || ev.key === 'H') && inCall() && !/^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName || '') && !ev.metaKey && !ev.ctrlKey) {
      ev.preventDefault();
      hangup();
    }
  };
  document.addEventListener('keydown', onKey);
  offs.push(() => document.removeEventListener('keydown', onKey));
  offs.push(store.subscribe('env', () => { if (!inCall()) render(); }));
  offs.push(store.subscribe('verifiedNumbers', () => { if (!inCall()) render(); }));
  offs.push(onLangChange((code) => { if (!inCall() && s.phase === 'idle' && s.text == null) s.voiceLang = code; render(); }));

  const api = {
    state: s,
    render,
    inCall,
    costLine,
    hangup,
    /** Speak extra text during a connected call (Flows / OTP modes). */
    say(text, { after } = {}) {
      if (s.phase !== 'connected' || !text) return Promise.resolve(false);
      s.words = splitWords(String(text) + ' ', s.plan ? s.plan.tag : LANGS[s.voiceLang].tts);
      s.wordIdx = -1;
      render();
      return speakNow([{ text: String(text) }], after || null);
    },
    destroy() {
      if (inCall()) end('canceled');
      clearTimers();
      if (speech) speech.stop();
      offs.forEach((f) => f());
      if (activeCall === api) activeCall = null;
    },
  };
  render();
  return api;
}

// ---------- floating card ----------
let floating = null;

function pillHTML(f) {
  const s = f.ctrl.state;
  return html`<span class="dot ${s.phase === 'connected' ? 'dot-ok' : s.phase === 'ringing' ? 'dot-warn' : ''}"></span>${t('dialer.title')} · ${s.phase === 'connected' ? fmt.duration(Math.round((nowMs() - s.answeredAt) / 1000)) : t(`dialer.phase.${s.phase === 'ended' ? 'idle' : s.phase}`)}`;
}

export function openDialer(opts = {}) {
  if (floating) {
    if (floating.min) toggleMin(false);
    floating.card.focus();
    if (!floating.ctrl.inCall()) {
      const st = floating.ctrl.state;
      if (opts.to) st.to = opts.to;
      if (opts.text != null) st.text = opts.text;
      if (opts.voiceLang && LANGS[opts.voiceLang]) st.voiceLang = opts.voiceLang;
      if (opts.from) st.from = opts.from;
      if (OUTCOMES.includes(opts.outcome)) st.outcome = opts.outcome;
      floating.ctrl.render();
    }
    return floating;
  }
  const card = toEl(html`<section class="dialer-float" role="dialog" aria-modal="false" aria-labelledby="df-title" tabindex="-1">
    <div class="df-head"><h2 id="df-title">${icon('phone-call', 'ico-sm')}<span data-df-title>${t('dialer.title')}</span></h2>
      <a class="btn btn-ghost btn-sm" href="#/test-call" data-action="dl.full">${t('dialer.fullPage')}</a>
      <button type="button" class="xbtn" data-action="dl.minimise" aria-label="${t('dialer.minimise')}" data-tip-key="dialer.minimise">${icon('minus')}</button>
      <button type="button" class="xbtn" data-action="dl.close" aria-label="${t('common.close')}" data-tip-key="dialer.closeTip">${icon('x')}</button></div>
    <div class="df-cost" data-df-cost></div>
    <div class="df-body" data-df-body></div></section>`);
  layersRoot().appendChild(card);
  document.body.classList.add('has-dialer');
  const body = card.querySelector('[data-df-body]');
  const layer = { el: card, modal: false, escClose: true, persistent: true, close: () => { if (!floating.ctrl.inCall()) closeDialer(); } };
  const unregister = pushLayer(layer);
  const sync = () => {
    if (!floating || !floating.ctrl) return; // the controller's first render runs before it is assigned
    card.querySelector('[data-df-cost]').textContent = floating.ctrl.costLine();
    card.querySelector('[data-df-title]').textContent = t('dialer.title');
    // The header is built once; refresh its words so a language switch reaches every part of the card.
    const full = card.querySelector('[data-action="dl.full"]');
    if (full) full.textContent = t('dialer.fullPage');
    const mn = card.querySelector('[data-action="dl.minimise"]');
    if (mn) mn.setAttribute('aria-label', t('dialer.minimise'));
    const cl = card.querySelector('[data-action="dl.close"]');
    if (cl) cl.setAttribute('aria-label', t('common.close'));
    const busy = floating.ctrl.inCall();
    layer.escClose = !busy;
    const x = card.querySelector('[data-action="dl.close"]');
    if (x) x.hidden = busy;
    if (floating.pill) floating.pill.innerHTML = String(pillHTML(floating));
  };
  floating = { card, ctrl: null, unregister, offs: [], min: false, pill: null };
  floating.ctrl = createController(body, { ...opts, uid: `f${++uidN}`, onRender: sync, onNavigate: () => {} });
  sync();
  floating.offs.push(on(card, 'click', '[data-action="dl.close"]', (ev) => { ev.__handled = true; if (!floating.ctrl.inCall()) closeDialer(); }));
  floating.offs.push(on(card, 'click', '[data-action="dl.full"]', (ev) => { ev.__handled = true; if (!floating.ctrl.inCall()) closeDialer(); else toggleMin(true); }));
  floating.offs.push(on(card, 'click', '[data-action="dl.minimise"]', (ev) => { ev.__handled = true; toggleMin(true); }));
  floating.offs.push(setInterval.bind(window)(() => { if (floating && floating.pill && floating.min) floating.pill.innerHTML = String(pillHTML(floating)); }, 500));
  requestAnimationFrame(() => requestAnimationFrame(() => card.classList.add('is-open')));
  setTimeout(() => { const b = card.querySelector('[data-action="dl.call"]'); focusQuiet(b || card); }, 60); // no tooltip, so the first Esc closes
  effect('overlay', { kind: 'dialer' });
  return floating;
}

function toggleMin(min) {
  if (!floating) return;
  floating.min = min;
  floating.card.hidden = min;
  if (min) {
    const pill = toEl(html`<button type="button" class="demo-pill dialer-pill" data-action="dl.restore" aria-label="${t('dialer.restore')}">${pillHTML(floating)}</button>`);
    pill.addEventListener('click', (ev) => { ev.__handled = true; toggleMin(false); });
    layersRoot().appendChild(pill);
    floating.pill = pill;
    pill.focus();
  } else {
    if (floating.pill) floating.pill.remove();
    floating.pill = null;
    floating.card.focus();
  }
}

export function closeDialer() {
  if (!floating) return;
  const f = floating;
  floating = null;
  f.ctrl.destroy();
  f.offs.forEach((x) => (typeof x === 'function' ? x() : clearInterval(x)));
  if (f.pill) f.pill.remove();
  f.unregister();
  document.body.classList.remove('has-dialer');
  f.card.classList.remove('is-open');
  // While it fades out the card takes no more clicks (its handlers are gone already).
  f.card.addEventListener('click', (ev) => { ev.__handled = true; ev.preventDefault(); }, true);
  f.card.style.pointerEvents = 'none';
  f.card.setAttribute('aria-hidden', 'true');
  setTimeout(() => f.card.remove(), reducedMotion() ? 0 : 240);
}

export const isDialerOpen = () => !!floating;

// ---------- inline (#/test-call) ----------
// The inline dialer survives in-place re-renders (language switch, setState): its element is re-parented
// into the new slot, and it is destroyed only when it is no longer in the document (route left).
let inline = null;

export function mountDialer(container, opts = {}) {
  if (inline && inline.alive) {
    container.appendChild(inline.rootEl);
    inline.ctrl.render();
  } else {
    const rootEl = document.createElement('div');
    container.appendChild(rootEl);
    const ctrl = createController(rootEl, { ...opts, inline: true, uid: `i${++uidN}` });
    inline = { rootEl, ctrl, alive: true };
  }
  const mine = inline;
  return () => {
    setTimeout(() => {
      if (mine.alive && !document.body.contains(mine.rootEl)) {
        mine.alive = false;
        mine.ctrl.destroy();
        if (inline === mine) inline = null;
      }
    }, 0);
  };
}

// ---------- verify a number (sandbox, max 3) ----------
function maskNumber(value) {
  const d = String(value).replace(/\D/g, '');
  if (d.length < 9 || d.length > 10 || d[0] !== '0') return null;
  return `${d.slice(0, 3)}-xxx-${d.slice(-4)}`;
}

export function verifyNumber() {
  return new Promise((resolve) => {
    if (!canAddVerified()) {
      toast(t('dialer.verifyMax', { max: PRICES.trial.verifiedNumbers }), { kind: 'warn' });
      resolve(null);
      return;
    }
    let masked = null;
    let result = null;
    const numberBody = () => html`<p class="hint">${t('dialer.verifyIntro', { max: PRICES.trial.verifiedNumbers })}</p>
      <label class="field" style="margin-top:12px"><span class="label">${t('dialer.verifyNumber')}</span>
      <input class="input" data-v="num" inputmode="tel" placeholder="081-xxx-1234" autofocus autocomplete="off"></label>
      <span class="field-err" data-v="err" hidden>${t('dialer.badNumber')}</span>
      <p class="hint-xs" style="margin-top:8px">${t('dialer.verifyPrivacy')}</p>`;
    const codeBody = () => html`<p class="hint">${t('dialer.verifySent', { number: masked })}</p>
      <label class="field" style="margin-top:12px"><span class="label">${t('dialer.verifyCode')}</span>
      <input class="input mono" data-v="code" inputmode="numeric" maxlength="7" autocomplete="one-time-code" autofocus></label>
      <span class="field-err" data-v="err" hidden>${t('dialer.verifyWrong')}</span>`;
    const focusIn = (h, sel) => setTimeout(() => { const c = h.el.querySelector(sel); if (c) c.focus(); }, 20);
    let numberButtons;
    const codeButtons = [
      { label: t('common.back'), action: 'vf.back', onClick: (h) => { h.setBody(numberBody()); h.setButtons(numberButtons); focusIn(h, '[data-v="num"]'); return false; } },
      { label: t('dialer.verifyConfirm'), kind: 'navy', action: 'vf.confirm', onClick: (h) => {
        const v = h.el.querySelector('[data-v="code"]').value.replace(/[^\d๐-๙]/g, '').replace(/[๐-๙]/g, (x) => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(x)));
        if (v !== '482913') { h.el.querySelector('[data-v="err"]').hidden = false; return false; }
        addVerifiedNumber(masked);
        result = masked;
        toast(t('toast.T43', { num: masked }), { kind: 'success' });
        return true;
      } },
    ];
    numberButtons = [
      { label: t('common.cancel'), action: 'vf.cancel' },
      { label: t('dialer.verifySend'), kind: 'navy', action: 'vf.send', onClick: (h) => {
        masked = maskNumber(h.el.querySelector('[data-v="num"]').value);
        if (!masked) { h.el.querySelector('[data-v="err"]').hidden = false; return false; }
        h.setBody(codeBody());
        h.setButtons(codeButtons);
        toast(t('toast.T42', { code: '482 913' }), { kind: 'info', demo: true });
        focusIn(h, '[data-v="code"]');
        return false;
      } },
    ];
    modal({ title: t('dialer.verifyTitle'), size: 'sm', body: numberBody(), onClose: () => resolve(result), buttons: numberButtons });
  });
}
