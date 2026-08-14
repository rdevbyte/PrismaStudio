/* Headless test of the analysis engine against a wide insurance dataset */
const fs = require('fs'), path = require('path');
const SRC = path.join(__dirname, '..', 'src');
const g = globalThis;
g.window = g;
g.performance = g.performance || { now: () => Date.now() };
['analysis.js', 'insights.js'].forEach((f) => eval(fs.readFileSync(path.join(SRC, f), 'utf8')));
const A = g.PrismaAnalysis, I = g.PrismaInsights;

/* ---- build the 45-column insurance dataset the user described ---- */
let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const rows = [];
const brackets = ['18-24', '25-34', '35-49', '50-64', '65+'];
const vehClass = ['Sedan', 'SUV', 'Truck', 'Sports', 'Minivan', 'EV'];
const credit = ['Poor', 'Fair', 'Good', 'Very Good', 'Excellent'];
const usage = ['Commute', 'Pleasure', 'Business', 'Farm'];
for (let i = 0; i < 900; i++) {
  const ageB = pick(brackets);
  const age = { '18-24': 21, '25-34': 29, '35-49': 42, '50-64': 57, '65+': 71 }[ageB] + Math.floor(rnd() * 6) - 3;
  const cls = pick(vehClass), cr = pick(credit);
  const viol = Math.max(0, Math.round(rnd() * 3 - (['Excellent', 'Very Good'].includes(cr) ? 1 : 0)));
  const claims = Math.max(0, Math.round(rnd() * 2.2 - (age > 50 ? 0.7 : 0)));
  const cf = { Poor: 1.55, Fair: 1.3, Good: 1, 'Very Good': .87, Excellent: .75 }[cr];
  const af = { '18-24': 1.85, '25-34': 1.2, '35-49': .92, '50-64': .86, '65+': 1.05 }[ageB];
  const lf = { Sedan: 1, SUV: 1.1, Truck: 1.15, Sports: 1.7, Minivan: .92, EV: 1.2 }[cls];
  const premium = +(620 * cf * af * lf * (1 + viol * .13) * (1 + claims * .16) * (.9 + rnd() * .22)).toFixed(2);
  const sev = claims ? +(2200 * lf * (.6 + rnd() * 1.5)).toFixed(2) : 0;
  rows.push({
    'Policy ID': 'P' + (100000 + i), Age: age, 'Age Bracket': ageB, Gender: pick(['M', 'F', 'X']),
    'Marital Status': pick(['Single', 'Married', 'Divorced', 'Widowed']),
    'Education Level': pick(['High School', 'Some College', 'Bachelor', 'Master', 'Doctorate']),
    'Employment Type': pick(['Full-time', 'Part-time', 'Self-employed', 'Retired', 'Student']),
    'Household Income Bracket': pick(['<40K', '40-75K', '75-125K', '125-200K', '200K+']),
    'Zip Territory': pick(['10001', '30301', '60601', '75201', '90210', '98101']),
    'Vehicle Class': cls, 'Vehicle Age': Math.round(rnd() * 14), 'Vehicle Safety Rating': Math.round(1 + rnd() * 4),
    'Anti-Theft Device': pick(['Yes', 'No']), 'Primary Use': pick(usage),
    'Annual Mileage': Math.round(6000 + rnd() * 18000), 'Commute Distance': +(rnd() * 42).toFixed(1),
    'Cars Insured': 1 + Math.floor(rnd() * 3), 'Household Drivers': 1 + Math.floor(rnd() * 4),
    'Credit Score Range': cr, 'Years As Customer': Math.round(rnd() * 18),
    'Traffic Violations': viol, 'Claims Filed': claims, 'Claim Amount Paid': sev, 'Average Claim Severity': sev,
    'Suspension History': viol > 2 ? 'Yes' : 'No', 'Annual Premium': premium,
    'Bundled Policies': pick(['None', 'Home', 'Life', 'Home+Life']),
    'Payment History': pick(['On-time', 'Late 1-2', 'Late 3+']),
    'Discount Eligibility': pick(['Yes', 'No']), 'Telematics Enrolled': pick(['Yes', 'No']),
    'Defensive Driving Course': pick(['Yes', 'No']), 'Good Student Discount': ageB === '18-24' ? pick(['Yes', 'No']) : 'No',
    'Loyalty Program': pick(['Bronze', 'Silver', 'Gold', 'None']),
    'Quote Conversion Rate': +(.15 + rnd() * .6).toFixed(3),
    'Competitor Policies Held': Math.floor(rnd() * 3), 'Coverage Gap Months': Math.floor(rnd() * 5),
    'Occupational Hazard Rating': Math.round(1 + rnd() * 4),
    'Customer Lifetime Value': +(premium * (3 + rnd() * 8)).toFixed(2),
    'Last Renewal Date': new Date(2025, Math.floor(rnd() * 12), 1 + Math.floor(rnd() * 27)).toISOString().slice(0, 10),
    'Communication Preference': pick(['Email', 'Phone', 'Mail', 'SMS']),
  });
}
const columns = Object.keys(rows[0]);

/* ---- mirror app.js analyse() ---- */
const types = {};
columns.forEach((c) => { types[c] = A.inferType(rows.map((r) => r[c]), c); });
const profiles = columns.map((c) => A.profileColumn(c, rows.map((r) => r[c]), types[c]));
const byName = Object.fromEntries(profiles.map((p) => [p.name, p]));
const typeOf = (n) => (byName[n] ? byName[n].type : 'text');
const numCols = profiles.filter((p) => A.isNumericType(p.type) && !p.constant && p.values && p.values.length > 4).map((p) => p.name);
const catCols = profiles.filter((p) => A.isGroupable(p.type) && !p.constant && p.unique <= 60).map((p) => p.name);
const dateCols = profiles.filter((p) => p.type === 'date' && p.dates && p.dates.length > 3).map((p) => p.name);
const derivedCats = [];
numCols.forEach((c) => {
  if (catCols.length >= 25) return;
  const b = A.binNumeric(rows, c, 5); if (!b) return;
  const name = `${c} (quintile)`;
  rows.forEach((r) => { const v = A.parseNumberLike(r[c]); r[name] = isFinite(v) ? b.label(v) : ''; });
  derivedCats.push(name);
});
const allCats = [...catCols, ...derivedCats];
const primaryMetric = I.pickPrimaryMetric(profiles);
const correlations = A.numericCorrelations(rows, numCols, .15);
const driverResults = A.driverAnalysis(rows, allCats, [...new Set([primaryMetric, ...numCols].filter(Boolean))].slice(0, 14)).filter((d) => d.eta2 > .005);
const catAssoc = A.categoricalAssociations(rows, catCols, .12);
const anomalies = A.detectAnomalies(rows, profiles);
const quality = A.qualityReport(profiles, rows);
const segments = A.segmentScan(rows, allCats.filter((c) => c !== `${primaryMetric} (quintile)`), primaryMetric);
const paretoResults = catCols.slice(0, 6).map((c) => ({ ...A.pareto(rows, c, primaryMetric), column: c, metric: primaryMetric })).filter((p) => p.items.length >= 3);
const ctx = { rows, columns, profiles, byName, typeOf, numCols, catCols: allCats, baseCats: catCols, dateCols, primaryMetric, correlations, driverResults, catAssoc, anomalies, quality, segments, paretoResults, series: null, forecastResult: null, seasonal: null, domain: I.detectDomain(columns) };
ctx.findings = I.buildFindings(ctx);
ctx.summary = I.buildSummary(ctx);
ctx.actions = I.buildActions(ctx);

/* ---- report ---- */
const strip = (s) => String(s).replace(/<[^>]+>/g, '');
console.log('=== TYPE INFERENCE ===');
const tc = {}; Object.values(types).forEach((t) => tc[t] = (tc[t] || 0) + 1);
console.log(tc);
console.log('numeric:', numCols.length, '| category:', catCols.length, '| derived quintiles:', derivedCats.length, '| date:', dateCols.length);
console.log('primary metric:', primaryMetric, '| domain:', ctx.domain && ctx.domain.label);
console.log('\n=== SUMMARY ===\n' + strip(ctx.summary));
console.log('\n=== COUNTS ===');
console.log({ findings: ctx.findings.length, drivers: driverResults.length, correlations: correlations.length, catAssoc: catAssoc.length, segments: segments.length, anomalies: anomalies.length, qualityIssues: quality.issues.length, actions: ctx.actions.length, qualityScore: quality.score });
console.log('\n=== TOP 8 DRIVERS ===');
driverResults.slice(0, 8).forEach((d) => console.log(`  ${d.driver} -> ${d.metric}: eta2=${d.eta2.toFixed(3)} p=${isFinite(d.p) ? d.p.toExponential(1) : 'NA'} top=${d.top.key}(${d.top.mean.toFixed(0)}) bottom=${d.bottom.key}(${d.bottom.mean.toFixed(0)})`));
console.log('\n=== TOP 6 FINDINGS ===');
ctx.findings.slice(0, 6).forEach((f, i) => console.log(`  ${i + 1}. [${f.kind}/${f.tone}] ${f.title}\n     ${strip(f.body).slice(0, 190)}`));
console.log('\n=== ACTIONS ===');
ctx.actions.forEach((a) => console.log('  - ' + strip(a.text).slice(0, 150)));

/* ---- assertions ---- */
const fail = [];
if (ctx.findings.length < 15) fail.push('too few findings: ' + ctx.findings.length);
if (driverResults.length < 10) fail.push('too few drivers: ' + driverResults.length);
if (!primaryMetric) fail.push('no primary metric');
if (types['Zip Territory'] !== 'category') fail.push('zip should be category, got ' + types['Zip Territory']);
if (types['Annual Premium'] !== 'currency') fail.push('premium should be currency, got ' + types['Annual Premium']);
if (types['Last Renewal Date'] !== 'date') fail.push('renewal date should be date, got ' + types['Last Renewal Date']);
if (types['Policy ID'] !== 'id') fail.push('policy id should be id, got ' + types['Policy ID']);
// known ground truth: credit + age bracket + vehicle class drive premium
const premDrivers = driverResults.filter((d) => d.metric === 'Annual Premium').slice(0, 5).map((d) => d.driver);
['Credit Score Range', 'Age Bracket', 'Vehicle Class'].forEach((d) => {
  if (!premDrivers.includes(d)) fail.push(`expected ${d} in top-5 premium drivers, got ${premDrivers.join(', ')}`);
});
console.log('\n=== ASSERTIONS ===');
if (fail.length) { fail.forEach((f) => console.log('  FAIL ' + f)); process.exit(1); }
console.log('  All passed.');
