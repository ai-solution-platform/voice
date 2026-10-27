// API keys & Webhooks — #/keys?tab=keys|requests|webhooks|events   (?section=webhooks is accepted too)
// Keys, an API request log (?tab=requests&status=all|2xx|4xx|5xx&req=req_…), webhook endpoints, failed deliveries,
// an event inspector and "Verify a signature".
// Secrets are visibly fake and shown once: ak_live_DEMO_…_not_a_real_key, whsec_DEMO_…_not_a_real_secret.
// Rotate / Revoke / Rotate secret ask you to type the name; a revoked key has no actions except Hide;
// removing a row before saving offers Undo.

import { raw, reducedMotion } from '../core/dom.js';
import { getLang, tIn, LANGS } from '../core/i18n.js';
import { newId, audit, setStep } from '../core/actions.js';
import { nowMs, DEMO_NOW, at as atTime } from '../data/clock.js';
import { DEMO_KEY_SANDBOX, DEMO_KEY_LIVE, maskKey, API_BASE, SANDBOX_CALLER_E164, DEFAULT_WEBHOOK } from '../data/edge.js';
import { PRICES } from '../data/prices.js';
import { ERRORS } from '../data/reference.js';
import { reqId, reqIdLine } from '../ui/reqid.js';

export const id = 'keys';
export const nav = { group: 'account', icon: 'key', labelKey: 'nav.keys' };
export const titleKey = 'nav.keys';
export const skeleton = 'table';
export const css = true;

const KEY_RE = /^[a-z0-9-]{3,32}$/;
const IP_RE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}(\/(3[0-2]|[12]?\d))?$/;
const URL_RE = /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(:\d{2,5})?(\/[\w./-]*)?$/i;
const SCOPES = ['calls:write', 'broadcasts:write', 'numbers:write', 'otp:write', 'read'];
const EVENTS = ['call.completed', 'call.*', 'otp.*', 'broadcast.*', 'recording.ready', 'number.*'];
const TABS = ['keys', 'requests', 'webhooks', 'events'];
const RETRY = [1, 5, 30, 120, 600];
const noop = () => {};

export const initialState = () => ({ env: 'all', showRevoked: false, hidden: [], shown: null, creating: false, tests: {}, resending: {}, sent: [], evQ: '', evStatus: 'all', rqQ: '', verify: { wh: null, ts: null, payload: null, sig: '', result: null, busy: false }, seq: 3 });

// the tab bar already says where you are; a crumb would only repeat it
export function crumb() { return ''; }

export const commands = [
  { id: 'wh', labelKey: 'cmd.webhooks', icon: 'link', keywords: ['webhooks events deliveries signature'], run: ({ go }) => go('keys?tab=webhooks') },
  { id: 'rq', labelKey: 'cmd.requests', icon: 'activity', keywords: ['api requests log request id 4xx 5xx errors debugger'], run: ({ go }) => go('keys?tab=requests') },
];

// ---------- helpers ----------
function tabOf(params) {
  const q = params.query || {};
  const v = q.tab || q.section;
  return TABS.includes(v) ? v : 'keys';
}
const onKeys = () => /^#\/keys(\?|$)/.test(location.hash);
function soon(ctx, fn, ms) {
  const st = ctx.state;
  setTimeout(() => { if (st === ctx.state) fn(st); }, reducedMotion() ? Math.min(ms, 250) : ms);
}
const redraw = (ctx) => { if (onKeys()) ctx.rerender(); };
const hostOf = (url) => { try { return new URL(url).host; } catch { return url; } };
const secretOf = (wh) => `whsec_DEMO_${wh.secretLast4}_not_a_real_secret`;
const maskSecret = (wh) => `whsec_DEMO••••${wh.secretLast4}`;
const firstRun = (ctx) => ctx.store.get('mode') === 'firstRun';
// store reasons are English API text; show them in the UI language
function reasonText(r, t) {
  if (!r) return '';
  if (/Timed out/i.test(r)) return t('rsn.timeout', { s: 5 });
  const m = /HTTP (\d{3})/.exec(r);
  return m ? `HTTP ${m[1]} · ${t(`wt.code.${m[1]}`)}` : r;
}

async function hmacHex(secret, msg) {
  const enc = new TextEncoder();
  try {
    if (window.crypto && crypto.subtle) {
      const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
      return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch { /* fall through */ }
  // No Web Crypto (old browser, insecure context): a stable demo hash so the helper still works.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (const c of secret + '|' + msg) { h1 = Math.imul(h1 ^ c.charCodeAt(0), 16777619) >>> 0; h2 = Math.imul(h2 + c.charCodeAt(0), 2654435761) >>> 0; }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).repeat(4);
}

function samplePayload(ctx) {
  const c = ctx.list('calls')[0];
  return JSON.stringify({ event: 'call.completed', id: 'evt_01JBKX5B7C', data: { call_id: c ? c.id : 'call_01JBTEST0001', status: 'completed', sip_code: 200, talk_seconds: c ? c.sec : 18, price: c ? c.credits : PRICES.outbound, price_unit: 'credits' } });
}

/** Recent deliveries: built from the call log and the failed events, plus test events sent here. */
function eventsList(ctx) {
  const whs = ctx.list('webhooks');
  const hooks = whs.find((w) => w.url.includes('hooks.example.com'));
  const crm = whs.find((w) => w.url.includes('crm.example.com'));
  const out = [...ctx.state.sent];
  const failed = new Set(ctx.list('failedEvents').map((e) => e.id));
  ctx.list('failedEvents').forEach((e, i) => {
    out.push({ id: e.id, at: new Date(new Date(ctx.list('calls')[0] ? ctx.list('calls')[0].ts : nowMs()).getTime() - (i + 1) * 61000).toISOString(), event: e.event, url: crm ? crm.url : `https://${e.endpoint}`, code: /Timed out/.test(e.reason) ? null : 503, ms: /Timed out/.test(e.reason) ? 5000 : 1204, status: 'failed', attempts: e.attempts, reason: e.reason });
  });
  ctx.list('calls').slice(0, 18).forEach((c, i) => {
    const tail = c.id.slice(-8);
    const toCrm = crm && c.sub === 'sub_01JB2DV7RX' && c.source && ['campaign', 'notification', 'click-to-call'].includes(c.source.type);
    const late = new Date(c.ts).getTime() >= new Date(ctx.list('calls')[0].ts).getTime() - 10 * 60000;
    const ev = { id: `evt_01JB${tail}`, at: new Date(new Date(c.ts).getTime() + Math.max(1, c.sec || 0) * 1000 + 800).toISOString(), event: 'call.completed', callId: c.id, call: c };
    if (toCrm && crm) {
      if (failed.has(ev.id)) return;
      out.push({ ...ev, url: crm.url, code: late ? 503 : 200, ms: late ? 1204 : 214, status: late ? (crm.status === 'off' ? 'failed' : 'retrying') : 'delivered', attempts: late ? 2 + (i % 3) : 1 });
    } else if (hooks) {
      out.push({ ...ev, url: hooks.url, code: 200, ms: 150 + ((i * 37) % 90), status: 'delivered', attempts: 1 });
      if (c.recorded) out.push({ ...ev, id: `evt_01JR${tail}`, event: 'recording.ready', url: hooks.url, code: 200, ms: 171, status: 'delivered', attempts: 1, at: new Date(new Date(ev.at).getTime() + 4000).toISOString() });
    }
  });
  return out.sort((a, b) => (a.at < b.at ? 1 : -1));
}

function payloadOf(ctx, ev) {
  const { fmt } = ctx;
  const c = ev.call;
  const data = c ? {
    call_id: c.id, direction: c.direction, from: e164(c.from), to: e164(c.to), status: c.status, sip_code: c.sip, talk_seconds: c.sec,
    billed_minutes: c.billedMin, price: c.credits, price_unit: 'credits', subaccount_id: c.sub,
  } : ev.data || { note: 'sample' };
  if (ev.event === 'recording.ready') return { event: ev.event, id: ev.id, created_at: fmt.iso(ev.at), data: { call_id: c.id, recording_url: `${API_BASE}/voice/calls/${c.id}/recording`, duration_seconds: c.sec, expires_in_days: 90 } };
  return { event: ev.event, id: ev.id, created_at: fmt.iso(ev.at), data };
}
const e164 = (num) => (num && /^0/.test(num) ? '+66' + num.replace(/^0/, '').replace(/-/g, '') : num);

// ---------- pieces ----------
function header(ctx, tab) {
  const { t, html: h, icon } = ctx;
  return h`<div class="page-head"><div class="titles"><h1>${t('title')}${ctx.pageHelp()}</h1><span class="sub">${t('sub')}</span></div>
    <div class="tools"><a class="btn" href="#/connect/api" data-action="ky.connect">${icon('plug')}${t('connect')}</a>
      ${tab === 'keys' ? h`<button type="button" class="btn btn-primary" data-action="ky.create">${icon('plus')}${t('create')}</button>` : tab === 'webhooks' ? h`<button type="button" class="btn btn-primary" data-action="wh.add">${icon('plus')}${t('wh.add')}</button>` : ''}</div></div>`;
}

function tabs(ctx, tab) {
  const { t, html: h } = ctx;
  const failed = ctx.list('failedEvents').length;
  return h`<div class="seg ky-tabs" role="tablist" aria-label="${t('tabsAria')}">${TABS.map((k) => h`<a role="tab" href="#/keys?tab=${k}" data-action="ky.tab" aria-selected="${tab === k}" ${raw(tab === k ? 'aria-current="page"' : '')}>${t(`tab.${k}`)}${k === 'webhooks' && failed ? h` <span class="badge badge-err">${failed}</span>` : ''}</a>`)}</div>`;
}

function tiles(ctx) {
  const { t, html: h, fmt } = ctx;
  const kt = ctx.store.get('keyTiles') || { requests24h: 0, error4xxPct: 0, webhookDeliveryPct: null, webhookEvents24h: 0, retried24h: 0 };
  const active = ctx.list('apiKeys').filter((k) => k.status === 'active').length;
  const failed = ctx.list('failedEvents').length;
  // Same totals as the Requests tab; opens it already filtered to 4xx (when there are any).
  const rt = reqTotals(ctx);
  return h`<div class="grid g-4 ky-tiles">
    <div class="card tile"><span class="t">${t('tile.active')}</span><span class="v">${fmt.int(active)}</span><span class="h">${t('tile.activeLine', { live: fmt.int(ctx.list('apiKeys').filter((k) => k.status === 'active' && k.env === 'live').length), sandbox: fmt.int(ctx.list('apiKeys').filter((k) => k.status === 'active' && k.env === 'sandbox').length) })}</span></div>
    <a class="card tile tile-link" href="#/keys?tab=requests${rt.n4 ? '&status=4xx' : ''}" data-action="ky.tile.requests"><span class="t">${t('tile.requests')}</span><span class="v">${fmt.int(rt.total)}</span><span class="h">${t('tile.requestsLine', { pct: fmt.pct(rt.total ? (rt.n4 / rt.total) * 100 : kt.error4xxPct) })}</span></a>
    <a class="card tile tile-link" href="#/keys?tab=events" data-action="ky.tile.delivery"><span class="t">${ctx.term(t('tile.delivery'), 'webhook')}</span><span class="v">${kt.webhookDeliveryPct != null ? fmt.pct(kt.webhookDeliveryPct) : '—'}</span><span class="h">${t('tile.deliveryLine', { n: fmt.int(kt.webhookEvents24h), r: fmt.int(kt.retried24h) })}</span></a>
    <a class="card tile tile-link ${failed ? 'ky-tile-warn' : ''}" href="#/keys?tab=webhooks&focus=failed" data-action="ky.tile.failed"><span class="t">${t('tile.failed')}</span><span class="v">${fmt.int(failed)}</span><span class="h">${failed ? t('tile.failedLine') : t('tile.failedNone')}</span></a>
  </div>`;
}

function shownBanner(ctx) {
  const { t, html: h, icon } = ctx;
  const s = ctx.state;
  if (s.creating) return h`<div class="note note-info ky-shown" role="status"><span class="spin" aria-hidden="true"></span><span>${t('banner.creating')}</span></div>`;
  if (!s.shown || s.shown.saved) return '';
  const k = ctx.list('apiKeys').find((x) => x.id === s.shown.keyId);
  return h`<div class="note note-ok ky-shown" role="status">${icon('key')}<div class="grow stack" style="gap:6px">
    <strong>${s.shown.kind === 'rotate' ? t('banner.rotated', { name: k ? k.name : '' }) : t('banner.created', { name: k ? k.name : '' })}</strong>
    <div class="input-group"><code class="code-inline mono grow ky-secret" translate="no" id="ky-secret">${s.shown.value}</code>
      <button type="button" class="btn btn-sm" data-action="ky.banner.copy">${icon('copy', 'ico-sm')}${t('common.copy')}</button></div>
    <span class="hint-xs">${s.shown.kind === 'rotate' ? t('banner.rotateHint', { until: ctx.fmt.dateTime(k && k.oldUntil ? k.oldUntil : nowMs() + 86400000) }) : t('banner.hint')}</span>
    <div><button type="button" class="btn btn-sm btn-navy" data-action="ky.banner.saved">${icon('check')}${t('banner.saved')}</button></div></div></div>`;
}

function keysTab(ctx) {
  const { t, html: h, icon, fmt } = ctx;
  const s = ctx.state;
  const all = ctx.list('apiKeys');
  if (!all.length && !s.creating) {
    return h`${shownBanner(ctx)}<div class="card ky-empty"><div class="empty"><span class="art">${icon('key')}</span><h2>${t('empty.title')}</h2><p class="hint">${t('empty.body')}</p>
      <div class="row"><button type="button" class="btn btn-primary" data-action="ky.empty.create">${icon('plus')}${t('create')}</button><a class="btn" href="#/connect/api" data-action="ky.empty.connect">${icon('code')}${t('empty.quickstart')}</a></div></div></div>`;
  }
  const hiddenCount = all.filter((k) => s.hidden.includes(k.id)).length;
  const visible = all.filter((k) => (s.env === 'all' || k.env === s.env) && (!s.hidden.includes(k.id) || s.showRevoked));
  return h`${shownBanner(ctx)}
    ${ctx.store.get('env') === 'sandbox' ? h`<div class="note note-warn">${icon('info')}<span>${t('sandboxNote')}</span></div>` : ''}
    <div class="row ky-filters"><div class="seg" role="group" aria-label="${t('f.envAria')}">${['all', 'live', 'sandbox'].map((k) => h`<button type="button" data-action="ky.env" data-value="${k}" aria-pressed="${s.env === k}">${t(`f.env.${k}`)}</button>`)}</div>
      <span class="grow"></span>${hiddenCount ? h`<button type="button" class="linkbtn hint-xs" data-action="ky.revoked.show" aria-pressed="${s.showRevoked}">${s.showRevoked ? t('f.hideRevoked') : t('f.showRevoked', { n: hiddenCount })}</button>` : ''}</div>
    ${visible.length ? h`<div class="card"><div class="tbl-wrap"><table class="tbl ky-tbl"><thead><tr><th>${t('col.name')} · ${t('col.sub')}</th><th>${t('col.key')} · ${ctx.term(t('col.env'), 'env')}</th><th>${ctx.term(t('col.scopes'), 'scope')}</th><th>${ctx.term(t('col.ips'), 'ip_allow')}</th><th class="ky-c-created">${t('col.created')}</th><th>${t('col.status')} · ${t('col.used')}</th><th><span class="sr-only">${t('col.actions')}</span></th></tr></thead>
      <tbody>${visible.map((k) => h`<tr class="${k.status === 'revoked' ? 'ky-revoked' : ''} ${s.fresh === k.id ? 'new-row' : ''}">
        <td><strong class="mono" translate="no">${k.name}</strong><div class="hint-xs ky-sub">${ctx.ui.describe.sub(k.sub)}</div></td>
        <td class="ky-c-key"><div class="ky-keycell"><span class="mono" translate="no">${maskKey(k.prefix, k.last4)}</span><span class="chip ${k.env === 'live' ? 'chip-ok' : 'chip-warn'}">${k.env === 'live' ? t('top.live') : t('top.sandbox')}</span></div>${k.status !== 'revoked' && k.oldUntil && nowMs() < new Date(k.oldUntil).getTime() ? h`<div class="hint-xs">${t('old.until', { old: maskKey(k.prefix, k.oldLast4), until: fmt.dateTime(k.oldUntil) })}</div>` : ''}</td>
        <td class="ky-c-scopes" data-label="${t('col.scopes')}"><div class="ky-scopes">${k.scopes.map((sc) => h`<code class="mono">${sc}</code>`)}</div></td>
        <td class="ky-c-ips" data-label="${t('col.ips')}">${k.allowedIps && k.allowedIps.length ? h`<div class="ky-ips mono" translate="no">${k.allowedIps.map((ip) => h`<span>${ip}</span>`)}</div>` : h`<span class="hint-xs ${k.env === 'live' && k.status === 'active' ? 'warn-text' : ''}">${k.env === 'live' && k.status === 'active' ? t('ips.anySuggest') : t('ips.any')}</span>`}</td>
        <td class="nowrap ky-c-created">${fmt.dayMonth(k.createdAt)}<div class="hint-xs">${k.createdBy || '—'}</div></td>
        <td class="nowrap ky-c-status">${k.status === 'revoked' ? h`<span class="chip chip-err" tabindex="0" data-tip-key="keys.tip.revoked">${t('st.revokedOn', { date: fmt.dayMonth(k.revokedAt) })}</span>` : h`<span class="chip chip-ok" tabindex="0" data-tip-key="keys.tip.active">${t('st.active')}</span>`}<div class="hint-xs ky-used">${k.lastUsed ? fmt.relative(k.lastUsed) : t('used.never')}</div></td>
        <td class="num ky-c-act">${k.status === 'revoked'
          ? h`<button type="button" class="btn btn-sm btn-ghost" data-action="ky.revoked.hide" data-value="${k.id}">${s.hidden.includes(k.id) ? t('unhide') : t('hide')}</button>`
          : h`<button type="button" class="btn btn-sm btn-ghost btn-icon" data-action="ky.menu" data-value="${k.id}" aria-haspopup="menu" aria-expanded="false" aria-label="${t('menuFor', { name: k.name })}" data-tip-key="keys.menuTip">${icon('more')}</button>`}</td></tr>`)}</tbody></table></div>
      <div class="card-foot hint-xs">${t('foot')}</div></div>`
      : h`<div class="card"><div class="empty empty-center" role="status"><strong>${t('noMatch')}</strong><button type="button" class="btn btn-sm" data-action="ky.clear">${t('clear')}</button></div></div>`}`;
}

function whCard(ctx, wh) {
  const { t, html: h, icon, fmt } = ctx;
  const test = ctx.state.tests[wh.id];
  const st = wh.status;
  const ld = wh.lastDelivery;
  const steps = test ? [
    { k: 'sign', on: test.step >= 1, label: t('wt.sign') },
    { k: 'send', on: test.step >= 2, label: t('wt.send', { host: hostOf(wh.url) }) },
  ] : [];
  return h`<section class="card ky-wh ${st === 'failing' ? 'is-failing' : st === 'off' ? 'is-off' : ''}" aria-label="${hostOf(wh.url)}">
    <div class="ky-wh-h"><span class="ky-wh-ico">${icon('link', 'ico-sm')}</span>
      <div class="grow stack" style="gap:2px"><strong class="mono ky-url" translate="no">${wh.url}</strong>
        <div class="row-tight ky-evchips">${wh.events.map((e) => h`<code class="mono">${e}</code>`)}</div></div>
      ${st === 'active' ? h`<span class="chip chip-ok">${t('wst.active')}</span>` : st === 'failing' ? h`<span class="chip chip-err" tabindex="0" data-tip-key="keys.tip.failing">${t('wst.failing', { n: wh.failuresInRow })}</span>` : h`<span class="chip" tabindex="0" data-tip-key="keys.tip.off">${wh.failuresInRow >= 100 ? t('wst.autoOff') : t('wst.off')}</span>`}
      <button type="button" class="toggle" role="switch" data-action="wh.toggle" data-value="${wh.id}" aria-checked="${st !== 'off'}" aria-label="${t('wh.toggleFor', { host: hostOf(wh.url) })}"></button></div>
    <div class="ky-wh-b">
      <div class="wkv"><span class="k">${ctx.term(t('wh.secret'), 'signing_secret')}</span><strong class="mono" translate="no">${maskSecret(wh)}</strong>
        <button type="button" class="btn btn-sm btn-ghost" data-action="wh.rotate" data-value="${wh.id}">${icon('refresh', 'ico-sm')}${t('wh.rotate')}</button></div>
      <div class="wkv"><span class="k">${t('wh.last')}</span><span>${ld ? h`<span class="mono">${fmt.time(ld.at)}</span> · ${ld.timeout ? t('wh.timeout') : h`<span class="${ld.code >= 400 ? 'err-text' : 'ok-text'} strong">${ld.code}</span>${ld.ms ? ` · ${t('wt.ms', { ms: fmt.int(ld.ms) })}` : ''}`}` : t('wh.never')}</span><span></span></div>
      ${st === 'failing' ? h`<p class="hint-xs err-text">${t('wh.failingHint', { n: wh.failuresInRow, schedule: RETRY.map((x) => `${x} s`).join(' · ') })}</p>` : ''}
      ${st === 'off' && wh.failuresInRow >= 100 ? h`<p class="hint-xs">${t('wh.autoOffHint')}</p>` : ''}
      ${test ? h`<ol class="ky-test" aria-live="polite">${steps.map((x) => h`<li class="${x.on ? 'is-on' : ''}">${x.on ? icon('check', 'ico-xs') : raw('<span class="spin" aria-hidden="true"></span>')}<span>${x.label}</span></li>`)}
        ${test.step >= 3 ? h`<li class="is-res ${test.ok ? 'is-ok' : 'is-bad'}">${icon(test.ok ? 'check-circle' : 'alert-circle', 'ico-sm')}<span><strong>${test.code ? test.code : t('wt.noResp')}</strong> ${test.code ? t(`wt.code.${test.code}`) : ''} · ${t('wt.ms', { ms: fmt.int(test.ms) })} <span class="hint-xs">${t('wt.simulated')}</span>${test.ok ? '' : h`<br><span class="hint-xs">${t('wt.retryNote', { schedule: RETRY.map((x) => `${x} s`).join(' · ') })}</span>${test.ev ? h`<br>${reqIdLine(reqId(`keys/webhooks|${wh.id}|${test.code || 'timeout'}`), { cls: 'rq-left' })}` : ''}`}</span>
          <button type="button" class="linkbtn hint-xs" data-action="wh.test.view" data-value="${wh.id}">${t('wt.view')}</button></li>` : ''}</ol>` : ''}
      <div class="row ky-wh-a"><button type="button" class="btn btn-sm btn-navy" data-action="wh.test" data-value="${wh.id}" ${raw(test && test.step < 3 ? 'aria-busy="true"' : '')}>${test && test.step < 3 ? raw('<span class="spin" aria-hidden="true"></span>') : icon('send', 'ico-sm')}${t('wh.test')}</button>
        <button type="button" class="btn btn-sm" data-action="wh.edit" data-value="${wh.id}">${icon('edit', 'ico-sm')}${t('wh.edit')}</button>
        <a class="btn btn-sm btn-ghost" href="#/keys?tab=events&host=${encodeURIComponent(hostOf(wh.url))}" data-action="wh.events">${t('wh.deliveries')}</a></div>
    </div></section>`;
}

function verifyCard(ctx) {
  const { t, html: h, icon } = ctx;
  const v = ctx.state.verify;
  const whs = ctx.list('webhooks');
  if (!whs.length) return '';
  const whId = v.wh || whs[0].id;
  return h`<section class="card ky-verify" aria-labelledby="ky-v-h"><div class="card-head"><h2 id="ky-v-h">${t('ver.title')}</h2><a class="linkbtn hint-xs" href="#/help/article/webhooks-signature" data-action="wh.verify.help">${icon('book', 'ico-xs')}${t('ver.help')}</a></div>
    <div class="card-body stack-3">
      <p class="hint">${t('ver.how')}</p>
      <pre class="code ky-sigcode" translate="no">X-ANTS-Timestamp: ${v.ts || '…'}
X-ANTS-Signature: v1=HMAC-SHA256(secret, timestamp + "." + body)</pre>
      <div class="ky-v-grid">
        <label class="field"><span class="label">${t('ver.endpoint')}</span><select class="select" data-field="vWh" data-action="wh.verify.wh">${whs.map((w) => h`<option value="${w.id}" ${raw(whId === w.id ? 'selected' : '')}>${hostOf(w.url)} · ${maskSecret(w)}</option>`)}</select></label>
        <label class="field"><span class="label">X-ANTS-Timestamp</span><input class="input mono" data-field="vTs" data-action="wh.verify.ts" value="${v.ts || ''}" inputmode="numeric" translate="no"></label></div>
      <label class="field"><span class="label">${t('ver.body')}</span><textarea class="textarea mono ky-v-body" rows="3" data-field="vBody" data-action="wh.verify.body" spellcheck="false" translate="no">${v.payload || ''}</textarea></label>
      <label class="field"><span class="label">X-ANTS-Signature</span><input class="input mono" data-field="vSig" data-action="wh.verify.sig" value="${v.sig}" spellcheck="false" translate="no"></label>
      <div class="row"><button type="button" class="btn btn-navy btn-sm" data-action="wh.verify" ${raw(v.busy ? 'aria-busy="true"' : '')}>${v.busy ? raw('<span class="spin" aria-hidden="true"></span>') : icon('shield-check', 'ico-sm')}${t('ver.check')}</button>
        <button type="button" class="btn btn-sm btn-ghost" data-action="wh.verify.reset">${t('ver.reset')}</button>
        <span aria-live="polite">${v.result === 'ok' ? h`<span class="chip chip-ok">${icon('check')}${t('ver.ok')}</span>` : v.result === 'old' ? h`<span class="chip chip-warn">${icon('clock')}${t('ver.old')}</span>` : v.result === 'bad' ? h`<span class="chip chip-err">${icon('x')}${t('ver.bad')}</span>` : ''}</span></div>
      <p class="hint-xs">${t('ver.note', { schedule: RETRY.map((x) => `${x} s`).join(' · ') })}</p></div></section>`;
}

function failedCard(ctx) {
  const { t, html: h, icon } = ctx;
  const list = ctx.list('failedEvents');
  const rs = ctx.state.resending;
  return h`<section class="card ky-failed" aria-labelledby="ky-f-h"><div class="card-head"><h2 id="ky-f-h">${t('fail.title')}</h2>
      ${list.length ? h`<button type="button" class="btn btn-sm" data-action="wh.fail.resendall" ${raw(Object.keys(rs).length ? 'aria-busy="true"' : '')}>${icon('refresh', 'ico-sm')}${t('fail.resendAll', { n: list.length })}</button>` : ''}</div>
    ${list.length ? h`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>${t('fail.event')} · ${t('fail.endpoint')}</th><th class="num">${t('fail.attempts')}</th><th>${t('fail.reason')}</th><th><span class="sr-only">${t('col.actions')}</span></th></tr></thead>
      <tbody>${list.map((e) => h`<tr class="${rs[e.id] ? 'ky-resending' : ''}"><td><span class="mono">${e.event}</span><div><button type="button" class="linkbtn mono hint-xs" data-action="wh.fail.view" data-value="${e.id}" translate="no">${e.id}</button></div><div class="hint-xs mono">${e.endpoint}</div></td><td class="num mono">${e.attempts}<div class="hint-xs">${e.window}</div></td><td class="err-text">${reasonText(e.reason, t)}</td>
        <td class="num"><button type="button" class="btn btn-sm" data-action="wh.fail.resend" data-value="${e.id}" ${raw(rs[e.id] ? 'aria-busy="true"' : '')}>${rs[e.id] ? raw('<span class="spin" aria-hidden="true"></span>') : icon('send', 'ico-sm')}${t('fail.resend')}</button></td></tr>`)}</tbody></table></div>`
      : h`<div class="empty"><span class="hint">${icon('check-circle', 'ico-sm')} ${t('fail.none')}</span></div>`}</section>`;
}

function webhooksTab(ctx) {
  const { t, html: h, icon } = ctx;
  const whs = ctx.list('webhooks');
  if (!whs.length) {
    return h`<div class="card ky-empty"><div class="empty"><span class="art">${icon('link')}</span><h2>${t('wh.emptyTitle')}</h2><p class="hint">${t('wh.emptyBody')}</p>
      <div class="row"><button type="button" class="btn btn-primary" data-action="wh.empty.add">${icon('plus')}${t('wh.add')}</button></div></div></div>`;
  }
  return h`<div class="ky-wgrid"><div class="stack-4">${whs.map((w) => whCard(ctx, w))}${failedCard(ctx)}</div><div class="stack-4">${verifyCard(ctx)}</div></div>`;
}

function eventsTab(ctx) {
  const { t, html: h, icon, fmt } = ctx;
  const s = ctx.state;
  const all = eventsList(ctx);
  if (!all.length) {
    return h`<div class="card ky-empty"><div class="empty"><span class="art">${icon('activity')}</span><h2>${t('ev.emptyTitle')}</h2><p class="hint">${t('ev.emptyBody')}</p>
      <a class="btn btn-sm" href="#/keys?tab=webhooks" data-action="ev.empty.webhooks">${t('tab.webhooks')}</a></div></div>`;
  }
  const host = ctx.params.query.host || '';
  const q = s.evQ.trim().toLowerCase();
  const rows = all.filter((e) => (s.evStatus === 'all' || e.status === s.evStatus) && (!host || hostOf(e.url) === host) && (!q || e.id.toLowerCase().includes(q) || e.event.toLowerCase().includes(q) || (e.callId || '').toLowerCase().includes(q)));
  return h`<div class="row ky-filters">
      <label class="ky-search">${icon('search', 'ico-sm')}<input class="input mono" type="search" data-field="evQ" data-action="wh.ev.search" value="${s.evQ}" placeholder="evt_01JB… · call.completed" aria-label="${t('ev.searchAria')}" autocomplete="off" spellcheck="false"></label>
      <select class="select ky-sel" data-field="evStatus" data-action="wh.ev.status" aria-label="${t('ev.statusAria')}">${['all', 'delivered', 'retrying', 'failed'].map((k) => h`<option value="${k}" ${raw(s.evStatus === k ? 'selected' : '')}>${t(`ev.st.${k}`)}</option>`)}</select>
      ${host ? h`<span class="chip chip-navy mono">${host}<button type="button" class="chip-x" data-action="wh.ev.host" aria-label="${t('ev.clearHost')}">${icon('x', 'ico-xs')}</button></span>` : ''}
      <span class="grow"></span><span class="hint-xs">${t('ev.kept')}</span></div>
    ${rows.length ? h`<div class="card"><div class="tbl-wrap"><table class="tbl ky-evtbl"><thead><tr><th>${t('ev.time')}</th><th>${t('ev.event')} · ${t('ev.id')}</th><th>${t('ev.endpoint')}</th><th>${t('ev.status')}</th><th class="num">${t('ev.attempts')}</th><th class="num">${t('ev.ms')}</th></tr></thead>
      <tbody>${rows.slice(0, 40).map((e) => h`<tr class="${s.freshEv === e.id ? 'new-row' : ''}"><td class="mono">${fmt.time(e.at)}</td><td><span class="mono">${e.event}</span><div><button type="button" class="linkbtn mono hint-xs" data-action="wh.ev.row" data-value="${e.id}" translate="no">${e.id}</button></div></td>
        <td class="mono">${hostOf(e.url)}</td>
        <td><span class="chip ${e.status === 'delivered' ? 'chip-ok' : e.status === 'retrying' ? 'chip-warn' : 'chip-err'}">${e.code ? `${e.code} · ` : ''}${t(`ev.st.${e.status}`)}</span></td>
        <td class="num mono">${e.attempts}</td><td class="num mono">${fmt.int(e.ms)}</td></tr>`)}</tbody></table></div>
      <div class="card-foot hint-xs">${t('ev.foot', { n: fmt.int(rows.length), shown: fmt.int(Math.min(40, rows.length)) })}</div></div>`
      : h`<div class="card"><div class="empty empty-center" role="status"><strong>${t('ev.noMatch')}</strong><button type="button" class="btn btn-sm" data-action="wh.ev.clear">${t('clear')}</button></div></div>`}`;
}

// ---------- API request log (Keys › Requests) — benchmark: Stripe Workbench › Logs, Twilio Debugger ----------
// Sample data that reconciles with the tile: keyTiles.requests24h requests in 24 h, error4xxPct % of them 4xx and
// REQ_5XX 5xx. The demo keeps one page per filter (the latest rows); requests sent in this session (Connect › API
// test call, the OTP console) go on top and are counted in the totals. Bodies follow the Connect and OTP samples;
// numbers are masked, codes redacted, hosts are .example.
const PAGE = 40;
const REQ_5XX = 2;
const OLD_KEY_401 = 24; // the revoked key old-pos still polls once an hour → 24 of the day's 4xx
const RQ_STATUS = ['all', '2xx', '4xx', '5xx'];
const HTTP_TEXT = { 200: 'OK', 201: 'Created', 401: 'Unauthorized', 403: 'Forbidden', 409: 'Conflict', 422: 'Unprocessable Entity', 429: 'Too Many Requests', 503: 'Service Unavailable' };
const KEY_IP = { 'app-backend': ['203.0.113.10', '203.0.113.11'], 'delivery-system': ['198.51.100.23'], 'old-pos': ['198.51.100.77'] };
const CRM_HOOK = 'https://crm.example.com/ants/webhook';
const C1 = 'bc_01JBK7C1Q2';
const SAY_ETA = 'สวัสดีค่ะ พัสดุคำสั่งซื้อ 5120 จะถึงวันนี้ช่วง 13:00–15:00 น.';
const bucketOf = (status) => `${String(status)[0]}xx`;
const rqStatusOf = (params) => { const v = (params.query || {}).status; return RQ_STATUS.includes(v) ? v : 'all'; };
const errEn = (code) => { const e = ERRORS.find((x) => x.code === code); return e ? e.text.en.split(' · ')[0] : ''; };
const callBody = (to, say = SAY_ETA, extra = {}) => ({ from: '+662xxx1001', to, say, language: 'th-TH', webhook_url: CRM_HOOK, ...extra });
// The day's latest 4xx: [time, method, path, status, code, key, body]
const SAMPLE_4XX = [
  ['14:33:12', 'POST', '/voice/otp', 422, 'VOICE_4220', 'app-backend', { to: '+6681xxx12', template: 'otp-login', lang: 'th-TH' }],
  ['14:21:40', 'POST', '/voice/calls', 409, 'VOICE_4213', 'delivery-system', callBody('+6689xxx3021')],
  ['14:00:00', 'GET', '/voice/calls?limit=50', 401, 'HTTP 401', 'old-pos', null],
  ['13:47:05', 'POST', '/voice/calls', 403, 'VOICE_4204', 'delivery-system', callBody('+6698xxx3345')],
  ['13:00:00', 'GET', '/voice/calls?limit=50', 401, 'HTTP 401', 'old-pos', null],
  ['12:18:33', 'POST', '/voice/otp', 429, 'VOICE_4207', 'app-backend', { to: '+6696xxx9981', template: 'otp-payment-confirm', lang: 'th-TH' }],
  ['12:00:00', 'GET', '/voice/calls?limit=50', 401, 'HTTP 401', 'old-pos', null],
  ['11:26:10', 'POST', '/voice/calls', 422, 'VOICE_4220', 'delivery-system', callBody('+6685xxx')],
  ['11:00:00', 'GET', '/voice/calls?limit=50', 401, 'HTTP 401', 'old-pos', null],
  ['10:42:51', 'POST', '/voice/calls', 403, 'VOICE_4202', 'delivery-system', callBody('+65xxxx2210')],
  ['10:00:00', 'GET', '/voice/calls?limit=50', 401, 'HTTP 401', 'old-pos', null],
  ['09:15:27', 'POST', '/voice/calls', 403, 'VOICE_4204', 'delivery-system', callBody('+6683xxx7712')],
];
const SAMPLE_5XX = [
  ['03:12:44', 'POST', '/voice/otp', 503, 'app-backend', { to: '+6662xxx4410', template: 'otp-login', lang: 'th-TH' }],
  ['03:12:41', 'POST', '/voice/otp', 503, 'app-backend', { to: '+6662xxx4410', template: 'otp-login', lang: 'th-TH' }],
];

function keyRef(ctx, name) {
  const k = ctx.list('apiKeys').find((x) => x.name === name);
  return k ? { name: k.name, prefix: k.prefix, last4: k.last4, status: k.status, env: k.env } : { name, prefix: 'ak_live_', last4: '0002', status: 'active', env: 'live' };
}
function sessionKey(ctx, env, sub) {
  const ks = ctx.list('apiKeys').filter((k) => k.status === 'active' && k.env === (env === 'sandbox' ? 'sandbox' : 'live'));
  const k = ks.find((x) => x.sub === sub) || ks[0];
  if (k) return { name: k.name, prefix: k.prefix, last4: k.last4, status: k.status, env: k.env };
  return env === 'sandbox' ? { name: 'sandbox', prefix: 'ak_test_', last4: '0001', status: 'active', env: 'sandbox' } : { name: 'live', prefix: 'ak_live_', last4: '0002', status: 'active', env: 'live' };
}
const mkReq = (r) => ({ ...r, id: reqId(`${r.method} ${r.path}|${r.at}|${r.key.name}`) });
const callSummary = (c) => ({ id: c.id, direction: c.direction, from: e164(c.from), to: e164(c.to), status: c.status, talk_seconds: c.sec || 0 });

/** Every request the log knows: the seeded day (busy account) plus this session's requests. Newest first. */
function requestsList(ctx) {
  const { fmt } = ctx;
  const out = [];
  const calls = ctx.list('calls');
  const busy = !!ctx.store.get('keyTiles') && !firstRun(ctx);
  // this session: Connect › API test calls and OTP-console sends (calls placed after the demo clock started)
  calls.filter((c) => new Date(c.ts).getTime() > DEMO_NOW && c.source && ((c.source.type === 'test-call' && c.source.ref === 'connect') || c.source.type === 'otp' || c.source.type === 'notification')).forEach((c) => {
    const at = new Date(c.ts).getTime() - 900;
    const key = sessionKey(ctx, c.env, c.sub);
    if (c.source.type === 'otp') {
      out.push(mkReq({ at, method: 'POST', path: '/voice/otp', status: 201, ms: 164, key, ip: '203.0.113.10', sub: c.sub, callId: c.id, session: true,
        body: { to: e164(c.to), template: c.source.ref, lang: LANGS[getLang()].tts }, res: { id: `otp_${c.id.slice(5)}`, status: 'queued', expires_at: fmt.iso(at + 300000) } }));
    } else {
      const lang = getLang();
      const body = c.source.type === 'test-call'
        ? { from: SANDBOX_CALLER_E164, to: '+668XXXX0101', say: tIn(lang, 'dialer.tpl.test.text'), language: LANGS[lang].tts, webhook_url: DEFAULT_WEBHOOK }
        : { to: e164(c.to), template: c.source.ref, lang: LANGS[lang].tts };
      out.push(mkReq({ at, method: 'POST', path: '/voice/calls', status: 201, ms: 188, key, ip: '203.0.113.10', sub: c.sub, callId: c.id, session: true, body, res: { id: c.id, status: 'queued' } }));
    }
  });
  if (!busy) return out.sort((a, b) => b.at - a.at);
  const seeded = calls.filter((c) => new Date(c.ts).getTime() <= DEMO_NOW);
  const app = keyRef(ctx, 'app-backend');
  const dv = keyRef(ctx, 'delivery-system');
  const old = keyRef(ctx, 'old-pos');
  // API-placed calls in the call log → the request that created each of them
  seeded.forEach((c, i) => {
    const t0 = new Date(c.ts).getTime();
    const type = c.source && c.source.type;
    if (type === 'otp') {
      const otpId = `otp_${c.id.slice(5)}`;
      out.push(mkReq({ at: t0 - 1400, method: 'POST', path: '/voice/otp', status: 201, ms: 150 + ((i * 29) % 70), key: app, ip: KEY_IP['app-backend'][i % 2], sub: c.sub, callId: c.id,
        body: { to: e164(c.to), template: c.source.ref, lang: 'th-TH' }, res: { id: otpId, status: 'queued', expires_at: fmt.iso(t0 - 1400 + 300000) } }));
      if (c.status === 'completed') out.push(mkReq({ at: t0 + (c.sec || 20) * 1000 + 6000, method: 'POST', path: `/voice/otp/${otpId}/verify`, status: 200, ms: 40 + ((i * 13) % 30), key: app, ip: KEY_IP['app-backend'][(i + 1) % 2], sub: c.sub, redacted: true,
        body: { code: '[redacted]' }, res: { id: otpId, status: 'approved', call_id: c.id } }));
    } else if (type === 'notification') {
      out.push(mkReq({ at: t0 - 1100, method: 'POST', path: '/voice/calls', status: 201, ms: 176, key: dv, ip: KEY_IP['delivery-system'][0], sub: c.sub, callId: c.id, body: callBody(e164(c.to)), res: { id: c.id, status: 'queued' } }));
      if (c.status === 'canceled') out.push(mkReq({ at: t0 + 2400, method: 'POST', path: `/voice/calls/${c.id}/cancel`, status: 200, ms: 61, key: dv, ip: KEY_IP['delivery-system'][0], sub: c.sub, callId: c.id, body: null, res: { id: c.id, status: 'canceled' } }));
    } else if (type === 'click-to-call') {
      out.push(mkReq({ at: t0 - 1300, method: 'POST', path: '/voice/calls', status: 201, ms: 191, key: dv, ip: KEY_IP['delivery-system'][0], sub: c.sub, callId: c.id,
        body: { from: e164(c.from), to: '+6681xxx2040', connect: e164(c.to), webhook_url: CRM_HOOK }, res: { id: c.id, status: 'queued' } }));
    }
  });
  // delivery-system polls the call list every 15 s and the running campaign every minute (last used 14:33)
  const camp = ctx.list('campaigns').find((x) => x.id === C1);
  for (let s = atTime('14:20:00'), i = 0; s <= atTime('14:33:45'); s += 15000, i += 1) {
    const recent = seeded.filter((c) => new Date(c.ts).getTime() <= s).slice(0, 2).map(callSummary);
    out.push(mkReq({ at: s, method: 'GET', path: '/voice/calls?limit=100', status: 200, ms: 38 + ((i * 17) % 45), key: dv, ip: KEY_IP['delivery-system'][0], sub: dv.sub, body: null, res: { object: 'list', data: recent, has_more: true } }));
  }
  if (camp) {
    for (let s = atTime('14:20:45'), i = 0; s <= atTime('14:33:00'); s += 60000, i += 1) {
      out.push(mkReq({ at: s, method: 'GET', path: `/voice/broadcasts/${C1}`, status: 200, ms: 44 + ((i * 11) % 30), key: dv, ip: KEY_IP['delivery-system'][0], body: null,
        res: { id: C1, status: camp.status, progress_pct: camp.progressPct, dialled: camp.progress ? camp.progress.dialled : undefined, answered: camp.progress ? camp.progress.answered : undefined } }));
    }
  }
  SAMPLE_4XX.forEach(([hms, method, path, status, code, keyName, body], i) => {
    const key = keyName === 'old-pos' ? old : keyName === 'app-backend' ? app : dv;
    const err = code === 'HTTP 401' ? { error: 'unauthorized', detail: 'API key revoked' } : { error: code, detail: errEn(code) };
    const r = mkReq({ at: atTime(hms) + (i % 3) * 137, method, path, status, ms: 22 + ((i * 7) % 30), key, ip: KEY_IP[keyName][0], code, body, err });
    r.res = { ...err, request_id: r.id };
    out.push(r);
  });
  SAMPLE_5XX.forEach(([hms, method, path, status, keyName, body], i) => {
    const r = mkReq({ at: atTime(hms) + i * 91, method, path, status, ms: 31 - i * 2, key: app, ip: KEY_IP[keyName][i % 2], body, err: { error: 'service_unavailable', detail: 'Temporarily unavailable. Nothing was created; safe to retry.' } });
    r.res = { ...r.err, request_id: r.id };
    out.push(r);
  });
  return out.filter((r) => r.at <= DEMO_NOW || r.session).sort((a, b) => b.at - a.at);
}

/** Totals for the tile and the tab: the seeded day plus this session's requests. */
function reqTotals(ctx, list = null) {
  const kt = ctx.store.get('keyTiles');
  const busy = !!kt && !firstRun(ctx);
  const session = (list || requestsList(ctx)).filter((r) => r.session);
  const s4 = session.filter((r) => bucketOf(r.status) === '4xx').length;
  const s5 = session.filter((r) => bucketOf(r.status) === '5xx').length;
  const base = busy ? kt.requests24h : 0;
  const n4 = (busy ? Math.round((kt.requests24h * kt.error4xxPct) / 100) : 0) + s4;
  const n5 = (busy ? REQ_5XX : 0) + s5;
  const total = base + session.length;
  return { total, n2: total - n4 - n5, n4, n5, all: total };
}

function requestsTab(ctx) {
  const { t, html: h, icon, fmt } = ctx;
  const all = requestsList(ctx);
  const tot = reqTotals(ctx, all);
  if (!all.length) {
    return h`<div class="card ky-empty"><div class="empty"><span class="art">${icon('activity')}</span><h2>${t('rq.emptyTitle')}</h2><p class="hint">${t('rq.emptyBody')}</p>
      <div class="row"><a class="btn btn-primary" href="#/connect/api" data-action="rq.empty.connect">${icon('send')}${t('rq.emptyCta')}</a></div></div></div>`;
  }
  const st = rqStatusOf(ctx.params);
  const q = ctx.state.rqQ.trim().toLowerCase();
  const inBucket = all.filter((r) => st === 'all' || bucketOf(r.status) === st);
  const rows = inBucket.filter((r) => !q || r.id.toLowerCase().includes(q) || r.path.toLowerCase().includes(q) || String(r.status) === q || (r.code || '').toLowerCase().includes(q) || r.key.name.includes(q)).slice(0, PAGE);
  const count = st === 'all' ? tot.all : tot[`n${st[0]}`];
  const oldKey = st === '4xx' && all.some((r) => r.key.name === 'old-pos' && r.status === 401);
  const label = (k) => (k === 'all' ? t('rq.all') : k);
  return h`<div class="row ky-filters">
      <div class="seg ky-rq-seg" role="group" aria-label="${t('rq.statusAria')}">${RQ_STATUS.map((k) => h`<button type="button" data-action="rq.status" data-value="${k}" aria-pressed="${st === k}"><span>${label(k)}</span> <span class="ky-rq-n tnum">${fmt.int(k === 'all' ? tot.all : tot[`n${k[0]}`])}</span></button>`)}</div>
      <label class="ky-search">${icon('search', 'ico-sm')}<input class="input mono" type="search" data-field="rqQ" data-action="rq.search" value="${ctx.state.rqQ}" placeholder="req_01JB… · /voice/otp · 422" aria-label="${t('rq.searchAria')}" autocomplete="off" spellcheck="false"></label>
      <span class="grow"></span><span class="hint-xs">${t('ev.kept')}</span></div>
    ${oldKey ? h`<div class="note note-warn">${icon('key')}<span>${t('rq.oldKey', { n: fmt.int(OLD_KEY_401), total: fmt.int(tot.n4), name: 'old-pos' })} <a class="linkbtn" href="#/keys?tab=keys" data-action="rq.oldkey">${t('rq.oldKeyLink')}</a></span></div>` : ''}
    ${rows.length ? h`<div class="card"><div class="tbl-wrap" data-pin="none"><table class="tbl ky-rqtbl"><thead><tr><th>${t('rq.col.time')}</th><th>${t('rq.col.req')}</th><th>${t('rq.col.status')}</th><th class="num">${t('rq.col.ms')}</th><th class="ky-c-rqkey">${t('rq.col.key')}</th><th>${t('rq.col.id')}</th></tr></thead>
      <tbody>${rows.map((r) => h`<tr class="${r.status >= 400 ? 'ky-rq-bad' : ''} ${r.session ? 'new-row' : ''}" data-req="${r.id}">
        <td class="mono nowrap ky-rq-time">${fmt.time(r.at)}</td>
        <td class="ky-rq-req"><a class="ky-rq-link" href="#/keys?tab=requests${st !== 'all' ? `&status=${st}` : ''}&req=${r.id}" data-action="rq.row" translate="no"><span class="ky-rq-m">${r.method}</span> <span class="mono">${r.path}</span></a></td>
        <td class="nowrap ky-rq-st"><span class="chip ${r.status >= 500 ? 'chip-err' : r.status >= 400 ? 'chip-warn' : 'chip-ok'}" translate="no">${r.status}</span>${r.code ? h` <code class="mono hint-xs" translate="no">${r.code}</code>` : ''}</td>
        <td class="num mono nowrap ky-rq-ms">${t('wt.ms', { ms: fmt.int(r.ms) })}</td>
        <td class="ky-c-rqkey"><span class="mono" translate="no">${r.key.name}</span>${r.key.status === 'revoked' ? h` <span class="chip chip-err">${t('rq.revoked')}</span>` : ''}</td>
        <td class="ky-rq-id">${reqIdLine(r.id)}</td></tr>`)}</tbody></table></div>
      <div class="card-foot hint-xs">${t('rq.foot', { shown: fmt.int(rows.length), n: fmt.int(q ? inBucket.length : count) })} · ${t('rq.sample')}</div></div>`
      : h`<div class="card"><div class="empty empty-center" role="status"><strong>${q ? t('rq.noMatch') : t('rq.noneStatus', { status: label(st) })}</strong><button type="button" class="btn btn-sm" data-action="rq.clear">${t('clear')}</button></div></div>`}`;
}

// The request drawer follows ?req= (linkable, survives reload and Back).
const RQ = { handle: null, id: null, programmatic: false };

function rqBody(ctx, r) {
  const { t, html: h, icon, fmt } = ctx;
  const call = r.callId ? ctx.list('calls').find((c) => c.id === r.callId) : null;
  const errLoc = r.code ? ERRORS.find((x) => x.code === r.code) : null;
  const reqText = `${r.method} ${API_BASE}${r.path}\nAuthorization: Bearer ${maskKey(r.key.prefix, r.key.last4)}${r.body ? `\nContent-Type: application/json\n\n${JSON.stringify(r.body, null, 2)}` : ''}`;
  const resText = `HTTP ${r.status} ${HTTP_TEXT[r.status] || ''}\nRequest-Id: ${r.id}\nContent-Type: application/json\n\n${JSON.stringify(r.res, null, 2)}`;
  return h`<div class="stack-3 ky-rq-d">
    <div class="row"><span class="chip ${r.status >= 500 ? 'chip-err' : r.status >= 400 ? 'chip-warn' : 'chip-ok'}" translate="no">${r.status} ${HTTP_TEXT[r.status] || ''}</span><span class="hint-xs">${fmt.dateTime(r.at)} · ${t('wt.ms', { ms: fmt.int(r.ms) })}</span></div>
    <div>${reqIdLine(r.id, { hint: r.status >= 400, cls: 'rq-left' })}</div>
    ${r.status >= 400 ? h`<div class="note ${r.status >= 500 ? 'note-err' : 'note-warn'}">${icon('alert-circle')}<div class="grow"><strong class="mono" translate="no">${r.code || r.status}</strong> · ${errLoc ? ctx.loc(errLoc.text) : t('rq.d.5xx')}
      ${r.key.status === 'revoked' ? h`<br><span class="hint-xs">${t('rq.d.revokedKey', { name: r.key.name })}</span>` : ''}
      <div><a class="linkbtn hint-xs" href="#/help/errors" data-action="rq.d.errors">${t('rq.d.errorsLink')}</a></div></div></div>` : ''}
    <div class="ky-rq-kv">
      <div class="kv"><span class="k">${t('rq.col.key')}</span><span class="v mono" translate="no">${r.key.name} · ${maskKey(r.key.prefix, r.key.last4)}</span></div>
      <div class="kv"><span class="k">${t('rq.d.ip')}</span><span class="v mono" translate="no">${r.ip || '—'}</span></div>
      ${call ? h`<div class="kv"><span class="k">${t('rq.d.call')}</span><span class="v"><a class="linkbtn mono" href="#/logs?call=${call.id}" data-action="rq.d.call" translate="no">${call.id}</a></span></div>` : ''}
    </div>
    <span class="label">${t('insp.request')}</span><pre class="code ky-pre" translate="no">${reqText}</pre>
    ${r.redacted ? h`<p class="hint-xs">${t('rq.d.redacted')}</p>` : ''}
    <span class="label">${t('insp.response')}</span><pre class="code ky-pre" translate="no">${resText}</pre>
    <p class="hint-xs">${t('insp.note')}</p></div>`;
}

function openReq(ctx, r) {
  if (RQ.handle && RQ.id === r.id) return;
  if (RQ.handle) { RQ.id = r.id; RQ.handle.setTitle(`${r.method} ${r.path}`); RQ.handle.setBody(rqBody(ctx, r)); return; }
  RQ.id = r.id;
  const st = rqStatusOf(ctx.params);
  RQ.handle = ctx.ui.drawer({
    title: `${r.method} ${r.path}`, wide: true, className: 'ky-rq-drawer',
    body: rqBody(ctx, r),
    actions: { 'rq.d.errors': noop, 'rq.d.call': noop },
    buttons: [
      { label: ctx.t('rq.d.copyRes'), icon: 'copy', action: 'rq.d.copyres', onClick: (hd, btn) => { const cur = requestsList(ctx).find((x) => x.id === RQ.id) || r; ctx.ui.copy(JSON.stringify(cur.res, null, 2), btn); return false; } },
      { label: ctx.t('common.close'), kind: 'navy', action: 'rq.d.close' },
    ],
    onClose: () => {
      const was = RQ.id;
      RQ.handle = null;
      RQ.id = null;
      if (RQ.programmatic) { RQ.programmatic = false; return; }
      if (/^#\/keys\?(.*&)?tab=requests/.test(location.hash) && /[?&]req=/.test(location.hash)) {
        ctx.state.focusReq = was;
        ctx.go(`keys?tab=requests${st !== 'all' ? `&status=${st}` : ''}`, { replace: true });
      }
    },
  });
}
function closeReq() {
  if (!RQ.handle) return;
  RQ.programmatic = true;
  RQ.handle.close();
}

export function render(ctx) {
  const { html: h } = ctx;
  const tab = tabOf(ctx.params);
  const body = tab === 'webhooks' ? webhooksTab(ctx) : tab === 'events' ? eventsTab(ctx) : tab === 'requests' ? requestsTab(ctx) : keysTab(ctx);
  return h`<div class="page ky">${header(ctx, tab)}${tiles(ctx)}${tabs(ctx, tab)}<div class="ky-body" role="tabpanel">${body}</div></div>`;
}

// ---------- modals ----------
function createKeyModal(ctx) {
  const { t, html: h, icon } = ctx;
  const subs = ctx.list('subAccounts');
  const liveLocked = firstRun(ctx);
  const d = { name: '', env: liveLocked ? 'sandbox' : 'live', scopes: ['calls:write', 'read'], sub: subs[0] ? subs[0].id : '', ips: '', expiry: 'never', errs: {} };
  const body = () => h`<div class="stack-3">
    <label class="field"><span class="label">${t('cm.name')}</span><input class="input mono" data-m="name" value="${d.name}" placeholder="backend-server" maxlength="32" spellcheck="false" translate="no" autocomplete="off" aria-invalid="${d.errs.name ? 'true' : 'false'}" aria-describedby="ky-cm-name-h">
      ${d.errs.name ? h`<span class="field-err" id="ky-cm-name-h">${d.errs.name}</span>` : h`<span class="hint-xs" id="ky-cm-name-h">${t('cm.nameHint')}</span>`}</label>
    <div class="field"><span class="label">${ctx.term(t('cm.env'), 'env')}</span><div class="seg" role="group" aria-label="${t('cm.env')}">
      <button type="button" data-action="ky.cm.env" data-value="sandbox" aria-pressed="${d.env === 'sandbox'}">${t('top.sandbox')}</button>
      <button type="button" data-action="ky.cm.env" data-value="live" aria-pressed="${d.env === 'live'}" ${raw(liveLocked ? 'aria-disabled="true" aria-describedby="ky-cm-live-h"' : '')}>${t('top.live')}</button></div>
      ${liveLocked ? h`<span class="hint-xs" id="ky-cm-live-h">${t('cm.liveLocked')}</span>` : h`<span class="hint-xs">${d.env === 'live' ? t('cm.liveHint') : t('cm.sandboxHint')}</span>`}</div>
    <fieldset class="ky-fs"><legend class="label">${ctx.term(t('cm.scopes'), 'scope')}</legend><div class="ky-checks">${SCOPES.map((sc) => h`<label class="check"><input type="checkbox" data-m="scope" value="${sc}" ${raw(d.scopes.includes(sc) ? 'checked' : '')}><code class="mono">${sc}</code><span class="hint-xs">${t(`scope.${sc.replace(':', '_')}`)}</span></label>`)}</div>
      ${d.errs.scopes ? h`<span class="field-err">${d.errs.scopes}</span>` : ''}</fieldset>
    ${subs.length > 1 ? h`<label class="field"><span class="label">${ctx.term(t('cm.sub'), 'subaccount')}</span><select aria-label="${t('cm.sub')}" class="select" data-m="sub">${subs.map((x) => h`<option value="${x.id}" ${raw(d.sub === x.id ? 'selected' : '')}>${ctx.loc(x.name)}</option>`)}</select></label>` : ''}
    <label class="field"><span class="label">${ctx.term(t('cm.ips'), 'ip_allow')} <span class="opt">${t('common.optional')}</span></span><textarea aria-label="${t('cm.ips')}" class="textarea mono" rows="2" data-m="ips" placeholder="203.0.113.10, 203.0.113.0/28" spellcheck="false" translate="no" aria-invalid="${d.errs.ips ? 'true' : 'false'}">${d.ips}</textarea>
      ${d.errs.ips ? h`<span class="field-err">${d.errs.ips}</span>` : h`<span class="hint-xs">${t('cm.ipsHint')}</span>`}</label>
    <label class="field"><span class="label">${t('cm.expiry')}</span><select class="select" data-m="expiry">${['never', '90d', '1y'].map((x) => h`<option value="${x}" ${raw(d.expiry === x ? 'selected' : '')}>${t(`cm.exp.${x}`)}</option>`)}</select></label>
    <p class="hint-xs">${icon('info', 'ico-xs')} ${t('cm.once')}</p></div>`;
  const read = (hd) => {
    const q = (k) => hd.el.querySelector(`[data-m="${k}"]`);
    d.name = q('name').value.trim().toLowerCase();
    d.scopes = [...hd.el.querySelectorAll('[data-m="scope"]:checked')].map((x) => x.value);
    if (q('sub')) d.sub = q('sub').value;
    d.ips = q('ips').value;
    d.expiry = q('expiry').value;
  };
  const m = ctx.ui.modal({
    title: t('cm.title'), size: 'md', body: body(),
    actions: {
      'ky.cm.env': (el, ev, hd) => { read(hd); d.env = el.dataset.value; hd.setBody(body()); const b = hd.el.querySelector(`[data-action="ky.cm.env"][data-value="${d.env}"]`); if (b) b.focus(); },
    },
    buttons: [
      { label: t('common.cancel') },
      { label: t('cm.create'), kind: 'primary', icon: 'key', onClick: (hd) => {
        read(hd);
        d.errs = {};
        if (!KEY_RE.test(d.name)) d.errs.name = t('cm.nameErr');
        else if (ctx.list('apiKeys').some((k) => k.name === d.name && k.status === 'active')) d.errs.name = t('cm.nameTaken');
        if (!d.scopes.length) d.errs.scopes = t('cm.scopesErr');
        const ips = d.ips.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
        if (ips.some((ip) => !IP_RE.test(ip))) d.errs.ips = t('cm.ipsErr');
        if (Object.keys(d.errs).length) { hd.setBody(body()); const e = hd.el.querySelector('[aria-invalid="true"]'); if (e) e.focus(); return false; }
        createKey(ctx, { ...d, ips });
        return true;
      } },
    ],
  });
  return m;
}

function createKey(ctx, d) {
  const { t } = ctx;
  ctx.state.creating = true;
  ctx.state.shown = null;
  ctx.rerender();
  soon(ctx, (s) => {
    const live = d.env === 'live';
    const rec = { id: newId('key'), name: d.name, prefix: live ? 'ak_live_' : 'ak_test_', last4: live ? '0002' : '0001', env: live ? 'live' : 'sandbox', scopes: d.scopes, sub: d.sub || null, allowedIps: d.ips, createdAt: new Date(nowMs()).toISOString().slice(0, 10), createdBy: ctx.store.get('user.name'), lastUsed: null, status: 'active', expiry: d.expiry };
    ctx.store.push('apiKeys', rec, { prepend: true });
    audit('key.created', { name: rec.name, env: rec.env }, rec.id);
    setStep('connect', 'done');
    s.creating = false;
    s.shown = { keyId: rec.id, value: live ? DEMO_KEY_LIVE : DEMO_KEY_SANDBOX, kind: 'create', saved: false };
    s.fresh = rec.id;
    ctx.ui.toast(t('toast.T07', { name: rec.name }), { kind: 'success' });
    redraw(ctx);
  }, 600);
}

async function rotateKey(ctx, k) {
  const { t, fmt } = ctx;
  const until = nowMs() + 86400000;
  const ok = await ctx.ui.confirm({
    title: t('rot.title', { name: k.name }), body: t('rot.body'),
    consequences: [t('rot.c1'), t('rot.c2', { until: fmt.dateTime(until) }), t('rot.c3')],
    confirmLabel: t('rot.yes'), cancelLabel: t('rot.no'), danger: true, typed: k.name,
  });
  if (!ok) return;
  ctx.state.seq += 1;
  const n = String(ctx.state.seq).padStart(4, '0');
  ctx.store.update('apiKeys', (list) => list.map((x) => (x.id === k.id ? { ...x, oldLast4: x.last4, last4: n, oldUntil: new Date(until).toISOString() } : x)));
  audit('key.rotated', { name: k.name }, k.id);
  ctx.state.shown = { keyId: k.id, value: `${k.prefix}DEMO_${n}_not_a_real_key`, kind: 'rotate', saved: false };
  ctx.state.fresh = k.id;
  ctx.ui.toast(t('toast.T09', { name: k.name }), { kind: 'success' });
}

async function revokeKey(ctx, k) {
  const { t, fmt } = ctx;
  const ok = await ctx.ui.confirm({
    title: t('rev.title', { name: k.name }), body: t('rev.body'),
    consequences: [t('rev.c1'), t('rev.c2', { sub: ctx.ui.describe.sub(k.sub), used: k.lastUsed ? fmt.relative(k.lastUsed) : t('used.never') }), t('rev.c3')],
    confirmLabel: t('rev.yes'), cancelLabel: t('rev.no'), danger: true, typed: k.name,
  });
  if (!ok) return;
  ctx.store.update('apiKeys', (list) => list.map((x) => (x.id === k.id ? { ...x, status: 'revoked', revokedAt: new Date(nowMs()).toISOString(), oldUntil: null } : x)));
  if (ctx.state.shown && ctx.state.shown.keyId === k.id) ctx.state.shown = null;
  audit('key.revoked', { name: k.name }, k.id);
  ctx.ui.toast(t('toast.T08', { name: k.name }), { kind: 'success' });
}

function webhookModal(ctx, wh = null) {
  const { t, html: h, icon } = ctx;
  const subs = ctx.list('subAccounts');
  const d = { url: wh ? wh.url : 'https://', events: wh ? wh.events.slice() : ['call.completed'], sub: subs[0] ? subs[0].id : '', err: null, evErr: null };
  let created = null;
  const form = () => h`<div class="stack-3">
    <label class="field"><span class="label">${t('wm.url')}</span><input class="input mono" data-m="url" value="${d.url}" inputmode="url" spellcheck="false" translate="no" autocomplete="off" aria-invalid="${d.err ? 'true' : 'false'}" aria-describedby="ky-wm-h">
      ${d.err ? h`<span class="field-err" id="ky-wm-h">${d.err}</span>` : h`<span class="hint-xs" id="ky-wm-h">${t('wm.urlHint')}</span>`}</label>
    <fieldset class="ky-fs"><legend class="label">${t('wm.events')}</legend><div class="ky-checks">${EVENTS.map((e) => h`<label class="check"><input type="checkbox" data-m="ev" value="${e}" ${raw(d.events.includes(e) ? 'checked' : '')}><code class="mono">${e}</code><span class="hint-xs">${t(`wev.${e.replace(/[.*]/g, (c) => (c === '.' ? '_' : 'all'))}`)}</span></label>`)}</div>
      ${d.evErr ? h`<span class="field-err">${d.evErr}</span>` : ''}</fieldset>
    ${!wh && subs.length > 1 ? h`<label class="field"><span class="label">${t('cm.sub')}</span><select class="select" data-m="sub">${subs.map((x) => h`<option value="${x.id}">${ctx.loc(x.name)}</option>`)}</select></label>` : ''}
    <p class="hint-xs">${t('wm.retry', { schedule: RETRY.map((x) => `${x} s`).join(' · ') })}</p></div>`;
  const secretView = (w) => h`<div class="stack-3"><div class="note note-ok">${icon('check-circle')}<span>${t('wm.added', { host: hostOf(w.url) })}</span></div>
    <span class="label">${ctx.term(t('wh.secret'), 'signing_secret')}</span>
    <div class="input-group"><code class="code-inline mono grow" translate="no">${secretOf(w)}</code><button type="button" class="btn btn-sm" data-action="wh.secret.copy">${icon('copy', 'ico-sm')}${t('common.copy')}</button></div>
    <span class="hint-xs">${t('wm.secretOnce')}</span></div>`;
  const m = ctx.ui.modal({
    title: wh ? t('wm.editTitle', { host: hostOf(wh.url) }) : t('wm.addTitle'), size: 'md', body: form(),
    actions: {
      'wh.secret.copy': (el) => { if (created) ctx.ui.copy(secretOf(created), el); },
    },
    buttons: [
      { label: t('common.cancel') },
      { label: wh ? t('wm.save') : t('wm.add'), kind: 'navy', icon: wh ? 'check' : 'plus', onClick: (hd) => {
        if (created) return true;
        d.url = hd.el.querySelector('[data-m="url"]').value.trim();
        d.events = [...hd.el.querySelectorAll('[data-m="ev"]:checked')].map((x) => x.value);
        const sub = hd.el.querySelector('[data-m="sub"]');
        if (sub) d.sub = sub.value;
        d.err = URL_RE.test(d.url) ? null : t('wm.urlErr');
        d.evErr = d.events.length ? null : t('wm.evErr');
        if (d.err || d.evErr) { hd.setBody(form()); const e = hd.el.querySelector('[aria-invalid="true"]'); if (e) e.focus(); return false; }
        if (wh) {
          ctx.store.update('webhooks', (list) => list.map((x) => (x.id === wh.id ? { ...x, url: d.url, events: d.events } : x)));
          audit('webhook.updated', { host: hostOf(d.url) }, wh.id);
          ctx.ui.toast(t('toast.T02'), { kind: 'success', sub: hostOf(d.url) });
          return true;
        }
        ctx.state.seq += 1;
        created = { id: newId('wh'), url: d.url, events: d.events, sub: d.sub, secretLast4: `${String(ctx.state.seq).padStart(2, '0')}d${ctx.state.seq % 10}`, status: 'active', failuresInRow: 0, lastDelivery: null };
        ctx.store.push('webhooks', created);
        audit('webhook.added', { host: hostOf(d.url) }, created.id);
        hd.setBody(secretView(created));
        hd.setButtons([{ label: t('wm.saved'), kind: 'navy', icon: 'check' }]);
        return false;
      } },
    ],
  });
  return m;
}

function payloadModal(ctx, ev) {
  const { t, html: h, icon, fmt } = ctx;
  const payload = JSON.stringify(payloadOf(ctx, ev), null, 2);
  const ts = Math.floor(new Date(ev.at).getTime() / 1000);
  const attempts = Array.from({ length: Math.min(ev.attempts, 6) }, (_, i) => ({ n: i + 1, at: new Date(new Date(ev.at).getTime() + RETRY.slice(0, i).reduce((a, b) => a + b, 0) * 1000), ok: ev.status === 'delivered' && i === ev.attempts - 1 }));
  const respBody = ev.status === 'delivered' ? '{"ok":true}' : ev.code === 503 ? '<html><body>503 Service Unavailable</body></html>' : '';
  ctx.ui.modal({
    title: t('insp.title', { id: ev.id }), size: 'lg',
    body: h`<div class="stack-3">
      <div class="row"><span class="chip ${ev.status === 'delivered' ? 'chip-ok' : ev.status === 'retrying' ? 'chip-warn' : 'chip-err'}">${ev.code ? `${ev.code} · ` : ''}${t(`ev.st.${ev.status}`)}</span><span class="hint-xs">${fmt.dateTime(ev.at)} · ${t('ev.attemptsN', { count: ev.attempts, n: ev.attempts })}${ev.reason ? ` · ${reasonText(ev.reason, t)}` : ''}</span></div>
      <span class="label">${t('insp.request')}</span>
      <pre class="code ky-pre" translate="no">POST ${ev.url}
Content-Type: application/json
User-Agent: ANTS-Webhooks/1.0
X-ANTS-Event-Id: ${ev.id}
X-ANTS-Timestamp: ${ts}
X-ANTS-Signature: v1=${'0'.repeat(8)}demo${'0'.repeat(8)}signature</pre>
      <span class="label">${t('insp.payload')}</span><pre class="code ky-pre" translate="no">${payload}</pre>
      <span class="label">${t('insp.response')}</span><pre class="code ky-pre" translate="no">${ev.code ? `HTTP ${ev.code} · ${fmt.int(ev.ms)} ms\n${respBody}` : t('insp.noResponse', { ms: fmt.int(ev.ms) })}</pre>
      <span class="label">${t('insp.attempts')}</span>
      <ol class="timeline">${attempts.map((a) => h`<li><span class="tdot ${a.ok ? '' : ev.status === 'delivered' ? '' : 'err'}">${icon(a.ok || ev.status === 'delivered' ? 'check' : 'x')}</span><span>${t('insp.attempt', { n: a.n })} ${a.ok ? h`<code>${ev.code}</code>` : ev.status === 'delivered' ? '' : h`<code>${ev.code || 'timeout'}</code>`}</span><time>${fmt.time(a.at)}</time></li>`)}</ol>
      <p class="hint-xs">${t('insp.note')}</p></div>`,
    buttons: [
      { label: t('insp.copy'), icon: 'copy', onClick: (hd, btn) => { ctx.ui.copy(payload, btn); return false; } },
      ...(ev.status !== 'delivered' ? [{ label: t('fail.resend'), icon: 'send', onClick: () => { resendOne(ctx, ev.id); return true; } }] : []),
      { label: t('common.close'), kind: 'navy' },
    ],
  });
}

// ---------- behaviour ----------
function runTest(ctx, whId) {
  const { t } = ctx;
  const s = ctx.state;
  const wh = ctx.list('webhooks').find((x) => x.id === whId);
  if (!wh || (s.tests[whId] && s.tests[whId].step < 3)) return;
  const crm = wh.url.includes('crm.example.com');
  const dead = wh.status === 'off' && wh.failuresInRow >= 100;
  const res = dead ? { code: null, ms: 5000, ok: false } : crm ? { code: 503, ms: 1204, ok: false } : { code: 200, ms: 182, ok: true };
  s.tests[whId] = { step: 0, ...res };
  ctx.rerender();
  soon(ctx, (st) => { if (st.tests[whId]) { st.tests[whId].step = 1; redraw(ctx); } }, 350);
  soon(ctx, (st) => { if (st.tests[whId]) { st.tests[whId].step = 2; redraw(ctx); } }, 800);
  soon(ctx, (st) => {
    const tt = st.tests[whId];
    if (!tt) return;
    tt.step = 3;
    const at = new Date(nowMs()).toISOString();
    const ev = { id: newId('evt'), at, event: 'call.completed', url: wh.url, code: res.code, ms: res.ms, status: res.ok ? 'delivered' : 'failed', attempts: 1, test: true, data: { call_id: 'call_01JBTEST0001', status: 'completed', sip_code: 200, talk_seconds: 18, price: PRICES.outbound, price_unit: 'credits', test: true } };
    tt.ev = ev;
    st.sent = [ev, ...st.sent];
    st.freshEv = ev.id;
    ctx.store.update('webhooks', (list) => list.map((x) => (x.id === whId ? { ...x, lastDelivery: res.code ? { at, code: res.code, ms: res.ms } : { at, code: null, timeout: true } } : x)));
    if (res.ok) ctx.ui.toast(t('toast.T10', { code: res.code, ms: res.ms }), { kind: 'success' });
    else ctx.ui.toast(res.code ? t('wt.failToast', { code: res.code, host: hostOf(wh.url) }) : t('wt.timeoutToast', { host: hostOf(wh.url) }), { kind: 'error', demo: true, reqId: reqId(`keys/webhooks|${wh.id}|${res.code || 'timeout'}`) });
    redraw(ctx);
  }, dead ? 1900 : crm ? 2100 : 1250);
}

function resendOne(ctx, evId, then) {
  const { t } = ctx;
  const s = ctx.state;
  if (s.resending[evId]) return;
  s.resending[evId] = true;
  ctx.rerender();
  soon(ctx, (st) => {
    delete st.resending[evId];
    ctx.store.update('failedEvents', (list) => list.filter((e) => e.id !== evId));
    ctx.store.update('keyTiles', (k) => (k ? { ...k, failedDeliveries: Math.max(0, (k.failedDeliveries || 0) - 1) } : k));
    const at = new Date(nowMs()).toISOString();
    st.sent = [{ id: evId, at, event: 'call.completed', url: 'https://crm.example.com/ants/webhook', code: 200, ms: 190, status: 'delivered', attempts: 7, data: { resent: true } }, ...st.sent];
    if (!then) ctx.ui.toast(t('toast.T11'), { kind: 'success' });
    if (then) then(); else redraw(ctx);
  }, 700);
}

function resendAll(ctx) {
  const { t } = ctx;
  const ids = ctx.list('failedEvents').map((e) => e.id);
  if (!ids.length || Object.keys(ctx.state.resending).length) return;
  const next = (i) => {
    if (i >= ids.length) { ctx.ui.toast(t('fail.allDone', { n: ids.length }), { kind: 'success', sub: t('toast.T11') }); redraw(ctx); return; }
    resendOne(ctx, ids[i], () => { redraw(ctx); next(i + 1); });
  };
  next(0);
}

async function rotateSecret(ctx, wh) {
  const { t, html: h, icon } = ctx;
  const host = hostOf(wh.url);
  const ok = await ctx.ui.confirm({
    title: t('rs.title', { host }), body: t('rs.body'),
    consequences: [t('rs.c1'), t('rs.c2'), t('rs.c3')],
    confirmLabel: t('rs.yes'), cancelLabel: t('rs.no'), danger: true, typed: host,
  });
  if (!ok) return;
  ctx.state.seq += 1;
  const last4 = `${String(ctx.state.seq).padStart(2, '0')}e${ctx.state.seq % 10}`;
  const next = { ...wh, secretLast4: last4 };
  ctx.store.update('webhooks', (list) => list.map((x) => (x.id === wh.id ? { ...x, secretLast4: last4, oldSecretUntil: new Date(nowMs() + 86400000).toISOString() } : x)));
  audit('webhook.secret.rotated', { host }, wh.id);
  ctx.ui.modal({
    title: t('rs.newTitle', { host }), size: 'md',
    body: h`<div class="stack-3"><div class="input-group"><code class="code-inline mono grow" translate="no">${secretOf(next)}</code><button type="button" class="btn btn-sm" data-action="wh.secret.copy">${icon('copy', 'ico-sm')}${t('common.copy')}</button></div>
      <p class="hint-xs">${t('rs.newHint', { until: ctx.fmt.dateTime(nowMs() + 86400000) })}</p></div>`,
    actions: { 'wh.secret.copy': (el) => ctx.ui.copy(secretOf(next), el) },
    buttons: [{ label: t('wm.saved'), kind: 'navy', icon: 'check' }],
  });
}

async function verify(ctx) {
  const v = ctx.state.verify;
  const wh = ctx.list('webhooks').find((x) => x.id === v.wh) || ctx.list('webhooks')[0];
  if (!wh) return;
  v.busy = true;
  ctx.rerender();
  const expected = `v1=${await hmacHex(secretOf(wh), `${v.ts}.${v.payload}`)}`;
  const age = Math.abs(Math.floor(nowMs() / 1000) - Number(v.ts || 0));
  soon(ctx, (s) => {
    s.verify.busy = false;
    s.verify.result = s.verify.sig.trim() !== expected ? 'bad' : age > 300 ? 'old' : 'ok';
    redraw(ctx);
  }, 400);
}

async function prefillVerify(ctx, root) {
  const v = ctx.state.verify;
  const wh = ctx.list('webhooks').find((x) => x.id === v.wh) || ctx.list('webhooks')[0];
  if (!wh) return;
  if (!v.wh) v.wh = wh.id;
  if (!v.ts) v.ts = String(Math.floor(nowMs() / 1000));
  if (v.payload == null) v.payload = samplePayload(ctx);
  if (!v.sig) {
    v.sig = `v1=${await hmacHex(secretOf(wh), `${v.ts}.${v.payload}`)}`;
    const i = root.querySelector('[data-field="vSig"]');
    if (i && !i.value) i.value = v.sig;
    const ts = root.querySelector('[data-field="vTs"]');
    if (ts && !ts.value) ts.value = v.ts;
    const b = root.querySelector('[data-field="vBody"]');
    if (b && !b.value) b.value = v.payload;
    const pre = root.querySelector('.ky-sigcode');
    if (pre) pre.textContent = pre.textContent.replace('…', v.ts);
  }
}

export function mount(root, ctx) {
  const { t } = ctx;
  const s = ctx.state;
  const tab = tabOf(ctx.params);
  const key = (idv) => ctx.list('apiKeys').find((k) => k.id === idv);

  ctx.actions(root, {
    'ky.connect': noop, 'ky.tab': noop, 'ky.tile.delivery': noop,
    // Already showing what the tile opens: point at the list instead of reloading the same view.
    'ky.tile.requests': (el, ev) => { if (location.hash === el.getAttribute('href')) { ev.preventDefault(); flashTo(root, '.ky-body > .card, .ky-body > .ky-empty'); } },
    // requests log
    'rq.row': noop, 'rq.search': noop, 'rq.empty.connect': noop, 'rq.oldkey': noop,
    'rq.status': (el) => { const v = el.dataset.value; ctx.go(`keys?tab=requests${v !== 'all' ? `&status=${v}` : ''}`, { replace: true }); },
    'rq.clear': () => { ctx.state.rqQ = ''; if (rqStatusOf(ctx.params) !== 'all') ctx.go('keys?tab=requests', { replace: true }); else ctx.rerender(); },
    // Already on Webhooks: the tile scrolls to the failed list instead of reloading the tab it is on.
    'ky.tile.failed': (el, ev) => { if (tab === 'webhooks') { ev.preventDefault(); toFailed(root); } }, 'ky.empty.connect': noop, 'wh.events': noop, 'ev.empty.webhooks': noop,
    'wh.verify.help': noop, 'wh.verify.wh': noop, 'wh.verify.ts': noop, 'wh.verify.body': noop, 'wh.verify.sig': noop, 'wh.ev.search': noop, 'wh.ev.status': noop,
    'ky.create': () => createKeyModal(ctx),
    'ky.empty.create': () => createKeyModal(ctx),
    'ky.env': (el) => ctx.setState({ env: el.dataset.value }),
    'ky.clear': () => ctx.setState({ env: 'all', showRevoked: true }),
    'ky.banner.copy': (el) => { if (s.shown) ctx.ui.copy(s.shown.value, el); },
    'ky.banner.saved': () => { if (s.shown) { s.shown.saved = true; ctx.guard(null); ctx.rerender(); } },
    'ky.menu': (el) => {
      const k = key(el.dataset.value);
      if (!k) return;
      ctx.ui.menu(el, [
        { id: 'ky.rotate', label: t('menu.rotate'), icon: 'refresh', onSelect: () => rotateKey(ctx, k) },
        { id: 'ky.copyid', label: t('menu.copyId'), icon: 'copy', onSelect: () => ctx.ui.copy(k.id) },
        { sep: true },
        { id: 'ky.revoke', label: t('menu.revoke'), icon: 'x-circle', danger: true, onSelect: () => revokeKey(ctx, k) },
      ], { label: t('menuFor', { name: k.name }) });
    },
    'ky.revoked.hide': (el) => {
      const idv = el.dataset.value;
      const was = s.hidden.includes(idv);
      s.hidden = was ? s.hidden.filter((x) => x !== idv) : [...s.hidden, idv];
      if (!was) s.showRevoked = false;
      ctx.rerender();
      if (!was) ctx.ui.toast(t('hidden', { name: (key(idv) || {}).name || '' }), { kind: 'info', timeout: 10000, action: { label: t('common.undo'), onClick: () => { ctx.state.hidden = ctx.state.hidden.filter((x) => x !== idv); redraw(ctx); } } });
    },
    'ky.revoked.show': () => ctx.setState({ showRevoked: !s.showRevoked }),
    // webhooks
    'wh.add': () => webhookModal(ctx),
    'wh.empty.add': () => webhookModal(ctx),
    'wh.edit': (el) => { const w = ctx.list('webhooks').find((x) => x.id === el.dataset.value); if (w) webhookModal(ctx, w); },
    'wh.test': (el) => runTest(ctx, el.dataset.value),
    'wh.test.view': (el) => { const tt = s.tests[el.dataset.value]; const w = ctx.list('webhooks').find((x) => x.id === el.dataset.value); if (tt && tt.ev && w) payloadModal(ctx, tt.ev); },
    'wh.toggle': (el) => {
      const w = ctx.list('webhooks').find((x) => x.id === el.dataset.value);
      if (!w) return;
      const turningOff = w.status !== 'off';
      ctx.store.update('webhooks', (list) => list.map((x) => (x.id === w.id ? { ...x, status: turningOff ? 'off' : 'active', failuresInRow: turningOff ? x.failuresInRow : 0 } : x)));
      audit(turningOff ? 'webhook.disabled' : 'webhook.enabled', { host: hostOf(w.url) }, w.id);
      ctx.ui.toast(t(turningOff ? 'toast.T29off' : 'toast.T29', { name: hostOf(w.url) }), { kind: 'success' });
    },
    'wh.rotate': (el) => { const w = ctx.list('webhooks').find((x) => x.id === el.dataset.value); if (w) rotateSecret(ctx, w); },
    'wh.fail.resend': (el) => resendOne(ctx, el.dataset.value),
    'wh.fail.resendall': () => resendAll(ctx),
    'wh.fail.view': (el) => { const ev = eventsList(ctx).find((e) => e.id === el.dataset.value); if (ev) payloadModal(ctx, ev); },
    'wh.verify': () => verify(ctx),
    'wh.verify.reset': () => { s.verify = { wh: s.verify.wh, ts: null, payload: null, sig: '', result: null, busy: false }; ctx.rerender(); },
    // events
    'wh.ev.row': (el) => { const ev = eventsList(ctx).find((e) => e.id === el.dataset.value); if (ev) payloadModal(ctx, ev); },
    'wh.ev.clear': () => { ctx.setState({ evQ: '', evStatus: 'all' }); if (ctx.params.query.host) ctx.go('keys?tab=events', { replace: true }); },
    'wh.ev.host': () => ctx.go('keys?tab=events', { replace: true }),
  });

  ctx.inputs(root, {
    evQ: (v) => ctx.setState({ evQ: v }),
    rqQ: (v) => ctx.setState({ rqQ: v }),
    evStatus: (v) => ctx.setState({ evStatus: v }),
    vWh: async (v) => { s.verify.wh = v; s.verify.sig = ''; s.verify.result = null; const w = ctx.list('webhooks').find((x) => x.id === v); if (w) s.verify.sig = `v1=${await hmacHex(secretOf(w), `${s.verify.ts}.${s.verify.payload}`)}`; redraw(ctx); },
    vTs: (v) => { s.verify.ts = v.trim(); s.verify.result = null; },
    vBody: (v) => { s.verify.payload = v; s.verify.result = null; },
    vSig: (v) => { s.verify.sig = v; s.verify.result = null; },
  });

  ctx.watch('apiKeys', 'webhooks', 'failedEvents', 'keyTiles', 'calls', 'mode', 'env', 'subAccounts');

  // A key shown once and not saved yet: ask before leaving.
  if (s.shown && !s.shown.saved) {
    ctx.guard(async () => {
      const ok = await ctx.ui.confirm({ title: t('leave.title'), body: t('leave.body'), confirmLabel: t('leave.yes'), cancelLabel: t('leave.stay') });
      if (ok && ctx.state.shown) ctx.state.shown.saved = true;
      return ok;
    });
  }
  if (tab === 'webhooks') prefillVerify(ctx, root);
  // Requests: a click anywhere on a row opens it; the drawer follows ?req=.
  if (tab === 'requests') {
    ctx.on(root, 'click', '.ky-rqtbl tbody tr', (ev, tr) => {
      if (ev.target.closest('a, button, input')) return;
      const a = tr.querySelector('[data-action="rq.row"]');
      if (!a) return;
      ev.__handled = true;
      ctx.go(a.getAttribute('href').slice(2));
    });
  }
  const want = tab === 'requests' ? ctx.params.query.req : null;
  const req = want ? requestsList(ctx).find((r) => r.id === want) : null;
  if (req) openReq(ctx, req);
  else closeReq();
  if (want && !req && ctx.state.missingReq !== want) { ctx.state.missingReq = want; ctx.later(() => ctx.ui.toast(t('rq.notFound', { id: want }), { kind: 'warn' }), 50); }
  if (!req && ctx.state.focusReq) {
    const fr = ctx.state.focusReq;
    ctx.state.focusReq = null;
    ctx.later(() => { const a = root.querySelector(`tr[data-req="${fr}"] [data-action="rq.row"]`); if (a) a.focus({ preventScroll: true }); }, 30);
  }
  if (tab === 'webhooks' && ctx.params.query.focus === 'failed') ctx.later(() => toFailed(root), 60);
}

function toFailed(root) { flashTo(root, '.ky-failed, .ky-body > .ky-empty'); }

function flashTo(root, sel) {
  const card = root.querySelector(sel);
  if (!card) return;
  card.setAttribute('tabindex', '-1');
  card.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
  card.focus({ preventScroll: true });
  card.classList.remove('ky-flash'); void card.offsetWidth; card.classList.add('ky-flash');
}
