// Product tour: 7 spotlight steps anchored to [data-tour] attributes.
// CONTRACT: ui.tour.start() · ui.tour.stop() · replay from Help › Replay tour, the palette, or ?tour=1.
// Anchors live in the shell (product, credits, env, nav-connect, nav-logs, help) and on Overview (test-call).
// On a phone, anchors inside the nav drawer point at the hamburger instead; the card becomes a bottom sheet.
// Switching language mid-tour (top bar or the EN · ไทย · 中文 chips on the card) re-renders the current step. State persists as 'done' | 'skipped'.

import { html, el as toEl, on, reducedMotion, isMobile, effect } from '../core/dom.js';
import { t, onLangChange, setLang, getLang, LANGS, LANG_ORDER } from '../core/i18n.js';
import { fmt } from '../core/format.js';
import { persist, KEYS } from '../core/persist.js';
import { go, parseHash } from '../core/router.js';
import { PRICES } from '../data/prices.js';
import { pushLayer, layersRoot } from './overlay.js';
import { icon } from './icons.js';

const TOUR_VERSION = 1;
const STEPS = [
  { id: 'product', anchors: ['product'], inNav: true },
  { id: 'credits', anchors: ['credits'] },
  { id: 'env', anchors: ['env'] },
  { id: 'connect', anchors: ['nav-connect'], inNav: true },
  { id: 'testcall', anchors: ['test-call', 'test-call-alt'], route: 'overview', cta: true },
  { id: 'logs', anchors: ['nav-logs'], inNav: true },
  { id: 'help', anchors: ['help'] },
];

let active = null;

export const tourState = () => {
  const v = persist.get(KEYS.tourDone);
  return v && v.v === TOUR_VERSION ? v.state : null;
};

function findAnchor(step) {
  if (step.inNav && isMobile()) return document.querySelector('[data-tour="navtoggle"]');
  for (const a of step.anchors) {
    const list = document.querySelectorAll(`[data-tour="${a}"]`);
    for (const el of list) if (el.offsetParent !== null) return el;
  }
  return null;
}

export function startTour({ from = 0, onCta } = {}) {
  if (active) active.stop('restart');
  const layer = toEl(html`<div class="tour-layer" role="presentation"><div class="tour-dim"></div><div class="tour-spot" hidden></div>
    <div class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title" tabindex="-1"></div></div>`);
  layersRoot().appendChild(layer);
  const spot = layer.querySelector('.tour-spot');
  const card = layer.querySelector('.tour-card');
  let i = from;
  let anchor = null;
  const offs = [];

  function vars() {
    return { outbound: fmt.rate(PRICES.outbound), n: i + 1, total: STEPS.length };
  }

  function renderCard() {
    const st = STEPS[i];
    const last = i === STEPS.length - 1;
    card.innerHTML = String(html`
      <div class="tc-top"><span class="chip chip-brand">${t('tour.stepOf', vars())}</span>
        <span class="tc-langs" role="group" aria-label="${t('top.langAria')}">${LANG_ORDER.map((l) => html`<button type="button" class="tc-lang" data-tour-act="lang" data-action="tour.lang" data-value="${l}" lang="${LANGS[l].html}" aria-pressed="${l === getLang()}">${LANGS[l].short}</button>`)}</span>
        <button type="button" class="linkbtn" data-tour-act="skip" data-action="tour.skip" style="font-size:var(--fs-xs)">${t('tour.skip')}</button></div>
      <h2 id="tour-title">${t(`tour.${st.id}.title`, vars())}</h2>
      <p>${t(`tour.${st.id}.body`, vars())}</p>
      <div class="tc-foot">
        <div class="tour-dots" aria-hidden="true">${STEPS.map((_, k) => html`<i class="${k === i ? 'on' : ''}"></i>`)}</div>
        ${i > 0 ? html`<button type="button" class="btn btn-sm" data-tour-act="back" data-action="tour.back">${t('common.back')}</button>` : ''}
        ${st.cta ? html`<button type="button" class="btn btn-sm" data-tour-act="cta" data-action="tour.cta">${icon('phone')}${t('tour.testcall.cta')}</button>` : ''}
        <button type="button" class="btn btn-sm btn-navy" data-tour-act="next" data-action="tour.next" autofocus>${last ? t('tour.done') : t('common.next')}</button>
      </div>`);
  }

  function place() {
    const mobileSheet = window.matchMedia('(max-width: 720px)').matches;
    anchor = findAnchor(STEPS[i]);
    layer.classList.toggle('has-spot', !!anchor);
    if (anchor) {
      const r = anchor.getBoundingClientRect();
      const pad = 8;
      spot.hidden = false;
      Object.assign(spot.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
      if (mobileSheet) {
        Object.assign(card.style, { left: '8px', right: '8px', bottom: '8px', top: 'auto', width: 'auto' });
        return;
      }
      const cw = card.offsetWidth || 320;
      const ch = card.offsetHeight || 180;
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      let top = r.bottom + 14;
      let left = r.left + r.width / 2 - cw / 2;
      if (top + ch > vh - 8) top = r.top - ch - 14;
      if (top < 8) { top = Math.min(vh - ch - 8, Math.max(8, r.top)); left = r.right + 16; if (left + cw > vw - 8) left = r.left - cw - 16; }
      left = Math.max(8, Math.min(left, vw - cw - 8));
      Object.assign(card.style, { left: `${Math.round(left)}px`, top: `${Math.round(top)}px`, right: 'auto', bottom: 'auto', width: '' });
    } else {
      spot.hidden = true;
      if (mobileSheet) { Object.assign(card.style, { left: '8px', right: '8px', bottom: '8px', top: 'auto', width: 'auto' }); return; }
      const cw = card.offsetWidth || 340;
      Object.assign(card.style, { left: `${Math.round((document.documentElement.clientWidth - cw) / 2)}px`, top: '30vh', right: 'auto', bottom: 'auto' });
    }
  }

  async function show(k) {
    i = Math.max(0, Math.min(STEPS.length - 1, k));
    const st = STEPS[i];
    if (st.route && parseHash().id !== st.route) {
      go(st.route);
      await new Promise((r) => setTimeout(r, 650));
    }
    renderCard();
    const a = findAnchor(st);
    // Scroll only when the anchor is out of view, so the top bar never slides away for a target that is visible.
    if (a) { const r = a.getBoundingClientRect(); if (r.top < 64 || r.bottom > window.innerHeight - 8) a.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' }); }
    place();
    setTimeout(place, reducedMotion() ? 0 : 320);
    const next = card.querySelector('[data-tour-act="next"]');
    if (next) next.focus({ preventScroll: true });
    effect('tour', { step: st.id });
  }

  function stop(state = 'skipped') {
    if (!active) return;
    active = null;
    offs.forEach((f) => f());
    unregister();
    layer.remove();
    if (state !== 'restart') persist.set(KEYS.tourDone, { v: TOUR_VERSION, state });
    const help = document.querySelector('[data-tour="help"]');
    if (help && state !== 'restart') help.focus({ preventScroll: true });
  }

  offs.push(on(card, 'click', '[data-tour-act]', (ev, b) => {
    ev.__handled = true;
    const a = b.dataset.tourAct;
    if (a === 'next') { if (i === STEPS.length - 1) stop('done'); else show(i + 1); }
    else if (a === 'back') show(i - 1);
    else if (a === 'skip') stop('skipped');
    else if (a === 'cta') { stop('done'); if (onCta) onCta(); }
    else if (a === 'lang' && b.dataset.value !== getLang()) { setLang(b.dataset.value); setTimeout(() => { const n = card.querySelector(`[data-tour-act="lang"][data-value="${b.dataset.value}"]`); if (n) n.focus({ preventScroll: true }); }, 60); }
  }));
  offs.push(on(card, 'keydown', (ev) => {
    if (ev.key === 'ArrowRight' && !ev.target.matches('input,textarea')) { ev.preventDefault(); if (i < STEPS.length - 1) show(i + 1); }
    if (ev.key === 'ArrowLeft' && !ev.target.matches('input,textarea')) { ev.preventDefault(); if (i > 0) show(i - 1); }
  }));
  offs.push(on(window, 'resize', () => place()));
  offs.push(on(window, 'scroll', () => place(), true));
  offs.push(onLangChange(() => setTimeout(() => { renderCard(); place(); }, 30)));
  const unregister = pushLayer({ el: card, modal: true, persistent: true, close: () => stop('skipped') });
  active = { stop, show };
  requestAnimationFrame(() => layer.classList.add('is-open'));
  show(i);
  return active;
}

export function stopTour() { if (active) active.stop('skipped'); }
export const tourActive = () => !!active;
