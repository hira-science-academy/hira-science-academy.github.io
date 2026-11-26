'use strict';

const ToolsCommon = (function () {

  function formatNumber(value, decimals = 6) {
    if (!isFinite(value)) return '—';
    if (Number.isInteger(value)) return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
    const rounded = parseFloat(value.toFixed(decimals));
    if (Math.abs(rounded) !== 0 && (Math.abs(rounded) < 1e-4 || Math.abs(rounded) >= 1e12)) {
      return rounded.toExponential(6);
    }
    return rounded.toLocaleString('en-US', { maximumFractionDigits: decimals, minimumFractionDigits: 0 });
  }

  function parseNum(raw) {
    if (raw === '' || raw === null || raw === undefined) return NaN;
    const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : NaN;
  }

  function showError(inputEl, message) {
    inputEl.classList.add('is-invalid');
    inputEl.setAttribute('aria-invalid', 'true');
    let errEl = inputEl.parentElement.querySelector('.calc-error');
    if (!errEl) {
      errEl = document.createElement('p');
      errEl.className = 'calc-error';
      errEl.setAttribute('role', 'alert');
      inputEl.parentElement.appendChild(errEl);
    }
    errEl.textContent = message;
    errEl.classList.add('is-visible');
  }

  function clearAllErrors(container) {
    container.querySelectorAll('.is-invalid').forEach(el => {
      el.classList.remove('is-invalid');
      el.removeAttribute('aria-invalid');
    });
    container.querySelectorAll('.calc-error').forEach(el => {
      el.textContent = '';
      el.classList.remove('is-visible');
    });
  }

function showResult(panel, html) {
  panel.innerHTML = html;
  panel.classList.add('is-visible');
  panel.setAttribute('aria-live', 'polite');
  // Wait for MathJax's own readiness signal instead of polling
  if (window.MathJax && MathJax.startup && MathJax.startup.promise) {
    MathJax.startup.promise.then(() => {
      MathJax.typesetPromise([panel]).catch(() => {});
    }).catch(() => {});
  } else if (window.MathJax && MathJax.typesetPromise) {
    MathJax.typesetPromise([panel]).catch(() => {});
  }
}
  function hideResult(panel) {
    panel.classList.remove('is-visible');
    panel.innerHTML = '';
  }

  async function copyToClipboard(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (_) {}
      document.body.removeChild(ta);
    }
    const original = btn.textContent;
    btn.classList.add('is-copied');
    btn.textContent = '✓ Copied';
    setTimeout(() => { btn.classList.remove('is-copied'); btn.textContent = original; }, 1800);
  }

  function gcd(a, b) {
    a = Math.abs(a); b = Math.abs(b);
    while (b) { [a, b] = [b, a % b]; }
    return a;
  }

  function lcm(a, b) {
    if (a === 0 || b === 0) return 0;
    return Math.abs(a * b) / gcd(a, b);
  }

  function round(value, decimals) {
    const f = Math.pow(10, decimals);
    return Math.round((value + Number.EPSILON) * f) / f;
  }

  function trackEvent(calculatorName, action) {
    if (typeof gtag === 'function') {
      gtag('event', action, { event_category: 'calculator', event_label: calculatorName, value: 1 });
    }
  }

  function bindEnterKey(container, button) {
    container.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); button.click(); }
    });
  }

  function attachCopyButton(resultPanel, calcName) {
    const observer = new MutationObserver(() => {
      if (resultPanel.classList.contains('is-visible') && !resultPanel.querySelector('.btn-copy')) {
        const btn = document.createElement('button');
        btn.className = 'btn-copy mt-3';
        btn.textContent = 'Copy Result';
        btn.addEventListener('click', () => {
          const val = resultPanel.querySelector('.result-value');
          if (val) {
            copyToClipboard(val.textContent.trim(), btn);
            trackEvent(calcName, 'copy_result');
          }
        });
        resultPanel.appendChild(btn);
      }
    });
    observer.observe(resultPanel, { childList: true, attributes: true, attributeFilter: ['class'] });
  }

  const CONVERSIONS = {
    length: { m:1, km:1000, cm:0.01, mm:0.001, um:1e-6, nm:1e-9, mi:1609.344, yd:0.9144, ft:0.3048, in:0.0254, nmi:1852 },
    mass: { kg:1, g:0.001, mg:1e-6, t:1000, lb:0.45359237, oz:0.028349523125, st:6.35029318, ton_us:907.18474, ton_uk:1016.0469088 },
    area: { m2:1, km2:1e6, cm2:1e-4, mm2:1e-6, ha:10000, acre:4046.8564224, ft2:0.09290304, in2:0.00064516, yd2:0.83612736, mi2:2589988.110336 },
    volume: { L:1, mL:0.001, m3:1000, cm3:0.001, ft3:28.316846592, in3:0.016387064, gal_us:3.785411784, gal_uk:4.54609, qt_us:0.946352946, pt_us:0.473176473, cup_us:0.2365882365, floz_us:0.0295735295625, tbsp:0.01478676478125, tsp:0.00492892159375 },
    speed: { mps:1, kmh:0.2777777778, mph:0.44704, fps:0.3048, knot:0.5144444444 },
    time: { s:1, min:60, h:3600, d:86400, wk:604800, mo:2629746, yr:31556952 }
  };

  function convertUnit(value, fromUnit, toUnit, category) {
    const table = CONVERSIONS[category];
    if (!table) throw new Error('Unknown category: ' + category);
    return value * table[fromUnit] / table[toUnit];
  }

  function convertTemperature(value, from, to) {
    let c;
    switch (from) {
      case 'C': c = value; break;
      case 'F': c = (value - 32) * 5 / 9; break;
      case 'K': c = value - 273.15; break;
      default: throw new Error('Unknown unit');
    }
    switch (to) {
      case 'C': return c;
      case 'F': return c * 9 / 5 + 32;
      case 'K': return c + 273.15;
    }
  }

  /* Safe math expression evaluator (no eval) */
  function safeEval(expr, degMode) {
    // Tokenize
    const tokens = expr.replace(/\s+/g, '')
      .replace(/([+\-*/^()])/g, ' $1 ')
      .replace(/(sin|cos|tan|log|ln|sqrt|abs|exp|pi|e)/gi, ' $1 ')
      .trim().split(/\s+/).filter(Boolean);

    const toRad = degMode ? (x) => x * Math.PI / 180 : (x) => x;
    let pos = 0;

    function peek() { return tokens[pos]; }
    function next() { return tokens[pos++]; }

    function parseExpr() {
      let left = parseTerm();
      while (peek() === '+' || peek() === '-') {
        const op = next();
        const right = parseTerm();
        left = op === '+' ? left + right : left - right;
      }
      return left;
    }

    function parseTerm() {
      let left = parseFactor();
      while (peek() === '*' || peek() === '/') {
        const op = next();
        const right = parseFactor();
        if (op === '*') left = left * right;
        else {
          if (right === 0) throw new Error('Division by zero');
          left = left / right;
        }
      }
      return left;
    }

    function parseFactor() {
      let base = parseUnary();
      if (peek() === '^') {
        next();
        const exp = parseFactor();
        return Math.pow(base, exp);
      }
      return base;
    }

    function parseUnary() {
      if (peek() === '-') { next(); return -parseUnary(); }
      if (peek() === '+') { next(); return parseUnary(); }
      return parsePrimary();
    }

    function parsePrimary() {
      const t = peek();
      if (t === undefined) throw new Error('Unexpected end');
      if (t === '(') {
        next();
        const v = parseExpr();
        if (next() !== ')') throw new Error('Missing )');
        return v;
      }
      const lower = t.toLowerCase();
      if (['sin','cos','tan','log','ln','sqrt','abs','exp'].includes(lower)) {
        next();
        let arg;
        if (peek() === '(') {
          next();
          arg = parseExpr();
          if (next() !== ')') throw new Error('Missing )');
        } else {
          arg = parseUnary();
        }
        switch (lower) {
          case 'sin': return Math.sin(toRad(arg));
          case 'cos': return Math.cos(toRad(arg));
          case 'tan': return Math.tan(toRad(arg));
          case 'log': if (arg <= 0) throw new Error('log domain'); return Math.log10(arg);
          case 'ln': if (arg <= 0) throw new Error('ln domain'); return Math.log(arg);
          case 'sqrt': if (arg < 0) throw new Error('sqrt domain'); return Math.sqrt(arg);
          case 'abs': return Math.abs(arg);
          case 'exp': return Math.exp(arg);
        }
      }
      if (lower === 'pi') { next(); return Math.PI; }
      if (lower === 'e') { next(); return Math.E; }
      const num = Number(t);
      if (Number.isFinite(num)) { next(); return num; }
      throw new Error('Unexpected token: ' + t);
    }

    const result = parseExpr();
    if (pos < tokens.length) throw new Error('Unexpected token: ' + tokens[pos]);
    return result;
  }

  return {
    formatNumber, parseNum, showError, clearAllErrors, showResult, hideResult,
    copyToClipboard, gcd, lcm, round, trackEvent, bindEnterKey, attachCopyButton,
    convertUnit, convertTemperature, CONVERSIONS, safeEval
  };
})();

/* ============================================================
   Page layout for every tool page (runs once, after the page is parsed)

   1. Calculators: inputs on the left, result on the right (desktop).
   2. Ad rails, same pattern as the notes pages:
        - right rail (300px): one ad, then a sticky ad that stays in view
          for the whole page (calculators from 1280px, other tools from 1100px)
        - left rail (160px): one sticky ad on screens 1600px and wider
      Below those widths the ad slots stay inline, as written in the page.
   3. Ads are requested only when they are visible and near the screen, so
      hidden rails (or the inline copies hidden on wide screens) never load.

   Elements are moved, not copied, so every id and event listener keeps
   working. The styling lives in tools.css.

   Page requirement: do NOT call adsbygoogle.push() inline inside the ad
   slots. This script requests every ad once, at the right moment.
   ============================================================ */
(function () {
  var CLIENT_FALLBACK = 'ca-pub-4029002473204443';

  /* ---------- 1. Two-column calculator layout ---------- */
  function buildCalcLayout() {
    var result = document.getElementById('result-panel');
    if (!result || result.closest('.calc-layout')) return;
    var main = result.parentElement;
    if (!main || main.tagName !== 'MAIN') return;
    // Upload and converter tools (dropzone) keep their single-column layout.
    if (document.getElementById('dropzone') || document.querySelector('.dropzone')) return;

    // The inputs are the nearest <section> before the result panel.
    var inputs = result.previousElementSibling;
    while (inputs && inputs.tagName !== 'SECTION') inputs = inputs.previousElementSibling;
    if (!inputs) return;

    // Anything between the inputs and the result panel stays with the inputs.
    var between = [];
    for (var p = inputs.nextElementSibling; p && p !== result; p = p.nextElementSibling) between.push(p);

    // Everything after the result panel, up to the first ad or the article.
    function isAd(el) { return el.classList.contains('ad-slot') || !!el.querySelector('ins.adsbygoogle, ins.adslazy'); }
    var follow = [];
    for (var n = result.nextElementSibling; n && n.tagName !== 'ARTICLE'; n = n.nextElementSibling) {
      if (isAd(n)) break;
      follow.push(n);
    }

    var layout = document.createElement('div');
    layout.className = 'calc-layout';
    var mainCol = document.createElement('div');
    mainCol.className = 'calc-main';
    var side = document.createElement('div');
    side.className = 'calc-side';
    layout.appendChild(mainCol);
    layout.appendChild(side);
    main.insertBefore(layout, inputs);

    mainCol.appendChild(inputs);
    between.forEach(function (el) { mainCol.appendChild(el); });

    side.appendChild(result);
    var empty = document.createElement('div');
    empty.className = 'result-empty';
    empty.setAttribute('aria-hidden', 'true');
    empty.innerHTML = '<p><strong>Your result appears here.</strong></p><p>Fill in the fields and press the calculate button.</p>';
    side.appendChild(empty);

    follow.forEach(function (el) {
      // The screen-reader live region goes with the result; examples and notes go with the inputs.
      (el.id === 'answer-live' ? side : mainCol).appendChild(el);
    });

    // Wider page frame; keep the long article at a readable line length.
    main.classList.add('calc-wide');
    var article = main.querySelector(':scope > article');
    if (article) article.classList.add('calc-narrow');
    var header = document.querySelector('header');
    var crumb = header && header.nextElementSibling;
    if (crumb && crumb.querySelector('nav[aria-label="Breadcrumb"]')) crumb.classList.add('calc-wide');
  }

  /* ---------- 2. Ad rails ---------- */
  function railAd(client, slotId, format) {
    var box = document.createElement('div');
    box.className = 'trail-ad';
    var label = document.createElement('p');
    label.className = 'ad-label';
    label.textContent = 'Advertisement';
    var ins = document.createElement('ins');
    ins.className = 'adslazy';
    ins.style.display = 'block';
    ins.setAttribute('data-ad-client', client);
    ins.setAttribute('data-ad-slot', slotId);
    ins.setAttribute('data-ad-format', format);
    ins.setAttribute('data-full-width-responsive', 'false');
    box.appendChild(label);
    box.appendChild(ins);
    return box;
  }

  function buildRails() {
    var main = document.querySelector('main');
    if (!main || (main.parentElement && main.parentElement.classList.contains('tools-shell'))) return;

    // Ad slots written in the page, and the real ad-unit ids they use.
    var slots = Array.prototype.filter.call(main.querySelectorAll('.ad-slot'), function (el) {
      return !!el.querySelector('ins.adsbygoogle, ins.adslazy');
    });
    var ids = [];
    var client = '';
    slots.forEach(function (s) {
      var ins = s.querySelector('ins');
      var id = ins.getAttribute('data-ad-slot') || '';
      client = client || ins.getAttribute('data-ad-client') || '';
      if (/^\d{6,}$/.test(id) && ids.indexOf(id) === -1) ids.push(id);   // skips "auto" and SLOT_ID placeholders
    });
    if (!ids.length) return;                                              // no valid ad unit: no rails
    client = client || CLIENT_FALLBACK;

    var shell = document.createElement('div');
    shell.className = 'tools-shell' + (main.classList.contains('calc-wide') ? ' is-calc' : '');

    var left = document.createElement('aside');
    left.className = 'trail trail-left';
    left.setAttribute('aria-label', 'Advertisement');
    var leftSticky = document.createElement('div');
    leftSticky.className = 'trail-sticky';
    leftSticky.appendChild(railAd(client, ids[0], 'vertical'));
    left.appendChild(leftSticky);

    var right = document.createElement('aside');
    right.className = 'trail trail-right';
    right.setAttribute('aria-label', 'Advertisement');
    right.appendChild(railAd(client, ids[0], 'auto'));
    var rightSticky = document.createElement('div');
    rightSticky.className = 'trail-sticky';
    rightSticky.appendChild(railAd(client, ids[1] || ids[0], 'vertical'));
    right.appendChild(rightSticky);

    // The inline copies are hidden by CSS whenever the rails are showing.
    slots.forEach(function (s) { s.classList.add('rail-src'); });

    // Where the rail sticks: below a sticky menu, otherwise near the top of the screen.
    var nav = document.getElementById('site-nav') || document.querySelector('nav[aria-label="Main navigation"]');
    var navSticky = nav && window.getComputedStyle(nav).position === 'sticky';
    shell.style.setProperty('--trail-top', ((navSticky ? nav.offsetHeight : 0) + 16) + 'px');

    main.parentNode.insertBefore(shell, main);
    shell.appendChild(left);
    shell.appendChild(main);
    shell.appendChild(right);
  }

  /* ---------- 3. Lazy ad requests ---------- */
  var observer = null;

  function requestAd(el) {
    if (el.getAttribute('data-done') || !el.offsetWidth) return;        // hidden rails are never requested
    el.setAttribute('data-done', '1');
    el.className = 'adsbygoogle';
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) { /* blocked or not loaded */ }
  }

  function scanAds() {
    var list = document.querySelectorAll('ins.adslazy:not([data-done])');
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (!el.offsetWidth || el.getAttribute('data-watch')) continue;
      el.setAttribute('data-watch', '1');
      if (observer) observer.observe(el); else requestAd(el);
    }
  }

  function startAds() {
    // Ads written in the page become lazy ones, unless Google already handled them.
    var own = document.querySelectorAll('ins.adsbygoogle');
    for (var i = 0; i < own.length; i++) {
      if (!own[i].getAttribute('data-adsbygoogle-status')) own[i].className = 'adslazy';
    }
    window.adsbygoogle = window.adsbygoogle || [];
    // If a page still has inline push() calls waiting for Google's script, drop them: this script
    // now requests each ad itself, once, in its final position.
    var queue = window.adsbygoogle;
    if (Object.prototype.toString.call(queue) === '[object Array]' && !queue.loaded && queue.length) queue.length = 0;
    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { observer.unobserve(e.target); requestAd(e.target); }
        });
      }, { rootMargin: '350px 0px' });
    }
    scanAds();
    // A rail that becomes visible after a resize is picked up here.
    var t;
    window.addEventListener('resize', function () { clearTimeout(t); t = setTimeout(scanAds, 250); });
  }

  function run() {
    try { buildCalcLayout(); } catch (e) { /* the layout is an enhancement; never break the calculator */ }
    try { buildRails(); } catch (e) { /* same for the rails */ }
    try { startAds(); } catch (e) { /* and the ads */ }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
