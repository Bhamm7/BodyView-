/**
 * Catalogue of blood markers.
 *
 * Canonical units are SI, which is what Canadian labs (including Alberta
 * Precision Labs, behind MyHealth Alberta) report in. US-unit equivalents are
 * listed as conversions so a report in mg/dL or ng/dL can still be charted
 * against the rest.
 *
 * The reference intervals here are *typical adult* figures for orientation
 * only. Real intervals vary by lab, assay, sex and age — so whenever a report
 * carries its own range it is stored on the result and takes precedence over
 * anything in this file.
 */

export type MarkerCategory =
  | 'hormones'
  | 'lipids'
  | 'metabolic'
  | 'liver'
  | 'kidney'
  | 'blood'
  | 'thyroid'
  | 'inflammation'
  | 'vitamins'
  | 'other';

export interface MarkerDef {
  key: string;
  label: string;
  /** Canonical unit; everything is charted in this. */
  unit: string;
  category: MarkerCategory;
  /** Names as they appear on reports, lowercase. Longest match wins. */
  aliases: string[];
  /** Typical adult interval, superseded by the lab's own when present. */
  ref?: { low?: number; high?: number; note?: string };
  precision: number;
  /** Other units this marker is reported in, and the factor to canonical. */
  conversions?: Record<string, number>;
}

export const BLOOD_MARKERS: MarkerDef[] = [
  /* ----------------------------------------------------------- hormones -- */
  {
    key: 'testosterone_total',
    label: 'Testosterone, total',
    unit: 'nmol/L',
    category: 'hormones',
    aliases: ['testosterone total', 'total testosterone', 'testosterone'],
    ref: { low: 8.4, high: 28.7, note: 'adult male' },
    precision: 2,
    conversions: { 'ng/dL': 0.0347, 'ng/mL': 3.47 },
  },
  {
    key: 'testosterone_free',
    label: 'Testosterone, free',
    unit: 'pmol/L',
    category: 'hormones',
    aliases: ['free testosterone', 'testosterone free', 'testosterone, free'],
    ref: { low: 196, high: 636, note: 'adult male' },
    precision: 1,
    conversions: { 'pg/mL': 3.47, 'ng/dL': 34.7 },
  },
  {
    key: 'shbg',
    label: 'SHBG',
    unit: 'nmol/L',
    category: 'hormones',
    aliases: ['shbg', 'sex hormone binding globulin'],
    ref: { low: 18, high: 54, note: 'adult male' },
    precision: 1,
  },
  {
    key: 'estradiol',
    label: 'Estradiol',
    unit: 'pmol/L',
    category: 'hormones',
    aliases: ['estradiol', 'oestradiol', 'e2'],
    ref: { low: 40, high: 160, note: 'adult male' },
    precision: 0,
    conversions: { 'pg/mL': 3.671 },
  },
  {
    key: 'lh',
    label: 'LH',
    unit: 'IU/L',
    category: 'hormones',
    aliases: ['lh', 'luteinizing hormone', 'luteinising hormone'],
    ref: { low: 1.7, high: 8.6, note: 'adult male' },
    precision: 2,
  },
  {
    key: 'fsh',
    label: 'FSH',
    unit: 'IU/L',
    category: 'hormones',
    aliases: ['fsh', 'follicle stimulating hormone'],
    ref: { low: 1.5, high: 12.4, note: 'adult male' },
    precision: 2,
  },
  {
    key: 'prolactin',
    label: 'Prolactin',
    unit: 'µg/L',
    category: 'hormones',
    aliases: ['prolactin', 'prl'],
    ref: { low: 4, high: 15.2, note: 'adult male' },
    precision: 1,
    conversions: { 'ng/mL': 1, 'mIU/L': 0.0472 },
  },
  {
    key: 'igf1',
    label: 'IGF-1',
    unit: 'nmol/L',
    category: 'hormones',
    aliases: ['igf-1', 'igf 1', 'igf1', 'insulin like growth factor'],
    ref: { low: 13, high: 44, note: 'varies sharply with age' },
    precision: 1,
    conversions: { 'ng/mL': 0.131, 'µg/L': 0.131 },
  },
  {
    key: 'cortisol',
    label: 'Cortisol',
    unit: 'nmol/L',
    category: 'hormones',
    aliases: ['cortisol'],
    ref: { low: 133, high: 537, note: 'morning draw' },
    precision: 0,
    conversions: { 'µg/dL': 27.59, 'ug/dL': 27.59 },
  },
  {
    key: 'dhea_s',
    label: 'DHEA-S',
    unit: 'µmol/L',
    category: 'hormones',
    aliases: ['dhea-s', 'dhea sulfate', 'dheas', 'dhea sulphate'],
    ref: { low: 2.4, high: 11.6, note: 'adult male' },
    precision: 2,
    conversions: { 'µg/dL': 0.02714, 'ug/dL': 0.02714 },
  },

  /* -------------------------------------------------------------- lipids -- */
  {
    key: 'cholesterol_total',
    label: 'Cholesterol, total',
    unit: 'mmol/L',
    category: 'lipids',
    aliases: ['total cholesterol', 'cholesterol total', 'cholesterol'],
    ref: { high: 5.2 },
    precision: 2,
    conversions: { 'mg/dL': 0.02586 },
  },
  {
    key: 'ldl',
    label: 'LDL cholesterol',
    unit: 'mmol/L',
    category: 'lipids',
    aliases: ['ldl cholesterol', 'ldl-c', 'ldl'],
    ref: { high: 3.4 },
    precision: 2,
    conversions: { 'mg/dL': 0.02586 },
  },
  {
    key: 'hdl',
    label: 'HDL cholesterol',
    unit: 'mmol/L',
    category: 'lipids',
    aliases: ['hdl cholesterol', 'hdl-c', 'hdl'],
    ref: { low: 1.0, note: 'adult male' },
    precision: 2,
    conversions: { 'mg/dL': 0.02586 },
  },
  {
    key: 'triglycerides',
    label: 'Triglycerides',
    unit: 'mmol/L',
    category: 'lipids',
    aliases: ['triglycerides', 'triglyceride', 'tg'],
    ref: { high: 1.7 },
    precision: 2,
    conversions: { 'mg/dL': 0.01129 },
  },
  {
    key: 'non_hdl',
    label: 'Non-HDL cholesterol',
    unit: 'mmol/L',
    category: 'lipids',
    aliases: ['non-hdl cholesterol', 'non hdl cholesterol', 'non-hdl'],
    ref: { high: 4.2 },
    precision: 2,
    conversions: { 'mg/dL': 0.02586 },
  },
  {
    key: 'apob',
    label: 'Apolipoprotein B',
    unit: 'g/L',
    category: 'lipids',
    aliases: ['apolipoprotein b', 'apo b', 'apob'],
    ref: { high: 1.0 },
    precision: 2,
    conversions: { 'mg/dL': 0.01 },
  },
  {
    key: 'lpa',
    label: 'Lipoprotein(a)',
    unit: 'nmol/L',
    category: 'lipids',
    aliases: ['lipoprotein(a)', 'lipoprotein a', 'lp(a)', 'lpa'],
    ref: { high: 75 },
    precision: 0,
  },

  /* ----------------------------------------------------------- metabolic -- */
  {
    key: 'glucose',
    label: 'Glucose, fasting',
    unit: 'mmol/L',
    category: 'metabolic',
    aliases: ['glucose fasting', 'fasting glucose', 'glucose random', 'glucose'],
    ref: { low: 3.6, high: 5.5 },
    precision: 2,
    conversions: { 'mg/dL': 0.0555 },
  },
  {
    key: 'hba1c',
    label: 'HbA1c',
    unit: '%',
    category: 'metabolic',
    aliases: ['hba1c', 'hemoglobin a1c', 'haemoglobin a1c', 'a1c', 'glycated hemoglobin'],
    ref: { high: 5.7 },
    precision: 1,
  },
  {
    key: 'insulin',
    label: 'Insulin, fasting',
    unit: 'pmol/L',
    category: 'metabolic',
    aliases: ['insulin fasting', 'fasting insulin', 'insulin'],
    ref: { low: 18, high: 173 },
    precision: 1,
    conversions: { 'µIU/mL': 6.945, 'uIU/mL': 6.945, 'mIU/L': 6.945 },
  },

  /* --------------------------------------------------------------- liver -- */
  {
    key: 'alt',
    label: 'ALT',
    unit: 'U/L',
    category: 'liver',
    aliases: ['alt', 'alanine aminotransferase', 'sgpt'],
    ref: { high: 50, note: 'adult male' },
    precision: 0,
  },
  {
    key: 'ast',
    label: 'AST',
    unit: 'U/L',
    category: 'liver',
    aliases: ['ast', 'aspartate aminotransferase', 'sgot'],
    ref: { high: 40, note: 'adult male' },
    precision: 0,
  },
  {
    key: 'alp',
    label: 'ALP',
    unit: 'U/L',
    category: 'liver',
    aliases: ['alp', 'alkaline phosphatase'],
    ref: { low: 40, high: 129 },
    precision: 0,
  },
  {
    key: 'ggt',
    label: 'GGT',
    unit: 'U/L',
    category: 'liver',
    aliases: ['ggt', 'gamma glutamyl transferase', 'gamma-glutamyl transferase'],
    ref: { high: 60, note: 'adult male' },
    precision: 0,
  },
  {
    key: 'bilirubin_total',
    label: 'Bilirubin, total',
    unit: 'µmol/L',
    category: 'liver',
    aliases: ['bilirubin total', 'total bilirubin', 'bilirubin'],
    ref: { high: 21 },
    precision: 1,
    conversions: { 'mg/dL': 17.1 },
  },
  {
    key: 'albumin',
    label: 'Albumin',
    unit: 'g/L',
    category: 'liver',
    aliases: ['albumin'],
    ref: { low: 35, high: 50 },
    precision: 0,
    conversions: { 'g/dL': 10 },
  },

  /* -------------------------------------------------------------- kidney -- */
  {
    key: 'creatinine',
    label: 'Creatinine',
    unit: 'µmol/L',
    category: 'kidney',
    aliases: ['creatinine'],
    ref: { low: 62, high: 115, note: 'adult male' },
    precision: 0,
    conversions: { 'mg/dL': 88.4 },
  },
  {
    key: 'egfr',
    label: 'eGFR',
    unit: 'mL/min/1.73m²',
    category: 'kidney',
    aliases: ['egfr', 'estimated gfr', 'gfr'],
    ref: { low: 90 },
    precision: 0,
  },
  {
    key: 'urea',
    label: 'Urea',
    unit: 'mmol/L',
    category: 'kidney',
    aliases: ['urea', 'bun', 'blood urea nitrogen'],
    ref: { low: 2.5, high: 8.1 },
    precision: 1,
    conversions: { 'mg/dL': 0.357 },
  },
  {
    key: 'uric_acid',
    label: 'Uric acid',
    unit: 'µmol/L',
    category: 'kidney',
    aliases: ['uric acid', 'urate'],
    ref: { low: 200, high: 430, note: 'adult male' },
    precision: 0,
    conversions: { 'mg/dL': 59.48 },
  },
  {
    key: 'sodium',
    label: 'Sodium',
    unit: 'mmol/L',
    category: 'kidney',
    aliases: ['sodium', 'na'],
    ref: { low: 135, high: 145 },
    precision: 0,
  },
  {
    key: 'potassium',
    label: 'Potassium',
    unit: 'mmol/L',
    category: 'kidney',
    aliases: ['potassium', 'k'],
    ref: { low: 3.5, high: 5.1 },
    precision: 1,
  },
  {
    key: 'chloride',
    label: 'Chloride',
    unit: 'mmol/L',
    category: 'kidney',
    aliases: ['chloride', 'cl'],
    ref: { low: 98, high: 107 },
    precision: 0,
  },
  {
    key: 'calcium',
    label: 'Calcium',
    unit: 'mmol/L',
    category: 'kidney',
    aliases: ['calcium', 'ca'],
    ref: { low: 2.2, high: 2.6 },
    precision: 2,
    conversions: { 'mg/dL': 0.2495 },
  },
  {
    key: 'magnesium',
    label: 'Magnesium',
    unit: 'mmol/L',
    category: 'kidney',
    aliases: ['magnesium', 'mg'],
    ref: { low: 0.7, high: 1.0 },
    precision: 2,
    conversions: { 'mg/dL': 0.4114 },
  },

  /* --------------------------------------------------------------- blood -- */
  {
    key: 'hemoglobin',
    label: 'Hemoglobin',
    unit: 'g/L',
    category: 'blood',
    aliases: ['hemoglobin', 'haemoglobin', 'hgb', 'hb'],
    ref: { low: 135, high: 175, note: 'adult male' },
    precision: 0,
    conversions: { 'g/dL': 10 },
  },
  {
    key: 'hematocrit',
    label: 'Hematocrit',
    unit: 'L/L',
    category: 'blood',
    aliases: ['hematocrit', 'haematocrit', 'hct'],
    ref: { low: 0.4, high: 0.5, note: 'adult male' },
    precision: 3,
    conversions: { '%': 0.01 },
  },
  {
    key: 'rbc',
    label: 'Red blood cells',
    unit: '10^12/L',
    category: 'blood',
    aliases: ['red blood cell count', 'red blood cells', 'rbc', 'erythrocytes'],
    ref: { low: 4.5, high: 5.9, note: 'adult male' },
    precision: 2,
  },
  {
    key: 'wbc',
    label: 'White blood cells',
    unit: '10^9/L',
    category: 'blood',
    aliases: ['white blood cell count', 'white blood cells', 'wbc', 'leukocytes'],
    ref: { low: 4.0, high: 11.0 },
    precision: 1,
  },
  {
    key: 'platelets',
    label: 'Platelets',
    unit: '10^9/L',
    category: 'blood',
    aliases: ['platelet count', 'platelets', 'plt'],
    ref: { low: 150, high: 400 },
    precision: 0,
  },
  {
    key: 'ferritin',
    label: 'Ferritin',
    unit: 'µg/L',
    category: 'blood',
    aliases: ['ferritin'],
    ref: { low: 30, high: 400, note: 'adult male' },
    precision: 0,
    conversions: { 'ng/mL': 1 },
  },

  /* ------------------------------------------------------------- thyroid -- */
  {
    key: 'tsh',
    label: 'TSH',
    unit: 'mIU/L',
    category: 'thyroid',
    aliases: ['tsh', 'thyroid stimulating hormone', 'thyrotropin'],
    ref: { low: 0.32, high: 4.0 },
    precision: 2,
    conversions: { 'µIU/mL': 1, 'uIU/mL': 1 },
  },
  {
    key: 'free_t4',
    label: 'Free T4',
    unit: 'pmol/L',
    category: 'thyroid',
    aliases: ['free t4', 'ft4', 't4 free', 'free thyroxine'],
    ref: { low: 10, high: 25 },
    precision: 1,
    conversions: { 'ng/dL': 12.87 },
  },
  {
    key: 'free_t3',
    label: 'Free T3',
    unit: 'pmol/L',
    category: 'thyroid',
    aliases: ['free t3', 'ft3', 't3 free', 'free triiodothyronine'],
    ref: { low: 3.5, high: 6.5 },
    precision: 1,
    conversions: { 'pg/mL': 1.536 },
  },

  /* -------------------------------------------------------- inflammation -- */
  {
    key: 'crp',
    label: 'CRP (high sensitivity)',
    unit: 'mg/L',
    category: 'inflammation',
    aliases: ['hs-crp', 'hs crp', 'high sensitivity crp', 'c-reactive protein', 'crp'],
    ref: { high: 3.0 },
    precision: 2,
  },
  {
    key: 'homocysteine',
    label: 'Homocysteine',
    unit: 'µmol/L',
    category: 'inflammation',
    aliases: ['homocysteine'],
    ref: { high: 15 },
    precision: 1,
  },

  /* ------------------------------------------------------------ vitamins -- */
  {
    key: 'vitamin_d',
    label: 'Vitamin D (25-OH)',
    unit: 'nmol/L',
    category: 'vitamins',
    aliases: ['vitamin d', '25-oh vitamin d', '25 hydroxy vitamin d', '25-hydroxyvitamin d'],
    ref: { low: 75, high: 250 },
    precision: 0,
    conversions: { 'ng/mL': 2.496 },
  },
  {
    key: 'vitamin_b12',
    label: 'Vitamin B12',
    unit: 'pmol/L',
    category: 'vitamins',
    aliases: ['vitamin b12', 'b12', 'cobalamin'],
    ref: { low: 156, high: 672 },
    precision: 0,
    conversions: { 'pg/mL': 0.738 },
  },
  {
    key: 'folate',
    label: 'Folate',
    unit: 'nmol/L',
    category: 'vitamins',
    aliases: ['folate', 'folic acid'],
    ref: { low: 10 },
    precision: 1,
    conversions: { 'ng/mL': 2.266 },
  },

  /* --------------------------------------------------------------- other -- */
  {
    key: 'psa',
    label: 'PSA',
    unit: 'µg/L',
    category: 'other',
    aliases: ['psa', 'prostate specific antigen'],
    ref: { high: 4.0 },
    precision: 2,
    conversions: { 'ng/mL': 1 },
  },
];

export const CATEGORY_LABELS: Record<MarkerCategory, string> = {
  hormones: 'Hormones',
  lipids: 'Lipids',
  metabolic: 'Metabolic',
  liver: 'Liver',
  kidney: 'Kidney & electrolytes',
  blood: 'Blood count',
  thyroid: 'Thyroid',
  inflammation: 'Inflammation',
  vitamins: 'Vitamins',
  other: 'Other',
};

const BY_KEY = new Map(BLOOD_MARKERS.map((m) => [m.key, m]));

export function markerDef(key: string): MarkerDef | undefined {
  return BY_KEY.get(key);
}

/**
 * Aliases longest-first, so "free testosterone" is matched before
 * "testosterone" and a report line is not mis-assigned to the shorter name.
 */
export const ALIAS_INDEX: Array<{ alias: string; key: string }> = BLOOD_MARKERS.flatMap((m) =>
  [...m.aliases, m.label.toLowerCase()].map((alias) => ({ alias: alias.toLowerCase(), key: m.key })),
).sort((a, b) => b.alias.length - a.alias.length);
