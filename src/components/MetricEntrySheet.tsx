import { useEffect, useState } from 'react';
import { db, removeRecord, uid } from '@/db/db';
import { metricDef } from '@/db/metrics';
import type { MetricEntry, MetricKey } from '@/db/types';
import { combineDateTime, formatTime, nowTime, today } from '@/lib/date';
import { displayRange, metricUnit, toDisplay, toStored } from '@/lib/metricUnits';
import { useSettings } from '@/hooks/useData';
import { Field, NumberInput, Sheet, useToast } from './ui';

/**
 * Logs or edits a single metric reading. Every field gets a big numeric input
 * so it can be filled one-handed.
 */
export function MetricEntrySheet({
  metric,
  date,
  entry,
  open,
  onClose,
}: {
  metric: MetricKey;
  date?: string;
  /** Editing an existing reading rather than adding a new one. */
  entry?: MetricEntry;
  open: boolean;
  onClose: () => void;
}) {
  const def = metricDef(metric);
  const [settings] = useSettings();
  const toast = useToast();

  const [values, setValues] = useState<Record<string, number | null>>({});
  const [when, setWhen] = useState(date ?? today());
  const [time, setTime] = useState(nowTime());
  const [note, setNote] = useState('');

  // Reset the form whenever the sheet is opened for a different reading.
  useEffect(() => {
    if (!open) return;
    if (entry) {
      const seeded: Record<string, number | null> = {};
      for (const f of def.fields) {
        const raw = entry.values[f.key];
        seeded[f.key] = raw == null ? null : toDisplay(def, raw, settings);
      }
      setValues(seeded);
      setWhen(entry.date);
      setTime(formatTime(entry.recordedAt) || nowTime());
      setNote(entry.note ?? '');
    } else {
      setValues(Object.fromEntries(def.fields.map((f) => [f.key, null])));
      setWhen(date ?? today());
      setTime(nowTime());
      setNote('');
    }
    // `settings` is intentionally read-only here: re-seeding on a unit change
    // mid-edit would overwrite what the user has typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entry, metric, date]);

  const filled = def.fields.filter((f) => values[f.key] != null);
  const canSave = filled.length === def.fields.length;

  const save = async () => {
    if (!canSave) return;
    const stored: Record<string, number> = {};
    for (const f of def.fields) {
      stored[f.key] = toStored(def, values[f.key]!, settings);
    }
    const record: MetricEntry = {
      id: entry?.id ?? uid(),
      metric,
      date: when,
      recordedAt: combineDateTime(when, time),
      values: stored,
      note: note.trim() || undefined,
    };
    await db.metrics.put(record);
    toast.show(entry ? `${def.label} updated` : `${def.label} logged`);
    onClose();
  };

  const remove = async () => {
    if (!entry) return;
    await removeRecord('metrics', entry.id);
    toast.show(`${def.label} deleted`);
    onClose();
  };

  return (
    <Sheet
      open={open}
      title={`${def.icon} ${entry ? 'Edit' : 'Log'} ${def.label.toLowerCase()}`}
      onClose={onClose}
      footer={
        <>
          {entry ? (
            <button className="btn danger" onClick={remove}>
              Delete
            </button>
          ) : (
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
          )}
          <button className="btn primary" onClick={save} disabled={!canSave}>
            Save
          </button>
        </>
      }
    >
      <div className={def.fields.length > 1 ? 'grid grid-2' : ''}>
        {def.fields.map((f) => {
          const range = displayRange(def, f, settings);
          return (
            <Field key={f.key} label={`${f.label} (${f.unit ?? metricUnit(def, settings)})`}>
              <NumberInput
                big
                value={values[f.key] ?? null}
                onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))}
                min={range.min}
                max={range.max}
                step={range.step}
                autoFocus={def.fields[0].key === f.key}
                aria-label={f.label}
              />
            </Field>
          );
        })}
      </div>

      <div className="grid grid-2">
        <Field label="Date">
          <input
            className="input"
            type="date"
            value={when}
            max={today()}
            onChange={(e) => setWhen(e.target.value)}
          />
        </Field>
        <Field label="Time">
          <input
            className="input"
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </Field>
      </div>

      <Field label="Note">
        <textarea
          className="textarea"
          value={note}
          placeholder="Context — fasted, post-workout, poor sleep…"
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
    </Sheet>
  );
}
