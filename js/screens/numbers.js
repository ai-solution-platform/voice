// Numbers — #/numbers (list · number drawer ?n=<id> · request drawer ?r=<id>) · #/numbers/buy (5 steps; ?return=connect · ?step=docs&view=1)
// Numbers are always masked (02-xxx-1000); E.164 views keep the mask (+662xxx1000). Prices come from
// js/data/prices.js only, and the cost is shown on the same screen as the button that spends. KYC files are read
// for their name and size only — nothing leaves the browser.
// Step 1 is the type: Landline is ordered now (area → digits → reserve → documents → order). Mobile, toll-free 1800
// and 4-digit 1xxx are sent as a request (store numberRequests): by quote, nothing charged until the number is
// active. "Your existing number" opens the letter-of-authorisation form.

import { raw, on, reducedMotion } from '../core/dom.js';
import { newId, audit, notify, setStep, isPostpaid, numberFeesMonth, currentPeriod } from '../core/actions.js';
import { nowMs } from '../data/clock.js';
import { PRICES, BY_QUOTE_TYPES, numberFirstMonth, numberFeeInMonth } from '../data/prices.js';
import { registerIcons } from '../ui/icons.js';

registerIcons({ smartphone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.2"/><path d="M10.5 18.3h3"/>' });

export const id = 'numbers';
export const nav = { group: 'build', icon: 'hash', labelKey: 'nav.numbers' };
export const titleKey = 'nav.numbers';
export const skeleton = 'table';
export const css = true;

/** Hold length for reserved numbers, in minutes. One constant. */
const RESERVE_MIN = 30;
const STEP_KEYS = ['type', 'pick', 'docs', 'review', 'done'];
/** Step labels: a request has "Details" where an order picks the number. */
const stepKeys = (b) => (isRequest(b.kind) ? ['type', 'details', 'docs', 'review', 'done'] : STEP_KEYS);
const GROUPS = { '02': ['02'], '03x': ['038', '035', '034'], '0xx': ['053', '043', '074'] };
const CITY = { '02': 'bkk', '038': 'chonburi', '035': 'ayutthaya', '034': 'nakhonpathom', '053': 'chiangmai', '043': 'khonkaen', '074': 'hatyai' };
const DOCS = ['cert', 'director', 'address'];
/** Step 3 checklist (T2 audit #6): the three uploads + how the number is used + power of attorney = 5 items. */
const USE_PURPOSES = ['otp', 'service', 'reminder', 'payment', 'marketing'];
const SAMPLE_FILES = {
  cert: ['company-certificate-sample.pdf', 186368], director: ['director-id-sample.pdf', 142336], address: ['proof-of-address-sample.pdf', 97280], poa: ['power-of-attorney-sample.pdf', 120832],
  intent: ['letter-of-intent-sample.pdf', 104448], tfForm: ['toll-free-application-sample.pdf', 132096], nbtcForm: ['nbtc-application-sample.pdf', 158720], profile: ['company-profile-sample.pdf', 214016],
};

// ---------- number types (step 1) ----------
/** Types sold in the buy flow. Landline is ordered now; the others are requests (prices.js BY_QUOTE_TYPES). */
const KINDS = ['landline', 'mobile', 'toll_free', 'short_code'];
const isRequest = (k) => BY_QUOTE_TYPES.includes(k);
const KIND_ICON = { landline: 'phone', mobile: 'smartphone', toll_free: 'phone-in', short_code: 'hash', loa: 'file-text' };
/** List filter: landline = local + regional; loa = your existing number (caller ID only). */
const TYPE_FILTERS = ['all', 'landline', 'mobile', 'toll_free', 'short_code', 'loa'];
const typeGroup = (type) => (type === 'local' || type === 'regional' ? 'landline' : type);
const MOBILE_QTY = [1, 5, 10, 20, 30];
const TOLL_FREE_MAX = 10;
/** Our target for a quote (business days) — shown as a target, never a promise. */
const QUOTE_DAYS = 2;
/** Preferred ending digits: the last block of the number (mobile 0xx-xxx-xxxx · toll-free 1800-xxx-xxx). */
const PREF_MAX = { mobile: 4, toll_free: 3 };
const SC_CHOICES = 3;        // a 4-digit application names up to 3 numbers
const SC_RE = /^1\d{3}$/;    // 1 + 3 digits
/** Documents a request adds to the company documents. */
const EXTRA_DOCS = { landline: [], mobile: ['intent'], toll_free: ['tfForm'], short_code: ['nbtcForm', 'profile'] };
/** What each type may be used for: mobile = one-to-one calls only (not campaigns or broadcasts); toll-free and 4-digit are inbound. */
const PURPOSES = { landline: USE_PURPOSES, mobile: ['service', 'agents', 'masking'], toll_free: ['service', 'orders', 'info'], short_code: ['service', 'orders', 'info'] };
/** Request lifecycle (cancelled / rejected are terminal). */
const LIFE = { mobile: ['requested', 'quoted', 'in_review', 'active'], toll_free: ['requested', 'quoted', 'in_review', 'active'], short_code: ['preparing', 'submitted_to_nbtc', 'allocated', 'active'] };
const OPEN = ['requested', 'quoted', 'in_review', 'preparing', 'submitted_to_nbtc', 'allocated'];
const RQ_TONE = { requested: 'warn', quoted: 'info', in_review: 'warn', preparing: 'warn', submitted_to_nbtc: 'info', allocated: 'info', active: 'ok', cancelled: '', rejected: 'err' };
const RQ_WHEN = { requested: 'requestedAt', quoted: 'quotedAt', in_review: 'acceptedAt', preparing: 'requestedAt', submitted_to_nbtc: 'submittedAt', allocated: 'allocatedAt', cancelled: 'cancelledAt' };
const maskShort = (d) => `1xx${String(d).slice(-1)}`;
/** Number format per type: the pattern (mono, untranslated) · how many digits. */
const PATTERN = { landline: '02 · 03x · 0xx', mobile: '06 · 08 · 09', toll_free: '1800-xxx-xxx', short_code: '1xxx' };
const DIGITS = { landline: 9, mobile: 10, toll_free: 10, short_code: 4 };
const formatLine = (ctx, k) => ctx.html`<span class="mono" translate="no">${PATTERN[k]}</span> · ${ctx.t('by.1.digits', { n: DIGITS[k] })}`;
/** The use declared with the documents on file (busy account): pre-fills the use item, editable. */
const USE_ON_FILE = { purpose: 'otp', perDay: '1000' };
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
  run: 0, step: 1, kind: 'landline', group: '02', area: '02', qty: 1, sub: null, mode: 'contains', digits: '24', page: 1, loading: false, results: null,
  picked: [], reserving: false, reservedAt: 0, reserved: [], expired: false, onFile: true, docs: {}, address: '', signer: '', consent: false,
  use: { purpose: '', who: '', perDay: '', touched: false }, signerIsDirector: true,
  // requests (mobile · toll-free · 4-digit): how many, preferred ending digits, the 4-digit choices (+ which were left)
  rqQty: 1, pref: '', choices: ['', '', ''], choiceLeft: [false, false, false],
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
let RD = null;           // { id, handle } — the open request drawer

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

// ---------- requests (mobile · toll-free · 4-digit) ----------
/** Requests shown in the list. An active request's numbers are in the numbers list, so it is not repeated. */
const requests = (ctx) => ctx.list('numberRequests').filter((r) => r.status !== 'active');

/** How a request reads in a list: the number in the quote, else the format (× how many), else the 4-digit choices. */
function rqLabel(rq) {
  if (rq.number) return rq.number;
  if (rq.type === 'short_code') return (rq.preferred || []).length ? rq.preferred.join(' · ') : '1xxx';
  const base = rq.type === 'toll_free' ? '1800-xxx-xxx' : '0xx-xxx-xxxx';
  return rq.quantity > 1 ? `${base} × ${rq.quantity}` : base;
}

/** Mobile and toll-free numbers are assigned by the operator after the quote is accepted. */
const unassigned = (rq) => !rq.number && rq.type !== 'short_code';

/** Type badge (the same in the list, the drawers and the review): Landline · Mobile · Toll-free 1800 · 4-digit · Existing. */
function badge(ctx, type) {
  const g = typeGroup(type);
  return ctx.html`<span class="chip nm-badge">${ctx.icon(KIND_ICON[g] || 'phone', 'ico-xs')}${ctx.t(`badge.${g}`)}</span>`;
}

function rqChip(ctx, rq) {
  const { t, html: h, fmt } = ctx;
  const tone = RQ_TONE[rq.status];
  const when = rq[RQ_WHEN[rq.status]];
  return h`<span class="chip ${tone ? `chip-${tone}` : ''}" tabindex="0" data-tip-key="numbers.tip.rq.${rq.status}">${t(`rq.st.${rq.status}`)}</span>${when ? h` <span class="hint-xs nowrap">${t(`rq.when.${rq.status}`, { date: fmt.dayMonth(when) })}</span>` : ''}`;
}

/** The use declared with a request (seeded answers are { en, th, zh }). */
function rqUse(ctx, rq) {
  const { t, fmt } = ctx;
  const u = rq.use || {};
  const who = u.who && typeof u.who === 'object' ? ctx.loc(u.who) : String(u.who || '—');
  const purpose = u.purpose ? t(`docs.use.p.${u.purpose}`) : '—';
  return u.perMonth != null ? t('rev.useMonth', { purpose, who, n: fmt.int(Number(u.perMonth) || 0) }) : t('rev.use', { purpose, who, n: fmt.int(Number(u.perDay) || 0) });
}

// ---------- list ----------
function rowMatches(ctx, row, isRq) {
  const s = ctx.state;
  const q = (s.q || '').replace(/\D/g, '');
  if (s.type !== 'all' && typeGroup(row.type) !== s.type) return false;
  if (s.sub !== 'all' && row.sub !== s.sub) return false;
  if (s.status !== 'all') {
    // Requests: "Requests in progress" = any open request; a request whose documents are being checked is also "In review".
    if (isRq ? !((s.status === 'requests' && OPEN.includes(row.status)) || (s.status === 'in-review' && row.status === 'in_review')) : row.status !== s.status) return false;
  }
  if (!q) return true;
  const texts = isRq ? [rqLabel(row), ...(row.preferred || [])] : [row.number];
  return texts.some((x) => digitsOf(x).includes(q));
}
function filtered(ctx) {
  return { nums: ctx.list('numbers').filter((n) => rowMatches(ctx, n, false)), reqs: requests(ctx).filter((r) => rowMatches(ctx, r, true)) };
}

function header(ctx) {
  const { t, html: h, icon } = ctx;
  const has = ctx.list('numbers').length + requests(ctx).length > 0;
  return h`<div class="page-head"><div class="titles"><h1>${t('title')}${ctx.pageHelp()}</h1><span class="sub">${t('sub')}</span></div>
    <div class="tools">${has ? h`<button type="button" class="btn" data-action="nb.loa">${icon('file-text')}${t('loa')}</button>
      <a class="btn btn-primary" href="#/numbers/buy" data-action="nb.buy">${icon('plus')}${t('buy')}</a>` : ''}</div></div>`;
}

function tiles(ctx) {
  const { t, html: h, fmt } = ctx;
  const all = ctx.list('numbers');
  const active = all.filter((n) => n.status === 'active');
  // In review = numbers whose documents or letter are checked + requests whose documents are checked (same as the filter).
  const review = [...all.filter((n) => n.status === 'in-review'), ...requests(ctx).filter((r) => r.status === 'in_review')];
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
    <div class="seg" role="group" aria-label="${t('f.typeAria')}">${TYPE_FILTERS.map((k) => h`<button type="button" data-action="nb.type" data-value="${k}" aria-pressed="${s.type === k}">${t(`f.type.${k}`)}</button>`)}</div>
    <select class="select nm-sel" data-field="status" data-action="nb.status" aria-label="${t('f.statusAria')}">${['all', 'active', 'in-review', 'requests', 'releasing'].map((k) => h`<option value="${k}" ${raw(s.status === k ? 'selected' : '')}>${t(`f.status.${k}`)}</option>`)}</select>
    ${subs.length > 1 ? h`<select class="select nm-sel" data-field="sub" data-action="nb.sub" aria-label="${t('f.subAria')}"><option value="all">${t('f.subAll')}</option>${subs.map((x) => h`<option value="${x.id}" ${raw(s.sub === x.id ? 'selected' : '')}>${ctx.loc(x.name)}</option>`)}</select>` : ''}
    <label class="nm-search">${icon('search', 'ico-sm')}<input class="input" type="search" inputmode="numeric" data-field="q" data-action="nb.search" value="${s.q}" placeholder="${t('f.searchPh')}" aria-label="${t('f.searchAria')}" autocomplete="off"></label>
  </div>`;
}

function table(ctx, { nums, reqs }) {
  const { t, html: h, fmt } = ctx;
  if (!nums.length && !reqs.length) {
    return h`<div class="card"><div class="empty empty-center" role="status"><strong>${t('noMatch')}</strong><span class="hint">${t('noMatchHint')}</span>
      <button type="button" class="btn btn-sm" data-action="nb.clear">${t('clear')}</button></div></div>`;
  }
  return h`<div class="card"><div class="tbl-wrap"><table class="tbl nm-tbl"><thead><tr>
      <th>${t('col.number')} · ${t('col.type')}</th><th>${t('col.routing')}</th><th>${ctx.term(t('col.cid'), 'caller_id')}</th><th>${t('col.status')}</th><th class="num">${t('col.monthly')}</th></tr></thead>
    <tbody>${nums.map((n) => h`<tr class="${ctx.state.fresh === n.id ? 'new-row' : ''}">
      <td><a class="mono strong" href="#/numbers?n=${n.id}" data-action="nb.row" translate="no">${n.number}</a>
        <div class="nm-typeline">${badge(ctx, n.type)}<span class="hint-xs">${n.type === 'loa' ? t('type.loa') : t(`city.${CITY[n.area] || 'bkk'}`)}</span></div>
        <div class="hint-xs" title="${t('col.sub')}">${ctx.ui.describe.sub(n.sub)}</div></td>
      <td class="nm-route">${routeLabel(ctx, n)}</td>
      <td class="nm-cid">${cidUse(ctx, n)}</td>
      <td class="nowrap nm-stcell">${statusChip(ctx, n)}</td>
      <td class="num mono">${n.monthly != null ? fmt.int(n.monthly) : '—'}</td></tr>`)}
    ${reqs.map((rq) => h`<tr class="nm-rqrow ${ctx.state.fresh === rq.id ? 'new-row' : ''}">
      <td>${unassigned(rq) ? h`<a class="strong" href="#/numbers?r=${rq.id}" data-action="nb.rq.row">${t('rq.toAssign', { count: rq.quantity || 1, n: rq.quantity || 1 })}</a>` : h`<a class="mono strong" href="#/numbers?r=${rq.id}" data-action="nb.rq.row" translate="no">${rqLabel(rq)}</a>`}
        <div class="nm-typeline">${badge(ctx, rq.type)}<span class="hint-xs">${t(rq.type === 'short_code' ? 'rq.kind.application' : 'rq.kind.request')}</span></div>
        <div class="hint-xs" title="${t('col.sub')}">${ctx.ui.describe.sub(rq.sub)}</div></td>
      <td class="nm-route"><span class="hint-xs">${t('rq.route')}</span></td>
      <td class="nm-cid">${t(rq.type === 'mobile' ? 'rq.cid.mobile' : 'rq.cid.inbound')}</td>
      <td class="nowrap nm-stcell">${rqChip(ctx, rq)}</td>
      <td class="num"><span class="hint-xs nowrap">${t('rq.byQuote')}</span></td></tr>`)}</tbody></table></div>
    <div class="card-foot row nm-foot"><span class="hint-xs nm-foot-t">${t('foot', { price: fmt.int(PRICES.number), bulk: fmt.int(PRICES.numberBulk), from: PRICES.numberBulkFrom })}<span class="nm-block">${t('footRq')}</span></span>
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
  const has = all.length + requests(ctx).length > 0;
  const sbx = sandbox(ctx) && all.length > 0;
  return h`<div class="page nm">${header(ctx)}
    ${sbx ? h`<div class="note note-warn">${icon('info')}<span>${t('sandboxNote', { shared: '02-xxx-0100' })}</span></div>` : ''}
    ${has ? h`${tiles(ctx)}${filters(ctx)}${table(ctx, filtered(ctx))}` : emptyState(ctx)}
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

// ---------- request drawer (?r=<id>) ----------
function rqDrawerBody(ctx, rq) {
  const { t, html: h, icon, fmt } = ctx;
  const life = LIFE[rq.type] || LIFE.mobile;
  const closed = rq.status === 'cancelled' || rq.status === 'rejected';
  const at = life.indexOf(rq.status);
  const open = OPEN.includes(rq.status);
  const sc = rq.type === 'short_code';
  const kv = (k, v) => h`<div class="kv"><span class="k">${k}</span><span class="v">${v}</span></div>`;
  const pref = sc ? h`<span class="mono" translate="no">${(rq.preferred || []).join(' · ') || '—'}</span>`
    : (rq.preferred || []).length ? t('rd.prefEnds', { digits: rq.preferred.join(', ') }) : t('rd.prefNone');
  const docs = [...DOCS.map((k) => t(`docs.${k}Short`)), ...(rq.docs || EXTRA_DOCS[rq.type] || []).map((k) => t(`docs.${k}Short`))].join(' · ');
  let now = '';
  if (rq.status === 'requested') now = h`<p class="hint-xs">${t('rd.waitQuote', { days: QUOTE_DAYS, date: fmt.dateProse(rq.requestedAt) })}</p>`;
  else if (rq.status === 'quoted') {
    now = h`<div class="note note-info nm-quote">${icon('file-text')}<div class="stack" style="gap:6px"><strong>${t('rd.quoteReady')}</strong>
        <span>${t('rd.quoteBody', { date: fmt.dateProse(rq.quotedAt), ref: quoteRef(rq) })}</span>
        ${rq.type === 'toll_free' ? h`<span>${t('rd.quoteTollFree')}</span>` : ''}<span>${t('rd.noFee')}</span></div></div>
      <div class="row"><button type="button" class="btn" data-action="nb.rq.quote" aria-haspopup="dialog">${icon('file-text')}${t('rd.quoteOpen')}</button>
        <button type="button" class="btn btn-navy" data-action="nb.rq.accept">${icon('check')}${t('rd.accept')}</button></div>
      <span class="hint-xs">${t('rd.acceptHint')}</span>`;
  } else if (rq.status === 'in_review') now = h`<p class="hint-xs">${t('rd.reviewBody')}</p>`;
  else if (rq.status === 'preparing') now = h`<p class="hint-xs">${t('rd.prepBody')}</p>`;
  else if (rq.status === 'submitted_to_nbtc') now = h`<p class="hint-xs">${t('rd.nbtcBody', { date: fmt.dateProse(rq.submittedAt) })}</p>`;
  else if (rq.status === 'allocated') now = h`<p class="hint-xs">${t('rd.allocBody')}</p>`;
  else if (closed) now = h`<p class="hint-xs">${t(rq.status === 'cancelled' ? 'rd.cancelledBody' : 'rd.rejectedBody', { date: fmt.dateProse(rq.cancelledAt || rq.requestedAt) })}</p>`;

  return h`<div class="stack-4 nm-drawer">
    <div class="stack nm-dhead"><div class="row-tight">${rqChip(ctx, rq)}</div><span class="hint">${badge(ctx, rq.type)} ${t(sc ? 'rq.kind.application' : 'rq.kind.request')} · ${ctx.ui.describe.sub(rq.sub)}</span></div>
    <div class="nm-e164 row"><span class="hint-xs">${t('rd.id')}</span><code class="mono" translate="no">${rq.id}</code>
      <button type="button" class="copybtn" data-action="nb.rq.copy" aria-label="${t('rd.copy')}">${icon('copy', 'ico-sm')}</button></div>

    <section class="nm-sec" aria-labelledby="nm-rq-p"><h3 id="nm-rq-p">${t('rd.progress')}</h3>
      <ol class="nm-life ${closed ? 'is-closed' : ''}">${life.map((k, i) => {
        const st = closed ? 'todo' : i < at ? 'done' : i === at ? 'current' : 'todo';
        return h`<li class="is-${st}" ${raw(st === 'current' ? 'aria-current="step"' : '')}><span class="nm-life-dot">${st === 'done' ? icon('check', 'ico-xs') : ''}</span><span>${t(`rq.st.${k}`)}</span></li>`;
      })}</ol>
      ${now}</section>

    <section class="nm-sec" aria-labelledby="nm-rq-d"><h3 id="nm-rq-d">${t('rd.details')}</h3>
      ${kv(t('rd.format'), formatLine(ctx, rq.type))}
      ${rq.number ? kv(t('rd.number'), h`<span class="mono" translate="no">${rq.number}</span>`) : ''}
      ${sc ? '' : kv(t('rd.qty'), fmt.int(rq.quantity || 1))}
      ${kv(t(sc ? 'rd.choices' : 'rd.pref'), pref)}
      <p class="hint-xs">${rqUse(ctx, rq)}</p>
      <p class="hint-xs">${t('rd.docs', { list: docs })}</p></section>

    <section class="nm-sec" aria-labelledby="nm-rq-f"><h3 id="nm-rq-f">${t('d.feeTitle')}</h3>
      ${sc ? h`${kv(ctx.term(t('by.cost.nbtc'), 'nbtc'), t('by.cost.nbtcV'))}${kv(t('by.cost.service'), t('by.cost.byQuote'))}`
        : h`${kv(t('by.cost.monthlyRq'), t('by.cost.byQuote'))}${kv(t(rq.type === 'toll_free' ? 'by.cost.minutesTf' : 'by.cost.minutesRq'), t('by.cost.byQuote'))}`}
      ${kv(t('rd.charged'), fmt.credits2(0))}
      <p class="hint-xs">${t('rd.noFee')}</p>
      <span class="chip chip-warn" tabindex="0" data-tip-key="common.plannedPricesTip">${t('common.plannedPrices')}</span></section>

    ${open ? h`<section class="nm-sec nm-danger" aria-labelledby="nm-rq-x"><h3 id="nm-rq-x">${t('rd.cancelTitleSec')}</h3>
      <p class="hint-xs">${t('rd.cancelHint')}</p>
      <div><button type="button" class="btn btn-danger-ghost" data-action="nb.rq.cancel">${icon('x')}${t(sc ? 'rd.cancelSc' : 'rd.cancel')}</button></div></section>` : ''}
  </div>`;
}

// ---------- the quote (a SAMPLE in the demo: no amounts — the real quote, emailed, lists them) ----------
const quoteRef = (rq) => rq.quoteRef || `Q-${String(rq.id).slice(-6)}`;
const orgName = (ctx) => { const n = ctx.store.get('org.name'); return n && typeof n === 'object' ? ctx.loc(n) : String(n || '—'); };

/** The quote as lines: shared by the sample view and its .txt download. Amounts are never shown in the demo. */
function quoteRows(ctx, rq) {
  const { t, fmt } = ctx;
  const tf = rq.type === 'toll_free';
  return [
    [t('qt.customer'), orgName(ctx)],
    [t('qt.sent'), fmt.dateProse(rq.quotedAt || rq.requestedAt)],
    [t('rd.id'), rq.id, true],
    [t('rev.type'), t(`badge.${rq.type}`)],
    ...(rq.number ? [[t('rd.number'), rq.number, true]] : []),
    [t('rd.qty'), fmt.int(rq.quantity || 1)],
    [t('by.cost.monthlyRq'), null],
    [t(tf ? 'by.cost.minutesTf' : 'by.cost.minutesRq'), null],
  ];
}

function quoteText(ctx, rq) {
  const { t } = ctx;
  const lines = [t('qt.fileHead'), '', t('qt.title', { ref: quoteRef(rq) }),
    ...quoteRows(ctx, rq).map(([k, v]) => `${k}: ${v == null ? `[${t('qt.amount')}]` : v}`),
    '', t('rd.noFee'), ...(rq.type === 'toll_free' ? [t('rd.quoteTollFree')] : []), '', t('qt.fileHead')];
  return `${lines.join('\r\n')}\r\n`;
}

function quoteModal(ctx, rq) {
  const { t, html: h } = ctx;
  const ref = quoteRef(rq);
  const body = h`<div class="stack-3">
    <div><span class="chip chip-warn nm-sample">${t('qt.sample')}</span></div>
    <p class="hint">${t('qt.intro')}</p>
    <div class="card card-pad stack nm-quote-v">${quoteRows(ctx, rq).map(([k, v, mono]) => h`<div class="kv"><span class="k">${k}</span><span class="v">${v == null ? h`<span class="hint">${t('qt.amount')}</span>` : mono ? h`<span class="mono" translate="no">${v}</span>` : v}</span></div>`)}</div>
    <p class="hint-xs">${t('rd.noFee')}${rq.type === 'toll_free' ? ` ${t('rd.quoteTollFree')}` : ''}</p></div>`;
  ctx.ui.modal({
    title: t('qt.title', { ref }), size: 'md', body,
    buttons: [
      { label: t('common.close') },
      { label: t('qt.download'), kind: 'navy', icon: 'download', action: 'nb.rq.qdl', onClick: () => { ctx.ui.download(`ants-voice-quote-SAMPLE-${ref}.txt`, quoteText(ctx, rq)); return false; } },
    ],
  });
}

function refreshRqDrawer() {
  if (!RD || !CTX) return;
  const rq = CTX.list('numberRequests').find((x) => x.id === RD.id);
  if (!rq) { closeRqDrawer(); return; }
  const a = document.activeElement;
  const sel = a && RD.handle.el.contains(a) ? focusKey(a) : null;
  RD.handle.setBody(rqDrawerBody(CTX, rq));
  if (sel) { const el = RD.handle.el.querySelector(sel); if (el) el.focus({ preventScroll: true }); }
}

function closeRqDrawer() {
  if (!RD) return;
  const h = RD.handle;
  RD = null;
  h.close();
}

function syncRqDrawer(ctx) {
  const rid = ctx.params.query.r;
  if (!rid || ctx.params.path.length) { closeRqDrawer(); return; }
  const rq = ctx.list('numberRequests').find((x) => x.id === rid);
  if (!rq) {
    closeRqDrawer();
    ctx.ui.toast(ctx.t('rd.notFound'), { kind: 'warn', reqId: true });
    ctx.go('numbers', { replace: true });
    return;
  }
  if (RD && RD.id === rid) { refreshRqDrawer(); return; }
  closeRqDrawer();
  const handle = ctx.ui.drawer({
    title: ctx.t(`rd.title.${rq.type}`),
    body: rqDrawerBody(ctx, rq),
    actions: rqDrawerActions(),
    onClose: () => {
      if (RD && RD.handle === handle) {
        RD = null;
        if (/^#\/numbers\?/.test(location.hash) && /[?&]r=/.test(location.hash)) CTX.go('numbers', { replace: true });
      }
    },
  });
  RD = { id: rid, handle };
}

function rqDrawerActions() {
  const cur = () => CTX;
  const req = () => cur().list('numberRequests').find((x) => x.id === (RD && RD.id));
  const patch = (id, fn) => cur().store.update('numberRequests', (list) => list.map((x) => (x.id === id ? fn(x) : x)));
  return {
    'nb.rq.copy': (el) => { const rq = req(); if (rq) cur().ui.copy(rq.id, el); },
    'nb.rq.quote': () => { const rq = req(); if (rq) quoteModal(cur(), rq); },
    'nb.rq.accept': () => {
      const ctx = cur();
      const rq = req();
      if (!rq || rq.status !== 'quoted') return;
      patch(rq.id, (x) => ({ ...x, status: 'in_review', acceptedAt: new Date(nowMs()).toISOString() }));
      audit('number.request.accepted', { number: rqLabel(rq) }, rq.id);
      ctx.ui.toast(ctx.t('rd.accepted'), { kind: 'success', sub: rq.id });
    },
    'nb.rq.cancel': async () => {
      const ctx = cur();
      const { t } = ctx;
      const rq = req();
      if (!rq || !OPEN.includes(rq.status)) return;
      const sc = rq.type === 'short_code';
      const ok = await ctx.ui.confirm({
        title: t(sc ? 'rd.cancelQSc' : 'rd.cancelQ'), body: t('rd.cancelBody'), consequences: [t(sc ? 'rd.cancelC1Sc' : 'rd.cancelC1')],
        confirmLabel: t(sc ? 'rd.cancelSc' : 'rd.cancel'), cancelLabel: t('rd.keep'), danger: true,
      });
      if (!ok) return;
      patch(rq.id, (x) => ({ ...x, status: 'cancelled', cancelledAt: new Date(nowMs()).toISOString() }));
      audit('number.request.cancelled', { number: rqLabel(rq) }, rq.id);
      ctx.ui.toast(t('rd.cancelled'), { kind: 'info', sub: rq.id });
    },
  };
}

// ---------- LOA modal ----------
function loaModal(ctx, { onSent } = {}) {
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
        if (onSent) setTimeout(() => onSent(rec), 0);
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
  const keys = stepKeys(b);
  return h`<ol class="nm-steps" aria-label="${t('by.stepsAria')}">${keys.map((k, i) => {
    const n = i + 1;
    const st = n < b.step ? 'done' : n === b.step ? 'current' : 'todo';
    return h`<li class="nm-step is-${st}" ${raw(st === 'current' ? 'aria-current="step"' : '')}><span class="nm-circ">${st === 'done' ? icon('check', 'ico-xs') : n}</span><span class="nm-slbl">${t(`by.s.${k}`)}</span></li>`;
  })}</ol>
  <p class="nm-stepnow">${t('by.stepNow', { n: b.step, total: keys.length, name: t(`by.s.${keys[b.step - 1]}`) })}</p>`;
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

/** Step 1: the type cards. Landline, mobile, toll-free and 4-digit select a type; "Your existing number" opens the LOA form. */
function typeCards(ctx) {
  const { t, html: h, icon, fmt } = ctx;
  const b = ctx.state.buy;
  const how = (k) => (k === 'landline' ? t('by.1.how.landline', { price: fmt.int(PRICES.number) }) : t(`by.1.how.${k}`));
  return h`<div class="field"><span class="label" id="nm-kind-l">${t('by.1.typeLabel')}</span>
    <div class="nm-types" role="group" aria-labelledby="nm-kind-l">
      ${KINDS.map((k) => h`<button type="button" class="optcard nm-tcard" data-action="by.1.kind" data-value="${k}" aria-pressed="${b.kind === k}">
        <span class="nm-tcard-h">${icon(KIND_ICON[k], 'ico-sm')}<span class="t">${t(`by.1.t.${k}`)}</span></span>
        <span class="h">${formatLine(ctx, k)}</span><span class="h">${t(`by.1.h.${k}`)}</span><span class="h strong nm-tcard-how">${how(k)}</span></button>`)}
      <button type="button" class="optcard nm-tcard nm-tcard-ext" data-action="by.1.existing" aria-haspopup="dialog">
        <span class="nm-tcard-h">${icon(KIND_ICON.loa, 'ico-sm')}<span class="t">${t('by.1.t.existing')}</span></span>
        <span class="h">${t('by.1.f.existing')}</span><span class="h">${t('by.1.h.existing')}</span><span class="h strong nm-tcard-how">${t('by.1.how.existing')}${icon('arrow-up-right', 'ico-xs')}</span></button>
    </div>
    <p class="hint-xs nm-notoffered">${t('by.1.notOffered')}</p></div>`;
}

/** The cost panel of a request: by quote, nothing charged until the number is live. */
function rqCost(ctx) {
  const { t, html: h, fmt } = ctx;
  const k = ctx.state.buy.kind;
  const kv = (a, v) => h`<div class="kv"><span class="k">${a}</span><span class="v">${v}</span></div>`;
  return h`<aside class="card card-sunken card-pad nm-cost" aria-live="polite">
    <div class="row nm-cost-h"><strong>${t('by.cost.titleRq')}</strong><span class="chip chip-warn" tabindex="0" data-tip-key="common.plannedPricesTip">${t('common.plannedPrices')}</span></div>
    ${k === 'short_code' ? h`${kv(ctx.term(t('by.cost.nbtc'), 'nbtc'), t('by.cost.nbtcV'))}${kv(t('by.cost.service'), t('by.cost.byQuote'))}`
      : h`${kv(t('by.cost.monthlyRq'), t('by.cost.byQuote'))}${kv(t(k === 'toll_free' ? 'by.cost.minutesTf' : 'by.cost.minutesRq'), t('by.cost.byQuote'))}`}
    <div class="kv kv-total"><span class="k">${t('by.cost.todayRq')}</span><span class="v">${fmt.int(0)}</span></div>
    <p class="hint-xs strong">${t('by.cost.noFee')}</p>
    ${k === 'toll_free' ? h`<p class="hint-xs">${t('by.cost.tollFree')}</p>` : ''}
    <p class="hint-xs">${k === 'short_code' ? t('by.cost.quoteSc') : t('by.cost.quote', { days: QUOTE_DAYS })}</p>
  </aside>`;
}

function subSelect(ctx) {
  const { t, html: h } = ctx;
  const b = ctx.state.buy;
  const subs = ctx.list('subAccounts');
  return subs.length > 1 ? h`<label class="field grow"><span class="label">${ctx.term(t('by.1.sub'), 'subaccount')}</span><select class="select" data-field="buySub" data-action="by.1.sub" aria-label="${t('by.1.sub')}">${subs.map((x) => h`<option value="${x.id}" ${raw((b.sub || subs[0].id) === x.id ? 'selected' : '')}>${ctx.loc(x.name)}</option>`)}</select></label>` : '';
}

/** Step 1 of a request: what the type is, how it is bought, who pays, when it is live. */
function rqStep1(ctx) {
  const { t, html: h } = ctx;
  const k = ctx.state.buy.kind;
  const row = (label, value) => h`<div class="nm-info-r"><dt>${label}</dt><dd>${value}</dd></div>`;
  return h`<div class="nm-grid">
    <div class="stack-4">
      <dl class="card card-pad nm-info">
        ${row(t('by.1.i.format'), formatLine(ctx, k))}
        ${row(t('by.1.i.how'), t(`by.1.how2.${k}`))}
        ${row(t('by.1.i.use'), t(`by.1.use2.${k}`))}
        ${row(t('by.1.i.pays'), k === 'toll_free' ? h`<strong>${t('by.1.pays.owner')}</strong>` : t('by.1.pays.caller'))}
        ${row(t('by.1.i.when'), t(`by.1.when.${k}`, { days: QUOTE_DAYS }))}
      </dl>
      ${subSelect(ctx) ? h`<div class="row nm-qtyrow">${subSelect(ctx)}</div>` : ''}
    </div>
    ${rqCost(ctx)}</div>`;
}

function buyStep1(ctx) {
  return ctx.html`<div class="stack-4">${typeCards(ctx)}${ctx.state.buy.kind === 'landline' ? landlineStep1(ctx) : rqStep1(ctx)}</div>`;
}

function landlineStep1(ctx) {
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
      <p class="hint-xs strong">${t('by.cost.fromLive')}</p>
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

/** Step 2 of a request — what still blocks Next (null = ready). Mobile and toll-free only take optional digits. */
function detailsProblem(ctx) {
  const b = ctx.state.buy;
  if (b.kind !== 'short_code') return null;
  const filled = b.choices.filter((c) => c);
  if (filled.some((c) => !SC_RE.test(c))) return ctx.t('by.2.fixChoice');
  return filled.length ? null : ctx.t('by.2.needChoice');
}
/** Typing in step 2 updates Next and its helper in place (no re-render while typing). */
function syncDetails(root, ctx) {
  const p = detailsProblem(ctx);
  const help = root.querySelector('[data-nm-nexthelp]');
  if (help) { help.textContent = p || ''; help.hidden = !p; }
  const next = root.querySelector('[data-action="by.next"]');
  if (next) { if (p) next.setAttribute('aria-disabled', 'true'); else next.removeAttribute('aria-disabled'); }
}

function rqStep2(ctx) {
  const { t, html: h, icon } = ctx;
  const b = ctx.state.buy;
  const k = b.kind;
  if (k === 'short_code') {
    return h`<div class="nm-grid">
      <div class="stack-4"><fieldset class="nm-fs"><legend class="label">${t('by.2.choices', { n: SC_CHOICES })}</legend>
        <div class="nm-choices">${b.choices.map((c, i) => {
          const bad = b.choiceLeft[i] && c && !SC_RE.test(c);
          return h`<label class="field"><span class="hint-xs">${t('by.2.choice', { n: i + 1 })}${i === 0 ? '' : h` · ${t('by.2.optional')}`}</span>
            <input class="input mono" id="nm-sc-${i}" data-field="scChoice" data-idx="${i}" value="${c}" inputmode="numeric" maxlength="4" placeholder="1xxx" autocomplete="off" spellcheck="false" translate="no" aria-invalid="${bad ? 'true' : 'false'}" ${raw(bad ? `aria-describedby="nm-sc-e${i}"` : '')}>
            ${bad ? h`<span class="field-err" id="nm-sc-e${i}">${t('by.2.choiceErr')}</span>` : ''}</label>`;
        })}</div>
        <span class="hint-xs">${t('by.2.choiceHint')}</span><span class="hint-xs">${t('by.2.maskNote')}</span></fieldset>
        <div class="note note-info">${icon('info')}<span>${t('by.2.scNote')}</span></div></div>
      ${rqCost(ctx)}</div>`;
  }
  const qty = k === 'mobile'
    ? h`<div class="seg nm-qtyseg" role="group" aria-label="${t('by.2.qty')}">${MOBILE_QTY.map((n) => h`<button type="button" data-action="by.2.mqty" data-value="${n}" aria-pressed="${b.rqQty === n}">${n}</button>`)}</div>`
    : h`<div class="stepper"><button type="button" data-action="by.2.tqty" data-value="-1" aria-label="${t('by.1.less')}" ${raw(b.rqQty <= 1 ? 'aria-disabled="true"' : '')}>${icon('minus', 'ico-sm')}</button>
        <output aria-live="polite" aria-label="${t('by.2.qty')}">${b.rqQty}</output>
        <button type="button" data-action="by.2.tqty" data-value="1" aria-label="${t('by.1.more')}" ${raw(b.rqQty >= TOLL_FREE_MAX ? 'aria-disabled="true"' : '')}>${icon('plus', 'ico-sm')}</button></div>`;
  return h`<div class="nm-grid">
    <div class="stack-4">
      <div class="field"><span class="label">${t('by.2.qty')}</span>${qty}${k === 'toll_free' ? h`<span class="hint-xs">${t('by.2.qtyMax', { n: TOLL_FREE_MAX })}</span>` : ''}</div>
      <label class="field"><span class="label">${t(`by.2.pref.${k}`)}</span>
        <span class="nm-pref"><span class="mono nm-pref-x" translate="no">${k === 'toll_free' ? '1800-xxx-' : '0xx-xxx-'}</span><input class="input mono" data-field="rqPref" value="${b.pref}" inputmode="numeric" maxlength="${PREF_MAX[k]}" placeholder="${'x'.repeat(PREF_MAX[k])}" autocomplete="off" spellcheck="false" translate="no" aria-describedby="nm-pref-h"></span>
        <span class="hint-xs" id="nm-pref-h">${t(`by.2.prefHint.${k}`, { n: PREF_MAX[k] })}</span></label>
      ${k === 'mobile' ? h`<div class="note note-info">${icon('info')}<span>${t('by.2.mobileNote')}</span></div>` : ''}
    </div>
    ${rqCost(ctx)}</div>`;
}

function docRow(ctx, key, i, { skip = false, extra = '' } = {}) {
  const { t, html: h, icon, fmt } = ctx;
  const doc = skip ? null : ctx.state.buy.docs[key];
  const st = skip ? 'skip' : doc ? doc.state : 'empty';
  const checks = doc && doc.checks ? doc.checks : [];
  return h`<li class="nm-doc is-${st}" data-nm-doc="${key}">
    <div class="nm-doc-h"><span class="nm-doc-ico">${st === 'ok' ? icon('check', 'ico-sm') : st === 'bad' ? icon('x', 'ico-sm') : st === 'skip' ? icon('minus', 'ico-sm') : icon('file-text', 'ico-sm')}</span>
      <div class="grow"><strong>${t(`docs.${key}`)}</strong><div class="hint-xs">${t(`docs.${key}H`)}</div></div>
      ${st === 'skip' ? h`<span class="chip">${t('docs.poaNotNeeded')}</span>` : st === 'empty' || st === 'bad' ? h`<div class="row nm-doc-a"><button type="button" class="btn btn-sm" data-action="by.3.upload" data-value="${key}">${icon('file', 'ico-sm')}${t('docs.sample')}</button>
        <label class="btn btn-sm btn-ghost nm-filebtn">${icon('upload', 'ico-sm')}${t('docs.choose')}<input type="file" class="sr-only" data-field="file" data-doc="${key}" accept=".pdf,.jpg,.jpeg,.png" aria-label="${t('docs.chooseFor', { doc: t(`docs.${key}`) })}"></label></div>`
        : st === 'ok' ? h`<button type="button" class="btn btn-sm btn-ghost" data-action="by.3.remove" data-value="${key}">${t('docs.remove')}</button>` : ''}</div>
    ${doc ? h`<div class="nm-doc-b"><span class="mono hint-xs nm-fname" translate="no">${doc.name} · ${fmt.num(Math.max(1, Math.round(doc.size / 1024)), 0)} KB</span>
      ${st === 'upload' ? h`<span class="progress nm-prog" role="progressbar" aria-label="${t('docs.reading')}"><i class="nm-prog-i"></i></span><span class="hint-xs">${t('docs.reading')}</span>` : ''}
      ${checks.length ? h`<ul class="nm-checks">${checks.map((c) => h`<li class="is-${c.ok == null ? 'run' : c.ok ? 'ok' : 'bad'}">${c.ok == null ? raw('<span class="spin" aria-hidden="true"></span>') : icon(c.ok ? 'check' : 'x', 'ico-xs')}<span>${t(`docs.chk.${c.k}`)}</span></li>`)}</ul>` : ''}
      ${st === 'ok' ? h`<span class="hint-xs ok-text">${t('docs.attached')}</span>` : ''}
      ${st === 'bad' ? h`<span class="hint-xs err-text">${t(`docs.bad.${doc.bad}`)}</span>` : ''}</div>` : ''}
    ${extra}
  </li>`;
}

/** The use declared for the new number: the user's answers, or the declaration on file until they change it. */
function useOf(ctx) {
  const b = ctx.state.buy;
  // The declaration on file is for the landline numbers (OTP and alerts): a request declares its own use.
  if (b.use.touched || !ctx.store.get('org.kycApproved') || b.kind !== 'landline') return { ...b.use, prefilled: false };
  return { purpose: USE_ON_FILE.purpose, who: ctx.t('docs.use.whoOnFile'), perDay: USE_ON_FILE.perDay, prefilled: true };
}
const useComplete = (u) => !!u.purpose && !!String(u.who || '').trim() && Number(u.perDay) > 0;

/** Checklist item 4: how the number will be used (purpose · who is called · calls a day). */
function useRow(ctx) {
  const { t, html: h, icon, fmt } = ctx;
  const u = useOf(ctx);
  const ok = useComplete(u);
  const k = ctx.state.buy.kind;
  const inbound = k === 'toll_free' || k === 'short_code';
  const month = k === 'short_code';
  return h`<li class="nm-doc nm-use is-${ok ? 'ok' : 'empty'}" data-nm-doc="use">
    <div class="nm-doc-h"><span class="nm-doc-ico">${icon(ok ? 'check' : 'edit', 'ico-sm')}</span>
      <div class="grow"><strong>${t(month ? 'docs.usePlan' : 'docs.use')}</strong><div class="hint-xs">${t(k === 'mobile' ? 'docs.useH.mobile' : inbound ? 'docs.useH.inbound' : 'docs.useH')}</div></div></div>
    <div class="nm-use-f">
      <label class="field"><span class="label">${t('docs.use.purpose')}</span><select class="select" data-field="usePurpose" data-action="by.3.purpose">
        <option value="" ${raw(u.purpose ? '' : 'selected')}>${t('docs.use.pick')}</option>${PURPOSES[k].map((p) => h`<option value="${p}" ${raw(u.purpose === p ? 'selected' : '')}>${t(`docs.use.p.${p}`)}</option>`)}</select></label>
      <label class="field"><span class="label">${t(inbound ? 'docs.use.whoIn' : 'docs.use.who')}</span><input class="input" data-field="useWho" data-action="by.3.who" value="${u.who}" placeholder="${t(inbound ? 'docs.use.whoInPh' : 'docs.use.whoPh')}" autocomplete="off"></label>
      <label class="field"><span class="label">${t(month ? 'docs.use.perMonth' : 'docs.use.perDay')}</span><input class="input tnum" type="number" min="1" step="1" inputmode="numeric" data-field="usePerDay" data-action="by.3.perday" value="${u.perDay}" placeholder="${t('docs.use.perDayPh', { n: fmt.int(month ? 5000 : 200) })}"></label>
    </div>
    ${u.prefilled ? h`<span class="hint-xs nm-use-note">${t('docs.use.onFile')}</span>` : ''}
  </li>`;
}

/** Checklist item 5: power of attorney, needed only when the signer is not a director. */
function poaRow(ctx, usingFile) {
  const { t, html: h, icon } = ctx;
  const b = ctx.state.buy;
  if (usingFile) return h`<li class="nm-doc is-ok" data-nm-doc="poa"><div class="nm-doc-h"><span class="nm-doc-ico">${icon('check', 'ico-sm')}</span><div class="grow"><strong>${t('docs.poa')}</strong><div class="hint-xs">${t('docs.poaOnFile')}</div></div></div></li>`;
  const box = h`<label class="check nm-poa-dir"><input type="checkbox" data-field="signerIsDirector" data-action="by.3.director" ${raw(b.signerIsDirector ? 'checked' : '')}>${t('docs.poaDirector')}</label>`;
  return docRow(ctx, 'poa', 4, { skip: b.signerIsDirector, extra: box });
}

function buyStep3(ctx) {
  const { t, html: h, icon, fmt } = ctx;
  const b = ctx.state.buy;
  const kyc = ctx.store.get('org.kycApproved');
  const usingFile = kyc && b.onFile;
  const missing = missingDocs(ctx);
  // A request adds its own document(s) — needed even when the company documents are on file.
  const extra = EXTRA_DOCS[b.kind].map((k, i) => docRow(ctx, k, DOCS.length + i));
  const timing = b.kind === 'short_code' ? t('docs.timingSc') : isRequest(b.kind) ? t('docs.timingRq') : t('docs.timing');
  return h`<div class="nm-grid">
    <div class="stack-4">
      ${kyc ? h`<label class="optcard nm-onfile"><span class="row-tight"><input type="checkbox" data-field="onFile" data-action="by.3.onfile" ${raw(b.onFile ? 'checked' : '')}><span class="t">${t('docs.onFile', { date: fmt.dateProse(kyc) })}</span></span><span class="h">${t('docs.onFileH')}</span></label>` : ''}
      ${usingFile ? h`${extra.length ? h`<div class="note note-warn">${icon('shield')}<span>${t('docs.warn')}</span></div>` : ''}<ol class="nm-doclist">${DOCS.map((k) => h`<li class="nm-doc is-ok" data-nm-doc="${k}"><div class="nm-doc-h"><span class="nm-doc-ico">${icon('check', 'ico-sm')}</span><div class="grow"><strong>${t(`docs.${k}`)}</strong><div class="hint-xs">${t('docs.approved', { date: fmt.dayMonth(kyc) })}</div></div></div></li>`)}${extra}${useRow(ctx)}${poaRow(ctx, true)}</ol>`
        : h`<div class="note note-warn">${icon('shield')}<span>${t('docs.warn')}</span></div>
          <ol class="nm-doclist">${DOCS.map((k, i) => docRow(ctx, k, i))}${extra}${useRow(ctx)}${poaRow(ctx, false)}</ol>
          <label class="field"><span class="label">${t('docs.addr')}</span><textarea class="textarea" rows="2" data-field="address" data-action="by.3.addr" placeholder="${t('docs.addrPh')}">${b.address}</textarea></label>
          <label class="field"><span class="label">${t('docs.signer')}</span><input class="input" data-field="signer" data-action="by.3.signer" value="${b.signer}" placeholder="${t('docs.signerPh')}" autocomplete="off"></label>
          <label class="check nm-consent"><input type="checkbox" data-field="consent" data-action="by.3.consent" ${raw(b.consent ? 'checked' : '')}>${t('docs.consent')}</label>`}
    </div>
    <aside class="card card-sunken card-pad stack nm-kycside">
      <strong>${ctx.term(t('docs.whyTitle'), 'kyc')}</strong><p class="hint-xs">${t('docs.why')}</p>
      <p class="hint-xs">${timing}</p>
      <a class="linkbtn hint-xs" href="#/help/article/thai-number-kyc" data-action="by.3.help">${icon('book', 'ico-xs')}${t('docs.help')}</a>
      <p class="hint-xs ${missing.length ? 'warn-text' : 'ok-text'}" id="nm-next-h" data-nm-missing>${missing.length ? t('docs.missing', { list: missing.join(' · ') }) : t('docs.complete')}</p>
    </aside></div>`;
}

function missingDocs(ctx) {
  const { t } = ctx;
  const b = ctx.state.buy;
  const usingFile = !!(ctx.store.get('org.kycApproved') && b.onFile);
  const attached = (k) => b.docs[k] && b.docs[k].state === 'ok';
  const out = usingFile ? [] : DOCS.filter((k) => !attached(k)).map((k) => t(`docs.${k}Short`));
  out.push(...EXTRA_DOCS[b.kind].filter((k) => !attached(k)).map((k) => t(`docs.${k}Short`)));
  const u = useOf(ctx);
  const inbound = b.kind === 'toll_free' || b.kind === 'short_code';
  if (!u.purpose || !PURPOSES[b.kind].includes(u.purpose)) out.push(t('docs.use.purposeShort'));
  if (!String(u.who || '').trim()) out.push(t(inbound ? 'docs.use.whoInShort' : 'docs.use.whoShort'));
  if (!(Number(u.perDay) > 0)) out.push(t(b.kind === 'short_code' ? 'docs.use.perMonthShort' : 'docs.use.perDayShort'));
  if (usingFile) return out;
  if (!b.signerIsDirector && !(b.docs.poa && b.docs.poa.state === 'ok')) out.push(t('docs.poaShort'));
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
  const use = root.querySelector('[data-nm-doc="use"]');
  if (use) { const ok = useComplete(useOf(ctx)); use.classList.toggle('is-ok', ok); use.classList.toggle('is-empty', !ok); }
}

/**
 * What an order costs. Nothing is charged when the order is placed or while the documents are checked: the fee
 * starts the day the number goes live, prorated for the rest of that month, then the full fee on the 1st
 * (prices.js numberFeeInMonth · SRS-NUM-06). Prepaid: from the balance; postpaid: on that month's invoice.
 */
function orderMath(ctx) {
  const b = ctx.state.buy;
  const price = unitPrice(ctx, b.qty);
  return { price, monthly: price * b.qty, live: ctx.store.get('env') === 'live', postpaid: isPostpaid() };
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
        <div class="card-body stack"><p class="hint">${kyc && b.onFile ? t('rev.docsOnFile', { date: fmt.dateProse(kyc) }) : t('rev.docsNew', { n: fmt.int(DOCS.length + (b.signerIsDirector ? 0 : 1)), signer: b.signer || '—' })}</p>
          ${(() => { const u = useOf(ctx); return h`<p class="hint" data-nm-rev-use>${t('rev.use', { purpose: u.purpose ? t(`docs.use.p.${u.purpose}`) : '—', who: String(u.who || '').trim() || '—', n: fmt.int(Number(u.perDay) || 0) })}</p>`; })()}</div></section>
      ${b.expired ? h`<div class="note note-err" role="alert">${icon('clock')}<div class="grow">${t('rev.expired')}</div><button type="button" class="btn btn-sm" data-action="by.2.again">${t('by.2.again')}</button></div>` : ''}
    </div>
    <aside class="card card-pad stack nm-pay" aria-labelledby="nm-pay-h">
      <div class="row nm-cost-h"><strong id="nm-pay-h">${t('rev.costTitle')}</strong><span class="chip chip-warn" tabindex="0" data-tip-key="common.plannedPricesTip">${t('common.plannedPrices')}</span></div>
      <div class="kv"><span class="k">${t('rev.monthly', { n: b.qty, price: fmt.int(m.price) })}</span><span class="v">${fmt.int(m.monthly)}</span></div>
      <div class="kv kv-total"><span class="k">${t('rev.today')}</span><span class="v" data-nm-today>${fmt.int(0)}</span></div>
      <p class="hint-xs strong">${t('rev.noFeeReview')}</p>
      <p class="hint-xs">${!m.live ? t('rev.sandbox', { price: fmt.int(m.monthly) }) : m.postpaid ? t('rev.feeStartsPostpaid', { price: fmt.int(m.monthly) }) : t('rev.feeStarts', { price: fmt.int(m.monthly) })}</p>
      <button type="button" class="btn btn-primary btn-lg btn-block nm-order" data-action="by.4.order" ${raw(b.ordering ? 'aria-busy="true"' : b.expired ? 'aria-disabled="true" aria-describedby="nm-order-h"' : '')}>${b.ordering ? raw('<span class="spin" aria-hidden="true"></span>') : icon('check')}${t('rev.order', { price: fmt.int(m.monthly) })}</button>
      <span class="hint-xs" id="nm-order-h">${b.expired ? t('rev.expired') : !m.live ? t('rev.orderHintSandbox') : m.postpaid ? t('rev.orderHintPostpaid') : t('rev.orderHint')}</span>
    </aside></div>`;
}

function buyStep5(ctx) {
  const { t, html: h, icon } = ctx;
  const b = ctx.state.buy;
  const nums = ctx.list('numbers').filter((n) => b.ordered.includes(n.id));
  const ret = ctx.params.query.return === 'connect';
  return h`<div class="nm-done" role="status">
    <span class="nm-done-ico"><svg class="ico ico-xl check-draw" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></span>
    <h2>${t('done.title', { count: nums.length, n: nums.length })}</h2>
    <div class="row nm-done-nums">${nums.map((n) => h`<span class="chip chip-navy mono" translate="no">${n.number}</span>`)}<span class="chip chip-warn">${t('st.review')}</span></div>
    <p class="hint">${t('done.body')}</p>
    <ol class="nm-next"><li>${t('done.n1')}</li><li>${t('done.n2')}</li><li>${sandbox(ctx) ? t('done.n3Sandbox') : t('done.n3')}</li></ol>
    <div class="row nm-done-a">
      <a class="btn btn-primary" href="#/numbers?n=${nums[0] ? nums[0].id : ''}" data-action="by.5.route">${icon('route')}${t('done.route')}</a>
      ${ret ? h`<a class="btn btn-navy" href="#/connect/sip" data-action="by.5.connect">${icon('server')}${t('done.connect')}</a>` : ''}
      <a class="btn" href="#/numbers" data-action="by.5.back">${t('done.back')}</a>
      <button type="button" class="btn btn-ghost" data-action="by.5.another">${icon('plus')}${t('done.another')}</button></div></div>`;
}

/** Step 4 of a request: what is asked for, the documents, and "By quote" next to the Send button. */
function rqStep4(ctx) {
  const { t, html: h, icon, fmt } = ctx;
  const b = ctx.state.buy;
  const k = b.kind;
  const sc = k === 'short_code';
  const kyc = ctx.store.get('org.kycApproved');
  const subId = b.sub || (ctx.list('subAccounts')[0] || {}).id;
  const kv = (a, v) => h`<div class="kv"><span class="k">${a}</span><span class="v">${v}</span></div>`;
  const choices = b.choices.filter((c) => SC_RE.test(c));
  const u = useOf(ctx);
  const use = { purpose: u.purpose ? t(`docs.use.p.${u.purpose}`) : '—', who: String(u.who || '').trim() || '—', n: fmt.int(Number(u.perDay) || 0) };
  return h`<div class="nm-grid">
    <div class="stack-4">
      <section class="card nm-rev"><div class="card-head"><h3>${t('rev.request')}</h3><button type="button" class="linkbtn" data-action="by.4.edit" data-value="2">${t('rev.edit')}</button></div>
        <div class="card-body stack">
          ${kv(t('rev.type'), badge(ctx, k))}
          ${kv(t('rd.format'), formatLine(ctx, k))}
          ${sc ? kv(t('rd.choices'), h`<span class="mono" translate="no">${choices.join(' · ')}</span>`) : h`${kv(t('rd.qty'), fmt.int(b.rqQty))}${kv(t('rd.pref'), b.pref ? t('rd.prefEnds', { digits: b.pref }) : t('rd.prefNone'))}`}
          ${subId ? kv(t('by.1.sub'), ctx.ui.describe.sub(subId)) : ''}</div></section>
      <section class="card nm-rev"><div class="card-head"><h3>${ctx.term(t('rev.docs'), 'kyc')}</h3><button type="button" class="linkbtn" data-action="by.4.edit" data-value="3">${t('rev.edit')}</button></div>
        <div class="card-body stack"><p class="hint">${kyc && b.onFile ? t('rev.docsOnFile', { date: fmt.dateProse(kyc) }) : t('rev.docsNew', { n: fmt.int(DOCS.length + (b.signerIsDirector ? 0 : 1)), signer: b.signer || '—' })}</p>
          <p class="hint">${t('rev.docsExtra', { list: EXTRA_DOCS[k].map((d) => t(`docs.${d}Short`)).join(' · ') })}</p>
          <p class="hint">${sc ? t('rev.useMonth', use) : t('rev.use', use)}</p></div></section>
    </div>
    <aside class="card card-pad stack nm-pay" aria-labelledby="nm-pay-h">
      <div class="row nm-cost-h"><strong id="nm-pay-h">${t('rev.costTitle')}</strong><span class="chip chip-warn" tabindex="0" data-tip-key="common.plannedPricesTip">${t('common.plannedPrices')}</span></div>
      ${sc ? h`${kv(ctx.term(t('by.cost.nbtc'), 'nbtc'), t('by.cost.nbtcV'))}${kv(t('by.cost.service'), t('by.cost.byQuote'))}`
        : h`${kv(t('by.cost.monthlyRq'), t('by.cost.byQuote'))}${kv(t(k === 'toll_free' ? 'by.cost.minutesTf' : 'by.cost.minutesRq'), t('by.cost.byQuote'))}`}
      <div class="kv kv-total"><span class="k">${t('rev.today')}</span><span class="v" data-nm-today>${fmt.int(0)}</span></div>
      <p class="hint-xs strong">${t('by.cost.noFee')}</p>
      ${k === 'toll_free' ? h`<p class="hint-xs">${t('by.cost.tollFree')}</p>` : ''}
      <button type="button" class="btn btn-primary btn-lg btn-block nm-order" data-action="by.4.send" aria-describedby="nm-order-h" ${raw(b.ordering ? 'aria-busy="true"' : '')}>${b.ordering ? raw('<span class="spin" aria-hidden="true"></span>') : icon('send')}${t('rev.send')}</button>
      <span class="hint-xs" id="nm-order-h">${sc ? t('rev.sendHintSc') : t('rev.sendHint', { days: QUOTE_DAYS })}</span>
    </aside></div>`;
}

/** Step 5 of a request: sent, its status and what happens next. */
function rqStep5(ctx) {
  const { t, html: h, icon } = ctx;
  const b = ctx.state.buy;
  const rq = ctx.list('numberRequests').find((x) => x.id === b.ordered[0]);
  if (!rq) return h`<div class="nm-done" role="status"><a class="btn" href="#/numbers" data-action="by.5.back">${t('done.back')}</a></div>`;
  const sc = rq.type === 'short_code';
  const next = sc ? ['done.sc.n1', 'done.sc.n2', 'done.sc.n3'] : ['done.rq.n1', 'done.rq.n2', rq.type === 'toll_free' ? 'done.rq.n3tf' : 'done.rq.n3'];
  return h`<div class="nm-done" role="status">
    <span class="nm-done-ico"><svg class="ico ico-xl check-draw" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></span>
    <h2>${t(sc ? 'done.scTitle' : 'done.rqTitle')}</h2>
    <div class="row nm-done-nums">${unassigned(rq) ? '' : h`<span class="chip chip-navy mono" translate="no">${rqLabel(rq)}</span>`}${badge(ctx, rq.type)}${rqChip(ctx, rq)}</div>
    ${unassigned(rq) ? h`<p class="hint strong">${t('done.rqAssigned', { count: rq.quantity || 1, n: rq.quantity || 1 })}</p>` : ''}
    <p class="hint">${t('done.rqBody')}</p>
    <ol class="nm-next">${next.map((k) => h`<li>${t(k, { days: QUOTE_DAYS })}</li>`)}</ol>
    <div class="row nm-done-a">
      <a class="btn btn-primary" href="#/numbers?r=${rq.id}" data-action="by.5.view">${icon('list')}${t('done.rqView')}</a>
      <a class="btn" href="#/numbers" data-action="by.5.back">${t('done.back')}</a>
      <button type="button" class="btn btn-ghost" data-action="by.5.another">${icon('plus')}${t('done.rqAnother')}</button></div></div>`;
}

function docsView(ctx) {
  const { t, html: h, icon, fmt } = ctx;
  const kyc = ctx.store.get('org.kycApproved');
  return h`<div class="page nm">
    <div class="page-head"><div class="titles"><h1>${t('dv.title')}${ctx.pageHelp()}</h1><span class="sub">${t('dv.sub')}</span></div>
      <div class="tools"><a class="btn" href="#/numbers" data-action="by.docs.back">${icon('arrow-left', 'ico-sm')}${t('dv.back')}</a></div></div>
    <div class="card">${kyc ? h`<ul class="nm-doclist nm-dv">${DOCS.map((k) => h`<li class="nm-doc is-ok"><div class="nm-doc-h"><span class="nm-doc-ico">${icon('check', 'ico-sm')}</span>
        <div class="grow"><strong>${t(`docs.${k}`)}</strong><div class="hint-xs">${t('docs.approved', { date: fmt.dayMonth(kyc) })}</div></div><span class="chip chip-ok">${t('dv.approved')}</span></div></li>`)}
        <li class="nm-doc is-ok"><div class="nm-doc-h"><span class="nm-doc-ico">${icon('check', 'ico-sm')}</span><div class="grow"><strong>${t('docs.use')}</strong><div class="hint-xs">${t('rev.use', { purpose: t(`docs.use.p.${USE_ON_FILE.purpose}`), who: t('docs.use.whoOnFile'), n: fmt.int(Number(USE_ON_FILE.perDay)) })}</div></div><span class="chip chip-ok">${t('dv.approved')}</span></div></li>
        <li class="nm-doc is-ok"><div class="nm-doc-h"><span class="nm-doc-ico">${icon('check', 'ico-sm')}</span><div class="grow"><strong>${t('docs.poa')}</strong><div class="hint-xs">${t('docs.poaOnFile')}</div></div></div></li></ul>
        <div class="card-foot hint-xs">${t('dv.note')}</div>`
      : h`<div class="empty empty-center"><strong>${t('dv.none')}</strong><span class="hint">${t('dv.noneHint')}</span><a class="btn btn-sm btn-navy" href="#/numbers/buy" data-action="by.docs.buy">${t('empty.get')}</a></div>`}</div></div>`;
}

function buyPage(ctx) {
  const { t, html: h, icon } = ctx;
  if (ctx.params.query.view === '1') return docsView(ctx);
  const b = ctx.state.buy;
  const rq = isRequest(b.kind);
  const body = rq ? [null, buyStep1, rqStep2, buyStep3, rqStep4, rqStep5][b.step](ctx) : [null, buyStep1, buyStep2, buyStep3, buyStep4, buyStep5][b.step](ctx);
  const missing = b.step === 3 ? missingDocs(ctx) : [];
  const problem = b.step === 2 && rq ? detailsProblem(ctx) : null;
  const canNext = b.step === 1 || (b.step === 2 && (rq ? !problem : b.reservedAt && !b.expired)) || (b.step === 3 && !missing.length);
  const nextHelp = b.step === 2 ? (rq ? problem || '' : b.expired ? t('by.2.expired') : t('by.nextNeedsResv')) : t('docs.missing', { list: missing.join(' · ') });
  const head = rq && b.step >= 4 ? (b.step === 4 ? 'reviewRq' : b.kind === 'short_code' ? 'doneSc' : 'doneRq') : stepKeys(b)[b.step - 1];
  return h`<div class="page nm">
    <div class="page-head"><div class="titles"><h1>${t('by.title')}${ctx.pageHelp()}</h1><span class="sub">${t('by.sub')}</span></div>
      <div class="tools">${b.step < 5 ? h`<button type="button" class="btn btn-ghost" data-action="by.cancel">${t('common.cancel')}</button>` : ''}</div></div>
    ${sandbox(ctx) && b.step < 5 ? h`<div class="note note-info">${icon('info')}<span>${t(rq ? 'by.sandboxRq' : 'by.sandbox')}</span></div>` : ''}
    <section class="card nm-buy" aria-labelledby="nm-buy-h">
      <div class="nm-stepsbar">${steps(ctx)}</div>
      <div class="card-head"><h2 id="nm-buy-h">${t(`by.h.${head}`)}</h2>${(b.step === 2 || b.step === 3) && !rq ? resvChip(ctx) : ''}</div>
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
    const recs = bb.reserved.map((num) => ({ id: newId('num'), number: num, e164: e164(num), type: bb.group === '02' ? 'local' : 'regional', area: bb.area, sub: subId, routing: null, callerIdFor: null, status: 'in-review', orderedAt: at, monthly: m.price }));
    ctx.store.set('numbers', [...ctx.list('numbers'), ...recs]);
    recs.forEach((r) => { audit('number.ordered', { number: r.number, monthly: r.monthly }, r.id); notify('numberOrdered', { vars: { number: r.number }, href: `numbers?n=${r.id}` }); });
    setStep('number', 'progress');
    bb.ordered = recs.map((r) => r.id);
    bb.ordering = false;
    bb.step = 5;
    ctx.ui.toast(t('toast.T13', { num: recs.map((r) => r.number).join(', ') }), { kind: 'success' });
    redraw(ctx, onBuy);
  }, 800);
}

/**
 * Send a request (POST …/number-requests { type, quantity, preferred[], use, documentIds[] } → 201 { id, status }).
 * Nothing is spent: by quote, no fee until the number is active (prices.js numberFeeInMonth never counts a request).
 * 4-digit choices are masked once sent, like every number in the demo.
 */
function sendRequest(ctx) {
  const { t } = ctx;
  const b = ctx.state.buy;
  if (b.ordering) return;
  b.ordering = true;
  ctx.rerender();
  soon(ctx, (s) => {
    const bb = s.buy;
    const kind = bb.kind;
    const sc = kind === 'short_code';
    const u = useOf(ctx);
    const at = new Date(nowMs()).toISOString();
    const rec = {
      id: newId('nrq'), type: kind, quantity: sc ? 1 : bb.rqQty,
      preferred: sc ? bb.choices.filter((c) => SC_RE.test(c)).map(maskShort) : (bb.pref ? [bb.pref] : []),
      number: null, sub: bb.sub || (ctx.list('subAccounts')[0] || {}).id || null, status: sc ? 'preparing' : 'requested', requestedAt: at,
      use: { purpose: u.purpose, who: String(u.who || '').trim(), ...(sc ? { perMonth: u.perDay } : { perDay: u.perDay }) },
      docs: EXTRA_DOCS[kind].slice(),
    };
    ctx.store.push('numberRequests', rec);
    audit('number.request.sent', { number: rqLabel(rec) }, rec.id);
    bb.ordered = [rec.id];
    bb.ordering = false;
    bb.step = 5;
    ctx.ui.toast(t(sc ? 'toast.scSent' : 'toast.rqSent'), { kind: 'success', sub: rec.id });
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
    'by.3.purpose': noop,
    'by.3.who': noop,
    'by.3.perday': noop,
    'by.3.director': noop,
    'by.3.help': noop,
    'nb.rq.row': noop, // link to ?r= (the request drawer)
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
      const rq = isRequest(s.kind);
      if (s.step === 1) { s.step = 2; if (!rq && !s.results) { search(ctx); return; } }
      else if (s.step === 2 && (rq ? !detailsProblem(ctx) : s.reservedAt && !s.expired)) s.step = 3;
      else if (s.step === 3 && !missingDocs(ctx).length) s.step = 4;
      ctx.rerender();
      const card = root.querySelector('.nm-buy');
      if (card && card.getBoundingClientRect().top < 0) card.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
    },
    // Step 1 — the type. Changing it starts the use declaration again and releases a landline reservation.
    'by.1.kind': (el) => {
      const s = ctx.state.buy;
      const k = el.dataset.value;
      if (s.kind === k || !KINDS.includes(k)) return;
      const held = s.reservedAt && !s.expired;
      s.kind = k;
      s.rqQty = 1;
      s.pref = s.pref.slice(0, PREF_MAX[k] || 4);
      s.use = { purpose: '', who: '', perDay: '', touched: false };
      if (held) { s.reservedAt = 0; s.reserved = []; s.picked = []; s.expired = false; }
      ctx.rerender();
      if (held) ctx.ui.toast(t('by.2.released'), { kind: 'info' });
    },
    'by.1.existing': () => loaModal(ctx, { onSent: () => { ctx.state.buy = { ...freshBuy(), run: ctx.state.buy.run + 1 }; ctx.go('numbers'); } }),
    // Step 2 of a request
    'by.2.mqty': (el) => { const s = ctx.state.buy; const n = Number(el.dataset.value); if (MOBILE_QTY.includes(n) && n !== s.rqQty) { s.rqQty = n; ctx.rerender(); } },
    'by.2.tqty': (el) => { const s = ctx.state.buy; const q = Math.max(1, Math.min(TOLL_FREE_MAX, s.rqQty + Number(el.dataset.value))); if (q !== s.rqQty) { s.rqQty = q; ctx.rerender(); } },
    'by.4.send': () => sendRequest(ctx),
    'by.5.view': () => { ctx.state.buy = { ...freshBuy(), run: ctx.state.buy.run + 1 }; },
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
      const [name, size] = SAMPLE_FILES[key];
      attach(ctx, key, { name, size });
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
    signerIsDirector: (v) => { ctx.state.buy.signerIsDirector = !!v; ctx.rerender(); },
    // How the number is used: typing updates "Still needed" in place; a committed change (select, blur) redraws the item.
    usePurpose: (v) => setUse(ctx, 'purpose', v, true),
    useWho: (v, el, ev) => setUse(ctx, 'who', v, ev && ev.type === 'change'),
    usePerDay: (v, el, ev) => setUse(ctx, 'perDay', String(v).replace(/[^\d]/g, ''), ev && ev.type === 'change'),
    file: (v, el) => pickFile(el),
    // Request details: digits only; typing updates Next in place, leaving a 4-digit field shows its error.
    rqPref: (v, el) => {
      const clean = String(v).replace(/\D/g, '').slice(0, PREF_MAX[ctx.state.buy.kind] || 4);
      if (clean !== v) el.value = clean;
      ctx.state.buy.pref = clean;
    },
    scChoice: (v, el) => {
      const s = ctx.state.buy;
      const i = Number(el.dataset.idx);
      if (!(i >= 0 && i < SC_CHOICES)) return;
      const clean = String(v).replace(/\D/g, '').slice(0, 4);
      if (clean !== v) el.value = clean;
      s.choices = s.choices.map((c, j) => (j === i ? clean : c));
      syncDetails(root, ctx);
      if (!clean || SC_RE.test(clean)) { // fixed: the error goes as soon as the value is right
        const err = root.querySelector(`#nm-sc-e${i}`);
        if (err) err.remove();
        el.setAttribute('aria-invalid', 'false');
        el.removeAttribute('aria-describedby');
      }
    },
  });
  function setUse(c, field, v, redrawNow) {
    const s = c.state.buy;
    const u = useOf(c);
    s.use = { purpose: u.purpose, who: u.who, perDay: u.perDay, touched: true, [field]: v };
    if (redrawNow) c.rerender(); else syncMissing(root, c);
  }
  // A chosen file: its real name and size go through the same checks as the sample (name and size only, nothing is read).
  // Browsers fire "input" and "change" for a file picker; both paths land here once per file.
  function pickFile(el) {
    const f = el.files && el.files[0];
    if (!f || el.__picked === f) return;
    el.__picked = f;
    attach(ctx, el.dataset.doc, { name: f.name, size: f.size });
  }
  ctx.on(root, 'change', 'input[type="file"][data-field="file"]', (ev, el) => pickFile(el));
  // Leaving a 4-digit field shows its error (like Connect's name fields): re-render only when the error appears or
  // goes, keep focus on the field the user moved to; a re-render during a press waits for the click (press.js).
  ctx.on(root, 'focusout', '[data-field="scChoice"]', (ev, el) => {
    const s = ctx.state.buy;
    const i = Number(el.dataset.idx);
    if (!(i >= 0 && i < SC_CHOICES)) return;
    const shown = () => !!(s.choiceLeft[i] && s.choices[i] && !SC_RE.test(s.choices[i]));
    const was = shown();
    s.choiceLeft = s.choiceLeft.map((x, j) => x || j === i);
    if (shown() === was) return;
    const to = ev.relatedTarget && root.contains(ev.relatedTarget) && ev.relatedTarget.id ? ev.relatedTarget.id : null;
    ctx.rerender();
    if (to && !root.contains(document.activeElement)) { const n = document.getElementById(to); if (n) n.focus({ preventScroll: true }); }
  });
  ctx.on(root, 'keydown', '[data-field="digits"]', (ev) => {
    if (ev.key !== 'Enter' || ev.isComposing || ev.keyCode === 229) return;
    ev.preventDefault();
    clearTimeout(ctx.state.buy._deb);
    search(ctx);
  });

  ctx.watch('numbers', 'numberRequests', 'flows', 'trunks', 'env', 'mode', 'credits', 'subAccounts');

  if (onBuyRoute) {
    if (b.step === 2 && b.kind === 'landline' && !b.results && !b.loading) ctx.later(() => search(ctx), 0);
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
        // Already released (Cancel asked, or the reservation ended): leave without asking twice.
        const cur = ctx.state.buy;
        if (!cur.reservedAt || cur.expired || cur.step >= 5) return true;
        const ok = await ctx.ui.confirm({ title: t('by.leaveTitle'), body: t('by.leaveBody'), confirmLabel: t('by.leaveYes'), cancelLabel: t('by.leaveNo') });
        if (ok) ctx.state.buy = { ...freshBuy(), run: ctx.state.buy.run + 1 };
        return ok;
      });
    }
  }

  // Detail drawer from ?n=, request drawer from ?r= (linkable, survive reload); ?loa=1 opens the LOA form (palette command).
  syncDrawer(ctx);
  syncRqDrawer(ctx);
  ctx.cleanup(() => { if (!/^#\/numbers\?(.*&)?n=/.test(location.hash)) closeDrawer(); });
  ctx.cleanup(() => { if (!/^#\/numbers\?(.*&)?r=/.test(location.hash)) closeRqDrawer(); });
  if (!onBuyRoute && ctx.params.query.loa === '1') ctx.later(() => { ctx.go('numbers', { replace: true }); loaModal(ctx); }, 30);
}
