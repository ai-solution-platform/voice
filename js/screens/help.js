// Help & Status — #/help (help center, ?q=) · /article/<slug> · /status (?inc=) · /contact (?topic=&call=&campaign=&sub=&from=)
//                · /tickets · /tickets/<id> · /whats-new · /errors (#<code> or ?code=)
// 26 articles in 6 categories, status page with the 14:06–14:24 incident history, the contact
// form → ticket SUP-104xx with "first reply by" (P1 1 h any day · P2 4 business hours · P3 1 business day), My tickets
// (SUP-10452 waiting for you · SUP-10418 solved), the service-level wording, "What's new", keyboard shortcuts and the tour.

import { html as h, raw, reducedMotion } from '../core/dom.js';
import { loc as locOf, setLang, getLang } from '../core/i18n.js';
import { audit, notify } from '../core/actions.js';
import { nowMs } from '../data/clock.js';
import { PRICES } from '../data/prices.js';
import { ARTICLES, ERRORS, STATUS_CODES } from '../data/reference.js';
import { API_BASE, SIP_HOST } from '../data/edge.js';
import { WEBHOOK_RETRY } from '../data/active.js';
import { HOLIDAYS as THAI_HOLIDAYS, holidayOn, holidaysFrom, ymdOf, holidayYears, HOLIDAY_RANGE } from '../data/holidays.js';

export const id = 'help';
export const nav = { group: 'account', icon: 'help', labelKey: 'nav.help' };
export const titleKey = 'nav.help';
export const skeleton = 'detail';
export const css = true;
export const initialState = { q: '', cat: null, open: {}, helpful: {}, form: null, formRaw: null, sent: null, wnRead: false, reply: '', _raw: null };

export const commands = [
  { id: 'contact', labelKey: 'cmd.contact', icon: 'lifebuoy', keywords: ['support ticket contact help problem'], run: ({ go }) => go('help/contact') },
  { id: 'status', labelKey: 'cmd.status', icon: 'activity', keywords: ['status incident outage uptime'], run: ({ go }) => go('help/status') },
  { id: 'errors', labelKey: 'cmd.errors', icon: 'alert-circle', keywords: ['error code sip q850 voice_4206'], run: ({ go }) => go('help/errors') },
];

export function crumb(params, { t }) {
  const [sub, x] = params.path;
  if (sub === 'article') { const a = ARTICLES.find((y) => y.slug === x); return a ? locOf(a.title) : ''; }
  if (sub === 'tickets' && x) return x;
  if (['status', 'contact', 'tickets', 'whats-new', 'errors'].includes(sub)) return t(`tab.${sub}`);
  return '';
}

// ---------- reference content ----------
// Six help categories over the article cats in reference.js.
const CATS = [
  { id: 'start', icon: 'rocket', of: ['start'] },
  { id: 'api', icon: 'code', of: ['api'] },
  { id: 'campaigns', icon: 'megaphone', of: ['campaigns', 'compliance'] },
  { id: 'phone', icon: 'server', of: ['pbx', 'numbers', 'flows'] },
  { id: 'calls', icon: 'list', of: ['logs'] },
  { id: 'account', icon: 'card', of: ['billing', 'account'] },
];
const catOf = (a) => CATS.find((c) => c.of.includes(a.cat)) || CATS[0];
const QUICK = [['otp', 'api-quickstart-otp', 'shield-check'], ['notify', 'api-quickstart-notify', 'bell'], ['c2c', 'click-to-call', 'phone-call'], ['campaign', 'campaign-guide', 'megaphone'], ['pbx', 'pbx-freepbx', 'server']];
const TOPICS = ['calls', 'trunk', 'numbers', 'campaigns', 'otp', 'billing', 'api', 'account', 'sales', 'international', 'other'];
const TOPIC_ARTICLES = {
  calls: ['error-codes', 'answer-rate-tips', 'call-statuses'], trunk: ['trunk-troubleshooting', 'pbx-freepbx', 'pbx-yeastar'], numbers: ['thai-number-kyc', 'loa-caller-id', 'verify-number'],
  campaigns: ['campaign-guide', 'calling-hours-dnc', 'answer-rate-tips'], otp: ['api-quickstart-otp', 'webhooks-signature', 'sandbox-rules'], billing: ['billing-credits', 'spending-limits', 'volume-plans'],
  api: ['api-quickstart-notify', 'webhooks-signature', 'error-codes'], account: ['roles', 'support-sla', 'first-call'], sales: ['volume-plans', 'billing-credits', 'support-sla'],
  international: ['spending-limits', 'billing-credits', 'support-sla'], other: ['first-call', 'support-sla', 'error-codes'],
};
const CAT_TOPIC = { start: 'account', api: 'api', campaigns: 'campaigns', phone: 'trunk', calls: 'calls', account: 'billing' };
// Status page components and the sample incident history.
const COMPONENTS = ['console', 'mobile', 'fixed', 'inbound', 'trunks', 'campaigns', 'otp', 'voices', 'webhooks', 'platform'];
const HISTORY = [
  { id: 'inc-20261027', date: '2026-10-27', component: 'mobile', impact: 'degraded', from: '14:06', to: '14:24', updates: [['14:09', 'investigating'], ['14:15', 'identified'], ['14:24', 'monitoring'], ['14:33', 'resolved']] },
  { id: 'inc-20261019', date: '2026-10-19', component: 'webhooks', impact: 'degraded', from: '09:12', to: '09:34', updates: [['09:15', 'investigating'], ['09:34', 'resolved']] },
  { id: 'inc-20261008', date: '2026-10-08', component: 'trunks', impact: 'maintenance', from: '02:00', to: '02:20', updates: [['02:00', 'scheduled'], ['02:20', 'completed']] },
  { id: 'inc-20260930', date: '2026-09-30', component: 'console', impact: 'degraded', from: '10:05', to: '10:25', updates: [['10:07', 'investigating'], ['10:25', 'resolved']] },
];
const WHATS_NEW = [
  { id: 'zh', date: '2026-10-27', target: 'lang:zh' },
  { id: 'plans', date: '2026-10-20', target: 'billing?section=prices' },
  { id: 'failover', date: '2026-10-13', target: 'trunks/hq-pbx' },
  { id: 'lists', date: '2026-10-06', target: 'campaigns/new' },
  { id: 'fallback', date: '2026-09-29', target: 'otp' },
  { id: 'reasons', date: '2026-09-22', target: 'logs?status=failed' },
];
/** Thai public holidays: the one shared demo list (js/data/holidays.js) — support targets and the calling-hours article. */
const HOLIDAYS = THAI_HOLIDAYS.map((x) => x.date);
/** Weekday holiday used as the example in the calling-hours article (Thu 10 Dec 2026, Constitution Day; same as the campaign check). */
const HOLIDAY_EXAMPLE = '2026-12-10';
/** Webhook delivery rule of the API contract (§8 Delivery): 5 s timeout, retries in WEBHOOK_RETRY, off after 100 failures. */
const WEBHOOK_DELIVERY = { timeoutSec: 5, offAfter: 100 };
/** Common questions shown on the help center (and found by its search). */
const FAQ = [{ id: 'callerid', href: '#/help/errors?code=voice-4213', action: 'hp.faq.error' }];
const CALL_RE = /^call_[0-9A-Z]{8,}$/i;
/** Same anchor ids as the Logs drawer links (#/help/errors?code=sip-503-q34). */
const errorSlug = (code) => String(code).toLowerCase().replace(/ · q\.850 /, '-q').replace(/[\s_]+/g, '-');
/** The part after a second '#' in the route (#/help/status#inc-20261027). */
const hashPart = (ctx) => (String(ctx.params.raw).split('?')[0].split('#')[1] || '');

/** Price and product values every article body may use as {vars} (never typed into a dictionary). */
function artVars(ctx, a) {
  const { fmt } = ctx;
  const p = PRICES;
  return {
    outbound: fmt.rate(p.outbound), otp: fmt.rate(p.otpPerAnsweredCall), inbound: fmt.rate(p.inbound), number: fmt.int(p.number), numberBulk: fmt.int(p.numberBulk), bulkFrom: p.numberBulkFrom,
    trunkInc: p.trunkIncludedCalls, extra: fmt.int(p.extraConcurrentCall), premium: fmt.rate(p.premiumVoice), transcription: fmt.rate(p.transcription), recording: fmt.rate(p.recording),
    recordingDays: p.recordingDays, intl: fmt.rate(p.international), plan1min: fmt.int(p.plans[0].minMinutes), plan1rate: fmt.rate(p.plans[0].rate), plan2min: fmt.int(p.plans[1].minMinutes),
    plan2rate: fmt.rate(p.plans[1].rate), salesFrom: fmt.int(p.plansContactSalesFrom), months: p.planMonths, trialMin: p.trial.minutes, trialNumbers: p.trial.verifiedNumbers, otpCalls: Math.round(p.trial.minutes / p.trial.otpCallUses), otpUses: fmt.num(p.trial.otpCallUses, 1), firstPct: p.offers.firstTopUpPct, firstCap: fmt.int(p.offers.firstTopUpCap), firstUntil: fmt.dateProse(p.offers.firstTopUpUntil), annualPct: p.offers.annualTopUpPct,
    cps: p.cpsDefault, api: API_BASE, sip: SIP_HOST, pbx: a && a.pbx ? a.pbx : '',
    timeout: WEBHOOK_DELIVERY.timeoutSec, retry: WEBHOOK_RETRY.map((x) => `${fmt.int(x)} s`).join(' · '), attempts: WEBHOOK_RETRY.length + 1, offAfter: fmt.int(WEBHOOK_DELIVERY.offAfter),
    holiday: fmt.dateProse(HOLIDAY_EXAMPLE, true), holidayName: holidayOn(HOLIDAY_EXAMPLE) ? locOf(holidayOn(HOLIDAY_EXAMPLE).name) : '',
  };
}
const fill = (s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (v[k] == null ? m : String(v[k])));
/** Minimal markup in article bodies: **bold** and `code`. Escapes everything else. */
function md(ctx, s) {
  const e = ctx.esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code class="inline" translate="no">$1</code>');
  return raw(e);
}
function bodyOf(ctx, a) {
  const key = a.pbx ? 'art.pbx' : `art.${a.slug}`;
  const v = ctx.t(key);
  return Array.isArray(v) ? v.map((x) => fill(x, artVars(ctx, a))) : [];
}

/** Business-hours arithmetic for "first reply by" (Mon–Fri 09:00–18:00 Bangkok, Thai public holidays excluded). */
function firstReplyBy(ctx, priority, fromMs) {
  const BKK = 7 * 3600000;
  if (priority === 'P1') return fromMs + 3600000;
  const isBiz = (d) => { const wd = new Date(d + BKK).getUTCDay(); const ymd = new Date(d + BKK).toISOString().slice(0, 10); return wd >= 1 && wd <= 5 && !HOLIDAYS.includes(ymd); };
  const dayStart = (d) => { const x = new Date(d + BKK); x.setUTCHours(0, 0, 0, 0); return x.getTime() - BKK; };
  const open = (d) => dayStart(d) + 9 * 3600000;
  const close = (d) => dayStart(d) + 18 * 3600000;
  const nextOpen = (d) => { let x = dayStart(d) + 86400000; while (!isBiz(x)) x += 86400000; return x + 9 * 3600000; };
  let cur = fromMs;
  if (!isBiz(cur) || cur >= close(cur)) cur = nextOpen(cur);
  else if (cur < open(cur)) cur = open(cur);
  if (priority === 'P3') {
    // one business day: the same clock time on the next business day
    const clock = cur - dayStart(cur);
    return nextOpen(cur) - 9 * 3600000 + clock;
  }
  let left = 4 * 3600000;
  for (let i = 0; i < 10 && left > 0; i++) {
    const room = close(cur) - cur;
    if (room >= left) return cur + left;
    left -= room;
    cur = nextOpen(cur);
  }
  return cur;
}

// ---------- shared pieces ----------
function tabs(ctx) {
  const { t } = ctx;
  const sub = ctx.params.path[0] || 'center';
  const open = ctx.list('tickets').filter((x) => x.status !== 'solved').length;
  const items = [['center', 'help'], ['status', 'help/status'], ['contact', 'help/contact'], ['tickets', 'help/tickets'], ['whats-new', 'help/whats-new']];
  return h`<nav class="hp-tabs" aria-label="${t('tabsAria')}">${items.map(([k, href]) => h`<a href="#/${href}" data-action="hp.tab" data-value="${k}" ${raw(sub === k || (k === 'center' && (sub === 'article' || sub === 'errors')) ? 'aria-current="page"' : '')}>${t(`tab.${k}`)}${k === 'tickets' && open ? h` <span class="badge">${open}</span>` : ''}${k === 'whats-new' && !ctx.state.wnRead ? h` <span class="dot dot-warn" aria-label="${t('wn.unread')}"></span>` : ''}</a>`)}</nav>`;
}

function head(ctx, title, sub) {
  return h`<div class="page-head"><div class="titles"><h1>${title}${ctx.pageHelp()}</h1>${sub ? h`<span class="sub">${sub}</span>` : ''}</div></div>${tabs(ctx)}`;
}

function statusStrip(ctx) {
  const { t, icon } = ctx;
  return h`<div class="note note-ok hp-strip">${icon('check-circle')}<span class="grow"><strong>${t('ss.allNormal')}</strong> · ${t('ss.resolvedToday')}</span>
    <a class="btn btn-sm" href="#/help/status?inc=20261027" data-action="hp.strip.status">${icon('activity')}${t('ss.view')}</a></div>`;
}

function hoursLine(ctx) {
  return h`<span class="hint-xs hp-hours">${ctx.icon('clock', 'ico-xs')}<span>${ctx.t('help.supportTitle')} · ${ctx.t('help.supportHours')}</span></span>`;
}

// ---------- help center ----------
function matches(ctx, a, q) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = [locOf(a.title), a.title.en, a.slug, ...bodyOf(ctx, a)].join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
}

const faqAnswer = (ctx, f) => { const v = ctx.t(`faq.${f.id}.a`); return Array.isArray(v) ? v : []; };
function faqMatches(ctx, f, q) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = [ctx.t(`faq.${f.id}.q`), ...faqAnswer(ctx, f)].join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
}
function faqCard(ctx, items) {
  const { t, icon } = ctx;
  if (!items.length) return '';
  return h`<section class="card card-pad stack hp-faq" aria-labelledby="hp-faq-h"><h2 id="hp-faq-h">${t('faq.title')}</h2>
    ${items.map((f) => h`<div class="hp-faq-item" id="faq-${f.id}"><h3>${t(`faq.${f.id}.q`)}</h3><div class="hp-prose">${faqAnswer(ctx, f).map((p) => h`<p>${md(ctx, p)}</p>`)}</div>
      <a class="linkbtn" href="${f.href}" data-action="${f.action}">${icon('alert-circle', 'ico-sm')}<span translate="no">${t(`faq.${f.id}.link`)}</span></a></div>`)}</section>`;
}

function articleLink(ctx, a) {
  return h`<li><a class="hp-art" href="#/help/article/${a.slug}" data-action="hp.article" data-value="${a.slug}">${ctx.icon('file-text', 'ico-sm')}<span>${locOf(a.title)}</span></a></li>`;
}

function center(ctx) {
  const { t, fmt, icon } = ctx;
  const q = ctx.state.q.trim();
  const cat = ctx.state.cat;
  const results = q ? ARTICLES.filter((a) => matches(ctx, a, q)) : null;
  const faqHits = q ? FAQ.filter((f) => faqMatches(ctx, f, q)) : FAQ;
  const latest = WHATS_NEW[0];
  const list = results
    ? h`<section class="card hp-results" aria-live="polite" aria-labelledby="hp-res-h"><div class="card-head"><h2 id="hp-res-h">${t('center.results', { n: results.length + faqHits.length, q })}</h2><button type="button" class="btn btn-sm btn-ghost" data-action="hp.search.clear">${icon('x')}${t('center.clear')}</button></div>
      ${results.length ? h`<ul class="hp-list">${results.map((a) => articleLink(ctx, a))}</ul>` : faqHits.length ? ''
        : h`<div class="empty"><span class="art">${icon('search')}</span><strong>${t('center.none', { q })}</strong><span class="hint">${t('center.noneHint')}</span>
          <a class="btn btn-sm btn-navy" href="#/help/contact" data-action="hp.noresult.contact">${icon('lifebuoy')}${t('help.contact')}</a></div>`}</section>`
    : h`<div class="hp-cats" role="group" aria-label="${t('center.catsAria')}">${CATS.map((c) => {
        const n = ARTICLES.filter((a) => c.of.includes(a.cat)).length;
        return h`<button type="button" class="card hp-cat" data-action="hp.cat" data-value="${c.id}" aria-pressed="${cat === c.id}">${icon(c.icon)}<strong>${t(`cat.${c.id}`)}</strong><span class="hint-xs">${t('center.nArticles', { count: n })}</span></button>`;
      })}</div>
      <section class="card" aria-labelledby="hp-all-h"><div class="card-head"><h2 id="hp-all-h">${cat ? t(`cat.${cat}`) : t('center.all')}</h2>${cat ? h`<button type="button" class="btn btn-sm btn-ghost" data-action="hp.cat" data-value="">${t('center.showAll')}</button>` : h`<a class="linkbtn" href="#/help/errors" data-action="hp.errors">${icon('alert-circle')}${t('center.errors')}</a>`}</div>
        <div class="hp-groups">${CATS.filter((c) => !cat || c.id === cat).map((c) => h`<div class="hp-group"><h3>${t(`cat.${c.id}`)}</h3><ul class="hp-list">${ARTICLES.filter((a) => c.of.includes(a.cat)).map((a) => articleLink(ctx, a))}</ul></div>`)}</div></section>`;
  return h`<div class="page hp">${head(ctx, t('center.title'), t('center.sub'))}
    <div class="hp-hero card"><label class="hp-search"><span class="sr-only">${t('center.searchAria')}</span>${icon('search')}<input class="input" type="search" data-field="hp.q" data-action="hp.search" value="${ctx.state.q}" placeholder="${t('center.searchPh')}" autocomplete="off"></label>
      <div class="hp-quick">${QUICK.map(([k, slug, ic]) => h`<a class="hp-quick-card" href="#/help/article/${slug}" data-action="hp.quick" data-value="${slug}">${icon(ic)}<span>${t(`quick.${k}`)}</span></a>`)}</div></div>
    ${statusStrip(ctx)}
    <div class="hp-main"><div class="stack-4">${list}${faqCard(ctx, faqHits)}</div>
      <aside class="stack-4 hp-side">
        <section class="card card-pad stack"><h2>${t('side.contactTitle')}</h2>${hoursLine(ctx)}
          <ul class="hp-prio">${['P1', 'P2', 'P3'].map((p) => h`<li><span class="chip ${p === 'P1' ? 'chip-err' : p === 'P2' ? 'chip-warn' : ''}">${p}</span><span>${t(`prio.${p}.reply`)}</span></li>`)}</ul>
          <div class="row"><a class="btn btn-sm btn-navy" href="#/help/contact" data-action="hp.side.contact">${icon('lifebuoy')}${t('help.contact')}</a><a class="btn btn-sm" href="#/help/contact?topic=sales" data-action="hp.side.sales">${icon('building')}${t('help.sales')}</a></div></section>
        <section class="card card-pad stack"><h2>${t('sla.title')}</h2><p class="hint">${t('sla.short')}</p>
          <a class="linkbtn" href="#/help/article/support-sla" data-action="hp.side.sla">${t('sla.read')}</a></section>
        <section class="card card-pad stack"><h2>${t('side.tools')}</h2>
          <button type="button" class="btn btn-sm" data-action="hp.shortcuts">${icon('keyboard')}${t('help.shortcuts')} <kbd>?</kbd></button>
          <button type="button" class="btn btn-sm" data-action="hp.tour">${icon('compass')}${t('help.tour')}</button></section>
        <section class="card card-pad stack"><h2>${t('tab.whats-new')}</h2><span class="hint-xs">${fmt.dateProse(latest.date)}</span><strong>${t(`wn.${latest.id}.t`)}</strong>
          <a class="linkbtn" href="#/help/whats-new" data-action="hp.side.whatsnew">${t('wn.all')}</a></section>
        <section class="card card-pad stack hp-about"><h2>${t('about.title')}</h2><p class="hint-xs">${t('about.aggregator')}</p><p class="hint-xs">${t('about.licence')}</p>
          <p class="hint-xs hp-tr">${icon('globe', 'ico-xs')} ${t('help.translationPending')}</p></section>
      </aside></div></div>`;
}

// ---------- article ----------
function articleBody(ctx, a) {
  const paras = bodyOf(ctx, a);
  const out = [];
  let ul = null;
  for (const p of paras) {
    if (p.startsWith('- ')) { if (!ul) { ul = []; out.push(ul); } ul.push(p.slice(2)); continue; }
    ul = null;
    out.push(p);
  }
  return h`${out.map((x) => (Array.isArray(x) ? h`<ul>${x.map((li) => h`<li>${md(ctx, li)}</li>`)}</ul>` : x.startsWith('## ') ? h`<h2>${x.slice(3)}</h2>` : h`<p>${md(ctx, x)}</p>`))}`;
}

function articleExtras(ctx, a) {
  const { t, fmt } = ctx;
  if (a.slug === 'error-codes') return errorTable(ctx, null);
  if (a.slug === 'call-statuses') {
    return h`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>${t('status.chip')}</th><th>${t('status.api')}</th><th>${t('status.means')}</th></tr></thead><tbody>
      ${STATUS_CODES.map((c) => h`<tr><td>${ctx.ui.describe.statusChip(c)}</td><td class="mono" translate="no">${c}</td><td class="hint">${t(`statusTip.${c}`).replace(/^[a-z-]+ — /, '')}</td></tr>`)}</tbody></table></div>`;
  }
  if (a.slug === 'support-sla') return slaBlock(ctx);
  if (a.slug === 'calling-hours-dnc') {
    // The next public holidays from the shared list: each one uses the weekend hours (calls stop at 18:00).
    const next = holidaysFrom(ymdOf(nowMs())).slice(0, 6);
    return h`<h2>${t('hol.title')}</h2><div class="tbl-wrap hp-hol"><table class="tbl"><thead><tr><th>${t('hol.date')}</th><th>${t('hol.name')}</th><th>${t('hol.hours')}</th></tr></thead><tbody>
      ${next.map((x) => h`<tr><td class="nowrap">${fmt.dateProse(x.date, true)}</td><td>${locOf(x.name)}</td><td class="mono nowrap">08:00–18:00</td></tr>`)}</tbody></table></div>
      <p class="hint-xs">${t('hol.foot', { n: fmt.int(holidaysFrom(ymdOf(nowMs())).length), all: fmt.int(THAI_HOLIDAYS.length), years: holidayYears(getLang()), until: fmt.dateProse(HOLIDAY_RANGE.to) })}</p>`;
  }
  if (a.slug === 'volume-plans') {
    return h`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>${t('vp.minutes')}</th><th class="num">${t('vp.rate')}</th><th>${t('vp.terms')}</th></tr></thead><tbody>
      <tr><td>${t('vp.payg')}</td><td class="num mono">${fmt.rate(PRICES.outbound)}</td><td class="hint">${t('vp.noCommit')}</td></tr>
      ${PRICES.plans.map((p) => h`<tr><td>${t('vp.from', { n: fmt.int(p.minMinutes) })}</td><td class="num mono">${fmt.rate(p.rate)}</td><td class="hint">${t('vp.commit', { months: PRICES.planMonths })}</td></tr>`)}
      <tr><td>${t('vp.bigger', { n: fmt.int(PRICES.plansContactSalesFrom) })}</td><td class="num"><a class="linkbtn" href="#/help/contact?topic=sales" data-action="hp.vp.sales">${t('vp.sales')}</a></td><td class="hint">${t('vp.custom')}</td></tr></tbody></table></div>
      <p class="hint-xs">${t('common.plannedPrices')} · ${t('common.exVat')}</p>
      <div class="row"><a class="btn btn-sm btn-navy" href="#/billing?panel=compare" data-action="hp.vp.compare">${t('vp.compare')}</a></div>`;
  }
  return '';
}

function article(ctx, slug) {
  const { t, icon, fmt } = ctx;
  const a = ARTICLES.find((x) => x.slug === slug);
  if (!a) {
    return h`<div class="page hp">${head(ctx, t('center.title'))}<div class="card"><div class="empty empty-center"><span class="art">${icon('compass')}</span><strong>${t('art.missing')}</strong>
      <a class="btn btn-sm btn-navy" href="#/help" data-action="hp.back">${t('art.back')}</a></div></div></div>`;
  }
  const c = catOf(a);
  const related = ARTICLES.filter((x) => x.slug !== a.slug && catOf(x).id === c.id).slice(0, 3);
  const vote = ctx.state.helpful[a.slug];
  return h`<div class="page hp">${tabs(ctx)}
    <div class="hp-main"><article class="card hp-article" aria-labelledby="hp-art-h">
      <div class="row hp-art-top"><a class="linkbtn" href="#/help" data-action="hp.back">${icon('arrow-left')}${t('art.back')}</a><span class="chip">${icon(c.icon)}${t(`cat.${c.id}`)}</span></div>
      <h1 id="hp-art-h">${locOf(a.title)}</h1><span class="hint-xs">${t('art.updated', { date: fmt.dateProse('2026-10-20') })}</span>
      <div class="hp-prose">${articleBody(ctx, a)}${articleExtras(ctx, a)}</div>
      <div class="hp-helpful" aria-live="polite">${vote === 'yes' || vote === 'sent' ? h`<span class="ok-text">${icon('check-circle', 'ico-sm')} ${t('art.thanks')}</span>`
        : vote === 'no' ? h`<label class="field grow"><span class="label">${t('art.missingQ')}</span><textarea class="textarea" rows="3" data-field="hp.fb" placeholder="${t('art.missingPh')}"></textarea></label>
          <div class="row"><button type="button" class="btn btn-sm btn-navy" data-action="hp.art.feedback" data-value="${a.slug}">${icon('send')}${t('art.send')}</button><button type="button" class="btn btn-sm btn-ghost" data-action="hp.art.helpful" data-value="cancel">${t('common.cancel')}</button></div>`
        : h`<span class="strong">${t('art.helpful')}</span><button type="button" class="btn btn-sm" data-action="hp.art.helpful" data-value="yes">${t('art.yes')}</button><button type="button" class="btn btn-sm" data-action="hp.art.helpful" data-value="no">${t('art.no')}</button>`}</div>
    </article>
    <aside class="stack-4 hp-side">
      ${related.length ? h`<section class="card card-pad stack"><h2>${t('art.related')}</h2><ul class="hp-list">${related.map((x) => h`<li><a class="hp-art" href="#/help/article/${x.slug}" data-action="hp.art.related">${icon('file-text', 'ico-sm')}<span>${locOf(x.title)}</span></a></li>`)}</ul></section>` : ''}
      <section class="card card-pad stack"><h2>${t('art.stuck')}</h2>${hoursLine(ctx)}<a class="btn btn-sm btn-navy" href="#/help/contact?topic=${CAT_TOPIC[c.id]}&article=${a.slug}" data-action="hp.art.contact">${icon('lifebuoy')}${t('help.contact')}</a></section>
    </aside></div></div>`;
}

// ---------- service level ----------
function slaBlock(ctx) {
  const { t } = ctx;
  return h`<div class="tbl-wrap"><table class="tbl hp-prio-tbl"><thead><tr><th>${t('prio.col')}</th><th>${t('prio.when')}</th><th>${t('prio.reply')}</th></tr></thead><tbody>
      ${['P1', 'P2', 'P3'].map((p) => h`<tr><td class="nowrap"><span class="chip ${p === 'P1' ? 'chip-err' : p === 'P2' ? 'chip-warn' : ''}">${p}</span> <strong>${t(`prio.${p}.name`)}</strong></td><td>${t(`prio.${p}.when`)}</td><td class="nowrap">${t(`prio.${p}.reply`)}</td></tr>`)}</tbody></table></div>
    <div class="hp-sla"><p>${md(ctx, t('sla.target'))}</p><p>${md(ctx, t('sla.notCounted'))}</p><p>${md(ctx, t('sla.hours'))}</p></div>`;
}

// ---------- status ----------
function bars(ctx, comp) {
  const { t, fmt } = ctx;
  const end = new Date('2026-10-27T12:00:00+07:00').getTime();
  const days = Array.from({ length: 90 }, (_, i) => fmt.isoDate(end - (89 - i) * 86400000));
  return h`<div class="hp-bars" role="group" aria-label="${t('ss.barsAria', { name: t(`comp.${comp}`) })}">${days.map((d) => {
    const inc = HISTORY.find((x) => x.date === d && x.component === comp);
    const tone = inc ? (inc.impact === 'maintenance' ? 'mt' : 'dg') : 'ok';
    const tip = inc ? `${fmt.dayMonth(d)} · ${t(`inc.${inc.id}.title`)}` : `${fmt.dayMonth(d)} · ${t('ss.noDowntime')}`;
    // Only incident days are tab stops; the group label says the rest had no downtime.
    return inc ? h`<span class="hp-bar hp-bar-${tone}" tabindex="0" data-tip="${tip}" aria-label="${tip}"></span>` : h`<span class="hp-bar hp-bar-${tone}" data-tip="${tip}" aria-hidden="true"></span>`;
  })}</div><div class="row hp-bars-legend"><span class="hint-xs">${t('ss.daysAgo')}</span><span class="hint-xs">${t('ss.sampleBars')}</span><span class="hint-xs">${t('ss.today')}</span></div>`;
}

function statusPage(ctx) {
  const { t, fmt, icon } = ctx;
  const q = ctx.params.query.inc;
  const target = q ? `inc-${String(q).replace(/^inc-/, '')}` : hashPart(ctx) || null;
  const open = ctx.state.open;
  if (target && open[target] === undefined) open[target] = true;
  return h`<div class="page hp">${head(ctx, t('tab.status'), t('ss.sub'))}
    <section class="card hp-ss-head"><span class="hp-big-dot" aria-hidden="true"></span><div class="grow"><h2>${t('ss.allNormal')}</h2>
      <span class="hint">${t('ss.checked', { time: fmt.timeShort(nowMs()) })}</span></div>
      <button type="button" class="btn btn-navy" data-action="ss.sub">${icon('bell')}${t('ss.subscribe')}</button></section>
    <section class="card" aria-labelledby="hp-comp-h"><div class="card-head"><h2 id="hp-comp-h">${t('ss.components')}</h2><span class="hp-legend"><span><i class="hp-sw hp-bar-ok"></i>${t('ss.l.ok')}</span><span><i class="hp-sw hp-bar-dg"></i>${t('ss.l.dg')}</span><span><i class="hp-sw hp-bar-out"></i>${t('ss.l.out')}</span><span><i class="hp-sw hp-bar-mt"></i>${t('ss.l.mt')}</span></span></div>
      <ul class="hp-comps">${COMPONENTS.map((c) => {
        const k = `comp-${c}`;
        const isOpen = !!open[k];
        return h`<li><button type="button" class="hp-comp" data-action="ss.comp" data-value="${k}" aria-expanded="${isOpen}">${icon(isOpen ? 'chevron-down' : 'chevron-right', 'ico-sm')}<span class="grow strong">${t(`comp.${c}`)}</span>
          ${c === 'mobile' ? h`<span class="hint-xs hp-comp-note">${t('ss.mobileNote')}</span>` : ''}<span class="chip chip-ok"><span class="dot dot-ok"></span>${t('ss.normal')}</span></button>
          ${isOpen ? h`<div class="hp-comp-body">${bars(ctx, c)}</div>` : ''}</li>`;
      })}</ul></section>
    <section class="card" aria-labelledby="hp-maint-h"><div class="card-head"><h2 id="hp-maint-h">${t('ss.maintTitle')}</h2></div>
      <ul class="hp-incs"><li id="maint-20261103"><button type="button" class="hp-comp" data-action="ss.maint" data-value="maint-20261103" aria-expanded="${!!open['maint-20261103']}">${icon(open['maint-20261103'] ? 'chevron-down' : 'chevron-right', 'ico-sm')}
        <span class="grow"><strong>${t('ss.maintName')}</strong><span class="hint-xs">${fmt.dateProse('2026-11-03', true)} · 02:00–02:30</span></span><span class="chip chip-info">${t('ss.l.mt')}</span></button>
        ${open['maint-20261103'] ? h`<div class="hp-comp-body"><p class="hint">${t('ss.maintBody')}</p></div>` : ''}</li></ul></section>
    <section class="card" aria-labelledby="hp-hist-h"><div class="card-head"><h2 id="hp-hist-h">${t('ss.history')}</h2></div>
      <ul class="hp-incs">${HISTORY.map((inc) => {
        const isOpen = !!open[inc.id];
        return h`<li id="${inc.id}" class="${target === inc.id ? 'is-target' : ''}"><button type="button" class="hp-comp" data-action="ss.inc" data-value="${inc.id}" aria-expanded="${isOpen}">${icon(isOpen ? 'chevron-down' : 'chevron-right', 'ico-sm')}
          <span class="grow"><strong>${t(`inc.${inc.id}.title`)}</strong><span class="hint-xs">${fmt.dateProse(inc.date)} · ${inc.from}–${inc.to} · ${t(`comp.${inc.component}`)}</span></span>
          <span class="chip ${inc.impact === 'maintenance' ? 'chip-info' : 'chip-warn'}">${t(inc.impact === 'maintenance' ? 'ss.l.mt' : 'ss.l.dg')}</span><span class="chip chip-ok">${t(inc.impact === 'maintenance' ? 'upd.completed' : 'upd.resolved')}</span></button>
          ${isOpen ? h`<ol class="hp-upd">${inc.updates.slice().reverse().map(([time, st]) => h`<li><span class="mono hp-upd-t">${time}</span><div><strong>${t(`upd.${st}`)}</strong><p>${t(`inc.${inc.id}.${st}`)}</p></div></li>`)}</ol>` : ''}</li>`;
      })}</ul></section>
    <p class="hint-xs hp-foot">${t('ss.foot')} <a class="linkbtn" href="#/help/article/support-sla" data-action="ss.sla">${t('sla.read')}</a></p></div>`;
}

// ---------- contact ----------
function blankForm(ctx) {
  const q = ctx.params.query;
  const items = [];
  for (const c of String(q.call || '').split(',').filter(Boolean)) items.push({ kind: 'call', value: c });
  if (q.campaign) items.push({ kind: 'campaign', value: q.campaign });
  if (q.sub) items.push({ kind: 'sub', value: q.sub });
  if (q.trunk) items.push({ kind: 'trunk', value: q.trunk });
  if (q.number) items.push({ kind: 'number', value: q.number });
  const topic = TOPICS.includes(q.topic) ? q.topic : items.some((i) => i.kind === 'call') ? 'calls' : '';
  const incidentCall = items.some((i) => i.kind === 'call');
  return {
    topic, priority: incidentCall ? 'P2' : 'P3', items, adding: false, addValue: '', addErr: '',
    start: ctx.fmt.iso(incidentCall ? '2026-10-27T14:06:00+07:00' : nowMs()).slice(0, 16),
    subject: incidentCall && q.campaign ? ctx.t('cs.prefillSubject') : '', desc: '', files: [],
    name: ctx.store.get('user.name'), email: ctx.store.get('user.email'), phone: '', replyLang: getLang(), cc: '', access: true, touched: {}, from: q.from || '',
  };
}

function itemLabel(ctx, it) {
  if (it.kind === 'campaign') { const c = ctx.list('campaigns').find((x) => x.id === it.value); return c ? ctx.loc(c.name) : it.value; }
  if (it.kind === 'sub') return ctx.ui.describe.sub(it.value);
  return it.value;
}

function formErrors(ctx, f) {
  const e = {};
  if (!f.topic) e.topic = 'cs.err.topic';
  if ((f.priority === 'P1' || f.priority === 'P2') && !f.start) e.start = 'cs.err.start';
  if (!f.subject.trim()) e.subject = 'cs.err.subject';
  else if (f.subject.length > 120) e.subject = 'cs.err.subjectLong';
  if (f.desc.trim().length < 20) e.desc = 'cs.err.desc';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) e.email = 'cs.err.email';
  if (f.cc && !f.cc.split(/[,\s]+/).filter(Boolean).every((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x))) e.cc = 'cs.err.cc';
  return e;
}

function contactPage(ctx) {
  const { t, fmt, icon } = ctx;
  if (ctx.state.formRaw !== ctx.params.raw || !ctx.state.form) { ctx.state.form = blankForm(ctx); ctx.state.formRaw = ctx.params.raw; ctx.state.sent = null; }
  if (ctx.state.sent) return confirmation(ctx);
  const f = ctx.state.form;
  const errs = formErrors(ctx, f);
  const show = (k) => (f.touched[k] || f.touched.all) && errs[k];
  const err = (k) => (show(k) ? h`<span class="field-err" id="cs-err-${k}">${t(errs[k])}</span>` : '');
  const suggest = TOPIC_ARTICLES[f.topic || 'other'].map((s) => ARTICLES.find((a) => a.slug === s)).filter(Boolean);
  const summary = f.touched.all && Object.keys(errs).length;
  return h`<div class="page hp">${head(ctx, t('tab.contact'), t('cs.sub'))}
    <div class="note note-warn hp-strip">${icon('activity')}<span class="grow">${t('cs.incident')}</span><a class="btn btn-sm" href="#/help/status?inc=20261027" data-action="cs.status.view">${t('ss.view')}</a></div>
    <div class="hp-main"><form class="card card-pad stack-3 hp-form" novalidate data-form="contact">
      ${summary ? h`<div class="note note-err" role="alert">${icon('alert-circle')}<span>${t('cs.summary', { n: Object.keys(errs).length })}</span></div>` : ''}
      ${f.topic === 'sales' ? h`<div class="note note-brand">${icon('building')}<div class="grow"><strong>${t('sales.contactTitle')}</strong> · ${t('sales.contactSub')}</div><button type="button" class="btn btn-sm btn-navy" data-action="cs.sales">${t('cs.salesForm')}</button></div>` : ''}
      <div class="grid g-2">
        <label class="field"><span class="label">${t('cs.topic')} *</span><select class="select" data-field="cs.topic" aria-invalid="${!!show('topic')}" aria-describedby="cs-err-topic"><option value="">${t('cs.topicPick')}</option>${TOPICS.map((x) => h`<option value="${x}" ${raw(f.topic === x ? 'selected' : '')}>${t(`topic.${x}`)}</option>`)}</select>${err('topic')}</label>
        <label class="field"><span class="label">${t('cs.start')}${f.priority !== 'P3' ? ' *' : ''}</span><input class="input" type="datetime-local" data-field="cs.start" value="${f.start}" aria-describedby="cs-err-start"><span class="hint-xs">${t('cs.startHint')}</span>${err('start')}</label>
      </div>
      <fieldset class="field"><legend class="label">${t('cs.priority')} *</legend><div class="hp-prio-pick">${['P1', 'P2', 'P3'].map((p) => h`<label class="optcard hp-prio-opt" aria-checked="${f.priority === p}"><input type="radio" name="cs-prio" value="${p}" data-field="cs.priority" ${raw(f.priority === p ? 'checked' : '')} class="sr-only">
        <span class="row-tight"><span class="chip ${p === 'P1' ? 'chip-err' : p === 'P2' ? 'chip-warn' : ''}">${p}</span><span class="t">${t(`prio.${p}.name`)}</span></span><span class="h">${t(`prio.${p}.when`)}</span><span class="h strong">${t(`prio.${p}.reply`)}</span></label>`)}</div>
        ${f.priority === 'P1' ? h`<div class="note note-err">${icon('alert')}<span>${t('cs.p1Note')}</span></div>` : ''}</fieldset>
      <div class="field"><span class="label">${t('cs.items')}</span><div class="hp-chips">${f.items.map((it, i) => h`<span class="chip chip-navy hp-item"><span class="hint-xs">${t(`item.${it.kind}`)}</span> <span class="${['call', 'trunk', 'number'].includes(it.kind) ? 'mono' : ''}" ${raw(['call', 'trunk', 'number'].includes(it.kind) ? 'translate="no"' : '')}>${itemLabel(ctx, it)}</span>
          <button type="button" class="hp-x" data-action="cs.chip.remove" data-value="${i}" aria-label="${t('cs.removeItem', { item: itemLabel(ctx, it) })}">${icon('x', 'ico-xs')}</button></span>`)}
        ${f.adding ? h`<span class="row-tight hp-add"><input class="input input-sm mono" data-field="cs.addValue" value="${f.addValue}" placeholder="call_01JBK…" aria-label="${t('cs.addCall')}" spellcheck="false" autofocus><button type="button" class="btn btn-sm btn-navy" data-action="cs.addcall.ok">${t('cs.add')}</button><button type="button" class="btn btn-sm btn-ghost" data-action="cs.addcall.cancel">${t('common.cancel')}</button></span>`
          : h`<button type="button" class="btn btn-sm btn-ghost" data-action="cs.addcall">${icon('plus')}${t('cs.addCall')}</button>`}</div>
        ${f.addErr ? h`<span class="field-err">${t(f.addErr)}</span>` : h`<span class="hint-xs">${t('cs.itemsHint')}</span>`}</div>
      <label class="field"><span class="label">${t('cs.subject')} *</span><input class="input" data-field="cs.subject" value="${f.subject}" maxlength="120" aria-invalid="${!!show('subject')}" aria-describedby="cs-err-subject cs-count">
        <span class="hint-xs" id="cs-count">${t('cs.count', { n: f.subject.length, max: 120 })}</span>${err('subject')}</label>
      <label class="field"><span class="label">${t('cs.desc')} *</span><textarea class="textarea" rows="6" data-field="cs.desc" placeholder="${t('cs.descPh')}" aria-invalid="${!!show('desc')}" aria-describedby="cs-err-desc">${f.desc}</textarea>${err('desc')}</label>
      <div class="field"><span class="label">${t('cs.files')} <span class="opt">${t('common.optional')}</span></span>
        <div class="row"><label class="btn btn-sm hp-filebtn">${icon('upload')}${t('cs.addFiles')}<input type="file" multiple class="sr-only" data-c="files"></label>${f.files.map((x, i) => h`<span class="chip">${x.name} · ${fmt.num(x.size / 1024, 1)} KB <button type="button" class="hp-x" data-action="cs.file.remove" data-value="${i}" aria-label="${t('cs.removeItem', { item: x.name })}">${icon('x', 'ico-xs')}</button></span>`)}</div>
        <span class="hint-xs">${t('cs.filesNote')}</span></div>
      <div class="grid g-2">
        <label class="field"><span class="label">${t('sales.name')}</span><input class="input" data-field="cs.name" value="${f.name}"></label>
        <label class="field"><span class="label">${t('sales.email')} *</span><input class="input" type="email" data-field="cs.email" value="${f.email}" aria-describedby="cs-err-email">${err('email')}</label>
        <label class="field"><span class="label">${t('sales.phoneOrLine')} <span class="opt">${t('common.optional')}</span></span><input class="input" data-field="cs.phone" value="${f.phone}" placeholder="081-xxx-1234 · LINE ID"></label>
        <label class="field"><span class="label">${t('cs.replyLang')}</span><select class="select" data-field="cs.replyLang">${['en', 'th', 'zh'].map((l) => h`<option value="${l}" ${raw(f.replyLang === l ? 'selected' : '')}>${{ en: 'English', th: 'ไทย', zh: '中文' }[l]}</option>`)}</select></label>
      </div>
      <label class="field"><span class="label">${t('cs.cc')} <span class="opt">${t('common.optional')}</span></span><input class="input" data-field="cs.cc" value="${f.cc}" placeholder="ops@example.com" aria-describedby="cs-err-cc">${err('cc')}</label>
      <label class="check"><input type="checkbox" data-field="cs.access" ${raw(f.access ? 'checked' : '')}>${t('cs.access')}</label>
      ${f.access ? '' : h`<span class="hint-xs warn-text">${t('cs.accessOff')}</span>`}
      <div class="row hp-form-foot"><button type="button" class="btn btn-primary" data-action="cs.submit">${icon('send')}${t('cs.send')}</button>${hoursLine(ctx)}</div>
    </form>
    <aside class="stack-4 hp-side"><section class="card card-pad stack"><h2>${t('cs.suggested')}</h2><span class="hint-xs">${t('cs.suggestedHint')}</span>
      <ul class="hp-list">${suggest.map((a) => h`<li><a class="hp-art" href="#/help/article/${a.slug}" data-action="cs.suggest">${icon('file-text', 'ico-sm')}<span>${locOf(a.title)}</span></a></li>`)}</ul></section>
      <section class="card card-pad stack"><h2>${t('sla.title')}</h2><p class="hint-xs">${t('sla.short')}</p><a class="linkbtn" href="#/help/article/support-sla" data-action="cs.sla">${t('sla.read')}</a></section></aside></div></div>`;
}

function confirmation(ctx) {
  const { t, fmt, icon } = ctx;
  const s = ctx.state.sent;
  const tk = ctx.list('tickets').find((x) => x.id === s.id);
  if (!tk) return contactPage(ctx);
  const nCalls = tk.items.filter((i) => i.kind === 'call').length;
  const other = tk.items.length - nCalls;
  return h`<div class="page hp">${head(ctx, t('tab.contact'))}
    <section class="card hp-conf" aria-live="polite"><svg class="ico check-draw hp-conf-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.8 2.8L16.2 9.5"/></svg>
      <h2>${t('conf.title', { id: tk.id })}</h2>
      <p>${t('conf.line1', { p: tk.priority, when: replyLabel(ctx, tk.firstReplyBy) })}</p>
      <p class="hint">${tk.items.length ? t('conf.line2', { items: [nCalls ? t('conf.calls', { count: nCalls }) : '', other ? t('conf.others', { count: other }) : ''].filter(Boolean).join(t('conf.and')) }) : t('conf.line2none')}</p>
      ${tk.priority === 'P1' ? h`<p class="note note-info">${icon('info')}<span>${t('conf.p1', { time: fmt.timeShort(tk.firstReplyBy) })}</span></p>` : ''}
      <div class="row" style="justify-content:center"><a class="btn btn-navy" href="#/help/tickets/${tk.id}" data-action="cs.conf.view">${icon('ticket')}${t('conf.view')}</a>
        <button type="button" class="btn" data-action="cs.conf.another">${t('conf.back')}</button></div></section></div>`;
}

function replyLabel(ctx, ms) {
  const { fmt } = ctx;
  const same = fmt.isoDate(ms) === fmt.isoDate(nowMs());
  return same ? ctx.t('conf.today', { time: fmt.timeShort(ms) }) : `${fmt.weekday(ms)} ${fmt.dayMonth(ms)} ${fmt.timeShort(ms)}`;
}

// ---------- tickets ----------
function ticketStatus(ctx, st) {
  const tone = { open: 'chip-info', 'waiting-for-you': 'chip-warn', 'waiting-ants': 'chip-info', solved: 'chip-ok' }[st] || '';
  return h`<span class="chip ${tone}">${ctx.t(`tk.st.${st}`)}</span>`;
}

function ticketsPage(ctx) {
  const { t, fmt, icon } = ctx;
  const list = ctx.list('tickets');
  return h`<div class="page hp">${head(ctx, t('tab.tickets'), t('tk.sub'))}
    <section class="card" aria-labelledby="hp-tk-h"><div class="card-head"><h2 id="hp-tk-h">${t('tab.tickets')}</h2><a class="btn btn-sm btn-navy" href="#/help/contact" data-action="tk2.new">${icon('plus')}${t('tk.new')}</a></div>
    ${list.length ? h`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>${t('tk.id')}</th><th>${t('tk.subject')}</th><th>${t('tk.priority')}</th><th>${t('tk.status')}</th><th>${t('tk.opened')}</th><th>${t('tk.last')}</th></tr></thead>
      <tbody>${list.map((tk) => h`<tr class="hp-click" data-action="tk2.row" data-value="${tk.id}"><td class="mono strong nowrap"><a href="#/help/tickets/${tk.id}" data-action="tk2.link" translate="no">${tk.id}</a></td>
        <td>${ctx.loc(tk.subject)}<span class="hint-xs hp-block">${t(`topic.${tk.topic}`)}</span></td><td><span class="chip ${tk.priority === 'P1' ? 'chip-err' : tk.priority === 'P2' ? 'chip-warn' : ''}">${tk.priority}</span></td>
        <td>${ticketStatus(ctx, tk.status)}</td><td class="nowrap hint">${fmt.dayMonth(tk.openedAt)} ${fmt.timeShort(tk.openedAt)} · ${tk.openedBy}</td>
        <td class="hint">${lastLine(ctx, tk)}</td></tr>`)}</tbody></table></div>`
    : h`<div class="empty"><span class="art">${icon('ticket')}</span><strong>${t('tk.empty')}</strong><span class="hint">${t('tk.emptyHint')}</span>
      <a class="btn btn-sm btn-navy" href="#/help/contact" data-action="tk2.empty">${icon('lifebuoy')}${t('help.contact')}</a></div>`}</section></div>`;
}

/** The thread of a ticket: sample tickets come from the dictionaries; new tickets store the text the user typed. */
function thread(ctx, tk) {
  const { t, fmt } = ctx;
  if (tk.messages) {
    return tk.messages.map((m) => ({ from: m.from, at: m.at, text: m.key ? t(m.key, { subject: ctx.loc(tk.subject), time: replyLabel(ctx, tk.firstReplyBy) }) : m.text }));
  }
  const base = [];
  if (tk.id === 'SUP-10452') {
    base.push({ from: tk.openedBy, at: tk.openedAt, text: t('tk.SUP-10452.m1') });
    base.push({ from: 'ants', at: '2026-10-27T14:20:00+07:00', text: t('tk.SUP-10452.m2') });
  } else if (tk.id === 'SUP-10418') {
    base.push({ from: tk.openedBy, at: tk.openedAt, text: t('tk.SUP-10418.m1') });
    base.push({ from: 'ants', at: '2026-10-21T09:40:00+07:00', text: t('tk.SUP-10418.m2') });
  }
  void fmt;
  return [...base, ...(tk.extra || [])];
}
function lastLine(ctx, tk) {
  const th = thread(ctx, tk);
  const m = th[th.length - 1];
  if (!m) return '—';
  const who = m.from === 'ants' ? ctx.t('tk.ants') : m.from === 'you' ? ctx.store.get('user.name') : m.from;
  const txt = String(m.text);
  return `${who}: ${txt.length > 70 ? `${txt.slice(0, 70)}…` : txt}`;
}

function ticketDetail(ctx, tid) {
  const { t, fmt, icon } = ctx;
  const tk = ctx.list('tickets').find((x) => x.id === tid);
  if (!tk) {
    return h`<div class="page hp">${head(ctx, t('tab.tickets'))}<div class="card"><div class="empty empty-center"><span class="art">${icon('ticket')}</span><strong>${t('tk.missing', { id: tid })}</strong>
      <a class="btn btn-sm btn-navy" href="#/help/tickets" data-action="tk2.back">${t('tk.backList')}</a></div></div></div>`;
  }
  const items = tk.items || (tk.id === 'SUP-10452' ? [{ kind: 'trunk', value: 'cm-branch-pbx' }, { kind: 'number', value: '053-xxx-120' }] : tk.id === 'SUP-10418' ? [{ kind: 'campaign', value: 'bc_01JBK7C1Q2' }] : []);
  const itemHref = (it) => (it.kind === 'call' ? `#/logs?call=${it.value}` : it.kind === 'campaign' ? `#/campaigns/${it.value}` : it.kind === 'trunk' ? `#/trunks/${it.value}` : it.kind === 'number' ? '#/numbers' : `#/reports?sub=${it.value}`);
  const th = thread(ctx, tk);
  return h`<div class="page hp">${tabs(ctx)}
    <div class="hp-main"><section class="card hp-ticket" aria-labelledby="hp-tkd-h">
      <div class="card-head"><a class="linkbtn" href="#/help/tickets" data-action="tk2.back">${icon('arrow-left')}${t('tk.backList')}</a></div>
      <div class="card-body stack-3"><div class="row" style="justify-content:space-between;align-items:flex-start"><div class="stack" style="gap:4px"><span class="mono hint" translate="no">${tk.id}</span><h1 id="hp-tkd-h" class="hp-tk-title">${ctx.loc(tk.subject)}</h1></div>${ticketStatus(ctx, tk.status)}</div>
        ${items.length ? h`<div class="hp-chips">${items.map((it) => h`<a class="chip chip-navy hp-item" href="${itemHref(it)}" data-action="tk2.item"><span class="hint-xs">${t(`item.${it.kind}`)}</span> <span class="${['call', 'trunk', 'number'].includes(it.kind) ? 'mono' : ''}" ${raw(['call', 'trunk', 'number'].includes(it.kind) ? 'translate="no"' : '')}>${itemLabel(ctx, it)}</span></a>`)}</div>` : ''}
        <ol class="hp-thread">${th.map((m) => h`<li class="${m.from === 'ants' ? 'is-ants' : ''}"><div class="hp-msg-head"><strong>${m.from === 'ants' ? t('tk.ants') : m.from === 'you' ? ctx.store.get('user.name') : m.from}</strong><span class="hint-xs">${fmt.dayMonth(m.at)} ${fmt.timeShort(m.at)}</span></div><p>${m.text}</p></li>`)}</ol>
        <label class="field"><span class="label">${t('tk.reply')}</span><textarea class="textarea" rows="3" data-field="tk2.replyText" placeholder="${t('tk.replyPh')}">${ctx.state.reply}</textarea></label>
        <div class="row"><button type="button" class="btn btn-navy" data-action="tk2.reply" data-value="${tk.id}">${icon('send')}${t('tk.send')}</button>
          ${tk.status !== 'solved' ? h`<button type="button" class="btn" data-action="tk2.close" data-value="${tk.id}">${icon('check')}${t('tk.solve')}</button>` : h`<span class="hint-xs">${t('tk.solvedNote')}</span>`}</div></div></section>
    <aside class="stack-4 hp-side"><section class="card card-pad stack"><h2>${t('tk.details')}</h2>
      <div class="kv"><span class="k">${t('tk.priority')}</span><span class="v"><span class="chip ${tk.priority === 'P1' ? 'chip-err' : tk.priority === 'P2' ? 'chip-warn' : ''}">${tk.priority}</span></span></div>
      <div class="kv"><span class="k">${t('tk.topic')}</span><span class="v">${t(`topic.${tk.topic}`)}</span></div>
      <div class="kv"><span class="k">${t('tk.opened')}</span><span class="v">${fmt.dayMonth(tk.openedAt)} ${fmt.timeShort(tk.openedAt)}</span></div>
      <div class="kv"><span class="k">${t('tk.by')}</span><span class="v">${tk.openedBy}</span></div>
      ${tk.firstReplyBy && tk.status === 'open' ? h`<div class="kv"><span class="k">${t('tk.firstReply')}</span><span class="v">${replyLabel(ctx, tk.firstReplyBy)}</span></div>` : ''}
      ${tk.solvedAt ? h`<div class="kv"><span class="k">${t('tk.solvedOn')}</span><span class="v">${fmt.dayMonth(tk.solvedAt)}</span></div>` : ''}
      ${hoursLine(ctx)}</section></aside></div></div>`;
}

// ---------- what's new · errors ----------
function whatsNew(ctx) {
  const { t, fmt, icon } = ctx;
  return h`<div class="page hp">${head(ctx, t('tab.whats-new'), t('wn.sub'))}
    <section class="card" aria-labelledby="hp-wn-h"><div class="card-head"><h2 id="hp-wn-h">${t('wn.title')}</h2><button type="button" class="btn btn-sm" data-action="wn.readall" ${raw(ctx.state.wnRead ? 'aria-disabled="true" aria-describedby="hp-wn-read"' : '')}>${icon('check')}${t('wn.readAll')}</button>${ctx.state.wnRead ? h`<span class="hint-xs" id="hp-wn-read">${t('wn.allRead')}</span>` : ''}</div>
      <ol class="hp-wn">${WHATS_NEW.map((e, i) => h`<li><span class="hp-wn-date">${fmt.dateProse(e.date)}</span><div class="grow"><h3>${i === 0 && !ctx.state.wnRead ? h`<span class="dot dot-warn" aria-label="${t('wn.unread')}"></span> ` : ''}${t(`wn.${e.id}.t`)}</h3>
        <p class="hint">${t(`wn.${e.id}.b`, { plan1: fmt.int(PRICES.plans[0].minMinutes), rate1: fmt.rate(PRICES.plans[0].rate), plan2: fmt.int(PRICES.plans[1].minMinutes), rate2: fmt.rate(PRICES.plans[1].rate) })}</p>
        ${e.target.startsWith('lang:') ? h`<button type="button" class="linkbtn" data-action="wn.entry" data-value="${e.target}">${t('wn.try')} →</button>` : h`<a class="linkbtn" href="#/${e.target}" data-action="wn.entry">${t('wn.try')} →</a>`}</div></li>`)}</ol></section></div>`;
}

function errorTable(ctx, target) {
  const { t, icon } = ctx;
  const open = ctx.state.open;
  return h`<div class="tbl-wrap"><table class="tbl hp-errs"><thead><tr><th>${ctx.term(t('er.code'), 'sip_code')}</th><th>${t('er.what')}</th><th><span class="sr-only">${t('er.more')}</span></th></tr></thead><tbody>
    ${ERRORS.map((e) => {
      const [what, ...todo] = locOf(e.text).split(' · ');
      const slug = errorSlug(e.code);
      const k = `er-${slug}`;
      const isOpen = open[k] === undefined ? target === slug : !!open[k];
      const support = /^VOICE_/.test(e.code) ? e.code : null;
      return h`<tr class="hp-click ${target === slug ? 'is-target' : ''}" id="${slug}" data-action="er.row" data-value="${k}" data-open="${isOpen}">
        <td class="mono nowrap strong" translate="no">${e.code}</td><td>${what}${isOpen ? h`<div class="hp-er-more">${todo.length ? h`<p><strong>${t('er.todo')}</strong> ${todo.join(' · ')}</p>` : h`<p class="hint">${t('er.generic')}</p>`}
          ${support ? h`<p class="hint-xs">${t('er.support', { code: support })}</p>` : ''}<a class="linkbtn" href="#/help/contact?topic=calls" data-action="er.contact">${t('help.contact')}</a></div>` : ''}</td>
        <td class="num"><button type="button" class="btn btn-sm btn-ghost btn-icon" data-action="er.row" data-value="${k}" data-open="${isOpen}" aria-expanded="${isOpen}" aria-label="${t('er.more')}: ${e.code}">${icon(isOpen ? 'chevron-up' : 'chevron-down', 'ico-sm')}</button></td></tr>`;
    })}</tbody></table></div>`;
}

function errorsPage(ctx) {
  const { t } = ctx;
  const c = ctx.params.query.code || hashPart(ctx);
  const target = c ? (ERRORS.some((e) => errorSlug(e.code) === c) ? c : errorSlug(c)) : null;
  return h`<div class="page hp">${head(ctx, t('er.title'), t('er.sub'))}<section class="card">${errorTable(ctx, target)}</section></div>`;
}

// ---------- screen contract ----------
export function render(ctx) {
  if (ctx.state._raw !== ctx.params.raw) {
    ctx.state._raw = ctx.params.raw;
    if (!ctx.params.path.length) ctx.state.q = ctx.params.query.q || '';
    ctx.state.reply = '';
  }
  const [sub, x] = ctx.params.path;
  const base = String(sub || '').split('#')[0];
  if (base === 'article') return article(ctx, String(x || '').split('#')[0]);
  if (base === 'tickets' && x) return ticketDetail(ctx, String(x).split('#')[0]);
  if (base === 'status') return statusPage(ctx);
  if (base === 'contact') return contactPage(ctx);
  if (base === 'tickets') return ticketsPage(ctx);
  if (base === 'whats-new') return whatsNew(ctx);
  if (base === 'errors') return errorsPage(ctx);
  return center(ctx);
}

// ---------- behaviour ----------
function subscribeModal(ctx) {
  const { t, icon } = ctx;
  const body = h`<div class="stack-3"><p class="hint">${t('sub.intro')}</p>
    <fieldset class="field"><legend class="label">${t('sub.how')}</legend>
      ${['email', 'line', 'webhook'].map((c, i) => h`<label class="radio"><input type="radio" name="hp-sub" value="${c}" ${raw(i === 0 ? 'checked' : '')}>${t(`sub.${c}`)}</label>`)}</fieldset>
    <label class="field"><span class="label">${t('sub.address')}</span><input class="input" data-s="addr" value="${ctx.store.get('user.email')}" spellcheck="false"><span class="hint-xs" data-s="hint">${t('sub.emailHint')}</span></label>
    <span class="field-err" data-s="err" hidden>${t('sub.bad')}</span>
    <div class="row"><button type="button" class="btn btn-sm" data-action="ss.rss">${icon('download')}${t('sub.rss')}</button><span class="hint-xs">${t('sub.rssHint')}</span></div></div>`;
  const m = ctx.ui.modal({
    title: t('ss.subscribe'), body,
    actions: { 'ss.rss': () => ctx.ui.download('ants-status-sample.xml', rss(ctx), 'application/rss+xml') },
    buttons: [{ label: t('common.cancel') }, { label: t('sub.yes'), kind: 'navy', onClick: (hh) => {
      const how = hh.el.querySelector('input[name="hp-sub"]:checked').value;
      const v = hh.el.querySelector('[data-s="addr"]').value.trim();
      const ok = how === 'webhook' ? /^https:\/\/\S+\.\S+/.test(v) : how === 'email' ? /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) : v.length > 1;
      if (!ok) { hh.el.querySelector('[data-s="err"]').hidden = false; return false; }
      ctx.ui.toast(t('toast.T45'), { kind: 'success', demo: true });
      return true;
    } }],
  });
  m.el.addEventListener('change', (ev) => {
    if (ev.target.name !== 'hp-sub') return;
    const addr = m.el.querySelector('[data-s="addr"]');
    const hint = m.el.querySelector('[data-s="hint"]');
    const v = ev.target.value;
    addr.value = v === 'email' ? ctx.store.get('user.email') : v === 'webhook' ? 'https://hooks.example.com/ants/status' : 'Example Trading ops';
    hint.textContent = t(`sub.${v}Hint`);
    m.el.querySelector('[data-s="err"]').hidden = true;
  });
}

function rss(ctx) {
  const { t } = ctx;
  const esc = ctx.esc;
  const items = HISTORY.map((inc) => `  <item><title>${esc(t(`inc.${inc.id}.title`))}</title><guid isPermaLink="false">${inc.id}</guid><pubDate>${new Date(`${inc.date}T${inc.to}:00+07:00`).toUTCString()}</pubDate><description>${esc(t(`inc.${inc.id}.${inc.updates[inc.updates.length - 1][1]}`))}</description></item>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel>\n  <title>ANTS Voice status (sample)</title>\n  <link>https://status.voice.example/</link>\n  <description>${esc(t('app.demoShort'))}</description>\n${items}\n</channel></rss>\n`;
}

function submitTicket(ctx, btn) {
  const { t } = ctx;
  const f = ctx.state.form;
  f.touched.all = true;
  const errs = formErrors(ctx, f);
  if (Object.keys(errs).length) {
    ctx.rerender();
    ctx.later(() => { const first = document.querySelector('#outlet [aria-invalid="true"], #outlet .field-err'); const fld = first && first.closest('.field'); if (fld) fld.querySelector('input, select, textarea')?.focus(); }, 20);
    return;
  }
  btn.setAttribute('aria-busy', 'true');
  btn.innerHTML = String(h`<span class="spin"></span>${t('cs.send')}`);
  ctx.later(() => {
    const no = 10473 + ctx.list('tickets').filter((x) => x.demo).length;
    const idT = `SUP-${no}`;
    const at = nowMs();
    const firstBy = firstReplyBy(ctx, f.priority, at);
    const tk = {
      id: idT, demo: true, priority: f.priority, topic: f.topic || 'other', subject: { en: f.subject, th: f.subject, zh: f.subject }, openedAt: new Date(at).toISOString(), openedBy: f.name || ctx.store.get('user.name'),
      status: 'open', firstReplyBy: firstBy, items: f.items.slice(),
      messages: [{ from: 'you', at: new Date(at).toISOString(), text: f.desc }, { from: 'ants', at: new Date(at + 1000).toISOString(), key: f.priority === 'P1' ? 'tk.autoP1' : 'tk.auto' }],
    };
    ctx.store.update('tickets', (l) => [tk, ...(l || [])]);
    notify('ticketReceived', { vars: { ticket: idT }, href: `help/tickets/${idT}` });
    audit('ticket.opened', { ticket: idT });
    ctx.setState({ sent: { id: idT } });
    ctx.ui.toast(t('toast.T34', { id: idT }), { kind: 'success', demo: true, action: { label: t('conf.view'), onClick: () => ctx.go(`help/tickets/${idT}`) } });
  }, reducedMotion() ? 300 : 800);
}

export function mount(root, ctx) {
  const { t } = ctx;
  const setQ = (v) => {
    ctx.setState({ q: v, cat: null });
    const raw2 = v.trim() ? `help?q=${encodeURIComponent(v.trim())}` : 'help';
    ctx.state._raw = raw2;
    ctx.params.raw = raw2;
    history.replaceState(history.state, '', `${location.pathname}${location.search}#/${raw2}`);
  };
  const f = () => ctx.state.form;
  ctx.actions(root, {
    'hp.search': () => {},
    'hp.search.clear': () => { setQ(''); ctx.later(() => { const i = root.querySelector('[data-field="hp.q"]'); if (i) i.focus(); }, 0); },
    'hp.cat': (el) => { const v = el.dataset.value || null; ctx.setState({ cat: v && ctx.state.cat !== v ? v : null }); },
    'hp.shortcuts': () => ctx.ui.shortcuts(),
    'hp.tour': () => ctx.ui.tour.start({ onCta: () => ctx.ui.dialer.open({ source: 'tour' }) }),
    'hp.art.helpful': (el) => {
      const slug = ctx.params.path[1];
      const v = el.dataset.value;
      if (v === 'cancel') { ctx.setState({ helpful: { ...ctx.state.helpful, [slug]: undefined } }); return; }
      ctx.setState({ helpful: { ...ctx.state.helpful, [slug]: v } });
      if (v === 'yes') ctx.ui.toast(t('art.thanks'), { kind: 'success' });
      else ctx.later(() => { const ta = root.querySelector('[data-field="hp.fb"]'); if (ta) ta.focus(); }, 0);
    },
    'hp.art.feedback': (el) => { ctx.setState({ helpful: { ...ctx.state.helpful, [el.dataset.value]: 'sent' } }); ctx.ui.toast(t('art.thanks'), { kind: 'success', demo: true }); },
    'ss.sub': () => subscribeModal(ctx),
    'ss.comp': (el) => ctx.setState({ open: { ...ctx.state.open, [el.dataset.value]: !ctx.state.open[el.dataset.value] } }),
    'ss.inc': (el) => ctx.setState({ open: { ...ctx.state.open, [el.dataset.value]: !ctx.state.open[el.dataset.value] } }),
    'ss.maint': (el) => ctx.setState({ open: { ...ctx.state.open, [el.dataset.value]: !ctx.state.open[el.dataset.value] } }),
    'er.row': (el, ev) => { if (ev.target.closest('a')) return; ctx.setState({ open: { ...ctx.state.open, [el.dataset.value]: el.dataset.open !== 'true' } }); },
    'cs.sales': () => ctx.ui.sales.contact({}),
    'cs.chip.remove': (el) => { f().items.splice(Number(el.dataset.value), 1); ctx.rerender(); },
    'cs.file.remove': (el) => { f().files.splice(Number(el.dataset.value), 1); ctx.rerender(); },
    'cs.addcall': () => { Object.assign(f(), { adding: true, addValue: '', addErr: '' }); ctx.rerender(); ctx.later(() => { const i = root.querySelector('[data-field="cs.addValue"]'); if (i) i.focus(); }, 0); },
    'cs.addcall.cancel': () => { Object.assign(f(), { adding: false, addErr: '' }); ctx.rerender(); },
    'cs.addcall.ok': () => {
      const v = f().addValue.trim();
      if (!CALL_RE.test(v)) { f().addErr = 'cs.err.callId'; ctx.rerender(); return; }
      if (!f().items.some((i) => i.value === v)) f().items.push({ kind: 'call', value: v });
      Object.assign(f(), { adding: false, addValue: '', addErr: '' });
      if (!f().topic) f().topic = 'calls';
      ctx.rerender();
    },
    'cs.submit': (el) => submitTicket(ctx, el),
    'cs.conf.another': () => {
      const from = f() && f().from;
      ctx.state.sent = null;
      ctx.state.form = null;
      ctx.go(from || 'overview');
    },
    'tk2.row': (el, ev) => { if (ev.target.closest('a')) return; ctx.go(`help/tickets/${el.dataset.value}`); },
    'tk2.reply': (el) => {
      const text = ctx.state.reply.trim();
      if (text.length < 2) { ctx.ui.toast(t('tk.replyEmpty'), { kind: 'warn' }); const ta = root.querySelector('[data-field="tk2.replyText"]'); if (ta) ta.focus(); return; }
      const idT = el.dataset.value;
      const msg = { from: 'you', at: new Date(nowMs()).toISOString(), text };
      ctx.store.update('tickets', (l) => l.map((x) => (x.id !== idT ? x : x.messages ? { ...x, messages: [...x.messages, msg], status: 'waiting-ants' } : { ...x, extra: [...(x.extra || []), msg], status: 'waiting-ants' })));
      audit('ticket.replied', { ticket: idT });
      ctx.state.reply = '';
      ctx.ui.toast(t('tk.replySent'), { kind: 'success', demo: true });
    },
    'tk2.close': (el) => {
      const idT = el.dataset.value;
      ctx.store.update('tickets', (l) => l.map((x) => (x.id === idT ? { ...x, status: 'solved', solvedAt: new Date(nowMs()).toISOString() } : x)));
      audit('ticket.solved', { ticket: idT });
      ctx.ui.toast(t('tk.solvedToast', { id: idT }), { kind: 'success' });
    },
    'wn.readall': () => { ctx.setState({ wnRead: true }); ctx.ui.toast(t('wn.allRead'), { kind: 'success' }); },
    'wn.entry': (el) => {
      const v = el.dataset.value || '';
      if (v.startsWith('lang:')) { setLang(v.slice(5)); }
    },
  });
  ctx.inputs(root, {
    'hp.q': (v) => setQ(v),
    'hp.fb': () => {},
    'tk2.replyText': (v) => { ctx.state.reply = v; },
    'cs.addValue': (v) => { f().addValue = v; },
    ...Object.fromEntries(['topic', 'priority', 'start', 'subject', 'desc', 'name', 'email', 'phone', 'replyLang', 'cc', 'access'].map((k) => [`cs.${k}`, (v, el) => {
      const form = f();
      form[k] = el.type === 'checkbox' ? !!v : v;
      if (['topic', 'priority', 'access'].includes(k)) { ctx.rerender(); return; }
      if (k === 'subject') { const c = root.querySelector('#cs-count'); if (c) c.textContent = t('cs.count', { n: v.length, max: 120 }); }
      if (form.touched[k] || form.touched.all) paintErr(k);
    }])),
  });
  // Validation on blur: a touched field shows its error, painted in place so focus and clicks are kept.
  const paintErr = (k) => {
    const form = f();
    const input = root.querySelector(`[data-field="cs.${k}"]`);
    if (!form || !input) return;
    const e = formErrors(ctx, form)[k];
    const field = input.closest('.field');
    if (!field) return;
    let span = field.querySelector(`#cs-err-${k}`);
    if (e) {
      if (!span) { span = document.createElement('span'); span.className = 'field-err'; span.id = `cs-err-${k}`; field.appendChild(span); }
      span.textContent = t(e);
      input.setAttribute('aria-invalid', 'true');
    } else {
      if (span) span.remove();
      input.setAttribute('aria-invalid', 'false');
    }
  };
  ctx.on(root, 'focusout', '[data-form="contact"] [data-field]', (ev, el) => {
    const k = el.dataset.field.replace(/^cs\./, '');
    const form = f();
    if (!form || k === 'addValue') return;
    form.touched[k] = true;
    paintErr(k);
  });
  ctx.on(root, 'change', '[data-c="files"]', (ev, el) => {
    const list = Array.from(el.files || []).slice(0, 5).map((x) => ({ name: x.name, size: x.size })); // name and size only
    f().files.push(...list);
    f().files = f().files.slice(0, 5);
    ctx.rerender();
  });
  ctx.on(root, 'keydown', '[data-field="cs.addValue"]', (ev) => { if (ev.key === 'Enter' && !ev.isComposing && ev.keyCode !== 229) { ev.preventDefault(); root.querySelector('[data-action="cs.addcall.ok"]').click(); } if (ev.key === 'Escape') { ev.stopPropagation(); root.querySelector('[data-action="cs.addcall.cancel"]').click(); } });
  ctx.on(root, 'submit', 'form', (ev) => ev.preventDefault());
  ctx.on(root, 'keydown', '.hp-click', (ev, el) => { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === el) { ev.preventDefault(); el.click(); } });
  ctx.watch('tickets', 'mode', 'user');
  // Deep links: scroll an incident / error row into view.
  const target = root.querySelector('.is-target');
  if (target && ctx.state._scrolled !== ctx.params.raw) { ctx.state._scrolled = ctx.params.raw; ctx.later(() => target.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' }), 60); }
}
