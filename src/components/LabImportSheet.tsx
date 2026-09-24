import { useRef, useState } from 'react';
import { db, uid } from '@/db/db';
import type { LabPanel, LabResult } from '@/db/types';
import { parseLabText, type ParsedRow } from '@/lib/labParse';
import { extractPdfText } from '@/lib/pdfText';
import { markerDef, rangeStatus } from '@/lib/markers';
import { today } from '@/lib/date';
import { num } from '@/lib/format';
import { Field, NumberInput, Sheet, useToast } from './ui';

type Stage = 'input' | 'review';

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

  const [stage, setStage] = useState<Stage>('input');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [date, setDate] = useState(today());
  const [label, setLabel] = useState('');
  const [fileName, setFileName] = useState<string | undefined>();
  const [source, setSource] = useState<LabPanel['source']>('paste');

  const reset = () => {
    setStage('input');
    setText('');
    setRows([]);
    setDate(today());
    setLabel('');
    setFileName(undefined);
    setSource('paste');
  };

  const close = () => {
    reset();
    onClose();
  };

  const review = (raw: string, from: LabPanel['source'], name?: string) => {
    const result = parseLabText(raw);
    if (result.rows.length === 0) {
      toast.show('No results found in that — check it looks like a list of markers.');
      return;
    }
    setRows(result.rows);
    if (result.date) setDate(result.date);
    setSource(from);
    setFileName(name);
    setStage('review');
  };

  const readFile = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      const raw = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
        ? await extractPdfText(file)
        : await file.text();
      review(raw, 'file', file.name);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'That file could not be read.');
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const patch = (index: number, changes: Partial<ParsedRow>) =>
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...changes } : r)));

  const keeping = rows.filter((r) => r.keep);

  const save = async () => {
    if (keeping.length === 0) return;
    const panel: LabPanel = {
      id: uid(),
      date,
      label: label.trim() || undefined,
      source,
      fileName,
    };
    const results: LabResult[] = keeping.map((row) => ({
      id: uid(),
      panelId: panel.id,
      marker: row.markerKey,
      reportedName: row.reportedName,
      label: row.label,
      value: row.value,
      unit: row.unit,
      low: row.low,
      high: row.high,
    }));

    await db.transaction('rw', [db.labPanels, db.labResults], async () => {
      await db.labPanels.add(panel);
      await db.labResults.bulkAdd(results);
    });
    toast.show(`${results.length} results saved`);
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
              onClick={() => review(text, 'paste')}
            >
              Read it
            </button>
          </>
        ) : (
          <>
            <button className="btn" onClick={() => setStage('input')}>
              Back
            </button>
            <button className="btn primary" onClick={save} disabled={keeping.length === 0}>
              Save {keeping.length}
            </button>
          </>
        )
      }
    >
      {stage === 'input' ? (
        <>
          <Field
            label="From a file"
            hint="The PDF or spreadsheet from MyHealth Records, or any lab report. It is read here on your device."
          >
            <button className="btn block" disabled={busy} onClick={() => fileInput.current?.click()}>
              {busy ? 'Reading…' : 'Choose a PDF or CSV'}
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".pdf,.csv,.tsv,.txt,application/pdf,text/csv,text/plain"
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
          <div className="grid grid-2">
            <Field label="Collection date">
              <input
                className="input"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
            <Field label="Label" hint="Optional">
              <input
                className="input"
                value={label}
                placeholder="Week 4"
                onChange={(e) => setLabel(e.target.value)}
              />
            </Field>
          </div>

          <p className="tiny dim" style={{ margin: 0 }}>
            {rows.length} rows read{fileName ? ` from ${fileName}` : ''}. Unrecognised names are off
            by default — switch one on to keep it under its own name.
          </p>

          <div className="list">
            {rows.map((row, i) => {
              const def = row.markerKey ? markerDef(row.markerKey) : undefined;
              const status = rangeStatus(row.value, { low: row.low, high: row.high });
              return (
                <div
                  key={`${row.reportedName}-${i}`}
                  className="card"
                  style={{ marginBottom: 'var(--sp-2)', opacity: row.keep ? 1 : 0.55 }}
                >
                  <div className="row" style={{ justifyContent: 'space-between', gap: 'var(--sp-2)' }}>
                    <button
                      className="lead"
                      aria-label={row.keep ? 'Leave this one out' : 'Include this one'}
                      style={{
                        border: `2px solid ${row.keep ? 'var(--accent)' : 'var(--border-strong)'}`,
                        background: row.keep ? 'var(--accent)' : 'transparent',
                        color: row.keep ? 'var(--accent-ink)' : 'var(--text-3)',
                      }}
                      onClick={() => patch(i, { keep: !row.keep })}
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
                      <span className={`badge ${status === 'high' ? 'serious' : 'warning'}`}>
                        {status === 'high' ? 'High' : 'Low'}
                      </span>
                    )}
                  </div>

                  <div className="grid grid-3" style={{ marginTop: 'var(--sp-2)' }}>
                    <Field label="Value">
                      <NumberInput
                        value={row.value}
                        onChange={(v) => patch(i, { value: v ?? 0 })}
                        step={0.1}
                      />
                    </Field>
                    <Field label="Unit">
                      <input
                        className="input"
                        value={row.unit}
                        onChange={(e) => patch(i, { unit: e.target.value })}
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
    </Sheet>
  );
}
