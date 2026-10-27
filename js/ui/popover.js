// Popovers and menus anchored to a button.
// CONTRACT:
//   ui.menu(anchorEl, [{ label, icon, onSelect, checked, kbd, danger, href, sep: true, heading: 'text' }], { align: 'end' })
//   ui.popover(anchorEl, { content: html``, className, align, actions: { name: fn(el, ev, handle) }, role: 'dialog' })
// Clicking the same anchor again closes it. Esc and outside clicks close. Arrow keys move through menu items.

import { html, raw, el as toEl, on, effect } from '../core/dom.js';
import { pushLayer, layersRoot, animateIn, animateOut } from './overlay.js';
import { icon } from './icons.js';

let openPop = null;

function position(pop, anchor, align) {
  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth;
  const ph = pop.offsetHeight;
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  let left = align === 'start' ? r.left : r.right - pw;
  left = Math.max(8, Math.min(left, vw - pw - 8));
  let top = r.bottom + 6;
  if (top + ph > vh - 8 && r.top - ph - 6 > 8) top = r.top - ph - 6;
  top = Math.max(8, Math.min(top, vh - ph - 8));
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(top)}px`;
}

export function closePopover() {
  if (openPop) openPop.close();
}

export function popover(anchor, { content = '', className = '', align = 'end', actions = {}, role = 'dialog', label = '', onClose } = {}) {
  if (openPop && openPop.anchor === anchor) { openPop.close(); return null; }
  closePopover();
  const pop = toEl(html`<div class="popover ${className}" role="${role}" tabindex="-1" ${raw(label ? `aria-label="${label.replace(/"/g, '&quot;')}"` : '')}>${content}</div>`);
  layersRoot().appendChild(pop);
  position(pop, anchor, align);
  anchor.setAttribute('aria-expanded', 'true');
  const offs = [];
  let closed = false;
  const handle = {
    el: pop,
    anchor,
    close() {
      if (closed) return;
      closed = true;
      offs.forEach((f) => f());
      anchor.setAttribute('aria-expanded', 'false');
      unregister();
      animateOut(pop, 120);
      if (openPop === handle) openPop = null;
      if (onClose) onClose();
    },
    reposition: () => position(pop, anchor, align),
    setContent(c) { pop.innerHTML = String(c); position(pop, anchor, align); },
  };
  const unregister = pushLayer({ el: pop, close: () => handle.close(), modal: false });
  offs.push(on(document, 'pointerdown', (ev) => {
    if (!pop.contains(ev.target) && !anchor.contains(ev.target)) handle.close();
  }, true));
  offs.push(on(window, 'resize', () => handle.reposition()));
  offs.push(on(window, 'scroll', () => handle.reposition(), true));
  offs.push(on(pop, 'click', '[data-action]', (ev, a) => {
    const fn = actions[a.dataset.action];
    if (!fn) return;
    ev.__handled = true;
    fn(a, ev, handle);
  }));
  offs.push(on(pop, 'keydown', (ev) => {
    const items = Array.from(pop.querySelectorAll('.menu-item:not([aria-disabled="true"])'));
    if (!items.length) return;
    const i = items.indexOf(document.activeElement);
    if (ev.key === 'ArrowDown') { ev.preventDefault(); items[(i + 1) % items.length].focus(); }
    if (ev.key === 'ArrowUp') { ev.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    if (ev.key === 'Home') { ev.preventDefault(); items[0].focus(); }
    if (ev.key === 'End') { ev.preventDefault(); items[items.length - 1].focus(); }
  }));
  openPop = handle;
  animateIn(pop);
  setTimeout(() => {
    const first = pop.querySelector('[autofocus], .menu-item, input, button, a[href]');
    (first || pop).focus({ preventScroll: true });
  }, 20);
  effect('overlay', { kind: 'popover' });
  return handle;
}

export function menu(anchor, items, { align = 'end', className = '', label = '', head = null, foot = null } = {}) {
  const content = html`${head || ''}${items.map((it, i) => {
    if (it.sep) return html`<div class="menu-sep" role="separator"></div>`;
    if (it.heading) return html`<div class="menu-label" role="presentation">${it.heading}</div>`;
    const inner = html`${it.icon ? icon(it.icon) : ''}<span class="grow" ${raw(it.lang ? `lang="${it.lang}"` : '')}>${it.label}</span>${it.meta || ''}${it.checked ? html`<span class="chk">${icon('check', 'ico-sm')}</span>` : ''}${it.kbd ? html`<span class="kbd">${it.kbd}</span>` : ''}`;
    const role = it.checked != null ? 'menuitemradio' : 'menuitem';
    const attrs = raw(`${it.id ? ` data-action="${it.id}"` : ''}${it.checked != null ? ` aria-checked="${!!it.checked}"` : ''}`);
    if (it.href) return html`<a class="menu-item ${it.danger ? 'danger' : ''}" role="${role}" href="${it.href}" data-mi="${i}"${attrs}>${inner}</a>`;
    return html`<button type="button" class="menu-item ${it.danger ? 'danger' : ''}" role="${role}" data-mi="${i}"${attrs}>${inner}</button>`;
  })}${foot || ''}`;
  const h = popover(anchor, { content, className: `menu ${className}`, align, role: 'menu', label });
  if (!h) return null;
  on(h.el, 'click', '[data-mi]', (ev, b) => {
    ev.__handled = true;
    const it = items[Number(b.dataset.mi)];
    h.close();
    if (it && it.onSelect) it.onSelect(ev);
  });
  return h;
}
