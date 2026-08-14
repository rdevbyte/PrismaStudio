// Bundles src/* into a single self-contained PrismaStudio.html
const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, 'src');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

const css = read('styles.css');
const vendor = fs.readFileSync(path.join(SRC, 'vendor', 'gsap.min.js'), 'utf8');
const js = [vendor, ...['anim.js', 'analysis.js', 'insights.js', 'charts.js', 'parse.js', 'app.js'].map(read)]
  .join('\n\n/* ---- */\n\n');
let html = read('shell.html');

html = html.replace('/*__CSS__*/', () => css).replace('/*__JS__*/', () => js);

const outDir = path.join(__dirname, 'dist');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'index.html'), html);
fs.writeFileSync(path.join(__dirname, 'PrismaStudio.html'), html);
console.log('Built: ' + (Buffer.byteLength(html) / 1024).toFixed(0) + ' KB → dist/index.html + PrismaStudio.html');
