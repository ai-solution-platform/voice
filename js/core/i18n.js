// i18n core: EN / TH / ZH with live switching.
// CONTRACT:
//   - Global dictionaries js/i18n/{en,th,zh}.js own the shell + shared namespaces
//     (app., nav., top., common., status., dir., glossary., dialer., topup., tour., announce., palette., …).
//   - Each screen owns js/i18n/screens/<id>.{en,th,zh}.js. Keys in those files are written WITHOUT the
//     prefix; the core registers them as "<id>.<key>". Inside a screen, ctx.t('title') looks up
//     "<id>.title" first and falls back to the global key, so ctx.t('common.copy') also works.
//   - Values are strings with {var} placeholders, or plural objects { one: '…', other: '…' } chosen by
//     vars.count via Intl.PluralRules.
//   - A missing key falls back to English and is recorded in window.__i18nMissing (QA fails on it).

import { raw, esc } from './dom.js';
import { persist, KEYS } from './persist.js';
import en from '../i18n/en.js';
import th from '../i18n/th.js';
import zh from '../i18n/zh.js';

export const LANGS = {
  en: { code: 'en', html: 'en', intl: 'en-GB', label: 'English', short: 'EN', tts: 'en-US' },
  th: { code: 'th', html: 'th', intl: 'th-TH-u-ca-gregory', label: 'ไทย', short: 'ไทย', tts: 'th-TH' },
  zh: { code: 'zh', html: 'zh-Hans', intl: 'zh-CN', label: '中文', short: '中文', tts: 'zh-CN' },
};
export const LANG_ORDER = ['en', 'th', 'zh'];

const dicts = { en: { ...en }, th: { ...th }, zh: { ...zh } };
const listeners = new Set();
const missing = new Set();
window.__i18nMissing = missing;

let current = 'en';

/** Register a screen namespace (called by app.js at boot for every screen in the manifest). */
export function registerNamespace(ns, byLang) {
  for (const code of LANG_ORDER) {
    const d = byLang[code] || {};
    for (const [k, v] of Object.entries(d)) dicts[code][`${ns}.${k}`] = v;
  }
}

function lookup(code, key) {
  return dicts[code][key];
}

function interpolate(str, vars) {
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (m, name) => (vars[name] == null ? m : String(vars[name])));
}

function resolve(key, ns) {
  if (ns) {
    const v = lookup(current, `${ns}.${key}`);
    if (v !== undefined) return v;
  }
  const g = lookup(current, key);
  if (g !== undefined) return g;
  // Not found in the current language: record the gap, fall back to English.
  const enNs = ns ? lookup('en', `${ns}.${key}`) : undefined;
  const enG = lookup('en', key);
  missing.add(`${current}:${enNs !== undefined || enG === undefined ? (ns ? ns + '.' : '') + key : key}`);
  return enNs ?? enG ?? `⟦${ns ? ns + '.' : ''}${key}⟧`;
}

/** Translate a key. vars: { name: value, count: n }. */
export function t(key, vars, ns) {
  let v = resolve(key, ns);
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const n = vars && vars.count != null ? Number(vars.count) : 1;
    const rule = new Intl.PluralRules(LANGS[current].intl).select(n);
    v = v[rule] ?? v.other ?? '';
  }
  if (Array.isArray(v)) return v;
  return interpolate(String(v), vars);
}

/** Translate in a specific language (e.g. the dialer's voice language differs from the UI language). */
export function tIn(code, key, vars, ns) {
  const saved = current;
  current = LANGS[code] ? code : 'en';
  try { return t(key, vars, ns); } finally { current = saved; }
}

/**
 * Translate with a tiny markup subset → SafeHTML: **bold**, `code`, and {var} (escaped).
 * Use for sentences that need emphasis; never put raw HTML in dictionaries.
 */
export function tm(key, vars, ns) {
  let v = resolve(key, ns);
  if (v && typeof v === 'object') v = v.other ?? '';
  let s = esc(String(v));
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, name) => (vars[name] == null ? m : esc(String(vars[name]))));
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code class="inline">$1</code>');
  return raw(s);
}

/** Does a key exist in the current language (or the namespace)? */
export function has(key, ns) {
  return (ns && lookup(current, `${ns}.${key}`) !== undefined) || lookup(current, key) !== undefined;
}

export const getLang = () => current;
export const locale = () => LANGS[current].intl;
export const ttsLang = () => LANGS[current].tts;

/** Pick the current-language value from a data object { en, th, zh } (mock data names). */
export function loc(value) {
  if (value && typeof value === 'object' && !Array.isArray(value) && ('en' in value)) return value[current] ?? value.en;
  return value;
}

export function onLangChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setLang(code, { save = true, silent = false } = {}) {
  if (!LANGS[code]) code = 'en';
  current = code;
  const root = document.documentElement;
  root.lang = LANGS[code].html;
  root.dataset.lang = code;
  if (save) persist.set(KEYS.lang, code);
  if (!silent) for (const fn of Array.from(listeners)) fn(code);
}

/** ?lang=th in the query string (or in the hash query) wins, then the saved choice, then English. */
export function initialLang() {
  const fromQuery = (s) => {
    try { return new URLSearchParams(s).get('lang'); } catch { return null; }
  };
  const raw = fromQuery(location.search) || fromQuery((location.hash.split('?')[1]) || '');
  const q = raw ? String(raw).trim().toLowerCase().replace(/^zh[-_].*/, 'zh') : null; // ?lang=TH, zh-Hans
  if (q && LANGS[q]) return q;
  const saved = persist.get(KEYS.lang);
  if (saved && LANGS[saved]) return saved;
  return 'en';
}

/** Scoped translator for a screen namespace. */
export function scoped(ns) {
  return {
    t: (k, v) => t(k, v, ns),
    tm: (k, v) => tm(k, v, ns),
    has: (k) => has(k, ns),
  };
}

/** Used by tools/qa: all keys per language. */
export function _dump() {
  return dicts;
}
