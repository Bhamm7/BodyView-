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
 * Day-marker colours, one per kind of event and used by both the grid and the
 * legend, so the two can never drift apart.
 */
const DOT_WORKOUT = 'var(--c-1)';
const DOT_METRICS = 'var(--c-3)';
const DOT_FOOD = 'var(--c-4)';
const DOT_BLOOD = 'var(--c-5)';
const DOT_DOSE = 'var(--c-6)';

const LEGEND: Array<{ color: string; label: string }> = [
  { color: DOT_WORKOUT, label: 'Workout' },
  { color: DOT_METRICS, label: 'Metrics' },
  { color: DOT_FOOD, label: 'Food' },
  { color: DOT_BLOOD, label: 'Bloodwork' },
  { color: DOT_DOSE, label: 'Dose taken' },
];

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

    // One fixed colour per kind of event. Colouring dose dots by compound put
    // arbitrary hues on the grid — a yellow compound's dot was indistinguishable
    // from the amber "Food" dot, so the legend appeared to be lying. Compound
    // colour still identifies the scheduled-dose underline, which is a
    // different shape and cannot be confused with a dot.
    for (const dose of doses) {
      if (dose.skipped) continue;
      const entry = get(dose.date);
      if (!entry.dots.includes(DOT_DOSE)) entry.dots.push(DOT_DOSE);
    }
    for (const w of workouts) {
      const entry = get(w.date);
      if (!entry.dots.includes(DOT_WORKOUT)) entry.dots.push(DOT_WORKOUT);
    }
    for (const m of meals) {
      const entry = get(m.date);
      if (!entry.dots.includes(DOT_FOOD)) entry.dots.push(DOT_FOOD);
    }
    for (const m of metrics) {
      const entry = get(m.date);
      if (!entry.dots.includes(DOT_METRICS)) entry.dots.push(DOT_METRICS);
    }
    for (const panel of blood) {
      const entry = get(panel.date);
      if (!entry.dots.includes(DOT_BLOOD)) entry.dots.push(DOT_BLOOD);
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
          {LEGEND.map(({ color, label }) => (
            <span className="key" key={label}>
              <i className="dot" style={{ background: color }} /> {label}
            </span>
          ))}
          <span className="key">
            <i style={{ width: 14, height: 3, borderRadius: 2, background: 'var(--text-3)' }} />
            Dose scheduled (underline, in the compound's colour)
          </span>
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
