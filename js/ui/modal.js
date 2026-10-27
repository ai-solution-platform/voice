// Modal + drawer.
// CONTRACT:
//   const m = ui.modal({ title, sub, body, size: 'sm'|'md'|'lg'|'xl', buttons, actions, onClose, dismissible });
//     body     — html`` / string
//     buttons  — [{ label, kind: 'primary'|'navy'|'danger'|'ghost'|'', icon, action, onClick(handle), close: true, id }]
//                `action` is written as data-action (the click inventory id) and becomes the close result; the button
//                runs its own onClick only — it is never also sent to `actions`.
//     actions  — { name: (el, ev, handle) => … } for [data-action] elements inside the body
//   m.close(result) · m.el · m.body (element) · m.setBody(html) · m.setButtons(buttons) · m.closed (Promise)
//   ui.drawer({ …same, wide: true }) slides in from the right.

import { html, raw, el as toEl, on, uid, effect } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { pushLayer, layersRoot, animateIn, animateOut } from './overlay.js';
import { icon } from './icons.js';

function buttonsHTML(buttons = []) {
  return buttons.map((b, i) => html`<button type="button" class="btn ${b.kind ? 'btn-' + b.kind : ''} ${b.left ? 'left' : ''}" data-mbtn="${i}" ${raw(b.action ? `data-action="${String(b.action).replace(/[^\w.:-]/g, '')}"` : '')} ${raw(b.id ? `id="${b.id}"` : '')} ${raw(b.disabled ? 'aria-disabled="true"' : '')}>${b.icon ? icon(b.icon) : ''}${b.label}</button>`);
}

function open(kind, opts) {
  const { title = '', sub = '', body = '', size = 'md', buttons = [], actions = {}, onClose, dismissible = true, wide = false, className = '', escClose = true, labelHidden = false } = opts;
  const id = uid(kind);
  const isDrawer = kind === 'drawer';
  const panelCls = isDrawer ? `drawer ${wide ? 'drawer-wide' : ''}` : `modal ${size !== 'md' ? 'modal-' + size : ''}`;
  const root = toEl(html`<div class="backdrop ${isDrawer ? 'drawer-backdrop' : ''}">
    <div class="${panelCls} ${className}" role="dialog" aria-modal="true" aria-labelledby="${id}-t" tabindex="-1">
      <div class="modal-head">
        <div class="grow"><h2 id="${id}-t" class="${labelHidden ? 'sr-only' : ''}">${title}</h2>${sub ? html`<div class="sub">${sub}</div>` : ''}</div>
        ${dismissible ? html`<button type="button" class="xbtn" data-mclose aria-label="${t('common.close')}">${icon('x')}</button>` : ''}
      </div>
      <div class="modal-body">${body}</div>
      <div class="modal-foot" ${raw(buttons.length ? '' : 'hidden')}>${buttonsHTML(buttons)}</div>
    </div></div>`);
  const panel = root.firstElementChild;
  let currentButtons = buttons;
  let resolveClosed;
  const closed = new Promise((r) => { resolveClosed = r; });
  let isClosed = false;
  const offs = [];
  const handle = {
    el: panel,
    get body() { return panel.querySelector('.modal-body'); },
    closed,
    close(result) {
      if (isClosed) return;
      isClosed = true;
      offs.forEach((f) => f());
      unregister();
      animateOut(root, isDrawer ? 200 : 160);
      if (onClose) onClose(result);
      resolveClosed(result);
    },
    setBody(content) { panel.querySelector('.modal-body').innerHTML = String(content); },
    setTitle(text) { panel.querySelector(`#${id}-t`).textContent = text; },
    setButtons(list) {
      currentButtons = list;
      const foot = panel.querySelector('.modal-foot');
      foot.innerHTML = String(html`${buttonsHTML(list)}`);
      foot.hidden = !list.length;
    },
  };
  offs.push(on(panel, 'click', '[data-mclose]', (ev) => { ev.__handled = true; handle.close(); }));
  offs.push(on(panel, 'click', '[data-mbtn]', (ev, btn) => {
    ev.__handled = true;
    if (btn.getAttribute('aria-disabled') === 'true') return;
    const b = currentButtons[Number(btn.dataset.mbtn)];
    if (!b) return;
    const keep = b.onClick ? b.onClick(handle, btn) === false : false;
    if (b.close !== false && !keep) handle.close(b.result ?? b.action ?? true);
  }));
  offs.push(on(panel, 'click', '[data-action]', (ev, a) => {
    if (a.hasAttribute('data-mbtn')) return; // footer buttons are handled above
    const fn = actions[a.dataset.action];
    if (!fn) return;
    ev.__handled = true;
    if (a.getAttribute('aria-disabled') === 'true') return;
    fn(a, ev, handle);
  }));
  if (dismissible) {
    offs.push(on(root, 'mousedown', (ev) => { if (ev.target === root) root.__downOnBackdrop = true; }));
    offs.push(on(root, 'click', (ev) => { if (ev.target === root && root.__downOnBackdrop) handle.close(); root.__downOnBackdrop = false; }));
  }
  layersRoot().appendChild(root);
  const unregister = pushLayer({ el: panel, close: () => handle.close(), modal: true, escClose: dismissible && escClose });
  animateIn(root);
  // Focus: first [autofocus], else the first form field, else the panel.
  setTimeout(() => {
    const f = panel.querySelector('[autofocus]') || panel.querySelector('.modal-body input:not([type=hidden]), .modal-body select, .modal-body textarea') || panel;
    f.focus({ preventScroll: true });
  }, 30);
  effect('overlay', { kind });
  return handle;
}

export const modal = (opts) => open('modal', opts);
export const drawer = (opts) => open('drawer', opts);
