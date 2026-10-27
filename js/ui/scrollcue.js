// Scroll cues for wide tables. Every .tbl-wrap that scrolls sideways gets classes the CSS turns into cues:
//   x-scroll — the table is wider than its card
//   x-pin    — …and its last column stays pinned on the right: when it is narrow (≤ 35 % of the card), when it
//              holds only buttons and links (row actions, up to 60 %), or when the screen asks for it with
//              data-pin="actions" on the .tbl-wrap or the table (data-pin="none" turns pinning off)
//   x-start  — some columns are hidden on the left: the left edge fades
//   x-end    — more columns wait on the right: the pinned column casts an edge shadow, or the right edge fades
// Screens need nothing beyond the usual <div class="tbl-wrap"><table class="tbl">…</table></div>.

let queued = false;

function update(wrap) {
  const over = wrap.scrollWidth > wrap.clientWidth + 1;
  wrap.classList.toggle('x-scroll', over);
  wrap.classList.toggle('x-pin', over && shouldPin(wrap));
  wrap.classList.toggle('x-start', over && wrap.scrollLeft > 1);
  wrap.classList.toggle('x-end', over && wrap.scrollLeft + wrap.clientWidth < wrap.scrollWidth - 1);
}

/** Does the last column hold only controls? (Every body cell's text comes from its buttons and links.) */
function actionsOnly(wrap) {
  const cells = wrap.querySelectorAll('tbody tr > td:last-child');
  if (!cells.length) return false;
  for (const td of cells) {
    const all = td.textContent.replace(/\s+/g, '');
    const ctl = [...td.querySelectorAll('button, a')].map((x) => x.textContent).join('').replace(/\s+/g, '');
    if (all !== ctl) return false;
  }
  return true;
}

function shouldPin(wrap) {
  const ask = wrap.dataset.pin || (wrap.querySelector('table') || {}).dataset?.pin;
  if (ask === 'none') return false;
  if (ask === 'actions') return true;
  const last = wrap.querySelector('tr > :last-child');
  if (!last) return false;
  const share = last.getBoundingClientRect().width / wrap.clientWidth;
  return share <= 0.35 || (share <= 0.6 && actionsOnly(wrap));
}

function updateAll() {
  queued = false;
  document.querySelectorAll('.tbl-wrap').forEach(update);
}

function queue() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(updateAll);
}

export function initScrollCues() {
  document.addEventListener('scroll', (ev) => {
    const el = ev.target;
    if (el instanceof Element && el.classList.contains('tbl-wrap')) update(el);
  }, { capture: true, passive: true });
  window.addEventListener('resize', queue, { passive: true });
  // Screens, drawers and language switches replace tables: re-check after any DOM change (one pass per frame).
  new MutationObserver(queue).observe(document.body, { childList: true, subtree: true });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(queue);
  queue();
}
