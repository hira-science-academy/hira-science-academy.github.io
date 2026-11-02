'use strict';

/* ============================================================
   Hira Science Academy — Image Compressor
   Runs entirely in the browser (Canvas API). No uploads, no backend.
   Depends on assets/tools-common.js (ToolsCommon). Does not modify it.
   ============================================================ */
(function () {

  if (typeof ToolsCommon === 'undefined') {
    const e = document.getElementById('file-error');
    if (e) {
      e.textContent = 'The shared tools script did not load. Please refresh the page.';
      e.classList.add('is-visible');
    }
    return;
  }

  const { trackEvent, parseNum, formatNumber, showError, clearAllErrors,
          showResult, hideResult, attachCopyButton } = ToolsCommon;

  const CALC_NAME = 'image-compressor';
  const MAX_FILE_BYTES = 25 * 1024 * 1024;   // 25 MB upload limit
  const MAX_PIXELS = 40e6;                    // 40 megapixel decode limit
  const DEBOUNCE_MS = 300;
  const TYPE_LABEL = { 'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/webp': 'WebP' };
  const TYPE_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

  const $ = (id) => document.getElementById(id);
  const card = $('tool-card');
  const dropzone = $('dropzone');
  const fileInput = $('file-input');
  const fileErr = $('file-error');
  const fileInfo = $('file-info');
  const fileNameEl = $('file-name');
  const fileMetaEl = $('file-meta');
  const settings = $('settings');
  const formatEl = $('format');
  const formatNote = $('format-note');
  const qualityEl = $('quality');
  const qualityOut = $('quality-out');
  const widthEl = $('width');
  const heightEl = $('height');
  const lockEl = $('lock');
  const bgWrap = $('bg-wrap');
  const bgEl = $('bg');
  const busyEl = $('busy');
  const downloadBtn = $('download-btn');
  const resetBtn = $('reset-btn');
  const resultPanel = $('result-panel');
  const cmpPlaceholder = $('cmp-placeholder');
  const cmpWrap = $('cmp-wrap');
  const cmpBox = $('cmp');
  const beforeImg = $('cmp-before');
  const afterImg = $('cmp-after');
  const divider = $('cmp-divider');
  const cmpRange = $('cmp-range');

  attachCopyButton(resultPanel, CALC_NAME);

  const state = {
    file: null, type: null, bytes: 0, w: 0, h: 0,
    decoded: null, origUrl: null, outUrl: null, outBlob: null,
    seq: 0, loadSeq: 0, timer: null, tracked: false
  };

  /* ---------- Feature detection ---------- */
  const WEBP_OK = (function () {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      return c.toDataURL('image/webp').indexOf('data:image/webp') === 0;
    } catch (_) { return false; }
  })();

  if (!WEBP_OK) {
    const opt = formatEl.querySelector('option[value="image/webp"]');
    if (opt) { opt.disabled = true; opt.textContent += ' (not supported by this browser)'; }
  }

  /* ---------- Helpers ---------- */
  function formatBytes(n) {
    if (n < 1024) return n + ' B';
    const kb = n / 1024;
    if (kb < 1024) return formatNumber(kb, kb < 10 ? 2 : 1) + ' KB';
    return formatNumber(kb / 1024, 2) + ' MB';
  }

  function fileError(msg) {
    fileErr.textContent = msg;
    fileErr.classList.add('is-visible');
  }

  function ascii(buf, start, len) {
    let s = '';
    for (let i = start; i < start + len; i++) s += String.fromCharCode(buf[i]);
    return s;
  }

  /* Detect the real type from the file signature (not the extension or MIME). */
  async function detectType(file) {
    const buf = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    if (buf.length >= 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
    const png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    if (buf.length >= 8 && png.every((b, i) => buf[i] === b)) return 'image/png';
    if (buf.length >= 12 && ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 4) === 'WEBP') return 'image/webp';
    return null;
  }

  /* Decode with EXIF orientation applied where the browser supports it. */
  async function decode(file) {
    if (typeof createImageBitmap === 'function') {
      const attempts = [{ imageOrientation: 'from-image' }, undefined];
      for (const opts of attempts) {
        try {
          const bmp = opts ? await createImageBitmap(file, opts) : await createImageBitmap(file);
          return { src: bmp, w: bmp.width, h: bmp.height, close: () => { try { bmp.close(); } catch (_) {} } };
        } catch (_) { /* try next strategy */ }
      }
    }
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve({
        src: img, w: img.naturalWidth, h: img.naturalHeight,
        close: () => URL.revokeObjectURL(url)
      });
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }

  function encode(src, w, h, mime, quality, bg) {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('canvas')); return; }
      if (mime === 'image/jpeg') {            // JPEG has no alpha channel
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, 0, 0, w, h);
      canvas.toBlob((blob) => {
        canvas.width = 0; canvas.height = 0;  // release canvas memory (Safari)
        blob ? resolve(blob) : reject(new Error('encode'));
      }, mime, mime === 'image/png' ? undefined : quality);
    });
  }

  function resolveMime() {
    return formatEl.value === 'original' ? state.type : formatEl.value;
  }

  function downloadName() {
    const raw = state.file ? state.file.name.replace(/\.[^.]*$/, '') : 'image';
    const base = raw.replace(/[^\p{L}\p{N}_\- ]+/gu, '').trim().slice(0, 80) || 'image';
    return base + '-compressed.' + TYPE_EXT[resolveMime()];
  }

  /* ---------- UI state ---------- */
  function setBusy(on) {
    busyEl.hidden = !on;
    resultPanel.setAttribute('aria-busy', on ? 'true' : 'false');
  }

  function updateFormatUi() {
    const mime = resolveMime();
    const hasAlphaSource = state.type === 'image/png' || state.type === 'image/webp';
    qualityEl.disabled = mime === 'image/png';
    bgWrap.hidden = !(mime === 'image/jpeg' && hasAlphaSource);
    let note = '';
    if (mime === 'image/png') {
      note = 'PNG is lossless, so the quality slider has no effect. To reduce the size, lower the width and height or choose WebP or JPEG.';
    } else if (mime === 'image/jpeg') {
      note = hasAlphaSource
        ? 'JPEG cannot store transparency. Transparent areas are filled with the background colour below.'
        : 'JPEG suits photographs. Lower quality gives a smaller file with more visible artefacts.';
    } else if (mime === 'image/webp') {
      note = 'WebP supports lossy compression and transparency, and is often smaller than JPEG or PNG at similar quality.';
    }
    formatNote.textContent = note;
  }

  function setCmp(v) {
    afterImg.style.clipPath = 'inset(0 0 0 ' + Number(v) + '%)';
    divider.style.left = Number(v) + '%';
  }

  function releaseImage() {
    clearTimeout(state.timer);
    state.seq++;
    if (state.origUrl) URL.revokeObjectURL(state.origUrl);
    if (state.outUrl) URL.revokeObjectURL(state.outUrl);
    if (state.decoded) state.decoded.close();
    state.origUrl = state.outUrl = state.outBlob = state.decoded = null;
    beforeImg.removeAttribute('src');
    afterImg.removeAttribute('src');
  }

  /* ---------- Loading a file ---------- */
  async function handleFile(file, extraCount) {
    clearAllErrors(card);
    if (!file) return;
    if (file.size === 0) { fileError('That file is empty.'); return; }
    if (file.size > MAX_FILE_BYTES) {
      fileError('This file is ' + formatBytes(file.size) + '. The limit is 25 MB.');
      return;
    }
    const myLoad = ++state.loadSeq;
    let type;
    try { type = await detectType(file); } catch (_) { type = null; }
    if (!type) {
      fileError('Unsupported or damaged file. Choose a JPG, PNG or WebP image.');
      return;
    }
    let dec;
    try { dec = await decode(file); } catch (_) {
      fileError('This image could not be read. It may be damaged or use an unsupported variant.');
      return;
    }
    if (myLoad !== state.loadSeq) { dec.close(); return; }
    if (!dec.w || !dec.h) { dec.close(); fileError('This image has no readable dimensions.'); return; }
    if (dec.w * dec.h > MAX_PIXELS) {
      dec.close();
      fileError('This image is ' + formatNumber(dec.w) + ' × ' + formatNumber(dec.h) +
        ' px, which is too large for a browser to process safely (limit: 40 megapixels).');
      return;
    }

    releaseImage();
    hideResult(resultPanel);
    state.file = file; state.type = type; state.bytes = file.size;
    state.w = dec.w; state.h = dec.h; state.decoded = dec; state.tracked = false;
    state.origUrl = URL.createObjectURL(file);

    beforeImg.src = state.origUrl;
    fileNameEl.textContent = file.name;                       // textContent: no HTML injection
    fileMetaEl.textContent = TYPE_LABEL[type] + ' · ' + dec.w + ' × ' + dec.h + ' px · ' + formatBytes(file.size) +
      (extraCount > 1 ? ' · Only the first image was used.' : '');
    fileInfo.hidden = false;

    settings.disabled = false;
    formatEl.value = (type === 'image/webp' && !WEBP_OK) ? 'image/jpeg' : 'original';
    qualityEl.value = 80;
    qualityOut.textContent = '80';
    widthEl.value = dec.w;
    heightEl.value = dec.h;
    updateFormatUi();

    cmpBox.style.aspectRatio = dec.w + ' / ' + dec.h;
    cmpRange.value = 50;
    setCmp(50);
    cmpPlaceholder.hidden = true;
    cmpWrap.hidden = false;
    schedule(0);
  }

  /* ---------- Compression ---------- */
  function readSettings() {
    clearAllErrors(settings);
    let ok = true;
    const w = parseNum(widthEl.value);
    const h = parseNum(heightEl.value);
    if (!Number.isInteger(w) || w < 1) {
      showError(widthEl, 'Enter a whole number of pixels, 1 or more.'); ok = false;
    } else if (w > state.w) {
      showError(widthEl, 'Width cannot be larger than the original (' + state.w + ' px).'); ok = false;
    }
    if (!Number.isInteger(h) || h < 1) {
      showError(heightEl, 'Enter a whole number of pixels, 1 or more.'); ok = false;
    } else if (h > state.h) {
      showError(heightEl, 'Height cannot be larger than the original (' + state.h + ' px).'); ok = false;
    }
    if (!ok) return null;
    return { w, h, mime: resolveMime(), quality: Number(qualityEl.value) / 100, bg: bgEl.value };
  }

  function schedule(delay) {
    clearTimeout(state.timer);
    state.timer = setTimeout(runCompress, delay);
  }

  async function runCompress() {
    if (!state.decoded) return;
    const p = readSettings();
    if (!p) { downloadBtn.disabled = true; hideResult(resultPanel); return; }

    const mySeq = ++state.seq;
    setBusy(true);
    try {
      const blob = await encode(state.decoded.src, p.w, p.h, p.mime, p.quality, p.bg);
      if (mySeq !== state.seq) return;                      // a newer request superseded this one
      if (blob.type !== p.mime) throw new Error('unsupported');

      const prevUrl = state.outUrl;
      state.outBlob = blob;
      state.outUrl = URL.createObjectURL(blob);
      afterImg.src = state.outUrl;
      if (prevUrl) URL.revokeObjectURL(prevUrl);

      const diff = state.bytes - blob.size;
      const pct = Math.abs(diff) / state.bytes * 100;
      const smaller = diff > 0;
      const verdict = diff === 0 ? 'no size change'
        : formatNumber(pct, 1) + '% ' + (smaller ? 'smaller' : 'larger');
      const warn = smaller ? '' :
        '<p class="result-warning" role="note"><strong>Compression was not effective at these settings.</strong> ' +
        'The new file is not smaller than the original. Try a lower quality, smaller dimensions, or WebP/JPEG output. ' +
        'At these settings the original file is the better choice.</p>';

      showResult(resultPanel,
        '<p class="result-label">Compression result</p>' +
        '<p class="result-value compact">' + formatBytes(state.bytes) + ' → ' + formatBytes(blob.size) + ' (' + verdict + ')</p>' +
        '<dl class="stat-grid">' +
          '<div class="stat"><dt>Original</dt><dd>' + formatBytes(state.bytes) + '</dd></div>' +
          '<div class="stat"><dt>Compressed</dt><dd>' + formatBytes(blob.size) + '</dd></div>' +
          '<div class="stat"><dt>' + (smaller ? 'Saved' : 'Change') + '</dt><dd>' + (smaller ? '' : '+') + formatNumber(pct, 1) + '%</dd></div>' +
        '</dl>' +
        '<p class="result-meta">Output: ' + TYPE_LABEL[p.mime] + ' · ' + p.w + ' × ' + p.h + ' px</p>' + warn);

      downloadBtn.disabled = false;
      setBusy(false);
      if (!state.tracked) { state.tracked = true; trackEvent(CALC_NAME, 'image_compress'); }
    } catch (err) {
      if (mySeq !== state.seq) return;
      setBusy(false);
      downloadBtn.disabled = true;
      hideResult(resultPanel);
      fileError(err && err.message === 'unsupported'
        ? 'This browser cannot create ' + TYPE_LABEL[p.mime] + ' files. Choose a different output format.'
        : 'The image could not be compressed. It may be too large for this browser. Try a smaller width and height.');
    }
  }

  /* ---------- Events ---------- */
  fileInput.addEventListener('change', () => {
    const files = fileInput.files;
    handleFile(files && files[0], files ? files.length : 0);
    fileInput.value = '';                                   // allow re-selecting the same file
  });

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  ['dragenter', 'dragover'].forEach((t) => dropzone.addEventListener(t, (e) => {
    e.preventDefault(); dropzone.classList.add('is-drag');
  }));
  ['dragleave', 'dragend'].forEach((t) => dropzone.addEventListener(t, () => dropzone.classList.remove('is-drag')));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('is-drag');
    const files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length) handleFile(files[0], files.length);
  });
  // Stop the browser from navigating away if a file is dropped outside the drop zone.
  ['dragover', 'drop'].forEach((t) => window.addEventListener(t, (e) => {
    if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') !== -1) e.preventDefault();
  }));

  formatEl.addEventListener('change', () => { updateFormatUi(); schedule(150); });
  bgEl.addEventListener('input', () => schedule(DEBOUNCE_MS));
  qualityEl.addEventListener('input', () => { qualityOut.textContent = qualityEl.value; schedule(DEBOUNCE_MS); });

  widthEl.addEventListener('input', () => {
    if (lockEl.checked) {
      const w = parseNum(widthEl.value);
      if (Number.isFinite(w) && w > 0) heightEl.value = Math.max(1, Math.round(w * state.h / state.w));
    }
    schedule(DEBOUNCE_MS);
  });
  heightEl.addEventListener('input', () => {
    if (lockEl.checked) {
      const h = parseNum(heightEl.value);
      if (Number.isFinite(h) && h > 0) widthEl.value = Math.max(1, Math.round(h * state.w / state.h));
    }
    schedule(DEBOUNCE_MS);
  });
  lockEl.addEventListener('change', () => {
    if (lockEl.checked && state.decoded) {
      const w = parseNum(widthEl.value);
      if (Number.isFinite(w) && w > 0) heightEl.value = Math.max(1, Math.round(w * state.h / state.w));
      schedule(150);
    }
  });

  document.querySelectorAll('[data-scale]').forEach((btn) => btn.addEventListener('click', () => {
    if (!state.decoded) return;
    const f = Number(btn.getAttribute('data-scale')) / 100;
    widthEl.value = Math.max(1, Math.round(state.w * f));
    heightEl.value = Math.max(1, Math.round(state.h * f));
    schedule(100);
  }));

  cmpRange.addEventListener('input', () => setCmp(cmpRange.value));

  downloadBtn.addEventListener('click', () => {
    if (!state.outUrl) return;
    const a = document.createElement('a');
    a.href = state.outUrl;
    a.download = downloadName();
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    trackEvent(CALC_NAME, 'download');
  });

  resetBtn.addEventListener('click', () => {
    releaseImage();
    state.file = state.type = null;
    state.loadSeq++;
    clearAllErrors(card);
    hideResult(resultPanel);
    setBusy(false);
    fileInfo.hidden = true;
    fileNameEl.textContent = '';
    fileMetaEl.textContent = '';
    formatEl.value = 'original';
    qualityEl.value = 80;
    qualityOut.textContent = '80';
    widthEl.value = '';
    heightEl.value = '';
    lockEl.checked = true;
    bgEl.value = '#ffffff';
    formatNote.textContent = '';
    bgWrap.hidden = true;
    settings.disabled = true;
    downloadBtn.disabled = true;
    cmpWrap.hidden = true;
    cmpPlaceholder.hidden = false;
    trackEvent(CALC_NAME, 'reset');
    dropzone.focus();
  });

  window.addEventListener('pagehide', releaseImage);
})();
