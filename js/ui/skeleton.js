// Skeleton loaders that mirror the real layout. CONTRACT: export `skeleton = 'dashboard'|'table'|'form'|'detail'`
// from a screen module (default 'dashboard'), or call ui.skeleton(kind) / ui.skeletonBlock(rows) inside a card.
// Static grey with reduced motion (CSS).

import { html, raw } from '../core/dom.js';

const line = (w, h = 12) => raw(`<div class="skel skel-line" style="width:${w};height:${h}px"></div>`);
const block = (h, extra = '') => raw(`<div class="skel" style="height:${h}px;border-radius:16px;${extra}"></div>`);

export function skeleton(kind = 'dashboard') {
  const head = html`<div class="page-head"><div class="titles">${line('180px', 26)}${line('260px')}</div><div class="tools">${block(36, 'width:220px;border-radius:10px')}</div></div>`;
  let body;
  if (kind === 'table') {
    body = html`<div class="row">${[140, 120, 120, 160].map((w) => block(36, `width:${w}px;border-radius:10px`))}</div>
      <div class="card" style="padding:16px;display:flex;flex-direction:column;gap:14px">${Array.from({ length: 9 }, (_, i) => line(`${92 - (i % 3) * 9}%`))}</div>`;
  } else if (kind === 'form') {
    body = html`<div class="grid g-2">${block(92)}${block(92)}</div><div class="card" style="padding:20px;display:flex;flex-direction:column;gap:16px">${line('30%', 14)}${block(40, 'border-radius:10px')}${line('24%', 14)}${block(40, 'border-radius:10px')}${line('40%', 14)}${block(120, 'border-radius:12px')}</div>`;
  } else if (kind === 'detail') {
    body = html`<div class="grid g-3">${block(110)}${block(110)}${block(110)}</div><div class="grid g-2">${block(260)}${block(260)}</div>`;
  } else {
    body = html`<div class="grid g-5">${Array.from({ length: 5 }, () => block(112))}</div>
      <div class="grid g-3"><div class="span-2">${block(240)}</div>${block(240)}</div>
      <div class="grid g-2">${block(220)}${block(220)}</div>`;
  }
  return html`<div class="page skel-page" aria-hidden="true">${head}${body}</div><span class="sr-only" role="status">…</span>`;
}

/** Skeleton rows for a single card that is "refreshing". */
export function skeletonBlock(rows = 4) {
  return html`<div class="stack" style="padding:16px" aria-hidden="true">${Array.from({ length: rows }, (_, i) => line(`${90 - (i % 3) * 12}%`))}</div>`;
}
