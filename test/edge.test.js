/* Edge-case robustness: every shape of data must still yield findings */
const fs = require('fs'), path = require('path');
const SRC = path.join(__dirname, '..', 'src');
const g = globalThis; g.window = g;
g.performance = g.performance || { now: () => Date.now() };
['analysis.js', 'insights.js', 'parse.js'].forEach((f) => eval(fs.readFileSync(path.join(SRC, f), 'utf8')));
const A = g.TabulaMetricsAnalysis, I = g.TabulaMetricsInsights, P = g.TabulaMetricsParse;

function analyse(ds) {
  const { rows, columns } = ds;
  const types = {}; columns.forEach((c) => types[c] = A.inferType(rows.map((r) => r[c]), c));
  const profiles = columns.map((c) => A.profileColumn(c, rows.map((r) => r[c]), types[c]));
  const byName = Object.fromEntries(profiles.map((p) => [p.name, p]));
  const typeOf = (n) => byName[n] ? byName[n].type : 'text';
  const numCols = profiles.filter((p) => A.isNumericType(p.type) && !p.constant && p.values && p.values.length > 4).map((p) => p.name);
  const catCols = profiles.filter((p) => A.isGroupable(p.type) && !p.constant && p.unique <= 60).map((p) => p.name);
  const dateCols = profiles.filter((p) => p.type === 'date' && p.dates && p.dates.length > 3).map((p) => p.name);
  const derivedCats = [];
  numCols.forEach((c) => { if (catCols.length + derivedCats.length >= 25) return; const b = A.binNumeric(rows, c, 5); if (!b) return; const n = `${c} (quintile)`; rows.forEach((r) => { const v = A.parseNumberLike(r[c]); r[n] = isFinite(v) ? b.label(v) : ''; }); derivedCats.push(n); });
  const allCats = [...catCols, ...derivedCats];
  const primaryMetric = I.pickPrimaryMetric(profiles);
  const correlationsAll = A.numericCorrelations(rows, numCols, 0);
  const correlations = correlationsAll.filter((c) => Math.abs(c.r) >= .15 && c.pAdj < .05);
  const driverAll = A.driverAnalysis(rows, allCats, [...new Set([primaryMetric, ...numCols].filter(Boolean))].slice(0, 14));
  const driverResults = driverAll.filter((d) => d.eta2 > .005 && d.pAdj < .05);
  const catAssocAll = A.categoricalAssociations(rows, catCols, 0);
  const catAssoc = catAssocAll.filter((c) => c.v >= .12 && c.chiSquareReliable && c.pAdj < .05);
  const anomalies = A.detectAnomalies(rows, profiles);
  const quality = A.qualityReport(profiles, rows);
  const segments = primaryMetric ? A.segmentScan(rows, allCats.filter((c) => c !== `${primaryMetric} (quintile)`), primaryMetric) : [];
  const paretoResults = primaryMetric ? catCols.slice(0, 6).map((c) => ({ ...A.pareto(rows, c, primaryMetric), column: c, metric: primaryMetric })).filter((p) => p.items.length >= 3) : [];
  let series = null, forecastResult = null, seasonal = null, dateCol = null;
  if (dateCols.length && primaryMetric) {
    dateCol = dateCols[0];
    series = A.buildTimeSeries(rows, dateCol, primaryMetric, 'sum');
    if (series.length > 5) { const span = (series[series.length - 1].t - series[0].t) / 864e5; forecastResult = A.forecast(series, Math.max(14, Math.round(span * .25))); seasonal = A.seasonality(series); } else series = null;
  }
  const ctx = { rows, columns, profiles, byName, typeOf, numCols, catCols: allCats, baseCats: catCols, dateCols, primaryMetric, correlations, correlationsAll, driverResults, driverAll, catAssoc, catAssocAll, anomalies, quality, segments, paretoResults, noise: A.noiseFloor(rows.length), series, forecastResult, seasonal, dateCol, domain: I.detectDomain(columns) };
  ctx.findings = I.buildFindings(ctx); ctx.summary = I.buildSummary(ctx); ctx.actions = I.buildActions(ctx);
  return ctx;
}

const cases = {};

// 1. all-categorical survey, no numerics at all
cases['all-categorical (no numerics)'] = (() => {
  const rows = []; let s = 3; const r = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = (a) => a[Math.floor(r() * a.length)];
  for (let i = 0; i < 300; i++) rows.push({
    Department: pick(['Sales', 'Eng', 'HR', 'Ops']), Satisfied: pick(['Yes', 'No']),
    Region: pick(['NA', 'EU', 'APAC']), Tenure: pick(['<1y', '1-3y', '3-5y', '5y+']),
    Remote: pick(['Onsite', 'Hybrid', 'Remote']),
  });
  return { columns: Object.keys(rows[0]), rows };
})();

// 2. tiny dataset
cases['tiny (6 rows)'] = { columns: ['Item', 'Cost'], rows: [
  { Item: 'a', Cost: 10 }, { Item: 'b', Cost: 22 }, { Item: 'c', Cost: 8 },
  { Item: 'd', Cost: 31 }, { Item: 'e', Cost: 14 }, { Item: 'f', Cost: 27 }] };

// 3. single numeric column only
cases['single numeric column'] = (() => {
  const rows = []; for (let i = 0; i < 200; i++) rows.push({ Value: Math.round(Math.exp(Math.random() * 6)) });
  return { columns: ['Value'], rows };
})();

// 4. messy: missing values, mixed case, dupes, currency strings
cases['messy currency + missing + dupes'] = (() => {
  const rows = []; let s = 11; const r = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 250; i++) {
    const cat = ['retail', 'Retail', 'RETAIL', 'wholesale', 'Wholesale'][Math.floor(r() * 5)];
    rows.push({ Channel: cat, Amount: r() > .12 ? '$' + (r() * 5000).toFixed(2) : '',
      Qty: r() > .3 ? Math.round(r() * 40) : '', Flag: 'CONSTANT' });
  }
  for (let i = 0; i < 12; i++) rows.push({ ...rows[0] });
  return { columns: Object.keys(rows[0]), rows };
})();

// 5. wide: 60 columns
cases['wide (60 cols)'] = (() => {
  const rows = []; let s = 5; const r = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const cols = []; for (let c = 0; c < 60; c++) cols.push(c % 3 === 0 ? `cat_${c}` : `num_${c}`);
  for (let i = 0; i < 400; i++) { const o = {}; cols.forEach((c, j) => { o[c] = c.startsWith('cat') ? 'G' + Math.floor(r() * 4) : +(r() * 100 + j).toFixed(2); }); rows.push(o); }
  return { columns: cols, rows };
})();

// 6. time series with dates
cases['time series (daily revenue)'] = (() => {
  const rows = []; const start = new Date(2025, 0, 1);
  for (let i = 0; i < 365; i++) { const d = new Date(start.getTime() + i * 864e5);
    rows.push({ Date: d.toISOString().slice(0, 10), Revenue: +(1000 + i * 3 + Math.sin(i / 7) * 300 + Math.random() * 200).toFixed(2), Store: 'S' + (i % 4) }); }
  return { columns: ['Date', 'Revenue', 'Store'], rows };
})();

// 7. european-format CSV via the real parser
cases['parsed semicolon CSV'] = (() => {
  let csv = 'Region;Product;Revenue;Units\n';
  const regs = ['North', 'South', 'East']; const prods = ['A', 'B', 'C', 'D'];
  for (let i = 0; i < 180; i++) csv += `${regs[i % 3]};${prods[i % 4]};${(Math.random() * 900 + 100).toFixed(2)};${Math.ceil(Math.random() * 30)}\n`;
  return P.parseText(csv, 'eu.csv');
})();

// 8. constant + id heavy
cases['id-heavy + constants'] = (() => {
  const rows = []; for (let i = 0; i < 150; i++) rows.push({ UUID: 'u-' + i + '-' + Math.random().toString(36).slice(2), Const: 'X', Note: 'free text row ' + i, Score: Math.round(Math.random() * 100) });
  return { columns: ['UUID', 'Const', 'Note', 'Score'], rows };
})();

// 9. preamble rows before the real header
cases['CSV with title preamble'] = (() => {
  let csv = 'Quarterly Report\nGenerated 2026-01-01\n\nRegion,Segment,Revenue\n';
  for (let i = 0; i < 120; i++) csv += `R${i % 4},S${i % 3},${(Math.random() * 500).toFixed(2)}\n`;
  return P.parseText(csv, 'preamble.csv');
})();

let failures = 0;
console.log('CASE'.padEnd(32) + 'ROWS'.padStart(6) + 'COLS'.padStart(6) + 'FIND'.padStart(6) + 'DRIV'.padStart(6) + 'CORR'.padStart(6) + 'SEG'.padStart(6) + 'ACT'.padStart(5) + '  QUAL');
console.log('-'.repeat(92));
for (const [name, ds] of Object.entries(cases)) {
  let ctx;
  try { ctx = analyse(ds); } catch (e) { console.log(name.padEnd(32) + '  ERROR: ' + e.message); failures++; continue; }
  console.log(name.padEnd(32) + String(ctx.rows.length).padStart(6) + String(ctx.columns.length).padStart(6) +
    String(ctx.findings.length).padStart(6) + String(ctx.driverResults.length).padStart(6) +
    String(ctx.correlations.length).padStart(6) + String(ctx.segments.length).padStart(6) +
    String(ctx.actions.length).padStart(5) + '  ' + ctx.quality.score);
  if (ctx.findings.length === 0) { console.log('    !! zero findings'); failures++; }
  if (!ctx.summary || ctx.summary.length < 60) { console.log('    !! summary too short'); failures++; }
  if (!ctx.actions.length) { console.log('    !! no actions'); failures++; }
}
// spot-check narratives on the hardest case
console.log('\n--- all-categorical narrative ---');
const cc = analyse(cases['all-categorical (no numerics)']);
console.log(cc.summary.replace(/<[^>]+>/g, ''));
cc.findings.slice(0, 3).forEach((f) => console.log('  * ' + f.title));
console.log('\n--- messy data quality ---');
const mm = analyse(cases['messy currency + missing + dupes']);
console.log('score', mm.quality.score);
mm.quality.issues.slice(0, 6).forEach((i) => console.log(`  [${i.sev}] ${i.col}: ${i.msg}`));
console.log('\n--- preamble header detection ---');
console.log('columns =', cases['CSV with title preamble'].columns.join(', '), '| headerRow =', cases['CSV with title preamble'].headerRow);

console.log(failures ? `\nFAILURES: ${failures}` : '\nAll edge cases produced substantive output.');
process.exit(failures ? 1 : 0);
