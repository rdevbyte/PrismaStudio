// Bundles src/* into a standalone TabulaMetrics.html; Google Sans is a remote, optional font.
const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, 'src');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const asset = (f) => fs.readFileSync(path.join(SRC, 'assets', f)).toString('base64');

const css = read('styles.css');
const vendor = fs.readFileSync(path.join(SRC, 'vendor', 'gsap.min.js'), 'utf8');
const workerSource = ['analysis.js', 'insights.js', 'parse.js', 'pipeline.js', 'worker.js']
  .map(read).join('\n\n/* ---- worker module ---- */\n\n');
const workerBootstrap = `globalThis.__TABULAMETRICS_WORKER_SOURCE__=${JSON.stringify(workerSource).replace(/<\//g, '<\\/')};`;
const js = [vendor, ...['anim.js', 'analysis.js', 'insights.js', 'charts.js', 'parse.js', 'pipeline.js'].map(read), workerBootstrap, read('app.js')]
  .join('\n\n/* ---- */\n\n');
let html = read('shell.html');
const scriptHash = require('crypto').createHash('sha256').update(js, 'utf8').digest('base64');
const csp = `default-src 'self'; script-src 'self' 'sha256-${scriptHash}'; style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'none'; worker-src blob:; form-action 'none'; base-uri 'self'`;

html = html
  .replace('/*__CSS__*/', () => css)
  .replace('<!--__CSP__*/', () => `<meta http-equiv="Content-Security-Policy" content="${csp}" />`)
  .replace('__TM_FAVICON__', () => asset('favicon.png'))
  .replace('__TM_MARK_DAYLIGHT__', () => asset('brand-mark-daylight.png'))
  .replace('__TM_MARK_SANDSTONE__', () => asset('brand-mark-sandstone.png'))
  .replace('__TM_MARK_EMBER__', () => asset('brand-mark-ember.png'))
  .replace('__TM_MARK_BURGUNDY__', () => asset('brand-mark-burgundy.png'))
  .replace('__TM_WORDMARK_DAYLIGHT__', () => asset('brand-wordmark-daylight.png'))
  .replace('__TM_WORDMARK_SANDSTONE__', () => asset('brand-wordmark-sandstone.png'))
  .replace('__TM_WORDMARK_EMBER__', () => asset('brand-wordmark-ember.png'))
  .replace('__TM_WORDMARK_BURGUNDY__', () => asset('brand-wordmark-burgundy.png'))
  .replace('/*__JS__*/', () => js);

const outDir = path.join(__dirname, 'dist');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'index.html'), html);
fs.writeFileSync(path.join(__dirname, 'TabulaMetrics.html'), html);
console.log('Built: ' + (Buffer.byteLength(html) / 1024).toFixed(0) + ' KB → dist/index.html + TabulaMetrics.html');
