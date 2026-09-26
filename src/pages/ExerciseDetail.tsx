import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { Page } from '@/components/Layout';
import { Card, EmptyState, StatTile } from '@/components/ui';
import { TrendChart } from '@/components/charts';
import { useSettings } from '@/hooks/useData';
import { formatDay } from '@/lib/date';
import { num, pluralize } from '@/lib/format';
import { e1rm, MUSCLE_LABELS, personalRecords, setLabel, workingSets } from '@/lib/training';

/** Per-exercise history: personal records, estimated 1RM trend and every set. */
export default function ExerciseDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [settings] = useSettings();

  const exercise = useLiveQuery(() => (id ? db.exercises.get(id) : undefined), [id]);
  const sets =
    useLiveQuery(() => (id ? db.sets.where('exerciseId').equals(id).toArray() : []), [id], []) ?? [];
  const workouts = useLiveQuery(() => db.workouts.toArray(), [], []) ?? [];

  const dateOf = useMemo(() => new Map(workouts.map((w) => [w.id, w.date])), [workouts]);
  const pr = useMemo(
    () => (id ? personalRecords(id, sets, dateOf) : null),
    [id, sets, dateOf],
  );

  // Best estimated 1RM per session, which is the cleanest strength signal.
  const series = useMemo(() => {
    const byDate = new Map<string, number>();
    for (const s of workingSets(sets)) {
      const date = dateOf.get(s.workoutId);
      if (!date) continue;
      const est = e1rm(s.weight ?? 0, s.reps ?? 0);
      if (est > (byDate.get(date) ?? 0)) byDate.set(date, est);
    }
    return [...byDate.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([x, y]) => ({ x, y }));
  }, [sets, dateOf]);

  const history = useMemo(() => {
    const byWorkout = new Map<string, typeof sets>();
    for (const s of sets) {
      const list = byWorkout.get(s.workoutId) ?? [];
      list.push(s);
      byWorkout.set(s.workoutId, list);
    }
    return [...byWorkout.entries()]
      .map(([workoutId, list]) => {
        const ordered = list.sort((a, b) => a.setIndex - b.setIndex);
        const workout = workouts.find((w) => w.id === workoutId);
        return {
          workoutId,
          date: dateOf.get(workoutId) ?? '',
          sets: ordered,
          // Keyed by the block's order within that session.
          note: workout?.exerciseNotes?.[String(ordered[0]?.order)]?.trim(),
        };
      })
      .filter((h) => h.date)
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [sets, dateOf, workouts]);

  if (!exercise) {
    return (
      <Page title="Exercise">
        <Card>
          <EmptyState icon="🏋️" title="Exercise not found" />
        </Card>
      </Page>
    );
  }

  return (
    <Page title={exercise.name}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 'var(--sp-4)' }}>
        <button className="btn ghost sm" onClick={() => navigate('/training')}>
          ‹ Training
        </button>
        <span className="small dim">
          {MUSCLE_LABELS[exercise.muscle] ?? exercise.muscle}
          {exercise.equipment ? ` · ${exercise.equipment}` : ''}
        </span>
      </div>

      {!pr || pr.totalSets === 0 ? (
        <Card>
          <EmptyState icon="📈" title="No sets logged yet">
            Log this movement in a session and its records and trend will appear here.
          </EmptyState>
        </Card>
      ) : (
        <>
          <div className="grid grid-2" style={{ marginBottom: 'var(--sp-4)' }}>
            <StatTile
              label="Heaviest set"
              value={num(pr.topWeight, 1)}
              unit={settings.weightUnit}
              icon="🏆"
              meta={`× ${pr.topWeightReps}${pr.topWeightDate ? ` · ${formatDay(pr.topWeightDate)}` : ''}`}
            />
            <StatTile
              label="Best e1RM"
              value={num(pr.bestE1rm, 1)}
              unit={settings.weightUnit}
              icon="📈"
              meta={pr.bestE1rmDate ? formatDay(pr.bestE1rmDate) : undefined}
            />
            <StatTile
              label="Best session volume"
              value={num(pr.bestSessionVolume, 0)}
              unit={settings.weightUnit}
              icon="📦"
              meta={pr.bestSessionVolumeDate ? formatDay(pr.bestSessionVolumeDate) : undefined}
            />
            <StatTile
              label="Total working sets"
              value={pr.totalSets}
              icon="🔁"
              meta={pr.lastPerformed ? `Last ${formatDay(pr.lastPerformed)}` : undefined}
            />
          </div>

          {series.length >= 2 && (
            <Card title={`Estimated 1RM (${settings.weightUnit})`}>
              <TrendChart
                series={[
                  {
                    key: 'e1rm',
                    label: 'Estimated 1RM',
                    color: 'var(--c-1)',
                    data: series,
                    unit: settings.weightUnit,
                    precision: 1,
                  },
                ]}
                showDots
                height={200}
              />
              <p className="tiny dim" style={{ marginTop: 'var(--sp-2)' }}>
                Epley estimate from your best set each session. Reps above 12 are capped, where the
                formula stops being reliable.
              </p>
            </Card>
          )}

          <Card title={`History · ${pluralize(history.length, 'session')}`}>
            <div className="list">
              {history.slice(0, 50).map((h) => (
                <div key={h.workoutId} className="list-row">
                  <span className="body">
                    <span className="title">{formatDay(h.date)}</span>
                    <span className="sub">
                      {h.sets
                        .filter((s) => s.done)
                        .map((s) => setLabel(s, exercise.kind, settings.weightUnit))
                        .join('  ·  ') || 'No completed sets'}
                    </span>
                    {h.note && (
                      <span className="sub" style={{ whiteSpace: 'normal', marginTop: 2 }}>
                        📝 {h.note}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </Page>
  );
}
