/* ============================================================
   PrismaStudio — Application shell & dashboard renderer
   ============================================================ */
(function (global) {
  'use strict';
  const A = global.PrismaAnalysis, I = global.PrismaInsights, C = global.PrismaCharts, P = global.PrismaParse;
  const { fmtNum, fmtPct, fmtP, fmtDate } = A;
  const esc = I.esc, trunc = I.trunc;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const el = (id) => document.getElementById(id);

  const STATE = {
    dataset: null, types: {}, analysis: null, filters: {}, pivot: {}, explore: {},
  };

  /* ================= theming ================= */
  const THEMES = ['light', 'dark', 'neon', 'ocean', 'sunset', 'corporate', 'pastel', 'mono'];
  function setTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('prisma-theme', t); } catch (e) { }
  }

  /* ================= boot ================= */
  function boot() {
    try { setTheme(localStorage.getItem('prisma-theme') || 'light'); } catch (e) { setTheme('light'); }
    const sel = el('themeSel');
    sel.value = document.documentElement.getAttribute('data-theme');
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
      if (txt && txt.trim().length > 20 && /[,\t;|]/.test(txt)) loadDataset(P.parseText(txt));
    });
    el('sampleBtn').addEventListener('click', loadSample);
    el('sampleInsuranceBtn').addEventListener('click', loadInsuranceSample);
    el('clearBtn').addEventListener('click', clearSession);
    el('exportBtn').addEventListener('click', exportReport);
  }

  function animateKpis() {
    if (!global.PrismaAnim || !global.PrismaAnim.enabled) return;
    $$('.kvalue').forEach((node) => {
      const raw = node.textContent.trim();
      // only count up pure numeric/percent/currency values
      const m = /^([+-]?)([$]?)([\d,]+(?:\.\d+)?)(%|\/100)?$/.exec(raw);
      if (!m) return;
      const [, sign, cur, digits, suffix] = m;
      const target = parseFloat(digits.replace(/,/g, '')) * (sign === '-' ? -1 : 1);
      const decimals = (digits.split('.')[1] || '').length;
      global.PrismaAnim.countUp(node, target, (v) => {
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
  async function handleFile(file) {
    if (file.size > 60 * 1024 * 1024) return showError('File too large', 'Maximum size is 50 MB. Try filtering the data or splitting the file.');
    showBusy('Parsing ' + file.name + '…');
    try {
      const ds = await P.parseFile(file);
      loadDataset(ds);
    } catch (err) {
      hideBusy();
      showError('Could not read that file', err.message || String(err));
    }
  }

  function loadDataset(ds) {
    const scan = P.healthScan(ds.columns, ds.rows);
    if (scan.blocked) { hideBusy(); return showHealthBlock(scan.terms); }
    STATE.dataset = ds;
    STATE.types = {};
    ds.columns.forEach((c) => { STATE.types[c] = A.inferType(ds.rows.map((r) => r[c]), c); });
    hideBusy();
    renderPreview(scan.override);
  }

  function showBusy(msg) { el('busy').style.display = 'flex'; el('busyMsg').textContent = msg; }
  function hideBusy() { el('busy').style.display = 'none'; }

  function showError(title, msg) {
    el('modalRoot').innerHTML = `<div class="modal-bg"><div class="modal"><div class="modal-icon err">!</div><h3>${esc(title)}</h3><p>${esc(msg)}</p><div class="modal-actions"><button class="btn primary" onclick="document.getElementById('modalRoot').innerHTML=''">Got it</button></div></div></div>`;
  }
  function showHealthBlock(terms) {
    el('modalRoot').innerHTML = `<div class="modal-bg"><div class="modal"><div class="modal-icon err">⛔</div><h3>Health data not supported</h3>
      <p>This file looks like it contains health or medical information, which this tool deliberately does not process (HIPAA guardrail). The file was <b>never analysed</b> and has been dropped from memory.</p>
      <p class="dim small">Triggered by: ${terms.map((t) => `“${esc(t)}”`).join(', ')}</p>
      <div class="note">If this file genuinely holds no protected health information, add a line containing <b>“No PHI”</b> or <b>“de-identified”</b> and re-upload.</div>
      <div class="modal-actions"><button class="btn primary" onclick="document.getElementById('modalRoot').innerHTML=''">Understood</button></div></div></div>`;
  }

  /* ================= preview & type editor ================= */
  const TYPE_OPTIONS = ['number', 'currency', 'percent', 'date', 'category', 'boolean', 'text', 'id'];

  function renderPreview(override) {
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
      ${override ? '<div class="note ok">“No PHI” declaration detected — processed locally, nothing stored.</div>' : ''}
      <div class="chips">${Object.entries(counts).map(([t, n]) => `<span class="chip">${n} ${t}</span>`).join('')}</div>
      <div class="tablewrap preview"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
      <p class="dim small">Types drive the whole report: numeric columns become metrics, categories become drivers and segments, dates unlock trends. Adjust anything that looks wrong.</p>
      <div class="modal-actions"><button class="btn" id="cancelBtn">Cancel</button><button class="btn primary" id="analyzeBtn">Analyse →</button></div>
    </div></div>`;
    if (global.PrismaAnim) global.PrismaAnim.modalIn($('.modal'));
    $$('.typesel').forEach((s) => s.addEventListener('change', () => { STATE.types[s.dataset.col] = s.value; }));
    el('cancelBtn').addEventListener('click', () => { el('modalRoot').innerHTML = ''; STATE.dataset = null; });
    el('analyzeBtn').addEventListener('click', () => { el('modalRoot').innerHTML = ''; runAnalysis(); });
  }

  /* ================= analysis orchestration ================= */
  function runAnalysis() {
    showBusy('Analysing…');
    setTimeout(() => {
      try {
        STATE.analysis = analyse(STATE.dataset, STATE.types);
        hideBusy();
        renderDashboard();
      } catch (err) {
        hideBusy(); console.error(err);
        showError('Analysis failed', err.message || String(err));
      }
    }, 30);
  }

  function analyse(ds, types) {
    const t0 = performance.now();
    const rows = ds.rows, columns = ds.columns;
    const profiles = columns.map((c) => A.profileColumn(c, rows.map((r) => r[c]), types[c]));
    const byName = Object.fromEntries(profiles.map((p) => [p.name, p]));
    const typeOf = (n) => (byName[n] ? byName[n].type : 'text');

    const numCols = profiles.filter((p) => A.isNumericType(p.type) && !p.constant && p.values && p.values.length > 4).map((p) => p.name);
    const catCols = profiles.filter((p) => A.isGroupable(p.type) && !p.constant && p.unique <= 60).map((p) => p.name);
    const dateCols = profiles.filter((p) => p.type === 'date' && p.dates && p.dates.length > 3).map((p) => p.name);

    // bucket high-cardinality numerics into quintiles so they can act as drivers too
    const derivedCats = [];
    numCols.forEach((c) => {
      if (catCols.length >= 25) return;
      const b = A.binNumeric(rows, c, 5);
      if (!b) return;
      const name = `${c} (quintile)`;
      rows.forEach((r) => { const v = A.parseNumberLike(r[c]); r[name] = isFinite(v) ? b.label(v) : ''; });
      derivedCats.push(name);
    });

    const primaryMetric = I.pickPrimaryMetric(profiles);
    const allCats = [...catCols, ...derivedCats];

    const correlations = A.numericCorrelations(rows, numCols, 0.15);
    // always test the headline metric first, then the other numerics
    const metricsForDrivers = [...new Set([primaryMetric, ...numCols].filter(Boolean))].slice(0, 14);
    const driverResults = A.driverAnalysis(rows, allCats, metricsForDrivers).filter((d) => d.eta2 > 0.005);
    const catAssoc = A.categoricalAssociations(rows, catCols, 0.12);
    const anomalies = A.detectAnomalies(rows, profiles);
    const quality = A.qualityReport(profiles, rows);
    // a metric's own quintile band trivially "predicts" it — exclude from the scan
    const segCats = allCats.filter((c) => c !== `${primaryMetric} (quintile)`);
    const segments = primaryMetric ? A.segmentScan(rows, segCats, primaryMetric) : [];
    const paretoResults = [];
    if (primaryMetric) {
      catCols.slice(0, 6).forEach((c) => {
        const pr = A.pareto(rows, c, primaryMetric);
        if (pr.items.length >= 3) paretoResults.push({ ...pr, column: c, metric: primaryMetric });
      });
      paretoResults.sort((a, b) => a.pct80 - b.pct80);
    }

    let series = null, forecastResult = null, seasonal = null, dateCol = null, partialTrimmed = false;
    if (dateCols.length && primaryMetric) {
      dateCol = dateCols[0];
      series = A.buildTimeSeries(rows, dateCol, primaryMetric, 'sum');
      // A trailing partial period (far fewer records than typical) drags the last
      // point toward zero and distorts both the chart and the projection baseline.
      if (series.length > 8) {
        const counts = series.map((p) => p.n);
        const typical = A.median(counts);
        while (series.length > 8 && series[series.length - 1].n < typical * 0.5) {
          series = series.slice(0, -1);
          partialTrimmed = true;
        }
      }
      if (series.length > 5) {
        const spanDays = (series[series.length - 1].t - series[0].t) / 86400000;
        forecastResult = A.forecast(series, Math.max(14, Math.round(spanDays * 0.25)));
        seasonal = A.seasonality(series);
      } else series = null;
    }

    const ctx = {
      rows, columns, profiles, byName, typeOf, numCols, catCols: allCats, baseCats: catCols, dateCols, derivedCats,
      primaryMetric, correlations, driverResults, catAssoc, anomalies, quality, segments,
      paretoResults, series, forecastResult, seasonal, dateCol, partialTrimmed,
      domain: I.detectDomain(columns),
    };
    ctx.findings = I.buildFindings(ctx);
    ctx.summary = I.buildSummary(ctx);
    ctx.actions = I.buildActions(ctx);
    ctx.elapsed = Math.round(performance.now() - t0);
    return ctx;
  }

  /* ================= dashboard ================= */
  function renderDashboard() {
    const a = STATE.analysis, ds = STATE.dataset;
    el('landing').style.display = 'none';
    el('appbar').classList.add('active');
    const root = el('dashboard');
    root.style.display = 'block';
    root.innerHTML = `
      <div class="filebar"><span class="pill">📄 ${esc(ds.name)}</span>
        <span class="pill">${ds.rows.length.toLocaleString()} rows × ${ds.columns.length} cols</span>
        ${a.domain ? `<span class="pill accent">${esc(a.domain.label)} detected</span>` : ''}
        <span class="pill">${a.findings.length} findings</span>
        <span class="pill">analysed in ${a.elapsed}ms</span></div>

      <section class="card summary">
        <div class="sechead"><span class="sicon">📋</span><h2>Executive summary</h2></div>
        <p class="lead">${a.summary}</p>
      </section>

      ${renderKpiStrip(a)}
      ${renderNav()}
      <div id="tab-findings" class="tabpane active">${renderFindings(a)}${renderActions(a)}</div>
      <div id="tab-drivers" class="tabpane">${renderDrivers(a)}</div>
      <div id="tab-relations" class="tabpane">${renderRelations(a)}</div>
      <div id="tab-segments" class="tabpane">${renderSegments(a)}</div>
      <div id="tab-columns" class="tabpane">${renderColumns(a)}</div>
      <div id="tab-time" class="tabpane">${renderTime(a)}</div>
      <div id="tab-quality" class="tabpane">${renderQuality(a)}</div>
      <div id="tab-explore" class="tabpane">${renderExplore(a)}</div>
      <div id="tab-data" class="tabpane">${renderDataTab(a)}</div>
    `;
    wireDashboard(a);
    window.scrollTo(0, 0);
    if (global.PrismaAnim) {
      global.PrismaAnim.enterDashboard(root);
      // wait a frame so the freshly-injected pane has real dimensions
      requestAnimationFrame(() => global.PrismaAnim.observe(el('tab-findings')));
      animateKpis();
    }
  }

  const TABS = [
    ['findings', '💡 Findings'], ['drivers', '🎯 Drivers'], ['relations', '🔗 Relationships'],
    ['segments', '🧭 Segments'], ['columns', '📚 Column Profiles'], ['time', '📈 Trends'],
    ['quality', '🧪 Data Quality'], ['explore', '🔬 Explore'], ['data', '🗂 Data'],
  ];
  function renderNav() {
    return `<nav class="tabs">${TABS.map(([id, label], i) => `<button class="tab${i === 0 ? ' active' : ''}" data-tab="${id}">${label}</button>`).join('')}</nav>`;
  }

  function renderKpiStrip(a) {
    const cards = [];
    cards.push({ label: 'Rows analysed', value: a.rows.length.toLocaleString(), sub: `${a.columns.length} columns` });
    cards.push({ label: 'Data quality', value: a.quality.score + '/100', sub: `${a.quality.issues.length} issue${a.quality.issues.length === 1 ? '' : 's'}`, tone: a.quality.score >= 90 ? 'pos' : a.quality.score >= 70 ? 'warn' : 'neg' });
    const kpiDriver = a.driverResults.find((d) => d.metric === a.primaryMetric) || a.driverResults[0];
    if (kpiDriver) {
      cards.push({ label: 'Top driver', value: trunc(kpiDriver.driver, 22), sub: `explains ${(kpiDriver.eta2 * 100).toFixed(0)}% of ${trunc(kpiDriver.metric, 16)}`, tone: 'accent' });
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

  function renderActions(a) {
    return `<section class="card"><div class="sechead"><span class="sicon">🚀</span><h2>Recommended next steps</h2></div>
      <ul class="actions">${a.actions.map((x) => `<li><span>${x.icon}</span><div>${x.text}</div></li>`).join('')}</ul></section>`;
  }

  /* ---------- drivers ---------- */
  function renderDrivers(a) {
    if (!a.driverResults.length) {
      return `<section class="card"><div class="sechead"><span class="sicon">🎯</span><h2>Driver analysis</h2></div>
        <p class="empty">Driver analysis needs at least one numeric metric and one categorical column with 2+ groups of 3+ rows each. This file didn't provide that combination — check the column types in the preview step.</p></section>`;
    }
    // lead with drivers of the headline metric so the most relevant rows are visible first
    const ordered = [...a.driverResults.filter((d) => d.metric === a.primaryMetric),
                     ...a.driverResults.filter((d) => d.metric !== a.primaryMetric)];
    const top = ordered.slice(0, 14);
    const rows = top.map((d) => `<tr>
        <td><b>${esc(d.driver)}</b></td><td>${esc(d.metric)}</td>
        <td class="num etacell"><span class="bar" style="--w:${Math.min(100, d.eta2 * 100 * 2).toFixed(0)}%"></span><span class="etaval">${(d.eta2 * 100).toFixed(1)}%</span></td>
        <td class="num">${isFinite(d.f) ? d.f.toFixed(1) : '—'}</td><td class="num">${fmtP(d.p)}</td>
        <td>${esc(trunc(d.top.key, 18))} <span class="dim">${fmtNum(d.top.mean, { currency: a.typeOf(d.metric) === 'currency' })}</span></td>
        <td>${esc(trunc(d.bottom.key, 18))} <span class="dim">${fmtNum(d.bottom.mean, { currency: a.typeOf(d.metric) === 'currency' })}</span></td>
        <td class="num">${fmtNum(d.spread, { currency: a.typeOf(d.metric) === 'currency' })}</td>
      </tr>`).join('');

    const detail = top.slice(0, 6).map((d) => {
      const isCur = a.typeOf(d.metric) === 'currency';
      const items = d.levels.slice(0, 12).map((l) => ({ label: l.key, value: l.mean, sub: `n=${l.n}`, color: l.lift >= 0 ? 'var(--c1)' : 'var(--c4)' }));
      return `<div class="subcard">
        <h4>${esc(d.driver)} → ${esc(d.metric)}</h4>
        <p class="dim small">η² = ${d.eta2.toFixed(3)} · F = ${isFinite(d.f) ? d.f.toFixed(1) : '—'} · ${fmtP(d.p)} · ${d.levels.length} groups · n = ${d.n}</p>
        ${C.barH(items, { currency: isCur })}
        <table class="mini"><thead><tr><th>Group</th><th class="num">n</th><th class="num">Mean</th><th class="num">Median</th><th class="num">vs avg</th></tr></thead>
        <tbody>${d.levels.slice(0, 12).map((l) => `<tr><td>${esc(trunc(l.key, 26))}</td><td class="num">${l.n}</td><td class="num">${fmtNum(l.mean, { currency: isCur })}</td><td class="num">${fmtNum(l.median, { currency: isCur })}</td><td class="num ${l.lift >= 0 ? 'pos' : 'neg'}">${l.lift >= 0 ? '+' : ''}${l.lift.toFixed(1)}%</td></tr>`).join('')}</tbody></table>
      </div>`;
    }).join('');

    return `<section class="card">
      <div class="sechead"><span class="sicon">🎯</span><h2>What actually drives your metrics</h2><span class="dim small">one-way ANOVA · η² effect size</span></div>
      <p class="explain">Each row measures how much of a metric's variation is explained by splitting the data on a categorical field. <b>η² (eta-squared)</b> runs 0–1: above 0.14 is a large effect, 0.06–0.14 medium, below 0.06 small. Numeric fields are also bucketed into quintiles so they can be tested as drivers.</p>
      <div class="tablewrap"><table><thead><tr><th>Driver</th><th>Metric</th><th class="num">η² explained</th><th class="num">F</th><th class="num">Significance</th><th>Highest group</th><th>Lowest group</th><th class="num">Spread</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="grid2">${detail}</div>
    </section>`;
  }

  /* ---------- relationships ---------- */
  function renderRelations(a) {
    let html = '<section class="card"><div class="sechead"><span class="sicon">🔗</span><h2>Numeric relationships</h2><span class="dim small">Pearson r, Spearman ρ, significance</span></div>';
    if (!a.correlations.length) {
      html += `<p class="empty">No numeric pairs reached |r| ≥ 0.15. That usually means the numeric columns are independent, or there are too few numeric columns (this file has ${a.numCols.length}).</p>`;
    } else {
      html += `<p class="explain">r measures straight-line association from −1 to +1. r² is the share of variance shared. Where Spearman ρ clearly exceeds r, the relationship is monotonic but curved — a linear model would understate it.</p>
      <div class="tablewrap"><table><thead><tr><th>Field A</th><th>Field B</th><th class="num">r</th><th class="num">r²</th><th class="num">Spearman ρ</th><th class="num">n</th><th class="num">Significance</th><th>Reading</th></tr></thead><tbody>
      ${a.correlations.slice(0, 25).map((c) => `<tr><td>${esc(c.a)}</td><td>${esc(c.b)}</td>
        <td class="num ${c.r >= 0 ? 'pos' : 'neg'}"><b>${c.r.toFixed(3)}</b></td><td class="num">${(c.r * c.r * 100).toFixed(0)}%</td>
        <td class="num">${isFinite(c.rho) ? c.rho.toFixed(3) : '—'}</td><td class="num">${c.n}</td><td class="num">${fmtP(c.p)}</td>
        <td>${esc(c.strength)}${c.nonlinear ? ' <span class="tagpill">non-linear</span>' : ''}${c.p >= 0.05 ? ' <span class="tagpill warn">not significant</span>' : ''}</td></tr>`).join('')}
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
        return `<div class="subcard"><h4>${esc(c.a)} vs ${esc(c.b)}</h4><p class="dim small">r = ${c.r.toFixed(3)} · ${fmtP(c.p)} · n = ${c.n}</p>
          ${C.scatter(xs, ys, { xLabel: c.a, yLabel: c.b, xCurrency: a.typeOf(c.a) === 'currency', yCurrency: a.typeOf(c.b) === 'currency' })}</div>`;
      }).join('')}</div>`;
    }
    html += '</section>';

    html += '<section class="card"><div class="sechead"><span class="sicon">🧩</span><h2>Categorical associations</h2><span class="dim small">Cramér\'s V · chi-square</span></div>';
    if (!a.catAssoc.length) html += '<p class="empty">No categorical pairs showed meaningful association (Cramér\'s V ≥ 0.12).</p>';
    else html += `<p class="explain">Cramér's V measures how strongly two categorical fields move together, from 0 (independent) to 1 (one perfectly predicts the other). Values above 0.7 often signal redundant or derived columns.</p>
      <div class="tablewrap"><table><thead><tr><th>Field A</th><th>Field B</th><th class="num">Cramér's V</th><th class="num">χ²</th><th class="num">Significance</th><th class="num">Levels</th><th>Reading</th></tr></thead><tbody>
      ${a.catAssoc.slice(0, 20).map((c) => `<tr><td>${esc(c.a)}</td><td>${esc(c.b)}</td><td class="num"><b>${c.v.toFixed(3)}</b></td><td class="num">${c.chi2.toFixed(1)}</td><td class="num">${fmtP(c.p)}</td><td class="num">${c.la}×${c.lb}</td>
      <td>${c.v >= 0.7 ? 'near-duplicate fields' : c.v >= 0.4 ? 'strong overlap' : c.v >= 0.25 ? 'moderate overlap' : 'mild overlap'}</td></tr>`).join('')}</tbody></table></div>`;
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
      <table class="mini"><thead><tr><th>Field</th><th>Value</th><th class="num">n</th><th class="num">Mean</th><th class="num">vs avg</th><th class="num">z</th></tr></thead><tbody>
      ${list.map((s) => `<tr><td>${esc(trunc(s.column, 18))}</td><td>${esc(trunc(s.value, 20))}</td><td class="num">${s.n}</td><td class="num">${fmtNum(s.mean, { currency: isCur })}</td><td class="num ${s.lift >= 0 ? 'pos' : 'neg'}">${s.lift >= 0 ? '+' : ''}${s.lift.toFixed(1)}%</td><td class="num">${s.z.toFixed(1)}</td></tr>`).join('')}
      </tbody></table></div>`;
    let html = `<section class="card"><div class="sechead"><span class="sicon">🧭</span><h2>Segment scan — ${esc(a.primaryMetric)}</h2><span class="dim small">every category value ranked by deviation</span></div>
      <p class="explain">Each value of every categorical field is compared against the dataset average for <b>${esc(a.primaryMetric)}</b>. The z-score accounts for segment size, so a small segment needs a bigger gap to rank highly. |z| ≥ 2 is unlikely to be noise.</p>
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

    if (a.seasonal) {
      html += `<section class="card"><div class="sechead"><span class="sicon">🗓️</span><h2>Seasonality</h2></div>
        <div class="grid2">
          <div class="subcard"><h4>Day of week (index, 100 = average)</h4>${C.barH(a.seasonal.dow.filter((d) => d.n).map((d) => ({ label: d.label, value: d.index - 100, sub: `n=${d.n}`, color: d.index >= 100 ? 'var(--pos)' : 'var(--neg)' })), {})}</div>
          <div class="subcard"><h4>Month (index, 100 = average)</h4>${C.barH(a.seasonal.month.filter((d) => d.n).map((d) => ({ label: d.label, value: d.index - 100, sub: `n=${d.n}`, color: d.index >= 100 ? 'var(--pos)' : 'var(--neg)' })), {})}</div>
        </div>
        <p class="explain">Bars show deviation from the overall daily average. Values above zero run hotter than typical.</p></section>`;
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
    const periods = [...buckets.entries()].sort((x, y) => x[0].localeCompare(y[0])).map(([key, vals]) => ({
      key, n: vals.length, sum: A.sum(vals), mean: A.mean(vals), median: A.median(vals),
      min: Math.min(...vals), max: Math.max(...vals),
    }));
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
    if (global.PrismaAnim) global.PrismaAnim.play(el('exploreOut'));
  }

  function drawScatter() {
    const a = STATE.analysis;
    const x = el('scX').value, y = el('scY').value;
    const [xs, ys] = pairFor(a.rows, x, y);
    if (xs.length < 3) { el('scatterOut').innerHTML = '<p class="empty">Not enough paired values.</p>'; return; }
    const r = A.pearson(xs, ys), rho = A.spearman(xs, ys), p = A.corrPValue(r, xs.length);
    el('scatterOut').innerHTML = `<p class="dim small">n = ${xs.length} · r = ${r.toFixed(3)} · ρ = ${rho.toFixed(3)} · ${fmtP(p)} · r² = ${(r * r * 100).toFixed(1)}%</p>
      ${C.scatter(xs, ys, { width: 760, height: 380, xLabel: x, yLabel: y, xCurrency: a.typeOf(x) === 'currency', yCurrency: a.typeOf(y) === 'currency' })}`;
    if (global.PrismaAnim) global.PrismaAnim.play(el('scatterOut'));
  }

  function drawPivot() {
    const a = STATE.analysis;
    const r = el('pvRow').value, c = el('pvCol').value, m = el('pvMetric').value, agg = el('pvAgg').value;
    const ct = A.crossTab(a.rows, r, c, m || null, agg);
    el('pivotOut').innerHTML = C.heatmap(ct, { currency: m && a.typeOf(m) === 'currency', maxWidth: pivotWidth() });
    if (global.PrismaAnim) global.PrismaAnim.play(el('pivotOut'));
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
      $$('.tab').forEach((x) => x.classList.remove('active'));
      $$('.tabpane').forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      const pane = el('tab-' + t.dataset.tab);
      pane.classList.add('active');
      if (t.dataset.tab === 'explore') { drawExplore(); if (el('scX')) drawScatter(); }
      window.scrollTo({ top: 0, behavior: 'smooth' });
      // swapTab defers observe() to the next frame, once the pane has layout
      if (global.PrismaAnim) global.PrismaAnim.swapTab(pane);
    }));
    ['pvRow', 'pvCol', 'pvMetric', 'pvAgg'].forEach((id) => { const e = el(id); if (e) e.addEventListener('change', drawPivot); });
    if (el('pvRow')) {
      let rt = null;
      window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (el('pivotOut')) drawPivot(); }, 180); });
    }
    ['exMetric', 'exGroup', 'exSort'].forEach((id) => { const e = el(id); if (e) e.addEventListener('change', drawExplore); });
    ['scX', 'scY'].forEach((id) => { const e = el(id); if (e) e.addEventListener('change', drawScatter); });
  }

  function clearSession() {
    STATE.dataset = null; STATE.analysis = null;
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
    const html = `<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8"><title>PrismaStudio report — ${esc(STATE.dataset.name)}</title><style>${style}
      .tabpane{display:block!important} .tabs{display:none} .controls{display:none} .exph{margin:32px 0 8px;font-size:22px}</style></head>
      <body><main class="wrap"><h1>PrismaStudio report</h1><p class="dim">${esc(STATE.dataset.name)} · ${a.rows.length.toLocaleString()} rows × ${a.columns.length} columns · generated ${new Date().toLocaleString()}</p>
      <section class="card summary"><h2>Executive summary</h2><p class="lead">${a.summary}</p></section>
      ${renderKpiStrip(a)}${panes}</main></body></html>`;
    download(html, `prismastudio-report-${Date.now()}.html`, 'text/html');
    toast('Report exported as a standalone HTML file.');
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
  global.PrismaApp = { STATE, analyse, loadDataset };
})(typeof window !== 'undefined' ? window : globalThis);
