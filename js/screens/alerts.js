// Alerts — #/alerts   (query: ?rule=<rule id>|new)
// Rules (spend near limit, failure rate, trunk down, answer-rate drop, low credits, unusual calling pattern = OTP abuse
// and toll fraud), a rule editor with "Send test" (animated → toast + bell item), recent alerts with acknowledge, and
// today's incident told step by step. Alerts only notify; the daily spending limit in
// Billing is what blocks calls.

import { html as h, raw, reducedMotion } from '../core/dom.js';
import { notify, audit, newId } from '../core/actions.js';
import { nowMs } from '../data/clock.js';
import { has } from '../core/i18n.js';

export const id = 'alerts';
export const nav = { group: 'operate', icon: 'bell', labelKey: 'nav.alerts' };
export const titleKey = 'nav.alerts';
export const skeleton = 'table';
export const css = true;
export const initialState = { panel: 'new', form: null, test: null, story: true, fresh: null, _raw: null };

export const commands = [
  { id: 'new', labelKey: 'cmd.new', icon: 'plus', keywords: ['alert rule new notify failure rate trunk down'], run: ({ go }) => go('alerts?rule=new') },
];

const TYPES = ['failure-rate', 'trunk-down', 'answer-rate-drop', 'low-credits', 'spend-near-limit', 'unusual-pattern'];
const TYPE_ICON = { 'failure-rate': 'alert', 'trunk-down': 'server', 'answer-rate-drop': 'chart-line', 'low-credits': 'coin', 'spend-near-limit': 'shield', 'unusual-pattern': 'shield-check' };
const DEFAULTS = {
  'failure-rate': { pct: 10, windowMin: 15, minCalls: 50 },
  'trunk-down': { misses: 3 },
  'answer-rate-drop': { pct: 50, windowMin: 30 },
  'low-credits': { below: 5000 },
  'spend-near-limit': { pct: 80 },
  'unusual-pattern': { newNumbersPerHour: 300 },
};
const FIELDS = {
  'failure-rate': [['pct', 1, 100], ['windowMin', 5, 60], ['minCalls', 10, 1000]],
  'trunk-down': [['misses', 1, 10]],
  'answer-rate-drop': [['pct', 5, 95], ['windowMin', 10, 120]],
  'low-credits': [['below', 100, 1000000]],
  'spend-near-limit': [['pct', 10, 100]],
  'unusual-pattern': [['newNumbersPerHour', 20, 5000]],
};
const CHANNELS = ['email', 'line', 'webhook'];
const C1 = 'bc_01JBK7C1Q2';
/** Feature-detect the global bell type for test alerts. */
const TEST_NOTIF_KEY = 'notif.alertTest.title';

const rules = (ctx) => ctx.list('alertRules');
const history = (ctx) => ctx.list('alertHistory');
const channelsInfo = (ctx) => ctx.store.get('alertChannels') || { emails: [], lineGroup: null, webhook: null };

function ruleName(ctx, r) { return r.name ? ctx.loc(r.name) : ctx.t(`type.${r.type}`); }
function condition(ctx, type, c) {
  const { fmt, t } = ctx;
  const v = { ...DEFAULTS[type], ...(c || {}) };
  return t(`cond.${type}`, { pct: fmt.int(v.pct), window: fmt.int(v.windowMin), min: fmt.int(v.minCalls), n: fmt.int(v.misses ?? v.newNumbersPerHour ?? 0), below: fmt.int(v.below) });
}
function blankForm(type = 'failure-rate') {
  return { id: null, type, ...DEFAULTS[type], channels: { email: true, line: true, webhook: false }, errs: {} };
}
function formFrom(rule) {
  return { id: rule.id, type: rule.type, ...DEFAULTS[rule.type], ...(rule.condition || {}), channels: Object.fromEntries(CHANNELS.map((c) => [c, (rule.channels || []).includes(c)])), errs: {} };
}
function channelList(ctx, chans) { return chans.map((c) => ctx.t(`ch.${c}`)).join(' · '); }

/** Busy button for a simulated server call. */
function busy(btn, ms = 600) {
  return new Promise((resolve) => {
    const prev = btn ? btn.innerHTML : '';
    if (btn) { btn.setAttribute('aria-busy', 'true'); const ico = btn.querySelector('svg.ico'); const sp = document.createElement('span'); sp.className = 'spin'; if (ico) ico.replaceWith(sp); else btn.prepend(sp); }
    setTimeout(() => { if (btn && btn.isConnected) { btn.removeAttribute('aria-busy'); btn.innerHTML = prev; } resolve(); }, reducedMotion() ? Math.min(ms, 300) : ms);
  });
}

// ---------- pieces ----------
function header(ctx) {
  const { t, icon } = ctx;
  return h`<div class="page-head"><div class="titles"><h1>${t('title')}${ctx.pageHelp()}</h1><span class="sub">${t('sub')}</span></div>
    <div class="tools"><button type="button" class="btn btn-primary" data-action="al.new">${icon('plus')}${t('new')}</button></div></div>
    <div class="note note-info al-limits">${icon('info')}<div class="grow">${ctx.tm('limitsNote')}</div>
      <a class="btn btn-sm" href="#/billing?panel=limits" data-action="al.limits">${icon('shield')}${t('openLimits')}</a></div>`;
}

function tiles(ctx) {
  const { t, fmt } = ctx;
  const list = rules(ctx);
  const on = list.filter((r) => r.on).length;
  const day = history(ctx).filter((a) => nowMs() - new Date(a.at).getTime() < 86400000);
  const acked = day.filter((a) => a.status !== 'open').length;
  const lim = ctx.store.get('limits') || {};
  const used = (ctx.store.get('billing.usedToday') || {}).total || 0;
  const ch = channelsInfo(ctx);
  const nCh = (ch.emails && ch.emails.length ? 1 : 0) + (ch.lineGroup ? 1 : 0) + (ch.webhook ? 1 : 0);
  return h`<div class="grid g-4 al-tiles">
    <div class="card tile"><span class="t">${t('tile.active')}</span><span class="v">${fmt.int(on)} <small>/ ${fmt.int(list.length)}</small></span><span class="h">${list.some((r) => r.recommended && !r.on) ? t('tile.activeRec') : t('tile.activeLine')}</span></div>
    <div class="card tile"><span class="t">${t('tile.fired')}</span><span class="v">${fmt.int(day.length)}</span><span class="h">${t('tile.firedLine', { n: fmt.int(acked) })}</span></div>
    <a class="card tile al-tile-link" href="#/billing?panel=limits" data-action="al.tile.spend"><span class="t">${t('tile.spend')}</span><span class="v">${fmt.int(used)} <small>/ ${fmt.int(lim.daily || 0)}</small></span><span class="h">${t('tile.spendLine')}</span></a>
    <a class="card tile al-tile-link" href="#/settings?tab=notifications" data-action="al.tile.channels"><span class="t">${t('tile.channels')}</span><span class="v">${fmt.int(nCh)}</span><span class="h">${t('tile.channelsLine', { emails: fmt.int((ch.emails || []).length), line: ch.lineGroup ? 1 : 0, wh: ch.webhook ? 1 : 0 })}</span></a>
  </div>`;
}

function story(ctx) {
  const { t, icon, fmt } = ctx;
  const a = history(ctx).find((x) => x.id === 'alr_20261027_1423');
  if (!a) return '';
  const open = ctx.state.story;
  const steps = [
    ['13:58', 'trunk', 'err'], ['14:02', 'ticket', 'info'], ['14:05', 'ackTrunk', 'ok'], ['14:06', 'start', 'err'],
    ['14:23', 'fired', 'warn'], ['14:24', 'backup', 'ok'], ['14:33', 'resolved', 'ok'],
  ];
  return h`<section class="card al-story" aria-labelledby="al-story-h">
    <div class="card-head"><h2 id="al-story-h">${icon('activity')}${t('story.title')}</h2><span class="hint">${t('story.sub')}</span>
      <button type="button" class="btn btn-sm btn-ghost" data-action="al.story.toggle" aria-expanded="${open}">${icon(open ? 'chevron-up' : 'chevron-down')}${open ? t('story.hide') : t('story.show')}</button></div>
    ${open ? h`<div class="card-body"><ol class="al-tl">${steps.map(([time, key, tone]) => h`<li class="al-tl-${tone}"><span class="al-tl-dot"></span><span class="al-tl-time mono">${time}</span>
        <div class="grow"><strong>${t(`story.${key}.t`)}</strong><span class="hint">${t(`story.${key}.d`, { pct: a.details.pct, failed: a.details.failed, of: a.details.of })}</span></div></li>`)}</ol>
      <div class="row al-story-actions">
        <a class="btn btn-sm" href="#/logs?status=failed&src=${C1}&range=24h" data-action="al.ev.logs" data-value="${a.id}">${icon('list')}${t('ev.logs')}</a>
        <a class="btn btn-sm" href="#/help/status?inc=20261027" data-action="al.ev.status" data-value="${a.id}">${icon('activity')}${t('ev.status')}</a>
        <a class="btn btn-sm" href="#/help/tickets/SUP-10452" data-action="al.story.ticket">${icon('ticket')}${t('story.ticket')}</a>
        ${a.status === 'open' ? h`<button type="button" class="btn btn-sm btn-navy" data-action="al.ev.ack" data-value="${a.id}">${icon('check')}${t('ev.ack')}</button>`
          : h`<span class="chip chip-ok">${icon('check')}${t('ev.ackedBy', { name: a.by || '', time: a.byAt || fmt.timeShort(nowMs()) })}</span>`}
      </div><p class="hint-xs">${t('story.note')}</p></div>` : ''}
  </section>`;
}

function rulesCard(ctx) {
  const { t, fmt, icon } = ctx;
  const list = rules(ctx);
  if (!list.length) {
    return h`<section class="card al-rules" aria-labelledby="al-rules-h"><div class="card-head"><h2 id="al-rules-h">${t('rules.title')}</h2></div>
      <div class="empty"><span class="art">${icon('bell')}</span><strong>${t('rules.empty')}</strong><span class="hint">${t('rules.emptyHint')}</span>
      <div class="row"><button type="button" class="btn btn-sm btn-navy" data-action="al.recommended">${icon('sparkles')}${t('rules.addRecommended')}</button>
      <a class="btn btn-sm" href="#/help/article/spending-limits" data-action="al.rules.learn">${icon('book')}${t('common.learnMore')}</a></div></div></section>`;
  }
  const last = (r) => {
    if (!r.lastFired) return h`<span class="hint">${t('rules.never')}</span>`;
    const today = fmt.isoDate(r.lastFired) === fmt.isoDate(nowMs());
    return today ? h`<span class="err-text strong">${t('rules.today', { time: fmt.timeShort(r.lastFired) })}</span>` : h`<span class="hint">${fmt.dayMonth(r.lastFired)} ${fmt.timeShort(r.lastFired)}</span>`;
  };
  return h`<section class="card al-rules" aria-labelledby="al-rules-h"><div class="card-head"><h2 id="al-rules-h">${t('rules.title')}</h2><span class="hint">${t('rules.sub')}</span></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>${t('rules.rule')}</th><th>${t('rules.cond')}</th><th>${t('rules.channels')}</th><th>${t('rules.on')}</th><th>${t('rules.last')}</th><th><span class="sr-only">${t('rules.more')}</span></th></tr></thead>
    <tbody>${list.map((r) => h`<tr class="al-row ${ctx.state.panel === r.id ? 'is-sel' : ''} ${ctx.state.fresh === r.id ? 'new-row' : ''}" data-action="al.row" data-value="${r.id}" tabindex="0" aria-selected="${ctx.state.panel === r.id}">
      <td class="al-name"><span class="row-tight"><span class="al-ico">${icon(TYPE_ICON[r.type])}</span><span class="strong">${ruleName(ctx, r)}</span></span>${r.recommended && !r.on ? h` <span class="chip chip-brand">${t('rules.recommended')}</span>` : ''}</td>
      <td class="al-cond">${condition(ctx, r.type, r.condition)}</td>
      <td><span class="row-tight" style="flex-wrap:wrap">${(r.channels || []).map((c) => h`<span class="chip">${t(`ch.${c}`)}</span>`)}</span></td>
      <td><button type="button" class="toggle" role="switch" aria-checked="${!!r.on}" data-action="al.toggle" data-value="${r.id}" aria-label="${t('rules.toggleAria', { name: ruleName(ctx, r) })}"></button></td>
      <td class="nowrap">${last(r)}</td>
      <td class="num"><button type="button" class="btn btn-ghost btn-sm btn-icon" data-action="al.row.menu" data-value="${r.id}" aria-label="${t('rules.more')}" aria-haspopup="menu">${icon('more')}</button></td></tr>`)}</tbody></table></div></section>`;
}

function editor(ctx) {
  const { t, fmt, icon } = ctx;
  const f = ctx.state.form;
  const editing = f.id && rules(ctx).find((r) => r.id === f.id);
  const ch = channelsInfo(ctx);
  const test = ctx.state.test;
  const chosen = CHANNELS.filter((c) => f.channels[c]);
  const target = { email: (ch.emails || []).join(', ') || t('send.noEmail'), line: ch.lineGroup ? `"${ch.lineGroup}"` : t('send.noLine'), webhook: ch.webhook || t('send.noWebhook') };
  const avail = { email: !!(ch.emails && ch.emails.length), line: !!ch.lineGroup, webhook: !!ch.webhook };
  return h`<section class="card al-editor" aria-labelledby="al-ed-h" id="al-editor">
    <div class="card-head"><h2 id="al-ed-h">${editing ? t('ed.edit', { name: ruleName(ctx, editing) }) : t('ed.new')}</h2>
      ${editing ? h`<button type="button" class="btn btn-sm btn-ghost" data-action="al.new">${icon('plus')}${t('new')}</button>` : ''}</div>
    <div class="card-body stack-3">
      <fieldset class="field al-types"><legend class="label">${t('ed.type')}</legend>
        <div class="al-type-grid" role="radiogroup" aria-label="${t('ed.type')}">${TYPES.map((ty) => h`<button type="button" class="optcard al-type" role="radio" aria-checked="${f.type === ty}" data-action="al.type" data-value="${ty}">
          <span class="row-tight">${icon(TYPE_ICON[ty])}<span class="t">${t(`type.${ty}`)}</span></span><span class="h">${t(`typeHint.${ty}`)}</span></button>`)}</div></fieldset>
      <div class="al-fields">${FIELDS[f.type].map(([k, min, max]) => h`<label class="field"><span class="label">${t(`field.${k}`)}</span>
        <input class="input tnum" inputmode="numeric" data-field="al.f.${k}" value="${fmt.int(f[k])}" aria-invalid="${!!f.errs[k]}" aria-describedby="al-err-${k}">
        <span class="field-err" id="al-err-${k}" ${raw(f.errs[k] ? '' : 'hidden')}>${t('ed.range', { min: fmt.int(min), max: fmt.int(max) })}</span></label>`)}</div>
      <p class="hint-xs">${t('ed.preview')} <strong>${condition(ctx, f.type, f)}</strong></p>
      <fieldset class="field"><legend class="label">${t('send.title')}</legend>
        ${CHANNELS.map((c) => h`<label class="check al-send"><input type="checkbox" data-field="al.send.${c}" data-action="al.send.${c}" ${raw(f.channels[c] ? 'checked' : '')} ${raw(avail[c] ? '' : 'disabled')}><span><strong>${t(`ch.${c}`)}</strong> <span class="hint-xs mono" translate="no">${target[c]}</span></span></label>`)}
        ${!avail.line || !avail.webhook ? h`<a class="linkbtn al-setup" href="#/settings?tab=notifications" data-action="al.send.setup">${t('send.setup')}</a>` : ''}
        ${f.errs.channels ? h`<span class="field-err">${t('send.none')}</span>` : ''}</fieldset>
      ${test ? h`<ol class="al-test" aria-live="polite">${['check', ...test.channels].map((c, i) => h`<li class="${i < test.step ? 'is-done' : i === test.step ? 'is-run' : ''}">
          <span class="al-test-ico">${i < test.step ? icon('check') : i === test.step ? raw('<span class="spin"></span>') : ''}</span>${c === 'check' ? t('test.check') : t('test.sending', { ch: t(`ch.${c}`) })}</li>`)}
        ${test.step > test.channels.length ? h`<li class="is-done al-test-done"><span class="al-test-ico">${icon('check-circle')}</span>${t('test.done')}</li>` : ''}</ol>` : ''}
      <div class="row al-ed-actions">
        <button type="button" class="btn" data-action="al.test" ${raw(test && test.step <= test.channels.length ? 'aria-disabled="true"' : '')}>${icon('send')}${t('ed.test')}</button>
        <button type="button" class="btn btn-navy" data-action="al.save">${icon('check')}${t('ed.save')}</button>
        ${editing ? h`<button type="button" class="btn btn-ghost btn-danger-ghost" data-action="al.ed.delete" data-value="${editing.id}">${icon('trash')}${t('menu.delete')}</button>` : ''}
      </div>
      <p class="hint-xs">${t('ed.note', { n: chosen.length })}</p>
    </div></section>`;
}

function historyCard(ctx) {
  const { t, fmt, icon } = ctx;
  const list = history(ctx);
  const open = list.filter((a) => a.status === 'open').length;
  const camp = (ref) => { const c = ctx.list('campaigns').find((x) => x.id === ref); return c ? ctx.loc(c.name) : ref || ''; };
  const details = (a) => {
    if (a.rule === 'failure-rate') return t('hist.failure', { campaign: camp(a.ref), pct: a.details.pct, failed: a.details.failed, of: a.details.of, sip: a.details.sip, time: a.details.movedAt });
    if (a.rule === 'trunk-down') return t('hist.trunk', { trunk: a.ref });
    if (a.rule === 'answer-rate-drop') return t('hist.answer', { pct: a.details.pct, window: a.details.windowMin });
    if (a.rule === 'low-credits') return t('hist.credits', { balance: fmt.int(a.details.balance), below: fmt.int(5000) });
    if (a.rule === 'test') return t('hist.test', { name: a.details.name });
    return a.rule;
  };
  const status = (a) => {
    if (a.status === 'open') return h`<span class="chip chip-err"><span class="dot dot-err"></span>${t('hist.open')}</span>`;
    if (a.status === 'acknowledged') return h`<span class="chip chip-warn" tabindex="0" data-tip="${t('ev.ackedBy', { name: a.by || '', time: a.byAt || '' })}">${t('hist.acked')}</span><span class="hint-xs al-by">${t('ev.ackedBy', { name: a.by || '', time: a.byAt || '' })}</span>`;
    if (a.status === 'test') return h`<span class="chip chip-navy">${t('hist.testChip')}</span>`;
    return h`<span class="chip chip-ok">${t('hist.resolved')}${a.resolvedAt ? ` ${a.resolvedAt}` : ''}</span>`;
  };
  const actions = (a) => h`${a.rule === 'failure-rate' ? h`<a class="btn btn-sm" href="#/logs?status=failed&src=${a.ref}&range=24h" data-action="al.ev.logs" data-value="${a.id}">${t('ev.logs')}</a>` : ''}
    ${a.rule === 'trunk-down' ? h`<a class="btn btn-sm" href="#/trunks/${a.ref}" data-action="al.ev.trunk" data-value="${a.id}">${t('ev.trunk')}</a>` : ''}
    ${a.rule === 'failure-rate' && a.id === 'alr_20261027_1423' ? h`<a class="btn btn-sm" href="#/help/status?inc=20261027" data-action="al.ev.status" data-value="${a.id}">${t('ev.status')}</a>` : ''}
    ${a.status === 'open' ? h`<button type="button" class="btn btn-sm btn-navy" data-action="al.ev.ack" data-value="${a.id}">${t('ev.ack')}</button>` : ''}`;
  return h`<section class="card al-hist" aria-labelledby="al-hist-h"><div class="card-head"><h2 id="al-hist-h">${t('hist.title')}</h2>
      <button type="button" class="btn btn-sm" data-action="al.ev.ackall" ${raw(open ? '' : 'aria-disabled="true" aria-describedby="al-ackall-h"')}>${t('ev.ackAll')}</button>
      ${open ? '' : h`<span class="hint-xs" id="al-ackall-h">${t('hist.noneOpen')}</span>`}</div>
    ${list.length ? h`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>${t('hist.time')}</th><th>${t('hist.rule')}</th><th>${t('hist.details')}</th><th>${t('hist.sentTo')}</th><th>${t('hist.status')}</th></tr></thead>
      <tbody>${list.map((a) => h`<tr class="${ctx.state.fresh === a.id ? 'new-row' : ''}"><td class="nowrap mono">${fmt.dayMonth(a.at)} ${fmt.timeShort(a.at)}</td>
        <td class="strong nowrap">${a.rule === 'test' ? t('hist.testRule') : t(`type.${a.rule}`)}<span class="hint-xs mono al-time-m">${fmt.dayMonth(a.at)} ${fmt.timeShort(a.at)}</span></td><td class="al-details">${details(a)}${a.rule === 'failure-rate' || a.rule === 'trunk-down' || a.status === 'open' ? h`<span class="row-tight al-acts" role="group" aria-label="${t('hist.actions')}">${actions(a)}</span>` : ''}</td>
        <td><span class="row-tight" style="flex-wrap:wrap">${(a.sentTo || []).map((c) => h`<span class="chip">${t(`ch.${c}`)}</span>`)}</span></td>
        <td><span class="stack" style="gap:2px;align-items:flex-start">${status(a)}</span></td></tr>`)}</tbody></table></div>`
    : h`<div class="empty"><span class="art">${icon('check-circle')}</span><strong>${t('hist.empty')}</strong><span class="hint">${t('hist.emptyHint')}</span></div>`}</section>`;
}

// ---------- screen contract ----------
function sync(ctx) {
  if (!ctx.state.form) ctx.state.form = blankForm();
  if (ctx.state._raw === ctx.params.raw) return;
  ctx.state._raw = ctx.params.raw;
  const r = ctx.params.query.rule;
  if (r === 'new') { ctx.state.panel = 'new'; ctx.state.form = blankForm(); ctx.state.test = null; }
  else if (r) { const rule = rules(ctx).find((x) => x.id === r); if (rule) { ctx.state.panel = rule.id; ctx.state.form = formFrom(rule); ctx.state.test = null; } }
}

export function render(ctx) {
  sync(ctx);
  return h`<div class="page al">${header(ctx)}${tiles(ctx)}${story(ctx)}
    <div class="grid al-main">${rulesCard(ctx)}${editor(ctx)}</div>${historyCard(ctx)}</div>`;
}

// ---------- behaviour ----------
function validate(ctx) {
  const f = ctx.state.form;
  const errs = {};
  for (const [k, min, max] of FIELDS[f.type]) { const v = Number(f[k]); if (!Number.isFinite(v) || v < min || v > max) errs[k] = true; }
  if (!CHANNELS.some((c) => f.channels[c])) errs.channels = true;
  f.errs = errs;
  return !Object.keys(errs).length;
}

function runTest(ctx, btn) {
  const { t } = ctx;
  if (!validate(ctx)) { ctx.rerender(); return; }
  const f = ctx.state.form;
  const chans = CHANNELS.filter((c) => f.channels[c]);
  const token = Symbol('test');
  ctx.setState({ test: { step: 0, channels: chans, token } });
  const step = reducedMotion() ? 200 : 450;
  const tick = (n) => setTimeout(() => {
    const s = ctx.state.test;
    if (!s || s.token !== token) return;
    s.step = n;
    if (location.hash.startsWith('#/alerts')) ctx.rerender();
    if (n <= chans.length) { tick(n + 1); return; }
    const name = f.id ? ruleName(ctx, rules(ctx).find((r) => r.id === f.id) || { type: f.type }) : t(`type.${f.type}`);
    ctx.ui.toast(t('toast.T27', { channels: chans.map((c) => t(`ch.${c}`)).join(', ') }), { kind: 'success', demo: true });
    // Bell item: the test-alert wording, or (if it is missing) the real alert's own wording for the two rule types that have one.
    if (has(TEST_NOTIF_KEY)) notify('alertTest', { vars: { rule: name }, href: 'alerts' });
    else if (f.type === 'failure-rate') notify('failureRate', { vars: { pct: f.pct, window: f.windowMin, campaign: t('test.bellCampaign') }, href: 'alerts' });
    else if (f.type === 'trunk-down') notify('trunkDown', { vars: { trunk: t('test.bellTrunk') }, href: 'alerts' });
    ctx.store.update('alertHistory', (l) => [{ id: newId('alr'), at: new Date(nowMs()).toISOString(), rule: 'test', details: { name }, sentTo: chans, status: 'test' }, ...(l || [])]);
    audit('alert.test.sent', { rule: f.type, channels: chans });
    setTimeout(() => { const s2 = ctx.state.test; if (s2 && s2.token === token) { ctx.state.test = null; if (location.hash.startsWith('#/alerts')) ctx.rerender(); } }, 2600);
  }, step);
  tick(1);
}

async function deleteRule(ctx, ruleId) {
  const { t } = ctx;
  const r = rules(ctx).find((x) => x.id === ruleId);
  if (!r) return;
  const ok = await ctx.ui.confirm({ title: t('del.title', { name: ruleName(ctx, r) }), body: t('del.body'), confirmLabel: t('del.yes'), cancelLabel: t('del.keep'), danger: true });
  if (!ok) return;
  ctx.store.update('alertRules', (l) => l.filter((x) => x.id !== ruleId));
  if (ctx.state.panel === ruleId) { ctx.state.panel = 'new'; ctx.state.form = blankForm(); }
  audit('alert.rule.deleted', { rule: r.type });
  ctx.ui.toast(t('del.done', { name: ruleName(ctx, r) }), { kind: 'info' });
}

function acknowledge(ctx, ids) {
  const { t, fmt } = ctx;
  const by = ctx.store.get('user.name');
  const at = fmt.timeShort(nowMs());
  ctx.store.update('alertHistory', (l) => l.map((a) => (ids.includes(a.id) && a.status === 'open' ? { ...a, status: 'acknowledged', by, byAt: at } : a)));
  if (ids.includes('alr_20261027_1423') && ctx.store.get('today.alert')) ctx.store.set('today.alert.acknowledged', true);
  for (const x of ids) { const a = history(ctx).find((y) => y.id === x); audit('alert.acknowledged', { rule: a ? a.rule : null, alert: x }); }
  ctx.ui.toast(t('toast.T28'), { kind: 'success' });
}

export function mount(root, ctx) {
  const { t } = ctx;
  const openRule = (id2) => {
    const r = rules(ctx).find((x) => x.id === id2);
    if (!r) return;
    ctx.setState({ panel: r.id, form: formFrom(r), test: null });
    if (window.matchMedia('(max-width: 1279px)').matches) ctx.later(() => { const e = root.querySelector('#al-editor'); if (e) e.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' }); }, 30);
  };
  ctx.actions(root, {
    'al.new': () => {
      ctx.setState({ panel: 'new', form: blankForm(), test: null });
      ctx.later(() => { const e = root.querySelector('#al-editor'); if (e) { e.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' }); const b = e.querySelector('[data-action="al.type"][aria-checked="true"]'); if (b) b.focus({ preventScroll: true }); } }, 30);
    },
    'al.type': (el) => { const f = ctx.state.form; ctx.setState({ form: { ...f, ...DEFAULTS[el.dataset.value], type: el.dataset.value, errs: {} }, test: null }); },
    'al.send.email': () => {}, 'al.send.line': () => {}, 'al.send.webhook': () => {},
    'al.test': (el) => runTest(ctx, el),
    'al.save': async (el) => {
      if (!validate(ctx)) { ctx.rerender(); return; }
      await busy(el, 500);
      const f = ctx.state.form;
      const condition2 = Object.fromEntries(FIELDS[f.type].map(([k]) => [k, Number(f[k])]));
      const channels = CHANNELS.filter((c) => f.channels[c]);
      let rid = f.id;
      if (rid && rules(ctx).some((r) => r.id === rid)) {
        ctx.store.update('alertRules', (l) => l.map((r) => (r.id === rid ? { ...r, type: f.type, condition: condition2, channels } : r)));
      } else {
        rid = newId('rule');
        ctx.store.update('alertRules', (l) => [...(l || []), { id: rid, type: f.type, condition: condition2, channels, on: true, lastFired: null }]);
      }
      audit('alert.rule.saved', { rule: f.type, channels });
      const rule = rules(ctx).find((r) => r.id === rid);
      ctx.setState({ panel: rid, form: formFrom(rule), fresh: rid });
      setTimeout(() => { if (ctx.state.fresh === rid) ctx.state.fresh = null; }, 2000);
      ctx.ui.toast(t('toast.T02'), { kind: 'success' });
    },
    'al.row': (el, ev) => { if (ev.target.closest('.toggle, [data-action="al.row.menu"]')) return; openRule(el.dataset.value); },
    'al.toggle': (el) => {
      const r = rules(ctx).find((x) => x.id === el.dataset.value);
      if (!r) return;
      const on = !r.on;
      ctx.store.update('alertRules', (l) => l.map((x) => (x.id === r.id ? { ...x, on } : x)));
      audit(on ? 'alert.rule.on' : 'alert.rule.off', { rule: r.type });
      ctx.ui.toast(t(on ? 'toast.T29' : 'toast.T29off', { name: ruleName(ctx, r) }), { kind: on ? 'success' : 'info' });
    },
    'al.row.menu': (el) => {
      const r = rules(ctx).find((x) => x.id === el.dataset.value);
      if (!r) return;
      ctx.ui.menu(el, [
        { id: 'al.menu.edit', label: t('menu.edit'), icon: 'edit', onSelect: () => openRule(r.id) },
        { id: 'al.menu.dup', label: t('menu.duplicate'), icon: 'copy', onSelect: () => {
          const copy = { ...r, id: newId('rule'), on: false, lastFired: null, recommended: false };
          ctx.store.update('alertRules', (l) => [...l, copy]);
          ctx.setState({ fresh: copy.id });
          setTimeout(() => { if (ctx.state.fresh === copy.id) ctx.state.fresh = null; }, 2000);
          ctx.ui.toast(t('menu.duplicated', { name: ruleName(ctx, r) }), { kind: 'success' });
        } },
        { sep: true },
        { id: 'al.menu.delete', label: t('menu.delete'), icon: 'trash', danger: true, onSelect: () => deleteRule(ctx, r.id) },
      ], { label: t('rules.more') });
    },
    'al.ed.delete': (el) => deleteRule(ctx, el.dataset.value),
    'al.ev.ack': (el) => acknowledge(ctx, [el.dataset.value]),
    'al.ev.ackall': () => acknowledge(ctx, history(ctx).filter((a) => a.status === 'open').map((a) => a.id)),
    'al.story.toggle': () => ctx.setState({ story: !ctx.state.story }),
    'al.recommended': () => {
      const email = !!(channelsInfo(ctx).emails || []).length;
      const list = TYPES.map((ty) => ({ id: newId('rule'), type: ty, condition: { ...DEFAULTS[ty] }, channels: email ? ['email'] : [], on: ty !== 'unusual-pattern', recommended: ty === 'unusual-pattern', lastFired: null }));
      ctx.store.set('alertRules', list);
      audit('alert.rules.recommended', { n: list.length });
      ctx.ui.toast(t('rules.added', { n: list.length }), { kind: 'success' });
    },
  });
  ctx.inputs(root, {
    ...Object.fromEntries(['pct', 'windowMin', 'minCalls', 'misses', 'below', 'newNumbersPerHour'].map((k) => [`al.f.${k}`, (v) => {
      ctx.state.form[k] = Number(String(v).replace(/[^\d]/g, '')) || 0;
      if (ctx.state.form.errs[k]) { delete ctx.state.form.errs[k]; }
      const p = root.querySelector('.al-editor p.hint-xs strong');
      if (p) p.textContent = condition(ctx, ctx.state.form.type, ctx.state.form);
    }])),
    ...Object.fromEntries(CHANNELS.map((c) => [`al.send.${c}`, (v) => { ctx.state.form.channels[c] = !!v; delete ctx.state.form.errs.channels; }])),
  });
  ctx.on(root, 'keydown', 'tr.al-row', (ev, tr) => { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === tr) { ev.preventDefault(); openRule(tr.dataset.value); } });
  ctx.watch('alertRules', 'alertHistory', 'alertChannels', 'limits', 'billing', 'mode');
}
