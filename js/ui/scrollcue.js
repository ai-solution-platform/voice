// Scroll cues for wide tables. Every .tbl-wrap that scrolls sideways gets classes the CSS turns into cues:
//   x-scroll — the table is wider than its card
//   x-pin    — …and its last column (row actions) is narrow (≤ 35 % of the card): it stays pinned on the right
//   x-start  — some columns are hidden on the left: the left edge fades
//   x-end    — more columns wait on the right: the pinned column casts an edge shadow, or the right edge fades
// Screens need nothing beyond the usual <div class="tbl-wrap"><table class="tbl">…</table></div>.

let queued = false;

function update(wrap) {
  const over = wrap.scrollWidth > wrap.clientWidth + 1;
  wrap.classList.toggle('x-scroll', over);
  const last = over ? wrap.querySelector('tr > :last-child') : null;
  wrap.classList.toggle('x-pin', !!last && last.getBoundingClientRect().width <= wrap.clientWidth * 0.35);
  wrap.classList.toggle('x-start', over && wrap.scrollLeft > 1);
  wrap.classList.toggle('x-end', over && wrap.scrollLeft + wrap.clientWidth < wrap.scrollWidth - 1);
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
