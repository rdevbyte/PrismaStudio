/* Verify: pivot has no overlapping text, and GSAP animations actually run */
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');

const rectsOverlap = (a, b) => !(a.x + a.w <= b.x + 0.5 || b.x + b.w <= a.x + 0.5 || a.y + a.h <= b.y + 0.5 || b.y + b.h <= a.y + 0.5);

(async () => {
  const out = path.join(__dirname, '..', 'shots');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  await page.goto('file://' + path.join(__dirname, '..', 'dist', 'index.html'));
  const gsapOk = await page.evaluate(() => !!window.gsap && !!window.TabulaMetricsAnim && window.TabulaMetricsAnim.enabled);
  console.log('GSAP loaded & enabled:', gsapOk);

  await page.click('#sampleInsuranceBtn');
  await page.waitForSelector('#analyzeBtn');
  await page.click('#analyzeBtn');
  await page.waitForSelector('.kpis');

  // --- KPI count-up actually animates ---
  const kpiMid = await page.evaluate(() => document.querySelector('.kvalue').textContent);
  await page.waitForTimeout(1500);
  const kpiEnd = await page.evaluate(() => document.querySelector('.kvalue').textContent);
  console.log('KPI count-up:', JSON.stringify(kpiMid), '->', JSON.stringify(kpiEnd));

  await page.click('.tab[data-tab="segments"]');
  await page.waitForTimeout(1400);

  const pivotCard = await page.$('#pivotCard');
  await pivotCard.scrollIntoViewIfNeeded();
  await page.waitForTimeout(900);

  // --- overlap check across many field combinations ---
  async function checkOverlap(label) {
    return await page.evaluate(() => {
      const svg = document.querySelector('#pivotOut svg');
      if (!svg) return { error: 'no svg' };
      const texts = [...svg.querySelectorAll('text')];
      const boxes = texts.map((t) => {
        const b = t.getBBox();
        return { x: b.x, y: b.y, w: b.width, h: b.height, s: t.textContent, rot: (t.getAttribute('transform') || '').includes('rotate') };
      });
      // compare only same-orientation labels (rotated headers legitimately share bbox space)
      let collisions = 0; const samples = [];
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        if (a.rot !== b.rot) continue;
        if (a.rot && b.rot) continue; // rotated: measured bbox is pre-rotation, skip
        const hit = !(a.x + a.w <= b.x + 0.5 || b.x + b.w <= a.x + 0.5 || a.y + a.h <= b.y + 0.5 || b.y + b.h <= a.y + 0.5);
        if (hit) { collisions++; if (samples.length < 4) samples.push(a.s + ' / ' + b.s); }
      }
      const vb = svg.getAttribute('viewBox').split(' ').map(Number);
      const rect = svg.getBoundingClientRect();
      return { collisions, samples, scale: +(rect.width / vb[2]).toFixed(2), rendered: Math.round(rect.width), vbW: vb[2] };
    });
  }

  const combos = [];
  const opts = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('#pvRow option')].map((o) => o.value),
    cols: [...document.querySelectorAll('#pvCol option')].map((o) => o.value),
  }));
  const longest = (l) => l.slice().sort((a, b) => b.length - a.length)[0];
  const tests = [
    ['Age Bracket', 'Vehicle Class'],
    [longest(opts.rows), longest(opts.cols.filter((c) => c !== longest(opts.rows)))],
    ['Zip Territory', opts.cols.find((c) => /quintile/.test(c)) || opts.cols[1]],
    ['Vehicle Class', 'Credit Score Range'],
  ];
  for (const [r, c] of tests) {
    if (!opts.rows.includes(r) || !opts.cols.includes(c)) { console.log('skip', r, c); continue; }
    await page.selectOption('#pvRow', r);
    await page.selectOption('#pvCol', c);
    await page.waitForTimeout(900);
    const res = await checkOverlap();
    combos.push({ rows: r, cols: c, ...res });
  }
  console.table(combos);
  await pivotCard.screenshot({ path: path.join(out, 'pivot-fixed.png') });

  // widest possible: quintile x quintile
  const q = opts.cols.filter((c) => /quintile/.test(c));
  if (q.length >= 2) {
    await page.selectOption('#pvRow', q[0]);
    await page.selectOption('#pvCol', q[1]);
    await page.waitForTimeout(900);
    const res = await checkOverlap();
    console.log('quintile x quintile:', res);
    combos.push({ rows: q[0], cols: q[1], ...res });
    await (await page.$('#pivotCard')).screenshot({ path: path.join(out, 'pivot-quintiles.png') });
  }

  // --- animation actually mutates the DOM (bar widths grow from 0) ---
  await page.click('.tab[data-tab="drivers"]');
  await page.waitForTimeout(120);
  const growth = await page.evaluate(async () => {
    const svg = document.querySelector('#tab-drivers svg.chart[data-anim="barH"]');
    if (!svg) return null;
    svg.dataset.animated = '';
    const bar = svg.querySelector('rect[data-bar]');
    const target = +bar.dataset.w;
    window.TabulaMetricsAnim.animateSvg(svg);
    // sample on the very next frame — the tween should still be near zero
    const w0 = await new Promise((r) => requestAnimationFrame(() => r(+bar.getAttribute('width'))));
    await new Promise((r) => setTimeout(r, 300));
    const w1 = +bar.getAttribute('width');
    await new Promise((r) => setTimeout(r, 700));
    const w2 = +bar.getAttribute('width');
    return { w0, w1, w2, target };
  });
  console.log('bar grow:', growth);

  // line draw-on
  await page.click('.tab[data-tab="time"]');
  await page.waitForTimeout(900);
  const lineAnim = await page.evaluate(() => {
    const p = document.querySelector('#tab-time polyline[data-line]');
    if (!p) return 'no line (projection suppressed)';
    return { dash: p.style.strokeDasharray || getComputedStyle(p).strokeDasharray, offset: p.style.strokeDashoffset };
  });
  console.log('line anim state:', lineAnim);

  await page.screenshot({ path: path.join(out, 'anim-drivers.png'), fullPage: false });

  // reduced motion must disable animation and still render
  const p2 = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await p2.emulateMedia({ reducedMotion: 'reduce' });
  p2.on('pageerror', (e) => errors.push('RM PAGEERROR: ' + e.message));
  await p2.goto('file://' + path.join(__dirname, '..', 'dist', 'index.html'));
  await p2.click('#sampleBtn');
  await p2.waitForSelector('#analyzeBtn');
  await p2.click('#analyzeBtn');
  await p2.waitForSelector('.kpis');
  await p2.waitForTimeout(600);
  const rm = await p2.evaluate(() => ({
    enabled: window.TabulaMetricsAnim.enabled,
    kpiVisible: getComputedStyle(document.querySelector('.kpi')).opacity,
    kpiText: document.querySelector('.kvalue').textContent,
    cardsVisible: [...document.querySelectorAll('#tab-findings .finding')].every((c) => getComputedStyle(c).opacity === '1'),
  }));
  console.log('reduced-motion:', rm);

  await browser.close();

  const fails = [];
  if (!gsapOk) fails.push('GSAP not enabled');
  combos.forEach((c) => {
    if (c.collisions > 0) fails.push(`pivot overlap ${c.rows}×${c.cols}: ${c.collisions} (${(c.samples || []).join(' | ')})`);
    if (c.scale && Math.abs(c.scale - 1) > 0.02) fails.push(`pivot scaled ${c.scale}× (should be 1.0)`);
  });
  if (!growth || !(growth.w0 < growth.w1 && growth.w1 <= growth.w2 && growth.w0 < growth.target * 0.5 && Math.abs(growth.w2 - growth.target) < 1)) fails.push('bars did not animate: ' + JSON.stringify(growth));
  if (rm.enabled !== false) fails.push('reduced-motion not honoured');
  if (rm.kpiVisible !== '1' || !rm.cardsVisible) fails.push('content hidden under reduced motion');
  if (errors.length) fails.push(...errors);
  console.log(fails.length ? '\nFAILURES:\n' + fails.join('\n') : '\nAll animation + pivot checks passed.');
  process.exit(fails.length ? 1 : 0);
})();
