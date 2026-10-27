// Placeholder for screens that are registered but not built yet. A builder replaces the stub file
// js/screens/<id>.js with the real module; nothing else changes. Every control here works.

import { html } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { store } from '../core/store.js';

export function placeholderModule({ id, nav, titleKey, skeleton = 'dashboard' }) {
  return {
    id,
    nav,
    titleKey,
    skeleton,
    placeholder: true,
    render(ctx) {
      const recentCalls = id === 'logs' ? (store.get('calls') || []).slice(0, 5) : [];
      return html`<div class="page"><div class="ph"><div class="card ph-card">
        <div class="ph-art">${ctx.icon(nav.icon)}</div>
        <span class="chip chip-brand">${t('placeholder.chip')}</span>
        <h1>${t(titleKey)}</h1>
        <p class="hint" style="max-width:480px">${t(`placeholder.desc.${id}`)}</p>
        ${recentCalls.length ? html`<div class="card" style="width:100%;text-align:left;margin-top:8px"><div class="card-head"><h3>${t('placeholder.latestCalls')}</h3></div>
          <div class="tbl-wrap"><table class="tbl"><tbody>${recentCalls.map((c) => html`<tr class="${c.id === ctx.params.query.call ? 'new-row' : ''}"><td class="mono">${ctx.fmt.timeShort(c.ts)}</td><td class="mono" translate="no">${c.to}</td><td><span class="chip ${c.status === 'completed' ? 'chip-ok' : ''}">${t(`status.${c.status}`)}</span></td><td class="num mono">${ctx.fmt.duration(c.sec)}</td></tr>`)}</tbody></table></div></div>` : ''}
        <div class="row" style="justify-content:center;margin-top:8px">
          <a class="btn btn-navy" href="#/overview">${ctx.icon('grid')}${t('placeholder.back')}</a>
          <button type="button" class="btn" data-action="ph.call">${ctx.icon('phone')}${t('placeholder.testCall')}</button>
          <button type="button" class="btn" data-action="ph.palette">${ctx.icon('search')}${t('placeholder.palette')}</button>
        </div>
      </div></div></div>`;
    },
    mount(root, ctx) {
      ctx.actions(root, {
        'ph.call': () => ctx.ui.dialer.open({ source: id }),
        'ph.palette': () => ctx.ui.palette(),
      });
    },
  };
}
