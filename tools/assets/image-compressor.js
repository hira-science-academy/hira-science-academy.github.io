'use strict';

/* ============================================================
   Hira Science Academy — Image Compressor
   Runs entirely in the browser (Canvas API). No uploads, no backend.
   Depends on assets/tools-common.js (ToolsCommon). Does not modify it.

   Modes
   - Manual (default): you choose quality and dimensions.
   - Target size: you choose a maximum file size. The tool searches for the
     highest quality that fits and reduces dimensions only when it must.
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

  /* Target-size mode. 1 KB = 1,024 bytes, matching formatBytes() below. */
  const TARGET_MIN_BYTES = 1024;                  // 1 KB
  const TARGET_MAX_BYTES = 25 * 1024 * 1024;      // 25 MB (same as the upload limit)

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
  const qualityHint = $('quality-hint');
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
  const targetBox = $('target-box');
  const targetChips = targetBox.querySelectorAll('[data-target]');
  const customWrap = $('custom-target');
  const customEl = $('custom-size');
  const customUnit = $('custom-unit');
  const targetNote = $('target-note');

  const QUALITY_HINT_DEFAULT = qualityHint.textContent;
  const TARGET_NOTE_DEFAULT = targetNote.textContent;

  attachCopyButton(resultPanel, CALC_NAME);

  const state = {
    file: null, type: null, bytes: 0, w: 0, h: 0,
    decoded: null, origUrl: null, outUrl: null, outBlob: null,
    seq: 0, loadSeq: 0, timer: null, tracked: false,
    targetKey: 'off', targetTracked: false
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

  /* Short label for a target, e.g. 102400 -> "100 KB", 1048576 -> "1 MB". */
  function targetLabel(bytes) {
    const trim = (n) => String(Math.round(n * 100) / 100);
    const kb = bytes / 1024;
    return kb >= 1024 ? trim(kb / 1024) + ' MB' : trim(kb) + ' KB';
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

  /* Canvas helpers. Drawing and encoding are separate so the target-size search
     can draw once per size and encode several times at different qualities. */
  function drawCanvas(src, w, h, mime, bg) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas');
    if (mime === 'image/jpeg') {            // JPEG has no alpha channel
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, w, h);
    return canvas;
  }

  function canvasToBlob(canvas, mime, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => { blob ? resolve(blob) : reject(new Error('encode')); },
        mime, mime === 'image/png' ? undefined : quality);
    });
  }

  function freeCanvas(canvas) { canvas.width = 0; canvas.height = 0; }   // release memory (Safari)

  async function encode(src, w, h, mime, quality, bg) {
    const canvas = drawCanvas(src, w, h, mime, bg);
    try { return await canvasToBlob(canvas, mime, quality); }
    finally { freeCanvas(canvas); }
  }

  /* >>> fitToTarget (self-contained; tested separately from the DOM) */
  const TARGET_Q_MAX = 95;          // highest quality tried (percent)
  const TARGET_Q_PREFERRED = 50;    // reduce dimensions before going below this quality
  const TARGET_Q_ABSOLUTE = 10;     // last-resort quality, used only at the smallest allowed size
  const TARGET_MIN_SIDE = 64;       // never shrink the shorter side below this (px)
  const TARGET_MAX_ENCODES = 24;    // hard cap so the browser is never kept busy for long
  const TARGET_MAX_STEPS = 10;      // hard cap on how many different sizes are tried
  const STALE = { stale: true };

  /* Finds the best result at or below `target` bytes.
     o.w / o.h        starting size in pixels (never enlarged)
     o.mime           output type; PNG is lossless, so only dimensions can change
     o.render(w, h)   returns a drawing handle for that size (may be async)
     o.encode(handle, qualityPercent) returns a Promise<Blob>
     o.dispose(handle) frees the handle
     o.isStale()      true when a newer request has replaced this one
     Resolves to { blob, w, h, q, reached, encodes }, or null if it became stale.
     When the target cannot be reached, `blob` is the smallest result produced. */
  async function fitToTarget(o) {
    const T = o.target;
    const lossless = o.mime === 'image/png';
    const minScale = Math.min(1, TARGET_MIN_SIDE / Math.min(o.w, o.h));
    const dims = (s) => ({ w: Math.max(1, Math.round(o.w * s)), h: Math.max(1, Math.round(o.h * s)) });
    let encodes = 0;
    let best = null;       // best result that fits the target
    let smallest = null;   // smallest result of any kind (the "closest" fallback)

    async function attempt(handle, d, q) {
      if (o.isStale()) throw STALE;
      if (encodes >= TARGET_MAX_ENCODES) return null;
      encodes++;
      const blob = await o.encode(handle, q);
      if (o.isStale()) throw STALE;
      const r = { blob, w: d.w, h: d.h, q: lossless ? null : q };
      if (!smallest || blob.size < smallest.blob.size) smallest = r;
      return r;
    }

    async function withCanvas(d, fn) {
      if (o.isStale()) throw STALE;
      const handle = await o.render(d.w, d.h);
      try { return await fn(handle); }
      finally { o.dispose(handle); }
    }

    /* Largest quality in (lo, hi) that fits, assuming `lo` already fits. */
    async function raiseQuality(handle, d, lo, hi) {
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        const r = await attempt(handle, d, mid);
        if (!r) return;
        if (r.blob.size <= T) { best = r; lo = mid; } else { hi = mid; }
      }
    }

    try {
      if (!lossless) {
        let s = 1;
        let measured = 0;
        for (let step = 0; step < TARGET_MAX_STEPS && !best; step++) {
          const d = dims(s);
          const verdict = await withCanvas(d, async (handle) => {
            if (step === 0) {                                   // already small enough at top quality?
              const top = await attempt(handle, d, TARGET_Q_MAX);
              if (!top) return 'limit';
              if (top.blob.size <= T) { best = top; return 'fit'; }
            }
            const low = await attempt(handle, d, TARGET_Q_PREFERRED);
            if (!low) return 'limit';
            if (low.blob.size <= T) {
              best = low;
              await raiseQuality(handle, d, TARGET_Q_PREFERRED, step === 0 ? TARGET_Q_MAX : TARGET_Q_MAX + 1);
              return 'fit';
            }
            if (s <= minScale + 1e-9) {                         // smallest allowed size: last resort
              const floor = await attempt(handle, d, TARGET_Q_ABSOLUTE);
              if (!floor) return 'limit';
              if (floor.blob.size <= T) {
                best = floor;
                await raiseQuality(handle, d, TARGET_Q_ABSOLUTE, TARGET_Q_PREFERRED);
                return 'fit';
              }
              return 'fail';
            }
            measured = low.blob.size;
            return 'shrink';
          });
          if (verdict !== 'shrink') break;
          // File size grows roughly with pixel count, so aim a little below the target.
          const ratio = Math.sqrt(T / measured) * 0.95;
          s = Math.max(minScale, s * Math.min(0.9, ratio));
        }
      } else {
        const d1 = dims(1);
        const first = await withCanvas(d1, (handle) => attempt(handle, d1, null));
        if (first && first.blob.size <= T) {
          best = first;
        } else if (first && minScale < 1) {
          let lo = minScale, hi = 1;
          let probe = Math.max(minScale, Math.min(0.95, Math.sqrt(T / first.blob.size) * 0.95));
          let lastKey = '';
          for (let i = 0; i < 8 && hi - lo > 0.01; i++) {
            const d = dims(probe);
            const key = d.w + 'x' + d.h;
            if (key !== lastKey) {
              lastKey = key;
              const r = await withCanvas(d, (handle) => attempt(handle, d, null));
              if (!r) break;
              if (r.blob.size <= T) { best = r; lo = probe; } else { hi = probe; }
            }
            probe = (lo + hi) / 2;
          }
          if (!best) {                                          // try the smallest allowed size once
            const dm = dims(minScale);
            const r = await withCanvas(dm, (handle) => attempt(handle, dm, null));
            if (r && r.blob.size <= T) best = r;
          }
        }
      }
    } catch (err) {
      if (err === STALE) return null;
      throw err;
    }

    const out = best || smallest;
    return { blob: out.blob, w: out.w, h: out.h, q: out.q, reached: !!best, encodes };
  }
  /* <<< fitToTarget */

  function resolveMime() {
    return formatEl.value === 'original' ? state.type : formatEl.value;
  }

  function downloadName() {
    const raw = state.file ? state.file.name.replace(/\.[^.]*$/, '') : 'image';
    const base = raw.replace(/[^\p{L}\p{N}_\- ]+/gu, '').trim().slice(0, 80) || 'image';
    return base + '-compressed.' + TYPE_EXT[resolveMime()];
  }

  /* ---------- Target-size input ---------- */
  /* Pure: reads the target controls without touching the page. */
  function targetFromUi() {
    if (state.targetKey === 'off') return { on: false };
    if (state.targetKey !== 'custom') return { on: true, bytes: Number(state.targetKey) * 1024 };
    if (!customEl.value.trim()) return { on: true, pending: true };
    const v = parseNum(customEl.value);
    if (!Number.isFinite(v) || v <= 0) return { on: true, error: 'Enter a size greater than zero, for example 150.' };
    const bytes = Math.round(v * (customUnit.value === 'mb' ? 1024 * 1024 : 1024));
    if (bytes < TARGET_MIN_BYTES || bytes > TARGET_MAX_BYTES) {
      return { on: true, error: 'Choose a size between 1 KB and 25 MB.' };
    }
    return { on: true, bytes };
  }

  /* Validates and returns the target, or null when compression should not run. */
  function readTarget() {
    clearAllErrors(targetBox);
    const t = targetFromUi();
    if (t.error) { showError(customEl, t.error); return null; }
    if (t.pending) return null;
    return t;
  }

  function setTarget(key) {
    state.targetKey = key;
    targetChips.forEach((b) => b.setAttribute('aria-pressed', String(b.getAttribute('data-target') === key)));
    customWrap.hidden = key !== 'custom';
    clearAllErrors(targetBox);
    updateFormatUi();
    if (state.decoded) schedule(100);
    if (key === 'custom') customEl.focus();
  }

  /* ---------- UI state ---------- */
  function setBusy(on, message) {
    busyEl.textContent = message || 'Compressing…';
    busyEl.hidden = !on;
    resultPanel.setAttribute('aria-busy', on ? 'true' : 'false');
  }

  function updateFormatUi() {
    const targetOn = state.targetKey !== 'off';
    const mime = state.type ? resolveMime() : null;
    const hasAlphaSource = state.type === 'image/png' || state.type === 'image/webp';

    if (mime) {
      qualityEl.disabled = mime === 'image/png' || targetOn;
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

    qualityHint.textContent = (targetOn && mime !== 'image/png')
      ? 'A target size is set, so quality is chosen automatically. Select “No target” to set it yourself.'
      : QUALITY_HINT_DEFAULT;

    let text = TARGET_NOTE_DEFAULT;
    if (targetOn) {
      const t = targetFromUi();
      const label = t.bytes ? targetLabel(t.bytes) : 'your target size';
      if (!state.type) text = 'Target set: ' + label + '. Choose an image and it will be compressed to fit where possible.';
      else if (mime === 'image/png') text = 'PNG is lossless, so this target can only be reached by reducing the dimensions. Choose WebP or JPEG to keep more of the original size.';
      else text = 'The compressor picks the highest quality that fits and reduces the dimensions only if needed. Width and height act as maximum sizes.';
    }
    targetNote.textContent = text;
  }

  function setCmp(v) {
    afterImg.style.clipPath = 'inset(0 0 0 ' + Number(v) + '%)';
    divider.style.left = Number(v) + '%';
  }

  function releaseImage() {
    clearTimeout(state.timer);
    state.seq++;                                  // also cancels any target-size search in progress
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
    state.w = dec.w; state.h = dec.h; state.decoded = dec; state.tracked = false; state.targetTracked = false;
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
    updateFormatUi();                                         // keeps any target the person chose earlier

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

  /* Result text that only applies when a target size was requested. */
  function targetResultHtml(t, fit, p) {
    const label = targetLabel(t.bytes);
    const size = formatBytes(fit.blob.size);
    const lossless = p.mime === 'image/png';
    let html = '';
    if (state.bytes <= t.bytes) {
      html += '<p class="result-meta"><strong>Your original file (' + formatBytes(state.bytes) +
        ') is already within ' + label + '.</strong> It does not need compressing for this limit, so keep using the original if the quality matters.</p>';
    }
    if (fit.reached) {
      html += '<p class="result-meta"><strong>Target reached:</strong> ' + size + ' is at or below ' + label + '.' +
        (lossless ? '' : ' Quality was set to ' + fit.q + '% automatically.') + '</p>';
      if (fit.w < p.w || fit.h < p.h) {
        html += '<p class="result-meta">The dimensions were reduced from ' + p.w + ' × ' + p.h + ' px to ' +
          fit.w + ' × ' + fit.h + ' px to reach the target.</p>';
      }
    } else {
      html += '<p class="result-warning" role="note"><strong>The ' + label + ' target could not be reached.</strong> ' +
        'The closest result is ' + size + ', which is still above the target, but you can download it. ' +
        (lossless
          ? 'PNG is lossless, so only a smaller image can reduce its size. Choose WebP or JPEG, or pick a larger target.'
          : 'The tool keeps the shorter side at ' + TARGET_MIN_SIDE + ' px or more and the quality at ' + TARGET_Q_ABSOLUTE +
            '% or more. Pick a larger target, or start from a larger maximum width and height.') + '</p>';
    }
    return html;
  }

  async function runCompress() {
    if (!state.decoded) return;
    const p = readSettings();
    if (!p) { downloadBtn.disabled = true; hideResult(resultPanel); return; }
    const t = readTarget();
    if (!t) { downloadBtn.disabled = true; hideResult(resultPanel); return; }

    const mySeq = ++state.seq;
    setBusy(true, t.on ? 'Finding the best fit for ' + targetLabel(t.bytes) + '…' : 'Compressing…');
    try {
      let blob, outW = p.w, outH = p.h, fit = null;
      if (t.on) {
        const src = state.decoded.src;
        fit = await fitToTarget({
          w: p.w, h: p.h, mime: p.mime, target: t.bytes,
          render: (w, h) => drawCanvas(src, w, h, p.mime, p.bg),
          encode: async (canvas, qualityPercent) => {
            const b = await canvasToBlob(canvas, p.mime, qualityPercent / 100);
            if (b.type !== p.mime) throw new Error('unsupported');
            return b;
          },
          dispose: freeCanvas,
          isStale: () => mySeq !== state.seq
        });
        if (!fit || mySeq !== state.seq) return;              // a newer request superseded this one
        blob = fit.blob; outW = fit.w; outH = fit.h;
        if (fit.q != null) { qualityEl.value = fit.q; qualityOut.textContent = String(fit.q); }
      } else {
        blob = await encode(state.decoded.src, p.w, p.h, p.mime, p.quality, p.bg);
        if (mySeq !== state.seq) return;                      // a newer request superseded this one
        if (blob.type !== p.mime) throw new Error('unsupported');
      }

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
      const originalWithinTarget = t.on && state.bytes <= t.bytes;
      const warn = (smaller || originalWithinTarget) ? '' :
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
        '<p class="result-meta">Output: ' + TYPE_LABEL[p.mime] + ' · ' + outW + ' × ' + outH + ' px</p>' +
        (fit ? targetResultHtml(t, fit, p) : '') + warn);

      downloadBtn.disabled = false;
      setBusy(false);
      if (!state.tracked) { state.tracked = true; trackEvent(CALC_NAME, 'image_compress'); }
      if (t.on && !state.targetTracked) { state.targetTracked = true; trackEvent(CALC_NAME, 'target_size'); }
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

  targetChips.forEach((btn) => btn.addEventListener('click', () => setTarget(btn.getAttribute('data-target'))));
  customEl.addEventListener('input', () => { updateFormatUi(); if (state.decoded) schedule(DEBOUNCE_MS); });
  customUnit.addEventListener('change', () => { updateFormatUi(); if (state.decoded) schedule(150); });

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
    customEl.value = '';
    customUnit.value = 'kb';
    setTarget('off');
    if (state.decoded === null) qualityEl.disabled = false;
    trackEvent(CALC_NAME, 'reset');
    dropzone.focus();
  });

  window.addEventListener('pagehide', releaseImage);
})();
