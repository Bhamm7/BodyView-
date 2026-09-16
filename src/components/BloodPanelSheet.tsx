import { useEffect, useMemo, useRef, useState } from 'react';
import { db, removeRecords, uid } from '@/db/db';
import type { BloodPanel, BloodResult } from '@/db/types';
import { BLOOD_MARKERS, CATEGORY_LABELS, markerDef } from '@/db/bloodMarkers';
import { parseCsv, parseReport, type ParsedResult } from '@/lib/bloodParse';
import { FLAG_LABEL, FLAG_TONE, flagFor, referenceFor } from '@/lib/blood';
import { today } from '@/lib/date';
import { Field, MissingFields, NumberInput, Segmented, Sheet, useToast } from './ui';

type Mode = 'paste' | 'upload' | 'manual';

const MODES = [
  { value: 'paste', label: 'Paste' },
  { value: 'upload', label: 'File' },
  { value: 'manual', label: 'By hand' },
] as const;

/** A row being edited before the panel is saved. */
interface Draft extends ParsedResult {
  rowId: string;
  include: boolean;
}

const toDraft = (parsed: ParsedResult): Draft => ({
  ...parsed,
  rowId: uid(),
  include: true,
});

/**
 * Adds or edits a blood panel.
 *
 * Imported results always go through a review table before they are saved —
 * lab reports have no standard format, so the parser is a first pass that the
 * user confirms, not an authority. Anything it could not read is shown rather
 * than silently dropped.
 */
export function BloodPanelSheet({
  panel,
  open,
  onClose,
}: {
  panel?: BloodPanel;
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<Mode>('paste');
  const [date, setDate] = useState(today());
  const [lab, setLab] = useState('');
  const [notes, setNotes] = useState('');
  const [raw, setRaw] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [markerPick, setMarkerPick] = useState('');

  useEffect(() => {
    if (!open) return;
    setMode(panel ? 'manual' : 'paste');
    setDate(panel?.date ?? today());
    setLab(panel?.lab ?? 'MyHealth Alberta');
    setNotes(panel?.notes ?? '');
    setRaw('');
    setUnmatched([]);
    setMarkerPick('');

    if (panel) {
      void db.bloodResults
        .where('panelId')
        .equals(panel.id)
        .toArray()
        .then((rows) =>
          setDrafts(
            rows.map((r) => ({
              rowId: r.id,
              marker: r.marker,
              label: r.label,
              value: r.value,
              unit: r.unit,
              refLow: r.refLow,
              refHigh: r.refHigh,
              known: !!markerDef(r.marker),
              source: '',
              include: true,
            })),
          ),
        );
    } else {
      setDrafts([]);
    }
  }, [open, panel]);

  const runParse = (text: string, kind: 'paste' | 'csv') => {
    const outcome = kind === 'csv' ? parseCsv(text) : parseReport(text);
    setDrafts(outcome.results.map(toDraft));
    setUnmatched(outcome.unmatched);
    if (outcome.date) setDate(outcome.date);
    toast.show(
      outcome.results.length > 0
        ? `Read ${outcome.results.length} result${outcome.results.length === 1 ? '' : 's'}`
        : 'Nothing recognised — check the format',
    );
  };

  const readFile = async (file: File) => {
    const text = await file.text();
    runParse(text, file.name.toLowerCase().endsWith('.csv') ? 'csv' : 'paste');
  };

  const addBlankRow = (markerKey: string) => {
    const def = markerDef(markerKey);
    setDrafts((prev) => [
      ...prev,
      {
        rowId: uid(),
        marker: markerKey,
        label: def?.label ?? markerKey,
        value: 0,
        unit: def?.unit ?? '',
        known: !!def,
        source: '',
        include: true,
        refLow: undefined,
        refHigh: undefined,
      },
    ]);
    setMarkerPick('');
  };

  const included = drafts.filter((d) => d.include);
  const missing: string[] = [];
  if (!date) missing.push('date');
  if (included.length === 0) missing.push('at least one result');
  const valid = missing.length === 0;

  const save = async () => {
    if (!valid) return;
    const panelId = panel?.id ?? uid();

    const record: BloodPanel = {
      id: panelId,
      date,
      lab: lab.trim() || undefined,
      source: panel ? panel.source : mode === 'manual' ? 'manual' : mode === 'upload' ? 'csv' : 'paste',
      notes: notes.trim() || undefined,
    };

    // Replacing the whole set is simpler than diffing, and a panel is small.
    const existing = panel
      ? await db.bloodResults.where('panelId').equals(panelId).primaryKeys()
      : [];

    await db.bloodPanels.put(record);
    if (existing.length > 0) await removeRecords('bloodResults', existing as string[]);

    await db.bloodResults.bulkPut(
      included.map((d) => ({
        id: uid(),
        panelId,
        date,
        marker: d.marker,
        label: d.label,
        value: d.value,
        unit: d.unit,
        refLow: d.refLow,
        refHigh: d.refHigh,
      })),
    );

    toast.show(`Panel saved — ${included.length} results`);
    onClose();
  };

  const removePanel = async () => {
    if (!panel) return;
    const ids = await db.bloodResults.where('panelId').equals(panel.id).primaryKeys();
    await removeRecords('bloodResults', ids as string[]);
    await removeRecords('bloodPanels', [panel.id]);
    toast.show('Panel deleted');
    onClose();
  };

  const grouped = useMemo(() => {
    const byCategory = new Map<string, typeof BLOOD_MARKERS>();
    for (const m of BLOOD_MARKERS) {
      const list = byCategory.get(m.category) ?? [];
      list.push(m);
      byCategory.set(m.category, list);
    }
    return [...byCategory.entries()];
  }, []);

  return (
    <Sheet
      open={open}
      title={panel ? 'Edit panel' : 'New blood panel'}
      onClose={onClose}
      footer={
        <>
          {panel ? (
            <button className="btn danger" onClick={removePanel}>
              Delete
            </button>
          ) : (
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
          )}
          <button className="btn primary" onClick={save} disabled={!valid}>
            Save {included.length > 0 ? `(${included.length})` : ''}
          </button>
        </>
      }
    >
      {!panel && (
        <Field label="How are you adding it?">
          <Segmented value={mode} options={MODES} onChange={setMode} block label="Entry method" />
        </Field>
      )}

      {!panel && mode === 'paste' && (
        <Field
          label="Paste the report"
          hint="Copy the results from MyHealth Alberta (or any lab report) and paste here — one result per line."
        >
          <textarea
            className="textarea"
            style={{ minHeight: 140, fontFamily: 'var(--mono)', fontSize: 13 }}
            value={raw}
            placeholder={'Hemoglobin        152    g/L      (135 - 170)\nTSH               1.85   mIU/L    (0.32 - 4.00)'}
            onChange={(e) => setRaw(e.target.value)}
          />
        </Field>
      )}

      {!panel && mode === 'paste' && (
        <button className="btn block" disabled={!raw.trim()} onClick={() => runParse(raw, 'paste')}>
          Read results
        </button>
      )}

      {!panel && mode === 'upload' && (
        <>
          <button className="btn block lg" onClick={() => fileInput.current?.click()}>
            Choose a CSV or text file
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,.txt,.tsv,text/csv,text/plain"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void readFile(file);
              e.target.value = '';
            }}
          />
          <p className="tiny dim">
            A PDF cannot be read directly — open it, select the results, and use Paste instead.
          </p>
        </>
      )}

      <div className="grid grid-2">
        <Field label="Collection date" required>
          <input
            className="input"
            type="date"
            value={date}
            max={today()}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label="Lab">
          <input className="input" value={lab} onChange={(e) => setLab(e.target.value)} />
        </Field>
      </div>

      {unmatched.length > 0 && (
        <div className="card" style={{ background: 'color-mix(in srgb, var(--warning) 12%, transparent)' }}>
          <div className="card-title" style={{ color: 'var(--warning)' }}>
            {unmatched.length} line{unmatched.length === 1 ? '' : 's'} not read
          </div>
          <p className="tiny" style={{ marginBottom: 6 }}>
            Nothing is dropped silently — add these by hand below if you need them.
          </p>
          <div className="mono tiny dim" style={{ maxHeight: 90, overflowY: 'auto' }}>
            {unmatched.slice(0, 20).map((line, i) => (
              <div key={i} className="truncate">
                {line}
              </div>
            ))}
          </div>
        </div>
      )}

      {drafts.length > 0 && (
        <>
          <div className="card-title">
            Results · {included.length} of {drafts.length} selected
          </div>
          <div className="scroll-x">
            <table className="data blood-review">
              <thead>
                <tr>
                  <th style={{ width: 28 }} />
                  <th>Marker</th>
                  <th className="num">Value</th>
                  <th>Unit</th>
                  <th className="num">Flag</th>
                  <th style={{ width: 30 }} />
                </tr>
              </thead>
              <tbody>
                {drafts.map((draft) => {
                  const asResult: BloodResult = {
                    id: draft.rowId,
                    panelId: 'preview',
                    date,
                    marker: draft.marker,
                    label: draft.label,
                    value: draft.value,
                    unit: draft.unit,
                    refLow: draft.refLow,
                    refHigh: draft.refHigh,
                  };
                  const flag = flagFor(asResult);
                  const ref = referenceFor(asResult);

                  return (
                    <tr key={draft.rowId} style={{ opacity: draft.include ? 1 : 0.45 }}>
                      <td>
                        <input
                          type="checkbox"
                          checked={draft.include}
                          aria-label={`Include ${draft.label}`}
                          onChange={(e) =>
                            setDrafts((prev) =>
                              prev.map((d) =>
                                d.rowId === draft.rowId ? { ...d, include: e.target.checked } : d,
                              ),
                            )
                          }
                        />
                      </td>
                      <td style={{ whiteSpace: 'normal', minWidth: 130 }}>
                        <span className="truncate">{draft.label}</span>
                        {!draft.known && (
                          <div className="tiny dim">not in the catalogue — kept as typed</div>
                        )}
                        {ref.low != null || ref.high != null ? (
                          <div className="tiny dim">
                            ref {ref.low ?? '—'}–{ref.high ?? '—'}
                            {ref.fromLab ? '' : ' (typical)'}
                          </div>
                        ) : null}
                      </td>
                      <td className="num" style={{ minWidth: 92 }}>
                        <NumberInput
                          value={draft.value}
                          onChange={(value) =>
                            setDrafts((prev) =>
                              prev.map((d) =>
                                d.rowId === draft.rowId ? { ...d, value: value ?? 0 } : d,
                              ),
                            )
                          }
                          step={0.01}
                          aria-label={`${draft.label} value`}
                        />
                      </td>
                      <td>
                        <input
                          className="input"
                          style={{ minHeight: 38, width: 84, fontSize: 13 }}
                          value={draft.unit}
                          aria-label={`${draft.label} unit`}
                          onChange={(e) =>
                            setDrafts((prev) =>
                              prev.map((d) =>
                                d.rowId === draft.rowId ? { ...d, unit: e.target.value } : d,
                              ),
                            )
                          }
                        />
                      </td>
                      <td className="num">
                        <span className={`badge ${FLAG_TONE[flag]}`}>{FLAG_LABEL[flag]}</span>
                      </td>
                      <td>
                        <button
                          className="btn ghost sm icon"
                          aria-label={`Remove ${draft.label}`}
                          onClick={() =>
                            setDrafts((prev) => prev.filter((d) => d.rowId !== draft.rowId))
                          }
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Field label="Add a marker by hand">
        <select
          className="select"
          value={markerPick}
          onChange={(e) => e.target.value && addBlankRow(e.target.value)}
        >
          <option value="">Choose a marker…</option>
          {grouped.map(([category, markers]) => (
            <optgroup key={category} label={CATEGORY_LABELS[category as never] ?? category}>
              {markers.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label} ({m.unit})
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Field>

      <Field label="Notes">
        <textarea
          className="textarea"
          value={notes}
          placeholder="Fasted, time of day, anything worth remembering about this draw…"
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>

      <MissingFields missing={missing} />

      <p className="tiny dim">
        Reference ranges printed on your report are stored with the result and always take
        precedence. Built-in ranges are shown as “typical” and are for orientation only — BodyView
        does not interpret results.
      </p>
    </Sheet>
  );
}
