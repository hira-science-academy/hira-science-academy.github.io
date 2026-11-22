'use strict';

/* ============================================================
   Hira Science Academy: PDF Watermark Tool
   Adds a text or image watermark to a PDF with pdf-lib, in the browser.
   The watermark is written into each page's content (it is not an overlay),
   so it stays in the file after download. Text watermarks use standard PDF
   fonts, so the text is selectable. Nothing is uploaded.
   Depends on assets/tools-common.js and assets/pdf-common.js.
   ============================================================ */
(function () {

  const $ = (id) => document.getElementById(id);
  const fileErr = $('file-error');
  if (typeof PDFTools === 'undefined') {
    if (fileErr) { fileErr.textContent = 'The shared PDF script did not load. Please refresh the page.'; fileErr.classList.add('is-visible'); }
    return;
  }
  const T = PDFTools;
  const TOOL = 'pdf-watermark';
  const MAX_FILE_BYTES = 300 * 1024 * 1024;
  const MAX_LOGO_BYTES = 20 * 1024 * 1024;
  const MM = 72 / 25.4;
  const MAX_TILES = 600;

  const dropzone = $('dropzone'), fileInput = $('file-input');
  const fileInfo = $('file-info'), fileNameEl = $('file-name'), fileMetaEl = $('file-meta'), changeBtn = $('change-btn');
  const work = $('wm-work'), settings = $('settings'), actionRow = $('action-row');
  const applyBtn = $('apply-btn'), cancelBtn = $('cancel-btn'), busyEl = $('busy'), progress = $('progress'), progressBar = $('progress-bar');
  const canvas = $('preview-canvas'), stage = $('wm-stage'), pageNo = $('page-no'), pageOf = $('page-of'), wmNote = $('wm-note');
  const resultPanel = $('result-panel'), resultNote = $('result-note'), dlBtn = $('download-btn'), againBtn = $('again-btn'), nameEl = $('out-name');

  const state = { bytes: null, pages: 0, base: 'document', preview: null, cur: 1, baseBitmap: null, baseKey: '', logo: null,
    running: false, run: 0, outUrl: null, loadToken: 0, drawToken: 0, scratch: null, fontCache: {}, pending: false };

  function showError(msg) { fileErr.textContent = msg; fileErr.classList.add('is-visible'); }
  function clearError() { fileErr.textContent = ''; fileErr.classList.remove('is-visible'); }
  function setBusy(on, msg) { busyEl.textContent = msg || 'Working…'; busyEl.hidden = !on; }
  const radio = (name) => { const r = document.querySelector('input[name="' + name + '"]:checked'); return r ? r.value : ''; };

  /* ---------- Fonts ---------- */
  const FONTS = {
    helv: ['Helvetica', 'HelveticaBold', 'HelveticaOblique', 'HelveticaBoldOblique'],
    times: ['TimesRoman', 'TimesRomanBold', 'TimesRomanItalic', 'TimesRomanBoldItalic'],
    cour: ['Courier', 'CourierBold', 'CourierOblique', 'CourierBoldOblique']
  };
  const CSS_FAMILY = {
    helv: 'Helvetica, Arial, "Liberation Sans", "Noto Naskh Arabic", "Noto Nastaliq Urdu", sans-serif',
    times: '"Times New Roman", Times, "Liberation Serif", "Noto Naskh Arabic", serif',
    cour: '"Courier New", Courier, "Liberation Mono", monospace'
  };
  function fontName(o) { return FONTS[o.family][(o.bold ? 1 : 0) + (o.italic ? 2 : 0)]; }
  async function measureFont(name) {              // font used only to measure text (same metrics as the output)
    if (state.fontCache[name]) return state.fontCache[name];
    const lib = window.PDFLib;
    if (!state.scratch) state.scratch = await lib.PDFDocument.create();
    const font = await state.scratch.embedFont(lib.StandardFonts[name]);
    const set = new Set(font.getCharacterSet());
    return (state.fontCache[name] = { font, set });
  }

  /* ---------- Reading the controls ---------- */
  function opts() {
    return {
      type: radio('wtype'), text: $('wm-text').value.replace(/\r/g, ''), family: $('font-family').value,
      bold: $('font-bold').checked, italic: $('font-italic').checked, size: Number($('font-size').value),
      color: $('font-color').value, align: radio('talign'), scale: Number($('img-scale').value),
      opacity: Number($('opacity').value) / 100, rot: Number($('rotation').value),
      layout: radio('layout'), pos: radio('pos'), edge: Number($('edge').value) * MM,
      gapX: Number($('gap-x').value), gapY: Number($('gap-y').value), layer: radio('layer')
    };
  }

  /* ---------- Size of one watermark (unrotated), in points ---------- */
  function canvasFont(o, px) { return (o.italic ? 'italic ' : '') + (o.bold ? 'bold ' : '') + px + 'px ' + CSS_FAMILY[o.family]; }
  async function measure(o, visW) {
    if (o.type === 'image') {
      if (!state.logo) return null;
      const w = visW * o.scale / 100;
      return { kind: 'image', w, h: w * state.logo.h / state.logo.w };
    }
    const lines = o.text.split('\n').map((l) => l.replace(/\s+$/, ''));
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    while (lines.length && !lines[0].trim()) lines.shift();
    if (!lines.length) return null;
    const { font, set } = await measureFont(fontName(o));
    let latin = true;
    for (const ch of o.text.replace(/\n/g, '')) { if (!set.has(ch.codePointAt(0))) { latin = false; break; } }
    const lineH = o.size * 1.2;
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = canvasFont(o, o.size);
    const ws = lines.map((l) => latin ? font.widthOfTextAtSize(l, o.size) : ctx.measureText(l).width);
    const cw = lines.map((l) => ctx.measureText(l).width);
    return { kind: 'text', asImage: !latin, lines, widths: ws, canvasWidths: cw, w: Math.max.apply(null, ws), h: lines.length * lineH, lineH };
  }

  /* ---------- Where the watermark goes (visual coordinates: origin bottom-left, y up) ---------- */
  function placements(o, visW, visH, m) {
    const a = o.rot * Math.PI / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
    const bw = m.w * c + m.h * s, bh = m.w * s + m.h * c;           // bounding box of the rotated watermark
    const list = [];
    if (o.layout === 'tiled') {
      let gx = o.gapX, gy = o.gapY, cw = bw + gx, ch = bh + gy;
      const need = (Math.ceil(visW / cw) + 2) * (Math.ceil(visH / ch) + 2);
      if (need > MAX_TILES) { const k = Math.sqrt(need / MAX_TILES); cw *= k; ch *= k; }
      const cols = Math.ceil(visW / cw) + 2, rows = Math.ceil(visH / ch) + 2;
      const x0 = visW / 2 - (cols - 1) * cw / 2, y0 = visH / 2 - (rows - 1) * ch / 2;
      for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
        const cx = x0 + q * cw + (r % 2 ? cw / 2 : 0), cy = y0 + r * ch;
        if (cx + bw / 2 < 0 || cx - bw / 2 > visW || cy + bh / 2 < 0 || cy - bh / 2 > visH) continue;
        list.push({ cx, cy });
      }
      if (!list.length) list.push({ cx: visW / 2, cy: visH / 2 });
    } else {
      const p = o.pos || 'mc', e = o.edge;
      const cx = p[1] === 'l' ? e + bw / 2 : p[1] === 'r' ? visW - e - bw / 2 : visW / 2;
      const cy = p[0] === 't' ? visH - e - bh / 2 : p[0] === 'b' ? e + bh / 2 : visH / 2;
      list.push({ cx, cy });
    }
    return list;
  }

  /* Page geometry: visible box, rotation, and the visual size the person sees. */
  function pageGeometry(page) {
    const box = page.getCropBox ? page.getCropBox() : page.getMediaBox();
    const rot = ((page.getRotation().angle % 360) + 360) % 360;
    const W = box.width, H = box.height;
    return { box, rot, W, H, visW: rot % 180 ? H : W, visH: rot % 180 ? W : H };
  }
  function toUser(g, vx, vy) {
    let x, y;
    if (g.rot === 90) { x = g.W - vy; y = vx; }
    else if (g.rot === 180) { x = g.W - vx; y = g.H - vy; }
    else if (g.rot === 270) { x = vy; y = g.H - vx; }
    else { x = vx; y = vy; }
    return { x: g.box.x + x, y: g.box.y + y };
  }

  /* ---------- Page selection ---------- */
  function selection(total) {
    const mode = $('pages-mode').value;
    const all = T.range(1, total);
    if (mode === 'all') return { list: all };
    if (mode === 'odd') return { list: all.filter((n) => n % 2 === 1) };
    if (mode === 'even') return { list: all.filter((n) => n % 2 === 0) };
    if (mode === 'range') {
      const a = Number($('range-from').value), b = Number($('range-to').value);
      if (!Number.isInteger(a) || !Number.isInteger(b)) return { error: 'Enter whole page numbers for the range.' };
      if (a < 1 || b < 1 || a > total || b > total) return { error: 'This PDF has ' + T.pagesWord(total) + '. Choose pages from 1 to ' + total + '.' };
      if (a > b) return { error: 'The first page of the range must not be after the last page.' };
      return { list: T.range(a, b) };
    }
    const r = T.parsePageList($('pages-text').value, total, true);
    if (r.error) return r;
    if (mode === 'list') return { list: r.list };
    const skip = new Set(r.list), keep = all.filter((n) => !skip.has(n));
    if (!keep.length) return { error: 'That would leave no pages to watermark.' };
    return { list: keep };
  }

  /* ---------- Loading a PDF ---------- */
  async function handleFile(file, count) {
    clearError();
    if (!file) return;
    if (file.size === 0) { showError('That file is empty (0 bytes).'); return; }
    if (file.size > MAX_FILE_BYTES) { showError('This file is ' + T.formatBytes(file.size) + '. The limit is 300 MB because the whole PDF is held in your browser’s memory.'); return; }
    let ok = false;
    try { ok = await T.looksLikePdf(file); } catch (_) { /* ignore */ }
    if (!ok) { showError('This does not look like a PDF file. Choose a file ending in .pdf.'); return; }
    const token = ++state.loadToken;
    resetAll(true);
    fileInfo.hidden = false; fileNameEl.textContent = file.name; fileMetaEl.textContent = 'Reading… ' + T.formatBytes(file.size);
    setBusy(true, 'Opening the PDF…');
    try {
      const bytes = await T.readBytes(file);
      const res = await T.openPdf(bytes);
      if (token !== state.loadToken) return;
      if (res.error) { fileInfo.hidden = true; setBusy(false); showError(T.OPEN_ERRORS[res.error]); return; }
      state.bytes = bytes; state.pages = res.pages; state.cur = 1;
      state.base = T.baseName(file.name, 'document');
      nameEl.value = state.base + '-watermarked';
      fileMetaEl.textContent = T.plural(res.pages, 'page') + ' · ' + T.formatBytes(file.size) + (count > 1 ? ' · Only the first file was used.' : '');
      pageNo.max = String(res.pages); pageNo.value = '1'; pageOf.textContent = 'of ' + res.pages;
      $('range-from').value = '1'; $('range-to').value = String(res.pages);
      work.hidden = false; actionRow.hidden = false; settings.disabled = false; applyBtn.disabled = false;
      setBusy(true, 'Preparing the preview…');
      state.preview = await T.openPreview(bytes);
      if (token !== state.loadToken) return;
      setBusy(false);
      if (!state.preview) wmNote.textContent = 'The page preview could not be loaded, but you can still add the watermark.';
      refresh();
      T.track(TOOL, 'pdf_watermark_upload');
    } catch (err) {
      if (token !== state.loadToken) return;
      setBusy(false); fileInfo.hidden = true;
      showError(err instanceof RangeError ? 'The browser ran out of memory opening this PDF. Close other tabs or try a smaller file.' : 'This PDF could not be read. It may be damaged.');
    }
  }

  /* ---------- Live preview (same geometry as the real output) ---------- */
  function refresh() { if (state.pending) return; state.pending = true; requestAnimationFrame(() => { state.pending = false; drawPreview(); }); }

  async function drawPreview() {
    if (!state.bytes) return;
    const token = ++state.drawToken;
    const o = opts(), n = state.cur;
    const sel = selection(state.pages);
    const included = !sel.error && sel.list.indexOf(n) !== -1;
    wmNote.textContent = sel.error ? sel.error : (included ? 'Page ' + n + ' will be watermarked. The preview matches the downloaded file.' : 'Page ' + n + ' is not in your selection, so it stays unchanged.');
    if (!state.preview) return;
    // the page itself, rendered once per page and width
    const cssW = Math.max(200, Math.min(640, stage.clientWidth - 24 || 420));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const key = n + ':' + cssW + ':' + dpr;
    if (state.baseKey !== key) {
      try {
        const bmp = await T.renderPage(state.preview, n, cssW * dpr, true);
        if (token !== state.drawToken) return;
        state.baseBitmap = bmp; state.baseKey = key;
      } catch (_) { return; }
    }
    const bmp = state.baseBitmap;
    const cw = bmp.width, ch = bmp.height;
    // visual size of the page in points, from the first render ratio
    const pg = await state.preview.getPage(n); const vp = pg.getViewport({ scale: 1 }); try { pg.cleanup(); } catch (_) { /* ignore */ }
    const visW = vp.width, visH = vp.height, k = cw / visW;
    let m = null, list = [];
    if (included) { m = await measure(o, visW); if (m) list = placements(o, visW, visH, m); }
    if (token !== state.drawToken) return;
    canvas.width = cw; canvas.height = ch; canvas.style.width = (cw / dpr) + 'px';
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, ch);
    const paint = () => { if (m && list.length) drawWatermark(ctx, o, m, list, k, ch); };
    if (o.layer === 'below') { paint(); ctx.drawImage(bmp, 0, 0); } else { ctx.drawImage(bmp, 0, 0); paint(); }
  }

  function drawWatermark(ctx, o, m, list, k, canvasH) {
    ctx.save(); ctx.globalAlpha = o.opacity;
    list.forEach((p) => {
      ctx.save();
      ctx.translate(p.cx * k, canvasH - p.cy * k); ctx.rotate(-o.rot * Math.PI / 180); ctx.scale(k, k);
      if (m.kind === 'image') {
        ctx.drawImage(state.logo.img, -m.w / 2, -m.h / 2, m.w, m.h);
      } else {
        ctx.fillStyle = o.color; ctx.font = canvasFont(o, o.size); ctx.textBaseline = 'alphabetic';
        m.lines.forEach((line, i) => {
          const lw = m.widths[i];
          const lx = o.align === 'left' ? -m.w / 2 : o.align === 'right' ? m.w / 2 - lw : -lw / 2;
          const base = m.h / 2 - (i + 1) * m.lineH + o.size * 0.27;
          ctx.save(); ctx.translate(lx, -base);
          const sx = m.canvasWidths[i] > 0 ? lw / m.canvasWidths[i] : 1; ctx.scale(sx, 1);
          ctx.fillText(line, 0, 0); ctx.restore();
        });
      }
      ctx.restore();
    });
    ctx.restore();
  }

  /* ---------- Logo ---------- */
  async function loadLogo(file) {
    state.logo = null; $('logo-note').textContent = 'Transparent PNG files keep their transparency.';
    if (!file) { refresh(); return; }
    if (file.size > MAX_LOGO_BYTES) { $('logo-note').textContent = 'That image is over 20 MB. Choose a smaller one.'; $('logo-input').value = ''; refresh(); return; }
    const h = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const kind = h[0] === 0xFF && h[1] === 0xD8 ? 'jpg' : (h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4E && h[3] === 0x47 ? 'png' : '');
    if (!kind) { $('logo-note').textContent = 'Only PNG and JPG images can be used as a watermark.'; $('logo-input').value = ''; refresh(); return; }
    try {
      const url = URL.createObjectURL(file);
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('decode')); i.src = url; });
      URL.revokeObjectURL(url);
      if (img.naturalWidth * img.naturalHeight > 60e6) throw new Error('big');
      state.logo = { file, kind, img, w: img.naturalWidth, h: img.naturalHeight };
      $('logo-note').textContent = 'Using this image (' + img.naturalWidth + ' × ' + img.naturalHeight + ' px). Transparent PNG files keep their transparency.';
    } catch (_) {
      $('logo-note').textContent = 'That image could not be read. It may be damaged or too large.'; $('logo-input').value = '';
    }
    refresh();
  }

  /* ---------- Writing the watermark into the PDF ---------- */
  const num = (v) => (Math.abs(v) < 1e-9 ? 0 : v).toFixed(4);
  function rgb(hex) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '#000000') || [0, '00', '00', '00'];
    return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255].map((v) => v.toFixed(4)).join(' ');
  }
  async function textAsPng(o, m) {                 // for characters standard PDF fonts cannot hold (Urdu, Arabic, CJK…)
    const S = 3, pad = Math.ceil(o.size * 0.3);
    const c = document.createElement('canvas');
    c.width = Math.ceil((m.w + 2 * pad) * S); c.height = Math.ceil((m.h + 2 * pad) * S);
    const ctx = c.getContext('2d'); ctx.scale(S, S);
    ctx.fillStyle = o.color; ctx.font = canvasFont(o, o.size); ctx.textBaseline = 'alphabetic';
    m.lines.forEach((line, i) => {
      const lw = m.widths[i];
      const lx = pad + (o.align === 'left' ? 0 : o.align === 'right' ? m.w - lw : (m.w - lw) / 2);
      ctx.fillText(line, lx, pad + (i + 1) * m.lineH - o.size * 0.27);
    });
    const blob = await new Promise((res, rej) => c.toBlob((b) => b ? res(b) : rej(new Error('encode')), 'image/png'));
    c.width = c.height = 0;
    return { bytes: new Uint8Array(await blob.arrayBuffer()), pad };
  }

  async function apply() {
    if (!state.bytes || state.running) return;
    clearError(); dropResult();
    const sel = selection(state.pages);
    if (sel.error) { showError(sel.error); return; }
    const o = opts();
    if (o.type === 'text' && !o.text.trim()) { showError('Type the watermark text first.'); return; }
    if (o.type === 'image' && !state.logo) { showError('Choose a PNG or JPG image for the watermark first.'); return; }
    const run = ++state.run; state.running = true;
    applyBtn.disabled = true; settings.disabled = true; cancelBtn.hidden = false; progress.hidden = false; progressBar.style.width = '0%';
    setBusy(true, 'Preparing…');
    try {
      const lib = await T.loadPdfLib();
      const { PDFDocument, PDFName, StandardFonts } = lib;
      const doc = await PDFDocument.load(state.bytes, { updateMetadata: false });
      const ctxPdf = doc.context;
      // resources are embedded once and shared by every page
      let fontRef = null, imgRef = null, textImg = null;
      const m0 = await measure(o, 1000);
      if (!m0) throw new Error('nothing');
      if (o.type === 'image') {
        const bytes = await T.readBytes(state.logo.file);
        imgRef = (state.logo.kind === 'png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes)).ref;
      } else if (m0.asImage) {
        const png = await textAsPng(o, m0); textImg = png;
        imgRef = (await doc.embedPng(png.bytes)).ref;
      } else {
        fontRef = await doc.embedFont(StandardFonts[fontName(o)]);
      }
      const gsRef = ctxPdf.register(ctxPdf.obj({ Type: 'ExtGState', ca: o.opacity, CA: o.opacity }));
      const wrapQ = ctxPdf.register(ctxPdf.stream('q\n')), wrapEnd = ctxPdf.register(ctxPdf.stream('\nQ\n'));
      const pages = doc.getPages();
      const colour = rgb(o.color);
      for (let i = 0; i < sel.list.length; i++) {
        if (run !== state.run) return;
        const page = pages[sel.list[i] - 1];
        const g = pageGeometry(page);
        const m = await measure(o, g.visW);
        const list = placements(o, g.visW, g.visH, m);
        // resources for this page
        page.node.normalize();
        const gsName = page.node.newExtGState('HsaGS', gsRef);
        const fName = fontRef ? page.node.newFontDictionary('HsaF', fontRef.ref) : null;
        const xName = imgRef ? page.node.newXObject('HsaI', imgRef) : null;
        const ops = ['q', '/' + gsName.asString().replace(/^\//, '') + ' gs'];
        list.forEach((p) => {
          const u = toUser(g, p.cx, p.cy), phi = (o.rot + g.rot) * Math.PI / 180, c = Math.cos(phi), s = Math.sin(phi);
          ops.push('q', [num(c), num(s), num(-s), num(c), num(u.x), num(u.y)].join(' ') + ' cm');
          if (xName) {
            const w = textImg ? m.w + 2 * textImg.pad : m.w, h = textImg ? m.h + 2 * textImg.pad : m.h;
            ops.push([num(w), 0, 0, num(h), num(-w / 2), num(-h / 2)].join(' ') + ' cm', '/' + xName.asString().replace(/^\//, '') + ' Do');
          } else {
            m.lines.forEach((line, li) => {
              if (!line.trim()) return;
              const lw = m.widths[li];
              const lx = o.align === 'left' ? -m.w / 2 : o.align === 'right' ? m.w / 2 - lw : -lw / 2;
              const base = m.h / 2 - (li + 1) * m.lineH + o.size * 0.27;
              ops.push('BT', '/' + fName.asString().replace(/^\//, '') + ' ' + num(o.size) + ' Tf', colour + ' rg', '1 0 0 1 ' + num(lx) + ' ' + num(base) + ' Tm', fontRef.encodeText(line).toString() + ' Tj', 'ET');
            });
          }
          ops.push('Q');
        });
        ops.push('Q');
        const wmRef = ctxPdf.register(ctxPdf.stream(ops.join('\n') + '\n'));
        // layering: wrap the existing content in q … Q so its graphics state cannot leak into the watermark
        let arr = page.node.Contents();
        if (!arr) { arr = ctxPdf.obj([]); page.node.set(PDFName.of('Contents'), arr); }
        if (o.layer === 'below') { arr.insert(0, wmRef); arr.insert(1, wrapQ); arr.push(wrapEnd); }
        else { arr.insert(0, wrapQ); arr.push(wrapEnd); arr.push(wmRef); }
        progressBar.style.width = Math.round((i + 1) / sel.list.length * 100) + '%';
        if (i % 4 === 3) { setBusy(true, 'Watermarking page ' + sel.list[i] + '…'); await T.tick(); }
      }
      if (run !== state.run) return;
      setBusy(true, 'Saving the PDF…'); await T.tick();
      const out = await doc.save();
      const blob = new Blob([out], { type: 'application/pdf' });
      showResult(blob, sel.list.length);
      T.track(TOOL, 'pdf_watermark_success');
    } catch (err) {
      if (run === state.run) showError(err instanceof RangeError || /memory|allocation/i.test(String(err && err.message))
        ? 'The browser ran out of memory while adding the watermark. Try a smaller file, or close other tabs.'
        : 'The watermark could not be added. The PDF may use a feature this tool cannot edit.');
    } finally {
      if (run === state.run) { state.running = false; setBusy(false); progress.hidden = true; cancelBtn.hidden = true; applyBtn.disabled = !state.bytes; settings.disabled = !state.bytes; }
    }
  }
  function cancel() { state.run++; state.running = false; setBusy(false); progress.hidden = true; cancelBtn.hidden = true; applyBtn.disabled = !state.bytes; settings.disabled = !state.bytes; }

  /* ---------- Result ---------- */
  function outName() { return T.cleanFileName(nameEl.value, 'watermarked') + '.pdf'; }
  function dropResult() { if (state.outUrl) { T.freeUrl(state.outUrl); state.outUrl = null; } dlBtn.removeAttribute('href'); resultPanel.classList.remove('is-visible'); }
  function showResult(blob, count) {
    state.outUrl = T.makeUrl(blob); dlBtn.href = state.outUrl; dlBtn.download = outName();
    resultNote.textContent = outName() + ' · watermark added to ' + T.plural(count, 'page') + ' of ' + state.pages + ' · ' + T.formatBytes(blob.size);
    resultPanel.classList.add('is-visible'); resultPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function resetAll(keepInfo) {
    state.run++; state.running = false; state.drawToken++;
    if (state.preview) { try { state.preview.destroy(); } catch (_) { /* ignore */ } }
    state.preview = null; state.bytes = null; state.pages = 0; state.baseBitmap = null; state.baseKey = '';
    dropResult(); work.hidden = true; actionRow.hidden = true; progress.hidden = true; cancelBtn.hidden = true; setBusy(false);
    wmNote.textContent = ''; const c = canvas.getContext('2d'); c.clearRect(0, 0, canvas.width, canvas.height);
    if (!keepInfo) { fileInfo.hidden = true; fileNameEl.textContent = ''; fileMetaEl.textContent = ''; }
  }
  function startOver() {
    state.loadToken++; resetAll(false); clearError(); T.track(TOOL, 'pdf_watermark_reset');
    dropzone.scrollIntoView({ behavior: 'smooth', block: 'center' }); dropzone.focus();
  }

  /* ---------- Controls ---------- */
  function syncPanels() {
    const t = radio('wtype'), l = radio('layout'), pm = $('pages-mode').value;
    $('panel-text').hidden = t !== 'text'; $('panel-image').hidden = t !== 'image';
    $('panel-single').hidden = l !== 'single'; $('panel-tiled').hidden = l !== 'tiled';
    $('pages-range').hidden = pm !== 'range'; $('pages-list').hidden = pm !== 'list' && pm !== 'except';
    $('pages-text-label').textContent = pm === 'except' ? 'Pages to leave out' : 'Pages to watermark';
    const note = $('text-note');
    if (t === 'text') {
      note.hidden = true;
      measure(opts(), 600).then((m) => { if (m && m.asImage) { note.hidden = false; note.textContent = 'This text has characters that standard PDF fonts do not contain, so it will be added as a picture of the text. It looks the same but cannot be selected.'; } }).catch(() => {});
    }
  }
  function sync() {
    $('font-size-out').textContent = $('font-size').value; $('img-scale-out').textContent = $('img-scale').value + '%';
    $('opacity-out').textContent = $('opacity').value + '%'; $('rotation-out').textContent = $('rotation').value + '°';
    $('edge-out').textContent = $('edge').value + ' mm'; $('gap-x-out').textContent = $('gap-x').value; $('gap-y-out').textContent = $('gap-y').value;
    syncPanels(); dropResult(); refresh();
  }
  settings.addEventListener('input', sync); settings.addEventListener('change', sync);
  document.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => { $('wm-text').value = b.dataset.text; sync(); }));
  document.querySelectorAll('[data-rot]').forEach((b) => b.addEventListener('click', () => { $('rotation').value = b.dataset.rot; sync(); }));
  $('logo-input').addEventListener('change', () => { dropResult(); loadLogo($('logo-input').files[0]); });
  $('prev-page').addEventListener('click', () => gotoPage(state.cur - 1));
  $('next-page').addEventListener('click', () => gotoPage(state.cur + 1));
  pageNo.addEventListener('change', () => gotoPage(Number(pageNo.value)));
  function gotoPage(n) { if (!state.pages) return; n = Math.max(1, Math.min(state.pages, Math.round(n) || 1)); state.cur = n; pageNo.value = String(n); refresh(); }
  window.addEventListener('resize', () => { state.baseKey = ''; refresh(); });

  fileInput.addEventListener('change', () => { const f = fileInput.files; handleFile(f && f[0], f ? f.length : 0); fileInput.value = ''; });
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
  ['dragenter', 'dragover'].forEach((t) => dropzone.addEventListener(t, (e) => { e.preventDefault(); dropzone.classList.add('is-drag'); }));
  ['dragleave', 'dragend'].forEach((t) => dropzone.addEventListener(t, () => dropzone.classList.remove('is-drag')));
  dropzone.addEventListener('drop', (e) => { e.preventDefault(); dropzone.classList.remove('is-drag'); const f = e.dataTransfer && e.dataTransfer.files; if (f && f.length) handleFile(f[0], f.length); });
  ['dragover', 'drop'].forEach((t) => window.addEventListener(t, (e) => { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') !== -1) e.preventDefault(); }));
  changeBtn.addEventListener('click', () => fileInput.click());
  applyBtn.addEventListener('click', apply); cancelBtn.addEventListener('click', cancel); againBtn.addEventListener('click', startOver);
  nameEl.addEventListener('input', () => { if (state.outUrl) dlBtn.download = outName(); });
  dlBtn.addEventListener('click', () => { dlBtn.download = outName(); T.track(TOOL, 'pdf_watermark_download'); });
  window.addEventListener('pagehide', () => { try { if (state.preview) state.preview.destroy(); } catch (_) { /* ignore */ } });
  syncPanels();
})();
