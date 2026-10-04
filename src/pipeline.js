/* ============================================================
   TabulaMetrics — Analysis pipeline
   Runs without a DOM in either the main thread or an isolated worker.
   ============================================================ */
(function (global) {
  'use strict';
  const A = global.TabulaMetricsAnalysis, I = global.TabulaMetricsInsights;

  function analyse(ds, types) {
    const t0 = performance.now();
    const rows = ds.rows, columns = ds.columns;
    const profiles = columns.map((c) => A.profileColumn(c, rows.map((r) => r[c]), types[c]));
    const byName = Object.fromEntries(profiles.map((p) => [p.name, p]));
    const typeOf = (n) => (byName[n] ? byName[n].type : 'text');

    const numCols = profiles.filter((p) => A.isNumericType(p.type) && !p.constant && p.values && p.values.length > 4).map((p) => p.name);
    const catCols = profiles.filter((p) => A.isGroupable(p.type) && !p.constant && p.unique <= 60).map((p) => p.name);
    const dateCols = profiles.filter((p) => p.type === 'date' && p.dates && p.dates.length > 3).map((p) => p.name);

    // Bucket high-cardinality numerics into quintiles so they can act as drivers too.
    const derivedCats = [];
    numCols.forEach((c) => {
      if (catCols.length + derivedCats.length >= 25) return;
      const b = A.binNumeric(rows, c, 5);
      if (!b) return;
      const name = `${c} (quintile)`;
      rows.forEach((r) => { const v = A.parseNumberLike(r[c]); r[name] = isFinite(v) ? b.label(v) : ''; });
      derivedCats.push(name);
    });

    const primaryMetric = I.pickPrimaryMetric(profiles);
    const allCats = [...catCols, ...derivedCats];

    const correlationsAll = A.numericCorrelations(rows, numCols, 0);
    const correlations = correlationsAll.filter((c) => Math.abs(c.r) >= 0.15 && c.pAdj < 0.05);
    const metricsForDrivers = [...new Set([primaryMetric, ...numCols].filter(Boolean))].slice(0, 14);
    const driverAll = A.driverAnalysis(rows, allCats, metricsForDrivers);
    const driverResults = driverAll.filter((d) => d.eta2 > 0.005 && d.pAdj < 0.05);
    const catAssocAll = A.categoricalAssociations(rows, catCols, 0);
    const catAssoc = catAssocAll.filter((c) => c.v >= 0.12 && c.chiSquareReliable && c.pAdj < 0.05);
    const anomalies = A.detectAnomalies(rows, profiles);
    const quality = A.qualityReport(profiles, rows);
    // A metric's own quintile band trivially restates it; exclude it from this scan.
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
      // Exclude a trailing partial period with far fewer records than typical.
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
      primaryMetric, correlations, correlationsAll, driverResults, driverAll,
      catAssoc, catAssocAll, anomalies, quality, segments,
      noise: A.noiseFloor(rows.length),
      paretoResults, series, forecastResult, seasonal, dateCol, partialTrimmed,
      domain: I.detectDomain(columns),
    };
    ctx.findings = I.buildFindings(ctx);
    ctx.summary = I.buildSummary(ctx);
    ctx.actions = I.buildActions(ctx);
    ctx.elapsed = Math.round(performance.now() - t0);
    return ctx;
  }

  global.TabulaMetricsPipeline = { analyse };
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis));
