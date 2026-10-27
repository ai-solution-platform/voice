// The `ui` facade handed to screens as ctx.ui. Screens touch the DOM outside their root ONLY through this.
// Each helper's contract is in the header of its own file.

import { icon, registerIcons } from './icons.js';
import { modal, drawer } from './modal.js';
import { popover, menu, closePopover } from './popover.js';
import { toast } from './toast.js';
import { term, hideTooltip } from './tooltip.js';
import { confirm } from './confirm.js';
import { skeleton, skeletonBlock } from './skeleton.js';
import { copy, download, downloadJSON, csv } from './io.js';
import { tones, tts, words, unlock, setMuted, isMuted } from './audio.js';
import { openDialer, closeDialer, mountDialer, verifyNumber, isDialerOpen } from './dialer.js';
import { openTopUp, goLive, goLivePopover, spendingLimits } from './topup.js';
import { sales } from './sales.js';
import { startTour, stopTour } from './tour.js';
import { openAnnouncement } from './announce.js';
import { openPalette, openShortcuts } from './palette.js';
import { chart } from './charts.js';
import { describe } from './describe.js';
import { html } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { PAGE_HELP } from '../data/reference.js';

/** "?" next to a page title → that screen's help article. */
function pageHelp(screenId) {
  const slug = PAGE_HELP[screenId] || 'first-call';
  return html`<a class="pagehelp" href="#/help/article/${slug}" data-action="shell.pagehelp" aria-label="${t('shell.pageHelp')}" data-tip-key="shell.pageHelp">${icon('help', 'ico-sm')}</a>`;
}

export const ui = {
  icon,
  registerIcons,
  modal,
  drawer,
  popover,
  menu,
  closePopover,
  toast,
  term,
  hideTooltip,
  confirm,
  skeleton,
  skeletonBlock,
  copy,
  download,
  downloadJSON,
  csv,
  audio: { tones, tts, words, unlock, setMuted, isMuted },
  dialer: { open: openDialer, close: closeDialer, mount: mountDialer, verifyNumber, isOpen: isDialerOpen },
  topup: openTopUp,
  goLive,
  goLivePopover,
  spendingLimits,
  pageHelp,
  sales,
  tour: { start: startTour, stop: stopTour },
  announce: openAnnouncement,
  palette: openPalette,
  shortcuts: openShortcuts,
  chart,
  describe,
};
