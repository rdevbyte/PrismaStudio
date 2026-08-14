/* PHI guard: must block real clinical data, must NOT block school / HR /
   insurance files that merely contain a clinical-sounding substring. */
const fs = require('fs');
const path = require('path');
const g = globalThis;
g.window = g;
g.performance = g.performance || { now: () => Date.now() };
eval(fs.readFileSync(path.join(__dirname, '..', 'src', 'parse.js'), 'utf8'));
const P = g.PrismaParse;

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

console.log('\nOVERRIDE declarations');
t('No PHI note in row 1', ['patient_name', 'diagnosis'], [{ patient_name: 'No PHI - synthetic', diagnosis: 'x' }], false);
t('de-identified', ['mrn', 'icd-10'], [{ mrn: 'de-identified export', 'icd-10': 'x' }], false);
// declaration far down the file must still be honoured
const many = [];
for (let i = 0; i < 300; i++) many.push({ student: 'S' + i, diagnosis: 'x', score: '1' });
many.push({ student: 'No PHI', diagnosis: '', score: '' });
t('No PHI at row 301', ['student', 'diagnosis', 'score'], many, false);

console.log(fails ? `\nFAILURES: ${fails}` : '\nAll PHI guard cases passed.');
process.exit(fails ? 1 : 0);
