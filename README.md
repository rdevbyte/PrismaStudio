# TabulaMetrics v2 — Zero-Persistence Analytics

**Drop a spreadsheet → get an exploratory report. No AI, no file upload, no app-managed dataset storage.**

TabulaMetrics parses and analyzes CSV/TSV/XLSX in your browser. The generated standalone app is about **565 KiB** (`TabulaMetrics.html` or `dist/index.html`), with its CSS, JavaScript, worker, and animation library inline. Google Sans is loaded from Google Fonts when a network is available; the app falls back to system sans-serif fonts offline. No analytics or data-analysis services are called; the external font request is only for typography.

“Zero persistence” describes the app's handling of the dataset: contents and analysis stay in page/worker memory unless you explicitly export a report. The app stores only the selected theme in browser `localStorage`. If you use a hosted copy, the hosting provider still receives the normal request for the app and may process or log request metadata; see [PRIVACY.md](PRIVACY.md) and the provider's policy.

---

## Color themes

Choose among four persistent palettes from the toolbar: **Daylight** pairs warm ivory with deep teal and clay; **Sandstone** uses parchment, terracotta, and olive; **Ember** combines charcoal with copper and amber; **Burgundy** pairs deep aubergine surfaces with warm gold and lilac accents. Daylight and Sandstone are light modes; Ember and Burgundy are dark. The labeled native picker works with a keyboard or screen reader; each palette coordinates chart, surface, focus, status, and supplied-logo colors. Theme preference is stored locally; dataset contents are not.

---

## What changed in v2

The v1 report had little to say about category-heavy business datasets. v2 adds category analysis, segments, richer profiling, more careful inference, and interactive exploration.

| Area | v1 | v2 |
|---|---|---|
| Numeric ↔ numeric | Pearson r | Pearson r + Spearman ρ, p-values, BH adjustment, r², non-linearity hints, matrix and scatter plots |
| **Category → metric** | *nothing* | **One-way ANOVA with η² and bias-adjusted ω², group summaries, and false-discovery-rate adjustment** |
| **Category ↔ category** | *nothing* | **Cramér's V; chi-square p-values are withheld when expected counts are too sparse; eligible comparisons are adjusted** |
| **Segment analysis** | *nothing* | **Welch tests comparing each segment with the remaining usable rows, with BH-adjusted p-values** |
| Column profiling | row count, missing % | quartiles, P5/P95, skew, kurtosis, CV, entropy balance, histograms, concentration |
| Distribution shape | *nothing* | skew/volatility warnings with median-vs-mean guidance |
| Concentration | *nothing* | Pareto curves + 80% thresholds |
| Time series | linear fit | moving average, coverage-aware day/month seasonality, momentum, volatility, partial-period trimming |
| Data quality | missing count | scored 0–100 with severity-ranked issues: duplicates, constants, case-variant categories, skew |
| Interactivity | static | pivot/cross-tab builder, box plots by group, custom scatter |
| Motion | none | GSAP-driven: bars grow, lines draw on, cells cascade, KPIs count up |
| Findings | fixed/small set | dataset-dependent; tested counts and no-signal caveats are shown where applicable |

Statistical results are exploratory. Adjustment reduces false discoveries across tested comparisons, but does not prove an association is important, causal, or stable in new data. A non-significant result does not prove independence. Weak linear trends do not produce a confident projection.

---

## Quick start

```bash
node build.js       # bundle src/ → dist/index.html + TabulaMetrics.html
npm run dev         # build, then serve at http://localhost:3000
npm test            # engine, edge, guard and regression suites; no browser needed
```

No `npm install` is required to build or run the static app; the build uses plain Node.js (18+). Playwright is a pinned development dependency for browser tests only. To run those tests, install dependencies and Chromium once:

```bash
npm install
npx playwright install chromium
npm run test:ui     # browser UI, layout, PHI-gate and no-signal suites
npm run test:anim   # animation and pivot browser checks
```

Playwright may also need operating-system browser libraries on a fresh Linux machine; see its installation instructions if Chromium reports missing dependencies.

---

## Deploying to Vercel

The build is a static single-file app. `vercel.json` runs `node build.js` and publishes `dist/`; no serverless functions, runtime packages, or npm install are needed for deployment. To deploy:

1. Push this directory to GitHub.
2. In Vercel: **New Project → Import** the repo.
3. Framework Preset: **Other**. Leave Build Command and Output Directory blank so `vercel.json` supplies `node build.js` and `dist`.
4. Deploy.

Or from the CLI:

```bash
npx vercel --prod
```

Any static host can serve the generated `dist/index.html`. The deploy config sets response security headers, including a restrictive Content Security Policy. A hosted page necessarily involves a request to that host; it does not mean the app uploads the user's spreadsheet. Hosting-provider access logs and retention are outside this repository's control. See [DEPLOY.md](DEPLOY.md) and [PRIVACY.md](PRIVACY.md).

---

## The analysis pipeline

1. **Parse** — CSV/TSV (delimiter auto-sniffed, quoted fields supported) or XLSX/XLSM. The XLSX reader uses browser-native `DecompressionStream`, reads the first available worksheet in workbook relationship order, and handles shared strings, number formats and date serials without SheetJS. Import is limited to 50 MiB, 100,000 rows, 200 columns, 1,000,000 cells and 1,000,000 characters per field; expanded XLSX XML is capped at 100 MiB.
2. **Header detection** — scans up to the first 8 rows and skips likely title/preamble lines.
3. **Type inference** — date / currency / percent / number / boolean / category / id / text, with name-aware rules so `Zip Territory` is a category rather than a metric. Types can be changed in the preview.
4. **Sensitive-data heuristic** — files are first read and parsed in browser memory; a local clinical-term heuristic then runs before statistical analysis. Some matches gate analysis behind explicit confirmation. It can miss sensitive data or flag ordinary data; it is **not** a PHI detector, de-identification check, or security boundary. The attestation is not verification or legal authorization. See [PRIVACY.md](PRIVACY.md) and [LEGAL-NOTES.md](LEGAL-NOTES.md).
5. **Profile** — descriptive statistics per column.
6. **Derive** — eligible numeric columns may be bucketed into quintiles so they can be tested as categorical drivers.
7. **Test** — ANOVA, numeric correlations, Cramér's V, Welch segment comparisons, Pareto, anomalies, seasonality and forecast. Benjamini–Hochberg adjustment is applied within the relevant test families; sparse categorical tables do not receive an asymptotic chi-square p-value.
8. **Narrate** — findings are ranked and paired with plain-English interpretation and limitations.

### Guards against nonsense

- **Tautological drivers** — groupings whose metric ranges are essentially disjoint (such as age bands explaining the age values used to create them) are excluded from driver tests.
- **Near-duplicate findings** — the narrative suppresses some duplicate raw-field/derived-bin findings; detailed driver tables can still show related groupings separately.
- **Near-duplicate numeric fields** — correlations above 0.999 are called out as possible duplicates or fixed rescalings, not automatically treated as proof of duplication.
- **Meaningless projections** — forecasts are suppressed below the configured R² threshold and compared against the fitted trend rather than a single noisy observation.
- **Partial trailing periods** — a final period with far fewer records than typical may be trimmed so it does not distort the trend.
- **Small segments** — each eligible segment is compared with the remaining rows, subject to minimum-size rules; p-values are BH-adjusted over the scan.

---

## The nine tabs

- **Findings** · ranked narrative insights + recommended next steps
- **Drivers** · ANOVA table + per-driver breakdowns with bar charts
- **Relationships** · numeric correlations, matrix, scatter plots and categorical associations
- **Segments** · segment comparisons, Pareto curves and pivot builder
- **Column profiles** · statistics with a histogram or top-values chart
- **Trends** · time series, moving average, seasonality and forecast (or an explanation of why not)
- **Data quality** · score breakdown, completeness chart and outlier table
- **Explore** · choose a metric × grouping for summaries and box plots
- **Data** · parsed rows with detected types (first 200 shown)

Export creates a standalone HTML report with expanded tabs. The report includes analysis results and a preview of up to 200 data rows; treat it as sensitive if the source data is sensitive. Export is a user-initiated local download, not an upload.

---

## Typography

The entire interface—including headings, body copy, buttons, labels, numeric readouts, chart labels, and exported reports—uses Google Sans from the Google Fonts CSS2 stylesheet, with tabular numerals for aligned values. When offline or when Google Fonts is unavailable, the app falls back to Roboto, Arial, and the system sans-serif. Google receives ordinary font-resource request metadata when the stylesheet/font files are fetched; spreadsheet contents and analysis results are not part of those requests.

## Animation

Charts use vendored GSAP 3.12.5, inlined at build time; no CDN is required. Animations are gated by `prefers-reduced-motion`. Off-screen and hidden-tab charts are revealed when appropriate, and the test suite checks that reduced-motion users still see the content.

The pivot/cross-tab uses explicit pixel dimensions rather than stretching a small SVG viewBox, to keep text and rotated column headers legible. Changing a pivot field or explorer metric redraws the chart.

---

## Privacy and security notes

- The app parses and analyzes files in the browser; it has no upload endpoint and no application API calls. Its CSP sets `connect-src 'none'`.
- Application code includes no analytics, telemetry, third-party runtime scripts, or tracking cookies. Google Fonts is requested only to render Google Sans; Google may receive ordinary font-request metadata, but the app does not send it spreadsheet contents or analysis results. The only app-managed persistent browser value is the selected theme (`tabulametrics-theme` in `localStorage`).
- Dataset and analysis state are held in memory by the page/worker. **Clear session** drops the app's references; closing the page ends the ordinary in-memory session. This is not a guarantee of physical erasure from device memory or browser internals.
- User-initiated report exports are saved by the browser and include analysis plus up to 200 rows. The app does not control the user's download destination or subsequent sharing.
- The sensitive-data heuristic is a convenience gate, not a compliance control. Local processing does not by itself establish HIPAA, FERPA, or other legal compliance.
- When hosted, the web host receives ordinary requests for the page and may process or retain request metadata. This project does not set the host's logging or retention policies.

For details, see [PRIVACY.md](PRIVACY.md) and [LEGAL-NOTES.md](LEGAL-NOTES.md).

## Project layout

```
src/anim.js        GSAP animation layer
src/vendor/        vendored GSAP 3.12.5
src/analysis.js    statistical functions
src/insights.js    finding generation and narrative templates
src/charts.js      inline-SVG chart primitives
src/parse.js       CSV/XLSX parsing and sensitive-data heuristic
src/pipeline.js    analysis orchestration
src/worker.js      background parsing and analysis worker
src/app.js         UI shell, orchestration and rendering
src/styles.css     themes and component styles
src/shell.html     HTML skeleton
build.js           standalone HTML build
test/              engine, edge-case, guard, regression and browser suites
```

## Browser support

Chrome/Edge 103+, Firefox 113+, Safari 16.4+. XLSX requires `DecompressionStream`; export as CSV if your browser lacks it. Browser tests use Playwright + Chromium and are separate from the runtime app.
