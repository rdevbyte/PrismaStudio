/* Capture the pivot/cross-tab in isolation, with long labels, to inspect overlap */
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');

(async () => {
  const out = path.join(__dirname, '..', 'shots');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto('file://' + path.join(__dirname, '..', 'dist', 'index.html'));
  await page.click('#sampleInsuranceBtn');
  await page.waitForSelector('#analyzeBtn');
  await page.click('#analyzeBtn');
  await page.waitForSelector('.kpis');
  await page.click('.tab[data-tab="segments"]');
  await page.waitForTimeout(600);

  const card = await page.$('#pivotCard');
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await card.screenshot({ path: path.join(out, 'pivot-default.png') });

  // worst case: many columns with long labels
  const opts = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('#pvRow option')].map((o) => o.value),
    cols: [...document.querySelectorAll('#pvCol option')].map((o) => o.value),
  }));
  console.log('row options:', opts.rows.length, 'col options:', opts.cols.length);

  // pick the widest categorical fields
  const pickLong = (list) => list.reduce((a, b) => (b.length > a.length ? b : a), list[0]);
  await page.selectOption('#pvRow', pickLong(opts.rows));
  await page.selectOption('#pvCol', pickLong(opts.cols.filter((c) => c !== pickLong(opts.rows))));
  await page.waitForTimeout(500);
  await card.screenshot({ path: path.join(out, 'pivot-longlabels.png') });

  // quintile bands = longest possible labels
  const quint = opts.cols.find((c) => /quintile/.test(c));
  if (quint) {
    await page.selectOption('#pvCol', quint);
    await page.waitForTimeout(500);
    await card.screenshot({ path: path.join(out, 'pivot-quintile.png') });
    console.log('quintile col used:', quint);
  }
  const box = await page.evaluate(() => {
    const svg = document.querySelector('#pivotOut svg');
    const b = svg.getBoundingClientRect();
    const holder = document.getElementById('pivotOut').getBoundingClientRect();
    return { svgW: Math.round(b.width), svgH: Math.round(b.height), holderW: Math.round(holder.width), viewBox: svg.getAttribute('viewBox') };
  });
  console.log(box);
  await browser.close();
})();
