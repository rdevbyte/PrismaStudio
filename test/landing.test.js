/* Regressions for:
   - busy overlay must be centred (was pinned left: display:flex + place-items)
   - switching tabs must land on that tab's content, with nothing visible hidden
   - PHI attestation modal must appear for genuinely clinical files */
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

const TABS = ['findings', 'drivers', 'relations', 'segments', 'columns', 'time', 'quality', 'explore', 'data'];

(async () => {
  const server = await serve(5200);
  const browser = await chromium.launch();
  const fails = [];
  const errs = [];

  for (const vp of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
    const page = await browser.newPage({ viewport: vp });
    page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
    await page.goto('http://127.0.0.1:5200/');

    // ---- busy overlay centring ----
    const busy = await page.evaluate(() => {
      const el = document.getElementById('busy');
      el.style.display = 'flex';
      const box = el.querySelector('.busybox').getBoundingClientRect();
      const r = {
        dx: Math.abs((box.left + box.width / 2) - innerWidth / 2),
        dy: Math.abs((box.top + box.height / 2) - innerHeight / 2),
      };
      el.style.display = 'none';
      return r;
    });
    if (busy.dx > 2 || busy.dy > 2) fails.push(`${vp.width}px: busy overlay off-centre by ${Math.round(busy.dx)}x${Math.round(busy.dy)}px`);

    // ---- tab landing ----
    await page.click('#sampleInsuranceBtn');
    await page.waitForSelector('#analyzeBtn');
    await page.click('#analyzeBtn');
    await page.waitForSelector('.kpis');
    await page.waitForTimeout(700);

    const rows = [];
    for (const tab of TABS) {
      await page.click(`.tab[data-tab="${tab}"]`);
      await page.waitForTimeout(1100); // smooth scroll + reveal
      const r = await page.evaluate((t) => {
        const pane = document.getElementById('tab-' + t);
        const nodes = [...pane.querySelectorAll('.card, .subcard, .finding')];
        const inView = nodes.filter((n) => {
          const b = n.getBoundingClientRect();
          return b.top < innerHeight && b.bottom > 0;
        });
        return {
          scrollY: Math.round(scrollY),
          inView: inView.length,
          inViewHidden: inView.filter((n) => +getComputedStyle(n).opacity < 0.95).length,
          // how much real content sits in the first screenful
          visibleText: (() => {
            let n = 0;
            inView.forEach((el) => { n += el.innerText.length; });
            return n;
          })(),
        };
      }, tab);
      rows.push({ vp: vp.width, tab, ...r });
      if (r.inView === 0) fails.push(`${vp.width}px/${tab}: no cards in the first screenful after switching`);
      if (r.inViewHidden > 0) fails.push(`${vp.width}px/${tab}: ${r.inViewHidden} visible cards at opacity<1`);
      if (r.visibleText < 200 && tab !== 'data') fails.push(`${vp.width}px/${tab}: only ${r.visibleText} chars visible on landing`);
    }
    if (vp.width === 1440) console.table(rows);
    await page.close();
  }

  // ---- attestation modal for genuinely clinical data ----
  const p2 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  p2.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  const clinical = path.join('/tmp', 'reg-clinical.csv');
  fs.writeFileSync(clinical, 'patient_name,diagnosis,medication,amount\nA,Flu,Tamiflu,100\nB,Cold,Rest,90\n');
  await p2.goto('http://127.0.0.1:5200/');
  await p2.setInputFiles('#fileInput', clinical);
  await p2.waitForTimeout(800);
  const gate = await p2.evaluate(() => ({
    shown: document.body.innerText.includes('looks like health data'),
    box: !!document.getElementById('attestBox'),
    disabled: !!(document.getElementById('hbProceed') || {}).disabled,
  }));
  console.log('clinical file gate:', gate);
  if (!gate.shown || !gate.box || !gate.disabled) fails.push('attestation modal not shown/gated for clinical file: ' + JSON.stringify(gate));

  // ticking the box lets it through and records the attestation
  await p2.check('#attestBox');
  await p2.click('#hbProceed');
  await p2.waitForSelector('#analyzeBtn', { timeout: 8000 });
  await p2.click('#analyzeBtn');
  await p2.waitForSelector('.kpis', { timeout: 20000 });
  const after = await p2.evaluate(() => ({
    pill: document.body.innerText.includes('No-PHI attestation'),
    recorded: !!window.PrismaApp.STATE.attestation,
  }));
  console.log('after attesting:', after);
  if (!after.pill || !after.recorded) fails.push('attestation not recorded/surfaced: ' + JSON.stringify(after));

  // school data must NOT be gated
  const school = path.join('/tmp', 'reg-school.csv');
  fs.writeFileSync(school, 'student_id,grade_level,Philosophy,gpa,immunization_status\nS1,9,A,3.4,Complete\nS2,10,B,3.1,Partial\n');
  const p3 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await p3.goto('http://127.0.0.1:5200/');
  await p3.setInputFiles('#fileInput', school);
  await p3.waitForTimeout(800);
  const schoolGate = await p3.evaluate(() => ({
    gated: document.body.innerText.includes('looks like health data'),
    preview: !!document.getElementById('analyzeBtn'),
  }));
  console.log('school file:', schoolGate);
  if (schoolGate.gated || !schoolGate.preview) fails.push('school file wrongly gated: ' + JSON.stringify(schoolGate));

  fs.unlinkSync(clinical); fs.unlinkSync(school);
  if (errs.length) fails.push(...errs);
  await browser.close();
  server.close();
  console.log(fails.length ? '\nFAILURES:\n' + fails.join('\n') : '\nAll landing / overlay / attestation checks passed.');
  process.exit(fails.length ? 1 : 0);
})();
