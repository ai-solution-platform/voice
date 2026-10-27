// Command palette (⌘K / Ctrl+K) + keyboard shortcuts (? sheet, G then a letter, D dialer).
// CONTRACT: screens add entries with `export const commands = [{ id, labelKey, icon, keywords: ['en words'], run(ctxLite) }]`
// (labelKey is looked up in the screen's own namespace). Matching is fuzzy against the current language AND
// English, so typing "logs" in Thai finds บันทึกการโทร. `call_…` jumps to that call; digits match phone numbers.

import { html, el as toEl, on, effect } from '../core/dom.js';
import { t, setLang, LANGS, LANG_ORDER, loc } from '../core/i18n.js';
import { store } from '../core/store.js';
import { go, getScreens } from '../core/router.js';
import { pushLayer, layersRoot, animateIn, animateOut, topLayer } from './overlay.js';
import { icon } from './icons.js';
import { modal } from './modal.js';

let open = null;
const recent = [];
let hooks = {}; // set by app.js: { dialer, topup, toggleEnv, tour, announce, reset, mode, sales }

export function configurePalette(h) { hooks = h; }

/** Shortcut letters for G-navigation (also shown in nav tooltips). */
export const GO_KEYS = { overview: 'O', connect: 'C', numbers: 'N', trunks: 'T', campaigns: 'P', flows: 'F', logs: 'L', reports: 'R', alerts: 'A', billing: 'B', users: 'U', keys: 'K', settings: 'S', help: 'H' };

let enT = null;
async function enLabel(key) {
  if (!enT) enT = (await import('../i18n/en.js')).default;
  return enT[key] || '';
}

function fuzzy(q, text) {
  if (!text) return false;
  const a = text.toLowerCase();
  const b = q.toLowerCase();
  if (a.includes(b)) return true;
  let i = 0;
  for (const ch of a) { if (ch === b[i]) i++; if (i === b.length) return true; }
  return false;
}

async function buildItems() {
  const items = [];
  for (const m of getScreens()) {
    if (!m.nav) continue;
    items.push({ group: 'go', id: `go:${m.id}`, label: t(m.nav.labelKey), en: await enLabel(m.nav.labelKey), icon: m.nav.icon, meta: GO_KEYS[m.id] ? `G ${GO_KEYS[m.id]}` : '', run: () => go(m.id) });
  }
  const env = store.get('env');
  const A = (id, labelKey, ic, run, vars, meta = '') => items.push({ group: 'act', id, label: t(labelKey, vars), en: '', enKey: labelKey, icon: ic, meta, run });
  A('test-call', 'palette.a.testCall', 'phone', () => hooks.dialer && hooks.dialer(), null, 'D');
  A('buy-number', 'palette.a.buyNumber', 'hash', () => go('numbers/buy'));
  A('new-campaign', 'palette.a.newCampaign', 'megaphone', () => go('campaigns/new'));
  A('create-key', 'palette.a.createKey', 'key', () => go('connect/api?focus=key'));
  A('topup', 'palette.a.topup', 'coin', () => hooks.topup && hooks.topup());
  A('env', env === 'live' ? 'palette.a.toSandbox' : 'palette.a.toLive', 'zap', () => hooks.toggleEnv && hooks.toggleEnv());
  for (const code of LANG_ORDER) A(`lang:${code}`, 'palette.a.lang', 'globe', () => setLang(code), { lang: LANGS[code].label });
  A('mode', store.get('mode') === 'active' ? 'palette.a.firstRun' : 'palette.a.active', 'sliders', () => hooks.mode && hooks.mode());
  A('tour', 'palette.a.tour', 'compass', () => hooks.tour && hooks.tour());
  A('announce', 'palette.a.whatsNew', 'sparkles', () => hooks.announce && hooks.announce());
  A('shortcuts', 'palette.a.shortcuts', 'keyboard', () => openShortcuts(), null, '?');
  A('sales', 'palette.a.sales', 'lifebuoy', () => hooks.sales && hooks.sales());
  A('reset', 'palette.a.reset', 'refresh', () => hooks.reset && hooks.reset());
  for (const it of items) if (it.enKey) it.en = await enLabel(it.enKey);
  // screen-provided commands
  for (const m of getScreens()) {
    for (const c of m.commands || []) {
      items.push({ group: 'act', id: `${m.id}:${c.id}`, label: t(c.labelKey, undefined, m.id), en: (c.keywords || []).join(' '), icon: c.icon || 'arrow-right', run: () => c.run({ go, store }) });
    }
  }
  return items;
}

function results(q) {
  const out = [];
  const query = q.trim();
  if (query.length < 2) return out;
  const calls = (store.get('calls') || []);
  if (/^call_/i.test(query)) {
    for (const c of calls) { if (c.id.toLowerCase().startsWith(query.toLowerCase())) { out.push({ group: 'res', id: c.id, label: c.id, meta: `${c.to} · ${t(`status.${c.status}`)}`, icon: 'list', run: () => go(`logs?call=${c.id}`) }); if (out.length >= 6) break; } }
    return out;
  }
  const digits = query.replace(/\D/g, '');
  if (digits.length >= 3 && digits.length === query.replace(/[\s-]/g, '').length) {
    for (const n of (store.get('numbers') || [])) if (n.number.replace(/\D/g, '').includes(digits)) out.push({ group: 'res', id: n.id, label: n.number, meta: t('nav.numbers'), icon: 'hash', run: () => go(`numbers?n=${n.id}`) });
    for (const c of calls) { if (out.length >= 8) break; if (c.to.replace(/\D/g, '').includes(digits)) out.push({ group: 'res', id: c.id, label: c.to, meta: `${c.id} · ${t(`status.${c.status}`)}`, icon: 'list', run: () => go(`logs?call=${c.id}`) }); }
    return out;
  }
  for (const c of (store.get('campaigns') || [])) if (fuzzy(query, loc(c.name)) || fuzzy(query, c.name.en)) out.push({ group: 'res', id: c.id, label: loc(c.name), meta: t('nav.campaigns'), icon: 'megaphone', run: () => go(`campaigns/${c.id}`) });
  for (const tr of (store.get('trunks') || [])) if (fuzzy(query, tr.name)) out.push({ group: 'res', id: tr.id, label: tr.name, meta: t('nav.trunks'), icon: 'server', run: () => go(`trunks/${tr.name}`) });
  for (const tp of store.get('otpTemplates') || []) if (fuzzy(query, tp.id)) out.push({ group: 'res', id: tp.id, label: tp.id, meta: t('nav.otp'), icon: 'shield-check', run: () => go(`otp?template=${tp.id}`) });
  return out.slice(0, 8);
}

export async function openPalette() {
  if (open) { open.close(); return; }
  if (topLayer() && topLayer().modal) return;
  const all = await buildItems();
  const root = toEl(html`<div class="backdrop palette-backdrop"><div class="palette" role="dialog" aria-modal="true" aria-label="${t('palette.title')}">
    <div class="palette-in">${icon('search')}<input type="text" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list" placeholder="${t('palette.placeholder')}" autocomplete="off" spellcheck="false"><span class="kbd">Esc</span></div>
    <div class="palette-list" id="palette-list" role="listbox"></div>
    <div class="palette-foot"><span><span class="kbd">↑</span> <span class="kbd">↓</span> ${t('palette.move')}</span><span><span class="kbd">↵</span> ${t('palette.run')}</span><span><span class="kbd">?</span> ${t('palette.shortcuts')}</span></div>
  </div></div>`);
  layersRoot().appendChild(root);
  const panel = root.firstElementChild;
  const input = panel.querySelector('input');
  const listEl = panel.querySelector('.palette-list');
  let shown = [];
  let sel = 0;
  const render = () => {
    const q = input.value.trim();
    const res = results(q);
    let base = q ? all.filter((it) => fuzzy(q, it.label) || fuzzy(q, it.en)) : all;
    const rec = q ? [] : recent.map((id) => all.find((x) => x.id === id)).filter(Boolean).map((x) => ({ ...x, group: 'recent' }));
    base = [...rec, ...base, ...res];
    shown = base.slice(0, 40);
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    if (!shown.length) { listEl.innerHTML = String(html`<div class="palette-empty">${t('palette.empty', { q })}</div>`); return; }
    let lastGroup = null;
    listEl.innerHTML = String(html`${shown.map((it, i) => {
      const head = it.group !== lastGroup ? html`<div class="palette-group" role="presentation">${t(`palette.g.${it.group}`)}</div>` : '';
      lastGroup = it.group;
      return html`${head}<button type="button" class="palette-item" role="option" id="pi-${i}" data-pi="${i}" aria-selected="${i === sel}">${icon(it.icon || 'arrow-right')}<span class="clip">${it.label}</span>${it.meta ? html`<span class="meta">${it.meta}</span>` : ''}</button>`;
    })}`);
    input.setAttribute('aria-activedescendant', `pi-${sel}`);
    const cur = listEl.querySelector(`#pi-${sel}`);
    if (cur) cur.scrollIntoView({ block: 'nearest' });
  };
  const runAt = (i) => {
    const it = shown[i];
    if (!it) return;
    recent.splice(0, recent.length, it.id, ...recent.filter((x) => x !== it.id).slice(0, 2));
    handle.close();
    setTimeout(() => it.run(), 10);
  };
  const offs = [];
  offs.push(on(input, 'input', () => { sel = 0; render(); }));
  offs.push(on(input, 'keydown', (ev) => {
    if (ev.isComposing || ev.keyCode === 229) return; // Chinese / Thai input methods
    if (ev.key === 'ArrowDown') { ev.preventDefault(); sel = Math.min(shown.length - 1, sel + 1); render(); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); sel = Math.max(0, sel - 1); render(); }
    else if (ev.key === 'Enter') { ev.preventDefault(); runAt(sel); }
  }));
  offs.push(on(listEl, 'click', '[data-pi]', (ev, b) => { ev.__handled = true; runAt(Number(b.dataset.pi)); }));
  offs.push(on(listEl, 'pointermove', '[data-pi]', (ev, b) => { const i = Number(b.dataset.pi); if (i !== sel) { sel = i; listEl.querySelectorAll('[aria-selected="true"]').forEach((x) => x.setAttribute('aria-selected', 'false')); b.setAttribute('aria-selected', 'true'); } }));
  offs.push(on(root, 'click', (ev) => { if (ev.target === root) handle.close(); }));
  const handle = {
    close() {
      offs.forEach((f) => f());
      unregister();
      animateOut(root, 160);
      open = null;
    },
  };
  const unregister = pushLayer({ el: panel, modal: true, close: () => handle.close() });
  open = handle;
  render();
  animateIn(root);
  setTimeout(() => input.focus(), 20);
  effect('overlay', { kind: 'palette' });
}

export function openShortcuts() {
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const rows = [
    [isMac ? '⌘ K' : 'Ctrl K', t('shortcuts.palette')],
    ['?', t('shortcuts.sheet')],
    ['D', t('shortcuts.dialer')],
    ['H', t('shortcuts.hangup')],
    ['Esc', t('shortcuts.close')],
    ...Object.entries(GO_KEYS).filter(([id]) => id !== 'test-call').map(([id, k]) => [`G ${k}`, t('shortcuts.goTo', { screen: t(`nav.${id}`) })]),
  ];
  return modal({
    title: t('shortcuts.title'),
    size: 'sm',
    body: html`<div class="stack" style="gap:0">${rows.map(([k, label]) => html`<div class="kv" style="border-bottom:1px solid var(--border);padding:8px 0"><span>${label}</span><span>${k.split(' ').map((x) => html`<kbd style="margin-left:4px">${x}</kbd>`)}</span></div>`)}</div>`,
    buttons: [{ label: t('common.close'), kind: 'navy', action: 'kb.close' }],
  });
}

/** Global keys: ⌘K/Ctrl+K, ?, G+letter, D. Ignored while typing or when a modal is open (except ⌘K). */
export function initShortcuts() {
  let gArmed = 0;
  document.addEventListener('keydown', (ev) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName) || ev.target.isContentEditable;
    if ((ev.metaKey || ev.ctrlKey) && (ev.key === 'k' || ev.key === 'K')) { ev.preventDefault(); openPalette(); return; }
    if (typing || ev.metaKey || ev.ctrlKey || ev.altKey || ev.isComposing) return;
    if (topLayer() && topLayer().modal) return;
    if (ev.key === '?') { ev.preventDefault(); openShortcuts(); return; }
    const k = ev.key.toUpperCase();
    if (gArmed && Date.now() - gArmed < 1200) {
      gArmed = 0;
      const id = Object.keys(GO_KEYS).find((x) => GO_KEYS[x] === k);
      if (id) { ev.preventDefault(); go(id); }
      return;
    }
    if (k === 'G') { gArmed = Date.now(); return; }
    if (k === 'D' && hooks.dialer) { ev.preventDefault(); hooks.dialer(); }
  });
}

