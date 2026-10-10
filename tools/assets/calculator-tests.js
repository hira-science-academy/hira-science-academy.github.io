/* ============================================================
   Hira Science Academy — Calculator Test Suite
   Run in browser console: runAllTests()
   ============================================================ */

'use strict';

const CalcTests = (function () {

  const results = [];

  function assert(name, actual, expected, tolerance = 1e-9) {
    let pass;
    if (typeof expected === 'number' && typeof actual === 'number') {
      pass = Math.abs(actual - expected) <= tolerance;
    } else {
      pass = actual === expected;
    }
    results.push({ name, actual, expected, pass });
    if (!pass) {
      console.error(`✗ FAIL: ${name} — expected ${expected}, got ${actual}`);
    } else {
      console.log(`✓ PASS: ${name}`);
    }
    return pass;
  }

  function assertThrows(name, fn, expectedMessagePart) {
    let threw = false;
    let message = '';
    try { fn(); } catch (e) { threw = true; message = e.message || ''; }
    const pass = threw && (!expectedMessagePart || message.includes(expectedMessagePart));
    results.push({ name, pass, actual: message, expected: expectedMessagePart || 'throws' });
    if (pass) {
      console.log(`✓ PASS: ${name}`);
    } else {
      console.error(`✗ FAIL: ${name} — ${threw ? 'wrong message: ' + message : 'did not throw'}`);
    }
    return pass;
  }

  /* ---------- Test definitions ---------- */

  function testCommon() {
    console.log('\n=== Common Utilities ===');
    assert('formatNumber integer', ToolsCommon.formatNumber(1234), '1,234');
    assert('formatNumber decimal', ToolsCommon.formatNumber(3.14159, 2), '3.14');
    assert('formatNumber zero', ToolsCommon.formatNumber(0), '0');
    assert('parseNum valid', ToolsCommon.parseNum('42'), 42);
    assert('parseNum empty -> NaN', ToolsCommon.parseNum(''), NaN);
    assert('parseNum invalid -> NaN', ToolsCommon.parseNum('abc'), NaN);
    assert('gcd(12,18)', ToolsCommon.gcd(12, 18), 6);
    assert('gcd(0,5)', ToolsCommon.gcd(0, 5), 5);
    assert('lcm(4,6)', ToolsCommon.lcm(4, 6), 12);
    assert('lcm(0,5)', ToolsCommon.lcm(0, 5), 0);
    assert('round(3.14159,2)', ToolsCommon.round(3.14159, 2), 3.14);
    assert('isInt(5)', ToolsCommon.isInt(5), true);
    assert('isInt(5.5)', ToolsCommon.isInt(5.5), false);
  }

  function testUnitConversions() {
    console.log('\n=== Unit Conversions ===');
    assert('1 km to m', ToolsCommon.convertUnit(1, 'km', 'm', 'length'), 1000);
    assert('1 mi to m', ToolsCommon.convertUnit(1, 'mi', 'm', 'length'), 1609.344);
    assert('1 kg to lb', ToolsCommon.convertUnit(1, 'kg', 'lb', 'mass'), 2.2046226218, 1e-6);
    assert('1 acre to m2', ToolsCommon.convertUnit(1, 'acre', 'm2', 'area'), 4046.8564224, 1e-4);
    assert('1 gal_us to L', ToolsCommon.convertUnit(1, 'gal_us', 'L', 'volume'), 3.785411784, 1e-6);
    assert('1 kmh to mps', ToolsCommon.convertUnit(1, 'kmh', 'mps', 'speed'), 0.2777777778, 1e-6);
    assert('1 h to s', ToolsCommon.convertUnit(1, 'h', 's', 'time'), 3600);
  }

  function testTemperature() {
    console.log('\n=== Temperature Conversions ===');
    assert('0°C to F', ToolsCommon.convertTemperature(0, 'C', 'F'), 32);
    assert('100°C to F', ToolsCommon.convertTemperature(100, 'C', 'F'), 212);
    assert('32°F to C', ToolsCommon.convertTemperature(32, 'F', 'C'), 0);
    assert('0°C to K', ToolsCommon.convertTemperature(0, 'C', 'K'), 273.15);
    assert('273.15K to C', ToolsCommon.convertTemperature(273.15, 'K', 'C'), 0);
    assert('-40°C to F', ToolsCommon.convertTemperature(-40, 'C', 'F'), -40);
  }

  /* ---------- Individual calculator tests ---------- */

  // These are called by each page's own test block.
  // The test suite here covers shared utilities.
  // Each calculator page should include its own <script> with test cases
  // that call CalcTests.assert() for its specific logic.

  function runAll() {
    results.length = 0;
    console.log('🧪 Hira Science Academy — Calculator Test Suite');
    console.log('='.repeat(50));
    testCommon();
    testUnitConversions();
    testTemperature();
    // Individual calculator tests are run by each page via CalcTests.runPageTests()
    console.log('\n' + '='.repeat(50));
    const passed = results.filter(r => r.pass).length;
    const failed = results.filter(r => !r.pass).length;
    console.log(`Results: ${passed} passed, ${failed} failed, ${results.length} total`);
    if (failed === 0) {
      console.log('✅ All shared tests passed.');
    } else {
      console.log('❌ Some tests failed. See details above.');
    }
    return { passed, failed, total: results.length, results: [...results] };
  }

  function getResults() { return [...results]; }

  return { assert, assertThrows, runAll, getResults, results };
})();

// Auto-run in dev mode when ?test=1 is in URL
if (typeof window !== 'undefined' && window.location.search.includes('test=1')) {
  window.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => CalcTests.runAll(), 500);
  });
}