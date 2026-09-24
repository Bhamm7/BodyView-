/**
 * The blood markers BodyView knows how to name, group and judge.
 *
 * A lab report is free text: the same analyte is "Hemoglobin A1C", "HbA1c" or
 * "Glycated hemoglobin" depending on who printed it. Matching against this
 * table is what turns a parsed line into a series that can be charted next to
 * the same marker from a draw six months earlier.
 *
 * Reference ranges here are adult-male SI ranges, used for display only and
 * only as a fallback: whatever range the report itself carries always wins,
 * because it belongs to the lab that ran the assay. A range is a drawing aid,
 * not a verdict, and none of this is medical advice.
 */
export type MarkerCategory =
  | 'hormones'
  | 'lipids'
  | 'renal'
  | 'electrolytes'
  | 'liver'
  | 'cbc'
  | 'metabolic'
  | 'thyroid'
  | 'inflammation'
  | 'other';

export const CATEGORY_LABELS: Record<MarkerCategory, string> = {
  hormones: 'Hormones',
  lipids: 'Lipids',
  renal: 'Kidney',
  electrolytes: 'Electrolytes',
  liver: 'Liver',
  cbc: 'Blood count',
  metabolic: 'Metabolic',
  thyroid: 'Thyroid',
  inflammation: 'Inflammation',
  other: 'Other',
};

export interface MarkerDef {
  key: string;
  label: string;
  short?: string;
  category: MarkerCategory;
  /** Canonical unit. Values arriving in a known alternative are converted. */
  unit: string;
  /** Fallback adult-male range, used only when the report carries none. */
  range?: { low?: number; high?: number };
  /** Extra names seen on reports, matched loosely. */
  aliases: string[];
  /** Factor to the canonical unit, keyed by the unit as written, lowercase. */
  convert?: Record<string, number>;
  decimals?: number;
}

const M = (def: MarkerDef): MarkerDef => def;

export const MARKERS: MarkerDef[] = [
  // Hormones
  M({ key: 'testosterone', label: 'Testosterone, total', short: 'Test', category: 'hormones', unit: 'nmol/L', range: { low: 8.4, high: 28.7 }, aliases: ['testosterone total', 'total testosterone', 'testosterone'], convert: { 'ng/dl': 0.03467, 'ng/ml': 3.467 }, decimals: 1 }),
  M({ key: 'freeTestosterone', label: 'Testosterone, free', short: 'Free T', category: 'hormones', unit: 'pmol/L', range: { low: 196, high: 636 }, aliases: ['free testosterone', 'testosterone free', 'bioavailable testosterone'], convert: { 'pg/ml': 3.467 }, decimals: 0 }),
  M({ key: 'estradiol', label: 'Estradiol', short: 'E2', category: 'hormones', unit: 'pmol/L', range: { low: 40, high: 160 }, aliases: ['estradiol', 'oestradiol', 'e2', 'estradiol sensitive'], convert: { 'pg/ml': 3.671 }, decimals: 0 }),
  M({ key: 'shbg', label: 'SHBG', category: 'hormones', unit: 'nmol/L', range: { low: 18, high: 54 }, aliases: ['shbg', 'sex hormone binding globulin'], decimals: 0 }),
  M({ key: 'lh', label: 'LH', category: 'hormones', unit: 'IU/L', range: { low: 1.7, high: 8.6 }, aliases: ['lh', 'luteinizing hormone'], decimals: 1 }),
  M({ key: 'fsh', label: 'FSH', category: 'hormones', unit: 'IU/L', range: { low: 1.5, high: 12.4 }, aliases: ['fsh', 'follicle stimulating hormone'], decimals: 1 }),
  M({ key: 'prolactin', label: 'Prolactin', category: 'hormones', unit: 'ug/L', range: { low: 4, high: 15.2 }, aliases: ['prolactin', 'prl'], decimals: 1 }),
  M({ key: 'igf1', label: 'IGF-1', category: 'hormones', unit: 'nmol/L', range: { low: 11, high: 40 }, aliases: ['igf-1', 'igf 1', 'insulin like growth factor'], decimals: 1 }),
  M({ key: 'dheas', label: 'DHEA-S', category: 'hormones', unit: 'umol/L', range: { low: 2.4, high: 11.6 }, aliases: ['dhea-s', 'dhea sulfate', 'dheas'], decimals: 1 }),
  M({ key: 'cortisol', label: 'Cortisol', category: 'hormones', unit: 'nmol/L', range: { low: 133, high: 537 }, aliases: ['cortisol'], decimals: 0 }),
  M({ key: 'psa', label: 'PSA', category: 'hormones', unit: 'ug/L', range: { high: 4 }, aliases: ['psa', 'prostate specific antigen'], decimals: 2 }),

  // Lipids
  M({ key: 'cholesterol', label: 'Cholesterol, total', short: 'TC', category: 'lipids', unit: 'mmol/L', range: { high: 5.2 }, aliases: ['cholesterol', 'total cholesterol', 'cholesterol total'], convert: { 'mg/dl': 0.02586 }, decimals: 2 }),
  M({ key: 'ldl', label: 'LDL cholesterol', short: 'LDL', category: 'lipids', unit: 'mmol/L', range: { high: 3.4 }, aliases: ['ldl', 'ldl cholesterol', 'ldl c', 'cholesterol ldl calculated'], convert: { 'mg/dl': 0.02586 }, decimals: 2 }),
  M({ key: 'hdl', label: 'HDL cholesterol', short: 'HDL', category: 'lipids', unit: 'mmol/L', range: { low: 1.0 }, aliases: ['hdl', 'hdl cholesterol', 'hdl c', 'cholesterol hdl'], convert: { 'mg/dl': 0.02586 }, decimals: 2 }),
  M({ key: 'nonHdl', label: 'Non-HDL cholesterol', short: 'Non-HDL', category: 'lipids', unit: 'mmol/L', range: { high: 4.2 }, aliases: ['non hdl cholesterol', 'non hdl', 'non hdl c'], convert: { 'mg/dl': 0.02586 }, decimals: 2 }),
  M({ key: 'triglycerides', label: 'Triglycerides', short: 'Trig', category: 'lipids', unit: 'mmol/L', range: { high: 1.7 }, aliases: ['triglycerides', 'triglyceride', 'tg'], convert: { 'mg/dl': 0.01129 }, decimals: 2 }),
  M({ key: 'apob', label: 'Apolipoprotein B', short: 'ApoB', category: 'lipids', unit: 'g/L', range: { high: 1.05 }, aliases: ['apolipoprotein b', 'apo b', 'apob'], decimals: 2 }),
  M({ key: 'lpa', label: 'Lipoprotein(a)', short: 'Lp(a)', category: 'lipids', unit: 'nmol/L', range: { high: 75 }, aliases: ['lipoprotein a', 'lp a', 'lpa'], decimals: 0 }),
  M({ key: 'cholHdlRatio', label: 'Chol : HDL ratio', category: 'lipids', unit: 'ratio', range: { high: 5 }, aliases: ['cholesterol hdl ratio', 'chol hdl ratio', 'tc hdl ratio'], decimals: 1 }),

  // Kidney
  M({ key: 'creatinine', label: 'Creatinine', category: 'renal', unit: 'umol/L', range: { low: 62, high: 106 }, aliases: ['creatinine', 'creat'], convert: { 'mg/dl': 88.4 }, decimals: 0 }),
  M({ key: 'egfr', label: 'eGFR', category: 'renal', unit: 'mL/min/1.73m2', range: { low: 90 }, aliases: ['egfr', 'gfr', 'estimated gfr', 'egfr ckd epi'], decimals: 0 }),
  M({ key: 'cystatinC', label: 'Cystatin C', category: 'renal', unit: 'mg/L', range: { low: 0.51, high: 0.98 }, aliases: ['cystatin c'], decimals: 2 }),
  M({ key: 'uacr', label: 'Urine albumin : creatinine', short: 'uACR', category: 'renal', unit: 'mg/mmol', range: { high: 3 }, aliases: ['albumin creatinine ratio', 'urine albumin creatinine ratio', 'uacr', 'acr', 'microalbumin creatinine ratio'], decimals: 1 }),
  M({ key: 'urea', label: 'Urea', category: 'renal', unit: 'mmol/L', range: { low: 3, high: 9.2 }, aliases: ['urea', 'bun', 'blood urea nitrogen'], decimals: 1 }),
  M({ key: 'uricAcid', label: 'Uric acid', category: 'renal', unit: 'umol/L', range: { low: 200, high: 430 }, aliases: ['uric acid', 'urate'], decimals: 0 }),

  // Electrolytes
  M({ key: 'sodium', label: 'Sodium', short: 'Na', category: 'electrolytes', unit: 'mmol/L', range: { low: 135, high: 145 }, aliases: ['sodium'], decimals: 0 }),
  M({ key: 'potassium', label: 'Potassium', short: 'K', category: 'electrolytes', unit: 'mmol/L', range: { low: 3.5, high: 5.1 }, aliases: ['potassium'], decimals: 1 }),
  M({ key: 'chloride', label: 'Chloride', short: 'Cl', category: 'electrolytes', unit: 'mmol/L', range: { low: 98, high: 107 }, aliases: ['chloride'], decimals: 0 }),
  M({ key: 'bicarbonate', label: 'Bicarbonate', short: 'CO2', category: 'electrolytes', unit: 'mmol/L', range: { low: 22, high: 29 }, aliases: ['bicarbonate', 'co2', 'carbon dioxide', 'total co2'], decimals: 0 }),
  M({ key: 'calcium', label: 'Calcium', category: 'electrolytes', unit: 'mmol/L', range: { low: 2.15, high: 2.6 }, aliases: ['calcium'], decimals: 2 }),
  M({ key: 'magnesium', label: 'Magnesium', category: 'electrolytes', unit: 'mmol/L', range: { low: 0.7, high: 1.05 }, aliases: ['magnesium'], decimals: 2 }),
  M({ key: 'phosphate', label: 'Phosphate', category: 'electrolytes', unit: 'mmol/L', range: { low: 0.8, high: 1.45 }, aliases: ['phosphate', 'phosphorus'], decimals: 2 }),

  // Liver
  M({ key: 'alt', label: 'ALT', category: 'liver', unit: 'U/L', range: { high: 50 }, aliases: ['alt', 'alanine aminotransferase', 'sgpt'], decimals: 0 }),
  M({ key: 'ast', label: 'AST', category: 'liver', unit: 'U/L', range: { high: 36 }, aliases: ['ast', 'aspartate aminotransferase', 'sgot'], decimals: 0 }),
  M({ key: 'ggt', label: 'GGT', category: 'liver', unit: 'U/L', range: { high: 55 }, aliases: ['ggt', 'gamma gt', 'gamma glutamyl transferase'], decimals: 0 }),
  M({ key: 'alp', label: 'ALP', category: 'liver', unit: 'U/L', range: { low: 40, high: 129 }, aliases: ['alp', 'alkaline phosphatase'], decimals: 0 }),
  M({ key: 'bilirubin', label: 'Bilirubin, total', category: 'liver', unit: 'umol/L', range: { high: 20 }, aliases: ['bilirubin', 'total bilirubin', 'bilirubin total'], decimals: 0 }),
  M({ key: 'albumin', label: 'Albumin', category: 'liver', unit: 'g/L', range: { low: 35, high: 50 }, aliases: ['albumin'], decimals: 0 }),

  // Blood count
  M({ key: 'hemoglobin', label: 'Hemoglobin', short: 'Hgb', category: 'cbc', unit: 'g/L', range: { low: 135, high: 175 }, aliases: ['hemoglobin', 'haemoglobin', 'hgb', 'hb'], convert: { 'g/dl': 10 }, decimals: 0 }),
  M({ key: 'hematocrit', label: 'Hematocrit', short: 'Hct', category: 'cbc', unit: 'L/L', range: { low: 0.4, high: 0.5 }, aliases: ['hematocrit', 'haematocrit', 'hct'], decimals: 3 }),
  M({ key: 'rbc', label: 'Red cell count', short: 'RBC', category: 'cbc', unit: '10*12/L', range: { low: 4.5, high: 5.9 }, aliases: ['rbc', 'red blood cell count', 'red cell count', 'erythrocytes'], decimals: 2 }),
  M({ key: 'wbc', label: 'White cell count', short: 'WBC', category: 'cbc', unit: '10*9/L', range: { low: 4, high: 11 }, aliases: ['wbc', 'white blood cell count', 'white cell count', 'leukocytes'], decimals: 1 }),
  M({ key: 'platelets', label: 'Platelets', short: 'Plt', category: 'cbc', unit: '10*9/L', range: { low: 150, high: 400 }, aliases: ['platelets', 'platelet count', 'plt'], decimals: 0 }),
  M({ key: 'ferritin', label: 'Ferritin', category: 'cbc', unit: 'ug/L', range: { low: 30, high: 400 }, aliases: ['ferritin'], decimals: 0 }),
  M({ key: 'iron', label: 'Iron', category: 'cbc', unit: 'umol/L', range: { low: 10, high: 30 }, aliases: ['iron', 'serum iron'], decimals: 0 }),

  // Metabolic
  M({ key: 'glucose', label: 'Glucose, fasting', category: 'metabolic', unit: 'mmol/L', range: { low: 3.6, high: 5.5 }, aliases: ['glucose', 'fasting glucose', 'glucose fasting', 'glucose random'], convert: { 'mg/dl': 0.0555 }, decimals: 1 }),
  M({ key: 'hba1c', label: 'HbA1c', category: 'metabolic', unit: '%', range: { high: 5.7 }, aliases: ['hba1c', 'hemoglobin a1c', 'a1c', 'glycated hemoglobin'], decimals: 1 }),
  M({ key: 'insulin', label: 'Insulin, fasting', category: 'metabolic', unit: 'pmol/L', range: { low: 18, high: 90 }, aliases: ['insulin', 'fasting insulin'], decimals: 0 }),
  M({ key: 'vitaminD', label: 'Vitamin D (25-OH)', category: 'metabolic', unit: 'nmol/L', range: { low: 75, high: 250 }, aliases: ['vitamin d', '25 oh vitamin d', '25 hydroxy vitamin d', 'vitamin d 25 hydroxy'], decimals: 0 }),
  M({ key: 'b12', label: 'Vitamin B12', category: 'metabolic', unit: 'pmol/L', range: { low: 138, high: 652 }, aliases: ['b12', 'vitamin b12', 'cobalamin'], decimals: 0 }),

  // Thyroid
  M({ key: 'tsh', label: 'TSH', category: 'thyroid', unit: 'mIU/L', range: { low: 0.2, high: 4 }, aliases: ['tsh', 'thyroid stimulating hormone'], decimals: 2 }),
  M({ key: 'freeT4', label: 'Free T4', category: 'thyroid', unit: 'pmol/L', range: { low: 10, high: 25 }, aliases: ['free t4', 'ft4', 't4 free'], decimals: 1 }),
  M({ key: 'freeT3', label: 'Free T3', category: 'thyroid', unit: 'pmol/L', range: { low: 3.5, high: 6.5 }, aliases: ['free t3', 'ft3', 't3 free'], decimals: 1 }),

  // Inflammation
  M({ key: 'crp', label: 'CRP (high sensitivity)', short: 'hs-CRP', category: 'inflammation', unit: 'mg/L', range: { high: 3 }, aliases: ['crp', 'c reactive protein', 'hs crp', 'high sensitivity crp'], decimals: 1 }),
  M({ key: 'homocysteine', label: 'Homocysteine', category: 'inflammation', unit: 'umol/L', range: { high: 15 }, aliases: ['homocysteine'], decimals: 1 }),
];

const BY_KEY = new Map(MARKERS.map((m) => [m.key, m]));

export function markerDef(key: string): MarkerDef | undefined {
  return BY_KEY.get(key);
}

/** Strips punctuation and case, so "Cholesterol, Total" meets "cholesterol total". */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const ALIAS_INDEX = MARKERS.flatMap((m) =>
  [m.label, ...m.aliases].map((alias) => ({ alias: normalizeName(alias), key: m.key })),
).sort((a, b) => b.alias.length - a.alias.length);

/**
 * Finds the marker a reported name refers to.
 *
 * Exact match first, then the longest alias appearing as whole words in the
 * name — reports pad names with sample and method ("Testosterone, Total -
 * serum, LC/MS"), and going longest-first is what stops "testosterone"
 * claiming a "free testosterone" line.
 */
export function matchMarker(reportedName: string): MarkerDef | undefined {
  const name = normalizeName(reportedName);
  if (!name) return undefined;

  for (const entry of ALIAS_INDEX) if (entry.alias === name) return BY_KEY.get(entry.key);
  for (const entry of ALIAS_INDEX) {
    if (entry.alias.length < 2) continue;
    if (new RegExp(`(^|\\s)${entry.alias}($|\\s)`).test(name)) return BY_KEY.get(entry.key);
  }
  return undefined;
}

/** Converts a reported value into the marker's canonical unit where it can. */
export function toCanonicalUnit(
  def: MarkerDef,
  value: number,
  unit?: string,
): { value: number; unit: string; converted: boolean } {
  const reported = (unit ?? '').trim();
  if (!reported) return { value, unit: def.unit, converted: false };
  if (normalizeName(reported) === normalizeName(def.unit)) {
    return { value, unit: def.unit, converted: false };
  }

  const factor = def.convert?.[reported.toLowerCase()];
  if (factor == null) return { value, unit: reported, converted: false };
  return { value: Number((value * factor).toPrecision(6)), unit: def.unit, converted: true };
}

export type RangeStatus = 'low' | 'high' | 'in' | 'unknown';

/** Where a value sits against a range — the report's own, when it has one. */
export function rangeStatus(value: number, range?: { low?: number; high?: number }): RangeStatus {
  if (!range || (range.low == null && range.high == null)) return 'unknown';
  if (range.low != null && value < range.low) return 'low';
  if (range.high != null && value > range.high) return 'high';
  return 'in';
}
