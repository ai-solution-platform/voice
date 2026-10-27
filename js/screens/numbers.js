// Numbers — #/numbers (list · detail drawer ?n=<id>) · #/numbers/buy (5 steps; ?return=connect · ?step=docs&view=1)
// Numbers are always masked (02-xxx-1000); E.164 views keep the mask (+662xxx1000). Prices come from
// js/data/prices.js only, and the cost is shown on the same screen as the button that spends. KYC files are read
// for their name and size only — nothing leaves the browser.

import { raw, on, reducedMotion } from '../core/dom.js';
import { newId, audit, notify, spend, setStep, balance, isPostpaid, numberFeesMonth, currentPeriod, describeProfile } from '../core/actions.js';
import { nowMs } from '../data/clock.js';
import { PRICES, numberFirstMonth, numberFeeInMonth } from '../data/prices.js';

export const id = 'numbers';
export const nav = { group: 'build', icon: 'hash', labelKey: 'nav.numbers' };
export const titleKey = 'nav.numbers';
export const skeleton = 'table';
export const css = true;

/** Hold length for reserved numbers, in minutes. One constant. */
const RESERVE_MIN = 30;
const STEP_KEYS = ['type', 'pick', 'docs', 'review', 'done'];
const GROUPS = { '02': ['02'], '03x': ['038', '035', '034'], '0xx': ['053', '043', '074'] };
const CITY = { '02': 'bkk', '038': 'chonburi', '035': 'ayutthaya', '034': 'nakhonpathom', '053': 'chiangmai', '043': 'khonkaen', '074': 'hatyai' };
const DOCS = ['cert', 'director', 'address'];
const MODES = ['contains', 'starts', 'ends'];
const ROUTES = ['flow', 'trunk', 'webhook', 'message'];
const MESSAGES = ['otp-only', 'closed'];
const OK_TYPES = /\.(pdf|jpe?g|png)$/i;
const MAX_BYTES = 10 * 1024 * 1024;
/** The first month of a number ordered now: days left in this month × fee ÷ days in the month, then the 1st (prices.js). */
const firstMonth = (monthly) => numberFirstMonth(monthly, nowMs());
const RELEASE_ON = firstMonth(0).to; // end of the paid month (fees run per calendar month)
const noop = () => {};
const URL_RE = /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/[\w./-]*)?$/i;

const freshBuy = () => ({
  run: 0, step: 1, group: '02', area: '02', qty: 1, sub: null, mode: 'contains', digits: '24', page: 1, loading: false, results: null,
  picked: [], reserving: false, reservedAt: 0, reserved: [], expired: false, onFile: true, docs: {}, address: '', signer: '', consent: false,
  ordering: false, ordered: [], live: '',
});
export const initialState = () => ({ type: 'all', status: 'all', sub: 'all', q: '', buy: freshBuy(), d: null });

export function crumb(params, { t }) {
  if (params.path[0] !== 'buy') return '';
  return params.query.view === '1' ? t('crumb.docs') : t('crumb.buy');
}

export const commands = [
  { id: 'loa', labelKey: 'cmd.loa', icon: 'file-text', keywords: ['loa caller id existing 02 number letter'], run: ({ go }) => go('numbers?loa=1') },
];

// ---------- helpers ----------
let CTX = null;          // the latest ctx (drawer handlers run after re-renders)
let DR = null;           // { id, handle } — the open detail drawer

const onBuy = () => /^#\/numbers\/buy/.test(location.hash);
const onList = () => /^#\/numbers(\?|$)/.test(location.hash);
const firstRun = (ctx) => ctx.store.get('mode') === 'firstRun';
const sandbox = (ctx) => ctx.store.get('env') === 'sandbox';
const digitsOf = (num) => String(num).replace(/x/gi, '').replace(/\D/g, '');
const e164 = (num) => '+66' + String(num).replace(/^0/, '').replace(/-/g, '');
const width = (area) => (area === '02' ? 4 : 3);

/** Timers that survive in-place re-renders (ctx.later is cleared on every render); dropped after Reset demo. */
function soon(ctx, fn, ms) {
  const st = ctx.state;
  setTimeout(() => { if (st === ctx.state) fn(st); }, reducedMotion() ? Math.min(ms, 250) : ms);
}
const redraw = (ctx, when) => { if (when()) ctx.rerender(); };

function unitPrice(ctx, qty) {
  const billable = ctx.list('numbers').filter((n) => n.monthly != null && n.status !== 'releasing').length;
  return billable + qty >= PRICES.numberBulkFrom ? PRICES.numberBulk : PRICES.number;
}

/** Deterministic pseudo-random candidates for an area + pattern (masked; the last block stays visible). */
function searchNumbers(ctx, b, page) {
  const w = width(b.area);
  const d = (b.digits || '').replace(/\D/g, '');
  if (d.length > w) return [];
  const owned = new Set(ctx.list('numbers').map((n) => n.number));
  if (b.area === '02' && b.mode === 'contains' && d === '24' && page === 1) return ctx.list('numberSearch').filter((n) => !owned.has(n)).slice(0, 8);
  const seen = new Set(page > 1 ? (b.results || []) : []);
  let seed = [...`${b.area}${b.mode}${d}`].reduce((s, c) => (s * 31 + c.charCodeAt(0)) >>> 0, 7) + page * 977;
  const out = [];
  const max = 10 ** w;
  for (let i = 0; i < 4000 && out.length < 8; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    const s = String(seed % max).padStart(w, '0');
    const ok = !d || (b.mode === 'contains' ? s.includes(d) : b.mode === 'starts' ? s.startsWith(d) : s.endsWith(d));
    if (!ok) continue;
    const num = `${b.area}-xxx-${s}`;
    if (owned.has(num) || seen.has(num) || out.includes(num)) continue;
    out.push(num);
  }
  return out.sort();
}

function routeLabel(ctx, n) {
  const { t } = ctx;
  if (n.type === 'loa') return t('route.loa');
  const r = n.routing;
  if (!r) return t('route.none');
  if (r.type === 'flow') { const f = ctx.list('flows').find((x) => x.id === r.ref); return t('route.flow', { name: f ? ctx.loc(f.name) : r.ref }); }
  if (r.type === 'trunk') {
    const fb = r.fallback && ctx.list('flows').find((x) => x.id === r.fallback);
    return fb ? t('route.trunkFb', { name: r.ref, fallback: ctx.loc(fb.name) }) : t('route.trunk', { name: r.ref });
  }
  if (r.type === 'webhook') { let host = r.ref; try { host = new URL(r.ref).host; } catch { /* keep */ } return t('route.webhook', { host }); }
  return t(`route.msg.${MESSAGES.includes(r.ref) ? r.ref : 'otp-only'}`);
}

function cidAllowDefault(n) {
  if (n.callerIdFor === 'agents') return ['trunk:hq-pbx'];
  if (n.callerIdFor === 'campaigns') return ['campaigns', 'api', 'c2c'];
  if (n.callerIdFor === 'otp') return ['api'];
  return [];
}
const cidAllow = (n) => n.cidAllow || cidAllowDefault(n);

function statusChip(ctx, n) {
  const { t, html: h, fmt } = ctx;
  if (n.status === 'active') return h`<span class="chip chip-ok" tabindex="0" data-tip-key="numbers.tip.active">${t('st.active')}</span>${n.since ? h` <span class="hint-xs nowrap">${t('st.since', { date: fmt.dayMonth(n.since) })}</span>` : ''}`;
  if (n.status === 'releasing') return h`<span class="chip" tabindex="0" data-tip-key="numbers.tip.releasing">${t('st.releasing')}</span> <span class="hint-xs nowrap">${t('st.releaseOn', { date: fmt.dayMonth(n.releaseOn || RELEASE_ON) })}</span>`;
  const when = n.letterSentAt ? t('st.letterSent', { date: fmt.dayMonth(n.letterSentAt) }) : n.orderedAt ? t('st.ordered', { date: fmt.dayMonth(n.orderedAt) }) : '';
  return h`<span class="chip chip-warn" tabindex="0" data-tip-key="numbers.tip.review">${t('st.review')}</span>${when ? h` <span class="hint-xs nowrap">${when}</span>` : ''}`;
}

function cidUse(ctx, n) {
  const { t } = ctx;
  if (n.cidOff) return t('cid.off');
  if (n.callerIdFor) return t(`cid.${n.callerIdFor}`);
  if (n.type === 'loa') return t('cid.loa');
  if ((n.cidAllow || []).length) return t('cid.custom', { count: n.cidAllow.length, n: n.cidAllow.length });
  return '—';
}

// ---------- list ----------
function filtered(ctx) {
  const s = ctx.state;
  const q = (s.q || '').replace(/\D/g, '');
  return ctx.list('numbers').filter((n) => (s.type === 'all' || n.type === s.type)
    && (s.status === 'all' || n.status === s.status)
    && (s.sub === 'all' || n.sub === s.sub)
    && (!q || digitsOf(n.number).includes(q) || digitsOf(n.number).endsWith(q)));
}

function header(ctx) {
  const { t, html: h, icon } = ctx;
  const has = ctx.list('numbers').length > 0;
  return h`<div class="page-head"><div class="titles"><h1>${t('title')}${ctx.pageHelp()}</h1><span class="sub">${t('sub')}</span></div>
    <div class="tools">${has ? h`<button type="button" class="btn" data-action="nb.loa">${icon('file-text')}${t('loa')}</button>
      <a class="btn btn-primary" href="#/numbers/buy" data-action="nb.buy">${icon('plus')}${t('buy')}</a>` : ''}</div></div>`;
}

function tiles(ctx) {
  const { t, html: h, fmt } = ctx;
  const all = ctx.list('numbers');
  const active = all.filter((n) => n.status === 'active');
  const review = all.filter((n) => n.status === 'in-review');
  const fees = numberFeesMonth(); // same figure as Billing › Usage, the statement and the invoice
  const tile = (key, value, line, action, val, pressed) => h`<button type="button" class="card tile nm-tile" data-action="${action}" data-value="${val}" aria-pressed="${pressed}"><span class="t">${t(`tile.${key}`)}</span><span class="v">${value}</span><span class="h">${line}</span></button>`;
  return h`<div class="grid g-4 nm-tiles">
    ${tile('total', fmt.int(all.length), t('tile.totalLine', { local: fmt.int(all.filter((n) => n.type === 'local').length), regional: fmt.int(all.filter((n) => n.type === 'regional').length), loa: fmt.int(all.filter((n) => n.type === 'loa').length) }), 'nb.tile.total', 'all', ctx.state.status === 'all' && ctx.state.type === 'all')}
    ${tile('active', fmt.int(active.length), t('tile.activeLine'), 'nb.tile.active', 'active', ctx.state.status === 'active')}
    ${tile('review', fmt.int(review.length), t('tile.reviewLine'), 'nb.tile.review', 'in-review', ctx.state.status === 'in-review')}
    <a class="card tile tile-link nm-tile" href="#/billing?section=usage" data-action="nb.tile.fees"><span class="t">${t('tile.fees')}</span><span class="v">${fmt.credits2(fees.credits)}</span><span class="h">${fees.first ? t('tile.feesSplit', { full: fmt.int(fees.full), price: fmt.int(fees.price), first: fmt.int(fees.first) }) : t('tile.feesLine', { n: fmt.int(fees.full), price: fmt.int(fees.price) })}</span></a>
  </div>`;
}

function filters(ctx) {
  const { t, html: h, icon } = ctx;
  const s = ctx.state;
  const subs = ctx.list('subAccounts');
  return h`<div class="nm-filters">
    <div class="seg" role="group" aria-label="${t('f.typeAria')}">${['all', 'local', 'regional', 'loa'].map((k) => h`<button type="button" data-action="nb.type" data-value="${k}" aria-pressed="${s.type === k}">${t(`f.type.${k}`)}</button>`)}</div>
    <select class="select nm-sel" data-field="status" data-action="nb.status" aria-label="${t('f.statusAria')}">${['all', 'active', 'in-review', 'releasing'].map((k) => h`<option value="${k}" ${raw(s.status === k ? 'selected' : '')}>${t(`f.status.${k}`)}</option>`)}</select>
    ${subs.length > 1 ? h`<select class="select nm-sel" data-field="sub" data-action="nb.sub" aria-label="${t('f.subAria')}"><option value="all">${t('f.subAll')}</option>${subs.map((x) => h`<option value="${x.id}" ${raw(s.sub === x.id ? 'selected' : '')}>${ctx.loc(x.name)}</option>`)}</select>` : ''}
    <label class="nm-search">${icon('search', 'ico-sm')}<input class="input" type="search" inputmode="numeric" data-field="q" data-action="nb.search" value="${s.q}" placeholder="${t('f.searchPh')}" aria-label="${t('f.searchAria')}" autocomplete="off"></label>
  </div>`;
}

function table(ctx, rows) {
  const { t, html: h, fmt } = ctx;
  if (!rows.length) {
    return h`<div class="card"><div class="empty empty-center" role="status"><strong>${t('noMatch')}</strong><span class="hint">${t('noMatchHint')}</span>
      <button type="button" class="btn btn-sm" data-action="nb.clear">${t('clear')}</button></div></div>`;
  }
  return h`<div class="card"><div class="tbl-wrap"><table class="tbl nm-tbl"><thead><tr>
      <th>${t('col.number')} · ${t('col.type')}</th><th>${t('col.routing')}</th><th>${ctx.term(t('col.cid'), 'caller_id')}</th><th>${t('col.status')}</th><th class="num">${t('col.monthly')}</th></tr></thead>
    <tbody>${rows.map((n) => h`<tr class="${ctx.state.fresh === n.id ? 'new-row' : ''}">
      <td><a class="mono strong" href="#/numbers?n=${n.id}" data-action="nb.row" translate="no">${n.number}</a>
        <div class="hint-xs"><span class="nowrap">${t(`type.${n.type}`)}</span> · ${n.type === 'loa' ? t('type.loaH') : t(`city.${CITY[n.area] || 'bkk'}`)}</div>
        <div class="hint-xs" title="${t('col.sub')}">${ctx.ui.describe.sub(n.sub)}</div></td>
      <td class="nm-route">${routeLabel(ctx, n)}</td>
      <td class="nm-cid">${cidUse(ctx, n)}</td>
      <td class="nowrap nm-stcell">${statusChip(ctx, n)}</td>
      <td class="num mono">${n.monthly != null ? fmt.int(n.monthly) : '—'}</td></tr>`)}</tbody></table></div>
    <div class="card-foot row nm-foot"><span class="hint-xs">${t('foot', { price: fmt.int(PRICES.number), bulk: fmt.int(PRICES.numberBulk), from: PRICES.numberBulkFrom })}</span>
      <span class="chip chip-warn" tabindex="0" data-tip-key="common.plannedPricesTip">${t('common.plannedPrices')}</span></div></div>`;
}

function emptyState(ctx) {
  const { t, html: h, icon } = ctx;
  return h`<div class="card nm-empty"><div class="empty">
    <span class="art">${icon('hash')}</span><h2>${t('empty.title')}</h2><p class="hint">${t('empty.body', { shared: '02-xxx-0100' })}</p>
    <div class="steps"><div><span class="stepnum">1</span>${t('empty.s1')}</div><div><span class="stepnum">2</span>${ctx.term(t('empty.s2'), 'kyc')}</div><div><span class="stepnum">3</span>${t('empty.s3')}</div></div>
    <div class="row"><a class="btn btn-primary" href="#/numbers/buy" data-action="nb.empty.get">${icon('plus')}${t('empty.get')}</a>
      <button type="button" class="btn" data-action="nb.empty.loa">${icon('file-text')}${t('loa')}</button></div>
    <p class="hint-xs">${t('empty.price', { price: ctx.fmt.int(PRICES.number) })} · ${t('common.plannedPrices')}</p></div></div>`;
}

function listPage(ctx) {
  const { t, html: h, icon } = ctx;
  const all = ctx.list('numbers');
  const sbx = sandbox(ctx) && all.length > 0;
  return h`<div class="page nm">${header(ctx)}
    ${sbx ? h`<div class="note note-warn">${icon('info')}<span>${t('sandboxNote', { shared: '02-xxx-0100' })}</span></div>` : ''}
    ${all.length ? h`${tiles(ctx)}${filters(ctx)}${table(ctx, filtered(ctx))}` : emptyState(ctx)}
    <p class="hint-xs nm-soon">${icon('sparkles', 'ico-xs')} ${t('soon')}</p></div>`;
}

// ---------- detail drawer ----------
function draftFrom(n) {
  const r = n.routing || {};
  return { id: n.id, type: r.type || 'flow', flow: r.type === 'flow' ? r.ref : 'flw_01JB5MAIN1', trunk: r.type === 'trunk' ? r.ref : 'hq-pbx', url: r.type === 'webhook' ? r.ref : 'https://crm.example.com/ants/webhook', msg: r.type === 'message' ? r.ref : 'otp-only', urlErr: null, dirty: false };
}

function targetLabel(ctx, d) {
  const { t } = ctx;
  if (d.type === 'flow') { const f = ctx.list('flows').find((x) => x.id === d.flow); return t('route.flow', { name: f ? ctx.loc(f.name) : d.flow }); }
  if (d.type === 'trunk') return t('route.trunk', { name: d.trunk });
  if (d.type === 'webhook') { let host = d.url; try { host = new URL(d.url).host; } catch { /* keep */ } return t('route.webhook', { host }); }
  return t(`route.msg.${d.msg}`);
}

/** Drawer › Cost: the monthly fee, what this month cost (full month or the prorated first month) and the next charge. */
function feeLines(ctx, n) {
  const { t, html: h, fmt } = ctx;
  const f = numberFeeInMonth(n, currentPeriod());
  const next = firstMonth(n.monthly).next;
  const how = f.kind === 'full' ? t('d.monthFull', { date: fmt.dayMonth(`${currentPeriod()}-01`) })
    : f.kind === 'first' ? t('d.monthFirst', { count: f.days, days: f.days, price: fmt.int(n.monthly), cycle: f.cycleDays, date: fmt.dayMonth(f.from) }) : '';
  const month = f.kind === 'none' ? t('d.monthNone') : h`<strong class="tnum">${fmt.credits2(f.credits)}</strong><span class="hint-xs nm-block">${how}</span>`;
  return h`<div class="kv"><span class="k">${t('d.fee')}</span><span class="v">${t('d.feeValue', { price: fmt.int(n.monthly) })}</span></div>
    <div class="kv"><span class="k">${t('d.thisMonth')}</span><span class="v nm-fee-v">${month}</span></div>
    <div class="kv"><span class="k">${t('d.next')}</span><span class="v">${n.status === 'releasing' ? t('d.nextNone') : f.kind === 'none' ? t('d.nextLive') : t('d.nextOn', { price: fmt.int(n.monthly), date: fmt.dateProse(next) })}</span></div>`;
}

function drawerBody(ctx, n) {
  const { t, html: h, icon, fmt } = ctx;
  const d = ctx.state.d;
  const loa = n.type === 'loa';
  const active = n.status === 'active';
  const flows = ctx.list('flows');
  const trunks = ctx.list('trunks');
  const allow = cidAllow(n);
  const cidOn = !n.cidOff && (!!n.callerIdFor || allow.length > 0);
  const sources = [{ k: 'campaigns' }, { k: 'api' }, { k: 'c2c' }, ...trunks.map((tr) => ({ k: `trunk:${tr.name}`, name: tr.name }))];
  const kyc = ctx.store.get('org.kycApproved');
  const docsLine = kyc ? t('d.docsOk', { date: fmt.dayMonth(kyc) }) : t('d.docsReview');
  const routing = loa
    ? h`<div class="note note-info">${icon('info')}<span>${t('d.loaNote')}</span></div>`
    : h`<div class="seg nm-routeseg" role="group" aria-label="${t('d.routeAria')}">${ROUTES.map((k) => h`<button type="button" data-action="nb.d.route" data-value="${k}" aria-pressed="${d.type === k}">${icon(k === 'flow' ? 'flow' : k === 'trunk' ? 'server' : k === 'webhook' ? 'link' : 'volume', 'ico-sm')}${t(`d.route.${k}`)}</button>`)}</div>
      ${d.type === 'flow' ? h`<div class="field"><label class="label" for="nm-dflow">${t('d.flow')}</label><select class="select" id="nm-dflow" data-dfield="flow">${flows.length ? flows.map((f) => h`<option value="${f.id}" ${raw(d.flow === f.id ? 'selected' : '')}>${ctx.loc(f.name)}${f.live ? ` · v${f.live}` : ` · ${t('d.draftOnly')}`}</option>`) : h`<option value="">${t('d.noFlows')}</option>`}</select>
        ${flows.length ? h`<a class="linkbtn nm-openflow" href="#/flows/${d.flow}" data-action="nb.d.openflow">${icon('flow', 'ico-xs')}${t('d.openFlow')}</a>` : ''}</div>` : ''}
      ${d.type === 'trunk' ? h`<label class="field"><span class="label">${ctx.term(t('d.trunk'), 'sip_trunk')}</span><select aria-label="${t('d.trunk')}" class="select" data-dfield="trunk">${trunks.length ? trunks.map((tr) => h`<option value="${tr.name}" ${raw(d.trunk === tr.name ? 'selected' : '')}>${tr.name}${tr.status === 'down' ? ` · ${t('d.trunkDown')}` : ''}</option>`) : h`<option value="">${t('d.noTrunks')}</option>`}</select>
        ${trunks.find((x) => x.name === d.trunk && x.status === 'down') ? h`<span class="hint-xs warn-text">${t('d.trunkDownHint', { name: d.trunk })}</span>` : ''}</label>` : ''}
      ${d.type === 'webhook' ? h`<label class="field"><span class="label">${ctx.term(t('d.webhook'), 'webhook')}</span><input aria-label="${t('d.webhook')}" class="input mono" data-dfield="url" value="${d.url}" inputmode="url" spellcheck="false" translate="no" aria-invalid="${d.urlErr ? 'true' : 'false'}" aria-describedby="nm-url-h">
        ${d.urlErr ? h`<span class="field-err" id="nm-url-h">${d.urlErr}</span>` : h`<span class="hint-xs" id="nm-url-h">${t('d.webhookHint')}</span>`}</label>` : ''}
      ${d.type === 'message' ? h`<label class="field"><span class="label">${t('d.message')}</span><select class="select" data-dfield="msg">${MESSAGES.map((m) => h`<option value="${m}" ${raw(d.msg === m ? 'selected' : '')}>${t(`route.msg.${m}`)}</option>`)}</select></label>` : ''}
      <div class="row nm-saverow"><button type="button" class="btn ${d.dirty ? 'btn-primary' : ''}" data-action="nb.d.save">${icon('check')}${t('d.save')}</button>
        <span class="hint-xs" aria-live="polite">${d.dirty ? t('d.unsaved') : t('d.now', { target: routeLabel(ctx, n) })}</span></div>
      ${!active ? h`<p class="hint-xs">${t('d.whenActiveHint')}</p>` : ''}`;

  return h`<div class="stack-4 nm-drawer">
    <div class="stack nm-dhead"><div class="row-tight">${statusChip(ctx, n)}</div><span class="hint">${t(`type.${n.type}`)} · ${n.type === 'loa' ? t('type.loaH') : t(`city.${CITY[n.area] || 'bkk'}`)} · ${ctx.ui.describe.sub(n.sub)}</span></div>
    <div class="nm-e164 row"><span class="hint-xs">${ctx.term('E.164', 'e164')}</span><code class="mono" translate="no">${n.e164 || e164(n.number)}</code>
      <button type="button" class="copybtn" data-action="nb.d.copy" aria-label="${t('d.copy')}" data-tip-key="numbers.d.copy">${icon('copy', 'ico-sm')}</button></div>

    <section class="nm-sec" aria-labelledby="nm-r-h"><h3 id="nm-r-h">${t('d.routeTitle')}</h3>${routing}</section>

    <section class="nm-sec" aria-labelledby="nm-c-h"><div class="row nm-sec-h"><h3 id="nm-c-h" class="grow">${ctx.term(t('d.cidTitle'), 'caller_id')}</h3>
      <button type="button" class="toggle" role="switch" data-action="nb.d.cid" aria-checked="${cidOn}" aria-labelledby="nm-c-h" ${raw(n.status === 'releasing' ? 'aria-disabled="true" aria-describedby="nm-c-help"' : '')}></button></div>
      <p class="hint-xs" id="nm-c-help">${n.status === 'releasing' ? t('d.cidReleasing') : cidOn ? t('d.cidOn') : t('d.cidOffHint')}</p>
      ${cidOn ? h`<fieldset class="nm-allow"><legend class="label">${t('d.allowTitle')}</legend>
        ${sources.map((s) => h`<label class="check"><input type="checkbox" data-action="nb.d.allow" data-value="${s.k}" ${raw(allow.includes(s.k) ? 'checked' : '')}>${s.name ? h`<span>${t('d.allow.trunk')} <span class="mono" translate="no">${s.name}</span></span>` : t(`d.allow.${s.k}`)}</label>`)}
        <span class="hint-xs">${t('d.allowHint')}</span></fieldset>` : ''}</section>

    <section class="nm-sec" aria-labelledby="nm-t-h"><h3 id="nm-t-h">${t('d.toolsTitle')}</h3>
      <div class="row"><button type="button" class="btn btn-navy" data-action="nb.d.test" ${raw(active ? '' : 'aria-disabled="true" aria-describedby="nm-test-h"')}>${icon('phone')}${t('d.test')}</button>
        <a class="btn" href="#/logs?number=${encodeURIComponent(n.number)}" data-action="nb.d.logs">${icon('list')}${t('d.logs')}</a></div>
      ${active ? h`<span class="hint-xs">${t('d.testHint')}</span>` : h`<span class="hint-xs" id="nm-test-h">${t('d.testOff')}</span>`}
      <a class="linkbtn hint-xs" href="#/numbers/buy?step=docs&view=1" data-action="nb.d.docs">${icon('file-text', 'ico-xs')}${docsLine}</a></section>

    <section class="nm-sec" aria-labelledby="nm-f-h"><h3 id="nm-f-h">${t('d.feeTitle')}</h3>
      ${n.monthly != null ? feeLines(ctx, n) : h`<p class="hint-xs">${t('d.feeLoa')}</p>`}
      <span class="chip chip-warn" tabindex="0" data-tip-key="common.plannedPricesTip">${t('common.plannedPrices')}</span></section>

    <section class="nm-sec nm-danger" aria-labelledby="nm-x-h"><h3 id="nm-x-h">${t('d.dangerTitle')}</h3>
      ${n.status === 'releasing'
        ? h`<p class="hint-xs">${t('d.releasingBody', { date: fmt.dateProse(n.releaseOn || RELEASE_ON) })}</p><div><button type="button" class="btn" data-action="nb.d.keep">${icon('refresh')}${t('d.keep')}</button></div>`
        : h`<p class="hint-xs" id="nm-rel-h">${active ? t('d.releaseHint', { date: fmt.dateProse(RELEASE_ON) }) : t('d.releaseOff')}</p>
          <div><button type="button" class="btn btn-danger-ghost" data-action="nb.d.release" ${raw(active ? '' : 'aria-disabled="true" aria-describedby="nm-rel-h"')}>${icon('trash')}${t('d.release')}</button></div>`}</section>
  </div>`;
}

function focusKey(el) {
  if (!el) return null;
  if (el.dataset.dfield) return `[data-dfield="${el.dataset.dfield}"]`;
  if (el.dataset.action) return `[data-action="${el.dataset.action}"]${el.dataset.value != null ? `[data-value="${el.dataset.value}"]` : ''}`;
  return null;
}

function refreshDrawer() {
  if (!DR || !CTX) return;
  const n = CTX.list('numbers').find((x) => x.id === DR.id);
  if (!n) { closeDrawer(); return; }
  const a = document.activeElement;
  const sel = a && DR.handle.el.contains(a) ? focusKey(a) : null;
  DR.handle.setBody(drawerBody(CTX, n));
  if (sel) { const el = DR.handle.el.querySelector(sel); if (el) el.focus({ preventScroll: true }); }
}

function closeDrawer() {
  if (!DR) return;
  const h = DR.handle;
  DR = null;
  h.close();
}

function syncDrawer(ctx) {
  const nid = ctx.params.query.n;
  if (!nid || ctx.params.path.length) { closeDrawer(); return; }
  const n = ctx.list('numbers').find((x) => x.id === nid);
  if (!n) {
    closeDrawer();
    ctx.ui.toast(ctx.t('d.notFound'), { kind: 'warn', reqId: true });
    ctx.go('numbers', { replace: true });
    return;
  }
  if (!ctx.state.d || ctx.state.d.id !== nid) ctx.state.d = draftFrom(n);
  if (DR && DR.id === nid) { refreshDrawer(); return; }
  closeDrawer();
  const handle = ctx.ui.drawer({
    title: n.number,
    body: drawerBody(ctx, n),
    actions: drawerActions(),
    onClose: () => {
      if (DR && DR.handle === handle) {
        DR = null;
        if (/^#\/numbers\?/.test(location.hash) && /[?&]n=/.test(location.hash)) CTX.go('numbers', { replace: true });
      }
    },
  });
  DR = { id: nid, handle };
  const fieldChange = (ev) => {
    const el = ev.target.closest && ev.target.closest('[data-dfield]');
    if (!el || !CTX) return;
    const d = CTX.state.d;
    const k = el.dataset.dfield;
    if (k === 'url') { d.url = el.value.trim(); d.urlErr = null; d.dirty = true; if (ev.type === 'change') refreshDrawer(); return; }
    if (ev.type !== 'change') return;
    d[k] = el.value;
    d.dirty = true;
    refreshDrawer();
  };
  on(handle.el, 'input', fieldChange);
  on(handle.el, 'change', fieldChange);
}

function drawerActions() {
  const cur = () => CTX;
  const num = () => cur().list('numbers').find((x) => x.id === (DR && DR.id));
  const patch = (fn) => { const ctx = cur(); const nid = DR && DR.id; ctx.store.update('numbers', (list) => list.map((x) => (x.id === nid ? fn(x) : x))); };
  return {
    'nb.d.copy': (el) => { const n = num(); if (n) cur().ui.copy(n.e164 || e164(n.number), el); },
    'nb.d.route': (el) => { const d = cur().state.d; if (d.type !== el.dataset.value) { d.type = el.dataset.value; d.dirty = true; d.urlErr = null; refreshDrawer(); } },
    'nb.d.save': () => {
      const ctx = cur();
      const { t } = ctx;
      const n = num();
      const d = ctx.state.d;
      if (!n) return;
      if (d.type === 'webhook' && !URL_RE.test(d.url)) { d.urlErr = t('d.webhookErr'); refreshDrawer(); const i = DR.handle.el.querySelector('[data-dfield="url"]'); if (i) i.focus(); return; }
      const ref = d.type === 'flow' ? d.flow : d.type === 'trunk' ? d.trunk : d.type === 'webhook' ? d.url : d.msg;
      if (!ref) return;
      const fallback = d.type === 'trunk' ? 'flw_01JB5CLSD2' : undefined;
      patch((x) => ({ ...x, routing: { type: d.type, ref, ...(fallback ? { fallback } : {}) } }));
      d.dirty = false;
      audit('number.routing.changed', { number: n.number, to: d.type, ref }, n.id);
      const target = targetLabel(ctx, d) + (n.status === 'active' ? '' : ` ${t('d.whenActive')}`);
      ctx.ui.toast(t('toast.T15', { num: n.number, target }), { kind: 'success' });
      refreshDrawer();
    },
    'nb.d.cid': () => {
      const ctx = cur();
      const n = num();
      if (!n) return;
      const on1 = !n.cidOff && (!!n.callerIdFor || cidAllow(n).length > 0);
      patch((x) => ({ ...x, cidOff: on1, cidAllow: on1 ? cidAllow(x) : (cidAllow(x).length ? cidAllow(x) : ['campaigns', 'api']) }));
      ctx.ui.toast(ctx.t(on1 ? 'd.cidOffToast' : 'd.cidOnToast', { num: n.number }), { kind: 'success' });
    },
    'nb.d.allow': (el) => {
      const k = el.dataset.value;
      patch((x) => { const list = cidAllow(x); return { ...x, cidAllow: list.includes(k) ? list.filter((y) => y !== k) : [...list, k] }; });
    },
    'nb.d.test': () => {
      const ctx = cur();
      const n = num();
      if (!n) return;
      // The number under test is the caller ID (live only: Sandbox calls always come from the shared test number).
      ctx.ui.dialer.open({ mode: 'number', source: 'numbers', ...(ctx.store.get('env') === 'live' ? { from: n.number } : {}) });
    },
    'nb.d.logs': () => closeDrawer(),
    'nb.d.docs': () => closeDrawer(),
    'nb.d.openflow': () => closeDrawer(),
    'nb.d.release': async () => {
      const ctx = cur();
      const { t, fmt } = ctx;
      const n = num();
      if (!n) return;
      const token = digitsOf(n.number);
      const ok = await ctx.ui.confirm({
        title: t('rel.title', { num: n.number }),
        body: t('rel.body', { date: fmt.dateProse(RELEASE_ON) }),
        consequences: [t('rel.c1', { num: n.number, target: routeLabel(ctx, n) }), t('rel.c2'), t('rel.c3')],
        confirmLabel: t('rel.yes'), cancelLabel: t('rel.no'), danger: true, typed: token,
      });
      if (!ok) return;
      const prev = { status: n.status };
      patch((x) => ({ ...x, status: 'releasing', releaseOn: RELEASE_ON }));
      audit('number.released', { number: n.number, on: RELEASE_ON }, n.id);
      ctx.ui.toast(t('toast.T14', { num: n.number, date: fmt.dateProse(RELEASE_ON) }), {
        kind: 'info', timeout: 10000,
        action: { label: t('common.undo'), onClick: () => cur().store.update('numbers', (l) => l.map((x) => (x.id === n.id ? { ...x, status: prev.status, releaseOn: undefined } : x))) },
      });
    },
    'nb.d.keep': () => {
      const ctx = cur();
      const n = num();
      if (!n) return;
      patch((x) => ({ ...x, status: 'active', releaseOn: undefined }));
      ctx.ui.toast(ctx.t('d.kept', { num: n.number }), { kind: 'success' });
    },
  };
}

// ---------- LOA modal ----------
function loaModal(ctx) {
  const { t, html: h, icon } = ctx;
  const subs = ctx.list('subAccounts');
  let file = null;
  const body = () => h`<div class="stack-3">
    <p class="hint">${t('loaM.intro')}</p>
    <label class="field"><span class="label">${t('loaM.number')}</span><input class="input mono" data-m="num" placeholder="02-xxx-7788" inputmode="tel" translate="no" autocomplete="off" aria-describedby="nm-loa-num-h"><span class="hint-xs" id="nm-loa-num-h">${t('loaM.numberHint')}</span></label>
    <label class="field"><span class="label">${t('loaM.provider')}</span><input class="input" data-m="prov" placeholder="${t('loaM.providerPh')}" autocomplete="off"></label>
    ${subs.length > 1 ? h`<label class="field"><span class="label">${t('f.subAria')}</span><select class="select" data-m="sub">${subs.map((x) => h`<option value="${x.id}">${ctx.loc(x.name)}</option>`)}</select></label>` : ''}
    <div class="field"><span class="label">${ctx.term(t('loaM.letter'), 'loa')}</span>
      <div class="row nm-loafile"><button type="button" class="btn btn-sm" data-action="nb.loa.sample">${icon('file')}${t('docs.sample')}</button>
        <label class="btn btn-sm nm-filebtn">${icon('upload')}${t('docs.choose')}<input type="file" class="sr-only" data-m="file" accept=".pdf,.jpg,.jpeg,.png"></label>
        <span class="hint-xs" data-m="fileinfo" aria-live="polite">${t('loaM.noFile')}</span></div>
      <span class="hint-xs warn-text">${t('docs.warn')}</span></div>
    <label class="field"><span class="label">${t('loaM.signer')}</span><input class="input" data-m="signer" autocomplete="off" placeholder="${t('loaM.signerPh')}"></label>
    <label class="check"><input type="checkbox" data-m="auth">${t('loaM.authorised')}</label>
    <span class="field-err" data-m="err" hidden></span></div>`;
  const m = ctx.ui.modal({
    title: t('loaM.title'), size: 'md', body: body(),
    actions: {
      'nb.loa.sample': () => { file = { name: 'letter-of-authorisation-sample.pdf', size: 184320 }; m.el.querySelector('[data-m="fileinfo"]').textContent = t('loaM.fileInfo', { name: file.name, size: ctx.fmt.num(file.size / 1024, 0) }); },
    },
    buttons: [
      { label: t('common.cancel') },
      { label: t('loaM.submit'), kind: 'navy', icon: 'send', onClick: (hd) => {
        const q = (k) => hd.el.querySelector(`[data-m="${k}"]`);
        const err = q('err');
        const raw1 = q('num').value.trim();
        const dg = raw1.replace(/\D/g, '');
        let msg = '';
        if (!/^0?2/.test(dg) || dg.replace(/^0/, '').length < 3) msg = t('loaM.errNumber');
        else if (!file) msg = t('loaM.errFile');
        else if (!q('signer').value.trim()) msg = t('loaM.errSigner');
        else if (!q('auth').checked) msg = t('loaM.errAuth');
        if (msg) { err.textContent = msg; err.hidden = false; return false; }
        const last4 = dg.slice(-4).padStart(4, '0');
        const number = `02-xxx-${last4}`;
        const rec = { id: newId('num'), number, e164: `+662xxx${last4}`, type: 'loa', area: '02', sub: (q('sub') && q('sub').value) || (subs[0] && subs[0].id) || null, routing: null, status: 'in-review', letterSentAt: new Date(nowMs()).toISOString(), monthly: null };
        ctx.store.push('numbers', rec);
        audit('number.loa.sent', { number }, rec.id);
        ctx.ui.toast(t('loaM.toast'), { kind: 'success', sub: number });
        return true;
      } },
    ],
  });
  on(m.el, 'change', '[data-m="file"]', (ev, inp) => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    file = { name: f.name, size: f.size };
    m.el.querySelector('[data-m="fileinfo"]').textContent = t('loaM.fileInfo', { name: f.name, size: ctx.fmt.num(Math.max(1, Math.round(f.size / 1024)), 0) });
    inp.value = '';
  });
  return m;
}

// ---------- buy flow ----------
function steps(ctx) {
  const { t, html: h, icon } = ctx;
  const b = ctx.state.buy;
  return h`<ol class="nm-steps" aria-label="${t('by.stepsAria')}">${STEP_KEYS.map((k, i) => {
    const n = i + 1;
    const st = n < b.step ? 'done' : n === b.step ? 'current' : 'todo';
    return h`<li class="nm-step is-${st}" ${raw(st === 'current' ? 'aria-current="step"' : '')}><span class="nm-circ">${st === 'done' ? icon('check', 'ico-xs') : n}</span><span class="nm-slbl">${t(`by.s.${k}`)}</span></li>`;
  })}</ol>
  <p class="nm-stepnow">${t('by.stepNow', { n: b.step, total: STEP_KEYS.length, name: t(`by.s.${STEP_KEYS[b.step - 1]}`) })}</p>`;
}

function reservationLeft(b) {
  if (!b.reservedAt) return 0;
  return Math.max(0, RESERVE_MIN * 60 - Math.floor((nowMs() - b.reservedAt) / 1000));
}
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function resvChip(ctx) {
  const { t, html: h, icon } = ctx;
  const b = ctx.state.buy;
  if (!b.reservedAt) return '';
  if (b.expired) return h`<span class="chip chip-err">${icon('clock')}${t('by.2.expired')}</span>`;
  return h`<span class="chip chip-ok nm-resv" tabindex="0" data-tip-key="numbers.by.2.resvTip" data-tip-vars='{"min":${RESERVE_MIN}}'>${icon('lock')}${t('by.2.reservedFor')} <span class="mono" data-nm-countdown>${mmss(reservationLeft(b))}</span></span>`;
}

function buyStep1(ctx) {
  const { t, html: h, icon, fmt } = ctx;
  const b = ctx.state.buy;
  const subs = ctx.list('subAccounts');
  const price = unitPrice(ctx, b.qty);
  return h`<div class="nm-grid">
    <div class="stack-4">
      <div class="field"><span class="label">${t('by.1.area')}</span>
        <div class="grid g-3 nm-areas" role="radiogroup" aria-label="${t('by.1.area')}">${Object.keys(GROUPS).map((g) => h`<button type="button" class="optcard" role="radio" data-action="by.1.type" data-value="${g}" aria-checked="${b.group === g}">
          <span class="t"><span class="mono" translate="no">${g}</span> · ${t(`by.1.g.${g}`)}</span><span class="h">${t(`by.1.gh.${g}`)}</span><span class="h strong">${t('by.1.perMonth', { price: fmt.int(PRICES.number) })}</span></button>`)}</div></div>
      ${GROUPS[b.group].length > 1 ? h`<div class="field"><span class="label">${t('by.1.code')}</span>
        <div class="seg" role="group" aria-label="${t('by.1.code')}">${GROUPS[b.group].map((a) => h`<button type="button" data-action="by.1.area" data-value="${a}" aria-pressed="${b.area === a}"><span class="mono" translate="no">${a}</span> ${t(`city.${CITY[a]}`)}</button>`)}</div></div>` : ''}
      <div class="row nm-qtyrow">
        <div class="field"><span class="label">${t('by.1.qty')}</span>
          <div class="stepper"><button type="button" data-action="by.1.qty" data-value="-1" aria-label="${t('by.1.less')}" ${raw(b.qty <= 1 ? 'aria-disabled="true"' : '')}>${icon('minus', 'ico-sm')}</button>
            <output aria-live="polite" aria-label="${t('by.1.qty')}">${b.qty}</output>
            <button type="button" data-action="by.1.qty" data-value="1" aria-label="${t('by.1.more')}" ${raw(b.qty >= 20 ? 'aria-disabled="true"' : '')}>${icon('plus', 'ico-sm')}</button></div></div>
        ${subs.length > 1 ? h`<label class="field grow"><span class="label">${ctx.term(t('by.1.sub'), 'subaccount')}</span><select class="select" data-field="buySub" data-action="by.1.sub" aria-label="${t('by.1.sub')}">${subs.map((x) => h`<option value="${x.id}" ${raw((b.sub || subs[0].id) === x.id ? 'selected' : '')}>${ctx.loc(x.name)}</option>`)}</select></label>` : ''}
      </div>
    </div>
    <aside class="card card-sunken card-pad nm-cost" aria-live="polite">
      <div class="row nm-cost-h"><strong>${t('by.cost.title')}</strong><span class="chip chip-warn" tabindex="0" data-tip-key="common.plannedPricesTip">${t('common.plannedPrices')}</span></div>
      <div class="kv"><span class="k">${t('by.cost.each')}</span><span class="v">${fmt.int(price)}</span></div>
      <div class="kv"><span class="k">${t('by.cost.qty')}</span><span class="v">× ${b.qty}</span></div>
      <div class="kv kv-total"><span class="k">${t('by.cost.month')}</span><span class="v">${fmt.int(price * b.qty)}</span></div>
      <p class="hint-xs">${price === PRICES.numberBulk ? t('by.cost.bulkOn', { n: PRICES.numberBulkFrom, price: fmt.int(PRICES.numberBulk) }) : t('by.cost.bulk', { n: PRICES.numberBulkFrom, price: fmt.int(PRICES.numberBulk) })}</p>
      <p class="hint-xs">${t('by.cost.inbound', { rate: fmt.rate(PRICES.inbound) })}</p>
    </aside></div>`;
}

function buyStep2(ctx) {
  const { t, html: h, icon } = ctx;
  const b = ctx.state.buy;
  const locked = !!b.reservedAt && !b.expired;
  const need = b.qty - b.picked.length;
  const chips = b.loading && !(b.results && b.results.length && b.page > 1)
    ? h`<div class="nm-results" aria-busy="true">${Array.from({ length: 8 }, () => raw('<span class="skel nm-skel"></span>'))}</div>`
    : b.results && b.results.length
      ? h`<div class="nm-results" role="group" aria-label="${t('by.2.resultsAria')}">${b.results.map((num) => {
          const sel = b.picked.includes(num);
          const res = locked && b.reserved.includes(num);
          return h`<button type="button" class="nm-num ${res ? 'is-res' : ''}" data-action="by.2.pick" data-value="${num}" aria-pressed="${sel}" translate="no" ${raw(locked && !res ? 'aria-disabled="true"' : '')}>${res ? icon('lock', 'ico-xs') : sel ? icon('check', 'ico-xs') : ''}<span class="mono">${num}</span></button>`;
        })}${b.loading ? Array.from({ length: 4 }, () => raw('<span class="skel nm-skel"></span>')) : ''}</div>`
      : h`<div class="empty empty-center nm-noresult" role="status"><strong>${t('by.2.none', { digits: b.digits || '—' })}</strong><span class="hint">${t('by.2.noneHint')}</span>
          <button type="button" class="btn btn-sm" data-action="by.2.clear">${t('by.2.clear')}</button></div>`;
  return h`<div class="stack-4">
    <div class="nm-searchrow">
      <div class="seg" role="group" aria-label="${t('by.2.modeAria')}">${MODES.map((m) => h`<button type="button" data-action="by.2.mode" data-value="${m}" aria-pressed="${b.mode === m}" ${raw(locked ? 'aria-disabled="true"' : '')}>${t(`by.2.mode.${m}`)}</button>`)}</div>
      <label class="nm-search grow">${icon('search', 'ico-sm')}<span class="mono nm-prefix" translate="no">${b.area}-xxx-</span><input class="input mono" data-field="digits" data-action="by.2.search" value="${b.digits}" inputmode="numeric" maxlength="${width(b.area)}" placeholder="${'0'.repeat(width(b.area))}" aria-label="${t('by.2.searchAria')}" autocomplete="off" ${raw(locked ? 'disabled' : '')}></label>
    </div>
    <p class="hint-xs" aria-live="polite">${b.loading ? t('by.2.loading') : b.results && b.results.length ? t('by.2.count', { n: b.results.length, area: b.area, city: t(`city.${CITY[b.area]}`) }) : ''}</p>
    ${chips}
    ${b.results && b.results.length && !locked ? h`<div><button type="button" class="btn btn-sm btn-ghost" data-action="by.2.more" ${raw(b.loading ? 'aria-busy="true"' : '')}>${b.loading ? raw('<span class="spin" aria-hidden="true"></span>') : icon('plus', 'ico-sm')}${t('by.2.more')}</button></div>` : ''}
    <div class="card card-pad nm-resvbox">
      ${b.expired ? h`<div class="note note-err" role="alert">${icon('clock')}<div class="grow"><strong>${t('by.2.expired')}</strong> · ${t('by.2.expiredBody')}</div><button type="button" class="btn btn-sm" data-action="by.2.again">${icon('refresh', 'ico-sm')}${t('by.2.again')}</button></div>`
        : locked ? h`<div class="row nm-resvline">${resvChip(ctx)}<span class="hint-xs grow">${t('by.2.reservedBody', { list: b.reserved.join(', '), min: RESERVE_MIN })}</span>
            <button type="button" class="btn btn-sm btn-ghost" data-action="by.2.unreserve">${t('by.2.unreserve')}</button>
            <button type="button" class="linkbtn hint-xs" data-action="by.2.expire">${t('by.2.expireDemo')} <span class="chip chip-navy">${t('common.demoTag')}</span></button></div>`
          : h`<div class="row nm-resvline"><span class="hint grow">${b.picked.length ? t('by.2.picked', { list: b.picked.join(', ') }) : t('by.2.pickHint', { n: b.qty })}</span>
            <button type="button" class="btn btn-navy" data-action="by.2.reserve" ${raw(need === 0 && !b.reserving ? '' : b.reserving ? 'aria-busy="true"' : 'aria-disabled="true" aria-describedby="nm-resv-h"')}>${b.reserving ? raw('<span class="spin" aria-hidden="true"></span>') : icon('lock', 'ico-sm')}${t('by.2.reserve')}</button></div>
            ${need > 0 ? h`<span class="hint-xs" id="nm-resv-h">${t('by.2.needMore', { count: need, n: need })}</span>` : h`<span class="hint-xs" id="nm-resv-h">${t('by.2.resvHint', { min: RESERVE_MIN })}</span>`}`}
      <span class="sr-only" aria-live="polite">${b.live}</span>
    </div></div>`;
}

function docRow(ctx, key, i) {
  const { t, html: h, icon, fmt } = ctx;
  const doc = ctx.state.buy.docs[key];
  const st = doc ? doc.state : 'empty';
  const checks = doc && doc.checks ? doc.checks : [];
  return h`<li class="nm-doc is-${st}">
    <div class="nm-doc-h"><span class="nm-doc-ico">${st === 'ok' ? icon('check', 'ico-sm') : st === 'bad' ? icon('x', 'ico-sm') : icon('file-text', 'ico-sm')}</span>
      <div class="grow"><strong>${t(`docs.${key}`)}</strong><div class="hint-xs">${t(`docs.${key}H`)}</div></div>
      ${st === 'empty' || st === 'bad' ? h`<div class="row nm-doc-a"><button type="button" class="btn btn-sm" data-action="by.3.upload" data-value="${key}">${icon('file', 'ico-sm')}${t('docs.sample')}</button>
        <label class="btn btn-sm btn-ghost nm-filebtn">${icon('upload', 'ico-sm')}${t('docs.choose')}<input type="file" class="sr-only" data-field="file" data-doc="${key}" accept=".pdf,.jpg,.jpeg,.png" aria-label="${t('docs.chooseFor', { doc: t(`docs.${key}`) })}"></label></div>`
        : st === 'ok' ? h`<button type="button" class="btn btn-sm btn-ghost" data-action="by.3.remove" data-value="${key}">${t('docs.remove')}</button>` : ''}</div>
    ${doc ? h`<div class="nm-doc-b"><span class="mono hint-xs nm-fname" translate="no">${doc.name} · ${fmt.num(Math.max(1, Math.round(doc.size / 1024)), 0)} KB</span>
      ${st === 'upload' ? h`<span class="progress nm-prog" role="progressbar" aria-label="${t('docs.reading')}"><i class="nm-prog-i"></i></span><span class="hint-xs">${t('docs.reading')}</span>` : ''}
      ${checks.length ? h`<ul class="nm-checks">${checks.map((c) => h`<li class="is-${c.ok == null ? 'run' : c.ok ? 'ok' : 'bad'}">${c.ok == null ? raw('<span class="spin" aria-hidden="true"></span>') : icon(c.ok ? 'check' : 'x', 'ico-xs')}<span>${t(`docs.chk.${c.k}`)}</span></li>`)}</ul>` : ''}
      ${st === 'ok' ? h`<span class="hint-xs ok-text">${t('docs.attached')}</span>` : ''}
      ${st === 'bad' ? h`<span class="hint-xs err-text">${t(`docs.bad.${doc.bad}`)}</span>` : ''}</div>` : ''}
  </li>`;
}

function buyStep3(ctx) {
  const { t, html: h, icon, fmt } = ctx;
  const b = ctx.state.buy;
  const kyc = ctx.store.get('org.kycApproved');
  const usingFile = kyc && b.onFile;
  const missing = missingDocs(ctx);
  return h`<div class="nm-grid">
    <div class="stack-4">
      ${kyc ? h`<label class="optcard nm-onfile"><span class="row-tight"><input type="checkbox" data-field="onFile" data-action="by.3.onfile" ${raw(b.onFile ? 'checked' : '')}><span class="t">${t('docs.onFile', { date: fmt.dateProse(kyc) })}</span></span><span class="h">${t('docs.onFileH')}</span></label>` : ''}
      ${usingFile ? h`<ul class="nm-doclist">${DOCS.map((k) => h`<li class="nm-doc is-ok"><div class="nm-doc-h"><span class="nm-doc-ico">${icon('check', 'ico-sm')}</span><div class="grow"><strong>${t(`docs.${k}`)}</strong><div class="hint-xs">${t('docs.approved', { date: fmt.dayMonth(kyc) })}</div></div></div></li>`)}</ul>`
        : h`<div class="note note-warn">${icon('shield')}<span>${t('docs.warn')}</span></div>
          <ol class="nm-doclist">${DOCS.map((k, i) => docRow(ctx, k, i))}</ol>
          <label class="field"><span class="label">${t('docs.addr')}</span><textarea class="textarea" rows="2" data-field="address" data-action="by.3.addr" placeholder="${t('docs.addrPh')}">${b.address}</textarea></label>
          <label class="field"><span class="label">${t('docs.signer')}</span><input class="input" data-field="signer" data-action="by.3.signer" value="${b.signer}" placeholder="${t('docs.signerPh')}" autocomplete="off"></label>
          <label class="check nm-consent"><input type="checkbox" data-field="consent" data-action="by.3.consent" ${raw(b.consent ? 'checked' : '')}>${t('docs.consent')}</label>`}
    </div>
    <aside class="card card-sunken card-pad stack nm-kycside">
      <strong>${ctx.term(t('docs.whyTitle'), 'kyc')}</strong><p class="hint-xs">${t('docs.why')}</p>
      <p class="hint-xs">${t('docs.timing')}</p>
      <a class="linkbtn hint-xs" href="#/help/article/thai-number-kyc" data-action="by.3.help">${icon('book', 'ico-xs')}${t('docs.help')}</a>
      <p class="hint-xs ${missing.length ? 'warn-text' : 'ok-text'}" id="nm-next-h" data-nm-missing>${missing.length ? t('docs.missing', { list: missing.join(' · ') }) : t('docs.complete')}</p>
    </aside></div>`;
}

function missingDocs(ctx) {
  const { t } = ctx;
  const b = ctx.state.buy;
  if (ctx.store.get('org.kycApproved') && b.onFile) return [];
  const out = DOCS.filter((k) => !(b.docs[k] && b.docs[k].state === 'ok')).map((k) => t(`docs.${k}Short`));
  if (!b.address.trim()) out.push(t('docs.addrShort'));
  if (!b.signer.trim()) out.push(t('docs.signerShort'));
  if (!b.consent) out.push(t('docs.consentShort'));
  return out;
}

/** Step 3 text fields update the "still needed" helpers and Next in place — no re-render while typing (IME-safe, focus kept). */
function syncMissing(root, ctx) {
  const missing = missingDocs(ctx);
  const msg = missing.length ? ctx.t('docs.missing', { list: missing.join(' · ') }) : ctx.t('docs.complete');
  const side = root.querySelector('[data-nm-missing]');
  if (side) { side.textContent = msg; side.classList.toggle('warn-text', !!missing.length); side.classList.toggle('ok-text', !missing.length); }
  const help = root.querySelector('[data-nm-nexthelp]');
  if (help) { help.textContent = missing.length ? msg : ''; help.hidden = !missing.length; }
  const next = root.querySelector('[data-action="by.next"]');
  if (next) { if (missing.length) next.setAttribute('aria-disabled', 'true'); else next.removeAttribute('aria-disabled'); }
}

/**
 * What an order costs. The first month is prorated: on the order day each number is charged for the days left in
 * this month (fee × days ÷ days in the month); from the 1st the full fee. Prepaid: from the balance today. Postpaid:
 * added to the invoice issued on the 1st, within the credit limit.
 */
function orderMath(ctx) {
  const b = ctx.state.buy;
  const price = unitPrice(ctx, b.qty);
  const monthly = price * b.qty;
  const live = ctx.store.get('env') === 'live';
  const first = firstMonth(price);
  const firstTotal = Math.round(first.each * b.qty * 100) / 100;
  const today = live ? firstTotal : 0;
  const postpaid = isPostpaid();
  const open = postpaid ? describeProfile().openInvoice : null;
  return { price, monthly, first, firstTotal, today, live, postpaid, invoiceOn: (open && open.issuedAt) || first.next,
    left: balance(), after: Math.round((balance() - today) * 100) / 100, short: live && balance() < today };
}

function buyStep4(ctx) {
  const { t, html: h, icon, fmt } = ctx;
  const b = ctx.state.buy;
  const m = orderMath(ctx);
  const kyc = ctx.store.get('org.kycApproved');
  const subId = b.sub || (ctx.list('subAccounts')[0] || {}).id;
  return h`<div class="nm-grid">
    <div class="stack-4">
      <section class="card nm-rev"><div class="card-head"><h3>${t('rev.numbers')}</h3><button type="button" class="linkbtn" data-action="by.4.edit" data-value="2">${t('rev.edit')}</button></div>
        <div class="card-body stack"><div class="row">${b.reserved.map((n) => h`<span class="chip chip-navy mono" translate="no">${n}</span>`)}${resvChip(ctx)}</div>
          <div class="kv"><span class="k">${t('rev.area')}</span><span class="v">${b.area} · ${t(`city.${CITY[b.area]}`)}</span></div>
          ${subId ? h`<div class="kv"><span class="k">${t('by.1.sub')}</span><span class="v">${ctx.ui.describe.sub(subId)}</span></div>` : ''}</div></section>
      <section class="card nm-rev"><div class="card-head"><h3>${ctx.term(t('rev.docs'), 'kyc')}</h3><button type="button" class="linkbtn" data-action="by.4.edit" data-value="3">${t('rev.edit')}</button></div>
        <div class="card-body"><p class="hint">${kyc && b.onFile ? t('rev.docsOnFile', { date: fmt.dateProse(kyc) }) : t('rev.docsNew', { signer: b.signer || '—' })}</p></div></section>
      ${b.expired ? h`<div class="note note-err" role="alert">${icon('clock')}<div class="grow">${t('rev.expired')}</div><button type="button" class="btn btn-sm" data-action="by.2.again">${t('by.2.again')}</button></div>` : ''}
    </div>
    <aside class="card card-pad stack nm-pay" aria-labelledby="nm-pay-h">
      <div class="row nm-cost-h"><strong id="nm-pay-h">${t('rev.costTitle')}</strong><span class="chip chip-warn" tabindex="0" data-tip-key="common.plannedPricesTip">${t('common.plannedPrices')}</span></div>
      <div class="kv"><span class="k">${t('rev.monthly', { n: b.qty, price: fmt.int(m.price) })}</span><span class="v">${fmt.int(m.monthly)}</span></div>
      ${m.live ? h`<div class="kv"><span class="k">${t('rev.firstMonth', { from: fmt.dayMonth(m.first.from), to: fmt.dayMonth(m.first.to) })}</span><span class="v">${fmt.credits2(m.firstTotal)}</span></div>
        <p class="hint-xs mono nm-prorate" data-nm-prorate>${b.qty > 1 ? t('rev.prorateN', { count: m.first.days, days: m.first.days, price: fmt.int(m.price), cycle: m.first.cycleDays, each: fmt.credits2(m.first.each), n: b.qty, total: fmt.credits2(m.firstTotal) }) : t('rev.prorate', { count: m.first.days, days: m.first.days, price: fmt.int(m.price), cycle: m.first.cycleDays, each: fmt.credits2(m.first.each) })}</p>
        <div class="kv"><span class="k">${m.postpaid ? t('rev.addedInvoice', { month: periodName(ctx, m.invoiceOn) }) : t('rev.today')}</span><span class="v" data-nm-today>${fmt.credits2(m.today)}</span></div>
        <p class="hint-xs">${m.postpaid ? t('rev.thenPostpaid', { price: fmt.int(m.monthly), issued: fmt.dateProse(m.invoiceOn), date: fmt.dayMonth(m.first.next) }) : t('rev.thenOn', { price: fmt.int(m.monthly), date: fmt.dayMonth(m.first.next) })}</p>
        ${m.postpaid ? h`<div class="kv kv-total"><span class="k">${t('rev.limitAfter')}</span><span class="v" data-nm-after>${fmt.credits2(m.after)}</span></div>
          <p class="hint-xs">${t('rev.limitNow', { left: fmt.credits2(m.left), limit: fmt.int(describeProfile().creditLimit || 0) })}</p>`
          : h`<div class="kv kv-total"><span class="k">${t('rev.after')}</span><span class="v" data-nm-after>${fmt.credits2(m.after)}</span></div>`}`
        : h`<div class="kv"><span class="k">${t('rev.today')}</span><span class="v">${fmt.int(0)}</span></div>
        <p class="hint-xs">${t('rev.sandbox', { price: fmt.int(m.monthly) })}</p>`}
      ${m.short ? h`<div class="note note-warn">${icon('alert')}<div class="grow">${m.postpaid ? t('rev.shortLimit') : t('rev.short')} ${m.postpaid ? h`<a class="linkbtn" href="#/billing?section=mode" data-action="by.4.limit">${t('rev.limitLink')}</a>` : h`<button type="button" class="linkbtn" data-action="by.4.topup">${t('top.topup')}</button>`}</div></div>` : ''}
      <button type="button" class="btn btn-primary btn-lg btn-block nm-order" data-action="by.4.order" ${raw(b.ordering ? 'aria-busy="true"' : b.expired || m.short ? 'aria-disabled="true" aria-describedby="nm-order-h"' : '')}>${b.ordering ? raw('<span class="spin" aria-hidden="true"></span>') : icon('check')}${t('rev.order', { price: fmt.int(m.monthly) })}</button>
      <span class="hint-xs" id="nm-order-h">${b.expired ? t('rev.expired') : m.short ? (m.postpaid ? t('rev.shortLimit') : t('rev.short')) : !m.live ? t('rev.orderHintSandbox') : m.postpaid ? t('rev.orderHintPostpaid', { month: periodName(ctx, m.invoiceOn) }) : t('rev.orderHint')}</span>
    </aside></div>`;
}

/** "November" — the month an invoice is issued in (the postpaid invoice of the 1st). */
function monthName(ctx, ymd) {
  const loc = ctx.lang === 'th' ? 'th-TH' : ctx.lang === 'zh' ? 'zh-CN' : 'en-GB';
  return new Intl.DateTimeFormat(loc, { month: 'long', timeZone: 'Asia/Bangkok' }).format(new Date(`${String(ymd).slice(0, 10)}T12:00:00+07:00`));
}

/** Billing-period month of an invoice issued on `ymd` (issued 1 Nov → October), matching Billing's invoice labels. */
function periodName(ctx, ymd) {
  const d = new Date(`${String(ymd).slice(0, 10)}T12:00:00+07:00`);
  d.setUTCDate(d.getUTCDate() - 1);
  return monthName(ctx, d.toISOString().slice(0, 10));
}

function buyStep5(ctx) {
  const { t, html: h, icon, fmt } = ctx;
  const b = ctx.state.buy;
  const nums = ctx.list('numbers').filter((n) => b.ordered.includes(n.id));
  const ret = ctx.params.query.return === 'connect';
  return h`<div class="nm-done" role="status">
    <span class="nm-done-ico"><svg class="ico ico-xl check-draw" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></span>
    <h2>${t('done.title', { count: nums.length, n: nums.length })}</h2>
    <div class="row nm-done-nums">${nums.map((n) => h`<span class="chip chip-navy mono" translate="no">${n.number}</span>`)}<span class="chip chip-warn">${t('st.review')}</span></div>
    <p class="hint">${t('done.body')}</p>
    <ol class="nm-next"><li>${t('done.n1')}</li><li>${t('done.n2')}</li><li>${t('done.n3', { date: fmt.dateProse(firstMonth(PRICES.number).next) })}</li></ol>
    <div class="row nm-done-a">
      <a class="btn btn-primary" href="#/numbers?n=${nums[0] ? nums[0].id : ''}" data-action="by.5.route">${icon('route')}${t('done.route')}</a>
      ${ret ? h`<a class="btn btn-navy" href="#/connect/sip" data-action="by.5.connect">${icon('server')}${t('done.connect')}</a>` : ''}
      <a class="btn" href="#/numbers" data-action="by.5.back">${t('done.back')}</a>
      <button type="button" class="btn btn-ghost" data-action="by.5.another">${icon('plus')}${t('done.another')}</button></div></div>`;
}

function docsView(ctx) {
  const { t, html: h, icon, fmt } = ctx;
  const kyc = ctx.store.get('org.kycApproved');
  return h`<div class="page nm">
    <div class="page-head"><div class="titles"><h1>${t('dv.title')}${ctx.pageHelp()}</h1><span class="sub">${t('dv.sub')}</span></div>
      <div class="tools"><a class="btn" href="#/numbers" data-action="by.docs.back">${icon('arrow-left', 'ico-sm')}${t('dv.back')}</a></div></div>
    <div class="card">${kyc ? h`<ul class="nm-doclist nm-dv">${DOCS.map((k) => h`<li class="nm-doc is-ok"><div class="nm-doc-h"><span class="nm-doc-ico">${icon('check', 'ico-sm')}</span>
        <div class="grow"><strong>${t(`docs.${k}`)}</strong><div class="hint-xs">${t('docs.approved', { date: fmt.dayMonth(kyc) })}</div></div><span class="chip chip-ok">${t('dv.approved')}</span></div></li>`)}</ul>
        <div class="card-foot hint-xs">${t('dv.note')}</div>`
      : h`<div class="empty empty-center"><strong>${t('dv.none')}</strong><span class="hint">${t('dv.noneHint')}</span><a class="btn btn-sm btn-navy" href="#/numbers/buy" data-action="by.docs.buy">${t('empty.get')}</a></div>`}</div></div>`;
}

function buyPage(ctx) {
  const { t, html: h, icon } = ctx;
  if (ctx.params.query.view === '1') return docsView(ctx);
  const b = ctx.state.buy;
  const body = [null, buyStep1, buyStep2, buyStep3, buyStep4, buyStep5][b.step](ctx);
  const missing = b.step === 3 ? missingDocs(ctx) : [];
  const canNext = b.step === 1 || (b.step === 2 && b.reservedAt && !b.expired) || (b.step === 3 && !missing.length);
  const nextHelp = b.step === 2 ? (b.expired ? t('by.2.expired') : t('by.nextNeedsResv')) : t('docs.missing', { list: missing.join(' · ') });
  return h`<div class="page nm">
    <div class="page-head"><div class="titles"><h1>${t('by.title')}${ctx.pageHelp()}</h1><span class="sub">${t('by.sub')}</span></div>
      <div class="tools">${b.step < 5 ? h`<button type="button" class="btn btn-ghost" data-action="by.cancel">${t('common.cancel')}</button>` : ''}</div></div>
    ${sandbox(ctx) && b.step < 5 ? h`<div class="note note-info">${icon('info')}<span>${t('by.sandbox')}</span></div>` : ''}
    <section class="card nm-buy" aria-labelledby="nm-buy-h">
      <div class="nm-stepsbar">${steps(ctx)}</div>
      <div class="card-head"><h2 id="nm-buy-h">${t(`by.h.${STEP_KEYS[b.step - 1]}`)}</h2>${b.step === 2 || b.step === 3 ? resvChip(ctx) : ''}</div>
      <div class="card-body">${body}</div>
      ${b.step < 4 ? h`<div class="card-foot row nm-buyfoot">
        <button type="button" class="btn" data-action="by.back" ${raw(b.step === 1 ? 'aria-disabled="true"' : '')}>${icon('arrow-left', 'ico-sm')}${t('common.back')}</button>
        <span class="grow"></span>
        <span class="hint-xs" id="nm-next-help" data-nm-nexthelp ${raw(canNext ? 'hidden' : '')}>${canNext ? '' : nextHelp}</span>
        <button type="button" class="btn btn-navy" data-action="by.next" aria-describedby="nm-next-help" ${raw(canNext ? '' : 'aria-disabled="true"')}>${t('common.next')}${icon('arrow-right', 'ico-sm')}</button></div>`
        : b.step === 4 ? h`<div class="card-foot row"><button type="button" class="btn" data-action="by.back">${icon('arrow-left', 'ico-sm')}${t('common.back')}</button></div>` : ''}
    </section></div>`;
}

// ---------- render ----------
export function render(ctx) {
  return ctx.params.path[0] === 'buy' ? buyPage(ctx) : listPage(ctx);
}

// ---------- behaviour ----------
function search(ctx, { more = false } = {}) {
  const b = ctx.state.buy;
  b.run += 1;
  const run = b.run;
  b.loading = true;
  if (!more) { b.page = 1; b.picked = []; }
  ctx.rerender();
  soon(ctx, (s) => {
    const bb = s.buy;
    if (bb.run !== run) return;
    const page = more ? bb.page + 1 : 1;
    const list = searchNumbers(ctx, bb, page);
    bb.results = more ? [...(bb.results || []), ...list] : list;
    bb.page = page;
    bb.loading = false;
    redraw(ctx, onBuy);
  }, more ? 450 : 500);
}

function attach(ctx, key, file) {
  const b = ctx.state.buy;
  const bad = !OK_TYPES.test(file.name) ? 'type' : file.size > MAX_BYTES ? 'size' : null;
  b.docs[key] = { name: file.name, size: file.size, state: 'upload', checks: [] };
  ctx.rerender();
  // Reading 1.2 s → three checks 300 ms apart → attached (or the failed check with its fix).
  soon(ctx, (s) => {
    const d = s.buy.docs[key];
    if (!d) return;
    d.state = 'check';
    d.checks = [{ k: 'type', ok: null }, { k: 'size', ok: null }, { k: 'readable', ok: null }];
    redraw(ctx, onBuy);
    const res = { type: bad !== 'type', size: bad !== 'size', readable: !bad };
    ['type', 'size', 'readable'].forEach((k, i) => soon(ctx, (s2) => {
      const d2 = s2.buy.docs[key];
      if (!d2 || d2.state !== 'check') return;
      d2.checks = d2.checks.map((c) => (c.k === k ? { ...c, ok: res[k] } : c));
      if (i === 2) { d2.state = bad ? 'bad' : 'ok'; d2.bad = bad; s2.buy.live = ctx.t(bad ? `docs.bad.${bad}` : 'docs.attached'); }
      redraw(ctx, onBuy);
    }, 300 * (i + 1)));
  }, 1200);
}

function placeOrder(ctx) {
  const { t } = ctx;
  const b = ctx.state.buy;
  if (b.ordering) return;
  b.ordering = true;
  ctx.rerender();
  soon(ctx, (s) => {
    const bb = s.buy;
    const m = orderMath(ctx);
    const subId = bb.sub || (ctx.list('subAccounts')[0] || {}).id || null;
    const at = new Date(nowMs()).toISOString();
    const recs = bb.reserved.map((num) => ({ id: newId('num'), number: num, e164: e164(num), type: bb.group === '02' ? 'local' : 'regional', area: bb.area, sub: subId, routing: null, callerIdFor: null, status: 'in-review', orderedAt: at, feeFrom: m.live ? at : null, monthly: m.price }));
    ctx.store.set('numbers', [...ctx.list('numbers'), ...recs]);
    if (m.today) spend(m.today);
    recs.forEach((r) => { audit('number.ordered', { number: r.number, monthly: r.monthly }, r.id); notify('numberOrdered', { vars: { number: r.number }, href: `numbers?n=${r.id}` }); });
    setStep('number', 'progress');
    bb.ordered = recs.map((r) => r.id);
    bb.ordering = false;
    bb.step = 5;
    ctx.ui.toast(t('toast.T13', { num: recs.map((r) => r.number).join(', ') }), { kind: 'success' });
    redraw(ctx, onBuy);
  }, 800);
}

async function cancelBuy(ctx) {
  const { t } = ctx;
  const b = ctx.state.buy;
  if (b.reservedAt && !b.expired) {
    const ok = await ctx.ui.confirm({ title: t('by.leaveTitle'), body: t('by.leaveBody'), confirmLabel: t('by.leaveYes'), cancelLabel: t('by.leaveNo') });
    if (!ok) return;
  }
  ctx.state.buy = { ...freshBuy(), run: b.run + 1 };
  ctx.go('numbers');
}

export function mount(root, ctx) {
  CTX = ctx;
  const { t } = ctx;
  const b = ctx.state.buy;
  const onBuyRoute = ctx.params.path[0] === 'buy';

  ctx.actions(root, {
    // list
    'nb.buy': noop,
    'nb.empty.get': noop,
    'nb.status': noop,
    'nb.sub': noop,
    'nb.search': noop,
    'by.1.sub': noop,
    'by.2.search': noop,
    'by.3.onfile': noop,
    'by.3.addr': noop,
    'by.3.signer': noop,
    'by.3.consent': noop,
    'by.3.help': noop,
    'nb.loa': () => loaModal(ctx),
    'nb.empty.loa': () => loaModal(ctx),
    'nb.type': (el) => ctx.setState({ type: el.dataset.value }),
    'nb.tile.total': () => ctx.setState({ status: 'all', type: 'all', sub: 'all', q: '' }),
    'nb.tile.active': () => ctx.setState({ status: ctx.state.status === 'active' ? 'all' : 'active' }),
    'nb.tile.review': () => ctx.setState({ status: ctx.state.status === 'in-review' ? 'all' : 'in-review' }),
    'nb.clear': () => ctx.setState({ type: 'all', status: 'all', sub: 'all', q: '' }),
    // buy flow
    'by.cancel': () => cancelBuy(ctx),
    'by.back': () => { const s = ctx.state.buy; if (s.step > 1) { s.step -= 1; ctx.rerender(); } },
    'by.next': () => {
      const s = ctx.state.buy;
      if (s.step === 1) { s.step = 2; if (!s.results) { search(ctx); return; } }
      else if (s.step === 2 && s.reservedAt && !s.expired) s.step = 3;
      else if (s.step === 3 && !missingDocs(ctx).length) s.step = 4;
      ctx.rerender();
      const card = root.querySelector('.nm-buy');
      if (card && card.getBoundingClientRect().top < 0) card.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
    },
    'by.1.type': (el) => { const s = ctx.state.buy; if (s.group === el.dataset.value) return; s.group = el.dataset.value; s.area = GROUPS[s.group][0]; s.results = null; s.picked = []; s.digits = s.group === '02' ? '24' : ''; ctx.rerender(); },
    'by.1.area': (el) => { const s = ctx.state.buy; s.area = el.dataset.value; s.results = null; s.picked = []; ctx.rerender(); },
    'by.1.qty': (el) => { const s = ctx.state.buy; const q = Math.max(1, Math.min(20, s.qty + Number(el.dataset.value))); if (q !== s.qty) { s.qty = q; if (s.picked.length > q) s.picked = s.picked.slice(0, q); ctx.rerender(); } },
    'by.2.mode': (el) => { const s = ctx.state.buy; if (s.mode !== el.dataset.value) { s.mode = el.dataset.value; search(ctx); } },
    'by.2.pick': (el) => {
      const s = ctx.state.buy;
      if (s.reservedAt && !s.expired) return;
      const v = el.dataset.value;
      if (s.picked.includes(v)) s.picked = s.picked.filter((x) => x !== v);
      else if (s.qty === 1) s.picked = [v];
      else if (s.picked.length < s.qty) s.picked = [...s.picked, v];
      else { ctx.ui.toast(t('by.2.maxPicked', { n: s.qty }), { kind: 'info' }); return; }
      ctx.rerender();
    },
    'by.2.more': () => search(ctx, { more: true }),
    'by.2.clear': () => { ctx.state.buy.digits = ''; search(ctx); },
    'by.2.reserve': () => {
      const s = ctx.state.buy;
      if (s.reserving || s.picked.length !== s.qty) return;
      s.reserving = true;
      ctx.rerender();
      soon(ctx, (st) => {
        st.buy.reserving = false;
        st.buy.reservedAt = nowMs();
        st.buy.reserved = st.buy.picked.slice();
        st.buy.expired = false;
        st.buy.live = t('by.2.reservedLive', { min: RESERVE_MIN });
        redraw(ctx, onBuy);
      }, 600);
    },
    'by.2.unreserve': () => {
      const s = ctx.state.buy;
      const prev = { reservedAt: s.reservedAt, reserved: s.reserved };
      s.reservedAt = 0; s.reserved = []; s.expired = false;
      ctx.rerender();
      ctx.ui.toast(t('by.2.released'), { kind: 'info', timeout: 10000, action: { label: t('common.undo'), onClick: () => { const s2 = ctx.state.buy; if (!s2.reservedAt) { s2.reservedAt = prev.reservedAt; s2.reserved = prev.reserved; s2.expired = reservationLeft(s2) === 0; redraw(ctx, onBuy); } } } });
    },
    'by.2.expire': () => { const s = ctx.state.buy; s.reservedAt = nowMs() - RESERVE_MIN * 60000; s.expired = true; s.live = t('by.2.expired'); ctx.rerender(); },
    'by.2.again': () => {
      const s = ctx.state.buy;
      s.step = 2;
      s.reserving = true;
      ctx.rerender();
      soon(ctx, (st) => { st.buy.reserving = false; st.buy.reservedAt = nowMs(); st.buy.expired = false; st.buy.reserved = st.buy.reserved.length ? st.buy.reserved : st.buy.picked.slice(); st.buy.live = t('by.2.reservedLive', { min: RESERVE_MIN }); redraw(ctx, onBuy); }, 600);
    },
    'by.3.upload': (el) => {
      const key = el.dataset.value;
      const names = { cert: 'company-certificate-sample.pdf', director: 'director-id-sample.pdf', address: 'proof-of-address-sample.pdf' };
      attach(ctx, key, { name: names[key], size: [186368, 142336, 97280][DOCS.indexOf(key)] });
    },
    'by.3.remove': (el) => {
      const s = ctx.state.buy;
      const key = el.dataset.value;
      const prev = s.docs[key];
      delete s.docs[key];
      ctx.rerender();
      ctx.ui.toast(t('docs.removed', { doc: t(`docs.${key}`) }), { kind: 'info', timeout: 10000, action: { label: t('common.undo'), onClick: () => { ctx.state.buy.docs[key] = prev; redraw(ctx, onBuy); } } });
    },
    'by.4.edit': (el) => { ctx.state.buy.step = Number(el.dataset.value); ctx.rerender(); },
    'by.4.order': () => placeOrder(ctx),
    'by.4.topup': () => ctx.ui.topup(),
    'by.4.limit': noop, // link to Billing › How you pay
    'by.5.route': () => { ctx.state.buy = { ...freshBuy(), run: ctx.state.buy.run + 1, ordered: [] }; },
    'by.5.back': () => { ctx.state.buy = { ...freshBuy(), run: ctx.state.buy.run + 1 }; },
    'by.5.connect': () => { ctx.state.buy = { ...freshBuy(), run: ctx.state.buy.run + 1 }; },
    'by.5.another': () => { ctx.state.buy = { ...freshBuy(), run: ctx.state.buy.run + 1 }; ctx.rerender(); },
  });

  ctx.inputs(root, {
    status: (v) => ctx.setState({ status: v }),
    sub: (v) => ctx.setState({ sub: v }),
    q: (v) => ctx.setState({ q: v }),
    buySub: (v) => { ctx.state.buy.sub = v; },
    digits: (v, el) => {
      const s = ctx.state.buy;
      const clean = v.replace(/\D/g, '').slice(0, width(s.area));
      if (clean !== v) el.value = clean;
      if (clean === s.digits) return;
      s.digits = clean;
      clearTimeout(s._deb);
      s._deb = setTimeout(() => { if (ctx.state.buy === s && onBuy()) search(ctx); }, 300);
    },
    onFile: (v) => { ctx.state.buy.onFile = !!v; ctx.rerender(); },
    address: (v) => { ctx.state.buy.address = v; syncMissing(root, ctx); },
    signer: (v) => { ctx.state.buy.signer = v; syncMissing(root, ctx); },
    consent: (v) => { ctx.state.buy.consent = !!v; ctx.rerender(); },
    file: (v, el) => pickFile(el),
  });
  // A chosen file: its real name and size go through the same checks as the sample (name and size only, nothing is read).
  // Browsers fire "input" and "change" for a file picker; both paths land here once per file.
  function pickFile(el) {
    const f = el.files && el.files[0];
    if (!f || el.__picked === f) return;
    el.__picked = f;
    attach(ctx, el.dataset.doc, { name: f.name, size: f.size });
  }
  ctx.on(root, 'change', 'input[type="file"][data-field="file"]', (ev, el) => pickFile(el));
  ctx.on(root, 'keydown', '[data-field="digits"]', (ev) => {
    if (ev.key !== 'Enter' || ev.isComposing || ev.keyCode === 229) return;
    ev.preventDefault();
    clearTimeout(ctx.state.buy._deb);
    search(ctx);
  });

  ctx.watch('numbers', 'flows', 'trunks', 'env', 'mode', 'credits', 'subAccounts');

  if (onBuyRoute) {
    if (b.step === 2 && !b.results && !b.loading) ctx.later(() => search(ctx), 0);
    // Reservation countdown: ticks the chip text; at 0:00 the reservation expires.
    ctx.every(() => {
      const s = ctx.state.buy;
      if (!s.reservedAt || s.expired) return;
      const left = reservationLeft(s);
      root.querySelectorAll('[data-nm-countdown]').forEach((el) => { el.textContent = mmss(left); });
      if (left <= 0) { s.expired = true; s.live = t('by.2.expired'); ctx.rerender(); }
    }, 1000);
    // Leaving with numbers reserved and no order: ask first.
    if (b.reservedAt && !b.expired && b.step < 5) {
      ctx.guard(async () => {
        const ok = await ctx.ui.confirm({ title: t('by.leaveTitle'), body: t('by.leaveBody'), confirmLabel: t('by.leaveYes'), cancelLabel: t('by.leaveNo') });
        if (ok) ctx.state.buy = { ...freshBuy(), run: ctx.state.buy.run + 1 };
        return ok;
      });
    }
  }

  // Detail drawer from ?n= (linkable, survives reload); ?loa=1 opens the LOA form (palette command).
  syncDrawer(ctx);
  ctx.cleanup(() => { if (!/^#\/numbers\?(.*&)?n=/.test(location.hash)) closeDrawer(); });
  if (!onBuyRoute && ctx.params.query.loa === '1') ctx.later(() => { ctx.go('numbers', { replace: true }); loaModal(ctx); }, 30);
}
