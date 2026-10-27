// Connect — #/connect · #/connect/api · #/connect/sip   (query: ?focus=key)
// Two ways in: Card A HTTP API quickstart (create a key shown once → copy the code →
// "Send test call" runs it in the dialer's API mode → watch it in Logs) and Card B SIP trunk, a 5-step wizard
// with animated live checks. All endpoints come from js/data/edge.js, all prices from js/data/prices.js.

import { raw, reducedMotion } from '../core/dom.js';
import { setStep, newId, audit, isActive } from '../core/actions.js';
import { tIn, getLang, LANGS } from '../core/i18n.js';
import { nowMs } from '../data/clock.js';
import { PRICES, estimateMonthly, planBreakEven } from '../data/prices.js';
import {
  API_BASE, SIP_HOST, SIGNALLING_IPS, MEDIA_IPS, MEDIA_PORTS, PORTS, SANDBOX_CALLER_E164, DEFAULT_WEBHOOK,
  DEMO_SIP_PASSWORD, DEMO_KEY_SANDBOX, DEMO_KEY_LIVE, maskKey,
} from '../data/edge.js';

export const id = 'connect';
export const nav = { group: 'start', icon: 'plug', labelKey: 'nav.connect' };
export const titleKey = 'nav.connect';
export const skeleton = 'form';
export const css = true;

const KEY_RE = /^[a-z0-9-]{3,32}$/;
const IP_RE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}(\/(3[0-2]|[12]?\d))?$/;
const URI_RE = /^sips?:[A-Za-z0-9.-]+(:\d{2,5})?(;[A-Za-z0-9=;-]+)?$/;
const PBX = { generic: 'Generic', freepbx: 'FreePBX', '3cx': '3CX', asterisk: 'Asterisk', yeastar: 'Yeastar' };
const PBX_GUIDE = { generic: 'pbx-freepbx', freepbx: 'pbx-freepbx', '3cx': 'pbx-3cx', asterisk: 'pbx-asterisk', yeastar: 'pbx-yeastar' };
const SCOPES = { calls: ['calls:write', 'read'], otp: ['otp:write', 'read'], full: ['calls:write', 'otp:write', 'numbers:write', 'read'], read: ['read'] };
const TABS = ['curl', 'node', 'python', 'php'];
const TRANSPORT = { tls: 'TLS 5061', tcp: 'TCP 5060', udp: 'UDP 5060' };
const STEPS = 5;
const TO_SAMPLE = '+668XXXX0101';

const freshApi = () => ({ keyName: null, keyErr: null, scope: 'calls', env: 'sandbox', busy: false, shownKey: null, keyId: null, saved: false, tab: 'curl', webhook: DEFAULT_WEBHOOK, statusBusy: false });
const freshWizard = () => ({
  runId: 0, step: 1, done: 0, concurrent: PRICES.trunkIncludedCalls, cps: PRICES.cpsDefault, minutes: 20000,
  name: 'clinic-pbx', nameErr: null, pbx: 'freepbx', auth: 'ip', ips: [{ ip: '198.51.100.60', label: 'Clinic PBX' }], ipInput: '', ipErr: null,
  transport: 'tls', srtp: true, reveal: 'hidden', revealAt: 0,
  uris: [{ uri: 'sip:pbx-clinic.example.com:5061', priority: 10, weight: 10, on: true }], uriErr: null, failover: 4, fallback: 'message', fallbackFlow: 'flw_01JB5CLSD2', forwardTo: '', attached: [], cid: 'attached',
  checks: { options: 'idle', reg: 'idle', tls: 'idle', inbound: 'idle', outbound: 'idle' }, at: {}, firewall: false, ran: false, draftId: null, live: '',
});
export const initialState = () => ({ api: freshApi(), wz: freshWizard() });

/** Breadcrumb after "Connect". */
export function crumb(params, { t }) {
  const sub = params.path[0];
  return sub === 'sip' ? t('crumb.sip') : sub === 'api' ? t('crumb.api') : '';
}

/** Palette entries (CONTRACT: run({ go, store })). */
export const commands = [
  { id: 'trunk', labelKey: 'cmd.trunk', icon: 'server', keywords: ['sip trunk pbx wizard create'], run: ({ go }) => go('connect/sip') },
];

// ---------- helpers ----------
const selected = (ctx) => {
  const p = ctx.params.path[0];
  if (p === 'sip' || p === 'api') return p;
  return ctx.store.get('onboarding.role') === 'pbx' ? 'sip' : 'api';
};
const firstRun = (ctx) => ctx.store.get('mode') === 'firstRun';
/** Suggested key name: the first-run account gets "sandbox-tests"; the active one already has it. */
const keyNameOf = (ctx) => ctx.state.api.keyName ?? (firstRun(ctx) ? 'sandbox-tests' : 'backend-server');
const onSip = () => /^#\/connect\/sip/.test(location.hash);
const onApi = () => /^#\/connect(\/api)?(\?|$)/.test(location.hash);

/** Timers that must survive in-place re-renders (ctx.later is cleared on every re-render). */
function soon(ctx, fn, ms, key = 'wz') {
  const st = ctx.state;
  const run = st && st[key] ? st[key].runId : 0;
  setTimeout(() => {
    const s = ctx.state;
    if (!s || !s[key] || (key === 'wz' && s.wz.runId !== run)) return; // reset or restarted meanwhile
    fn(s);
  }, reducedMotion() ? Math.min(ms, 300) : ms);
}
const redraw = (ctx, when) => { if (when()) ctx.rerender(); };

function existingSandboxKey(ctx) {
  return ctx.list('apiKeys').find((k) => k.env === 'sandbox' && k.status === 'active');
}
function connectCall(ctx) {
  return ctx.list('calls').find((c) => c.source && c.source.type === 'test-call' && c.source.ref === 'connect');
}
function lastApiCall(ctx) {
  return ctx.list('calls').find((c) => c.source && ['api', 'otp', 'notification'].includes(c.source.type));
}

// ---------- code samples ----------
function codeSample(ctx, tab) {
  const { t } = ctx;
  const lang = getLang();
  const say = tIn(lang, 'dialer.tpl.test.text');
  const voice = LANGS[lang].tts;
  const url = `${API_BASE}/voice/calls`;
  const cTo = t('api.cmtTo');
  const q = (s) => JSON.stringify(s);
  if (tab === 'node') {
    return `// ${t('api.cmtNode')}
const res = await fetch('${url}', {
  method: 'POST',
  headers: {
    Authorization: \`Bearer \${process.env.ANTS_API_KEY}\`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    from: '${SANDBOX_CALLER_E164}',
    to: '${TO_SAMPLE}', // ${cTo}
    say: ${q(say)},
    language: '${voice}',
    webhook_url: '${ctx.state.api.webhook}',
  }),
});
console.log(res.status, await res.json()); // 201 { id: 'call_…', status: 'queued' }`;
  }
  if (tab === 'python') {
    return `import os, requests

r = requests.post(
    "${url}",
    headers={"Authorization": f"Bearer {os.environ['ANTS_API_KEY']}"},
    json={
        "from": "${SANDBOX_CALLER_E164}",
        "to": "${TO_SAMPLE}",  # ${cTo}
        "say": ${q(say)},
        "language": "${voice}",
        "webhook_url": "${ctx.state.api.webhook}",
    },
    timeout=10,
)
print(r.status_code, r.json())  # 201 {'id': 'call_…', 'status': 'queued'}`;
  }
  if (tab === 'php') {
    return `<?php
$ch = curl_init('${url}');
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_HTTPHEADER => [
    'Authorization: Bearer ' . getenv('ANTS_API_KEY'),
    'Content-Type: application/json',
  ],
  CURLOPT_POSTFIELDS => json_encode([
    'from' => '${SANDBOX_CALLER_E164}',
    'to' => '${TO_SAMPLE}', // ${cTo}
    'say' => ${q(say)},
    'language' => '${voice}',
    'webhook_url' => '${ctx.state.api.webhook}',
  ], JSON_UNESCAPED_UNICODE),
]);
echo curl_exec($ch); // 201 {"id":"call_…","status":"queued"}`;
  }
  return `# ${t('api.cmtCurl')}
curl -X POST ${url} \\
  -H "Authorization: Bearer $ANTS_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "from": "${SANDBOX_CALLER_E164}",
    "to": "${TO_SAMPLE}",
    "say": ${q(say)},
    "language": "${voice}",
    "webhook_url": "${ctx.state.api.webhook}"
  }'`;
}

// ---------- page pieces ----------
function header(ctx) {
  const { t, html: h } = ctx;
  return h`<div class="page-head"><div class="titles"><h1>${t('title')}${ctx.pageHelp()}</h1><span class="sub">${t('sub')}</span></div></div>`;
}

function cards(ctx, sel) {
  const { t, html: h, icon, fmt } = ctx;
  const cc = connectCall(ctx);
  const api = ctx.state.api;
  const hasKey = !!(api.keyId || existingSandboxKey(ctx));
  return h`<div class="grid g-2 cn-cards">
    <section class="card cn-card ${sel === 'api' ? 'is-sel' : ''}" aria-labelledby="cn-a-h">
      <div class="cn-card-top"><span class="cn-ico">${icon('code')}</span>
        <h2 id="cn-a-h"><a href="#/connect/api" data-action="cn.card.api" ${raw(sel === 'api' ? 'aria-current="page"' : '')}>${t('a.title')}</a></h2><span class="chip chip-brand">${t('a.rec')}</span></div>
      <p class="hint">${t('a.sub')}</p>
      <div class="row-tight hint-xs"><span class="dot ${cc ? 'dot-ok' : ''}"></span>${cc ? t('api.statusFirst', { time: fmt.time(cc.ts), status: t(`status.${cc.status}`) }) : t('api.statusNone')}</div>
      <div class="row">${sel === 'api'
        ? h`<a class="btn btn-sm" href="#/connect/api?focus=key" data-action="cn.card.api.key">${icon(hasKey ? 'key' : 'plus')}${hasKey ? t('a.ctaKey') : t('api.create')}</a>`
        : h`<a class="btn btn-sm" href="#/connect/api" data-action="cn.card.api.use">${t('a.use')}</a>`}</div>
    </section>
    <section class="card cn-card ${sel === 'sip' ? 'is-sel' : ''}" aria-labelledby="cn-b-h">
      <div class="cn-card-top"><span class="cn-ico">${icon('server')}</span>
        <h2 id="cn-b-h"><a href="#/connect/sip" data-action="cn.card.sip" ${raw(sel === 'sip' ? 'aria-current="page"' : '')}>${ctx.term(t('b.title'), 'sip_trunk')}</a></h2></div>
      <p class="hint">${t('b.sub')}</p>
      <p class="hint-xs">${t('b.price', { trunk: fmt.int(PRICES.trunkMonthly), included: PRICES.trunkIncludedCalls, extra: fmt.int(PRICES.extraConcurrentCall) })}</p>
      <div class="row">${sel === 'sip' ? '' : h`<a class="btn btn-sm" href="#/connect/sip" data-action="cn.sip.create">${icon('plus')}${t('b.create')}</a>`}
        <a class="linkbtn" href="#/help/article/pbx-freepbx" data-action="cn.sip.guide">${icon('book', 'ico-sm')}${t('b.guides')}</a></div>
    </section></div>`;
}

// ---------- Card A: HTTP API quickstart ----------
function apiPanel(ctx) {
  const { t, html: h, icon, fmt } = ctx;
  const a = ctx.state.api;
  const existing = existingSandboxKey(ctx);
  const created = a.keyId ? ctx.list('apiKeys').find((k) => k.id === a.keyId) : null;
  const key = created || existing;
  const cc = connectCall(ctx);
  const last = !cc && isActive() ? lastApiCall(ctx) : null;
  const liveLocked = firstRun(ctx);
  const stepDone = [!!key, !!cc, false];
  const num = (i) => h`<span class="stepnum ${stepDone[i] ? 'is-done' : ''}">${stepDone[i] ? icon('check', 'ico-xs') : i + 1}</span>`;
  const status = cc
    ? h`<span class="dot dot-ok"></span><strong>${t('api.statusFirst', { time: fmt.time(cc.ts), status: t(`status.${cc.status}`) })}</strong>`
    : last ? h`<span class="dot dot-ok"></span><strong>${t('api.statusLast', { time: fmt.time(last.ts), status: t(`status.${last.status}`), name: last.source.ref })}</strong>`
      : h`<span class="dot"></span><strong>${t('api.statusNone')}</strong>`;

  const keyBlock = () => {
    if (a.shownKey && !a.saved) {
      return h`<div class="note note-ok cn-shown" role="status">${icon('key')}<div class="grow stack" style="gap:6px">
        <strong>${t('api.shownTitle')}</strong>
        <div class="input-group"><code class="code-inline mono grow" translate="no" id="cn-key">${a.shownKey}</code>
          <button type="button" class="btn btn-sm" data-action="cn.api.copykey">${icon('copy', 'ico-sm')}${t('common.copy')}</button></div>
        <span class="hint-xs">${t('api.shownHint')}</span>
        <div><button type="button" class="btn btn-sm btn-navy" data-action="cn.api.saved">${icon('check')}${t('api.saved')}</button></div></div></div>`;
    }
    if (created) {
      return h`<div class="row-tight cn-keyline">${icon('check-circle', 'ico-sm')}<span>${t('api.keyReady', { name: created.name })}</span><code class="mono" translate="no">${maskKey(created.prefix, created.last4)}</code></div>`;
    }
    return '';
  };

  return h`<section class="card cn-api" aria-labelledby="cn-api-h">
    <div class="card-head"><h2 id="cn-api-h" class="row-tight cn-status" aria-live="polite">${status}</h2>
      <button type="button" class="btn btn-sm" data-action="cn.api.status.refresh" ${raw(a.statusBusy ? 'aria-busy="true"' : '')}>${a.statusBusy ? raw('<span class="spin" aria-hidden="true"></span>') : icon('refresh', 'ico-sm')}${t('api.refresh')}</button>
      <button type="button" class="btn btn-sm btn-ghost" data-action="cn.api.reset">${t('api.reset')}</button></div>

    <div class="cn-step"><div class="cn-step-h">${num(0)}<div><h3>${t('api.s1')}</h3><p class="hint">${t('api.s1h')}</p></div></div>
      ${existing && !created ? h`<p class="hint-xs cn-existing">${t('api.existing', { name: existing.name, masked: maskKey(existing.prefix, existing.last4), date: fmt.dateProse(existing.createdAt) })}</p>` : ''}
      ${a.shownKey && !a.saved ? '' : h`<div class="cn-keyform">
        <label class="field"><span class="label">${t('api.keyName')}</span>
          <input class="input mono" id="cn-keyname" data-field="keyName" value="${keyNameOf(ctx)}" autocomplete="off" spellcheck="false" translate="no" maxlength="32" aria-invalid="${a.keyErr ? 'true' : 'false'}" aria-describedby="cn-keyname-err">
          ${a.keyErr ? h`<span class="field-err" id="cn-keyname-err">${a.keyErr}</span>` : h`<span class="hint-xs" id="cn-keyname-err">${t('api.keyNameHint')}</span>`}</label>
        <label class="field"><span class="label">${ctx.term(t('api.scope'), 'scope')}</span>
          <select class="select" data-field="scope" aria-label="${t('api.scope')}">${Object.keys(SCOPES).map((s) => h`<option value="${s}" ${raw(a.scope === s ? 'selected' : '')}>${t(`api.scope.${s}`)}</option>`)}</select></label>
        <div class="field"><span class="label">${ctx.term(t('api.env'), 'env')}</span>
          <div class="seg" role="group" aria-label="${t('api.env')}">
            <button type="button" data-action="cn.api.env" data-value="sandbox" aria-pressed="${a.env === 'sandbox'}">${t('top.sandbox')}</button>
            <button type="button" data-action="cn.api.env" data-value="live" aria-pressed="${a.env === 'live'}" ${raw(liveLocked ? 'aria-disabled="true"' : '')} aria-describedby="cn-env-help">${t('top.live')}</button></div>
          ${liveLocked ? h`<span class="hint-xs" id="cn-env-help">${t('api.liveLocked')}</span>` : ''}</div>
      </div>
      <div><button type="button" class="btn btn-navy" data-action="cn.api.create" ${raw(a.busy ? 'aria-busy="true"' : '')}>${a.busy ? raw('<span class="spin" aria-hidden="true"></span>') : icon('plus')}${t('api.create')}</button></div>`}
      ${keyBlock()}
    </div>

    <div class="cn-step"><div class="cn-step-h">${num(1)}<div class="grow"><h3>${t('api.s2')}</h3><p class="hint">${t('api.s2h')}</p></div></div>
      <div class="row cn-tabs-row"><div class="seg" role="tablist" aria-label="${t('api.codeAria')}">${TABS.map((tb) => h`<button type="button" role="tab" id="cn-tab-${tb}" aria-controls="cn-code" data-action="cn.api.tab.${tb}" aria-selected="${a.tab === tb}" tabindex="${a.tab === tb ? 0 : -1}">${t(`api.tab.${tb}`)}</button>`)}</div>
        <button type="button" class="btn btn-sm" data-action="cn.api.copycode">${icon('copy', 'ico-sm')}${t('common.copy')}</button></div>
      <p class="hint-xs cn-sample">${icon('info', 'ico-xs')} ${t('api.sampleEndpoint')}</p>
      <pre class="code" id="cn-code" role="tabpanel" aria-labelledby="cn-tab-${a.tab}" translate="no" tabindex="0">${codeSample(ctx, a.tab)}</pre>
      <p class="hint-xs mono" translate="no">${t('api.response')} 201 Created {"id": "call_01JB…", "status": "queued"}</p>
      <div class="row"><button type="button" class="btn btn-primary" data-action="cn.api.send" data-tour="test-call-alt">${icon('phone')}${t('api.send')}</button><span class="hint-xs">${t('api.sendHint')}</span></div>
    </div>

    <div class="cn-step"><div class="cn-step-h">${num(2)}<div class="grow"><h3>${t('api.s3')}</h3><p class="hint">${t('api.s3h')}</p></div>
      <div class="stack" style="gap:4px;align-items:flex-end"><a class="btn" href="${cc ? `#/logs?call=${cc.id}` : '#'}" data-action="cn.api.logs" ${raw(cc ? '' : 'aria-disabled="true" aria-describedby="cn-logs-help"')}>${icon('list')}${t('api.openLogs')}</a>
      ${cc ? '' : h`<span class="hint-xs" id="cn-logs-help">${t('api.logsFirst')}</span>`}</div></div></div>
  </section>`;
}

function apiSide(ctx) {
  const { t, html: h, icon, fmt } = ctx;
  const a = ctx.state.api;
  const created = a.keyId ? ctx.list('apiKeys').find((k) => k.id === a.keyId) : existingSandboxKey(ctx);
  const auth = `Authorization: Bearer ${created ? maskKey(created.prefix, created.last4) : '$ANTS_API_KEY'}`;
  return h`<aside class="card card-pad cn-side stack">
    <label class="field"><span class="label">${t('api.base')}</span>
      <div class="input-group"><input class="input mono" readonly value="${API_BASE}" translate="no" aria-label="${t('api.base')}">
      <button type="button" class="copybtn" data-action="cn.api.copy.base" aria-label="${t('api.copyBase')}" data-tip-key="connect.api.copyBase">${icon('copy', 'ico-sm')}</button></div></label>
    <label class="field"><span class="label">${t('api.auth')}</span>
      <div class="input-group"><input class="input mono" readonly value="${auth}" translate="no" aria-label="${t('api.auth')}">
      <button type="button" class="copybtn" data-action="cn.api.copy.auth" aria-label="${t('api.copyAuth')}" data-tip-key="connect.api.copyAuth">${icon('copy', 'ico-sm')}</button></div></label>
    <label class="field"><span class="label">${ctx.term(t('api.webhook'), 'webhook')}</span>
      <input class="input mono" data-field="webhook" value="${a.webhook}" inputmode="url" spellcheck="false" translate="no" aria-label="${t('api.webhook')}"></label>
    <p class="hint-xs">${t('api.whHint')}</p>
    <div><button type="button" class="btn btn-sm" data-action="cn.api.sendevent">${icon('send', 'ico-sm')}${t('api.sendEvent')}</button></div>
    <hr class="divider">
    <div class="stack" style="gap:6px">
      <span class="label">${t('prices.title')} <span class="chip chip-warn" tabindex="0" data-tip-key="common.plannedPricesTip">${t('common.plannedPrices')}</span></span>
      <p class="hint-xs">${t('prices.line', { out: fmt.rate(PRICES.outbound), inb: fmt.rate(PRICES.inbound), otp: fmt.rate(PRICES.otpPerAnsweredCall), number: fmt.int(PRICES.number) })}</p>
      <p class="hint-xs">${t('prices.plans', { min: fmt.int(PRICES.plans[0].minMinutes) })}</p>
      <a class="linkbtn" href="#/billing?section=prices" data-action="cn.api.prices">${t('prices.all')}</a>
    </div>
    <hr class="divider">
    <p class="hint-xs cn-data">${icon('shield', 'ico-xs')} ${t('dataNote')}</p>
  </aside>`;
}

// ---------- Card B: SIP trunk wizard ----------
function wzCircles(ctx) {
  const { t, html: h, icon } = ctx;
  const w = ctx.state.wz;
  return h`<ol class="wz-steps" aria-label="${t('wz.stepsAria')}">${Array.from({ length: STEPS }, (_, i) => {
    const n = i + 1;
    const state = n <= w.done && n !== w.step ? 'done' : n === w.step ? 'current' : 'todo';
    const reachable = n <= w.done + 1;
    return h`<li><button type="button" class="wz-step is-${state}" data-action="wz.step" data-value="${n}" ${raw(n === w.step ? 'aria-current="step"' : '')} ${raw(reachable ? '' : 'aria-disabled="true"')}>
      <span class="wz-circ">${state === 'done' ? icon('check', 'ico-xs') : n}</span><span class="wz-lbl">${t(`wz.s${n}`)}</span>
      ${reachable ? '' : h`<span class="sr-only"> · ${t('wz.finishFirst', { n: w.done + 1 })}</span>`}</button></li>`;
  })}</ol>`;
}

function wzStep1(ctx) {
  const { t, html: h, icon, fmt } = ctx;
  const w = ctx.state.wz;
  const est = estimateMonthly({ minutes: w.minutes, concurrent: w.concurrent, numbers: 0, trunk: true });
  const extra = est.trunk.extra;
  const p50 = PRICES.plans[0];
  const breakEven = planBreakEven(p50);
  const plans = est.plans;
  let planLine = '';
  if (plans.contactSales) {
    planLine = h`<div class="note note-info">${icon('info')}<div class="grow">${t('wz.1.custom', { min: fmt.int(PRICES.plansContactSalesFrom) })} <button type="button" class="linkbtn" data-action="wz.1.contact">${t('wz.1.contactSales')}</button></div></div>`;
  } else if (w.minutes >= breakEven && plans.suggestPlan) {
    const sp = plans.suggestPlan;
    planLine = h`<div class="note note-brand">${icon('coin')}<div class="grow stack" style="gap:4px">
      <span>${t('wz.1.planLine', { min: fmt.int(sp.plan.minMinutes), rate: fmt.rate(sp.rate), cost: fmt.int(sp.cost), payg: fmt.int(est.minuteCost) })}</span>
      <span class="hint-xs">${t('wz.1.planTerms', { months: PRICES.planMonths })}</span>
      <div><button type="button" class="btn btn-sm" data-action="wz.1.plan" data-value="${sp.id}">${t('wz.1.requestPlan')}</button></div></div></div>`;
  }
  return h`<div class="wz-grid">
    <div class="stack-4">
      <div class="field"><span class="label">${ctx.term(t('wz.1.cc'), 'concurrent')}</span>
        <div class="row"><div class="stepper"><button type="button" data-action="wz.1.minus" aria-label="${t('wz.1.minus')}" ${raw(w.concurrent <= 1 ? 'aria-disabled="true"' : '')}>${icon('minus', 'ico-sm')}</button>
          <output aria-live="polite" aria-label="${t('wz.1.cc')}">${w.concurrent}</output>
          <button type="button" data-action="wz.1.plus" aria-label="${t('wz.1.plus')}" ${raw(w.concurrent >= 100 ? 'aria-disabled="true"' : '')}>${icon('plus', 'ico-sm')}</button></div>
          <span class="hint-xs">${extra ? t('wz.1.ccExtra', { included: PRICES.trunkIncludedCalls, extra, fee: fmt.int(PRICES.extraConcurrentCall), total: fmt.int(est.trunk.extraCost) }) : t('wz.1.ccIncluded', { included: PRICES.trunkIncludedCalls, fee: fmt.int(PRICES.extraConcurrentCall) })}</span></div>
        <span class="hint-xs">${t('wz.1.sameRates')}</span></div>
      <div class="field"><span class="label">${ctx.term(t('wz.1.cps'), 'cps')}</span>
        <div class="row"><div class="stepper"><button type="button" data-action="wz.1.cps" data-value="-1" aria-label="${t('wz.1.cpsLess')}" ${raw(w.cps <= 1 ? 'aria-disabled="true"' : '')}>${icon('minus', 'ico-sm')}</button>
          <output aria-live="polite">${w.cps}</output>
          <button type="button" data-action="wz.1.cps" data-value="1" aria-label="${t('wz.1.cpsMore')}" ${raw(w.cps >= 10 ? 'aria-disabled="true"' : '')}>${icon('plus', 'ico-sm')}</button></div>
          <span class="hint-xs">${t('wz.1.cpsHint', { def: PRICES.cpsDefault, max: 10 })}</span></div></div>
      <label class="field"><span class="label">${t('wz.1.minutes')}</span>
        <div class="row" style="flex-wrap:nowrap"><input type="range" class="grow" min="0" max="250000" step="1000" value="${w.minutes}" data-field="minutes" aria-valuetext="${fmt.int(w.minutes)}">
        <output class="mono nowrap cn-min-out" data-minutes-out>${fmt.int(w.minutes)}</output></div>
        <span class="hint-xs">${t('wz.1.minutesHint')}</span></label>
      <a class="linkbtn" href="#/help/contact?topic=sales" data-action="wz.1.sales">${t('wz.1.salesLink')}</a>
    </div>
    <div class="card card-sunken card-pad cn-est" aria-live="polite">
      <div class="row" style="justify-content:space-between"><strong>${t('wz.1.estimate')}</strong><span class="chip chip-warn" tabindex="0" data-tip-key="common.plannedPricesTip">${t('common.plannedPrices')}</span></div>
      <div class="kv"><span class="k">${ctx.term(t('wz.1.estTrunk'), 'sip_trunk')}</span><span class="v">${fmt.int(est.trunk.base)}</span></div>
      <div class="kv"><span class="k">${t('wz.1.estExtra', { n: extra, fee: fmt.int(PRICES.extraConcurrentCall) })}</span><span class="v">${fmt.int(est.trunk.extraCost)}</span></div>
      <div class="kv"><span class="k">${t('wz.1.estMin', { min: fmt.int(w.minutes), rate: fmt.rate(PRICES.outbound) })}</span><span class="v">${fmt.int(est.minuteCost)}</span></div>
      <div class="kv kv-total"><span class="k">${t('wz.1.total')}</span><span class="v">${fmt.int(est.total)}</span></div>
      <p class="hint-xs">${t('wz.1.payg')}</p>
      ${planLine}
      <p class="hint-xs">${t('wz.1.noSetup', { trunk: fmt.int(PRICES.trunkMonthly) })}</p>
    </div></div>`;
}

function wzStep2(ctx) {
  const { t, html: h, icon } = ctx;
  const w = ctx.state.wz;
  const needIps = w.auth !== 'credentials';
  return h`<div class="wz-grid">
    <div class="stack-4">
      <label class="field"><span class="label">${t('wz.2.name')}</span>
        <input class="input mono" id="wz-name" data-field="wzName" value="${w.name}" maxlength="32" spellcheck="false" translate="no" aria-invalid="${w.nameErr ? 'true' : 'false'}" aria-describedby="wz-name-h">
        ${w.nameErr ? h`<span class="field-err" id="wz-name-h">${w.nameErr}</span>` : h`<span class="hint-xs" id="wz-name-h">${t('wz.2.nameHint')}</span>`}</label>
      <div class="field"><span class="label">${ctx.term(t('wz.2.pbx'), 'pbx')}</span>
        <div class="seg" role="group" aria-label="${t('wz.2.pbx')}">${Object.keys(PBX).map((k) => h`<button type="button" data-action="wz.2.pbx" data-value="${k}" aria-pressed="${w.pbx === k}">${k === 'generic' ? t('wz.2.generic') : PBX[k]}</button>`)}</div></div>
      <div class="field"><span class="label">${t('wz.2.auth')}</span>
        <div class="grid g-3 wz-auth" role="radiogroup" aria-label="${t('wz.2.auth')}">${['ip', 'credentials', 'both'].map((k) => h`<button type="button" class="optcard" role="radio" data-action="wz.2.auth" data-value="${k}" aria-checked="${w.auth === k}"><span class="t">${t(`wz.2.auth.${k}`)}</span><span class="h">${t(`wz.2.auth.${k}H`)}</span></button>`)}</div></div>
      ${needIps ? h`<div class="field"><span class="label">${ctx.term(t('wz.2.ips'), 'ip_allow')}</span>
        <div class="tbl-wrap card"><table class="tbl"><thead><tr><th>${t('wz.2.ipCol')}</th><th>${t('wz.2.label')}</th><th><span class="sr-only">${t('wz.2.remove')}</span></th></tr></thead>
        <tbody>${w.ips.length ? w.ips.map((r, i) => h`<tr><td class="mono" translate="no">${r.ip}</td>
          <td><input class="input input-sm" data-field="ipLabel" data-index="${i}" value="${r.label}" aria-label="${t('wz.2.labelFor', { ip: r.ip })}"></td>
          <td class="num"><button type="button" class="btn btn-ghost btn-sm" data-action="wz.2.ip.remove" data-value="${i}">${t('wz.2.remove')}</button></td></tr>`)
          : h`<tr><td colspan="3" class="hint">${t('wz.2.noIps')}</td></tr>`}
        </tbody></table>
        <div class="wz-addip"><input class="input mono grow" data-field="ipInput" value="${w.ipInput}" placeholder="${t('wz.2.ipPh')}" aria-label="${t('wz.2.ipCol')}" aria-invalid="${w.ipErr ? 'true' : 'false'}" aria-describedby="wz-ip-err" translate="no" ${raw(w.ips.length >= 10 ? 'disabled' : '')}>
          <button type="button" class="btn btn-sm" data-action="wz.2.ip.add" ${raw(w.ips.length >= 10 ? 'aria-disabled="true"' : '')}>${icon('plus', 'ico-sm')}${t('wz.2.addIp')}</button></div></div>
        ${w.ipErr ? h`<span class="field-err" id="wz-ip-err">${w.ipErr}</span>` : h`<span class="hint-xs" id="wz-ip-err">${t('wz.2.ipHint')}</span>`}</div>` : ''}
    </div>
    <div class="stack-4">
      <div class="field"><span class="label">${t('wz.2.transport')}</span>
        <div class="seg" role="group" aria-label="${t('wz.2.transport')}">${Object.keys(TRANSPORT).map((k) => h`<button type="button" data-action="wz.2.transport" data-value="${k}" aria-pressed="${w.transport === k}">${TRANSPORT[k]}</button>`)}</div>
        ${w.transport === 'tls' ? '' : h`<span class="hint-xs warn-text">${t('wz.2.tlsAdvice')}</span>`}</div>
      <div class="card card-pad row" style="flex-wrap:nowrap">
        <div class="grow"><strong id="wz-srtp-l">${ctx.term(t('wz.2.srtp'), 'srtp')}</strong><div class="hint-xs" id="wz-srtp-h">${w.transport !== 'tls' ? t('wz.2.srtpNeedsTls') : w.srtp ? t('wz.2.srtpOn') : t('wz.2.srtpOff')}</div></div>
        <button type="button" class="toggle" role="switch" data-action="wz.2.srtp" aria-checked="${w.transport === 'tls' && w.srtp}" aria-labelledby="wz-srtp-l" aria-describedby="wz-srtp-h" ${raw(w.transport !== 'tls' ? 'aria-disabled="true"' : '')}></button></div>
      <div class="wkv"><span class="hint">${ctx.term(t('wz.2.codec'), 'codec')}</span><strong translate="no">G.711 A-law / μ-law</strong><span class="hint-xs">${t('wz.2.fixed')}</span></div>
      <div class="wkv"><span class="hint">${ctx.term(t('wz.2.dtmf'), 'dtmf')}</span><strong translate="no">RFC 2833</strong><span class="hint-xs">${t('wz.2.fixed')}</span></div>
      <div class="wkv"><span class="hint">${t('wz.1.cc')}</span><strong class="tnum">${w.concurrent}</strong><span class="hint-xs">${t('wz.2.fromStep1')}</span></div>
      <div class="wkv"><span class="hint">${t('wz.1.cps')}</span><strong class="tnum">${w.cps}</strong><span class="hint-xs">${t('wz.2.fromStep1')}</span></div>
    </div></div>`;
}

function configRows(ctx) {
  const w = ctx.state.wz;
  const { t } = ctx;
  const rows = [
    { k: 'domain', label: t('wz.3.domain'), v: SIP_HOST },
    { k: 'sig', label: t('wz.3.sig'), v: SIGNALLING_IPS.join(', ') },
    { k: 'ports', label: t('wz.3.ports'), v: PORTS },
    { k: 'media', label: t('wz.3.media'), v: `${MEDIA_IPS} · ${MEDIA_PORTS}` },
    { k: 'codec', label: t('wz.2.codec'), v: 'PCMA (G.711 A-law), PCMU (G.711 μ-law)' },
    { k: 'dtmf', label: t('wz.2.dtmf'), v: 'RFC 2833 · telephone-event/8000' },
    { k: 'e164', label: t('wz.3.e164'), v: 'E.164 · +662xxx1234' },
    { k: 'transport', label: t('wz.2.transport'), v: `${TRANSPORT[w.transport]}${w.transport === 'tls' && w.srtp ? ' · SRTP' : ''}` },
  ];
  if (w.auth !== 'ip') rows.push({ k: 'user', label: t('wz.3.user'), v: `trk_${w.name.replace(/-/g, '_')}_DEMO` });
  return rows;
}

function wzStep3(ctx) {
  const { t, html: h, icon } = ctx;
  const w = ctx.state.wz;
  const rows = configRows(ctx);
  const left = w.reveal === 'shown' ? Math.max(0, 30 - Math.floor((Date.now() - w.revealAt) / 1000)) : 0;
  return h`<div class="wz-grid wz-grid-wide">
    <div class="card cn-cfg">${rows.map((r) => h`<div class="wkv"><span class="hint">${r.label}</span><strong class="mono" translate="no">${r.v}</strong>
      <button type="button" class="copybtn" data-action="wz.3.copy" data-value="${r.k}" aria-label="${t('wz.3.copyRow', { what: r.label })}" data-tip-key="common.copy">${icon('copy', 'ico-sm')}</button></div>`)}
      ${w.auth !== 'ip' ? h`<div class="wkv"><span class="hint">${t('wz.3.pass')}</span>
        <strong class="mono" translate="no">${w.reveal === 'shown' ? DEMO_SIP_PASSWORD : '••••••••••••••••'}</strong>
        ${w.reveal === 'hidden' ? h`<button type="button" class="btn btn-sm" data-action="wz.3.reveal">${icon('eye', 'ico-sm')}${t('wz.3.reveal')}</button>`
          : w.reveal === 'shown' ? h`<span class="hint-xs" data-reveal-left aria-live="polite">${t('wz.3.hidesIn', { n: left })}</span>`
            : h`<span class="hint-xs">${t('wz.3.revealed')}</span>`}</div>` : ''}
    </div>
    <div class="stack">
      <button type="button" class="btn btn-navy btn-block" data-action="wz.3.copyall">${icon('copy', 'ico-sm')}${t('wz.3.copyAll')}</button>
      <button type="button" class="btn btn-block" data-action="wz.3.download">${icon('download', 'ico-sm')}${t('wz.3.download', { pbx: w.pbx === 'generic' ? t('wz.2.generic') : PBX[w.pbx] })}</button>
      <button type="button" class="btn btn-block" data-action="wz.3.email">${icon('mail', 'ico-sm')}${t('wz.3.email')}</button>
      <p class="hint-xs">${t('wz.3.fix', { media: MEDIA_IPS, ports: MEDIA_PORTS })}</p>
      <a class="linkbtn" href="#/help/article/${PBX_GUIDE[w.pbx]}" data-action="wz.3.guide">${icon('book', 'ico-sm')}${t('wz.3.guide', { pbx: w.pbx === 'generic' ? 'FreePBX' : PBX[w.pbx] })}</a>
    </div></div>`;
}

function wzStep4(ctx) {
  const { t, html: h, icon, fmt } = ctx;
  const w = ctx.state.wz;
  const flows = ctx.list('flows');
  return h`<div class="wz-grid">
    <div class="stack-4">
      <div class="field"><span class="label">${ctx.term(t('wz.4.uris'), 'origination')}</span><span class="hint-xs">${t('wz.4.urisH')}</span>
        <div class="tbl-wrap card"><table class="tbl wz-uris"><thead><tr><th>URI</th><th class="num">${ctx.term(t('wz.4.prio'), 'priority_weight')}</th><th class="num">${t('wz.4.weight')}</th><th>${t('wz.4.on')}</th><th><span class="sr-only">${t('wz.2.remove')}</span></th></tr></thead>
        <tbody>${w.uris.map((u, i) => h`<tr>
          <td><input class="input input-sm mono" data-field="uri" data-index="${i}" value="${u.uri}" aria-label="${t('wz.4.uriN', { n: i + 1 })}" spellcheck="false" translate="no"></td>
          <td class="num"><input class="input input-sm mono wz-num" type="number" min="1" max="100" data-field="prio" data-index="${i}" value="${u.priority}" aria-label="${t('wz.4.prio')}"></td>
          <td class="num"><input class="input input-sm mono wz-num" type="number" min="1" max="100" data-field="weight" data-index="${i}" value="${u.weight}" aria-label="${t('wz.4.weight')}"></td>
          <td><button type="button" class="toggle" role="switch" data-action="wz.4.uri.toggle" data-value="${i}" aria-checked="${u.on}" aria-label="${t('wz.4.onFor', { n: i + 1 })}"></button></td>
          <td class="num"><button type="button" class="btn btn-ghost btn-sm btn-icon" data-action="wz.4.uri.remove" data-value="${i}" aria-label="${t('wz.2.remove')}" data-tip-key="connect.wz.2.remove" ${raw(w.uris.length <= 1 ? 'aria-disabled="true"' : '')}>${icon('x', 'ico-sm')}</button></td></tr>`)}</tbody></table>
        <div class="wz-addip"><button type="button" class="btn btn-sm" data-action="wz.4.uri.add" ${raw(w.uris.length >= 3 ? 'aria-disabled="true"' : '')}>${icon('plus', 'ico-sm')}${t('wz.4.add')}</button><span class="hint-xs">${t('wz.4.max', { n: 3 })}</span></div></div>
        ${w.uriErr ? h`<span class="field-err">${w.uriErr}</span>` : ''}</div>
      <label class="field"><span class="label">${ctx.term(t('wz.4.failover'), 'failover')}</span>
        <select class="select" data-field="failover" aria-label="${t('wz.4.failover')}" style="max-width:220px">${[2, 4, 8].map((s) => h`<option value="${s}" ${raw(w.failover === s ? 'selected' : '')}>${t('common.seconds', { n: s })}</option>`)}</select></label>
      <fieldset class="field"><legend class="label">${t('wz.4.allDown')}</legend>
        <div class="row">${['message', 'forward', 'hangup'].map((k) => h`<label class="radio optcard wz-radio"><input type="radio" name="wz-fb" value="${k}" data-field="fallback" ${raw(w.fallback === k ? 'checked' : '')}>${t(`wz.4.fb.${k}`)}</label>`)}</div>
        ${w.fallback === 'message' ? h`<select class="select" data-field="fallbackFlow" aria-label="${t('wz.4.fbFlow')}" style="max-width:280px">${flows.length ? flows.map((f) => h`<option value="${f.id}" ${raw(w.fallbackFlow === f.id ? 'selected' : '')}>${ctx.loc(f.name)}</option>`) : h`<option value="default">${t('wz.4.fbDefault')}</option>`}</select>` : ''}
        ${w.fallback === 'forward' ? h`<input class="input" data-field="forwardTo" value="${w.forwardTo}" placeholder="081-xxx-1234" inputmode="tel" aria-label="${t('wz.4.fbNumber')}" style="max-width:280px" translate="no">` : ''}</fieldset>
    </div>
    <div class="stack-4">
      <div class="field"><span class="label">${t('wz.4.numbers')}</span>
        <div class="wz-chips">${w.attached.map((n) => h`<span class="chip chip-navy" translate="no">${n}<button type="button" class="chip-x" data-action="wz.4.detach" data-value="${n}" aria-label="${t('wz.4.detach', { number: n })}">${icon('x', 'ico-xs')}</button></span>`)}
          <button type="button" class="btn btn-sm" data-action="wz.4.attach">${icon('plus', 'ico-sm')}${t('wz.4.attach')}</button></div>
        <a class="linkbtn" href="#/numbers/buy?return=connect" data-action="wz.4.buy">${t('wz.4.buy', { price: fmt.int(PRICES.number) })}</a></div>
      <fieldset class="field"><legend class="label">${ctx.term(t('wz.4.cid'), 'caller_id')}</legend>
        ${['attached', 'loa', 'list'].map((k) => h`<label class="radio optcard wz-radio-block"><input type="radio" name="wz-cid" value="${k}" data-field="cid" ${raw(w.cid === k ? 'checked' : '')}><span>${t(`wz.4.cid.${k}`)}</span></label>`)}
        ${w.cid === 'loa' ? h`<a class="linkbtn" href="#/help/article/loa-caller-id" data-action="wz.4.loa">${t('wz.4.loaHelp')}</a>` : ''}</fieldset>
    </div></div>`;
}

const CHECK_ICON = { ok: 'check', fail: 'x', run: null, na: 'minus', idle: null };
function checkRow(ctx, key, title, detail, extra = '') {
  const { html: h, icon, t } = ctx;
  const st = ctx.state.wz.checks[key];
  // The check is drawn (240 ms) only right after it passes; later re-renders show it static.
  const fresh = ctx.state.wz.at[key] && nowMs() - ctx.state.wz.at[key] < 700;
  const badge = st === 'run' ? raw('<span class="spin" aria-hidden="true"></span>') : st === 'ok' ? raw(`<svg class="ico ico-sm ${fresh ? 'check-draw' : ''}" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>`) : CHECK_ICON[st] ? icon(CHECK_ICON[st], 'ico-sm') : raw('<span class="dot"></span>');
  return h`<li class="wz-check is-${st}"><span class="wz-badge">${badge}</span>
    <div class="grow"><strong>${title}</strong><div class="hint-xs">${st === 'run' ? t('wz.5.checking') : detail}</div></div>${extra}</li>`;
}

function wzStep5(ctx) {
  const { t, html: h, icon, fmt } = ctx;
  const w = ctx.state.wz;
  const c = w.checks;
  const at = (k) => (w.at[k] ? fmt.time(w.at[k]) : '');
  const ip = w.auth === 'credentials' ? '198.51.100.60' : (w.ips[0] ? w.ips[0].ip.split('/')[0] : '198.51.100.60');
  const canActivate = c.options === 'ok' && (c.inbound === 'ok' || c.outbound === 'ok');
  return h`<div class="wz-grid wz-grid-wide">
    <div class="stack">
      <ol class="card wz-checks">
        ${checkRow(ctx, 'options', t('wz.5.options'), c.options === 'ok' ? t('wz.5.optionsOk', { time: at('options'), ms: 12 }) : t('wz.5.optionsWait'))}
        ${checkRow(ctx, 'reg', t('wz.5.reg'), c.reg === 'na' ? t('wz.5.regNa') : c.reg === 'ok' ? t('wz.5.regOk', { time: at('reg') }) : t('wz.5.waiting'))}
        ${checkRow(ctx, 'tls', t('wz.5.tls'), c.tls === 'na' ? t('wz.5.tlsNa', { transport: TRANSPORT[w.transport] }) : c.tls === 'ok' ? (w.srtp ? 'TLS 1.3 · SRTP AES_CM_128_HMAC_SHA1_80' : 'TLS 1.3') : t('wz.5.waiting'))}
        ${checkRow(ctx, 'inbound', t('wz.5.inbound'), c.inbound === 'ok' ? t('wz.5.inboundOk', { time: at('inbound') }) : c.inbound === 'fail' ? t('wz.5.noAudio', { media: MEDIA_IPS, ports: MEDIA_PORTS }) : t('wz.5.inboundH'),
          c.inbound === 'fail' ? h`<button type="button" class="btn btn-sm" data-action="wz.5.retry">${icon('refresh', 'ico-sm')}${t('common.retry')}</button>`
            : c.inbound === 'ok' || c.inbound === 'run' ? '' : h`<button type="button" class="btn btn-sm" data-action="wz.5.inbound" ${raw(c.options === 'ok' ? '' : 'aria-disabled="true"')}>${icon('phone-in', 'ico-sm')}${t('wz.5.inboundBtn')}</button>`)}
        ${checkRow(ctx, 'outbound', t('wz.5.outbound'), c.outbound === 'ok' ? t('wz.5.outboundOk', { time: at('outbound') }) : t('wz.5.outboundH'),
          c.outbound === 'ok' || c.outbound === 'run' ? '' : h`<button type="button" class="linkbtn" data-action="wz.5.outbound" ${raw(c.options === 'ok' ? '' : 'aria-disabled="true"')}>${t('wz.5.simulateOut')} <span class="chip chip-navy">${t('common.demoTag')}</span></button>`)}
      </ol>
      ${c.options === 'ok' ? h`<p class="hint-xs row-tight" aria-hidden="true"><span class="dot dot-ok dot-live"></span><span data-heartbeat>${t('wz.5.heartbeat', { ip, n: 0 })}</span></p>` : ''}
      <div><button type="button" class="linkbtn" data-action="wz.5.fail" ${raw(c.inbound === 'run' ? 'aria-disabled="true"' : '')}>${t('wz.5.simulateFail')} <span class="chip chip-navy">${t('common.demoTag')}</span></button></div>
    </div>
    <div class="card card-sunken card-pad stack">
      <p class="hint-xs">${t('wz.3.fix', { media: MEDIA_IPS, ports: MEDIA_PORTS })}</p>
      <p class="hint-xs">${t('wz.5.activateRule')}</p>
      <button type="button" class="btn btn-primary btn-block wz-activate ${canActivate ? 'is-ready' : ''}" data-action="wz.5.activate" ${raw(canActivate ? '' : 'aria-disabled="true" aria-describedby="wz-act-h"')}>${icon('check')}${t('wz.5.activate')}</button>
      <span class="hint-xs" id="wz-act-h">${canActivate ? t('wz.5.ready') : c.options === 'ok' ? t('wz.5.optionsPassed') : t('wz.5.activateH')}</span>
      <span class="sr-only" aria-live="polite">${w.live}</span>
    </div></div>`;
}

function wizard(ctx) {
  const { t, html: h, icon } = ctx;
  const w = ctx.state.wz;
  const body = [null, wzStep1, wzStep2, wzStep3, wzStep4, wzStep5][w.step](ctx);
  return h`<section class="card cn-wz" aria-labelledby="wz-h">
    <div class="card-head"><h2 id="wz-h" tabindex="-1">${t('b.title')} <span class="hint">· ${t('wz.stepOf', { n: w.step, total: STEPS })}<span class="wz-cur"> · ${t(`wz.s${w.step}`)}</span></span></h2>
      <button type="button" class="btn btn-sm" data-action="wz.saveexit">${icon('file', 'ico-sm')}${t('wz.saveExit')}</button>
      <button type="button" class="btn btn-sm btn-ghost" data-action="wz.close">${t('common.close')}</button></div>
    <div class="cn-wz-steps">${wzCircles(ctx)}</div>
    <div class="card-body">${body}</div>
    <div class="card-foot row" style="justify-content:space-between">
      <button type="button" class="btn" data-action="wz.back" ${raw(w.step === 1 ? 'aria-disabled="true"' : '')}>${icon('arrow-left', 'ico-sm')}${t('common.back')}</button>
      ${w.step < STEPS ? h`<button type="button" class="btn btn-navy" data-action="wz.next">${t('common.next')}${icon('arrow-right', 'ico-sm')}</button>` : ''}
    </div></section>`;
}

// ---------- continue a draft trunk: #/connect/sip?trunk=<name>[&step=<n>] ----------
const PBX_KEY = Object.fromEntries(Object.entries(PBX).map(([k, v]) => [v, k]));
function loadDraft(ctx) {
  const name = ctx.params.query.trunk;
  const key = `${name}|${ctx.params.query.step || ''}`;
  const w = ctx.state.wz;
  if (!name || w.loadedFrom === key) return;
  const tr = ctx.list('trunks').find((x) => x.name === name);
  if (!tr) return;
  const next = {
    ...freshWizard(), runId: w.runId + 1, loadedFrom: key, draftId: tr.id,
    name: tr.name, pbx: PBX_KEY[tr.pbx] || 'generic', auth: tr.auth || 'ip', transport: tr.transport || 'tls', srtp: tr.srtp !== false,
    ips: (tr.ips || []).map((ip, i) => ({ ip, label: (tr.ipLabels || [])[i] || '' })),
    uris: (tr.uris && tr.uris.length ? tr.uris : freshWizard().uris).map((u) => ({ uri: u.uri, priority: u.priority, weight: u.weight, on: u.on ?? u.status !== 'off' })),
    concurrent: tr.concurrent || PRICES.trunkIncludedCalls, cps: tr.cps || PRICES.cpsDefault, failover: tr.failoverSec || 4,
    fallback: tr.fallback || 'message', attached: tr.attached || [], cid: tr.cid || 'attached',
  };
  ctx.state.wz = next;
  // Open on the step asked for, otherwise on the first step that is not finished.
  const asked = Number(ctx.params.query.step);
  let step = asked >= 1 && asked <= STEPS ? asked : 0;
  if (!step) step = !validateStep(ctx, 2) ? 2 : !validateStep(ctx, 4) ? 4 : 5;
  next.step = step;
  next.done = step - 1;
}

// ---------- render ----------
export function render(ctx) {
  const { html: h } = ctx;
  const sel = selected(ctx);
  if (sel === 'sip') loadDraft(ctx);
  return h`<div class="page cn">${header(ctx)}${cards(ctx, sel)}
    ${sel === 'api' ? h`<div class="cn-api-grid">${apiPanel(ctx)}${apiSide(ctx)}</div>` : wizard(ctx)}</div>`;
}

// ---------- behaviour ----------
function validateName(ctx, v) {
  return KEY_RE.test(v) ? null : ctx.t('api.keyErr');
}

let needKeyToast = null; // the "create a key first" warning, closed once a key exists
function createKey(ctx) {
  const a = ctx.state.api;
  a.keyName = keyNameOf(ctx);
  a.keyErr = validateName(ctx, a.keyName);
  if (!a.keyErr && ctx.list('apiKeys').some((k) => k.name === a.keyName && k.status === 'active')) a.keyErr = ctx.t('api.keyTaken');
  if (a.keyErr) { ctx.rerender(); const i = document.getElementById('cn-keyname'); if (i) i.focus(); return; }
  ctx.setState({ api: { ...a, busy: true } });
  soon(ctx, (s) => {
    const live = s.api.env === 'live';
    const rec = {
      id: newId('key'), name: s.api.keyName, prefix: live ? 'ak_live_' : 'ak_test_', last4: live ? '0002' : '0001', env: live ? 'live' : 'sandbox',
      scopes: SCOPES[s.api.scope], sub: (ctx.store.get('subAccounts') || [])[0]?.id || null, allowedIps: [], createdAt: new Date(nowMs()).toISOString().slice(0, 10),
      createdBy: ctx.store.get('user.name'), lastUsed: null, status: 'active',
    };
    ctx.store.push('apiKeys', rec, { prepend: true });
    audit('key.created', { name: rec.name, env: rec.env }, rec.id);
    s.api = { ...s.api, busy: false, shownKey: live ? DEMO_KEY_LIVE : DEMO_KEY_SANDBOX, keyId: rec.id, saved: false };
    setStep('connect', 'done');
    if (needKeyToast) { needKeyToast.close(); needKeyToast = null; } // "Create an API key first" is no longer true
    ctx.ui.toast(ctx.t('toast.T07', { name: rec.name }), { kind: 'success' });
    redraw(ctx, onApi);
  }, 600, 'api');
}

function sendTestEvent(ctx) {
  const { t, html: h, fmt } = ctx;
  const cc = connectCall(ctx);
  const env = ctx.store.get('env');
  const ts = Math.floor(nowMs() / 1000);
  const payload = {
    event: 'call.completed', id: newId('evt'), created_at: fmt.iso(nowMs()),
    data: {
      call_id: cc ? cc.id : 'call_01JBTEST0001', direction: 'outbound', from: SANDBOX_CALLER_E164, to: TO_SAMPLE, status: 'completed', sip_code: 200,
      talk_seconds: cc ? cc.sec : 18, billed_minutes: 1, price: env === 'sandbox' ? 0 : PRICES.outbound, price_unit: 'credits', environment: env,
    },
  };
  const text = JSON.stringify(payload, null, 2);
  const url = ctx.state.api.webhook;
  ctx.ui.modal({
    title: t('api.evTitle'), size: 'lg',
    body: h`<p class="hint">${t('api.evIntro', { url })}</p>
      <span class="label">${t('api.evHeaders')}</span>
      <pre class="code" translate="no">POST ${url}
Content-Type: application/json
X-ANTS-Timestamp: ${ts}
X-ANTS-Signature: v1=demo0000signature0000not0real</pre>
      <span class="label">${t('api.evPayload')}</span><pre class="code" translate="no">${text}</pre>
      <div class="note note-ok">${ctx.icon('check-circle')}<span><strong>200 OK · 182 ms</strong> ${t('api.evSimulated')}</span></div>
      <a class="linkbtn" href="#/help/article/webhooks-signature" data-action="cn.api.ev.sig">${t('api.evSig')}</a>`,
    buttons: [
      { label: t('api.evCopy'), icon: 'copy', action: 'cn.ev.copy', onClick: (hd, btn) => { ctx.ui.copy(text, btn); return false; } },
      { label: t('common.close'), kind: 'navy', action: 'cn.ev.close' },
    ],
  });
  ctx.ui.toast(t('toast.T10', { code: 200, ms: 182 }), { kind: 'success' });
}

function trunkConfigText(ctx) {
  const w = ctx.state.wz;
  const name = w.name;
  const user = `trk_${name.replace(/-/g, '_')}_DEMO`;
  const head = `; ${ctx.t('wz.3.fileHead', { name, pbx: PBX[w.pbx] })}\n; ${ctx.t('wz.3.fileNote')}\n`;
  if (w.pbx === 'freepbx' || w.pbx === 'asterisk' || w.pbx === 'generic') {
    return `${head}
[ants-${name}]
type=endpoint
transport=transport-${w.transport}
context=from-trunk
disallow=all
allow=alaw,ulaw
dtmf_mode=rfc4733
media_encryption=${w.transport === 'tls' && w.srtp ? 'sdes' : 'no'}
aors=ants-${name}
${w.auth !== 'ip' ? `outbound_auth=ants-${name}-auth\n` : ''}
[ants-${name}]
type=aor
contact=sip:${SIP_HOST}:${w.transport === 'tls' ? 5061 : 5060}
qualify_frequency=30

[ants-${name}-identify]
type=identify
endpoint=ants-${name}
match=${SIGNALLING_IPS.join(',')}
${w.auth !== 'ip' ? `
[ants-${name}-auth]
type=auth
auth_type=userpass
username=${user}
password=<paste the password you saved>
` : ''}`;
  }
  return `${head}
${configRows(ctx).map((r) => `${r.label}: ${r.v}`).join('\n')}
${w.auth !== 'ip' ? `${ctx.t('wz.3.pass')}: <paste the password you saved>\n` : ''}`;
}

function emailAdmin(ctx) {
  const { t, html: h } = ctx;
  const preview = `${t('wz.3.emailIntro', { name: ctx.state.wz.name })}\n\n${configRows(ctx).map((r) => `${r.label}: ${r.v}`).join('\n')}`;
  ctx.ui.modal({
    title: t('wz.3.email'), size: 'md',
    body: h`<label class="field"><span class="label">${t('wz.3.emailTo')}</span><input class="input" type="email" data-m="to" value="it@example.com" autocomplete="off"></label>
      <span class="field-err" data-m="err" hidden>${t('wz.3.emailErr')}</span>
      <label class="field" style="margin-top:12px"><span class="label">${t('wz.3.emailPreview')}</span><textarea class="textarea mono" rows="9" readonly translate="no">${preview}</textarea></label>
      <p class="hint-xs">${t('wz.3.emailNoPass')}</p>`,
    buttons: [
      { label: t('common.cancel'), action: 'wz.3.email.cancel' },
      { label: t('wz.3.emailSend'), kind: 'navy', icon: 'send', action: 'wz.3.email.send', onClick: (hd) => {
        const v = hd.el.querySelector('[data-m="to"]').value.trim();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { hd.el.querySelector('[data-m="err"]').hidden = false; return false; }
        ctx.ui.toast(t('toast.T19'), { kind: 'info', demo: true });
        return true;
      } },
    ],
  });
}

function attachNumber(ctx) {
  const { t, html: h } = ctx;
  const w = ctx.state.wz;
  const nums = ctx.list('numbers').filter((n) => n.status === 'active' && !w.attached.includes(n.number));
  const target = (n) => {
    if (!n.routing) return null;
    if (n.routing.type === 'flow') { const f = ctx.list('flows').find((x) => x.id === n.routing.ref); return t('wz.4.toFlow', { name: f ? ctx.loc(f.name) : n.routing.ref }); }
    if (n.routing.type === 'trunk') return t('wz.4.toTrunk', { name: n.routing.ref });
    if (n.routing.type === 'webhook') return t('wz.4.toWebhook');
    return t('wz.4.toMessage');
  };
  const handle = ctx.ui.modal({
    title: t('wz.4.attach'), size: 'sm',
    body: nums.length
      ? h`<div class="stack" role="list">${nums.map((n) => h`<button type="button" class="optcard" role="listitem" data-action="wz.4.pick" data-value="${n.number}" style="flex-direction:row;align-items:center;justify-content:space-between;width:100%">
          <span class="t mono" translate="no">${n.number}</span><span class="h">${target(n) ? t('wz.4.now', { target: target(n) }) : t('wz.4.unrouted')}</span></button>`)}</div>`
      : h`<div class="empty"><strong>${t('wz.4.noNumbers')}</strong><span class="hint">${t('wz.4.noNumbersH')}</span>
          <a class="btn btn-sm btn-navy" href="#/numbers/buy?return=connect" data-action="wz.4.pick.buy">${t('wz.4.buy', { price: ctx.fmt.int(PRICES.number) })}</a></div>`,
    buttons: [{ label: t('common.cancel'), action: 'wz.4.picker.cancel' }],
    actions: {
      'wz.4.pick': async (el) => {
        const n = nums.find((x) => x.number === el.dataset.value);
        const tg = target(n);
        handle.close();
        if (tg) {
          const ok = await ctx.ui.confirm({ title: t('wz.4.moveTitle'), body: t('wz.4.moveBody', { number: n.number, target: tg }), confirmLabel: t('wz.4.moveYes'), cancelLabel: t('wz.4.moveNo') });
          if (!ok) return;
        }
        ctx.state.wz.attached = [...ctx.state.wz.attached, n.number];
        ctx.rerender();
      },
      'wz.4.pick.buy': () => handle.close(),
    },
  });
}

/** Step 5 live checks: OPTIONS 1.2 s → registration → TLS/SRTP 1.5 s. */
function runChecks(ctx) {
  const w = ctx.state.wz;
  w.runId += 1;
  w.ran = true;
  w.checks = { options: 'run', reg: 'idle', tls: 'idle', inbound: w.checks.inbound === 'ok' ? 'ok' : 'idle', outbound: w.checks.outbound === 'ok' ? 'ok' : 'idle' };
  const set = (s, k, v) => { s.wz.checks[k] = v; if (v === 'ok') s.wz.at[k] = nowMs(); };
  soon(ctx, (s) => {
    set(s, 'options', 'ok');
    if (s.wz.auth === 'ip') set(s, 'reg', 'na'); else set(s, 'reg', 'run');
    if (s.wz.auth === 'ip') set(s, 'tls', s.wz.transport === 'tls' ? 'run' : 'na');
    redraw(ctx, onSip);
    const afterReg = s.wz.auth === 'ip' ? 0 : 800;
    soon(ctx, (s2) => {
      if (s2.wz.auth !== 'ip') { set(s2, 'reg', 'ok'); set(s2, 'tls', s2.wz.transport === 'tls' ? 'run' : 'na'); redraw(ctx, onSip); }
      if (s2.wz.checks.tls !== 'run') { liveMsg(ctx, s2); return; }
      soon(ctx, (s3) => { set(s3, 'tls', 'ok'); liveMsg(ctx, s3); redraw(ctx, onSip); }, 1500);
    }, afterReg);
  }, 1200);
  ctx.rerender();
}

function liveMsg(ctx, s) {
  const c = s.wz.checks;
  s.wz.live = c.options === 'ok' && (c.inbound === 'ok' || c.outbound === 'ok') ? ctx.t('wz.5.allPassed') : ctx.t('wz.5.optionsPassed');
}

function runInbound(ctx) {
  const w = ctx.state.wz;
  w.checks.inbound = 'run';
  ctx.ui.audio.unlock();
  const stop = ctx.ui.audio.tones.ringback(1);
  ctx.rerender();
  soon(ctx, (s) => {
    if (typeof stop === 'function') stop();
    if (s.wz.firewall) { s.wz.checks.inbound = 'fail'; s.wz.live = ctx.t('wz.5.noAudio', { media: MEDIA_IPS, ports: MEDIA_PORTS }); } else { s.wz.checks.inbound = 'ok'; s.wz.at.inbound = nowMs(); liveMsg(ctx, s); }
    redraw(ctx, onSip);
  }, 2000);
}

function activate(ctx) {
  const { t } = ctx;
  const w = ctx.state.wz;
  const tr = trunkRecord(ctx, 'active');
  upsertTrunk(ctx, tr);
  setStep('connect', 'done');
  audit('trunk.activated', { name: tr.name }, tr.id);
  ctx.ui.toast(t('toast.T16', { name: tr.name }), { kind: 'success' });
  ctx.state.wz = { ...freshWizard(), runId: w.runId + 1 };
  ctx.go(`trunks/${tr.name}`);
}

function trunkRecord(ctx, status) {
  const w = ctx.state.wz;
  const tm = estimateMonthly({ minutes: 0, concurrent: w.concurrent }).trunk;
  return {
    id: w.draftId || newId('trk'), name: w.name, pbx: PBX[w.pbx], sub: (ctx.store.get('subAccounts') || [])[0]?.id || null,
    auth: w.auth, ips: w.auth === 'credentials' ? [] : w.ips.map((r) => r.ip), ipLabels: w.ips.map((r) => r.label), transport: w.transport, srtp: w.transport === 'tls' && w.srtp,
    concurrent: w.concurrent, included: PRICES.trunkIncludedCalls, inUse: 0, monthly: tm.extraCost, cps: w.cps, status, availability: status === 'active' ? 100 : null,
    last24h: { calls: 0, outbound: 0, inbound: 0, answerRatePct: null, pddSec: null, credits: 0 },
    uris: w.uris.map((u) => ({ priority: u.priority, uri: u.uri, weight: u.weight, status: u.on ? (status === 'active' ? 'healthy' : 'unknown') : 'off', replyMs: status === 'active' && u.on ? 12 : null })),
    failoverSec: w.failover, fallback: w.fallback, attached: w.attached, cid: w.cid, username: w.auth !== 'ip' ? `trk_${w.name.replace(/-/g, '_')}_DEMO` : null,
    createdAt: new Date(nowMs()).toISOString(),
  };
}
function upsertTrunk(ctx, tr) {
  const list = ctx.list('trunks');
  ctx.store.set('trunks', list.some((x) => x.id === tr.id) ? list.map((x) => (x.id === tr.id ? tr : x)) : [...list, tr]);
}

function validateStep(ctx, step) {
  const { t } = ctx;
  const w = ctx.state.wz;
  if (step === 2) {
    w.nameErr = KEY_RE.test(w.name) ? null : t('wz.2.nameErr');
    if (!w.nameErr && ctx.list('trunks').some((x) => x.name === w.name && x.id !== w.draftId)) w.nameErr = t('wz.2.nameTaken');
    if (w.auth !== 'credentials' && !w.ips.length) w.ipErr = t('wz.2.needIp');
    return !w.nameErr && !(w.auth !== 'credentials' && !w.ips.length);
  }
  if (step === 4) {
    const bad = w.uris.find((u) => !URI_RE.test(u.uri.trim()));
    w.uriErr = bad ? t('wz.4.uriErr') : (!w.uris.some((u) => u.on) ? t('wz.4.oneOn') : null);
    return !w.uriErr;
  }
  return true;
}

function goStep(ctx, n) {
  const w = ctx.state.wz;
  const ae = document.activeElement;
  const from = ae && ae.closest && ae.closest('.cn-wz') ? ae.dataset.action || null : null;
  w.step = n;
  if (n === 5 && !w.ran) { runChecks(ctx); } else ctx.rerender();
  const card = document.querySelector('.cn-wz');
  if (card && card.getBoundingClientRect().top < 0) card.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
  // Keyboard users keep their place: focus returns to the same button (Next / Back) or, when the step has none
  // (step 5 shows Activate instead of Next), to the step heading — never to <body>.
  if (from) {
    setTimeout(() => {
      const again = document.querySelector(`.cn-wz [data-action="${from}"]`);
      const target = again && again.getAttribute('aria-disabled') !== 'true' ? again : document.getElementById('wz-h');
      if (target) target.focus({ preventScroll: true });
    }, 0);
  }
}

export function mount(root, ctx) {
  const { t } = ctx;
  const a = ctx.state.api;

  // Leaving with a key that is still shown once → ask.
  if (a.shownKey && !a.saved) {
    ctx.guard(async () => {
      const ok = await ctx.ui.confirm({ title: t('api.leaveTitle'), body: t('api.leaveBody'), confirmLabel: t('api.leaveYes'), cancelLabel: t('api.leaveStay') });
      if (ok) ctx.state.api.saved = true;
      return ok;
    });
  }

  ctx.actions(root, {
    // cards
    'cn.card.api': () => ctx.go('connect/api'),
    'cn.card.api.use': () => ctx.go('connect/api'),
    'cn.card.api.key': () => { ctx.go('connect/api?focus=key'); },
    'cn.card.sip': () => ctx.go('connect/sip'),
    'cn.sip.create': () => ctx.go('connect/sip'),
    // API card
    'cn.api.status.refresh': () => {
      ctx.setState({ api: { ...ctx.state.api, statusBusy: true } });
      soon(ctx, (s) => { s.api.statusBusy = false; redraw(ctx, onApi); }, 600, 'api');
    },
    'cn.api.reset': () => {
      const prev = { ...ctx.state.api };
      ctx.setState({ api: { ...freshApi(), webhook: prev.webhook } });
      ctx.ui.toast(t('api.resetDone'), { kind: 'info', action: { label: t('common.undo'), onClick: () => ctx.setState({ api: prev }) }, timeout: 10000 });
    },
    'cn.api.env': (el) => { ctx.state.api.env = el.dataset.value; ctx.rerender(); },
    'cn.api.create': () => { if (!ctx.state.api.busy) createKey(ctx); },
    'cn.api.copykey': (el) => ctx.ui.copy(ctx.state.api.shownKey, el),
    'cn.api.saved': () => { ctx.state.api.saved = true; ctx.guard(null); ctx.rerender(); },
    'cn.api.tab.curl': () => ctx.setState({ api: { ...ctx.state.api, tab: 'curl' } }),
    'cn.api.tab.node': () => ctx.setState({ api: { ...ctx.state.api, tab: 'node' } }),
    'cn.api.tab.python': () => ctx.setState({ api: { ...ctx.state.api, tab: 'python' } }),
    'cn.api.tab.php': () => ctx.setState({ api: { ...ctx.state.api, tab: 'php' } }),
    'cn.api.copycode': (el) => ctx.ui.copy(codeSample(ctx, ctx.state.api.tab), el),
    'cn.api.send': () => {
      // The sample needs a key: without one, point at step 1 instead of pretending the request ran.
      if (!ctx.state.api.keyId && !existingSandboxKey(ctx)) {
        needKeyToast = ctx.ui.toast(t('api.needKey'), { kind: 'warn' });
        const i = root.querySelector('#cn-keyname');
        if (i) { i.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' }); i.focus({ preventScroll: true }); }
        return;
      }
      ctx.ui.dialer.open({ mode: 'api', source: 'connect', autostart: true, onEnd: () => redraw(ctx, onApi) });
    },
    'cn.api.logs': (el, ev) => { ev.preventDefault(); const cc = connectCall(ctx); if (cc) ctx.go(`logs?call=${cc.id}`); },
    'cn.api.copy.base': (el) => ctx.ui.copy(API_BASE, el),
    'cn.api.copy.auth': (el) => ctx.ui.copy('Authorization: Bearer $ANTS_API_KEY', el),
    'cn.api.sendevent': () => sendTestEvent(ctx),
    // wizard
    'wz.step': (el) => { const n = Number(el.dataset.value); if (n <= ctx.state.wz.done + 1 && n !== ctx.state.wz.step) goStep(ctx, n); },
    'wz.back': () => { if (ctx.state.wz.step > 1) goStep(ctx, ctx.state.wz.step - 1); },
    'wz.next': () => {
      const w = ctx.state.wz;
      if (!validateStep(ctx, w.step)) { ctx.rerender(); const e = root.querySelector('[aria-invalid="true"], .field-err'); if (e && e.focus) e.focus(); return; }
      w.done = Math.max(w.done, w.step);
      goStep(ctx, w.step + 1);
    },
    'wz.saveexit': () => {
      const w = ctx.state.wz;
      if (!KEY_RE.test(w.name)) { w.step = 2; validateStep(ctx, 2); ctx.rerender(); return; }
      const tr = trunkRecord(ctx, 'draft');
      w.draftId = tr.id;
      upsertTrunk(ctx, tr);
      ctx.ui.toast(t('toast.T03'), { kind: 'success' });
      ctx.go('trunks');
    },
    'wz.close': () => ctx.go('connect'),
    'wz.1.minus': () => { const w = ctx.state.wz; if (w.concurrent > 1) { w.concurrent -= 1; ctx.rerender(); } },
    'wz.1.plus': () => { const w = ctx.state.wz; if (w.concurrent < 100) { w.concurrent += 1; ctx.rerender(); } },
    'wz.1.cps': (el) => { const w = ctx.state.wz; w.cps = Math.max(1, Math.min(10, w.cps + Number(el.dataset.value))); ctx.rerender(); },
    'wz.1.plan': (el) => ctx.ui.sales.requestPlan({ planId: el.dataset.value, minutes: ctx.state.wz.minutes }),
    'wz.1.contact': () => ctx.ui.sales.contact({ volume: 'gt200', use: 'pbx' }),
    'wz.2.pbx': (el) => { ctx.state.wz.pbx = el.dataset.value; ctx.rerender(); },
    'wz.2.auth': (el) => { ctx.state.wz.auth = el.dataset.value; ctx.state.wz.ipErr = null; ctx.state.wz.ran = false; ctx.rerender(); },
    'wz.2.ip.add': () => {
      const w = ctx.state.wz;
      const v = w.ipInput.trim();
      if (!IP_RE.test(v)) { w.ipErr = t('wz.2.ipErr'); ctx.rerender(); return; }
      if (w.ips.some((r) => r.ip === v)) { w.ipErr = t('wz.2.ipDup'); ctx.rerender(); return; }
      w.ips = [...w.ips, { ip: v, label: '' }];
      w.ipInput = '';
      w.ipErr = null;
      ctx.rerender();
      const inp = root.querySelector('[data-field="ipInput"]');
      if (inp) inp.focus();
    },
    'wz.2.ip.remove': (el) => {
      const w = ctx.state.wz;
      const i = Number(el.dataset.value);
      const row = w.ips[i];
      w.ips = w.ips.filter((_, k) => k !== i);
      ctx.rerender();
      ctx.ui.toast(t('wz.2.removed', { ip: row.ip }), { kind: 'info', timeout: 10000, action: { label: t('common.undo'), onClick: () => { const s = ctx.state.wz; s.ips = [...s.ips.slice(0, i), row, ...s.ips.slice(i)]; redraw(ctx, onSip); } } });
    },
    'wz.2.transport': (el) => { const w = ctx.state.wz; w.transport = el.dataset.value; if (w.transport !== 'tls') w.srtp = false; else w.srtp = true; w.ran = false; ctx.rerender(); },
    'wz.2.srtp': () => { const w = ctx.state.wz; if (w.transport === 'tls') { w.srtp = !w.srtp; w.ran = false; ctx.rerender(); } },
    'wz.3.copy': (el) => { const r = configRows(ctx).find((x) => x.k === el.dataset.value); if (r) ctx.ui.copy(r.v, el); },
    'wz.3.copyall': (el) => ctx.ui.copy(configRows(ctx).map((r) => `${r.label}: ${r.v}`).join('\n'), el),
    'wz.3.reveal': () => {
      const w = ctx.state.wz;
      w.reveal = 'shown';
      w.revealAt = Date.now();
      ctx.rerender();
      soon(ctx, (s) => { s.wz.reveal = 'used'; redraw(ctx, onSip); }, 30000);
    },
    'wz.3.download': () => {
      const w = ctx.state.wz;
      const file = `ants-trunk-${w.name}-${w.pbx}.txt`;
      ctx.ui.download(file, trunkConfigText(ctx));
    },
    'wz.3.email': () => emailAdmin(ctx),
    'wz.4.uri.add': () => { const w = ctx.state.wz; if (w.uris.length < 3) { w.uris = [...w.uris, { uri: 'sip:', priority: (w.uris.length + 1) * 10, weight: 10, on: true }]; ctx.rerender(); const ins = root.querySelectorAll('[data-field="uri"]'); if (ins.length) ins[ins.length - 1].focus(); } },
    'wz.4.uri.remove': (el) => {
      const w = ctx.state.wz;
      if (w.uris.length <= 1) return;
      const i = Number(el.dataset.value);
      const row = w.uris[i];
      w.uris = w.uris.filter((_, k) => k !== i);
      ctx.rerender();
      ctx.ui.toast(t('wz.4.removed'), { kind: 'info', timeout: 10000, action: { label: t('common.undo'), onClick: () => { const s = ctx.state.wz; s.uris = [...s.uris.slice(0, i), row, ...s.uris.slice(i)]; redraw(ctx, onSip); } } });
    },
    'wz.4.uri.toggle': (el) => { const u = ctx.state.wz.uris[Number(el.dataset.value)]; u.on = !u.on; ctx.rerender(); },
    'wz.4.attach': () => attachNumber(ctx),
    'wz.4.detach': (el) => {
      const w = ctx.state.wz;
      const n = el.dataset.value;
      w.attached = w.attached.filter((x) => x !== n);
      ctx.rerender();
      ctx.ui.toast(t('wz.4.detached', { number: n }), { kind: 'info', timeout: 10000, action: { label: t('common.undo'), onClick: () => { ctx.state.wz.attached = [...ctx.state.wz.attached, n]; redraw(ctx, onSip); } } });
    },
    'wz.5.inbound': () => runInbound(ctx),
    'wz.5.retry': () => { ctx.state.wz.firewall = false; runInbound(ctx); },
    'wz.5.outbound': () => {
      const w = ctx.state.wz;
      w.checks.outbound = 'run';
      ctx.rerender();
      soon(ctx, (s) => { s.wz.checks.outbound = 'ok'; s.wz.at.outbound = nowMs(); liveMsg(ctx, s); redraw(ctx, onSip); }, 2000);
    },
    'wz.5.fail': () => {
      const w = ctx.state.wz;
      w.firewall = true;
      if (w.checks.inbound === 'ok') { w.checks.inbound = 'fail'; w.live = t('wz.5.noAudio', { media: MEDIA_IPS, ports: MEDIA_PORTS }); }
      ctx.rerender();
      ctx.ui.toast(t('wz.5.failOn'), { kind: 'info', demo: true });
    },
    'wz.5.activate': () => activate(ctx),
  });

  ctx.inputs(root, {
    keyName: (v) => { ctx.state.api.keyName = v.trim().toLowerCase(); },
    scope: (v) => { ctx.state.api.scope = v; },
    webhook: (v) => { ctx.state.api.webhook = v.trim() || DEFAULT_WEBHOOK; },
    minutes: (v, el) => {
      ctx.state.wz.minutes = Number(v) || 0;
      const out = root.querySelector('[data-minutes-out]');
      if (out) out.textContent = ctx.fmt.int(ctx.state.wz.minutes);
      el.setAttribute('aria-valuetext', ctx.fmt.int(ctx.state.wz.minutes));
    },
    wzName: (v) => { ctx.state.wz.name = v.trim().toLowerCase(); },
    ipInput: (v) => { ctx.state.wz.ipInput = v; },
    ipLabel: (v, el) => { const r = ctx.state.wz.ips[Number(el.dataset.index)]; if (r) r.label = v; },
    uri: (v, el) => { const u = ctx.state.wz.uris[Number(el.dataset.index)]; if (u) u.uri = v; },
    prio: (v, el) => { const u = ctx.state.wz.uris[Number(el.dataset.index)]; if (u) u.priority = Math.max(1, Math.min(100, Number(v) || 1)); },
    weight: (v, el) => { const u = ctx.state.wz.uris[Number(el.dataset.index)]; if (u) u.weight = Math.max(1, Math.min(100, Number(v) || 1)); },
    failover: (v) => { ctx.state.wz.failover = Number(v); },
    fallback: (v, el, ev) => { if (ev.type === 'change') { ctx.state.wz.fallback = v; ctx.rerender(); } },
    fallbackFlow: (v) => { ctx.state.wz.fallbackFlow = v; },
    forwardTo: (v) => { ctx.state.wz.forwardTo = v; },
    cid: (v, el, ev) => { if (ev.type === 'change') { ctx.state.wz.cid = v; ctx.rerender(); } },
  });
  // Re-render after a slider drag ends (estimate card) and validate fields on blur.
  ctx.on(root, 'change', '[data-field="minutes"]', () => ctx.rerender());
  ctx.on(root, 'focusout', '[data-field="keyName"]', () => {
    const a2 = ctx.state.api;
    const err = validateName(ctx, keyNameOf(ctx));
    if (err !== a2.keyErr) { a2.keyErr = err; ctx.rerender(); }
  });
  ctx.on(root, 'focusout', '[data-field="wzName"]', () => {
    const w = ctx.state.wz;
    const err = KEY_RE.test(w.name) ? null : t('wz.2.nameErr');
    if (err !== w.nameErr) { w.nameErr = err; ctx.rerender(); }
  });
  ctx.on(root, 'keydown', '[data-field="ipInput"], [data-field="keyName"]', (ev, el) => {
    if (ev.key !== 'Enter' || ev.isComposing || ev.keyCode === 229) return;
    ev.preventDefault();
    const b = root.querySelector(el.dataset.field === 'ipInput' ? '[data-action="wz.2.ip.add"]' : '[data-action="cn.api.create"]');
    if (b) b.click();
  });
  // Arrow keys move between code tabs (WAI-ARIA tabs pattern).
  ctx.on(root, 'keydown', '[role="tab"]', (ev) => {
    if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
    const i = TABS.indexOf(ctx.state.api.tab);
    const next = TABS[(i + (ev.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
    ctx.setState({ api: { ...ctx.state.api, tab: next } });
    const b = root.querySelector(`#cn-tab-${next}`);
    if (b) b.focus();
  });

  ctx.watch('calls', 'apiKeys', 'trunks', 'numbers', 'mode', 'env');

  // Ticking text without re-rendering: reveal-once countdown and the OPTIONS heartbeat.
  ctx.every(() => {
    const w = ctx.state.wz;
    const left = root.querySelector('[data-reveal-left]');
    if (left && w.reveal === 'shown') left.textContent = t('wz.3.hidesIn', { n: Math.max(0, 30 - Math.floor((Date.now() - w.revealAt) / 1000)) });
    const hb = root.querySelector('[data-heartbeat]');
    if (hb && w.at.options) {
      const ip = w.auth === 'credentials' ? '198.51.100.60' : (w.ips[0] ? w.ips[0].ip.split('/')[0] : '198.51.100.60');
      hb.textContent = t('wz.5.heartbeat', { ip, n: Math.floor(((nowMs() - w.at.options) / 1000) % 30) });
    }
  }, 1000);

  // Deep link ?focus=key → the key-name field.
  if (ctx.params.query.focus === 'key') ctx.later(() => { const i = root.querySelector('#cn-keyname'); if (i) { i.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' }); i.focus({ preventScroll: true }); } }, 60);
  // Step 5 opened by a direct link or a step circle: start the checks once.
  if (selected(ctx) === 'sip' && ctx.state.wz.step === 5 && !ctx.state.wz.ran) ctx.later(() => runChecks(ctx), 0);
}
