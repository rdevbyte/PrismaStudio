/* ============================================================
   PrismaStudio — Insight Engine (template-based, deterministic)
   Turns statistics into ranked, human-readable findings.
   ============================================================ */
(function (global) {
  'use strict';
  const A = global.PrismaAnalysis;
  const { fmtNum, fmtPct, fmtP, fmtDate } = A;

  const DOMAINS = [
    { id: 'insurance', label: 'Insurance / Actuarial', hits: ['premium', 'policy', 'claim', 'insured', 'deductible', 'underwriting', 'coverage', 'telematics', 'territory', 'peril', 'loss ratio', 'renewal'] },
    { id: 'finance', label: 'Finance / Accounting', hits: ['revenue', 'expense', 'invoice', 'balance', 'debit', 'credit', 'account', 'transaction', 'cash', 'profit', 'margin', 'budget'] },
    { id: 'sales', label: 'Sales / Commercial', hits: ['revenue', 'units', 'order', 'quantity', 'discount', 'customer', 'deal', 'pipeline', 'quota', 'churn', 'arr', 'mrr'] },
    { id: 'marketing', label: 'Marketing / Growth', hits: ['ad spend', 'impression', 'click', 'ctr', 'cpc', 'conversion', 'campaign', 'channel', 'roas', 'lead', 'traffic'] },
    { id: 'hr', label: 'HR / Workforce', hits: ['employee', 'salary', 'tenure', 'attrition', 'headcount', 'department', 'hire', 'performance rating', 'absence'] },
    { id: 'ops', label: 'Operations / Supply chain', hits: ['inventory', 'sku', 'warehouse', 'shipment', 'lead time', 'defect', 'downtime', 'throughput', 'supplier', 'fulfil'] },
    { id: 'realestate', label: 'Real estate / Property', hits: ['rent', 'property', 'tenant', 'occupancy', 'square', 'sqft', 'lease', 'valuation', 'mortgage'] },
    { id: 'education', label: 'Education', hits: ['student', 'grade', 'course', 'enrol', 'attendance', 'score', 'teacher', 'gpa'] },
  ];

  function detectDomain(columns) {
    const hay = columns.map((c) => c.toLowerCase()).join(' | ');
    let best = null;
    DOMAINS.forEach((d) => {
      const matched = d.hits.filter((h) => hay.includes(h));
      if (matched.length && (!best || matched.length > best.matched.length)) best = { ...d, matched };
    });
    return best;
  }

  // Recognised KPI patterns → orientation & meaning
  const KPI_LIB = [
    { re: /(loss ratio)/i, label: 'Loss ratio', better: 'lower', domain: 'Insurance', note: 'claims paid ÷ premium earned; under 100% means underwriting profit.' },
    { re: /(premium)/i, label: 'Premium', better: 'higher', domain: 'Insurance', note: 'price charged for coverage — the core revenue line.' },
    { re: /(claim.*(amount|paid|severity)|severity)/i, label: 'Claim severity', better: 'lower', domain: 'Insurance', note: 'average cost per claim.' },
    { re: /(claim.*(count|frequency|number)|accident freq)/i, label: 'Claim frequency', better: 'lower', domain: 'Insurance', note: 'claims per exposure unit.' },
    { re: /(lifetime value|clv|ltv)/i, label: 'Customer lifetime value', better: 'higher', domain: 'Customer', note: 'projected total value of a customer relationship.' },
    { re: /(conversion|win rate|close rate)/i, label: 'Conversion rate', better: 'higher', domain: 'Sales', note: 'share of quotes/leads that become customers.' },
    { re: /(churn|attrition|lapse)/i, label: 'Churn / lapse', better: 'lower', domain: 'Retention', note: 'share of customers leaving.' },
    { re: /(retention|renewal rate|loyalty)/i, label: 'Retention', better: 'higher', domain: 'Retention' },
    { re: /(revenue|sales|turnover|gross)/i, label: 'Revenue', better: 'higher', domain: 'Sales' },
    { re: /(profit|margin|net income|ebitda)/i, label: 'Profit / margin', better: 'higher', domain: 'Finance' },
    { re: /(cost|expense|spend|opex|cogs)/i, label: 'Cost', better: 'lower', domain: 'Finance' },
    { re: /(credit score|fico)/i, label: 'Credit score', better: 'higher', domain: 'Risk', note: 'a widely used rating input; higher generally means lower risk.' },
    { re: /(mileage|miles|distance)/i, label: 'Mileage / exposure', better: 'neutral', domain: 'Exposure', note: 'more exposure usually means more risk.' },
    { re: /(tenure|years as|years with|seniority)/i, label: 'Tenure', better: 'higher', domain: 'Customer' },
    { re: /(satisfaction|nps|csat|rating|score)/i, label: 'Satisfaction / rating', better: 'higher', domain: 'Experience' },
    { re: /(occupancy)/i, label: 'Occupancy', better: 'higher', domain: 'Property' },
    { re: /(defect|error|failure|downtime|complaint|violation|suspension)/i, label: 'Defects / violations', better: 'lower', domain: 'Quality' },
    { re: /(units|quantity|volume|count)/i, label: 'Volume', better: 'higher', domain: 'Operations' },
    { re: /(discount)/i, label: 'Discount', better: 'lower', domain: 'Pricing', note: 'higher discounting erodes realised price.' },
    { re: /(age)/i, label: 'Age', better: 'neutral', domain: 'Demographic' },
    { re: /(income|salary|wage)/i, label: 'Income', better: 'higher', domain: 'Demographic' },
  ];

  function classifyKPI(name) {
    for (const k of KPI_LIB) if (k.re.test(name)) return k;
    return null;
  }

  /* ---------- primary metric selection ---------- */
  const METRIC_PRIORITY = [
    /premium/i, /loss ratio/i, /revenue|sales|turnover/i, /profit|margin/i,
    /claim.*(amount|paid|severity)/i, /lifetime value|clv|ltv/i,
    /amount|total|value/i, /cost|expense|spend/i, /price/i, /score/i,
  ];
  function pickPrimaryMetric(profiles) {
    const cands = profiles.filter((p) => A.isNumericType(p.type) && p.values && p.values.length > 4 && !p.constant);
    if (!cands.length) return null;
    for (const re of METRIC_PRIORITY) {
      const hit = cands.find((p) => re.test(p.name));
      if (hit) return hit.name;
    }
    // fallback: currency column with most variance, else widest-range numeric
    const cur = cands.filter((p) => p.type === 'currency');
    const pool = cur.length ? cur : cands;
    return pool.slice().sort((a, b) => (b.cv || 0) - (a.cv || 0))[0].name;
  }

  /* ---------- narrative builders ---------- */
  function buildFindings(ctx) {
    const F = [];
    const { profiles, rows, driverResults, correlations, catAssoc, anomalies, quality, series, forecastResult, primaryMetric, paretoResults, segments, seasonal } = ctx;
    const push = (f) => F.push(f);

    /* --- drivers --- */
    // prioritise drivers of the headline metric, then everything else
    const primaryDrivers = driverResults.filter((d) => d.metric === primaryMetric).slice(0, 6);
    const otherDrivers = driverResults.filter((d) => d.metric !== primaryMetric).slice(0, 5);
    [...primaryDrivers, ...otherDrivers].forEach((d, i) => {
      const strong = d.eta2 >= 0.14, moderate = d.eta2 >= 0.06;
      const isCur = ctx.typeOf(d.metric) === 'currency';
      push({
        kind: 'driver',
        score: 100 * d.eta2 + (d.metric === primaryMetric ? 25 : 0) + (i === 0 ? 12 : 0) + (isFinite(d.p) && d.p < 0.05 ? 8 : 0),
        icon: strong ? '🎯' : '🔍',
        tone: strong ? 'strong' : moderate ? 'medium' : 'weak',
        title: `${d.driver} ${strong ? 'strongly shapes' : moderate ? 'moderately shapes' : 'slightly shapes'} ${d.metric}`,
        body: `Across ${d.levels.length} groups, <b>${d.driver}</b> explains <b>${(d.eta2 * 100).toFixed(1)}%</b> of the variation in ${d.metric} (η² = ${d.eta2.toFixed(3)}, ${fmtP(d.p)}). ` +
          `Highest: <b>${esc(d.top.key)}</b> at ${fmtNum(d.top.mean, { currency: isCur })} (n = ${d.top.n}, ${d.top.lift >= 0 ? '+' : ''}${d.top.lift.toFixed(0)}% vs average). ` +
          `Lowest: <b>${esc(d.bottom.key)}</b> at ${fmtNum(d.bottom.mean, { currency: isCur })} (n = ${d.bottom.n}). ` +
          `That is a spread of ${fmtNum(d.spread, { currency: isCur })} — ${Math.abs(d.spreadPct).toFixed(0)}% of the overall average.`,
        why: strong
          ? 'η² above 0.14 is a large effect by Cohen\'s convention — this field is worth segmenting or pricing on.'
          : moderate ? 'η² between 0.06 and 0.14 is a medium effect — real, but secondary to stronger drivers.'
            : 'η² below 0.06 is a small effect — treat as background noise unless the business context says otherwise.',
        data: d,
      });
    });

    /* --- correlations --- */
    correlations.slice(0, 8).forEach((c, i) => {
      const abs = Math.abs(c.r);
      push({
        kind: 'correlation',
        score: 70 * abs + (i === 0 ? 10 : 0) + (c.p < 0.05 ? 6 : 0),
        icon: '🔗',
        tone: abs >= 0.6 ? 'strong' : abs >= 0.4 ? 'medium' : 'weak',
        title: c.duplicate
          ? `${c.a} and ${c.b} are the same column twice`
          : `${c.a} ${c.r > 0 ? '↑ moves with ↑' : '↑ moves against ↓'} ${c.b}`,
        body: (c.duplicate ? `These two fields are perfectly correlated (r = ${c.r.toFixed(3)}), meaning one is a copy or a fixed rescaling of the other. Keep one and drop the other — carrying both double-counts the same information in every total and model. ` : '') +
          `Pearson r = <b>${c.r.toFixed(3)}</b> (${c.strength}, ${fmtP(c.p)}, n = ${c.n}). ` +
          `About <b>${(c.r * c.r * 100).toFixed(0)}%</b> of the movement in one is statistically shared with the other. ` +
          (c.nonlinear ? `Spearman ρ = ${c.rho.toFixed(3)} is notably higher than r — the relationship is real but <b>curved, not straight</b>, so a linear model will understate it. ` : '') +
          (c.p >= 0.05 ? 'Not statistically significant at the 5% level — could be chance. ' : ''),
        why: 'Correlation is not causation. Both fields may be driven by a third factor (e.g. size, season, or exposure).',
        data: c,
      });
    });

    /* --- categorical associations --- */
    catAssoc.slice(0, 5).forEach((c) => {
      push({
        kind: 'assoc',
        score: 45 * c.v,
        icon: '🧩',
        tone: c.v >= 0.4 ? 'strong' : c.v >= 0.2 ? 'medium' : 'weak',
        title: `${c.a} and ${c.b} overlap`,
        body: `Cramér's V = <b>${c.v.toFixed(3)}</b> (χ² = ${c.chi2.toFixed(1)}, ${fmtP(c.p)}, n = ${c.n}). ` +
          `Knowing ${c.a} tells you a meaningful amount about ${c.b}. ` +
          (c.v > 0.7 ? 'The overlap is so high the two fields may be near-duplicates — including both can double-count the same signal.' : ''),
        why: 'Cramér\'s V runs 0 (independent) to 1 (perfectly predictable). Above 0.25 is a substantive association.',
        data: c,
      });
    });

    /* --- segments --- */
    segments.slice(0, 6).forEach((s) => {
      if (Math.abs(s.z) < 2) return;
      const isCur = ctx.typeOf(primaryMetric) === 'currency';
      push({
        kind: 'segment',
        score: 12 * Math.min(6, Math.abs(s.z)),
        icon: s.lift > 0 ? '📈' : '📉',
        tone: Math.abs(s.z) >= 4 ? 'strong' : 'medium',
        title: `${s.column} = "${trunc(s.value, 28)}" runs ${s.lift > 0 ? 'hot' : 'cold'} on ${primaryMetric}`,
        body: `This segment covers <b>${s.n} rows</b> (${s.share.toFixed(1)}% of data) and averages <b>${fmtNum(s.mean, { currency: isCur })}</b> — ` +
          `<b>${s.lift >= 0 ? '+' : ''}${s.lift.toFixed(1)}%</b> versus the dataset average (z = ${s.z.toFixed(1)}). Median for the segment is ${fmtNum(s.median, { currency: isCur })}.`,
        why: '|z| above 2 means the gap is unlikely to be sampling noise given the segment size.',
        data: s,
      });
    });

    /* --- distribution shape --- */
    profiles.filter((p) => A.isNumericType(p.type) && p.values && p.values.length > 20).slice(0, 30).forEach((p) => {
      const isCur = p.type === 'currency';
      if (Math.abs(p.skew) > 1.5) {
        push({
          kind: 'distribution',
          score: 18 + Math.min(10, Math.abs(p.skew) * 2),
          icon: '🪃',
          tone: 'medium',
          title: `${p.name} is heavily ${p.skew > 0 ? 'right' : 'left'}-skewed`,
          body: `Mean ${fmtNum(p.mean, { currency: isCur })} vs median ${fmtNum(p.median, { currency: isCur })} (skew ${p.skew.toFixed(2)}). ` +
            `The top 5% sit above ${fmtNum(p.p95, { currency: isCur })} while the bottom 5% sit below ${fmtNum(p.p05, { currency: isCur })}. ` +
            `${p.skew > 0 ? 'A small number of large values is pulling the average up' : 'A tail of small values is pulling the average down'} — report the median instead.`,
          why: 'Skewed data breaks averages, and standard-deviation outlier rules over-flag the long tail.',
          data: p,
        });
      }
      if (p.cv > 1) {
        push({
          kind: 'distribution', score: 14, icon: '🌊', tone: 'medium',
          title: `${p.name} is highly volatile`,
          body: `Coefficient of variation is <b>${p.cv.toFixed(2)}</b> (σ = ${fmtNum(p.sd, { currency: isCur })} against a mean of ${fmtNum(p.mean, { currency: isCur })}). Values range ${fmtNum(p.min, { currency: isCur })} → ${fmtNum(p.max, { currency: isCur })}.`,
          why: 'CV above 1 means the spread exceeds the average — single-number summaries are misleading here.',
          data: p,
        });
      }
    });

    /* --- concentration --- */
    paretoResults.slice(0, 4).forEach((pr) => {
      if (pr.items.length < 3) return;
      const isCur = ctx.typeOf(pr.metric) === 'currency';
      push({
        kind: 'concentration',
        score: 20 + (pr.pct80 < 30 ? 15 : 0),
        icon: '🏔️',
        tone: pr.pct80 < 25 ? 'strong' : 'medium',
        title: `${pr.metric} is concentrated in a few ${pr.column} values`,
        body: `<b>${pr.countTo80}</b> of ${pr.items.length} ${pr.column} values (${pr.pct80.toFixed(0)}%) account for 80% of total ${pr.metric}. ` +
          `Top contributor <b>${esc(pr.items[0].key)}</b> alone holds ${pr.items[0].share.toFixed(1)}% (${fmtNum(pr.items[0].value, { currency: isCur })}).`,
        why: pr.pct80 < 25 ? 'A classic Pareto profile — concentration this tight is both an opportunity and a dependency risk.' : 'Moderate concentration; the base is reasonably diversified.',
        data: pr,
      });
    });

    /* --- trend & forecast --- */
    if (series && series.length > 6 && forecastResult) {
      const first = series[0], last = series[series.length - 1];
      const change = first.value ? ((last.value - first.value) / Math.abs(first.value)) * 100 : 0;
      const f = forecastResult.fit;
      const isCur = ctx.typeOf(primaryMetric) === 'currency';
      const end = forecastResult.points[forecastResult.points.length - 1];
      const noTrend = f.r2 < 0.15;
      push({
        kind: 'trend',
        score: noTrend ? 30 : 60 + f.r2 * 25,
        icon: noTrend ? '➖' : '📊',
        tone: f.r2 >= 0.5 ? 'strong' : f.r2 >= 0.2 ? 'medium' : 'weak',
        title: noTrend
          ? `${primaryMetric} has no reliable trend over ${ctx.dateCol}`
          : `${primaryMetric} is ${f.slope > 0 ? 'trending up' : f.slope < 0 ? 'trending down' : 'flat'} over time`,
        body: noTrend
          ? `A straight line through ${primaryMetric} against ${ctx.dateCol} explains just <b>${(f.r2 * 100).toFixed(1)}%</b> of the movement (R² = ${f.r2.toFixed(2)}), so there is no dependable direction to project. ` +
            `Values ran ${fmtNum(first.value, { currency: isCur })} on ${fmtDate(first.date)} to ${fmtNum(last.value, { currency: isCur })} on ${fmtDate(last.date)}, but the path between is essentially noise. ` +
            `This is normal when each row is an independent record (a policy, a customer, a transaction) rather than a measurement over time.`
          : `From ${fmtDate(first.date)} to ${fmtDate(last.date)}, ${primaryMetric} moved ${change >= 0 ? '+' : ''}${change.toFixed(1)}% ` +
            `(${fmtNum(first.value, { currency: isCur })} → ${fmtNum(last.value, { currency: isCur })}). ` +
            `The fitted line moves <b>${fmtNum(f.slope, { currency: isCur })} per day</b> with R² = <b>${f.r2.toFixed(2)}</b>. ` +
            `Extrapolated forward, the central estimate reaches ${fmtNum(end.value, { currency: isCur })} with a 95% band of ${fmtNum(end.lower, { currency: isCur })} → ${fmtNum(end.upper, { currency: isCur })}.`,
        why: noTrend
          ? 'Rather than show a misleading forecast, the projection is suppressed. Use the driver and segment analysis instead — that is where the signal is for this dataset.'
          : f.r2 < 0.3
            ? 'R² is low: the line explains little of the movement, so treat the projection as a weak reference, not a plan. The wide band reflects that.'
            : 'R² is respectable, but this is a straight-line extrapolation — it assumes nothing structural changes.',
        data: { fit: f },
      });
    }
    if (seasonal) {
      const dow = seasonal.dow.filter((d) => d.n >= 3).sort((a, b) => b.index - a.index);
      if (dow.length >= 5 && dow[0].index - dow[dow.length - 1].index > 25) {
        push({
          kind: 'seasonality', score: 30, icon: '🗓️', tone: 'medium',
          title: `Day-of-week pattern detected`,
          body: `<b>${dow[0].label}</b> runs at ${dow[0].index.toFixed(0)}% of the daily average while <b>${dow[dow.length - 1].label}</b> runs at ${dow[dow.length - 1].index.toFixed(0)}%. ` +
            `That is a ${(dow[0].index - dow[dow.length - 1].index).toFixed(0)}-point swing across the week.`,
          why: 'Weekly cycles inflate day-to-day comparisons — compare like-for-like weekdays or use a 7-day average.',
          data: seasonal,
        });
      }
    }

    /* --- period comparison: recent half vs prior half --- */
    if (series && series.length >= 8) {
      const isCur = ctx.typeOf(primaryMetric) === 'currency';
      const half = Math.floor(series.length / 2);
      const prior = series.slice(0, half).map((p) => p.value);
      const recent = series.slice(half).map((p) => p.value);
      const mp = A.mean(prior), mr = A.mean(recent);
      const chg = mp ? ((mr - mp) / Math.abs(mp)) * 100 : 0;
      if (Math.abs(chg) > 3) {
        push({
          kind: 'momentum', score: 48 + Math.min(18, Math.abs(chg) / 4), icon: mr > mp ? '🚀' : '🐢',
          tone: Math.abs(chg) > 25 ? 'strong' : 'medium',
          title: `Recent period is running ${chg >= 0 ? 'ahead of' : 'behind'} the earlier period`,
          body: `The most recent half of the timeline averages <b>${fmtNum(mr, { currency: isCur })}</b> per period versus <b>${fmtNum(mp, { currency: isCur })}</b> in the first half — a change of <b>${chg >= 0 ? '+' : ''}${chg.toFixed(1)}%</b>. ` +
            `Split point: ${fmtDate(series[half].date)}.`,
          why: 'Comparing equal halves is a quick check on whether a trend is genuinely accelerating or just noisy.',
          data: { mp, mr, chg },
        });
      }
      // best & worst periods
      const sorted = [...series].sort((a, b) => b.value - a.value);
      push({
        kind: 'extremes', score: 26, icon: '🏁', tone: 'medium',
        title: `Best and worst periods for ${primaryMetric}`,
        body: `Peak was <b>${fmtNum(sorted[0].value, { currency: isCur })}</b> on ${fmtDate(sorted[0].date)}; the low was <b>${fmtNum(sorted[sorted.length - 1].value, { currency: isCur })}</b> on ${fmtDate(sorted[sorted.length - 1].date)}. ` +
          `The peak is ${sorted[sorted.length - 1].value ? (sorted[0].value / Math.abs(sorted[sorted.length - 1].value)).toFixed(1) + '×' : 'far above'} the low. Typical period sits at ${fmtNum(A.median(series.map((p) => p.value)), { currency: isCur })}.`,
        why: 'Knowing the operating range tells you whether a given period is genuinely exceptional or within normal swing.',
        data: sorted,
      });
      // volatility of the series
      const vals = series.map((p) => p.value);
      const cv = A.mean(vals) ? A.sd(vals) / Math.abs(A.mean(vals)) : 0;
      const diffs = [];
      for (let i = 1; i < vals.length; i++) if (vals[i - 1]) diffs.push(Math.abs((vals[i] - vals[i - 1]) / Math.abs(vals[i - 1])) * 100);
      if (diffs.length) {
        push({
          kind: 'volatility', score: 24 + Math.min(14, cv * 20), icon: '🎢',
          tone: cv > 0.5 ? 'strong' : cv > 0.25 ? 'medium' : 'weak',
          title: `${primaryMetric} moves ${A.median(diffs).toFixed(1)}% between periods on average`,
          body: `Period-to-period swing has a median of <b>${A.median(diffs).toFixed(1)}%</b> and the series coefficient of variation is <b>${cv.toFixed(2)}</b>. ` +
            `${cv > 0.5 ? 'That is a highly unstable series — single-period comparisons are close to meaningless.' : cv > 0.25 ? 'Moderately variable; use multi-period averages when comparing.' : 'The series is relatively stable, so period comparisons are meaningful.'}`,
          why: 'Volatility sets the bar for what counts as a real change versus normal fluctuation.',
          data: { cv },
        });
      }
    }

    /* --- categorical composition (matters when there are no numerics) --- */
    profiles.filter((p) => p.type === 'category' && p.counts && p.counts.length > 1).slice(0, 12).forEach((p) => {
      const dominant = p.topShare > 60;
      const balanced = p.balance > 0.9;
      push({
        kind: 'composition',
        score: 16 + (dominant ? 12 : 0) + (p.rare > 0 ? 4 : 0) + (F.filter((x) => x.kind === 'driver').length ? 0 : 10),
        icon: '🍩',
        tone: dominant ? 'medium' : 'weak',
        title: dominant
          ? `${p.name} is dominated by “${trunc(p.counts[0][0], 24)}”`
          : balanced ? `${p.name} is evenly spread across ${p.unique} values`
            : `${p.name} splits into ${p.unique} groups`,
        body: `Top values: ${p.top.slice(0, 4).map((t) => `<b>${esc(trunc(t.key, 20))}</b> ${t.pct.toFixed(1)}%`).join(', ')}. ` +
          `Distribution balance is ${(p.balance * 100).toFixed(0)}% of maximum evenness` +
          (p.rare ? `, and ${p.rare} value${p.rare === 1 ? ' appears' : 's appear'} only once` : '') + '. ' +
          (dominant ? 'One group carries most of the file, so overall averages mostly describe that group.' : ''),
        why: 'Composition determines how much any group-level comparison can be trusted — thin groups give unstable numbers.',
        data: p,
      });
    });

    /* --- anomalies --- */
    if (anomalies.length) {
      const high = anomalies.filter((a) => a.severity === 'high');
      const top = anomalies[0];
      push({
        kind: 'anomaly',
        score: 40 + Math.min(20, anomalies.length),
        icon: '⚠️',
        tone: high.length ? 'strong' : 'medium',
        title: `${anomalies.length} outlier${anomalies.length === 1 ? '' : 's'} flagged${high.length ? ` (${high.length} extreme)` : ''}`,
        body: isFinite(top.z)
          ? `Largest: <b>${top.column}</b> = ${fmtNum(top.value)} on row ${top.row}, which is <b>${Math.abs(top.z).toFixed(1)}σ ${top.direction}</b> the column mean (typical value ${fmtNum(top.expected)}). Detected by ${top.method}.`
          : `Includes rare category values that appear only once.`,
        why: 'Outliers are flagged where |z| ≥ 3 or a value falls outside the 1.5×IQR fence. They can be genuine extremes, data-entry errors, or unit mismatches — check before excluding.',
        data: anomalies,
      });
    }

    /* --- headline metric shape (always present when a metric exists) --- */
    if (primaryMetric) {
      const p = ctx.byName[primaryMetric];
      if (p && p.values && p.values.length > 4) {
        const isCur = p.type === 'currency';
        const top10 = [...p.values].sort((a, b) => b - a).slice(0, Math.max(1, Math.ceil(p.values.length * 0.1)));
        const top10Share = p.sum ? (A.sum(top10) / p.sum) * 100 : 0;
        push({
          kind: 'metric', score: 55, icon: '💠', tone: 'strong',
          title: `${primaryMetric} at a glance`,
          body: `Across ${p.values.length.toLocaleString()} values: total <b>${fmtNum(p.sum, { currency: isCur })}</b>, average <b>${fmtNum(p.mean, { currency: isCur })}</b>, median <b>${fmtNum(p.median, { currency: isCur })}</b>. ` +
            `The middle 50% falls between ${fmtNum(p.q1, { currency: isCur })} and ${fmtNum(p.q3, { currency: isCur })}. ` +
            `The top 10% of rows account for <b>${top10Share.toFixed(1)}%</b> of the total` +
            (p.zeroCount ? `, and ${p.zeroCount} row${p.zeroCount === 1 ? '' : 's'} sit at zero` : '') +
            (p.negCount ? `, with ${p.negCount} negative value${p.negCount === 1 ? '' : 's'}` : '') + '.',
          why: top10Share > 40
            ? 'When the top decile holds this much of the total, headline averages describe a minority of rows — segment before drawing conclusions.'
            : 'The total is reasonably spread across rows, so averages are representative.',
          data: p,
        });
      }
    }

    /* --- range / scale notes for other numerics --- */
    const otherNums = profiles.filter((p) => A.isNumericType(p.type) && p.name !== primaryMetric && p.values && p.values.length > 10);
    if (otherNums.length) {
      const widest = otherNums.slice().sort((a, b) => (b.cv || 0) - (a.cv || 0))[0];
      if (widest && widest.cv > 0.35) {
        const isCur = widest.type === 'currency';
        push({
          kind: 'metric', score: 20, icon: '📏', tone: 'weak',
          title: `${widest.name} spans a wide range`,
          body: `Values run from ${fmtNum(widest.min, { currency: isCur })} to ${fmtNum(widest.max, { currency: isCur })}, median ${fmtNum(widest.median, { currency: isCur })} (CV ${widest.cv.toFixed(2)}). ${widest.unique.toLocaleString()} distinct values across ${widest.complete.toLocaleString()} rows.`,
          why: 'Wide-ranging fields are good candidates for bucketing — the report already tests their quintiles as drivers.',
          data: widest,
        });
      }
    }

    /* --- no-signal notice --- */
    if (!driverResults.length && !correlations.length && rows.length > 50) {
      const nf = ctx.noise || {};
      const nDrivers = (ctx.driverAll || []).length, nPairs = (ctx.correlationsAll || []).length;
      push({
        kind: 'nosignal', score: 95, icon: '🔍', tone: 'strong',
        title: 'No relationships detected — the columns appear independent',
        body: `Tested <b>${nDrivers.toLocaleString()}</b> driver/metric combinations and <b>${nPairs.toLocaleString()}</b> numeric pairs across ${rows.length.toLocaleString()} rows. ` +
          `Nothing exceeded the noise floor: the largest correlation was |r| = ${(ctx.correlationsAll && ctx.correlationsAll[0] ? Math.abs(ctx.correlationsAll[0].r) : 0).toFixed(3)} against a chance threshold of ${(nf.r || 0.03).toFixed(3)}, ` +
          `and the largest η² was ${((ctx.driverAll && ctx.driverAll[0] ? ctx.driverAll[0].eta2 : 0) * 100).toFixed(2)}%. ` +
          `The analysis completed correctly — there is genuinely no structure in this data to find.`,
        why: 'Randomly generated data has independent columns by construction, so every test returns a null result. Column profiles, distributions and data-quality checks below are still fully valid.',
        data: null,
      });
    }

    /* --- quality --- */
    if (quality.issues.length) {
      const high = quality.issues.filter((i) => i.sev === 'high');
      push({
        kind: 'quality',
        score: 35 + high.length * 5,
        icon: '🧪',
        tone: quality.score < 70 ? 'strong' : quality.score < 90 ? 'medium' : 'weak',
        title: `Data quality scores ${quality.score}/100`,
        body: `${quality.issues.length} issue${quality.issues.length === 1 ? '' : 's'} found` +
          (high.length ? `, including ${high.length} severe: ${high.slice(0, 2).map((i) => `<b>${esc(i.col)}</b> — ${esc(i.msg)}`).join('; ')}` : '.') +
          (quality.dupRows ? ` ${quality.dupRows} duplicate rows will double-count in every total.` : ''),
        why: 'Quality issues propagate into every statistic below — fix them first if the numbers will drive a decision.',
        data: quality,
      });
    }

    // Suppress near-duplicate findings: a raw field and its derived quintile
    // often tell the identical story. Keep the higher-scoring one.
    F.sort((a, b) => b.score - a.score);
    const seen = new Set(), kept = [];
    // strip derived-bucket suffixes so "Age", "Age Bracket" and "Age (quintile)" collapse together
    const norm = (s) => String(s).toLowerCase()
      .replace(/\s*\((quintile|quartile|decile|bucket|bin|band)\)\s*/g, '')
      .replace(/\s+(bracket|band|range|tier|group|category|bucket|bin|level)s?$/g, '')
      .trim();
    for (const f of F) {
      let key = null;
      if (f.kind === 'driver') key = `driver:${norm(f.data.driver)}:${norm(f.data.metric)}`;
      else if (f.kind === 'segment') key = `segment:${norm(f.data.column)}:${Math.round(f.data.lift)}:${f.data.n}`;
      if (key) { if (seen.has(key)) continue; seen.add(key); }
      kept.push(f);
    }
    return kept;
  }

  /* ---------- executive summary ---------- */
  function buildSummary(ctx) {
    const { profiles, rows, columns, domain, primaryMetric, driverResults, correlations, quality, series, forecastResult, findings } = ctx;
    const parts = [];
    const numCount = profiles.filter((p) => A.isNumericType(p.type)).length;
    const catCount = profiles.filter((p) => A.isGroupable(p.type)).length;
    const dateCount = profiles.filter((p) => p.type === 'date').length;

    parts.push(`This dataset holds <b>${rows.length.toLocaleString()} rows</b> across <b>${columns.length} columns</b> — ${numCount} numeric, ${catCount} categorical${dateCount ? `, ${dateCount} date` : ''}.`);
    if (domain) parts.push(`The column names read as <b>${domain.label}</b> data (matched on ${domain.matched.slice(0, 4).map((m) => `“${m}”`).join(', ')}), so the report is framed around that.`);

    if (primaryMetric) {
      const p = profiles.find((x) => x.name === primaryMetric);
      const isCur = p.type === 'currency';
      parts.push(`The headline metric is <b>${primaryMetric}</b>: average ${fmtNum(p.mean, { currency: isCur })}, median ${fmtNum(p.median, { currency: isCur })}, spanning ${fmtNum(p.min, { currency: isCur })} to ${fmtNum(p.max, { currency: isCur })}.`);
    }
    const headlineDrivers = driverResults.filter((d) => d.metric === primaryMetric);
    const d = headlineDrivers[0] || driverResults[0];
    if (d) {
      parts.push(`The single strongest lever on ${d.metric} is <b>${d.driver}</b>, explaining <b>${(d.eta2 * 100).toFixed(1)}%</b> of its variation — the gap between “${esc(d.top.key)}” and “${esc(d.bottom.key)}” is ${fmtNum(d.spread, { currency: ctx.typeOf(d.metric) === 'currency' })}.`);
      if (headlineDrivers.length > 1) {
        parts.push(`Next in line: ${headlineDrivers.slice(1, 4).map((x) => `<b>${esc(x.driver)}</b> (${(x.eta2 * 100).toFixed(1)}%)`).join(', ')}.`);
      }
    }
    if (correlations.length) {
      const c = correlations[0];
      parts.push(`The tightest numeric pairing is <b>${c.a} ↔ ${c.b}</b> (r = ${c.r.toFixed(2)}).`);
    }
    if (series && forecastResult) {
      const f = forecastResult.fit;
      parts.push(f.r2 < 0.15
        ? `Over time ${primaryMetric} shows <b>no meaningful trend</b> (R² = ${f.r2.toFixed(2)}) — this data is cross-sectional rather than a time series, so no projection is offered.`
        : `Over time ${primaryMetric} is ${f.slope > 0 ? 'rising' : 'falling'} with R² = ${f.r2.toFixed(2)}${f.r2 < 0.3 ? ' — weak, so the projection is indicative only' : ''}.`);
    }
    // Be explicit when the analysis ran but found nothing, rather than staying
    // silent and letting the report look broken.
    const noSignal = !driverResults.length && !correlations.length;
    if (noSignal && rows.length > 50) {
      const nf = ctx.noise || {};
      parts.push(`<b>No statistically meaningful relationships were found in this file.</b> Every column pair and grouping was tested; the strongest effects sit at the level random noise produces for ${rows.length.toLocaleString()} rows (|r| under ${(nf.r || 0.03).toFixed(3)}). That is the signature of independently generated values — common in synthetic or randomly generated test data.`);
    }
    parts.push(`Data quality scores <b>${quality.score}/100</b>${quality.issues.length ? ` with ${quality.issues.length} flagged issue${quality.issues.length === 1 ? '' : 's'}` : ' with no issues detected'}. ${findings.length} findings were generated below.`);
    return parts.join(' ');
  }

  /* ---------- recommended next steps ---------- */
  function buildActions(ctx) {
    const acts = [];
    const { driverResults, correlations, quality, profiles, primaryMetric, catAssoc, anomalies } = ctx;
    if (quality.score < 85) acts.push({ icon: '🧹', text: `Clean first: data quality is ${quality.score}/100. Resolve missing values and duplicate rows before trusting any total.` });
    const primaryFirst = [...driverResults.filter((d) => d.metric === primaryMetric), ...driverResults.filter((d) => d.metric !== primaryMetric)];
    if (primaryFirst.length) {
      const d = primaryFirst[0];
      acts.push({ icon: '🎯', text: `Segment by <b>${d.driver}</b>. It explains ${(d.eta2 * 100).toFixed(0)}% of ${d.metric} variation — the biggest single split available in this file.` });
    }
    if (primaryFirst.length > 2) {
      const combo = primaryFirst.slice(0, 2).map((d) => d.driver);
      if (combo[0] !== combo[1]) acts.push({ icon: '🔬', text: `Cross <b>${combo[0]}</b> with <b>${combo[1]}</b> in the pivot below — the two strongest drivers often interact and the combined cell may beat either alone.` });
    }
    const dupPair = catAssoc.find((c) => c.v > 0.7);
    if (dupPair) acts.push({ icon: '✂️', text: `<b>${dupPair.a}</b> and <b>${dupPair.b}</b> are ${(dupPair.v * 100).toFixed(0)}% redundant (Cramér's V ${dupPair.v.toFixed(2)}). Drop one before modelling to avoid double-counting.` });
    const weak = correlations.filter((c) => c.p >= 0.05).length;
    if (weak) acts.push({ icon: '⚖️', text: `${weak} correlation${weak === 1 ? '' : 's'} fail the 5% significance test — don't build a story on them without more data.` });
    if (anomalies.filter((a) => a.severity === 'high').length) acts.push({ icon: '🔎', text: `Review the ${anomalies.filter((a) => a.severity === 'high').length} extreme outliers individually — at 4σ+ they are usually errors or genuinely special cases, and either way they distort averages.` });
    const constants = profiles.filter((p) => p.constant && p.complete > 0);
    if (constants.length) acts.push({ icon: '🗑️', text: `${constants.length} column${constants.length === 1 ? '' : 's'} (${constants.slice(0, 3).map((c) => c.name).join(', ')}) hold a single value — remove them to reduce noise.` });
    const nonlin = correlations.find((c) => c.nonlinear);
    if (nonlin) acts.push({ icon: '📐', text: `<b>${nonlin.a} ↔ ${nonlin.b}</b> is non-linear (Spearman beats Pearson). Try a log or rank transform before fitting a model.` });
    if (!acts.length) acts.push({ icon: '✅', text: 'No blocking issues found — the dataset is clean and the relationships above are the substantive story.' });
    return acts;
  }

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const trunc = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));

  global.PrismaInsights = { detectDomain, classifyKPI, pickPrimaryMetric, buildFindings, buildSummary, buildActions, esc, trunc, DOMAINS };
})(typeof window !== 'undefined' ? window : globalThis);
