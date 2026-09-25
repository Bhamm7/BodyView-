import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, uid } from '@/db/db';
import type { LabPanel, LabResult } from '@/db/types';
import { parseLabRows, parseLabText, type ParsedDraw, type ParsedRow } from '@/lib/labParse';
import { readWorkbook } from '@/lib/xlsx';
import { extractPdfText } from '@/lib/pdfText';
import { markerDef, rangeStatus } from '@/lib/markers';
import { formatDay, today } from '@/lib/date';
import { num } from '@/lib/format';
import { Field, NumberInput, Sheet, useToast } from './ui';

type Stage = 'input' | 'review';

/** A draw as it sits on the review screen, before anything is written. */
interface Draft {
  date: string;
  label: string;
  rows: ParsedRow[];
  include: boolean;
  /** A panel with this date is already on file. */
  duplicate: boolean;
}

const countRows = (result: { draws: ParsedDraw[] }): number =>
  result.draws.reduce((total, draw) => total + draw.rows.length, 0);

/**
 * Brings a blood draw in from a report.
 *
 * Whatever the source — pasted text, a spreadsheet export, a PDF — it lands on
 * the same review table before anything is saved. Parsing someone's lab report
 * is guesswork at the edges, and the cost of a silent mistake here is a chart
 * that quietly lies for years, so every row is shown with what it was read as
 * and can be corrected or dropped.
 */
export function LabImportSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);

  const existing = useLiveQuery(() => db.labPanels.toArray(), [], []) ?? [];

  const [stage, setStage] = useState<Stage>('input');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [draws, setDraws] = useState<Draft[]>([]);
  const [fileName, setFileName] = useState<string | undefined>();
  const [source, setSource] = useState<LabPanel['source']>('paste');
  const [openDraw, setOpenDraw] = useState<number | null>(0);

  const reset = () => {
    setStage('input');
    setText('');
    setDraws([]);
    setFileName(undefined);
    setSource('paste');
    setOpenDraw(0);
  };

  const close = () => {
    reset();
    onClose();
  };

  const alreadyImported = (date?: string) =>
    !!date && existing.some((panel) => panel.date === date);

  const review = (parsed: ParsedDraw[], from: LabPanel['source'], name?: string) => {
    const usable = parsed.filter((draw) => draw.rows.length > 0);
    if (usable.length === 0) {
      toast.show('No results found in that — check it looks like a list of markers.');
      return;
    }
    setDraws(
      usable.map((draw) => ({
        date: draw.date ?? today(),
        label: '',
        rows: draw.rows,
        // A draw already on file is left off, rather than silently doubled.
        include: !alreadyImported(draw.date),
        duplicate: alreadyImported(draw.date),
      })),
    );
    setSource(from);
    setFileName(name);
    setOpenDraw(usable.length === 1 ? 0 : null);
    setStage('review');
  };

  const readFile = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      const name = file.name.toLowerCase();
      if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) {
        // A portal export is a workbook of everything it holds; only the sheet
        // that parses as results is of interest, and it is rarely the first.
        const sheets = await readWorkbook(file);
        const parsed = sheets
          .map((sheet) => parseLabRows(sheet.rows))
          .filter((r): r is NonNullable<typeof r> => r != null)
          .sort((a, b) => countRows(b) - countRows(a))[0];
        if (!parsed) {
          toast.show('No results sheet in that workbook — check it is the lab results export.');
          return;
        }
        review(parsed.draws, 'file', file.name);
        return;
      }

      const raw =
        file.type === 'application/pdf' || name.endsWith('.pdf')
          ? await extractPdfText(file)
          : await file.text();
      review(parseLabText(raw).draws, 'file', file.name);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'That file could not be read.');
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const patchDraw = (index: number, changes: Partial<Draft>) =>
    setDraws((prev) => prev.map((d, i) => (i === index ? { ...d, ...changes } : d)));

  const patchRow = (drawIndex: number, rowIndex: number, changes: Partial<ParsedRow>) =>
    setDraws((prev) =>
      prev.map((draw, i) =>
        i === drawIndex
          ? { ...draw, rows: draw.rows.map((r, j) => (j === rowIndex ? { ...r, ...changes } : r)) }
          : draw,
      ),
    );

  const keptIn = (draw: Draft) => draw.rows.filter((r) => r.keep);
  const included = draws.filter((d) => d.include && keptIn(d).length > 0);
  const totalKeeping = included.reduce((total, draw) => total + keptIn(draw).length, 0);

  const save = async () => {
    if (included.length === 0) return;

    const panels: LabPanel[] = [];
    const results: LabResult[] = [];

    for (const draw of included) {
      const panel: LabPanel = {
        id: uid(),
        date: draw.date,
        label: draw.label.trim() || undefined,
        source,
        fileName,
      };
      panels.push(panel);
      for (const row of keptIn(draw)) {
        results.push({
          id: uid(),
          panelId: panel.id,
          marker: row.markerKey,
          reportedName: row.reportedName,
          label: row.label,
          value: row.value,
          unit: row.unit,
          low: row.low,
          high: row.high,
        });
      }
    }

    await db.transaction('rw', [db.labPanels, db.labResults], async () => {
      await db.labPanels.bulkAdd(panels);
      await db.labResults.bulkAdd(results);
    });
    toast.show(
      panels.length === 1
        ? `${results.length} results saved`
        : `${results.length} results across ${panels.length} draws`,
    );
    close();
  };

  return (
    <Sheet
      open={open}
      title={stage === 'input' ? 'Import bloodwork' : 'Check the numbers'}
      onClose={close}
      footer={
        stage === 'input' ? (
          <>
            <button className="btn" onClick={close}>
              Cancel
            </button>
            <button
              className="btn primary"
              disabled={!text.trim() || busy}
              onClick={() => review(parseLabText(text).draws, 'paste')}
            >
              Read it
            </button>
          </>
        ) : (
          <>
            <button className="btn" onClick={() => setStage('input')}>
              Back
            </button>
            <button className="btn primary" onClick={save} disabled={totalKeeping === 0}>
              Save {totalKeeping}
              {included.length > 1 ? ` · ${included.length} draws` : ''}
            </button>
          </>
        )
      }
    >
      {stage === 'input' ? (
        <>
          <Field
            label="From a file"
            hint="The spreadsheet or PDF export from MyHealth Records, or any lab report. It is read here on your device and nothing about it is uploaded."
          >
            <button className="btn block" disabled={busy} onClick={() => fileInput.current?.click()}>
              {busy ? 'Reading…' : 'Choose a spreadsheet or PDF'}
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".xlsx,.xlsm,.pdf,.csv,.tsv,.txt,application/pdf,text/csv,text/plain"
              hidden
              onChange={(e) => readFile(e.target.files?.[0])}
            />
          </Field>

          <Field label="Or paste the results" hint="Select the results in the report and paste them here">
            <textarea
              className="textarea"
              rows={8}
              value={text}
              placeholder={'Hemoglobin      152 g/L      (135 - 175)\nALT             34 U/L       (10 - 50)'}
              onChange={(e) => setText(e.target.value)}
            />
          </Field>
        </>
      ) : (
        <>
          <p className="tiny dim" style={{ margin: 0 }}>
            {draws.length === 1
              ? `${draws[0].rows.length} rows read`
              : `${draws.length} draws read`}
            {fileName ? ` from ${fileName}` : ''}. Unrecognised names are off by default — switch one
            on to keep it under its own name.
          </p>

          {draws.map((draw, drawIndex) => {
            const kept = draw.rows.filter((r) => r.keep).length;
            const expanded = openDraw === drawIndex;
            return (
              <div key={`${draw.date}-${drawIndex}`} className="card">
                <div className="row" style={{ justifyContent: 'space-between', gap: 'var(--sp-2)' }}>
                  <button
                    className="lead"
                    aria-label={draw.include ? 'Leave this draw out' : 'Import this draw'}
                    style={{
                      border: `2px solid ${draw.include ? 'var(--accent)' : 'var(--border-strong)'}`,
                      background: draw.include ? 'var(--accent)' : 'transparent',
                      color: draw.include ? 'var(--accent-ink)' : 'var(--text-3)',
                    }}
                    onClick={() => patchDraw(drawIndex, { include: !draw.include })}
                  >
                    {draw.include ? '✓' : ''}
                  </button>
                  <button
                    className="grow"
                    style={{ background: 'none', border: 'none', textAlign: 'left', minWidth: 0 }}
                    onClick={() => setOpenDraw(expanded ? null : drawIndex)}
                  >
                    <strong>{formatDay(draw.date)}</strong>
                    <span className="tiny dim" style={{ display: 'block' }}>
                      {kept} of {draw.rows.length} results
                      {draw.duplicate ? ' · already imported' : ''}
                    </span>
                  </button>
                  <span className="trail dim">{expanded ? '▾' : '▸'}</span>
                </div>

                {expanded && (
                  <>
                    <div className="grid grid-2" style={{ marginTop: 'var(--sp-3)' }}>
                      <Field label="Collection date">
                        <input
                          className="input"
                          type="date"
                          value={draw.date}
                          onChange={(e) => patchDraw(drawIndex, { date: e.target.value })}
                        />
                      </Field>
                      <Field label="Label" hint="Optional">
                        <input
                          className="input"
                          value={draw.label}
                          placeholder="Week 4"
                          onChange={(e) => patchDraw(drawIndex, { label: e.target.value })}
                        />
                      </Field>
                    </div>

                    <div className="list">
                      {draw.rows.map((row, i) => {
                        const def = row.markerKey ? markerDef(row.markerKey) : undefined;
                        const status = rangeStatus(row.value, { low: row.low, high: row.high });
                        return (
                          <div
                            key={`${row.reportedName}-${i}`}
                            className="card"
                            style={{
                              marginBottom: 'var(--sp-2)',
                              background: 'var(--surface-2)',
                              opacity: row.keep ? 1 : 0.55,
                            }}
                          >
                            <div
                              className="row"
                              style={{ justifyContent: 'space-between', gap: 'var(--sp-2)' }}
                            >
                              <button
                                className="lead"
                                aria-label={row.keep ? 'Leave this one out' : 'Include this one'}
                                style={{
                                  border: `2px solid ${row.keep ? 'var(--accent)' : 'var(--border-strong)'}`,
                                  background: row.keep ? 'var(--accent)' : 'transparent',
                                  color: row.keep ? 'var(--accent-ink)' : 'var(--text-3)',
                                }}
                                onClick={() => patchRow(drawIndex, i, { keep: !row.keep })}
                              >
                                {row.keep ? '✓' : ''}
                              </button>
                              <span className="grow" style={{ minWidth: 0 }}>
                                <strong className="truncate">{row.label}</strong>
                                <span className="tiny dim" style={{ display: 'block' }}>
                                  read as “{row.reportedName}”
                                  {row.converted ? ` · converted to ${row.unit}` : ''}
                                  {!def ? ' · not a marker I know' : ''}
                                </span>
                              </span>
                              {status !== 'unknown' && status !== 'in' && (
                                <span
                                  className={`badge ${status === 'high' ? 'serious' : 'warning'}`}
                                >
                                  {status === 'high' ? 'High' : 'Low'}
                                </span>
                              )}
                            </div>

                            <div className="grid grid-3" style={{ marginTop: 'var(--sp-2)' }}>
                              <Field label="Value">
                                <NumberInput
                                  value={row.value}
                                  onChange={(v) => patchRow(drawIndex, i, { value: v ?? 0 })}
                                  step={0.1}
                                />
                              </Field>
                              <Field label="Unit">
                                <input
                                  className="input"
                                  value={row.unit}
                                  onChange={(e) => patchRow(drawIndex, i, { unit: e.target.value })}
                                />
                              </Field>
                              <Field label="Range">
                                <span className="small dim">
                                  {row.low != null || row.high != null
                                    ? `${row.low != null ? num(row.low, 2) : '—'} – ${row.high != null ? num(row.high, 2) : '—'}`
                                    : 'none given'}
                                </span>
                              </Field>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </>
      )}
    </Sheet>
  );
}
