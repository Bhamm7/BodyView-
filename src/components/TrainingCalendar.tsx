import { useMemo, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { format } from 'date-fns';
import { db } from '@/db/db';
import type { ISODate, Workout } from '@/db/types';
import { Card } from '@/components/ui';
import { isSameMonth, monthGrid, shiftMonth, weekdayLabels } from '@/lib/calendar';
import { fromISODate, today } from '@/lib/date';
import { useSettings } from '@/hooks/useData';
import {
  GROUP_COLOR,
  GROUP_SHORT,
  TRAINING_GROUPS,
  groupCounts,
  workoutGroups,
  type TrainingTag,
} from '@/lib/training';

/**
 * A month of training, read by body group rather than by "something happened
 * here".
 *
 * The main calendar carries five kinds of event at once, so a workout gets one
 * dot there and nothing more — which answers "did I train?" but never "what
 * did I train?". This grid has only one subject, so each day can say the group
 * outright. Tapping a group filters the month down to it, which is the fastest
 * way to answer the question that actually comes up: when did I last do legs,
 * and how long has back been sitting idle?
 */
export function TrainingCalendar() {
  const navigate = useNavigate();
  const [settings] = useSettings();
  const [month, setMonth] = useState<ISODate>(today());
  const [filter, setFilter] = useState<TrainingTag | null>(null);

  const days = useMemo(
    () => monthGrid(month, settings.weekStartsOn),
    [month, settings.weekStartsOn],
  );
  const from = days[0];
  const to = days[days.length - 1];

  const workouts =
    useLiveQuery(
      () => db.workouts.where('date').between(from, to, true, true).toArray(),
      [from, to],
      [],
    ) ?? [];

  /** Sessions per day, with the groups each one covers already worked out. */
  const byDay = useMemo(() => {
    const map = new Map<ISODate, Array<{ workout: Workout; groups: TrainingTag[] }>>();
    for (const workout of workouts) {
      const entry = map.get(workout.date) ?? [];
      entry.push({ workout, groups: workoutGroups(workout) });
      map.set(workout.date, entry);
    }
    return map;
  }, [workouts]);

  // Counts cover the month itself, not the leading and trailing days the grid
  // borrows from its neighbours — otherwise "6 leg days" quietly includes two
  // from last month.
  const inMonth = useMemo(
    () => workouts.filter((w) => isSameMonth(w.date, month)),
    [workouts, month],
  );
  const counts = useMemo(() => groupCounts(inMonth), [inMonth]);

  const now = today();

  return (
    <div style={{ marginTop: 'var(--sp-4)' }}>
      <Card>
        <div className="card-head">
          <h2 className="card-title">{format(fromISODate(month), 'MMMM yyyy')}</h2>
          <div className="row" style={{ gap: 2 }}>
            <button
              className="btn ghost sm icon"
              onClick={() => setMonth(shiftMonth(month, -1))}
              aria-label="Previous month"
            >
              ‹
            </button>
            <button className="btn ghost sm" onClick={() => setMonth(now)}>
              Today
            </button>
            <button
              className="btn ghost sm icon"
              onClick={() => setMonth(shiftMonth(month, 1))}
              aria-label="Next month"
            >
              ›
            </button>
          </div>
        </div>

        <div className="tag-row" style={{ marginBottom: 'var(--sp-3)' }}>
          {TRAINING_GROUPS.map((group) => {
            const on = filter === group;
            return (
              <button
                key={group}
                className="chip group"
                aria-pressed={on}
                onClick={() => setFilter(on ? null : group)}
                style={{ ['--group' as string]: GROUP_COLOR[group] } as CSSProperties}
              >
                <i className="chip-dot" style={{ background: GROUP_COLOR[group] }} aria-hidden="true" />
                {group}
                <span className="dim"> {counts.get(group) ?? 0}</span>
              </button>
            );
          })}
        </div>

        <div className="cal-grid" style={{ marginBottom: 0 }}>
          {weekdayLabels(settings.weekStartsOn).map((d) => (
            <div key={d} className="cal-dow">
              {d}
            </div>
          ))}
        </div>

        <div className="cal-grid">
          {days.map((day) => {
            const sessions = byDay.get(day) ?? [];
            const shown = filter
              ? sessions.filter((s) => s.groups.includes(filter))
              : sessions;
            const groups = [...new Set(shown.flatMap((s) => s.groups))];
            // A session that names no group still trained something, so the day
            // is marked — just without a colour it cannot honestly claim.
            const trained = shown.length > 0;
            const muted = filter != null && sessions.length > 0 && shown.length === 0;

            return (
              <button
                key={day}
                className={[
                  'cal-day',
                  'train-day',
                  isSameMonth(day, month) ? '' : 'outside',
                  day === now ? 'today' : '',
                  trained ? 'trained' : '',
                  muted ? 'muted' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => navigate(`/day/${day}`)}
                aria-label={
                  trained
                    ? `${day}, trained ${groups.length ? groups.join(' and ') : 'unnamed session'}`
                    : day
                }
              >
                <span className="train-date">{Number(day.slice(8, 10))}</span>
                <span className="train-groups">
                  {groups.slice(0, 2).map((group) => (
                    <span
                      key={group}
                      className="train-group"
                      // The tint carries the group; the text stays ink, which
                      // survives both themes where coloured text does not.
                      style={{
                        background: `color-mix(in srgb, ${GROUP_COLOR[group]} 32%, transparent)`,
                        boxShadow: `inset 2px 0 0 ${GROUP_COLOR[group]}`,
                      }}
                    >
                      {GROUP_SHORT[group]}
                    </span>
                  ))}
                  {groups.length > 2 && <span className="train-group more">+{groups.length - 2}</span>}
                  {trained && groups.length === 0 && <span className="train-group more">Session</span>}
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      <Card title="This month">
        {inMonth.length === 0 ? (
          <p className="small dim" style={{ margin: 0 }}>
            No sessions logged in {format(fromISODate(month), 'MMMM')}.
          </p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Group</th>
                <th className="num">Sessions</th>
              </tr>
            </thead>
            <tbody>
              {TRAINING_GROUPS.map((group) => (
                <tr key={group}>
                  <td>
                    <i
                      className="chip-dot"
                      style={{ background: GROUP_COLOR[group], marginRight: 6 }}
                      aria-hidden="true"
                    />
                    {group}
                  </td>
                  <td className="num mono">{counts.get(group) ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
