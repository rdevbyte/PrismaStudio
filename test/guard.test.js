/* PHI guard: must block real clinical data, must NOT block school / HR /
   insurance files that merely contain a clinical-sounding substring. */
const fs = require('fs');
const path = require('path');
const g = globalThis;
g.window = g;
g.performance = g.performance || { now: () => Date.now() };
eval(fs.readFileSync(path.join(__dirname, '..', 'src', 'parse.js'), 'utf8'));
const P = g.TabulaMetricsParse;

let fails = 0;
function t(name, cols, rows, expect) {
  const r = P.healthScan(cols, rows || [{}]);
  const ok = r.blocked === expect;
  if (!ok) { fails++; console.log(`  FAIL ${name} -> blocked=${r.blocked}, expected=${expect} [${(r.terms || []).join(',')}]`); }
  else console.log(`  pass ${name}`);
}

console.log('MUST BLOCK — genuine clinical data');
t('patient + diagnosis + medication', ['patient_name', 'diagnosis', 'medication', 'dosage'], null, true);
t('medical record number', ['mrn', 'visit_date'], null, true);
t('ICD-10 in header', ['member', 'icd-10', 'claim'], null, true);
t('ICD-10 in body', ['a', 'b'], [{ a: 'ICD-10 E11.9', b: '1' }], true);
t('discharge summary', ['id', 'discharge summary'], null, true);
t('labs + cholesterol + BP', ['lab result', 'cholesterol', 'blood pressure'], null, true);
t('prescription', ['rx', 'prescription', 'pharmacy'], null, true);
t('clinical + hospital + admission', ['clinical', 'hospital', 'admission date'], null, true);
t('explicit PHI header', ['protected health information'], null, true);
t('two weak terms, no edu context', ['diagnosis', 'symptom', 'amount'], null, true);
t('Patient + Diagnosis header', ['Patient', 'Diagnosis', 'Amount'], null, true);

console.log('\nMUST NOT BLOCK — false positives');
t('school gradebook w/ Philosophy', ['student_id', 'Philosophy', 'Geography', 'gpa'], null, false);
t('school + immunization only', ['student_id', 'grade_level', 'immunization_status', 'gpa'], null, false);
t('school + IEP/504', ['student', 'iep_status', '504_plan', 'reading_level'], null, false);
t('Philadelphia / Memphis', ['city', 'Philadelphia', 'Memphis'], null, false);
t('name Sophia', ['Sophia Martinez', 'score'], null, false);
t('graphic_design', ['graphic_design', 'budget'], null, false);
t('auto insurance', ['age_bracket', 'citation_type', 'premium_amount'], null, false);
t('HR file', ['employee', 'salary', 'department', 'tenure'], null, false);
t('retail', ['sku', 'revenue', 'units'], null, false);
t('hospital as employer value', ['employer', 'salary'], [{ employer: 'Mercy Hospital', salary: '1' }], false);
t('trophies / Delphi', ['trophies', 'Delphi'], null, false);
t('impatient_flag substring', ['impatient_flag', 'score'], null, false);

console.log('\nDECLARATION PHRASES ARE HINTS, NOT OVERRIDES');
t('incidental sample-data phrase cannot bypass patient header', ['patient_name', 'diagnosis'], [{ patient_name: 'sample data', diagnosis: 'x' }], true);
t('de-identified text cannot bypass MRN and ICD headers', ['mrn', 'icd-10'], [{ mrn: 'de-identified export', 'icd-10': 'x' }], true);
t('unrelated synthetic phrase cannot bypass an MRN body value', ['record', 'score'], [{ record: 'synthetic test data', score: 'MRN 12345' }], true);
// Strong identifiers are scanned after row 60, even with generic headers.
const many = [];
for (let i = 0; i < 300; i++) many.push({ field_a: 'row ' + i, field_b: 'ordinary', field_c: i });
many.push({ field_a: 'late record', field_b: 'MRN 12345', field_c: 301 });
t('MRN in row 301 is detected', ['field_a', 'field_b', 'field_c'], many, true);

console.log(fails ? `\nFAILURES: ${fails}` : '\nAll PHI guard cases passed.');
process.exit(fails ? 1 : 0);
