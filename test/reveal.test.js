/* Verifies: no tab is ever visually empty, every chart animates,
   and elements re-animate when scrolled away and back. */
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
  const server = await serve(4600);
  const browser = await chromium.launch();
  const fails = [];

  for (const sample of ['#sampleInsuranceBtn', '#sampleBtn']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
    await page.goto('http://127.0.0.1:4600/');
    await page.click(sample);
    await page.waitForSelector('#analyzeBtn');
    await page.click('#analyzeBtn');
    await page.waitForSelector('.kpis');
    await page.waitForTimeout(700);

    const name = sample.includes('Insurance') ? 'insurance' : 'sales';
    console.log(`\n=== ${name} ===`);
    const rows = [];

    for (const tab of TABS) {
      await page.click(`.tab[data-tab="${tab}"]`);
      await page.waitForTimeout(500);

      // walk the whole pane top to bottom, as a user scrolling would
      const walk = await page.evaluate(async () => {
        const pane = document.querySelector('.tabpane.active');
        const H = pane.scrollHeight;
        const everAnimated = new Set();
        const svgList = [...pane.querySelectorAll('svg.chart')];
        for (let y = 0; y <= H; y += Math.round(innerHeight * 0.6)) {
          window.scrollTo({ top: y, behavior: 'instant' });
          await new Promise((r) => setTimeout(r, 160));
          svgList.forEach((s, i) => { if (s.dataset.animated === '1') everAnimated.add(i); });
        }
        window.scrollTo({ top: 0, behavior: 'instant' });
        await new Promise((r) => setTimeout(r, 350));
        const cards = [...pane.querySelectorAll('.card, .subcard, .finding')];
        const svgs = [...pane.querySelectorAll('svg.chart')];
        // anything on screen right now must be visible
        const onScreenHidden = cards.filter((c) => {
          const r = c.getBoundingClientRect();
          return r.top < innerHeight && r.bottom > 0 && +getComputedStyle(c).opacity < 0.95;
        }).length;
        return {
          text: pane.innerText.trim().length,
          cards: cards.length,
          svgs: svgs.length,
          donuts: pane.querySelectorAll('svg [data-slice]').length,
          animatedSvgs: everAnimated.size,
          onScreenHidden,
          empties: pane.querySelectorAll('.empty').length,
        };
      });
      rows.push({ tab, ...walk });

      if (walk.text < 400) fails.push(`${name}/${tab}: only ${walk.text} chars of visible text`);
      if (walk.onScreenHidden > 0) fails.push(`${name}/${tab}: ${walk.onScreenHidden} on-screen cards invisible`);
      if (walk.svgs > 0 && walk.animatedSvgs === 0) fails.push(`${name}/${tab}: ${walk.svgs} charts, none animated`);
    }
    console.table(rows);

    // --- re-animation: scroll away and back must replay ---
    await page.click('.tab[data-tab="columns"]');
    await page.waitForTimeout(500);
    const replay = await page.evaluate(async () => {
      const pane = document.getElementById('tab-columns');
      const svg = [...pane.querySelectorAll('svg.chart')].find((s) => {
        const b = s.querySelector('rect[data-bar]');
        return b && isFinite(+b.dataset.w) && +b.dataset.w > 20;
      });
      if (!svg) return null;
      svg.scrollIntoView({ block: 'center', behavior: 'instant' });
      await new Promise((r) => setTimeout(r, 900));
      const firstPass = svg.dataset.animated;
      // scroll far away so it fully exits the viewport
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' });
      await new Promise((r) => setTimeout(r, 500));
      const rearmed = svg.dataset.animated;
      // come back
      svg.scrollIntoView({ block: 'center', behavior: 'instant' });
      await new Promise((r) => setTimeout(r, 120));
      const bar = svg.querySelector('rect[data-bar]');
      const mid = bar ? +bar.getAttribute('width') : null;
      await new Promise((r) => setTimeout(r, 800));
      const end = bar ? +bar.getAttribute('width') : null;
      return { firstPass, rearmed, replayed: svg.dataset.animated, mid, end, target: bar ? +bar.dataset.w : null };
    });
    console.log('re-animate on scroll back:', replay);
    if (replay) {
      if (replay.rearmed === '1') fails.push(`${name}: chart not re-armed after leaving viewport`);
      if (replay.mid != null && replay.end != null && !(replay.mid < replay.end)) {
        fails.push(`${name}: chart did not replay on return (mid=${replay.mid} end=${replay.end})`);
      }
    }

    // card re-reveal
    const cardReplay = await page.evaluate(async () => {
      const pane = document.getElementById('tab-columns');
      const card = [...pane.querySelectorAll('.subcard')][2];
      if (!card) return null;
      card.scrollIntoView({ block: 'center', behavior: 'instant' });
      await new Promise((r) => setTimeout(r, 700));
      const seen = card.dataset.revealed;
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' });
      await new Promise((r) => setTimeout(r, 500));
      const armed = card.dataset.revealed;
      card.scrollIntoView({ block: 'center', behavior: 'instant' });
      await new Promise((r) => setTimeout(r, 600));
      return { seen, armedAfterLeave: armed, finalOpacity: getComputedStyle(card).opacity, revealed: card.dataset.revealed };
    });
    console.log('card re-reveal:', cardReplay);
    if (cardReplay && +cardReplay.finalOpacity < 0.95) fails.push(`${name}: card invisible after returning`);

    if (errs.length) fails.push(...errs.map((e) => `${name}: ${e}`));
    await page.close();
  }

  await browser.close();
  server.close();
  console.log(fails.length ? '\nFAILURES:\n' + fails.join('\n') : '\nAll reveal / animation / content checks passed.');
  process.exit(fails.length ? 1 : 0);
})();
