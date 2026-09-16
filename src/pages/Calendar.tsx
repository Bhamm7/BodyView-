import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { format } from 'date-fns';
import { db } from '@/db/db';
import type { ISODate } from '@/db/types';
import { Page } from '@/components/Layout';
import { Card } from '@/components/ui';
import { isSameMonth, monthGrid, shiftMonth, weekdayLabels } from '@/lib/calendar';
import { fromISODate, relativeDay, today } from '@/lib/date';
import { useActiveProtocols, useCompoundMap, useSettings } from '@/hooks/useData';
import { isScheduledOn } from '@/lib/schedule';
import { DaySummary } from './DayDetail';

/**
 * Month view. Each day shows what happened on it — doses, a workout, meals,
 * body metrics — so cycles and training blocks are visible at a glance.
 */
export default function Calendar() {
  const navigate = useNavigate();
  const [settings] = useSettings();
  const [month, setMonth] = useState(today());
  const [selected, setSelected] = useState<ISODate>(today());

  const days = useMemo(
    () => monthGrid(month, settings.weekStartsOn),
    [month, settings.weekStartsOn],
  );
  const from = days[0];
  const to = days[days.length - 1];

  const protocols = useActiveProtocols();
  const compounds = useCompoundMap();

  const doses =
    useLiveQuery(() => db.doses.where('date').between(from, to, true, true).toArray(), [from, to], []) ?? [];
  const workouts =
    useLiveQuery(() => db.workouts.where('date').between(from, to, true, true).toArray(), [from, to], []) ?? [];
  const meals =
    useLiveQuery(() => db.meals.where('date').between(from, to, true, true).toArray(), [from, to], []) ?? [];
  const metrics =
    useLiveQuery(() => db.metrics.where('date').between(from, to, true, true).toArray(), [from, to], []) ?? [];
  const blood =
    useLiveQuery(() => db.bloodPanels.where('date').between(from, to, true, true).toArray(), [from, to], []) ?? [];

  /** Per-day marks, in a stable order so colours never jump around. */
  const marks = useMemo(() => {
    const map = new Map<ISODate, { dots: string[]; scheduled: string[] }>();
    const get = (d: ISODate) => {
      const entry = map.get(d) ?? { dots: [], scheduled: [] };
      map.set(d, entry);
      return entry;
    };

    for (const dose of doses) {
      if (dose.skipped) continue;
      const color = compounds.get(dose.compoundId)?.color ?? 'var(--c-6)';
      const entry = get(dose.date);
      if (!entry.dots.includes(color)) entry.dots.push(color);
    }
    for (const w of workouts) {
      const entry = get(w.date);
      if (!entry.dots.includes('var(--c-1)')) entry.dots.push('var(--c-1)');
    }
    for (const m of meals) {
      const entry = get(m.date);
      if (!entry.dots.includes('var(--c-4)')) entry.dots.push('var(--c-4)');
    }
    for (const m of metrics) {
      const entry = get(m.date);
      if (!entry.dots.includes('var(--c-3)')) entry.dots.push('var(--c-3)');
    }
    for (const panel of blood) {
      const entry = get(panel.date);
      if (!entry.dots.includes('var(--c-5)')) entry.dots.push('var(--c-5)');
    }

    // A stripe under the date marks a day a protocol schedules a dose on.
    for (const day of days) {
      const due = protocols.filter((p) => isScheduledOn(p, day));
      if (due.length > 0) {
        get(day).scheduled = due
          .map((p) => compounds.get(p.compoundId)?.color ?? 'var(--c-6)')
          .slice(0, 3);
      }
    }

    return map;
  }, [doses, workouts, meals, metrics, blood, protocols, compounds, days]);

  const now = today();

  return (
    <Page
      title={format(fromISODate(month), 'MMMM yyyy')}
      actions={
        <>
          <button className="btn ghost sm icon" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">
            ‹
          </button>
          <button className="btn ghost sm" onClick={() => { setMonth(now); setSelected(now); }}>
            Today
          </button>
          <button className="btn ghost sm icon" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month">
            ›
          </button>
        </>
      }
    >
      <Card>
        <div className="cal-grid" style={{ marginBottom: 0 }}>
          {weekdayLabels(settings.weekStartsOn).map((d) => (
            <div key={d} className="cal-dow">
              {d}
            </div>
          ))}
        </div>
        <div className="cal-grid">
          {days.map((day) => {
            const mark = marks.get(day);
            const dots = mark?.dots ?? [];
            return (
              <button
                key={day}
                className={[
                  'cal-day',
                  isSameMonth(day, month) ? '' : 'outside',
                  day === now ? 'today' : '',
                  day === selected ? 'selected' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => setSelected(day)}
                aria-label={`${day}${dots.length ? `, ${dots.length} entries` : ''}`}
              >
                <span>{Number(day.slice(8, 10))}</span>
                <span className="cal-dots">
                  {dots.slice(0, 4).map((color, i) => (
                    <i key={i} style={{ background: color }} />
                  ))}
                  {dots.length > 4 && <i style={{ background: 'var(--text-3)' }} />}
                </span>
                {mark?.scheduled.length ? (
                  <span
                    className="cal-cycle"
                    style={{
                      background:
                        mark.scheduled.length === 1
                          ? mark.scheduled[0]
                          : `linear-gradient(90deg, ${mark.scheduled.join(', ')})`,
                    }}
                  />
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="legend-row" style={{ marginTop: 'var(--sp-4)' }}>
          <span className="key">
            <i className="dot" style={{ background: 'var(--c-1)' }} /> Workout
          </span>
          <span className="key">
            <i className="dot" style={{ background: 'var(--c-3)' }} /> Metrics
          </span>
          <span className="key">
            <i className="dot" style={{ background: 'var(--c-4)' }} /> Food
          </span>
          <span className="key">
            <i className="dot" style={{ background: 'var(--c-5)' }} /> Bloodwork
          </span>
          <span className="key">
            <i className="dot" style={{ background: 'var(--text-3)' }} /> Dose taken
          </span>
          <span className="key">
            <i style={{ width: 14, height: 3, borderRadius: 2, background: 'var(--text-3)' }} /> Dose
            scheduled
          </span>
          <span className="key">Dose marks use each compound's own colour.</span>
        </div>
      </Card>

      <Card
        title={relativeDay(selected)}
        action={
          <button className="btn sm" onClick={() => navigate(`/day/${selected}`)}>
            Open day
          </button>
        }
      >
        <DaySummary date={selected} />
      </Card>
    </Page>
  );
}
