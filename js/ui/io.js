// Clipboard + downloads (generated files only, via Blob — nothing is fetched).
// CONTRACT:
//   ui.copy(text, buttonEl?)  → copies; if buttonEl is given its icon swaps to a check for 1.2 s and an
//                               aria-live message says "Copied" (no toast — too noisy). Without a button: toast.
//   ui.download(filename, content, mime, opts)   ui.downloadJSON(filename, obj, opts)
//   ui.csv(filename, rows, columns, opts)  columns = [{ key, label }] or plain keys; UTF-8 BOM so Excel reads Thai.
//   opts = { toast: false } skips the generic "Downloaded {file}" toast when the screen shows its own (e.g. T05).

import { effect } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { toast } from './toast.js';

let live = null;
function announce(msg) {
  if (!live) {
    live = document.createElement('div');
    live.className = 'sr-only';
    live.setAttribute('aria-live', 'polite');
    document.body.appendChild(live);
  }
  live.textContent = '';
  setTimeout(() => { live.textContent = msg; }, 30);
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;left:-9999px;top:0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

export async function copy(text, button = null) {
  let ok = false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      ok = true;
    }
  } catch { ok = false; }
  if (!ok) ok = fallbackCopy(text);
  effect('copy', { text });
  if (button) {
    const use = button.querySelector('use');
    const prev = use ? use.getAttribute('href') : null;
    button.classList.add('done');
    if (use) use.setAttribute('href', '#i-check');
    const label = button.getAttribute('aria-label');
    clearTimeout(button.__copyT);
    button.__copyT = setTimeout(() => {
      button.classList.remove('done');
      if (use && prev) use.setAttribute('href', prev);
      if (label) button.setAttribute('aria-label', label);
    }, 1200);
    announce(ok ? t('common.copied') : t('common.copyFailed'));
  } else {
    toast(ok ? t('common.copied') : t('common.copyFailed'), { kind: ok ? 'success' : 'warn' });
  }
  return ok;
}

export function download(filename, content, mime = 'text/plain;charset=utf-8', { toast: showToast = true } = {}) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  effect('download', { filename });
  if (showToast) toast(t('common.downloaded', { file: filename }), { kind: 'success', demo: true });
}

export const downloadJSON = (filename, obj, opts) => download(filename, JSON.stringify(obj, null, 2), 'application/json', opts);

const cell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function csv(filename, rows, columns, opts) {
  const cols = (columns || Object.keys(rows[0] || {})).map((c) => (typeof c === 'string' ? { key: c, label: c } : c));
  const lines = [cols.map((c) => cell(c.label)).join(',')];
  for (const r of rows) lines.push(cols.map((c) => cell(typeof c.value === 'function' ? c.value(r) : r[c.key])).join(','));
  download(filename, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8', opts);
}
