'use strict';

/* ============================================================
   Hira Science Academy: PDF Splitter
   Splits a PDF in the browser with pdf-lib. Nothing is uploaded.
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
  const TOOL = 'pdf-splitter';
  const MAX_FILE_BYTES = 300 * 1024 * 1024;
  const BIG_FILE_BYTES = 60 * 1024 * 1024;
  const MAX_FILES_OUT = 1000;

  const dropzone = $('dropzone'), fileInput = $('file-input');
  const fileInfo = $('file-info'), fileNameEl = $('file-name'), fileMetaEl = $('file-meta'), changeBtn = $('change-btn');
  const settings = $('settings');
  const splitBtn = $('split-btn'), cancelBtn = $('cancel-btn'), busyEl = $('busy');
  const progress = $('progress'), progressBar = $('progress-bar');
  const resultPanel = $('result-panel'), resultTitle = $('result-title'), resultNote = $('result-note');
  const resultList = $('result-list'), zipBtn = $('zip-btn'), againBtn = $('again-btn');
  const grid = $('thumb-grid'), selCount = $('sel-count');
  const modeInputs = Array.from(document.querySelectorAll('input[name="mode"]'));

  const state = { name: 'document', doc: null, bytes: null, pages: 0, preview: null, previewTried: false,
    outputs: [], run: 0, running: false, selected: new Set(), gridBuilt: false, thumbUrls: [], observer: null, queue: T.makeQueue(2), loadToken: 0 };

  /* ---------- Messages ---------- */
  function showError(msg) { fileErr.textContent = msg; fileErr.classList.add('is-visible'); }
  function clearError() { fileErr.textContent = ''; fileErr.classList.remove('is-visible'); }
  function setBusy(on, msg) { busyEl.textContent = msg || 'Working…'; busyEl.hidden = !on; }
  function mode() { const m = modeInputs.find((r) => r.checked); return m ? m.value : 'extract'; }

  /* ---------- Loading ---------- */
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
    fileInfo.hidden = false;
    fileNameEl.textContent = file.name;
    fileMetaEl.textContent = 'Reading… ' + T.formatBytes(file.size);
    setBusy(true, 'Opening the PDF…');
    try {
      const bytes = await T.readBytes(file);
      const res = await T.openPdf(bytes);
      if (token !== state.loadToken) return;
      if (res.error) { fileInfo.hidden = true; setBusy(false); showError(T.OPEN_ERRORS[res.error]); return; }
      state.doc = res.doc; state.bytes = bytes; state.pages = res.pages;
      state.name = T.baseName(file.name, 'document');
      fileMetaEl.textContent = T.plural(res.pages, 'page') + ' · ' + T.formatBytes(file.size) + (count > 1 ? ' · Only the first file was used. Split the others one at a time.' : '');
      if (file.size > BIG_FILE_BYTES) fileMetaEl.textContent += ' · Large file: splitting may take a little while.';
      settings.disabled = false; splitBtn.disabled = false;
      applyPageLimits();
      updatePanels();
      setBusy(false);
      T.track(TOOL, 'pdf_split_upload');
    } catch (err) {
      if (token !== state.loadToken) return;
      setBusy(false); fileInfo.hidden = true;
      showError(isMemory(err) ? 'The browser ran out of memory opening this PDF. Close other tabs or try a smaller file.' : 'This PDF could not be read. It may be damaged.');
    }
  }
  function isMemory(err) { return err instanceof RangeError || /memory|allocation/i.test(String(err && err.message)); }

  function applyPageLimits() {
    const n = state.pages;
    $('pages-total').textContent = T.pagesWord(n);
    const eq = $('equal-count'); eq.max = String(Math.max(2, n)); if (Number(eq.value) > n) eq.value = String(Math.max(2, Math.min(n, 2)));
    const ch = $('chunk-size'); ch.max = String(Math.max(1, n));
    modeInputs.forEach((r) => { r.disabled = false; });
    const tooShort = n < 2;
    ['half', 'every', 'equal', 'chunk'].forEach((v) => { const r = modeInputs.find((x) => x.value === v); if (r) r.disabled = tooShort; });
    if (tooShort && ['half', 'every', 'equal', 'chunk'].indexOf(mode()) !== -1) modeInputs.find((x) => x.value === 'extract').checked = true;
    $('every-info').textContent = 'This creates ' + T.plural(n, 'separate PDF') + ', one per page, packed into one ZIP file.';
    $('half-info').textContent = n < 2 ? 'A one-page PDF cannot be halved.' :
      'Part 1 gets pages 1–' + Math.ceil(n / 2) + ' and part 2 gets pages ' + (Math.ceil(n / 2) + 1) + '–' + n + '.' + (n % 2 ? ' The page count is odd, so part 1 has one extra page.' : '');
    if (n < 2) $('every-info').textContent = 'A one-page PDF has nothing to split. Use Extract pages to copy it.';
  }

  function updatePanels() {
    const m = mode();
    ['extract', 'ranges', 'every', 'half', 'equal', 'chunk', 'select'].forEach((p) => { $('panel-' + p).hidden = p !== m; });
    const labels = { extract: 'Extract pages', ranges: 'Split by ranges', every: 'Split every page', half: 'Split in half', equal: 'Split into equal parts', chunk: 'Split PDF', select: 'Extract selected pages' };
    splitBtn.textContent = labels[m] || 'Split PDF';
    if (m === 'select' && state.doc) buildGrid();
    updateSelCount();
  }

  /* ---------- Page picker with thumbnails ---------- */
  async function buildGrid() {
    if (state.gridBuilt || !state.doc) return;
    state.gridBuilt = true;
    grid.textContent = '';
    const frag = document.createDocumentFragment();
    for (let n = 1; n <= state.pages; n++) {
      const label = document.createElement('label');
      label.className = 'thumb-tile'; label.dataset.page = String(n);
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.value = String(n); cb.setAttribute('aria-label', 'Page ' + n);
      const box = document.createElement('span'); box.className = 'thumb-box'; box.textContent = '…';
      const num = document.createElement('span'); num.className = 'thumb-num'; num.textContent = 'Page ' + n;
      label.appendChild(cb); label.appendChild(box); label.appendChild(num);
      cb.addEventListener('change', () => { if (cb.checked) state.selected.add(n); else state.selected.delete(n); label.classList.toggle('is-on', cb.checked); updateSelCount(); });
      frag.appendChild(label);
    }
    grid.appendChild(frag);
    if (!state.previewTried) {
      state.previewTried = true;
      setBusy(true, 'Loading page previews…');
      state.preview = await T.openPreview(state.bytes);
      setBusy(false);
    }
    if (!state.preview) { grid.querySelectorAll('.thumb-box').forEach((b) => { b.textContent = ''; }); $('preview-note').hidden = false; return; }
    const token = state.loadToken;
    state.observer = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        state.observer.unobserve(en.target);
        const tile = en.target, n = Number(tile.dataset.page);
        state.queue.add(async () => {
          if (token !== state.loadToken || !state.preview) return;
          const c = await T.renderPage(state.preview, n, 180);
          const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.72));
          c.width = c.height = 0;
          if (!blob || token !== state.loadToken) return;
          const url = T.makeUrl(blob); state.thumbUrls.push(url);
          const img = document.createElement('img');
          img.src = url; img.alt = 'Preview of page ' + n; img.decoding = 'async';
          const box = tile.querySelector('.thumb-box'); box.textContent = ''; box.appendChild(img);
        });
      });
    }, { rootMargin: '300px' });
    grid.querySelectorAll('.thumb-tile').forEach((t) => state.observer.observe(t));
  }
  function setSelection(fn) {
    state.selected.clear();
    grid.querySelectorAll('.thumb-tile').forEach((t) => {
      const n = Number(t.dataset.page), on = fn(n), cb = t.querySelector('input');
      cb.checked = on; t.classList.toggle('is-on', on); if (on) state.selected.add(n);
    });
    updateSelCount();
  }
  function updateSelCount() {
    selCount.textContent = state.selected.size ? T.plural(state.selected.size, 'page') + ' selected' : 'No pages selected yet';
  }

  /* ---------- Building the list of output files ---------- */
  function pad(n) { return String(n).padStart(String(state.pages).length, '0'); }
  function planJobs() {
    const m = mode(), n = state.pages, base = state.name;
    if (m === 'extract') {
      const r = T.parsePageList($('extract-pages').value, n, false);
      if (r.error) return r;
      return { jobs: [{ pages: r.list, filename: base + '-pages-' + labelOf(r.list) + '.pdf' }] };
    }
    if (m === 'ranges') {
      const r = T.parseRangeGroups($('ranges-text').value, n);
      if (r.error) return r;
      const used = {};
      return { jobs: r.groups.map((g) => {
        used[g.label] = (used[g.label] || 0) + 1;
        return { pages: g.pages, filename: base + '-pages-' + g.label + (used[g.label] > 1 ? '-' + used[g.label] : '') + '.pdf' };
      }) };
    }
    if (m === 'every') {
      if (n < 2) return { error: 'This PDF has only one page, so there is nothing to split.' };
      return { jobs: T.range(1, n).map((p) => ({ pages: [p], filename: base + '-page-' + pad(p) + '.pdf' })) };
    }
    if (m === 'half') {
      if (n < 2) return { error: 'A one-page PDF cannot be split in half.' };
      const h = Math.ceil(n / 2);
      return { jobs: [{ pages: T.range(1, h), filename: base + '-part-1-of-2.pdf' }, { pages: T.range(h + 1, n), filename: base + '-part-2-of-2.pdf' }] };
    }
    if (m === 'equal') {
      const k = Number($('equal-count').value);
      if (!Number.isInteger(k) || k < 2) return { error: 'Enter a whole number of parts, 2 or more.' };
      if (k > n) return { error: 'This PDF has ' + T.pagesWord(n) + ', so it cannot be split into ' + k + ' parts. Choose ' + n + ' or fewer.' };
      const size = Math.floor(n / k), extra = n % k, jobs = [];
      let start = 1;
      for (let i = 0; i < k; i++) {
        const len = size + (i < extra ? 1 : 0);
        jobs.push({ pages: T.range(start, start + len - 1), filename: base + '-part-' + (i + 1) + '-of-' + k + '.pdf' });
        start += len;
      }
      return { jobs };
    }
    if (m === 'chunk') {
      const s = Number($('chunk-size').value);
      if (!Number.isInteger(s) || s < 1) return { error: 'Enter how many pages each file should have, for example 10.' };
      if (s >= n) return { error: 'This PDF has only ' + T.pagesWord(n) + '. Enter a number smaller than ' + n + ' to get more than one file.' };
      const jobs = []; const total = Math.ceil(n / s);
      for (let i = 0; i < total; i++) {
        const a = i * s + 1, b = Math.min(n, a + s - 1);
        jobs.push({ pages: T.range(a, b), filename: base + '-part-' + (i + 1) + '-of-' + total + '.pdf' });
      }
      return { jobs };
    }
    if (m === 'select') {
      if (!state.selected.size) return { error: 'Tick at least one page in the preview first.' };
      const list = Array.from(state.selected).sort((a, b) => a - b);
      return { jobs: [{ pages: list, filename: base + '-selected-pages.pdf' }] };
    }
    return { error: 'Choose how to split the PDF.' };
  }
  function labelOf(list) {
    // 1,2,3,5 → "1-3_5" (readable, filename-safe, short)
    const parts = [];
    const sorted = list.slice().sort((x, y) => x - y);
    let a = sorted[0], b = sorted[0];
    for (let i = 1; i <= sorted.length; i++) {
      if (sorted[i] === b + 1) { b = sorted[i]; continue; }
      parts.push(a === b ? String(a) : a + '-' + b);
      a = b = sorted[i];
    }
    const s = parts.join('_');
    return s.length > 40 ? s.slice(0, 36).replace(/_[^_]*$/, '') + '_etc' : s;
  }

  /* ---------- Splitting ---------- */
  async function split() {
    if (!state.doc || state.running) return;
    clearError();
    const plan = planJobs();
    if (plan.error) { showError(plan.error); return; }
    if (plan.jobs.length > MAX_FILES_OUT) { showError('That would create ' + plan.jobs.length + ' files. The limit is ' + MAX_FILES_OUT + '. Use fewer ranges or bigger parts.'); return; }

    clearResults();
    const run = ++state.run;
    state.running = true;
    splitBtn.disabled = true; cancelBtn.hidden = false; settings.disabled = true;
    progress.hidden = false; progressBar.style.width = '0%';
    const lib = window.PDFLib;
    const outputs = [];
    try {
      for (let i = 0; i < plan.jobs.length; i++) {
        if (run !== state.run) return;
        const job = plan.jobs[i];
        setBusy(true, 'Creating file ' + (i + 1) + ' of ' + plan.jobs.length + '…');
        await T.tick();
        const out = await lib.PDFDocument.create();
        const copied = await out.copyPages(state.doc, job.pages.map((p) => p - 1));
        copied.forEach((p) => out.addPage(p));
        out.setProducer('Hira Science Academy PDF Splitter');
        const bytes = await out.save();
        const blob = new Blob([bytes], { type: 'application/pdf' });
        outputs.push({ filename: job.filename, pages: job.pages.length, blob, first: job.pages[0], last: job.pages[job.pages.length - 1] });
        progressBar.style.width = Math.round((i + 1) / plan.jobs.length * 100) + '%';
      }
      if (run !== state.run) return;
      state.outputs = outputs;
      showResults();
      T.track(TOOL, 'pdf_split_success');
    } catch (err) {
      if (run === state.run) showError(isMemory(err)
        ? 'The browser ran out of memory while splitting. Try fewer pages at a time, a smaller file, or close other tabs.'
        : 'Splitting failed. The PDF may use a feature this tool cannot copy. Try the Extract pages option with a smaller range.');
    } finally {
      if (run === state.run) {
        state.running = false; setBusy(false); progress.hidden = true;
        cancelBtn.hidden = true; splitBtn.disabled = !state.doc; settings.disabled = !state.doc;
      }
    }
  }
  function cancel() {
    state.run++; state.running = false;
    setBusy(false); progress.hidden = true; cancelBtn.hidden = true;
    splitBtn.disabled = !state.doc; settings.disabled = !state.doc;
  }

  /* ---------- Results ---------- */
  function clearResults() {
    state.outputs = [];
    resultList.textContent = '';
    resultPanel.classList.remove('is-visible');
    zipBtn.hidden = true;
  }
  function showResults() {
    const outs = state.outputs;
    resultList.textContent = '';
    let total = 0;
    outs.forEach((o, i) => {
      total += o.blob.size;
      const li = document.createElement('li'); li.className = 'out-row';
      const info = document.createElement('div'); info.className = 'out-info';
      const nm = document.createElement('p'); nm.className = 'out-name'; nm.textContent = o.filename;
      const meta = document.createElement('p'); meta.className = 'out-meta';
      meta.textContent = T.plural(o.pages, 'page') + ' · ' + T.formatBytes(o.blob.size);
      info.appendChild(nm); info.appendChild(meta);
      const a = document.createElement('a');
      a.className = 'btn-calc btn-secondary-calc dl-link';
      a.textContent = 'Download';
      a.href = T.makeUrl(o.blob); a.download = o.filename;
      a.setAttribute('aria-label', 'Download ' + o.filename);
      a.addEventListener('click', () => T.track(TOOL, 'pdf_split_download'));
      li.appendChild(info); li.appendChild(a); resultList.appendChild(li);
    });
    resultTitle.textContent = outs.length === 1 ? 'Your PDF is ready' : T.plural(outs.length, 'PDF file') + ' created';
    resultNote.textContent = outs.length === 1 ? 'Your file is ready to download.' : 'Download the files one by one, or all together in a ZIP file. Total size ' + T.formatBytes(total) + '.';
    zipBtn.hidden = outs.length < 2;
    resultPanel.classList.add('is-visible');
    resultPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  async function downloadZip() {
    if (!state.outputs.length) return;
    zipBtn.disabled = true;
    const label = zipBtn.textContent; zipBtn.textContent = 'Building ZIP…';
    try {
      const zip = await T.makeZip(state.outputs.map((o) => ({ name: o.filename, blob: o.blob })));
      T.saveBlob(zip, state.name + '-split.zip');
      T.track(TOOL, 'pdf_split_download');
    } catch (_) { showError('The ZIP file could not be created. Download the files one by one instead.'); }
    finally { zipBtn.disabled = false; zipBtn.textContent = label; }
  }

  /* ---------- Reset ---------- */
  function resetAll(keepFileInfo) {
    state.run++; state.running = false;
    state.queue.clear();
    if (state.observer) { state.observer.disconnect(); state.observer = null; }
    state.thumbUrls.forEach(T.freeUrl); state.thumbUrls = [];
    if (state.preview) { try { state.preview.destroy(); } catch (_) { /* ignore */ } }
    state.preview = null; state.previewTried = false; state.gridBuilt = false;
    state.doc = null; state.bytes = null; state.pages = 0; state.selected.clear();
    resultList.querySelectorAll('a').forEach((a) => T.freeUrl(a.href));
    clearResults();
    grid.textContent = ''; $('preview-note').hidden = true; updateSelCount();
    settings.disabled = true; splitBtn.disabled = true; cancelBtn.hidden = true; progress.hidden = true; setBusy(false);
    if (!keepFileInfo) { fileInfo.hidden = true; fileNameEl.textContent = ''; fileMetaEl.textContent = ''; }
  }
  function startOver() {
    state.loadToken++;
    resetAll(false); clearError();
    $('extract-pages').value = ''; $('ranges-text').value = ''; $('equal-count').value = '2'; $('chunk-size').value = '10';
    modeInputs.find((r) => r.value === 'extract').checked = true;
    modeInputs.forEach((r) => { r.disabled = false; });
    updatePanels();
    T.track(TOOL, 'pdf_split_reset');
    dropzone.scrollIntoView({ behavior: 'smooth', block: 'center' });
    dropzone.focus();
  }

  /* ---------- Events ---------- */
  fileInput.addEventListener('change', () => { const f = fileInput.files; handleFile(f && f[0], f ? f.length : 0); fileInput.value = ''; });
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
  changeBtn.addEventListener('click', () => fileInput.click());
  modeInputs.forEach((r) => r.addEventListener('change', () => { clearError(); updatePanels(); }));
  $('sel-all').addEventListener('click', () => setSelection(() => true));
  $('sel-none').addEventListener('click', () => setSelection(() => false));
  $('sel-odd').addEventListener('click', () => setSelection((n) => n % 2 === 1));
  $('sel-even').addEventListener('click', () => setSelection((n) => n % 2 === 0));
  splitBtn.addEventListener('click', split);
  cancelBtn.addEventListener('click', cancel);
  zipBtn.addEventListener('click', downloadZip);
  againBtn.addEventListener('click', startOver);
  settings.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox' && e.target.type !== 'radio') { e.preventDefault(); splitBtn.click(); } });
  window.addEventListener('pagehide', () => { try { if (state.preview) state.preview.destroy(); } catch (_) { /* ignore */ } });

  updatePanels();
})();
