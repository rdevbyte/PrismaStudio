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
  const themeSnapshots = [];
  let themeOptions = [];
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
    const a = window.TabulaMetricsApp.STATE.analysis;
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
  await page.evaluate(() => document.fonts.ready);
  const typography = await page.evaluate(() => ({
    body: getComputedStyle(document.body).fontFamily,
    button: getComputedStyle(document.querySelector('#sampleBtn')).fontFamily,
    label: getComputedStyle(document.querySelector('.theme-control label')).fontFamily,
    number: getComputedStyle(document.querySelector('.kvalue')).fontFamily,
    chart: getComputedStyle(document.querySelector('svg.chart .tick')).fontFamily,
    googleSansLink: [...document.querySelectorAll('link[rel="stylesheet"]')].some((link) => link.href.startsWith('https://fonts.googleapis.com/css2?family=Google+Sans:ital,opsz,wght@0,17..18,400..700;1,17..18,400..700&display=swap')),
  }));
  console.log('typography:', typography);

  const tabs = ['overview', 'findings', 'drivers', 'relations', 'segments', 'columns', 'time', 'quality', 'explore', 'data'];
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

  // Four persistent, accessible themes: two light palettes and two dark palettes.
  themeOptions = await page.locator('#themeSel option').evaluateAll((options) => options.map((o) => ({ value: o.value, group: o.parentElement.label })));
  for (const th of ['daylight', 'sandstone', 'ember', 'burgundy']) {
    await page.selectOption('#themeSel', th);
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(outDir, `theme-${th}.png`) });
    themeSnapshots.push(await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      const hex = (value) => { const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim()); if (!m) return null; const raw = m[1].length === 3 ? m[1].split('').map((x) => x + x).join('') : m[1]; return [0,2,4].map((i) => parseInt(raw.slice(i, i + 2), 16) / 255).map((x) => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4); };
      const lum = (value) => { const rgb = hex(value); return rgb && .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2]; };
      const ratio = (a, b) => { const x = lum(a), y = lum(b); return x == null || y == null ? 0 : (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
      const read = (name) => style.getPropertyValue(name).trim();
      const bg = read('--bg'), text = read('--text'), dim = read('--dim'), accent = read('--accent'), accentOn = read('--accent-on');
      const theme = document.documentElement.dataset.theme;
      const activeMark = document.querySelector('.logo .mark-' + theme);
      const activeWordmark = document.querySelector('.wordmark-' + theme);
      const visibleMarks = [...document.querySelectorAll('.logo img')].filter((img) => getComputedStyle(img).display !== 'none').length;
      const visibleWordmarks = [...document.querySelectorAll('.brand-wordmark')].filter((img) => getComputedStyle(img).display !== 'none').length;
      return { theme, stored: localStorage.getItem('tabulametrics-theme'), bg, text, dim, accent, accentOn, textContrast: ratio(text, bg), dimContrast: ratio(dim, bg), buttonContrast: ratio(accentOn, accent), logoMarkVisible: !!activeMark && getComputedStyle(activeMark).display === 'block' && activeMark.naturalWidth > 0, logoWordmarkVisible: !!activeWordmark && getComputedStyle(activeWordmark).display === 'block' && activeWordmark.naturalWidth > 0, visibleMarks, visibleWordmarks };
    }));
  }
  await page.selectOption('#themeSel', 'daylight');

  // An exported report retains the selected visual theme and clearly warns that it includes source rows.
  const [reportDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#exportBtn'),
  ]);
  const reportPath = await reportDownload.path();
  const exportedReport = fs.readFileSync(reportPath, 'utf8');
  const exportPrivacyOk = exportedReport.includes('Data handling note:') &&
    exportedReport.includes('up to 200 source-data rows') &&
    exportedReport.includes('Content-Security-Policy');
  const exportTypographyOk = exportedReport.includes('fonts.googleapis.com/css2?family=Google+Sans') &&
    exportedReport.includes('fonts.gstatic.com');
  console.log('export privacy notice:', exportPrivacyOk, '| Google Sans:', exportTypographyOk);

  // A hostile spreadsheet must render markup-looking headers/cells as text, including in exports.
  const csvQuote = (value) => '"' + String(value).replace(/"/g, '""') + '"';
  const xssPath = path.join(outDir, 'tmp-xss.csv');
  const xssMetric = '<img src=x onerror="window.__xss=1">';
  const xssGroup = '<svg onload="window.__xss=2">';
  const xssCell = '<img src=x onerror="window.__xss=3">';
  const xssRows = [[xssMetric, xssGroup], ...Array.from({ length: 80 }, (_, i) => [
    i < 40 ? 10 + (i % 3) : 100 + (i % 3), i < 40 ? xssCell : 'ordinary',
  ])];
  fs.writeFileSync(xssPath, xssRows.map((row) => row.map(csvQuote).join(',')).join('\n'));
  const p5 = await browser.newPage();
  p5.on('pageerror', (e) => errors.push('PAGEERROR5: ' + e.message));
  await p5.goto(file);
  await p5.evaluate(() => { window.__xss = 0; });
  await p5.setInputFiles('#fileInput', xssPath);
  await p5.waitForSelector('#analyzeBtn', { timeout: 15000 });
  await p5.click('#analyzeBtn');
  await p5.waitForSelector('.kpis', { timeout: 60000 });
  const xssState = await p5.evaluate((label) => ({
    fired: window.__xss !== 0,
    injectedMarkup: !!document.querySelector('img[src="x"], svg[onload], [onerror]'),
    escapedTextVisible: document.querySelector('.summary').innerText.includes(label),
  }), xssMetric);
  const [xssDownload] = await Promise.all([
    p5.waitForEvent('download'),
    p5.click('#exportBtn'),
  ]);
  const xssReport = fs.readFileSync(await xssDownload.path(), 'utf8');
  const xssExportSafe = !/<img src=x onerror=/i.test(xssReport) && !/<svg onload=/i.test(xssReport);
  console.log('hostile spreadsheet rendering:', JSON.stringify(xssState), '| export safe:', xssExportSafe);
  await p5.close();
  fs.unlinkSync(xssPath);

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
  const upStats = await p3.evaluate(() => ({ findings: window.TabulaMetricsApp.STATE.analysis.findings.length, cols: window.TabulaMetricsApp.STATE.analysis.columns.length }));
  console.log('csv upload:', previewText.replace(/\n/g, ' '), '->', upStats);

  // PHI block
  const phiPath = path.join(__dirname, '..', 'shots', 'tmp-phi.csv');
  fs.writeFileSync(phiPath, 'Patient,Diagnosis,Amount\nJohn,Flu,120\nJane,Cold,90\n');
  const p4 = await browser.newPage();
  await p4.goto(file);
  await p4.setInputFiles('#fileInput', phiPath);
  await p4.waitForTimeout(900);
  // Guard must intercept AND require an explicit attestation before proceeding:
  // the proceed button starts disabled and no data reaches the analyser.
  const phiState = await p4.evaluate(() => ({
    intercepted: document.body.innerText.includes('may contain health data'),
    hasAttestation: !!document.getElementById('attestBox'),
    proceedDisabled: !!(document.getElementById('hbProceed') || {}).disabled,
    noDatasetLoaded: !window.TabulaMetricsApp.STATE.dataset,
  }));
  const phiBlocked = phiState.intercepted && phiState.hasAttestation && phiState.proceedDisabled && phiState.noDatasetLoaded;
  console.log('PHI gated:', JSON.stringify(phiState));
  await p4.screenshot({ path: path.join(outDir, 'phi-block.png') });

  fs.unlinkSync(csvPath); fs.unlinkSync(phiPath);
  await browser.close();

  const fails = [];
  const expectedThemes = ['daylight', 'sandstone', 'ember', 'burgundy'];
  if (themeOptions.length !== 4 || themeOptions.map((o) => o.value).join(',') !== expectedThemes.join(',')) fails.push('theme picker must expose exactly the four requested palettes: ' + JSON.stringify(themeOptions));
  if (themeOptions.filter((o) => o.group === 'Light modes').length !== 2 || themeOptions.filter((o) => o.group === 'Dark modes').length !== 2) fails.push('themes are not grouped into two light and two dark modes: ' + JSON.stringify(themeOptions));
  if (themeSnapshots.length !== 4 || themeSnapshots.some((x, i) => x.theme !== expectedThemes[i] || x.stored !== expectedThemes[i] || x.textContrast < 4.5 || x.dimContrast < 4.5 || x.buttonContrast < 4.5 || !x.logoMarkVisible || !x.logoWordmarkVisible || x.visibleMarks !== 1 || x.visibleWordmarks !== 1)) fails.push('theme persistence/contrast/logo/accessibility check failed: ' + JSON.stringify(themeSnapshots));
  if (stats.findings < 20) fails.push('few findings ' + stats.findings);
  for (const [t, i] of Object.entries(tabInfo)) {
    if (!i.visible) fails.push(t + ' not visible');
    if (i.chars < 200) fails.push(t + ' too little content: ' + i.chars);
  }
  if (tabInfo.drivers.svgs < 3) fails.push('drivers missing charts');
  if (tabInfo.columns.svgs < 10) fails.push('columns missing charts: ' + tabInfo.columns.svgs);
  if (timeInfo.svgs < 2 || timeInfo.empties) fails.push('sales time tab weak');
  if (!phiBlocked) fails.push('PHI not gated behind attestation: ' + JSON.stringify(phiState));
  if (!scatterOk) fails.push('scatter did not render');
  if (!exportPrivacyOk) fails.push('export is missing its data handling notice or CSP');
  if (!exportTypographyOk) fails.push('export is missing Google Sans or its allowed font origin');
  if (![typography.body, typography.button, typography.label, typography.number, typography.chart].every((family) => /Google Sans/i.test(family)) || !typography.googleSansLink) {
    fails.push('Google Sans link/font family is not applied consistently across UI, numeric readouts, and charts: ' + JSON.stringify(typography));
  }
  if (xssState.fired || xssState.injectedMarkup || !xssState.escapedTextVisible || !xssExportSafe) {
    fails.push('hostile spreadsheet markup escaped incorrectly: ' + JSON.stringify({ ...xssState, xssExportSafe }));
  }
  if (errors.length) fails.push(...errors);
  console.log(fails.length ? '\nFAILURES:\n' + fails.join('\n') : '\nUI: all checks passed.');
  process.exit(fails.length ? 1 : 0);
})();
