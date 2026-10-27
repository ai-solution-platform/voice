// SIP Trunking — #/trunks (list) · #/trunks/<name> (detail)
// Demo data: hq-pbx, and cm-branch-pbx down since 13:58 with ticket SUP-10452. New trunks are created by the
// 5-step wizard on #/connect/sip (no second wizard here).
// Endpoints come from js/data/edge.js; prices from js/data/prices.js (0 a month, 10 calls at the same time
// included, each extra call per month). Passwords are visibly fake and revealed once.

import { raw, reducedMotion } from '../core/dom.js';
import { audit } from '../core/actions.js';
import { nowMs, at as atTime } from '../data/clock.js';
import { PRICES, trunkMonthly } from '../data/prices.js';
import { SIP_HOST, SIGNALLING_IPS, MEDIA_IPS, MEDIA_PORTS, PORTS, DEMO_SIP_PASSWORD } from '../data/edge.js';

export const id = 'trunks';
export const nav = { group: 'build', icon: 'server', labelKey: 'nav.trunks' };
export const titleKey = 'nav.trunks';
export const skeleton = 'table';
export const css = true;

const IP_RE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}(\/(3[0-2]|[12]?\d))?$/;
const PBX = ['Generic', 'FreePBX', '3CX', 'Asterisk', 'Yeastar'];
const PBX_KEY = { Generic: 'generic', FreePBX: 'freepbx', '3CX': '3cx', Asterisk: 'asterisk', Yeastar: 'yeastar' };
const PBX_GUIDE = { generic: 'pbx-freepbx', freepbx: 'pbx-freepbx', '3cx': 'pbx-3cx', asterisk: 'pbx-asterisk', yeastar: 'pbx-yeastar' };
const TRANSPORT = { tls: 'TLS 5061', tcp: 'TCP 5060', udp: 'UDP 5060' };
const STATUSES = ['all', 'active', 'off', 'down', 'draft'];
const REVEAL_SEC = 30;
const noop = () => {};

export const initialState = () => ({ filter: 'all', auth: 'all', transport: 'all', q: '', range: '24h', retest: {}, reveal: {}, ipInput: '', ipLabel: '', ipErr: null, pbxSel: {} });

export function crumb(params) {
  return params.path[0] || '';
}

// ---------- helpers ----------
const onTrunks = () => /^#\/trunks(\/|\?|$)/.test(location.hash);
function soon(ctx, fn, ms) {
  const st = ctx.state;
  setTimeout(() => { if (st === ctx.state) fn(st); }, reducedMotion() ? Math.min(ms, 250) : ms);
}
const redraw = (ctx) => { if (onTrunks()) ctx.rerender(); };
const pbxKey = (tr) => PBX_KEY[tr.pbx] || 'generic';
const trunkBy = (ctx, name) => ctx.list('trunks').find((x) => x.name === name);
function patchTrunk(ctx, name, fn) {
  ctx.store.update('trunks', (list) => list.map((x) => (x.name === name ? fn(x) : x)));
}
const fee = (tr) => trunkMonthly(tr.concurrent || PRICES.trunkIncludedCalls);

function statusChip(ctx, tr) {
  const { t, html: h, fmt } = ctx;
  if (tr.status === 'down') return h`<span class="chip chip-err" tabindex="0" data-tip-key="trunks.tip.down">${ctx.icon('alert-circle')}${t('st.down')}</span> <span class="hint-xs nowrap">${t('st.since', { time: fmt.timeShort(tr.downSince || nowMs()) })}</span>`;
  if (tr.status === 'off') return h`<span class="chip" tabindex="0" data-tip-key="trunks.tip.off">${t('st.off')}</span>`;
  if (tr.status === 'draft') return h`<span class="chip chip-info" tabindex="0" data-tip-key="trunks.tip.draft">${t('st.draft')}</span>`;
  return h`<span class="chip chip-ok" tabindex="0" data-tip-key="trunks.tip.active">${ctx.icon('check-circle')}${t('st.active')}</span>${tr.availability != null ? h` <span class="hint-xs nowrap">${t('st.avail', { pct: fmt.pct(tr.availability, 1) })}</span>` : ''}`;
}

const authLabel = (ctx, tr) => ctx.t(`auth.${tr.auth || 'ip'}`);
const transportLabel = (tr) => `${TRANSPORT[tr.transport] || TRANSPORT.tls}${tr.srtp ? ' · SRTP' : ''}`;

function filtered(ctx) {
  const s = ctx.state;
  const q = s.q.trim().toLowerCase();
  return ctx.list('trunks').filter((tr) => (s.filter === 'all' || tr.status === s.filter)
    && (s.auth === 'all' || tr.auth === s.auth)
    && (s.transport === 'all' || tr.transport === s.transport)
    && (!q || tr.name.toLowerCase().includes(q) || String(tr.pbx).toLowerCase().includes(q) || (tr.ips || []).some((ip) => ip.includes(q))));
}

function openDialer(ctx, tr) {
  const f = ctx.ui.dialer.open({ mode: 'trunk', source: `trunk:${tr.name}` });
  // A trunk that is down cannot answer the test: preset the demo outcome so the call shows the real result.
  try { if (f && f.ctrl && !f.ctrl.inCall() && tr.status === 'down') { f.ctrl.state.outcome = 'failed'; f.ctrl.render(); } } catch { /* dialer internals changed: default outcome */ }
}

// ---------- pieces ----------
function priceLine(ctx) {
  const { t, html: h, fmt } = ctx;
  return h`<div class="row tk-price"><span class="hint-xs">${t('price', { trunk: fmt.int(PRICES.trunkMonthly), included: PRICES.trunkIncludedCalls, extra: fmt.int(PRICES.extraConcurrentCall) })}</span>
    <span class="chip chip-warn" tabindex="0" data-tip-key="common.plannedPricesTip">${t('common.plannedPrices')}</span></div>`;
}

function downBanner(ctx, tr) {
  const { t, html: h, icon, fmt } = ctx;
  const rt = ctx.state.retest[tr.name] || {};
  const ticket = ctx.list('tickets').find((x) => x.topic === 'trunk' && x.status !== 'solved');
  return h`<div class="note note-err tk-down" role="status">${icon('alert-circle')}
    <div class="grow stack" style="gap:4px"><strong>${t('down.title', { name: tr.name, time: fmt.timeShort(tr.downSince || nowMs()) })}</strong>
      <span>${t('down.body', { ip: tr.pbxIp || (tr.uris && tr.uris[0] ? tr.uris[0].uri : ''), last: fmt.timeShort(tr.lastReply || tr.downSince || nowMs()) })}</span>
      ${rt.state === 'done' ? h`<span class="tk-retest-res" aria-live="polite">${t('down.still', { ip: tr.pbxIp || '', last: fmt.timeShort(tr.lastReply || nowMs()), time: fmt.time(rt.at) })} <a class="linkbtn" href="#/help/article/trunk-troubleshooting" data-action="tk.down.fix">${t('down.fixes')}</a></span>` : ''}</div>
    <div class="row tk-down-a"><button type="button" class="btn btn-sm" data-action="tk.down.retest" data-value="${tr.name}" ${raw(rt.state === 'run' ? 'aria-busy="true"' : '')}>${rt.state === 'run' ? raw('<span class="spin" aria-hidden="true"></span>') : icon('refresh', 'ico-sm')}${rt.state === 'run' ? t('down.testing') : t('down.retest')}</button>
      ${ticket ? h`<a class="btn btn-sm" href="#/help/tickets/${ticket.id}" data-action="tk.down.ticket">${icon('ticket', 'ico-sm')}${t('down.ticket', { id: ticket.id })}</a>` : ''}</div></div>`;
}

// ---------- list ----------
function listPage(ctx) {
  const { t, html: h, icon, fmt } = ctx;
  const all = ctx.list('trunks');
  const head = h`<div class="page-head"><div class="titles"><h1>${t('title')}${ctx.pageHelp()}</h1><span class="sub">${t('sub')}</span></div>
    <div class="tools"><a class="btn" href="#/help/article/pbx-freepbx" data-action="tk.guide">${icon('book')}${t('guide')}</a>
      ${all.length ? h`<a class="btn btn-primary" href="#/connect/sip" data-action="tk.create">${icon('plus')}${t('create')}</a>` : ''}</div></div>`;
  if (!all.length) {
    return h`<div class="page tk">${head}<div class="card tk-empty"><div class="empty">
      <span class="art">${icon('server')}</span><h2>${t('empty.title')}</h2><p class="hint">${t('empty.body')}</p>
      <div class="steps"><div><span class="stepnum">1</span>${t('empty.s1')}</div><div><span class="stepnum">2</span>${t('empty.s2')}</div><div><span class="stepnum">3</span>${t('empty.s3')}</div></div>
      <div class="row"><a class="btn btn-primary" href="#/connect/sip" data-action="tk.empty.create">${icon('plus')}${t('empty.create')}</a>
        <a class="btn" href="#/connect/api" data-action="tk.empty.api">${icon('code')}${t('empty.api')}</a></div>
      ${priceLine(ctx)}</div></div></div>`;
  }
  const rows = filtered(ctx);
  const s = ctx.state;
  const inUse = all.reduce((x, tr) => x + (tr.status === 'active' ? tr.inUse || 0 : 0), 0);
  const cap = all.reduce((x, tr) => x + (tr.status === 'draft' ? 0 : tr.concurrent || 0), 0);
  const fees = all.reduce((x, tr) => x + (tr.status === 'draft' ? 0 : fee(tr).total), 0);
  // Seeded trunks keep their stored totals (a trunk that is down carries none); console-made trunks count their calls.
  const calls = all.reduce((x, tr) => x + ((tr.createdAt ? stats24(ctx, tr).calls : tr.last24h && tr.last24h.calls) || 0), 0);
  const down = all.filter((tr) => tr.status === 'down');
  return h`<div class="page tk">${head}
    ${down.map((tr) => downBanner(ctx, tr))}
    <div class="grid g-4 tk-tiles">
      <div class="card tile"><span class="t">${t('tile.trunks')}</span><span class="v">${fmt.int(all.length)}</span><span class="h">${t('tile.trunksLine', { active: fmt.int(all.filter((x) => x.status === 'active').length), down: fmt.int(down.length) })}</span></div>
      <div class="card tile"><span class="t">${ctx.term(t('tile.inUse'), 'concurrent')}</span><span class="v">${fmt.int(inUse)} <small>/ ${fmt.int(cap)}</small></span><span class="h">${t('tile.inUseLine')}</span></div>
      <a class="card tile tile-link" href="#/billing?section=usage" data-action="tk.tile.fees"><span class="t">${t('tile.fees')}</span><span class="v">${fmt.int(fees)}</span><span class="h">${t('tile.feesLine', { extra: fmt.int(PRICES.extraConcurrentCall) })}</span></a>
      <a class="card tile tile-link" href="#/logs?src=trunk&range=24h" data-action="tk.tile.calls"><span class="t">${t('tile.calls')}</span><span class="v">${fmt.int(calls)}</span><span class="h">${t('tile.callsLine')}</span></a>
    </div>
    <div class="tk-filters">
      <div class="seg" role="group" aria-label="${t('f.statusAria')}">${STATUSES.map((k) => h`<button type="button" data-action="tk.filter" data-value="${k}" aria-pressed="${s.filter === k}">${t(`f.${k}`)}</button>`)}</div>
      <select class="select tk-sel" data-field="auth" data-action="tk.auth" aria-label="${t('f.authAria')}">${['all', 'ip', 'credentials', 'both'].map((k) => h`<option value="${k}" ${raw(s.auth === k ? 'selected' : '')}>${k === 'all' ? t('f.authAll') : t(`auth.${k}`)}</option>`)}</select>
      <select class="select tk-sel" data-field="transport" data-action="tk.transport" aria-label="${t('f.transportAria')}">${['all', 'tls', 'tcp', 'udp'].map((k) => h`<option value="${k}" ${raw(s.transport === k ? 'selected' : '')}>${k === 'all' ? t('f.transportAll') : TRANSPORT[k]}</option>`)}</select>
      <label class="tk-search">${icon('search', 'ico-sm')}<input class="input" type="search" data-field="q" data-action="tk.search" value="${s.q}" placeholder="${t('f.searchPh')}" aria-label="${t('f.searchAria')}" autocomplete="off" spellcheck="false"></label>
    </div>
    ${rows.length ? h`<div class="card"><div class="tbl-wrap"><table class="tbl tk-tbl"><thead><tr><th>${t('col.name')} · ${ctx.term(t('col.pbx'), 'pbx')}</th><th>${t('col.auth')} · ${t('col.transport')}</th><th class="num">${ctx.term(t('col.cc'), 'concurrent')}</th><th class="num">${t('col.monthly')}</th><th>${t('col.status')}</th><th><span class="sr-only">${t('col.actions')}</span></th></tr></thead>
      <tbody>${rows.map((tr) => h`<tr class="${tr.status === 'down' ? 'tk-row-down' : ''}">
        <td><a class="mono strong" href="#/trunks/${tr.name}" data-action="tk.row" translate="no">${tr.name}</a><div class="hint-xs">${tr.pbx} · ${ctx.ui.describe.sub(tr.sub)}</div></td>
        <td data-label="${t('col.auth')}">${authLabel(ctx, tr)}<div class="hint-xs mono nowrap">${transportLabel(tr)}</div></td>
        <td class="num mono" data-label="${t('col.cc')}">${tr.status === 'active' ? tr.inUse || 0 : 0} / ${tr.concurrent}<div class="hint-xs">${t('col.ccIncl', { n: PRICES.trunkIncludedCalls })}</div></td>
        <td class="num mono" data-label="${t('col.monthly')}">${tr.status === 'draft' ? '—' : fmt.int(fee(tr).total)}</td>
        <td class="nowrap tk-stcell">${statusChip(ctx, tr)}</td>
        <td class="num nowrap tk-c-act"><div class="row tk-rowact">${tr.status === 'draft'
          ? h`<a class="btn btn-sm btn-navy" href="#/connect/sip?trunk=${encodeURIComponent(tr.name)}" data-action="tk.continue">${t('continue')}</a>`
          : h`<button type="button" class="btn btn-sm" data-action="tk.testcall" data-value="${tr.name}" ${raw(tr.status === 'off' ? 'aria-disabled="true"' : '')}>${icon('phone', 'ico-sm')}${t('testCall')}</button>`}
          <a class="btn btn-sm btn-ghost" href="#/trunks/${tr.name}" data-action="tk.view">${t('view')}</a></div></td></tr>`)}</tbody></table></div>
      <div class="card-foot">${priceLine(ctx)}</div></div>`
      : h`<div class="card"><div class="empty empty-center" role="status"><strong>${t('noMatch')}</strong><span class="hint">${t('noMatchHint')}</span><button type="button" class="btn btn-sm" data-action="tk.clear">${t('clear')}</button></div></div>`}
  </div>`;
}

// ---------- health ----------
function buckets24(tr) {
  const end = atTime('14:30');
  const created = tr.createdAt ? new Date(tr.createdAt).getTime() : 0;
  const downAt = tr.downSince ? new Date(tr.downSince).getTime() : null;
  const out = [];
  for (let i = 0; i < 48; i++) {
    const start = end - (47 - i) * 1800000;
    const stop = start + 1800000;
    const partial = i === 47;
    const span = partial ? Math.max(30, Math.min(1800, Math.round((nowMs() - start) / 1000))) : 1800;
    const n = Math.max(1, Math.round(span / 30)) + ((i * 7) % 3 === 0 ? 1 : 0);
    const ms = 10 + ((i * 13) % 5);
    let st = 'ok';
    let key = 'ok';
    if (created && stop <= created) { st = 'none'; key = 'none'; }
    else if (tr.status === 'draft') { st = 'none'; key = 'none'; }
    else if (downAt && start >= downAt - 1800000 && stop > downAt) { st = start < downAt ? 'warn' : 'err'; key = start < downAt ? 'downStart' : 'down'; }
    else if (tr.failovers24h && tr.failovers24h.some((f) => { const fs = atTime(f.from); return fs >= start && fs < stop; })) { st = 'warn'; key = 'failover'; }
    out.push({ start, stop: partial ? nowMs() : stop, st, key, n, ms });
  }
  return out;
}
function buckets7(tr) {
  const days = ['2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27'];
  const created = tr.createdAt ? new Date(tr.createdAt).toISOString().slice(0, 10) : null;
  return days.map((d, i) => {
    let st = 'ok';
    let key = 'okDay';
    let pct = 100;
    if ((created && d < created) || tr.status === 'draft') { st = 'none'; key = 'none'; pct = null; }
    else if (tr.downSince && d === '2026-10-27') { st = 'err'; key = 'downDay'; pct = tr.availability; }
    else if (tr.failovers24h && d === '2026-10-27') { st = 'warn'; key = 'failoverDay'; }
    return { day: d, st, key, pct, n: 2880 - (i % 3) * 3 };
  });
}

function healthCard(ctx, tr) {
  const { t, html: h, fmt } = ctx;
  const r = ctx.state.range;
  const bars = r === '24h' ? buckets24(tr) : buckets7(tr);
  const tip = (b) => {
    if (r === '7d') return b.key === 'none' ? t('hb.noneDay', { day: fmt.dayMonth(b.day) }) : t(`hb.${b.key}`, { day: fmt.dayMonth(b.day), n: fmt.int(b.n), pct: b.pct != null ? fmt.pct(b.pct, 1) : '', time: tr.downSince ? fmt.timeShort(tr.downSince) : '' });
    const range = `${fmt.timeShort(b.start)}–${fmt.timeShort(b.stop)}`;
    return t(`hb.${b.key}`, { range, n: fmt.int(b.n), ms: b.ms, last: tr.lastReply ? fmt.timeShort(tr.lastReply) : '' });
  };
  const fo = (tr.failovers24h || [])[0];
  return h`<section class="card tk-health" aria-labelledby="tk-h-h">
    <div class="card-head"><h2 id="tk-h-h">${t('health.title')}</h2>
      <div class="seg seg-sm" role="group" aria-label="${t('health.rangeAria')}">${['24h', '7d'].map((k) => h`<button type="button" data-action="td.health.range" data-value="${k}" aria-pressed="${r === k}">${t(`health.${k}`)}</button>`)}</div></div>
    <div class="card-body stack-3">
      <div class="row tk-hsum"><span class="tk-big tnum">${tr.availability != null ? fmt.pct(tr.availability, 1) : '—'}</span><span class="hint">${t('health.avail')}</span>
        <span class="grow"></span><span class="hint-xs">${t('health.legend')}</span></div>
      <div class="tk-bars ${r === '7d' ? 'is-7d' : ''}" role="group" aria-label="${t('health.aria', { name: tr.name })}">${bars.map((b) => h`<span class="tk-bar is-${b.st}" tabindex="0" data-tip="${tip(b)}" aria-label="${tip(b)}"></span>`)}</div>
      <div class="row tk-axis hint-xs">${r === '24h' ? h`<span>${fmt.timeShort(bars[0].start)}</span><span>${fmt.timeShort(atTime('03:00'))}</span><span>${fmt.timeShort(atTime('09:00'))}</span><span>${t('health.now')}</span>` : h`<span>${fmt.dayMonth(bars[0].day)}</span><span>${fmt.dayMonth(bars[6].day)}</span>`}</div>
      ${fo ? h`<p class="hint-xs">${t('health.failover', { from: fo.from, to: fo.to, target: fo.target })}</p>` : ''}
      ${tr.status === 'down' ? h`<p class="hint-xs err-text">${t('health.downLine', { time: fmt.timeShort(tr.downSince) })}</p>` : ''}
    </div></section>`;
}

// ---------- detail ----------
function eventsFor(ctx, tr) {
  const { t } = ctx;
  const ev = (time, kind, key, vars = {}) => ({ at: typeof time === 'number' ? time : atTime(time), kind, text: t(`ev.${key}`, vars) });
  if (tr.name === 'hq-pbx') {
    return [
      ev('14:34:30', 'ok', 'options', { host: 'pbx-hq.example.com', ms: 12 }),
      ev('14:30:12', 'ok', 'register', { ip: '198.51.100.22', exp: 3600 }),
      ev('14:12:05', 'warn', 'blocked', { ip: '198.51.100.77' }),
      ev('03:52:10', 'ok', 'back', { host: 'pbx-hq.example.com' }),
      ev('03:30:04', 'warn', 'failover', { host: 'pbx-hq.example.com', backup: 'pbx-backup.example.com' }),
    ];
  }
  if (tr.name === 'cm-branch-pbx') {
    return [
      ev('14:34:00', 'err', 'timeout', { ip: '198.51.100.40' }),
      ev('13:58:00', 'err', 'markedDown', { n: 3 }),
      ev('13:56:31', 'ok', 'options', { host: '198.51.100.40', ms: 18 }),
      ev('13:41:07', 'ok', 'register', { ip: '198.51.100.40', exp: 1800 }),
    ];
  }
  const created = tr.createdAt ? new Date(tr.createdAt).getTime() : nowMs();
  if (tr.status === 'draft') return [ev(created, 'warn', 'draft')];
  return [ev(created + 2000, 'ok', 'options', { host: (tr.ips && tr.ips[0]) || SIP_HOST, ms: 12 }), ev(created, 'ok', 'activated')];
}

/** Calls through this trunk in the environment on screen (the same set Logs shows), newest first. */
function callsFor(ctx, tr, limit = 6) {
  const envNow = ctx.store.get('env');
  const all = ctx.list('calls').filter((c) => (c.env || 'live') === envNow && ((c.source && c.source.type === 'trunk' && c.source.ref === tr.name)
    || (tr.name === 'cm-branch-pbx' && c.to === '053-xxx-120')
    || (c.source && c.source.type === 'test-call' && c.source.ref === `trunk:${tr.name}`)));
  return limit ? all.slice(0, limit) : all;
}

/** Last-24-hour totals: the seeded trunks keep their stored totals; a trunk made in this console counts its calls. */
function stats24(ctx, tr) {
  if (tr.last24h && !tr.createdAt) return tr.last24h;
  const since = nowMs() - 86400000;
  const c = callsFor(ctx, tr, 0).filter((x) => !x.ts || Date.parse(x.ts) >= since);
  const answered = c.filter((x) => x.status === 'completed').length;
  const pdd = c.filter((x) => x.pddMs != null);
  return {
    calls: c.length, outbound: c.filter((x) => x.direction === 'outbound').length, inbound: c.filter((x) => x.direction === 'inbound').length,
    answerRatePct: c.length ? (answered / c.length) * 100 : null, pddSec: pdd.length ? pdd.reduce((s, x) => s + x.pddMs, 0) / pdd.length / 1000 : null,
    credits: c.reduce((x, y) => x + (y.credits || 0), 0),
  };
}

/** Logs filtered to this trunk: its own calls by source; the Chiang Mai number for the trunk that is down. */
const logsHref = (tr) => (tr.name === 'cm-branch-pbx' ? '#/logs?number=053-xxx-120' : `#/logs?src=${encodeURIComponent(tr.name)}`);

/** What happens when every destination is down — exactly what the SIP wizard (step 4) or Edit saved. */
function fallbackOf(ctx, tr) {
  const kind = tr.fallback || 'message';
  if (kind === 'forward') return { kind, number: tr.forwardTo || '—' };
  if (kind === 'hangup') return { kind };
  const fid = tr.allDown === undefined ? 'flw_01JB5CLSD2' : tr.allDown;
  const flow = ctx.list('flows').find((f) => f.id === fid) || null;
  return { kind: 'message', flow, name: flow ? ctx.loc(flow.name) : ctx.t('dest.fb.defaultName') };
}
function fallbackText(ctx, fb) {
  const { t } = ctx;
  if (fb.kind === 'forward') return t('dest.fb.forward', { number: fb.number });
  if (fb.kind === 'hangup') return t('dest.fb.hangup');
  return `${t('dest.fb.message', { name: fb.name })} · ${fb.flow ? t('dest.fb.flowV', { v: fb.flow.live || 1 }) : t('dest.fb.default')}`;
}

function configRows(ctx, tr) {
  const { t } = ctx;
  const rows = [
    { k: 'domain', label: t('cfg.domain'), v: SIP_HOST },
    { k: 'sig', label: t('cfg.sig'), v: SIGNALLING_IPS.join(', ') },
    { k: 'ports', label: t('cfg.ports'), v: PORTS },
    { k: 'media', label: t('cfg.media'), v: `${MEDIA_IPS} · ${MEDIA_PORTS}` },
    { k: 'codec', label: t('cfg.codec'), v: 'PCMA (G.711 A-law), PCMU (G.711 μ-law)' },
    { k: 'dtmf', label: t('cfg.dtmf'), v: 'RFC 2833 · telephone-event/8000' },
    { k: 'e164', label: t('cfg.e164'), v: 'E.164 · +662xxx1234' },
    { k: 'transport', label: t('cfg.transport'), v: transportLabel(tr) },
  ];
  if (tr.username) rows.push({ k: 'user', label: t('cfg.user'), v: tr.username });
  return rows;
}

function configText(ctx, tr, pbx) {
  const head = `; ${ctx.t('cfg.fileHead', { name: tr.name, pbx })}\n; ${ctx.t('cfg.fileNote')}\n`;
  const port = tr.transport === 'tls' ? 5061 : 5060;
  if (pbx === 'FreePBX' || pbx === 'Asterisk' || pbx === 'Generic') {
    return `${head}
[ants-${tr.name}]
type=endpoint
transport=transport-${tr.transport || 'tls'}
context=from-trunk
disallow=all
allow=alaw,ulaw
dtmf_mode=rfc4733
media_encryption=${tr.srtp ? 'sdes' : 'no'}
aors=ants-${tr.name}
${tr.username ? `outbound_auth=ants-${tr.name}-auth\n` : ''}
[ants-${tr.name}]
type=aor
contact=sip:${SIP_HOST}:${port}
qualify_frequency=30

[ants-${tr.name}-identify]
type=identify
endpoint=ants-${tr.name}
match=${SIGNALLING_IPS.join(',')}
${tr.username ? `
[ants-${tr.name}-auth]
type=auth
auth_type=userpass
username=${tr.username}
password=<paste the password you saved>
` : ''}`;
  }
  return `${head}
${configRows(ctx, tr).map((r) => `${r.label}: ${r.v}`).join('\n')}
${tr.username ? `${ctx.t('cred.password')}: <paste the password you saved>\n` : ''}`;
}

function credCard(ctx, tr) {
  const { t, html: h, icon } = ctx;
  const rv = ctx.state.reveal[tr.name] || {};
  const left = rv.state === 'shown' ? Math.max(0, REVEAL_SEC - Math.floor((performance.now() - rv.at) / 1000)) : 0;
  return h`<section class="card tk-cred" aria-labelledby="tk-c-h"><div class="card-head"><h2 id="tk-c-h">${t('cred.title')}</h2><span class="chip chip-navy">${authLabel(ctx, tr)}</span></div>
    <div class="card-body">
      ${tr.username ? h`<div class="wkv"><span class="k">${t('cred.user')}</span><strong class="mono" translate="no">${tr.username}</strong>
          <button type="button" class="copybtn" data-action="td.copy.user" data-value="user" aria-label="${t('cfg.copyRow', { what: t('cred.user') })}" data-tip-key="common.copy">${icon('copy', 'ico-sm')}</button></div>
        <div class="wkv"><span class="k">${t('cred.password')}</span><strong class="mono tk-pwd" translate="no">${rv.state === 'shown' ? DEMO_SIP_PASSWORD : '••••••••••••••••'}</strong>
          ${rv.state === 'shown' ? h`<span class="hint-xs" data-tk-left aria-live="polite">${t('cred.hidesIn', { n: left })}</span>`
            : rv.state === 'used' ? h`<span class="hint-xs">${t('cred.used')}</span>`
              : h`<button type="button" class="btn btn-sm" data-action="td.pwd.reveal">${icon('eye', 'ico-sm')}${t('cred.reveal')}</button>`}</div>
        <div class="row tk-credact"><button type="button" class="btn btn-sm btn-ghost" data-action="td.pwd.reset">${icon('refresh', 'ico-sm')}${t('cred.reset')}</button><span class="hint-xs">${t('cred.resetHint')}</span></div>`
        : h`<p class="hint">${t('cred.ipOnly')}</p>`}
      <hr class="divider">
      <div class="stack tk-ips"><div class="row"><strong class="grow">${ctx.term(t('ip.title'), 'ip_allow')}</strong><span class="hint-xs">${t('ip.count', { n: (tr.ips || []).length, max: 10 })}</span></div>
        ${(tr.ips || []).length ? h`<ul class="tk-iplist">${tr.ips.map((ip, i) => h`<li><span class="mono" translate="no">${ip}</span><span class="hint-xs grow">${(tr.ipLabels && tr.ipLabels[i]) || t('ip.noLabel')}</span>
            <button type="button" class="btn btn-ghost btn-sm" data-action="td.ip.remove" data-value="${ip}">${t('ip.remove')}</button></li>`)}</ul>`
          : h`<p class="hint-xs">${tr.auth === 'credentials' ? t('ip.noneCred') : t('ip.none')}</p>`}
        <div class="tk-ipadd"><input class="input mono" data-field="ipInput" value="${ctx.state.ipInput}" placeholder="198.51.100.0/24" aria-label="${t('ip.input')}" aria-invalid="${ctx.state.ipErr ? 'true' : 'false'}" aria-describedby="tk-ip-err" translate="no" spellcheck="false" ${raw((tr.ips || []).length >= 10 ? 'disabled' : '')}>
          <input class="input" data-field="ipLabel" value="${ctx.state.ipLabel}" placeholder="${t('ip.labelPh')}" aria-label="${t('ip.label')}">
          <button type="button" class="btn btn-sm" data-action="td.ip.add" ${raw((tr.ips || []).length >= 10 ? 'aria-disabled="true"' : '')}>${icon('plus', 'ico-sm')}${t('ip.add')}</button></div>
        ${ctx.state.ipErr ? h`<span class="field-err" id="tk-ip-err">${ctx.state.ipErr}</span>` : h`<span class="hint-xs" id="tk-ip-err">${t('ip.hint')}</span>`}
      </div></div></section>`;
}

function capacityCard(ctx, tr) {
  const { t, html: h, icon, fmt } = ctx;
  const m = fee(tr);
  const used = tr.status === 'active' ? tr.inUse || 0 : 0;
  const pct = tr.concurrent ? Math.round((used / tr.concurrent) * 100) : 0;
  return h`<section class="card tk-cap" aria-labelledby="tk-cc-h"><div class="card-head"><h2 id="tk-cc-h">${ctx.term(t('cap.title'), 'concurrent')}</h2>
      <button type="button" class="btn btn-sm" data-action="td.capacity">${icon('sliders', 'ico-sm')}${t('cap.add')}</button></div>
    <div class="card-body stack">
      <div class="row tk-capnum"><span class="tk-big tnum">${used}</span><span class="hint">${t('cap.of', { n: tr.concurrent })}</span></div>
      <span class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${tr.concurrent}" aria-valuenow="${used}" aria-label="${t('cap.title')}"><i style="width:${pct}%"></i></span>
      <div class="kv"><span class="k">${t('cap.included', { n: PRICES.trunkIncludedCalls })}</span><span class="v">${fmt.int(m.base)}</span></div>
      <div class="kv"><span class="k">${t('cap.extra', { n: m.extra, fee: fmt.int(PRICES.extraConcurrentCall) })}</span><span class="v">${fmt.int(m.extraCost)}</span></div>
      <div class="kv kv-total"><span class="k">${t('cap.month')}</span><span class="v">${fmt.int(m.total)}</span></div>
      <p class="hint-xs">${t('cap.rates', { rate: fmt.rate(PRICES.outbound), inbound: fmt.rate(PRICES.inbound) })}</p>
      <span class="chip chip-warn" tabindex="0" data-tip-key="common.plannedPricesTip">${t('common.plannedPrices')}</span>
    </div></section>`;
}

function statsCard(ctx, tr) {
  const { t, html: h, fmt } = ctx;
  const s = stats24(ctx, tr);
  return h`<section class="card tk-stats" aria-labelledby="tk-s-h"><div class="card-head"><h2 id="tk-s-h">${t('stats.title')}</h2><a class="btn btn-sm btn-ghost" href="${logsHref(tr)}" data-action="td.logs">${t('stats.logs')}</a></div>
    <div class="card-body tk-statgrid">
      <div><span class="hint-xs">${t('stats.calls')}</span><strong class="tnum">${fmt.int(s.calls || 0)}</strong><span class="hint-xs">${t('stats.split', { out: fmt.int(s.outbound || 0), inb: fmt.int(s.inbound || 0) })}</span></div>
      <div><span class="hint-xs">${ctx.term(t('stats.answer'), 'answer_rate')}</span><strong class="tnum">${s.answerRatePct != null ? fmt.pct(s.answerRatePct) : '—'}</strong></div>
      <div><span class="hint-xs">${ctx.term(t('stats.pdd'), 'pdd')}</span><strong class="tnum">${s.pddSec != null ? t('common.seconds', { n: fmt.num(s.pddSec, 1) }) : '—'}</strong></div>
      <div><span class="hint-xs">${t('stats.credits')}</span><strong class="tnum">${fmt.credits2(s.credits || 0)}</strong></div>
    </div></section>`;
}

function destCard(ctx, tr) {
  const { t, html: h } = ctx;
  const fb = fallbackOf(ctx, tr);
  return h`<section class="card tk-dest" aria-labelledby="tk-d-h"><div class="card-head"><h2 id="tk-d-h">${ctx.term(t('dest.title'), 'origination')}</h2></div>
    <div class="tbl-wrap"><table class="tbl tk-desttbl"><thead><tr><th class="num">${ctx.term(t('dest.prio'), 'priority_weight')}</th><th>URI</th><th class="num">${t('dest.weight')}</th><th>${t('dest.status')}</th><th class="num">${t('dest.reply')}</th><th>${t('dest.on')}</th></tr></thead>
    <tbody>${(tr.uris || []).map((u, i) => h`<tr>
      <td class="num"><input class="input tk-num mono" type="number" min="1" max="100" data-field="prio" data-action="td.dest.prio" data-index="${i}" value="${u.priority}" aria-label="${t('dest.prioFor', { uri: u.uri })}"></td>
      <td class="mono tk-uri" translate="no">${u.uri}</td><td class="num mono">${u.weight}</td>
      <td><span class="chip ${u.status === 'healthy' ? 'chip-ok' : u.status === 'down' ? 'chip-err' : ''}">${t(`dest.st.${u.status || 'unknown'}`)}</span></td>
      <td class="num mono">${u.replyMs != null && u.status !== 'off' ? `${u.replyMs} ms` : '—'}</td>
      <td><button type="button" class="toggle" role="switch" data-action="td.dest.toggle" data-value="${i}" aria-checked="${u.status !== 'off'}" aria-label="${t('dest.toggleFor', { uri: u.uri })}"></button></td></tr>`)}</tbody></table></div>
    <div class="card-foot stack" style="gap:4px"><span class="hint-xs">${ctx.term(t('dest.failover', { s: tr.failoverSec || 4 }), 'failover')}</span>
      <span class="hint-xs" data-tk-fallback>${t('dest.allDown')} ${fb.flow ? h`<a class="linkbtn" href="#/flows/${fb.flow.id}" data-action="td.fallback">${fallbackText(ctx, fb)}</a>` : h`<strong>${fallbackText(ctx, fb)}</strong>`}</span>
      ${tr.failovers24h && tr.failovers24h.length ? h`<span class="hint-xs">${t('dest.failovers', { n: tr.failovers24h.length, from: tr.failovers24h[0].from, to: tr.failovers24h[0].to, target: tr.failovers24h[0].target })}</span>` : ''}
</div></section>`;
}

function edgeCard(ctx, tr) {
  const { t, html: h, icon } = ctx;
  const pbx = ctx.state.pbxSel[tr.name] || tr.pbx || 'Generic';
  const key = PBX_KEY[pbx] || 'generic';
  return h`<section class="card tk-edge" aria-labelledby="tk-e-h"><div class="card-head"><h2 id="tk-e-h">${t('cfg.title')}</h2>
      <label class="row-tight hint-xs"><span>${ctx.term(t('cfg.pbx'), 'pbx')}</span><select class="select tk-pbx" data-field="pbx" data-action="td.pbx" aria-label="${t('cfg.pbx')}">${PBX.map((p) => h`<option value="${p}" ${raw(pbx === p ? 'selected' : '')}>${p === 'Generic' ? t('cfg.generic') : p}</option>`)}</select></label></div>
    <div class="card-body">${configRows(ctx, tr).map((r) => h`<div class="wkv"><span class="k">${r.label}</span><strong class="mono" translate="no">${r.v}</strong>
      <button type="button" class="copybtn" data-action="td.copy.${r.k}" data-value="${r.k}" aria-label="${t('cfg.copyRow', { what: r.label })}" data-tip-key="common.copy">${icon('copy', 'ico-sm')}</button></div>`)}
      <div class="row tk-edgeact"><button type="button" class="btn btn-sm btn-navy" data-action="td.download">${icon('download', 'ico-sm')}${t('cfg.download', { pbx: pbx === 'Generic' ? t('cfg.generic') : pbx })}</button>
        <button type="button" class="btn btn-sm" data-action="td.email">${icon('mail', 'ico-sm')}${t('cfg.email')}</button>
        <a class="linkbtn hint-xs" href="#/help/article/${PBX_GUIDE[key]}" data-action="td.guide">${icon('book', 'ico-xs')}${t('cfg.guide', { pbx: pbx === 'Generic' ? 'FreePBX' : pbx })}</a></div>
      <p class="hint-xs">${t('cfg.fix', { media: MEDIA_IPS, ports: MEDIA_PORTS })}</p></div></section>`;
}

function eventsCard(ctx, tr) {
  const { t, html: h, icon, fmt } = ctx;
  const list = eventsFor(ctx, tr);
  return h`<section class="card tk-events" aria-labelledby="tk-ev-h"><div class="card-head"><h2 id="tk-ev-h">${t('ev.title')}</h2><span class="hint-xs">${t('ev.sub')}</span></div>
    <ol class="tk-evlist">${list.map((e) => h`<li class="is-${e.kind}"><span class="tk-evdot">${icon(e.kind === 'ok' ? 'check' : e.kind === 'warn' ? 'alert' : 'x', 'ico-xs')}</span><span class="grow">${e.text}</span><time class="mono hint-xs">${fmt.time(e.at)}</time></li>`)}</ol></section>`;
}

function recentCard(ctx, tr) {
  const { t, html: h, fmt } = ctx;
  const calls = callsFor(ctx, tr);
  return h`<section class="card tk-recent" aria-labelledby="tk-r-h"><div class="card-head"><h2 id="tk-r-h">${t('recent.title')}</h2><a class="btn btn-sm" href="${logsHref(tr)}" data-action="td.logs">${t('stats.logs')}</a></div>
    ${calls.length ? h`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>${t('recent.time')}</th><th>${t('recent.dir')}</th><th>${t('recent.party')}</th><th>${t('recent.status')}</th><th class="num">${t('recent.talk')}</th><th class="num">${t('recent.credits')}</th></tr></thead>
      <tbody>${calls.map((c) => h`<tr><td class="mono"><a href="#/logs?call=${c.id}" data-action="td.call.row">${fmt.time(c.ts)}</a></td><td>${ctx.ui.describe.direction(c)}</td>
        <td class="mono" translate="no">${ctx.ui.describe.party(c)}</td><td>${ctx.ui.describe.statusChip(c.status)}</td><td class="num mono">${c.sec ? fmt.duration(c.sec) : '—'}</td><td class="num mono">${fmt.credits2(c.credits || 0)}</td></tr>`)}</tbody></table></div>`
      : h`<div class="empty"><span class="hint">${t('recent.none')}</span><button type="button" class="btn btn-sm" data-action="td.test" ${raw(tr.status === 'off' || tr.status === 'draft' ? 'aria-disabled="true"' : '')}>${ctx.icon('phone', 'ico-sm')}${t('testCall')}</button></div>`}</section>`;
}

/** Where inbound calls go when the trunk is off: the message name or the forward number (null = hung up). */
function fallbackName(ctx, tr) {
  const fb = fallbackOf(ctx, tr);
  return fb.kind === 'hangup' ? null : fb.kind === 'forward' ? fb.number : fb.name;
}

function detailPage(ctx, name) {
  const { t, html: h, icon, fmt } = ctx;
  const tr = trunkBy(ctx, name);
  if (!tr) {
    return h`<div class="page tk"><div class="card"><div class="empty empty-center"><span class="art">${icon('server')}</span><h2>${t('nf.title', { name })}</h2><span class="hint">${t('nf.body')}</span>
      <a class="btn btn-navy" href="#/trunks" data-action="td.back">${icon('arrow-left', 'ico-sm')}${t('nf.back')}</a></div></div></div>`;
  }
  const off = tr.status === 'off';
  const draft = tr.status === 'draft';
  return h`<div class="page tk">
    <div class="page-head"><div class="titles"><a class="linkbtn hint tk-back" href="#/trunks" data-action="td.back">${icon('arrow-left', 'ico-xs')}${t('title')}</a>
        <h1 class="row-tight"><span class="mono" translate="no">${tr.name}</span>${ctx.pageHelp()}</h1>
        <span class="sub">${tr.pbx} · ${ctx.ui.describe.sub(tr.sub)} · ${transportLabel(tr)}</span></div>
      <div class="tools">${statusChip(ctx, tr)}
        <button type="button" class="btn" data-action="td.edit" ${raw(draft ? 'aria-disabled="true"' : '')}>${icon('edit')}${t('edit')}</button>
        <button type="button" class="btn btn-primary" data-action="td.test" ${raw(off || draft ? 'aria-disabled="true" aria-describedby="tk-test-h"' : '')}>${icon('phone')}${t('testCall')}</button></div></div>
    ${off || draft ? h`<span class="sr-only" id="tk-test-h">${off ? t('off.testHint') : t('draft.testHint')}</span>` : ''}
    ${tr.status === 'down' ? downBanner(ctx, tr) : ''}
    ${off ? h`<div class="note note-warn">${icon('info')}<div class="grow">${t('off.body', { name: tr.name })}</div><button type="button" class="btn btn-sm" data-action="td.enable">${t('off.turnOn')}</button></div>` : ''}
    ${draft ? h`<div class="note note-info">${icon('info')}<div class="grow">${t('draft.body')}</div><a class="btn btn-sm btn-navy" href="#/connect/sip?trunk=${encodeURIComponent(tr.name)}" data-action="td.continue">${t('continue')}</a></div>` : ''}
    <div class="tk-dgrid">
      <div class="stack-4 tk-main">${healthCard(ctx, tr)}${statsCard(ctx, tr)}${destCard(ctx, tr)}${eventsCard(ctx, tr)}${recentCard(ctx, tr)}</div>
      <div class="stack-4 tk-side">${capacityCard(ctx, tr)}${credCard(ctx, tr)}${edgeCard(ctx, tr)}
        <section class="card tk-danger" aria-labelledby="tk-x-h"><div class="card-head"><h2 id="tk-x-h">${t('danger.title')}</h2></div>
          <div class="card-body stack">${off
            ? h`<p class="hint-xs">${t('danger.offNow')}</p><div><button type="button" class="btn" data-action="td.enable">${t('off.turnOn')}</button></div>`
            : h`<p class="hint-xs">${fallbackName(ctx, tr) == null ? t('danger.bodyHangup') : t('danger.body', { fallback: fallbackName(ctx, tr) })}</p>
              <div><button type="button" class="btn btn-danger-ghost" data-action="td.disable" ${raw(draft ? 'aria-disabled="true"' : '')}>${icon('x-circle')}${t('danger.disable')}</button></div>`}
            <p class="hint-xs">${t('danger.created', { date: tr.createdAt ? fmt.dateProse(tr.createdAt) : fmt.dateProse(tr.name === 'hq-pbx' ? '2026-09-14' : '2026-10-14') })}</p></div></section>
      </div></div></div>`;
}

export function render(ctx) {
  const name = ctx.params.path[0];
  return name ? detailPage(ctx, name) : listPage(ctx);
}

// ---------- modals ----------
function capacityModal(ctx, tr) {
  const { t, html: h, icon, fmt } = ctx;
  let n = tr.concurrent || PRICES.trunkIncludedCalls;
  const min = Math.max(1, tr.status === 'active' ? tr.inUse || 0 : 0);
  const body = () => {
    const m = trunkMonthly(n);
    return h`<div class="stack-3"><p class="hint">${t('capM.intro', { included: PRICES.trunkIncludedCalls })}</p>
      <div class="row"><div class="stepper"><button type="button" data-action="tk.cap.minus" aria-label="${t('capM.less')}" ${raw(n <= min ? 'aria-disabled="true"' : '')}>${icon('minus', 'ico-sm')}</button>
        <output aria-live="polite">${n}</output><button type="button" data-action="tk.cap.plus" aria-label="${t('capM.more')}" ${raw(n >= 100 ? 'aria-disabled="true"' : '')}>${icon('plus', 'ico-sm')}</button></div>
        <span class="hint-xs">${m.extra ? t('capM.line', { included: PRICES.trunkIncludedCalls, extra: m.extra, fee: fmt.int(PRICES.extraConcurrentCall), total: fmt.int(m.extraCost) }) : t('capM.lineIncl', { included: PRICES.trunkIncludedCalls })}</span></div>
      ${n <= min && min > 1 ? h`<p class="hint-xs">${t('capM.min', { n: min })}</p>` : ''}
      <div class="card card-sunken card-pad"><div class="kv"><span class="k">${t('capM.now')}</span><span class="v">${fmt.int(trunkMonthly(tr.concurrent).total)}</span></div>
        <div class="kv kv-total"><span class="k">${t('capM.new')}</span><span class="v">${fmt.int(m.total)}</span></div>
        <p class="hint-xs">${t('capM.rates')}</p></div>
      <span class="chip chip-warn" tabindex="0" data-tip-key="common.plannedPricesTip">${t('common.plannedPrices')}</span></div>`;
  };
  const m = ctx.ui.modal({
    title: t('capM.title', { name: tr.name }), size: 'sm', body: body(),
    actions: {
      'tk.cap.minus': () => { if (n > min) { n -= 1; m.setBody(body()); m.el.querySelector('[data-action="tk.cap.minus"]').focus(); } },
      'tk.cap.plus': () => { if (n < 100) { n += 1; m.setBody(body()); m.el.querySelector('[data-action="tk.cap.plus"]').focus(); } },
    },
    buttons: [
      { label: t('common.cancel') },
      { label: t('capM.save'), kind: 'navy', icon: 'check', onClick: () => {
        const cost = trunkMonthly(n);
        patchTrunk(ctx, tr.name, (x) => ({ ...x, concurrent: n, monthly: cost.extraCost }));
        audit('trunk.capacity.changed', { name: tr.name, concurrent: n }, tr.id);
        ctx.ui.toast(t('toast.T18', { n, fee: fmt.int(cost.total) }), { kind: 'success' });
        return true;
      } },
    ],
  });
}

function editModal(ctx, tr) {
  const { t, html: h, icon } = ctx;
  const fb0 = fallbackOf(ctx, tr);
  const d = { pbx: tr.pbx || 'Generic', transport: tr.transport || 'tls', srtp: !!tr.srtp, failover: tr.failoverSec || 4,
    fb: fb0.kind === 'message' ? `msg:${fb0.flow ? fb0.flow.id : 'default'}` : fb0.kind, fwd: tr.forwardTo || '', fwdErr: false };
  const flows = ctx.list('flows');
  // "When all are down": the same three choices as the wizard (play a message · forward · hang up).
  const fbOpts = [...(flows.length ? flows.map((f) => [`msg:${f.id}`, t('dest.fb.message', { name: ctx.loc(f.name) })]) : [['msg:default', `${t('dest.fb.message', { name: t('dest.fb.defaultName') })} · ${t('dest.fb.default')}`]]),
    ['forward', t('editM.fb.forward')], ['hangup', t('dest.fb.hangup')]];
  const body = () => h`<div class="stack-3">
    <label class="field"><span class="label">${ctx.term(t('cfg.pbx'), 'pbx')}</span><select aria-label="${t('cfg.pbx')}" class="select" data-m="pbx">${PBX.map((p) => h`<option value="${p}" ${raw(d.pbx === p ? 'selected' : '')}>${p === 'Generic' ? t('cfg.generic') : p}</option>`)}</select></label>
    <div class="field"><span class="label">${t('cfg.transport')}</span><div class="seg" role="group" aria-label="${t('cfg.transport')}">${Object.keys(TRANSPORT).map((k) => h`<button type="button" data-action="tk.edit.transport" data-value="${k}" aria-pressed="${d.transport === k}">${TRANSPORT[k]}</button>`)}</div>
      ${d.transport === 'tls' ? '' : h`<span class="hint-xs warn-text">${t('editM.tlsAdvice')}</span>`}</div>
    <div class="row" style="flex-wrap:nowrap"><div class="grow"><strong id="tk-srtp-l">${ctx.term(t('editM.srtp'), 'srtp')}</strong><div class="hint-xs">${d.transport !== 'tls' ? t('editM.srtpNeedsTls') : d.srtp ? t('editM.srtpOn') : t('editM.srtpOff')}</div></div>
      <button type="button" class="toggle" role="switch" data-action="tk.edit.srtp" aria-checked="${d.transport === 'tls' && d.srtp}" aria-labelledby="tk-srtp-l" ${raw(d.transport !== 'tls' ? 'aria-disabled="true"' : '')}></button></div>
    <label class="field"><span class="label">${ctx.term(t('editM.failover'), 'failover')}</span><select aria-label="${t('editM.failover')}" class="select" data-m="failover">${[2, 4, 8].map((s) => h`<option value="${s}" ${raw(d.failover === s ? 'selected' : '')}>${t('common.seconds', { n: s })}</option>`)}</select></label>
    <label class="field"><span class="label">${t('editM.allDown')}</span><select class="select" data-m="allDown">${fbOpts.map(([v, l]) => h`<option value="${v}" ${raw(d.fb === v ? 'selected' : '')}>${l}</option>`)}</select></label>
    ${d.fb === 'forward' ? h`<label class="field"><span class="label">${t('editM.fb.number')}</span><input class="input mono" data-m="fwd" value="${d.fwd}" placeholder="081-xxx-1234" inputmode="tel" translate="no" aria-invalid="${d.fwdErr ? 'true' : 'false'}" aria-describedby="tk-fwd-err">
      ${d.fwdErr ? h`<span class="field-err" id="tk-fwd-err">${t('editM.fb.numberErr')}</span>` : h`<span class="hint-xs" id="tk-fwd-err">${t('editM.fb.numberHint')}</span>`}</label>` : ''}
    <p class="hint-xs">${icon('info', 'ico-xs')} ${t('editM.note')}</p></div>`;
  const sync = (m) => {
    const q = (k) => m.el.querySelector(`[data-m="${k}"]`);
    if (q('pbx')) d.pbx = q('pbx').value;
    if (q('failover')) d.failover = Number(q('failover').value);
    if (q('allDown')) d.fb = q('allDown').value;
    if (q('fwd')) d.fwd = q('fwd').value.trim();
  };
  const m = ctx.ui.modal({
    title: t('editM.title', { name: tr.name }), size: 'md', body: body(),
    actions: {
      'tk.edit.transport': (el, ev, hd) => { sync(hd); d.transport = el.dataset.value; d.srtp = d.transport === 'tls'; hd.setBody(body()); hd.el.querySelector(`[data-action="tk.edit.transport"][data-value="${d.transport}"]`).focus(); },
      'tk.edit.srtp': (el, ev, hd) => { sync(hd); if (d.transport === 'tls') { d.srtp = !d.srtp; hd.setBody(body()); hd.el.querySelector('[data-action="tk.edit.srtp"]').focus(); } },
    },
    buttons: [
      { label: t('common.cancel') },
      { label: t('editM.save'), kind: 'navy', icon: 'check', onClick: (hd) => {
        sync(hd);
        if (d.fb === 'forward' && !/^[0-9+][0-9x\- ]{5,}$/i.test(d.fwd)) {
          d.fwdErr = true; hd.setBody(body());
          const f = hd.el.querySelector('[data-m="fwd"]'); if (f) f.focus();
          return false;
        }
        const fbKind = d.fb.startsWith('msg:') ? 'message' : d.fb;
        patchTrunk(ctx, tr.name, (x) => ({ ...x, pbx: d.pbx, transport: d.transport, srtp: d.transport === 'tls' && d.srtp, failoverSec: d.failover,
          fallback: fbKind, allDown: fbKind === 'message' ? d.fb.slice(4) : null, forwardTo: fbKind === 'forward' ? d.fwd : (x.forwardTo || '') }));
        audit('trunk.updated', { name: tr.name }, tr.id);
        ctx.ui.toast(t('toast.T02'), { kind: 'success', sub: t('editM.saved', { name: tr.name }) });
        return true;
      } },
    ],
  });
  // Choosing "Forward to a number" shows the number field (and hides it again for the other choices).
  m.el.addEventListener('change', (ev) => {
    if (!ev.target.matches || !ev.target.matches('[data-m="allDown"]')) return;
    sync(m);
    d.fwdErr = false;
    m.setBody(body());
    const s = m.el.querySelector('[data-m="allDown"]'); if (s) s.focus();
  });
  return m;
}

function emailModal(ctx, tr, pbx) {
  const { t, html: h } = ctx;
  const preview = `${t('cfg.emailIntro', { name: tr.name })}\n\n${configRows(ctx, tr).map((r) => `${r.label}: ${r.v}`).join('\n')}`;
  ctx.ui.modal({
    title: t('cfg.email'), size: 'md',
    body: h`<label class="field"><span class="label">${t('cfg.emailTo')}</span><input class="input" type="email" data-m="to" value="it@example.com" autocomplete="off"></label>
      <span class="field-err" data-m="err" hidden>${t('cfg.emailErr')}</span>
      <label class="field tk-mt"><span class="label">${t('cfg.emailPreview', { pbx })}</span><textarea class="textarea mono" rows="9" readonly translate="no">${preview}</textarea></label>
      <p class="hint-xs">${t('cfg.emailNoPass')}</p>`,
    buttons: [
      { label: t('common.cancel') },
      { label: t('cfg.emailSend'), kind: 'navy', icon: 'send', onClick: (hd) => {
        const v = hd.el.querySelector('[data-m="to"]').value.trim();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { hd.el.querySelector('[data-m="err"]').hidden = false; return false; }
        ctx.ui.toast(t('toast.T19'), { kind: 'info', demo: true });
        return true;
      } },
    ],
  });
}

// ---------- behaviour ----------
function retest(ctx, name) {
  const st = ctx.state.retest[name] || {};
  if (st.state === 'run') return;
  ctx.state.retest[name] = { state: 'run' };
  ctx.rerender();
  soon(ctx, (s) => { s.retest[name] = { state: 'done', at: nowMs() }; redraw(ctx); }, 1500);
}

export function mount(root, ctx) {
  const { t } = ctx;
  const name = ctx.params.path[0];
  const cur = () => (name ? trunkBy(ctx, name) : null);

  ctx.actions(root, {
    'tk.guide': noop, 'tk.create': noop, 'tk.row': noop, 'tk.view': noop, 'tk.empty.create': noop, 'tk.empty.api': noop, 'tk.continue': noop,
    'tk.down.ticket': noop, 'tk.down.fix': noop, 'tk.tile.fees': noop, 'tk.tile.calls': noop, 'tk.auth': noop, 'tk.transport': noop, 'tk.search': noop,
    'td.back': noop, 'td.logs': noop, 'td.fallback': noop, 'td.call.row': noop, 'td.guide': noop, 'td.continue': noop, 'td.pbx': noop, 'td.dest.prio': noop,
    'tk.filter': (el) => ctx.setState({ filter: el.dataset.value }),
    'tk.clear': () => ctx.setState({ filter: 'all', auth: 'all', transport: 'all', q: '' }),
    'tk.testcall': (el) => { const tr = trunkBy(ctx, el.dataset.value); if (tr) openDialer(ctx, tr); },
    'tk.down.retest': (el) => retest(ctx, el.dataset.value),
    'td.test': () => { const tr = cur(); if (tr) openDialer(ctx, tr); },
    'td.edit': () => { const tr = cur(); if (tr) editModal(ctx, tr); },
    'td.capacity': () => { const tr = cur(); if (tr) capacityModal(ctx, tr); },
    'td.health.range': (el) => ctx.setState({ range: el.dataset.value }),
    // td.copy.<row>: one action id per config row
    ...Object.fromEntries(['domain', 'sig', 'ports', 'media', 'codec', 'dtmf', 'e164', 'transport', 'user'].map((k) => [`td.copy.${k}`, (el) => { const tr = cur(); if (!tr) return; const r = configRows(ctx, tr).find((x) => x.k === k); if (r) ctx.ui.copy(r.v, el); }])),
    'td.download': () => {
      const tr = cur();
      if (!tr) return;
      const pbx = ctx.state.pbxSel[tr.name] || tr.pbx || 'Generic';
      ctx.ui.download(`ants-trunk-${tr.name}-${PBX_KEY[pbx] || 'generic'}.txt`, configText(ctx, tr, pbx));
    },
    'td.email': () => { const tr = cur(); if (tr) emailModal(ctx, tr, ctx.state.pbxSel[tr.name] || tr.pbx); },
    'td.pwd.reveal': () => {
      const tr = cur();
      if (!tr) return;
      ctx.state.reveal[tr.name] = { state: 'shown', at: performance.now() };
      ctx.rerender();
      const nm = tr.name;
      soon(ctx, (s) => { if (s.reveal[nm] && s.reveal[nm].state === 'shown') { s.reveal[nm] = { state: 'used' }; redraw(ctx); } }, REVEAL_SEC * 1000);
    },
    'td.pwd.reset': async () => {
      const tr = cur();
      if (!tr) return;
      const ok = await ctx.ui.confirm({
        title: t('reset.title', { name: tr.name }), body: t('reset.body'),
        consequences: [t('reset.c1'), t('reset.c2'), t('reset.c3')],
        confirmLabel: t('reset.yes'), cancelLabel: t('reset.no'), danger: true, typed: tr.name,
      });
      if (!ok) return;
      audit('trunk.password.reset', { name: tr.name }, tr.id);
      ctx.state.reveal[tr.name] = { state: 'shown', at: performance.now() };
      const nm = tr.name;
      soon(ctx, (s) => { if (s.reveal[nm] && s.reveal[nm].state === 'shown') { s.reveal[nm] = { state: 'used' }; redraw(ctx); } }, REVEAL_SEC * 1000);
      ctx.rerender();
      ctx.ui.toast(t('reset.done'), { kind: 'warn' });
    },
    'td.ip.add': () => {
      const tr = cur();
      if (!tr) return;
      const v = ctx.state.ipInput.trim();
      if (!IP_RE.test(v)) { ctx.setState({ ipErr: t('ip.err') }); const i = root.querySelector('[data-field="ipInput"]'); if (i) i.focus(); return; }
      if ((tr.ips || []).includes(v)) { ctx.setState({ ipErr: t('ip.dup') }); return; }
      const label = ctx.state.ipLabel.trim();
      patchTrunk(ctx, tr.name, (x) => {
        const labels = (x.ips || []).map((ip, i) => (x.ipLabels && x.ipLabels[i]) || '');
        return { ...x, ips: [...(x.ips || []), v], ipLabels: [...labels, label], auth: x.auth === 'credentials' ? 'both' : x.auth };
      });
      audit('trunk.ip.added', { name: tr.name, ip: v }, tr.id);
      ctx.state.ipInput = '';
      ctx.state.ipLabel = '';
      ctx.state.ipErr = null;
      ctx.ui.toast(t('ip.added', { ip: v, name: tr.name }), { kind: 'success' });
    },
    'td.ip.remove': (el) => {
      const tr = cur();
      if (!tr) return;
      const ip = el.dataset.value;
      const before = { ips: tr.ips.slice(), ipLabels: (tr.ipLabels || []).slice(), auth: tr.auth };
      patchTrunk(ctx, tr.name, (x) => {
        const i = x.ips.indexOf(ip);
        return { ...x, ips: x.ips.filter((y) => y !== ip), ipLabels: (x.ipLabels || []).filter((_, k) => k !== i) };
      });
      ctx.ui.toast(t('ip.removed', { ip }), { kind: 'info', timeout: 10000, action: { label: t('common.undo'), onClick: () => patchTrunk(ctx, tr.name, (x) => ({ ...x, ...before })) } });
    },
    'td.dest.toggle': async (el) => {
      const tr = cur();
      if (!tr) return;
      const i = Number(el.dataset.value);
      const u = tr.uris[i];
      const turningOff = u.status !== 'off';
      const others = tr.uris.filter((x, k) => k !== i && x.status === 'healthy');
      if (turningOff && !others.length && tr.status === 'active') {
        const ok = await ctx.ui.confirm({ title: t('dest.lastTitle'), body: t('dest.lastBody'), confirmLabel: t('dest.lastYes'), cancelLabel: t('dest.lastNo'), danger: true });
        if (!ok) return;
      }
      patchTrunk(ctx, tr.name, (x) => ({ ...x, uris: x.uris.map((y, k) => (k === i ? { ...y, status: turningOff ? 'off' : (x.status === 'down' ? 'down' : 'healthy'), replyMs: turningOff ? null : (y.replyMs || 14) } : y)) }));
      ctx.ui.toast(t(turningOff ? 'dest.offToast' : 'dest.onToast', { uri: u.uri }), { kind: 'success' });
    },
    'td.disable': async () => {
      const tr = cur();
      if (!tr) return;
      const fbName = fallbackName(ctx, tr);
      const nums = [...new Set([...ctx.list('numbers').filter((n) => n.routing && n.routing.type === 'trunk' && n.routing.ref === tr.name).map((n) => n.number), ...(tr.attached || [])])];
      const numbers = nums.join(', ') || t('dis.noNumbers');
      const ok = await ctx.ui.confirm({
        title: t('dis.title', { name: tr.name }), body: t('dis.body'),
        consequences: [fbName == null ? t('dis.c1Hangup', { numbers }) : t('dis.c1', { fallback: fbName, numbers }), t('dis.c2'), t('dis.c3')],
        confirmLabel: t('dis.yes'), cancelLabel: t('dis.no'), danger: true, typed: tr.name,
      });
      if (!ok) return;
      patchTrunk(ctx, tr.name, (x) => ({ ...x, prevStatus: x.status, status: 'off', inUse: 0 }));
      audit('trunk.disabled', { name: tr.name }, tr.id);
      ctx.ui.toast(t('toast.T17', { name: tr.name }), { kind: 'success' });
    },
    'td.enable': () => {
      const tr = cur();
      if (!tr) return;
      const back = tr.prevStatus === 'down' ? 'down' : 'active';
      patchTrunk(ctx, tr.name, (x) => ({ ...x, status: back, prevStatus: undefined }));
      audit('trunk.enabled', { name: tr.name }, tr.id);
      ctx.ui.toast(back === 'down' ? t('off.onDown', { name: tr.name }) : t('toast.T16', { name: tr.name }), { kind: back === 'down' ? 'warn' : 'success' });
    },
  });

  ctx.inputs(root, {
    auth: (v) => ctx.setState({ auth: v }),
    transport: (v) => ctx.setState({ transport: v }),
    q: (v) => ctx.setState({ q: v }),
    ipInput: (v) => { ctx.state.ipInput = v; if (ctx.state.ipErr) { ctx.state.ipErr = null; const e = root.querySelector('#tk-ip-err'); if (e) { e.className = 'hint-xs'; e.textContent = t('ip.hint'); } } },
    ipLabel: (v) => { ctx.state.ipLabel = v; },
    pbx: (v) => { const tr = cur(); if (tr) { ctx.state.pbxSel[tr.name] = v; ctx.rerender(); } },
    prio: (v, el, ev) => {
      if (ev.type !== 'change') return;
      const tr = cur();
      if (!tr) return;
      const i = Number(el.dataset.index);
      const p = Math.max(1, Math.min(100, Number(v) || 1));
      patchTrunk(ctx, tr.name, (x) => ({ ...x, uris: x.uris.map((y, k) => (k === i ? { ...y, priority: p } : y)).sort((a, b) => a.priority - b.priority) }));
      ctx.ui.toast(t('dest.prioSaved', { uri: tr.uris[i].uri, p }), { kind: 'success' });
    },
  });
  ctx.on(root, 'keydown', '[data-field="ipInput"], [data-field="ipLabel"]', (ev) => {
    if (ev.key !== 'Enter' || ev.isComposing || ev.keyCode === 229) return;
    ev.preventDefault();
    const b = root.querySelector('[data-action="td.ip.add"]');
    if (b) b.click();
  });

  ctx.watch('trunks', 'calls', 'flows', 'numbers', 'tickets', 'mode', 'subAccounts');

  // Reveal-once countdown ticks without a re-render.
  ctx.every(() => {
    const tr = cur();
    if (!tr) return;
    const rv = ctx.state.reveal[tr.name];
    const el = root.querySelector('[data-tk-left]');
    if (el && rv && rv.state === 'shown') el.textContent = t('cred.hidesIn', { n: Math.max(0, REVEAL_SEC - Math.floor((performance.now() - rv.at) / 1000)) });
  }, 1000);
}
