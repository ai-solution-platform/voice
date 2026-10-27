// First-visit announcement with the optional role choice ("How will you use Voice?").
// CONTRACT: ui.announce.open({ onTour }) · ui.announce.shouldShow(). Dismissing (Esc, ×, either button)
// stores the announcement id, so a new announcement id shows again. Later announcements go to the bell.
// A first visit has no language choice yet, so the card carries EN · ไทย · 中文 chips that switch in place.

import { html, raw, on } from '../core/dom.js';
import { t, setLang, getLang, LANGS, LANG_ORDER } from '../core/i18n.js';
import { fmt } from '../core/format.js';
import { store } from '../core/store.js';
import { persist, KEYS } from '../core/persist.js';
import { PRICES, firstTopUpOfferActive } from '../data/prices.js';
import { modal } from './modal.js';
import { icon } from './icons.js';

export const ANNOUNCEMENT_ID = 'voice-launch-1';

export const shouldShow = () => persist.get(KEYS.announceDismissed) !== ANNOUNCEMENT_ID;

const ROLES = [
  { id: 'api', icon: 'code' },
  { id: 'pbx', icon: 'server' },
  { id: 'screens', icon: 'grid' },
];

const hero = raw(`<svg class="wave" width="150" height="96" viewBox="0 0 150 96" aria-hidden="true" fill="none" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="44" cy="48" r="30" fill="rgba(255,255,255,.08)" stroke="rgba(255,255,255,.18)"/>
  <path d="M33 34h6l3.4 8.2-4.4 2.8a22 22 0 0 0 10 10l2.8-4.4L59 54v6a4 4 0 0 1-4.4 4A31 31 0 0 1 29 38.4 4 4 0 0 1 33 34z" stroke="#fff" stroke-width="2.4"/>
  <path d="M86 40v16M96 30v36M106 22v52M116 34v28M126 42v12" stroke="#F26322" stroke-width="4"/>
</svg>`);

export function openAnnouncement({ onTour } = {}) {
  let role = store.get('onboarding.role') || 'api';
  const offer = firstTopUpOfferActive();
  const roleRow = () => html`<div class="row" role="radiogroup" aria-label="${t('announce.roleQ')}">${ROLES.map((r) => html`<button type="button" class="optcard" role="radio" data-action="role" data-value="${r.id}" aria-checked="${role === r.id}" style="flex:1 1 150px;flex-direction:row;align-items:center;gap:10px">${icon(r.icon)}<span class="t">${t(`announce.role.${r.id}`)}</span></button>`)}</div>`;
  const langs = () => html`<div class="tc-langs announce-langs" role="group" aria-label="${t('top.langAria')}">${LANG_ORDER.map((l) => html`<button type="button" class="tc-lang" data-action="an.lang" data-value="${l}" lang="${LANGS[l].html}" aria-pressed="${l === getLang()}">${LANGS[l].short}</button>`)}</div>`;
  const bodyHTML = () => html`
    <div class="announce-hero">${hero}${langs()}<h2>${t('announce.title')}</h2><p>${t('announce.sub')}</p></div>
    <div class="announce-list">
      <div><span class="ai">${icon('phone-call')}</span><div><strong>${t('announce.b1.t')}</strong><span>${t('announce.b1.d')}</span></div></div>
      <div><span class="ai">${icon('shield-check')}</span><div><strong>${t('announce.b2.t')}</strong><span>${t('announce.b2.d', { min: fmt.int(PRICES.trial.minutes), otp: fmt.int(PRICES.trial.minutes / PRICES.trial.otpCallUses), n: PRICES.trial.verifiedNumbers })}</span></div></div>
      ${offer ? html`<div><span class="ai">${icon('sparkles')}</span><div><strong>${t('announce.b3.t')}</strong><span>${t('announce.b3.d', { pct: PRICES.offers.firstTopUpPct, cap: fmt.int(PRICES.offers.firstTopUpCap), until: fmt.dateProse(PRICES.offers.firstTopUpUntil + 'T12:00:00') })}</span></div></div>` : ''}
    </div>
    <div class="field" style="margin-top:16px"><span class="label">${t('announce.roleQ')} <span class="opt">${t('common.optional')}</span></span><div data-role-row>${roleRow()}</div></div>
    <div class="row" style="margin-top:14px;justify-content:space-between"><span class="hint-xs">${t('app.demoShort')}</span>
      <a class="linkbtn" href="#/help/whats-new" data-close-announce data-action="an.updates" style="font-size:var(--fs-xs)">${t('announce.allUpdates')}</a></div>`;
  const buttons = () => [
    { label: t('announce.explore'), action: 'an.explore', result: 'explore' },
    { label: t('announce.tour'), kind: 'primary', icon: 'compass', action: 'an.tour', result: 'tour', onClick: () => { if (onTour) setTimeout(onTour, 220); } },
  ];
  const dismiss = () => persist.set(KEYS.announceDismissed, ANNOUNCEMENT_ID);
  const m = modal({
    title: t('announce.title'),
    labelHidden: true,
    body: bodyHTML(),
    className: 'announce',
    onClose: dismiss,
    actions: {
      role: (el, ev, h) => {
        role = el.dataset.value;
        store.set('onboarding.role', role);
        h.el.querySelector('[data-role-row]').innerHTML = String(roleRow());
        const b = h.el.querySelector(`[data-action="role"][data-value="${role}"]`);
        if (b) b.focus();
      },
      'an.lang': (el, ev, h) => {
        const code = el.dataset.value;
        if (code === getLang()) return;
        setLang(code);
        h.setBody(bodyHTML());
        h.setButtons(buttons());
        h.setTitle(t('announce.title'));
        const b = h.el.querySelector(`[data-action="an.lang"][data-value="${code}"]`);
        if (b) b.focus();
      },
    },
    buttons: buttons(),
  });
  on(m.el, 'click', '[data-close-announce]', (ev) => { ev.__handled = true; m.close(); });
  return m;
}
