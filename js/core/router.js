// Hash router + screen host.
// Routes: #/<screenId>/<sub/path>?<query>   e.g. #/overview, #/connect/sip, #/logs?call=call_01…
// CONTRACT for screens:
//   export const id, nav, titleKey; export function render(ctx) → html string; export function mount(root, ctx) → cleanup?
//   optional: initialState (object | (params) => object), skeleton ('dashboard' | 'table' | 'form' | 'detail'),
//             css (true → css/screens/<id>.css is loaded), commands (palette entries), sandboxNoteKey.
// ctx.state survives re-renders (language switch, setState) and navigating away/back; Reset demo clears it.

import { html, raw, esc, on, sleep, $ } from './dom.js';
import { t, scoped, getLang, loc } from './i18n.js';
import { fmt } from './format.js';
import { store } from './store.js';
import { closeAll } from '../ui/overlay.js';

const screens = new Map();
const order = [];
const states = new Map();
const visited = new Set();
let outlet = null;
let ui = null;
let onScreen = () => {};
let navToken = 0;
let passGuard = false;
let current = { id: null, mod: null, params: null, ctx: null, pathKey: '' };

export function parseHash(h = location.hash) {
  const s = String(h || '').replace(/^#\/?/, '');
  const [p, q = ''] = s.split('?');
  const parts = p.split('/').filter(Boolean).map((x) => {
    try { return decodeURIComponent(x); } catch { return x; }
  });
  const query = {};
  new URLSearchParams(q).forEach((v, k) => { query[k] = v; });
  return { id: parts[0] || '', path: parts.slice(1), query, raw: s };
}

/** Navigate: go('connect/sip'), go('#/logs?call=x'), go('overview', { replace: true }). */
export function go(target, { replace = false } = {}) {
  const s = String(target).replace(/^#?\/?/, '');
  const next = '#/' + s;
  if (replace) {
    history.replaceState(history.state, '', location.pathname + location.search + next);
    handleRoute();
  } else if (location.hash === next) {
    handleRoute();
  } else {
    location.hash = next;
  }
}

export function registerScreens(mods) {
  for (const m of mods) {
    if (!m || !m.id) continue;
    screens.set(m.id, m);
    order.push(m.id);
  }
}
export const getScreens = () => order.map((id) => screens.get(id));
export const getScreen = (id) => screens.get(id);
export const currentScreen = () => current;

/** app.js wires the host: where to render, the ui facade, and a callback for the shell. */
export function configureHost(opts) {
  outlet = opts.outlet;
  ui = opts.ui;
  onScreen = opts.onScreen || onScreen;
}

export function resetScreenStates() {
  states.clear();
  visited.clear();
  if (current.ctx) current.ctx._guard = null; // Reset demo never asks "leave this page?"
}

function initialStateFor(mod, params) {
  const s = mod.initialState;
  if (typeof s === 'function') return s(params) || {};
  return s ? JSON.parse(JSON.stringify(s)) : {};
}

function makeCtx(mod, params) {
  const cleanups = [];
  const sc = scoped(mod.id);
  if (!states.has(mod.id)) states.set(mod.id, initialStateFor(mod, params));
  const ctx = {
    id: mod.id,
    get lang() { return getLang(); },
    t: sc.t,
    tm: sc.tm,
    has: sc.has,
    fmt,
    store,
    ui,
    go,
    params,
    html,
    raw,
    esc,
    loc,
    icon: (name, cls) => ui.icon(name, cls),
    /** Jargon term with a plain-language tooltip: ctx.term('ASR', 'asr') uses glossary.asr. */
    term: (label, glossaryKey) => ui.term(label, glossaryKey),
    /** A list from the current dataset (always an array). */
    list: (name) => store.get(name) || [],
    /** "?" link next to the page title → this screen's help article. */
    pageHelp: () => ui.pageHelp(mod.id),
    get state() { return states.get(mod.id); },
    /** Merge into screen state; re-renders unless { render: false }. */
    setState(patch, { render = true } = {}) {
      Object.assign(states.get(mod.id), typeof patch === 'function' ? patch(states.get(mod.id)) : patch);
      if (render) rerender();
    },
    rerender: () => rerender(),
    /** Delegated click handlers for [data-action] inside root. Handlers get (el, event). */
    actions(root, map) {
      const off = on(root, 'click', '[data-action]', (ev, el) => {
        const fn = map[el.dataset.action];
        if (!fn) return;
        ev.__handled = true;
        if (el.tagName === 'A' && (el.getAttribute('href') || '#') === '#') ev.preventDefault();
        if (el.getAttribute('aria-disabled') === 'true') return;
        fn(el, ev);
      });
      cleanups.push(off);
      return off;
    },
    /**
     * Delegated input/change handlers for [data-field] inside root. Handlers get (value, el, event).
     * Value: checkbox → checked · file input → el.files (a FileList; fires on change) · anything else → el.value.
     */
    inputs(root, map) {
      const handler = (ev) => {
        const el = ev.target.closest && ev.target.closest('[data-field]');
        if (!el || !root.contains(el)) return;
        const fn = map[el.dataset.field];
        if (!fn) return;
        const v = el.type === 'checkbox' ? el.checked : el.type === 'file' ? el.files : el.value;
        fn(v, el, ev);
      };
      const a = on(root, 'input', (ev) => { if (ev.target.type !== 'file') handler(ev); }); // a file input reports once, on change
      const b = on(root, 'change', (ev) => { if (ev.target.tagName === 'SELECT' || ['checkbox', 'radio', 'file'].includes(ev.target.type)) handler(ev); });
      cleanups.push(a, b);
    },
    on(target, type, selOrFn, fn, opts) {
      const off = on(target, type, selOrFn, fn, opts);
      cleanups.push(off);
      return off;
    },
    subscribe(path, fn) {
      const off = store.subscribe(path, fn);
      cleanups.push(off);
      return off;
    },
    /** Re-render this screen when any of these store paths change. Several changes in one tick → one re-render. */
    watch(...paths) {
      let queued = false;
      let alive = true;
      cleanups.push(() => { alive = false; });
      const fn = () => {
        if (queued) return;
        queued = true;
        queueMicrotask(() => { queued = false; if (alive) rerender(); });
      };
      for (const p of paths.flat()) cleanups.push(store.subscribe(p, fn));
    },
    later(fn, ms) {
      const h = setTimeout(fn, ms);
      cleanups.push(() => clearTimeout(h));
      return h;
    },
    every(fn, ms) {
      const h = setInterval(fn, ms);
      cleanups.push(() => clearInterval(h));
      return h;
    },
    cleanup(fn) { cleanups.push(fn); },
    /** Ask before leaving this route (e.g. an API key shown once and not saved): fn() → boolean | Promise<boolean>. */
    guard(fn) { ctx._guard = fn; },
    _guard: null,
    _cleanups: cleanups,
  };
  return ctx;
}

function runCleanups() {
  const c = current.ctx;
  if (!c) return;
  for (const fn of c._cleanups.splice(0)) {
    try { fn(); } catch (e) { console.error(e); }
  }
}

function focusKeyOf(el) {
  if (!el || !outlet || !outlet.contains(el) || el === outlet) return null;
  const css = (v) => (window.CSS && CSS.escape ? CSS.escape(v) : v);
  if (el.id) return { sel: '#' + css(el.id) };
  if (el.dataset.field) return { sel: `[data-field="${css(el.dataset.field)}"]`, caret: el.selectionStart };
  if (el.dataset.action) {
    const v = el.dataset.value;
    return { sel: `[data-action="${css(el.dataset.action)}"]${v != null ? `[data-value="${css(v)}"]` : ''}` };
  }
  return null;
}

function restoreFocus(key) {
  if (!key) return;
  const el = outlet.querySelector(key.sel);
  if (!el) return;
  el.focus({ preventScroll: true });
  if (key.caret != null && typeof el.setSelectionRange === 'function') {
    try { el.setSelectionRange(key.caret, key.caret); } catch { /* not a text input */ }
  }
}

function renderInto(mod, params) {
  const ctx = makeCtx(mod, params);
  current.ctx = ctx;
  // Demo panel → "Simulate an error on this screen": every screen gets a working error state for free.
  if (store.get('demo.errorScreen') === mod.id) {
    outlet.innerHTML = String(errorState(mod));
    const retry = outlet.querySelector('[data-action="screen-retry"]');
    if (retry) retry.addEventListener('click', (ev) => { ev.__handled = true; store.set('demo.errorScreen', null); rerender(); });
    return;
  }
  try {
    outlet.innerHTML = String(mod.render(ctx));
    outlet.dataset.screen = mod.id;
    const c = mod.mount ? mod.mount(outlet, ctx) : null;
    if (typeof c === 'function') ctx._cleanups.push(c);
  } catch (e) {
    console.error(e);
    outlet.innerHTML = String(errorState(mod));
    const retry = outlet.querySelector('[data-action="screen-retry"]');
    if (retry) retry.addEventListener('click', (ev) => { ev.__handled = true; rerender(); });
  }
}

function errorState(mod) {
  const title = mod.titleKey ? t(mod.titleKey) : '';
  return html`<div class="page"><div class="card errstate" role="alert"><div class="ph-art">${ui.icon('alert-circle')}</div>
    <h2>${t('common.errorTitle', { screen: title })}</h2><p class="hint">${t('common.errorBody')}</p>
    <div class="row" style="justify-content:center"><button class="btn btn-navy" type="button" data-action="screen-retry">${ui.icon('refresh')}${t('common.retry')}</button>
    <a class="btn" href="#/help/status">${ui.icon('activity')}${t('common.checkStatus')}</a></div></div></div>`;
}

/** Re-render the current screen in place: keeps scroll position and keyboard focus. */
export function rerender() {
  if (!current.mod || !outlet) return;
  const y = window.scrollY;
  const key = focusKeyOf(document.activeElement);
  runCleanups();
  outlet.classList.add('no-anim'); // in-place updates never replay the page-in animation
  outlet.classList.remove('lang-fade');
  renderInto(current.mod, current.params);
  window.scrollTo(0, y);
  restoreFocus(key);
}

const notFound = {
  id: '__notfound',
  titleKey: 'notfound.title',
  render: () => html`<div class="ph"><div class="card ph-card"><div class="ph-art">${ui.icon('compass')}</div>
    <h1>${t('notfound.title')}</h1><p class="hint">${t('notfound.body')}</p>
    <a class="btn btn-navy" href="#/overview">${t('notfound.back')}</a></div></div>`,
};

/** Route handler — called on hashchange and by go(). */
export async function handleRoute() {
  const params = parseHash();
  if (!params.id) { go('overview', { replace: true }); return; }
  // Leave guard (ctx.guard): put the old address back, ask, then continue to the new one if allowed.
  const leaving = current.ctx && current.ctx._guard && current.params
    && (params.id !== current.id || params.path.join('/') !== current.pathKey);
  if (leaving && !passGuard) {
    const target = params.raw;
    history.replaceState(history.state, '', location.pathname + location.search + '#/' + current.params.raw);
    const ok = await current.ctx._guard();
    if (!ok) return;
    passGuard = true;
    go(target);
    return;
  }
  passGuard = false;
  const mod = screens.get(params.id) || notFound;
  const token = ++navToken;
  const screenChanged = current.id !== mod.id;
  const pathKey = params.path.join('/');
  const pathChanged = screenChanged || pathKey !== current.pathKey;
  runCleanups();
  // Dialogs, drawers and menus belong to the screen that opened them: close them when the screen changes
  // (Back, palette, G-shortcut). Query-only changes (tabs, ?call= drawers) keep them. Dialer and tour stay.
  if (screenChanged) closeAll({ keepPersistent: true });
  current = { id: mod.id, mod, params, ctx: null, pathKey };
  onScreen(mod, params);
  if (screenChanged && !visited.has(mod.id)) {
    // Simulated latency on a screen's FIRST visit only (450 ms). No skeleton for the first 150 ms so fast
    // loads don't flash; once shown, the skeleton stays at least 300 ms. Revisits render instantly.
    visited.add(mod.id);
    outlet.removeAttribute('data-ready');
    outlet.classList.add('leaving');
    await sleep(150);
    if (token !== navToken) return;
    outlet.classList.remove('leaving');
    outlet.setAttribute('aria-busy', 'true');
    outlet.innerHTML = String(ui.skeleton(mod.skeleton || 'dashboard'));
    window.scrollTo(0, 0);
    await sleep(300);
    if (token !== navToken) return;
    outlet.removeAttribute('aria-busy');
  } else if (pathChanged) {
    window.scrollTo(0, 0);
  }
  outlet.removeAttribute('data-ready');
  outlet.classList.remove('no-anim', 'lang-fade');
  renderInto(mod, params);
  void outlet.offsetWidth; // restart the page-in animation
  outlet.dataset.ready = 'true';
  if (screenChanged) {
    const main = $('#main');
    if (main && !document.querySelector('.backdrop, .tour-layer')) main.focus({ preventScroll: true });
  }
  window.dispatchEvent(new CustomEvent('demo:route', { detail: { id: mod.id, params } }));
}

export function startRouter() {
  window.addEventListener('hashchange', handleRoute);
  return handleRoute();
}

// Keep raw/esc/loc exported for modules that import the router only.
export { raw, esc, loc, t };
