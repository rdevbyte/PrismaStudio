/* ============================================================
   TabulaMetrics — File parsing (CSV / TSV / XLSX), zero deps.
   XLSX is unzipped with the browser-native DecompressionStream,
   so no SheetJS / no CDN / works fully offline.
   ============================================================ */
(function (global) {
  'use strict';

  const LIMITS = Object.freeze({
    maxRows: 100000,
    maxColumns: 200,
    maxCells: 1000000,
    maxFieldChars: 1000000,
    maxXlsxXmlBytes: 100 * 1024 * 1024,
  });

  /* ---------------- delimited text ---------------- */
  function sniffDelimiter(text) {
    const end = text.search(/\r?\n/);
    const line = (end < 0 ? text : text.slice(0, end)).replace(/^\uFEFF/, '');
    const counts = { ',': 0, '\t': 0, ';': 0, '|': 0 };
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') i++;
        else inQ = !inQ;
      } else if (!inQ && counts[ch] !== undefined) counts[ch]++;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0
      ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] : ',';
  }

  function parseDelimited(text, delim, limits = LIMITS) {
    text = text.replace(/^\uFEFF/, '');
    const d = delim || sniffDelimiter(text);
    const rows = [];
    let row = [], field = '', inQ = false, i = 0, cells = 0;
    const pushField = () => {
      row.push(field); field = ''; cells++;
      if (row.length > limits.maxColumns) throw new Error(`This file has more than ${limits.maxColumns} columns. Reduce the number of columns and try again.`);
      if (cells > limits.maxCells) throw new Error(`This file has more than ${limits.maxCells.toLocaleString()} cells. Filter the data and try again.`);
    };
    const pushRow = () => {
      pushField();
      if (rows.length >= limits.maxRows) throw new Error(`This file has more than ${limits.maxRows.toLocaleString()} rows. Filter the data and try again.`);
      rows.push(row); row = [];
    };
    while (i < text.length) {
      const c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        field += c; i++;
      } else if (c === '"') { inQ = true; i++; }
      else if (c === d) { pushField(); i++; }
      else if (c === '\r') { i++; }
      else if (c === '\n') { pushRow(); i++; }
      else { field += c; i++; }
      if (field.length > limits.maxFieldChars) throw new Error(`A single cell exceeds ${limits.maxFieldChars.toLocaleString()} characters. Shorten it and try again.`);
    }
    if (field !== '' || row.length) { pushField(); if (rows.length >= limits.maxRows) throw new Error(`This file has more than ${limits.maxRows.toLocaleString()} rows. Filter the data and try again.`); rows.push(row); }
    return rows.filter((r) => r.some((v) => String(v).trim() !== ''));
  }

  /* ---------------- ZIP + XLSX ---------------- */
  async function inflateRaw(bytes, maxOutputBytes) {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open .xlsx files (no DecompressionStream). Please export your sheet as CSV.');
    const ds = new DecompressionStream('deflate-raw');
    const reader = new Blob([bytes]).stream().pipeThrough(ds).getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxOutputBytes) {
          await reader.cancel();
          throw new Error('The expanded XLSX workbook exceeds the 100 MB safety limit. Save a smaller workbook or export as CSV.');
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
    return out;
  }

  async function unzip(buf) {
    const view = new DataView(buf), bytes = new Uint8Array(buf);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i--) {
      if (i + 4 <= bytes.length && view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Not a valid .xlsx file (no ZIP directory found).');
    const count = view.getUint16(eocd + 10, true);
    if (count > 10000) throw new Error('This XLSX contains an unreasonable number of ZIP entries.');
    let off = view.getUint32(eocd + 16, true);
    const files = Object.create(null);
    for (let n = 0; n < count; n++) {
      if (off + 46 > bytes.length || view.getUint32(off, true) !== 0x02014b50) throw new Error('The XLSX ZIP directory is malformed.');
      const method = view.getUint16(off + 10, true);
      const compSize = view.getUint32(off + 20, true);
      const nameLen = view.getUint16(off + 28, true);
      const extraLen = view.getUint16(off + 30, true);
      const commentLen = view.getUint16(off + 32, true);
      const localOff = view.getUint32(off + 42, true);
      const nameEnd = off + 46 + nameLen;
      const nextOff = nameEnd + extraLen + commentLen;
      if (nextOff > bytes.length || localOff + 30 > bytes.length) throw new Error('The XLSX ZIP directory is malformed.');
      const name = new TextDecoder().decode(bytes.subarray(off + 46, nameEnd));
      if (view.getUint32(localOff, true) !== 0x04034b50) throw new Error('The XLSX ZIP entry is malformed.');
      const lNameLen = view.getUint16(localOff + 26, true);
      const lExtraLen = view.getUint16(localOff + 28, true);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      if (dataStart + compSize > bytes.length) throw new Error('The XLSX ZIP entry is truncated.');
      files[name] = { method, raw: bytes.subarray(dataStart, dataStart + compSize) };
      off = nextOff;
    }
    const out = Object.create(null);
    let totalBytes = 0;
    for (const [name, f] of Object.entries(files)) {
      if (!/\.(xml|rels)$/i.test(name)) continue;
      const remaining = LIMITS.maxXlsxXmlBytes - totalBytes;
      if (remaining <= 0) throw new Error('The expanded XLSX workbook exceeds the 100 MB safety limit. Save a smaller workbook or export as CSV.');
      let decoded;
      if (f.method === 0) decoded = f.raw;
      else if (f.method === 8) decoded = await inflateRaw(f.raw, remaining);
      else throw new Error(`Unsupported XLSX compression method ${f.method}.`);
      totalBytes += decoded.byteLength;
      if (totalBytes > LIMITS.maxXlsxXmlBytes) throw new Error('The expanded XLSX workbook exceeds the 100 MB safety limit. Save a smaller workbook or export as CSV.');
      out[name] = new TextDecoder().decode(decoded);
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
  const unescapeXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&amp;/g, '&');

  function colToIndex(ref) {
    const m = /^([A-Z]+)/.exec(ref || ''); if (!m) return 0;
    let n = 0; for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }
  const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
  const excelDate = (serial) => new Date(EXCEL_EPOCH + Math.round(serial * 86400000));

  function normalizeZipPath(base, target) {
    const raw = target.startsWith('/') ? target.slice(1) : `${base}/${target}`;
    const parts = [];
    raw.split('/').forEach((part) => {
      if (!part || part === '.') return;
      if (part === '..') parts.pop();
      else parts.push(part);
    });
    return parts.join('/');
  }

  function resolveFirstWorksheet(workbookXml, relsXml, files) {
    const sheets = xmlTags(workbookXml, 'sheet');
    if (!sheets.length) throw new Error('No worksheets found in this workbook.');
    const relationships = new Map(xmlTags(relsXml || '', 'Relationship').map((r) => [attr(r.attrs, 'Id'), attr(r.attrs, 'Target')]));
    const ordered = [...sheets.filter((s) => attr(s.attrs, 'state') !== 'hidden' && attr(s.attrs, 'state') !== 'veryHidden'), ...sheets.filter((s) => ['hidden', 'veryHidden'].includes(attr(s.attrs, 'state')))];
    for (const sheet of ordered) {
      const relId = attr(sheet.attrs, 'r:id');
      const target = relId && relationships.get(relId);
      if (!target) continue;
      const key = normalizeZipPath('xl', target);
      if (files[key]) return { key, name: attr(sheet.attrs, 'name') || 'Sheet1' };
    }
    throw new Error('Could not resolve the first worksheet in this workbook. Save it again as .xlsx or export as CSV.');
  }

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
    // Follow workbook order and its relationship IDs; sheet file numbers do not
    // define tab order and may not match the first visible sheet.
    const wbXml = files['xl/workbook.xml'] || '';
    const relsXml = files['xl/_rels/workbook.xml.rels'] || '';
    const firstSheet = resolveFirstWorksheet(wbXml, relsXml, files);
    const sheetXml = files[firstSheet.key];
    const rowTags = xmlTags(sheetXml, 'row');
    if (rowTags.length > LIMITS.maxRows) throw new Error(`This worksheet has more than ${LIMITS.maxRows.toLocaleString()} rows. Filter the data and try again.`);
    const rows = [];
    let totalCells = 0;
    rowTags.forEach((r) => {
      const cells = [];
      const re = /<c(\s[^>]*)?(?:\/>|>([\s\S]*?)<\/c>)/g;
      let m;
      while ((m = re.exec(r.inner))) {
        const a = m[1] || '', inner = m[2] || '';
        const idx = colToIndex(attr(a, 'r'));
        if (idx >= LIMITS.maxColumns) throw new Error(`This worksheet has more than ${LIMITS.maxColumns} columns. Reduce the number of columns and try again.`);
        totalCells++;
        if (totalCells > LIMITS.maxCells) throw new Error(`This worksheet has more than ${LIMITS.maxCells.toLocaleString()} cells. Filter the data and try again.`);
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
    return { rows: rows.filter((r) => r.some((v) => v !== '' && v != null)), sheetName: firstSheet.name };
  }

  /* ---------------- header handling ---------------- */
  function dedupeHeaders(hdr) {
    const used = new Set();
    const nextSuffix = new Map();
    return hdr.map((h, i) => {
      const base = String(h == null ? '' : h).trim() || `Column ${i + 1}`;
      let name = base;
      if (used.has(name)) {
        let suffix = nextSuffix.get(base) || 2;
        do { name = `${base} (${suffix++})`; } while (used.has(name));
        nextSuffix.set(base, suffix);
      }
      used.add(name);
      return name;
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
    if (matrix.length > LIMITS.maxRows) throw new Error(`This file has more than ${LIMITS.maxRows.toLocaleString()} rows. Filter the data and try again.`);
    const hIdx = findHeaderRow(matrix);
    let width = 0;
    for (const row of matrix) if (row.length > width) width = row.length;
    if (width > LIMITS.maxColumns) throw new Error(`This file has more than ${LIMITS.maxColumns} columns. Reduce the number of columns and try again.`);
    if (width * Math.max(0, matrix.length - hIdx - 1) > LIMITS.maxCells) throw new Error(`This file expands to more than ${LIMITS.maxCells.toLocaleString()} cells. Filter the data and try again.`);
    const header = dedupeHeaders(Array.from({ length: width }, (_, i) => matrix[hIdx][i]));
    const rows = [];
    for (let i = hIdx + 1; i < matrix.length; i++) {
      const r = matrix[i];
      const o = Object.create(null);
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

  /* ---------------- health-data guard ----------------
     Matching is word-boundary based, not substring. "phi" as a loose substring
     matched Philosophy, Philadelphia, Sophia, Memphis, graphic_design and more —
     a school gradebook is not PHI. Terms are also weighted: a single ambiguous
     word no longer blocks a file on its own. */

  // Unambiguous clinical identifiers — one of these is enough to block.
  const HEALTH_STRONG = [
    'icd-?9', 'icd-?10', 'icd-?11', 'cpt code', 'hcpcs', 'snomed', 'npi number',
    'medical record (number|no|#)?', 'mrn', 'patients?', 'patient (name|id|identifier)',
    'protected health information', 'phi', 'ephi',
    'discharge summary', 'physician note', 'clinical note',
    'health plan beneficiary', 'treatment plan', 'lab result',
    'prescription', 'dosage', 'medication',
  ];
  // Softer clinical words — need two or more before blocking, because schools,
  // HR systems and insurers legitimately use them in isolation.
  const HEALTH_WEAK = [
    'diagnosis', 'diagnoses', 'symptom', 'blood pressure', 'cholesterol',
    'immunization', 'immunisation', 'vaccination', 'clinical', 'hospital',
    'admission date', 'discharge', 'allergy', 'allergies', 'insulin',
    'bmi', 'systolic', 'diastolic',
  ];
  // Contexts that are routinely non-clinical, used to discount weak hits.
  const EDU_CONTEXT = /\b(student|pupil|grade|gpa|semester|teacher|classroom|homeroom|attendance|enrol|course|school|district|transcript|iep|504)\b/i;

  const DECLARATION_HINT = /\b(no phi|no-phi|nophi|de-?identified|deidentified|synthetic|anonymi[sz]ed|test data|dummy data|sample data|not phi|contains no phi|phi[- ]free)\b/i;
  const wordRe = (term) => new RegExp(`(^|[^a-z0-9])(${term})([^a-z0-9]|$)`, 'i');
  const STRONG_RES = HEALTH_STRONG.map((term) => [term, wordRe(term)]);
  const WEAK_RES = HEALTH_WEAK.map((term) => [term, wordRe(term)]);

  function healthScan(columns, rows) {
    const headerHay = columns.join(' | ');
    const strongHits = new Set();
    for (const [term, re] of STRONG_RES) if (re.test(headerHay)) strongHits.add(term);
    const missingStrong = STRONG_RES.filter(([term]) => !strongHits.has(term));
    const weakHits = WEAK_RES.filter(([, re]) => re.test(headerHay)).map(([term]) => term);
    const eduContext = EDU_CONTEXT.test(headerHay);
    let declarationHint = DECLARATION_HINT.test(headerHay);

    // Scan every parsed record for strong identifiers. A free-text phrase such
    // as "sample data" is only a hint; it never overrides a clinical hit or
    // substitutes for the user's explicit, in-app attestation.
    for (const row of rows) {
      const text = Object.values(row).join(' ');
      if (!declarationHint && DECLARATION_HINT.test(text)) declarationHint = true;
      for (const [term, re] of missingStrong) if (!strongHits.has(term) && re.test(text)) strongHits.add(term);
    }

    const weakNeeded = eduContext ? 3 : 2;
    const blocked = strongHits.size > 0 || weakHits.length >= weakNeeded;
    const terms = [...new Set([...strongHits, ...weakHits])].map((t) => t.replace(/[-?()]/g, (m) => (m === '?' ? '' : m)));
    return { blocked, terms, strong: strongHits.size, weak: weakHits.length, eduContext, declarationHint, override: false };
  }

  global.TabulaMetricsParse = { parseFile, parseText, parseDelimited, sniffDelimiter, healthScan, toObjects };
})(typeof window !== 'undefined' ? window : globalThis);
