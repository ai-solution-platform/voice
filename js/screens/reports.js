// Reports — #/reports   (query: ?range=today|7d|30d|custom · ?sub=<sub id or key> · ?from=&to= for custom)
// Answer rate, average talk time, post-dial delay, calls and call credits; outcomes per day, cost by day and the
// post-dial-delay trend; why calls did not connect; credits by sub-account; campaign comparison. Every chart point and
// row drills down into Logs. "Email me this report" is a one-off email (no scheduled reports).
// Totals come from the store: 7 days = the sample 7-day report exactly, today = Overview's tiles, 30 days = the series.

import { html as h, raw, reducedMotion } from '../core/dom.js';
import { isActive, activePlan, planMinutesIn } from '../core/actions.js';
import { nowMs } from '../data/clock.js';

export const id = 'reports';
export const nav = { group: 'operate', icon: 'chart', labelKey: 'nav.reports' };
export const titleKey = 'nav.reports';
export const skeleton = 'dashboard';
export const css = true;
export const initialState = { range: '7d', gran: 'daily', sub: 'all', from: '2026-10-21', to: '2026-10-27', _raw: null };

export const commands = [
  { id: 'export', labelKey: 'cmd.export', icon: 'download', keywords: ['report export csv answer rate'], run: ({ go }) => go('reports?range=7d') },
];

const SUB_KEYS = { all: null, hq: 'sub_01JB2HQ000', app: 'sub_01JB2APP4K', dv: 'sub_01JB2DV7RX', ck: 'sub_01JB2CKN9S' };
const RANGES = ['today', '7d', '30d', 'custom'];
// Groups of "not connected" outcomes, and their 7-day totals: no answer · busy or declined · failed or blocked.
const GROUP_7D = { na: 1322 + 486 + 30, bd: 548 + 176 + 22, fb: 198 + 103 + 88 + 41 + 6 };
const GROUP_OF = { noAnswer: 'na', phoneOff: 'na', callerHungUp: 'na', busy: 'bd', declined: 'bd', canceled: 'bd', notInService: 'fb', networkUnavailable: 'fb', otherFailed: 'fb', dnc: 'fb', hours: 'fb', intlOff: 'fb' };
// Drill-down filter for Logs per reason.
const REASON_LOGS = {
  noAnswer: 'status=no-answer&reason=480-19', phoneOff: 'status=no-answer&reason=480-20', callerHungUp: 'status=canceled&reason=487',
  busy: 'status=busy&reason=486', declined: 'status=busy&reason=603', canceled: 'status=canceled&reason=487',
  notInService: 'status=failed&reason=404', networkUnavailable: 'status=failed&reason=503', otherFailed: 'status=failed',
  dnc: 'status=rejected&reason=VOICE_4204', hours: 'status=rejected&reason=VOICE_4205', intlOff: 'status=rejected&reason=VOICE_4202',
};
// Sample per-day post-dial delay (seconds) and average talk time. 21–27 Oct averages 2.6 s; 27 Oct is
// higher because of the 14:06–14:24 incident (peak 4.1 s at 14:10).
const PDD_FIX = { '2026-10-21': 2.5, '2026-10-22': 2.6, '2026-10-23': 2.4, '2026-10-24': 2.5, '2026-10-25': 2.4, '2026-10-26': 2.6, '2026-10-27': 3.1 };
const pddOf = (date) => PDD_FIX[date] ?? Math.round((2.4 + ((Number(date.slice(8)) * 7) % 5) / 10) * 10) / 10;
const talkOf = (date) => 85 + ((Number(date.slice(8)) * 11) % 13);
// Today by hour (07:00–14:35): weights for calls, the incident's 26 failed calls land in the 14:00 bucket.
const HOURS = ['07', '08', '09', '10', '11', '12', '13', '14'];
const HOUR_W = [2, 6, 12, 15, 14, 16, 17, 12];
// Not-connected calls lean to the early morning and the lunch hour, so the answer rate differs from hour to hour.
const HOUR_NC = [4, 9, 12, 13, 12, 19, 16, 12];
// Share of a weekday's calls made before 14:35: compares today so far with the same span last week.
const SHARE_TO_NOW = 0.62;

/**
 * The one answer-rate definition (shared with Campaigns): answered ÷ finished attempts, where finished =
 * answered + no answer + busy + failed. Queued and in-progress calls are not counted.
 */
export function answerRate(k) {
  if (!k || (k.noAnswer == null && k.busy == null && k.failed == null)) return null;
  const finished = (k.answered || 0) + (k.noAnswer || 0) + (k.busy || 0) + (k.failed || 0);
  return finished ? (k.answered / finished) * 100 : null;
}
const FINAL = ['completed', 'no-answer', 'busy', 'failed', 'canceled', 'rejected'];
const HOUR_PDD = [2.5, 2.4, 2.5, 2.6, 2.5, 2.6, 2.7, 3.6];
const AVG = { today: { talk: 88, talkIn: 139, pdd: 2.9 }, '7d': null, '30d': { talk: 92, talkIn: 141, pdd: 2.6 } };

/** Split an integer total by weights (largest remainder), so the parts always add up. */
function distribute(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const raw2 = weights.map((w) => (total * w) / sum);
  const out = raw2.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = raw2.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; k < order.length && left > 0; k++, left--) out[order[k][1]] += 1;
  return out;
}
const r2 = (n) => Math.round(n * 100) / 100;

function subId(ctx) { return SUB_KEYS[ctx.state.sub] || null; }
function share(ctx) {
  const sid = subId(ctx);
  const by = (ctx.store.get('reports') || {}).bySub || [];
  if (!sid || !by.length) return { calls: 1, credits: 1, planMin: 1 };
  const tc = by.reduce((s, x) => s + x.calls, 0);
  const tcr = by.reduce((s, x) => s + x.credits, 0);
  const tpm = by.reduce((s, x) => s + (x.planMin || 0), 0) || 1;
  const row = by.find((x) => x.sub === sid);
  return row ? { calls: row.calls / tc, credits: row.credits / tcr, planMin: (row.planMin || 0) / tpm } : { calls: 1, credits: 1, planMin: 1 };
}

function splitGroups(nc) {
  const [na, bd, fb] = distribute(nc, [GROUP_7D.na, GROUP_7D.bd, GROUP_7D.fb]);
  return { na, bd, fb };
}

/** Everything the screen shows for the current filter. */
function build(ctx) {
  const series = ctx.store.get('series') || [];
  const rep = ctx.store.get('reports');
  if (!series.length || !rep) return null;
  const range = ctx.state.range;
  const sh = share(ctx);
  let points;
  let tiles;
  let reasons;
  let prev = null;
  if (range === 'today') {
    const today = ctx.store.get('today');
    const d = series[series.length - 1];
    const nc = today.notConnected;
    const fbBase = nc.failed + nc.notDialled - nc.failed503;
    const ans = distribute(today.answered, HOUR_W);
    const na = distribute(nc.noAnswer, HOUR_NC);
    const bd = distribute(nc.busy, HOUR_NC);
    const fb = distribute(fbBase, HOUR_NC).map((v, i) => v + (i === HOURS.length - 1 ? nc.failed503 : 0));
    // keep each hour consistent: answered + not connected = calls
    const credits = distribute(Math.round(d.credits * 100), HOUR_W).map((c) => c / 100);
    const pmin = distribute(Math.round(d.planMin || 0), HOUR_W);
    points = HOURS.map((hh, i) => {
      const notC = na[i] + bd[i] + fb[i];
      return { key: `${d.date}T${hh}`, date: d.date, hour: hh, calls: ans[i] + notC, answered: ans[i], na: na[i], bd: bd[i], fb: fb[i], credits: credits[i], planMin: pmin[i], pdd: HOUR_PDD[i], talk: 80 + i * 2 };
    });
    tiles = {
      outAnswered: d.outAnswered, outCalls: d.outCalls, otpAns: d.otpAnswered, otpSent: d.otpSent, inAns: d.inAnswered, inCalls: d.inCalls,
      talk: AVG.today.talk, talkIn: AVG.today.talkIn, pdd: AVG.today.pdd, peak: rep.pddPeak, calls: today.calls, outbound: today.outbound, otp: today.otpNotif, inbound: today.inbound, credits: d.credits, planMin: Math.round(d.planMin || 0),
    };
    // Same weekday last week, over the same span (00:00 to now), so today-so-far is compared like for like.
    const base = (series[series.length - 8]) || null;
    if (base) prev = { label: 'prevWeekday', date: base.date, rate: (base.outAnswered / base.outCalls) * 100, credits: r2(base.credits * SHARE_TO_NOW), planMin: Math.round((base.planMin || 0) * SHARE_TO_NOW), calls: Math.round(base.calls * SHARE_TO_NOW) };
    const [busy, declined, canceled] = distribute(nc.busy, [548, 176, 22]);
    reasons = [
      { key: 'noAnswer', code: 'SIP 480 / 487 · Q.850 19', calls: nc.noAnswer - nc.phoneOff },
      { key: 'busy', code: 'SIP 486', calls: busy },
      { key: 'phoneOff', code: 'SIP 480 · Q.850 20', calls: nc.phoneOff },
      { key: 'notInService', code: 'SIP 404', calls: nc.failed404 },
      { key: 'declined', code: 'SIP 603', calls: declined },
      { key: 'networkUnavailable', code: 'SIP 503', calls: nc.failed503 },
      { key: 'otherFailed', code: 'SIP 4xx / 5xx', calls: nc.failedOther },
      { key: 'dnc', code: 'VOICE_4204', calls: nc.dnc },
      { key: 'hours', code: 'VOICE_4205', calls: nc.hours },
      { key: 'canceled', code: 'SIP 487', calls: canceled },
      { key: 'intlOff', code: 'VOICE_4202', calls: nc.intl },
    ];
  } else {
    let days;
    if (range === '7d') days = series.slice(-7);
    else if (range === '30d') days = series.slice(-30);
    else days = series.filter((d) => d.date >= ctx.state.from && d.date <= ctx.state.to);
    if (!days.length) days = series.slice(-1);
    points = days.map((d) => {
      const g = splitGroups(d.calls - d.answered);
      return { key: d.date, date: d.date, calls: d.calls, answered: d.answered, ...g, outCalls: d.outCalls, outAnswered: d.outAnswered, credits: d.credits, planMin: Math.round(d.planMin || 0), pdd: pddOf(d.date), talk: talkOf(d.date) };
    });
    const sum = (k) => days.reduce((s, d) => s + d[k], 0);
    const is7 = range === '7d';
    const avg = is7 ? { talk: rep.avgTalkSec, talkIn: rep.avgTalkInboundSec, pdd: rep.pddSec } : range === '30d' ? AVG['30d']
      : { talk: Math.round(points.reduce((s, p) => s + p.talk * p.calls, 0) / Math.max(1, sum('calls'))), talkIn: 140, pdd: Math.round((points.reduce((s, p) => s + p.pdd * p.calls, 0) / Math.max(1, sum('calls'))) * 10) / 10 };
    tiles = {
      outAnswered: sum('outAnswered'), outCalls: sum('outCalls'), otpAns: sum('otpAnswered'), otpSent: sum('otpSent'), inAns: sum('inAnswered'), inCalls: sum('inCalls'),
      talk: avg.talk, talkIn: avg.talkIn, pdd: avg.pdd, peak: range === '30d' || is7 || days.some((d) => d.date === '2026-10-27') ? rep.pddPeak : null,
      calls: sum('calls'), outbound: sum('outCalls'), otp: sum('otpSent'), inbound: sum('inCalls'), credits: r2(sum('credits')), planMin: planMinutesIn(days),
    };
    if (is7) tiles.credits = rep.credits;
    const n = days.length;
    const idx = series.indexOf(days[0]);
    const before = idx >= n ? series.slice(idx - n, idx) : [];
    if (before.length === n) {
      const s2 = (k) => before.reduce((s, d) => s + d[k], 0);
      prev = { label: 'prevPeriod', rate: (s2('outAnswered') / s2('outCalls')) * 100, credits: r2(s2('credits')), planMin: planMinutesIn(before), calls: s2('calls') };
    }
    const nc = sum('calls') - sum('answered');
    const parts = is7 ? rep.reasons.map((x) => x.calls) : distribute(nc, rep.reasons.map((x) => x.calls));
    reasons = rep.reasons.map((x, i) => ({ key: x.key, code: x.code, calls: parts[i] }));
  }
  // Sub-account filter: counts scale by the sub-account's share of calls, credits by its share of credits.
  if (subId(ctx)) {
    const sc = (v) => Math.round(v * sh.calls);
    for (const k of ['outAnswered', 'outCalls', 'otpAns', 'otpSent', 'inAns', 'inCalls', 'calls', 'outbound', 'otp', 'inbound']) tiles[k] = sc(tiles[k]);
    tiles.credits = r2(tiles.credits * sh.credits);
    tiles.planMin = Math.round((tiles.planMin || 0) * sh.planMin);
    points = points.map((p) => ({ ...p, calls: sc(p.na + p.bd + p.fb + p.answered), answered: sc(p.answered), na: sc(p.na), bd: sc(p.bd), fb: sc(p.fb), outCalls: p.outCalls == null ? null : sc(p.outCalls), outAnswered: p.outAnswered == null ? null : sc(p.outAnswered), credits: r2(p.credits * sh.credits), planMin: Math.round((p.planMin || 0) * sh.planMin) }))
      .map((p) => ({ ...p, calls: p.answered + p.na + p.bd + p.fb }));
    const parts = distribute(Math.round(reasons.reduce((s, r) => s + r.calls, 0) * sh.calls), reasons.map((r) => r.calls));
    reasons = reasons.map((r, i) => ({ ...r, calls: parts[i] }));
    prev = null;
  }
  const totalCalls = tiles.calls || 1;
  reasons = reasons.filter((r) => r.calls > 0).map((r) => ({ ...r, pct: (r.calls / totalCalls) * 100 })).sort((a, b) => b.calls - a.calls);
  return { points, tiles, reasons, prev, hourly: range === 'today' };
}

/** The same report without the sub-account filter (the sub-account table always shows every sub-account). */
function buildAll(ctx) {
  const keep = ctx.state.sub;
  ctx.state.sub = 'all';
  try { return build(ctx); } finally { ctx.state.sub = keep; }
}

/** First-run / no series: the visitor's own calls (Sandbox test calls) in the store. */
function records(ctx) {
  const list = ctx.list('calls');
  const finished = list.filter((c) => FINAL.includes(c.status));
  return { calls: list.length, finished: finished.length, answered: finished.filter((c) => c.status === 'completed').length, credits: r2(list.reduce((s, c) => s + (c.credits || 0), 0)), list };
}

// ---------- pieces ----------
function header(ctx) {
  const { t, fmt, icon } = ctx;
  const active = isActive();
  const st = ctx.state;
  return h`<div class="page-head">
    <div class="titles"><h1>${t('title')}${ctx.pageHelp()}</h1><span class="sub">${t('sub', { time: fmt.timeShort(nowMs()), date: fmt.dateProse(nowMs()) })}</span></div>
    <div class="tools">
      <div class="seg" role="group" aria-label="${t('rangeAria')}">${RANGES.map((r) => h`<button type="button" data-action="rp.range" data-value="${r}" aria-pressed="${st.range === r}">${r === 'custom' && st.range === 'custom' ? t('range.customSet', { from: fmt.dayMonth(st.from), to: fmt.dayMonth(st.to) }) : t(`range.${r}`)}</button>`)}</div>
      <div class="stack rp-gran" style="gap:2px"><div class="seg seg-sm" role="group" aria-label="${t('granAria')}">
        <button type="button" data-action="rp.gran" data-value="daily" aria-pressed="${st.gran === 'daily'}">${t(st.range === 'today' ? 'gran.hourly' : 'gran.daily')}</button>
        <button type="button" data-action="rp.gran" data-value="monthly" aria-pressed="false" aria-disabled="true" aria-describedby="rp-gran-help" data-disabled-help="rp-gran-help">${t('gran.monthly')}</button></div>
        <span class="hint-xs" id="rp-gran-help" tabindex="-1">${t('gran.help')}</span></div>
      ${active ? h`<select class="select rp-sub" data-field="rp.sub" aria-label="${t('subAria')}">${Object.keys(SUB_KEYS).map((k) => h`<option value="${k}" ${raw(st.sub === k ? 'selected' : '')}>${k === 'all' ? t('subAll') : ctx.ui.describe.sub(SUB_KEYS[k])}</option>`)}</select>
        <span class="chip chip-info" tabindex="0" data-tip-key="term.subaccount">${t('preview')}</span>` : ''}
    </div></div>
    <div class="row rp-actions"><button type="button" class="btn" data-action="rp.export">${icon('download')}${t('export')}</button>
      <button type="button" class="btn" data-action="rp.email">${icon('mail')}${t('email')}</button>
      ${ctx.store.get('env') === 'sandbox' ? h`<span class="hint-xs">${icon('info', 'ico-xs')} ${t('sandboxNote')}</span>` : ''}</div>`;
}

function rangeQuery(ctx) {
  const st = ctx.state;
  return st.range === 'custom' ? `range=custom&from=${st.from}&to=${st.to}` : `range=${st.range}`;
}

/** A previous period's call usage in the one wording: credits, and on a plan the plan minutes too. */
const prevUsed = (ctx, p) => (activePlan() ? ctx.ui.describe.used(p.credits, p.planMin, { plan: true }) : ctx.fmt.credits2(p.credits));

function tilesCard(ctx, d) {
  const { t, fmt } = ctx;
  const tl = d.tiles;
  const rate = tl.outCalls ? (tl.outAnswered / tl.outCalls) * 100 : 0;
  const rq = rangeQuery(ctx);
  const prevLabel = () => t(`delta.${d.prev.label}`, { day: d.prev.date ? fmt.weekdayDay(d.prev.date) : '', time: fmt.timeShort(nowMs()) });
  const delta = (cur, prev, unit) => {
    if (prev == null) return '';
    const diff = cur - prev;
    if (Math.abs(diff) < 0.05) return t('delta.same', { label: prevLabel() });
    return t(diff > 0 ? 'delta.up' : 'delta.down', { n: unit === 'pt' ? fmt.num(Math.abs(diff), 1) : fmt.int(Math.abs(diff)), label: prevLabel() });
  };
  const tile = (key, term, value, line, href) => h`<a class="card tile rp-tile" href="${href}" data-action="rp.tile.${key}"><span class="t">${term ? ctx.term(t(`tile.${key}`), term) : t(`tile.${key}`)}</span><span class="v">${value}</span><span class="h">${line}</span></a>`;
  return h`<div class="grid g-5 rp-tiles">
    ${tile('answer', 'answer_rate', fmt.pct(rate), h`${t('tile.answerLine', { a: fmt.int(tl.outAnswered), b: fmt.int(tl.outCalls) })}${d.prev ? h`<br>${delta(rate, d.prev.rate, 'pt')}` : ''}<br>${t('tile.answerOther', { otp: fmt.pct(tl.otpSent ? (tl.otpAns / tl.otpSent) * 100 : 0), inb: fmt.pct(tl.inCalls ? (tl.inAns / tl.inCalls) * 100 : 0) })}`, `#/logs?status=completed&${rq}`)}
    ${tile('talk', null, t('dur', { m: Math.floor(tl.talk / 60), s: tl.talk % 60 }), t('tile.talkLine', { m: Math.floor(tl.talkIn / 60), s: tl.talkIn % 60 }), `#/logs?status=completed&${rq}`)}
    ${tile('pdd', 'pdd', t('sec', { n: fmt.num(tl.pdd, 1) }), tl.peak ? t('tile.pddPeak', { n: fmt.num(tl.peak.sec, 1), day: fmt.dayMonth(tl.peak.at), time: fmt.timeShort(tl.peak.at) }) : t('tile.pddTarget'), `#/logs?${rq}&sort=pdd`)}
    ${tile('calls', null, fmt.int(tl.calls), t('tile.callsLine', { out: fmt.int(tl.outbound), otp: fmt.int(tl.otp), inb: fmt.int(tl.inbound) }), `#/logs?${rq}`)}
    ${tile('credits', 'billing_minute', fmt.credits2(tl.credits), h`${activePlan() ? h`<span class="strong" data-rp="planmin">${ctx.ui.describe.plusPlanMin(tl.planMin)}</span><br>` : ''}${t('tile.creditsLine')}${d.prev && !subId(ctx) ? h`<br>${d.prev.label === 'prevWeekday' ? t('tile.creditsPrevDay', { n: prevUsed(ctx, d.prev), label: prevLabel() }) : t('tile.creditsPrev', { n: prevUsed(ctx, d.prev) })}` : ''}`, `#/logs?${rq}&sort=credits`)}
  </div>
  <p class="hint-xs rp-def">${ctx.icon('info', 'ico-xs')} ${t('def.answerRate')}</p>`;
}

function outcomesChart(ctx, d) {
  const { t, fmt } = ctx;
  const pts = d.points;
  const max = Math.max(1, ...pts.map((p) => p.answered + p.na + p.bd + p.fb)) * 1.08;
  const every = pts.length > 14 ? Math.ceil(pts.length / 10) : 1;
  const label = (p) => (d.hourly ? `${p.hour}:00` : pts.length > 10 ? fmt.dayMonth(p.date) : fmt.weekdayDay(p.date));
  const href = (p) => (d.hourly ? `#/logs?date=${p.date}&hour=${p.hour}` : `#/logs?date=${p.date}`);
  const total = pts.reduce((s, p) => s + p.answered + p.na + p.bd + p.fb, 0);
  return h`<div class="card rp-out"><div class="card-head"><h2>${t('chart.outcomes')}</h2>
      <span class="rp-legend">${['answered', 'na', 'bd', 'fb'].map((k) => h`<span><i class="sw sw-${k}"></i>${t(`out.${k}`)}</span>`)}</span></div>
    <div class="card-body"><div class="rp-bars" style="--n:${pts.length}" role="group" aria-label="${t('chart.outcomesAria', { total: fmt.int(total), from: label(pts[0]), to: label(pts[pts.length - 1]) })}">
      ${pts.map((p, i) => {
        const all = p.answered + p.na + p.bd + p.fb;
        const tip = t('chart.outTip', { day: d.hourly ? `${p.hour}:00` : fmt.dayMonth(p.date), calls: fmt.int(all), a: fmt.int(p.answered), na: fmt.int(p.na), bd: fmt.int(p.bd), fb: fmt.int(p.fb) });
        const last = i === pts.length - 1;
        return h`<a class="rp-bar ${last ? 'is-last' : ''}" href="${href(p)}" data-action="rp.chart.outcomes" data-tip="${tip}" aria-label="${tip}">
          <span class="rp-val">${pts.length <= 10 ? fmt.int(all) : ''}</span>
          <span class="rp-stack" style="height:${((all / max) * 100).toFixed(1)}%"><i class="fb" style="flex:${p.fb}"></i><i class="bd" style="flex:${p.bd}"></i><i class="na" style="flex:${p.na}"></i><i class="an" style="flex:${p.answered}"></i></span>
          <span class="rp-day">${i % every === 0 || last ? label(p) : ''}</span></a>`;
      })}</div>${d.hourly ? h`<p class="hint-xs" style="margin-top:6px">${t('chart.hourlyNote')}</p>` : ''}</div></div>`;
}

function lineCard(ctx, d, kind) {
  const { t, fmt } = ctx;
  const pts = d.points;
  const labels = pts.map((p) => (d.hourly ? `${p.hour}:00` : pts.length > 10 ? fmt.dayMonth(p.date) : fmt.weekdayDay(p.date)));
  const isCost = kind === 'cost';
  const values = pts.map((p) => (isCost ? p.credits : p.pdd));
  const format = isCost ? (v) => (pts.length > 10 ? fmt.compact(v) : fmt.int(v)) : (v) => fmt.num(v, 1);
  const href = (p) => (d.hourly ? `#/logs?date=${p.date}&hour=${p.hour}${isCost ? '' : '&sort=pdd'}` : `#/logs?date=${p.date}${isCost ? '' : '&sort=pdd'}`);
  const sum = values.reduce((a, b) => a + b, 0);
  const peakI = values.indexOf(Math.max(...values));
  const onPlan = isCost && !!activePlan();
  const planSum = onPlan ? pts.reduce((a, p) => a + (p.planMin || 0), 0) : 0;
  const chart = ctx.ui.chart.line({
    labels, values, format, showValues: pts.length <= 10, height: 220,
    ariaLabel: isCost ? t(d.hourly ? 'chart.costAriaHour' : 'chart.costAria', { total: fmt.credits2(sum), peak: labels[peakI] }) : t('chart.pddAria', { peak: fmt.num(values[peakI], 1), at: labels[peakI] }),
    links: pts.map((p, i) => ({ href: href(p), action: isCost ? 'rp.chart.cost' : 'rp.chart.pdd', tip: isCost ? (onPlan ? t('chart.costTipPlan', { day: labels[i], used: ctx.ui.describe.used(p.credits, p.planMin, { plan: true }) }) : t('chart.costTip', { day: labels[i], credits: fmt.credits2(p.credits) })) : t('chart.pddTip', { day: labels[i], n: fmt.num(p.pdd, 1) }) })),
  });
  return h`<div class="card rp-line"><div class="card-head"><h2>${isCost ? t(d.hourly ? 'chart.costHour' : 'chart.cost') : ctx.term(t('chart.pdd'), 'pdd')}</h2>
      <span class="hint">${isCost ? (onPlan ? ctx.ui.describe.used(sum, planSum, { plan: true }) : t('chart.costTotal', { total: fmt.credits2(sum) })) : t('chart.pddTarget')}</span></div>
    <div class="card-body">${chart}${isCost ? h`<p class="hint-xs">${onPlan ? h`${t('chart.costNotePlan')} ` : ''}${t('chart.costNote')}</p>` : ''}</div></div>`;
}

function reasonsCard(ctx, d) {
  const { t, fmt, icon } = ctx;
  const total = d.reasons.reduce((s, r) => s + r.calls, 0);
  const rq = rangeQuery(ctx);
  return h`<section class="card rp-reasons" aria-labelledby="rp-reasons-h"><div class="card-head"><h2 id="rp-reasons-h">${t('why.title')}</h2><span class="hint tnum">${t('why.total', { n: fmt.int(total) })}</span>
      <a class="linkbtn" href="#/help/article/answer-rate-tips" data-action="rp.why.tips">${icon('book')}${t('why.tips')}</a></div>
    ${d.reasons.length ? h`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>${t('why.reason')}</th><th>${ctx.term(t('why.code'), 'sip_code')}</th><th class="num">${t('why.calls')}</th><th class="num">${t('why.pct')}</th><th class="rp-barcol"><span class="sr-only">${t('why.share')}</span></th></tr></thead>
      <tbody>${d.reasons.map((r) => h`<tr class="rp-click" data-action="rp.reason.row" data-value="${r.key}" tabindex="0" data-href="#/logs?${REASON_LOGS[r.key]}&${rq}">
        <td class="strong">${t(`reason.${r.key}`)}${GROUP_OF[r.key] === 'fb' && /^VOICE/.test(r.code) ? h` <span class="hint-xs">· ${t('why.notDialled')}</span>` : ''}</td><td class="mono hint" translate="no">${r.code}</td>
        <td class="num mono">${fmt.int(r.calls)}</td><td class="num mono">${fmt.pct(r.pct)}</td>
        <td class="rp-barcol"><span class="progress"><i class="rp-g-${GROUP_OF[r.key]}" style="width:${Math.max(2, Math.round((r.calls / (d.reasons[0].calls || 1)) * 100))}%"></i></span></td></tr>`)}</tbody></table></div>
      <div class="card-foot hint-xs">${t('why.foot')}</div>`
    : h`<div class="empty"><span class="art">${icon('check-circle')}</span><strong>${t('why.none')}</strong></div>`}</section>`;
}

function subCard(ctx, d) {
  const { t, fmt } = ctx;
  const rep = ctx.store.get('reports');
  const range = ctx.state.range;
  const by = rep.bySub || [];
  // 7 days = the sample 7-day reasons table; other ranges scale it to the range's calls and credits.
  const k = range === '7d' ? 1 : (buildAll(ctx).tiles.calls / rep.calls);
  // Scaled rows always add up to the tiles above (largest remainder on calls and on cents).
  const full = subId(ctx) ? buildAll(ctx) : d;
  const callsParts = range === '7d' ? by.map((x) => x.calls) : distribute(full.tiles.calls, by.map((x) => x.calls));
  const centParts = range === '7d' ? by.map((x) => Math.round(x.credits * 100)) : distribute(Math.round(full.tiles.credits * 100), by.map((x) => x.credits));
  const onPlan = !!activePlan();
  const pmParts = !onPlan ? by.map(() => 0) : range === '7d' ? by.map((x) => x.planMin || 0) : distribute(Math.round(full.tiles.planMin || 0), by.map((x) => x.planMin || 0));
  const rows = by.map((b, i) => ({ ...b, calls: callsParts[i], credits: centParts[i] / 100, planMin: pmParts[i], billedMin: b.billedMin == null ? null : Math.round(b.billedMin * k), otp: b.otpAnswered ? Math.round(b.otpAnswered * k) : null }));

  const totalCredits = rows.reduce((s, r) => s + r.credits, 0) || 1;
  const sid = subId(ctx);
  return h`<section class="card rp-subs" aria-labelledby="rp-subs-h"><div class="card-head"><h2 id="rp-subs-h">${t('subs.title')}</h2><span class="chip chip-info" tabindex="0" data-tip-key="term.subaccount">${t('preview')}</span></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>${t('subs.sub')}</th><th class="num">${t('subs.calls')}</th><th class="num">${t('subs.min')}</th><th class="num">${t('subs.credits')}</th>${onPlan ? h`<th class="num">${t('subs.planMin')}</th>` : ''}<th>${t('subs.share')}</th></tr></thead>
    <tbody>${rows.map((r) => {
      const key = Object.keys(SUB_KEYS).find((x) => SUB_KEYS[x] === r.sub);
      const pct = Math.round((r.credits / totalCredits) * 100);
      return h`<tr class="rp-click ${sid === r.sub ? 'is-sel' : ''}" data-action="rp.sub.row" data-value="${key}" tabindex="0" aria-selected="${sid === r.sub}">
        <td class="strong">${ctx.ui.describe.sub(r.sub)}</td><td class="num mono">${fmt.int(r.calls)}</td>
        ${r.billedMin != null ? h`<td class="num mono">${fmt.int(r.billedMin)}</td>` : h`<td class="num"><span class="hint-xs">${t('subs.otp', { n: fmt.int(r.otp || 0) })}</span></td>`}
        <td class="num mono">${fmt.credits2(r.credits)}</td>${onPlan ? h`<td class="num mono">${fmt.int(r.planMin || 0)}</td>` : ''}<td><span class="row-tight nowrap"><span class="progress rp-share"><i style="width:${pct}%"></i></span><span class="hint-xs tnum">${pct}%</span></span></td></tr>`;
    })}
    <tr class="rp-total"><td>${t('subs.total')}</td><td class="num mono">${fmt.int(rows.reduce((s, r) => s + r.calls, 0))}</td><td></td><td class="num mono">${fmt.credits2(rows.reduce((s, r) => s + r.credits, 0))}</td>${onPlan ? h`<td class="num mono">${fmt.int(rows.reduce((s, r) => s + (r.planMin || 0), 0))}</td>` : ''}<td></td></tr></tbody></table></div>
    <div class="card-foot hint-xs">${t('subs.foot')}${onPlan ? ` ${t('subs.planFoot')}` : ''}${sid ? h` · <button type="button" class="linkbtn" data-action="rp.sub.clear">${t('subs.clear')}</button>` : ''}</div></section>`;
}

function campaignsCard(ctx) {
  const { t, fmt } = ctx;
  const list = ctx.list('campaigns').filter((c) => c.status === 'running' || c.status === 'completed').slice(0, 4);
  if (!list.length) return '';
  // Same definition as Campaigns: answered ÷ finished (answered + no answer + busy + failed).
  const rate = (c) => {
    const k = c.status === 'running' ? c.progress : c.result;
    const r = answerRate(k);
    return r != null ? r : (c.result && c.result.answeredPct) || 0;
  };
  const toCall = (c) => c.toCall;
  const chip = (c) => (c.status === 'running' ? h`<span class="chip chip-info"><span class="dot dot-ok dot-live"></span>${t('camp.running')}</span>` : h`<span class="chip chip-ok">${t('camp.completed')}</span>`);
  return h`<section class="card rp-camps" aria-labelledby="rp-camps-h"><div class="card-head"><h2 id="rp-camps-h">${t('camp.title')}</h2><a class="btn btn-sm" href="#/campaigns" data-action="rp.camp.all">${t('camp.all')}</a></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>${t('camp.name')}</th><th class="num">${t('camp.toCall')}</th><th class="num">${ctx.term(t('camp.answered'), 'answer_rate')}</th><th class="num">${t('camp.credits')}</th><th>${t('camp.status')}</th></tr></thead>
    <tbody>${list.map((c) => h`<tr class="rp-click" data-action="rp.camp.row" data-value="${c.id}" tabindex="0">
      <td><a class="strong" href="#/campaigns/${c.id}" data-action="rp.camp.link">${ctx.loc(c.name)}</a></td><td class="num mono">${fmt.int(toCall(c))}</td>
      <td class="num mono">${fmt.pct(rate(c))}${c.status === 'running' ? h` <span class="hint-xs">${t('camp.soFar')}</span>` : ''}</td><td class="num mono">${c.planMin ? ctx.ui.describe.used(c.credits || 0, c.planMin) : fmt.credits2(c.credits || 0)}</td><td>${chip(c)}</td></tr>`)}</tbody></table></div></section>`;
}

function emptyView(ctx) {
  const { t, fmt, icon } = ctx;
  const rs = records(ctx);
  return h`<div class="grid g-4 rp-tiles">
      <div class="card tile"><span class="t">${ctx.term(t('tile.answer'), 'answer_rate')}</span><span class="v">${rs.finished ? fmt.pct((rs.answered / rs.finished) * 100) : '—'}</span><span class="h">${t('tile.answerLineAll', { a: fmt.int(rs.answered), b: fmt.int(rs.finished) })}</span></div>
      <div class="card tile"><span class="t">${t('tile.calls')}</span><span class="v">${fmt.int(rs.calls)}</span><span class="h">${t('empty.callsLine')}</span></div>
      <div class="card tile"><span class="t">${t('tile.credits')}</span><span class="v">${fmt.credits2(rs.credits)}</span><span class="h">${t('empty.creditsLine')}</span></div>
      <div class="card tile"><span class="t">${ctx.term(t('tile.pdd'), 'pdd')}</span><span class="v">—</span><span class="h">${t('tile.pddTarget')}</span></div></div>
    <div class="card rp-empty"><div class="empty empty-center"><span class="art">${icon('chart')}</span><strong>${t('empty.title')}</strong>
      <span class="hint" style="max-width:520px">${t('empty.body')}</span>
      <div class="row" style="justify-content:center"><button type="button" class="btn btn-navy" data-action="rp.empty.call">${icon('phone')}${t('empty.call')}</button>
      <a class="btn" href="#/help/article/answer-rate-tips" data-action="rp.empty.learn">${icon('book')}${t('why.tips')}</a>
      ${rs.calls ? h`<a class="btn" href="#/logs" data-action="rp.empty.logs">${icon('list')}${t('empty.logs')}</a>` : ''}</div></div></div>`;
}

// ---------- screen contract ----------
function syncQuery(ctx) {
  if (ctx.state._raw === ctx.params.raw) return;
  ctx.state._raw = ctx.params.raw;
  const q = ctx.params.query;
  if (q.range && RANGES.includes(q.range)) ctx.state.range = q.range === 'custom' && !(q.from && q.to) ? ctx.state.range : q.range;
  if (q.range === 'custom' && q.from && q.to) { ctx.state.from = q.from; ctx.state.to = q.to; }
  if (q.sub) {
    const key = SUB_KEYS[q.sub] !== undefined ? q.sub : Object.keys(SUB_KEYS).find((k) => SUB_KEYS[k] === q.sub);
    if (key) ctx.state.sub = key;
  }
}

export function render(ctx) {
  syncQuery(ctx);
  const d = build(ctx);
  if (!d) return h`<div class="page rp">${header(ctx)}${emptyView(ctx)}</div>`;
  return h`<div class="page rp">${header(ctx)}${tilesCard(ctx, d)}
    <div class="grid g-2 rp-charts">${outcomesChart(ctx, d)}${lineCard(ctx, d, 'cost')}</div>
    <div class="grid g-2 rp-charts">${lineCard(ctx, d, 'pdd')}${subCard(ctx, d)}</div>
    ${reasonsCard(ctx, d)}${campaignsCard(ctx)}</div>`;
}

// ---------- files + dialogs ----------
function exportCsv(ctx) {
  const { t, fmt } = ctx;
  const d = build(ctx);
  const st = ctx.state;
  const name = st.range === 'custom' ? `custom_${st.from}_${st.to}` : st.range;
  const file = `ants-voice-report_${name}${subId(ctx) ? `_${st.sub}` : ''}.csv`;
  const cell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [];
  let n = 0;
  if (d) {
    // answer_rate = answered ÷ finished (answered + no answer + busy + failed), all channels, as in the Outcomes chart;
    // outbound_answer_rate is the "Answer rate (outbound)" tile. Daily rows only carry the outbound split.
    lines.push([d.hourly ? 'hour' : 'date', 'calls', 'answered', 'no_answer', 'busy_or_declined', 'failed_or_not_dialled', 'answer_rate', 'outbound_calls', 'outbound_answered', 'outbound_answer_rate', 'talk_seconds_avg', 'pdd_avg', 'credits', ...(activePlan() ? ['plan_minutes'] : [])].join(','));
    for (const p of d.points) {
      const all = p.answered + p.na + p.bd + p.fb;
      const out = p.outCalls ? (p.outAnswered / p.outCalls).toFixed(3) : '';
      lines.push([d.hourly ? `${p.date}T${p.hour}:00:00+07:00` : p.date, all, p.answered, p.na, p.bd, p.fb, all ? (p.answered / all).toFixed(3) : '', p.outCalls ?? '', p.outAnswered ?? '', out, p.talk, p.pdd.toFixed(1), p.credits.toFixed(2), ...(activePlan() ? [p.planMin || 0] : [])].map(cell).join(','));
      n += 1;
    }
    lines.push('');
    lines.push(['reason', 'code', 'calls', 'pct_of_all_calls', 'reason_text'].join(','));
    for (const r of d.reasons) lines.push([r.key, r.code, r.calls, r.pct.toFixed(1), t(`reason.${r.key}`)].map(cell).join(','));
  } else {
    lines.push(['call_id', 'started_at', 'status', 'talk_seconds', 'credits'].join(','));
    for (const c of ctx.list('calls')) { lines.push([c.id, fmt.iso(c.ts), c.status, c.sec || 0, (c.credits || 0).toFixed(2)].map(cell).join(',')); n += 1; }
  }
  ctx.ui.download(file, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
  ctx.ui.toast(t('toast.T05', { n: fmt.int(n) }), { kind: 'success' });
}

function emailReport(ctx) {
  const { t, fmt, icon } = ctx;
  const st = ctx.state;
  const rangeLabel = st.range === 'custom' ? t('range.customSet', { from: fmt.dayMonth(st.from), to: fmt.dayMonth(st.to) }) : t(`range.${st.range}`);
  const body = h`<div class="stack-3">
    <div class="note">${icon('chart')}<span>${t('emailM.what', { range: rangeLabel, sub: st.sub === 'all' ? t('subAll') : ctx.ui.describe.sub(SUB_KEYS[st.sub]) })}</span></div>
    <label class="field"><span class="label">${t('emailM.to')}</span><input class="input" data-e="to" value="${ctx.store.get('user.email')}" autocomplete="off" spellcheck="false">
      <span class="hint-xs">${t('emailM.toHint')}</span></label>
    <span class="field-err" data-e="err" hidden>${t('emailM.bad')}</span>
    <div class="field"><span class="label">${t('emailM.format')}</span><div class="row"><label class="check"><input type="checkbox" data-e="csv" checked>CSV</label><label class="check"><input type="checkbox" data-e="pdf" checked>PDF</label></div></div>
    <p class="hint-xs">${t('emailM.once')}</p></div>`;
  ctx.ui.modal({
    title: t('emailM.title'), body, size: 'sm',
    buttons: [{ label: t('common.cancel') }, {
      label: t('emailM.send'), kind: 'navy', icon: 'send', onClick: (m, btn) => {
        const list = m.el.querySelector('[data-e="to"]').value.split(/[,\s]+/).filter(Boolean);
        const ok = list.length && list.every((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
        if (!ok) { m.el.querySelector('[data-e="err"]').hidden = false; m.el.querySelector('[data-e="to"]').setAttribute('aria-invalid', 'true'); return false; }
        btn.setAttribute('aria-busy', 'true');
        btn.innerHTML = String(h`<span class="spin"></span>${t('emailM.send')}`);
        setTimeout(() => { m.close(); ctx.ui.toast(t('toast.T40'), { kind: 'success', demo: true }); }, reducedMotion() ? 300 : 700);
        return false;
      },
    }],
  });
}

function customRange(ctx) {
  const { t } = ctx;
  const series = ctx.store.get('series') || [];
  const min = series.length ? series[0].date : '2026-10-27';
  const max = series.length ? series[series.length - 1].date : '2026-10-27';
  const body = h`<div class="stack-3"><div class="grid g-2">
      <label class="field"><span class="label">${t('custom.from')}</span><input class="input" type="date" data-r="from" min="${min}" max="${max}" value="${ctx.state.from}"></label>
      <label class="field"><span class="label">${t('custom.to')}</span><input class="input" type="date" data-r="to" min="${min}" max="${max}" value="${ctx.state.to}"></label></div>
    <span class="field-err" data-r="err" hidden>${t('custom.bad')}</span>
    <p class="hint-xs">${t('custom.hint', { from: ctx.fmt.dateProse(min), to: ctx.fmt.dateProse(max) })}</p></div>`;
  ctx.ui.modal({
    title: t('custom.title'), body, size: 'sm',
    buttons: [{ label: t('common.cancel') }, {
      label: t('custom.apply'), kind: 'navy', onClick: (m) => {
        const from = m.el.querySelector('[data-r="from"]').value;
        const to = m.el.querySelector('[data-r="to"]').value;
        if (!from || !to || from > to || from < min || to > max) { m.el.querySelector('[data-r="err"]').hidden = false; return false; }
        ctx.setState({ range: 'custom', from, to });
        setHash(ctx);
        return true;
      },
    }],
  });
}

/** Keep the address in sync with the filter (linkable) without re-routing. */
function setHash(ctx) {
  const st = ctx.state;
  const q = new URLSearchParams();
  q.set('range', st.range);
  if (st.range === 'custom') { q.set('from', st.from); q.set('to', st.to); }
  if (st.sub !== 'all') q.set('sub', st.sub);
  const raw2 = `reports?${q.toString()}`;
  st._raw = raw2;
  ctx.params.raw = raw2;
  history.replaceState(history.state, '', `${location.pathname}${location.search}#/${raw2}`);
}

export function mount(root, ctx) {
  ctx.actions(root, {
    'rp.range': (el) => {
      if (el.dataset.value === 'custom') { customRange(ctx); return; }
      ctx.setState({ range: el.dataset.value });
      setHash(ctx);
    },
    'rp.gran': () => {},
    'rp.export': () => exportCsv(ctx),
    'rp.email': () => emailReport(ctx),
    'rp.sub.row': (el) => { ctx.setState({ sub: ctx.state.sub === el.dataset.value ? 'all' : el.dataset.value }); setHash(ctx); },
    'rp.sub.clear': () => { ctx.setState({ sub: 'all' }); setHash(ctx); },
    'rp.reason.row': (el) => ctx.go(el.dataset.href.slice(2)),
    'rp.camp.row': (el, ev) => { if (ev.target.closest('a')) return; ctx.go(`campaigns/${el.dataset.value}`); },
    'rp.empty.call': () => ctx.ui.dialer.open({ source: 'reports' }),
  });
  ctx.inputs(root, { 'rp.sub': (v) => { ctx.setState({ sub: v }); setHash(ctx); } });
  // Disabled "Monthly": clicking moves focus to the helper that explains why.
  ctx.on(root, 'click', '[data-disabled-help]', (ev, el) => {
    const help = root.querySelector(`#${el.dataset.disabledHelp}`);
    if (help) { help.focus(); help.classList.remove('rp-nudge'); void help.offsetWidth; help.classList.add('rp-nudge'); }
  });
  ctx.on(root, 'keydown', 'tr.rp-click', (ev, tr) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); tr.click(); } });
  ctx.watch('series', 'reports', 'today', 'mode', 'env', 'calls', 'campaigns');
}
