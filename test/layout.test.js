/* Regression tests for: pivot overlap + width usage, Trends never empty,
   Explore responsiveness, and tab-label capitalisation. */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const serve = (port) => new Promise((res) => {
  const s = http.createServer((q, r) => {
    r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(path.join(ROOT, 'dist', 'index.html')).pipe(r);
  }).listen(port, '127.0.0.1', () => res(s));
});

// dataset with NO date column, long category names — matches the user's file
function noDateCsv() {
  let csv = 'age_bracket,citation_type,premium_amount,vehicle_class,region\n';
  const ages = ['18-25', '26-35', '36-45', '46-55', '56-65', '65+'];
  const cits = ['None', 'Speeding', 'DUI', 'At-fault Accident', 'Reckless Driving'];
  const veh = ['Sedan', 'SUV', 'Truck'], reg = ['North', 'South', 'East', 'West'];
  let seed = 5; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 900; i++) {
    csv += `${ages[Math.floor(rnd() * 6)]},${cits[Math.floor(rnd() * 5)]},${(2000 + rnd() * 1500).toFixed(2)},${veh[Math.floor(rnd() * 3)]},${reg[Math.floor(rnd() * 4)]}\n`;
  }
  return csv;
}

const measurePivot = () => {
  const svg = document.querySelector('#pivotOut svg');
  if (!svg) return { error: 'no pivot svg' };
  const cont = document.getElementById('pivotOut');
  const texts = [...svg.querySelectorAll('text')];
  const cells = [...svg.querySelectorAll('rect[data-cell]')];
  const gridTop = Math.min(...cells.map((c) => c.getBoundingClientRect().top));
  const headerOverGrid = texts.filter((t) => {
    const r = t.getBoundingClientRect();
    return r.bottom > gridTop + 1 && r.top < gridTop - 1;
  }).map((t) => t.textContent);
  // text-vs-text collisions among same-orientation labels
  let collisions = 0; const samples = [];
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const A = texts[i], B = texts[j];
      const ra = (A.getAttribute('transform') || '').includes('rotate');
      const rb = (B.getAttribute('transform') || '').includes('rotate');
      if (ra !== rb) continue;
      const a = A.getBoundingClientRect(), b = B.getBoundingClientRect();
      if (!(a.right <= b.left + 0.5 || b.right <= a.left + 0.5 || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5)) {
        collisions++; if (samples.length < 3) samples.push(`${A.textContent}/${B.textContent}`);
      }
    }
  }
  const sw = svg.getBoundingClientRect().width;
  return {
    svgW: Math.round(sw), contW: cont.clientWidth,
    fillPct: Math.round((sw / cont.clientWidth) * 100),
    overflows: sw > cont.clientWidth + 2,
    headerOverGrid, collisions, samples,
  };
};

(async () => {
  const server = await serve(4900);
  const browser = await chromium.launch();
  const fails = [];
  const csvPath = path.join('/tmp', 'layout-nodate.csv');
  fs.writeFileSync(csvPath, noDateCsv());

  // ---------- 1. tab capitalisation ----------
  const page = await browser.newPage({ viewport: { width: 1568, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
  await page.goto('http://127.0.0.1:4900/');
  await page.setInputFiles('#fileInput', csvPath);
  await page.waitForSelector('#analyzeBtn');
  await page.click('#analyzeBtn');
  await page.waitForSelector('.kpis');
  await page.waitForTimeout(600);

  const labels = await page.evaluate(() => [...document.querySelectorAll('.tab')].map((t) => t.textContent.replace(/^[^\w]+/, '').trim()));
  console.log('tab labels:', labels);
  const MINOR = new Set(['a', 'an', 'the', 'of', 'and', 'or', 'in', 'on', 'by', 'to', 'vs']);
  labels.forEach((l) => {
    l.split(/\s+/).forEach((word, i) => {
      if (!word || (i > 0 && MINOR.has(word.toLowerCase()))) return;
      if (!/^[A-Z0-9]/.test(word)) fails.push(`tab label not title-case: "${l}" (word "${word}")`);
    });
  });

  // ---------- 2. Trends must never be empty ----------
  await page.click('.tab[data-tab="time"]');
  await page.waitForTimeout(600);
  const trends = await page.evaluate(() => {
    const pane = document.getElementById('tab-time');
    return {
      text: pane.innerText.trim().length,
      svgs: pane.querySelectorAll('svg.chart').length,
      tables: pane.querySelectorAll('table').length,
      onlyEmpty: pane.querySelectorAll('.empty').length > 0 && pane.querySelectorAll('svg.chart').length === 0,
      panels: [...pane.querySelectorAll('.subcard h4')].map((h) => h.textContent.trim()),
    };
  });
  console.log('trends (no date col):', trends);
  if (trends.text < 800) fails.push(`Trends too sparse without dates: ${trends.text} chars`);
  if (trends.svgs < 3) fails.push(`Trends has only ${trends.svgs} charts without dates`);
  if (trends.onlyEmpty) fails.push('Trends shows only an empty-state message');
  const taut = trends.panels.filter((h) => /(\S+) across \1 \(quintile\)/.test(h));
  if (taut.length) fails.push('tautological trend panel: ' + taut.join(', '));

  // ---------- 3. pivot overlap + width, across viewports & field combos ----------
  const combos = [['age_bracket', 'citation_type'], ['region', 'vehicle_class'], ['citation_type', 'age_bracket']];
  const pivotRows = [];
  for (const vw of [1568, 1280, 1024]) {
    await page.setViewportSize({ width: vw, height: 900 });
    await page.click('.tab[data-tab="segments"]');
    await page.waitForTimeout(500);
    for (const [rc, cc] of combos) {
      await page.selectOption('#pvRow', rc).catch(() => {});
      await page.selectOption('#pvCol', cc).catch(() => {});
      await page.waitForTimeout(600);
      await page.evaluate(() => document.getElementById('pivotCard').scrollIntoView({ block: 'center', behavior: 'instant' }));
      await page.waitForTimeout(700);
      const m = await page.evaluate(measurePivot);
      pivotRows.push({ vw, rows: rc, cols: cc, ...m });
      if (m.error) { fails.push(`pivot ${vw}/${rc}x${cc}: ${m.error}`); continue; }
      if (m.collisions > 0) fails.push(`pivot ${vw}px ${rc}x${cc}: ${m.collisions} text collisions (${m.samples.join(', ')})`);
      if (m.headerOverGrid.length) fails.push(`pivot ${vw}px ${rc}x${cc}: headers overlap grid (${m.headerOverGrid.join(', ')})`);
      if (m.overflows) fails.push(`pivot ${vw}px ${rc}x${cc}: overflows container`);
      if (m.fillPct < 55) fails.push(`pivot ${vw}px ${rc}x${cc}: only ${m.fillPct}% of width used`);
    }
  }
  console.table(pivotRows);
  await page.setViewportSize({ width: 1568, height: 900 });

  // ---------- 4. Explore responsiveness (large dataset) ----------
  const p2 = await browser.newPage({ viewport: { width: 1568, height: 900 } });
  p2.on('pageerror', (e) => errs.push('PAGEERROR2: ' + e.message));
  await p2.goto('http://127.0.0.1:4900/');
  await p2.click('#sampleInsuranceBtn');
  await p2.waitForSelector('#analyzeBtn');
  await p2.click('#analyzeBtn');
  await p2.waitForSelector('.kpis');
  await p2.waitForTimeout(700);

  const timings = {};
  for (const tab of ['drivers', 'columns', 'explore', 'segments', 'explore']) {
    const dt = await p2.evaluate(async (t) => {
      const t0 = performance.now();
      document.querySelector(`.tab[data-tab="${t}"]`).click();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return Math.round(performance.now() - t0);
    }, tab);
    timings[tab] = Math.max(timings[tab] || 0, dt);
    await p2.waitForTimeout(300);
  }
  const scatterInfo = await p2.evaluate(() => ({
    html: document.getElementById('scatterOut').innerHTML.length,
    circles: document.querySelectorAll('#scatterOut circle').length,
    cloudPaths: document.querySelectorAll('#scatterOut path[data-pts]').length,
  }));
  console.log('tab open timings (ms):', timings, '| scatter:', scatterInfo);
  if (timings.explore > 250) fails.push(`Explore tab slow: ${timings.explore}ms`);
  if (scatterInfo.circles > 0) fails.push(`scatter still emits ${scatterInfo.circles} circle nodes`);
  if (scatterInfo.html > 120000) fails.push(`scatter HTML too large: ${scatterInfo.html} bytes`);

  if (errs.length) fails.push(...errs);
  await browser.close();
  server.close();
  fs.unlinkSync(csvPath);
  console.log(fails.length ? '\nFAILURES:\n' + fails.join('\n') : '\nAll layout / trends / perf / label checks passed.');
  process.exit(fails.length ? 1 : 0);
})();
