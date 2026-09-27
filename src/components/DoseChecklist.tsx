import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import type { DoseLog, ISODate, Protocol } from '@/db/types';
import { dueDoses, extraDoses, skipDose, takeDose, undoDose } from '@/lib/doses';
import { useActiveProtocols, useCompoundMap, useInventory } from '@/hooks/useData';
import { concentrationOf, UNITS_PER_ML, unitsForDose } from '@/lib/reconstitution';
import { dose as formatDose, num } from '@/lib/format';
import { formatTime } from '@/lib/date';
import { doseRate, protocolProgress } from '@/lib/schedule';
import { EmptyState, useToast } from './ui';

/**
 * The day's dose checklist. One tap logs a dose and draws it out of stock;
 * long-running protocols show how far through the cycle the day is.
 */
export function DoseChecklist({
  date,
  compact,
  onEditProtocol,
}: {
  date: ISODate;
  compact?: boolean;
  /** When given, the body of a row opens its protocol for editing. */
  onEditProtocol?: (protocol: Protocol) => void;
}) {
  const protocols = useActiveProtocols();
  const compounds = useCompoundMap();
  const inventory = useInventory();

  /**
   * How many syringe units each compound's dose comes to, where the vial in
   * stock has been reconstituted. This is the number wanted at the moment of
   * injection, and it is the whole reason the mix is recorded.
   */
  const unitsByCompound = useMemo(() => {
    const out = new Map<string, { units: number; ml: number }>();
    for (const item of inventory) {
      if (!item.reconstitution) continue;
      const concentration = concentrationOf(item.initial, item.unit, item.reconstitution.solventMl);
      if (!concentration) continue;
      const protocol = protocols.find((p) => p.compoundId === item.compoundId);
      if (!protocol) continue;
      const units = unitsForDose(
        protocol.dose,
        protocol.unit,
        concentration,
        item.reconstitution.unitsPerMl ?? UNITS_PER_ML,
      );
      if (units == null) continue;
      out.set(item.compoundId, { units, ml: units / (item.reconstitution.unitsPerMl ?? UNITS_PER_ML) });
    }
    return out;
  }, [inventory, protocols]);
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
          const rate = doseRate(protocol);
          // "160 mg · 160 mg/day" says one thing twice. The rate earns its
          // place only when it is a different number from the dose in hand.
          const perDose = formatDose(protocol.dose, protocol.unit);
          const showRate = rate.label !== `${perDose}/day`;
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

              <div
                className="body"
                role={onEditProtocol ? 'button' : undefined}
                tabIndex={onEditProtocol ? 0 : undefined}
                style={onEditProtocol ? { cursor: 'pointer' } : undefined}
                onClick={onEditProtocol ? () => onEditProtocol(protocol) : undefined}
                onKeyDown={
                  onEditProtocol
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onEditProtocol(protocol);
                        }
                      }
                    : undefined
                }
              >
                <div
                  className="title row tight"
                  style={{ textDecoration: skipped ? 'line-through' : undefined }}
                >
                  <span className="dot" style={{ background: compound?.color }} aria-hidden="true" />
                  <span className="truncate">{compound?.name ?? 'Unknown compound'}</span>
                </div>
                <div className="sub">
                  {perDose}
                  {(() => {
                    const draw = unitsByCompound.get(protocol.compoundId);
                    return draw ? ` · draw ${num(draw.units, 1)} units` : '';
                  })()}
                  {protocol.schedule.timesPerDay > 1 ? ` · dose ${slot + 1}` : ''}
                  {showRate && (
                    <>
                      {' · '}
                      <span className="mono" title={rate.longLabel}>
                        {rate.label}
                      </span>
                    </>
                  )}
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
