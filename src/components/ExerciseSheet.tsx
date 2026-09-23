import { useEffect, useState } from 'react';
import { db, removeRecord, uid } from '@/db/db';
import type { Exercise } from '@/db/types';
import { MUSCLE_LABELS } from '@/lib/training';
import { Field, isTouch, PhotoField, Sheet, useToast } from './ui';

/** The photo beside an exercise in a list, or a muscle-group glyph without one. */
export function ExerciseThumb({ exercise }: { exercise: Exercise }) {
  if (!exercise.photo) {
    return (
      <span className="lead" aria-hidden="true">
        🏋️
      </span>
    );
  }
  return (
    <img
      className="lead"
      src={exercise.photo}
      alt=""
      style={{ width: 38, height: 38, objectFit: 'cover', borderRadius: 'var(--radius-sm)' }}
    />
  );
}

export function ExerciseSheet({
  exercise,
  initialName,
  open,
  onClose,
  onSaved,
}: {
  exercise?: Exercise;
  /** Seeds the name, so a fruitless search can become the thing searched for. */
  initialName?: string;
  open: boolean;
  onClose: () => void;
  onSaved?: (exercise: Exercise) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [muscle, setMuscle] = useState<Exercise['muscle']>('chest');
  const [kind, setKind] = useState<Exercise['kind']>('strength');
  const [equipment, setEquipment] = useState('');
  const [photo, setPhoto] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!open) return;
    setName(exercise?.name ?? initialName ?? '');
    setMuscle(exercise?.muscle ?? 'chest');
    setKind(exercise?.kind ?? 'strength');
    setEquipment(exercise?.equipment ?? '');
    setPhoto(exercise?.photo);
  }, [open, exercise, initialName]);

  const save = async () => {
    if (!name.trim()) return;
    const record: Exercise = {
      id: exercise?.id ?? uid(),
      name: name.trim(),
      muscle,
      kind,
      equipment: equipment.trim() || undefined,
      photo,
      primary: exercise?.primary,
      notes: exercise?.notes,
      archived: exercise?.archived,
    };
    await db.exercises.put(record);
    toast.show(exercise ? `${record.name} updated` : `${record.name} added`);
    onSaved?.(record);
    onClose();
  };

  const remove = async () => {
    if (!exercise) return;
    const used = await db.sets.where('exerciseId').equals(exercise.id).count();
    if (used > 0) {
      await db.exercises.update(exercise.id, { archived: true });
      toast.show(`${exercise.name} archived — ${used} logged sets keep their history`);
    } else {
      await removeRecord('exercises', exercise.id);
      toast.show(`${exercise.name} deleted`);
    }
    onClose();
  };

  return (
    <Sheet
      open={open}
      title={exercise ? 'Edit exercise' : 'New exercise'}
      onClose={onClose}
      footer={
        <>
          {exercise ? (
            <button className="btn danger" onClick={remove}>
              Delete
            </button>
          ) : (
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
          )}
          <button className="btn primary" onClick={save} disabled={!name.trim()}>
            Save
          </button>
        </>
      }
    >
      <Field label="Name">
        <input
          className="input"
          value={name}
          autoFocus={!exercise && !isTouch()}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>

      <PhotoField
        value={photo}
        onChange={setPhoto}
        label="Photo"
        hint="The machine, the seat height, where the pin goes — whatever you'd want to see next time"
      />
      <Field label="Muscle group">
        <select
          className="select"
          value={muscle}
          onChange={(e) => setMuscle(e.target.value as Exercise['muscle'])}
        >
          {Object.entries(MUSCLE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Type">
        <select
          className="select"
          value={kind}
          onChange={(e) => setKind(e.target.value as Exercise['kind'])}
        >
          <option value="strength">Strength</option>
          <option value="bodyweight">Bodyweight</option>
          <option value="cardio">Cardio</option>
          <option value="timed">Timed</option>
        </select>
      </Field>
      <Field label="Equipment">
        <input
          className="input"
          value={equipment}
          placeholder="Barbell, dumbbell, machine…"
          onChange={(e) => setEquipment(e.target.value)}
        />
      </Field>
    </Sheet>
  );
}
