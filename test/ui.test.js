/* Browser test: load the built single-file app, run the insurance sample, screenshot every tab */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const outDir = path.join(__dirname, '..', 'shots');
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

  const file = 'file://' + path.join(__dirname, '..', 'dist', 'index.html');
  await page.goto(file);
  await page.screenshot({ path: path.join(outDir, '01-landing.png'), fullPage: false });

  // insurance sample -> preview modal
  await page.click('#sampleInsuranceBtn');
  await page.waitForSelector('#analyzeBtn', { timeout: 15000 });
  await page.screenshot({ path: path.join(outDir, '02-preview.png') });

  const t0 = Date.now();
  await page.click('#analyzeBtn');
  await page.waitForSelector('.kpis', { timeout: 60000 });
  const analysisMs = Date.now() - t0;

  const stats = await page.evaluate(() => {
    const a = window.PrismaApp.STATE.analysis;
    return {
      findings: a.findings.length, drivers: a.driverResults.length,
      correlations: a.correlations.length, segments: a.segments.length,
      catAssoc: a.catAssoc.length, anomalies: a.anomalies.length,
      profiles: a.profiles.length, actions: a.actions.length,
      quality: a.quality.score, elapsed: a.elapsed, primary: a.primaryMetric,
      domain: a.domain && a.domain.label,
    };
  });
  console.log('analysis stats:', stats, '| wall ms:', analysisMs);

  const tabs = ['findings', 'drivers', 'relations', 'segments', 'columns', 'time', 'quality', 'explore', 'data'];
  const tabInfo = {};
  for (const t of tabs) {
    await page.click(`.tab[data-tab="${t}"]`);
    await page.waitForTimeout(450);
    const info = await page.evaluate((tab) => {
      const pane = document.getElementById('tab-' + tab);
      return {
        visible: getComputedStyle(pane).display !== 'none',
        chars: pane.innerText.length,
        svgs: pane.querySelectorAll('svg.chart').length,
        tables: pane.querySelectorAll('table').length,
        rows: pane.querySelectorAll('tbody tr').length,
        empties: pane.querySelectorAll('.empty').length,
      };
    }, t);
    tabInfo[t] = info;
    await page.screenshot({ path: path.join(outDir, `tab-${t}.png`), fullPage: true });
  }
  console.table(tabInfo);

  // interactive controls
  await page.click('.tab[data-tab="explore"]');
  await page.waitForTimeout(400);
  await page.selectOption('#exGroup', { index: 3 });
  await page.waitForTimeout(400);
  const exploreChars = await page.evaluate(() => document.getElementById('exploreOut').innerText.length);
  await page.selectOption('#scY', { index: 2 });
  await page.waitForTimeout(300);
  const scatterOk = await page.evaluate(() => document.querySelectorAll('#scatterOut svg').length);

  await page.click('.tab[data-tab="segments"]');
  await page.waitForTimeout(300);
  const pivotBefore = await page.evaluate(() => document.getElementById('pivotOut').innerHTML.length);
  await page.selectOption('#pvCol', { index: 2 });
  await page.waitForTimeout(400);
  const pivotAfter = await page.evaluate(() => document.getElementById('pivotOut').innerHTML.length);
  console.log('explore chars:', exploreChars, '| scatter svgs:', scatterOk, '| pivot re-rendered:', pivotBefore !== pivotAfter || pivotAfter > 0);

  // themes
  for (const th of ['dark', 'neon']) {
    await page.selectOption('#themeSel', th);
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(outDir, `theme-${th}.png`) });
  }
  await page.selectOption('#themeSel', 'light');

  // sales sample (time series) in a fresh page
  const p2 = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  p2.on('pageerror', (e) => errors.push('PAGEERROR2: ' + e.message));
  await p2.goto(file);
  await p2.click('#sampleBtn');
  await p2.waitForSelector('#analyzeBtn', { timeout: 15000 });
  await p2.click('#analyzeBtn');
  await p2.waitForSelector('.kpis', { timeout: 60000 });
  await p2.click('.tab[data-tab="time"]');
  await p2.waitForTimeout(600);
  const timeInfo = await p2.evaluate(() => {
    const pane = document.getElementById('tab-time');
    return { chars: pane.innerText.length, svgs: pane.querySelectorAll('svg.chart').length, empties: pane.querySelectorAll('.empty').length };
  });
  console.log('sales time tab:', timeInfo);
  await p2.screenshot({ path: path.join(outDir, 'sales-time.png'), fullPage: true });

  // CSV upload path + header preamble
  const csvPath = path.join(__dirname, '..', 'shots', 'tmp-upload.csv');
  let csv = 'Monthly Report\n\nRegion,Product,Revenue,Units,Date\n';
  for (let i = 0; i < 200; i++) csv += `R${i % 4},P${i % 5},${(Math.random() * 900 + 100).toFixed(2)},${Math.ceil(Math.random() * 30)},2026-0${(i % 9) + 1}-1${i % 9}\n`;
  fs.writeFileSync(csvPath, csv);
  const p3 = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  p3.on('pageerror', (e) => errors.push('PAGEERROR3: ' + e.message));
  await p3.goto(file);
  await p3.setInputFiles('#fileInput', csvPath);
  await p3.waitForSelector('#analyzeBtn', { timeout: 15000 });
  const previewText = await p3.evaluate(() => document.querySelector('.modal p').innerText);
  await p3.click('#analyzeBtn');
  await p3.waitForSelector('.kpis', { timeout: 60000 });
  const upStats = await p3.evaluate(() => ({ findings: window.PrismaApp.STATE.analysis.findings.length, cols: window.PrismaApp.STATE.analysis.columns.length }));
  console.log('csv upload:', previewText.replace(/\n/g, ' '), '->', upStats);

  // PHI block
  const phiPath = path.join(__dirname, '..', 'shots', 'tmp-phi.csv');
  fs.writeFileSync(phiPath, 'Patient,Diagnosis,Amount\nJohn,Flu,120\nJane,Cold,90\n');
  const p4 = await browser.newPage();
  await p4.goto(file);
  await p4.setInputFiles('#fileInput', phiPath);
  await p4.waitForTimeout(900);
  const phiBlocked = await p4.evaluate(() => document.body.innerText.includes('Health data not supported'));
  console.log('PHI blocked:', phiBlocked);
  await p4.screenshot({ path: path.join(outDir, 'phi-block.png') });

  fs.unlinkSync(csvPath); fs.unlinkSync(phiPath);
  await browser.close();

  const fails = [];
  if (stats.findings < 20) fails.push('few findings ' + stats.findings);
  for (const [t, i] of Object.entries(tabInfo)) {
    if (!i.visible) fails.push(t + ' not visible');
    if (i.chars < 200) fails.push(t + ' too little content: ' + i.chars);
  }
  if (tabInfo.drivers.svgs < 3) fails.push('drivers missing charts');
  if (tabInfo.columns.svgs < 10) fails.push('columns missing charts: ' + tabInfo.columns.svgs);
  if (timeInfo.svgs < 2 || timeInfo.empties) fails.push('sales time tab weak');
  if (!phiBlocked) fails.push('PHI not blocked');
  if (!scatterOk) fails.push('scatter did not render');
  if (errors.length) fails.push(...errors);
  console.log(fails.length ? '\nFAILURES:\n' + fails.join('\n') : '\nUI: all checks passed.');
  process.exit(fails.length ? 1 : 0);
})();
