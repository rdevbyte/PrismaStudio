/* When data has no real structure (random/synthetic), the analysis must say so
   with evidence — never imply it failed to run or that the columns are wrong. */
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

// Random data: every column independent — no relationships exist by construction.
function randomCsv(rows = 2000) {
  const cats = { dept: ['A', 'B', 'C'], region: ['N', 'S', 'E', 'W'], tier: ['Gold', 'Silver', 'Bronze'] };
  const cols = ['dept', 'region', 'tier', 'score', 'amount', 'count', 'rate'];
  let csv = cols.join(',') + '\n';
  let seed = 99; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < rows; i++) {
    csv += [
      cats.dept[Math.floor(rnd() * 3)], cats.region[Math.floor(rnd() * 4)], cats.tier[Math.floor(rnd() * 3)],
      (rnd() * 100).toFixed(2), (rnd() * 5000).toFixed(2), Math.floor(rnd() * 50), (rnd()).toFixed(3),
    ].join(',') + '\n';
  }
  return csv;
}

// Structured data: a real driver and a real correlation exist.
function structuredCsv(rows = 1000) {
  let csv = 'tier,region,base,bonus\n';
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const tiers = ['Gold', 'Silver', 'Bronze'];
  for (let i = 0; i < rows; i++) {
    const t = tiers[Math.floor(rnd() * 3)];
    const mult = { Gold: 3, Silver: 2, Bronze: 1 }[t];
    const base = 1000 * mult + rnd() * 200;
    csv += `${t},${['N', 'S'][Math.floor(rnd() * 2)]},${base.toFixed(2)},${(base * 0.1 + rnd() * 20).toFixed(2)}\n`;
  }
  return csv;
}

(async () => {
  const server = await serve(5400);
  const browser = await chromium.launch();
  const fails = [];
  const errs = [];

  const rndPath = '/tmp/ns-random.csv', strPath = '/tmp/ns-structured.csv';
  fs.writeFileSync(rndPath, randomCsv());
  fs.writeFileSync(strPath, structuredCsv());

  async function run(file, label) {
    const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    p.on('pageerror', (e) => errs.push(`${label} PAGEERROR: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error') errs.push(`${label} CONSOLE: ${m.text()}`); });
    await p.goto('http://127.0.0.1:5400/');
    await p.setInputFiles('#fileInput', file);
    await p.waitForSelector('#analyzeBtn', { timeout: 30000 });
    await p.click('#analyzeBtn');
    await p.waitForSelector('.kpis', { timeout: 60000 });
    await p.waitForTimeout(900);
    const out = {};
    for (const tab of ['drivers', 'relations']) {
      await p.click(`.tab[data-tab="${tab}"]`);
      await p.waitForTimeout(1000);
      out[tab] = await p.evaluate((t) => {
        const pane = document.getElementById('tab-' + t);
        return {
          text: pane.innerText.trim().length,
          tableRows: pane.querySelectorAll('tbody tr').length,
          body: pane.innerText,
        };
      }, tab);
    }
    out.stats = await p.evaluate(() => {
      const a = window.PrismaApp.STATE.analysis;
      return { drivers: a.driverResults.length, driverAll: (a.driverAll || []).length, corr: a.correlations.length, corrAll: (a.correlationsAll || []).length };
    });
    await p.close();
    return out;
  }

  // ---- random data: must report "no signal" WITH evidence ----
  const rnd = await run(rndPath, 'random');
  console.log('random stats:', rnd.stats);
  console.log('drivers text length:', rnd.drivers.text, '| table rows:', rnd.drivers.tableRows);

  if (rnd.stats.driverAll === 0) fails.push('random: no driver combinations were tested at all');
  if (rnd.stats.corrAll === 0) fails.push('random: no correlation pairs were tested at all');
  // must NOT claim the data lacks the required column types
  if (/didn't provide that combination|too few numeric columns/i.test(rnd.drivers.body + rnd.relations.body)) {
    fails.push('random: shows misleading "wrong column types" message despite valid columns');
  }
  // must state it ran and show the near-misses
  if (!/tested/i.test(rnd.drivers.body)) fails.push('random: drivers tab does not say the combinations were tested');
  if (rnd.drivers.tableRows < 5) fails.push(`random: drivers tab shows no evidence table (${rnd.drivers.tableRows} rows)`);
  if (rnd.relations.tableRows < 5) fails.push(`random: relations tab shows no evidence table (${rnd.relations.tableRows} rows)`);
  if (rnd.drivers.text < 500) fails.push(`random: drivers tab too sparse (${rnd.drivers.text} chars)`);
  if (rnd.relations.text < 500) fails.push(`random: relations tab too sparse (${rnd.relations.text} chars)`);

  // ---- structured data: must still find the real signal ----
  const str = await run(strPath, 'structured');
  console.log('structured stats:', str.stats);
  if (str.stats.drivers === 0) fails.push('structured: failed to find the planted driver (tier -> base)');
  if (str.stats.corr === 0) fails.push('structured: failed to find the planted correlation (base ~ bonus)');
  if (/No drivers found/i.test(str.drivers.body)) fails.push('structured: wrongly reported "no drivers found"');

  if (errs.length) fails.push(...errs);
  await browser.close();
  server.close();
  fs.unlinkSync(rndPath); fs.unlinkSync(strPath);
  console.log(fails.length ? '\nFAILURES:\n' + fails.join('\n') : '\nAll no-signal reporting checks passed.');
  process.exit(fails.length ? 1 : 0);
})();
