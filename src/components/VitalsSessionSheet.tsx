import { useEffect, useState } from 'react';
import { db, uid } from '@/db/db';
import type { MetricEntry, VitalsSession } from '@/db/types';
import { combineDateTime, nowTime, today } from '@/lib/date';
import { num } from '@/lib/format';
import { nearestSession, SESSION_LABEL } from '@/lib/vitals';
import { Field, NumberInput, Segmented, Sheet, useToast } from './ui';

type Reading = { systolic: number | null; diastolic: number | null };

const SESSIONS = [
  { value: 'am', label: SESSION_LABEL.am },
  { value: 'pm', label: SESSION_LABEL.pm },
] as const;

const blank = (): Reading => ({ systolic: null, diastolic: null });

/**
 * A morning or night vitals session: two or three blood pressure readings
 * taken together, and a resting heart rate. Each reading is stored as its own
 * blood pressure entry tagged with the session, so the regular history and
 * charts still see every reading.
 */
export function VitalsSessionSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [session, setSession] = useState<VitalsSession>('am');
  const [when, setWhen] = useState(today());
  const [time, setTime] = useState(nowTime());
  const [readings, setReadings] = useState<Reading[]>([blank(), blank()]);
  const [hr, setHr] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const t = nowTime();
    setSession(nearestSession(t));
    setWhen(today());
    setTime(t);
    setReadings([blank(), blank()]);
    setHr(null);
  }, [open]);

  const complete = readings.filter(
    (r): r is { systolic: number; diastolic: number } => r.systolic != null && r.diastolic != null,
  );
  const partial = readings.some((r) => (r.systolic == null) !== (r.diastolic == null));
  const canSave = (complete.length > 0 || hr != null) && !partial;
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

  const setReading = (i: number, patch: Partial<Reading>) =>
    setReadings((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const save = async () => {
    if (!canSave) return;
    const base = new Date(combineDateTime(when, time)).getTime();
    // A minute apart, so the readings keep their order in the history.
    const records: MetricEntry[] = complete.map((r, i) => ({
      id: uid(),
      metric: 'bloodPressure',
      date: when,
      recordedAt: new Date(base + i * 60_000).toISOString(),
      values: { systolic: r.systolic, diastolic: r.diastolic },
      session,
    }));
    if (hr != null) {
      records.push({
        id: uid(),
        metric: 'restingHr',
        date: when,
        recordedAt: new Date(base).toISOString(),
        values: { value: hr },
        session,
      });
    }
    await db.metrics.bulkPut(records);
    toast.show(`${SESSION_LABEL[session]} vitals logged`);
    onClose();
  };

  return (
    <Sheet
      open={open}
      title="🩺 Log vitals"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save} disabled={!canSave}>
            Save
          </button>
        </>
      }
    >
      <Field label="Session">
        <Segmented value={session} options={SESSIONS} onChange={setSession} block label="Session" />
      </Field>

      {readings.map((r, i) => (
        <div key={i} className="grid grid-2">
          <Field label={`Reading ${i + 1} · SYS`}>
            <NumberInput
              big
              inputMode="numeric"
              value={r.systolic}
              onChange={(v) => setReading(i, { systolic: v })}
              min={60}
              max={220}
              autoFocus={i === 0}
              aria-label={`Reading ${i + 1} systolic`}
            />
          </Field>
          <Field label="DIA">
            <NumberInput
              big
              inputMode="numeric"
              value={r.diastolic}
              onChange={(v) => setReading(i, { diastolic: v })}
              min={40}
              max={140}
              aria-label={`Reading ${i + 1} diastolic`}
            />
          </Field>
        </div>
      ))}

      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 'var(--sp-3)' }}>
        {readings.length < 3 ? (
          <button className="btn ghost sm" onClick={() => setReadings((p) => [...p, blank()])}>
            + Third reading
          </button>
        ) : (
          <button className="btn ghost sm" onClick={() => setReadings((p) => p.slice(0, 2))}>
            Remove third reading
          </button>
        )}
        {complete.length > 0 && (
          <span className="small muted">
            Average{' '}
            <strong className="mono">
              {num(mean(complete.map((r) => r.systolic)), 0)}/{num(mean(complete.map((r) => r.diastolic)), 0)}
            </strong>{' '}
            mmHg
          </span>
        )}
      </div>

      <Field label="Resting heart rate (bpm)">
        <NumberInput
          big
          inputMode="numeric"
          value={hr}
          onChange={setHr}
          min={30}
          max={140}
          aria-label="Resting heart rate"
        />
      </Field>

      <div className="grid grid-2">
        <Field label="Date">
          <input className="input" type="date" value={when} max={today()} onChange={(e) => setWhen(e.target.value)} />
        </Field>
        <Field label="Time">
          <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
      </div>
    </Sheet>
  );
}
