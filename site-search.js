/*! Hira Science Academy – shared site search (Pagefind)
 *  Put this file in the ROOT of your site, then on any page add:
 *    1) where you want the bar:   <div id="site-search-slot"></div>
 *       (dark/blue section? use: <div id="site-search-slot" data-variant="glass"></div>)
 *    2) before </body>:           <script src="/site-search.js" defer></script>
 *  Any element with the attribute data-site-search also opens the search.
 *  Search files in /pagefind/ load only when the search is opened.
 */
(function () {
  if (window.__siteSearchLoaded) return;
  window.__siteSearchLoaded = true;

  var CSS = [
    '.ss-wrap{display:flex;justify-content:center;margin:0 auto;padding:0 16px}',
    '.ss-trigger{display:flex;align-items:center;gap:12px;width:100%;max-width:560px;height:52px;padding:0 18px;border-radius:12px;cursor:pointer;font:600 15px/1 inherit;font-family:inherit;text-align:left;transition:all .2s}',
    '.ss-trigger svg{flex:none;width:20px;height:20px}',
    '.ss-trigger span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.ss-trigger kbd{font:12px/1 inherit;border-radius:4px;padding:3px 7px}',
    '.ss-light{background:#fff;color:#4b5563;border:2px solid #d1d5db;box-shadow:0 2px 8px rgba(15,23,42,.06)}',
    '.ss-light:hover{border-color:#2563eb;color:#1d4ed8}',
    '.ss-light svg{color:#2563eb}.ss-light kbd{border:1px solid #d1d5db;color:#6b7280}',
    '.ss-glass{background:rgba(255,255,255,.1);color:rgba(239,246,255,.9);border:2px solid rgba(255,255,255,.4);backdrop-filter:blur(4px)}',
    '.ss-glass:hover{background:rgba(255,255,255,.2)}',
    '.ss-glass svg{color:#fde68a}.ss-glass kbd{border:1px solid rgba(255,255,255,.4);color:rgba(255,255,255,.8)}',
    '.ss-trigger:focus{outline:none;box-shadow:0 0 0 4px rgba(147,197,253,.6)}',
    '@media(max-width:767px){.ss-trigger kbd{display:none}}',
    '.ss-modal{position:fixed;inset:0;z-index:2147483000;display:none;align-items:flex-start;justify-content:center;padding:56px 12px 12px;background:rgba(15,23,42,.6)}',
    '.ss-modal.ss-open{display:flex}',
    '.ss-panel{width:100%;max-width:680px;max-height:calc(100vh - 72px);display:flex;flex-direction:column;background:#fff;border-radius:16px;box-shadow:0 24px 60px -12px rgba(15,23,42,.5);overflow:hidden}',
    '.ss-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid #e5e7eb}',
    '.ss-head h2{margin:0;font-size:15px;font-weight:700;color:#1e3a8a}',
    '.ss-close{border:1px solid #d1d5db;border-radius:8px;background:#f9fafb;color:#374151;font-size:13px;padding:6px 12px;cursor:pointer}',
    '#ss-pf{padding:14px 16px 18px;overflow-y:auto;--pagefind-ui-scale:1;--pagefind-ui-primary:#1d4ed8;--pagefind-ui-text:#111827;--pagefind-ui-background:#fff;--pagefind-ui-border:#d1d5db;--pagefind-ui-tag:#eff6ff;--pagefind-ui-border-width:1px;--pagefind-ui-border-radius:10px;--pagefind-ui-font:inherit}',
    '.ss-msg{padding:16px;text-align:center;color:#b91c1c;font-size:14px}',
    'body.ss-lock{overflow:hidden}'
  ].join('\n');

  var ICON = '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35M17 10.5a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z"/></svg>';
  var modal, mount, started = false, lastOpener = null;

  function fail() { started = false; mount.innerHTML = '<p class="ss-msg">Search could not be loaded. Please try again later.</p>'; }

  function start() {
    if (started) return; started = true;
    var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/pagefind/pagefind-ui.css'; document.head.appendChild(l);
    var s = document.createElement('script'); s.src = '/pagefind/pagefind-ui.js';
    s.onload = function () {
      try {
        mount.innerHTML = '';
        new PagefindUI({ element: '#ss-pf', showImages: false, showSubResults: true, resetStyles: false, autofocus: true, pageSize: 8, excerptLength: 20, translations: { placeholder: 'Search notes, tools & guides…' } });
      } catch (e) { fail(); }
    };
    s.onerror = fail; document.head.appendChild(s);
  }

  function open(opener) {
    lastOpener = opener || document.activeElement;
    modal.hidden = false; modal.classList.add('ss-open'); document.body.classList.add('ss-lock');
    start();
    setTimeout(function () { var i = mount.querySelector('input'); if (i) i.focus(); }, 50);
  }
  function close() {
    modal.classList.remove('ss-open'); modal.hidden = true; document.body.classList.remove('ss-lock');
    if (lastOpener && lastOpener.focus) lastOpener.focus();
  }

  function init() {
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);

    modal = document.createElement('div');
    modal.className = 'ss-modal'; modal.hidden = true;
    modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-labelledby', 'ss-title');
    modal.setAttribute('data-pagefind-ignore', '');
    modal.innerHTML = '<div class="ss-panel"><div class="ss-head"><h2 id="ss-title">Search Hira Science Academy</h2><button type="button" class="ss-close">Close (Esc)</button></div><div id="ss-pf"></div></div>';
    document.body.appendChild(modal);
    mount = modal.querySelector('#ss-pf');
    modal.querySelector('.ss-close').addEventListener('click', close);
    modal.addEventListener('click', function (e) { if (e.target === modal) close(); });

    document.querySelectorAll('#site-search-slot, [data-site-search-slot]').forEach(function (slot) {
      var glass = slot.getAttribute('data-variant') === 'glass';
      slot.setAttribute('data-pagefind-ignore', '');
      slot.className += ' ss-wrap';
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'ss-trigger ' + (glass ? 'ss-glass' : 'ss-light');
      b.setAttribute('aria-haspopup', 'dialog'); b.setAttribute('aria-label', 'Search all notes, tools and guides on this website');
      b.setAttribute('data-site-search', '');
      b.innerHTML = ICON + '<span>Search notes, tools &amp; guides…</span><kbd aria-hidden="true">/</kbd>';
      slot.appendChild(b);
    });

    document.querySelectorAll('[data-site-search]').forEach(function (el) {
      el.addEventListener('click', function () { open(el); });
    });

    document.addEventListener('keydown', function (e) {
      var t = e.target || {}, typing = /INPUT|TEXTAREA|SELECT/.test(t.tagName || '') || t.isContentEditable;
      if (e.key === 'Escape' && modal.classList.contains('ss-open')) close();
      else if (!modal.classList.contains('ss-open') && ((e.key === '/' && !typing && !e.ctrlKey && !e.metaKey) || ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'k'))) {
        e.preventDefault(); open(document.activeElement);
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
