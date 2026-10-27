// App shell: product switcher, grouped nav, top bar (search, setup pill, Sandbox/Live, credits, language,
// notifications, help), sandbox band, demo footer bar and the Demo controls (sidebar foot + footer bar — never
// floating over the page). It re-renders its own parts on
// language and state changes; the screen outlet is never touched here.
// CONTRACT: every interactive element carries data-action="<id>" (shell.*).
// The shell owns the document-level dispatcher: an unhandled [data-action] (other than a plain link)
// logs a console error — the QA dead-click gate relies on it.

import { html, raw, $, $$, on, isMobile, reducedMotion } from './core/dom.js';
import { t, LANGS, getLang, setLang, loc } from './core/i18n.js';
import { fmt } from './core/format.js';
import { store } from './core/store.js';
import { persist, KEYS } from './core/persist.js';
import { go, getScreens, currentScreen } from './core/router.js';
import { balance, trialLeft, stepsDone, markAllRead, markRead, setEnv, setMode, isActive, describeProfile, setBillingPreset, billingProfile } from './core/actions.js';
import { PRICES } from './data/prices.js';
import { TEST_WORKSPACE_NAME } from './data/active.js';
import { ui } from './ui/index.js';
import { GO_KEYS } from './ui/palette.js';

const GROUPS = ['start', 'build', 'operate', 'account'];
const PRODUCTS = [{ id: 'sms', icon: 'sms' }, { id: 'line', icon: 'chat' }, { id: 'email', icon: 'mail' }, { id: 'voice', icon: 'phone' }];
const LANG_MENU = ['en', 'zh', 'th']; // English · 中文 · ไทย
const NOTIF_ICON = { welcome: 'sparkles', numberVerified: 'check-circle', incidentResolved: 'activity', failureRate: 'alert', ticketReply: 'lifebuoy', trunkDown: 'server', campaignFinished: 'megaphone', numberOrdered: 'hash', webhookFailing: 'link', plansNew: 'sparkles', testCall: 'phone-call', topUp: 'coin', planRequest: 'calendar', ticketReceived: 'ticket', alertTest: 'bell', planCycle: 'calendar' };
const ANNOUNCE_PIN = 'announce-pin-dismissed';

let hooks = {};
let collapsed = new Set(persist.get(KEYS.navCollapsed, []));
let shownBalance = null;

/** Days of credit left at the 7-day average spend (active) — null when unknown. */
export function runwayDays() {
  const avg = store.get('billing.avgPerDay7');
  return isActive() && avg ? balance() / avg : null;
}

const openAlerts = () => (store.get('alertHistory') || []).filter((a) => a.status === 'open').length;

// ---------- templates ----------
function sidebarHTML() {
  const screens = getScreens();
  const cur = currentScreen().id;
  const org = loc(store.get('org.name'));
  const user = store.get('user');
  const alerts = openAlerts();
  return html`<div class="sidebar-scroll">
    <a class="brand" href="#/overview" data-action="shell.logo" aria-label="${t('app.brandAria')}"><span class="brand-mark">${ui.icon('ants')}</span>
      <span class="brand-txt"><span class="brand-name">ANTS</span><span class="brand-sub">${t('app.platform')}</span></span></a>
    <div class="prodsw" role="group" aria-label="${t('product.aria')}" data-tour="product">${PRODUCTS.map((p) => html`<button type="button" data-action="shell.prod.${p.id}" ${raw(p.id === 'voice' ? 'aria-current="page"' : '')} data-tip-key="product.${p.id}Tip">${ui.icon(p.icon)}<span>${t(`product.${p.id}`)}</span></button>`)}</div>
    <nav aria-label="${t('nav.aria')}" class="stack" style="gap:var(--s-3)">
      ${GROUPS.map((g) => {
        const items = screens.filter((m) => m.nav && m.nav.group === g);
        const isCol = collapsed.has(g);
        return html`<div class="navgroup" data-collapsed="${isCol}">
          <button type="button" class="navgroup-h" data-action="shell.nav.group.${g}" aria-expanded="${!isCol}" ${raw(g === 'account' ? 'data-tip-key="nav.group.accountTip"' : '')}><span>${t(`nav.group.${g}`)}</span>${ui.icon('chevron-down')}</button>
          <ul class="navlist">${items.map((m) => html`<li><a class="navlink" href="#/${m.id}" data-action="shell.nav.${m.id}" data-tour="nav-${m.id}" data-tip-key="${m.nav.labelKey}" data-tip-rail ${raw(m.id === cur ? 'aria-current="page"' : '')} ${raw(GO_KEYS[m.id] ? `data-tip-kbd="G ${GO_KEYS[m.id]}"` : '')}>${ui.icon(m.nav.icon)}<span class="navlabel">${t(m.nav.labelKey)}</span>${m.nav.beta ? html`<span class="chip chip-info navtag">${t('common.beta')}</span>` : ''}${m.id === 'alerts' && alerts ? html`<span class="badge badge-err navtag" aria-label="${t('nav.alertsOpen', { count: alerts })}">${alerts}</span>` : ''}</a></li>`)}</ul>
        </div>`;
      })}
    </nav>
  </div>
  <div class="sidebar-foot"><button type="button" class="demo-btn" data-action="shell.demo" aria-haspopup="dialog" aria-expanded="false" data-tip-key="demo.title" data-tip-rail>${ui.icon('sliders')}<span class="navlabel">${t('demo.pill')}</span></button>
    <button type="button" class="acct" data-action="shell.account" aria-haspopup="menu" aria-expanded="false" aria-label="${t('account.aria')}">
    <span class="avatar">${user.initials}</span><span class="acct-txt"><strong>${user.name}</strong><span>${t(`role.${user.role}`)} · ${org}</span></span>${ui.icon('chevron-up', 'ico-sm')}</button></div>`;
}

// Sandbox allowance: 50 minutes or 100 OTP calls, no end date. Credits topped up in Sandbox show beside it.
const trialVars = () => ({ otp: fmt.num(PRICES.trial.otpCallUses, 1), min: fmt.int(PRICES.trial.minutes), otpCalls: fmt.int(PRICES.trial.minutes / PRICES.trial.otpCallUses) });

function creditsHTML() {
  if (store.get('env') === 'sandbox') {
    const left = trialLeft();
    const low = left <= 10;
    return html`<div class="credits tb-credits ${low ? 'is-amber' : ''}" data-tour="credits">
      <button type="button" class="credits-btn" data-action="shell.credits" aria-haspopup="menu" aria-expanded="false" data-tip-key="top.trialTip" data-tip-vars='${JSON.stringify(trialVars())}'>
        <span class="coin">${ui.icon('coin')}</span><span class="credits-txt"><small>${balance() > 0 ? t('top.trialCredits', { credits: fmt.floor(balance()) }) : t('top.trial')}</small><strong>${t('top.trialValue', { left: fmt.num(left, 1), total: fmt.int(PRICES.trial.minutes) })}</strong></span></button>
      <button type="button" class="btn btn-sm tb-topup" data-action="shell.credits.topup">${t('top.topup')}</button></div>`;
  }
  // Live: prepaid shows the credit balance; postpaid shows this month's usage against the credit limit; a plan
  // adds a third line "Plan 50,000 min · N used" (hidden when the top bar is tight — the credits menu has it).
  const d = describeProfile();
  const planLine = d.plan ? html`<small class="plan-line">${t('bm.chip.plan', { min: fmt.int(d.plan.committedMinutes), used: fmt.int(d.plan.usedMinutes) })}</small>` : '';
  if (d.mode === 'postpaid') {
    const tone = d.pctOfLimit >= 95 ? 'is-red' : d.pctOfLimit >= 80 ? 'is-amber' : '';
    return html`<div class="credits tb-credits ${tone} ${d.plan ? 'has-plan' : ''}" data-tour="credits">
      <button type="button" class="credits-btn" data-action="shell.credits" aria-haspopup="menu" aria-expanded="false" data-tip-key="${d.modeKey}">
        <span class="coin">${ui.icon('coin')}</span><span class="credits-txt"><small>${tone ? t('bm.chip.nearLimit') : t('bm.chip.used')}</small><strong>${t('bm.chip.usedValue', { used: fmt.floor(d.usedThisMonth), limit: fmt.int(d.creditLimit) })}</strong>${planLine}</span></button></div>`;
  }
  const b = balance();
  const r = runwayDays();
  const tone = r != null && r < 1 ? 'is-red' : r != null && r < 3 ? 'is-amber' : '';
  const sub = r != null ? t('top.runway', { days: fmt.int(Math.max(0, Math.floor(r))) }) : t('top.credits');
  return html`<div class="credits tb-credits ${tone} ${d.plan ? 'has-plan' : ''}" data-tour="credits">
    <button type="button" class="credits-btn" data-action="shell.credits" aria-haspopup="menu" aria-expanded="false" data-tip-key="term.credits">
      <span class="coin">${ui.icon('coin')}</span><span class="credits-txt"><small>${tone === 'is-red' ? t('top.lowBalance') : sub}</small><strong data-credits-value>${fmt.floor(shownBalance ?? b)}</strong>${planLine}</span></button>
    <button type="button" class="btn btn-sm tb-topup ${tone ? 'btn-primary' : ''}" data-action="shell.credits.topup">${t('top.topup')}</button></div>`;
}

// ☰ — phone: opens the nav drawer · 768–1023: opens the full nav over the icon rail · from 1024: collapses the nav
// to the icon rail and back; that choice is remembered (persist 'navRail').
const navRailPref = () => !!persist.get('navRail', false);
function burgerState() {
  const w = window.innerWidth;
  const open = document.body.classList.contains('nav-open');
  if (w >= 1024) { const rail = navRailPref(); return { label: t(rail ? 'nav.expand' : 'nav.collapse'), expanded: !rail }; }
  return { label: t(open ? 'nav.close' : 'nav.open'), expanded: open };
}
function applyRail() {
  const w = window.innerWidth;
  const rail = w >= 1024 ? navRailPref() : w >= 768 ? !document.body.classList.contains('nav-open') : false;
  document.documentElement.classList.toggle('rail', rail);
  const b = document.querySelector('[data-action="shell.burger"]');
  if (b) { const st = burgerState(); b.setAttribute('aria-label', st.label); b.setAttribute('aria-expanded', String(st.expanded)); b.dataset.tip = st.label; }
}

function topbarHTML() {
  const cur = currentScreen();
  const mod = cur.mod;
  const title = mod && mod.titleKey ? t(mod.titleKey) : '';
  const crumb = mod && mod.crumb ? mod.crumb(cur.params, { t: (k, v) => t(k, v, mod.id) }) : '';
  const env = store.get('env');
  const unread = store.get('notifications').filter((n) => !n.read).length;
  const done = stepsDone();
  const showSetup = store.get('mode') === 'firstRun' && done < 6;
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const liveLocked = store.get('mode') === 'firstRun' && env === 'sandbox' && balance() <= 0;
  return html`
    <button type="button" class="iconbtn navtoggle" data-action="shell.burger" data-tour="navtoggle" aria-label="${burgerState().label}" data-tip="${burgerState().label}" aria-controls="sidebar" aria-expanded="${burgerState().expanded}">${ui.icon('menu')}</button>
    <div class="crumbs"><a href="#/overview" class="crumb-link" data-action="shell.crumb.voice">${t('product.voice')}</a>${ui.icon('chevron-right')}<strong>${title}</strong>${crumb ? html`${ui.icon('chevron-right')}<strong>${crumb}</strong>` : ''}</div>
    <button type="button" class="searchbtn" data-action="shell.search" aria-label="${t('top.search')}" data-tip-key="top.search" data-tip-kbd="${isMac ? '⌘K' : 'Ctrl K'}">${ui.icon('search', 'ico-sm')}<span class="lbl">${t('top.searchShort')}</span><kbd>${isMac ? '⌘K' : 'Ctrl K'}</kbd></button>
    ${showSetup ? html`<button type="button" class="setup-pill tb-setup" data-action="shell.setup" data-tip-key="top.setupTip" data-tip-vars='${JSON.stringify({ done, total: 6 })}'><span class="bar"><i style="width:${Math.round((done / 6) * 100)}%"></i></span><span class="setup-word">${t('top.setupWord')}</span> <span class="tnum">${done}/6</span></button>` : ''}
    <span class="break" aria-hidden="true"></span>
    <div class="envseg tb-env" role="group" aria-label="${t('top.envAria')}" data-tour="env">
      <button type="button" data-action="shell.env.live" aria-pressed="${env === 'live'}" ${raw(liveLocked ? 'aria-disabled="true"' : '')} data-tip-key="term.live"><span class="dot" style="background:var(--green)"></span>${t('top.live')}</button>
      <button type="button" data-action="shell.env.sandbox" aria-pressed="${env === 'sandbox'}" data-tip-key="term.sandbox"><span class="dot" style="background:var(--amber)"></span>${t('top.sandbox')}</button>
    </div>
    ${creditsHTML()}
    <button type="button" class="langbtn" data-action="shell.lang" aria-haspopup="menu" aria-expanded="false" aria-label="${t('top.langAria')}" data-tour="lang">${ui.icon('globe', 'ico-sm')}<span class="lbl">${LANGS[getLang()].label}</span><span class="lbl-short">${{ en: 'EN', th: 'TH', zh: '中' }[getLang()]}</span>${ui.icon('chevron-down', 'ico-xs')}</button>
    <button type="button" class="iconbtn" data-action="shell.bell" aria-haspopup="dialog" aria-expanded="false" aria-label="${t('top.bellAria', { count: unread })}" data-tip-key="top.bell">${ui.icon('bell')}${unread ? html`<span class="count">${unread}</span>` : ''}</button>
    <button type="button" class="iconbtn" data-action="shell.help" aria-haspopup="menu" aria-expanded="false" aria-label="${t('top.help')}" data-tip-key="top.help" data-tip-kbd="?" data-tour="help">${ui.icon('help')}</button>`;
}

function bandHTML() {
  if (store.get('env') !== 'sandbox') return '';
  const mod = currentScreen().mod;
  const key = mod && mod.sandboxNoteKey ? `${mod.id}.${mod.sandboxNoteKey}` : 'top.sandboxBand';
  return html`<div class="env-band" role="note">${ui.icon('alert')}<span>${t(key)}</span><a class="btn btn-sm" href="#/overview?focus=golive" data-action="shell.sandboxbar">${t('top.goLive')}</a></div>`;
}

function footHTML() {
  return html`<span>${t('app.demoFooter')}</span><button type="button" class="linkbtn" data-action="shell.demo" aria-haspopup="dialog" style="font-weight:600">${t('demo.pill')}</button><span aria-hidden="true">·</span><button type="button" class="linkbtn" data-action="shell.demobar.reset" style="font-weight:600">${t('account.reset')}</button><span aria-hidden="true">·</span><a href="#/help/status" class="linkbtn" style="font-weight:500">${t('help.status')}</a><span aria-hidden="true">·</span><span>© 2026 ANTS</span>`;
}

// ---------- panels & menus ----------
function notifVars(n) {
  const v = { ...(n.vars || {}) };
  if (v.status) v.status = t(`status.${v.status}`);
  if (v.campaign) { const c = (store.get('campaigns') || []).find((x) => x.id === v.campaign); v.campaign = c ? loc(c.name) : v.campaign; }
  for (const k of ['saving', 'total', 'bonus']) if (v[k] != null) v[k] = fmt.int(v[k]);
  return v;
}

function notificationsPanel(anchor) {
  const list = store.get('notifications');
  const pinned = persist.get(ANNOUNCE_PIN) !== true;
  const content = html`<div class="notif-head"><h2>${t('notif.title')}</h2>
      <button type="button" class="btn btn-ghost btn-sm" data-action="ntf.readall" ${raw(list.some((n) => !n.read) ? '' : 'aria-disabled="true"')}>${t('notif.markAll')}</button>
      <a class="btn btn-ghost btn-sm btn-icon" href="#/settings?tab=notifications" data-action="ntf.settings" aria-label="${t('notif.settings')}" data-tip-key="notif.settings">${ui.icon('settings')}</a></div>
    <div class="notif-list">
      ${pinned ? html`<div class="notif notif-pin"><span class="ni" style="background:var(--orange-50);color:var(--orange)">${ui.icon('sparkles')}</span>
        <span class="nt"><strong>${t('notif.announce.title')}</strong><span>${t('notif.announce.body')}</span>
        <span class="row" style="gap:6px;margin-top:4px"><button type="button" class="btn btn-sm" data-action="ntf.ann">${t('notif.openAnnounce')}</button><button type="button" class="btn btn-ghost btn-sm" data-action="ntf.ann.dismiss">${t('notif.dismiss')}</button></span></span></div>` : ''}
      ${list.length ? list.map((n) => html`<button type="button" class="notif ${n.read ? '' : 'unread'}" data-action="ntf.item" data-value="${n.id}">
      <span class="ni">${ui.icon(NOTIF_ICON[n.type] || 'bell')}</span>
      <span class="nt"><strong>${t(`notif.${n.type}.title`, notifVars(n))}</strong><span>${t(`notif.${n.type}.body`, notifVars(n))}</span><span>${fmt.relative(n.at)}</span></span></button>`)
      : html`<div class="empty empty-center"><span class="art">${ui.icon('bell')}</span><strong>${t('notif.empty')}</strong><span class="hint">${t('notif.emptyHint')}</span></div>`}</div>`;
  const h = ui.popover(anchor, {
    content,
    className: 'notif-panel',
    label: t('notif.title'),
    actions: {
      'ntf.readall': () => { markAllRead(); h.close(); ui.toast(t('notif.allRead'), { kind: 'success' }); },
      'ntf.item': (el) => {
        const n = list.find((x) => x.id === el.dataset.value);
        markRead(el.dataset.value);
        h.close();
        if (n && n.href) go(n.href);
      },
      'ntf.ann': () => { h.close(); hooks.announce(); },
      'ntf.ann.dismiss': (el) => { persist.set(ANNOUNCE_PIN, true); const pin = el.closest('.notif-pin'); if (pin) pin.remove(); },
      'ntf.settings': () => { h.close(); go('settings?tab=notifications'); },
    },
  });
}

function helpMenu(anchor) {
  const open = (store.get('tickets') || []).filter((x) => x.status !== 'solved').length;
  ui.menu(anchor, [
    { id: 'shell.help.center', label: t('help.center'), icon: 'book', href: '#/help' },
    { id: 'shell.help.status', label: t('help.status'), icon: 'activity', href: '#/help/status', meta: html`<span class="dot dot-ok"></span>` },
    { id: 'shell.help.contact', label: t('help.contact'), icon: 'lifebuoy', href: '#/help/contact' },
    { id: 'shell.help.tickets', label: t('help.tickets'), icon: 'ticket', href: '#/help/tickets', meta: open ? html`<span class="badge">${open}</span>` : '' },
    { id: 'shell.help.sales', label: t('help.sales'), icon: 'building', href: '#/help/contact?topic=sales' },
    { id: 'shell.help.whatsnew', label: t('help.whatsNew'), icon: 'sparkles', href: '#/help/whats-new' },
    { sep: true },
    { id: 'shell.help.shortcuts', label: t('help.shortcuts'), icon: 'keyboard', kbd: '?', onSelect: () => ui.shortcuts() },
    { id: 'shell.help.tour', label: t('help.tour'), icon: 'compass', onSelect: () => hooks.tour() },
  ], { label: t('top.help'), head: html`<div class="menu-head"><strong style="font-size:var(--fs-sm)">${t('help.supportTitle')}</strong><div class="hint-xs">${t('help.supportHours')}</div></div>`, foot: html`<div class="menu-foot hint-xs">${ui.icon('globe', 'ico-xs')}${t('help.translationPending')}</div>` });
}

function langMenu(anchor) {
  ui.menu(anchor, LANG_MENU.map((code) => ({ id: `shell.lang.${code}`, label: LANGS[code].label, checked: code === getLang(), lang: LANGS[code].html, onSelect: () => setLang(code) })), { label: t('top.langAria') });
}

/** Plain lines about the billing set-up (credits menu head; Billing and Settings use describeProfile too). */
function profileLines(d) {
  const lines = [t(d.modeKey)];
  if (d.mode === 'postpaid') lines.push(t('bm.limitLine', { limit: fmt.int(d.creditLimit), days: d.paymentTermsDays }));
  if (d.plan) {
    const p = d.plan;
    lines.push(t('bm.planLine', { min: fmt.int(p.committedMinutes), rate: fmt.rate(p.rate), charge: fmt.int(p.monthlyCharge), day: p.cycleStartDay }));
    lines.push(t('bm.chip.plan', { min: fmt.int(p.committedMinutes), used: fmt.int(p.usedMinutes) }));
    lines.push(t('bm.overageLine', { min: fmt.int(p.committedMinutes), rate: fmt.rate(p.rate) }));
    lines.push(t(p.policyKey, { months: p.carryMonths }));
  }
  lines.push(t('bm.rate', { label: loc(d.rate.label) }));
  return lines;
}

function creditsMenu(anchor) {
  const sandbox = store.get('env') === 'sandbox';
  const d = describeProfile();
  const postpaid = !sandbox && d.mode === 'postpaid';
  ui.menu(anchor, [
    postpaid
      ? { id: 'shell.credits.invoice', label: t('bm.menu.invoice'), icon: 'file', href: '#/billing?section=invoices' }
      : { id: 'shell.credits.menu.topup', label: t('top.topup'), icon: 'coin', onSelect: () => ui.topup() },
    ...(d.plan && !sandbox ? [{ id: 'shell.credits.plan', label: t('bm.menu.plan'), icon: 'calendar', href: '#/billing?section=plan' }] : []),
    { id: 'shell.credits.prices', label: t('top.viewPrices'), icon: 'list', href: '#/billing?section=prices' },
    ...(postpaid ? [] : [{ id: 'shell.credits.auto', label: t('top.autoTopup'), icon: 'refresh', href: '#/billing?panel=auto' }]),
    { id: 'shell.credits.limits', label: t('top.spendLimits'), icon: 'shield', href: '#/billing?panel=limits' },
  ], { label: t('top.credits'), head: html`<div class="menu-head">${sandbox ? html`<div class="hint-xs">${t('top.trialTip', trialVars())}</div>` : html`<ul class="menu-lines">${profileLines(d).map((l) => html`<li class="hint-xs">${l}</li>`)}</ul>`}</div>` });
}

function accountMenu(anchor) {
  const user = store.get('user');
  const mode = store.get('mode');
  ui.menu(anchor, [
    { id: 'shell.account.profile', label: t('account.profile'), icon: 'user', onSelect: openProfile },
    { id: 'shell.account.org', label: t('account.switchOrg'), icon: 'building', onSelect: openSwitchOrg },
    { sep: true },
    { heading: t('account.demoView') },
    { id: 'shell.account.view.new', label: t('account.viewNew'), checked: mode === 'firstRun', onSelect: () => hooks.mode('firstRun') },
    { id: 'shell.account.view.active', label: t('account.viewActive'), checked: mode === 'active', onSelect: () => hooks.mode('active') },
    { sep: true },
    { id: 'shell.account.reset', label: t('account.reset'), icon: 'refresh', onSelect: () => hooks.reset() },
    { id: 'shell.account.signout', label: t('account.signOut'), icon: 'logout', danger: true, onSelect: () => ui.toast(t('toast.T35'), { kind: 'info', demo: true }) },
  ], { align: 'start', label: t('account.aria'), head: html`<div class="menu-head"><strong style="font-size:var(--fs-sm)">${user.name}</strong><div class="hint-xs">${user.email}</div><div class="hint-xs">${t(`role.${user.role}`)} · ${loc(store.get('org.name'))}</div></div>` });
}

function openProfile() {
  const u = store.get('user');
  ui.modal({
    title: t('account.profile'),
    size: 'sm',
    body: html`<div class="stack-3">
      <label class="field"><span class="label">${t('account.name')}</span><input class="input" value="${u.name}" data-p="name"></label>
      <label class="field"><span class="label">${t('account.email')}</span><input class="input" value="${u.email}" readonly></label>
      <label class="field"><span class="label">${t('account.language')}</span><select class="select" data-p="lang">${['en', 'th', 'zh'].map((c) => html`<option value="${c}" ${raw(c === getLang() ? 'selected' : '')}>${LANGS[c].label}</option>`)}</select></label>
      <div class="kv"><span class="k">${t('account.role')}</span><span class="v">${t(`role.${u.role}`)}</span></div>
      <div class="kv"><span class="k">${t('account.twoFactor')}</span><span class="v"><span class="chip chip-ok">${t('common.on')}</span></span></div></div>`,
    buttons: [{ label: t('common.cancel'), action: 'shell.profile.cancel' }, { label: t('common.save'), kind: 'navy', action: 'shell.profile.save', onClick: (h) => {
      const name = h.el.querySelector('[data-p="name"]').value.trim() || u.name;
      const lang = h.el.querySelector('[data-p="lang"]').value;
      store.set('user', { ...u, name, initials: name.slice(0, 1).toUpperCase() });
      ui.toast(t('toast.T02'), { kind: 'success' });
      if (lang !== getLang()) setTimeout(() => setLang(lang), 200);
    } }],
  });
}

function openSwitchOrg() {
  const cur = store.get('org.id');
  const orgs = [{ id: store.get('org.id'), name: store.get('org.name') }, { id: 'org_test', name: TEST_WORKSPACE_NAME }];
  ui.modal({
    title: t('account.switchOrg'),
    size: 'sm',
    body: html`<div class="stack" role="radiogroup" aria-label="${t('account.switchOrg')}">${orgs.map((o) => html`<button type="button" class="optcard" role="radio" data-action="shell.account.org.pick" data-value="${o.id}" aria-checked="${o.id === cur}" style="flex-direction:row;align-items:center;gap:10px">${ui.icon('building')}<span class="t grow">${loc(o.name)}</span>${o.id === cur ? html`<span class="chip chip-ok">${t('account.current')}</span>` : ''}</button>`)}</div>
      <p class="hint-xs" style="margin-top:10px">${t('account.switchNote')}</p>`,
    actions: {
      'shell.account.org.pick': (el, ev, h) => {
        h.close();
        if (el.dataset.value === cur) return;
        setMode('firstRun', { fresh: true, orgName: TEST_WORKSPACE_NAME });
        store.set('org.id', 'org_test');
        hooks.rerender();
        ui.toast(t('account.switched', { org: loc(TEST_WORKSPACE_NAME) }), { kind: 'success', demo: true });
      },
    },
    buttons: [{ label: t('common.close'), action: 'shell.dialog.close' }],
  });
}

// Demo panel › Billing mode: the four set-ups the team can show (a real account gets its terms from sales).
const BILLING_PRESETS = ['prepaid', 'postpaid', 'prepaid-plan', 'postpaid-plan'];
const currentPreset = () => { const p = billingProfile(); return `${p.mode}${p.plan ? '-plan' : ''}`; };

function demoPanel(anchor) {
  const mode = store.get('mode');
  const h = ui.popover(anchor, {
    className: 'demo-panel',
    label: t('demo.title'),
    align: 'start',
    content: html`<div class="dp-head"><strong>${t('demo.title')}</strong><span>${t('app.demoShort')}</span></div>
      <div class="dp-body">
        <div class="dp-row"><span class="label">${t('account.demoView')}</span><div class="seg" role="group" aria-label="${t('account.demoView')}">
          <button type="button" data-action="demo.view.new" aria-pressed="${mode === 'firstRun'}">${t('account.viewNew')}</button>
          <button type="button" data-action="demo.view.active" aria-pressed="${mode === 'active'}">${t('account.viewActive')}</button></div>
          <span class="hint-xs">${t('demo.viewHint')}</span></div>
        <div class="dp-row"><label class="label" for="demo-billing">${t('bm.preset.label')}</label>
          <select class="select" id="demo-billing" data-demo="billing" data-action="demo.billing">${BILLING_PRESETS.map((p) => html`<option value="${p}" ${raw(p === currentPreset() ? 'selected' : '')}>${t(`bm.preset.${p.replace('-plan', 'Plan')}`, { min: fmt.int(PRICES.plans[0].minMinutes) })}</option>`)}</select>
          <span class="hint-xs">${t('bm.preset.hint')}</span></div>
        <div class="dp-row"><label class="label" for="demo-outcome">${t('demo.outcome')}</label>
          <select class="select" id="demo-outcome" data-demo="outcome">${['answered', 'busy', 'no-answer', 'failed'].map((o) => html`<option value="${o}" ${raw(store.get('demo.outcome') === o ? 'selected' : '')}>${t(`dialer.out.${o}`)}</option>`)}</select></div>
        <div class="row">
          <button type="button" class="btn btn-sm" data-action="demo.error">${ui.icon('alert-circle')}${t('demo.error')}</button>
          <button type="button" class="btn btn-sm" data-action="demo.tour">${ui.icon('compass')}${t('help.tour')}</button>
          <button type="button" class="btn btn-sm" data-action="demo.announce">${ui.icon('sparkles')}${t('demo.announce')}</button>
        </div>
        <button type="button" class="btn btn-sm btn-danger-ghost" data-action="demo.reset">${ui.icon('refresh')}${t('account.reset')}</button>
      </div>`,
    actions: {
      'demo.view.new': () => { h.close(); hooks.mode('firstRun'); },
      'demo.view.active': () => { h.close(); hooks.mode('active'); },
      'demo.error': () => { const id = currentScreen().id; store.set('demo.errorScreen', id); h.close(); hooks.rerender(); ui.toast(t('demo.errorOn'), { kind: 'info', demo: true }); },
      'demo.tour': () => { h.close(); hooks.tour(); },
      'demo.announce': () => { h.close(); hooks.announce(); },
      'demo.reset': () => { h.close(); hooks.reset(); },
      'demo.billing': () => {}, // the native list opens; the change handler below applies the choice
    },
  });
  if (h) on(h.el, 'change', '[data-demo="billing"]', (ev, el) => {
    const d = (setBillingPreset(el.value), describeProfile());
    ui.toast(t('bm.preset.set', { mode: t(d.modeKey) }), { kind: 'success', demo: true });
  });
  if (h) on(h.el, 'change', '[data-demo="outcome"]', (ev, el) => { store.set('demo.outcome', el.value); ui.toast(t('demo.outcomeSet', { outcome: t(`dialer.out.${el.value}`) }), { kind: 'success' }); });
}

async function envAction(target, el) {
  const env = store.get('env');
  if (target === env) return;
  if (target === 'live') {
    if (el && el.getAttribute('aria-disabled') === 'true') { ui.goLivePopover(el); return; }
    if (balance() <= 0) { ui.goLive(); return; }
    setEnv('live');
    ui.toast(t('toast.T37', { env: t('top.live') }), { kind: 'success' });
    return;
  }
  if (isActive() || env === 'live') {
    const ok = await ui.confirm({ title: t('top.toSandboxTitle'), body: t('top.toSandboxBody'), confirmLabel: t('top.toSandboxYes'), cancelLabel: t('top.stayLive') });
    if (!ok) return;
  }
  setEnv('sandbox');
  ui.toast(t('toast.T37', { env: t('top.sandbox') }), { kind: 'info' });
}

/** Count the credits chip up after a top-up, and float "+N". */
function animateCredits(from, to) {
  const el = $('[data-credits-value]');
  if (!el || reducedMotion() || to <= from) { shownBalance = null; return; }
  const t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / 800);
    const v = from + (to - from) * (1 - Math.pow(1 - k, 3));
    const e = $('[data-credits-value]');
    if (e) e.textContent = fmt.floor(v);
    shownBalance = v;
    if (k < 1) requestAnimationFrame(step); else shownBalance = null;
  };
  requestAnimationFrame(step);
  const chip = el.closest('.credits');
  if (chip) {
    const f = document.createElement('span');
    f.className = 'credit-float';
    f.textContent = `+${fmt.int(to - from)}`;
    chip.appendChild(f);
    setTimeout(() => f.remove(), 700);
  }
}

// ---------- mount ----------
export function mountShell(appEl, h) {
  hooks = h;
  appEl.innerHTML = String(html`<button type="button" class="skip" data-action="shell.skip">${t('app.skip')}</button>
    <div class="layout">
      <aside class="sidebar" id="sidebar"></aside>
      <div class="scrim" data-action="shell.scrim" aria-hidden="true"></div>
      <div class="main-col">
        <header class="topbar"></header>
        <div data-band></div>
        <main id="main" tabindex="-1"><div id="outlet"></div></main>
        <footer class="app-foot demo-bar"></footer>
      </div>
    </div>
    <div id="layers"></div>`);

  const sidebar = $('#sidebar');
  const topbar = $('.topbar');
  const band = $('[data-band]');
  const foot = $('.app-foot');

  const render = {
    sidebar: () => { sidebar.innerHTML = String(sidebarHTML()); },
    topbar: () => {
      const a = document.activeElement;
      const key = a && topbar.contains(a) ? a.dataset.action : null;
      topbar.innerHTML = String(topbarHTML());
      if (key) { const el = $$('[data-action]', topbar).find((x) => x.dataset.action === key); if (el) el.focus(); }
    },
    band: () => { band.innerHTML = String(bandHTML()); },
    foot: () => { foot.innerHTML = String(footHTML()); },
    all() { this.sidebar(); this.topbar(); this.band(); this.foot(); const l = $('[data-demo-label]'); if (l) l.textContent = t('demo.pill'); $('.skip').textContent = t('app.skip'); },
  };
  render.all();

  let lastBalance = balance();
  let lastMode = store.get('mode');
  store.subscribe('*', (st, path) => {
    if (path === '*' || /^(env|mode|credits|notifications|onboarding|calls|org|user|tickets|alertHistory|billing)/.test(path)) {
      const b = balance();
      const grew = store.get('mode') === lastMode && b > lastBalance + 0.5;
      const from = lastBalance;
      lastBalance = b;
      lastMode = store.get('mode');
      render.topbar();
      render.band();
      if (grew) animateCredits(from, b);
    }
    if (path === '*' || /^(org|user|alertHistory|mode)/.test(path)) render.sidebar();
  });

  const closeNav = () => { document.body.classList.remove('nav-open'); applyRail(); };
  const exact = {
    'shell.skip': () => { const m = $('#main'); m.focus(); m.scrollIntoView(); },
    'shell.burger': () => {
      if (window.innerWidth >= 1024) { persist.set('navRail', !navRailPref()); applyRail(); return; }
      const open = !document.body.classList.contains('nav-open');
      document.body.classList.toggle('nav-open', open);
      applyRail();
      if (open) setTimeout(() => { const a = $('.navlink[aria-current="page"]') || $('.navlink'); if (a) a.focus(); }, 60);
    },
    'shell.scrim': closeNav,
    'shell.search': () => ui.palette(),
    'shell.setup': () => go('overview?focus=checklist'),
    'shell.env.live': (el) => envAction('live', el),
    'shell.env.sandbox': (el) => envAction('sandbox', el),
    'shell.credits': (el) => creditsMenu(el),
    'shell.credits.topup': () => ui.topup(),
    'shell.lang': (el) => langMenu(el),
    'shell.bell': (el) => notificationsPanel(el),
    'shell.help': (el) => helpMenu(el),
    'shell.account': (el) => accountMenu(el),
    'shell.demo': (el) => demoPanel(el),
    'shell.demobar.reset': () => hooks.reset(),
  };
  const prefix = [
    ['shell.prod.', (el, id) => { if (id === 'voice') go('overview'); else ui.toast(t('toast.T36', { ch: t(`product.${id}`) }), { kind: 'info', demo: true }); }],
    ['shell.nav.group.', (el, g) => {
      if (collapsed.has(g)) collapsed.delete(g); else collapsed.add(g);
      persist.set(KEYS.navCollapsed, [...collapsed]);
      el.closest('.navgroup').dataset.collapsed = String(collapsed.has(g));
      el.setAttribute('aria-expanded', String(!collapsed.has(g)));
    }],
  ];

  // One document-level dispatcher: screens and overlays mark ev.__handled; what is left must be a shell
  // action or a plain link. Anything else is a dead click and is reported.
  on(document, 'click', '[data-action]', (ev, el) => {
    if (ev.__handled) return;
    const name = el.dataset.action;
    if (exact[name]) { exact[name](el, ev); return; }
    const p = prefix.find(([pre]) => name.startsWith(pre));
    if (p) { p[1](el, name.slice(p[0].length), ev); return; }
    if (el.tagName.toLowerCase() === 'a' && el.getAttribute('href') && el.getAttribute('href') !== '#') {
      // A link to the page you are on still answers: re-render it and go back to the top (no dead click).
      if (el.getAttribute('href') === location.hash) {
        ev.preventDefault();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        go(location.hash, { replace: true });
        // Visible even when already at the top: the page plays its entry motion again.
        const o = $('#outlet');
        if (o && !reducedMotion()) { o.classList.remove('replay'); void o.offsetWidth; o.classList.add('replay'); setTimeout(() => o.classList.remove('replay'), 400); }
      }
      return; // navigation
    }
    console.error(`Unhandled data-action "${name}" — every clickable needs a handler (no dead clicks).`);
  });
  // Phone drawer: picking a page or a product closes it; Esc closes it too.
  on(sidebar, 'click', 'a.navlink, a.brand, .prodsw button', () => { if (window.innerWidth < 1024) closeNav(); });
  on(document, 'keydown', (ev) => {
    if (ev.key === 'Escape' && document.body.classList.contains('nav-open')) { closeNav(); const b = $('[data-action="shell.burger"]'); if (b) b.focus(); }
  });
  on(window, 'resize', () => { if (!isMobile()) closeNav(); else applyRail(); });
  applyRail();

  return {
    render,
    onScreen(mod) {
      render.topbar();
      render.band();
      $$('.navlink', sidebar).forEach((a) => {
        if (a.getAttribute('href') === `#/${mod.id}`) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      });
      document.title = `${mod.titleKey ? t(mod.titleKey) : 'ANTS'} · ANTS Voice`;
      if (window.innerWidth < 1024) closeNav();
    },
    closeNav,
  };
}

