// Overview — #/overview  (query: ?focus=checklist | ?focus=golive)
// Two states: FIRST-RUN (checklist "First call in 10 minutes", teaching empty states,
// tiles from the visitor's own test calls) and ACTIVE (the busy sample account: alert, KPIs, live calls,
// spend, trunk health, recent calls). Every number comes from the store (js/data/active.js).

import { raw, reducedMotion } from '../core/dom.js';
import { stepsDone, isActive, trialLeft, balance, setStep } from '../core/actions.js';
import { nowMs } from '../data/clock.js';
import { PRICES } from '../data/prices.js';

export const id = 'overview';
export const nav = { group: 'start', icon: 'grid', labelKey: 'nav.overview' };
export const titleKey = 'nav.overview';
export const skeleton = 'dashboard';
export const css = true;
export const initialState = { range: 'today', sub: 'all', ended: [] };

const ROWS = [
  { n: 1, step: 'verify', min: 1 },
  { n: 2, step: 'connect', min: 2 },
  { n: 3, step: 'testCall', min: 1, primary: true },
  { n: 4, step: 'number', min: 3 },
  { n: 5, step: 'cap', min: 1 },
  { n: 6, step: 'live', min: 2 },
];
const SUB_KEYS = { all: null, hq: 'sub_01JB2HQ000', app: 'sub_01JB2APP4K', dv: 'sub_01JB2DV7RX', ck: 'sub_01JB2CKN9S' };
// Checklist motion: a step that turned "done" since this screen last mounted flashes once (check-draw + row-flash).
let lastSteps = null;
let flash = [];
function computeFlash(ctx) {
  const steps = ctx.store.get('onboarding.steps') || {};
  flash = lastSteps && ctx.store.get('mode') === 'firstRun' ? Object.keys(steps).filter((k) => steps[k] === 'done' && lastSteps[k] !== 'done') : [];
}

// ---------- data helpers ----------
function shareFor(ctx, subId) {
  const by = (ctx.store.get('reports') || {}).bySub || [];
  const total = by.reduce((s, x) => s + x.calls, 0) || 1;
  const credits = by.reduce((s, x) => s + x.credits, 0) || 1;
  const row = by.find((x) => x.sub === subId);
  return row ? { calls: row.calls / total, credits: row.credits / credits } : { calls: 1, credits: 1 };
}

/** KPI values for the active account in Live, per range and sub-account. */
function activeStats(ctx) {
  const { range, sub } = ctx.state;
  const subId = SUB_KEYS[sub];
  const sh = subId ? shareFor(ctx, subId) : { calls: 1, credits: 1 };
  const series = ctx.store.get('series') || [];
  const today = ctx.store.get('today');
  const r = ctx.store.get('reports');
  let st;
  if (range === 'today') {
    st = { calls: today.calls, outbound: today.outbound, otp: today.otpNotif, inbound: today.inbound, answered: today.answered, used: today.creditsUsedVoice, failed: today.failed, failed503: today.failed503 };
  } else {
    const days = range === '7d' ? series.slice(-7) : series;
    const sum = (k) => days.reduce((s, d) => s + d[k], 0);
    const calls = sum('calls');
    const failRate = (r.reasons.find((x) => x.key === 'notInService').calls + r.reasons.find((x) => x.key === 'networkUnavailable').calls) / r.calls;
    const f503 = r.reasons.find((x) => x.key === 'networkUnavailable').calls / r.calls;
    st = { calls, outbound: sum('outCalls'), otp: sum('otpSent'), inbound: sum('inCalls'), answered: sum('answered'), used: Math.round(sum('credits') * 100) / 100, failed: Math.round(calls * failRate), failed503: Math.round(calls * f503) };
  }
  if (subId) {
    for (const k of ['calls', 'outbound', 'otp', 'inbound', 'answered', 'failed', 'failed503']) st[k] = Math.round(st[k] * sh.calls);
    st.used = Math.round(st.used * sh.credits * 100) / 100;
  }
  return st;
}

/** KPIs from the calls in the store (first-run account, or Sandbox in the active account). */
function recordStats(ctx) {
  const env = ctx.store.get('env');
  const since = nowMs() - 86400000;
  const list = ctx.list('calls').filter((c) => c.env === env && new Date(c.ts).getTime() >= since);
  const answered = list.filter((c) => c.status === 'completed').length;
  const failed = list.filter((c) => c.status === 'failed').length;
  return { list, calls: list.length, answered, failed, used: list.reduce((s, c) => s + (c.credits || 0), 0), outbound: list.filter((c) => c.direction === 'outbound').length, inbound: list.filter((c) => c.direction === 'inbound').length };
}

const pctOf = (a, b) => (b ? (a / b) * 100 : 0);

// ---------- pieces ----------
function header(ctx) {
  const { t, html: h, fmt, icon } = ctx;
  const active = isActive() && ctx.store.get('env') === 'live';
  return h`<div class="page-head">
    <div class="titles"><h1>${t('title')}${ctx.pageHelp()}</h1><span class="sub">${fmt.dateProse(nowMs(), true)}</span></div>
    <div class="tools">
      <a class="chip chip-ok ov-status" href="#/help/status" data-action="ov.status" data-tip-key="overview.statusTip"><span class="dot dot-ok dot-live"></span>${t('status')}</a>
      <div class="seg" role="group" aria-label="${t('rangeAria')}">${['today', '7d', '30d'].map((r) => h`<button type="button" data-action="ov.range" data-value="${r}" aria-pressed="${ctx.state.range === r}">${t(`range.${r}`)}</button>`)}</div>
      ${active ? h`<select class="select ov-sub" data-field="sub" aria-label="${t('subAria')}">${Object.keys(SUB_KEYS).map((k) => h`<option value="${k}" ${raw(ctx.state.sub === k ? 'selected' : '')}>${k === 'all' ? t('subAll') : ctx.ui.describe.sub(SUB_KEYS[k])}</option>`)}</select>
        <span class="chip chip-info" data-tip-key="term.subaccount" tabindex="0">${t('preview')}</span>` : ''}
      <button type="button" class="btn ${active ? 'btn-primary' : ''}" data-action="ov.testcall" data-tour="test-call-alt">${icon('phone')}${t('testCall')}</button>
    </div></div>`;
}

function checklist(ctx) {
  const { t, html: h, icon, fmt } = ctx;
  const st = ctx.store.get('onboarding');
  const done = stepsDone();
  if (st.cardDismissed) return '';
  if (done === 6) {
    return h`<section class="card ov-live-card" id="checklist" aria-labelledby="chk-h"><div class="burst" aria-hidden="true">${flash.includes('live') && !reducedMotion() ? Array.from({ length: 16 }, (_, i) => raw(`<i style="--dx:${Math.round(Math.cos(i / 16 * 6.283) * 120)}px;--dy:${Math.round(Math.sin(i / 16 * 6.283) * 70)}px;background:${['#F26322', '#14274A', '#1FA971', '#FFC59E'][i % 4]};animation-delay:${(i % 4) * 30}ms"></i>`)) : ''}</div>
      <div class="ov-live-in"><span class="ov-live-ico">${icon('check-circle', 'ico-xl')}</span><div class="grow"><h2 id="chk-h">${t('chk.allDone')}</h2><p class="hint">${t('chk.allDoneBody')}</p></div>
      <div class="row"><button type="button" class="btn btn-navy" data-action="ov.chk.busy">${icon('chart-line')}${t('chk.seeBusy')}</button><button type="button" class="btn btn-ghost" data-action="ov.chk.dismiss">${t('chk.dismiss')}</button></div></div></section>`;
  }
  if (!st.open) {
    return h`<button type="button" class="card ov-chk-slim" data-action="ov.chk.expand"><span class="progress" style="width:120px"><i style="width:${Math.round(done / 6 * 100)}%"></i></span><strong>${t('chk.title')}</strong><span class="hint">${t('chk.progress', { done, total: 6 })}</span>${icon('chevron-down', 'ico-sm')}</button>`;
  }
  const steps = st.steps;
  const calls = ctx.list('calls');
  const lastTest = calls.find((c) => c.source && c.source.type === 'test-call' && c.status === 'completed');
  const key = (ctx.store.get('apiKeys') || [])[0];
  const trunk = (ctx.store.get('trunks') || [])[0];
  const order = (ctx.store.get('numbers') || []).find((n) => n.status === 'in-review');
  const active = (ctx.store.get('numbers') || []).find((n) => n.status === 'active');
  const lim = ctx.store.get('limits');
  const verified = ctx.store.get('verifiedNumbers');
  const statusLine = (r) => {
    const s = steps[r.step];
    if (r.n === 1) return t('chk.1.done', { number: verified[0], more: verified.length - 1 }) + (verified.length > 1 ? ` · ${t('chk.1.more', { n: verified.length - 1 })}` : '');
    if (s === 'done') {
      if (r.n === 2) return trunk ? t('chk.2.doneTrunk', { name: trunk.name }) : t('chk.2.doneKey', { name: key ? key.name : 'sandbox-tests' });
      if (r.n === 3) return t('chk.3.done', { dur: fmt.duration(lastTest ? lastTest.sec : 0) });
      if (r.n === 4) return t('chk.4.done', { number: active ? active.number : '' });
      if (r.n === 5) return t('chk.5.done', { limit: fmt.int(lim.daily), channels: (lim.channels || []).map((c) => t(`chk.ch.${c}`)).join(' + ') || '—' });
      if (r.n === 6) return t('chk.6.done');
    }
    if (s === 'progress' && r.n === 4) return t('chk.4.progress', { date: fmt.dayMonth(order ? order.orderedAt || nowMs() : nowMs()) });
    return t('chk.todo');
  };
  const button = (r) => {
    const s = steps[r.step];
    if (r.n === 1) return h`<button type="button" class="btn btn-sm" data-action="ov.chk.1">${t('chk.1.btn')}</button>`;
    if (r.n === 3 && s === 'done') return h`<a class="btn btn-sm" href="#/logs?call=${lastTest ? lastTest.id : ''}" data-action="ov.chk.3.logs">${icon('list')}${t('chk.3.logs')}</a>`;
    if (r.n === 4 && s === 'progress') return h`<a class="btn btn-sm" href="#/numbers?n=${order ? order.id : ''}" data-action="ov.chk.4.order">${t('chk.4.order')}</a>`;
    if (s === 'done' && r.n !== 5) return '';
    const cls = r.primary ? 'btn-primary' : '';
    return h`<button type="button" class="btn btn-sm ${cls}" data-action="ov.chk.${r.n}" ${raw(r.n === 3 ? 'data-tour="test-call"' : '')}>${r.n === 3 ? icon('phone') : ''}${t(`chk.${r.n}.btn`)}</button>`;
  };
  return h`<section class="card ov-chk" id="checklist" aria-labelledby="chk-h">
    <div class="card-head"><div class="grow stack" style="gap:6px"><h2 id="chk-h">${t('chk.title')}</h2>
      <div class="row-tight"><span class="progress" style="width:200px" role="progressbar" aria-valuemin="0" aria-valuemax="6" aria-valuenow="${done}" aria-label="${t('chk.title')}"><i class="scale" style="transform:scaleX(${done / 6})"></i></span><span class="hint strong">${t('chk.progress', { done, total: 6 })}</span></div></div>
      <button type="button" class="btn btn-sm btn-ghost" data-action="ov.chk.collapse">${t('chk.collapse')}</button></div>
    <ol class="ov-rows">${ROWS.map((r) => {
      const s = steps[r.step];
      const fresh = flash.includes(r.step);
      return h`<li class="ov-row ${fresh ? 'row-flash' : ''}" data-step="${r.step}" data-state="${s}">
        <span class="ov-circ ${s}">${s === 'done' ? raw(`<svg class="ico ico-sm ${fresh ? 'check-draw' : ''}" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>`) : r.n}</span>
        <div class="grow ov-row-txt"><div class="ov-row-t"><strong>${t(`chk.${r.n}.title`)}</strong> <span class="hint">· ${t('chk.minutes', { n: r.min })}</span></div>
          <div class="ov-row-s ${s}">${statusLine(r)}</div>
          ${s !== 'done' ? h`<div class="hint">${t(`chk.${r.n}.help`)}</div>` : ''}</div>
        <div class="ov-row-a">${button(r)}</div></li>`;
    })}</ol></section>`;
}

function tile(ctx, key, value, line, href, tipKey) {
  const { html: h, t } = ctx;
  const inner = h`<span class="t">${tipKey ? ctx.term(t(`tile.${key}`), tipKey) : t(`tile.${key}`)}</span><span class="v">${value}</span><span class="h clamp-2" title="${line}">${line}</span>`;
  return href ? h`<a class="card tile tile-link" href="${href}" data-action="ov.tile.${key}">${inner}</a>` : h`<div class="card tile">${inner}</div>`;
}

function tilesActive(ctx) {
  const { t, fmt, html: h } = ctx;
  const st = activeStats(ctx);
  const today = ctx.store.get('today');
  const subId = SUB_KEYS[ctx.state.sub];
  const subRow = (ctx.store.get('subAccounts') || []).find((x) => x.id === subId);
  const own = subRow && subRow.ownAllocation;
  const avg = ctx.store.get('billing.avgPerDay7');
  const range = ctx.state.range;
  return h`<div class="grid g-5 ov-tiles">
    ${tile(ctx, 'credits', own ? fmt.floor(own.left) : fmt.floor(balance()), own ? t('tile.creditsOwn', { moved: fmt.int(own.moved) }) : t('tile.creditsLine', { days: fmt.int(Math.floor(balance() / avg)) }), '#/billing')}
    ${tile(ctx, 'calls', fmt.int(st.calls), t('tile.callsLine', { out: fmt.int(st.outbound), otp: fmt.int(st.otp), inb: fmt.int(st.inbound) }), `#/logs?range=${range}`)}
    ${tile(ctx, 'answered', fmt.pct(range === 'today' && !subId ? today.answerRatePct : pctOf(st.answered, st.calls)), t('tile.answeredLine', { a: fmt.int(st.answered), b: fmt.int(st.calls) }), `#/reports?range=${range}`, 'answer_rate')}
    ${tile(ctx, 'used', fmt.int(st.used), range === 'today' ? t('tile.usedLine', { voice: fmt.int(today.monthVoice), all: fmt.int(today.monthAll) }) : t('tile.usedRange'), '#/billing?section=usage')}
    ${tile(ctx, 'failed', fmt.pct(range === 'today' && !subId ? today.failedPct : pctOf(st.failed, st.calls)), t('tile.failedLine', { n: fmt.int(st.failed), sip: fmt.int(st.failed503) }), `#/logs?status=failed&range=${range}`)}
  </div>`;
}

function tilesRecords(ctx, rs) {
  const { t, fmt, html: h, icon } = ctx;
  if (!rs.calls) {
    return h`<div class="card ov-strip"><span class="ov-strip-ico">${icon('chart')}</span><span class="grow">${t('strip')}</span>
      <button type="button" class="btn btn-sm" data-action="ov.strip.call">${icon('phone')}${t('chk.3.btn')}</button></div>`;
  }
  const sandbox = ctx.store.get('env') === 'sandbox';
  return h`<div class="grid g-5 ov-tiles">
    ${sandbox ? tile(ctx, 'trial', t('tile.trialValue', { left: fmt.num(trialLeft(), 1), total: fmt.int(PRICES.trial.minutes) }), t('tile.trialLine', { otpCalls: fmt.int(PRICES.trial.minutes / PRICES.trial.otpCallUses) }), null)
      : tile(ctx, 'credits', fmt.floor(balance()), t('tile.creditsLive'), '#/billing')}
    ${tile(ctx, 'calls', fmt.int(rs.calls), t('tile.callsLineSimple', { out: fmt.int(rs.outbound), inb: fmt.int(rs.inbound) }), '#/logs?range=today')}
    ${tile(ctx, 'answered', fmt.pct(pctOf(rs.answered, rs.calls)), t('tile.answeredLine', { a: fmt.int(rs.answered), b: fmt.int(rs.calls) }), '#/reports?range=today', 'answer_rate')}
    ${tile(ctx, 'used', fmt.credits(rs.used), sandbox ? t('tile.usedSandbox') : t('tile.usedRange'), '#/billing?section=usage')}
    ${tile(ctx, 'failed', fmt.pct(pctOf(rs.failed, rs.calls)), t('tile.failedLineSimple', { n: fmt.int(rs.failed) }), '#/logs?status=failed&range=today')}
  </div>`;
}

function chartCard(ctx, rs) {
  const { t, fmt, html: h, icon } = ctx;
  const busy = isActive() && ctx.store.get('env') === 'live';
  let days;
  if (busy) {
    const series = ctx.store.get('series');
    days = ctx.state.range === '30d' ? series : series.slice(-7);
  } else {
    days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(nowMs() - (6 - i) * 86400000);
      return { date: fmt.isoDate(d), calls: i === 6 ? rs.calls : 0, answered: i === 6 ? rs.answered : 0 };
    });
  }
  const labels = days.map((d) => (days.length > 10 ? fmt.dayMonth(d.date) : fmt.weekdayDay(d.date)));
  const values = days.map((d) => d.calls);
  const total = values.reduce((a, b) => a + b, 0);
  const empty = !busy && !rs.calls;
  const peak = days.reduce((a, d) => (d.calls > a.calls ? d : a), days[0]);
  const chart = ctx.ui.chart.line({
    labels, values, empty,
    format: (v) => (days.length > 10 ? fmt.compact(v) : fmt.int(v)),
    showValues: days.length <= 10,
    ariaLabel: empty ? t('chart.emptyAria') : t('chart.aria', { from: fmt.dayMonth(days[0].date), to: fmt.dayMonth(days[days.length - 1].date), peak: fmt.int(peak.calls), peakDay: fmt.weekdayDay(peak.date) }),
    links: empty ? null : days.map((d) => ({ href: `#/logs?date=${d.date}`, action: 'ov.chart.point', tip: t('chart.pointTip', { day: fmt.dayMonth(d.date), calls: fmt.int(d.calls), answered: fmt.int(d.answered) }) })),
  });
  return h`<div class="card span-2 ov-chart">
    <div class="card-head"><h2>${t('chart.title')}</h2>${!empty ? h`<span class="hint">${t('chart.total', { total: fmt.int(total), avg: fmt.int(total / days.length) })}</span>` : ''}</div>
    <div class="card-body" style="position:relative">${chart}
      ${empty ? h`<div class="ov-chart-empty"><div class="ov-chart-msg"><strong>${t('chart.empty')}</strong><span class="hint">${t('chart.emptyHint')}</span>
        <button type="button" class="btn btn-sm btn-navy" data-action="ov.chart.empty">${icon('phone')}${t('chart.emptyBtn')}</button></div></div>` : ''}</div></div>`;
}

function notConnected(ctx, rs) {
  const { t, fmt, html: h } = ctx;
  const busy = isActive() && ctx.store.get('env') === 'live';
  let items;
  let total;
  if (busy) {
    const nc = ctx.store.get('today.notConnected');
    total = nc.total;
    items = [
      { key: 'noAnswer', code: 'no-answer', value: nc.noAnswer, hint: t('nc.phoneOff', { n: fmt.int(nc.phoneOff) }), color: 'var(--amber)' },
      { key: 'busy', code: 'busy', value: nc.busy, color: '#F2B35C' },
      { key: 'failed', code: 'failed', value: nc.failed, hint: t('nc.failedHint', { a: nc.failed503, b: nc.failed404, c: nc.failedOther }), color: 'var(--red)' },
      { key: 'notDialled', code: 'rejected', value: nc.notDialled, hint: t('nc.notDialledHint', { a: nc.dnc, b: nc.hours, c: nc.intl }), color: 'var(--slate)' },
    ];
  } else {
    const list = rs.list.filter((c) => c.status !== 'completed');
    if (!list.length) return '';
    total = list.length;
    const count = (s) => list.filter((c) => c.status === s).length;
    items = [
      { key: 'noAnswer', code: 'no-answer', value: count('no-answer'), color: 'var(--amber)' },
      { key: 'busy', code: 'busy', value: count('busy'), color: '#F2B35C' },
      { key: 'failed', code: 'failed', value: count('failed'), color: 'var(--red)' },
      { key: 'canceled', code: 'canceled', value: count('canceled'), color: 'var(--slate)' },
    ].filter((x) => x.value);
  }
  return h`<div class="card ov-nc"><div class="card-head"><h2>${t('nc.title')}</h2><span class="hint tnum">${fmt.int(total)}</span></div>
    <div class="card-body stack" style="gap:12px">${items.map((it) => {
      const pct = total ? Math.round((it.value / total) * 100) : 0;
      return h`<a class="ov-nc-row" href="#/logs?status=${it.code}&range=today" data-action="ov.notconn.row" data-value="${it.code}">
        <span class="row" style="justify-content:space-between;flex-wrap:nowrap;gap:8px"><span class="clip">${t(`nc.${it.key}`)}</span><span class="mono nowrap">${fmt.int(it.value)} · ${pct}%</span></span>
        <span class="progress" style="margin-top:5px"><i style="width:${pct}%;background:${it.color}"></i></span>
        ${it.hint ? h`<span class="hint-xs">${it.hint}</span>` : ''}</a>`;
    })}</div></div>`;
}

function liveCalls(ctx) {
  const { t, fmt, html: h, icon } = ctx;
  const live = ctx.list('liveCalls');
  const total = ctx.store.get('today.liveTotal') - (ctx.state.ended || []).length;
  const rows = live.filter((c) => !(ctx.state.ended || []).includes(c.id));
  return h`<div class="card span-2 ov-livecalls"><div class="card-head"><h2><span class="dot dot-ok dot-live" style="margin-right:8px"></span>${t('live.title')}</h2><span class="hint">${t('live.count', { n: fmt.int(total) })}</span></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>${t('live.started')}</th><th>${t('live.dir')}</th><th>${t('live.source')}</th><th>${t('live.party')}</th><th>${t('live.state')}</th><th class="num">${t('live.elapsed')}</th><th><span class="sr-only">${t('live.end')}</span></th></tr></thead>
    <tbody>${rows.map((c) => h`<tr>
      <td class="mono">${fmt.time(c.startedAt)}</td>
      <td>${ctx.ui.describe.direction(c)}</td>
      <td class="ov-live-src">${ctx.ui.describe.source({ source: c.source })}${c.source.detail ? h` <span class="hint-xs">· ${ctx.loc(c.source.detail)}</span>` : ''}</td>
      <td><a class="mono" href="#/logs?call=${c.id}" data-action="ov.live.row" translate="no">${c.party}</a></td>
      <td>${ctx.ui.describe.statusChip(c.state)}</td>
      <td class="num mono" data-live-start="${new Date(c.startedAt).getTime()}">${fmt.duration((nowMs() - new Date(c.startedAt).getTime()) / 1000)}</td>
      <td class="num"><button type="button" class="btn btn-ghost btn-sm btn-icon" data-action="ov.live.hangup" data-value="${c.id}" aria-label="${t('live.end')}" data-tip-key="overview.live.end">${icon('phone-off')}</button></td></tr>`)}</tbody></table></div>
    <div class="card-foot"><a class="linkbtn" href="#/logs?status=in-progress" data-action="ov.live.more">${t('live.more', { n: Math.max(0, total - rows.length) })}</a></div></div>`;
}

function spendCard(ctx) {
  const { t, fmt, html: h, icon } = ctx;
  const today = ctx.store.get('today');
  const lim = ctx.store.get('limits');
  const used = today.creditsUsedVoice + today.creditsUsedOther;
  const pct = Math.min(100, Math.round((used / lim.daily) * 100));
  return h`<div class="card ov-spend"><div class="card-head"><h2>${t('spend.title')}</h2><button type="button" class="btn btn-sm" data-action="ov.spend.edit">${icon('edit')}${t('spend.edit')}</button></div>
    <div class="card-body stack"><div class="row" style="align-items:baseline;gap:6px"><span class="ov-big tnum">${fmt.int(used)}</span><span class="hint">/ ${fmt.int(lim.daily)}</span></div>
    <span class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${t('spend.title')}"><i style="width:${pct}%"></i></span>
    <span class="hint-xs">${t('spend.line', { voice: fmt.int(today.creditsUsedVoice), other: fmt.int(today.creditsUsedOther) })}</span>
    <span class="hint-xs">${t('spend.block')}</span></div></div>`;
}

function trunkCard(ctx) {
  const { t, fmt, html: h, icon } = ctx;
  const trunks = ctx.list('trunks');
  if (!trunks.length) {
    return h`<div class="card ov-trunks"><div class="card-head"><h2>${ctx.term(t('trunk.title'), 'sip_trunk')}</h2></div>
      <div class="empty"><span class="art">${icon('server')}</span><strong>${t('trunk.empty')}</strong><span class="hint">${t('trunk.emptyHint')}</span>
      <a class="btn btn-sm" href="#/connect/sip" data-action="ov.trunk.empty">${icon('plus')}${t('trunk.create')}</a></div></div>`;
  }
  return h`<div class="card ov-trunks"><div class="card-head"><h2>${ctx.term(t('trunk.title'), 'sip_trunk')}</h2><a class="btn btn-sm" href="#/trunks" data-action="ov.trunk.all">${t('trunk.all')}</a></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>${t('trunk.name')}</th><th>${t('trunk.status')}</th><th class="num">${ctx.term(t('trunk.inUse'), 'concurrent')}</th></tr></thead>
    <tbody>${trunks.map((tr) => h`<tr><td><a class="strong" href="#/trunks/${tr.name}" data-action="ov.trunk.row" translate="no">${tr.name}</a></td>
      <td>${tr.status === 'down' ? h`<span class="chip chip-err" tabindex="0" data-tip-key="overview.trunk.downTip">${t('trunk.down')}</span> <span class="hint-xs">${t('trunk.since', { time: fmt.timeShort(tr.downSince) })}</span>` : tr.status === 'draft' ? h`<span class="chip">${t('trunk.draft')}</span>` : h`<span class="chip chip-ok">${t('trunk.active')}</span>`}</td>
      <td class="num mono">${tr.inUse || 0} / ${tr.concurrent}</td></tr>`)}</tbody></table></div>
    ${trunks.some((x) => x.status === 'down') ? h`<div class="card-foot hint-xs">${t('trunk.note')}</div>` : ''}</div>`;
}

function recentCard(ctx) {
  const { t, fmt, html: h } = ctx;
  const env = ctx.store.get('env');
  const calls = ctx.list('calls').filter((c) => c.env === env).slice(0, 8);
  if (!calls.length) {
    return h`<div class="card ov-recent"><div class="card-head"><h2>${t('recent.title')}</h2></div>
      <div class="empty"><div class="steps">
        <div><span class="stepnum">1</span>${t('recent.e1')}</div><div><span class="stepnum">2</span>${t('recent.e2')}</div><div><span class="stepnum">3</span>${t('recent.e3')}</div></div>
        <a class="btn btn-sm btn-navy" href="#/connect" data-action="ov.recent.empty">${t('recent.open')}</a></div></div>`;
  }
  return h`<div class="card ov-recent"><div class="card-head"><h2>${t('recent.title')}</h2><a class="btn btn-sm" href="#/logs" data-action="ov.recent.all">${t('recent.all')}</a></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>${t('recent.time')}</th><th>${t('recent.party')}</th><th>${t('recent.dir')}</th><th>${t('recent.source')}</th><th>${t('recent.status')}</th><th class="num">${t('recent.talk')}</th><th class="num">${ctx.term(t('recent.credits'), 'billing_minute')}</th></tr></thead>
    <tbody>${calls.map((c) => h`<tr class="${c.source && c.source.type === 'test-call' && ctx.state.fresh === c.id ? 'new-row' : ''}">
      <td class="mono"><a href="#/logs?call=${c.id}" data-action="ov.recent.row">${fmt.time(c.ts)}</a></td>
      <td class="mono" translate="no">${ctx.ui.describe.party(c)}</td>
      <td>${ctx.ui.describe.direction(c)}</td>
      <td class="clip" style="max-width:260px">${ctx.ui.describe.source(c)}</td>
      <td>${ctx.ui.describe.statusChip(c.status)}</td>
      <td class="num mono">${c.sec ? fmt.duration(c.sec) : '—'}</td>
      <td class="num mono">${fmt.credits2(c.credits || 0)}</td></tr>`)}</tbody></table></div></div>`;
}

function alertBanner(ctx) {
  const { t, html: h, icon } = ctx;
  const a = ctx.store.get('today.alert');
  if (!a || a.acknowledged) return '';
  const c = (ctx.store.get('campaigns') || []).find((x) => x.id === a.campaign);
  return h`<div class="note note-warn ov-alert" role="status">${icon('alert')}
    <div class="grow"><strong>${t('alert.title', { pct: a.pct })}</strong> · ${t('alert.body', { failed: a.failed, of: a.of, from: a.from, to: a.to, campaign: c ? ctx.loc(c.name) : '', threshold: a.threshold, resolved: a.resolvedAt })}</div>
    <div class="row"><a class="btn btn-sm" href="#/logs?status=failed&src=${a.campaign}&range=24h" data-action="ov.alert.logs">${t('alert.logs')}</a>
    <a class="btn btn-sm" href="#/alerts" data-action="ov.alert.rules">${t('alert.rules')}</a>
    <button type="button" class="btn btn-sm btn-ghost" data-action="ov.alert.ack">${t('alert.ack')}</button></div></div>`;
}

// ---------- screen contract ----------
export function render(ctx) {
  const { html: h } = ctx;
  computeFlash(ctx);
  const busy = isActive() && ctx.store.get('env') === 'live';
  const rs = recordStats(ctx);
  const firstRun = ctx.store.get('mode') === 'firstRun';
  if (busy) {
    return h`<div class="page ov">${header(ctx)}${alertBanner(ctx)}${tilesActive(ctx)}
      <div class="grid g-3">${chartCard(ctx, rs)}${notConnected(ctx, rs)}</div>
      <div class="grid g-3">${liveCalls(ctx)}<div class="stack-4">${spendCard(ctx)}${trunkCard(ctx)}</div></div>
      ${recentCard(ctx)}</div>`;
  }
  const nc = notConnected(ctx, rs);
  return h`<div class="page ov">${header(ctx)}${firstRun ? checklist(ctx) : ''}${tilesRecords(ctx, rs)}
    <div class="grid g-3">${chartCard(ctx, rs)}${nc || trunkCard(ctx)}</div>
    ${nc ? h`<div class="grid g-3"><div class="span-2">${recentCard(ctx)}</div>${trunkCard(ctx)}</div>` : recentCard(ctx)}</div>`;
}

export function mount(root, ctx) {
  const { t } = ctx;
  lastSteps = { ...(ctx.store.get('onboarding.steps') || {}) };

  ctx.actions(root, {
    'ov.range': (el) => ctx.setState({ range: el.dataset.value }),
    'ov.testcall': () => ctx.ui.dialer.open({ source: 'overview' }),
    'ov.strip.call': () => ctx.ui.dialer.open({ source: 'overview' }),
    'ov.chart.empty': () => ctx.ui.dialer.open({ source: 'overview' }),
    'ov.chk.1': () => ctx.ui.dialer.verifyNumber(),
    'ov.chk.2': () => ctx.go(ctx.store.get('onboarding.role') === 'pbx' ? 'connect/sip' : 'connect/api'),
    'ov.chk.3': () => ctx.ui.dialer.open({ source: 'overview' }),
    'ov.chk.4': () => ctx.go('numbers/buy'),
    'ov.chk.5': () => ctx.ui.spendingLimits(),
    'ov.chk.6': () => ctx.ui.goLive(),
    'ov.spend.edit': () => ctx.ui.spendingLimits(),
    'ov.chk.collapse': () => ctx.store.set('onboarding.open', false),
    'ov.chk.expand': () => ctx.store.set('onboarding.open', true),
    // CONTRACT: screens switch the demo dataset by dispatching 'demo:mode' (app.js owns the swap + toast).
    'ov.chk.busy': () => window.dispatchEvent(new CustomEvent('demo:mode', { detail: 'active' })),
    'ov.chk.dismiss': () => ctx.store.set('onboarding.cardDismissed', true),
    'ov.alert.ack': () => {
      ctx.store.set('today.alert.acknowledged', true);
      ctx.store.update('alertHistory', (l) => l.map((a) => (a.status === 'open' ? { ...a, status: 'acknowledged', by: ctx.store.get('user.name') } : a)));
      ctx.ui.toast(t('toast.T28'), { kind: 'success' });
    },
    'ov.live.hangup': async (el) => {
      const ok = await ctx.ui.confirm({ title: t('live.endTitle'), body: t('live.endBody'), confirmLabel: t('live.endYes'), cancelLabel: t('live.keep'), danger: true });
      if (!ok) return;
      ctx.setState({ ended: [...(ctx.state.ended || []), el.dataset.value] });
      ctx.ui.toast(t('toast.T46'), { kind: 'info', demo: true });
    },
  });
  ctx.inputs(root, { sub: (v) => ctx.setState({ sub: v }) });
  // Re-render on the data this screen shows.
  ctx.watch('calls', 'onboarding', 'env', 'mode', 'credits', 'trunks', 'numbers', 'limits', 'today', 'verifiedNumbers', 'apiKeys');
  // Live timers tick from the demo clock.
  ctx.every(() => {
    root.querySelectorAll('[data-live-start]').forEach((td) => { td.textContent = ctx.fmt.duration((nowMs() - Number(td.dataset.liveStart)) / 1000); });
  }, 1000);
  // Deep links: ?focus=checklist scrolls to the first undone row · ?focus=golive opens the go-live flow.
  const focus = ctx.params.query.focus;
  if (focus === 'checklist' && ctx.store.get('mode') === 'firstRun') {
    if (!ctx.store.get('onboarding.open')) ctx.store.set('onboarding.open', true);
    ctx.later(() => {
      const c = root.querySelector('#checklist');
      if (c) c.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
      const b = root.querySelector('.ov-row:not([data-state="done"]) .ov-row-a .btn');
      if (b) b.focus({ preventScroll: true });
    }, 80);
  }
  if (focus === 'golive' && ctx.store.get('env') === 'sandbox') ctx.later(() => { ctx.go('overview', { replace: true }); ctx.ui.goLive(); }, 60);
  // A test call made from the Connect screen marks "Choose how to connect" too (a key exists then).
  if (ctx.store.get('mode') === 'firstRun' && (ctx.list('apiKeys').length || ctx.list('trunks').length)) setStep('connect', 'done');
}
