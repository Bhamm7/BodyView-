import { useEffect, useState } from 'react';
import { db, uid } from '@/db/db';
import type { Compound, CompoundCategory, DoseUnit, Route } from '@/db/types';
import { DOSE_UNITS } from '@/lib/units';
import { Field, NumberInput, Sheet, useToast } from './ui';

export const CATEGORY_LABELS: Record<CompoundCategory, string> = {
  peptide: 'Peptide',
  ped: 'Performance',
  vitamin: 'Vitamin',
  supplement: 'Supplement',
  medication: 'Medication',
  ancillary: 'Ancillary',
};

export const CATEGORY_ICONS: Record<CompoundCategory, string> = {
  peptide: '🧬',
  ped: '💪',
  vitamin: '🟡',
  supplement: '🥄',
  medication: '💊',
  ancillary: '🛡️',
};

const ROUTES: Array<{ value: Route; label: string }> = [
  { value: 'oral', label: 'Oral' },
  { value: 'subcutaneous', label: 'Subcutaneous' },
  { value: 'intramuscular', label: 'Intramuscular' },
  { value: 'sublingual', label: 'Sublingual' },
  { value: 'nasal', label: 'Nasal' },
  { value: 'topical', label: 'Topical' },
];

const PALETTE = ['#38bdf8', '#34d399', '#a78bfa', '#f472b6', '#fb923c', '#facc15', '#94a3b8', '#2dd4bf'];

/** Creates or edits an entry in the compound library. */
export function CompoundSheet({
  compound,
  open,
  onClose,
  onSaved,
}: {
  compound?: Compound;
  open: boolean;
  onClose: () => void;
  onSaved?: (id: string) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [category, setCategory] = useState<CompoundCategory>('supplement');
  const [unit, setUnit] = useState<DoseUnit>('mg');
  const [defaultDose, setDefaultDose] = useState<number | null>(null);
  const [route, setRoute] = useState<Route | ''>('');
  const [color, setColor] = useState(PALETTE[0]);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!open) return;
    setName(compound?.name ?? '');
    setCategory(compound?.category ?? 'supplement');
    setUnit(compound?.defaultUnit ?? 'mg');
    setDefaultDose(compound?.defaultDose ?? null);
    setRoute(compound?.route ?? '');
    setColor(compound?.color ?? PALETTE[Math.floor(Math.random() * PALETTE.length)]);
    setNotes(compound?.notes ?? '');
  }, [open, compound]);

  const save = async () => {
    if (!name.trim()) return;
    const record: Compound = {
      id: compound?.id ?? uid(),
      name: name.trim(),
      category,
      defaultUnit: unit,
      defaultDose: defaultDose ?? undefined,
      route: route || undefined,
      color,
      notes: notes.trim() || undefined,
      archived: compound?.archived,
    };
    await db.compounds.put(record);
    toast.show(compound ? 'Compound updated' : `${record.name} added`);
    onSaved?.(record.id);
    onClose();
  };

  const archive = async () => {
    if (!compound) return;
    await db.compounds.update(compound.id, { archived: true });
    toast.show(`${compound.name} archived`);
    onClose();
  };

  return (
    <Sheet
      open={open}
      title={compound ? 'Edit compound' : 'New compound'}
      onClose={onClose}
      footer={
        <>
          {compound ? (
            <button className="btn danger" onClick={archive}>
              Archive
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
          placeholder="e.g. BPC-157"
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </Field>

      <Field label="Category">
        <div className="chip-row" style={{ flexWrap: 'wrap' }}>
          {(Object.keys(CATEGORY_LABELS) as CompoundCategory[]).map((c) => (
            <button
              key={c}
              type="button"
              className="chip"
              aria-pressed={category === c}
              onClick={() => setCategory(c)}
            >
              <span aria-hidden="true">{CATEGORY_ICONS[c]}</span>
              {CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>
      </Field>

      <div className="grid grid-2">
        <Field label="Default dose" hint="Optional — prefills new protocols">
          <NumberInput value={defaultDose} onChange={setDefaultDose} step={0.5} min={0} />
        </Field>
        <Field label="Unit">
          <select className="select" value={unit} onChange={(e) => setUnit(e.target.value as DoseUnit)}>
            {DOSE_UNITS.map((u) => (
              <option key={u} value={u}>
                {u === 'iu' ? 'IU' : u}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Route">
        <select
          className="select"
          value={route}
          onChange={(e) => setRoute(e.target.value as Route | '')}
        >
          <option value="">Not specified</option>
          {ROUTES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Colour" hint="Used on the calendar and charts">
        <div className="row tight wrap">
          {PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Colour ${c}`}
              aria-pressed={color === c}
              onClick={() => setColor(c)}
              style={{
                width: 34,
                height: 34,
                borderRadius: '50%',
                background: c,
                border: color === c ? '3px solid var(--text)' : '1px solid var(--border)',
              }}
            />
          ))}
        </div>
      </Field>

      <Field label="Notes">
        <textarea
          className="textarea"
          value={notes}
          placeholder="Reconstitution, storage, supplier…"
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>
    </Sheet>
  );
}
