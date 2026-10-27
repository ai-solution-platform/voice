// Confirmation dialogs (Paste delete-severity pattern).
// CONTRACT:
//   await ui.confirm({ title, body, consequences: [..], confirmLabel: 'Revoke key', cancelLabel: 'Keep key',
//                      danger: true, typed: 'Backend server' }) → true | false
//   typed — the user must type this text (object name, or the recipient count before a spend).
//   Matching ignores case, spaces, dashes and commas, converts Thai digits ๐–๙ to 0–9 and normalises (NFC),
//   so a Thai keyboard can type "1874". Use the real action as the button label, never "OK".

import { html } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { modal } from './modal.js';

export function normalizeTyped(s) {
  return String(s || '')
    .normalize('NFC')
    .replace(/[๐-๙]/g, (d) => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(d)))
    .replace(/[\s,\-–—]/g, '')
    .toLowerCase();
}

export function confirm({ title, body = '', consequences = [], confirmLabel, cancelLabel, danger = false, typed = null, cost = null } = {}) {
  return new Promise((resolve) => {
    let ok = false;
    const target = typed != null ? String(typed) : null;
    const content = html`
      ${body ? html`<p class="hint" style="color:var(--text-2)">${body}</p>` : ''}
      ${cost ? html`<div class="note note-brand" style="margin-top:10px">${cost}</div>` : ''}
      ${consequences.length ? html`<ul class="stack" style="margin:12px 0 0;padding-left:18px;color:var(--text-2);font-size:var(--fs-sm)">${consequences.map((c) => html`<li>${c}</li>`)}</ul>` : ''}
      ${target != null ? html`<label class="field" style="margin-top:14px"><span class="label">${t('confirm.typeToConfirm', { text: target })}</span>
        <input class="input" data-typed autocomplete="off" spellcheck="false" autofocus aria-describedby="typed-hint">
        <span class="hint-xs" id="typed-hint">${t(/^\d+$/.test(normalizeTyped(target)) ? 'confirm.typedHint' : 'confirm.typedHintName')}</span></label>` : ''}`;
    const m = modal({
      title,
      body: content,
      size: 'sm',
      onClose: () => resolve(ok),
      buttons: [
        { label: cancelLabel || t('common.cancel'), kind: '', id: 'confirm-cancel', action: 'cf.cancel' },
        { label: confirmLabel || t('common.confirm'), kind: danger ? 'danger' : 'primary', action: 'cf.confirm', disabled: target != null, onClick: () => { ok = true; } },
      ],
    });
    if (target != null) {
      const input = m.el.querySelector('[data-typed]');
      const btn = m.el.querySelector('[data-mbtn="1"]');
      input.addEventListener('input', () => {
        const match = normalizeTyped(input.value) === normalizeTyped(target);
        btn.setAttribute('aria-disabled', match ? 'false' : 'true');
      });
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && !ev.isComposing && ev.keyCode !== 229 && btn.getAttribute('aria-disabled') === 'false') btn.click();
      });
    } else {
      setTimeout(() => { const c = m.el.querySelector('#confirm-cancel'); if (c) c.focus(); }, 40);
    }
  });
}
