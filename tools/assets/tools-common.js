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
