/**
 * Domain model for BodyView.
 *
 * Everything is stored locally in IndexedDB. Ids are string UUIDs so records
 * stay stable across export/import and any future sync backend.
 */

export type ID = string;

/** Calendar day in ISO `YYYY-MM-DD`, always in the user's local timezone. */
export type ISODate = string;

/** Full ISO timestamp, used for ordering within a day. */
export type ISODateTime = string;

/* ------------------------------------------------------------------ */
/* Body metrics                                                        */
/* ------------------------------------------------------------------ */

export type MetricKey =
  | 'weight'
  | 'bodyFat'
  | 'bloodPressure'
  | 'restingHr'
  | 'hrv'
  | 'sleep'
  | 'steps'
  | 'waist'
  | 'temperature'
  | 'glucose'
  | 'mood'
  | 'energy';

/** A metric can capture more than one number (blood pressure captures two). */
export interface MetricField {
  key: string;
  label: string;
  /** Short label used on compact chart axes and tiles. */
  short?: string;
  min: number;
  max: number;
  step: number;
  /** Optional per-field unit; falls back to the metric unit. */
  unit?: string;
  color: string;
}

export interface MetricDef {
  key: MetricKey;
  label: string;
  unit: string;
  /** Units this metric can be displayed in, if convertible. */
  unitSystem?: 'mass' | 'length';
  icon: string;
  fields: MetricField[];
  /** Lower values are better (resting HR, body fat, blood pressure). */
  lowerIsBetter?: boolean;
  /** Higher values are better (sleep, HRV, steps). Metrics with neither set —
   *  body weight, temperature — are shown neutrally, since the desirable
   *  direction depends on the user's goal. */
  higherIsBetter?: boolean;
  /** Suggested healthy band, drawn as a reference area on charts. */
  band?: { from: number; to: number; field?: string };
  precision: number;
}

export interface MetricEntry {
  id: ID;
  metric: MetricKey;
  date: ISODate;
  /** Recorded moment; multiple readings per day are allowed. */
  recordedAt: ISODateTime;
  /** Field key -> value, e.g. `{ systolic: 118, diastolic: 76 }`. */
  values: Record<string, number>;
  note?: string;
}

/* ------------------------------------------------------------------ */
/* Compounds, protocols and dosing                                     */
/* ------------------------------------------------------------------ */

export type CompoundCategory =
  | 'peptide'
  | 'ped'
  | 'vitamin'
  | 'supplement'
  | 'medication'
  | 'ancillary';

export type DoseUnit = 'mg' | 'mcg' | 'iu' | 'ml' | 'g' | 'capsule' | 'tablet' | 'drop';

export type Route =
  | 'oral'
  | 'subcutaneous'
  | 'intramuscular'
  | 'topical'
  | 'nasal'
  | 'sublingual';

export interface Compound {
  id: ID;
  name: string;
  category: CompoundCategory;
  /** Default dose used when creating a protocol or logging ad-hoc. */
  defaultDose?: number;
  defaultUnit: DoseUnit;
  route?: Route;
  /** Half-life in hours, used to sketch active levels. */
  halfLifeHours?: number;
  color: string;
  notes?: string;
  archived?: boolean;
}

/**
 * How often a protocol is taken. `everyNDays` covers ED/EOD/E3D, `weekdays`
 * covers "Mon/Thu" style splits, and `cycling` covers N days on / N days off.
 */
export type ScheduleKind = 'everyNDays' | 'weekdays' | 'cycling';

export interface Schedule {
  kind: ScheduleKind;
  /** everyNDays: 1 = every day, 2 = every other day, ... */
  intervalDays?: number;
  /** weekdays: 0 = Sunday .. 6 = Saturday. */
  days?: number[];
  /** cycling: days on, then days off, repeating from the protocol start. */
  daysOn?: number;
  daysOff?: number;
  /** Doses taken per scheduled day. */
  timesPerDay: number;
}

export interface Protocol {
  id: ID;
  compoundId: ID;
  name?: string;
  dose: number;
  unit: DoseUnit;
  schedule: Schedule;
  startDate: ISODate;
  /** Open-ended when omitted (e.g. an ongoing vitamin). */
  endDate?: ISODate;
  /** Optional titration notes, injection site rotation, etc. */
  notes?: string;
  /** Groups protocols into a named cycle, e.g. "Spring recomp". */
  cycleId?: ID;
  active: boolean;
}

export interface Cycle {
  id: ID;
  name: string;
  startDate: ISODate;
  endDate?: ISODate;
  goal?: string;
  notes?: string;
  color: string;
}

export interface DoseLog {
  id: ID;
  compoundId: ID;
  protocolId?: ID;
  date: ISODate;
  takenAt: ISODateTime;
  dose: number;
  unit: DoseUnit;
  /** Which of the day's scheduled doses this satisfies (0-based). */
  slot?: number;
  site?: string;
  note?: string;
  /** Explicitly recorded as skipped rather than taken. */
  skipped?: boolean;
}

/* ------------------------------------------------------------------ */
/* Inventory                                                           */
/* ------------------------------------------------------------------ */

export type InventoryForm = 'vial' | 'capsule' | 'tablet' | 'powder' | 'liquid' | 'pen' | 'other';

export interface InventoryItem {
  id: ID;
  compoundId: ID;
  label?: string;
  form: InventoryForm;
  /**
   * Remaining quantity expressed in `unit`. For a 10 mg vial part-way through,
   * this is the milligrams left, not the number of vials.
   */
  remaining: number;
  unit: DoseUnit;
  /** Quantity when the item was opened/received, for a "% left" readout. */
  initial: number;
  /** Units of unopened stock still in the box, multiplied by `initial`. */
  sealedCount?: number;
  vendor?: string;
  lot?: string;
  cost?: number;
  purchasedOn?: ISODate;
  expiresOn?: ISODate;
  /** Warn when projected days remaining drops below this. */
  reorderDays?: number;
  notes?: string;
}

/* ------------------------------------------------------------------ */
/* Nutrition                                                           */
/* ------------------------------------------------------------------ */

export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'preworkout' | 'postworkout';

export interface Macros {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number;
}

export interface Food {
  id: ID;
  name: string;
  brand?: string;
  /** Amount of one serving, e.g. 100 with `servingUnit: 'g'`. */
  servingSize: number;
  servingUnit: string;
  /** Macros for exactly one serving. */
  per: Macros;
  favorite?: boolean;
  archived?: boolean;
}

export interface MealEntry {
  id: ID;
  date: ISODate;
  slot: MealSlot;
  foodId?: ID;
  /** Free-text name when the entry is not from the food library. */
  name: string;
  servings: number;
  macros: Macros;
  loggedAt: ISODateTime;
  note?: string;
}

/** A reusable day of eating the user can apply to a date. */
export interface MealPlan {
  id: ID;
  name: string;
  notes?: string;
  items: Array<{
    slot: MealSlot;
    foodId?: ID;
    name: string;
    servings: number;
    macros: Macros;
  }>;
}

export interface NutritionTarget {
  id: ID;
  name: string;
  macros: Macros;
  active: boolean;
}

/* ------------------------------------------------------------------ */
/* Training                                                            */
/* ------------------------------------------------------------------ */

export type MuscleGroup =
  | 'chest'
  | 'back'
  | 'shoulders'
  | 'biceps'
  | 'triceps'
  | 'quads'
  | 'hamstrings'
  | 'glutes'
  | 'calves'
  | 'core'
  | 'forearms'
  | 'fullBody'
  | 'cardio';

export type ExerciseKind = 'strength' | 'cardio' | 'bodyweight' | 'timed';

export interface Exercise {
  id: ID;
  name: string;
  kind: ExerciseKind;
  muscle: MuscleGroup;
  equipment?: string;
  /** Tracked as a main lift: surfaced on the PR board and strength charts. */
  primary?: boolean;
  notes?: string;
  archived?: boolean;
}

export interface WorkoutTemplate {
  id: ID;
  name: string;
  notes?: string;
  items: Array<{
    exerciseId: ID;
    targetSets: number;
    targetReps?: string;
    targetWeight?: number;
    restSeconds?: number;
    note?: string;
  }>;
}

export interface Workout {
  id: ID;
  date: ISODate;
  name: string;
  /** Muscle groups / session type, from TRAINING_TAGS. */
  tags?: string[];
  templateId?: ID;
  startedAt: ISODateTime;
  finishedAt?: ISODateTime;
  bodyweight?: number;
  /** How the session went: how you felt, equipment you could not get. */
  notes?: string;
  /**
   * Per-exercise notes, keyed by the block's `order` within this workout —
   * setup details like shoe choice, wedge height or depth, which belong to the
   * movement for the whole session rather than to one set.
   */
  exerciseNotes?: Record<string, string>;
  /** Session RPE 1-10. */
  rpe?: number;
}

export interface SetLog {
  id: ID;
  workoutId: ID;
  exerciseId: ID;
  /** Ordering of exercises within the session. */
  order: number;
  setIndex: number;
  weight?: number;
  reps?: number;
  /** Seconds, for timed/cardio work. */
  duration?: number;
  /** Metres, for cardio. */
  distance?: number;
  rpe?: number;
  warmup?: boolean;
  done: boolean;
  note?: string;
}

/* ------------------------------------------------------------------ */
/* Bloodwork                                                           */
/* ------------------------------------------------------------------ */

/** One blood draw. Results hang off it and share its date. */
export interface BloodPanel {
  id: ID;
  date: ISODate;
  /** Where it came from, e.g. "MyHealth Alberta" or a clinic name. */
  lab?: string;
  /** How it got in, for the user's own reference. */
  source?: 'manual' | 'paste' | 'csv';
  notes?: string;
  updatedAt?: number;
}

export interface BloodResult {
  id: ID;
  panelId: ID;
  /** Copied from the panel so a day or chart query needs no join. */
  date: ISODate;
  /** Catalogue key, or `custom:<slug>` for a marker we do not know. */
  marker: string;
  /** The name exactly as printed on the report. */
  label: string;
  value: number;
  /** The unit as reported; converted to the marker's canonical unit to chart. */
  unit: string;
  /** The lab's own reference interval, which beats any built-in one. */
  refLow?: number;
  refHigh?: number;
  note?: string;
  updatedAt?: number;
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export type WeightUnit = 'kg' | 'lb';
export type LengthUnit = 'cm' | 'in';

export type ThemePref = 'auto' | 'dark' | 'light';

export interface Settings {
  id: 'settings';
  theme: ThemePref;
  weightUnit: WeightUnit;
  lengthUnit: LengthUnit;
  /** 0 = Sunday, 1 = Monday. */
  weekStartsOn: 0 | 1;
  heightCm?: number;
  birthYear?: number;
  /** Metrics pinned to the dashboard, in display order. */
  dashboardMetrics: MetricKey[];
  seededAt?: ISODateTime;
  /** Version of the built-in catalogues this device has taken in. */
  catalogueVersion?: number;
}
