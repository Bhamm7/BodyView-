import { matchMarker, toCanonicalUnit, type MarkerDef } from './markers';

/**
 * Turns a pasted or extracted lab report into rows worth reviewing.
 *
 * Lab reports are printed for humans, so this is deliberately forgiving: it
 * takes whatever it recognises, marks what it is unsure of, and hands the lot
 * to a review screen rather than trying to be clever silently. Nothing is
 * saved without the numbers being looked at, so a wrong guess costs a tap, and
 * a missed line costs nothing at all.
 */
export interface ParsedRow {
  /** The name exactly as the report wrote it. */
  reportedName: string;
  /** Canonical marker key, when the name was recognised. */
  markerKey?: string;
  label: string;
  value: number;
  unit: string;
  low?: number;
  high?: number;
  /** The report's own out-of-range mark, if it printed one. */
  reportedFlag?: 'low' | 'high';
  /** The value was rewritten into the marker's canonical unit. */
  converted?: boolean;
  /** Included in the save. Unrecognised rows start off. */
  keep: boolean;
}

// Grouped thousands first — matching plain digits first would take "100"
// out of "1000" and quietly turn a reference range into nonsense.
const NUMBER = String.raw`-?\d{1,3}(?:[ ,]\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?|-?\.\d+`;

/** Units as labs print them; deliberately loose, and never matched on its own. */
const UNIT = String.raw`(?:x?10[*^]?\d*\s*\/?\s*[a-zA-Z]+|%|[a-zA-Zµμ][a-zA-Z0-9µμ·/%^*.\-]*(?:\/[a-zA-Z0-9.^*·\-]+)*)`;

const RANGE_SEP = String.raw`(?:\s*(?:-|–|—|to)\s*)`;

const toNumber = (raw: string): number => Number(raw.replace(/[ ,]/g, ''));

/** "<0.5" and ">90" carry a real number for charting; the operator is dropped. */
function stripOperator(raw: string): string {
  return raw.replace(/^[<>≤≥]\s*/, '');
}

function cleanName(raw: string): string {
  return raw
    .replace(/^[\s*•\-–—|]+/, '')
    .replace(/[\s:.\-–—|]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const FLAG = /\b(H|HIGH|L|LOW|A|ABNORMAL|CRITICAL)\b\s*$/i;

/**
 * Report furniture that happens to look like "name: number" — the collection
 * time, an accession number, a page count, the patient's own details. Reading
 * these as markers is harmless (they arrive unrecognised and switched off) but
 * it buries the real results in noise on the review screen.
 */
const METADATA =
  /^(collect|receiv|report|order|accession|requisition|specimen|sample|patient|name|dob|date of birth|age|sex|gender|phn|mrn|chart|health care|physician|provider|doctor|ordered by|copy to|page|printed|fax|phone|tel|address|location|lab|performed|final|status|comment|note|interpretation|method|analyzer)\b/i;

/** A value that is really a date or a clock time, not a result. */
function looksLikeDateOrTime(value: number, raw: string, tail: string): boolean {
  if (/^(19|20)\d{2}$/.test(raw.trim()) && /[-/]\d{1,2}[-/]/.test(tail)) return true;
  if (/^\d{1,2}:\d{2}/.test(tail.trim())) return true;
  return Number.isInteger(value) && value >= 1900 && value <= 2100 && /[-/:]/.test(tail);
}

function readFlag(tail: string): 'low' | 'high' | undefined {
  const match = tail.match(FLAG);
  if (!match) return undefined;
  const token = match[1].toUpperCase();
  if (token === 'H' || token === 'HIGH') return 'high';
  if (token === 'L' || token === 'LOW') return 'low';
  return undefined;
}

/**
 * One line, in the shapes reports actually use:
 *   Hemoglobin           152 g/L        (135 - 175)
 *   ALT  34  U/L  10 - 50  H
 *   Creatinine,serum: 86 umol/L  Reference: 62-106
 *   Estradiol 118 pmol/L
 *   TSH<tab>1.84<tab>mIU/L<tab>0.20-4.00
 */
function parseLine(line: string): ParsedRow | null {
  const text = line.replace(/\t/g, '  ').trim();
  if (!text || text.length > 200) return null;

  const pattern = new RegExp(
    String.raw`^(?<name>[A-Za-z][^0-9]{1,60}?)` +
      String.raw`[\s:=]+` +
      String.raw`(?<value>[<>≤≥]?\s*(?:${NUMBER}))` +
      String.raw`\s*(?<unit>${UNIT})?` +
      String.raw`(?<tail>.*)$`,
  );

  const m = text.match(pattern);
  if (!m?.groups) return null;

  const name = cleanName(m.groups.name ?? '');
  if (name.length < 2) return null;
  // A line that is mostly digits is a date stamp or an accession number.
  if (!/[a-z]{2}/i.test(name)) return null;
  if (METADATA.test(name)) return null;

  const rawValue = stripOperator((m.groups.value ?? '').trim());
  const value = toNumber(rawValue);
  if (!Number.isFinite(value)) return null;
  if (looksLikeDateOrTime(value, rawValue, m.groups.tail ?? '')) return null;

  let unit = (m.groups.unit ?? '').trim();
  const tail = m.groups.tail ?? '';

  // Reference ranges: "(135 - 175)", "Reference: 62-106", "135-175", ">1.0"
  const rangePattern = new RegExp(String.raw`(${NUMBER})${RANGE_SEP}(${NUMBER})`);
  const range = tail.match(rangePattern);
  let low: number | undefined;
  let high: number | undefined;
  if (range) {
    low = toNumber(range[1]);
    high = toNumber(range[2]);
  } else {
    const onlyHigh = tail.match(new RegExp(String.raw`[<≤]\s*(${NUMBER})`));
    const onlyLow = tail.match(new RegExp(String.raw`[>≥]\s*(${NUMBER})`));
    if (onlyHigh) high = toNumber(onlyHigh[1]);
    if (onlyLow) low = toNumber(onlyLow[1]);
  }
  if (low != null && high != null && low > high) [low, high] = [high, low];

  // A unit swallowed from the range text ("62" in "62-106") is not a unit.
  if (unit && /^\d/.test(unit)) unit = '';

  const def: MarkerDef | undefined = matchMarker(name);
  const canonical = def
    ? toCanonicalUnit(def, value, unit)
    : { value, unit, converted: false };

  // A converted value's range came in the old unit and has to move with it.
  const factor = canonical.converted && value !== 0 ? canonical.value / value : 1;

  return {
    reportedName: name,
    markerKey: def?.key,
    label: def?.label ?? name,
    value: Number(canonical.value.toPrecision(6)),
    unit: canonical.unit || def?.unit || '',
    low: low == null ? def?.range?.low : Number((low * factor).toPrecision(6)),
    high: high == null ? def?.range?.high : Number((high * factor).toPrecision(6)),
    reportedFlag: readFlag(tail),
    converted: canonical.converted || undefined,
    keep: !!def,
  };
}

/** Splits a CSV or TSV row, honouring simple quoted fields. */
function splitDelimited(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === delimiter && !quoted) {
      out.push(field);
      field = '';
    } else field += ch;
  }
  out.push(field);
  return out.map((f) => f.trim());
}

const HEADER_HINTS = {
  name: ['test', 'name', 'analyte', 'marker', 'component', 'description'],
  value: ['result', 'value', 'reading'],
  unit: ['unit', 'units', 'uom'],
  low: ['low', 'min', 'lower', 'range low', 'ref low'],
  high: ['high', 'max', 'upper', 'range high', 'ref high'],
  range: ['reference', 'reference range', 'ref range', 'normal range', 'range'],
  date: ['date', 'collected', 'collection date', 'drawn'],
};

const pick = (headers: string[], hints: string[]): number =>
  headers.findIndex((h) => hints.some((hint) => h === hint || h.includes(hint)));

/** A spreadsheet export: one row per marker, with headers naming the columns. */
function parseTable(text: string): { rows: ParsedRow[]; date?: string } | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return null;

  const delimiter = (lines[0].match(/\t/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? '\t' : ',';
  const headers = splitDelimited(lines[0], delimiter).map((h) => h.toLowerCase());
  const nameAt = pick(headers, HEADER_HINTS.name);
  const valueAt = pick(headers, HEADER_HINTS.value);
  if (nameAt < 0 || valueAt < 0) return null;

  const unitAt = pick(headers, HEADER_HINTS.unit);
  const lowAt = pick(headers, HEADER_HINTS.low);
  const highAt = pick(headers, HEADER_HINTS.high);
  const rangeAt = pick(headers, HEADER_HINTS.range);
  const dateAt = pick(headers, HEADER_HINTS.date);

  const rows: ParsedRow[] = [];
  let date: string | undefined;

  for (const line of lines.slice(1)) {
    const cells = splitDelimited(line, delimiter);
    const name = cleanName(cells[nameAt] ?? '');
    const rawValue = stripOperator((cells[valueAt] ?? '').trim());
    const value = toNumber(rawValue);
    if (!name || !Number.isFinite(value) || rawValue === '') continue;

    let low = lowAt >= 0 ? toNumber(cells[lowAt] ?? '') : NaN;
    let high = highAt >= 0 ? toNumber(cells[highAt] ?? '') : NaN;
    if (rangeAt >= 0 && (!Number.isFinite(low) || !Number.isFinite(high))) {
      const pair = (cells[rangeAt] ?? '').match(new RegExp(String.raw`(${NUMBER})${RANGE_SEP}(${NUMBER})`));
      if (pair) {
        low = toNumber(pair[1]);
        high = toNumber(pair[2]);
      }
    }

    if (dateAt >= 0 && !date) {
      const parsed = parseDate(cells[dateAt] ?? '');
      if (parsed) date = parsed;
    }

    const def = matchMarker(name);
    const unit = unitAt >= 0 ? (cells[unitAt] ?? '').trim() : '';
    const canonical = def ? toCanonicalUnit(def, value, unit) : { value, unit, converted: false };
    const factor = canonical.converted && value !== 0 ? canonical.value / value : 1;

    rows.push({
      reportedName: name,
      markerKey: def?.key,
      label: def?.label ?? name,
      value: Number(canonical.value.toPrecision(6)),
      unit: canonical.unit || def?.unit || '',
      low: Number.isFinite(low) ? Number((low * factor).toPrecision(6)) : def?.range?.low,
      high: Number.isFinite(high) ? Number((high * factor).toPrecision(6)) : def?.range?.high,
      converted: canonical.converted || undefined,
      keep: !!def,
    });
  }

  return rows.length > 0 ? { rows, date } : null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Pulls a collection date out of report text, in the formats labs print. */
export function parseDate(text: string): string | undefined {
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const named = text.match(/\b(\d{1,2})[ -]([A-Za-z]{3})[a-z]*[ -](20\d{2})\b/);
  if (named) {
    const month = MONTHS.indexOf(named[2].toLowerCase());
    if (month >= 0) {
      return `${named[3]}-${String(month + 1).padStart(2, '0')}-${named[1].padStart(2, '0')}`;
    }
  }

  const monthFirst = text.match(/\b([A-Za-z]{3})[a-z]*\.? (\d{1,2}),? (20\d{2})\b/);
  if (monthFirst) {
    const month = MONTHS.indexOf(monthFirst[1].toLowerCase());
    if (month >= 0) {
      return `${monthFirst[3]}-${String(month + 1).padStart(2, '0')}-${monthFirst[2].padStart(2, '0')}`;
    }
  }

  const slashed = text.match(/\b(20\d{2})\/(\d{1,2})\/(\d{1,2})\b/);
  if (slashed) {
    return `${slashed[1]}-${slashed[2].padStart(2, '0')}-${slashed[3].padStart(2, '0')}`;
  }
  return undefined;
}

export interface ParseResult {
  rows: ParsedRow[];
  /** Collection date found in the report, if any. */
  date?: string;
  /** How the text was read, so the review screen can say so. */
  shape: 'table' | 'lines';
}

/** Parses pasted text, a spreadsheet export, or text lifted out of a PDF. */
export function parseLabText(text: string): ParseResult {
  const table = parseTable(text);
  if (table) return { rows: dedupe(table.rows), date: table.date, shape: 'table' };

  const rows: ParsedRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    const row = parseLine(line);
    if (row) rows.push(row);
  }
  return { rows: dedupe(rows), date: parseDate(text), shape: 'lines' };
}

/**
 * One marker, one row. A report that prints a marker twice — a repeat, or the
 * same panel summarised at the top — should not become two points on a chart
 * with the same date; the first occurrence wins, which is the one in the
 * results table rather than the summary.
 */
function dedupe(rows: ParsedRow[]): ParsedRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = row.markerKey ?? `raw:${row.reportedName.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
