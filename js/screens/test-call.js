// Test call — #/test-call
// The full-page version of the shared dialer (js/ui/dialer.js): dial → Thai ringback → connected timer →
// the message read aloud in the chosen language with live captions → hang up → a call record lands in Logs.
// Side column: what happens, what it costs (from prices.js), and this account's recent test calls.

import { trialLeft } from '../core/actions.js';
import { PRICES } from '../data/prices.js';

export const id = 'test-call';
export const nav = { group: 'start', icon: 'phone-call', labelKey: 'nav.test-call' };
export const titleKey = 'nav.test-call';
export const skeleton = 'form';
export const css = true;

function sideHow(ctx) {
  const { t, html: h } = ctx;
  return h`<section class="card card-pad stack tc-how" aria-labelledby="tc-how-h"><h2 id="tc-how-h">${t('how.title')}</h2>
    <ol class="tc-steps">${[1, 2, 3, 4].map((n) => h`<li><span class="stepnum">${n}</span><span>${t(`how.${n}`)}</span></li>`)}</ol></section>`;
}

function sideCost(ctx) {
  const { t, html: h, fmt } = ctx;
  const sandbox = ctx.store.get('env') === 'sandbox';
  return h`<section class="card card-pad stack tc-cost" aria-labelledby="tc-cost-h">
    <div class="row" style="justify-content:space-between"><h2 id="tc-cost-h">${t('cost.title')}</h2><span class="chip chip-warn" tabindex="0" data-tip-key="common.plannedPricesTip">${t('common.plannedPrices')}</span></div>
    ${sandbox ? h`<div class="kv"><span class="k">${ctx.term(t('top.sandbox'), 'sandbox')}</span><span class="v">${t('cost.sandbox')}</span></div>
      <div class="kv"><span class="k">${t('cost.trialLeft')}</span><span class="v">${t('cost.trialValue', { left: fmt.num(trialLeft(), 1), total: fmt.int(PRICES.trial.minutes) })}</span></div>` : ''}
    <div class="kv"><span class="k">${ctx.term(t('top.live'), 'live')}</span><span class="v">${t('cost.live', { rate: fmt.rate(PRICES.outbound) })}</span></div>
    <div class="kv"><span class="k">${ctx.term(t('cost.premium'), 'voice_tier')}</span><span class="v">${t('cost.premiumValue', { rate: fmt.rate(PRICES.premiumVoice) })}</span></div>
    <p class="hint-xs">${t('cost.note')}</p>
  </section>`;
}

function recent(ctx) {
  const { t, html: h, fmt, icon } = ctx;
  const env = ctx.store.get('env');
  const list = ctx.list('calls').filter((c) => c.source && c.source.type === 'test-call' && c.env === env).slice(0, 5);
  return h`<section class="card tc-recent" aria-labelledby="tc-rec-h"><div class="card-head"><h2 id="tc-rec-h">${t('recent.title')}</h2>
    ${list.length ? h`<a class="btn btn-sm" href="#/logs?src=test-call" data-action="tc.recent.all">${t('recent.all')}</a>` : ''}</div>
    ${list.length ? h`<ul class="tc-list">${list.map((c) => h`<li><a href="#/logs?call=${c.id}" data-action="tc.recent.row" class="tc-row">
        <span class="mono">${fmt.time(c.ts)}</span><span class="mono grow clip" translate="no">${c.to}</span>${ctx.ui.describe.statusChip(c.status)}
        <span class="mono hint-xs nowrap">${c.sec ? fmt.duration(c.sec) : '—'}</span>${icon('chevron-right', 'ico-sm')}</a></li>`)}</ul>`
      : h`<div class="empty"><span class="art">${icon('phone-call')}</span><strong>${t('recent.empty')}</strong><span class="hint">${t('recent.emptyHint')}</span></div>`}
  </section>`;
}

export function render(ctx) {
  const { t, html: h } = ctx;
  return h`<div class="page tc">
    <div class="page-head"><div class="titles"><h1>${t('title')}${ctx.pageHelp()}</h1><span class="sub">${t('sub')}</span></div></div>
    <div class="tc-grid">
      <div class="tc-main"><div class="card tc-dialer-card"><div data-dialer-slot></div></div>
        <p class="hint-xs tc-foot">${t('keys')} · ${t('voiceNote')}</p></div>
      <div class="stack-4">${sideHow(ctx)}${sideCost(ctx)}${recent(ctx)}</div>
    </div></div>`;
}

export function mount(root, ctx) {
  const slot = root.querySelector('[data-dialer-slot]');
  // CONTRACT: ui.dialer.mount keeps one inline dialer alive across re-renders (a call survives a language switch).
  ctx.cleanup(ctx.ui.dialer.mount(slot, { source: 'test-call' }));
  ctx.watch('calls', 'env', 'credits');
}

