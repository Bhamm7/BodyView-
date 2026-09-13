import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import type { DoseLog, ISODate } from '@/db/types';
import { dueDoses, extraDoses, skipDose, takeDose, undoDose } from '@/lib/doses';
import { useActiveProtocols, useCompoundMap } from '@/hooks/useData';
import { dose as formatDose } from '@/lib/format';
import { formatTime } from '@/lib/date';
import { protocolProgress } from '@/lib/schedule';
import { EmptyState, useToast } from './ui';

/**
 * The day's dose checklist. One tap logs a dose and draws it out of stock;
 * long-running protocols show how far through the cycle the day is.
 */
export function DoseChecklist({ date, compact }: { date: ISODate; compact?: boolean }) {
  const protocols = useActiveProtocols();
  const compounds = useCompoundMap();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const logs = useLiveQuery(() => db.doses.where('date').equals(date).toArray(), [date], []) ?? [];
  const due = useMemo(() => dueDoses(date, protocols, logs), [date, protocols, logs]);
  const extras = useMemo(() => extraDoses(logs, due), [logs, due]);

  const taken = due.filter((d) => d.log && !d.log.skipped).length;

  if (due.length === 0 && extras.length === 0) {
    return (
      <EmptyState icon="💊" title="Nothing scheduled">
        Protocols you start will appear here as a daily checklist.
      </EmptyState>
    );
  }

  return (
    <>
      {!compact && due.length > 0 && (
        <div className="row tiny dim" style={{ justifyContent: 'space-between', marginBottom: 'var(--sp-2)' }}>
          <span>
            {taken} of {due.length} taken
          </span>
          {taken === due.length && <span className="badge good">✓ All done</span>}
        </div>
      )}

      <div className="list">
        {due.map(({ protocol, slot, log }) => {
          const compound = compounds.get(protocol.compoundId);
          const key = `${protocol.id}:${slot}`;
          const progress = protocolProgress(protocol, date);
          const done = !!log && !log.skipped;
          const skipped = !!log?.skipped;

          return (
            <div key={key} className="list-row">
              <button
                className="lead"
                aria-label={done ? 'Undo dose' : 'Mark as taken'}
                style={{
                  border: `2px solid ${done ? 'var(--accent)' : 'var(--border-strong)'}`,
                  background: done ? 'var(--accent)' : 'transparent',
                  color: done ? 'var(--accent-ink)' : 'var(--text-3)',
                  opacity: busy === key ? 0.5 : 1,
                }}
                disabled={busy === key}
                onClick={async () => {
                  setBusy(key);
                  try {
                    if (log) {
                      await undoDose(log);
                      toast.show('Dose cleared');
                    } else {
                      await takeDose({ protocol, slot, log }, { date });
                      toast.show(`${compound?.name ?? 'Dose'} logged`);
                    }
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                {done ? '✓' : skipped ? '–' : ''}
              </button>

              <div className="body">
                <div
                  className="title row tight"
                  style={{ textDecoration: skipped ? 'line-through' : undefined }}
                >
                  <span className="dot" style={{ background: compound?.color }} aria-hidden="true" />
                  <span className="truncate">{compound?.name ?? 'Unknown compound'}</span>
                </div>
                <div className="sub">
                  {formatDose(protocol.dose, protocol.unit)}
                  {protocol.schedule.timesPerDay > 1 ? ` · dose ${slot + 1}` : ''}
                  {' · '}
                  {progress.label}
                  {log && !skipped ? ` · ${formatTime(log.takenAt)}` : ''}
                  {skipped ? ' · skipped' : ''}
                </div>
              </div>

              {!log && (
                <button
                  className="btn ghost sm trail"
                  onClick={() => skipDose({ protocol, slot, log }, date)}
                >
                  Skip
                </button>
              )}
            </div>
          );
        })}

        {extras.map((log: DoseLog) => {
          const compound = compounds.get(log.compoundId);
          return (
            <div key={log.id} className="list-row">
              <span className="lead" style={{ color: 'var(--accent)' }} aria-hidden="true">
                ✓
              </span>
              <div className="body">
                <div className="title row tight">
                  <span className="dot" style={{ background: compound?.color }} aria-hidden="true" />
                  <span className="truncate">{compound?.name ?? 'Unknown compound'}</span>
                  <span className="badge">one-off</span>
                </div>
                <div className="sub">
                  {formatDose(log.dose, log.unit)} · {formatTime(log.takenAt)}
                  {log.note ? ` · ${log.note}` : ''}
                </div>
              </div>
              <button className="btn ghost sm trail" onClick={() => undoDose(log)}>
                Undo
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}
