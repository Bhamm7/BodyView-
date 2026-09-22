import { useEffect, useState } from 'react';
import { db, removeRecord, uid } from '@/db/db';
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
  /** How much history points at this compound — null until counted. */
  const [usage, setUsage] = useState<{ protocols: number; doses: number } | null>(null);

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

  // A compound with protocols or logged doses behind it cannot simply vanish:
  // deleting it would leave those records pointing at nothing. Counted here so
  // the sheet can offer the honest choice — delete, or archive.
  useEffect(() => {
    let cancelled = false;
    if (!open || !compound) {
      setUsage(null);
      return;
    }
    void (async () => {
      const [protocols, doses] = await Promise.all([
        db.protocols.where('compoundId').equals(compound.id).count(),
        db.doses.where('compoundId').equals(compound.id).count(),
      ]);
      if (!cancelled) setUsage({ protocols, doses });
    })();
    return () => {
      cancelled = true;
    };
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

  const setArchived = async (archived: boolean) => {
    if (!compound) return;
    await db.compounds.update(compound.id, { archived: archived || undefined });
    toast.show(`${compound.name} ${archived ? 'archived' : 'restored'}`);
    onClose();
  };

  /** Only offered when nothing references the compound — see the count above. */
  const destroy = async () => {
    if (!compound || !unused) return;
    await removeRecord('compounds', compound.id);
    toast.show(`${compound.name} deleted`);
    onClose();
  };

  const unused = !!usage && usage.protocols === 0 && usage.doses === 0;
  const usageNote = !compound
    ? null
    : usage == null
      ? 'Checking what uses this compound…'
      : unused
        ? 'Nothing uses this compound, so it can be deleted outright.'
        : `Used by ${usage.protocols} protocol${usage.protocols === 1 ? '' : 's'} and ${usage.doses} logged dose${usage.doses === 1 ? '' : 's'}. Archive hides it from the pickers and keeps that history intact.`;

  return (
    <Sheet
      open={open}
      title={compound ? 'Edit compound' : 'New compound'}
      onClose={onClose}
      footer={
        <>
          {compound ? (
            unused ? (
              <button className="btn danger" onClick={destroy}>
                Delete
              </button>
            ) : (
              <button className="btn danger" onClick={() => setArchived(!compound.archived)}>
                {compound.archived ? 'Restore' : 'Archive'}
              </button>
            )
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
      {compound && (
        <div className="card" style={{ background: 'var(--surface-2)' }}>
          <div className="small">{usageNote}</div>
          <div className="row tight" style={{ marginTop: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <button className="btn sm" onClick={() => setArchived(!compound.archived)}>
              {compound.archived ? 'Restore to library' : 'Archive'}
            </button>
            {unused && (
              <button className="btn sm danger" onClick={destroy}>
                Delete permanently
              </button>
            )}
          </div>
        </div>
      )}

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
