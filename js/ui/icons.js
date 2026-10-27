// Inline SVG icon sprite (24×24 line icons, 1.75 px stroke — see .ico in app.css).
// CONTRACT: icon('phone') → <svg class="ico"><use href="#i-phone"/></svg> (SafeHTML).
// Need an icon that is not here? Call registerIcons({ name: '<path d="…"/>' }) at the top of your
// screen module instead of editing this file.

import { raw } from '../core/dom.js';

const ICONS = {
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/>',
  plug: '<path d="M9 3v4M15 3v4M7 7h10v4a5 5 0 0 1-10 0V7zM12 16v5"/>',
  phone: '<path d="M5.2 3.8h3l1.7 4.1-2.2 1.4a11.2 11.2 0 0 0 5 5l1.4-2.2 4.1 1.7v3a2 2 0 0 1-2.2 2A15.6 15.6 0 0 1 3.2 6a2 2 0 0 1 2-2.2z"/>',
  'phone-call': '<path d="M5.2 3.8h3l1.7 4.1-2.2 1.4a11.2 11.2 0 0 0 5 5l1.4-2.2 4.1 1.7v3a2 2 0 0 1-2.2 2A15.6 15.6 0 0 1 3.2 6a2 2 0 0 1 2-2.2z"/><path d="M14.5 3.2a6.5 6.5 0 0 1 6.3 6.3M14.5 6.6a3 3 0 0 1 2.9 2.9"/>',
  'phone-off': '<path d="M3 14.2c5-4.9 13-4.9 18 0l-2 2.7-3.5-1.3-.4-2.5a12.5 12.5 0 0 0-6.2 0l-.4 2.5L5 16.9z"/>',
  'phone-in': '<path d="M5.2 3.8h3l1.7 4.1-2.2 1.4a11.2 11.2 0 0 0 5 5l1.4-2.2 4.1 1.7v3a2 2 0 0 1-2.2 2A15.6 15.6 0 0 1 3.2 6a2 2 0 0 1 2-2.2z"/><path d="M20.5 3.5 15 9M15 4.5V9h4.5"/>',
  'phone-out': '<path d="M5.2 3.8h3l1.7 4.1-2.2 1.4a11.2 11.2 0 0 0 5 5l1.4-2.2 4.1 1.7v3a2 2 0 0 1-2.2 2A15.6 15.6 0 0 1 3.2 6a2 2 0 0 1 2-2.2z"/><path d="M15 9l5.5-5.5M16 3.5h4.5V8"/>',
  hash: '<path d="M5 9h14.5M4.5 15H19M10 3.5 8 20.5M16 3.5l-2 17"/>',
  server: '<rect x="3.5" y="4" width="17" height="6.5" rx="2"/><rect x="3.5" y="13.5" width="17" height="6.5" rx="2"/><path d="M7.5 7.25h.01M7.5 16.75h.01M11 7.25h6M11 16.75h6"/>',
  megaphone: '<path d="M4 10v4a1 1 0 0 0 1 1h2l6.5 4V5L7 9H5a1 1 0 0 0-1 1zM17 9a4 4 0 0 1 0 6M7.2 15l1 5h2.6l-1-5"/>',
  shield: '<path d="M12 3 5 6v5.5c0 4.3 3 7.7 7 9.5 4-1.8 7-5.2 7-9.5V6l-7-3z"/>',
  'shield-check': '<path d="M12 3 5 6v5.5c0 4.3 3 7.7 7 9.5 4-1.8 7-5.2 7-9.5V6l-7-3z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
  flow: '<circle cx="6" cy="5" r="2"/><circle cx="18" cy="5" r="2"/><circle cx="12" cy="19" r="2"/><path d="M6 7v1a4 4 0 0 0 4 4h4a4 4 0 0 0 4-4V7M12 12v5"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
  chart: '<path d="M4 20h16M7 16.5v-5M12 16.5V6M17 16.5V9.5"/>',
  'chart-line': '<path d="M4 4v16h16"/><path d="m7.5 14.5 3.5-4 3 2.5 4.5-6"/>',
  bell: '<path d="M6 16v-5a6 6 0 1 1 12 0v5l1.5 2h-15L6 16zM10 20.5a2.2 2.2 0 0 0 4 0"/>',
  card: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 10h18M7 15h3"/>',
  users: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 5.2a3.5 3.5 0 0 1 0 6.6M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
  key: '<circle cx="8" cy="15" r="4.5"/><path d="m11.2 11.8 8.3-8.3M16.5 6.5 19 9M14 9l2 2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.2 3h-4.4l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2l.4 2.6h4.4l.4-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.3a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.3-2.5 4M12 17.2h.01"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'chevron-up': '<path d="m6 15 6-6 6 6"/>',
  'chevron-right': '<path d="m9 6 6 6-6 6"/>',
  'chevron-left': '<path d="m15 6-6 6 6 6"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  'check-circle': '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.8 2.8L16.2 9.5"/>',
  'x-circle': '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2"/><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5M4.5 19.5h15"/>',
  upload: '<path d="M12 15.5V4.5M7 9l5-5 5 5M4.5 19.5h15"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.6-4.5M4 4.5v4h4M4 13a8 8 0 0 0 14.6 4.5M20 19.5v-4h-4"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off': '<path d="M4 4l16 16M10.6 6.1A9.6 9.6 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-2.9 3.6M6.2 7.6A16.6 16.6 0 0 0 2.5 12s3.5 6 9.5 6a9 9 0 0 0 4.1-1M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  mail: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="m4 7.5 8 6 8-6"/>',
  chat: '<path d="M20 11.5c0 4.1-3.6 7.5-8 7.5a8.6 8.6 0 0 1-3.3-.6L4 20l1.3-3.7A7.2 7.2 0 0 1 4 11.5C4 7.4 7.6 4 12 4s8 3.4 8 7.5z"/>',
  sms: '<rect x="3.5" y="4.5" width="17" height="12" rx="2.5"/><path d="m8 20.5 3-4M8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z"/>',
  pause: '<path d="M8.5 5.5v13M15.5 5.5v13"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/>',
  volume: '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  'volume-x': '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5zM16 9.5l5 5M21 9.5l-5 5"/>',
  wave: '<path d="M3 12h1.5M7 9v6M11 5.5v13M15 8v8M19 10.5v3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  alert: '<path d="M12 4 2.8 19.5h18.4zM12 10v4M12 17h.01"/>',
  'alert-circle': '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5M12 16h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8h.01"/>',
  sparkles: '<path d="M12 3.5l1.8 4.7 4.7 1.8-4.7 1.8-1.8 4.7-1.8-4.7L5.5 10l4.7-1.8zM18.5 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
  rocket: '<path d="M14.5 4.6c2.4-.9 5-1.1 5-1.1s-.2 2.6-1.1 5L13 14l-3-3zM10 11l-3.6.4L4 14l4 .6M13 14l-.4 3.6L10 20l-.6-4M7.4 16.6 5 19"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M7.5 14h9"/>',
  logout: '<path d="M14 4.5h4A1.5 1.5 0 0 1 19.5 6v12a1.5 1.5 0 0 1-1.5 1.5h-4M10 16l-4-4 4-4M6 12h9"/>',
  building: '<path d="M4.5 20.5V5A1.5 1.5 0 0 1 6 3.5h8A1.5 1.5 0 0 1 15.5 5v15.5M15.5 9.5H18a1.5 1.5 0 0 1 1.5 1.5v9.5M3 20.5h18M8 7.5h1M11 7.5h1M8 11h1M11 11h1M8 14.5h1M11 14.5h1"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  filter: '<path d="M4 5h16l-6 7.5V19l-4-1.5v-5z"/>',
  more: '<path d="M6 12h.01M12 12h.01M18 12h.01" stroke-width="3"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  'arrow-right': '<path d="M5 12h14M13 6l6 6-6 6"/>',
  'arrow-left': '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  'arrow-up-right': '<path d="M7 17 17 7M9 7h8v8"/>',
  'arrow-down-left': '<path d="M17 7 7 17M15 17H7V9"/>',
  code: '<path d="m8 7-5 5 5 5M16 7l5 5-5 5M13.5 4.5l-3 15"/>',
  terminal: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="m7 9.5 3 2.5-3 2.5M12.5 15H17"/>',
  book: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5zM20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z"/>',
  activity: '<path d="M3 12h4l2.5-6 5 12 2.5-6h4"/>',
  lifebuoy: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="m5.6 5.6 3.9 3.9M14.5 14.5l3.9 3.9M18.4 5.6l-3.9 3.9M9.5 14.5l-3.9 3.9"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5M14 11v5"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16zM13.5 6.5l4 4"/>',
  coin: '<circle cx="12" cy="12" r="8.5"/><path d="M14.8 9.2c-.5-.9-1.6-1.4-2.8-1.4-1.6 0-2.8.8-2.8 2.1 0 2.9 5.8 1.4 5.8 4.2 0 1.3-1.3 2.1-3 2.1-1.3 0-2.4-.5-2.9-1.5M12 6v1.8M12 16.2V18"/>',
  zap: '<path d="M13 3 5 13.5h6L10.5 21 19 10.5h-6z"/>',
  signal: '<path d="M4 20v-3M9 20v-7M14 20V9M19 20V4"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8M14 4.5v5M8 14.5v5"/>',
  file: '<path d="M6 3.5h8l4.5 4.5v12.5H6zM14 3.5V8h4.5"/>',
  'file-text': '<path d="M6 3.5h8l4.5 4.5v12.5H6zM14 3.5V8h4.5M9 12.5h6M9 16h6"/>',
  dialpad: '<path d="M6 5h.01M12 5h.01M18 5h.01M6 11h.01M12 11h.01M18 11h.01M6 17h.01M12 17h.01M18 17h.01" stroke-width="2.6"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  send: '<path d="M20.5 3.5 3.5 10l7 3 3 7zM10.5 13l4-4"/>',
  ticket: '<path d="M3.5 6.5h17v3a2.5 2.5 0 0 0 0 5v3h-17v-3a2.5 2.5 0 0 0 0-5zM14 6.5v11"/>',
  route: '<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5"/>',
  pulse: '<path d="M3 12h3.5l2-4.5 3.5 9 2.5-6.5 1.5 2H21"/>',
  ants: '<path d="M5.2 18 10.6 5.5h2.8L18.8 18M7.9 12.6h8.2"/>',
  dot: '<circle cx="12" cy="12" r="3"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".5"/>',
  'list-check': '<path d="M11 6h9M11 12h9M11 18h9M3.5 6l1.5 1.5L7.5 5M3.5 12l1.5 1.5 2.5-2.5M3.5 18l1.5 1.5 2.5-2.5"/>',
};

let spriteEl = null;

function symbolMarkup(name, inner) {
  return `<symbol id="i-${name}" viewBox="0 0 24 24">${inner}</symbol>`;
}

/** Inject the sprite once at boot (called by app.js). */
export function injectSprite() {
  if (spriteEl) return;
  spriteEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  spriteEl.setAttribute('aria-hidden', 'true');
  spriteEl.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden');
  spriteEl.innerHTML = Object.entries(ICONS).map(([n, p]) => symbolMarkup(n, p)).join('');
  document.body.prepend(spriteEl);
}

/** Add icons at runtime (screen modules). Existing names are not overwritten. */
export function registerIcons(map) {
  for (const [n, p] of Object.entries(map)) {
    if (ICONS[n]) continue;
    ICONS[n] = p;
    if (spriteEl) spriteEl.insertAdjacentHTML('beforeend', symbolMarkup(n, p));
  }
}

export const hasIcon = (name) => !!ICONS[name];

/** icon('phone', 'ico-sm') → SafeHTML */
export function icon(name, cls = '') {
  const n = ICONS[name] ? name : 'dot';
  return raw(`<svg class="ico${cls ? ' ' + cls : ''}" aria-hidden="true" focusable="false"><use href="#i-${n}"></use></svg>`);
}
