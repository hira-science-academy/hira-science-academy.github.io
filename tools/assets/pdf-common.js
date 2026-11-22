'use strict';

/* ============================================================
   Hira Science Academy: shared helpers for the PDF tools
   (PDF Splitter, PDF Merger, PDF Watermark).
   Everything runs in the browser. PDFs are never uploaded.
   Third-party code loaded on demand from cdnjs:
     pdf-lib 1.17.1  (create / edit PDFs)
     pdf.js 3.11.174 (page previews only; same version as the PDF to Image tool)
   Exposes the global PDFTools. Depends on assets/tools-common.js (optional:
   analytics is skipped if it is missing).
   ============================================================ */
(function (global) {

  const PDFLIB_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js';
  const PDFJS_VERSION = '3.11.174';
  const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/' + PDFJS_VERSION + '/pdf.min.js';
  const PDFJS_WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/' + PDFJS_VERSION + '/pdf.worker.min.js';

  const tick = () => new Promise((r) => setTimeout(r, 0));

  /* ---------- Library loading (once, on demand) ---------- */
  const pending = {};
  function loadScript(key, url, ready) {
    if (ready()) return Promise.resolve();
    if (pending[key]) return pending[key];
    pending[key] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url; s.async = true;
      s.onload = () => { if (ready()) resolve(); else { delete pending[key]; reject(new Error(key)); } };
      s.onerror = () => { delete pending[key]; reject(new Error(key)); };
      document.head.appendChild(s);
    });
    return pending[key];
  }
  function loadPdfLib() {
    return loadScript('pdflib', PDFLIB_URL, () => !!global.PDFLib).then(() => global.PDFLib);
  }
  function loadPdfJs() {
    return loadScript('pdfjs', PDFJS_URL, () => !!global.pdfjsLib).then(() => {
      if (!global.pdfjsLib.GlobalWorkerOptions.workerSrc) global.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      return global.pdfjsLib;
    });
  }

  /* ---------- Small helpers ---------- */
  function formatBytes(n) {
    if (n < 1024) return n + ' B';
    const kb = n / 1024;
    if (kb < 1024) return (kb < 10 ? kb.toFixed(2) : kb.toFixed(1)) + ' KB';
    const mb = kb / 1024;
    return (mb < 100 ? mb.toFixed(2) : mb.toFixed(1)) + ' MB';
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function baseName(filename, fallback) {
    const s = String(filename || '').replace(/\.[^.]*$/, '').replace(/[^\p{L}\p{N}_\- ]+/gu, '').trim().replace(/\s+/g, '-').slice(0, 60);
    return s || fallback || 'document';
  }
  function cleanFileName(text, fallback) {
    const s = String(text || '').replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '').trim().slice(0, 80);
    return s || fallback;
  }
  function track(tool, action) {
    try { if (global.ToolsCommon && global.ToolsCommon.trackEvent) global.ToolsCommon.trackEvent(tool, action); } catch (_) { /* analytics must never break a tool */ }
  }

  function readBytes(file) { return file.arrayBuffer().then((b) => new Uint8Array(b)); }

  /* A PDF starts with %PDF- somewhere in its first 1024 bytes. */
  async function looksLikePdf(file) {
    const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
    let s = '';
    for (let i = 0; i < head.length; i++) s += String.fromCharCode(head[i]);
    return s.indexOf('%PDF-') !== -1;
  }

  /* Opens a PDF with pdf-lib and says what is wrong if it cannot be used.
     Returns { doc, pages } or { error: 'encrypted' | 'invalid' | 'empty' }. */
  async function openPdf(bytes) {
    const lib = await loadPdfLib();
    let doc;
    try {
      doc = await lib.PDFDocument.load(bytes, { updateMetadata: false });
    } catch (err) {
      const msg = String(err && err.message || err);
      return { error: /encrypt/i.test(msg) ? 'encrypted' : 'invalid' };
    }
    let pages = 0;
    try { pages = doc.getPageCount(); } catch (_) { return { error: 'invalid' }; }
    if (!pages) return { error: 'empty' };
    return { doc, pages };
  }
  const OPEN_ERRORS = {
    encrypted: 'This PDF is password protected or encrypted, and this tool cannot open protected files. Remove the protection in the program that created the PDF, then try again.',
    invalid: 'This PDF is damaged or is not a valid PDF file, so it could not be opened.',
    empty: 'This PDF has no pages, so there is nothing to work with.'
  };

  /* ---------- Page lists such as "1-3, 5, 8-" ---------- */
  function pagesWord(total) { return total + (total === 1 ? ' page' : ' pages'); }
  /* One token → [from, to] or an error string */
  function parseToken(p, total) {
    const m = p.match(/^(\d*)(-?)(\d*)$/);
    if (!m || (!m[1] && !m[3])) return { error: '“' + p + '” is not a valid page or range. Use a format like 1-3, 5, 8-10.' };
    let a, b;
    if (!m[2]) { a = b = Number(m[1]); }
    else { a = m[1] ? Number(m[1]) : 1; b = m[3] ? Number(m[3]) : total; }
    if (a < 1 || b < 1 || a > total || b > total) return { error: 'This PDF has ' + pagesWord(total) + '. “' + p + '” is outside that. Choose pages from 1 to ' + total + '.' };
    if (a > b) return { error: 'The range “' + p + '” goes backwards. Write it as ' + b + '-' + a + '.' };
    return { a, b };
  }
  function tokens(text) { return String(text || '').replace(/\s+/g, '').replace(/[;،]/g, ',').split(',').filter(Boolean); }
  function range(a, b) { const r = []; for (let i = a; i <= b; i++) r.push(i); return r; }

  /* All listed pages as one list, duplicates removed, order kept (or sorted). */
  function parsePageList(text, total, sorted) {
    const parts = tokens(text);
    if (!parts.length) return { error: 'Enter the pages, for example 1-3, 5, 8-10.' };
    const seen = new Set(), list = [];
    for (const p of parts) {
      const t = parseToken(p, total);
      if (t.error) return t;
      for (let i = t.a; i <= t.b; i++) if (!seen.has(i)) { seen.add(i); list.push(i); }
    }
    if (sorted) list.sort((x, y) => x - y);
    return { list };
  }
  /* Each comma-separated token becomes its own group (its own output file). */
  function parseRangeGroups(text, total) {
    const parts = tokens(text);
    if (!parts.length) return { error: 'Enter at least one range, for example 1-3, 4-6, 7-10.' };
    const groups = [];
    for (const p of parts) {
      const t = parseToken(p, total);
      if (t.error) return t;
      groups.push({ label: t.a === t.b ? String(t.a) : t.a + '-' + t.b, pages: range(t.a, t.b) });
    }
    return { groups };
  }

  /* ---------- Download helpers ---------- */
  const liveUrls = new Set();
  function makeUrl(blob) { const u = URL.createObjectURL(blob); liveUrls.add(u); return u; }
  function freeUrl(u) { if (u) { URL.revokeObjectURL(u); liveUrls.delete(u); } }
  function freeAllUrls() { liveUrls.forEach((u) => URL.revokeObjectURL(u)); liveUrls.clear(); }
  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  global.addEventListener('pagehide', freeAllUrls);

  /* ---------- ZIP writer (store only: PDFs are already compressed) ---------- */
  const CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(u8) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  async function makeZip(files) {           // files: [{ name, blob }]
    const enc = new TextEncoder();
    const d = new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const parts = [], central = [];
    let offset = 0;
    for (const f of files) {
      const data = new Uint8Array(await f.blob.arrayBuffer());
      const name = enc.encode(f.name);
      const crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, time, true); lh.setUint16(12, date, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, time, true); ch.setUint16(14, date, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
      await tick();
    }
    let cdSize = 0;
    central.forEach((c) => { cdSize += c.length; });
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [new Uint8Array(end.buffer)]), { type: 'application/zip' });
  }

  /* ---------- pdf.js page rendering (previews) ---------- */
  /* Opens a document for previews. Never throws: resolves to null if pdf.js is unavailable. */
  async function openPreview(bytes) {
    try {
      const lib = await loadPdfJs();
      // pdf.js may transfer the buffer to its worker, so give it its own copy.
      return await lib.getDocument({ data: bytes.slice(0) }).promise;
    } catch (_) { return null; }
  }
  async function renderPage(pdfjsDoc, n, targetWidth, transparent) {
    const page = await pdfjsDoc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.max(0.05, Math.min(4, targetWidth / base.width));
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(vp.width)); c.height = Math.max(1, Math.ceil(vp.height));
    const ctx = c.getContext('2d');
    if (!transparent) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height); }
    await page.render({ canvasContext: ctx, viewport: vp, background: transparent ? 'rgba(0,0,0,0)' : undefined }).promise;
    try { page.cleanup(); } catch (_) { /* ignore */ }
    return c;
  }
  /* Runs async jobs two at a time so thumbnails never freeze the page. */
  function makeQueue(limit) {
    let running = 0; const waiting = [];
    function next() {
      while (running < limit && waiting.length) {
        const job = waiting.shift(); running++;
        job().catch(() => {}).then(() => { running--; next(); });
      }
    }
    return { add(job) { waiting.push(job); next(); }, clear() { waiting.length = 0; } };
  }

  global.PDFTools = {
    tick, loadPdfLib, loadPdfJs, formatBytes, plural, baseName, cleanFileName, track, readBytes, looksLikePdf,
    openPdf, OPEN_ERRORS, parsePageList, parseRangeGroups, range, pagesWord,
    makeUrl, freeUrl, freeAllUrls, saveBlob, makeZip,
    openPreview, renderPage, makeQueue
  };
})(window);
