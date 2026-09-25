/**
 * Just enough of .xlsx to read a lab export, with no dependencies.
 *
 * A workbook is a ZIP of XML, and the browser can already do both halves:
 * `DecompressionStream('deflate-raw')` inflates the entries and `DOMParser`
 * reads the XML. A spreadsheet library would be several hundred kilobytes to
 * do the ninety per cent of the format this never touches — styles, formulas,
 * charts, writing — so the small part that matters lives here instead.
 *
 * What it handles: the central directory, stored and deflated entries, shared
 * strings, inline strings, literal strings and numbers. What it does not:
 * encryption, and the old binary .xls, which is a different format entirely.
 */
export class NotASpreadsheet extends Error {
  constructor(message = 'That file is not a spreadsheet this can read.') {
    super(message);
    this.name = 'NotASpreadsheet';
  }
}

export interface Sheet {
  name: string;
  /** Rows of trimmed cell text, padded so every row has the same width. */
  rows: string[][];
}

interface ZipEntry {
  name: string;
  method: number;
  offset: number;
  compressedSize: number;
}

const textOf = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

/**
 * Reads the ZIP central directory, which is at the end of the file and is the
 * only trustworthy index: local headers may leave sizes to a trailing
 * descriptor, and entries need not appear in any particular order.
 */
function readDirectory(view: DataView): ZipEntry[] {
  const size = view.byteLength;
  let eocd = -1;
  // The end record is 22 bytes plus up to 64KB of comment.
  for (let i = size - 22; i >= Math.max(0, size - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new NotASpreadsheet();

  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const entries: ZipEntry[] = [];

  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== 0x02014b50) break;
    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const offset = view.getUint32(at + 42, true);
    const name = textOf(new Uint8Array(view.buffer, view.byteOffset + at + 46, nameLength));
    entries.push({ name, method, offset, compressedSize });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function readEntry(bytes: Uint8Array, view: DataView, entry: ZipEntry): Promise<string> {
  const at = entry.offset;
  if (view.getUint32(at, true) !== 0x04034b50) throw new NotASpreadsheet();
  const nameLength = view.getUint16(at + 26, true);
  const extraLength = view.getUint16(at + 28, true);
  const start = at + 30 + nameLength + extraLength;
  const body = bytes.subarray(start, start + entry.compressedSize);

  if (entry.method === 0) return textOf(body);
  if (entry.method !== 8) throw new NotASpreadsheet('That spreadsheet uses compression this cannot read.');

  const part = body.slice() as unknown as BlobPart;
  const stream = new Blob([part]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return textOf(new Uint8Array(await new Response(stream).arrayBuffer()));
}

const children = (parent: Element | Document, local: string): Element[] =>
  [...parent.getElementsByTagName('*')].filter((el) => el.localName === local);

function parseXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) throw new NotASpreadsheet();
  return doc;
}

/** Column letters to a zero-based index: A → 0, Z → 25, AA → 26. */
function columnIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? '';
  let index = 0;
  for (const ch of letters) index = index * 26 + (ch.charCodeAt(0) - 64);
  return index - 1;
}

function sheetRows(doc: Document, shared: string[]): string[][] {
  const rows: string[][] = [];
  let width = 0;

  for (const row of children(doc, 'row')) {
    const cells: string[] = [];
    let position = 0;

    for (const cell of [...row.children].filter((c) => c.localName === 'c')) {
      const ref = cell.getAttribute('r');
      // Cells carry their address only in some writers; otherwise they are
      // simply in order, and a skipped cell would shift everything after it.
      const at = ref ? columnIndex(ref) : position;
      position = at + 1;

      const type = cell.getAttribute('t');
      let text = '';
      if (type === 'inlineStr') {
        text = children(cell, 't')
          .map((t) => t.textContent ?? '')
          .join('');
      } else {
        const raw = children(cell, 'v')[0]?.textContent ?? '';
        text = type === 's' ? (shared[Number(raw)] ?? '') : raw;
      }

      while (cells.length < at) cells.push('');
      cells[at] = text.trim();
    }

    width = Math.max(width, cells.length);
    rows.push(cells);
  }

  for (const row of rows) while (row.length < width) row.push('');
  return rows;
}

/** Reads every sheet in a workbook into rows of text. */
export async function readWorkbook(file: Blob): Promise<Sheet[]> {
  if (typeof DecompressionStream === 'undefined') {
    throw new NotASpreadsheet('This browser cannot open spreadsheets — export the report as CSV instead.');
  }

  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const entries = readDirectory(view);
  const find = (name: string) => entries.find((e) => e.name === name.replace(/^\//, ''));

  const workbookEntry = find('xl/workbook.xml');
  if (!workbookEntry) throw new NotASpreadsheet();
  const workbook = parseXml(await readEntry(bytes, view, workbookEntry));

  const sharedEntry = find('xl/sharedStrings.xml');
  const shared = sharedEntry
    ? children(parseXml(await readEntry(bytes, view, sharedEntry)), 'si').map((si) =>
        children(si, 't')
          .map((t) => t.textContent ?? '')
          .join(''),
      )
    : [];

  const relsEntry = find('xl/_rels/workbook.xml.rels');
  const targets = new Map<string, string>();
  if (relsEntry) {
    for (const rel of children(parseXml(await readEntry(bytes, view, relsEntry)), 'Relationship')) {
      const id = rel.getAttribute('Id');
      const target = rel.getAttribute('Target');
      if (id && target) targets.set(id, target.replace(/^\//, '').replace(/^(?!xl\/)/, 'xl/'));
    }
  }

  const sheets: Sheet[] = [];
  for (const sheet of children(workbook, 'sheet')) {
    const name = sheet.getAttribute('name') ?? `Sheet ${sheets.length + 1}`;
    const relId =
      sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ??
      sheet.getAttribute('r:id');
    const path = relId ? targets.get(relId) : undefined;
    const entry = path ? find(path) : undefined;
    if (!entry) continue;
    sheets.push({ name, rows: sheetRows(parseXml(await readEntry(bytes, view, entry)), shared) });
  }

  if (sheets.length === 0) throw new NotASpreadsheet();
  return sheets;
}

/**
 * Excel keeps dates as days since 1899-12-30. A cell that holds one looks like
 * any other number, so the caller decides when to try this — here, only for a
 * column whose header says it is a date.
 */
export function excelSerialToISODate(serial: number): string | undefined {
  if (!Number.isFinite(serial) || serial < 20000 || serial > 80000) return undefined;
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString().slice(0, 10);
}
