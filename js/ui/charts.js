// Tiny SVG charts (no library). Responsive via viewBox; colours from tokens.
// CONTRACT:
//   ui.chart.line({ labels: [...], values: [...], ariaLabel, highlightLast: true, height: 210, format: fmt.int })
//   ui.chart.bars({ items: [{ label, value, color?, hint? }], format })   horizontal bars with % of the max
// Always pass ariaLabel that states the key facts (screen readers get no picture).

import { html, raw, esc } from '../core/dom.js';

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 4 ? 4 : n <= 5 ? 5 : 10;
  return step * p;
}

export function line({ labels = [], values = [], ariaLabel = '', highlightLast = true, height = 210, format = (x) => String(x), showValues = true, empty = false, links = null } = {}) {
  const W = 640;
  const H = height;
  const left = 46;
  const right = 18;
  const top = 22;
  const bottom = 34;
  const max = niceMax(Math.max(1, ...values) * 1.08);
  const n = Math.max(1, labels.length - 1);
  const x = (i) => left + (i * (W - left - right)) / n;
  const y = (v) => top + (1 - v / max) * (H - top - bottom);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));
  const every = labels.length > 10 ? Math.ceil(labels.length / 8) : 1;
  const grid = ticks.map((tv) => `<line x1="${left}" x2="${W - right}" y1="${y(tv)}" y2="${y(tv)}" stroke="#E7ECF4"/>`).join('');
  const yLabels = ticks.map((tv) => `<text x="${left - 8}" y="${y(tv) + 4}" text-anchor="end">${esc(format(tv))}</text>`).join('');
  // The last label is right-aligned to the plot edge so long Thai day names never get cut off.
  const xLabels = labels.map((l, i) => {
    if (!(i % every === 0 || i === labels.length - 1)) return '';
    const last = i === labels.length - 1 && labels.length > 1;
    return `<text x="${last ? W - 2 : x(i)}" y="${H - 10}" text-anchor="${last ? 'end' : 'middle'}" ${highlightLast && last && !empty ? 'fill="#C94A12" font-weight="600"' : ''}>${esc(l)}</text>`;
  }).join('');
  if (empty) {
    return raw(`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(ariaLabel)}" style="width:100%;height:auto;display:block;font-size:12px" fill="#5B6781">${grid}<g>${xLabels}</g></svg>`);
  }
  const pts = values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const area = `${left},${y(0)} ${pts} ${x(values.length - 1)},${y(0)}`;
  const dots = values.map((v, i) => (i === values.length - 1 && highlightLast
    ? `<circle cx="${x(i)}" cy="${y(v)}" r="5" fill="#F26322" stroke="#fff" stroke-width="2"/>`
    : (labels.length <= 10 ? `<circle cx="${x(i)}" cy="${y(v)}" r="3.5" fill="#fff" stroke="#14274A" stroke-width="2"/>` : ''))).join('');
  const vals = showValues && labels.length <= 10 ? values.map((v, i) => `<text x="${x(i)}" y="${y(v) - 11}" text-anchor="middle" font-weight="600" fill="${i === values.length - 1 && highlightLast ? '#C94A12' : '#14274A'}">${esc(format(v))}</text>`).join('') : '';
  // Optional point links (focusable, with a tooltip): links[i] = { href, tip, action }
  const hits = links ? values.map((v, i) => (links[i] ? `<a href="${esc(links[i].href)}" data-action="${esc(links[i].action || 'chart.point')}" data-tip="${esc(links[i].tip || '')}" aria-label="${esc(links[i].tip || '')}"><circle cx="${x(i)}" cy="${y(v)}" r="11" fill="transparent" class="chart-hit"/></a>` : '')).join('') : '';
  return raw(`<svg viewBox="0 0 ${W} ${H}" role="${links ? 'group' : 'img'}" aria-label="${esc(ariaLabel)}" style="width:100%;height:auto;display:block;font-size:12px" fill="#5B6781">
    <defs><linearGradient id="lg-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#14274A" stop-opacity=".10"/><stop offset="1" stop-color="#14274A" stop-opacity="0"/></linearGradient></defs>
    ${grid}<g>${yLabels}</g><polygon points="${area}" fill="url(#lg-area)"/>
    <polyline points="${pts}" fill="none" stroke="#14274A" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>${dots}<g>${vals}</g><g>${xLabels}</g>${hits}</svg>`);
}

export function bars({ items = [], format = (x) => String(x), total } = {}) {
  const sum = total ?? items.reduce((s, it) => s + it.value, 0);
  return html`<div class="stack" style="gap:12px">${items.map((it) => {
    const pct = sum ? Math.round((it.value / sum) * 100) : 0;
    return html`<div><div class="row" style="justify-content:space-between;font-size:var(--fs-sm);gap:8px;flex-wrap:nowrap"><span class="clip">${it.label}</span><span class="mono nowrap">${format(it.value)} · ${pct}%</span></div>
      <div class="progress" style="margin-top:5px" role="presentation"><i style="width:${pct}%;background:${it.color || 'var(--orange)'}"></i></div></div>`;
  })}</div>`;
}

export const chart = { line, bars };
