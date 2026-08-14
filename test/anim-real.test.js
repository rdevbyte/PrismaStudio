/* Regression test for "animations are stale on the deployed site".
   Drives the app the way a user does — clicking tabs — and samples SVG geometry
   across frames. Never calls animateSvg() directly, which is what let the
   original bug slip through. Runs against an HTTP server sending the real
   production CSP headers. */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const vc = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const HDRS = vc.headers[0].headers.reduce((a, h) => (a[h.key] = h.value, a), {});

function serve(port) {
  return new Promise((res) => {
    const s = http.createServer((req, rq) => {
      rq.writeHead(200, { ...HDRS, 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(path.join(ROOT, 'dist', 'index.html')).pipe(rq);
    }).listen(port, '127.0.0.1', () => res(s));
  });
}

// Sample an attribute across animation frames; returns distinct values seen.
const SAMPLER = async ({ sel, attr, frames }) => {
  const node = document.querySelector(sel);
  if (!node) return null;
  const seen = [];
  for (let i = 0; i < frames; i++) {
    seen.push(parseFloat(node.getAttribute(attr) ?? getComputedStyle(node)[attr]));
    await new Promise((r) => requestAnimationFrame(r));
  }
  return seen;
};

(async () => {
  const server = await serve(4399);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [], csp = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => {
    const t = m.text();
    if (/Content Security Policy|Refused to/i.test(t)) csp.push(t);
    else if (m.type() === 'error') errors.push('CONSOLE: ' + t);
  });

  await page.goto('http://127.0.0.1:4399/');
  await page.click('#sampleInsuranceBtn');
  await page.waitForSelector('#analyzeBtn');
  await page.click('#analyzeBtn');
  await page.waitForSelector('.kpis');

  const fails = [];
  const results = [];

  // --- 1. findings tab (default) : cards must fade in, not stay at opacity 0
  await page.waitForTimeout(1400);
  const cardState = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#tab-findings .finding')];
    const inView = cards.filter((c) => {
      const r = c.getBoundingClientRect();
      return r.top < innerHeight && r.bottom > 0;
    });
    return {
      total: cards.length,
      inView: inView.length,
      inViewHidden: inView.filter((c) => +getComputedStyle(c).opacity < 0.95).length,
    };
  });
  results.push({ check: 'in-view findings cards revealed', value: `${cardState.inViewHidden}/${cardState.inView} hidden of ${cardState.total}` });
  if (cardState.inViewHidden > 0) fails.push(`${cardState.inViewHidden} on-screen finding cards stuck at opacity<1`);

  // scrolling to the bottom must reveal the rest (nothing permanently invisible)
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1200);
  // Cards re-arm once fully scrolled past so they replay on the way back up.
  // The invariant is that nothing ON SCREEN is ever invisible.
  const stillHidden = await page.evaluate(() =>
    [...document.querySelectorAll('#tab-findings .finding')].filter((c) => {
      const r = c.getBoundingClientRect();
      return r.top < innerHeight && r.bottom > 0 && +getComputedStyle(c).opacity < 0.95;
    }).length);
  results.push({ check: 'no on-screen card hidden at page bottom', value: `${stillHidden} hidden` });
  if (stillHidden > 0) fails.push(`${stillHidden} on-screen finding cards invisible at page bottom`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);

  // --- 2. every tab: charts must actually move on first view
  const tabs = ['drivers', 'relations', 'segments', 'columns', 'quality'];
  for (const tab of tabs) {
    await page.click(`.tab[data-tab="${tab}"]`);
    // sample immediately — no settling wait, we want to catch the motion
    const sel = `#tab-${tab} svg.chart[data-anim="barH"] rect[data-bar], #tab-${tab} svg.chart[data-anim="bars"] rect[data-bar]`;
    const attr = await page.evaluate((s) => {
      const n = document.querySelector(s);
      if (!n) return null;
      return n.closest('svg').dataset.anim === 'bars' ? 'height' : 'width';
    }, sel);
    if (!attr) { results.push({ check: `${tab}: bar chart`, value: 'none present (skipped)' }); continue; }
    // Bring it into view first: below-fold charts are *supposed* to defer.
    await page.evaluate((s2) => {
      const n = document.querySelector(s2);
      if (n) n.closest('svg').scrollIntoView({ block: 'center', behavior: 'instant' });
    }, sel);
    const samples = await page.evaluate(SAMPLER, { sel, attr, frames: 14 });
    const distinct = new Set(samples.map((v) => Math.round(v))).size;
    const min = Math.min(...samples), max = Math.max(...samples);
    // Motion is the invariant, not the exact phase we happened to sample:
    // many distinct values across consecutive frames, changing monotonically.
    const moved = max - min;
    // The tween may start a frame or two into sampling, so measure the rise
    // from the low point forward rather than from sample[0].
    const minIdx = samples.lastIndexOf(min);
    const after = samples.slice(minIdx);
    const rising = after.length > 1 && after[after.length - 1] > after[0];
    results.push({ check: `${tab}: ${attr} animates`, value: `${distinct} distinct, ${min.toFixed(0)}→${max.toFixed(0)}` });
    if (distinct < 4 || moved < max * 0.1 || !rising) {
      fails.push(`${tab}: bars did not animate (samples ${samples.slice(0, 8).map((v) => v.toFixed(0)).join(',')})`);
    }
    await page.waitForTimeout(700); // let it finish before next tab
  }

  // --- 3. re-visiting a tab should NOT re-hide content
  await page.click('.tab[data-tab="findings"]');
  await page.waitForTimeout(500);
  await page.click('.tab[data-tab="drivers"]');
  await page.waitForTimeout(500);
  const reHidden = await page.evaluate(() =>
    [...document.querySelectorAll('#tab-drivers .subcard')].filter((c) => {
      const r = c.getBoundingClientRect();
      const onScreen = r.top < innerHeight && r.bottom > 0;
      return onScreen && +getComputedStyle(c).opacity < 0.95;
    }).length);
  results.push({ check: 'revisit does not re-hide', value: `${reHidden} hidden` });
  if (reHidden > 0) fails.push(`${reHidden} subcards hidden after revisiting tab`);

  // --- 4. deep-scroll charts (below fold) animate when scrolled to
  await page.click('.tab[data-tab="columns"]');
  await page.waitForTimeout(400);
  const deep = await page.evaluate(async () => {
    const svgs = [...document.querySelectorAll('#tab-columns svg.chart')];
    const last = svgs[svgs.length - 1];
    if (!last) return null;
    const before = last.dataset.animated || '(unset)';
    last.scrollIntoView({ block: 'center' });
    await new Promise((r) => setTimeout(r, 900));
    return { before, after: last.dataset.animated || '(unset)', total: svgs.length };
  });
  results.push({ check: 'below-fold chart animates on scroll', value: deep ? `${deep.before} -> ${deep.after}` : 'n/a' });
  if (deep && deep.after !== '1') fails.push('below-fold chart never animated on scroll');

  // --- 5. pivot re-render replays animation
  await page.click('.tab[data-tab="segments"]');
  await page.waitForTimeout(900);
  await page.evaluate(() => document.getElementById('pivotCard').scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.waitForTimeout(400);
  await page.selectOption('#pvCol', { index: 3 });
  // The heatmap staggers cells in with a scale-up, so mid-flight the cells
  // should show a SPREAD of transforms/opacities rather than all being final.
  const pivotSpread = await page.evaluate(async () => {
    const snap = () => [...document.querySelectorAll('#pivotOut svg rect[data-cell]')]
      .map((n) => `${getComputedStyle(n).opacity}|${getComputedStyle(n).transform}`);
    const frames = [];
    for (let i = 0; i < 12; i++) {
      frames.push(snap().join(','));
      await new Promise((r) => requestAnimationFrame(r));
    }
    const mid = snap();
    return { distinctFrames: new Set(frames).size, distinctCellsMid: new Set(mid).size, cells: mid.length };
  });
  results.push({ check: 'pivot replays on change', value: `${pivotSpread.distinctFrames} distinct frames, ${pivotSpread.cells} cells` });
  if (pivotSpread.distinctFrames < 3) fails.push('pivot did not re-animate on field change: ' + JSON.stringify(pivotSpread));

  console.table(results);
  console.log('CSP violations:', csp.length ? csp : 'none');
  console.log('JS errors:', errors.length ? errors : 'none');
  if (csp.length) fails.push(...csp);
  if (errors.length) fails.push(...errors);

  await browser.close();
  server.close();
  console.log(fails.length ? '\nFAILURES:\n' + fails.join('\n') : '\nAll real-path animation checks passed.');
  process.exit(fails.length ? 1 : 0);
})();
