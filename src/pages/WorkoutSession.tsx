import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, uid } from '@/db/db';
import type { Exercise, SetLog } from '@/db/types';
import { Page } from '@/components/Layout';
import { Card, EmptyState, Field, Sheet, useConfirm, useToast } from '@/components/ui';
import { useExerciseMap, useExercises, useSettings } from '@/hooks/useData';
import { formatDay, nowISO } from '@/lib/date';
import { duration, num, pluralize } from '@/lib/format';
import { e1rm, MUSCLE_LABELS, workingSets, workoutVolume } from '@/lib/training';

/**
 * The live session screen. Optimised for one-handed use between sets: large
 * tap targets, previous performance shown inline, and every edit saved
 * immediately so nothing is lost if the phone locks.
 */
export default function WorkoutSession() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [settings] = useSettings();
  const [picking, setPicking] = useState(false);
  const [restFrom, setRestFrom] = useState<number | null>(null);

  const workout = useLiveQuery(() => (id ? db.workouts.get(id) : undefined), [id]);
  const sets = useLiveQuery(
    () => (id ? db.sets.where('workoutId').equals(id).toArray() : []),
    [id],
    [],
  );
  const exercises = useExerciseMap();
  const allSets = useLiveQuery(() => db.sets.toArray(), [], []) ?? [];

  // Group the session's sets by exercise, preserving the order they were added.
  const groups = useMemo(() => {
    const map = new Map<number, { exerciseId: string; order: number; sets: SetLog[] }>();
    for (const s of sets) {
      const entry = map.get(s.order) ?? { exerciseId: s.exerciseId, order: s.order, sets: [] };
      entry.sets.push(s);
      map.set(s.order, entry);
    }
    return [...map.values()]
      .sort((a, b) => a.order - b.order)
      .map((g) => ({ ...g, sets: g.sets.sort((a, b) => a.setIndex - b.setIndex) }));
  }, [sets]);

  const done = workingSets(sets);
  const volume = workoutVolume(sets);

  if (!workout) {
    return (
      <Page title="Workout">
        <Card>
          <EmptyState icon="🏋️" title="Session not found">
            It may have been deleted.
          </EmptyState>
        </Card>
      </Page>
    );
  }

  const addExercise = async (exercise: Exercise) => {
    const order = groups.length;
    await db.sets.add({
      id: uid(),
      workoutId: workout.id,
      exerciseId: exercise.id,
      order,
      setIndex: 0,
      done: false,
    });
    setPicking(false);
  };

  const finish = async () => {
    if (done.length === 0) {
      const discard = await confirm('Nothing was logged. Discard this session?', 'Discard');
      if (!discard) return;
      await db.sets.where('workoutId').equals(workout.id).delete();
      await db.workouts.delete(workout.id);
      navigate('/training');
      return;
    }
    await db.workouts.update(workout.id, { finishedAt: nowISO() });
    toast.show('Session saved');
    navigate('/training');
  };

  return (
    <Page
      title={workout.name}
      actions={
        workout.finishedAt ? (
          <button className="btn sm" onClick={() => db.workouts.update(workout.id, { finishedAt: undefined })}>
            Reopen
          </button>
        ) : (
          <button className="btn primary sm" onClick={finish}>
            Finish
          </button>
        )
      }
    >
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 'var(--sp-4)' }}>
        <button className="btn ghost sm" onClick={() => navigate('/training')}>
          ‹ Training
        </button>
        <span className="small dim">
          {formatDay(workout.date)} · {pluralize(done.length, 'set')} ·{' '}
          {num(volume, 0)} {settings.weightUnit}
        </span>
      </div>

      {restFrom != null && <RestTimer startedAt={restFrom} onDismiss={() => setRestFrom(null)} />}

      {groups.length === 0 ? (
        <Card>
          <EmptyState
            icon="➕"
            title="Add your first exercise"
            action={
              <button className="btn primary" onClick={() => setPicking(true)}>
                Add exercise
              </button>
            }
          >
            Pick a movement and log sets as you complete them.
          </EmptyState>
        </Card>
      ) : (
        groups.map((group) => (
          <ExerciseBlock
            key={group.order}
            group={group}
            exercise={exercises.get(group.exerciseId)}
            workoutId={workout.id}
            allSets={allSets}
            weightUnit={settings.weightUnit}
            onRest={() => setRestFrom(Date.now())}
            onRemove={async () => {
              const ok = await confirm('Remove this exercise and its sets?', 'Remove');
              if (!ok) return;
              await db.sets.bulkDelete(group.sets.map((s) => s.id));
            }}
          />
        ))
      )}

      {groups.length > 0 && (
        <button className="btn block lg" onClick={() => setPicking(true)} style={{ marginTop: 'var(--sp-4)' }}>
          + Add exercise
        </button>
      )}

      <ExercisePicker open={picking} onClose={() => setPicking(false)} onPick={addExercise} />
      {dialog}
    </Page>
  );
}

function ExerciseBlock({
  group,
  exercise,
  workoutId,
  allSets,
  weightUnit,
  onRest,
  onRemove,
}: {
  group: { exerciseId: string; order: number; sets: SetLog[] };
  exercise?: Exercise;
  workoutId: string;
  allSets: SetLog[];
  weightUnit: string;
  onRest: () => void;
  onRemove: () => void;
}) {
  const isCardio = exercise?.kind === 'cardio' || exercise?.kind === 'timed';

  // Last time this movement was trained, to anchor today's loads.
  const previous = useMemo(() => {
    const prior = allSets.filter(
      (s) => s.exerciseId === group.exerciseId && s.workoutId !== workoutId && s.done && !s.warmup,
    );
    const byIndex = new Map<number, SetLog>();
    for (const s of prior) byIndex.set(s.setIndex, s);
    return byIndex;
  }, [allSets, group.exerciseId, workoutId]);

  const addSet = async () => {
    const last = group.sets[group.sets.length - 1];
    await db.sets.add({
      id: uid(),
      workoutId,
      exerciseId: group.exerciseId,
      order: group.order,
      setIndex: (last?.setIndex ?? -1) + 1,
      weight: last?.weight,
      reps: last?.reps,
      done: false,
    });
  };

  return (
    <Card
      title={
        <h2 className="card-title truncate">
          {exercise?.name ?? 'Exercise'}
          {exercise ? ` · ${MUSCLE_LABELS[exercise.muscle] ?? exercise.muscle}` : ''}
        </h2>
      }
      action={
        <button className="btn ghost sm" onClick={onRemove} aria-label="Remove exercise">
          ✕
        </button>
      }
    >
      <table className="data" style={{ marginBottom: 'var(--sp-3)' }}>
        <thead>
          <tr>
            <th style={{ width: 28 }}>#</th>
            <th className="num">{isCardio ? 'Min' : weightUnit}</th>
            <th className="num">{isCardio ? 'km' : 'Reps'}</th>
            <th className="num" style={{ width: 56 }}>
              RPE
            </th>
            <th style={{ width: 44 }} />
          </tr>
        </thead>
        <tbody>
          {group.sets.map((set) => (
            <SetRow
              key={set.id}
              set={set}
              previous={previous.get(set.setIndex)}
              isCardio={isCardio}
              onRest={onRest}
            />
          ))}
        </tbody>
      </table>

      <div className="row tight">
        <button className="btn sm grow" onClick={addSet}>
          + Set
        </button>
        {!isCardio && (
          <span className="tiny dim nowrap">
            Best e1RM{' '}
            {num(
              Math.max(
                0,
                ...group.sets.filter((s) => s.done).map((s) => e1rm(s.weight ?? 0, s.reps ?? 0)),
              ),
              0,
            )}{' '}
            {weightUnit}
          </span>
        )}
      </div>
    </Card>
  );
}

function SetRow({
  set,
  previous,
  isCardio,
  onRest,
}: {
  set: SetLog;
  previous?: SetLog;
  isCardio: boolean;
  onRest: () => void;
}) {
  const patch = (changes: Partial<SetLog>) => db.sets.update(set.id, changes);

  const toggleDone = async () => {
    const next = !set.done;
    await patch({ done: next });
    if (next) onRest();
  };

  return (
    <tr style={{ opacity: set.done ? 1 : 0.85 }}>
      <td className="dim">
        {set.warmup ? (
          <button
            className="badge"
            onClick={() => patch({ warmup: false })}
            title="Warm-up set — not counted in volume"
          >
            W
          </button>
        ) : (
          <button
            className="dim"
            style={{ background: 'none', border: 'none', padding: 0 }}
            onClick={() => patch({ warmup: true })}
            title="Mark as warm-up"
          >
            {set.setIndex + 1}
          </button>
        )}
      </td>
      <td className="num">
        <CellInput
          value={isCardio ? (set.duration != null ? set.duration / 60 : null) : (set.weight ?? null)}
          placeholder={
            previous
              ? String(isCardio ? Math.round((previous.duration ?? 0) / 60) : (previous.weight ?? ''))
              : '—'
          }
          step={isCardio ? 1 : 2.5}
          onChange={(v) => patch(isCardio ? { duration: v == null ? undefined : v * 60 } : { weight: v ?? undefined })}
        />
      </td>
      <td className="num">
        <CellInput
          value={isCardio ? (set.distance != null ? set.distance / 1000 : null) : (set.reps ?? null)}
          placeholder={previous ? String(isCardio ? (previous.distance ?? 0) / 1000 : (previous.reps ?? '')) : '—'}
          step={isCardio ? 0.5 : 1}
          onChange={(v) =>
            patch(isCardio ? { distance: v == null ? undefined : v * 1000 } : { reps: v ?? undefined })
          }
        />
      </td>
      <td className="num">
        <CellInput value={set.rpe ?? null} placeholder="—" step={0.5} onChange={(v) => patch({ rpe: v ?? undefined })} />
      </td>
      <td>
        <button
          onClick={toggleDone}
          aria-label={set.done ? 'Mark set as not done' : 'Mark set as done'}
          style={{
            width: 34,
            height: 34,
            borderRadius: 8,
            border: `2px solid ${set.done ? 'var(--accent)' : 'var(--border-strong)'}`,
            background: set.done ? 'var(--accent)' : 'transparent',
            color: set.done ? 'var(--accent-ink)' : 'var(--text-3)',
            fontWeight: 700,
          }}
        >
          ✓
        </button>
      </td>
    </tr>
  );
}

/** Compact numeric cell used inside the set table. */
function CellInput({
  value,
  placeholder,
  step,
  onChange,
}: {
  value: number | null;
  placeholder?: string;
  step: number;
  onChange: (value: number | null) => void;
}) {
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  const external = useRef(value);

  useEffect(() => {
    if (value !== external.current) {
      setDraft(value == null ? '' : String(value));
      external.current = value;
    }
  }, [value]);

  return (
    <input
      className="input numeric"
      inputMode="decimal"
      value={draft}
      placeholder={placeholder}
      step={step}
      style={{ minHeight: 40, padding: '6px 8px', textAlign: 'right', width: '100%' }}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        if (raw.trim() === '') {
          external.current = null;
          onChange(null);
          return;
        }
        const parsed = Number(raw.replace(',', '.'));
        if (Number.isFinite(parsed)) {
          external.current = parsed;
          onChange(parsed);
        }
      }}
    />
  );
}

/** Counts up from the last completed set. */
function RestTimer({ startedAt, onDismiss }: { startedAt: number; onDismiss: () => void }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    setElapsed(0);
    const tick = setInterval(() => setElapsed((Date.now() - startedAt) / 1000), 500);
    return () => clearInterval(tick);
  }, [startedAt]);

  return (
    <div className="card row" style={{ marginBottom: 'var(--sp-4)', background: 'var(--surface-2)' }}>
      <span className="grow">
        <span className="card-title">Rest</span>
        <div className="stat-value mono">{duration(elapsed)}</div>
      </span>
      <button className="btn ghost sm" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}

function ExercisePicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (exercise: Exercise) => void;
}) {
  const exercises = useExercises();
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return exercises;
    return exercises.filter((e) => `${e.name} ${e.equipment ?? ''}`.toLowerCase().includes(q));
  }, [exercises, query]);

  return (
    <Sheet open={open} title="Add exercise" onClose={onClose}>
      <Field label="Search">
        <input
          className="input"
          value={query}
          autoFocus
          placeholder="Bench, squat, curl…"
          onChange={(e) => setQuery(e.target.value)}
        />
      </Field>
      <div className="list">
        {results.slice(0, 80).map((ex) => (
          <button key={ex.id} className="list-row" onClick={() => onPick(ex)}>
            <span className="body">
              <span className="title truncate">{ex.name}</span>
              <span className="sub">
                {MUSCLE_LABELS[ex.muscle] ?? ex.muscle}
                {ex.equipment ? ` · ${ex.equipment}` : ''}
              </span>
            </span>
            <span className="trail dim">+</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}
