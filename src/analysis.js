/* ============================================================
   PrismaStudio — Analysis Engine (deterministic, no AI)
   Pure functions. No DOM. No network.
   ============================================================ */
(function (global) {
  'use strict';

  /* ---------------- basic stats ---------------- */
  const num = (a) => a.filter((v) => typeof v === 'number' && isFinite(v));
  const sum = (a) => a.reduce((s, v) => s + v, 0);
  const mean = (a) => (a.length ? sum(a) / a.length : NaN);
  function quantile(sorted, q) {
    if (!sorted.length) return NaN;
    const pos = (sorted.length - 1) * q, base = Math.floor(pos), rest = pos - base;
    return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
  }
  const median = (a) => quantile([...a].sort((x, y) => x - y), 0.5);
  function variance(a) { if (a.length < 2) return 0; const m = mean(a); return sum(a.map((v) => (v - m) ** 2)) / (a.length - 1); }
  const sd = (a) => Math.sqrt(variance(a));
  function skewness(a) {
    const n = a.length; if (n < 3) return 0;
    const m = mean(a), s = sd(a); if (!s) return 0;
    return (n / ((n - 1) * (n - 2))) * sum(a.map((v) => ((v - m) / s) ** 3));
  }
  function kurtosis(a) {
    const n = a.length; if (n < 4) return 0;
    const m = mean(a), s = sd(a); if (!s) return 0;
    const g2 = sum(a.map((v) => ((v - m) / s) ** 4)) / n - 3;
    return g2;
  }
  function pearson(x, y) {
    const n = Math.min(x.length, y.length); if (n < 3) return NaN;
    const mx = mean(x), my = mean(y);
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
    if (!sxx || !syy) return NaN;
    return sxy / Math.sqrt(sxx * syy);
  }
  function rank(a) {
    const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
    const r = new Array(a.length);
    let i = 0;
    while (i < idx.length) {
      let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  }
  const spearman = (x, y) => pearson(rank(x), rank(y));

  // two-tailed p-value for pearson r via t-distribution approximation
  function corrPValue(r, n) {
    if (!isFinite(r) || n < 4) return NaN;
    const t = Math.abs(r) * Math.sqrt((n - 2) / Math.max(1e-12, 1 - r * r));
    return 2 * (1 - studentTCdf(t, n - 2));
  }
  function studentTCdf(t, df) {
    // Abramowitz-Stegun style via incomplete beta
    const x = df / (df + t * t);
    return 1 - 0.5 * incBeta(x, df / 2, 0.5);
  }
  function incBeta(x, a, b) {
    if (x <= 0) return 0; if (x >= 1) return 1;
    const lbeta = lgamma(a) + lgamma(b) - lgamma(a + b);
    const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lbeta) / a;
    let f = 1, c = 1, d = 0;
    for (let i = 0; i <= 200; i++) {
      const m = Math.floor(i / 2);
      let numer;
      if (i === 0) numer = 1;
      else if (i % 2 === 0) numer = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
      else numer = -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1));
      d = 1 + numer * d; if (Math.abs(d) < 1e-30) d = 1e-30; d = 1 / d;
      c = 1 + numer / c; if (Math.abs(c) < 1e-30) c = 1e-30;
      const cd = c * d; f *= cd;
      if (Math.abs(1 - cd) < 1e-10) break;
    }
    const res = front * (f - 1);
    return x < (a + 1) / (a + b + 2) ? res : 1 - incBetaSwap(1 - x, b, a, lbeta);
  }
  function incBetaSwap(x, a, b, lbeta) {
    const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lbeta) / a;
    let f = 1, c = 1, d = 0;
    for (let i = 0; i <= 200; i++) {
      const m = Math.floor(i / 2);
      let numer;
      if (i === 0) numer = 1;
      else if (i % 2 === 0) numer = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
      else numer = -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1));
      d = 1 + numer * d; if (Math.abs(d) < 1e-30) d = 1e-30; d = 1 / d;
      c = 1 + numer / c; if (Math.abs(c) < 1e-30) c = 1e-30;
      const cd = c * d; f *= cd;
      if (Math.abs(1 - cd) < 1e-10) break;
    }
    return front * (f - 1);
  }
  function lgamma(z) {
    const g = [676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
      12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
    z -= 1; let x = 0.99999999999980993;
    for (let i = 0; i < g.length; i++) x += g[i] / (z + i + 1);
    const t = z + g.length - 0.5;
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
  }

  function linreg(xs, ys) {
    const n = xs.length; if (n < 2) return { slope: 0, intercept: ys[0] || 0, r2: 0, se: 0 };
    const mx = mean(xs), my = mean(ys);
    let sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
    const slope = sxx ? sxy / sxx : 0, intercept = my - slope * mx;
    let ssRes = 0, ssTot = 0;
    for (let i = 0; i < n; i++) { const p = slope * xs[i] + intercept; ssRes += (ys[i] - p) ** 2; ssTot += (ys[i] - my) ** 2; }
    const r2 = ssTot ? 1 - ssRes / ssTot : 0;
    const se = n > 2 ? Math.sqrt(ssRes / (n - 2)) : 0;
    return { slope, intercept, r2, se, sxx, mx, n };
  }

  /* ---------------- association measures ---------------- */
  // eta-squared: variance in numeric metric explained by categorical grouping
  function etaSquared(groups) {
    const all = [];
    groups.forEach((g) => all.push(...g.values));
    if (all.length < 3) return { eta2: 0, f: 0, p: NaN };
    const gm = mean(all);
    let ssb = 0, ssw = 0;
    groups.forEach((g) => {
      const m = mean(g.values);
      ssb += g.values.length * (m - gm) ** 2;
      g.values.forEach((v) => { ssw += (v - m) ** 2; });
    });
    const sst = ssb + ssw;
    const k = groups.length, n = all.length;
    const dfb = k - 1, dfw = n - k;
    const f = dfb > 0 && dfw > 0 && ssw > 0 ? (ssb / dfb) / (ssw / dfw) : 0;
    const p = dfb > 0 && dfw > 0 && f > 0 ? fDistPValue(f, dfb, dfw) : NaN;
    return { eta2: sst ? ssb / sst : 0, f, p, dfb, dfw };
  }
  function fDistPValue(f, d1, d2) {
    const x = (d1 * f) / (d1 * f + d2);
    return 1 - incBeta(x, d1 / 2, d2 / 2);
  }
  // Cramér's V for two categoricals
  function cramersV(a, b) {
    const rows = [...new Set(a)], cols = [...new Set(b)];
    if (rows.length < 2 || cols.length < 2) return { v: 0, chi2: 0, p: NaN };
    const ri = new Map(rows.map((r, i) => [r, i])), ci = new Map(cols.map((c, i) => [c, i]));
    const obs = rows.map(() => new Array(cols.length).fill(0));
    const rt = new Array(rows.length).fill(0), ct = new Array(cols.length).fill(0);
    let n = 0;
    for (let i = 0; i < a.length; i++) {
      const r = ri.get(a[i]), c = ci.get(b[i]);
      if (r === undefined || c === undefined) continue;
      obs[r][c]++; rt[r]++; ct[c]++; n++;
    }
    if (!n) return { v: 0, chi2: 0, p: NaN };
    let chi2 = 0;
    for (let r = 0; r < rows.length; r++) for (let c = 0; c < cols.length; c++) {
      const e = (rt[r] * ct[c]) / n;
      if (e > 0) chi2 += (obs[r][c] - e) ** 2 / e;
    }
    const k = Math.min(rows.length - 1, cols.length - 1);
    return { v: Math.sqrt(chi2 / (n * k)), chi2, p: chiSqPValue(chi2, (rows.length - 1) * (cols.length - 1)), n };
  }
  function chiSqPValue(x, df) {
    if (x <= 0 || df <= 0) return 1;
    return 1 - lowerGamma(df / 2, x / 2);
  }
  function lowerGamma(s, x) { // regularized P(s,x)
    if (x < 0) return 0;
    if (x < s + 1) {
      let sum_ = 1 / s, term = sum_;
      for (let n = 1; n < 300; n++) { term *= x / (s + n); sum_ += term; if (Math.abs(term) < Math.abs(sum_) * 1e-12) break; }
      return sum_ * Math.exp(-x + s * Math.log(x) - lgamma(s));
    }
    let b = x + 1 - s, c = 1e300, d = 1 / b, h = d;
    for (let i = 1; i < 300; i++) {
      const an = -i * (i - s);
      b += 2; d = an * d + b; if (Math.abs(d) < 1e-30) d = 1e-30;
      c = b + an / c; if (Math.abs(c) < 1e-30) c = 1e-30;
      d = 1 / d; const del = d * c; h *= del;
      if (Math.abs(del - 1) < 1e-12) break;
    }
    return 1 - Math.exp(-x + s * Math.log(x) - lgamma(s)) * h;
  }
  // point-biserial style: numeric vs binary already covered by eta2

  /* ---------------- type inference ---------------- */
  const CURRENCY_RE = /^\s*[-(]?\s*[$€£¥₹]\s?-?[\d,]+(\.\d+)?\s*\)?\s*$/;
  const PERCENT_RE = /^\s*-?[\d,]+(\.\d+)?\s*%\s*$/;
  const NUMBER_RE = /^\s*-?[\d,]*\.?\d+([eE][-+]?\d+)?\s*$/;
  const BOOL_SET = new Set(['true', 'false', 'yes', 'no', 'y', 'n', '1', '0', 't', 'f']);
  const DATE_RES = [
    /^\d{4}-\d{1,2}-\d{1,2}([ T]\d{1,2}:\d{2}(:\d{2})?)?/,
    /^\d{1,2}\/\d{1,2}\/\d{2,4}$/,
    /^\d{1,2}-[A-Za-z]{3}-\d{2,4}$/,
    /^[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}$/,
  ];

  function parseNumberLike(v) {
    if (typeof v === 'number') return v;
    if (v == null) return NaN;
    let s = String(v).trim();
    if (!s) return NaN;
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    s = s.replace(/[$€£¥₹,%\s]/g, '');
    if (s.startsWith('-')) { neg = true; s = s.slice(1); }
    const n = Number(s);
    if (!isFinite(n)) return NaN;
    return neg ? -n : n;
  }
  function parseDateLike(v) {
    if (v instanceof Date) return v;
    const s = String(v).trim();
    if (!s) return null;
    if (!DATE_RES.some((re) => re.test(s))) return null;
    const d = new Date(s.length <= 10 && /^\d{4}-\d{1,2}-\d{1,2}$/.test(s) ? s + 'T00:00:00' : s);
    return isNaN(d.getTime()) ? null : d;
  }

  function inferType(values, name) {
    const nonEmpty = values.filter((v) => v !== null && v !== undefined && String(v).trim() !== '');
    const n = nonEmpty.length;
    if (!n) return 'text';
    const sample = nonEmpty.length > 800 ? nonEmpty.filter((_, i) => i % Math.ceil(nonEmpty.length / 800) === 0) : nonEmpty;
    const hit = (fn) => sample.filter(fn).length / sample.length;
    const lname = String(name || '').toLowerCase();

    const dateHit = hit((v) => parseDateLike(v) !== null);
    if (dateHit > 0.85) return 'date';
    const curHit = hit((v) => CURRENCY_RE.test(String(v)));
    if (curHit > 0.7) return 'currency';
    const pctHit = hit((v) => PERCENT_RE.test(String(v)));
    if (pctHit > 0.7) return 'percent';
    const boolHit = hit((v) => BOOL_SET.has(String(v).trim().toLowerCase()));
    const uniq = new Set(sample.map((v) => String(v).trim().toLowerCase()));
    if (boolHit > 0.9 && uniq.size <= 3) return 'boolean';
    const numHit = hit((v) => NUMBER_RE.test(String(v)));
    if (numHit > 0.85) {
      const uniqVals = new Set(nonEmpty.map(String));
      // zip / id-like numerics should be categories, not metrics
      if (/(^|_|\s)(zip|postal|zipcode|id|code|year)($|_|\s)/.test(lname) && uniqVals.size < nonEmpty.length * 0.95) return 'category';
      if (/(price|amount|cost|revenue|premium|spend|paid|income|salary|value|fee|charge|balance)/.test(lname)) return 'currency';
      return 'number';
    }
    const uniqAll = new Set(nonEmpty.map((v) => String(v).trim()));
    const ratio = uniqAll.size / n;
    if (uniqAll.size <= 60 || ratio < 0.35) return 'category';
    if (ratio > 0.9 && n > 20) return 'id';
    return 'text';
  }

  const NUMERIC_TYPES = new Set(['number', 'currency', 'percent']);
  const isNumericType = (t) => NUMERIC_TYPES.has(t);
  const isGroupable = (t) => t === 'category' || t === 'boolean';

  /* ---------------- column profiling ---------------- */
  function profileColumn(name, raw, type) {
    const total = raw.length;
    const nonEmpty = [];
    for (const v of raw) if (v !== null && v !== undefined && String(v).trim() !== '') nonEmpty.push(v);
    const missing = total - nonEmpty.length;
    const p = {
      name, type, total, missing,
      missingPct: total ? (missing / total) * 100 : 0,
      unique: 0, complete: total - missing,
    };
    if (isNumericType(type)) {
      const vals = num(nonEmpty.map(parseNumberLike));
      p.values = vals;
      p.unique = new Set(vals).size;
      if (vals.length) {
        const s = [...vals].sort((a, b) => a - b);
        p.min = s[0]; p.max = s[s.length - 1];
        p.mean = mean(vals); p.median = quantile(s, 0.5);
        p.p05 = quantile(s, 0.05); p.q1 = quantile(s, 0.25); p.q3 = quantile(s, 0.75); p.p95 = quantile(s, 0.95);
        p.sd = sd(vals); p.cv = p.mean ? Math.abs(p.sd / p.mean) : 0;
        p.sum = sum(vals); p.skew = skewness(vals); p.kurt = kurtosis(vals);
        p.iqr = p.q3 - p.q1;
        p.zeroCount = vals.filter((v) => v === 0).length;
        p.negCount = vals.filter((v) => v < 0).length;
        p.histogram = histogram(vals, 24);
      }
    } else if (type === 'date') {
      const ds = nonEmpty.map(parseDateLike).filter(Boolean).sort((a, b) => a - b);
      p.dates = ds; p.unique = new Set(ds.map((d) => d.getTime())).size;
      if (ds.length) {
        p.minDate = ds[0]; p.maxDate = ds[ds.length - 1];
        p.spanDays = Math.round((p.maxDate - p.minDate) / 86400000);
      }
    } else {
      const counts = new Map();
      for (const v of nonEmpty) { const k = String(v).trim(); counts.set(k, (counts.get(k) || 0) + 1); }
      p.unique = counts.size;
      p.counts = [...counts.entries()].sort((a, b) => b[1] - a[1]);
      p.top = p.counts.slice(0, 12).map(([k, c]) => ({ key: k, count: c, pct: (c / nonEmpty.length) * 100 }));
      p.rare = p.counts.filter(([, c]) => c === 1).length;
      // concentration: Herfindahl + top-1 share
      const totalC = nonEmpty.length || 1;
      p.hhi = sum(p.counts.map(([, c]) => (c / totalC) ** 2));
      p.topShare = p.counts.length ? (p.counts[0][1] / totalC) * 100 : 0;
      p.entropy = -sum(p.counts.map(([, c]) => { const pr = c / totalC; return pr * Math.log2(pr); }));
      p.maxEntropy = Math.log2(Math.max(2, p.counts.length));
      p.balance = p.maxEntropy ? p.entropy / p.maxEntropy : 0;
    }
    p.uniquePct = p.complete ? (p.unique / p.complete) * 100 : 0;
    p.constant = p.unique <= 1;
    return p;
  }

  function histogram(vals, bins) {
    if (!vals.length) return [];
    const mn = Math.min(...vals), mx = Math.max(...vals);
    if (mn === mx) return [{ x0: mn, x1: mx, count: vals.length }];
    const w = (mx - mn) / bins;
    const out = Array.from({ length: bins }, (_, i) => ({ x0: mn + i * w, x1: mn + (i + 1) * w, count: 0 }));
    for (const v of vals) {
      let i = Math.floor((v - mn) / w); if (i >= bins) i = bins - 1; if (i < 0) i = 0;
      out[i].count++;
    }
    return out;
  }

  /* ---------------- data quality scoring ---------------- */
  function qualityReport(profiles, rows) {
    const issues = [];
    let score = 100;
    profiles.forEach((p) => {
      if (p.missingPct > 50) { issues.push({ sev: 'high', col: p.name, msg: `${p.missingPct.toFixed(0)}% of values are missing — unreliable for analysis.` }); score -= 6; }
      else if (p.missingPct > 15) { issues.push({ sev: 'med', col: p.name, msg: `${p.missingPct.toFixed(0)}% missing values.` }); score -= 3; }
      else if (p.missingPct > 0) { issues.push({ sev: 'low', col: p.name, msg: `${p.missing} missing value${p.missing === 1 ? '' : 's'} (${p.missingPct.toFixed(1)}%).` }); score -= 0.5; }
      if (p.constant && p.complete > 0) { issues.push({ sev: 'med', col: p.name, msg: 'Only one distinct value — contributes nothing to analysis.' }); score -= 2; }
      if (p.type === 'id') { issues.push({ sev: 'low', col: p.name, msg: 'Looks like an identifier (nearly all values unique) — excluded from statistics.' }); }
      if (isNumericType(p.type) && p.values && p.values.length && Math.abs(p.skew || 0) > 2) {
        issues.push({ sev: 'low', col: p.name, msg: `Strongly skewed (skew ${p.skew.toFixed(1)}) — median (${fmtNum(p.median)}) is more representative than mean (${fmtNum(p.mean)}).` });
      }
      if (p.counts) {
        const caseDupes = new Map();
        p.counts.forEach(([k]) => {
          const norm = k.toLowerCase().trim();
          caseDupes.set(norm, (caseDupes.get(norm) || 0) + 1);
        });
        const dupes = [...caseDupes.values()].filter((c) => c > 1).length;
        if (dupes) { issues.push({ sev: 'med', col: p.name, msg: `${dupes} categor${dupes === 1 ? 'y' : 'ies'} differ only by capitalisation/whitespace — consider normalising.` }); score -= 1.5; }
      }
    });
    // duplicate rows
    const seen = new Set(); let dupRows = 0;
    for (const r of rows) { const k = JSON.stringify(r); if (seen.has(k)) dupRows++; else seen.add(k); }
    if (dupRows) { issues.push({ sev: 'med', col: '(rows)', msg: `${dupRows} exact duplicate row${dupRows === 1 ? '' : 's'} detected.` }); score -= Math.min(10, dupRows * 0.5); }
    return { score: Math.max(0, Math.round(score)), issues, dupRows };
  }

  /* ---------------- relationships ---------------- */
  function pairedNumeric(rows, a, b) {
    const xs = [], ys = [];
    for (const r of rows) {
      const x = parseNumberLike(r[a]), y = parseNumberLike(r[b]);
      if (isFinite(x) && isFinite(y)) { xs.push(x); ys.push(y); }
    }
    return [xs, ys];
  }

  function numericCorrelations(rows, numCols, minAbs = 0.15) {
    const out = [];
    for (let i = 0; i < numCols.length; i++) {
      for (let j = i + 1; j < numCols.length; j++) {
        const [xs, ys] = pairedNumeric(rows, numCols[i], numCols[j]);
        if (xs.length < 8) continue;
        const r = pearson(xs, ys);
        if (!isFinite(r)) continue;
        const rho = spearman(xs, ys);
        out.push({
          a: numCols[i], b: numCols[j], r, rho, n: xs.length,
          p: corrPValue(r, xs.length),
          strength: strengthLabel(Math.abs(r)),
          nonlinear: isFinite(rho) && Math.abs(rho) - Math.abs(r) > 0.15,
          duplicate: Math.abs(r) > 0.999,
        });
      }
    }
    return out.filter((c) => Math.abs(c.r) >= minAbs).sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
  }

  function strengthLabel(a) {
    if (a >= 0.8) return 'very strong';
    if (a >= 0.6) return 'strong';
    if (a >= 0.4) return 'moderate';
    if (a >= 0.2) return 'weak';
    return 'very weak';
  }

  // Categorical driver analysis: how much does each category column explain each metric?
  function driverAnalysis(rows, catCols, metricCols, opts = {}) {
    const minGroup = opts.minGroup || 3, maxLevels = opts.maxLevels || 40;
    const results = [];
    for (const metric of metricCols) {
      for (const cat of catCols) {
        const map = new Map();
        for (const r of rows) {
          const v = parseNumberLike(r[metric]);
          if (!isFinite(v)) continue;
          const k = r[cat] == null || String(r[cat]).trim() === '' ? '(blank)' : String(r[cat]).trim();
          if (!map.has(k)) map.set(k, []);
          map.get(k).push(v);
        }
        let groups = [...map.entries()].map(([key, values]) => ({ key, values }))
          .filter((g) => g.values.length >= minGroup);
        if (groups.length < 2 || groups.length > maxLevels) continue;
        const stats = etaSquared(groups);
        const overall = mean(groups.flatMap((g) => g.values));
        const levels = groups.map((g) => {
          const m = mean(g.values);
          return {
            key: g.key, n: g.values.length, mean: m, median: median(g.values),
            sum: sum(g.values), sd: sd(g.values),
            lift: overall ? ((m - overall) / Math.abs(overall)) * 100 : 0,
          };
        }).sort((a, b) => b.mean - a.mean);
        const spread = levels[0].mean - levels[levels.length - 1].mean;

        // Tautology guard: if the grouping is simply a binning/restatement of the
        // metric itself, its groups occupy disjoint ranges of that metric.
        // e.g. "Age Bracket" -> Age, or "Revenue (quintile)" -> Revenue.
        const ranges = groups.map((g) => {
          const s = [...g.values].sort((x, y) => x - y);
          return { lo: s[0], hi: s[s.length - 1] };
        }).sort((x, y) => x.lo - y.lo);
        let disjoint = 0;
        for (let i = 0; i < ranges.length - 1; i++) if (ranges[i].hi <= ranges[i + 1].lo) disjoint++;
        const tautological = ranges.length > 1 && disjoint / (ranges.length - 1) >= 0.9;

        results.push({
          metric, driver: cat, eta2: stats.eta2, f: stats.f, p: stats.p,
          levels, overall, spread, tautological,
          spreadPct: overall ? (spread / Math.abs(overall)) * 100 : 0,
          top: levels[0], bottom: levels[levels.length - 1],
          n: sum(levels.map((l) => l.n)),
        });
      }
    }
    return results.filter((r) => !r.tautological).sort((a, b) => b.eta2 - a.eta2);
  }

  // Categorical ↔ categorical associations
  function categoricalAssociations(rows, catCols, minV = 0.1) {
    const out = [];
    for (let i = 0; i < catCols.length; i++) {
      for (let j = i + 1; j < catCols.length; j++) {
        const a = [], b = [];
        for (const r of rows) {
          const x = r[catCols[i]], y = r[catCols[j]];
          if (x == null || y == null || String(x).trim() === '' || String(y).trim() === '') continue;
          a.push(String(x).trim()); b.push(String(y).trim());
        }
        if (a.length < 20) continue;
        const la = new Set(a).size, lb = new Set(b).size;
        if (la < 2 || lb < 2 || la > 30 || lb > 30) continue;
        const { v, chi2, p } = cramersV(a, b);
        if (v >= minV) out.push({ a: catCols[i], b: catCols[j], v, chi2, p, n: a.length, la, lb });
      }
    }
    return out.sort((x, y) => y.v - x.v);
  }

  // Cross-tab of two categoricals, optionally aggregating a metric
  function crossTab(rows, rowCol, colCol, metric, agg = 'mean') {
    const rowKeys = [], colKeys = [];
    const cells = new Map();
    for (const r of rows) {
      const rk = String(r[rowCol] ?? '(blank)').trim() || '(blank)';
      const ck = String(r[colCol] ?? '(blank)').trim() || '(blank)';
      const key = rk + '\u0000' + ck;
      if (!cells.has(key)) cells.set(key, []);
      if (metric) { const v = parseNumberLike(r[metric]); if (isFinite(v)) cells.get(key).push(v); }
      else cells.get(key).push(1);
    }
    const rset = new Set(), cset = new Set();
    for (const key of cells.keys()) { const [rk, ck] = key.split('\u0000'); rset.add(rk); cset.add(ck); }
    rowKeys.push(...rset); colKeys.push(...cset);
    const value = (rk, ck) => {
      const arr = cells.get(rk + '\u0000' + ck) || [];
      if (!arr.length) return null;
      if (!metric || agg === 'count') return arr.length;
      if (agg === 'sum') return sum(arr);
      return mean(arr);
    };
    const matrix = rowKeys.map((rk) => colKeys.map((ck) => value(rk, ck)));
    return { rowKeys, colKeys, matrix };
  }

  /* ---------------- outliers & anomalies ---------------- */
  function detectAnomalies(rows, profiles, opts = {}) {
    const zThresh = opts.z || 3, out = [];
    profiles.filter((p) => isNumericType(p.type) && p.values && p.values.length > 12 && p.sd > 0).forEach((p) => {
      const lowFence = p.q1 - 1.5 * p.iqr, highFence = p.q3 + 1.5 * p.iqr;
      rows.forEach((r, i) => {
        const v = parseNumberLike(r[p.name]);
        if (!isFinite(v)) return;
        const z = (v - p.mean) / p.sd;
        const iqrOut = v < lowFence || v > highFence;
        if (Math.abs(z) >= zThresh || (iqrOut && Math.abs(z) >= 2)) {
          out.push({
            row: i + 1, column: p.name, value: v, z,
            method: Math.abs(z) >= zThresh ? 'z-score' : 'IQR',
            severity: Math.abs(z) >= 4 ? 'high' : Math.abs(z) >= 3 ? 'medium' : 'low',
            direction: z > 0 ? 'above' : 'below',
            expected: p.median,
          });
        }
      });
    });
    // rare categories
    profiles.filter((p) => p.type === 'category' && p.counts && p.complete > 50).forEach((p) => {
      p.counts.filter(([, c]) => c === 1).slice(0, 5).forEach(([k]) => {
        out.push({ row: null, column: p.name, value: k, z: NaN, method: 'rare category', severity: 'low', direction: 'rare', expected: null });
      });
    });
    return out.sort((a, b) => (Math.abs(b.z) || 0) - (Math.abs(a.z) || 0));
  }

  /* ---------------- time series ---------------- */
  function buildTimeSeries(rows, dateCol, metric, agg = 'sum') {
    const map = new Map();
    for (const r of rows) {
      const d = parseDateLike(r[dateCol]); if (!d) continue;
      const v = parseNumberLike(r[metric]); if (!isFinite(v)) continue;
      const key = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(v);
    }
    const pts = [...map.entries()].sort((a, b) => a[0] - b[0]).map(([t, arr]) => ({
      t, date: new Date(t), value: agg === 'mean' ? mean(arr) : agg === 'count' ? arr.length : sum(arr), n: arr.length,
    }));
    return pts;
  }

  function movingAverage(pts, w) {
    return pts.map((p, i) => {
      const s = Math.max(0, i - w + 1);
      const win = pts.slice(s, i + 1).map((q) => q.value);
      return { t: p.t, value: mean(win) };
    });
  }

  function forecast(pts, horizonDays) {
    if (pts.length < 4) return null;
    const t0 = pts[0].t;
    const xs = pts.map((p) => (p.t - t0) / 86400000), ys = pts.map((p) => p.value);
    const fit = linreg(xs, ys);
    const step = Math.max(1, Math.round((pts[pts.length - 1].t - t0) / 86400000 / Math.max(1, pts.length - 1)));
    const last = xs[xs.length - 1];
    const out = [];
    const tCrit = 1.96;
    for (let d = step; d <= horizonDays; d += step) {
      const x = last + d;
      const yhat = fit.slope * x + fit.intercept;
      const seP = fit.se * Math.sqrt(1 + 1 / fit.n + ((x - fit.mx) ** 2) / (fit.sxx || 1));
      out.push({ t: t0 + x * 86400000, value: yhat, lower: yhat - tCrit * seP, upper: yhat + tCrit * seP });
    }
    return { points: out, fit };
  }

  function seasonality(pts) {
    if (pts.length < 21) return null;
    const dow = Array.from({ length: 7 }, () => []);
    const mon = Array.from({ length: 12 }, () => []);
    pts.forEach((p) => { dow[p.date.getDay()].push(p.value); mon[p.date.getMonth()].push(p.value); });
    const overall = mean(pts.map((p) => p.value));
    const dowStats = dow.map((a, i) => ({ label: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][i], n: a.length, mean: a.length ? mean(a) : 0, index: a.length && overall ? (mean(a) / overall) * 100 : 0 }));
    const monStats = mon.map((a, i) => ({ label: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][i], n: a.length, mean: a.length ? mean(a) : 0, index: a.length && overall ? (mean(a) / overall) * 100 : 0 }));
    return { dow: dowStats, month: monStats, overall };
  }

  /* ---------------- concentration / pareto ---------------- */
  function pareto(rows, catCol, metric) {
    const map = new Map();
    for (const r of rows) {
      const k = String(r[catCol] ?? '(blank)').trim() || '(blank)';
      const v = metric ? parseNumberLike(r[metric]) : 1;
      if (metric && !isFinite(v)) continue;
      map.set(k, (map.get(k) || 0) + (metric ? v : 1));
    }
    const items = [...map.entries()].map(([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value);
    const tot = sum(items.map((i) => i.value)) || 1;
    let cum = 0;
    items.forEach((i) => { cum += i.value; i.share = (i.value / tot) * 100; i.cumShare = (cum / tot) * 100; });
    const idx80 = items.findIndex((i) => i.cumShare >= 80);
    return { items, total: tot, countTo80: idx80 >= 0 ? idx80 + 1 : items.length, pct80: items.length ? (((idx80 >= 0 ? idx80 + 1 : items.length) / items.length) * 100) : 0 };
  }

  /* ---------------- segment scan ---------------- */
  // find single-condition segments that most over/under-perform on a metric
  function segmentScan(rows, catCols, metric, opts = {}) {
    const minN = Math.max(opts.minN || 5, Math.ceil(rows.length * 0.01));
    const all = num(rows.map((r) => parseNumberLike(r[metric])));
    if (all.length < 20) return [];
    const gm = mean(all), gsd = sd(all);
    const segs = [];
    for (const c of catCols) {
      const map = new Map();
      for (const r of rows) {
        const v = parseNumberLike(r[metric]); if (!isFinite(v)) continue;
        const k = String(r[c] ?? '(blank)').trim() || '(blank)';
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(v);
      }
      for (const [k, vals] of map) {
        if (vals.length < minN) continue;
        const m = mean(vals);
        const se = gsd / Math.sqrt(vals.length);
        const z = se ? (m - gm) / se : 0;
        segs.push({
          column: c, value: k, n: vals.length, mean: m, median: median(vals), sum: sum(vals),
          lift: gm ? ((m - gm) / Math.abs(gm)) * 100 : 0, z,
          share: (vals.length / rows.length) * 100,
        });
      }
    }
    return segs.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
  }

  /* ---------------- numeric binning for non-numeric drivers ---------------- */
  function binNumeric(rows, col, bins = 5) {
    const vals = num(rows.map((r) => parseNumberLike(r[col])));
    if (vals.length < 20) return null;
    const s = [...vals].sort((a, b) => a - b);
    const edges = [];
    for (let i = 0; i <= bins; i++) edges.push(quantile(s, i / bins));
    const uniqEdges = [...new Set(edges)];
    if (uniqEdges.length < 3) return null;
    const label = (v) => {
      for (let i = 0; i < uniqEdges.length - 1; i++) {
        if (v <= uniqEdges[i + 1] || i === uniqEdges.length - 2) return `${fmtNum(uniqEdges[i])} – ${fmtNum(uniqEdges[i + 1])}`;
      }
      return '';
    };
    return { edges: uniqEdges, label };
  }

  /* ---------------- noise floor ----------------
     With enough rows, tiny effects appear purely by chance. These give the
     magnitude we'd expect from random data, so the UI can distinguish
     "found nothing" from "couldn't compute". */
  function noiseFloor(n) {
    if (!n || n < 4) return { r: 1, eta2: 1, v: 1 };
    const seR = 1 / Math.sqrt(n - 3);      // SE of Pearson r under the null
    return {
      n,
      r: 1.96 * seR,                        // |r| exceeded by 5% of random pairs
      eta2: 2 / (n - 1),                    // ~E[eta2] for a 3-level split
      v: 1.96 / Math.sqrt(n),               // rough Cramer's V chance level
    };
  }

  /* ---------------- formatting ---------------- */
  function fmtNum(v, opts = {}) {
    if (v == null || !isFinite(v)) return '—';
    const a = Math.abs(v);
    if (opts.currency) {
      if (a >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
      if (a >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
      if (a >= 1e4) return '$' + (v / 1e3).toFixed(1) + 'K';
      return '$' + v.toLocaleString(undefined, { maximumFractionDigits: 2 });
    }
    if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (a >= 1e4) return (v / 1e3).toFixed(1) + 'K';
    if (Number.isInteger(v)) return v.toLocaleString();
    if (a < 0.01) return v.toExponential(2);
    return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  const fmtPct = (v, d = 1) => (isFinite(v) ? `${v >= 0 ? '' : ''}${v.toFixed(d)}%` : '—');
  const fmtP = (p) => (!isFinite(p) ? '—' : p < 0.001 ? 'p < 0.001' : `p = ${p.toFixed(3)}`);
  const fmtDate = (d) => d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

  global.PrismaAnalysis = {
    mean, median, sd, variance, quantile, sum, num, skewness, kurtosis,
    pearson, spearman, corrPValue, linreg, etaSquared, cramersV, histogram,
    inferType, parseNumberLike, parseDateLike, isNumericType, isGroupable,
    profileColumn, qualityReport, numericCorrelations, driverAnalysis,
    categoricalAssociations, crossTab, detectAnomalies, buildTimeSeries,
    movingAverage, forecast, seasonality, pareto, segmentScan, binNumeric,
    strengthLabel, fmtNum, fmtPct, fmtP, fmtDate, noiseFloor,
  };
})(typeof window !== 'undefined' ? window : globalThis);
