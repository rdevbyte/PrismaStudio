/* ============================================================
   PrismaStudio — File parsing (CSV / TSV / XLSX), zero deps.
   XLSX is unzipped with the browser-native DecompressionStream,
   so no SheetJS / no CDN / works fully offline.
   ============================================================ */
(function (global) {
  'use strict';

  /* ---------------- delimited text ---------------- */
  function sniffDelimiter(text) {
    const line = text.split(/\r?\n/).find((l) => l.trim()) || '';
    const counts = { ',': 0, '\t': 0, ';': 0, '|': 0 };
    let inQ = false;
    for (const ch of line) {
      if (ch === '"') inQ = !inQ;
      else if (!inQ && counts[ch] !== undefined) counts[ch]++;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0
      ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] : ',';
  }

  function parseDelimited(text, delim) {
    text = text.replace(/^\uFEFF/, '');
    const d = delim || sniffDelimiter(text);
    const rows = [];
    let row = [], field = '', inQ = false, i = 0;
    while (i < text.length) {
      const c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { inQ = true; i++; continue; }
      if (c === d) { row.push(field); field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += c; i++;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.some((v) => String(v).trim() !== ''));
  }

  /* ---------------- ZIP + XLSX ---------------- */
  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open .xlsx files (no DecompressionStream). Please export your sheet as CSV.');
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function unzip(buf) {
    const view = new DataView(buf), bytes = new Uint8Array(buf);
    // locate End Of Central Directory
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Not a valid .xlsx file (no ZIP directory found).');
    const count = view.getUint16(eocd + 10, true);
    let off = view.getUint32(eocd + 16, true);
    const files = {};
    for (let n = 0; n < count; n++) {
      if (view.getUint32(off, true) !== 0x02014b50) break;
      const method = view.getUint16(off + 10, true);
      const compSize = view.getUint32(off + 20, true);
      const nameLen = view.getUint16(off + 28, true);
      const extraLen = view.getUint16(off + 30, true);
      const commentLen = view.getUint16(off + 32, true);
      const localOff = view.getUint32(off + 42, true);
      const name = new TextDecoder().decode(bytes.subarray(off + 46, off + 46 + nameLen));
      // read local header to find data start
      const lNameLen = view.getUint16(localOff + 26, true);
      const lExtraLen = view.getUint16(localOff + 28, true);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const raw = bytes.subarray(dataStart, dataStart + compSize);
      files[name] = { method, raw };
      off += 46 + nameLen + extraLen + commentLen;
    }
    const out = {};
    for (const [name, f] of Object.entries(files)) {
      if (!/\.(xml|rels)$/i.test(name)) continue;
      out[name] = new TextDecoder().decode(f.method === 0 ? f.raw : await inflateRaw(f.raw));
    }
    return out;
  }

  function xmlTags(xml, tag) {
    const out = [];
    const re = new RegExp(`<${tag}(\\s[^>]*)?(/>|>([\\s\\S]*?)</${tag}>)`, 'g');
    let m;
    while ((m = re.exec(xml))) out.push({ attrs: m[1] || '', inner: m[3] || '' });
    return out;
  }
  const attr = (s, name) => { const m = new RegExp(`${name}="([^"]*)"`).exec(s || ''); return m ? m[1] : null; };
  const unescapeXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&amp;/g, '&');

  function colToIndex(ref) {
    const m = /^([A-Z]+)/.exec(ref || ''); if (!m) return 0;
    let n = 0; for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }
  const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
  const excelDate = (serial) => new Date(EXCEL_EPOCH + Math.round(serial * 86400000));

  async function parseXlsx(buf) {
    const files = await unzip(buf);
    // shared strings
    const sst = [];
    const sstXml = files['xl/sharedStrings.xml'];
    if (sstXml) {
      xmlTags(sstXml, 'si').forEach((si) => {
        const parts = xmlTags(si.inner, 't').map((t) => unescapeXml(t.inner));
        sst.push(parts.join(''));
      });
    }
    // number formats → which style ids are dates
    const dateStyles = new Set();
    const stylesXml = files['xl/styles.xml'];
    if (stylesXml) {
      const customDate = new Set();
      xmlTags(stylesXml, 'numFmt').forEach((nf) => {
        const code = attr(nf.attrs, 'formatCode') || '';
        const id = attr(nf.attrs, 'numFmtId');
        if (/[dmyhs]/i.test(code) && /(d|m|y)/i.test(code) && !/[#0]/.test(code.replace(/\[[^\]]*\]/g, ''))) customDate.add(id);
      });
      const cellXfs = stylesXml.split('<cellXfs')[1] || '';
      xmlTags(cellXfs, 'xf').forEach((xf, i) => {
        const id = attr(xf.attrs, 'numFmtId');
        const builtin = +id;
        if (customDate.has(id) || (builtin >= 14 && builtin <= 22) || (builtin >= 45 && builtin <= 47)) dateStyles.add(i);
      });
    }
    // find first worksheet
    const wbXml = files['xl/workbook.xml'] || '';
    const sheetNames = xmlTags(wbXml, 'sheet').map((s) => attr(s.attrs, 'name'));
    const sheetKeys = Object.keys(files).filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
      .sort((a, b) => +(/(\d+)/.exec(a)[1]) - +(/(\d+)/.exec(b)[1]));
    if (!sheetKeys.length) throw new Error('No worksheets found in this workbook.');
    const sheetXml = files[sheetKeys[0]];
    const rows = [];
    xmlTags(sheetXml, 'row').forEach((r) => {
      const cells = [];
      const re = /<c(\s[^>]*)?(?:\/>|>([\s\S]*?)<\/c>)/g;
      let m;
      while ((m = re.exec(r.inner))) {
        const a = m[1] || '', inner = m[2] || '';
        const idx = colToIndex(attr(a, 'r'));
        const t = attr(a, 't');
        const sIdx = attr(a, 's') != null ? +attr(a, 's') : -1;
        let val = null;
        if (t === 'inlineStr') {
          val = xmlTags(inner, 't').map((x) => unescapeXml(x.inner)).join('');
        } else {
          const vm = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(inner);
          const raw = vm ? unescapeXml(vm[1]) : null;
          if (raw == null) val = null;
          else if (t === 's') val = sst[+raw] ?? '';
          else if (t === 'b') val = raw === '1' ? 'TRUE' : 'FALSE';
          else if (t === 'str' || t === 'e') val = raw;
          else {
            const n = Number(raw);
            if (dateStyles.has(sIdx) && isFinite(n) && n > 20 && n < 2958466) {
              const d = excelDate(n);
              val = d.toISOString().slice(0, 10);
            } else val = isFinite(n) ? n : raw;
          }
        }
        cells[idx] = val;
      }
      for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = '';
      rows.push(cells);
    });
    return { rows: rows.filter((r) => r.some((v) => v !== '' && v != null)), sheetName: sheetNames[0] || 'Sheet1' };
  }

  /* ---------------- header handling ---------------- */
  function dedupeHeaders(hdr) {
    const seen = new Map();
    return hdr.map((h, i) => {
      let name = String(h == null ? '' : h).trim();
      if (!name) name = `Column ${i + 1}`;
      if (seen.has(name)) { const c = seen.get(name) + 1; seen.set(name, c); return `${name} (${c})`; }
      seen.set(name, 1); return name;
    });
  }

  // Detect a preamble (title rows) before the real header row
  function findHeaderRow(matrix) {
    const limit = Math.min(8, matrix.length);
    let best = 0, bestScore = -Infinity;
    const widths = matrix.slice(0, limit).map((r) => r.filter((v) => String(v ?? '').trim() !== '').length);
    const maxWidth = Math.max(...widths, 1);
    for (let i = 0; i < limit; i++) {
      const r = matrix[i];
      const filled = r.filter((v) => String(v ?? '').trim() !== '').length;
      if (filled < maxWidth * 0.6) continue;
      const textish = r.filter((v) => String(v ?? '').trim() !== '' && isNaN(Number(String(v).replace(/[$,%\s]/g, '')))).length;
      const score = filled + textish * 1.5 - i * 0.5;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    return best;
  }

  function toObjects(matrix) {
    if (!matrix.length) return { columns: [], rows: [] };
    const hIdx = findHeaderRow(matrix);
    const width = Math.max(...matrix.map((r) => r.length));
    const header = dedupeHeaders(Array.from({ length: width }, (_, i) => matrix[hIdx][i]));
    const rows = [];
    for (let i = hIdx + 1; i < matrix.length; i++) {
      const r = matrix[i];
      const o = {};
      let any = false;
      for (let j = 0; j < width; j++) {
        const v = r[j];
        o[header[j]] = v == null ? '' : v;
        if (String(v ?? '').trim() !== '') any = true;
      }
      if (any) rows.push(o);
    }
    // drop fully-empty columns
    const keep = header.filter((h) => rows.some((r) => String(r[h] ?? '').trim() !== ''));
    return { columns: keep, rows, headerRow: hIdx };
  }

  async function parseFile(file) {
    const name = file.name || 'data';
    const ext = (name.split('.').pop() || '').toLowerCase();
    const t0 = performance.now();
    let matrix, sheetName = null;
    if (ext === 'xlsx' || ext === 'xlsm') {
      const res = await parseXlsx(await file.arrayBuffer());
      matrix = res.rows; sheetName = res.sheetName;
    } else if (ext === 'xls') {
      throw new Error('Legacy .xls is not supported. Open it in Excel/Sheets and save as .xlsx or .csv.');
    } else {
      const text = await file.text();
      matrix = parseDelimited(text);
    }
    const { columns, rows, headerRow } = toObjects(matrix);
    if (!columns.length || !rows.length) throw new Error('No tabular data found in that file.');
    return { name, columns, rows, sheetName, headerRow, parseMs: Math.round(performance.now() - t0) };
  }

  function parseText(text, name = 'pasted-data.csv') {
    const t0 = performance.now();
    const { columns, rows, headerRow } = toObjects(parseDelimited(text));
    return { name, columns, rows, headerRow, parseMs: Math.round(performance.now() - t0) };
  }

  /* ---------------- health-data guard ---------------- */
  const HEALTH_TERMS = ['diagnosis', 'diagnoses', 'icd-10', 'icd10', 'icd-9', 'patient name', 'medical record', 'mrn', 'phi', 'prescription', 'medication', 'dosage', 'treatment plan', 'symptom', 'lab result', 'blood pressure', 'cholesterol', 'immunization', 'clinical', 'hospital admission', 'discharge summary', 'physician note', 'health plan beneficiary'];
  const NEGATION = /\b(no phi|de-?identified|synthetic|anonymi[sz]ed|test data|dummy data|not phi)\b/i;

  function healthScan(columns, rows) {
    const headerHay = columns.join(' | ').toLowerCase();
    const sampleHay = rows.slice(0, 40).map((r) => Object.values(r).join(' ')).join(' ').toLowerCase();
    if (NEGATION.test(headerHay + ' ' + sampleHay)) return { blocked: false, override: true };
    const hits = HEALTH_TERMS.filter((t) => headerHay.includes(t));
    // body matches only count for the strongest terms, to cut false positives
    const strong = ['icd-10', 'icd10', 'medical record', 'mrn', 'diagnosis'];
    const bodyHits = strong.filter((t) => sampleHay.includes(t));
    const all = [...new Set([...hits, ...bodyHits])];
    return { blocked: all.length > 0, terms: all };
  }

  global.PrismaParse = { parseFile, parseText, parseDelimited, sniffDelimiter, healthScan, toObjects };
})(typeof window !== 'undefined' ? window : globalThis);
