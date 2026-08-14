/* ============================================================
   PrismaStudio — Chart primitives (dependency-free inline SVG)
   Every chart returns an SVG string. Theme-aware via CSS vars.
   ============================================================ */
(function (global) {
  'use strict';
  const A = global.PrismaAnalysis;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const trunc = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));
  const PAL = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)', 'var(--c7)', 'var(--c8)'];

  function niceTicks(min, max, count = 5) {
    if (!isFinite(min) || !isFinite(max)) return [0, 1];
    if (min === max) { min = min - 1; max = max + 1; }
    const span = max - min;
    const step0 = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const norm = step0 / mag;
    const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
    const start = Math.floor(min / step) * step;
    const out = [];
    for (let v = start; v <= max + step * 0.5; v += step) out.push(+v.toFixed(10));
    // never emit ticks outside the plotted range — they render outside the axes
    const eps = step * 1e-6;
    return out.filter((v) => v >= min - eps && v <= max + eps);
  }

  /* ---------- horizontal bar chart (group comparison) ---------- */
  function barH(items, opts = {}) {
    const w = opts.width || 560, rowH = opts.rowH || 30, padL = opts.padL || 150, padR = 90, padT = 8;
    const n = items.length, h = n * rowH + padT + 26;
    const vals = items.map((i) => i.value);
    const max = Math.max(0, ...vals), min = Math.min(0, ...vals);
    const span = max - min || 1;
    const x = (v) => padL + ((v - min) / span) * (w - padL - padR);
    const zero = x(0);
    let s = `<svg viewBox="0 0 ${w} ${h}" class="chart" data-anim="barH" role="img">`;
    niceTicks(min, max, 4).forEach((t) => {
      s += `<line x1="${x(t).toFixed(1)}" y1="${padT}" x2="${x(t).toFixed(1)}" y2="${padT + n * rowH}" class="grid"/>`;
      s += `<text x="${x(t).toFixed(1)}" y="${padT + n * rowH + 16}" class="tick mid">${esc(A.fmtNum(t, { currency: opts.currency }))}</text>`;
    });
    items.forEach((it, i) => {
      const y = padT + i * rowH + 4, bh = rowH - 12;
      const x0 = Math.min(zero, x(it.value)), bw = Math.abs(x(it.value) - zero);
      const col = it.color || (it.value >= 0 ? 'var(--pos)' : 'var(--neg)');
      s += `<text x="${padL - 8}" y="${y + bh / 2 + 4}" class="lbl end" title="${esc(it.label)}">${esc(trunc(it.label, 22))}</text>`;
      s += `<rect data-bar="1" data-x="${x0.toFixed(1)}" data-w="${Math.max(1, bw).toFixed(1)}" data-zero="${zero.toFixed(1)}" x="${x0.toFixed(1)}" y="${y}" width="${Math.max(1, bw).toFixed(1)}" height="${bh}" rx="3" fill="${col}" opacity="0.88"><title>${esc(it.label)}: ${esc(A.fmtNum(it.value, { currency: opts.currency }))}${it.sub ? ' · ' + esc(it.sub) : ''}</title></rect>`;
      s += `<text data-val="1" x="${(x0 + bw + 6).toFixed(1)}" y="${y + bh / 2 + 4}" class="val">${esc(A.fmtNum(it.value, { currency: opts.currency }))}${it.sub ? `<tspan class="dim"> ${esc(it.sub)}</tspan>` : ''}</text>`;
    });
    s += `<line x1="${zero.toFixed(1)}" y1="${padT}" x2="${zero.toFixed(1)}" y2="${padT + n * rowH}" class="axis"/>`;
    return s + '</svg>';
  }

  /* ---------- histogram ---------- */
  function histogramChart(bins, opts = {}) {
    const w = opts.width || 520, h = opts.height || 180, padL = 46, padB = 30, padT = 10, padR = 10;
    if (!bins.length) return '';
    const maxC = Math.max(...bins.map((b) => b.count));
    const bw = (w - padL - padR) / bins.length;
    let s = `<svg viewBox="0 0 ${w} ${h}" class="chart" data-anim="bars">`;
    niceTicks(0, maxC, 4).forEach((t) => {
      const y = h - padB - (t / maxC) * (h - padB - padT);
      s += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${w - padR}" y2="${y.toFixed(1)}" class="grid"/><text x="${padL - 6}" y="${(y + 4).toFixed(1)}" class="tick end">${t}</text>`;
    });
    bins.forEach((b, i) => {
      const bh = maxC ? (b.count / maxC) * (h - padB - padT) : 0;
      s += `<rect data-bar="1" data-h="${bh.toFixed(1)}" data-y="${(h - padB - bh).toFixed(1)}" data-base="${(h - padB).toFixed(1)}" x="${(padL + i * bw + 0.8).toFixed(1)}" y="${(h - padB - bh).toFixed(1)}" width="${Math.max(1, bw - 1.6).toFixed(1)}" height="${bh.toFixed(1)}" fill="var(--c1)" opacity="0.8" rx="1.5"><title>${esc(A.fmtNum(b.x0, opts))} – ${esc(A.fmtNum(b.x1, opts))}: ${b.count} rows</title></rect>`;
    });
    s += `<line x1="${padL}" y1="${h - padB}" x2="${w - padR}" y2="${h - padB}" class="axis"/>`;
    s += `<text x="${padL}" y="${h - 8}" class="tick">${esc(A.fmtNum(bins[0].x0, opts))}</text>`;
    s += `<text x="${w - padR}" y="${h - 8}" class="tick end">${esc(A.fmtNum(bins[bins.length - 1].x1, opts))}</text>`;
    return s + '</svg>';
  }

  /* ---------- box plot row ---------- */
  function boxPlot(groups, opts = {}) {
    const w = opts.width || 560, rowH = 34, padL = 150, padR = 60, padT = 8;
    const h = groups.length * rowH + padT + 24;
    const all = groups.flatMap((g) => [g.min, g.max]);
    const min = Math.min(...all), max = Math.max(...all), span = max - min || 1;
    const x = (v) => padL + ((v - min) / span) * (w - padL - padR);
    let s = `<svg viewBox="0 0 ${w} ${h}" class="chart" data-anim="box">`;
    niceTicks(min, max, 4).forEach((t) => {
      s += `<line x1="${x(t).toFixed(1)}" y1="${padT}" x2="${x(t).toFixed(1)}" y2="${padT + groups.length * rowH}" class="grid"/><text x="${x(t).toFixed(1)}" y="${h - 6}" class="tick mid">${esc(A.fmtNum(t, opts))}</text>`;
    });
    groups.forEach((g, i) => {
      const cy = padT + i * rowH + rowH / 2;
      s += `<text x="${padL - 8}" y="${cy + 4}" class="lbl end">${esc(trunc(g.label, 22))}</text>`;
      s += `<line data-whisk="1" x1="${x(g.min).toFixed(1)}" y1="${cy}" x2="${x(g.max).toFixed(1)}" y2="${cy}" class="whisk"/>`;
      s += `<rect data-box="1" x="${x(g.q1).toFixed(1)}" y="${cy - 8}" width="${Math.max(1, x(g.q3) - x(g.q1)).toFixed(1)}" height="16" rx="2" fill="${PAL[i % PAL.length]}" opacity="0.55"/>`;
      s += `<line x1="${x(g.median).toFixed(1)}" y1="${cy - 9}" x2="${x(g.median).toFixed(1)}" y2="${cy + 9}" class="medline"/>`;
      s += `<title>${esc(g.label)} — median ${esc(A.fmtNum(g.median, opts))}, IQR ${esc(A.fmtNum(g.q1, opts))}–${esc(A.fmtNum(g.q3, opts))}, n=${g.n}</title>`;
    });
    return s + '</svg>';
  }

  /* ---------- scatter with fit line ---------- */
  function scatter(xs, ys, opts = {}) {
    const w = opts.width || 460, h = opts.height || 300, padL = 54, padB = 36, padT = 12, padR = 14;
    if (!xs.length) return '';
    const xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(...ys), ymax = Math.max(...ys);
    const X = (v) => padL + ((v - xmin) / (xmax - xmin || 1)) * (w - padL - padR);
    const Y = (v) => h - padB - ((v - ymin) / (ymax - ymin || 1)) * (h - padB - padT);
    let s = `<svg viewBox="0 0 ${w} ${h}" class="chart" data-anim="scatter">`;
    niceTicks(ymin, ymax, 4).forEach((t) => { s += `<line x1="${padL}" y1="${Y(t).toFixed(1)}" x2="${w - padR}" y2="${Y(t).toFixed(1)}" class="grid"/><text x="${padL - 6}" y="${(Y(t) + 4).toFixed(1)}" class="tick end">${esc(A.fmtNum(t, { currency: opts.yCurrency }))}</text>`; });
    niceTicks(xmin, xmax, 4).forEach((t) => { s += `<text x="${X(t).toFixed(1)}" y="${h - padB + 16}" class="tick mid">${esc(A.fmtNum(t, { currency: opts.xCurrency }))}</text>`; });
    // Points are drawn as a single <path> of tiny arcs rather than N <circle>
    // nodes. 900 circles cost ~250KB of DOM and 900 GSAP tweens; one path is a
    // few KB and animates as one object, which is what made this tab sluggish.
    // Cap the plotted sample so huge files stay interactive.
    const CAP = 2000;
    const step = xs.length > CAP ? Math.ceil(xs.length / CAP) : 1;
    const r = 2.6;
    let d = '';
    let plotted = 0;
    for (let i = 0; i < xs.length; i += step) {
      const cx = +X(xs[i]).toFixed(1), cy = +Y(ys[i]).toFixed(1);
      // two half-arcs = a full dot, in path syntax
      d += `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0`;
      plotted++;
    }
    s += `<path data-pts="1" d="${d}" fill="var(--c1)" opacity="0.45"/>`;
    const fit = A.linreg(xs, ys);
    s += `<line data-fit="1" x1="${X(xmin).toFixed(1)}" y1="${Y(fit.slope * xmin + fit.intercept).toFixed(1)}" x2="${X(xmax).toFixed(1)}" y2="${Y(fit.slope * xmax + fit.intercept).toFixed(1)}" class="fitline"/>`;
    s += `<text x="${w - padR}" y="${padT + 10}" class="tick end">R² = ${fit.r2.toFixed(2)}</text>`;
    if (step > 1) s += `<text x="${w - padR}" y="${padT + 24}" class="tick end">showing ${plotted.toLocaleString()} of ${xs.length.toLocaleString()} points</text>`;
    s += `<line x1="${padL}" y1="${h - padB}" x2="${w - padR}" y2="${h - padB}" class="axis"/><line x1="${padL}" y1="${padT}" x2="${padL}" y2="${h - padB}" class="axis"/>`;
    if (opts.xLabel) s += `<text x="${(w / 2).toFixed(0)}" y="${h - 4}" class="axlbl mid">${esc(opts.xLabel)}</text>`;
    if (opts.yLabel) s += `<text transform="translate(12 ${(h / 2).toFixed(0)}) rotate(-90)" class="axlbl mid">${esc(opts.yLabel)}</text>`;
    return s + '</svg>';
  }

  /* ---------- time series + forecast ---------- */
  function timeSeries(pts, ma, fc, opts = {}) {
    const w = opts.width || 900, h = opts.height || 320, padL = 62, padB = 40, padT = 16, padR = 18;
    if (!pts.length) return '';
    const allT = [...pts.map((p) => p.t), ...(fc ? fc.points.map((p) => p.t) : [])];
    const allV = [...pts.map((p) => p.value), ...(fc ? fc.points.flatMap((p) => [p.lower, p.upper]) : [])].filter(isFinite);
    const tmin = Math.min(...allT), tmax = Math.max(...allT);
    let vmin = Math.min(...allV), vmax = Math.max(...allV);
    const pad = (vmax - vmin) * 0.08 || 1; vmin -= pad; vmax += pad;
    const X = (t) => padL + ((t - tmin) / (tmax - tmin || 1)) * (w - padL - padR);
    const Y = (v) => h - padB - ((v - vmin) / (vmax - vmin || 1)) * (h - padB - padT);
    let s = `<svg viewBox="0 0 ${w} ${h}" class="chart" data-anim="line">`;
    niceTicks(vmin, vmax, 5).forEach((t) => { s += `<line x1="${padL}" y1="${Y(t).toFixed(1)}" x2="${w - padR}" y2="${Y(t).toFixed(1)}" class="grid"/><text x="${padL - 8}" y="${(Y(t) + 4).toFixed(1)}" class="tick end">${esc(A.fmtNum(t, { currency: opts.currency }))}</text>`; });
    const tickCount = Math.min(7, pts.length);
    for (let i = 0; i < tickCount; i++) {
      const t = tmin + ((tmax - tmin) * i) / (tickCount - 1 || 1);
      s += `<text x="${X(t).toFixed(1)}" y="${h - padB + 18}" class="tick mid">${new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })}</text>`;
    }
    if (fc && fc.points.length) {
      const up = fc.points.map((p) => `${X(p.t).toFixed(1)},${Y(p.upper).toFixed(1)}`).join(' ');
      const lo = fc.points.slice().reverse().map((p) => `${X(p.t).toFixed(1)},${Y(p.lower).toFixed(1)}`).join(' ');
      s += `<polygon data-band="1" points="${up} ${lo}" fill="var(--c3)" opacity="0.15"/>`;
      const last = pts[pts.length - 1];
      s += `<polyline data-fcline="1" points="${X(last.t).toFixed(1)},${Y(last.value).toFixed(1)} ${fc.points.map((p) => `${X(p.t).toFixed(1)},${Y(p.value).toFixed(1)}`).join(' ')}" fill="none" stroke="var(--c3)" stroke-width="2.2" stroke-dasharray="7 5"/>`;
    }
    s += `<polyline data-line="1" points="${pts.map((p) => `${X(p.t).toFixed(1)},${Y(p.value).toFixed(1)}`).join(' ')}" fill="none" stroke="var(--c1)" stroke-width="1.9" opacity="0.9"/>`;
    if (ma && ma.length) s += `<polyline data-line="1" points="${ma.map((p) => `${X(p.t).toFixed(1)},${Y(p.value).toFixed(1)}`).join(' ')}" fill="none" stroke="var(--c2)" stroke-width="2.2" opacity="0.95"/>`;
    (opts.anomalies || []).forEach((an) => { s += `<circle data-dot="1" cx="${X(an.t).toFixed(1)}" cy="${Y(an.value).toFixed(1)}" r="4.5" fill="var(--neg)" stroke="var(--surface)" stroke-width="1.5"><title>Outlier: ${esc(A.fmtNum(an.value, { currency: opts.currency }))}</title></circle>`; });
    s += `<line x1="${padL}" y1="${h - padB}" x2="${w - padR}" y2="${h - padB}" class="axis"/>`;
    return s + '</svg>';
  }

  /* ---------- heatmap / pivot ---------- */
  // Approximate text width in px for a given font-size (avg glyph ratio ~0.56 for Inter/system UI).
  const textW = (str, fontPx) => String(str).length * fontPx * 0.56;

  /* Rendered at true pixel scale so labels are never magnified by CSS stretching.
     Columns expand to fill the available container width. Rotated headers get a
     top pad derived from real trigonometry (label length x sin(angle)) plus the
     descender, so they can never bleed into the first row of cells. */
  function heatmap(ct, opts = {}) {
    const MAXR = 16, MAXC = 16;
    const rowKeys = ct.rowKeys.slice(0, MAXR), colKeys = ct.colKeys.slice(0, MAXC);
    if (!rowKeys.length || !colKeys.length) return '<p class="empty">Not enough data to build a cross-tab.</p>';

    const FS_LBL = 12, FS_CELL = 12;
    const rowLabels = rowKeys.map((r) => trunc(r, 26));
    const colLabels = colKeys.map((c) => trunc(c, 22));

    const vals = [];
    rowKeys.forEach((_, i) => colKeys.forEach((__, j) => {
      const v = ct.matrix[i][j]; if (v != null && isFinite(v)) vals.push(v);
    }));
    if (!vals.length) return '<p class="empty">No values to cross-tabulate for this combination.</p>';

    const widestVal = vals.map((v) => A.fmtNum(v, opts)).reduce((a, b) => (b.length > a.length ? b : a), '0');
    const minCellW = Math.ceil(textW(widestVal, FS_CELL)) + 22;

    const widestColLabel = colLabels.reduce((a, b) => (b.length > a.length ? b : a), '');
    const colLabelPx = textW(widestColLabel, FS_LBL);
    const padL = Math.min(240, Math.ceil(textW(rowLabels.reduce((a, b) => (b.length > a.length ? b : a), ''), FS_LBL)) + 18);

    // Available width inside the card (set by the caller); grow cells to fill it.
    const avail = Math.max(320, (opts.maxWidth || 900) - padL - 14);
    const fitCellW = Math.floor(avail / colKeys.length);

    // Headers stay horizontal whenever the label fits in the cell it labels.
    let cellW = Math.max(minCellW, Math.min(fitCellW, 260));
    const horizontal = colLabelPx + 14 <= cellW;
    if (!horizontal) cellW = Math.max(cellW, minCellW);

    const ROT = 45, rad = (ROT * Math.PI) / 180;
    // Vertical space a rotated label truly occupies, + font descender + breathing room.
    const padT = horizontal ? 30 : Math.min(190, Math.ceil(colLabelPx * Math.sin(rad)) + FS_LBL + 14);

    const cellH = 32, gap = 3, padR = 14, padB = 12;
    const w = padL + colKeys.length * cellW + padR;
    const h = padT + rowKeys.length * cellH + padB;

    const mn = Math.min(...vals), mx = Math.max(...vals);
    const t = (v) => (mx === mn ? 0.5 : (v - mn) / (mx - mn));

    let s = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="chart pivot" data-anim="heatmap" style="max-width:none">`;

    colLabels.forEach((c, j) => {
      const cx = padL + j * cellW + cellW / 2;
      if (horizontal) {
        s += `<text x="${cx.toFixed(1)}" y="${padT - 11}" class="lbl mid">${esc(c)}</text>`;
      } else {
        // Anchor the label's END at the top-centre of its column, rotated up-left.
        // Sitting 8px above the grid guarantees clearance for the whole glyph run.
        s += `<text transform="translate(${cx.toFixed(1)} ${(padT - 9).toFixed(1)}) rotate(-${ROT})" class="lbl end">${esc(c)}</text>`;
      }
    });

    rowKeys.forEach((r, i) => {
      const cy = padT + i * cellH;
      s += `<text x="${padL - 10}" y="${(cy + cellH / 2 + 4).toFixed(1)}" class="lbl end">${esc(rowLabels[i])}</text>`;
      colKeys.forEach((c, j) => {
        const v = ct.matrix[i][j];
        const x = padL + j * cellW, y = cy;
        const cw = cellW - gap, ch = cellH - gap;
        if (v == null) {
          s += `<rect x="${x}" y="${y}" width="${cw}" height="${ch}" rx="4" fill="var(--border)" opacity="0.22" data-cell="1"/>`;
          return;
        }
        const tv = t(v);
        const label = A.fmtNum(v, opts);
        s += `<g class="pcell"><rect x="${x}" y="${y}" width="${cw}" height="${ch}" rx="4" fill="var(--c1)" opacity="${(0.12 + tv * 0.8).toFixed(2)}" data-cell="1">` +
          `<title>${esc(r)} \u00d7 ${esc(c)}: ${esc(label)}</title></rect>` +
          `<text x="${(x + cw / 2).toFixed(1)}" y="${(y + ch / 2 + 4).toFixed(1)}" class="cellv mid" fill="${tv > 0.55 ? '#fff' : 'var(--text)'}" style="pointer-events:none">${esc(label)}</text></g>`;
      });
    });

    let note = '';
    if (ct.rowKeys.length > MAXR || ct.colKeys.length > MAXC) {
      note = `<p class="dim small">Showing ${rowKeys.length} of ${ct.rowKeys.length} row values and ${colKeys.length} of ${ct.colKeys.length} column values.</p>`;
    }
    return s + '</svg>' + note;
  }

  /* ---------- donut ---------- */
  function donut(items, opts = {}) {
    const size = opts.size || 240, r = size / 2 - 6, ir = r * 0.58, cx = size / 2, cy = size / 2;
    const total = items.reduce((s, i) => s + i.value, 0) || 1;
    let ang = -Math.PI / 2, s = `<svg viewBox="0 0 ${size} ${size}" class="chart" data-anim="donut">`;
    items.forEach((it, i) => {
      const frac = it.value / total, a2 = ang + frac * Math.PI * 2;
      const large = frac > 0.5 ? 1 : 0;
      const p = (rad, a) => `${(cx + rad * Math.cos(a)).toFixed(2)} ${(cy + rad * Math.sin(a)).toFixed(2)}`;
      s += `<path data-slice="1" d="M ${p(r, ang)} A ${r} ${r} 0 ${large} 1 ${p(r, a2)} L ${p(ir, a2)} A ${ir} ${ir} 0 ${large} 0 ${p(ir, ang)} Z" fill="${PAL[i % PAL.length]}" opacity="0.9"><title>${esc(it.label)}: ${esc(A.fmtNum(it.value, opts))} (${((frac) * 100).toFixed(1)}%)</title></path>`;
      ang = a2;
    });
    s += `<text x="${cx}" y="${cy - 2}" class="donutv mid">${esc(A.fmtNum(total, opts))}</text><text x="${cx}" y="${cy + 16}" class="tick mid">${esc(opts.centerLabel || 'total')}</text>`;
    s += '</svg>';
    if (opts.legend === false) return s;
    const legend = items.map((it, i) => {
      const pct = ((it.value / total) * 100).toFixed(1);
      return `<li><span class="sw" style="background:${PAL[i % PAL.length]}"></span>` +
        `<span class="lg-lbl">${esc(trunc(it.label, 22))}</span>` +
        `<span class="lg-val">${esc(A.fmtNum(it.value, opts))} <span class="dim">${pct}%</span></span></li>`;
    }).join('');
    return `<div class="donutwrap">${s}<ul class="legend">${legend}</ul></div>`;
  }

  /* ---------- correlation matrix ---------- */
  function corrMatrix(cols, getR, opts = {}) {
    const n = cols.length;
    const cell = Math.max(28, Math.min(52, 560 / Math.max(1, n)));
    const padL = 130, padT = 130;
    const w = padL + n * cell + 12, h = padT + n * cell + 12;
    let s = `<svg viewBox="0 0 ${w} ${h}" class="chart" data-anim="heatmap">`;
    cols.forEach((c, i) => {
      s += `<text transform="translate(${(padL + i * cell + cell / 2).toFixed(1)} ${padT - 8}) rotate(-45)" class="lbl end">${esc(trunc(c, 16))}</text>`;
      s += `<text x="${padL - 8}" y="${(padT + i * cell + cell / 2 + 4).toFixed(1)}" class="lbl end">${esc(trunc(c, 16))}</text>`;
    });
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const r = i === j ? 1 : getR(cols[i], cols[j]);
      const x = padL + j * cell, y = padT + i * cell;
      if (r == null || !isFinite(r)) { s += `<rect data-cell="1" x="${x}" y="${y}" width="${cell - 2}" height="${cell - 2}" rx="3" fill="var(--border)" opacity="0.2"/>`; continue; }
      const col = r >= 0 ? 'var(--pos)' : 'var(--neg)';
      s += `<rect data-cell="1" x="${x}" y="${y}" width="${cell - 2}" height="${cell - 2}" rx="3" fill="${col}" opacity="${(0.1 + Math.abs(r) * 0.85).toFixed(2)}"><title>${esc(cols[i])} ↔ ${esc(cols[j])}: r = ${r.toFixed(3)}</title></rect>`;
      if (cell >= 34) s += `<text x="${(x + cell / 2 - 1).toFixed(1)}" y="${(y + cell / 2 + 4).toFixed(1)}" class="cellv mid" fill="${Math.abs(r) > 0.6 ? '#fff' : 'var(--text)'}">${r.toFixed(2).replace('0.', '.')}</text>`;
    }
    return s + '</svg>';
  }

  /* ---------- pareto ---------- */
  function paretoChart(items, opts = {}) {
    const show = items.slice(0, 14);
    const w = opts.width || 700, h = 260, padL = 56, padB = 66, padT = 14, padR = 44;
    const max = Math.max(...show.map((i) => i.value)) || 1;
    const bw = (w - padL - padR) / show.length;
    const Y = (v) => h - padB - (v / max) * (h - padB - padT);
    const Y2 = (p) => h - padB - (p / 100) * (h - padB - padT);
    let s = `<svg viewBox="0 0 ${w} ${h}" class="chart" data-anim="bars">`;
    niceTicks(0, max, 4).forEach((t) => { s += `<line x1="${padL}" y1="${Y(t).toFixed(1)}" x2="${w - padR}" y2="${Y(t).toFixed(1)}" class="grid"/><text x="${padL - 6}" y="${(Y(t) + 4).toFixed(1)}" class="tick end">${esc(A.fmtNum(t, opts))}</text>`; });
    show.forEach((it, i) => {
      const bh = h - padB - Y(it.value);
      s += `<rect data-bar="1" data-h="${Math.max(1, bh).toFixed(1)}" data-y="${Y(it.value).toFixed(1)}" data-base="${(h - padB).toFixed(1)}" x="${(padL + i * bw + 3).toFixed(1)}" y="${Y(it.value).toFixed(1)}" width="${(bw - 6).toFixed(1)}" height="${Math.max(1, bh).toFixed(1)}" rx="3" fill="var(--c1)" opacity="0.85"><title>${esc(it.key)}: ${esc(A.fmtNum(it.value, opts))} (${it.share.toFixed(1)}%)</title></rect>`;
      s += `<text transform="translate(${(padL + i * bw + bw / 2).toFixed(1)} ${h - padB + 14}) rotate(-38)" class="lbl end">${esc(trunc(it.key, 14))}</text>`;
    });
    s += `<polyline points="${show.map((it, i) => `${(padL + i * bw + bw / 2).toFixed(1)},${Y2(it.cumShare).toFixed(1)}`).join(' ')}" fill="none" stroke="var(--c3)" stroke-width="2.2"/>`;
    show.forEach((it, i) => { s += `<circle cx="${(padL + i * bw + bw / 2).toFixed(1)}" cy="${Y2(it.cumShare).toFixed(1)}" r="3" fill="var(--c3)"><title>cumulative ${it.cumShare.toFixed(1)}%</title></circle>`; });
    s += `<line x1="${padL}" y1="${Y2(80).toFixed(1)}" x2="${w - padR}" y2="${Y2(80).toFixed(1)}" stroke="var(--c4)" stroke-width="1.2" stroke-dasharray="4 4"/><text x="${w - padR + 4}" y="${(Y2(80) + 4).toFixed(1)}" class="tick">80%</text>`;
    return s + '</svg>';
  }

  /* ---------- missingness bar ---------- */
  function missingness(profiles, opts = {}) {
    const items = profiles.map((p) => ({ label: p.name, value: 100 - p.missingPct, missing: p.missingPct }));
    const w = 560, rowH = 20, padL = 170, h = items.length * rowH + 20;
    let s = `<svg viewBox="0 0 ${w} ${h}" class="chart" data-anim="barH">`;
    items.forEach((it, i) => {
      const y = i * rowH + 8, bw = (w - padL - 60);
      s += `<text x="${padL - 8}" y="${y + 11}" class="lbl end">${esc(trunc(it.label, 24))}</text>`;
      s += `<rect x="${padL}" y="${y}" width="${bw}" height="13" rx="3" fill="var(--border)" opacity="0.5"/>`;
      s += `<rect data-bar="1" data-x="${padL}" data-w="${(bw * it.value / 100).toFixed(1)}" data-zero="${padL}" x="${padL}" y="${y}" width="${(bw * it.value / 100).toFixed(1)}" height="13" rx="3" fill="${it.missing > 20 ? 'var(--warn)' : 'var(--pos)'}" opacity="0.85"><title>${esc(it.label)}: ${it.value.toFixed(1)}% complete</title></rect>`;
      s += `<text x="${padL + bw + 6}" y="${y + 11}" class="val">${it.value.toFixed(0)}%</text>`;
    });
    return s + '</svg>';
  }

  global.PrismaCharts = { barH, histogramChart, boxPlot, scatter, timeSeries, heatmap, donut, corrMatrix, paretoChart, missingness, niceTicks, PAL };
})(typeof window !== 'undefined' ? window : globalThis);
