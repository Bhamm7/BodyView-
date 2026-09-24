/**
 * Text extraction from a lab PDF, in the browser.
 *
 * pdf.js is large, so it is imported only when a PDF is actually chosen —
 * the bundler gives it a chunk of its own and the app's first load never pays
 * for it. The file is read locally and nothing about it leaves the device,
 * which is the whole reason for doing this here rather than on a server.
 *
 * Only the text layer is read. A scanned report is a picture of a table with
 * no text in it, and rather than guess with OCR, the caller is told plainly
 * that there was nothing to read.
 */
export class PdfHasNoText extends Error {
  constructor() {
    super('That PDF has no text in it — it is probably a scan. Paste the numbers instead.');
    this.name = 'PdfHasNoText';
  }
}

interface TextItem {
  str?: string;
  transform?: number[];
}

/**
 * Rebuilds lines from positioned text runs.
 *
 * A PDF has no lines, only glyphs at coordinates, so runs are grouped by their
 * y position and sorted by x. Without this a report's columns arrive
 * interleaved and every parse is nonsense.
 */
function itemsToLines(items: TextItem[]): string[] {
  const rows = new Map<number, Array<{ x: number; text: string }>>();

  for (const item of items) {
    const text = item.str ?? '';
    if (!text.trim()) continue;
    const [, , , , x = 0, y = 0] = item.transform ?? [];
    // Round y so runs a hair apart still count as the same line.
    const key = Math.round(y / 2) * 2;
    const row = rows.get(key) ?? [];
    row.push({ x, text });
    rows.set(key, row);
  }

  return [...rows.entries()]
    .sort((a, b) => b[0] - a[0]) // PDF y grows upwards; the page reads downwards
    .map(([, row]) =>
      row
        .sort((a, b) => a.x - b.x)
        .map((cell) => cell.text)
        .join('  ')
        .replace(/\s{3,}/g, '  ')
        .trim(),
    )
    .filter(Boolean);
}

export async function extractPdfText(file: Blob): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.mjs',
    import.meta.url,
  ).toString();

  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data });
  const doc = await task.promise;

  const lines: string[] = [];
  try {
    for (let page = 1; page <= doc.numPages; page++) {
      const content = await (await doc.getPage(page)).getTextContent();
      lines.push(...itemsToLines(content.items as TextItem[]));
    }
  } finally {
    // Frees the worker; the report can be tens of pages of a hospital's fonts.
    await task.destroy();
  }

  const text = lines.join('\n');
  if (!text.replace(/\s/g, '')) throw new PdfHasNoText();
  return text;
}
