# PrismaStudio v2 — Zero-Persistence Analytics

**Drop any spreadsheet → get a full analytical report. No AI, no uploads, no storage.**

Everything runs in the browser. The whole app is one 249 KB HTML file — no React, no ECharts, no CDN. GSAP is vendored inline, so animation works with the network unplugged. Open `PrismaStudio.html` by double-clicking it and it works, offline, forever.

---

## What changed in v2

The v1 report gave you a handful of cards regardless of what you fed it. On a 45-column auto-insurance file it found almost nothing, because it only knew how to do three things: correlate numeric pairs, fit a trend to a date column, and flag z-score outliers. A dataset that is mostly *categorical* — which describes most real business data — had nothing for it to say.

v2 adds the analysis that wide, category-heavy data actually needs.

| | v1 | v2 |
|---|---|---|
| Numeric ↔ numeric | Pearson r | Pearson r + Spearman ρ + p-values + r² + non-linearity detection + full matrix + scatter plots |
| **Category → metric** | *nothing* | **One-way ANOVA with η² effect sizes, F-statistics, per-group means/medians/spreads** |
| **Category ↔ category** | *nothing* | **Cramér's V + chi-square, with redundant-column detection** |
| **Segment analysis** | *nothing* | **Every category value ranked by size-adjusted deviation (z-score)** |
| Column profiling | row count, missing % | quartiles, P5/P95, skew, kurtosis, CV, entropy balance, histograms, concentration |
| Distribution shape | *nothing* | skew/volatility warnings with median-vs-mean guidance |
| Concentration | *nothing* | Pareto curves + 80% thresholds |
| Time series | linear fit | + moving average, day-of-week & month seasonality, momentum, volatility, partial-period trimming |
| Data quality | missing count | scored 0–100 with severity-ranked issues: dupes, constants, case-variant categories, skew |
| Interactivity | static | pivot/cross-tab builder, box plots by any group, custom scatter |
| Motion | none | GSAP-driven: bars grow, lines draw on, cells cascade, KPIs count up |
| Findings on the insurance sample | ~4 | **53** |

It also **withholds** conclusions that aren't supported. If a trend line explains under 15% of the movement, the projection is suppressed and replaced with an explanation, instead of printing a confident `+157%`.

---

## Quick start

```bash
npm run build     # bundle src/ → dist/index.html + PrismaStudio.html
npm run dev       # build, then serve at http://localhost:3000
npm test          # engine + edge-case suites (no browser needed)
npm run test:ui   # full browser test, screenshots to shots/
npm run test:anim # pivot overlap + animation behaviour
```

No `npm install` required to build — the bundler is plain Node with no dependencies. (`playwright` is only needed for `test:ui`.)

---

## Deploying to Vercel

**Why your deploy was failing:** the old `vercel.json` said

```json
"buildCommand": "npm run build --workspace=frontend",
"outputDirectory": "frontend/dist"
```

but there is no `frontend/` directory in the project, and the root `package.json` declared `"workspaces": ["frontend"]` pointing at the same missing folder. npm exits with `No workspaces found: --workspace=frontend`, the build fails, and Vercel serves an error page. The `functions` block also referenced `api/*.ts`, which doesn't exist either.

Both files are now corrected. To deploy:

1. Push this directory to GitHub.
2. In Vercel: **New Project → Import** the repo.
3. Framework Preset: **Other**. Leave Build Command and Output Directory blank — `vercel.json` sets them (`outputDirectory: "dist"`).
4. Deploy.

Or from the CLI:

```bash
npx vercel --prod
```

Since the output is a single static file, any host works — Netlify, GitHub Pages, S3, or an intranet file share. You can also skip hosting entirely and email `PrismaStudio.html` to someone; it runs from the filesystem.

---

## The analysis pipeline

1. **Parse** — CSV/TSV (delimiter auto-sniffed, RFC-4180 quoting) or XLSX. The XLSX reader unzips via the browser-native `DecompressionStream` and reads shared strings, number formats and date serials directly — no SheetJS.
2. **Header detection** — scans the first 8 rows and skips title/preamble lines, so exported reports with a title block parse correctly.
3. **Type inference** — date / currency / percent / number / boolean / category / id / text, with name-aware rules so `Zip Territory` becomes a category rather than a metric, and `Premium` becomes currency. Every type is overridable in the preview.
4. **Privacy guard** — health/PHI keyword scan runs *before* analysis; matching files are dropped from memory unedited. Override with a `No PHI` / `de-identified` declaration.
5. **Profile** — full descriptive statistics per column.
6. **Derive** — numeric columns are bucketed into quintiles so they can be tested as categorical drivers.
7. **Test** — ANOVA, correlations, Cramér's V, segment scan, Pareto, anomalies, seasonality, forecast.
8. **Narrate** — findings ranked by statistical strength, each with a plain-English "how to read this" note.

### Guards against nonsense

Real datasets create traps that naive tools fall into. These are handled explicitly:

- **Tautological drivers** — `Age Bracket` "explains" 99% of `Age` because it *is* Age. Detected by checking whether the groups occupy disjoint ranges of the metric, and excluded.
- **Duplicate findings** — `Age`, `Age Bracket` and `Age (quintile)` telling the same story three times are collapsed to one.
- **Duplicate columns** — perfectly correlated pairs (r > 0.999) are called out as copies rather than reported as a discovery.
- **Meaningless projections** — suppressed below R² 0.15, and baselined against the fitted trend rather than a single noisy last observation.
- **Partial trailing periods** — a final day with a third of the usual records is trimmed so it doesn't drag the trend down.
- **Small segments** — the segment scan uses z-scores, so a 3-row group needs a much larger gap than a 300-row group to rank.

---

## The nine tabs

**Findings** · ranked narrative insights + recommended next steps
**Drivers** · ANOVA table + per-driver breakdowns with bar charts
**Relationships** · correlation table, matrix, scatter plots, categorical associations
**Segments** · over/under-performing segments, Pareto curves, pivot builder
**Column profiles** · every column fully described with a histogram or top-values chart
**Trends** · time series, moving average, seasonality, forecast (or an explanation of why not)
**Data quality** · score breakdown, completeness chart, outlier table
**Explore** · pick any metric × any grouping; box plots and full statistics
**Data** · the parsed rows with detected types

Export produces a standalone HTML report with every tab expanded, styled, and self-contained.


---

## Animation

Charts are animated with **GSAP 3.12.5**, vendored into `src/vendor/` and inlined at build time — no CDN, so it still works offline and keeps `connect-src 'none'` honest.

Each chart type has its own entrance timeline, triggered by an `IntersectionObserver` when it scrolls into view (so nothing animates off-screen, and long tabs stay responsive):

| Chart | Motion |
|---|---|
| Horizontal bars | grow outward from the zero baseline, staggered |
| Histogram / Pareto | rise from the axis |
| Line & forecast | stroke-dashoffset draw-on, confidence band fades in behind |
| Scatter | points pop in from random order, then the fit line draws |
| Heatmap / pivot / matrix | cells cascade with a scale-up, values fade after |
| Donut | slices scale in with a slight overshoot |
| Box plot | whiskers extend, then boxes expand |
| KPIs | numeric count-up from zero |

Charts re-animate when their data changes — changing a pivot field or explorer metric replays the entrance rather than snapping.

Charts are revealed by an `IntersectionObserver`, which has two failure modes the code guards against explicitly:

- **Hidden tab panes.** Inactive tabs are `display:none`, so their contents have zero dimensions and the observer never reports them as intersecting. Registration is deferred until the pane is actually displayed (one frame after the tab is clicked, so layout has settled).
- **Scrolling past too fast.** Jumping straight to the bottom (End key, `scrollTo`, anchor link) can skip an element without ever firing an intersection. Anything scrolled past is revealed instantly, and a debounced scroll/resize sweep catches stragglers — so content can never be left permanently at `opacity: 0`.

**Accessibility:** every animation is gated behind `prefers-reduced-motion`. When a user has reduced motion enabled, `PrismaAnim.enabled` is `false`, all tweens are skipped, and content renders immediately at full opacity — verified in the test suite, since animation-on-reveal is a common way to accidentally hide content from people who disable motion.

### Rendering note

The pivot/cross-tab renders at **true pixel scale** (explicit `width`/`height`, not just a `viewBox`). Previously it drew into a small viewBox that CSS stretched to full width, magnifying text ~3.4× and colliding the rotated column headers. Now column headers stay horizontal when they fit and only rotate when they must, padding is measured from the actual longest label, and cell width is sized to the widest value it has to hold.

---

## Privacy

- No network calls. `connect-src 'none'` in the CSP makes this enforceable, not just a promise.
- No cookies, no analytics, no telemetry.
- `localStorage` holds one key: your theme choice.
- Data lives in a JS variable and dies when you close the tab or hit **Clear session**.
- Health/medical data is blocked before parsing.

## Project layout

```
src/anim.js        GSAP animation layer (scroll-reveal, per-chart timelines)
src/vendor/        GSAP 3.12.5, vendored for offline use
src/analysis.js    statistics engine (pure functions, no DOM)
src/insights.js    finding generation & narrative templates
src/charts.js      inline-SVG chart primitives
src/parse.js       CSV/XLSX parsing, ZIP inflate, PHI guard
src/app.js         UI shell, orchestration, rendering
src/styles.css     8 themes via CSS variables
src/shell.html     HTML skeleton
build.js           inlines everything into one file
test/              engine, edge-case and browser suites
```

## Browser support

Chrome/Edge 103+, Firefox 113+, Safari 16.4+ (needs `DecompressionStream` for XLSX; CSV works everywhere). Export your sheet as CSV if you're on something older.
