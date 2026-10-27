// Boot: language → icon sprite → screen modules + their dictionaries → shell → router → first-visit onboarding.
// Query flags: ?lang=en|th|zh · ?tour=1 (start the tour) · ?motion=reduce (QA) · ?i18ncheck=1 (outline gaps).

import { injectSprite } from './ui/icons.js';
import { initTooltips } from './ui/tooltip.js';
import { initScrollCues } from './ui/scrollcue.js';
import { registerNamespace, setLang, initialLang, onLangChange, getLang, LANGS, t } from './core/i18n.js';
import { registerScreens, configureHost, startRouter, rerender, resetScreenStates, go, parseHash, currentScreen } from './core/router.js';
import { store } from './core/store.js';
import { persist, KEYS } from './core/persist.js';
import { setMode } from './core/actions.js';
import { resetClock } from './data/clock.js';
import { ui } from './ui/index.js';
import { mountShell } from './shell.js';
import { configurePalette, initShortcuts } from './ui/palette.js';
import { shouldShow, openAnnouncement } from './ui/announce.js';
import { startTour } from './ui/tour.js';
import { closeAll } from './ui/overlay.js';
import { closeDialer } from './ui/dialer.js';
import { initI18nCheck } from './ui/i18ncheck.js';
import { SCREEN_IDS } from './screens/index.js';

const LANG_CODES = ['en', 'th', 'zh'];
const GROUP = { overview: 'start', connect: 'start', 'test-call': 'start', numbers: 'build', trunks: 'build', otp: 'build', campaigns: 'build', flows: 'build', logs: 'operate', reports: 'operate', alerts: 'operate' };

/** Stand-in for a screen module that failed to import (syntax error while a builder is mid-edit, etc.). */
function brokenScreen(id) {
  return {
    id,
    nav: { group: GROUP[id] || 'account', icon: 'alert-circle', labelKey: `nav.${id}` },
    titleKey: `nav.${id}`,
    render: () => `<div class="page"><div class="card errstate" role="alert"><h2>${t('common.errorTitle', { screen: t(`nav.${id}`) })}</h2><p class="hint">${t('common.errorBody')}</p></div></div>`,
  };
}

async function boot() {
  const q = new URLSearchParams(location.search);
  if (q.get('motion') === 'reduce') document.documentElement.dataset.motion = 'reduce';
  setLang(initialLang(), { save: false, silent: true });
  injectSprite();

  // Every screen module and its three dictionaries load in parallel (no build step). One broken screen
  // must not take the demo down: it is replaced by an error screen and reported in the console.
  const [mods, dicts] = await Promise.all([
    Promise.all(SCREEN_IDS.map((id) => import(`./screens/${id}.js`).catch((e) => { console.error(`Screen "${id}" failed to load:`, e); return brokenScreen(id); }))),
    Promise.all(SCREEN_IDS.map((id) => Promise.all(LANG_CODES.map((l) => import(`./i18n/screens/${id}.${l}.js`).catch((e) => { console.error(`Dictionary ${id}.${l} failed to load:`, e); return { default: {} }; }))))),
  ]);
  SCREEN_IDS.forEach((id, i) => registerNamespace(id, { en: dicts[i][0].default, th: dicts[i][1].default, zh: dicts[i][2].default }));
  for (const m of mods) {
    if (m.css) {
      const l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = `css/screens/${m.id}.css`;
      document.head.appendChild(l);
    }
  }
  registerScreens(mods);

  const hooks = {
    dialer: () => ui.dialer.open({ source: parseHash().id || 'palette' }),
    topup: () => ui.topup(),
    tour: () => startTour({ onCta: () => ui.dialer.open({ source: 'tour' }) }),
    announce: () => openAnnouncement({ onTour: () => hooks.tour() }),
    sales: () => go('help/contact?topic=sales'),
    rerender: () => rerender(),
    mode: (m) => {
      const next = m || (store.get('mode') === 'active' ? 'firstRun' : 'active');
      if (next === store.get('mode')) return;
      closeDialer();
      setMode(next);
      rerender();
      ui.toast(next === 'active' ? t('demo.nowActive') : t('demo.nowFirstRun'), { kind: 'info', demo: true });
    },
    toggleEnv: () => {
      const btn = document.querySelector(`[data-action="shell.env.${store.get('env') === 'live' ? 'sandbox' : 'live'}"]`);
      if (btn) btn.click();
    },
    reset: async () => {
      const ok = await ui.confirm({ title: t('account.resetTitle'), body: t('account.resetBody'), confirmLabel: t('account.resetConfirm'), danger: true });
      if (!ok) return;
      const lang = getLang();
      closeDialer();
      closeAll();
      persist.clearAll();
      persist.set(KEYS.lang, lang);
      resetClock();
      store.reset();
      resetScreenStates();
      shell.render.all();
      go('overview');
      ui.toast(t('toast.T39'), { kind: 'success' });
      setTimeout(() => hooks.announce(), 700);
    },
  };

  const app = document.getElementById('app');
  const shell = mountShell(app, hooks);
  configureHost({ outlet: document.getElementById('outlet'), ui, onScreen: (mod, params) => shell.onScreen(mod, params) });
  configurePalette(hooks);
  // CONTRACT: a screen asks for a dataset switch with window.dispatchEvent(new CustomEvent('demo:mode', { detail: 'active' | 'firstRun' })).
  window.addEventListener('demo:mode', (ev) => hooks.mode(ev.detail));
  initTooltips();
  initScrollCues();
  initShortcuts();

  // Live language switch: shell + current screen re-render; route, scroll and focus are kept.
  const live = document.createElement('div');
  live.className = 'sr-only';
  live.setAttribute('aria-live', 'polite');
  document.body.appendChild(live);
  onLangChange((code) => {
    shell.render.all();
    rerender();
    const outlet = document.getElementById('outlet');
    outlet.classList.remove('no-anim', 'lang-fade');
    void outlet.offsetWidth;
    outlet.classList.add('lang-fade');
    const cur = currentScreen();
    if (cur.mod) shell.onScreen(cur.mod, cur.params);
    live.textContent = `${t('top.langAria')}: ${LANGS[code].label}`;
    // keep ?lang= in the address in sync so a reload or a shared link shows the same language
    const u = new URL(location.href);
    if (u.searchParams.has('lang')) { u.searchParams.set('lang', code); history.replaceState(history.state, '', u.pathname + u.search + u.hash); }
  });

  const first = parseHash();
  await startRouter();
  if (q.get('i18ncheck') === '1') initI18nCheck();

  // First visit: announcement (role choice + tour), unless the first route is a deep link into a sub-page.
  if (q.get('tour') === '1') setTimeout(() => hooks.tour(), 300);
  else if (shouldShow() && first.path.length === 0) setTimeout(() => hooks.announce(), 350);
}

boot().catch((e) => {
  console.error(e);
  const app = document.getElementById('app');
  if (app) app.innerHTML = '<div class="boot"><div>The demo could not start. Please reload the page.</div></div>';
});
