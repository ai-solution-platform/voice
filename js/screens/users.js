// Users & Roles — #/users   (tabs ?tab=members|subaccounts|audit · ?invite=1 opens the invite dialog)
// Members and roles (invite, change role, reset 2-step sign-in, remove = typed email), the permission matrix,
// sub-accounts tagged "Preview" (move credits, own allocation, limits, suspend/resume, new), and the audit log
// (filters, search, export CSV, raw event drawer). Destructive actions: low = Undo · medium = confirm · high = typed.

import { html as h, raw, reducedMotion } from '../core/dom.js';
import { audit, newId, balance } from '../core/actions.js';
import { nowMs } from '../data/clock.js';

export const id = 'users';
export const nav = { group: 'account', icon: 'users', labelKey: 'nav.users' };
export const titleKey = 'nav.users';
export const skeleton = 'table';
export const css = true;
export const initialState = { tab: 'members', who: 'all', via: 'all', q: '', fresh: null, _raw: null };

export const commands = [
  { id: 'invite', labelKey: 'cmd.invite', icon: 'plus', keywords: ['invite member user team role'], run: ({ go }) => go('users?tab=members&invite=1') },
  { id: 'audit', labelKey: 'cmd.audit', icon: 'list', keywords: ['audit log history who changed'], run: ({ go }) => go('users?tab=audit') },
];

const TABS = ['members', 'subaccounts', 'audit'];
const INVITE_ROLES = ['admin', 'developer', 'operator', 'viewer'];
const ROLES = ['owner', 'admin', 'developer', 'operator', 'viewer'];
// Permission matrix: y = full · v = view · s = own sub-account · n = no access.
const MATRIX = [
  ['credits', ['y', 'v', 'n', 'n', 'n']],
  ['members', ['y', 'y', 'n', 'n', 'n']],
  ['keys', ['y', 'y', 'y', 'n', 'n']],
  ['numbers', ['y', 'y', 'y', 'v', 'v']],
  ['campaigns', ['y', 'y', 'y', 'y', 'v']],
  ['logs', ['y', 'y', 'y', 's', 's']],
];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const members = (ctx) => ctx.list('members');
const subs = (ctx) => ctx.list('subAccounts');
const me = (ctx) => ctx.store.get('user.email');
const needs2fa = (role) => role === 'owner' || role === 'admin';
const r2 = (n) => Math.round(n * 100) / 100;

function accessLabel(ctx, access) {
  if (!access || access === 'all') return ctx.t('access.all');
  return ctx.ui.describe.sub(access);
}
function allocated(ctx) { return r2(subs(ctx).reduce((s, x) => s + (x.ownAllocation && x.status !== 'closed' ? x.ownAllocation.left : 0), 0)); }
function freeMain(ctx) { return r2(balance() - allocated(ctx)); }
function used7(ctx, subId) { const row = ((ctx.store.get('reports') || {}).bySub || []).find((x) => x.sub === subId); return row ? row.credits : 0; }

function busy(btn, ms = 600) {
  return new Promise((resolve) => {
    const prev = btn ? btn.innerHTML : '';
    if (btn) { btn.setAttribute('aria-busy', 'true'); const ico = btn.querySelector('svg.ico'); const sp = document.createElement('span'); sp.className = 'spin'; if (ico) ico.replaceWith(sp); else btn.prepend(sp); }
    setTimeout(() => { if (btn && btn.isConnected) { btn.removeAttribute('aria-busy'); btn.innerHTML = prev; } resolve(); }, reducedMotion() ? Math.min(ms, 300) : ms);
  });
}

// ---------- audit text ----------
function whoLabel(ctx, who) {
  if (who === 'system') return ctx.t('who.system');
  if (String(who).startsWith('key:')) return ctx.t('who.key', { name: who.slice(4) });
  return who;
}
function whatText(ctx, ev) {
  const { t, fmt } = ctx;
  const d = ev.detail || {};
  const rule = (r) => t(`alerts.type.${r}`);
  const chans = (l) => (l || []).map((c) => t(`alerts.ch.${c}`)).join(' + ');
  const val = (x) => (x == null ? '' : ROLES.includes(x) ? t(`role.${x}`) : typeof x === 'number' ? fmt.int(x) : ctx.loc(x));
  const v = {
    rule: d.rule ? rule(d.rule) : '', channels: chans(d.channels), trunk: d.trunk ? ` (${d.trunk})` : '', ticket: d.ticket || '', numbers: fmt.int(d.numbers || 0), max: fmt.credits2(d.max || 0),
    token: d.token || '', calls: fmt.int(d.calls || 0), flow: d.flow ? ((ctx.list('flows').find((f) => f.id === d.flow) || {}).name ? ctx.loc(ctx.list('flows').find((f) => f.id === d.flow).name) : d.flow) : '', v: d.v || '',
    email: d.email || '', role: d.role ? t(`role.${d.role}`) : '', number: d.number || '', monthly: fmt.int(d.monthly || 0), member: d.member || '',
    from: val(d.from), to: val(d.to),
    credits: fmt.int(d.credits || 0), invoice: d.invoice || '', host: d.host || '', name: d.name ? ctx.loc(d.name) : '', env: d.env ? t(`env.${d.env}`) : '', n: fmt.int(d.n || 0),
    sub: d.sub || '', limit: fmt.int(d.limit || 0), tab: d.tab ? t(`tabName.${d.tab}`) : '', alert: d.alert || '',
  };
  const key = `what.${ev.what}`;
  if (ctx.has(key)) return t(key, v);
  const extra = Object.entries(d).map(([k, x]) => `${k}: ${typeof x === 'object' ? JSON.stringify(x) : x}`).join(' · ');
  return `${ev.what}${extra ? ` · ${extra}` : ''}`;
}

// ---------- pieces ----------
function header(ctx) {
  const { t, icon } = ctx;
  const tab = ctx.state.tab;
  const nMembers = members(ctx).filter((m) => !m.pending).length;
  return h`<div class="page-head"><div class="titles"><h1>${t('title')}${ctx.pageHelp()}</h1><span class="sub">${t('sub')}</span></div>
    <div class="tools">${tab === 'members' ? h`<button type="button" class="btn btn-primary" data-action="us.invite">${icon('plus')}${t('invite')}</button>` : ''}
      ${tab === 'subaccounts' ? h`<button type="button" class="btn btn-primary" data-action="us.sub.new">${icon('plus')}${t('sub.new')}</button>` : ''}
      ${tab === 'audit' ? h`<button type="button" class="btn" data-action="us.audit.export">${icon('download')}${t('audit.export')}</button>` : ''}</div></div>
    <div class="seg us-tabs" role="tablist" aria-label="${t('tabsAria')}">${TABS.map((x) => h`<button type="button" role="tab" id="us-tab-${x}" aria-controls="us-panel" aria-selected="${tab === x}" tabindex="${tab === x ? 0 : -1}" data-action="us.tab" data-value="${x}">
      ${t(`tab.${x}`)}${x === 'members' ? h` <span class="us-count">${nMembers}</span>` : ''}${x === 'subaccounts' ? h` <span class="chip chip-info us-prev">${t('preview')}</span>` : ''}</button>`)}</div>`;
}

function membersPanel(ctx) {
  const { t, fmt, icon } = ctx;
  const list = members(ctx);
  const row = (m) => {
    const self = m.email === me(ctx);
    if (m.pending) {
      return h`<tr class="${ctx.state.fresh === m.id ? 'new-row' : ''} is-pending"><td class="us-c-name"><span class="row-tight"><span class="us-av us-av-pending">${icon('mail', 'ico-sm')}</span><span class="stack" style="gap:0"><span class="strong mono" translate="no">${m.email}</span><span class="hint-xs">${t('m.invited', { date: fmt.dayMonth(m.invitedAt), time: fmt.timeShort(m.invitedAt) })}</span></span></span></td>
        <td class="mono hint us-c-email us-c-dup" translate="no">${m.email}</td><td data-label="${t('m.role')}"><span class="chip">${t(`role.${m.role}`)}</span></td><td data-label="${t('m.access')}">${accessLabel(ctx, m.access)}</td>
        <td data-label="${t('m.twofa')}"><span class="chip chip-warn">${t('m.pending')}</span></td><td class="hint" data-label="${t('m.last')}">—</td>
        <td class="num nowrap us-c-act"><button type="button" class="btn btn-sm" data-action="us.pending.resend" data-value="${m.id}">${icon('send')}${t('m.resend')}</button>
          <button type="button" class="btn btn-sm btn-ghost btn-danger-ghost" data-action="us.pending.revoke" data-value="${m.id}">${t('m.revoke')}</button></td></tr>`;
    }
    return h`<tr class="${ctx.state.fresh === m.id ? 'new-row' : ''}"><td class="us-c-name"><span class="row-tight"><span class="us-av">${m.name.slice(0, 1)}</span><span class="strong">${m.name}</span>${self ? h`<span class="chip chip-navy">${t('m.you')}</span>` : ''}</span></td>
      <td class="mono hint us-c-email" translate="no">${m.email}</td><td data-label="${t('m.role')}"><span class="chip ${m.role === 'owner' ? 'chip-brand' : ''}">${t(`role.${m.role}`)}</span></td><td data-label="${t('m.access')}">${accessLabel(ctx, m.access)}</td>
      <td data-label="${t('m.twofa')}">${m.twoFactor ? h`<span class="chip chip-ok">${icon('shield-check')}${t('m.on')}</span>` : h`<span class="chip chip-warn" tabindex="0" data-tip-key="${needs2fa(m.role) ? 'users.m.requiredTip' : 'users.m.allowedTip'}">${t('m.notSet')}</span>`}</td>
      <td class="nowrap hint" data-label="${t('m.last')}">${m.lastSignIn ? `${fmt.dayMonth(m.lastSignIn)} ${fmt.timeShort(m.lastSignIn)}` : '—'}</td>
      <td class="num us-c-act"><button type="button" class="btn btn-sm" data-action="us.edit" data-value="${m.id}">${icon('edit')}${t('m.edit')}</button></td></tr>`;
  };
  return h`<section class="card" aria-labelledby="us-m-h"><div class="card-head"><h2 id="us-m-h">${t('m.title')}</h2>
      <a class="linkbtn us-2fa" href="#/settings?tab=security" data-action="us.2fa.policy">${icon('shield-check')}${t('m.policy')}</a></div>
    <div class="tbl-wrap"><table class="tbl us-mtbl"><thead><tr><th>${t('m.name')}</th><th>${t('m.email')}</th><th>${t('m.role')}</th><th>${ctx.term(t('m.access'), 'subaccount')}</th><th>${t('m.twofa')}</th><th>${t('m.last')}</th><th><span class="sr-only">${t('m.actions')}</span></th></tr></thead>
      <tbody>${list.map(row)}</tbody></table></div>
    ${list.length <= 1 ? h`<div class="empty us-alone"><span class="art">${icon('users')}</span><strong>${t('m.aloneTitle')}</strong><span class="hint">${t('m.aloneHint')}</span>
      <button type="button" class="btn btn-sm btn-navy" data-action="us.invite">${icon('plus')}${t('invite')}</button></div>` : ''}
    <div class="card-foot"><div class="row us-roles"><span class="hint-xs">${t('m.rolesLead')}</span>${ROLES.map((r) => h`<button type="button" class="chip us-rolechip" data-action="us.roles.compare" data-value="${r}">${t(`role.${r}`)} · ${t(`roleShort.${r}`)}</button>`)}
      <button type="button" class="linkbtn" data-action="us.roles.compare" data-value="all">${t('m.compare')}</button></div></div></section>`;
}

function subsPanel(ctx) {
  const { t, fmt, icon } = ctx;
  const list = subs(ctx);
  const alloc = list.filter((s) => s.ownAllocation && s.ownAllocation.left > 0);
  const lineVars = { bal: fmt.credits2(balance()), alloc: fmt.credits2(allocated(ctx)), names: alloc.map((s) => ctx.loc(s.name)).join(', ') || '—' };
  const card = (s) => {
    const own = !!s.ownAllocation;
    const suspended = s.status === 'suspended';
    const nums = (s.numbers || []).length;
    const keys = (s.keys || []).length;
    return h`<article class="card us-sub ${suspended ? 'is-susp' : ''} ${ctx.state.fresh === s.id ? 'us-fresh' : ''}" aria-labelledby="us-s-${s.id}">
      <div class="us-sub-head"><h3 id="us-s-${s.id}">${ctx.loc(s.name)}</h3>${s.main ? h`<span class="chip chip-navy">${t('sub.main')}</span>` : suspended ? h`<span class="chip chip-err">${t('sub.suspended')}</span>` : h`<span class="chip chip-ok">${t('sub.active')}</span>`}</div>
      <div class="us-kv"><span>${t('sub.credits')}</span><strong>${s.main ? t('sub.mainBalance') : own ? t('sub.own') : t('sub.shared')}</strong></div>
      <div class="us-kv"><span>${t('sub.balance')}</span><strong class="tnum">${s.main ? h`${fmt.credits2(freeMain(ctx))} <span class="hint-xs">${t('sub.free')}</span>` : own ? h`${fmt.credits2(s.ownAllocation.left)} <span class="hint-xs">${t('sub.ofMoved', { moved: fmt.int(s.ownAllocation.moved) })}</span>` : h`${fmt.credits2(balance())} <span class="hint-xs">${t('sub.sharedHint')}</span>`}</strong></div>
      <div class="us-kv"><span>${t('sub.used7')}</span><strong class="tnum">${fmt.credits2(used7(ctx, s.id))}</strong></div>
      <div class="us-kv"><span>${t('sub.limit')}</span><strong class="tnum">${s.dailyLimit ? fmt.int(s.dailyLimit) : t('sub.accountLimit')}</strong></div>
      <div class="us-kv"><span>${t('sub.numbersKeys')}</span><strong class="tnum">${nums} · ${keys}</strong></div>
      <div class="us-kv"><span>${t('sub.owner')}</span><strong>${s.owner || '—'}</strong></div>
      <div class="us-kv us-docs"><span>${t('sub.docs')}</span><strong>${docsStatus(ctx, s)}</strong></div>
      <div class="row us-sub-actions">
        ${own || s.main ? h`<button type="button" class="btn btn-sm" data-action="us.sub.move" data-value="${s.id}" ${raw(suspended ? 'aria-disabled="true"' : '')}>${icon('coin')}${t('sub.move')}</button>` : ''}
        ${!s.main ? h`<button type="button" class="btn btn-sm" data-action="us.sub.mode" data-value="${s.id}">${own ? t('sub.useMain') : t('sub.giveOwn')}</button>` : ''}
        ${!s.main ? h`<button type="button" class="btn btn-sm" data-action="us.sub.limit" data-value="${s.id}">${t('sub.setLimit')}</button>` : ''}
        <a class="btn btn-sm btn-ghost" href="#/reports?sub=${s.id}" data-action="us.sub.usage">${icon('chart')}${t('sub.usage')}</a>
        ${!s.main ? (suspended ? h`<button type="button" class="btn btn-sm btn-navy" data-action="us.sub.resume" data-value="${s.id}">${t('sub.resume')}</button>`
          : h`<button type="button" class="btn btn-sm btn-ghost btn-danger-ghost" data-action="us.sub.suspend" data-value="${s.id}">${t('sub.suspend')}</button>`) : ''}
      </div></article>`;
  };
  return h`<div class="note note-info us-subline">${icon('info')}<span class="grow">${t('sub.line', lineVars)}</span><span class="chip chip-info" tabindex="0" data-tip-key="term.subaccount">${t('preview')}</span></div>
    <div class="us-subgrid">${list.map(card)}
      <button type="button" class="card us-sub us-sub-new" data-action="us.sub.new">${icon('plus', 'ico-lg')}<strong>${t('sub.new')}</strong><span class="hint-xs">${t('sub.newHint')}</span></button></div>
    <div class="note us-subdocs">${icon('file-text')}<span class="grow">${t('subDocs.note')}</span><a class="btn btn-sm" href="#/help/article/thai-number-kyc" data-action="us.sub.docshelp">${icon('book')}${t('subDocs.help')}</a></div>`;
}

/**
 * Business documents of a sub-account (T2 audit #7). Today every sub-account belongs to the company and uses the
 * company's checked documents; a sub-account used by another business would need its own (planned, not built).
 */
function docsStatus(ctx, s) {
  const { t, fmt } = ctx;
  const kyc = ctx.store.get('org.kycApproved');
  if (kyc) return h`<span class="chip chip-ok us-docs-chip is-company" tabindex="0" data-tip-key="users.sub.docsCompanyTip">${t('sub.docsCompany', { date: fmt.dayMonth(kyc) })}</span>`;
  return h`<span class="chip chip-warn us-docs-chip is-none" tabindex="0" data-tip-key="users.sub.docsNoneTip">${t('sub.docsNone')}</span>`;
}

function auditRows(ctx) {
  const st = ctx.state;
  const q = st.q.trim().toLowerCase();
  return ctx.list('audit').filter((ev) => (st.who === 'all' || ev.who === st.who) && (st.via === 'all' || ev.via === st.via)
    && (!q || [whoLabel(ctx, ev.who), whatText(ctx, ev), ev.target || '', ev.ip || ''].join(' ').toLowerCase().includes(q)));
}

function auditPanel(ctx) {
  const { t, fmt, icon } = ctx;
  const all = ctx.list('audit');
  const whos = [...new Set(all.map((e) => e.who))];
  const rows = auditRows(ctx);
  const filtered = ctx.state.who !== 'all' || ctx.state.via !== 'all' || ctx.state.q;
  return h`<section class="card" aria-labelledby="us-a-h"><div class="card-head"><h2 id="us-a-h">${t('audit.title')}</h2><span class="hint">${t('audit.sub')}</span></div>
    <div class="us-filters">
      <label class="field"><span class="label">${t('audit.who')}</span><select class="select" data-field="who" data-action="us.audit.actor">${[['all', t('audit.everyone')], ...whos.map((w) => [w, whoLabel(ctx, w)])].map(([v, l]) => h`<option value="${v}" ${raw(ctx.state.who === v ? 'selected' : '')}>${l}</option>`)}</select></label>
      <div class="field"><span class="label">${t('audit.via')}</span><div class="seg" role="group" aria-label="${t('audit.via')}">${['all', 'console', 'api', 'system'].map((v) => h`<button type="button" data-action="us.audit.via" data-value="${v}" aria-pressed="${ctx.state.via === v}">${v === 'all' ? t('audit.allVia') : t(`via.${v}`)}</button>`)}</div></div>
      <label class="field grow"><span class="label">${t('audit.search')}</span><input class="input" type="search" data-field="q" data-action="us.audit.search" value="${ctx.state.q}" placeholder="${t('audit.searchPh')}" autocomplete="off"></label>
    </div>
    ${rows.length ? h`<div class="tbl-wrap"><table class="tbl us-audit"><thead><tr><th>${t('audit.time')}</th><th>${t('audit.whoCol')}</th><th>${t('audit.what')}</th><th>${t('audit.target')}</th><th>${t('audit.ip')}</th><th>${t('audit.viaCol')}</th></tr></thead>
      <tbody>${rows.map((ev) => {
        const i = all.indexOf(ev);
        return h`<tr class="us-click" data-action="us.audit.row" data-value="${i}" tabindex="0"><td class="nowrap mono us-a-time">${fmt.dayMonth(ev.at)} ${fmt.timeShort(ev.at)}${ev.until ? `–${fmt.timeShort(ev.until)}` : ''}</td>
          <td class="nowrap strong us-a-who">${whoLabel(ctx, ev.who)}</td><td class="us-a-what">${whatText(ctx, ev)}</td><td class="mono hint" translate="no" data-label="${t('audit.target')}">${ev.target || '—'}</td><td class="mono hint" translate="no" data-label="${t('audit.ip')}">${ev.ip || '—'}</td>
          <td data-label="${t('audit.viaCol')}"><span class="chip ${ev.via === 'api' ? 'chip-info' : ev.via === 'system' ? 'chip-navy' : ''}">${t(`via.${ev.via}`)}</span></td></tr>`;
      })}</tbody></table></div>
      <div class="card-foot hint-xs">${t('audit.count', { n: fmt.int(rows.length), total: fmt.int(all.length) })} · ${t('audit.kept')}</div>`
    : h`<div class="empty"><span class="art">${icon('search')}</span><strong>${t('audit.none')}</strong><span class="hint">${t('audit.noneHint')}</span>
      ${filtered ? h`<button type="button" class="btn btn-sm" data-action="us.audit.clear">${icon('x')}${t('audit.clear')}</button>` : ''}</div>`}</section>`;
}

// ---------- screen contract ----------
function sync(ctx) {
  if (ctx.state._raw === ctx.params.raw) return;
  ctx.state._raw = ctx.params.raw;
  ctx.state._invite = ctx.params.query.invite === '1';
  const tab = ctx.params.query.tab;
  if (TABS.includes(tab)) ctx.state.tab = tab;
}

export function render(ctx) {
  sync(ctx);
  const tab = ctx.state.tab;
  const body = tab === 'subaccounts' ? subsPanel(ctx) : tab === 'audit' ? auditPanel(ctx) : membersPanel(ctx);
  return h`<div class="page us">${header(ctx)}<div id="us-panel" role="tabpanel" aria-labelledby="us-tab-${tab}" class="stack-4">${body}</div></div>`;
}

// ---------- dialogs ----------
function inviteModal(ctx) {
  const { t, icon } = ctx;
  const body = h`<div class="stack-3">
    <label class="field"><span class="label">${t('inv.email')}</span><input class="input" type="email" data-i="email" placeholder="name@example.com" autocomplete="off" spellcheck="false" aria-describedby="us-inv-err">
      <span class="field-err" id="us-inv-err" data-i="err" hidden></span></label>
    <div class="grid g-2"><label class="field"><span class="label">${t('inv.role')}</span><select class="select" data-i="role">${INVITE_ROLES.map((r) => h`<option value="${r}" ${raw(r === 'operator' ? 'selected' : '')}>${t(`role.${r}`)}</option>`)}</select></label>
      <label class="field"><span class="label">${ctx.term(t('inv.access'), 'subaccount')}</span><select class="select" data-i="access"><option value="all">${t('access.all')}</option>${subs(ctx).filter((s) => !s.main).map((s) => h`<option value="${s.id}">${ctx.loc(s.name)}</option>`)}</select></label></div>
    <p class="hint-xs" data-i="roleHint">${t('roleShort.operator')}</p>
    <div class="note">${icon('shield-check')}<span>${t('inv.note')}</span></div></div>`;
  const m = ctx.ui.modal({
    title: t('invite'), body,
    buttons: [{ label: t('common.cancel') }, {
      label: t('inv.send'), kind: 'primary', icon: 'send', onClick: (hh, btn) => {
        const email = hh.el.querySelector('[data-i="email"]').value.trim().toLowerCase();
        const err = hh.el.querySelector('[data-i="err"]');
        const input = hh.el.querySelector('[data-i="email"]');
        let msg = '';
        if (!EMAIL_RE.test(email)) msg = t('inv.bad');
        else if (members(ctx).some((x) => x.email === email)) msg = t('inv.dup');
        if (msg) { err.textContent = msg; err.hidden = false; input.setAttribute('aria-invalid', 'true'); input.focus(); return false; }
        const role = hh.el.querySelector('[data-i="role"]').value;
        const access = hh.el.querySelector('[data-i="access"]').value;
        busy(btn, 600).then(() => {
          const rec = { id: newId('user'), name: null, email, role, access, twoFactor: false, pending: true, invitedAt: new Date(nowMs()).toISOString() };
          ctx.store.update('members', (l) => [...(l || []), rec]);
          audit('member.invited', { email, role });
          ctx.setState({ fresh: rec.id });
          setTimeout(() => { if (ctx.state.fresh === rec.id) ctx.state.fresh = null; }, 2000);
          hh.close();
          ctx.ui.toast(t('toast.T30', { email }), { kind: 'success', demo: true });
        });
        return false;
      },
    }],
  });
  m.el.querySelector('[data-i="role"]').addEventListener('change', (ev) => { m.el.querySelector('[data-i="roleHint"]').textContent = t(`roleShort.${ev.target.value}`); });
  m.el.querySelector('[data-i="email"]').addEventListener('input', () => { const e = m.el.querySelector('[data-i="err"]'); e.hidden = true; m.el.querySelector('[data-i="email"]').removeAttribute('aria-invalid'); });
}

function matrixModal(ctx, focusRole) {
  const { t, icon } = ctx;
  const mark = (v) => (v === 'y' ? h`<span class="us-y" aria-label="${t('mx.y')}">${icon('check')}</span>` : v === 'v' ? h`<span class="chip">${t('mx.v')}</span>` : v === 's' ? h`<span class="chip chip-info">${t('mx.s')}</span>` : h`<span class="hint" aria-label="${t('mx.n')}">—</span>`);
  ctx.ui.modal({
    title: t('mx.title'), size: 'lg',
    body: h`<div class="tbl-wrap"><table class="tbl us-mx"><thead><tr><th>${t('mx.area')}</th>${ROLES.map((r) => h`<th class="${r === focusRole ? 'is-focus' : ''}">${t(`role.${r}`)}</th>`)}</tr></thead>
      <tbody>${MATRIX.map(([area, cells]) => h`<tr><td class="strong">${t(`mx.${area}`)}</td>${cells.map((c, i) => h`<td class="${ROLES[i] === focusRole ? 'is-focus' : ''}">${mark(c)}</td>`)}</tr>`)}</tbody></table></div>
      <p class="hint-xs" style="margin-top:10px">${t('mx.note')}</p>`,
    buttons: [{ label: t('common.close'), kind: 'navy' }],
  });
}

function editDrawer(ctx, memberId) {
  const { t, fmt, icon } = ctx;
  const m = members(ctx).find((x) => x.id === memberId);
  if (!m) return;
  const owner = m.role === 'owner';
  const body = h`<div class="stack-3">
    <div class="row-tight"><span class="us-av us-av-lg">${m.name.slice(0, 1)}</span><div class="stack" style="gap:0"><strong>${m.name}</strong><span class="hint mono" translate="no">${m.email}</span><span class="hint-xs">${t('ed.last', { when: m.lastSignIn ? `${fmt.dayMonth(m.lastSignIn)} ${fmt.timeShort(m.lastSignIn)}` : '—' })}</span></div></div>
    <label class="field"><span class="label">${t('m.role')}</span><select class="select" data-d="role" ${raw(owner ? 'disabled aria-describedby="us-owner-h"' : '')}>${ROLES.filter((r) => r !== 'owner' || owner).map((r) => h`<option value="${r}" ${raw(r === m.role ? 'selected' : '')}>${t(`role.${r}`)}</option>`)}</select>
      ${owner ? h`<span class="hint-xs" id="us-owner-h">${t('ed.ownerRole')}</span>` : h`<span class="hint-xs" data-d="roleHint">${t(`roleShort.${m.role}`)}</span>`}</label>
    <label class="field"><span class="label">${ctx.term(t('m.access'), 'subaccount')}</span><select class="select" data-d="access" ${raw(owner ? 'disabled' : '')}><option value="all">${t('access.all')}</option>${subs(ctx).filter((s) => !s.main).map((s) => h`<option value="${s.id}" ${raw(m.access === s.id ? 'selected' : '')}>${ctx.loc(s.name)}</option>`)}</select></label>
    <div class="us-danger stack" style="gap:10px">
      <div class="row" style="justify-content:space-between"><div class="stack" style="gap:2px"><strong>${t('ed.reset2fa')}</strong><span class="hint-xs">${m.twoFactor ? t('ed.reset2faHint') : t('ed.no2fa')}</span></div>
        <button type="button" class="btn btn-sm" data-action="us.ed.reset2fa" ${raw(m.twoFactor ? '' : 'aria-disabled="true"')}>${icon('refresh')}${t('ed.reset')}</button></div>
      <div class="row" style="justify-content:space-between"><div class="stack" style="gap:2px"><strong>${t('ed.remove')}</strong><span class="hint-xs" id="us-rm-h">${owner ? t('ed.ownerRemove') : t('ed.removeHint')}</span></div>
        <button type="button" class="btn btn-sm btn-danger" data-action="us.ed.remove" ${raw(owner ? 'aria-disabled="true" aria-describedby="us-rm-h"' : '')}>${icon('trash')}${t('ed.remove')}</button></div>
    </div></div>`;
  const d = ctx.ui.drawer({
    title: t('ed.title', { name: m.name }), body,
    actions: {
      'us.ed.reset2fa': (el, ev, hh) => {
        const prev = m.twoFactor;
        ctx.store.update('members', (l) => l.map((x) => (x.id === m.id ? { ...x, twoFactor: false } : x)));
        audit('member.2fa.reset', { member: m.name });
        hh.close();
        ctx.ui.toast(t('ed.resetDone', { name: m.name }), { kind: 'info', timeout: 10000, action: { label: t('common.undo'), onClick: () => ctx.store.update('members', (l) => l.map((x) => (x.id === m.id ? { ...x, twoFactor: prev } : x))) } });
      },
      'us.ed.remove': async (el, ev, hh) => {
        const ok = await ctx.ui.confirm({ title: t('rm.title', { name: m.name }), consequences: [t('rm.c1', { name: m.name }), t('rm.c2')], typed: m.email, confirmLabel: t('rm.yes'), cancelLabel: t('rm.keep'), danger: true });
        if (!ok) return;
        hh.close();
        ctx.store.update('members', (l) => l.filter((x) => x.id !== m.id));
        audit('member.removed', { email: m.email });
        ctx.ui.toast(t('rm.done', { name: m.name }), { kind: 'info' });
      },
    },
    buttons: owner ? [{ label: t('common.close') }] : [{ label: t('common.cancel') }, {
      label: t('ed.save'), kind: 'navy', onClick: (hh, btn) => {
        const role = hh.el.querySelector('[data-d="role"]').value;
        const access = hh.el.querySelector('[data-d="access"]').value;
        const save = () => busy(btn, 500).then(() => {
          ctx.store.update('members', (l) => l.map((x) => (x.id === m.id ? { ...x, role, access } : x)));
          if (role !== m.role) audit('member.role.changed', { member: m.name, from: m.role, to: role });
          if (access !== m.access) audit('member.access.changed', { member: m.name, sub: accessLabel(ctx, access) });
          hh.close();
          ctx.ui.toast(role !== m.role ? t('toast.T31', { name: m.name, role: t(`role.${role}`) }) : t('toast.T02'), { kind: 'success' });
        });
        if (role !== m.role) {
          ctx.ui.confirm({ title: t('rc.title', { name: m.name, role: t(`role.${role}`) }), body: t(`rc.body.${role}`), confirmLabel: t('rc.yes'), cancelLabel: t('rc.keep', { role: t(`role.${m.role}`) }) })
            .then((ok) => { if (ok) save(); });
        } else save();
        return false;
      },
    }],
  });
  const sel = d.el.querySelector('[data-d="role"]');
  if (sel && !owner) sel.addEventListener('change', () => { const hint = d.el.querySelector('[data-d="roleHint"]'); if (hint) hint.textContent = t(`roleShort.${sel.value}`); });
}

function moveCredits(ctx, subId) {
  const { t, fmt } = ctx;
  const own = subs(ctx).filter((s) => s.ownAllocation && s.status !== 'suspended');
  if (!own.length) { ctx.ui.toast(t('mv.noOwn'), { kind: 'info' }); return; }
  const target = subs(ctx).find((s) => s.id === subId);
  const opts = [['main', t('mv.main', { n: fmt.credits2(freeMain(ctx)) })], ...own.map((s) => [s.id, `${ctx.loc(s.name)} · ${fmt.credits2(s.ownAllocation.left)}`])];
  const from0 = target && !target.main ? 'main' : 'main';
  const to0 = target && !target.main ? target.id : own[0].id;
  const body = h`<div class="stack-3"><div class="grid g-2">
      <label class="field"><span class="label">${t('mv.from')}</span><select class="select" data-m="from">${opts.map(([v, l]) => h`<option value="${v}" ${raw(v === from0 ? 'selected' : '')}>${l}</option>`)}</select></label>
      <label class="field"><span class="label">${t('mv.to')}</span><select class="select" data-m="to">${opts.map(([v, l]) => h`<option value="${v}" ${raw(v === to0 ? 'selected' : '')}>${l}</option>`)}</select></label></div>
    <label class="field"><span class="label">${t('mv.amount')}</span><input class="input tnum" data-m="amount" inputmode="numeric" value="${fmt.int(2000)}"></label>
    <span class="field-err" data-m="err" hidden></span>
    <p class="hint-xs">${t('mv.note')}</p></div>`;
  ctx.ui.modal({
    title: t('mv.title'), body, size: 'sm',
    buttons: [{ label: t('common.cancel') }, {
      label: t('mv.yes'), kind: 'navy', onClick: (hh, btn) => {
        const from = hh.el.querySelector('[data-m="from"]').value;
        const to = hh.el.querySelector('[data-m="to"]').value;
        const n = Number(String(hh.el.querySelector('[data-m="amount"]').value).replace(/[^\d.]/g, '')) || 0;
        const err = hh.el.querySelector('[data-m="err"]');
        const avail = from === 'main' ? freeMain(ctx) : (subs(ctx).find((s) => s.id === from).ownAllocation.left);
        let msg = '';
        if (from === to) msg = t('mv.same');
        else if (n <= 0) msg = t('mv.zero');
        else if (n > avail) msg = t('mv.tooMuch', { n: fmt.credits2(avail) });
        if (msg) { err.textContent = msg; err.hidden = false; return false; }
        busy(btn, 500).then(() => {
          ctx.store.update('subAccounts', (l) => l.map((s) => {
            if (s.id === from && s.ownAllocation) return { ...s, ownAllocation: { ...s.ownAllocation, left: r2(s.ownAllocation.left - n) } };
            if (s.id === to && s.ownAllocation) return { ...s, ownAllocation: { ...s.ownAllocation, left: r2(s.ownAllocation.left + n), moved: r2(s.ownAllocation.moved + n) } };
            return s;
          }));
          const name = (x) => (x === 'main' ? t('mv.mainShort') : ctx.loc(subs(ctx).find((s) => s.id === x).name));
          audit('credits.moved', { n, from: name(from), to: name(to) });
          hh.close();
          ctx.ui.toast(t('mv.done', { n: fmt.int(n), to: name(to) }), { kind: 'success' });
        });
        return false;
      },
    }],
  });
}

function giveOwn(ctx, s) {
  const { t, fmt } = ctx;
  if (s.ownAllocation) {
    ctx.ui.confirm({ title: t('mode.backTitle', { name: ctx.loc(s.name) }), body: t('mode.backBody', { n: fmt.credits2(s.ownAllocation.left) }), confirmLabel: t('mode.backYes'), cancelLabel: t('common.cancel') }).then((ok) => {
      if (!ok) return;
      ctx.store.update('subAccounts', (l) => l.map((x) => { if (x.id !== s.id) return x; const { ownAllocation, ...rest } = x; void ownAllocation; return rest; }));
      audit('sub.mode.main', { name: s.name });
      ctx.ui.toast(t('mode.backDone', { name: ctx.loc(s.name) }), { kind: 'success' });
    });
    return;
  }
  const body = h`<div class="stack-3"><p class="hint">${t('mode.ownBody', { name: ctx.loc(s.name) })}</p>
    <label class="field"><span class="label">${t('mv.amount')}</span><input class="input tnum" data-o="amount" inputmode="numeric" value="${fmt.int(2000)}"></label>
    <span class="field-err" data-o="err" hidden>${t('mv.tooMuch', { n: fmt.credits2(freeMain(ctx)) })}</span></div>`;
  ctx.ui.modal({
    title: t('mode.ownTitle', { name: ctx.loc(s.name) }), body, size: 'sm',
    buttons: [{ label: t('common.cancel') }, { label: t('mode.ownYes'), kind: 'navy', onClick: (hh) => {
      const n = Number(String(hh.el.querySelector('[data-o="amount"]').value).replace(/[^\d.]/g, '')) || 0;
      if (n <= 0 || n > freeMain(ctx)) { hh.el.querySelector('[data-o="err"]').hidden = false; return false; }
      ctx.store.update('subAccounts', (l) => l.map((x) => (x.id === s.id ? { ...x, ownAllocation: { left: n, moved: n, movedOn: fmt.isoDate(nowMs()) } } : x)));
      audit('credits.moved', { n, from: t('mv.mainShort'), to: ctx.loc(s.name) });
      ctx.ui.toast(t('mv.done', { n: fmt.int(n), to: ctx.loc(s.name) }), { kind: 'success' });
      return true;
    } }],
  });
}

function setLimit(ctx, s) {
  const { t, fmt } = ctx;
  const body = h`<div class="stack-3"><label class="field"><span class="label">${t('lim.daily')}</span><input class="input tnum" data-l="v" inputmode="numeric" value="${fmt.int(s.dailyLimit || 1000)}">
    <span class="hint-xs">${t('lim.hint', { account: fmt.int((ctx.store.get('limits') || {}).daily || 0) })}</span></label>
    <span class="field-err" data-l="err" hidden>${t('lim.bad')}</span></div>`;
  ctx.ui.modal({
    title: t('lim.title', { name: ctx.loc(s.name) }), body, size: 'sm',
    buttons: [{ label: t('common.cancel') }, { label: t('common.save'), kind: 'navy', onClick: (hh) => {
      const v = Number(String(hh.el.querySelector('[data-l="v"]').value).replace(/[^\d]/g, '')) || 0;
      if (v < 100) { hh.el.querySelector('[data-l="err"]').hidden = false; return false; }
      ctx.store.update('subAccounts', (l) => l.map((x) => (x.id === s.id ? { ...x, dailyLimit: v } : x)));
      if (s.id) ctx.store.update('limits', (lim) => ({ ...(lim || {}), perSub: { ...((lim && lim.perSub) || {}), [s.id]: v } }));
      audit('sub.limit.set', { name: s.name, limit: v });
      ctx.ui.toast(t('lim.done', { name: ctx.loc(s.name), n: fmt.int(v) }), { kind: 'success' });
      return true;
    } }],
  });
}

function newSub(ctx) {
  const { t, fmt } = ctx;
  const body = h`<div class="stack-3"><label class="field"><span class="label">${t('ns.name')}</span><input class="input" data-n="name" placeholder="${t('ns.namePh')}" autocomplete="off"></label>
    <fieldset class="field"><legend class="label">${t('sub.credits')}</legend>
      <label class="radio"><input type="radio" name="us-ns-mode" value="main" checked>${t('sub.shared')}</label>
      <label class="radio"><input type="radio" name="us-ns-mode" value="own">${t('ns.own')}</label></fieldset>
    <div class="grid g-2"><label class="field"><span class="label">${t('ns.allocation')}</span><input class="input tnum" data-n="alloc" inputmode="numeric" value="${fmt.int(1000)}"><span class="hint-xs">${t('ns.allocHint', { n: fmt.credits2(freeMain(ctx)) })}</span></label>
      <label class="field"><span class="label">${t('lim.daily')}</span><input class="input tnum" data-n="limit" inputmode="numeric" value="${fmt.int(1000)}"></label></div>
    <span class="field-err" data-n="err" hidden></span>
    <p class="hint-xs">${t('ns.note')}</p>
    <p class="hint-xs">${t('ns.docsNote')}</p></div>`;
  ctx.ui.modal({
    title: t('sub.new'), body,
    buttons: [{ label: t('common.cancel') }, { label: t('ns.create'), kind: 'primary', onClick: (hh, btn) => {
      const name = hh.el.querySelector('[data-n="name"]').value.trim();
      const mode = hh.el.querySelector('input[name="us-ns-mode"]:checked').value;
      const alloc = Number(String(hh.el.querySelector('[data-n="alloc"]').value).replace(/[^\d.]/g, '')) || 0;
      const limit = Number(String(hh.el.querySelector('[data-n="limit"]').value).replace(/[^\d]/g, '')) || 0;
      const err = hh.el.querySelector('[data-n="err"]');
      let msg = '';
      if (name.length < 2) msg = t('ns.badName');
      else if (mode === 'own' && (alloc <= 0 || alloc > freeMain(ctx))) msg = t('mv.tooMuch', { n: fmt.credits2(freeMain(ctx)) });
      if (msg) { err.textContent = msg; err.hidden = false; return false; }
      busy(btn, 600).then(() => {
        const rec = { id: newId('sub'), key: null, name: { en: name, th: name, zh: name }, dailyLimit: limit || null, numbers: [], keys: [], owner: ctx.store.get('user.name'), status: 'active', ...(mode === 'own' ? { ownAllocation: { left: alloc, moved: alloc, movedOn: fmt.isoDate(nowMs()) } } : {}) };
        ctx.store.update('subAccounts', (l) => [...(l || []), rec]);
        audit('sub.created', { name: rec.name });
        ctx.setState({ tab: 'subaccounts', fresh: rec.id });
        setTimeout(() => { if (ctx.state.fresh === rec.id) ctx.state.fresh = null; }, 2000);
        hh.close();
        ctx.ui.toast(t('ns.done', { name }), { kind: 'success', demo: true });
      });
      return false;
    } }],
  });
}

function auditDrawer(ctx, ev) {
  const { t, fmt, icon } = ctx;
  const raw2 = { id: `evt_audit_${String(new Date(ev.at).getTime()).slice(-8)}`, time: fmt.iso(ev.at), ...(ev.until ? { until: fmt.iso(ev.until) } : {}), actor: ev.who, action: ev.what, target: ev.target, ip: ev.ip, via: ev.via, detail: ev.detail || {} };
  const json = JSON.stringify(raw2, null, 2);
  const keyRow = String(ev.who).startsWith('key:');
  ctx.ui.drawer({
    title: t('ad.title'), sub: whatText(ctx, ev),
    body: h`<div class="stack-3"><div class="kv"><span class="k">${t('audit.whoCol')}</span><span class="v">${whoLabel(ctx, ev.who)}</span></div>
      <div class="kv"><span class="k">${t('audit.time')}</span><span class="v mono">${fmt.iso(ev.at)}</span></div>
      <div class="kv"><span class="k">${t('audit.viaCol')}</span><span class="v">${t(`via.${ev.via}`)}</span></div>
      <div class="row" style="justify-content:space-between"><span class="label">${t('ad.raw')}</span><button type="button" class="copybtn" data-action="us.ad.copy" aria-label="${t('common.copy')}" data-tip-key="common.copy">${icon('copy')}</button></div>
      <pre class="code" translate="no">${json}</pre>
      ${keyRow ? h`<a class="btn btn-sm" href="#/logs?src=${ev.who.slice(4)}&date=${fmt.isoDate(ev.at)}" data-action="us.ad.logs">${icon('list')}${t('ad.logs')}</a>` : ''}
      <p class="hint-xs">${t('audit.kept')}</p></div>`,
    actions: { 'us.ad.copy': (el) => ctx.ui.copy(json, el), 'us.ad.logs': (el, e2, hh) => hh.close() },
    buttons: [{ label: t('common.close') }],
  });
}

function exportAudit(ctx) {
  const { t, fmt } = ctx;
  const rows = auditRows(ctx);
  const st = ctx.state;
  const slug = [st.who !== 'all' ? String(st.who).replace(/[^a-z0-9]+/gi, '-').toLowerCase() : 'all', st.via !== 'all' ? st.via : '', st.q ? 'search' : ''].filter(Boolean).join('_');
  ctx.ui.csv(`ants-audit_${slug}.csv`, rows.map((ev) => ({ time: fmt.iso(ev.at), actor: ev.who, action: ev.what, target: ev.target || '', ip: ev.ip || '', via: ev.via, action_text: whatText(ctx, ev) })), ['time', 'actor', 'action', 'target', 'ip', 'via', 'action_text']);
  ctx.ui.toast(t('toast.T05', { n: fmt.int(rows.length) }), { kind: 'success' });
}

// ---------- behaviour ----------
function setTab(ctx, tab) {
  ctx.setState({ tab });
  const raw2 = `users?tab=${tab}`;
  ctx.state._raw = raw2;
  ctx.params.raw = raw2;
  history.replaceState(history.state, '', `${location.pathname}${location.search}#/${raw2}`);
}

export function mount(root, ctx) {
  const { t } = ctx;
  const sub = (el) => subs(ctx).find((s) => s.id === el.dataset.value);
  ctx.actions(root, {
    'us.tab': (el) => setTab(ctx, el.dataset.value),
    'us.invite': () => inviteModal(ctx),
    'us.pending.resend': async (el) => {
      const m = members(ctx).find((x) => x.id === el.dataset.value);
      await busy(el, 500);
      ctx.store.update('members', (l) => l.map((x) => (x.id === m.id ? { ...x, invitedAt: new Date(nowMs()).toISOString() } : x)));
      ctx.ui.toast(t('toast.T30', { email: m.email }), { kind: 'success', demo: true });
    },
    'us.pending.revoke': (el) => {
      const list = members(ctx);
      const i = list.findIndex((x) => x.id === el.dataset.value);
      const m = list[i];
      ctx.store.update('members', (l) => l.filter((x) => x.id !== m.id));
      audit('member.invite.revoked', { email: m.email });
      ctx.ui.toast(t('m.revoked', { email: m.email }), { kind: 'info', timeout: 10000, action: { label: t('common.undo'), onClick: () => ctx.store.update('members', (l) => { const c = l.slice(); c.splice(Math.min(i, c.length), 0, m); return c; }) } });
    },
    'us.edit': (el) => editDrawer(ctx, el.dataset.value),
    'us.roles.compare': (el) => matrixModal(ctx, el.dataset.value),
    'us.sub.new': () => newSub(ctx),
    'us.sub.docshelp': () => {}, // link to Help › Documents for Thai numbers
    'us.sub.move': (el) => moveCredits(ctx, el.dataset.value),
    'us.sub.mode': (el) => giveOwn(ctx, sub(el)),
    'us.sub.limit': (el) => setLimit(ctx, sub(el)),
    'us.sub.suspend': async (el) => {
      const s = sub(el);
      const ok = await ctx.ui.confirm({ title: t('susp.title', { name: ctx.loc(s.name) }), body: t('susp.body'), confirmLabel: t('susp.yes'), cancelLabel: t('susp.keep'), danger: true });
      if (!ok) return;
      ctx.store.update('subAccounts', (l) => l.map((x) => (x.id === s.id ? { ...x, status: 'suspended' } : x)));
      audit('sub.suspended', { name: s.name });
      ctx.ui.toast(t('susp.done', { name: ctx.loc(s.name) }), { kind: 'info' });
    },
    'us.sub.resume': (el) => {
      const s = sub(el);
      ctx.store.update('subAccounts', (l) => l.map((x) => (x.id === s.id ? { ...x, status: 'active' } : x)));
      audit('sub.resumed', { name: s.name });
      ctx.ui.toast(t('susp.resumed', { name: ctx.loc(s.name) }), { kind: 'success' });
    },
    'us.audit.actor': () => {},
    'us.audit.search': () => {},
    'us.audit.via': (el) => ctx.setState({ via: el.dataset.value }),
    'us.audit.clear': () => ctx.setState({ who: 'all', via: 'all', q: '' }),
    'us.audit.export': () => exportAudit(ctx),
    'us.audit.row': (el) => { const ev = ctx.list('audit')[Number(el.dataset.value)]; if (ev) auditDrawer(ctx, ev); },
  });
  ctx.inputs(root, {
    who: (v) => ctx.setState({ who: v }),
    q: (v) => ctx.setState({ q: v }),
  });
  ctx.on(root, 'keydown', 'tr.us-click', (ev, tr) => { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === tr) { ev.preventDefault(); tr.click(); } });
  // Tabs: arrow keys move between tabs (WAI-ARIA tabs pattern).
  ctx.on(root, 'keydown', '[role="tab"]', (ev, el) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(ev.key)) return;
    ev.preventDefault();
    const i = TABS.indexOf(el.dataset.value);
    const next = ev.key === 'Home' ? 0 : ev.key === 'End' ? TABS.length - 1 : (i + (ev.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length;
    setTab(ctx, TABS[next]);
    ctx.later(() => { const b = root.querySelector(`#us-tab-${TABS[next]}`); if (b) b.focus(); }, 0);
  });
  ctx.watch('members', 'subAccounts', 'audit', 'credits', 'mode', 'reports');
  if (ctx.state._invite) { ctx.state._invite = false; ctx.later(() => inviteModal(ctx), 80); }
}
