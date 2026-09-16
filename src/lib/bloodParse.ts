import { ALIAS_INDEX, markerDef } from '@/db/bloodMarkers';

/**
 * Parser for lab results pasted or uploaded from a patient portal.
 *
 * Lab reports have no standard machine format, so this is deliberately
 * forgiving: it reads one line at a time, finds a marker name, a number, a
 * unit and — where present — the lab's own reference interval. Anything it
 * cannot place is returned as an unmatched line rather than dropped, so the
 * review step can show the user exactly what did not import.
 *
 * It never guesses a value. A line without a clearly parseable number is
 * skipped, on the grounds that a missing result is recoverable and a wrong one
 * is not.
 */

export interface ParsedResult {
  /** Catalogue key, or `custom:<slug>` when the name is not recognised. */
  marker: string;
  /** The name as printed on the report. */
  label: string;
  value: number;
  unit: string;
  refLow?: number;
  refHigh?: number;
  /** True when the marker name matched the catalogue. */
  known: boolean;
  /** The line this came from, for the review table. */
  source: string;
}

export interface ParseOutcome {
  results: ParsedResult[];
  /** Lines that looked like data but could not be read. */
  unmatched: string[];
  /** Collection date found in the text, if any. */
  date?: string;
}

/** Units seen on lab reports, longest first so "10^9/L" beats "L". */
const UNIT_PATTERN = String.raw`(?:x?\s*10\^?\d+\s*\/\s*[a-zA-Z]+|[a-zA-Zµu%]+\s*\/\s*[a-zA-Z0-9.²\s]+|mmol|mg|µg|ug|ng|pg|nmol|pmol|µmol|umol|g|%|ratio)`;

const NUMBER = String.raw`-?\d+(?:[.,]\d+)?`;

/** Lines that are headings, footers or commentary rather than results. */
const NOISE = [
  /^(name|patient|dob|date of birth|ordering|physician|provider|collected|received|reported|accession|specimen|report|page|lab|comment|note|status|final|preliminary|test\s+result|result\s+unit)/i,
  /^[-=_*\s]+$/,
  /^\d+\s*$/,
];

const isNoise = (line: string) => NOISE.some((re) => re.test(line.trim()));

function toNumber(raw: string): number | null {
  const value = Number(raw.replace(/,/g, '.').trim());
  return Number.isFinite(value) ? value : null;
}

function slug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48);
}

/** Lowercase, punctuation to spaces, collapsed — "Testosterone, Total" -> "testosterone total". */
function normalizeName(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9^]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Sample-type prefixes that carry no meaning for identifying the marker. */
const LEADING_NOISE = new Set(['serum', 'plasma', 'blood', 'whole', 's', 'p', 'b']);

const ALIAS_LOOKUP = new Map<string, string>();
for (const { alias, key } of ALIAS_INDEX) {
  const normalized = normalizeName(alias);
  // ALIAS_INDEX is longest-first; keep the first (longest) claim on a name.
  if (!ALIAS_LOOKUP.has(normalized)) ALIAS_LOOKUP.set(normalized, key);
}

/**
 * Identifies a marker from its printed name.
 *
 * Matching is on the *whole* name, not a substring. Substring matching reads
 * "Reticulocyte Haemoglobin" as plain haemoglobin and files a reticulocyte
 * value into the haemoglobin series — a silently wrong chart, which is worse
 * than an unrecognised marker the review step will show the user.
 *
 * Trailing words are dropped one at a time so "TSH Reflex" still resolves, and
 * a few meaningless sample-type prefixes are stripped so "Serum Testosterone"
 * does. Leading words are otherwise kept, since those are the qualifiers that
 * change what a marker actually is.
 */
export function matchMarker(text: string): { key: string; known: boolean } {
  const normalized = normalizeName(text);
  if (!normalized) return { key: `custom:${slug(text)}`, known: false };

  let words = normalized.split(' ');
  while (words.length > 1 && LEADING_NOISE.has(words[0])) words = words.slice(1);

  for (let end = words.length; end > 0; end--) {
    const candidate = words.slice(0, end).join(' ');
    const key = ALIAS_LOOKUP.get(candidate);
    if (key) return { key, known: true };
  }

  return { key: `custom:${slug(text)}`, known: false };
}

/** Pulls a reference interval out of the trailing part of a line. */
function parseReference(tail: string): { refLow?: number; refHigh?: number } {
  // "(3.5 - 5.1)", "[3.5-5.1]", "Ref: 3.5 - 5.1"
  const range = tail.match(
    new RegExp(String.raw`[\(\[]?\s*(${NUMBER})\s*[-–—]\s*(${NUMBER})\s*[\)\]]?`),
  );
  if (range) {
    const low = toNumber(range[1]);
    const high = toNumber(range[2]);
    if (low != null && high != null && high >= low) return { refLow: low, refHigh: high };
  }

  const below = tail.match(new RegExp(String.raw`[<≤]\s*(${NUMBER})`));
  if (below) {
    const high = toNumber(below[1]);
    if (high != null) return { refHigh: high };
  }

  const above = tail.match(new RegExp(String.raw`[>≥]\s*(${NUMBER})`));
  if (above) {
    const low = toNumber(above[1]);
    if (low != null) return { refLow: low };
  }

  return {};
}

/** Finds a collection date anywhere in the report header. */
export function findDate(text: string): string | undefined {
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const months: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };
  // "12 Mar 2026" / "Mar 12, 2026"
  const dmy = text.match(/\b(\d{1,2})[\s-]([A-Za-z]{3})[a-z]*[\s,-]+(20\d{2})\b/);
  if (dmy && months[dmy[2].toLowerCase()]) {
    return `${dmy[3]}-${months[dmy[2].toLowerCase()]}-${dmy[1].padStart(2, '0')}`;
  }
  const mdy = text.match(/\b([A-Za-z]{3})[a-z]*\s+(\d{1,2})[\s,]+(20\d{2})\b/);
  if (mdy && months[mdy[1].toLowerCase()]) {
    return `${mdy[3]}-${months[mdy[1].toLowerCase()]}-${mdy[2].padStart(2, '0')}`;
  }
  return undefined;
}

/** Reads one line. Returns null when it holds no usable result. */
export function parseLine(line: string): ParsedResult | null {
  const trimmed = line.replace(/\s+/g, ' ').trim();
  if (!trimmed || isNoise(trimmed)) return null;

  // The name is whatever precedes the first standalone number.
  const valueMatch = trimmed.match(
    new RegExp(String.raw`^(.*?)(?:[:\t]|\s)\s*(${NUMBER})(?!\S*[-–—]\s*\d)\s*(${UNIT_PATTERN})?(.*)$`),
  );
  if (!valueMatch) return null;

  const [, rawLabel, rawValue, rawUnit = '', tail = ''] = valueMatch;
  const label = rawLabel.replace(/[:\-–—\s]+$/, '').trim();
  if (!label || /^\d+$/.test(label)) return null;

  const value = toNumber(rawValue);
  if (value == null) return null;

  const { key, known } = matchMarker(label);
  const def = known ? markerDef(key) : undefined;

  // Fall back to the catalogue's unit when the report omits it, which happens
  // in tabular exports where the unit sits in a separate column.
  const unit = rawUnit.replace(/\s+/g, '').trim() || def?.unit || '';

  return {
    marker: key,
    label,
    value,
    unit,
    known,
    source: trimmed,
    ...parseReference(tail),
  };
}

/** Parses a whole pasted report. */
export function parseReport(text: string): ParseOutcome {
  const results: ParsedResult[] = [];
  const unmatched: string[] = [];

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || isNoise(trimmed)) continue;

    const parsed = parseLine(trimmed);
    if (parsed) {
      results.push(parsed);
    } else if (/\d/.test(trimmed)) {
      // Held back rather than dropped: the review step shows these so nothing
      // disappears without the user seeing it.
      unmatched.push(trimmed);
    }
  }

  return { results, unmatched, date: findDate(text) };
}

/** Parses a CSV export: marker, value, unit, then optional reference columns. */
export function parseCsv(text: string): ParseOutcome {
  const rows = text.split(/\r?\n/).filter((r) => r.trim());
  if (rows.length === 0) return { results: [], unmatched: [] };

  /** Splits a CSV row, respecting quoted fields that contain commas. */
  const split = (row: string): string[] => {
    const cells: string[] = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < row.length; i++) {
      const char = row[i];
      if (char === '"') {
        if (quoted && row[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = !quoted;
        }
      } else if (char === ',' && !quoted) {
        cells.push(cell.trim());
        cell = '';
      } else {
        cell += char;
      }
    }
    cells.push(cell.trim());
    return cells;
  };

  const header = split(rows[0]).map((h) => h.toLowerCase());
  const looksLikeHeader = header.some((h) => /test|marker|name|analyte|result|value/.test(h));
  const column = (...names: string[]) => {
    for (const name of names) {
      const i = header.findIndex((h) => h.includes(name));
      if (i >= 0) return i;
    }
    return -1;
  };

  const nameCol = looksLikeHeader ? column('test', 'marker', 'analyte', 'name') : 0;
  const valueCol = looksLikeHeader ? column('result', 'value') : 1;
  const unitCol = looksLikeHeader ? column('unit') : 2;
  const lowCol = looksLikeHeader ? column('low', 'min', 'ref low') : -1;
  const highCol = looksLikeHeader ? column('high', 'max', 'ref high') : -1;

  const results: ParsedResult[] = [];
  const unmatched: string[] = [];

  for (const row of rows.slice(looksLikeHeader ? 1 : 0)) {
    const cells = split(row);
    const label = cells[nameCol >= 0 ? nameCol : 0]?.trim();
    const value = toNumber(cells[valueCol >= 0 ? valueCol : 1] ?? '');
    if (!label || value == null) {
      if (label || /\d/.test(row)) unmatched.push(row);
      continue;
    }

    const { key, known } = matchMarker(label);
    const def = known ? markerDef(key) : undefined;
    const refLow = lowCol >= 0 ? toNumber(cells[lowCol] ?? '') : null;
    const refHigh = highCol >= 0 ? toNumber(cells[highCol] ?? '') : null;

    results.push({
      marker: key,
      label,
      value,
      unit: (unitCol >= 0 ? cells[unitCol] : '')?.trim() || def?.unit || '',
      known,
      source: row,
      refLow: refLow ?? undefined,
      refHigh: refHigh ?? undefined,
    });
  }

  return { results, unmatched, date: findDate(text) };
}
