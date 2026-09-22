import { useEffect, useState } from 'react';
import { db, removeRecord, uid } from '@/db/db';
import type { WorkoutTemplate } from '@/db/types';
import { useExercises } from '@/hooks/useData';
import { Field, NumberInput, Sheet, useToast } from './ui';

type Item = WorkoutTemplate['items'][number];

/**
 * Creates or edits a named workout — "Chest day A" — that a session can be
 * started from later, on its own or as part of a plan.
 */
export function TemplateSheet({
  template,
  initial,
  open,
  onClose,
  onSaved,
}: {
  template?: WorkoutTemplate;
  /** Pre-filled name and exercises, e.g. when saving a finished session. */
  initial?: { name: string; items: Item[] };
  open: boolean;
  onClose: () => void;
  onSaved?: (id: string) => void;
}) {
  const exercises = useExercises();
  const toast = useToast();
  const [name, setName] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [adding, setAdding] = useState('');

  useEffect(() => {
    if (!open) return;
    setName(template?.name ?? initial?.name ?? '');
    setItems(template?.items ?? initial?.items ?? []);
    setAdding('');
  }, [open, template, initial]);

  const addExercise = (exerciseId: string) => {
    if (!exerciseId) return;
    setItems((prev) => [...prev, { exerciseId, targetSets: 3, targetReps: '8-12' }]);
    setAdding('');
  };

  const patchItem = (index: number, changes: Partial<Item>) =>
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...changes } : it)));

  const move = (index: number, delta: number) =>
    setItems((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const save = async () => {
    if (!name.trim() || items.length === 0) return;
    const record: WorkoutTemplate = {
      id: template?.id ?? uid(),
      name: name.trim(),
      notes: template?.notes,
      items,
    };
    await db.templates.put(record);
    toast.show(template ? 'Workout updated' : `${record.name} saved`);
    onSaved?.(record.id);
    onClose();
  };

  const remove = async () => {
    if (!template) return;
    await removeRecord('templates', template.id);
    toast.show('Workout deleted');
    onClose();
  };

  return (
    <Sheet
      open={open}
      title={template ? 'Edit workout' : 'Save a workout'}
      onClose={onClose}
      footer={
        <>
          {template ? (
            <button className="btn danger" onClick={remove}>
              Delete
            </button>
          ) : (
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
          )}
          <button
            className="btn primary"
            onClick={save}
            disabled={!name.trim() || items.length === 0}
          >
            Save
          </button>
        </>
      }
    >
      <Field label="Name" hint="What you'd call it in the gym — Chest day A, Pull B">
        <input
          className="input"
          value={name}
          placeholder="e.g. Chest day A"
          onChange={(e) => setName(e.target.value)}
          autoFocus={!template}
        />
      </Field>

      <Field label="Add an exercise">
        <select className="select" value={adding} onChange={(e) => addExercise(e.target.value)}>
          <option value="">Choose…</option>
          {exercises.map((ex) => (
            <option key={ex.id} value={ex.id}>
              {ex.name}
            </option>
          ))}
        </select>
      </Field>

      {items.length === 0 ? (
        <p className="small dim">
          Nothing added yet. Pick the movements in the order you'd do them.
        </p>
      ) : (
        <div className="list">
          {items.map((item, i) => {
            const exercise = exercises.find((e) => e.id === item.exerciseId);
            return (
              <div key={`${item.exerciseId}-${i}`} className="card" style={{ marginBottom: 'var(--sp-2)' }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <strong className="truncate">{exercise?.name ?? 'Removed exercise'}</strong>
                  <span className="row tight">
                    <button className="btn ghost sm" onClick={() => move(i, -1)} aria-label="Move up">
                      ↑
                    </button>
                    <button className="btn ghost sm" onClick={() => move(i, 1)} aria-label="Move down">
                      ↓
                    </button>
                    <button
                      className="btn ghost sm"
                      onClick={() => setItems((prev) => prev.filter((_, x) => x !== i))}
                      aria-label="Remove"
                    >
                      ✕
                    </button>
                  </span>
                </div>
                <div className="grid grid-3" style={{ marginTop: 'var(--sp-2)' }}>
                  <Field label="Sets">
                    <NumberInput
                      value={item.targetSets}
                      onChange={(v) => patchItem(i, { targetSets: Math.max(1, v ?? 1) })}
                      min={1}
                      max={12}
                      inputMode="numeric"
                    />
                  </Field>
                  <Field label="Reps">
                    <input
                      className="input"
                      value={item.targetReps ?? ''}
                      placeholder="8-12"
                      onChange={(e) => patchItem(i, { targetReps: e.target.value || undefined })}
                    />
                  </Field>
                  <Field label="Weight">
                    <NumberInput
                      value={item.targetWeight ?? null}
                      onChange={(v) => patchItem(i, { targetWeight: v ?? undefined })}
                      step={2.5}
                      min={0}
                    />
                  </Field>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}
