import { matchMarker, toCanonicalUnit, type MarkerDef } from './markers';
import { excelSerialToISODate } from './xlsx';

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

const toNumber = (raw: string): number => {
  // `Number('')` is 0, which would quietly turn an empty range column into a
  // range that starts at zero. A blank cell is an absent number, not a zero.
  const text = raw.replace(/[ ,]/g, '');
  return text === '' ? Number.NaN : Number(text);
};

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

/**
 * Column headers, most specific first.
 *
 * Order carries meaning: a MyHealth Records export has "Lab Group Name",
 * "Laboratory Name" and "Test Name", and only the last one names the analyte.
 * It also has both "Result" ("25 U/L") and "Structured Value" ("25"), and the
 * structured one is the number to trust. So each hint is tried as an exact
 * header before any of them is tried as a substring.
 */
const HEADER_HINTS = {
  name: ['test name', 'analyte', 'marker name', 'component', 'test', 'analyte name', 'name'],
  value: ['structured value', 'numeric result', 'value', 'result', 'reading'],
  unit: ['unit', 'units', 'uom'],
  low: ['reference range units minimum value', 'minimum value', 'range low', 'ref low', 'low', 'min'],
  high: ['reference range units maximum value', 'maximum value', 'range high', 'ref high', 'high', 'max'],
  range: ['reference range units', 'reference range', 'ref range', 'normal range', 'reference', 'range'],
  date: ['collection date', 'collected', 'date drawn', 'date', 'drawn'],
  /** Not a marker — the row's own status, used to skip cancelled results. */
  status: ['result status', 'status'],
};

const normalizeHeader = (text: string): string =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Exact header match for any hint first, then a contained one, in hint order. */
function pick(headers: string[], hints: string[]): number {
  for (const hint of hints) {
    const at = headers.indexOf(hint);
    if (at >= 0) return at;
  }
  for (const hint of hints) {
    const at = headers.findIndex((h) => h.includes(hint));
    if (at >= 0) return at;
  }
  return -1;
}

/**
 * Units as a report writes them, tidied so the same quantity from two labs
 * lands on one axis: "x10**9/L" and "10^9/L" are the same unit.
 */
export function normalizeUnit(unit: string): string {
  const text = unit.trim();
  if (!text) return '';
  return text
    .replace(/^x/i, '')
    .replace(/10\s*\*\*\s*(\d+)/i, '10^$1')
    .replace(/10\s*\^\s*(\d+)/i, '10^$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A measurement written as one string: "25 U/L", "<0.3 IU/L", "0.492". */
function readMeasure(text: string): { value: number; unit: string } | null {
  const match = text
    .trim()
    .match(new RegExp(String.raw`^[<>≤≥]?\s*=?\s*(${NUMBER})\s*(.*)$`));
  if (!match) return null;
  const value = toNumber(match[1]);
  if (!Number.isFinite(value)) return null;
  return { value, unit: normalizeUnit(match[2] ?? '') };
}

/**
 * A reference range as printed beside a result: "40-120 (U/L) U/L",
 * ">=1.00 (mmol/L)", "<70", ">59". The unit in brackets is dropped — it is the
 * result's unit repeated, and leaving it in would have the range's own digits
 * competing with the unit's.
 */
export function readRange(text: string): { low?: number; high?: number } {
  const cleaned = text.replace(/\((?:[^()]*)\)/g, ' ').trim();
  if (!cleaned) return {};

  const pair = cleaned.match(new RegExp(String.raw`(${NUMBER})${RANGE_SEP}(${NUMBER})`));
  if (pair) {
    let low = toNumber(pair[1]);
    let high = toNumber(pair[2]);
    if (low > high) [low, high] = [high, low];
    return { low, high };
  }

  const atMost = cleaned.match(new RegExp(String.raw`[<≤]\s*=?\s*(${NUMBER})`));
  if (atMost) return { high: toNumber(atMost[1]) };

  const atLeast = cleaned.match(new RegExp(String.raw`[>≥]\s*=?\s*(${NUMBER})`));
  if (atLeast) return { low: toNumber(atLeast[1]) };

  return {};
}

/** Builds a reviewable row from already-separated fields. */
function rowFromFields(fields: {
  name: string;
  value: number;
  unit: string;
  low?: number;
  high?: number;
}): ParsedRow {
  const def = matchMarker(fields.name);
  const canonical = def
    ? toCanonicalUnit(def, fields.value, fields.unit)
    : { value: fields.value, unit: fields.unit, converted: false };
  const factor = canonical.converted && fields.value !== 0 ? canonical.value / fields.value : 1;

  const scale = (bound?: number) =>
    bound == null ? undefined : Number((bound * factor).toPrecision(6));

  return {
    reportedName: fields.name,
    markerKey: def?.key,
    label: def?.label ?? fields.name,
    value: Number(canonical.value.toPrecision(6)),
    // No unit substituted when the report printed none: a lab that reports
    // iron saturation as 0.21 rather than 21% would otherwise be labelled "%"
    // by this table and read as a fifth of what it is.
    unit: normalizeUnit(canonical.unit),
    low: fields.low == null ? def?.range?.low : scale(fields.low),
    high: fields.high == null ? def?.range?.high : scale(fields.high),
    converted: canonical.converted || undefined,
    keep: !!def,
  };
}

/**
 * A table of results — a spreadsheet export, or a CSV.
 *
 * The header is not assumed to be the first row: an export usually opens with
 * a disclaimer, so the first row that looks like headers is the header. Rows
 * are grouped by their collection date, because one export routinely holds
 * years of draws and each draw is its own panel.
 */
function parseTable(rows: string[][]): ParseResult | null {
  if (rows.length < 2) return null;

  let headerAt = -1;
  let headers: string[] = [];
  let nameAt = -1;
  let valueAt = -1;

  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const candidate = rows[i].map(normalizeHeader);
    const name = pick(candidate, HEADER_HINTS.name);
    const value = pick(candidate, HEADER_HINTS.value);
    if (name >= 0 && value >= 0 && name !== value) {
      headerAt = i;
      headers = candidate;
      nameAt = name;
      valueAt = value;
      break;
    }
  }
  if (headerAt < 0) return null;

  const unitAt = pick(headers, HEADER_HINTS.unit);
  const lowAt = pick(headers, HEADER_HINTS.low);
  const highAt = pick(headers, HEADER_HINTS.high);
  const rangeAt = pick(headers, HEADER_HINTS.range);
  const dateAt = pick(headers, HEADER_HINTS.date);
  const statusAt = pick(headers, HEADER_HINTS.status);
  // The column the structured value was taken from may leave censored results
  // ("<0.3 IU/L") empty, with the text sitting in a plainer result column.
  const textValueAt = pick(headers, ['result', 'reading', 'value']);

  const byDate = new Map<string, ParsedRow[]>();
  let any = false;

  for (const cells of rows.slice(headerAt + 1)) {
    const name = cleanName(cells[nameAt] ?? '');
    if (!name || METADATA.test(name)) continue;

    const status = statusAt >= 0 ? (cells[statusAt] ?? '').toLowerCase() : '';
    if (/cancel|pending|in progress/.test(status)) continue;

    let measure = readMeasure(cells[valueAt] ?? '');
    if (!measure && textValueAt >= 0 && textValueAt !== valueAt) {
      measure = readMeasure(cells[textValueAt] ?? '');
    }
    if (!measure) continue;

    let unit = unitAt >= 0 ? normalizeUnit(cells[unitAt] ?? '') : '';
    if (!unit) unit = measure.unit;

    let low = lowAt >= 0 ? toNumber(cells[lowAt] ?? '') : NaN;
    let high = highAt >= 0 ? toNumber(cells[highAt] ?? '') : NaN;
    if ((!Number.isFinite(low) || !Number.isFinite(high)) && rangeAt >= 0) {
      const parsed = readRange(cells[rangeAt] ?? '');
      if (!Number.isFinite(low) && parsed.low != null) low = parsed.low;
      if (!Number.isFinite(high) && parsed.high != null) high = parsed.high;
    }

    const row = rowFromFields({
      name,
      value: measure.value,
      unit,
      low: Number.isFinite(low) ? low : undefined,
      high: Number.isFinite(high) ? high : undefined,
    });

    const date = dateAt >= 0 ? readDateCell(cells[dateAt] ?? '') : undefined;
    const key = date ?? '';
    byDate.set(key, [...(byDate.get(key) ?? []), row]);
    any = true;
  }

  if (!any) return null;

  const draws = [...byDate.entries()]
    .map(([date, list]) => ({ date: date || undefined, rows: dedupe(list) }))
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));

  return { draws, shape: 'table' };
}

/** A date cell: text a person would recognise, or an Excel serial number. */
function readDateCell(text: string): string | undefined {
  const direct = parseDate(text);
  if (direct) return direct;
  const serial = Number(text);
  return Number.isFinite(serial) ? excelSerialToISODate(serial) : undefined;
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

/** One blood draw's worth of rows, as read from a report. */
export interface ParsedDraw {
  /** Collection date, when the report gave one. */
  date?: string;
  rows: ParsedRow[];
}

export interface ParseResult {
  /**
   * A draw per collection date. A pasted page is one draw; a portal export is
   * routinely years of them, and splitting on the date is what makes each one
   * a panel rather than a single implausible draw with six hemoglobins in it.
   */
  draws: ParsedDraw[];
  /** How the report was read, so the review screen can say so. */
  shape: 'table' | 'lines';
}

/** Splits a delimited text file into rows, then reads it as a table. */
function textToRows(text: string): string[][] | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return null;
  const tabs = lines[0].match(/\t/g)?.length ?? 0;
  const commas = lines[0].match(/,/g)?.length ?? 0;
  if (tabs === 0 && commas === 0) return null;
  const delimiter = tabs > commas ? '\t' : ',';
  return lines.map((line) => splitDelimited(line, delimiter));
}

/** Parses pasted text, a CSV export, or text lifted out of a PDF. */
export function parseLabText(text: string): ParseResult {
  const rows = textToRows(text);
  if (rows) {
    const table = parseTable(rows);
    if (table) return table;
  }

  const lineRows: ParsedRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    const row = parseLine(line);
    if (row) lineRows.push(row);
  }
  return {
    draws: [{ date: parseDate(text), rows: dedupe(lineRows) }],
    shape: 'lines',
  };
}

/** Parses a sheet already split into cells — a spreadsheet export. */
export function parseLabRows(rows: string[][]): ParseResult | null {
  return parseTable(rows);
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
