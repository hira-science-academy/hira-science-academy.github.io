'use strict';

/* ============================================================
   Hira Science Academy — PDF to Image Converter
   Renders PDF pages to JPG, PNG or WebP in the browser.
   The PDF never leaves the device. The only network request is for the
   open-source pdf.js renderer (Mozilla), which loads on demand the first
   time a PDF is chosen. Depends on assets/tools-common.js.
   ============================================================ */
(function () {

  if (typeof ToolsCommon === 'undefined') {
    const e = document.getElementById('file-error');
    if (e) { e.textContent = 'The shared tools script did not load. Please refresh the page.'; e.classList.add('is-visible'); }
    return;
  }

  const { trackEvent, formatNumber } = ToolsCommon;

  const CALC_NAME = 'pdf-to-image';
  const PDFJS_VERSION = '3.11.174';
  const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/' + PDFJS_VERSION + '/pdf.min.js';
  const WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/' + PDFJS_VERSION + '/pdf.worker.min.js';
  const MAX_FILE_BYTES = 150 * 1024 * 1024;
  const MAX_PAGES_PER_RUN = 300;
  const MAX_SIDE = 16000;
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const MAX_PIXELS = coarse ? 16e6 : 50e6;       // iOS Safari limits canvas area
  const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

  const $ = (id) => document.getElementById(id);
  const dropzone = $('dropzone');
  const fileInput = $('file-input');
  const fileErr = $('file-error');
  const fileInfo = $('file-info');
  const fileNameEl = $('file-name');
  const fileMetaEl = $('file-meta');
  const fileThumb = $('file-thumb');
  const pwBox = $('pw-box');
  const pwInput = $('pw-input');
  const pwBtn = $('pw-btn');
  const pwNote = $('pw-note');
  const settings = $('settings');
  const formatEl = $('format');
  const dpiEl = $('dpi');
  const qualityEl = $('quality');
  const qualityOut = $('quality-out');
  const qualityWrap = $('quality-wrap');
  const pagesEl = $('pages');
  const rangeWrap = $('range-wrap');
  const rangeEl = $('range');
  const convertBtn = $('convert-btn');
  const cancelBtn = $('cancel-btn');
  const resetBtn = $('reset-btn');
  const busyEl = $('busy');
  const progressWrap = $('progress-wrap');
  const progressBar = $('progress-bar');
  const resultsSection = $('results-section');
  const resultsHead = $('results-head');
  const zipBtn = $('zip-btn');
  const grid = $('results-grid');

  const state = { pdf: null, name: 'document', pages: 0, run: 0, running: false, results: [], pwCallback: null, thumbUrl: null };

  /* ---------- Helpers ---------- */
  function formatBytes(n) {
    if (n < 1024) return n + ' B';
    const kb = n / 1024;
    if (kb < 1024) return formatNumber(kb, kb < 10 ? 2 : 1) + ' KB';
    return formatNumber(kb / 1024, 2) + ' MB';
  }
  function showError(msg) { fileErr.textContent = msg; fileErr.classList.add('is-visible'); }
  function clearError() { fileErr.textContent = ''; fileErr.classList.remove('is-visible'); }
  const tick = () => new Promise((r) => setTimeout(r, 0));

  const WEBP_OK = (function () {
    try { const c = document.createElement('canvas'); c.width = c.height = 1; return c.toDataURL('image/webp').indexOf('data:image/webp') === 0; }
    catch (_) { return false; }
  })();
  if (!WEBP_OK) {
    const o = formatEl.querySelector('option[value="webp"]');
    if (o) { o.disabled = true; o.textContent += ' (not supported by this browser)'; }
  }

  /* pdf.js is loaded only when it is needed, which keeps the page fast. */
  let pdfjsPromise = null;
  function loadPdfJs() {
    if (window.pdfjsLib) { window.pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_URL; return Promise.resolve(window.pdfjsLib); }
    if (pdfjsPromise) return pdfjsPromise;
    pdfjsPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PDFJS_URL;
      s.onload = () => {
        if (window.pdfjsLib) { window.pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_URL; resolve(window.pdfjsLib); }
        else { pdfjsPromise = null; reject(new Error('pdfjs')); }
      };
      s.onerror = () => { pdfjsPromise = null; reject(new Error('pdfjs')); };
      document.head.appendChild(s);
    });
    return pdfjsPromise;
  }

  /* ---------- Loading a PDF ---------- */
  async function isPdf(file) {
    const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
    let s = '';
    for (let i = 0; i < head.length; i++) s += String.fromCharCode(head[i]);
    return s.indexOf('%PDF-') !== -1;
  }

  async function handleFile(file, extra) {
    clearError();
    if (!file) return;
    if (file.size === 0) { showError('That file is empty.'); return; }
    if (file.size > MAX_FILE_BYTES) { showError('This file is ' + formatBytes(file.size) + '. The limit is 150 MB.'); return; }
    let ok = false;
    try { ok = await isPdf(file); } catch (_) { /* ignore */ }
    if (!ok) { showError('This does not look like a PDF file. Choose a file ending in .pdf.'); return; }

    resetResults();
    destroyPdf();
    fileInfo.hidden = false;
    fileNameEl.textContent = file.name;
    fileMetaEl.textContent = 'Reading PDF… ' + formatBytes(file.size);
    setBusy(true, 'Loading the PDF reader…');

    let lib;
    try { lib = await loadPdfJs(); }
    catch (_) {
      setBusy(false);
      fileInfo.hidden = true;
      showError('The PDF reader could not be loaded. Check your internet connection and try again.');
      return;
    }

    let data;
    try { data = new Uint8Array(await file.arrayBuffer()); }
    catch (_) { setBusy(false); fileInfo.hidden = true; showError('The file could not be read.'); return; }

    setBusy(true, 'Opening the PDF…');
    const task = lib.getDocument({ data });
    task.onPassword = (cb, reason) => {
      state.pwCallback = cb;
      pwBox.hidden = false;
      pwNote.textContent = reason === 2 ? 'That password is not correct. Try again.' : 'This PDF is password protected. Enter the password to open it.';
      pwNote.className = reason === 2 ? 'hint-line pw-bad' : 'hint-line';
      setBusy(false);
      pwInput.focus();
    };
    try {
      const pdf = await task.promise;
      state.pdf = pdf;
      state.pages = pdf.numPages;
      state.name = file.name.replace(/\.[^.]*$/, '').replace(/[^\p{L}\p{N}_\- ]+/gu, '').trim().slice(0, 80) || 'document';
      pwBox.hidden = true; pwInput.value = ''; state.pwCallback = null;
      fileMetaEl.textContent = pdf.numPages + (pdf.numPages === 1 ? ' page' : ' pages') + ' · ' + formatBytes(file.size) +
        (extra > 1 ? ' · Only the first file was used.' : '');
      settings.disabled = false;
      convertBtn.disabled = false;
      setBusy(false);
      updateUi();
      showThumb(pdf);
      trackEvent(CALC_NAME, 'pdf_loaded');
    } catch (err) {
      setBusy(false);
      pwBox.hidden = true;
      fileInfo.hidden = true;
      const name = err && err.name;
      showError(name === 'InvalidPDFException' ? 'This PDF is damaged or not a valid PDF file.'
        : name === 'PasswordException' ? 'A password is required to open this PDF.'
        : 'This PDF could not be opened. It may be damaged or use an unsupported feature.');
    }
  }

  /* Small preview of page 1 so the person can confirm they chose the right file. */
  async function showThumb(pdf) {
    try {
      const page = await pdf.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: Math.min(3, 220 / base.width) });
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.ceil(vp.width)); c.height = Math.max(1, Math.ceil(vp.height));
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const blob = await toBlob(c, 'image/jpeg', 0.8);
      c.width = c.height = 0;
      try { page.cleanup(); } catch (_) {}
      if (state.pdf !== pdf) return;                 // a different file was chosen meanwhile
      clearThumb();
      state.thumbUrl = URL.createObjectURL(blob);
      fileThumb.src = state.thumbUrl;
      fileThumb.hidden = false;
    } catch (_) { /* the preview is optional */ }
  }
  function clearThumb() {
    if (state.thumbUrl) URL.revokeObjectURL(state.thumbUrl);
    state.thumbUrl = null;
    fileThumb.removeAttribute('src');
    fileThumb.hidden = true;
  }

  function destroyPdf() {
    if (state.pdf) { try { state.pdf.destroy(); } catch (_) {} }
    revokeResults();
    clearThumb();
    state.pdf = null; state.pages = 0;
    settings.disabled = true; convertBtn.disabled = true;
  }

  function setBusy(on, message) {
    busyEl.textContent = message || 'Working…';
    busyEl.hidden = !on;
  }

  /* ---------- Page selection ---------- */
  function parsePages(text, total) {
    const set = new Set();
    const parts = text.replace(/\s+/g, '').split(',').filter(Boolean);
    if (!parts.length) return { error: 'Enter the pages to convert, for example 1-3, 5.' };
    for (const p of parts) {
      const m = p.match(/^(\d*)(-?)(\d*)$/);
      if (!m || (!m[1] && !m[3])) return { error: '“' + p + '” is not a valid page or range. Use a format like 1-3, 5.' };
      let a, b;
      if (!m[2]) { a = b = Number(m[1]); }
      else { a = m[1] ? Number(m[1]) : 1; b = m[3] ? Number(m[3]) : total; }
      if (a < 1 || b < 1 || a > total || b > total) return { error: 'This PDF has ' + total + (total === 1 ? ' page' : ' pages') + '. Choose pages between 1 and ' + total + '.' };
      if (a > b) return { error: 'The range ' + p + ' goes backwards. Write it as ' + b + '-' + a + '.' };
      for (let i = a; i <= b; i++) set.add(i);
    }
    return { list: Array.from(set).sort((x, y) => x - y) };
  }

  function updateUi() {
    const f = formatEl.value;
    qualityWrap.hidden = f === 'png';
    rangeWrap.hidden = pagesEl.value !== 'range';
  }

  /* ---------- Rendering ---------- */
  function toBlob(canvas, mime, q) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((b) => { b ? resolve(b) : reject(new Error('encode')); }, mime, mime === 'image/png' ? undefined : q);
    });
  }

  function revokeResults() {
    state.results.forEach((r) => URL.revokeObjectURL(r.url));
    state.results = [];
  }

  function resetResults() {
    revokeResults();
    grid.textContent = '';
    resultsSection.hidden = true;
    zipBtn.hidden = true;
    progressWrap.hidden = true;
    progressBar.style.width = '0%';
  }

  function addCard(r) {
    const li = document.createElement('li');
    li.className = 'img-card';

    const preview = document.createElement('div');
    preview.className = 'preview';
    const zoom = document.createElement('a');
    zoom.href = r.url; zoom.target = '_blank'; zoom.rel = 'noopener';
    zoom.setAttribute('aria-label', 'Open page ' + r.n + ' at full size in a new tab');
    const img = document.createElement('img');
    img.src = r.url; img.alt = 'Page ' + r.n + ' as ' + r.ext.toUpperCase(); img.loading = 'lazy'; img.decoding = 'async';
    zoom.appendChild(img); preview.appendChild(zoom);

    const cap = document.createElement('p');
    cap.className = 'img-cap';
    cap.textContent = 'Page ' + r.n + ' · ' + r.w + ' × ' + r.h + ' px · ' + formatBytes(r.blob.size) +
      (r.reduced ? ' · resolution lowered to fit the browser' : '');

    const a = document.createElement('a');
    a.className = 'btn-calc btn-secondary-calc dl-link';
    a.href = r.url; a.download = r.filename; a.textContent = 'Download page ' + r.n;
    a.addEventListener('click', () => trackEvent(CALC_NAME, 'download_single'));

    li.appendChild(preview); li.appendChild(cap); li.appendChild(a);
    grid.appendChild(li);
  }

  async function convert() {
    if (!state.pdf || state.running) return;
    clearError();
    let list;
    if (pagesEl.value === 'range') {
      const parsed = parsePages(rangeEl.value, state.pages);
      if (parsed.error) { showError(parsed.error); return; }
      list = parsed.list;
    } else {
      list = Array.from({ length: state.pages }, (_, i) => i + 1);
    }
    if (list.length > MAX_PAGES_PER_RUN) { showError('Convert at most ' + MAX_PAGES_PER_RUN + ' pages at a time. Use the page range option.'); return; }

    resetResults();
    const run = ++state.run;
    state.running = true;
    convertBtn.disabled = true; cancelBtn.hidden = false; settings.disabled = true;
    resultsSection.hidden = false; progressWrap.hidden = false;

    const fmt = formatEl.value, mime = MIME[fmt];
    const scaleBase = Number(dpiEl.value) / 72;
    const quality = Number(qualityEl.value) / 100;
    const pad = String(state.pages).length;
    let done = 0, lowered = 0;

    try {
      for (const n of list) {
        if (run !== state.run) return;
        setBusy(true, 'Converting page ' + n + ' (' + (done + 1) + ' of ' + list.length + ')…');
        await tick();
        const page = await state.pdf.getPage(n);
        let scale = scaleBase;
        let vp = page.getViewport({ scale });
        let reduced = false;
        const area = vp.width * vp.height, side = Math.max(vp.width, vp.height);
        if (area > MAX_PIXELS || side > MAX_SIDE) {
          scale *= Math.min(Math.sqrt(MAX_PIXELS / area), MAX_SIDE / side);
          vp = page.getViewport({ scale });
          reduced = true; lowered++;
        }
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(vp.width));
        canvas.height = Math.max(1, Math.floor(vp.height));
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('canvas');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        if (run !== state.run) { canvas.width = canvas.height = 0; return; }
        const blob = await toBlob(canvas, mime, quality);
        if (blob.type !== mime) throw new Error('unsupported');
        const w = canvas.width, h = canvas.height;
        canvas.width = canvas.height = 0;
        try { page.cleanup(); } catch (_) {}

        const r = { n, blob, w, h, ext: fmt, reduced, url: URL.createObjectURL(blob),
          filename: state.name + '-page-' + String(n).padStart(pad, '0') + '.' + fmt };
        state.results.push(r);
        addCard(r);
        done++;
        progressBar.style.width = Math.round(done / list.length * 100) + '%';
        resultsHead.textContent = done + ' of ' + list.length + (list.length === 1 ? ' page converted' : ' pages converted');
      }
      resultsHead.textContent = done + (done === 1 ? ' page converted' : ' pages converted') + ' to ' + fmt.toUpperCase();
      zipBtn.hidden = done < 2;
      if (lowered) showError(lowered + (lowered === 1 ? ' page was' : ' pages were') + ' larger than the browser can safely draw, so ' + (lowered === 1 ? 'its' : 'their') + ' resolution was lowered. Choose a lower resolution for consistent results.');
      trackEvent(CALC_NAME, 'convert_' + fmt);
    } catch (err) {
      showError(err && err.message === 'unsupported'
        ? 'This browser cannot create ' + fmt.toUpperCase() + ' files. Choose a different format.'
        : 'Page conversion failed. Try a lower resolution or convert fewer pages at once.');
    } finally {
      if (run === state.run) {
        state.running = false;
        setBusy(false);
        cancelBtn.hidden = true;
        convertBtn.disabled = !state.pdf;
        settings.disabled = !state.pdf;
        progressWrap.hidden = true;
      }
    }
  }

  function cancel() {
    state.run++;
    state.running = false;
    setBusy(false);
    cancelBtn.hidden = true;
    convertBtn.disabled = !state.pdf;
    settings.disabled = !state.pdf;
    progressWrap.hidden = true;
    resultsHead.textContent = state.results.length + (state.results.length === 1 ? ' page converted' : ' pages converted') + ' before you stopped';
    zipBtn.hidden = state.results.length < 2;
  }

  /* ---------- ZIP (store only; images are already compressed) ---------- */
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
  async function makeZip(files) {
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
    }
    let cdSize = 0;
    central.forEach((c) => { cdSize += c.length; });
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [new Uint8Array(end.buffer)]), { type: 'application/zip' });
  }

  async function downloadZip() {
    if (!state.results.length) return;
    zipBtn.disabled = true;
    const label = zipBtn.textContent;
    zipBtn.textContent = 'Building ZIP…';
    try {
      const blob = await makeZip(state.results.map((r) => ({ name: r.filename, blob: r.blob })));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = state.name + '-images.zip'; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      trackEvent(CALC_NAME, 'download_zip');
    } catch (_) {
      showError('The ZIP file could not be created. Download the pages one by one instead.');
    } finally {
      zipBtn.disabled = false; zipBtn.textContent = label;
    }
  }

  /* ---------- Events ---------- */
  fileInput.addEventListener('change', () => {
    const f = fileInput.files;
    handleFile(f && f[0], f ? f.length : 0);
    fileInput.value = '';
  });
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
  ['dragenter', 'dragover'].forEach((t) => dropzone.addEventListener(t, (e) => { e.preventDefault(); dropzone.classList.add('is-drag'); }));
  ['dragleave', 'dragend'].forEach((t) => dropzone.addEventListener(t, () => dropzone.classList.remove('is-drag')));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault(); dropzone.classList.remove('is-drag');
    const f = e.dataTransfer && e.dataTransfer.files;
    if (f && f.length) handleFile(f[0], f.length);
  });
  ['dragover', 'drop'].forEach((t) => window.addEventListener(t, (e) => {
    if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') !== -1) e.preventDefault();
  }));

  pwBtn.addEventListener('click', () => { if (state.pwCallback && pwInput.value) { setBusy(true, 'Opening the PDF…'); state.pwCallback(pwInput.value); } });
  pwInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); pwBtn.click(); } });

  formatEl.addEventListener('change', updateUi);
  pagesEl.addEventListener('change', updateUi);
  qualityEl.addEventListener('input', () => { qualityOut.textContent = qualityEl.value; });
  convertBtn.addEventListener('click', convert);
  cancelBtn.addEventListener('click', cancel);
  zipBtn.addEventListener('click', downloadZip);

  resetBtn.addEventListener('click', () => {
    state.run++; state.running = false;
    resetResults(); destroyPdf(); clearError();
    fileInfo.hidden = true; fileNameEl.textContent = ''; fileMetaEl.textContent = '';
    pwBox.hidden = true; pwInput.value = ''; state.pwCallback = null;
    formatEl.value = 'jpg'; dpiEl.value = '150'; qualityEl.value = 90; qualityOut.textContent = '90';
    pagesEl.value = 'all'; rangeEl.value = '';
    cancelBtn.hidden = true; setBusy(false);
    updateUi();
    trackEvent(CALC_NAME, 'reset');
    dropzone.focus();
  });

  window.addEventListener('pagehide', () => { state.results.forEach((r) => URL.revokeObjectURL(r.url)); destroyPdf(); });

  updateUi();
})();
