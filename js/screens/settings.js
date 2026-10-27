// Settings — #/settings   (tabs ?tab=general|compliance|notifications|security)
// Organisation defaults, compliance (Do-Not-Call list: check / upload a CSV / view / export, calling hours, the
// recording notice in TH · EN · ZH with Listen, retention, data location), notifications (event × channel matrix,
// LINE group, the one alert webhook with "Send test") and security (2-step sign-in policy, console IP allow-list,
// session timeout). Edits collect in a draft; a sticky bar offers Discard / Save, and leaving asks first.
// Event webhooks live only in API keys & Webhooks — Settings links there.

import { html as h, raw, reducedMotion } from '../core/dom.js';
import { audit, isActive } from '../core/actions.js';
import { tIn, LANGS } from '../core/i18n.js';
import { nowMs } from '../data/clock.js';
import { PRICES } from '../data/prices.js';

export const id = 'settings';
export const nav = { group: 'account', icon: 'settings', labelKey: 'nav.settings' };
export const titleKey = 'nav.settings';
export const skeleton = 'form';
export const css = true;

const TABS = ['general', 'compliance', 'notifications', 'security'];
const EVENTS = ['lowCredits', 'limitReached', 'failureRate', 'trunkDown', 'documents', 'campaignFinished', 'ticketUpdates'];
const CHANNELS = ['email', 'line', 'webhook'];
const TIMES = Array.from({ length: 31 }, (_, i) => { const m = 6 * 60 + i * 30; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${m % 60 ? '30' : '00'}`; });
const IP_RE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}(\/(3[0-2]|[12]?\d))?$/;

/** Sample Do-Not-Call list (masked numbers). 098-xxx-3345 is the "not dialled" row in Logs; 091-xxx-4470 pressed 9 today. */
const DNC_SAMPLE = [
  { phone: '091-xxx-4470', at: '2026-10-27T14:28:40+07:00', by: 'press9', reason: 'press9' },
  { phone: '083-xxx-2219', at: '2026-10-26T11:05:12+07:00', by: 'press9', reason: 'press9' },
  { phone: '098-xxx-3345', at: '2026-10-20T10:12:00+07:00', by: 'press9', reason: 'press9' },
  { phone: '086-xxx-7710', at: '2026-10-20T09:00:00+07:00', by: 'Wipa Srisuk', reason: 'upload' },
  { phone: '081-xxx-5533', at: '2026-10-20T09:00:00+07:00', by: 'Wipa Srisuk', reason: 'upload' },
  { phone: '089-xxx-0921', at: '2026-10-18T16:44:00+07:00', by: 'press9', reason: 'press9' },
  { phone: '095-xxx-4108', at: '2026-10-15T13:20:00+07:00', by: 'key:delivery-system', reason: 'api' },
  { phone: '092-xxx-6650', at: '2026-10-12T10:31:00+07:00', by: 'press9', reason: 'press9' },
  { phone: '02-xxx-8812', at: '2026-10-08T15:02:00+07:00', by: 'Somchai Jaidee', reason: 'request' },
  { phone: '087-xxx-3390', at: '2026-10-05T09:48:00+07:00', by: 'press9', reason: 'press9' },
  { phone: '061-xxx-2047', at: '2026-09-28T11:15:00+07:00', by: 'Wipa Srisuk', reason: 'upload' },
  { phone: '080-xxx-7765', at: '2026-09-21T14:09:00+07:00', by: 'press9', reason: 'press9' },
];
const DNC_TOTAL = 1284;
const DNC_PRESS9_30D = 212;

function defaults(ctx) {
  const active = isActive();
  const ch = ctx.store.get('alertChannels') || {};
  const matrix = {};
  for (const e of EVENTS) matrix[e] = { email: true, line: ['lowCredits', 'limitReached', 'failureRate', 'trunkDown'].includes(e) && !!ch.lineGroup, webhook: ['failureRate', 'trunkDown'].includes(e) && !!ch.webhook };
  const nums = ctx.list('numbers').filter((n) => n.status === 'active');
  return {
    general: { name: ctx.loc(ctx.store.get('org.name')), tz: 'Asia/Bangkok', lang: 'en', cid: active ? '02-xxx-1001' : (nums[0] ? nums[0].number : ''), sub: 'sub_01JB2HQ000', ring: 30, voice: 'th' },
    compliance: { wdFrom: '08:00', wdTo: '20:00', weFrom: '08:00', weTo: '18:00', holidays: true, recOn: true, recStop: true, retention: PRICES.recordingDays, purpose: 'reminder', cap: 1 },
    notifications: { matrix, webhook: ch.webhook || '' },
    security: { twofa: 'admins', ips: '', timeout: '8h' },
  };
}
const clone = (x) => JSON.parse(JSON.stringify(x));
export const initialState = () => ({ tab: 'general', saved: null, draft: null, recLang: 'th', speaking: false, dnc: {}, check: null, whResult: null, _raw: null, _mode: null });

function busy(btn, ms = 600) {
  return new Promise((resolve) => {
    const prev = btn ? btn.innerHTML : '';
    if (btn) { btn.setAttribute('aria-busy', 'true'); const ico = btn.querySelector('svg.ico'); const sp = document.createElement('span'); sp.className = 'spin'; if (ico) ico.replaceWith(sp); else btn.prepend(sp); }
    setTimeout(() => { if (btn && btn.isConnected) { btn.removeAttribute('aria-busy'); btn.innerHTML = prev; } resolve(); }, reducedMotion() ? Math.min(ms, 300) : ms);
  });
}

// ---------- state helpers ----------
function sync(ctx) {
  const mode = ctx.store.get('mode');
  if (!ctx.state.saved || ctx.state._mode !== mode) { ctx.state.saved = defaults(ctx); ctx.state.draft = null; ctx.state._mode = mode; }
  if (!ctx.state.dnc[mode]) ctx.state.dnc[mode] = mode === 'active' ? { total: DNC_TOTAL, press9: DNC_PRESS9_30D, rows: clone(DNC_SAMPLE), updated: '2026-10-20', by: 'Wipa Srisuk' } : { total: 0, press9: 0, rows: [], updated: null, by: null };
  if (ctx.state._raw === ctx.params.raw) return;
  ctx.state._raw = ctx.params.raw;
  const tab = ctx.params.query.tab;
  if (TABS.includes(tab)) ctx.state.tab = tab;
}
const cur = (ctx) => ctx.state.draft || ctx.state.saved;
const dnc = (ctx) => ctx.state.dnc[ctx.store.get('mode')];
const dirty = (ctx) => !!ctx.state.draft && JSON.stringify(ctx.state.draft) !== JSON.stringify(ctx.state.saved);
/** Change one draft value: path like 'general.name'. Re-renders only when the dirty bar has to appear or `render` is set. */
function setVal(ctx, path, value, render = false) {
  const wasDirty = dirty(ctx);
  if (!ctx.state.draft) ctx.state.draft = clone(ctx.state.saved);
  const parts = path.split('.');
  let o = ctx.state.draft;
  for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
  o[parts[parts.length - 1]] = value;
  if (render || wasDirty !== dirty(ctx)) ctx.rerender();
}

// ---------- pieces ----------
function header(ctx) {
  const { t } = ctx;
  const tab = ctx.state.tab;
  return h`<div class="page-head"><div class="titles"><h1>${t('title')}${ctx.pageHelp()}</h1><span class="sub">${t('sub')}</span></div></div>
    <div class="seg st-tabs" role="tablist" aria-label="${t('tabsAria')}">${TABS.map((x) => h`<button type="button" role="tab" id="st-tab-${x}" aria-controls="st-panel" aria-selected="${tab === x}" tabindex="${tab === x ? 0 : -1}" data-action="st.tab" data-value="${x}">${t(`tab.${x}`)}</button>`)}</div>`;
}

const opt = (v, label, selected) => h`<option value="${v}" ${raw(String(v) === String(selected) ? 'selected' : '')}>${label}</option>`;
const toggle = (ctx, action, on, label, extra = '') => h`<button type="button" class="toggle" role="switch" aria-checked="${!!on}" data-action="${action}" aria-label="${label}" ${raw(extra)}></button>`;

function generalTab(ctx) {
  const { t } = ctx;
  const g = cur(ctx).general;
  const nums = ctx.list('numbers').filter((n) => n.status === 'active');
  return h`<section class="card" aria-labelledby="st-gen-h"><div class="card-head"><h2 id="st-gen-h">${t('gen.title')}</h2></div>
    <div class="card-body st-grid">
      <label class="field"><span class="label">${t('gen.name')}</span><input class="input" data-field="st.gen.name" value="${g.name}" autocomplete="organization"><span class="hint-xs">${t('gen.nameHint')}</span></label>
      <label class="field"><span class="label">${t('gen.tz')}</span><select class="select" data-field="st.gen.tz">${opt('Asia/Bangkok', 'Asia/Bangkok (UTC+7)', g.tz)}${opt('Asia/Singapore', 'Asia/Singapore (UTC+8)', g.tz)}</select><span class="hint-xs">${t('gen.tzHint')}</span></label>
      <label class="field"><span class="label">${t('gen.lang')}</span><select class="select" data-field="st.gen.lang">${['en', 'th', 'zh'].map((c) => opt(c, LANGS[c].label, g.lang))}</select><span class="hint-xs">${t('gen.langHint')}</span></label>
      <label class="field"><span class="label">${ctx.term(t('gen.cid'), 'caller_id')}</span><select class="select" data-field="st.gen.cid">${nums.length ? nums.map((n) => opt(n.number, n.number, g.cid)) : opt('', t('gen.noNumber'), '')}</select>
        ${nums.length ? '' : h`<a class="linkbtn hint-xs" href="#/numbers/buy" data-action="st.gen.buy">${t('gen.buy')}</a>`}</label>
      <label class="field"><span class="label">${ctx.term(t('gen.sub'), 'subaccount')}</span><select class="select" data-field="st.gen.sub">${ctx.list('subAccounts').map((s) => opt(s.id, ctx.loc(s.name), g.sub))}</select></label>
      <label class="field"><span class="label">${t('gen.ring')}</span><select class="select" data-field="st.gen.ring">${[20, 30, 45, 60].map((s) => opt(s, t('gen.sec', { n: s }), g.ring))}</select><span class="hint-xs">${t('gen.ringHint')}</span></label>
      <label class="field"><span class="label">${ctx.term(t('gen.voice'), 'voice_tier')}</span><select class="select" data-field="st.gen.voice">${['th', 'en', 'zh'].map((c) => opt(c, t(`voiceLang.${c}`), g.voice))}</select><span class="hint-xs">${t('gen.voiceHint')}</span></label>
    </div></section>
    ${webhooksLink(ctx)}`;
}

function webhooksLink(ctx) {
  const { t, icon } = ctx;
  return h`<div class="note note-info st-wh">${icon('link')}<span class="grow">${t('wh.note')}</span><a class="btn btn-sm" href="#/keys" data-action="st.webhooks">${t('wh.open')}</a></div>`;
}

function complianceTab(ctx) {
  const { t, fmt, icon } = ctx;
  const c = cur(ctx).compliance;
  const d = dnc(ctx);
  const check = ctx.state.check;
  const sel = (field, v) => h`<select class="select st-time" data-field="st.hours.${field}">${TIMES.map((x) => opt(x, x, v))}</select>`;
  const notice = tIn(ctx.state.recLang, 'rec.text', undefined, 'settings');
  return h`
  <section class="card" aria-labelledby="st-dnc-h"><div class="card-head"><h2 id="st-dnc-h">${ctx.term(t('dnc.title'), 'dnc')}</h2>
      <div class="row st-dnc-check"><input class="input" data-field="st.dnc.q" value="${check ? check.q : ''}" placeholder="${t('dnc.checkPh')}" aria-label="${t('dnc.checkAria')}" inputmode="tel">
        <button type="button" class="btn" data-action="st.dnc.check">${icon('search')}${t('dnc.check')}</button></div></div>
    ${check && check.result ? h`<div class="note ${check.result === 'on' ? 'note-warn' : 'note-ok'} st-dnc-result" role="status">${icon(check.result === 'on' ? 'shield' : 'check-circle')}<span>${check.result === 'on'
      ? t('dnc.on', { phone: check.phone, date: fmt.dayMonth(check.row.at), how: t(`dnc.how.${check.row.reason}`) }) : check.result === 'bad' ? t('dnc.bad') : t('dnc.off', { phone: check.phone })}</span></div>` : ''}
    <div class="card-body"><div class="grid g-3 st-dnc-tiles">
      <div class="card card-sunken tile"><span class="t">${t('dnc.list')}</span><span class="v">${fmt.int(d.total)}</span><span class="h">${d.updated ? t('dnc.listLine', { date: fmt.dayMonth(d.updated), by: d.by }) : t('dnc.emptyLine')}</span></div>
      <div class="card card-sunken tile"><span class="t">${ctx.term(t('dnc.press9'), 'opt_out')}</span><span class="v">${fmt.int(d.press9)}</span><span class="h">${t('dnc.press9Line')}</span></div>
      <button type="button" class="card tile st-upload" data-action="st.dnc.upload">${icon('upload', 'ico-lg')}<strong>${t('dnc.upload')}</strong><span class="hint-xs">${t('dnc.uploadHint')}</span></button>
    </div>
    <div class="row st-dnc-actions"><button type="button" class="btn btn-sm" data-action="st.dnc.view">${icon('list')}${t('dnc.view')}</button>
      <button type="button" class="btn btn-sm" data-action="st.dnc.export">${icon('download')}${t('dnc.export')}</button>
      <span class="hint-xs">${t('dnc.note')}</span></div></div></section>

  <section class="card" aria-labelledby="st-hours-h" data-inv="st.hours"><div class="card-head"><h2 id="st-hours-h">${ctx.term(t('hours.title'), 'calling_hours')}</h2><span class="chip">${t('hours.default')}</span></div>
    <div class="card-body stack-3">
      <div class="st-hours"><span class="strong">${t('hours.weekdays')}</span><span class="row-tight">${sel('wdFrom', c.wdFrom)}<span aria-hidden="true">–</span>${sel('wdTo', c.wdTo)}</span></div>
      <div class="st-hours"><span class="strong">${t('hours.weekends')}</span><span class="row-tight">${sel('weFrom', c.weFrom)}<span aria-hidden="true">–</span>${sel('weTo', c.weTo)}</span></div>
      ${c.wdFrom >= c.wdTo || c.weFrom >= c.weTo ? h`<span class="field-err">${t('hours.bad')}</span>` : ''}
      <div class="st-line"><div class="grow"><strong>${t('hours.holidays')}</strong><span class="hint-xs">${t('hours.holidaysHint')}</span></div>${toggle(ctx, 'st.hours.holidays', c.holidays, t('hours.holidays'))}</div>
      <p class="hint-xs">${t('hours.note')}</p></div></section>

  <section class="card" aria-labelledby="st-rec-h"><div class="card-head"><h2 id="st-rec-h">${t('rec.title')}</h2><span class="chip chip-ok" tabindex="0" data-tip-key="settings.loc.tip">${icon('shield-check')}${t('loc.chip')}</span></div>
    <div class="card-body stack-3">
      <div class="st-line"><div class="grow"><strong>${t('rec.noticeLabel')}</strong><span class="hint-xs">${t('rec.noticeHint')}</span></div>${toggle(ctx, 'st.rec.toggle', c.recOn, t('rec.noticeLabel'))}</div>
      <div class="st-notice ${c.recOn ? '' : 'is-off'}">
        <div class="row" style="justify-content:space-between"><div class="seg seg-sm" role="group" aria-label="${t('rec.langAria')}">${['th', 'en', 'zh'].map((l) => h`<button type="button" data-action="st.rec.lang" data-value="${l}" aria-pressed="${ctx.state.recLang === l}">${LANGS[l].label}</button>`)}</div>
          <button type="button" class="btn btn-sm" data-action="st.rec.listen" aria-pressed="${ctx.state.speaking}">${icon(ctx.state.speaking ? 'stop' : 'play')}${ctx.state.speaking ? t('rec.stopListen') : t('rec.listen')}</button></div>
        <blockquote class="st-quote" lang="${LANGS[ctx.state.recLang].html}">${notice}</blockquote>
        <span class="hint-xs">${t('rec.voiceNote')}</span></div>
      <div class="st-line"><div class="grow"><strong>${t('rec.stop')}</strong><span class="hint-xs">${t('rec.stopHint')}</span></div>${toggle(ctx, 'st.rec.stop', c.recStop, t('rec.stop'))}</div>
      <div class="st-line"><div class="grow"><strong>${ctx.term(t('rec.retention'), 'retention')}</strong><span class="hint-xs">${t('rec.retentionHint', { rate: fmt.rate(PRICES.recording) })}</span></div>
        <select class="select st-narrow" data-field="st.rec.retention">${[30, 90, 180, 365].map((dd) => opt(dd, dd === PRICES.recordingDays ? t('rec.daysDefault', { n: dd }) : t('rec.days', { n: dd }), c.retention))}</select></div>
    </div></section>

  <section class="card" aria-labelledby="st-loc-h"><div class="card-head"><h2 id="st-loc-h">${t('loc.title')}</h2></div>
    <div class="card-body stack-3"><p class="st-loc">${icon('globe')}<span>${t('loc.text')}</span></p>
      <div class="st-line"><div class="grow"><strong>${t('dest.title')}</strong><span class="hint-xs">${t('dest.hint')}</span></div><a class="btn btn-sm" href="#/billing?section=limits" data-action="st.dest">${t('dest.link')}</a></div>
      <div class="st-line"><div class="grow"><strong>${t('purpose.title')}</strong><span class="hint-xs">${t('purpose.hint')}</span></div>
        <select class="select st-narrow" data-field="st.purpose">${['reminder', 'service', 'marketing', 'payment'].map((p) => opt(p, t(`purpose.${p}`), c.purpose))}</select></div>
      ${c.purpose === 'payment' ? h`<div class="note note-warn">${icon('alert')}<span>${t('purpose.paymentNote')}</span></div>` : c.purpose === 'marketing' ? h`<div class="note note-warn">${icon('alert')}<span>${t('purpose.marketingNote')}</span></div>` : ''}
      <div class="st-line"><div class="grow"><strong>${t('cap.title')}</strong><span class="hint-xs">${t('cap.hint')}</span></div>
        <select class="select st-narrow" data-field="st.cap">${[1, 2, 3].map((n) => opt(n, t('cap.n', { count: n }), c.cap))}</select></div>
      <p class="hint-xs">${t('consent')}</p></div></section>`;
}

function notificationsTab(ctx) {
  const { t, icon } = ctx;
  const n = cur(ctx).notifications;
  const ch = ctx.store.get('alertChannels') || {};
  const wr = ctx.state.whResult;
  return h`<section class="card" aria-labelledby="st-ntf-h"><div class="card-head"><h2 id="st-ntf-h">${t('ntf.title')}</h2><span class="hint">${t('ntf.sub')}</span></div>
    <div class="tbl-wrap"><table class="tbl st-matrix" data-inv="st.ntf.matrix"><thead><tr><th>${t('ntf.event')}</th>${CHANNELS.map((c) => h`<th class="st-c">${t(`ch.${c}`)}</th>`)}</tr></thead>
      <tbody>${EVENTS.map((e) => h`<tr><td><span class="strong">${t(`ev.${e}`)}</span><span class="hint-xs st-evh">${t(`evHint.${e}`)}</span></td>
        ${CHANNELS.map((c) => {
          const avail = c === 'email' || (c === 'line' ? !!ch.lineGroup : !!(n.webhook || ch.webhook));
          return h`<td class="st-c"><input type="checkbox" class="st-cb" data-field="st.ntf.${e}.${c}" ${raw(n.matrix[e][c] ? 'checked' : '')} ${raw(avail ? '' : 'disabled')} aria-label="${t('ntf.cbAria', { ev: t(`ev.${e}`), ch: t(`ch.${c}`) })}"></td>`;
        })}</tr>`)}</tbody></table></div>
    <div class="card-foot hint-xs">${t('ntf.foot')}</div></section>

  <section class="card" aria-labelledby="st-ch-h"><div class="card-head"><h2 id="st-ch-h">${t('ntf.channels')}</h2></div>
    <div class="card-body stack-3">
      <div class="st-line"><div class="grow"><strong>${t('ch.email')}</strong><span class="hint-xs mono" translate="no">${(ch.emails || []).join(', ') || '—'}</span></div><a class="btn btn-sm btn-ghost" href="#/users" data-action="st.ntf.emails">${t('ntf.emailsLink')}</a></div>
      <div class="st-line"><div class="grow"><strong>${t('ntf.lineGroup')}</strong><span class="hint-xs">${ch.lineGroup ? t('ntf.lineOn', { name: ch.lineGroup }) : t('ntf.lineOff')}</span></div>
        <button type="button" class="btn btn-sm ${ch.lineGroup ? '' : 'btn-navy'}" data-action="st.ntf.line">${icon('chat')}${ch.lineGroup ? t('ntf.lineChange') : t('ntf.lineConnect')}</button></div>
      <div class="field"><span class="label">${ctx.term(t('ntf.webhook'), 'webhook')}</span>
        <div class="row st-whrow"><input class="input mono grow" data-field="st.ntf.webhook" value="${n.webhook}" placeholder="https://hooks.example.com/ants/alerts" spellcheck="false" translate="no" aria-describedby="st-wh-res">
          <button type="button" class="btn" data-action="st.ntf.test">${icon('send')}${t('ntf.test')}</button></div>
        <span class="hint-xs" id="st-wh-res" role="status">${wr ? (wr.ok ? h`<span class="ok-text">${icon('check-circle', 'ico-xs')} ${t('ntf.testOk', { code: wr.code, ms: wr.ms })}</span>` : h`<span class="err-text">${t('ntf.testBad')}</span>`) : t('ntf.webhookHint')}</span></div>
    </div></section>
  ${webhooksLink(ctx)}`;
}

function securityTab(ctx) {
  const { t, icon } = ctx;
  const s = cur(ctx).security;
  const bad = s.ips.split(/[\s,]+/).filter(Boolean).filter((x) => !IP_RE.test(x));
  return h`<section class="card" aria-labelledby="st-sec-h"><div class="card-head"><h2 id="st-sec-h">${t('sec.title')}</h2></div>
    <div class="card-body stack-3">
      <div class="st-line"><div class="grow"><strong>${t('sec.twofa')}</strong><span class="hint-xs">${t('sec.twofaHint')}</span></div>
        <div class="seg" role="group" aria-label="${t('sec.twofa')}">${['admins', 'everyone'].map((v) => h`<button type="button" data-action="st.sec.2fa" data-value="${v}" aria-pressed="${s.twofa === v}">${t(`sec.twofa.${v}`)}</button>`)}</div></div>
      <label class="field"><span class="label">${t('sec.ip')}</span><textarea class="textarea mono" rows="2" data-field="st.sec.ip" placeholder="203.0.113.0/24, 198.51.100.7" spellcheck="false" aria-invalid="${bad.length > 0}" aria-describedby="st-ip-h">${s.ips}</textarea>
        <span class="${bad.length ? 'field-err' : 'hint-xs'}" id="st-ip-h">${bad.length ? t('sec.ipBad', { ip: bad[0] }) : t('sec.ipHint')}</span></label>
      <div class="st-line"><div class="grow"><strong>${t('sec.timeout')}</strong><span class="hint-xs">${t('sec.timeoutHint')}</span></div>
        <select class="select st-narrow" data-field="st.sec.timeout">${['1h', '8h', '24h'].map((v) => opt(v, t(`sec.timeout.${v}`), s.timeout))}</select></div>
      <div class="st-line"><div class="grow"><strong>${t('sec.audit')}</strong><span class="hint-xs">${t('sec.auditHint')}</span></div><a class="btn btn-sm" href="#/users?tab=audit" data-action="st.sec.audit">${icon('list')}${t('sec.auditBtn')}</a></div>
    </div></section>`;
}

function dirtyBar(ctx) {
  if (!dirty(ctx)) return '';
  const { t, icon } = ctx;
  return h`<div class="st-dirty" role="region" aria-label="${t('dirty.aria')}"><span class="row-tight">${icon('edit')}<strong>${t('dirty.text')}</strong></span>
    <span class="row"><button type="button" class="btn btn-ghost" data-action="st.dirty.discard">${t('dirty.discard')}</button><button type="button" class="btn btn-primary" data-action="st.dirty.save">${icon('check')}${t('dirty.save')}</button></span></div>`;
}

// ---------- screen contract ----------
export function render(ctx) {
  sync(ctx);
  const tab = ctx.state.tab;
  const body = tab === 'compliance' ? complianceTab(ctx) : tab === 'notifications' ? notificationsTab(ctx) : tab === 'security' ? securityTab(ctx) : generalTab(ctx);
  return h`<div class="page st">${header(ctx)}<div id="st-panel" role="tabpanel" aria-labelledby="st-tab-${tab}" class="stack-4">${body}</div>${dirtyBar(ctx)}</div>`;
}

// ---------- dialogs ----------
function uploadDnc(ctx) {
  const { t, fmt, icon } = ctx;
  let chosen = null;
  const body = () => h`<div class="stack-3">
    <p class="hint">${t('up.intro')}</p>
    <div class="row"><label class="btn st-filebtn">${icon('upload')}${t('up.choose')}<input type="file" accept=".csv,text/csv" data-u="file" class="sr-only"></label>
      <button type="button" class="btn" data-action="st.up.sample">${icon('file-text')}${t('up.sample')}</button></div>
    <div data-u="out">${chosen ? h`<div class="note">${icon('file')}<span><strong translate="no">${chosen.name}</strong> · ${t('up.size', { kb: fmt.num(chosen.size / 1024, 1) })}</span></div>` : h`<span class="hint-xs">${t('up.none')}</span>`}</div>
    <div class="note note-warn">${icon('alert')}<span>${t('up.privacy')}</span></div></div>`;
  const run = (m, file) => {
    chosen = file;
    m.setBody(body());
    const out = m.el.querySelector('[data-u="out"]');
    out.insertAdjacentHTML('beforeend', String(h`<div class="stack" style="gap:6px;margin-top:10px"><span class="hint-xs" data-u="step">${t('up.reading')}</span><span class="progress"><i data-u="bar" style="width:0%"></i></span></div>`));
    const bar = m.el.querySelector('[data-u="bar"]');
    const step = m.el.querySelector('[data-u="step"]');
    m.setButtons([{ label: t('common.cancel') }]);
    let p = 0;
    const iv = setInterval(() => {
      p = Math.min(100, p + (reducedMotion() ? 50 : 17));
      bar.style.width = `${p}%`;
      if (p >= 60) step.textContent = t('up.checking');
      if (p >= 100) {
        clearInterval(iv);
        const added = 120;
        const dup = 3;
        const d = dnc(ctx);
        d.total += added;
        d.updated = fmt.isoDate(nowMs());
        d.by = ctx.store.get('user.name');
        d.rows.unshift({ phone: '084-xxx-1209', at: new Date(nowMs()).toISOString(), by: d.by, reason: 'upload' });
        audit('dnc.uploaded', { n: added });
        m.setBody(h`<div class="note note-ok" role="status">${icon('check-circle')}<span>${t('up.done', { n: fmt.int(added), dup: fmt.int(dup) })}</span></div>`);
        m.setButtons([{ label: t('common.done'), kind: 'navy' }]);
        ctx.ui.toast(t('toast.T33', { n: fmt.int(added) }), { kind: 'success', demo: true });
        if (location.hash.startsWith('#/settings')) ctx.rerender();
      }
    }, 200);
  };
  const m = ctx.ui.modal({
    title: t('up.title'), body: body(),
    buttons: [{ label: t('common.cancel') }],
    actions: { 'st.up.sample': (el, ev, hh) => run(hh, { name: 'dnc_sample_demo.csv', size: 2617 }) },
  });
  m.el.addEventListener('change', (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (f) run(m, { name: f.name, size: f.size }); // name and size only — the file is never read
  });
}

function viewDnc(ctx) {
  const { t, fmt, icon } = ctx;
  let q = '';
  const table = () => {
    const d = dnc(ctx);
    const rows = d.rows.filter((r) => !q || r.phone.replace(/\D/g, '').includes(q.replace(/\D/g, '')) || r.phone.includes(q));
    if (!d.rows.length) return h`<div class="empty empty-center"><span class="art">${icon('shield')}</span><strong>${t('view.empty')}</strong><span class="hint">${t('view.emptyHint')}</span></div>`;
    if (!rows.length) return h`<div class="empty empty-center"><strong>${t('view.none', { q })}</strong></div>`;
    return h`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>${t('view.phone')}</th><th>${t('view.added')}</th><th>${t('view.by')}</th><th><span class="sr-only">${t('view.remove')}</span></th></tr></thead>
      <tbody>${rows.map((r) => h`<tr><td class="mono" translate="no">${r.phone}</td><td class="nowrap">${fmt.dayMonth(r.at)} ${fmt.timeShort(r.at)}</td><td>${t(`dnc.how.${r.reason}`)}${r.reason !== 'press9' ? h` <span class="hint-xs">· ${String(r.by).replace(/^key:/, '')}</span>` : ''}</td>
        <td class="num"><button type="button" class="btn btn-sm btn-ghost" data-action="st.view.remove" data-value="${r.phone}" aria-label="${t('view.removeAria', { phone: r.phone })}">${icon('trash')}</button></td></tr>`)}</tbody></table></div>
      <p class="hint-xs" style="margin-top:8px">${t('view.more', { shown: fmt.int(rows.length), total: fmt.int(d.total) })}</p>`;
  };
  const m = ctx.ui.modal({
    title: t('view.title'), size: 'lg',
    body: h`<div class="stack-3"><input class="input" type="search" data-v="q" placeholder="${t('view.search')}" aria-label="${t('view.search')}" inputmode="tel"><div data-v="table">${table()}</div></div>`,
    buttons: [{ label: t('common.close'), kind: 'navy' }],
    actions: {
      'st.view.remove': (el) => {
        const d = dnc(ctx);
        const i = d.rows.findIndex((r) => r.phone === el.dataset.value);
        if (i < 0) return;
        const [row] = d.rows.splice(i, 1);
        d.total -= 1;
        audit('dnc.removed', {});
        m.el.querySelector('[data-v="table"]').innerHTML = String(table());
        ctx.ui.toast(t('view.removed', { phone: row.phone }), { kind: 'info', timeout: 10000, action: { label: t('common.undo'), onClick: () => { d.rows.splice(i, 0, row); d.total += 1; const tb = m.el.querySelector('[data-v="table"]'); if (tb) tb.innerHTML = String(table()); if (location.hash.startsWith('#/settings')) ctx.rerender(); } } });
        if (location.hash.startsWith('#/settings')) ctx.rerender();
      },
    },
  });
  m.el.querySelector('[data-v="q"]').addEventListener('input', (ev) => { q = ev.target.value.trim(); m.el.querySelector('[data-v="table"]').innerHTML = String(table()); });
}

function connectLine(ctx) {
  const { t } = ctx;
  // Sample QR-like pattern (not a real code): a deterministic 21×21 grid with the three finder squares.
  const N = 21;
  const cells = [];
  const finder = (x, y) => (x < 7 && y < 7) || (x >= N - 7 && y < 7) || (x < 7 && y >= N - 7);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let on;
    if (finder(x, y)) { const fx = x >= N - 7 ? x - (N - 7) : x; const fy = y >= N - 7 ? y - (N - 7) : y; on = fx === 0 || fx === 6 || fy === 0 || fy === 6 || (fx >= 2 && fx <= 4 && fy >= 2 && fy <= 4); } else on = ((x * 7 + y * 13 + x * y) % 5) < 2;
    if (on) cells.push(`<rect x="${x}" y="${y}" width="1" height="1"/>`);
  }
  const qr = `<svg viewBox="-1 -1 ${N + 2} ${N + 2}" class="st-qr" role="img" aria-label="${ctx.esc(t('line.qrAria'))}"><rect x="-1" y="-1" width="${N + 2}" height="${N + 2}" fill="#fff"/><g fill="#14274A">${cells.join('')}</g></svg>`;
  ctx.ui.modal({
    title: t('line.title'),
    body: h`<div class="st-line-modal"><div>${raw(qr)}<span class="hint-xs">${t('line.sample')}</span></div>
      <ol class="stack" style="margin:0;padding-left:18px"><li>${t('line.s1')}</li><li>${t('line.s2')}</li><li>${t('line.s3')}</li></ol></div>`,
    buttons: [{ label: t('common.cancel') }, { label: t('line.done'), kind: 'navy', icon: 'check', onClick: (hh, btn) => {
      busy(btn, 700).then(() => {
        ctx.store.set('alertChannels.lineGroup', 'Example Trading ops');
        hh.close();
        ctx.ui.toast(t('line.connected', { name: 'Example Trading ops' }), { kind: 'success', demo: true });
      });
      return false;
    } }],
  });
}

// ---------- behaviour ----------
function setTab(ctx, tab) {
  ctx.setState({ tab });
  const raw2 = `settings?tab=${tab}`;
  ctx.state._raw = raw2;
  ctx.params.raw = raw2;
  history.replaceState(history.state, '', `${location.pathname}${location.search}#/${raw2}`);
}

async function save(ctx, btn) {
  const { t } = ctx;
  const d = ctx.state.draft;
  const c = d.compliance;
  if (c.wdFrom >= c.wdTo || c.weFrom >= c.weTo) { setTab(ctx, 'compliance'); ctx.ui.toast(t('hours.bad'), { kind: 'warn' }); return; }
  if (d.security.ips.split(/[\s,]+/).filter(Boolean).some((x) => !IP_RE.test(x))) { setTab(ctx, 'security'); ctx.ui.toast(t('sec.ipFix'), { kind: 'warn' }); return; }
  await busy(btn, 500);
  const before = ctx.state.saved;
  const changedTabs = TABS.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(d[k]));
  ctx.state.saved = clone(d);
  ctx.state.draft = null;
  // Values other screens read go to the store: the organisation name and the one alert webhook.
  if (d.general.name && d.general.name !== before.general.name) ctx.store.set('org.name', { ...(ctx.store.get('org.name') || {}), [ctx.lang]: d.general.name });
  if (d.notifications.webhook !== before.notifications.webhook) ctx.store.set('alertChannels.webhook', d.notifications.webhook || null);
  for (const k of changedTabs) audit('settings.saved', { tab: k });
  ctx.rerender();
  ctx.ui.toast(t('toast.T02'), { kind: 'success' });
}

export function mount(root, ctx) {
  const { t, fmt } = ctx;
  ctx.actions(root, {
    'st.tab': (el) => setTab(ctx, el.dataset.value),
    'st.dirty.discard': () => { ctx.state.draft = null; ctx.rerender(); ctx.ui.toast(t('dirty.discarded'), { kind: 'info' }); },
    'st.dirty.save': (el) => save(ctx, el),
    'st.hours.holidays': () => setVal(ctx, 'compliance.holidays', !cur(ctx).compliance.holidays, true),
    'st.rec.toggle': async () => {
      const on = cur(ctx).compliance.recOn;
      if (on) {
        const ok = await ctx.ui.confirm({ title: t('rec.offTitle'), body: t('rec.offBody'), confirmLabel: t('rec.offYes'), cancelLabel: t('rec.offKeep'), danger: true });
        if (!ok) return;
      }
      setVal(ctx, 'compliance.recOn', !on, true);
    },
    'st.rec.stop': () => setVal(ctx, 'compliance.recStop', !cur(ctx).compliance.recStop, true),
    'st.rec.lang': (el) => { if (ctx.state.speaking) ctx.ui.audio.tts.stop(); ctx.setState({ recLang: el.dataset.value, speaking: false }); },
    'st.rec.listen': () => {
      if (ctx.state.speaking) { ctx.ui.audio.tts.stop(); ctx.setState({ speaking: false }); return; }
      const code = ctx.state.recLang;
      const sp = ctx.ui.audio.tts.speak(tIn(code, 'rec.text', undefined, 'settings'), { lang: LANGS[code].tts });
      ctx.setState({ speaking: true });
      sp.done.then(() => { if (ctx.state.speaking) { ctx.state.speaking = false; if (location.hash.startsWith('#/settings')) ctx.rerender(); } });
    },
    'st.dnc.check': (el) => {
      const q = (ctx.state.check && ctx.state.check.q) || '';
      const digits = q.replace(/\D/g, '');
      busy(el, 400).then(() => {
        if (digits.length < 4) { ctx.setState({ check: { q, result: 'bad' } }); return; }
        const row = dnc(ctx).rows.find((r) => r.phone.replace(/\D/g, '').slice(-4) === digits.slice(-4) && (digits.length < 9 || r.phone.slice(0, 3) === `${digits.slice(0, 3)}`));
        const phone = row ? row.phone : `${digits.slice(0, 3)}-xxx-${digits.slice(-4)}`;
        ctx.setState({ check: { q, result: row ? 'on' : 'off', row, phone } });
      });
    },
    'st.dnc.upload': () => uploadDnc(ctx),
    'st.dnc.view': () => viewDnc(ctx),
    'st.dnc.export': () => {
      const d = dnc(ctx);
      const rows = d.rows.map((r) => ({ phone: r.phone, added_at: fmt.iso(r.at), added_by: r.reason === 'press9' ? 'pressed 9' : r.by, reason: r.reason }));
      if (!rows.length) rows.push({ phone: '', added_at: '', added_by: '', reason: '' });
      ctx.ui.csv(`ants-dnc_${fmt.isoDate(nowMs())}.csv`, rows, ['phone', 'added_at', 'added_by', 'reason']);
    },
    'st.sec.2fa': async (el) => {
      const v = el.dataset.value;
      if (v === cur(ctx).security.twofa) return;
      if (v === 'everyone') {
        const n = ctx.list('members').filter((m) => !m.twoFactor && !m.pending).length;
        const ok = await ctx.ui.confirm({ title: t('sec.allTitle'), body: t('sec.allBody', { count: n, n }), confirmLabel: t('sec.allYes'), cancelLabel: t('common.cancel') });
        if (!ok) return;
      }
      setVal(ctx, 'security.twofa', v, true);
    },
    'st.ntf.line': () => connectLine(ctx),
    'st.ntf.test': async (el) => {
      const url = cur(ctx).notifications.webhook.trim();
      await busy(el, 700);
      const ok = /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/\S*)?$/i.test(url);
      ctx.setState({ whResult: ok ? { ok: true, code: 200, ms: 160 } : { ok: false } });
      if (ok) ctx.ui.toast(t('toast.T10', { code: 200, ms: 160 }), { kind: 'success', demo: true });
    },
  });
  ctx.inputs(root, {
    'st.gen.name': (v) => setVal(ctx, 'general.name', v),
    'st.gen.tz': (v) => setVal(ctx, 'general.tz', v),
    'st.gen.lang': (v) => setVal(ctx, 'general.lang', v),
    'st.gen.cid': (v) => setVal(ctx, 'general.cid', v),
    'st.gen.sub': (v) => setVal(ctx, 'general.sub', v),
    'st.gen.ring': (v) => setVal(ctx, 'general.ring', Number(v)),
    'st.gen.voice': (v) => setVal(ctx, 'general.voice', v),
    'st.dnc.q': (v) => { ctx.state.check = { ...(ctx.state.check || {}), q: v, result: null }; },
    'st.hours.wdFrom': (v) => setVal(ctx, 'compliance.wdFrom', v, true),
    'st.hours.wdTo': (v) => setVal(ctx, 'compliance.wdTo', v, true),
    'st.hours.weFrom': (v) => setVal(ctx, 'compliance.weFrom', v, true),
    'st.hours.weTo': (v) => setVal(ctx, 'compliance.weTo', v, true),
    'st.rec.retention': (v) => setVal(ctx, 'compliance.retention', Number(v)),
    'st.purpose': (v) => setVal(ctx, 'compliance.purpose', v, true),
    'st.cap': (v) => setVal(ctx, 'compliance.cap', Number(v)),
    'st.ntf.webhook': (v) => { ctx.state.whResult = null; setVal(ctx, 'notifications.webhook', v); },
    'st.sec.ip': (v, el) => {
      setVal(ctx, 'security.ips', v);
      const bad = v.split(/[\s,]+/).filter(Boolean).filter((x) => !IP_RE.test(x));
      const hint = root.querySelector('#st-ip-h');
      el.setAttribute('aria-invalid', String(bad.length > 0));
      if (hint) { hint.className = bad.length ? 'field-err' : 'hint-xs'; hint.textContent = bad.length ? t('sec.ipBad', { ip: bad[0] }) : t('sec.ipHint'); }
    },
    'st.sec.timeout': (v) => setVal(ctx, 'security.timeout', v),
    ...Object.fromEntries(EVENTS.flatMap((e) => CHANNELS.map((c) => [`st.ntf.${e}.${c}`, (v) => setVal(ctx, `notifications.matrix.${e}.${c}`, !!v, true)]))),
  });
  ctx.on(root, 'keydown', '[data-field="st.dnc.q"]', (ev) => { if (ev.key === 'Enter' && !ev.isComposing && ev.keyCode !== 229) { ev.preventDefault(); const b = root.querySelector('[data-action="st.dnc.check"]'); if (b) b.click(); } });
  ctx.on(root, 'keydown', '[role="tab"]', (ev, el) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(ev.key)) return;
    ev.preventDefault();
    const i = TABS.indexOf(el.dataset.value);
    const next = ev.key === 'Home' ? 0 : ev.key === 'End' ? TABS.length - 1 : (i + (ev.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length;
    setTab(ctx, TABS[next]);
    ctx.later(() => { const b = root.querySelector(`#st-tab-${TABS[next]}`); if (b) b.focus(); }, 0);
  });
  // Leaving with unsaved changes asks first (UX dead-click note: sticky bar + leave guard).
  ctx.guard(() => (dirty(ctx) ? ctx.ui.confirm({ title: t('dirty.leaveTitle'), body: t('dirty.leaveBody'), confirmLabel: t('dirty.leaveYes'), cancelLabel: t('dirty.leaveStay'), danger: true }).then((ok) => { if (ok) ctx.state.draft = null; return ok; }) : true));
  ctx.cleanup(() => { if (ctx.state.speaking && !location.hash.startsWith('#/settings')) { ctx.ui.audio.tts.stop(); ctx.state.speaking = false; } });
  ctx.watch('alertChannels', 'mode', 'numbers', 'subAccounts', 'members');
}
