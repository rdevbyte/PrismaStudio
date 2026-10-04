/* ============================================================
   TabulaMetrics — Application shell & dashboard renderer
   ============================================================ */
(function (global) {
  'use strict';
  const A = global.TabulaMetricsAnalysis, I = global.TabulaMetricsInsights, C = global.TabulaMetricsCharts, P = global.TabulaMetricsParse;
  const Pipeline = global.TabulaMetricsPipeline;
  const { fmtNum, fmtPct, fmtP, fmtQ, fmtDate } = A;
  const esc = I.esc, trunc = I.trunc;
  const WORKER_SOURCE = global.__TABULAMETRICS_WORKER_SOURCE__ || null;
  const MAX_FILE_BYTES = 50 * 1024 * 1024;
  const MAX_PASTE_CHARS = 50 * 1024 * 1024;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const el = (id) => document.getElementById(id);

  const STATE = {
    dataset: null, types: Object.create(null), analysis: null, filters: {}, pivot: {}, explore: {},
    attestation: null, pendingScan: null, pendingDataset: null, pendingTypes: null,
    worker: null, workerUrl: null, taskId: 0,
  };

  /* ================= theming ================= */
  const THEMES = ['daylight', 'sandstone', 'ember', 'burgundy'];
  const LEGACY_THEMES = { light: 'daylight', dark: 'ember', neon: 'ember', ocean: 'sandstone', sunset: 'daylight', corporate: 'daylight', pastel: 'sandstone', mono: 'daylight', lavender: 'sandstone', midnight: 'ember', evergreen: 'burgundy' };
  function setTheme(theme) {
    const t = THEMES.includes(theme) ? theme : (LEGACY_THEMES[theme] || 'daylight');
    document.documentElement.setAttribute('data-theme', t);
    const sel = el('themeSel');
    if (sel && sel.value !== t) sel.value = t;
    try { localStorage.setItem('tabulametrics-theme', t); } catch (e) { }
  }

  /* ================= boot ================= */
  function boot() {
    try { setTheme(localStorage.getItem('tabulametrics-theme') || 'daylight'); } catch (e) { setTheme('daylight'); }
    const sel = el('themeSel');
    sel.addEventListener('change', () => setTheme(sel.value));

    const drop = el('dropzone'), input = el('fileInput');
    drop.addEventListener('click', () => input.click());
    drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    input.addEventListener('change', () => { if (input.files[0]) handleFile(input.files[0]); });
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) handleFile(f); });
    document.addEventListener('paste', (e) => {
      if (STATE.dataset) return;
      const txt = (e.clipboardData || window.clipboardData).getData('text');
      if (!txt || txt.trim().length <= 20 || !/[,\t;|]/.test(txt)) return;
      if (txt.length > MAX_PASTE_CHARS) return showError('Pasted data is too large', 'Maximum pasted text is 50 MiB. Save it as a file and filter it before importing.');
      processPaste(txt);
    });
    el('sampleBtn').addEventListener('click', loadSample);
    el('sampleInsuranceBtn').addEventListener('click', loadInsuranceSample);
    el('clearBtn').addEventListener('click', clearSession);
    el('exportBtn').addEventListener('click', exportReport);
    el('busyCancel').addEventListener('click', cancelCurrentTask);
  }

  function animateKpis() {
    if (!global.TabulaMetricsAnim || !global.TabulaMetricsAnim.enabled) return;
    $$('.kvalue').forEach((node) => {
      const raw = node.textContent.trim();
      // only count up pure numeric/percent/currency values
      const m = /^([+-]?)([$]?)([\d,]+(?:\.\d+)?)(%|\/100)?$/.exec(raw);
      if (!m) return;
      const [, sign, cur, digits, suffix] = m;
      const target = parseFloat(digits.replace(/,/g, '')) * (sign === '-' ? -1 : 1);
      const decimals = (digits.split('.')[1] || '').length;
      global.TabulaMetricsAnim.countUp(node, target, (v) => {
        const s = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
        return (v < 0 ? '-' : sign === '+' ? '+' : '') + cur + s + (suffix || '');
      });
    });
  }

  function toast(msg, kind = 'info') {
    const t = el('toast');
    t.textContent = msg; t.className = 'toast show ' + kind;
    setTimeout(() => { t.className = 'toast'; }, 4200);
  }

  /* ================= file handling ================= */
  function handleFile(file) {
    if (file.size > MAX_FILE_BYTES) return showError('File too large', 'Maximum file size is 50 MiB. Try filtering the data or splitting the file.');
    showBusy('Reading and parsing file…');
    const started = dispatchWorker('parse-file', { file }, showBusy, (data) => {
      if (data.type === 'error') { hideBusy(); return showError('Could not read that file', data.message); }
      acceptPrepared(data.dataset, data.scan, data.types);
    }, (error, id) => fallbackPrepare('parse-file', { file }, id));
    if (!started) fallbackPrepare('parse-file', { file }, STATE.taskId);
  }

  function processPaste(text) {
    showBusy('Parsing pasted data…');
    const payload = { text, name: 'pasted-data.csv' };
    const started = dispatchWorker('parse-text', payload, showBusy, (data) => {
      if (data.type === 'error') { hideBusy(); return showError('Could not read pasted data', data.message); }
      acceptPrepared(data.dataset, data.scan, data.types);
    }, (error, id) => fallbackPrepare('parse-text', payload, id));
    if (!started) fallbackPrepare('parse-text', payload, STATE.taskId);
  }

  function loadDataset(ds) {
    STATE.attestation = null;
    STATE.pendingScan = null;
    STATE.pendingDataset = null;
    STATE.pendingTypes = null;
    showBusy('Checking the dataset…');
    const payload = { dataset: ds };
    const started = dispatchWorker('prepare-dataset', payload, showBusy, (data) => {
      if (data.type === 'error') { hideBusy(); return showError('Could not prepare that dataset', data.message); }
      acceptPrepared(data.dataset, data.scan, data.types);
    }, (error, id) => fallbackPrepare('prepare-dataset', payload, id));
    if (!started) fallbackPrepare('prepare-dataset', payload, STATE.taskId);
  }

  function cancelWorker() {
    STATE.taskId++;
    if (STATE.worker) STATE.worker.terminate();
    if (STATE.workerUrl) URL.revokeObjectURL(STATE.workerUrl);
    STATE.worker = null;
    STATE.workerUrl = null;
  }

  function dispatchWorker(task, payload, onProgress, onComplete, onCrash) {
    cancelWorker();
    const id = STATE.taskId;
    if (!WORKER_SOURCE || typeof global.Worker !== 'function' || typeof global.Blob !== 'function' || !global.URL || !URL.createObjectURL) return false;
    let worker, url;
    try {
      url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
      worker = new global.Worker(url);
    } catch (error) {
      if (url) URL.revokeObjectURL(url);
      return false;
    }
    STATE.worker = worker;
    STATE.workerUrl = url;
    const release = () => {
      if (STATE.worker !== worker) return;
      worker.terminate();
      URL.revokeObjectURL(url);
      STATE.worker = null;
      STATE.workerUrl = null;
    };
    worker.onmessage = (event) => {
      const data = event.data || {};
      if (id !== STATE.taskId || data.id !== id || STATE.worker !== worker) return;
      if (data.type === 'progress') { onProgress(data.message); return; }
      release();
      onComplete(data);
    };
    worker.onerror = (event) => {
      if (id !== STATE.taskId || STATE.worker !== worker) return;
      event.preventDefault();
      release();
      onCrash(new Error(event.message || 'The background worker stopped unexpectedly.'), id);
    };
    try { worker.postMessage({ id, task, payload }); }
    catch (error) {
      release();
      onCrash(error, id);
    }
    return true;
  }

  async function fallbackPrepare(task, payload, id) {
    try {
      let ds;
      if (task === 'parse-file') ds = await P.parseFile(payload.file);
      else if (task === 'parse-text') ds = P.parseText(payload.text, payload.name);
      else ds = payload.dataset;
      if (id !== STATE.taskId) return;
      showBusy('Checking column names and data for sensitive-data indicators…');
      const scan = P.healthScan(ds.columns, ds.rows);
      const types = Object.create(null);
      for (const column of ds.columns) types[column] = A.inferType(ds.rows.map((row) => row[column]), column);
      if (id === STATE.taskId) acceptPrepared(ds, scan, types);
    } catch (error) {
      if (id !== STATE.taskId) return;
      hideBusy();
      showError('Could not read that data', error.message || String(error));
    }
  }

  function acceptPrepared(ds, scan, types) {
    hideBusy();
    STATE.pendingScan = scan;
    if (scan.blocked) {
      // Keep the parsed file in memory only while the user decides whether to
      // discard it or explicitly attest that it contains no PHI.
      STATE.pendingDataset = ds;
      STATE.pendingTypes = types;
      return showHealthBlock(scan);
    }
    STATE.pendingDataset = null;
    STATE.pendingTypes = null;
    acceptDataset(ds, types);
  }

  function acceptDataset(ds, types) {
    STATE.dataset = ds;
    STATE.types = Object.assign(Object.create(null), types || {});
    if (!types) ds.columns.forEach((c) => { STATE.types[c] = A.inferType(ds.rows.map((r) => r[c]), c); });
    hideBusy();
    renderPreview();
  }

  function showBusy(msg) { el('busy').style.display = 'flex'; el('busyMsg').textContent = msg; }
  function hideBusy() { el('busy').style.display = 'none'; }
  function cancelCurrentTask() {
    cancelWorker();
    hideBusy();
    if (STATE.dataset && !STATE.analysis) renderPreview();
    toast('Operation canceled. Data remains only in this browser session.');
  }

  function showError(title, msg) {
    el('modalRoot').innerHTML = `<div class="modal-bg"><div class="modal"><div class="modal-icon err">!</div><h3>${esc(title)}</h3><p>${esc(msg)}</p><div class="modal-actions"><button class="btn primary" id="errorDismiss">Got it</button></div></div></div>`;
    el('errorDismiss').addEventListener('click', () => { el('modalRoot').innerHTML = ''; });
  }
  function showHealthBlock(scan) {
    const terms = scan.terms || [];
    STATE.pendingScan = scan;
    el('modalRoot').innerHTML = `<div class="modal-bg"><div class="modal"><div class="modal-icon err">\u26d4</div>
      <h3>This file may contain health data</h3>
      <p>The local heuristic found clinical terms. The file has <b>not</b> been statistically analysed and remains only in your browser's memory. This detector is not a reliable PHI classifier; do not use it as a guarantee that sensitive data is safe to process.</p>
      <p class="dim small">Matched: ${terms.map((t) => `\u201c${esc(t)}\u201d`).join(', ') || 'clinical terminology'}</p>
      ${scan.declarationHint ? '<div class="note warn">A possible no-PHI or de-identification phrase appears in the file. It is only file text, not proof, and does not bypass this confirmation.</div>' : ''}

      <div class="note">If this is a <b>false positive</b> and you have verified that the file contains no protected health information, confirm below to continue. Otherwise cancel to discard it.</div>

      <label class="attest">
        <input type="checkbox" id="attestBox" />
        <span>I confirm this file contains <b>no protected health information</b> and that I am authorised to analyse it.</span>
      </label>

      <div class="modal-actions">
        <button class="btn" id="hbCancel">Cancel</button>
        <button class="btn primary" id="hbProceed" disabled>Analyse anyway</button>
      </div>
      <p class="dim small mt-s">Analysis runs in your browser. The app does not upload or persist file contents; they remain in this session's memory.</p>
    </div></div>`;
    if (global.TabulaMetricsAnim) global.TabulaMetricsAnim.modalIn($('.modal'));
    const box = el('attestBox'), go = el('hbProceed');
    box.addEventListener('change', () => { go.disabled = !box.checked; });
    el('hbCancel').addEventListener('click', () => {
      el('modalRoot').innerHTML = '';
      STATE.dataset = null; STATE.pendingScan = null; STATE.pendingDataset = null; STATE.pendingTypes = null;
      el('fileInput').value = '';
    });
    go.addEventListener('click', () => {
      if (!box.checked) return;
      // Record the attestation in-memory for this session only, so the report
      // and any export show when it was made, the filename, and matched terms.
      const ds = STATE.pendingDataset, types = STATE.pendingTypes;
      STATE.attestation = { at: new Date().toISOString(), terms, file: ds && ds.name };
      STATE.pendingDataset = null; STATE.pendingTypes = null;
      el('modalRoot').innerHTML = '';
      if (ds) acceptDataset(ds, types);
    });
  }

  /* ================= preview & type editor ================= */
  const TYPE_OPTIONS = ['number', 'currency', 'percent', 'date', 'category', 'boolean', 'text', 'id'];

  function renderPreview() {
    const ds = STATE.dataset;
    const cols = ds.columns;
    const head = cols.map((c) => `<th><div class="ph">${esc(c)}</div>
      <select data-col="${esc(c)}" class="typesel">${TYPE_OPTIONS.map((t) => `<option value="${t}"${STATE.types[c] === t ? ' selected' : ''}>${t}</option>`).join('')}</select></th>`).join('');
    const body = ds.rows.slice(0, 8).map((r) => `<tr>${cols.map((c) => `<td>${esc(trunc(String(r[c] ?? ''), 28))}</td>`).join('')}</tr>`).join('');
    const counts = {};
    cols.forEach((c) => { counts[STATE.types[c]] = (counts[STATE.types[c]] || 0) + 1; });
    el('modalRoot').innerHTML = `<div class="modal-bg"><div class="modal wide">
      <h3>Preview: ${esc(ds.name)}</h3>
      <p class="dim small">${ds.rows.length.toLocaleString()} rows × ${cols.length} columns · parsed in ${ds.parseMs}ms${ds.sheetName ? ` · sheet “${esc(ds.sheetName)}”` : ''}${ds.headerRow ? ` · header found on row ${ds.headerRow + 1}` : ''}</p>
      ${STATE.attestation ? '<div class="note ok">You confirmed that this file contains no protected health information. The detector is heuristic and cannot verify that claim; analysis remains local to this browser session.</div>' : ''}
      <div class="chips">${Object.entries(counts).map(([t, n]) => `<span class="chip">${n} ${t}</span>`).join('')}</div>
      <div class="tablewrap preview"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
      <p class="dim small">Types drive the whole report: numeric columns become metrics, categories become drivers and segments, dates unlock trends. Adjust anything that looks wrong.</p>
      <div class="modal-actions"><button class="btn" id="cancelBtn">Cancel</button><button class="btn primary" id="analyzeBtn">Analyse →</button></div>
    </div></div>`;
    if (global.TabulaMetricsAnim) global.TabulaMetricsAnim.modalIn($('.modal'));
    $$('.typesel').forEach((s) => s.addEventListener('change', () => { STATE.types[s.dataset.col] = s.value; }));
    el('cancelBtn').addEventListener('click', () => { el('modalRoot').innerHTML = ''; STATE.dataset = null; });
    el('analyzeBtn').addEventListener('click', () => { el('modalRoot').innerHTML = ''; runAnalysis(); });
  }

  /* ================= analysis orchestration ================= */
  function runAnalysis() {
    showBusy('Analysing…');
    const payload = { dataset: STATE.dataset, types: STATE.types };
    const started = dispatchWorker('analyse', payload, showBusy, (data) => {
      if (data.type === 'error') {
        hideBusy();
        return showError('Analysis failed', data.message);
      }
      STATE.analysis = hydrateAnalysis(data.result);
      hideBusy();
      renderDashboard();
    }, (error, id) => fallbackAnalysis(payload, id));
    if (!started) fallbackAnalysis(payload, STATE.taskId);
  }

  function fallbackAnalysis(payload, id) {
    setTimeout(() => {
      if (id !== STATE.taskId) return;
      try {
        STATE.analysis = hydrateAnalysis(Pipeline.analyse(payload.dataset, payload.types));
        hideBusy();
        renderDashboard();
      } catch (error) {
        hideBusy();
        console.error(error);
        showError('Analysis failed', error.message || String(error));
      }
    }, 30);
  }

  function hydrateAnalysis(result) {
    result.typeOf = (name) => (result.byName && result.byName[name] ? result.byName[name].type : 'text');
    return result;
  }

  const analyse = (ds, types) => Pipeline.analyse(ds, types);

  /* ================= dashboard ================= */
  function renderDashboard() {
    const a = STATE.analysis, ds = STATE.dataset;
    el('landing').style.display = 'none';
    el('appbar').classList.add('active');
    const root = el('dashboard');
    root.style.display = 'block';
    root.innerHTML = `
      <div class="workspace-layout">
        <aside class="workspace-rail" aria-label="Dataset and report navigation">
          <section class="dataset-card">
            <div class="dataset-card-head">
              <span class="dataset-file-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none"><path d="M6 3.75h8l4 4v12.5H6a2 2 0 0 1-2-2v-12a2.5 2.5 0 0 1 2-2.5Z"/><path d="M14 4v4h4M8 12h8M8 15.5h8"/></svg>
              </span>
              <div class="dataset-copy">
                <span class="rail-kicker">CURRENT DATASET</span>
                <strong title="${esc(ds.name)}">${esc(ds.name)}</strong>
                <span>${ds.rows.length.toLocaleString()} rows · ${ds.columns.length} columns</span>
              </div>
            </div>
            <div class="dataset-status"><span class="local-status"><i aria-hidden="true"></i>LOCAL SESSION</span><span>${a.findings.length} findings</span></div>
            ${a.domain ? `<span class="domain-chip">${esc(a.domain.label)} detected</span>` : ''}
            ${STATE.attestation ? `<span class="attest-chip" title="Attested ${esc(STATE.attestation.at)}">No-PHI attestation on file</span>` : ''}
            <button class="btn rail-upload" id="replaceFileBtn" type="button"><span aria-hidden="true">＋</span>Open another file</button>
          </section>
          ${renderNav()}
          <section class="rail-privacy" aria-label="Privacy status">
            <span class="rail-lock" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M6 10h12v10H6zM8.5 10V7.5a3.5 3.5 0 0 1 7 0V10"/><path d="M12 14v2"/></svg></span>
            <div><strong>Private by default</strong><span>Files stay in this browser session.</span></div>
          </section>
        </aside>

        <section class="workspace-main" aria-label="Analysis workspace">
          <header class="workspace-pagehead">
            <div class="workspace-title">
              <div class="eyebrow"><span class="eyebrow-dot" aria-hidden="true"></span> ANALYSIS WORKSPACE</div>
              <h1>Analysis overview</h1>
              <p>Explore patterns in <strong>${esc(ds.name)}</strong> and decide what to investigate next.</p>
            </div>
            <div class="workspace-meta" aria-label="Analysis status">
              <span class="meta-chip complete"><i aria-hidden="true"></i>Analysis complete</span>
              <span class="meta-chip">${a.elapsed} ms</span>
            </div>
          </header>
          <div id="tab-overview" class="tabpane active">${renderOverview(a)}</div>
          <div id="tab-findings" class="tabpane">${renderFindings(a)}${renderActions(a)}</div>
          <div id="tab-drivers" class="tabpane">${renderDrivers(a)}</div>
          <div id="tab-relations" class="tabpane">${renderRelations(a)}</div>
          <div id="tab-segments" class="tabpane">${renderSegments(a)}</div>
          <div id="tab-columns" class="tabpane">${renderColumns(a)}</div>
          <div id="tab-time" class="tabpane">${renderTime(a)}</div>
          <div id="tab-quality" class="tabpane">${renderQuality(a)}</div>
          <div id="tab-explore" class="tabpane">${renderExplore(a)}</div>
          <div id="tab-data" class="tabpane">${renderDataTab(a)}</div>
        </section>
      </div>
    `;
    wireDashboard(a);
    window.scrollTo(0, 0);
    if (global.TabulaMetricsAnim) {
      global.TabulaMetricsAnim.enterDashboard(root);
      requestAnimationFrame(() => global.TabulaMetricsAnim.observe(el('tab-overview')));
      animateKpis();
    }
  }

  const TABS = [
    ['overview', 'Overview', '◫'], ['findings', 'Findings', '✦'], ['drivers', 'Drivers', '↗'],
    ['relations', 'Relationships', '⇄'], ['segments', 'Segments', '▤'], ['columns', 'Column profiles', '▥'],
    ['time', 'Trends', '⌁'], ['quality', 'Data quality', '◉'], ['explore', 'Explore', '⌘'], ['data', 'Data preview', '▦'],
  ];
  function renderNav() {
    return `<nav class="workspace-nav tabs" aria-label="Report sections"><div class="rail-kicker nav-kicker">EXPLORE REPORT</div>${TABS.map(([id, label, icon], i) => `<button class="tab${i === 0 ? ' active' : ''}" type="button" data-tab="${id}" aria-controls="tab-${id}" aria-current="${i === 0 ? 'page' : 'false'}"><span class="tab-icon" aria-hidden="true">${icon}</span><span class="tab-label">${label}</span></button>`).join('')}</nav>`;
  }

  // Keep a newly selected report view at the top of the main workspace while
  // the dataset rail remains available as a persistent navigation anchor.
  function scrollToTabs() {
    const main = $('.workspace-main'), bar = $('.appbar');
    if (!main) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    const barH = bar ? bar.getBoundingClientRect().height : 0;
    const y = window.scrollY + main.getBoundingClientRect().top - barH - 10;
    window.scrollTo({ top: Math.max(0, Math.round(y)), behavior: 'smooth' });
  }

  function renderKpiStrip(a) {
    const cards = [];
    cards.push({ label: 'Rows analysed', value: a.rows.length.toLocaleString(), sub: `${a.columns.length} columns` });
    cards.push({ label: 'Data quality', value: a.quality.score + '/100', sub: `${a.quality.issues.length} issue${a.quality.issues.length === 1 ? '' : 's'}`, tone: a.quality.score >= 90 ? 'pos' : a.quality.score >= 70 ? 'warn' : 'neg' });
    const kpiDriver = a.driverResults.find((d) => d.metric === a.primaryMetric) || a.driverResults[0];
    if (kpiDriver) {
      cards.push({ label: 'Top adjusted association', value: trunc(kpiDriver.driver, 22), sub: `ω² ${(kpiDriver.omega2 || 0).toFixed(2)} · ${trunc(kpiDriver.metric, 16)}`, tone: 'accent' });
    }
    if (a.correlations.length) {
      const c = a.correlations[0];
      cards.push({ label: 'Strongest link', value: (c.r >= 0 ? '+' : '') + c.r.toFixed(2), sub: `${trunc(c.a, 12)} ↔ ${trunc(c.b, 12)}`, tone: 'accent' });
    }
    cards.push({ label: 'Outliers', value: a.anomalies.length, sub: `${a.anomalies.filter((x) => x.severity === 'high').length} extreme`, tone: a.anomalies.length ? 'warn' : 'pos' });
    if (a.forecastResult) {
      const f = a.forecastResult.fit;
      // A projection off a near-zero R² is noise; label it rather than implying precision.
      if (f.r2 < 0.15) {
        cards.push({ label: 'Projection', value: 'No trend', sub: `R² ${f.r2.toFixed(2)} — not forecastable`, tone: '' });
      } else {
        // Baseline against the FITTED value at the last actual date, not the last raw
        // observation — a single noisy or partial final period otherwise produces
        // absurd percentages (e.g. +2600%).
        const endPt = a.forecastResult.points[a.forecastResult.points.length - 1];
        const t0 = a.series[0].t;
        const lastX = (a.series[a.series.length - 1].t - t0) / 86400000;
        const baseline = f.slope * lastX + f.intercept;
        const chg = Math.abs(baseline) > 1e-9 ? ((endPt.value - baseline) / Math.abs(baseline)) * 100 : 0;
        cards.push({ label: 'Projection', value: (chg >= 0 ? '+' : '') + chg.toFixed(1) + '%', sub: `R² ${f.r2.toFixed(2)} · ${a.forecastResult.points.length} steps · vs trend`, tone: chg >= 0 ? 'pos' : 'neg' });
      }
    }
    if (a.primaryMetric) {
      const p = a.byName[a.primaryMetric];
      cards.push({ label: 'Median ' + trunc(a.primaryMetric, 16), value: fmtNum(p.median, { currency: p.type === 'currency' }), sub: `mean ${fmtNum(p.mean, { currency: p.type === 'currency' })}` });
    }
    return `<div class="kpis">${cards.map((c) => `<div class="kpi ${c.tone || ''}"><div class="klabel">${esc(c.label)}</div><div class="kvalue">${esc(String(c.value))}</div><div class="ksub">${esc(c.sub || '')}</div></div>`).join('')}</div>`;
  }

  /* ---------- overview workspace ---------- */
  function renderOverview(a) {
    const topFindings = a.findings.slice(0, 3);
    const cols = a.columns.slice(0, 6);
    const previewRows = a.rows.slice(0, 5);
    const preview = `<section class="card overview-preview">
      <div class="overview-card-head"><div><span class="rail-kicker">FIRST LOOK</span><h2>Data preview</h2><p>Sample rows from the file, kept in this browser session.</p></div>
        <button class="text-action overview-link" type="button" data-tab-link="data">View full dataset <span aria-hidden="true">→</span></button></div>
      <div class="tablewrap preview"><table class="datatable"><thead><tr>${cols.map((c) => `<th>${esc(c)}<span class="thtype">${esc(a.typeOf(c))}</span></th>`).join('')}</tr></thead>
        <tbody>${previewRows.map((r) => `<tr>${cols.map((c) => `<td>${esc(trunc(String(r[c] ?? ''), 32))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      ${a.columns.length > cols.length ? `<p class="dim small preview-note">Showing ${cols.length} of ${a.columns.length} columns and ${previewRows.length} sample rows.</p>` : ''}
    </section>`;
    const insights = topFindings.length ? topFindings.map((f, i) => `<article class="overview-insight ${f.tone}">
      <div class="insight-overline"><span class="insight-index">0${i + 1}</span><span class="ftag">${esc(f.kind)}</span></div>
      <h3>${esc(f.title)}</h3><p>${f.body}</p>
    </article>`).join('') : '<p class="empty">No notable patterns surfaced yet. Review the profile and data-quality sections for context.</p>';
    return `<div class="overview-stack">
      <section class="card summary overview-summary">
        <div class="overview-card-head summary-head"><div><span class="rail-kicker">A QUICK READ</span><h2>Executive summary</h2></div>
          <span class="summary-context"><i aria-hidden="true"></i>${a.rows.length.toLocaleString()} rows assessed</span></div>
        <p class="lead">${a.summary}</p>
      </section>
      <section class="overview-kpi-section" aria-labelledby="overviewKpisTitle">
        <div class="overview-section-head"><div><span class="rail-kicker">AT A GLANCE</span><h2 id="overviewKpisTitle">Key indicators</h2></div><span class="dim small">Computed locally from this dataset</span></div>
        ${renderKpiStrip(a)}
      </section>
      <div class="overview-grid">
        <div class="overview-main-column">${renderOverviewChart(a)}${preview}</div>
        <aside class="overview-side-column" aria-label="Highlights and recommended actions">
          <section class="card overview-insights-card"><div class="overview-card-head"><div><span class="rail-kicker">SIGNALS TO EXPLORE</span><h2>Key findings</h2></div><button class="text-action overview-link" type="button" data-tab-link="findings">All findings <span aria-hidden="true">→</span></button></div>
            <div class="overview-insights">${insights}</div>
          </section>
          ${renderActions(a, 'overview-actions')}
          <section class="rail-privacy overview-privacy"><span class="rail-lock" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M6 10h12v10H6zM8.5 10V7.5a3.5 3.5 0 0 1 7 0V10"/><path d="M12 14v2"/></svg></span><div><strong>Local, by design</strong><span>No dataset contents are uploaded or retained by the app.</span></div></section>
        </aside>
      </div>
    </div>`;
  }

  function renderOverviewChart(a) {
    let title = 'A closer look', note = 'A visual summary of the strongest available signal.', chart = '';
    const driver = a.driverResults.find((d) => d.metric === a.primaryMetric) || a.driverResults[0];
    if (driver) {
      const isCur = a.typeOf(driver.metric) === 'currency';
      title = `${driver.driver} and ${driver.metric}`;
      note = `Top adjusted association · ω² ${(driver.omega2 || 0).toFixed(2)} · BH ${fmtQ(driver.pAdj)} · observational, not causal`;
      chart = C.barH(driver.levels.slice(0, 8).map((l) => ({ label: l.key, value: l.mean, sub: `n=${l.n}`, color: l.lift >= 0 ? 'var(--c1)' : 'var(--c4)' })), { currency: isCur });
    } else if (a.correlations.length) {
      const c = a.correlations[0], pair = pairFor(a.rows, c.a, c.b);
      title = `${c.a} and ${c.b}`;
      note = `Strongest adjusted numeric relationship · r ${c.r >= 0 ? '+' : ''}${c.r.toFixed(2)} · BH ${fmtQ(c.pAdj)} · correlation is not causation`;
      chart = C.scatter(pair[0], pair[1], { width: 720, height: 280, xLabel: c.a, yLabel: c.b, xCurrency: a.typeOf(c.a) === 'currency', yCurrency: a.typeOf(c.b) === 'currency' });
    } else if (a.series && a.series.length) {
      const isCur = a.typeOf(a.primaryMetric) === 'currency';
      title = `${a.primaryMetric} over time`;
      note = `Time-series view · ${a.series.length} periods · projection is descriptive, not a guarantee`;
      chart = C.timeSeries(a.series, A.movingAverage(a.series, 7), a.forecastResult, { currency: isCur, width: 720, height: 280 });
    } else {
      note = 'No adjusted association or time series was available for a primary chart. The other report sections explain what could be tested.';
      chart = `<p class="empty overview-chart-empty">${esc(note)}</p>`;
    }
    return `<section class="card overview-chart-card"><div class="overview-card-head"><div><span class="rail-kicker">SIGNAL SNAPSHOT</span><h2>${esc(title)}</h2><p>${esc(note)}</p></div><button class="chart-link overview-link" type="button" data-tab-link="${driver ? 'drivers' : a.correlations.length ? 'relations' : 'time'}">Explore details <span aria-hidden="true">→</span></button></div><div class="overview-chart-scroll">${chart}</div></section>`;
  }

  /* ---------- findings ---------- */
  function renderFindings(a) {
    if (!a.findings.length) return '<section class="card"><p class="dim">No findings generated.</p></section>';
    const cards = a.findings.slice(0, 24).map((f) => `
      <article class="finding ${f.tone}">
        <div class="fhead"><span class="ficon">${f.icon}</span><h3>${esc(f.title)}</h3><span class="ftag">${f.kind}</span></div>
        <p class="fbody">${f.body}</p>
        <p class="fwhy"><b>How to read this:</b> ${esc(f.why)}</p>
      </article>`).join('');
    return `<section class="card"><div class="sechead"><span class="sicon">💡</span><h2>Findings</h2><span class="dim small">${a.findings.length} generated · ranked by statistical strength</span></div>
      <div class="findings">${cards}</div></section>`;
  }

  function renderActions(a, extraClass = '') {
    return `<section class="card ${extraClass}"><div class="sechead"><span class="sicon">🚀</span><h2>Recommended next steps</h2></div>
      <ul class="actions">${a.actions.map((x) => `<li><span>${x.icon}</span><div>${x.text}</div></li>`).join('')}</ul></section>`;
  }

  /* ---------- drivers ---------- */
  function renderDrivers(a) {
    if (!a.driverResults.length) {
      const tested = a.driverAll ? a.driverAll.length : 0;
      // Nothing cleared the bar. Distinguish "couldn't run" from "ran and
      // found no signal" — they need completely different responses.
      if (!tested) {
        return `<section class="card"><div class="sechead"><span class="sicon">🎯</span><h2>Driver analysis</h2></div>
          <p class="empty">Driver analysis needs at least one numeric metric and one categorical column with 2+ groups of 3+ rows each. This file has <b>${a.numCols.length} numeric</b> and <b>${a.baseCats.length} categorical</b> usable columns — check the column types in the preview step.</p></section>`;
      }
      const top = a.driverAll.slice(0, 12);
      const floor = top[0] ? top[0].noiseEta2 : (a.noise ? a.noise.eta2 : 0.0005);
      return `<section class="card">
        <div class="sechead"><span class="sicon">🎯</span><h2>No adjusted-significant drivers</h2><span class="dim small">${tested.toLocaleString()} combinations tested</span></div>
        <p class="explain"><b>No eligible driver/metric combination passed Benjamini–Hochberg false-discovery-rate adjustment at q &lt; 0.05.</b> The largest sample η² was <b>${(top[0].eta2 * 100).toFixed(2)}%</b> across ${top[0].levels.length} groups; the rough null expectation for that split is about ${(floor * 100).toFixed(2)}%. Ranked rows below are exploratory, not confirmed drivers.</p>
        <p class="explain">A lack of significant results does not prove the fields are independent. Small samples, missingness, sparse categories, nonlinear effects, or other assumptions can hide real patterns. The reported differences are descriptive and do not imply causation.</p>
        <h4 class="mt">Largest sample effects tested</h4>
        <div class="tablewrap"><table><thead><tr><th>Grouping</th><th>Metric</th><th class="num">η²</th><th class="num">ω²</th><th class="num">F</th><th class="num">BH q</th><th>Highest group</th><th>Lowest group</th></tr></thead><tbody>
        ${top.map((d) => `<tr><td><b>${esc(d.driver)}</b></td><td>${esc(d.metric)}</td>
          <td class="num">${(d.eta2 * 100).toFixed(3)}%</td><td class="num">${((d.omega2 || 0) * 100).toFixed(3)}%</td><td class="num">${isFinite(d.f) ? d.f.toFixed(2) : '∞'}</td><td class="num">${fmtQ(d.pAdj)}</td>
          <td>${esc(trunc(d.top.key, 18))} <span class="dim">${fmtNum(d.top.mean, { currency: a.typeOf(d.metric) === 'currency' })}</span></td>
          <td>${esc(trunc(d.bottom.key, 18))} <span class="dim">${fmtNum(d.bottom.mean, { currency: a.typeOf(d.metric) === 'currency' })}</span></td></tr>`).join('')}
        </tbody></table></div></section>`;
    }
    // lead with drivers of the headline metric so the most relevant rows are visible first
    const ordered = [...a.driverResults.filter((d) => d.metric === a.primaryMetric),
                     ...a.driverResults.filter((d) => d.metric !== a.primaryMetric)];
    const top = ordered.slice(0, 14);
    const rows = top.map((d) => `<tr>
        <td><b>${esc(d.driver)}</b></td><td>${esc(d.metric)}</td>
        <td class="num etacell"><span class="bar" style="--w:${Math.min(100, (d.omega2 || 0) * 100 * 2).toFixed(0)}%"></span><span class="etaval">${(d.eta2 * 100).toFixed(1)}% / ${((d.omega2 || 0) * 100).toFixed(1)}%</span></td>
        <td class="num">${d.f === Infinity ? '∞' : isFinite(d.f) ? d.f.toFixed(1) : '—'}</td><td class="num">${fmtQ(d.pAdj)}</td>
        <td>${esc(trunc(d.top.key, 18))} <span class="dim">${fmtNum(d.top.mean, { currency: a.typeOf(d.metric) === 'currency' })}</span></td>
        <td>${esc(trunc(d.bottom.key, 18))} <span class="dim">${fmtNum(d.bottom.mean, { currency: a.typeOf(d.metric) === 'currency' })}</span></td>
        <td class="num">${fmtNum(d.spread, { currency: a.typeOf(d.metric) === 'currency' })}</td>
      </tr>`).join('');

    const detail = top.slice(0, 6).map((d) => {
      const isCur = a.typeOf(d.metric) === 'currency';
      const items = d.levels.slice(0, 12).map((l) => ({ label: l.key, value: l.mean, sub: `n=${l.n}`, color: l.lift >= 0 ? 'var(--c1)' : 'var(--c4)' }));
      return `<div class="subcard">
        <h4>${esc(d.driver)} → ${esc(d.metric)}</h4>
        <p class="dim small">η² = ${d.eta2.toFixed(3)} · bias-adjusted ω² = ${(d.omega2 || 0).toFixed(3)} · F = ${d.f === Infinity ? '∞' : isFinite(d.f) ? d.f.toFixed(1) : '—'} · BH ${fmtQ(d.pAdj)} · ${d.levels.length} groups · n = ${d.n}</p>
        ${C.barH(items, { currency: isCur })}
        <table class="mini"><thead><tr><th>Group</th><th class="num">n</th><th class="num">Mean</th><th class="num">Median</th><th class="num">vs avg</th></tr></thead>
        <tbody>${d.levels.slice(0, 12).map((l) => `<tr><td>${esc(trunc(l.key, 26))}</td><td class="num">${l.n}</td><td class="num">${fmtNum(l.mean, { currency: isCur })}</td><td class="num">${fmtNum(l.median, { currency: isCur })}</td><td class="num ${l.lift >= 0 ? 'pos' : 'neg'}">${l.lift >= 0 ? '+' : ''}${l.lift.toFixed(1)}%</td></tr>`).join('')}</tbody></table>
      </div>`;
    }).join('');

    return `<section class="card">
      <div class="sechead"><span class="sicon">🎯</span><h2>Adjusted associations with metrics</h2><span class="dim small">one-way ANOVA · BH-adjusted q · observational</span></div>
      <p class="explain">η² is the sample share of variance across groups; ω² is a bias-adjusted effect-size estimate. Results shown here passed Benjamini–Hochberg false-discovery-rate adjustment at q &lt; 0.05. These are observational associations—not causal drivers—and effect sizes can still be uncertain for small or sparse groups. Numeric fields are also bucketed into quintiles.</p>
      <div class="tablewrap"><table><thead><tr><th>Grouping</th><th>Metric</th><th class="num">η² / ω²</th><th class="num">F</th><th class="num">BH q</th><th>Highest group</th><th>Lowest group</th><th class="num">Spread</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="grid2">${detail}</div>
    </section>`;
  }

  /* ---------- relationships ---------- */
  function renderRelations(a) {
    let html = '<section class="card"><div class="sechead"><span class="sicon">🔗</span><h2>Numeric relationships</h2><span class="dim small">Pearson r, Spearman ρ · BH-adjusted q</span></div>';
    if (!a.correlations.length) {
      const all = a.correlationsAll || [];
      if (!all.length) {
        html += `<p class="empty">Only ${a.numCols.length} usable numeric column${a.numCols.length === 1 ? '' : 's'} were found, so there are no pairs to correlate. Check the column types in the preview step.</p>`;
      } else {
        const strongestRef = A.noiseFloor(all[0].n).r;
        html += `<p class="explain"><b>No numeric pair passed BH false-discovery-rate adjustment at q &lt; 0.05.</b> The largest observed |r| was ${Math.abs(all[0].r).toFixed(3)} (q = ${fmtQ(all[0].pAdj)}; approximate 95% null reference ±${strongestRef.toFixed(3)} for n = ${all[0].n}). This is not proof that the fields are independent.</p>
        <p class="explain">The table shows the largest observed pairs for exploration. Correlation tests assume independent observations and a roughly appropriate Pearson/Spearman model; validate important findings on fresh data.</p>
        <h4 class="mt">Largest observed pairs</h4>
        <div class="tablewrap"><table><thead><tr><th>Field A</th><th>Field B</th><th class="num">r</th><th class="num">r²</th><th class="num">Spearman ρ</th><th class="num">n</th><th class="num">BH q</th></tr></thead><tbody>
        ${all.slice(0, 12).map((c) => `<tr><td>${esc(c.a)}</td><td>${esc(c.b)}</td>
          <td class="num ${c.r >= 0 ? 'pos' : 'neg'}">${c.r.toFixed(4)}</td><td class="num">${(c.r * c.r * 100).toFixed(2)}%</td>
          <td class="num">${isFinite(c.rho) ? c.rho.toFixed(4) : '—'}</td><td class="num">${c.n}</td><td class="num">${fmtQ(c.pAdj)}</td></tr>`).join('')}
        </tbody></table></div>`;
      }
    } else {
      html += `<p class="explain">r measures straight-line association from −1 to +1. r² is the sample variance shared; Spearman ρ captures rank-order association. Values shown passed BH adjustment across the tested numeric pairs, but correlation is not causation.</p>
      <div class="tablewrap"><table><thead><tr><th>Field A</th><th>Field B</th><th class="num">r</th><th class="num">r²</th><th class="num">Spearman ρ</th><th class="num">n</th><th class="num">BH q</th><th>Reading</th></tr></thead><tbody>
      ${a.correlations.slice(0, 25).map((c) => `<tr><td>${esc(c.a)}</td><td>${esc(c.b)}</td>
        <td class="num ${c.r >= 0 ? 'pos' : 'neg'}"><b>${c.r.toFixed(3)}</b></td><td class="num">${(c.r * c.r * 100).toFixed(0)}%</td>
        <td class="num">${isFinite(c.rho) ? c.rho.toFixed(3) : '—'}</td><td class="num">${c.n}</td><td class="num">${fmtQ(c.pAdj)}</td>
        <td>${esc(c.strength)}${c.nonlinear ? ' <span class="tagpill">monotonic / curved</span>' : ''}</td></tr>`).join('')}
      </tbody></table></div>`;
      if (a.numCols.length >= 3) {
        const cols = a.numCols.slice(0, 14);
        const map = new Map();
        a.correlations.forEach((c) => { map.set(c.a + '|' + c.b, c.r); map.set(c.b + '|' + c.a, c.r); });
        const rowsPairs = [];
        for (let i = 0; i < cols.length; i++) for (let j = 0; j < cols.length; j++) {
          if (i < j && !map.has(cols[i] + '|' + cols[j])) {
            const [xs, ys] = pairFor(a.rows, cols[i], cols[j]);
            const r = xs.length > 5 ? A.pearson(xs, ys) : null;
            map.set(cols[i] + '|' + cols[j], r); map.set(cols[j] + '|' + cols[i], r);
          }
        }
        html += `<h4 class="mt">Correlation matrix</h4><div class="scrollx">${C.corrMatrix(cols, (x, y) => map.get(x + '|' + y))}</div>`;
      }
      const top = a.correlations.slice(0, 4);
      html += `<h4 class="mt">Scatter plots — strongest pairs</h4><div class="grid2">${top.map((c) => {
        const [xs, ys] = pairFor(a.rows, c.a, c.b);
        return `<div class="subcard"><h4>${esc(c.a)} vs ${esc(c.b)}</h4><p class="dim small">r = ${c.r.toFixed(3)} · BH ${fmtQ(c.pAdj)} · n = ${c.n}</p>
          ${C.scatter(xs, ys, { xLabel: c.a, yLabel: c.b, xCurrency: a.typeOf(c.a) === 'currency', yCurrency: a.typeOf(c.b) === 'currency' })}</div>`;
      }).join('')}</div>`;
    }
    html += '</section>';

    html += '<section class="card"><div class="sechead"><span class="sicon">🧩</span><h2>Categorical associations</h2><span class="dim small">Cramér\'s V · chi-square</span></div>';
    if (!a.catAssoc.length) {
      const all = a.catAssocAll || [];
      if (!all.length) {
        html += `<p class="empty">Fewer than two usable categorical columns were found, so there are no pairs to test.</p>`;
      } else {
        html += `<p class="explain"><b>No categorical pair passed BH false-discovery-rate adjustment at q &lt; 0.05.</b> The largest observed Cramér's V was ${all[0].v.toFixed(3)} (${esc(all[0].a)} ↔ ${esc(all[0].b)}; q = ${fmtQ(all[0].pAdj)}). Cramér's V is descriptive; a dash for q means the chi-square approximation was withheld because expected cell counts were too sparse.</p>
        <div class="tablewrap"><table><thead><tr><th>Field A</th><th>Field B</th><th class="num">Cramér's V</th><th class="num">χ²</th><th class="num">BH q</th><th>Test status</th><th class="num">Levels</th></tr></thead><tbody>
        ${all.slice(0, 10).map((c) => `<tr><td>${esc(c.a)}</td><td>${esc(c.b)}</td><td class="num">${c.v.toFixed(4)}</td><td class="num">${c.chi2.toFixed(1)}</td><td class="num">${fmtQ(c.pAdj)}</td><td>${c.chiSquareReliable ? 'asymptotic χ²' : 'sparse counts; descriptive only'}</td><td class="num">${c.la}×${c.lb}</td></tr>`).join('')}
        </tbody></table></div>`;
      }
    }
    else html += `<p class="explain">Cramér's V measures sample association from 0 to 1. Listed pairs passed BH false-discovery-rate adjustment and met the expected-count rule for the chi-square approximation. A strong association does not establish that one field causes the other.</p>
      <div class="tablewrap"><table><thead><tr><th>Field A</th><th>Field B</th><th class="num">Cramér's V</th><th class="num">χ²</th><th class="num">BH q</th><th class="num">Levels</th><th>Reading</th></tr></thead><tbody>
      ${a.catAssoc.slice(0, 20).map((c) => `<tr><td>${esc(c.a)}</td><td>${esc(c.b)}</td><td class="num"><b>${c.v.toFixed(3)}</b></td><td class="num">${c.chi2.toFixed(1)}</td><td class="num">${fmtQ(c.pAdj)}</td><td class="num">${c.la}×${c.lb}</td>
      <td>${c.v >= 0.7 ? 'strong overlap; review definitions' : c.v >= 0.4 ? 'strong overlap' : c.v >= 0.25 ? 'moderate overlap' : 'mild overlap'}</td></tr>`).join('')}</tbody></table></div>`;
    html += '</section>';
    return html;
  }
  function pairFor(rows, a, b) {
    const xs = [], ys = [];
    rows.forEach((r) => { const x = A.parseNumberLike(r[a]), y = A.parseNumberLike(r[b]); if (isFinite(x) && isFinite(y)) { xs.push(x); ys.push(y); } });
    return [xs, ys];
  }

  /* ---------- segments ---------- */
  function renderSegments(a) {
    if (!a.primaryMetric || !a.segments.length) {
      return `<section class="card"><div class="sechead"><span class="sicon">🧭</span><h2>Segment scan</h2></div><p class="empty">Segment scanning needs a numeric metric plus categorical fields. None were available.</p></section>`;
    }
    const isCur = a.typeOf(a.primaryMetric) === 'currency';
    const hot = a.segments.filter((s) => s.lift > 0).slice(0, 12);
    const cold = a.segments.filter((s) => s.lift < 0).slice(0, 12);
    const tbl = (list, title, tone) => `<div class="subcard"><h4>${title}</h4>
      ${C.barH(list.map((s) => ({ label: `${trunc(s.column, 12)}: ${trunc(s.value, 14)}`, value: s.lift, sub: `n=${s.n}`, color: tone })), {})}
      <table class="mini"><thead><tr><th>Field</th><th>Value</th><th class="num">n</th><th class="num">Mean</th><th class="num">vs avg</th><th class="num">Welch t</th><th class="num">BH q</th></tr></thead><tbody>
      ${list.map((s) => `<tr><td>${esc(trunc(s.column, 18))}</td><td>${esc(trunc(s.value, 20))}</td><td class="num">${s.n}</td><td class="num">${fmtNum(s.mean, { currency: isCur })}</td><td class="num ${s.lift >= 0 ? 'pos' : 'neg'}">${s.lift >= 0 ? '+' : ''}${s.lift.toFixed(1)}%</td><td class="num">${s.t === Infinity ? '∞' : s.t === -Infinity ? '−∞' : s.t.toFixed(1)}</td><td class="num">${fmtQ(s.pAdj)}</td></tr>`).join('')}
      </tbody></table></div>`;
    let html = `<section class="card"><div class="sechead"><span class="sicon">🧭</span><h2>Segment scan — ${esc(a.primaryMetric)}</h2><span class="dim small">segments compared with remaining rows</span></div>
      <p class="explain">Each category value is compared with the remaining usable rows using Welch's t-test; p-values are BH-adjusted over the full segment scan. Lift is descriptive, and even adjusted associations are not causal.</p>
      <div class="grid2">${tbl(hot, '📈 Over-performing segments', 'var(--pos)')}${tbl(cold, '📉 Under-performing segments', 'var(--neg)')}</div></section>`;

    // composition donuts — share of the metric held by each category value
    const donutCats = a.baseCats.filter((c) => {
      const p = a.byName[c];
      return p && p.unique >= 2 && p.unique <= 10;
    }).slice(0, 4);
    if (donutCats.length) {
      html += `<section class="card"><div class="sechead"><span class="sicon">🍩</span><h2>Composition of ${esc(a.primaryMetric)}</h2><span class="dim small">share of total per group</span></div>
        <p class="explain">Each ring shows how the total ${esc(a.primaryMetric)} splits across a categorical field. The number in the centre is the overall total.</p>
        <div class="grid2">${donutCats.map((c) => {
          const pr = A.pareto(a.rows, c, a.primaryMetric);
          const items = pr.items.slice(0, 8).map((it) => ({ label: it.key, value: it.value }));
          return `<div class="subcard"><h4>${esc(c)}</h4>${C.donut(items, { currency: isCur, centerLabel: 'total', size: 200 })}</div>`;
        }).join('')}</div></section>`;
    }

    if (a.paretoResults.length) {
      html += `<section class="card"><div class="sechead"><span class="sicon">🏔️</span><h2>Concentration (Pareto)</h2></div>
        <p class="explain">Bars show total ${esc(a.primaryMetric)} per group, the line shows the running cumulative share. The dashed line marks 80%.</p>
        <div class="grid2">${a.paretoResults.slice(0, 4).map((pr) => `<div class="subcard"><h4>${esc(pr.column)}</h4>
          <p class="dim small">${pr.countTo80} of ${pr.items.length} values (${pr.pct80.toFixed(0)}%) make up 80% of the total</p>
          ${C.paretoChart(pr.items, { currency: isCur })}</div>`).join('')}</div></section>`;
    }

    if (a.baseCats.length >= 2) {
      const [r0, c0] = [a.baseCats[0], a.baseCats[1]];
      const ct = A.crossTab(a.rows, r0, c0, a.primaryMetric, 'mean');
      html += `<section class="card" id="pivotCard"><div class="sechead"><span class="sicon">🔲</span><h2>Pivot / cross-tab</h2></div>
        <div class="controls">
          <label>Rows <select id="pvRow">${a.baseCats.map((c) => `<option${c === r0 ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
          <label>Columns <select id="pvCol">${a.baseCats.map((c) => `<option${c === c0 ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
          <label>Metric <select id="pvMetric"><option value="">(row count)</option>${a.numCols.map((c) => `<option${c === a.primaryMetric ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
          <label>Aggregate <select id="pvAgg"><option value="mean">mean</option><option value="sum">sum</option><option value="count">count</option></select></label>
        </div>
        <div class="scrollx" id="pivotOut">${C.heatmap(ct, { currency: isCur, maxWidth: pivotWidth() })}</div></section>`;
    }
    return html;
  }

  /* ---------- column profiles ---------- */
  function renderColumns(a) {
    const cards = a.profiles.map((p) => {
      const isCur = p.type === 'currency';
      let inner = '';
      if (A.isNumericType(p.type) && p.values && p.values.length) {
        inner = `<div class="statgrid">
          ${stat('Mean', fmtNum(p.mean, { currency: isCur }))}${stat('Median', fmtNum(p.median, { currency: isCur }))}
          ${stat('Std dev', fmtNum(p.sd, { currency: isCur }))}${stat('CV', p.cv.toFixed(2))}
          ${stat('Min', fmtNum(p.min, { currency: isCur }))}${stat('Max', fmtNum(p.max, { currency: isCur }))}
          ${stat('P5', fmtNum(p.p05, { currency: isCur }))}${stat('Q1', fmtNum(p.q1, { currency: isCur }))}
          ${stat('Q3', fmtNum(p.q3, { currency: isCur }))}${stat('P95', fmtNum(p.p95, { currency: isCur }))}
          ${stat('Skew', p.skew.toFixed(2))}${stat('Kurtosis', p.kurt.toFixed(2))}
          ${stat('Sum', fmtNum(p.sum, { currency: isCur }))}${stat('Zeros', p.zeroCount)}
          ${stat('Negatives', p.negCount)}${stat('Distinct', p.unique.toLocaleString())}
        </div>${C.histogramChart(p.histogram, { currency: isCur })}
        <p class="dim small">Distribution is ${Math.abs(p.skew) < 0.5 ? 'roughly symmetric' : p.skew > 0 ? 'right-skewed (long tail of high values)' : 'left-skewed (long tail of low values)'}${Math.abs(p.kurt) > 1 ? `, ${p.kurt > 0 ? 'with heavy tails' : 'flatter than normal'}` : ''}.</p>`;
      } else if (p.type === 'date' && p.dates && p.dates.length) {
        inner = `<div class="statgrid">${stat('Earliest', fmtDate(p.minDate))}${stat('Latest', fmtDate(p.maxDate))}${stat('Span', p.spanDays + ' days')}${stat('Distinct dates', p.unique.toLocaleString())}</div>`;
      } else if (p.counts) {
        const useDonut = p.unique >= 2 && p.unique <= 8;
        inner = `<div class="statgrid">${stat('Distinct', p.unique.toLocaleString())}${stat('Top share', p.topShare.toFixed(1) + '%')}${stat('Balance', (p.balance * 100).toFixed(0) + '%')}${stat('Singletons', p.rare)}</div>
          ${useDonut
            ? C.donut(p.top.map((t) => ({ label: t.key, value: t.count })), { centerLabel: 'rows', size: 190 })
            : C.barH(p.top.map((t) => ({ label: t.key, value: t.count, sub: t.pct.toFixed(1) + '%', color: 'var(--c1)' })), {})}
          ${p.unique > 12 ? `<p class="dim small">Showing top 12 of ${p.unique} values.</p>` : ''}
          <p class="dim small">Balance ${(p.balance * 100).toFixed(0)}% (entropy ÷ max entropy) — ${p.balance > 0.85 ? 'values are evenly spread' : p.balance > 0.5 ? 'moderately uneven' : 'dominated by a few values'}.</p>`;
      } else {
        inner = `<div class="statgrid">${stat('Distinct', p.unique.toLocaleString())}${stat('Unique %', p.uniquePct.toFixed(1) + '%')}</div><p class="dim small">Free text or identifier — excluded from statistical tests.</p>`;
      }
      return `<div class="subcard">
        <div class="chead"><h4>${esc(p.name)}</h4><span class="typepill ${p.type}">${p.type}</span></div>
        <p class="dim small">${p.complete.toLocaleString()} of ${p.total.toLocaleString()} filled · ${p.missingPct.toFixed(1)}% missing${p.constant ? ' · <b>constant</b>' : ''}</p>
        ${inner}</div>`;
    }).join('');
    return `<section class="card"><div class="sechead"><span class="sicon">📚</span><h2>Column profiles</h2><span class="dim small">every column, fully described</span></div>
      <div class="grid2">${cards}</div></section>`;
  }
  const stat = (l, v) => `<div class="st"><span>${esc(l)}</span><b>${esc(String(v))}</b></div>`;

  /* ---------- time ---------- */
  function renderTime(a) {
    if (!a.series) return renderOrderedTrends(a);
    const isCur = a.typeOf(a.primaryMetric) === 'currency';
    const ma = A.movingAverage(a.series, 7);
    const anomPts = [];
    const vals = a.series.map((p) => p.value), m = A.mean(vals), s = A.sd(vals);
    a.series.forEach((p) => { if (s && Math.abs((p.value - m) / s) >= 3) anomPts.push(p); });
    const f = a.forecastResult.fit;
    let html = `<section class="card"><div class="sechead"><span class="sicon">📈</span><h2>${esc(a.primaryMetric)} over time</h2><span class="dim small">by ${esc(a.dateCol)} · solid = actual · dashed = forecast · shaded = 95% band</span></div>
      ${C.timeSeries(a.series, ma, a.forecastResult, { currency: isCur, anomalies: anomPts })}
      ${a.partialTrimmed ? '<p class="explain">A trailing partial period was excluded from the trend — it held far fewer records than a typical period and would have dragged the line down artificially.</p>' : ''}
      <p class="explain">Least-squares regression on ${a.series.length} periods. Slope ${fmtNum(f.slope, { currency: isCur })} per day, R² ${f.r2.toFixed(2)}${f.r2 < 0.3 ? ' — weak fit, so the band is wide and the projection should be treated as a rough reference' : ''}. The band widens with distance because prediction uncertainty compounds.</p></section>`;

    if (a.seasonal && (a.seasonal.dow.length || a.seasonal.month.length)) {
      const cards = [];
      if (a.seasonal.dow.length) cards.push(`<div class="subcard"><h4>Day of week (index, 100 = average)</h4>${C.barH(a.seasonal.dow.map((d) => ({ label: d.label, value: d.index - 100, sub: `n=${d.n}`, color: d.index >= 100 ? 'var(--pos)' : 'var(--neg)' })), {})}</div>`);
      if (a.seasonal.month.length) cards.push(`<div class="subcard"><h4>Month (index, 100 = average)</h4>${C.barH(a.seasonal.month.map((d) => ({ label: d.label, value: d.index - 100, sub: `n=${d.n}`, color: d.index >= 100 ? 'var(--pos)' : 'var(--neg)' })), {})}</div>`);
      html += `<section class="card"><div class="sechead"><span class="sicon">🗓️</span><h2>Seasonality — descriptive indices</h2></div>
        <div class="grid2">${cards.join('')}</div>
        <p class="explain">Bars show deviation from the overall average and are descriptive, not significance tests. Weekday summaries require at least eight observations per weekday across eight weeks; month-of-year summaries require at least two years of coverage.</p></section>`;
    }
    // Period breakdown — always shown, and the main content when the trend is
    // too weak to project from. Aggregates the metric by month.
    html += renderPeriodBreakdown(a, isCur);

    if (f.r2 < 0.15) {
      html += `<section class="card"><div class="sechead"><span class="sicon">🔮</span><h2>Why no projection</h2></div>
        <p class="explain">A trend line explains only <b>${(f.r2 * 100).toFixed(1)}%</b> of the movement in ${esc(a.primaryMetric)} (R² = ${f.r2.toFixed(2)}). Projecting from a fit this weak would produce a confident-looking number with no basis, so it is deliberately withheld.
        This usually means each row is an independent record (a policy, a customer, a transaction) rather than a measurement over time — the period tables above still describe the data accurately, and the <b>Drivers</b> and <b>Segments</b> tabs are where the signal is.</p></section>`;
      return html;
    }
    const pts = a.forecastResult.points;
    html += `<section class="card"><div class="sechead"><span class="sicon">🔮</span><h2>Projected values</h2></div>
      <div class="tablewrap"><table><thead><tr><th>Period</th><th class="num">Projected</th><th class="num">Lower 95%</th><th class="num">Upper 95%</th></tr></thead><tbody>
      ${pts.slice(0, 40).map((p) => `<tr><td>${fmtDate(new Date(p.t))}</td><td class="num"><b>${fmtNum(p.value, { currency: isCur })}</b></td><td class="num dim">${fmtNum(p.lower, { currency: isCur })}</td><td class="num dim">${fmtNum(p.upper, { currency: isCur })}</td></tr>`).join('')}
      </tbody></table></div></section>`;
    return html;
  }

  // No date column: a "trend" still exists along any ordered dimension.
  // Show how the headline metric progresses across ordinal/binned fields
  // (age brackets, tenure, quintiles) plus a cumulative distribution — so the
  // tab is genuinely useful for cross-sectional data instead of apologising.
  function renderOrderedTrends(a) {
    const metric = a.primaryMetric;
    if (!metric) {
      return `<section class="card"><div class="sechead"><span class="sicon">📈</span><h2>Trends</h2></div>
        <p class="empty">Trend analysis needs a numeric metric. This dataset has no numeric column that varies, so there is nothing to trend.</p></section>`;
    }
    const isCur = a.typeOf(metric) === 'currency';
    const p = a.byName[metric];

    // Rank an ordered categorical: leading number, or a known ordinal word list.
    const ORDINAL = ['none', 'very low', 'low', 'poor', 'fair', 'medium', 'moderate', 'average', 'good', 'high', 'very high', 'very good', 'excellent'];
    const rankOf = (k) => {
      const str = String(k).trim();
      const num = /(-?\d+(?:\.\d+)?)/.exec(str.replace(/,/g, ''));
      if (num) return parseFloat(num[1]);
      const idx = ORDINAL.indexOf(str.toLowerCase());
      return idx >= 0 ? idx : NaN;
    };
    const ordered = [];
    // A metric's own quintile bands trivially "predict" it (R²=1.00) — that is
    // a restatement, not a trend. Exclude the metric's own derived bins.
    const selfBin = `${metric} (quintile)`;
    a.catCols.filter((c) => c !== selfBin).forEach((c) => {
      const prof = a.byName[c];
      const levels = prof && prof.counts ? prof.counts.map(([k]) => k) : [...new Set(a.rows.map((r) => String(r[c] ?? '').trim()))].filter(Boolean);
      if (levels.length < 3 || levels.length > 12) return;
      const ranks = levels.map(rankOf);
      if (ranks.some((x) => !isFinite(x))) return;           // not an ordered field
      if (new Set(ranks).size !== ranks.length) return;
      const groups = levels.map((k, i) => {
        const vals = A.num(a.rows.filter((r) => String(r[c] ?? '').trim() === k).map((r) => A.parseNumberLike(r[metric])));
        return { key: k, rank: ranks[i], n: vals.length, mean: vals.length ? A.mean(vals) : 0, median: vals.length ? A.median(vals) : 0, sum: A.sum(vals) };
      }).filter((g) => g.n >= 3).sort((x, y) => x.rank - y.rank);
      if (groups.length < 3) return;
      const fit = A.linreg(groups.map((g) => g.rank), groups.map((g) => g.mean));
      ordered.push({ col: c, groups, fit, swing: groups[groups.length - 1].mean - groups[0].mean });
    });
    ordered.sort((x, y) => Math.abs(y.fit.r2) - Math.abs(x.fit.r2));

    let html = `<section class="card"><div class="sechead"><span class="sicon">📈</span><h2>Trends</h2><span class="dim small">no date column — showing progression across ordered fields</span></div>
      <p class="explain">This dataset is <b>cross-sectional</b>: each row is an independent record rather than a point in time, so there is no calendar trend to plot. A trend still exists along any <i>ordered</i> dimension, so ${esc(metric)} is tracked across ranked bands below.${a.dateCols.length ? '' : ' If one of your columns does hold dates, set its type to <b>date</b> in the preview step and re-run to unlock forecasting.'}</p>`;

    if (ordered.length) {
      html += `<div class="grid2">${ordered.slice(0, 4).map((o) => `<div class="subcard">
        <h4>${esc(metric)} across ${esc(o.col)}</h4>
        <p class="dim small">R² = ${o.fit.r2.toFixed(2)} · ${o.fit.slope >= 0 ? 'rising' : 'falling'} · swing ${fmtNum(o.swing, { currency: isCur })}</p>
        ${C.barH(o.groups.map((g) => ({ label: g.key, value: g.mean, sub: `n=${g.n}`, color: o.fit.slope >= 0 ? 'var(--c1)' : 'var(--c4)' })), { currency: isCur })}
        <table class="mini"><thead><tr><th>Band</th><th class="num">n</th><th class="num">Mean</th><th class="num">Median</th><th class="num">Δ prev</th></tr></thead><tbody>
        ${o.groups.map((g, i) => {
          const prev = o.groups[i - 1];
          const d = prev && prev.mean ? ((g.mean - prev.mean) / Math.abs(prev.mean)) * 100 : null;
          return `<tr><td>${esc(trunc(g.key, 22))}</td><td class="num">${g.n}</td><td class="num">${fmtNum(g.mean, { currency: isCur })}</td><td class="num">${fmtNum(g.median, { currency: isCur })}</td><td class="num ${d == null ? '' : d >= 0 ? 'pos' : 'neg'}">${d == null ? '—' : (d >= 0 ? '+' : '') + d.toFixed(1) + '%'}</td></tr>`;
        }).join('')}</tbody></table></div>`).join('')}</div>`;
    } else {
      html += `<p class="empty">No ordered categorical fields (age bands, tenure, ratings, quintiles) were detected, so there is no sequence to trend along. The <b>Drivers</b> and <b>Segments</b> tabs cover the group differences in this data.</p>`;
    }
    html += '</section>';

    // Cumulative distribution — always available for a numeric metric.
    if (p && p.values && p.values.length > 10) {
      const sorted = [...p.values].sort((x, y) => x - y);
      const pts = [];
      const STEPS = 40;
      for (let i = 0; i <= STEPS; i++) {
        const q = i / STEPS;
        pts.push({ t: q * 100, value: A.quantile(sorted, q) });
      }
      const decChunks = [];
      for (let d = 0; d < 10; d++) {
        const lo = Math.floor((d / 10) * sorted.length), hi = Math.floor(((d + 1) / 10) * sorted.length);
        const slice = sorted.slice(lo, Math.max(hi, lo + 1));
        decChunks.push({ label: `D${d + 1}`, value: A.sum(slice), n: slice.length });
      }
      const total = A.sum(sorted) || 1;
      html += `<section class="card"><div class="sechead"><span class="sicon">📊</span><h2>Distribution curve — ${esc(metric)}</h2></div>
        <p class="explain">The percentile curve shows the value at each point in the distribution: the steeper the right-hand tail, the more concentrated the metric is in a few large records.</p>
        <div class="grid2">
          <div class="subcard"><h4>Value by percentile</h4>
            ${C.timeSeries(pts.map((q) => ({ t: q.t, value: q.value, date: new Date() })), null, null, { currency: isCur, width: 560, height: 260 })}
            <p class="dim small">P10 ${fmtNum(A.quantile(sorted, 0.1), { currency: isCur })} · P50 ${fmtNum(p.median, { currency: isCur })} · P90 ${fmtNum(A.quantile(sorted, 0.9), { currency: isCur })}</p></div>
          <div class="subcard"><h4>Share of total by decile</h4>
            ${C.barH(decChunks.map((d) => ({ label: d.label, value: (d.value / total) * 100, sub: `n=${d.n}`, color: 'var(--c3)' })), {})}
            <p class="dim small">Top decile holds ${((decChunks[9].value / total) * 100).toFixed(1)}% of all ${esc(metric)}.</p></div>
        </div></section>`;
    }
    return html + renderPeriodFreeSummary(a, isCur);
  }

  // Record-count profile across the biggest categorical — a "volume" view that
  // stands in for the records-per-period chart a dated set would get.
  function renderPeriodFreeSummary(a, isCur) {
    const cat = a.baseCats.find((c) => { const p = a.byName[c]; return p && p.unique >= 3 && p.unique <= 14; });
    if (!cat) return '';
    const pr = A.pareto(a.rows, cat, a.primaryMetric);
    return `<section class="card"><div class="sechead"><span class="sicon">📆</span><h2>Volume profile</h2><span class="dim small">by ${esc(cat)}</span></div>
      <p class="explain">Without dates there is no per-period volume, so this shows how records and total ${esc(a.primaryMetric)} distribute across ${esc(cat)}.</p>
      <div class="grid2">
        <div class="subcard"><h4>Total ${esc(a.primaryMetric)}</h4>${C.barH(pr.items.slice(0, 12).map((i) => ({ label: i.key, value: i.value, sub: i.share.toFixed(1) + '%', color: 'var(--c1)' })), { currency: isCur })}</div>
        <div class="subcard"><h4>Share of total</h4>${C.donut(pr.items.slice(0, 8).map((i) => ({ label: i.key, value: i.value })), { currency: isCur, centerLabel: 'total', size: 200 })}</div>
      </div></section>`;
  }

  // Month-by-month table + bars. Works for any dated dataset, trend or not.
  function renderPeriodBreakdown(a, isCur) {
    const buckets = new Map();
    a.rows.forEach((r) => {
      const d = A.parseDateLike(r[a.dateCol]); if (!d) return;
      const v = A.parseNumberLike(r[a.primaryMetric]); if (!isFinite(v)) return;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(v);
    });
    if (buckets.size < 2) return '';
    const periods = [...buckets.entries()].sort((x, y) => x[0].localeCompare(y[0])).map(([key, vals]) => {
      const range = A.minMax(vals);
      return { key, n: vals.length, sum: A.sum(vals), mean: A.mean(vals), median: A.median(vals), min: range.min, max: range.max };
    });
    periods.forEach((p, i) => {
      const prev = periods[i - 1];
      p.change = prev && prev.sum ? ((p.sum - prev.sum) / Math.abs(prev.sum)) * 100 : null;
    });
    const best = periods.slice().sort((x, y) => y.sum - x.sum)[0];
    const worst = periods.slice().sort((x, y) => x.sum - y.sum)[0];
    const label = (k) => {
      const [y, m] = k.split('-');
      return new Date(+y, +m - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
    };
    return `<section class="card"><div class="sechead"><span class="sicon">📆</span><h2>Period breakdown</h2><span class="dim small">${periods.length} months · by ${esc(a.dateCol)}</span></div>
      <p class="explain">Totals, averages and record counts for every month in the data. Highest month is <b>${label(best.key)}</b> (${fmtNum(best.sum, { currency: isCur })}); lowest is <b>${label(worst.key)}</b> (${fmtNum(worst.sum, { currency: isCur })}).</p>
      <div class="grid2">
        <div class="subcard"><h4>Total ${esc(a.primaryMetric)} by month</h4>
          ${C.barH(periods.map((p) => ({ label: label(p.key), value: p.sum, sub: `n=${p.n}`, color: 'var(--c1)' })), { currency: isCur })}</div>
        <div class="subcard"><h4>Records per month</h4>
          ${C.barH(periods.map((p) => ({ label: label(p.key), value: p.n, color: 'var(--c3)' })), {})}</div>
      </div>
      <div class="tablewrap"><table><thead><tr><th>Period</th><th class="num">Records</th><th class="num">Total</th><th class="num">Mean</th><th class="num">Median</th><th class="num">Min</th><th class="num">Max</th><th class="num">vs prev</th></tr></thead><tbody>
      ${periods.map((p) => `<tr><td>${label(p.key)}</td><td class="num">${p.n}</td><td class="num"><b>${fmtNum(p.sum, { currency: isCur })}</b></td>
        <td class="num">${fmtNum(p.mean, { currency: isCur })}</td><td class="num">${fmtNum(p.median, { currency: isCur })}</td>
        <td class="num dim">${fmtNum(p.min, { currency: isCur })}</td><td class="num dim">${fmtNum(p.max, { currency: isCur })}</td>
        <td class="num ${p.change == null ? '' : p.change >= 0 ? 'pos' : 'neg'}">${p.change == null ? '—' : (p.change >= 0 ? '+' : '') + p.change.toFixed(1) + '%'}</td></tr>`).join('')}
      </tbody></table></div></section>`;
  }

  /* ---------- quality ---------- */
  function renderQuality(a) {
    const q = a.quality;
    const sevOrder = { high: 0, med: 1, low: 2 };
    const issues = [...q.issues].sort((x, y) => sevOrder[x.sev] - sevOrder[y.sev]);
    return `<section class="card"><div class="sechead"><span class="sicon">🧪</span><h2>Data quality — ${q.score}/100</h2></div>
      <div class="scorebar"><div class="fill ${q.score >= 90 ? 'pos' : q.score >= 70 ? 'warn' : 'neg'}" style="width:${q.score}%"></div></div>
      <p class="explain">The score starts at 100 and deducts for missing values, constant columns, duplicate rows and inconsistent category spellings. Every deduction is listed below.</p>
      ${issues.length ? `<div class="tablewrap"><table><thead><tr><th>Severity</th><th>Column</th><th>Issue</th></tr></thead><tbody>
        ${issues.map((i) => `<tr><td><span class="sev ${i.sev}">${i.sev === 'med' ? 'medium' : i.sev}</span></td><td>${esc(i.col)}</td><td>${esc(i.msg)}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="ok">No issues detected — every column is complete, varied and consistently formatted.</p>'}
      <h4 class="mt">Completeness by column</h4>${C.missingness(a.profiles)}
      ${a.anomalies.length ? `<h4 class="mt">Outliers (${a.anomalies.length})</h4>
        <div class="tablewrap"><table><thead><tr><th class="num">Row</th><th>Column</th><th class="num">Value</th><th class="num">z-score</th><th>Method</th><th>Severity</th><th class="num">Typical</th></tr></thead><tbody>
        ${a.anomalies.slice(0, 60).map((x) => `<tr><td class="num">${x.row ?? '—'}</td><td>${esc(x.column)}</td><td class="num">${esc(typeof x.value === 'number' ? fmtNum(x.value) : trunc(String(x.value), 24))}</td>
          <td class="num">${isFinite(x.z) ? x.z.toFixed(2) : '—'}</td><td>${esc(x.method)}</td><td><span class="sev ${x.severity === 'medium' ? 'med' : x.severity}">${esc(x.severity)}</span></td><td class="num dim">${x.expected != null ? fmtNum(x.expected) : '—'}</td></tr>`).join('')}
        </tbody></table></div>${a.anomalies.length > 60 ? `<p class="dim small">Showing first 60 of ${a.anomalies.length}.</p>` : ''}` : ''}
    </section>`;
  }

  /* ---------- explore ---------- */
  function renderExplore(a) {
    const cats = a.baseCats, nums = a.numCols;
    return `<section class="card"><div class="sechead"><span class="sicon">🔬</span><h2>Explore any combination</h2></div>
      <p class="explain">Build your own comparison. Pick a metric and a grouping field to get full statistics per group, including a box plot showing spread rather than just averages.</p>
      <div class="controls">
        <label>Metric <select id="exMetric">${nums.map((c) => `<option${c === a.primaryMetric ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
        <label>Group by <select id="exGroup">${a.catCols.map((c) => `<option>${esc(c)}</option>`).join('')}</select></label>
        <label>Sort <select id="exSort"><option value="mean">by mean</option><option value="n">by size</option><option value="name">by name</option></select></label>
      </div>
      <div id="exploreOut"></div></section>
      ${nums.length >= 2 ? `<section class="card"><div class="sechead"><span class="sicon">📉</span><h2>Custom scatter</h2></div>
        <div class="controls">
          <label>X <select id="scX">${nums.map((c, i) => `<option${i === 0 ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
          <label>Y <select id="scY">${nums.map((c, i) => `<option${i === 1 ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
        </div><div id="scatterOut"></div></section>` : ''}`;
  }

  function drawExplore() {
    const a = STATE.analysis;
    const metric = el('exMetric').value, group = el('exGroup').value, sort = el('exSort').value;
    const isCur = a.typeOf(metric) === 'currency';
    const map = new Map();
    a.rows.forEach((r) => {
      const v = A.parseNumberLike(r[metric]); if (!isFinite(v)) return;
      const k = String(r[group] ?? '(blank)').trim() || '(blank)';
      if (!map.has(k)) map.set(k, []); map.get(k).push(v);
    });
    let groups = [...map.entries()].filter(([, v]) => v.length >= 2).map(([key, vals]) => {
      const s = [...vals].sort((x, y) => x - y);
      return { key, n: vals.length, mean: A.mean(vals), median: A.quantile(s, 0.5), sd: A.sd(vals), sum: A.sum(vals), min: s[0], max: s[s.length - 1], q1: A.quantile(s, 0.25), q3: A.quantile(s, 0.75) };
    });
    if (!groups.length) { el('exploreOut').innerHTML = '<p class="empty">No group has enough values for this combination.</p>'; return; }
    if (sort === 'mean') groups.sort((x, y) => y.mean - x.mean);
    else if (sort === 'n') groups.sort((x, y) => y.n - x.n);
    else groups.sort((x, y) => String(x.key).localeCompare(String(y.key)));
    const show = groups.slice(0, 20);
    const overall = A.mean(a.rows.map((r) => A.parseNumberLike(r[metric])).filter(isFinite));
    const stats = A.etaSquared(groups.map((g) => ({ key: g.key, values: [] })).length ? [...map.entries()].filter(([, v]) => v.length >= 2).map(([key, values]) => ({ key, values })) : []);
    el('exploreOut').innerHTML = `
      <p class="dim small">${groups.length} groups · η² = ${stats.eta2.toFixed(3)} · ${fmtP(stats.p)} · overall mean ${fmtNum(overall, { currency: isCur })}</p>
      <div class="grid2">
        <div class="subcard"><h4>Mean by group</h4>${C.barH(show.map((g) => ({ label: g.key, value: g.mean, sub: `n=${g.n}`, color: g.mean >= overall ? 'var(--pos)' : 'var(--neg)' })), { currency: isCur })}</div>
        <div class="subcard"><h4>Spread (box plot)</h4>${C.boxPlot(show, { currency: isCur })}<p class="dim small">Box = middle 50% of values, line = median, whiskers = min/max.</p></div>
      </div>
      <div class="tablewrap"><table><thead><tr><th>Group</th><th class="num">n</th><th class="num">Mean</th><th class="num">Median</th><th class="num">Std dev</th><th class="num">Min</th><th class="num">Max</th><th class="num">Sum</th><th class="num">vs overall</th></tr></thead><tbody>
      ${show.map((g) => `<tr><td>${esc(trunc(g.key, 30))}</td><td class="num">${g.n}</td><td class="num">${fmtNum(g.mean, { currency: isCur })}</td><td class="num">${fmtNum(g.median, { currency: isCur })}</td><td class="num">${fmtNum(g.sd, { currency: isCur })}</td><td class="num">${fmtNum(g.min, { currency: isCur })}</td><td class="num">${fmtNum(g.max, { currency: isCur })}</td><td class="num">${fmtNum(g.sum, { currency: isCur })}</td>
        <td class="num ${g.mean >= overall ? 'pos' : 'neg'}">${overall ? ((g.mean - overall) / Math.abs(overall) * 100).toFixed(1) + '%' : '—'}</td></tr>`).join('')}
      </tbody></table></div>${groups.length > 20 ? `<p class="dim small">Showing top 20 of ${groups.length} groups.</p>` : ''}`;
    if (global.TabulaMetricsAnim) global.TabulaMetricsAnim.play(el('exploreOut'));
  }

  function drawScatter() {
    const a = STATE.analysis;
    const x = el('scX').value, y = el('scY').value;
    const [xs, ys] = pairFor(a.rows, x, y);
    if (xs.length < 3) { el('scatterOut').innerHTML = '<p class="empty">Not enough paired values.</p>'; return; }
    const r = A.pearson(xs, ys), rho = A.spearman(xs, ys), p = A.corrPValue(r, xs.length);
    el('scatterOut').innerHTML = `<p class="dim small">n = ${xs.length} · r = ${r.toFixed(3)} · ρ = ${rho.toFixed(3)} · ${fmtP(p)} · r² = ${(r * r * 100).toFixed(1)}%</p>
      ${C.scatter(xs, ys, { width: 760, height: 380, xLabel: x, yLabel: y, xCurrency: a.typeOf(x) === 'currency', yCurrency: a.typeOf(y) === 'currency' })}`;
    if (global.TabulaMetricsAnim) global.TabulaMetricsAnim.play(el('scatterOut'));
  }

  function drawPivot() {
    const a = STATE.analysis;
    const r = el('pvRow').value, c = el('pvCol').value, m = el('pvMetric').value, agg = el('pvAgg').value;
    const ct = A.crossTab(a.rows, r, c, m || null, agg);
    el('pivotOut').innerHTML = C.heatmap(ct, { currency: m && a.typeOf(m) === 'currency', maxWidth: pivotWidth() });
    if (global.TabulaMetricsAnim) global.TabulaMetricsAnim.play(el('pivotOut'));
  }

  // Width available to the pivot. Measured from the live container when it
  // exists, otherwise estimated from the viewport so the first paint fills too.
  function pivotWidth() {
    const node = el('pivotOut');
    if (node && node.clientWidth > 200) return node.clientWidth;
    return Math.min(1360, Math.max(360, window.innerWidth - 48)) - 44;
  }

  /* ---------- data tab ---------- */
  function renderDataTab(a) {
    const cols = a.columns;
    return `<section class="card"><div class="sechead"><span class="sicon">🗂</span><h2>Data</h2><span class="dim small">first 200 rows</span></div>
      <div class="tablewrap tall"><table class="datatable"><thead><tr>${cols.map((c) => `<th>${esc(c)}<span class="thtype">${esc(a.typeOf(c))}</span></th>`).join('')}</tr></thead>
      <tbody>${a.rows.slice(0, 200).map((r) => `<tr>${cols.map((c) => `<td>${esc(trunc(String(r[c] ?? ''), 32))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      ${a.rows.length > 200 ? `<p class="dim small">Showing 200 of ${a.rows.length.toLocaleString()} rows.</p>` : ''}</section>`;
  }

  /* ---------- wiring ---------- */
  function wireDashboard(a) {
    $$('.tab').forEach((t) => t.addEventListener('click', () => {
      $$('.tab').forEach((x) => { x.classList.remove('active'); x.setAttribute('aria-current', 'false'); });
      $$('.tabpane').forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      t.setAttribute('aria-current', 'page');
      const pane = el('tab-' + t.dataset.tab);
      pane.classList.add('active');
      if (t.dataset.tab === 'explore') { drawExplore(); if (el('scX')) drawScatter(); }
      scrollToTabs();
      if (global.TabulaMetricsAnim) global.TabulaMetricsAnim.swapTab(pane);
    }));
    $$('[data-tab-link]').forEach((link) => link.addEventListener('click', () => {
      const target = $(`.tab[data-tab="${link.dataset.tabLink}"]`);
      if (target) target.click();
    }));
    if (el('replaceFileBtn')) el('replaceFileBtn').addEventListener('click', () => { el('fileInput').value = ''; el('fileInput').click(); });
    ['pvRow', 'pvCol', 'pvMetric', 'pvAgg'].forEach((id) => { const e = el(id); if (e) e.addEventListener('change', drawPivot); });
    if (el('pvRow')) {
      let rt = null;
      window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (el('pivotOut')) drawPivot(); }, 180); });
    }
    ['exMetric', 'exGroup', 'exSort'].forEach((id) => { const e = el(id); if (e) e.addEventListener('change', drawExplore); });
    ['scX', 'scY'].forEach((id) => { const e = el(id); if (e) e.addEventListener('change', drawScatter); });
  }

  function clearSession() {
    cancelWorker();
    STATE.dataset = null; STATE.analysis = null; STATE.types = Object.create(null); STATE.attestation = null; STATE.pendingScan = null; STATE.pendingDataset = null; STATE.pendingTypes = null;
    el('dashboard').style.display = 'none'; el('dashboard').innerHTML = '';
    el('landing').style.display = 'block';
    el('appbar').classList.remove('active');
    el('fileInput').value = '';
    toast('Session cleared — all data removed from memory.');
  }

  /* ---------- export ---------- */
  function exportReport() {
    const a = STATE.analysis; if (!a) return;
    const style = [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n');
    const theme = document.documentElement.getAttribute('data-theme');
    const panes = TABS.map(([id, label]) => `<h2 class="exph">${label}</h2>${el('tab-' + id).innerHTML}`).join('');
    const html = `<!doctype html><html data-theme="${esc(theme || 'daylight')}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; img-src data:; font-src data: https://fonts.gstatic.com; base-uri 'none'; form-action 'none'"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Google+Sans:ital,opsz,wght@0,17..18,400..700;1,17..18,400..700&amp;display=swap" rel="stylesheet"><title>TabulaMetrics report — ${esc(STATE.dataset.name)}</title><style>${style}
      .tabpane{display:block!important} .tabs{display:none} .controls{display:none} .exph{margin:32px 0 8px;font-size:22px}</style></head>
      <body><main class="wrap"><h1>TabulaMetrics report</h1><p class="dim">${esc(STATE.dataset.name)} · ${a.rows.length.toLocaleString()} rows × ${a.columns.length} columns · generated ${new Date().toLocaleString()}</p>
      <section class="card"><p class="dim small"><b>Data handling note:</b> This export includes analysis and up to 200 source-data rows. Protect the file and any copies accordingly.</p></section>
      ${STATE.attestation ? `<section class="card"><p class="dim small"><b>No-PHI attestation:</b> the uploader confirmed on ${esc(new Date(STATE.attestation.at).toLocaleString())} that “${esc(STATE.attestation.file || 'this file')}” contains no protected health information. Flagged terms: ${STATE.attestation.terms.map((t) => esc(t)).join(', ') || 'n/a'}.</p></section>` : ''}
      <section class="card summary"><h2>Executive summary</h2><p class="lead">${a.summary}</p></section>
      ${renderKpiStrip(a)}${panes}</main></body></html>`;
    download(html, `tabulametrics-report-${Date.now()}.html`, 'text/html');
    toast('Report exported with analysis and up to 200 data rows. Save and share carefully.');
  }
  function download(content, name, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  /* ---------- samples ---------- */
  function loadSample() {
    const rows = [];
    const cats = ['Electronics', 'Groceries', 'Apparel', 'Dining', 'Home'];
    const regions = ['North', 'South', 'East', 'West'];
    const channels = ['Online', 'In-Store'];
    let seed = 42; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const start = new Date(2026, 1, 15);
    // 3 records per day over ~174 days, with a genuine growth trend + weekly seasonality
    // so the sample demonstrates trend fitting and forecasting rather than pure noise.
    for (let i = 0; i < 520; i++) {
      const dayIdx = Math.floor(i / 3);
      const d = new Date(start.getTime() + dayIdx * 86400000);
      const cat = cats[Math.floor(rnd() * cats.length)];
      const base = { Electronics: 1400, Groceries: 700, Apparel: 600, Dining: 380, Home: 900 }[cat];
      const trend = 1 + (dayIdx / 174) * 0.85;              // steady growth
      const weekly = 1 + 0.18 * Math.sin((d.getDay() / 7) * Math.PI * 2); // weekday rhythm
      const noise = 0.9 + rnd() * 0.2;                       // modest noise
      const units = Math.max(1, Math.round((base / 55) * trend * weekly * noise));
      const revenue = +(units * (base / 22) * trend * weekly * noise).toFixed(2);
      rows.push({
        Date: d.toISOString().slice(0, 10), Category: cat,
        Region: regions[Math.floor(rnd() * regions.length)], Channel: channels[Math.floor(rnd() * 2)],
        Units: units, Revenue: revenue, 'Ad Spend': +(revenue * (0.09 + rnd() * 0.05)).toFixed(2),
      });
    }
    loadDataset({ name: 'sample-sales.csv', columns: Object.keys(rows[0]), rows, parseMs: 3 });
  }

  function loadInsuranceSample() {
    let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const rows = [];
    const brackets = ['18-24', '25-34', '35-49', '50-64', '65+'];
    const vehClass = ['Sedan', 'SUV', 'Truck', 'Sports', 'Minivan', 'EV'];
    const empType = ['Full-time', 'Part-time', 'Self-employed', 'Retired', 'Student'];
    const edu = ['High School', 'Some College', 'Bachelor', 'Master', 'Doctorate'];
    const marital = ['Single', 'Married', 'Divorced', 'Widowed'];
    const credit = ['Poor', 'Fair', 'Good', 'Very Good', 'Excellent'];
    const usage = ['Commute', 'Pleasure', 'Business', 'Farm'];
    const territory = ['10001', '30301', '60601', '75201', '90210', '98101'];
    const income = ['<40K', '40-75K', '75-125K', '125-200K', '200K+'];
    for (let i = 0; i < 900; i++) {
      const ageB = pick(brackets);
      const ageBase = { '18-24': 21, '25-34': 29, '35-49': 42, '50-64': 57, '65+': 71 }[ageB];
      const age = ageBase + Math.floor(rnd() * 6) - 3;
      const cls = pick(vehClass);
      const cr = pick(credit);
      const viol = Math.max(0, Math.round((rnd() * 3) - (['Excellent', 'Very Good'].indexOf(cr) >= 0 ? 1 : 0)));
      const claims = Math.max(0, Math.round(rnd() * 2.2 - (age > 50 ? 0.7 : 0)));
      const mileage = Math.round((6000 + rnd() * 18000) * (pick(usage) === 'Commute' ? 1.25 : 1));
      const creditFactor = { Poor: 1.55, Fair: 1.3, Good: 1.0, 'Very Good': 0.87, Excellent: 0.75 }[cr];
      const ageFactor = { '18-24': 1.85, '25-34': 1.2, '35-49': 0.92, '50-64': 0.86, '65+': 1.05 }[ageB];
      const clsFactor = { Sedan: 1, SUV: 1.1, Truck: 1.15, Sports: 1.7, Minivan: 0.92, EV: 1.2 }[cls];
      const premium = +(620 * creditFactor * ageFactor * clsFactor * (1 + viol * 0.13) * (1 + claims * 0.16) * (0.9 + rnd() * 0.22)).toFixed(2);
      const severity = claims ? +(2200 * clsFactor * (0.6 + rnd() * 1.5)).toFixed(2) : 0;
      rows.push({
        'Policy ID': 'P' + (100000 + i),
        Age: age, 'Age Bracket': ageB, Gender: pick(['M', 'F', 'X']),
        'Marital Status': pick(marital), 'Education Level': pick(edu),
        'Employment Type': pick(empType), 'Household Income Bracket': pick(income),
        'Zip Territory': pick(territory), 'Vehicle Class': cls,
        'Vehicle Age': Math.round(rnd() * 14), 'Vehicle Safety Rating': Math.round(1 + rnd() * 4),
        'Anti-Theft Device': pick(['Yes', 'No']), 'Primary Use': pick(usage),
        'Annual Mileage': mileage, 'Commute Distance': +(rnd() * 42).toFixed(1),
        'Cars Insured': 1 + Math.floor(rnd() * 3), 'Household Drivers': 1 + Math.floor(rnd() * 4),
        'Credit Score Range': cr, 'Years As Customer': Math.round(rnd() * 18),
        'Traffic Violations': viol, 'Claims Filed': claims,
        'Claim Amount Paid': severity, 'Average Claim Severity': severity,
        'Suspension History': viol > 2 ? 'Yes' : 'No',
        'Annual Premium': premium,
        'Bundled Policies': pick(['None', 'Home', 'Life', 'Home+Life']),
        'Payment History': pick(['On-time', 'Late 1-2', 'Late 3+']),
        'Discount Eligibility': pick(['Yes', 'No']),
        'Telematics Enrolled': pick(['Yes', 'No']),
        'Defensive Driving Course': pick(['Yes', 'No']),
        'Good Student Discount': ageB === '18-24' ? pick(['Yes', 'No']) : 'No',
        'Loyalty Program': pick(['Bronze', 'Silver', 'Gold', 'None']),
        'Quote Conversion Rate': +(0.15 + rnd() * 0.6).toFixed(3),
        'Competitor Policies Held': Math.floor(rnd() * 3),
        'Coverage Gap Months': Math.floor(rnd() * 5),
        'Occupational Hazard Rating': Math.round(1 + rnd() * 4),
        'Customer Lifetime Value': +(premium * (3 + rnd() * 8)).toFixed(2),
        'Last Renewal Date': new Date(2025, Math.floor(rnd() * 12), 1 + Math.floor(rnd() * 27)).toISOString().slice(0, 10),
        'Communication Preference': pick(['Email', 'Phone', 'Mail', 'SMS']),
      });
    }
    loadDataset({ name: 'sample-auto-insurance.csv', columns: Object.keys(rows[0]), rows, parseMs: 5 });
  }

  document.addEventListener('DOMContentLoaded', boot);
  global.TabulaMetricsApp = { STATE, analyse, loadDataset };
})(typeof window !== 'undefined' ? window : globalThis);
