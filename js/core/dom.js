// DOM + templating helpers. No framework: screens return HTML strings built with the `html` tag.
// CONTRACT: interpolations inside html`` are escaped automatically; wrap trusted markup in raw().

export class SafeHTML {
  constructor(s) { this.__html = s; }
  toString() { return this.__html; }
}

/** Mark a string as trusted HTML (icons, t-markdown output, nested html``). */
export const raw = (s) => new SafeHTML(s == null ? '' : String(s));

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Escape text for HTML text or attribute context. */
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

function toHTML(v) {
  if (v == null || v === false || v === true) return '';
  if (v instanceof SafeHTML) return v.__html;
  if (Array.isArray(v)) return v.map(toHTML).join('');
  return esc(v);
}

/**
 * Tagged template: html`<p>${userText}</p>` → SafeHTML.
 * Arrays are joined, null/false/true render nothing (so `${cond && html`…`}` works) — EXCEPT directly inside
 * an attribute value, where a boolean renders "true"/"false": aria-pressed="${isOn}" → aria-pressed="true".
 */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const inAttr = typeof v === 'boolean' && /=["']$/.test(strings[i]);
    out += (inAttr ? String(v) : toHTML(v)) + strings[i + 1];
  }
  return new SafeHTML(out);
}

/** Build attributes: attrs({ 'aria-pressed': true, disabled: false, title: 'x' }). */
export function attrs(obj) {
  let s = '';
  for (const [k, v] of Object.entries(obj)) {
    if (v == null || v === false) continue;
    s += v === true ? ` ${k}` : ` ${k}="${esc(v)}"`;
  }
  return raw(s);
}

export const cx = (...c) => c.filter(Boolean).join(' ');
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/**
 * Event listener with optional delegation. Returns an unsubscribe function.
 * on(el, 'click', fn) or on(el, 'click', '.selector', (ev, matchedEl) => …)
 */
export function on(target, type, selOrFn, fn, opts) {
  let handler;
  if (typeof selOrFn === 'function') {
    handler = selOrFn;
    opts = fn;
  } else {
    handler = (ev) => {
      const el = ev.target instanceof Element ? ev.target.closest(selOrFn) : null;
      if (el && target.contains(el)) fn(ev, el);
    };
  }
  target.addEventListener(type, handler, opts);
  return () => target.removeEventListener(type, handler, opts);
}

/** Reduced motion is on when the OS asks for it, or QA forces it with ?motion=reduce (html[data-motion=reduce]). */
export const reducedMotion = () => document.documentElement.dataset.motion === 'reduce' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Phone layout: the nav is a drawer (≤ 767 px). */
export const isMobile = () => window.matchMedia('(max-width: 767px)').matches;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let uidN = 0;
export const uid = (p = 'id') => `${p}-${(++uidN).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Parse an HTML string into a single element. */
export function el(htmlString) {
  const t = document.createElement('template');
  t.innerHTML = String(htmlString).trim();
  return t.content.firstElementChild;
}

/** Elements that can take keyboard focus inside a container (for focus traps). */
/** Move focus without opening the element's tooltip (focus set by code — a dialog opening, focus returning). */
export function focusQuiet(node, opts = { preventScroll: true }) {
  if (!node || typeof node.focus !== 'function') return;
  node.__quietFocus = true;
  node.focus(opts);
  setTimeout(() => { node.__quietFocus = false; }, 0);
}

export function focusables(root) {
  return $$('a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', root)
    .filter((e) => e.offsetParent !== null || e === document.activeElement);
}

/** Lightweight signal to QA + analytics-free instrumentation: something visible happened. */
export function effect(kind, detail = {}) {
  window.dispatchEvent(new CustomEvent('demo:effect', { detail: { kind, ...detail } }));
}
