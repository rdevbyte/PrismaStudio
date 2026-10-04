/* Regression coverage for the reviewed parser, statistics, privacy and rendering defects. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const root = path.join(__dirname, '..');
const g = globalThis;
g.window = g;
g.performance = g.performance || { now: () => Date.now() };
for (const file of ['analysis.js', 'insights.js', 'charts.js', 'parse.js', 'pipeline.js']) {
  (0, eval)(fs.readFileSync(path.join(root, 'src', file), 'utf8'));
}
const A = g.TabulaMetricsAnalysis, I = g.TabulaMetricsInsights, C = g.TabulaMetricsCharts, P = g.TabulaMetricsParse, Pipeline = g.TabulaMetricsPipeline;

const pendingTests = [];
function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      pendingTests.push(result.then(() => console.log('  pass ' + name)).catch((error) => {
        console.error('  FAIL ' + name + ': ' + (error.stack || error)); process.exitCode = 1;
      }));
    } else console.log('  pass ' + name);
  } catch (error) {
    console.error('  FAIL ' + name + ': ' + (error.stack || error));
    process.exitCode = 1;
  }
}
function zipStore(entries) {
  const locals = [], central = [];
  let offset = 0;
  for (const [fileName, text] of Object.entries(entries)) {
    const name = Buffer.from(fileName), data = Buffer.from(text);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0, 8);
    dir.writeUInt16LE(0, 10);
    dir.writeUInt32LE(0, 16);
    dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt16LE(0, 30);
    dir.writeUInt16LE(0, 32);
    dir.writeUInt16LE(0, 34);
    dir.writeUInt16LE(0, 36);
    dir.writeUInt32LE(0, 38);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += local.length + name.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, directory, end]);
}

console.log('Parser and safety regressions:');
test('collision-safe duplicate headers remain unique', () => {
  const result = P.toObjects([['Name', 'Name', 'Name (2)', 'Name'], ['a', 'b', 'c', 'd']]);
  assert.strictEqual(new Set(result.columns).size, result.columns.length);
  assert.deepStrictEqual(result.columns, ['Name', 'Name (2)', 'Name (2) (2)', 'Name (3)']);
});
test('special object property column names remain ordinary data', () => {
  const result = P.toObjects([['__proto__', 'constructor', 'toString'], ['safe', 'value', 'text']]);
  assert.strictEqual(result.rows[0].__proto__, 'safe');
  assert.strictEqual(result.rows[0].constructor, 'value');
  assert.strictEqual(Object.getPrototypeOf(result.rows[0]), null);
});
test('delimited parser enforces row, cell and field-size budgets', () => {
  const limits = { maxRows: 2, maxColumns: 3, maxCells: 4, maxFieldChars: 3 };
  assert.throws(() => P.parseDelimited('a\n1\n2', ',', limits), /more than 2 rows/);
  assert.throws(() => P.parseDelimited('a,b\n1,2\n3,4', ',', limits), /more than 4 cells/);
  assert.throws(() => P.parseDelimited('a\n1234', ',', limits), /single cell exceeds 3 characters/);
});
test('150,000 numeric values profile without argument-spread failure', () => {
  const values = Array.from({ length: 150000 }, (_, i) => i);
  const profile = A.profileColumn('Metric', values, 'number');
  assert.strictEqual(profile.min, 0);
  assert.strictEqual(profile.max, 149999);
  assert.strictEqual(profile.histogram.reduce((s, bin) => s + bin.count, 0), values.length);
});
test('scatter chart finds extrema for large inputs without spreading arguments', () => {
  const xs = Array.from({ length: 150000 }, (_, i) => i);
  const ys = xs.map((x) => 2 * x + (x % 7));
  const svg = C.scatter(xs, ys);
  assert(svg.startsWith('<svg'));
  assert(svg.includes('showing 2,000 of 150,000 points'));
});
test('XLSX parser follows workbook relationship order rather than sheet filenames', async () => {
  const workbook = '<workbook xmlns:r="urn:r"><sheets><sheet name="Visible first" sheetId="1" r:id="rId2"/><sheet name="Hidden second" sheetId="2" state="hidden" r:id="rId1"/></sheets></workbook>';
  const rels = '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet9.xml"/></Relationships>';
  const sheet = (label, value) => `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${label}</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>${value}</t></is></c></row></sheetData></worksheet>`;
  const buffer = zipStore({
    'xl/workbook.xml': workbook,
    'xl/_rels/workbook.xml.rels': rels,
    'xl/worksheets/sheet1.xml': sheet('HiddenField', 'wrong sheet'),
    'xl/worksheets/sheet9.xml': sheet('VisibleField', 'right sheet'),
  });
  const file = { name: 'reordered.xlsx', arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) };
  const parsed = await P.parseFile(file);
  assert.strictEqual(parsed.sheetName, 'Visible first');
  assert.deepStrictEqual(parsed.columns, ['VisibleField']);
  assert.strictEqual(parsed.rows[0].VisibleField, 'right sheet');
});

console.log('\nStatistical regressions:');
test('Benjamini–Hochberg adjusted p-values are monotone and correct', () => {
  const out = A.adjustPValues([{ p: 0.01 }, { p: 0.04 }, { p: 0.03 }, { p: 0.2 }]);
  assert(Math.abs(out[0].pAdj - 0.04) < 1e-12);
  assert(Math.abs(out[1].pAdj - (0.04 * 4 / 3)) < 1e-12);
  assert(Math.abs(out[2].pAdj - (0.04 * 4 / 3)) < 1e-12);
  assert.strictEqual(out[3].pAdj, 0.2);
});
test('ANOVA handles perfect separation and fully constant outcomes', () => {
  const perfect = A.etaSquared([{ values: [1, 1, 1] }, { values: [2, 2, 2] }]);
  assert.strictEqual(perfect.eta2, 1);
  assert.strictEqual(perfect.omega2, 1);
  assert.strictEqual(perfect.f, Infinity);
  assert.strictEqual(perfect.p, 0);
  const constant = A.etaSquared([{ values: [2, 2, 2] }, { values: [2, 2, 2] }]);
  assert.strictEqual(constant.eta2, 0);
  assert.strictEqual(constant.f, 0);
  assert(Number.isNaN(constant.p));
});
test('high-cardinality sample η² is not retained as a significant driver by effect size alone', () => {
  const rows = [];
  const bump = Math.sqrt(0.15 / 0.85);
  const residuals = [-1, 1, -1, 1, -1, 1, -1, 1];
  for (let group = 0; group < 39; group++) {
    for (let rep = 0; rep < residuals.length; rep++) {
      rows.push({ group: 'G' + group, score: (group % 2 ? bump : -bump) + residuals[rep] });
    }
  }
  const result = A.driverAnalysis(rows, ['group'], ['score'])[0];
  assert(result.eta2 > 0.1, `expected visibly large sample eta², got ${result.eta2}`);
  assert(result.pAdj >= 0.05, `expected no adjusted significance, got ${result.pAdj}`);
  const ctx = Pipeline.analyse({ name: 'noise.csv', columns: ['group', 'score'], rows }, { group: 'category', score: 'number' });
  assert(!ctx.driverResults.some((driver) => driver.driver === 'group'));
});
test('sparse expected counts withhold asymptotic chi-square p-values', () => {
  const a = ['rare', ...Array(100).fill('common')];
  const b = ['x', ...Array(50).fill('x'), ...Array(50).fill('y')];
  const sparse = A.cramersV(a, b);
  assert.strictEqual(sparse.chiSquareReliable, false);
  assert(Number.isNaN(sparse.p));
  const balancedA = [], balancedB = [];
  for (let i = 0; i < 10; i++) { balancedA.push('a', 'a', 'b', 'b'); balancedB.push('x', 'y', 'x', 'y'); }
  const balanced = A.cramersV(balancedA, balancedB);
  assert.strictEqual(balanced.chiSquareReliable, true);
  assert.strictEqual(balanced.p, 1);
});
test('segment scan compares each group with the remaining rows and adjusts q-values', () => {
  const rows = [];
  for (let i = 0; i < 300; i++) rows.push({
    group: i < 100 ? 'treated' : 'control',
    metric: i < 100 ? 10 + (i % 2) * 0.1 : (i % 2) * 0.1,
  });
  const result = A.segmentScan(rows, ['group'], 'metric').find((s) => s.value === 'treated');
  assert(result);
  assert(result.t > 10);
  assert(result.pAdj < 0.05);
  assert.strictEqual(result.n, 100);
});
test('seasonality requires repeated calendar coverage', () => {
  const daily = (days) => Array.from({ length: days }, (_, i) => {
    const date = new Date(Date.UTC(2023, 0, 1 + i));
    return { t: date.getTime(), date, value: 10 + (i % 7) };
  });
  assert.strictEqual(A.seasonality(daily(21)), null);
  assert.strictEqual(A.seasonality(daily(56)), null);
  const eightWeeks = A.seasonality(daily(57));
  assert(eightWeeks && eightWeeks.dow.length === 7 && eightWeeks.month.length === 0);
  const twoYears = A.seasonality(daily(800));
  assert(twoYears && twoYears.month.length === 12);
});
test('numeric identifiers, postal codes and year fields infer safely', () => {
  const ids = Array.from({ length: 100 }, (_, i) => String(i + 1));
  assert.strictEqual(A.inferType(ids, 'customer_id'), 'id');
  assert.strictEqual(A.inferType(ids, 'account_code'), 'category');
  assert.strictEqual(A.inferType(ids, 'postal_code'), 'category');
  assert.strictEqual(A.inferType(Array(100).fill(2024), 'year'), 'category');
  assert.strictEqual(A.inferType(ids, 'measurement'), 'number');
});
test('date parser rejects impossible ISO and slash dates but accepts leap days', () => {
  assert(A.parseDateLike('2024-02-29'));
  assert.strictEqual(A.parseDateLike('2023-02-29'), null);
  assert.strictEqual(A.parseDateLike('2024-13-01'), null);
  assert.strictEqual(A.parseDateLike('02/30/2024'), null);
  assert(A.parseDateLike('0001-01-01'));
});

console.log('\nEscaping regressions:');
test('analysis narratives and SVG chart labels escape attacker-controlled headers and values', () => {
  const metric = 'revenue <img src=x onerror=alert(1)>';
  const category = 'segment <svg onload=alert(2)>';
  const payload = '<img src=x onerror=alert(3)>';
  const rows = Array.from({ length: 80 }, (_, i) => ({
    [metric]: i < 40 ? i + 1 : i + 100,
    [category]: i < 40 ? payload : 'ordinary',
  }));
  const ctx = Pipeline.analyse({ name: 'xss.csv', columns: [metric, category], rows }, { [metric]: 'number', [category]: 'category' });
  const renderedFindings = ctx.findings.map((finding) => `<h3>${I.esc(finding.title)}</h3><p>${finding.body}</p><p>${I.esc(finding.why)}</p>`).join('');
  const renderedActions = ctx.actions.map((action) => `<div>${action.text}</div>`).join('');
  const charts = C.barH([{ label: payload, value: 2 }]) + C.scatter([1, 2, 3], [1, 2, 3], { xLabel: metric, yLabel: category });
  const output = [ctx.summary, renderedFindings, renderedActions, charts].join('\n');
  assert(output.includes('&lt;img'));
  assert(output.includes('&lt;svg'));
  assert(!/<img\s+src=x\s+onerror=/i.test(output));
  assert(!/<svg\s+onload=/i.test(output));
});

Promise.all(pendingTests).then(() => {
  console.log(process.exitCode ? '\nRegression failures detected.' : '\nAll regression tests passed.');
});
