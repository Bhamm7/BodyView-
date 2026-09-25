import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, uid } from '@/db/db';
import type { TrainingPlan, Workout, WorkoutTemplate } from '@/db/types';
import { Page } from '@/components/Layout';
import { Card, EmptyState, Segmented, Sheet, StatTile, useToast } from '@/components/ui';
import { BarSeries } from '@/components/charts';
import { HBars } from '@/components/sparkline';
import { useExerciseMap, useExercises, useOpenWorkout } from '@/hooks/useData';
import { TemplateSheet } from '@/components/TemplateSheet';
import { ExerciseSheet, ExerciseThumb } from '@/components/ExerciseSheet';
import { PlanSheet } from '@/components/PlanSheet';
import { advanced, planSummary, plannedTemplateId } from '@/lib/plan';
import { formatDay, fromISODate, lastNDays, nowISO, relativeDay, toISODate, today } from '@/lib/date';
import { addDays } from 'date-fns';
import { duration, num, pluralize } from '@/lib/format';
import {
  e1rm,
  MUSCLE_LABELS,
  setsByMuscle,
  TRAINING_WEIGHT_UNIT,
  workingSets,
  workoutDuration,
  workoutTitle,
  workoutVolume,
} from '@/lib/training';

type Tab = 'sessions' | 'plan' | 'progress' | 'exercises';

const TABS = [
  { value: 'sessions', label: 'Sessions' },
  { value: 'plan', label: 'Plan' },
  { value: 'progress', label: 'Progress' },
  { value: 'exercises', label: 'Exercises' },
] as const;

/** Training hub: start or resume a session, review progress, browse exercises. */
export default function Training() {
  const navigate = useNavigate();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('sessions');
  const [starting, setStarting] = useState(false);

  const openWorkout = useOpenWorkout();
  const workouts =
    useLiveQuery(() => db.workouts.reverse().sortBy('date').then((w) => w.slice(0, 60)), [], []) ?? [];
  const templates = useLiveQuery(() => db.templates.toArray(), [], []) ?? [];
  const plans = useLiveQuery(() => db.plans.filter((p) => p.active).toArray(), [], []) ?? [];

  const templateMap = useMemo(() => new Map(templates.map((t) => [t.id, t])), [templates]);

  /** What the active plans call for today, with the plan that called for it. */
  const dueToday = useMemo(
    () =>
      plans
        .map((plan) => {
          const id = plannedTemplateId(plan, today());
          const template = id ? templateMap.get(id) : undefined;
          return template ? { plan, template } : null;
        })
        .filter((x): x is { plan: TrainingPlan; template: WorkoutTemplate } => x != null),
    [plans, templateMap],
  );

  const startWorkout = async (template?: WorkoutTemplate, plan?: TrainingPlan) => {
    const id = uid();
    const workout: Workout = {
      id,
      date: today(),
      name: template?.name ?? 'Workout',
      templateId: template?.id,
      startedAt: nowISO(),
    };
    await db.workouts.add(workout);

    if (template) {
      // Pre-fill the planned sets so the session opens ready to log.
      const rows = template.items.flatMap((item, order) =>
        Array.from({ length: Math.max(1, item.targetSets) }, (_, setIndex) => ({
          id: uid(),
          workoutId: id,
          exerciseId: item.exerciseId,
          order,
          setIndex,
          done: false,
          weight: item.targetWeight,
        })),
      );
      await db.sets.bulkAdd(rows);
    }

    // A rotation only moves when a session actually starts, so a missed day
    // delays the plan rather than dropping a session out of it.
    if (plan && plan.kind === 'rotation') {
      await db.plans.update(plan.id, { position: advanced(plan) });
    }

    setStarting(false);
    toast.show('Session started');
    navigate(`/workout/${id}`);
  };

  return (
    <Page
      title="Training"
      actions={
        <button className="btn primary sm" onClick={() => setStarting(true)}>
          + Workout
        </button>
      }
    >
      <Segmented value={tab} options={TABS} onChange={setTab} block label="Section" />

      {openWorkout && (
        <Card className="section" title="In progress">
          <button
            className="row"
            style={{ width: '100%', background: 'none', border: 'none', padding: 0, textAlign: 'left' }}
            onClick={() => navigate(`/workout/${openWorkout.id}`)}
          >
            <span className="grow">
              <strong>{workoutTitle(openWorkout)}</strong>
              <div className="tiny dim">Started {relativeDay(openWorkout.date)}</div>
            </span>
            <span className="btn primary sm">Resume</span>
          </button>
        </Card>
      )}

      {tab === 'sessions' && <SessionsTab workouts={workouts} />}
      {tab === 'plan' && (
        <PlanTab
          plans={plans}
          templates={templates}
          templateMap={templateMap}
          onStart={startWorkout}
        />
      )}
      {tab === 'progress' && <ProgressTab />}
      {tab === 'exercises' && <ExercisesTab />}

      <Sheet open={starting} title="Start a workout" onClose={() => setStarting(false)}>
        {dueToday.length > 0 && (
          <>
            <div className="card-title">On the plan today</div>
            <div className="list">
              {dueToday.map(({ plan, template }) => (
                <button
                  key={plan.id}
                  className="list-row"
                  onClick={() => startWorkout(template, plan)}
                >
                  <span className="lead" aria-hidden="true">
                    ⭐
                  </span>
                  <span className="body">
                    <span className="title">{template.name}</span>
                    <span className="sub">
                      {plan.name} · {pluralize(template.items.length, 'exercise')}
                    </span>
                  </span>
                  <span className="trail dim">›</span>
                </button>
              ))}
            </div>
          </>
        )}

        <button className="btn primary block lg" onClick={() => startWorkout()}>
          Empty workout
        </button>
        {templates.length > 0 && (
          <>
            <div className="card-title">Saved workouts</div>
            <div className="list">
              {templates.map((t) => (
                <button key={t.id} className="list-row" onClick={() => startWorkout(t)}>
                  <span className="lead" aria-hidden="true">
                    📋
                  </span>
                  <span className="body">
                    <span className="title">{t.name}</span>
                    <span className="sub">{pluralize(t.items.length, 'exercise')}</span>
                  </span>
                  <span className="trail dim">›</span>
                </button>
              ))}
            </div>
          </>
        )}
      </Sheet>
    </Page>
  );
}

/** Saved workouts, and the plans that arrange them. */
function PlanTab({
  plans,
  templates,
  templateMap,
  onStart,
}: {
  plans: TrainingPlan[];
  templates: WorkoutTemplate[];
  templateMap: Map<string, WorkoutTemplate>;
  onStart: (template: WorkoutTemplate, plan?: TrainingPlan) => void;
}) {
  const [newTemplate, setNewTemplate] = useState(false);
  const [editTemplate, setEditTemplate] = useState<WorkoutTemplate | null>(null);
  const [newPlan, setNewPlan] = useState(false);
  const [editPlan, setEditPlan] = useState<TrainingPlan | null>(null);
  const exercises = useExerciseMap();

  const date = today();

  return (
    <div style={{ marginTop: 'var(--sp-4)' }}>
      <Card
        title={`Saved workouts · ${templates.length}`}
        action={
          <button className="btn sm" onClick={() => setNewTemplate(true)}>
            + Create
          </button>
        }
      >
        {templates.length === 0 ? (
          <EmptyState icon="📋" title="Nothing saved yet">
            Save a workout — "Chest day A" — and it becomes something you can start in one
            tap, or drop into a plan.
          </EmptyState>
        ) : (
          <div className="list">
            {templates.map((t) => (
              <div key={t.id} className="list-row">
                <span className="lead" aria-hidden="true">
                  📋
                </span>
                <button
                  className="body"
                  style={{ background: 'none', border: 'none', textAlign: 'left', padding: 0 }}
                  onClick={() => setEditTemplate(t)}
                >
                  <span className="title">{t.name}</span>
                  <span className="sub truncate">
                    {pluralize(t.items.length, 'exercise')}
                    {t.items.length > 0 ? ' · ' : ''}
                    {t.items
                      .map((i) => exercises.get(i.exerciseId)?.name)
                      .filter(Boolean)
                      .slice(0, 3)
                      .join(', ')}
                    {t.items.length > 3 ? '…' : ''}
                  </span>
                </button>
                <button className="btn sm trail" onClick={() => onStart(t)}>
                  Start
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card
        title={`Plans · ${plans.length}`}
        action={
          <button className="btn sm" onClick={() => setNewPlan(true)} disabled={templates.length === 0}>
            + Plan
          </button>
        }
      >
        {plans.length === 0 ? (
          <EmptyState icon="🗓️" title="No plan yet">
            A plan arranges saved workouts — either onto days of the week, or into a rotation
            that advances each time you train.
          </EmptyState>
        ) : (
          <div className="list">
            {plans.map((plan) => {
              const dueId = plannedTemplateId(plan, date);
              const due = dueId ? templateMap.get(dueId) : undefined;
              return (
                <div key={plan.id} className="list-row">
                  <span className="lead" aria-hidden="true">
                    {plan.kind === 'weekday' ? '🗓️' : '🔁'}
                  </span>
                  <button
                    className="body"
                    style={{ background: 'none', border: 'none', textAlign: 'left', padding: 0 }}
                    onClick={() => setEditPlan(plan)}
                  >
                    <span className="title">{plan.name}</span>
                    <span className="sub truncate">{planSummary(plan, templateMap)}</span>
                  </button>
                  {due && (
                    <button className="btn sm trail" onClick={() => onStart(due, plan)}>
                      {plan.kind === 'weekday' ? 'Today' : 'Next'}: {due.name}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <TemplateSheet open={newTemplate} onClose={() => setNewTemplate(false)} />
      {editTemplate && (
        <TemplateSheet template={editTemplate} open onClose={() => setEditTemplate(null)} />
      )}
      <PlanSheet open={newPlan} onClose={() => setNewPlan(false)} />
      {editPlan && <PlanSheet plan={editPlan} open onClose={() => setEditPlan(null)} />}
    </div>
  );
}

function SessionsTab({ workouts }: { workouts: Workout[] }) {
  const navigate = useNavigate();
  const allSets = useLiveQuery(() => db.sets.toArray(), [], []) ?? [];

  const byWorkout = useMemo(() => {
    const map = new Map<string, typeof allSets>();
    for (const s of allSets) {
      const list = map.get(s.workoutId) ?? [];
      list.push(s);
      map.set(s.workoutId, list);
    }
    return map;
  }, [allSets]);

  if (workouts.length === 0) {
    return (
      <Card className="section">
        <EmptyState icon="🏋️" title="No workouts yet">
          Start a session and log your sets as you go — weight, reps and RPE.
        </EmptyState>
      </Card>
    );
  }

  return (
    <div style={{ marginTop: 'var(--sp-4)' }}>
      <Card title={`Recent sessions · ${workouts.length}`}>
        <div className="list">
          {workouts.map((w) => {
            const sets = byWorkout.get(w.id) ?? [];
            const done = workingSets(sets);
            const secs = workoutDuration(w);
            return (
              <button key={w.id} className="list-row" onClick={() => navigate(`/workout/${w.id}`)}>
                <span className="lead" aria-hidden="true">
                  {w.finishedAt ? '🏋️' : '⏱️'}
                </span>
                <span className="body">
                  <span className="title">
                    {workoutTitle(w)}
                    {w.tags && w.tags.length > 0 && (
                      <span className="tag-pills" style={{ marginLeft: 6 }}>
                        {w.tags.map((tag) => (
                          <span key={tag} className="tag-pill">
                            {tag}
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                  <span className="sub">
                    {formatDay(w.date)} · {pluralize(done.length, 'set')}
                    {secs ? ` · ${duration(secs)}` : w.finishedAt ? '' : ' · in progress'}
                  </span>
                </span>
                <span className="trail mono small">
                  {num(workoutVolume(sets), 0)}
                  <span className="dim tiny"> {TRAINING_WEIGHT_UNIT}</span>
                </span>
              </button>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

/** Weekly volume, session count and per-muscle set distribution. */
function ProgressTab() {
  const [weeks, setWeeks] = useState<'4' | '8' | '12'>('8');
  const exercises = useExerciseMap();

  const days = Number(weeks) * 7;
  const dates = useMemo(() => lastNDays(days), [days]);
  const from = dates[0];
  const to = dates[dates.length - 1];

  const workouts =
    useLiveQuery(() => db.workouts.where('date').between(from, to, true, true).toArray(), [from, to], []) ??
    [];
  const allSets = useLiveQuery(() => db.sets.toArray(), [], []) ?? [];

  const workoutIds = useMemo(() => new Set(workouts.map((w) => w.id)), [workouts]);
  const windowSets = useMemo(
    () => allSets.filter((s) => workoutIds.has(s.workoutId)),
    [allSets, workoutIds],
  );

  const dateOf = useMemo(() => new Map(workouts.map((w) => [w.id, w.date])), [workouts]);

  // Volume per ISO week, which is how training load is usually reviewed.
  const weekly = useMemo(() => {
    const buckets = new Map<string, number>();
    for (const s of windowSets) {
      const date = dateOf.get(s.workoutId);
      if (!date) continue;
      const monday = weekStart(date);
      buckets.set(monday, (buckets.get(monday) ?? 0) + (s.done && !s.warmup ? (s.weight ?? 0) * (s.reps ?? 0) : 0));
    }
    return [...buckets.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([x, y]) => ({ x, y }));
  }, [windowSets, dateOf]);

  const muscles = useMemo(() => {
    const counts = setsByMuscle(windowSets, exercises);
    return [...counts.entries()]
      .map(([muscle, value]) => ({ label: MUSCLE_LABELS[muscle] ?? muscle, value }))
      .sort((a, b) => b.value - a.value);
  }, [windowSets, exercises]);

  const totalVolume = workoutVolume(windowSets);
  const perWeek = workouts.length / Number(weeks);

  return (
    <div style={{ marginTop: 'var(--sp-4)' }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 'var(--sp-3)' }}>
        <span className="card-title">Training load</span>
        <Segmented
          value={weeks}
          options={[
            { value: '4', label: '4wk' },
            { value: '8', label: '8wk' },
            { value: '12', label: '12wk' },
          ]}
          onChange={(v) => setWeeks(v)}
          label="Time range"
        />
      </div>

      <div className="grid grid-2" style={{ marginBottom: 'var(--sp-4)' }}>
        <StatTile
          label="Sessions"
          value={workouts.length}
          icon="🏋️"
          meta={`${num(perWeek, 1)} per week`}
        />
        <StatTile
          label="Total volume"
          value={num(totalVolume / 1000, 1)}
          unit={`k ${TRAINING_WEIGHT_UNIT}`}
          icon="📦"
          meta={pluralize(workingSets(windowSets).length, 'working set')}
        />
      </div>

      {weekly.length === 0 ? (
        <Card>
          <EmptyState icon="📈" title="No training logged in this window">
            Volume and set distribution appear once you log a session.
          </EmptyState>
        </Card>
      ) : (
        <>
          <Card title={`Weekly volume (${TRAINING_WEIGHT_UNIT})`}>
            <BarSeries
              data={weekly}
              label="Volume"
              unit={TRAINING_WEIGHT_UNIT}
              color="var(--c-1)"
              labelFormatter={(l) => formatDay(l).replace(/^\w+ /, '')}
            />
            <p className="tiny dim" style={{ marginTop: 'var(--sp-2)' }}>
              Weight × reps of completed working sets, grouped by week.
            </p>
          </Card>

          <Card title="Sets per muscle group">
            <HBars items={muscles} unit="sets" />
          </Card>
        </>
      )}
    </div>
  );
}

/** Exercise library with a personal-record readout. */
function ExercisesTab() {
  const navigate = useNavigate();
  const exercises = useExercises();
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);

  const allSets = useLiveQuery(() => db.sets.toArray(), [], []) ?? [];

  const bests = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of allSets) {
      if (!s.done || s.warmup) continue;
      const est = e1rm(s.weight ?? 0, s.reps ?? 0);
      if (est > (map.get(s.exerciseId) ?? 0)) map.set(s.exerciseId, est);
    }
    return map;
  }, [allSets]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? exercises.filter((e) => `${e.name} ${e.equipment ?? ''}`.toLowerCase().includes(q))
      : exercises;
  }, [exercises, query]);

  return (
    <div style={{ marginTop: 'var(--sp-4)' }}>
      <Card
        title={`Exercises · ${exercises.length}`}
        action={
          <button className="btn sm" onClick={() => setCreating(true)}>
            + New
          </button>
        }
      >
        <input
          className="input"
          placeholder="Search exercises…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ marginBottom: 'var(--sp-3)' }}
        />
        <div className="list">
          {filtered.map((ex) => {
            const best = bests.get(ex.id);
            return (
              <button
                key={ex.id}
                className="list-row"
                onClick={() => navigate(`/training/exercise/${ex.id}`)}
              >
                <ExerciseThumb exercise={ex} />
                <span className="body">
                  <span className="title truncate">
                    {ex.name} {ex.primary ? '⭐' : ''}
                  </span>
                  <span className="sub">
                    {MUSCLE_LABELS[ex.muscle] ?? ex.muscle}
                    {ex.equipment ? ` · ${ex.equipment}` : ''}
                  </span>
                </span>
                <span className="trail mono small">
                  {best ? (
                    <>
                      {num(best, 0)}
                      <span className="dim tiny"> {TRAINING_WEIGHT_UNIT} e1RM</span>
                    </>
                  ) : (
                    <span className="dim tiny">—</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      <ExerciseSheet
        open={creating}
        initialName={query.trim()}
        onClose={() => setCreating(false)}
      />
    </div>
  );
}

/** Creates a custom exercise. */

/** Monday of the week containing `date`, as a local ISO date. */
function weekStart(date: string): string {
  const d = fromISODate(date);
  const dow = (d.getDay() + 6) % 7; // Monday = 0
  return toISODate(addDays(d, -dow));
}
