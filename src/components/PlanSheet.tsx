import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, removeRecord, uid } from '@/db/db';
import type { PlanKind, TrainingPlan } from '@/db/types';
import { PLAN_DAY_LABELS } from '@/lib/plan';
import { Field, Segmented, Sheet, useToast } from './ui';

const KINDS = [
  { value: 'weekday', label: 'By weekday' },
  { value: 'rotation', label: 'Rotation' },
] as const;

/**
 * Arranges saved workouts into a plan: either anchored to days of the week, or
 * an order that advances each time a session is started.
 */
export function PlanSheet({
  plan,
  open,
  onClose,
}: {
  plan?: TrainingPlan;
  open: boolean;
  onClose: () => void;
}) {
  const templates = useLiveQuery(() => db.templates.toArray(), [], []) ?? [];
  const toast = useToast();

  const [name, setName] = useState('');
  const [kind, setKind] = useState<PlanKind>('weekday');
  const [days, setDays] = useState<Array<{ day: number; templateId: string }>>([]);
  const [rotation, setRotation] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setName(plan?.name ?? '');
    setKind(plan?.kind ?? 'weekday');
    setDays(plan?.days ?? []);
    setRotation(plan?.rotation ?? []);
  }, [open, plan]);

  const setDay = (day: number, templateId: string) =>
    setDays((prev) => {
      const rest = prev.filter((d) => d.day !== day);
      return templateId ? [...rest, { day, templateId }] : rest;
    });

  const moveInRotation = (index: number, delta: number) =>
    setRotation((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const filled = kind === 'weekday' ? days.length > 0 : rotation.length > 0;

  const save = async () => {
    if (!name.trim() || !filled) return;
    const record: TrainingPlan = {
      id: plan?.id ?? uid(),
      name: name.trim(),
      kind,
      days: kind === 'weekday' ? days : undefined,
      rotation: kind === 'rotation' ? rotation : undefined,
      // A changed rotation should start from the top rather than mid-cycle.
      position: kind === 'rotation' ? (plan?.kind === 'rotation' ? (plan.position ?? 0) : 0) : undefined,
      notes: plan?.notes,
      active: plan?.active ?? true,
    };
    await db.plans.put(record);
    toast.show(plan ? 'Plan updated' : `${record.name} saved`);
    onClose();
  };

  const remove = async () => {
    if (!plan) return;
    await removeRecord('plans', plan.id);
    toast.show('Plan deleted');
    onClose();
  };

  return (
    <Sheet
      open={open}
      title={plan ? 'Edit plan' : 'New plan'}
      onClose={onClose}
      footer={
        <>
          {plan ? (
            <button className="btn danger" onClick={remove}>
              Delete
            </button>
          ) : (
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
          )}
          <button className="btn primary" onClick={save} disabled={!name.trim() || !filled}>
            Save
          </button>
        </>
      }
    >
      {templates.length === 0 ? (
        <p className="small dim">
          Save a workout first — a plan arranges saved workouts, so there is nothing to
          arrange yet.
        </p>
      ) : (
        <>
          <Field label="Name">
            <input
              className="input"
              value={name}
              placeholder="e.g. Winter block"
              onChange={(e) => setName(e.target.value)}
              autoFocus={!plan}
            />
          </Field>

          <Field
            label="Shape"
            hint={
              kind === 'weekday'
                ? 'Repeats every week. Days left empty are rest days.'
                : 'Advances one session each time you train, whatever the date.'
            }
          >
            <Segmented value={kind} options={KINDS} onChange={setKind} block label="Plan shape" />
          </Field>

          {kind === 'weekday' && (
            <div className="list">
              {PLAN_DAY_LABELS.map((label, day) => (
                <Field key={label} label={label}>
                  <select
                    className="select"
                    value={days.find((d) => d.day === day)?.templateId ?? ''}
                    onChange={(e) => setDay(day, e.target.value)}
                  >
                    <option value="">Rest</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </Field>
              ))}
            </div>
          )}

          {kind === 'rotation' && (
            <>
              <Field label="Add to the rotation">
                <select
                  className="select"
                  value=""
                  onChange={(e) => {
                    if (e.target.value) setRotation((prev) => [...prev, e.target.value]);
                  }}
                >
                  <option value="">Choose…</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Field>

              {rotation.length === 0 ? (
                <p className="small dim">Add sessions in the order you want to train them.</p>
              ) : (
                <div className="list">
                  {rotation.map((id, i) => (
                    <div key={`${id}-${i}`} className="list-row">
                      <span className="lead dim">{i + 1}</span>
                      <span className="body">
                        <span className="title">
                          {templates.find((t) => t.id === id)?.name ?? 'Deleted workout'}
                        </span>
                      </span>
                      <span className="trail row tight">
                        <button className="btn ghost sm" onClick={() => moveInRotation(i, -1)} aria-label="Move up">
                          ↑
                        </button>
                        <button className="btn ghost sm" onClick={() => moveInRotation(i, 1)} aria-label="Move down">
                          ↓
                        </button>
                        <button
                          className="btn ghost sm"
                          onClick={() => setRotation((prev) => prev.filter((_, x) => x !== i))}
                          aria-label="Remove"
                        >
                          ✕
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </Sheet>
  );
}
