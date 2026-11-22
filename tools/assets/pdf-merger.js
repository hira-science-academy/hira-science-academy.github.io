'use strict';

/* ============================================================
   Hira Science Academy: PDF Merger
   Combines PDFs and JPG/PNG images into one PDF with pdf-lib, in the
   browser. Nothing is uploaded. Depends on assets/tools-common.js and
   assets/pdf-common.js.
   ============================================================ */
(function () {

  const $ = (id) => document.getElementById(id);
  const fileErr = $('file-error');
  if (typeof PDFTools === 'undefined') {
    if (fileErr) { fileErr.textContent = 'The shared PDF script did not load. Please refresh the page.'; fileErr.classList.add('is-visible'); }
    return;
  }
  const T = PDFTools;
  const TOOL = 'pdf-merger';
  const MAX_FILES = 100;
  const MAX_PDF_BYTES = 300 * 1024 * 1024;
  const MAX_IMG_BYTES = 50 * 1024 * 1024;
  const MAX_TOTAL_BYTES = 600 * 1024 * 1024;
  const MAX_PIXELS = 120e6;                    // refuse absurd images that no browser can decode safely
  const MM = 72 / 25.4;
  const SIZES = { a4: [595.28, 841.89], letter: [612, 792], legal: [612, 1008], a3: [841.89, 1190.55], a5: [419.53, 595.28] };
  const MARGINS = { none: 0, small: 10 * MM, medium: 20 * MM };
  const OPT = { original: null, good: { side: 2400, q: 0.85 }, small: { side: 1600, q: 0.7 } };

  const dropzone = $('dropzone'), fileInput = $('file-input'), addInput = $('add-input');
  const listWrap = $('list-wrap'), list = $('file-list'), countLine = $('count-line');
  const settings = $('settings'), mergeBtn = $('merge-btn'), busyEl = $('busy'), progress = $('progress'), progressBar = $('progress-bar');
  const sizeEl = $('page-size'), orientEl = $('orientation'), marginEl = $('margin'), optEl = $('optimise'), nameEl = $('out-name');
  const resultPanel = $('result-panel'), resultTitle = $('result-title'), resultNote = $('result-note'), dlBtn = $('download-btn'), againBtn = $('again-btn'), cancelBtn = $('cancel-btn');

  const state = { items: [], nextId: 1, running: false, run: 0, adding: 0, outUrl: null, outBlob: null, thumbQueue: T.makeQueue(2) };

  function showError(msg) { fileErr.textContent = msg; fileErr.classList.add('is-visible'); }
  function clearError() { fileErr.textContent = ''; fileErr.classList.remove('is-visible'); }
  function setBusy(on, msg) { busyEl.textContent = msg || 'Working…'; busyEl.hidden = !on; }

  /* ---------- Type detection by file signature, not by name ---------- */
  async function detectKind(file) {
    const h = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
    if (h.length >= 3 && h[0] === 0xFF && h[1] === 0xD8 && h[2] === 0xFF) return 'jpg';
    if (h.length >= 8 && h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4E && h[3] === 0x47) return 'png';
    let s = ''; for (let i = 0; i < h.length; i++) s += String.fromCharCode(h[i]);
    if (s.indexOf('%PDF-') !== -1) return 'pdf';
    if (s.slice(0, 4) === 'RIFF' && s.slice(8, 12) === 'WEBP') return 'webp';
    return '';
  }

  /* EXIF orientation (1-8) of a JPEG; 1 when absent. */
  function jpegOrientation(u8) {
    try {
      let p = 2;
      while (p + 4 < u8.length) {
        if (u8[p] !== 0xFF) return 1;
        const marker = u8[p + 1], len = (u8[p + 2] << 8) | u8[p + 3];
        if (marker === 0xE1 && u8[p + 4] === 0x45 && u8[p + 5] === 0x78 && u8[p + 6] === 0x69 && u8[p + 7] === 0x66) {
          const t = p + 10, le = u8[t] === 0x49;
          const r16 = (o) => le ? (u8[t + o] | (u8[t + o + 1] << 8)) : ((u8[t + o] << 8) | u8[t + o + 1]);
          const r32 = (o) => le ? (u8[t + o] | (u8[t + o + 1] << 8) | (u8[t + o + 2] << 16) | (u8[t + o + 3] << 24)) >>> 0 : ((u8[t + o] << 24) | (u8[t + o + 1] << 16) | (u8[t + o + 2] << 8) | u8[t + o + 3]) >>> 0;
          const ifd = r32(4), n = r16(ifd);
          for (let i = 0; i < n; i++) { const e = ifd + 2 + i * 12; if (r16(e) === 0x0112) { const v = r16(e + 8); return v >= 1 && v <= 8 ? v : 1; } }
          return 1;
        }
        if (marker === 0xDA || marker === 0xD9) return 1;
        p += 2 + len;
      }
    } catch (_) { /* ignore */ }
    return 1;
  }

  function loadImage(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }
  function toBlob(canvas, mime, q) { return new Promise((res, rej) => canvas.toBlob((b) => b ? res(b) : rej(new Error('encode')), mime, q)); }

  /* ---------- Adding files ---------- */
  async function addFiles(fileList) {
    clearError();
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const problems = [];
    let added = 0;
    state.adding++; setBusy(true, 'Checking your files…');
    let total = state.items.reduce((s, i) => s + i.file.size, 0);
    for (const file of files) {
      if (state.items.length >= MAX_FILES) { problems.push('Only ' + MAX_FILES + ' files can be merged at once. The rest were not added.'); break; }
      const label = '“' + file.name + '”';
      try {
        if (file.size === 0) { problems.push(label + ' is empty.'); continue; }
        if (total + file.size > MAX_TOTAL_BYTES) { problems.push(label + ' was not added: the files together would be over ' + T.formatBytes(MAX_TOTAL_BYTES) + ', which is more than most browsers can hold in memory.'); continue; }
        const kind = await detectKind(file);
        if (!kind) { problems.push(label + ' is not a PDF, JPG or PNG file.'); continue; }
        if (kind === 'webp') { problems.push(label + ' is a WebP image. Only PDF, JPG and PNG are supported here. Convert it to JPG or PNG first.'); continue; }
        const item = { id: state.nextId++, file, kind, pages: 0, w: 0, h: 0, orient: 1, thumbUrl: null };
        if (kind === 'pdf') {
          if (file.size > MAX_PDF_BYTES) { problems.push(label + ' is ' + T.formatBytes(file.size) + '. PDFs over 300 MB are too large for the browser.'); continue; }
          const res = await T.openPdf(await T.readBytes(file));
          if (res.error) { problems.push(label + ': ' + T.OPEN_ERRORS[res.error]); continue; }
          item.pages = res.pages;
        } else {
          if (file.size > MAX_IMG_BYTES) { problems.push(label + ' is ' + T.formatBytes(file.size) + '. Images over 50 MB are too large.'); continue; }
          let img;
          try { img = await loadImage(file); } catch (_) { problems.push(label + ' could not be read as an image. It may be damaged.'); continue; }
          if (img.naturalWidth * img.naturalHeight > MAX_PIXELS) { problems.push(label + ' has too many pixels (' + img.naturalWidth + ' × ' + img.naturalHeight + ') for the browser to process safely.'); continue; }
          item.w = img.naturalWidth; item.h = img.naturalHeight;
          item.thumbUrl = await makeImageThumb(img);
        }
        total += file.size;
        state.items.push(item); added++;
        if (kind === 'pdf') queuePdfThumb(item);
      } catch (err) {
        problems.push(label + ' could not be added' + (err instanceof RangeError ? ' (the browser ran out of memory).' : '.'));
      }
      await T.tick();
    }
    state.adding--; setBusy(state.adding > 0, 'Checking your files…');
    if (problems.length) showError(problems.join(' '));
    if (added) { dropResult(); render(); T.track(TOOL, 'pdf_merge_upload'); }
  }

  async function makeImageThumb(img) {
    try {
      const s = Math.min(1, 160 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * s)); c.height = Math.max(1, Math.round(img.naturalHeight * s));
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
      const b = await toBlob(c, 'image/jpeg', 0.7); c.width = c.height = 0;
      return T.makeUrl(b);
    } catch (_) { return null; }
  }
  function queuePdfThumb(item) {
    state.thumbQueue.add(async () => {
      const doc = await T.openPreview(await T.readBytes(item.file));
      if (!doc) return;
      try {
        const c = await T.renderPage(doc, 1, 160);
        const b = await toBlob(c, 'image/jpeg', 0.7); c.width = c.height = 0;
        if (!state.items.includes(item)) return;
        item.thumbUrl = T.makeUrl(b);
        const img = list.querySelector('[data-id="' + item.id + '"] .file-thumb');
        if (img) setThumb(img, item);
      } finally { try { doc.destroy(); } catch (_) { /* ignore */ } }
    });
  }

  /* ---------- The ordered list ---------- */
  function setThumb(box, item) {
    const old = box.querySelector('img, .ph'); if (old) old.remove();
    if (item.thumbUrl) { const im = document.createElement('img'); im.src = item.thumbUrl; im.alt = ''; im.decoding = 'async'; box.appendChild(im); }
    else { const ph = document.createElement('span'); ph.className = 'ph'; ph.textContent = item.kind.toUpperCase(); box.appendChild(ph); }
  }
  function btn(txt, label, cls, fn, disabled) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'row-btn' + (cls ? ' ' + cls : ''); b.textContent = txt;
    b.setAttribute('aria-label', label); b.title = label; b.disabled = !!disabled;
    b.addEventListener('click', fn); return b;
  }
  function render() {
    const n = state.items.length;
    list.textContent = '';
    listWrap.hidden = n === 0;
    const pdfPages = state.items.reduce((s, i) => s + (i.kind === 'pdf' ? i.pages : 1), 0);
    countLine.textContent = T.plural(n, 'file') + ' · ' + T.plural(pdfPages, 'page') + ' in the merged PDF';
    state.items.forEach((item, idx) => {
      const li = document.createElement('li'); li.className = 'file-row'; li.dataset.id = String(item.id);
      const handle = document.createElement('div'); handle.className = 'drag-handle'; handle.textContent = '⋮⋮';
      handle.setAttribute('role', 'img'); handle.setAttribute('aria-label', 'Drag to reorder'); handle.title = 'Drag to reorder';
      const thumb = document.createElement('div'); thumb.className = 'file-thumb';
      const badge = document.createElement('span'); badge.className = 'pos-badge'; badge.textContent = String(idx + 1); thumb.appendChild(badge);
      setThumb(thumb, item);
      const text = document.createElement('div'); text.className = 'file-text';
      const nm = document.createElement('div'); nm.className = 'file-name'; nm.textContent = item.file.name; nm.title = item.file.name;
      const meta = document.createElement('div'); meta.className = 'file-meta';
      const tag = document.createElement('span'); tag.className = 'kind-tag' + (item.kind === 'pdf' ? '' : ' img'); tag.textContent = item.kind === 'jpg' ? 'JPG' : item.kind.toUpperCase();
      meta.appendChild(tag);
      meta.appendChild(document.createTextNode(item.kind === 'pdf' ? T.plural(item.pages, 'page') + ' · ' + T.formatBytes(item.file.size)
        : item.w + ' × ' + item.h + ' px · ' + T.formatBytes(item.file.size)));
      text.appendChild(nm); text.appendChild(meta);
      const tools = document.createElement('div'); tools.className = 'row-tools';
      tools.appendChild(btn('↑', 'Move ' + item.file.name + ' up', '', () => move(item.id, -1), idx === 0));
      tools.appendChild(btn('↓', 'Move ' + item.file.name + ' down', '', () => move(item.id, 1), idx === n - 1));
      tools.appendChild(btn('✕', 'Remove ' + item.file.name, 'danger', () => remove(item.id)));
      li.appendChild(handle); li.appendChild(thumb); li.appendChild(text); li.appendChild(tools);
      list.appendChild(li);
      bindDrag(handle, li);
    });
    const ready = n > 0 && !state.running;
    settings.disabled = n === 0; mergeBtn.disabled = !ready;
    mergeBtn.textContent = n < 2 ? 'Create PDF' : 'Merge ' + n + ' files into one PDF';
    $('image-settings-note').hidden = !state.items.some((i) => i.kind !== 'pdf');
  }
  function move(id, delta) {
    const i = state.items.findIndex((x) => x.id === id), j = i + delta;
    if (i < 0 || j < 0 || j >= state.items.length) return;
    const t = state.items[i]; state.items[i] = state.items[j]; state.items[j] = t;
    dropResult(); render();
    const tools = list.querySelector('[data-id="' + id + '"] .row-tools');
    if (tools) { const b = tools.children[delta < 0 ? 0 : 1]; (b && !b.disabled ? b : tools.children[delta < 0 ? 1 : 0]).focus(); }
  }
  function remove(id) {
    const i = state.items.findIndex((x) => x.id === id); if (i < 0) return;
    T.freeUrl(state.items[i].thumbUrl); state.items.splice(i, 1);
    clearError(); dropResult(); render();
  }
  function clearAll() {
    state.items.forEach((i) => T.freeUrl(i.thumbUrl)); state.items = [];
    state.thumbQueue.clear(); clearError(); dropResult(); render();
  }
  function sortAZ() {
    state.items.sort((a, b) => a.file.name.localeCompare(b.file.name, undefined, { numeric: true, sensitivity: 'base' }));
    dropResult(); render();
  }

  /* Drag and drop reordering (pointer events work for mouse, pen and touch) */
  function bindDrag(handle, row) {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      e.preventDefault();
      const pid = e.pointerId;       // moving the row in the DOM drops pointer capture, so listen on the window instead
      row.classList.add('is-dragging'); list.classList.add('is-sorting');
      let raf = 0, lastY = e.clientY;
      function place() {
        const rows = Array.from(list.children).filter((r) => r !== row);
        let before = null;
        for (const r of rows) { const b = r.getBoundingClientRect(); if (lastY < b.top + b.height / 2) { before = r; break; } }
        if (before) { if (row.nextSibling !== before) list.insertBefore(row, before); } else if (list.lastChild !== row) list.appendChild(row);
      }
      function scrollEdges() {
        if (lastY < 70) window.scrollBy(0, -14); else if (lastY > window.innerHeight - 70) window.scrollBy(0, 14);
        place(); raf = requestAnimationFrame(scrollEdges);
      }
      raf = requestAnimationFrame(scrollEdges);
      const onMove = (ev) => { if (ev.pointerId === pid) { lastY = ev.clientY; place(); } };
      const done = (ev) => {
        if (ev && ev.pointerId !== pid) return;
        cancelAnimationFrame(raf);
        window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', done); window.removeEventListener('pointercancel', done);
        row.classList.remove('is-dragging'); list.classList.remove('is-sorting');
        const order = Array.from(list.children).map((r) => Number(r.dataset.id));
        const byId = new Map(state.items.map((i) => [i.id, i]));
        state.items = order.map((id) => byId.get(id)).filter(Boolean);
        dropResult(); render();
      };
      window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', done); window.addEventListener('pointercancel', done);
    });
  }

  /* ---------- Page geometry for images ---------- */
  function pageFor(w, h) {                       // w, h: displayed image size in pixels
    const m = MARGINS[marginEl.value] || 0;
    if (sizeEl.value === 'original') {
      let pw = w * 0.75, ph = h * 0.75; const s = Math.min(1, 14000 / Math.max(pw, ph)); pw *= s; ph *= s;
      return { W: pw + 2 * m, H: ph + 2 * m, x: m, y: m, w: pw, h: ph };
    }
    let [W, H] = SIZES[sizeEl.value] || SIZES.a4;
    const o = orientEl.value;
    const land = o === 'landscape' || (o === 'auto' && w > h);
    if (land && W < H) { const t = W; W = H; H = t; } else if (!land && W > H) { const t = W; W = H; H = t; }
    const bw = Math.max(10, W - 2 * m), bh = Math.max(10, H - 2 * m);
    const k = Math.min(bw / w, bh / h);
    const dw = w * k, dh = h * k;
    return { W, H, x: (W - dw) / 2, y: (H - dh) / 2, w: dw, h: dh };
  }

  /* Bytes + size of one image as it will be embedded. */
  async function prepareImage(item) {
    const opt = OPT[optEl.value];
    const bytes = await T.readBytes(item.file);
    const orient = item.kind === 'jpg' ? jpegOrientation(bytes) : 1;
    if (!opt && orient === 1) return { kind: item.kind, bytes, w: item.w, h: item.h };
    // Re-encode through a canvas: needed for optimisation, and for photos whose EXIF rotation must be applied.
    const img = await loadImage(item.file);
    let w = img.naturalWidth, h = img.naturalHeight;
    if (opt) { const k = Math.min(1, opt.side / Math.max(w, h)); w = Math.max(1, Math.round(w * k)); h = Math.max(1, Math.round(h * k)); }
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'); if (!ctx) throw new Error('canvas');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
    const blob = await toBlob(c, 'image/jpeg', opt ? opt.q : 0.92); c.width = c.height = 0;
    return { kind: 'jpg', bytes: new Uint8Array(await blob.arrayBuffer()), w, h };
  }

  /* ---------- Merging ---------- */
  async function merge() {
    if (state.running || !state.items.length) return;
    clearError(); dropResult();
    const run = ++state.run; state.running = true;
    mergeBtn.disabled = true; settings.disabled = true; cancelBtn.hidden = false;
    progress.hidden = false; progressBar.style.width = '0%';
    const lib = await T.loadPdfLib().catch(() => null);
    if (!lib) { showError('The PDF library could not be loaded. Check your internet connection and try again.'); finish(run); return; }
    const out = await lib.PDFDocument.create();
    let pagesOut = 0, current = null;
    try {
      const items = state.items.slice();
      for (let i = 0; i < items.length; i++) {
        if (run !== state.run) return;
        const item = current = items[i];
        setBusy(true, 'Adding file ' + (i + 1) + ' of ' + items.length + '…');
        await T.tick();
        if (item.kind === 'pdf') {
          const src = await lib.PDFDocument.load(await T.readBytes(item.file), { updateMetadata: false });
          const copied = await out.copyPages(src, src.getPageIndices());
          copied.forEach((p) => out.addPage(p)); pagesOut += copied.length;
        } else {
          const prep = await prepareImage(item);
          const emb = prep.kind === 'png' ? await out.embedPng(prep.bytes) : await out.embedJpg(prep.bytes);
          const dispW = prep.w, dispH = prep.h;
          const g = pageFor(dispW, dispH);
          const page = out.addPage([g.W, g.H]);
          page.drawImage(emb, { x: g.x, y: g.y, width: g.w, height: g.h });
          pagesOut++;
        }
        progressBar.style.width = Math.round((i + 1) / items.length * 100) + '%';
      }
      if (run !== state.run) return;
      current = null;
      const name = T.cleanFileName(nameEl.value, 'merged');
      out.setTitle(name); out.setProducer('Hira Science Academy PDF Merger');
      setBusy(true, 'Saving the PDF…'); await T.tick();
      const bytes = await out.save();
      const blob = new Blob([bytes], { type: 'application/pdf' });
      showResult(blob, pagesOut, items.length);
      T.track(TOOL, 'pdf_merge_success');
    } catch (err) {
      if (run === state.run) {
        const who = current ? ' while adding “' + current.file.name + '”' : '';
        showError((err instanceof RangeError || /memory|allocation/i.test(String(err && err.message)))
          ? 'The browser ran out of memory' + who + '. Try fewer or smaller files, use image optimisation, or close other tabs.'
          : 'Merging failed' + who + '. That file may be damaged or use a feature this tool cannot copy. Remove it and try again.');
      }
    } finally { finish(run); }
  }
  function finish(run) {
    if (run !== state.run) return;
    state.running = false; setBusy(false); progress.hidden = true; cancelBtn.hidden = true;
    render();
  }
  function cancel() { state.run++; state.running = false; setBusy(false); progress.hidden = true; cancelBtn.hidden = true; render(); }

  function dropResult() {
    if (state.outUrl) { T.freeUrl(state.outUrl); state.outUrl = null; }
    state.outBlob = null; dlBtn.removeAttribute('href'); resultPanel.classList.remove('is-visible');
  }
  function outName() { return T.cleanFileName(nameEl.value, 'merged') + '.pdf'; }
  function showResult(blob, pages, files) {
    state.outBlob = blob; state.outUrl = T.makeUrl(blob);
    dlBtn.href = state.outUrl; dlBtn.download = outName();
    resultTitle.textContent = 'Your merged PDF is ready';
    resultNote.textContent = outName() + ' · ' + T.plural(pages, 'page') + ' from ' + T.plural(files, 'file') + ' · ' + T.formatBytes(blob.size);
    resultPanel.classList.add('is-visible');
    resultPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function startOver() {
    state.run++; state.running = false; clearAll(); setBusy(false); progress.hidden = true; cancelBtn.hidden = true;
    nameEl.value = 'merged'; sizeEl.value = 'a4'; orientEl.value = 'auto'; marginEl.value = 'none'; optEl.value = 'original';
    T.track(TOOL, 'pdf_merge_reset');
    dropzone.scrollIntoView({ behavior: 'smooth', block: 'center' }); dropzone.focus();
  }

  /* ---------- Events ---------- */
  fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; });
  addInput.addEventListener('change', () => { addFiles(addInput.files); addInput.value = ''; });
  $('add-btn').addEventListener('click', () => addInput.click());
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
  ['dragenter', 'dragover'].forEach((t) => dropzone.addEventListener(t, (e) => { e.preventDefault(); dropzone.classList.add('is-drag'); }));
  ['dragleave', 'dragend'].forEach((t) => dropzone.addEventListener(t, () => dropzone.classList.remove('is-drag')));
  dropzone.addEventListener('drop', (e) => { e.preventDefault(); dropzone.classList.remove('is-drag'); if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });
  ['dragover', 'drop'].forEach((t) => window.addEventListener(t, (e) => { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') !== -1) e.preventDefault(); }));
  $('sort-btn').addEventListener('click', sortAZ);
  $('clear-btn').addEventListener('click', clearAll);
  mergeBtn.addEventListener('click', merge);
  cancelBtn.addEventListener('click', cancel);
  againBtn.addEventListener('click', startOver);
  [sizeEl, orientEl, marginEl, optEl].forEach((el) => el.addEventListener('change', dropResult));
  sizeEl.addEventListener('change', () => { const o = sizeEl.value === 'original'; orientEl.disabled = o; });
  nameEl.addEventListener('input', () => { if (state.outBlob) { dlBtn.download = outName(); } });
  dlBtn.addEventListener('click', () => { dlBtn.download = outName(); T.track(TOOL, 'pdf_merge_download'); });
  settings.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); mergeBtn.click(); } });
  render();
})();
