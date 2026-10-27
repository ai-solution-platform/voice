// Tooltips on hover AND keyboard focus (WCAG 1.4.13: dismissible with Esc, hoverable, persistent).
// CONTRACT — declarative, no JS needed in screens:
//   <button class="iconbtn" aria-label="Notifications" data-tip-key="top.bell" data-tip-kbd="G N">…</button>
//   <button class="term" data-tip-key="term.answer_rate">Answer rate</button>  ← use ctx.term('Answer rate', 'answer_rate')
//   Tooltip texts get the price vars below automatically ({premium}, {transcription}, {plan1} …).
//   data-tip="literal text" also works (prefer data-tip-key so the text follows the language switch).
// Only put tooltips on focusable elements; never on disabled buttons; no links or buttons inside.
// Timing: 500 ms on icon buttons, 300 ms on terms, immediate on keyboard focus, 300 ms grace between triggers.

import { html, raw, esc, effect } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { fmt } from '../core/format.js';
import { PRICES } from '../data/prices.js';

/** Prices every tooltip may use as {vars} — dictionaries never type a price (CONTRACT). */
const priceVars = () => ({
  outbound: fmt.rate(PRICES.outbound), inbound: fmt.rate(PRICES.inbound), premium: fmt.rate(PRICES.premiumVoice),
  transcription: fmt.rate(PRICES.transcription), recording: fmt.rate(PRICES.recording), recordingDays: PRICES.recordingDays,
  plan1: fmt.int(PRICES.plans[0].minMinutes), plan2: fmt.int(PRICES.plans[1].minMinutes), planMonths: PRICES.planMonths,
  otpPrice: fmt.rate(PRICES.otpPerAnsweredCall), number: fmt.int(PRICES.number),
});

let tip = null;
let current = null;
let showTimer = null;
let hideTimer = null;
let lastHidden = 0;
let tipId = 'tooltip-live';
let watchTimer = null;
/** The anchor is gone (re-render, route change) or hidden: a tooltip must never outlive it. */
const anchorGone = (el) => {
  if (!el || !el.isConnected) return true;
  const r = el.getBoundingClientRect();
  return !r.width && !r.height;
};

function ensure() {
  if (tip && document.body.contains(tip)) return tip;
  tip = document.createElement('div');
  tip.className = 'tooltip';
  tip.id = tipId;
  tip.setAttribute('role', 'tooltip');
  tip.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  tip.addEventListener('mouseleave', () => scheduleHide());
  document.body.appendChild(tip);
  return tip;
}

function textFor(el) {
  const key = el.getAttribute('data-tip-key');
  const vars = { ...priceVars(), ...(el.dataset.tipVars ? JSON.parse(el.dataset.tipVars) : {}) };
  const txt = key ? t(key, vars) : el.getAttribute('data-tip') || '';
  const kbd = el.getAttribute('data-tip-kbd');
  return html`${txt}${kbd ? html` <strong>${kbd}</strong>` : ''}`;
}

function place(el) {
  const r = el.getBoundingClientRect();
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  const vw = document.documentElement.clientWidth;
  let left = r.left + r.width / 2 - w / 2;
  left = Math.max(8, Math.min(left, vw - w - 8));
  let top = r.top - h - 8;
  if (top < 8) top = r.bottom + 8;
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(top)}px`;
}

function show(el) {
  clearTimeout(hideTimer);
  clearTimeout(showTimer);
  if (anchorGone(el)) return; // a delayed show for an element that was re-rendered away would pin it at the top left
  ensure();
  if (current && current !== el) current.removeAttribute('aria-describedby');
  current = el;
  tip.innerHTML = String(textFor(el));
  tip.classList.add('is-open');
  place(el);
  el.setAttribute('aria-describedby', tipId);
  effect('tooltip');
  // While open: hide as soon as the anchor leaves the page (no pointerout fires for a removed element).
  clearInterval(watchTimer);
  watchTimer = setInterval(() => { if (anchorGone(current)) hide(); }, 200);
}

function hide() {
  clearTimeout(showTimer);
  clearInterval(watchTimer);
  if (!tip) return;
  tip.classList.remove('is-open');
  if (current) current.removeAttribute('aria-describedby');
  current = null;
  lastHidden = Date.now();
}

function scheduleHide() {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hide, 100);
}

const isDisabled = (el) => el.disabled || el.getAttribute('aria-disabled') === 'true'
  // nav-link name tooltips only matter when the sidebar is the 72-px icon rail (html.rail, set by shell.js)
  || (el.hasAttribute('data-tip-rail') && !document.documentElement.classList.contains('rail'));
const triggerOf = (target) => (target instanceof Element ? target.closest('[data-tip], [data-tip-key]') : null);

export function initTooltips() {
  document.addEventListener('pointerover', (ev) => {
    if (ev.pointerType === 'touch') return;
    const el = triggerOf(ev.target);
    if (!el || isDisabled(el)) return;
    if (el === current) { clearTimeout(hideTimer); return; }
    clearTimeout(showTimer);
    const grace = Date.now() - lastHidden < 300 || (current && tip && tip.classList.contains('is-open'));
    const delay = grace ? 0 : el.classList.contains('term') ? 300 : 500;
    showTimer = setTimeout(() => show(el), delay);
  });
  document.addEventListener('pointerout', (ev) => {
    const el = triggerOf(ev.target);
    if (!el) return;
    if (ev.relatedTarget && (el.contains(ev.relatedTarget) || (tip && tip.contains(ev.relatedTarget)))) return;
    clearTimeout(showTimer);
    if (el === current) scheduleHide();
  });
  document.addEventListener('focusin', (ev) => {
    const el = triggerOf(ev.target);
    if (el && !isDisabled(el) && !ev.target.__quietFocus && el.matches(':focus-visible')) show(el);
  });
  document.addEventListener('focusout', (ev) => {
    const el = triggerOf(ev.target);
    if (el && el === current) hide();
  });
  // Touch / click on a term toggles it like a popover.
  document.addEventListener('click', (ev) => {
    const el = ev.target instanceof Element ? ev.target.closest('.term') : null;
    if (!el) return;
    ev.__handled = true;
    if (current === el && tip && tip.classList.contains('is-open')) hide();
    else show(el);
  });
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && tip && tip.classList.contains('is-open')) {
      hide();
      ev.stopImmediatePropagation();
      ev.preventDefault();
    }
  }, true);
  window.addEventListener('scroll', () => { if (current) hide(); }, true);
  // A new screen, or a dialog / drawer / menu opening or closing, takes the tooltip with it (overlay.js 'demo:layers').
  window.addEventListener('hashchange', () => hide());
  window.addEventListener('demo:layers', () => hide());
}

export function hideTooltip() { hide(); }

/**
 * Jargon term → focusable inline button with a plain-language tooltip from term.<key>.
 * Returns SafeHTML. Use via ctx.term(label, key).
 */
export function term(label, key) {
  return raw(`<button type="button" class="term" data-tip-key="term.${esc(key)}">${esc(label)}</button>`);
}
