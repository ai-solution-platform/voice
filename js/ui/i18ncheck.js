// ?i18ncheck=1 — translation QA mode. Outlines labels that overflow their box and any
// missing key (rendered as ⟦key⟧), and lists the missing keys in a small fixed panel. Not shown otherwise.

const SELECTOR = '.navlabel, .btn, .chip, .tbl th, .menu-item, .seg button, .envseg button, .setup-pill, .optcard .t, .label';

function scan() {
  document.querySelectorAll('[data-i18n-flag]').forEach((e) => { e.style.outline = ''; e.removeAttribute('data-i18n-flag'); });
  let overflow = 0;
  for (const el of document.querySelectorAll(SELECTOR)) {
    if (el.offsetParent === null) continue;
    if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 4 && getComputedStyle(el).overflow === 'hidden') {
      el.style.outline = '2px dashed #E5484D';
      el.setAttribute('data-i18n-flag', 'overflow');
      overflow++;
    }
  }
  const walker = document.createTreeWalker(document.body, 4 /* NodeFilter.SHOW_TEXT */);
  let missingInDom = 0;
  while (walker.nextNode()) {
    if (walker.currentNode.nodeValue.includes('⟦')) {
      const p = walker.currentNode.parentElement;
      p.style.outline = '2px solid #E5484D';
      p.setAttribute('data-i18n-flag', 'missing');
      missingInDom++;
    }
  }
  const missing = [...(window.__i18nMissing || [])];
  let panel = document.getElementById('i18ncheck');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'i18ncheck';
    panel.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:9999;background:#0E1C37;color:#fff;font:12px/1.5 ui-monospace,monospace;padding:10px 12px;border-radius:10px;max-width:360px;max-height:40vh;overflow:auto;box-shadow:0 8px 24px rgba(0,0,0,.3)';
    document.body.appendChild(panel);
  }
  panel.textContent = `i18n check · lang=${document.documentElement.lang} · overflow ${overflow} · missing ${missing.length}${missingInDom ? ` (${missingInDom} on screen)` : ''}\n${missing.slice(0, 40).join('\n')}`;
  panel.style.whiteSpace = 'pre-wrap';
  window.__i18nCheck = { overflow, missing, missingInDom };
}

export function initI18nCheck() {
  const run = () => setTimeout(scan, 120);
  window.addEventListener('demo:route', run);
  document.addEventListener('click', run, true);
  run();
}
