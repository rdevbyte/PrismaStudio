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

  const NEGATION = /\b(no phi|no-phi|nophi|de-?identified|deidentified|synthetic|anonymi[sz]ed|test data|dummy data|sample data|not phi|contains no phi|phi[- ]free)\b/i;

  const wordRe = (term) => new RegExp(`(^|[^a-z0-9])(${term})([^a-z0-9]|$)`, 'i');

  function healthScan(columns, rows) {
    const headerHay = columns.join(' | ');
    // Scan the WHOLE file for a declaration, not just the first rows — a note
    // placed in a trailing row or a far column used to be missed entirely.
    const allText = rows.map((r) => Object.values(r).join(' ')).join(' ');
    const declHay = headerHay + ' ' + allText;
    if (NEGATION.test(declHay)) return { blocked: false, override: true };

    const bodySample = rows.slice(0, 60).map((r) => Object.values(r).join(' ')).join(' ');

    const strongHits = HEALTH_STRONG.filter((t) => wordRe(t).test(headerHay) || wordRe(t).test(bodySample));
    const weakHits = HEALTH_WEAK.filter((t) => wordRe(t).test(headerHay));
    const eduContext = EDU_CONTEXT.test(headerHay);

    // Block on any strong identifier, or on 2+ weak clinical terms.
    // In an obvious education context, require 3+ weak terms.
    const weakNeeded = eduContext ? 3 : 2;
    const blocked = strongHits.length > 0 || weakHits.length >= weakNeeded;
    const terms = [...new Set([...strongHits, ...weakHits])].map((t) => t.replace(/[-?()]/g, (m) => (m === '?' ? '' : m)));
    return {
      blocked,
      terms,
      strong: strongHits.length,
      weak: weakHits.length,
      eduContext,
    };
  }

  global.PrismaParse = { parseFile, parseText, parseDelimited, sniffDelimiter, healthScan, toObjects };
})(typeof window !== 'undefined' ? window : globalThis);
