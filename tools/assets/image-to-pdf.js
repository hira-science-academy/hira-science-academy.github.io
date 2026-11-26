'use strict';

/* ============================================================
   Hira Science Academy — Image to PDF Converter
   Runs entirely in the browser. No uploads, no backend, no libraries.
   Depends on assets/tools-common.js (ToolsCommon). Does not modify it.

   How it works
   - JPEG files are embedded as-is (DCTDecode): no quality loss, very fast.
   - PNG / WebP are embedded losslessly (Flate-compressed RGB + alpha mask),
     or re-encoded as JPEG when the person asks for a smaller file.
   - A small PDF 1.4 writer builds the file; one image per page.
   ============================================================ */
(function () {

  if (typeof ToolsCommon === 'undefined') {
    const e = document.getElementById('file-error');
    if (e) { e.textContent = 'The shared tools script did not load. Please refresh the page.'; e.classList.add('is-visible'); }
    return;
  }

  const { trackEvent, formatNumber, showResult, hideResult } = ToolsCommon;

  const CALC_NAME = 'image-to-pdf';
  const MAX_FILES = 100;
  const MAX_FILE_BYTES = 50 * 1024 * 1024;     // 50 MB per image
  const MAX_PIXELS = 60e6;                      // refuse to decode anything larger
  const RAW_MAX_PIXELS = 25e6;                  // above this, lossless embedding falls back to JPEG
  const MAX_PDF_UNITS = 14400;                  // PDF 1.4 page-size limit
  const TYPE_LABEL = { 'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/webp': 'WebP' };

  const PAGE_SIZES = {
    a4: [595.276, 841.89], a3: [841.89, 1190.551], a5: [419.528, 595.276],
    letter: [612, 792], legal: [612, 1008]
  };
  const MARGINS = { none: 0, small: 28.35, medium: 56.69 };   // 0, 10 mm, 20 mm

  const $ = (id) => document.getElementById(id);
  const dropzone = $('dropzone');
  const fileInput = $('file-input');
  const fileErr = $('file-error');
  const listWrap = $('list-wrap');
  const listEl = $('file-list');
  const countLine = $('count-line');
  const sortBtn = $('sort-btn');
  const clearBtn = $('clear-btn');
  const settings = $('settings');
  const pageSizeEl = $('page-size');
  const orientEl = $('orientation');
  const marginEl = $('margin');
  const qualityEl = $('quality');
  const qualityNote = $('quality-note');
  const nameEl = $('pdf-name');
  const createBtn = $('create-btn');
  const busyEl = $('busy');
  const resultPanel = $('result-panel');

  const state = { items: [], nextId: 1, busy: false, pdfUrl: null, pdfName: 'images.pdf' };

  const HAS_DEFLATE = typeof CompressionStream === 'function' && typeof Blob !== 'undefined' && !!Blob.prototype.stream;

  /* ---------- Small helpers ---------- */
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const fnum = (n) => String(Math.round(n * 1000) / 1000);

  function formatBytes(n) {
    if (n < 1024) return n + ' B';
    const kb = n / 1024;
    if (kb < 1024) return formatNumber(kb, kb < 10 ? 2 : 1) + ' KB';
    return formatNumber(kb / 1024, 2) + ' MB';
  }

  function showFileError(msg) { fileErr.textContent = msg; fileErr.classList.add('is-visible'); }
  function clearFileError() { fileErr.textContent = ''; fileErr.classList.remove('is-visible'); }

  function setBusy(on, message) {
    busyEl.textContent = message || 'Creating PDF…';
    busyEl.hidden = !on;
    resultPanel.setAttribute('aria-busy', on ? 'true' : 'false');
    createBtn.disabled = on || state.items.length === 0;
    state.busy = on;
  }

  function ascii(buf, start, len) {
    let s = '';
    for (let i = start; i < start + len; i++) s += String.fromCharCode(buf[i]);
    return s;
  }

  /* Real type from the file signature, not the extension. */
  async function detectType(file) {
    const buf = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    if (buf.length >= 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
    const png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    if (buf.length >= 8 && png.every((b, i) => buf[i] === b)) return 'image/png';
    if (buf.length >= 12 && ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 4) === 'WEBP') return 'image/webp';
    return null;
  }

  /* ---------- JPEG header parsing (size, components, EXIF orientation) ---------- */
  function exifOrientation(buf, i, segEnd) {
    // buf[i..] is the start of an APP1 segment: FF E1 len len 'Exif\0\0' TIFF...
    if (ascii(buf, i + 4, 4) !== 'Exif') return 1;
    const t = i + 10;
    const le = ascii(buf, t, 2) === 'II';
    const r16 = (o) => le ? (buf[o] | (buf[o + 1] << 8)) : ((buf[o] << 8) | buf[o + 1]);
    const r32 = (o) => le
      ? (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0
      : ((buf[o] << 24) | (buf[o + 1] << 16) | (buf[o + 2] << 8) | buf[o + 3]) >>> 0;
    const ifd = t + r32(t + 4);
    if (ifd + 2 > segEnd) return 1;
    const n = r16(ifd);
    for (let k = 0; k < n; k++) {
      const e = ifd + 2 + k * 12;
      if (e + 12 > segEnd) break;
      if (r16(e) === 0x0112) return r16(e + 8) || 1;
    }
    return 1;
  }

  function parseJpeg(buf) {
    const out = { w: 0, h: 0, comps: 0, bits: 8, orient: 1, arithmetic: false };
    let i = 2;
    while (i + 4 < buf.length) {
      if (buf[i] !== 0xFF) { i++; continue; }
      const m = buf[i + 1];
      if (m === 0xFF) { i++; continue; }
      if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }
      const len = (buf[i + 2] << 8) | buf[i + 3];
      if (m === 0xE1 && out.orient === 1) { try { out.orient = exifOrientation(buf, i, i + 2 + len); } catch (_) {} }
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
        out.bits = buf[i + 4];
        out.h = (buf[i + 5] << 8) | buf[i + 6];
        out.w = (buf[i + 7] << 8) | buf[i + 8];
        out.comps = buf[i + 9];
        out.arithmetic = m >= 0xC9;
        return out;
      }
      if (m === 0xDA) break;
      i += 2 + len;
    }
    return null;
  }

  /* ---------- Decoding and canvas helpers ---------- */
  async function loadBitmap(file) {
    if (typeof createImageBitmap === 'function') {
      for (const opts of [{ imageOrientation: 'from-image' }, undefined]) {
        try {
          const bmp = opts ? await createImageBitmap(file, opts) : await createImageBitmap(file);
          return { src: bmp, w: bmp.width, h: bmp.height, close: () => { try { bmp.close(); } catch (_) {} } };
        } catch (_) { /* try next strategy */ }
      }
    }
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve({ src: img, w: img.naturalWidth, h: img.naturalHeight, close: () => URL.revokeObjectURL(url) });
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }

  function drawRotated(dec, rot, whiteBg) {
    const swap = rot === 90 || rot === 270;
    const cw = swap ? dec.h : dec.w, ch = swap ? dec.w : dec.h;
    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas');
    if (whiteBg) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cw, ch); }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(cw / 2, ch / 2);
    ctx.rotate(rot * Math.PI / 180);
    ctx.drawImage(dec.src, -dec.w / 2, -dec.h / 2);
    return { canvas, ctx, w: cw, h: ch };
  }

  function freeCanvas(c) { c.width = 0; c.height = 0; }

  function canvasToJpeg(canvas, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(async (blob) => {
        if (!blob) { reject(new Error('encode')); return; }
        resolve(new Uint8Array(await blob.arrayBuffer()));
      }, 'image/jpeg', quality);
    });
  }

  async function deflate(u8) {
    const stream = new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /* Turns one list item into image data a PDF page can embed.
     Returns { w, h, cs, filter, data, smask? } */
  async function prepare(item, qualityKey) {
    const original = qualityKey === 'original';

    // 1. JPEG, untouched: embed the file bytes directly.
    if (original && item.type === 'image/jpeg' && !item.rot) {
      const buf = new Uint8Array(await item.file.arrayBuffer());
      const info = parseJpeg(buf);
      if (info && (info.comps === 1 || info.comps === 3) && info.bits === 8 && info.orient <= 1 && !info.arithmetic && info.w && info.h) {
        return { w: info.w, h: info.h, cs: info.comps === 1 ? 'DeviceGray' : 'DeviceRGB', filter: 'DCTDecode', data: buf };
      }
    }

    const dec = await loadBitmap(item.file);
    try {
      if (!dec.w || !dec.h) throw new Error('size');
      if (dec.w * dec.h > MAX_PIXELS) throw new Error('large');
      const rot = item.rot || 0;

      // 2. PNG / WebP kept lossless (RGB + alpha mask, Flate-compressed).
      if (original && item.type !== 'image/jpeg' && HAS_DEFLATE && dec.w * dec.h <= RAW_MAX_PIXELS) {
        const { canvas, ctx, w, h } = drawRotated(dec, rot, false);
        const px = ctx.getImageData(0, 0, w, h).data;
        freeCanvas(canvas);
        const n = w * h;
        const rgb = new Uint8Array(n * 3);
        const alpha = new Uint8Array(n);
        let hasAlpha = false;
        for (let i = 0, p = 0, a = 0; i < n; i++, p += 4, a += 3) {
          rgb[a] = px[p]; rgb[a + 1] = px[p + 1]; rgb[a + 2] = px[p + 2];
          const al = px[p + 3];
          alpha[i] = al;
          if (al !== 255) hasAlpha = true;
        }
        const out = { w, h, cs: 'DeviceRGB', filter: 'FlateDecode', data: await deflate(rgb) };
        if (hasAlpha) out.smask = { data: await deflate(alpha) };
        return out;
      }

      // 3. Everything else: draw on white and encode as JPEG.
      const q = original ? 0.95 : parseFloat(qualityKey);
      const { canvas, w, h } = drawRotated(dec, rot, true);
      try {
        const data = await canvasToJpeg(canvas, q);
        return { w, h, cs: 'DeviceRGB', filter: 'DCTDecode', data };
      } finally { freeCanvas(canvas); }
    } finally { dec.close(); }
  }

  /* ---------- Page layout ---------- */
  function layout(img, sizeKey, orient, margin) {
    let pw, ph, dw, dh, x, y;
    if (sizeKey === 'fit') {
      let w = img.w * 0.75, h = img.h * 0.75;           // 96 dpi pixels -> points
      const longest = Math.max(w, h) + 2 * margin;
      if (longest > MAX_PDF_UNITS) {
        const k = (MAX_PDF_UNITS - 2 * margin) / Math.max(w, h);
        w *= k; h *= k;
      }
      pw = w + 2 * margin; ph = h + 2 * margin;
      dw = w; dh = h; x = margin; y = margin;
    } else {
      [pw, ph] = PAGE_SIZES[sizeKey];
      const landscape = orient === 'landscape' || (orient === 'auto' && img.w > img.h);
      if (landscape) [pw, ph] = [ph, pw];
      const k = Math.min((pw - 2 * margin) / img.w, (ph - 2 * margin) / img.h);
      dw = img.w * k; dh = img.h * k;
      x = (pw - dw) / 2; y = (ph - dh) / 2;
    }
    return { img, pw, ph, dw, dh, x, y };
  }

  /* ---------- PDF 1.4 writer ---------- */
  function buildPdf(pages) {
    const enc = new TextEncoder();
    const objs = [];
    let next = 3;
    const kids = [];

    pages.forEach((p) => {
      const pageId = next++, contentId = next++, imgId = next++;
      const smId = p.img.smask ? next++ : null;
      kids.push(pageId + ' 0 R');
      const content = 'q ' + fnum(p.dw) + ' 0 0 ' + fnum(p.dh) + ' ' + fnum(p.x) + ' ' + fnum(p.y) + ' cm /Im0 Do Q';
      objs[pageId] = { dict: '/Type /Page /Parent 2 0 R /MediaBox [0 0 ' + fnum(p.pw) + ' ' + fnum(p.ph) + '] ' +
        '/Resources << /XObject << /Im0 ' + imgId + ' 0 R >> /ProcSet [/PDF /ImageB /ImageC] >> /Contents ' + contentId + ' 0 R' };
      objs[contentId] = { dict: '', stream: enc.encode(content) };
      objs[imgId] = { dict: '/Type /XObject /Subtype /Image /Width ' + p.img.w + ' /Height ' + p.img.h +
        ' /ColorSpace /' + p.img.cs + ' /BitsPerComponent 8 /Filter /' + p.img.filter +
        (smId ? ' /SMask ' + smId + ' 0 R' : ''), stream: p.img.data };
      if (smId) {
        objs[smId] = { dict: '/Type /XObject /Subtype /Image /Width ' + p.img.w + ' /Height ' + p.img.h +
          ' /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode', stream: p.img.smask.data };
      }
    });

    const infoId = next++;
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = 'D:' + d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) +
      pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';
    objs[1] = { dict: '/Type /Catalog /Pages 2 0 R' };
    objs[2] = { dict: '/Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + pages.length };
    objs[infoId] = { dict: '/Producer (Hira Science Academy Image to PDF) /CreationDate (' + stamp + ')' };

    const parts = [];
    const offs = [];
    let pos = 0;
    const push = (u8) => { parts.push(u8); pos += u8.length; };
    push(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34, 0x0A, 0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));

    for (let id = 1; id < next; id++) {
      const o = objs[id];
      offs[id] = pos;
      push(enc.encode(id + ' 0 obj\n'));
      if (o.stream) {
        push(enc.encode('<< ' + o.dict + ' /Length ' + o.stream.length + ' >>\nstream\n'));
        push(o.stream);
        push(enc.encode('\nendstream\nendobj\n'));
      } else {
        push(enc.encode('<< ' + o.dict + ' >>\nendobj\n'));
      }
    }
    const xpos = pos;
    let x = 'xref\n0 ' + next + '\n0000000000 65535 f \n';
    for (let id = 1; id < next; id++) x += String(offs[id]).padStart(10, '0') + ' 00000 n \n';
    x += 'trailer\n<< /Size ' + next + ' /Root 1 0 R /Info ' + infoId + ' 0 R >>\nstartxref\n' + xpos + '\n%%EOF\n';
    push(enc.encode(x));
    return new Blob(parts, { type: 'application/pdf' });
  }

  /* ---------- File list ---------- */
  async function addFiles(fileList) {
    clearFileError();
    const files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    const problems = [];
    let added = 0;
    for (const file of files) {
      if (state.items.length >= MAX_FILES) { problems.push('Only ' + MAX_FILES + ' images can be added at once.'); break; }
      if (file.size === 0) { problems.push(file.name + ' is empty.'); continue; }
      if (file.size > MAX_FILE_BYTES) { problems.push(file.name + ' is ' + formatBytes(file.size) + ' (limit 50 MB).'); continue; }
      let type = null;
      try { type = await detectType(file); } catch (_) { /* ignore */ }
      if (!type) { problems.push(file.name + ' is not a JPG, PNG or WebP image.'); continue; }
      state.items.push({ id: state.nextId++, file, name: file.name, type, bytes: file.size, rot: 0, w: 0, h: 0, url: URL.createObjectURL(file) });
      added++;
    }
    if (problems.length) {
      const shown = problems.slice(0, 3).join(' ');
      showFileError(shown + (problems.length > 3 ? ' (' + (problems.length - 3) + ' more skipped.)' : ''));
    }
    if (added) { hideResult(resultPanel); trackEvent(CALC_NAME, 'files_added'); }
    render();
    if (added) {
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      requestAnimationFrame(() => listWrap.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'nearest' }));
    }
  }

  function render() {
    listEl.textContent = '';
    state.items.forEach((it, idx) => {
      const li = document.createElement('li');
      li.className = 'file-row';
      li.dataset.id = String(it.id);

      const handle = document.createElement('span');
      handle.className = 'drag-handle';
      handle.setAttribute('aria-hidden', 'true');
      handle.textContent = '⋮⋮';
      enableDrag(handle, li);

      const thumbWrap = document.createElement('span');
      thumbWrap.className = 'thumb';
      const badge = document.createElement('span');
      badge.className = 'pos-badge';
      badge.textContent = String(idx + 1);
      badge.setAttribute('aria-hidden', 'true');
      const img = document.createElement('img');
      img.alt = '';
      img.decoding = 'async';
      img.src = it.url;
      img.style.transform = 'rotate(' + it.rot + 'deg)';
      img.addEventListener('load', () => { it.w = img.naturalWidth; it.h = img.naturalHeight; meta.textContent = metaText(it); });
      img.addEventListener('error', () => { meta.textContent = 'This image could not be previewed. It may be damaged.'; });
      thumbWrap.appendChild(img); thumbWrap.appendChild(badge);

      const info = document.createElement('span');
      info.className = 'file-text';
      const nm = document.createElement('span');
      nm.className = 'file-name';
      nm.textContent = 'Page ' + (idx + 1) + ' · ' + it.name;
      const meta = document.createElement('span');
      meta.className = 'file-meta';
      meta.textContent = metaText(it);
      info.appendChild(nm); info.appendChild(meta);

      const tools = document.createElement('span');
      tools.className = 'row-tools';
      tools.appendChild(rowBtn('↑', 'Move ' + it.name + ' up', () => move(it.id, -1), idx === 0));
      tools.appendChild(rowBtn('↓', 'Move ' + it.name + ' down', () => move(it.id, 1), idx === state.items.length - 1));
      tools.appendChild(rowBtn('⟳', 'Rotate ' + it.name + ' 90 degrees clockwise', () => rotate(it.id), false));
      tools.appendChild(rowBtn('✕', 'Remove ' + it.name, () => remove(it.id), false));

      li.appendChild(handle); li.appendChild(thumbWrap); li.appendChild(info); li.appendChild(tools);
      listEl.appendChild(li);
    });

    const n = state.items.length;
    listWrap.hidden = n === 0;
    settings.disabled = n === 0;
    createBtn.disabled = n === 0 || state.busy;
    countLine.textContent = n === 1 ? '1 image · 1 PDF page' : n + ' images · ' + n + ' PDF pages';
    sortBtn.disabled = n < 2;
  }

  /* Drag to reorder (mouse, pen and touch). Listeners live on the document because the row
     is moved in the DOM while it is dragged. */
  function enableDrag(handle, li) {
    handle.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      li.classList.add('is-dragging');
      listEl.classList.add('is-sorting');
      const onMove = (ev) => {
        const y = ev.clientY;
        if (y < 90) window.scrollBy(0, -16); else if (y > window.innerHeight - 90) window.scrollBy(0, 16);
        let before = null;
        const rows = Array.prototype.filter.call(listEl.children, (r) => r !== li);
        for (let i = 0; i < rows.length; i++) {
          const box = rows[i].getBoundingClientRect();
          if (y < box.top + box.height / 2) { before = rows[i]; break; }
        }
        if (before) { if (li.nextSibling !== before) listEl.insertBefore(li, before); }
        else if (listEl.lastChild !== li) listEl.appendChild(li);
      };
      const onEnd = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onEnd);
        document.removeEventListener('pointercancel', onEnd);
        li.classList.remove('is-dragging');
        listEl.classList.remove('is-sorting');
        commitOrder();
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onEnd);
      document.addEventListener('pointercancel', onEnd);
    });
  }

  function commitOrder() {
    const byId = new Map(state.items.map((it) => [it.id, it]));
    const next = Array.prototype.map.call(listEl.children, (r) => byId.get(Number(r.dataset.id))).filter(Boolean);
    if (next.length === state.items.length && next.some((it, i) => it !== state.items[i])) {
      state.items = next;
      hideResult(resultPanel);
      trackEvent(CALC_NAME, 'reorder');
    }
    render();
  }

  function metaText(it) {
    return TYPE_LABEL[it.type] + (it.w ? ' · ' + it.w + ' × ' + it.h + ' px' : '') + ' · ' + formatBytes(it.bytes) + (it.rot ? ' · rotated ' + it.rot + '°' : '');
  }

  function rowBtn(label, aria, fn, disabled) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'row-btn'; b.textContent = label;
    b.setAttribute('aria-label', aria); b.disabled = !!disabled;
    b.addEventListener('click', fn);
    return b;
  }

  function move(id, dir) {
    const i = state.items.findIndex((x) => x.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= state.items.length) return;
    const t = state.items[i]; state.items[i] = state.items[j]; state.items[j] = t;
    hideResult(resultPanel); render();
  }
  function rotate(id) {
    const it = state.items.find((x) => x.id === id);
    if (!it) return;
    it.rot = (it.rot + 90) % 360;
    hideResult(resultPanel); render();
  }
  function remove(id) {
    const i = state.items.findIndex((x) => x.id === id);
    if (i < 0) return;
    URL.revokeObjectURL(state.items[i].url);
    state.items.splice(i, 1);
    hideResult(resultPanel); clearFileError(); render();
  }
  function clearAll() {
    state.items.forEach((it) => URL.revokeObjectURL(it.url));
    state.items = [];
    if (state.pdfUrl) { URL.revokeObjectURL(state.pdfUrl); state.pdfUrl = null; }
    hideResult(resultPanel); clearFileError(); setBusy(false);
    nameEl.value = 'images';
    render();
  }

  /* ---------- Create the PDF ---------- */
  function safeName() {
    const raw = nameEl.value.replace(/\.pdf$/i, '');
    const base = raw.replace(/[^\p{L}\p{N}_\- ]+/gu, '').trim().slice(0, 80) || 'images';
    return base + '.pdf';
  }

  function updateOptionUi() {
    const fit = pageSizeEl.value === 'fit';
    orientEl.disabled = fit;
    const q = qualityEl.value;
    qualityNote.textContent = q === 'original'
      ? 'JPG files are embedded unchanged. PNG and WebP are kept lossless, including transparency. Files can be large for big PNGs.'
      : 'Images are re-encoded as JPEG to make the PDF smaller. Transparent areas become white.';
  }

  async function createPdf() {
    if (state.busy || !state.items.length) return;
    clearFileError();
    hideResult(resultPanel);
    setBusy(true, 'Preparing…');
    await tick();
    try {
      const sizeKey = pageSizeEl.value, orient = orientEl.value, margin = MARGINS[marginEl.value] || 0, q = qualityEl.value;
      const pages = [];
      let fallbacks = 0;
      for (let i = 0; i < state.items.length; i++) {
        const it = state.items[i];
        setBusy(true, 'Processing image ' + (i + 1) + ' of ' + state.items.length + '…');
        await tick();
        let img;
        try { img = await prepare(it, q); }
        catch (err) {
          const code = err && err.message;
          const why = code === 'large' ? 'is too large to process safely in a browser (limit 60 megapixels).'
            : (code === 'decode' || code === 'size') ? 'could not be read. It may be damaged or use an unsupported variant.'
            : 'could not be processed because the browser ran out of memory. Try fewer or smaller images, or choose a smaller-file quality option.';
          const userErr = new Error(it.name + ' ' + why);
          userErr.userFacing = true;
          throw userErr;
        }
        if (q === 'original' && it.type !== 'image/jpeg' && img.filter === 'DCTDecode') fallbacks++;
        pages.push(layout(img, sizeKey, orient, margin));
      }
      setBusy(true, 'Building PDF…');
      await tick();
      const blob = buildPdf(pages);
      // Create the new URL first; only release the old one once the result is on screen.
      const oldUrl = state.pdfUrl;
      const newUrl = URL.createObjectURL(blob);
      state.pdfUrl = newUrl;
      state.pdfName = safeName();

      const total = state.items.reduce((s, it) => s + it.bytes, 0);
      try {
      showResult(resultPanel,
        '<p class="result-label">PDF ready</p>' +
        '<p class="result-value compact">' + pages.length + (pages.length === 1 ? ' page' : ' pages') + ' · ' + formatBytes(blob.size) + '</p>' +
        '<dl class="stat-grid">' +
          '<div class="stat"><dt>Pages</dt><dd>' + pages.length + '</dd></div>' +
          '<div class="stat"><dt>Images total</dt><dd>' + formatBytes(total) + '</dd></div>' +
          '<div class="stat"><dt>PDF size</dt><dd>' + formatBytes(blob.size) + '</dd></div>' +
        '</dl>' +
        '<p class="result-meta">File name: ' + state.pdfName.replace(/[<>&"]/g, '') + '</p>' +
        (fallbacks ? '<p class="result-meta">' + fallbacks + (fallbacks === 1 ? ' image was' : ' images were') + ' very large, so ' + (fallbacks === 1 ? 'it was' : 'they were') + ' saved as high-quality JPEG to keep the PDF manageable.</p>' : '') +
        (blob.size > total * 3 && blob.size > 5 * 1024 * 1024 ? '<p class="result-warning" role="note"><strong>This PDF is large.</strong> Choose “Smaller file” under Image quality to reduce it.</p>' : '') +
        '<div class="action-row"><button type="button" id="download-btn" class="btn-calc btn-primary-calc">Download PDF</button>' +
        '<a id="open-link" class="btn-calc btn-secondary-calc" style="text-decoration:none" target="_blank" rel="noopener" href="' + state.pdfUrl + '">Open in new tab</a></div>');
      } catch (renderErr) {
        URL.revokeObjectURL(newUrl);
        state.pdfUrl = oldUrl;
        throw renderErr;
      }
      if (oldUrl) URL.revokeObjectURL(oldUrl);
      trackEvent(CALC_NAME, 'create_pdf');
    } catch (err) {
      showFileError(err && err.userFacing ? err.message : 'The PDF could not be created. The browser may have run out of memory. Try fewer or smaller images, or choose a smaller-file quality option.');
    } finally {
      setBusy(false);
    }
  }

  /* ---------- Events ---------- */
  fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; });
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
  ['dragenter', 'dragover'].forEach((t) => dropzone.addEventListener(t, (e) => { e.preventDefault(); dropzone.classList.add('is-drag'); }));
  ['dragleave', 'dragend'].forEach((t) => dropzone.addEventListener(t, () => dropzone.classList.remove('is-drag')));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault(); dropzone.classList.remove('is-drag');
    if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
  });
  ['dragover', 'drop'].forEach((t) => window.addEventListener(t, (e) => {
    if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') !== -1) e.preventDefault();
  }));

  sortBtn.addEventListener('click', () => {
    state.items.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    hideResult(resultPanel); render();
  });
  clearBtn.addEventListener('click', () => { clearAll(); trackEvent(CALC_NAME, 'reset'); dropzone.focus(); });
  createBtn.addEventListener('click', createPdf);
  [pageSizeEl, orientEl, marginEl, qualityEl].forEach((el) => el.addEventListener('change', () => { updateOptionUi(); hideResult(resultPanel); }));

  resultPanel.addEventListener('click', (e) => {
    const btn = e.target.closest ? e.target.closest('#download-btn') : null;
    if (!btn || !state.pdfUrl) return;
    const a = document.createElement('a');
    a.href = state.pdfUrl; a.download = state.pdfName; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    trackEvent(CALC_NAME, 'download');
  });

  window.addEventListener('pagehide', () => {
    state.items.forEach((it) => URL.revokeObjectURL(it.url));
    if (state.pdfUrl) URL.revokeObjectURL(state.pdfUrl);
  });

  updateOptionUi();
  render();
})();
