import { useEffect, useMemo, useState } from 'react';
import { db, removeRecord, uid } from '@/db/db';
import type { DoseUnit, InventoryForm, InventoryItem } from '@/db/types';
import { Page } from '@/components/Layout';
import { Card, EmptyState, Field, MissingFields, NumberInput, ProgressBar, Segmented, Sheet, StatTile, useToast } from '@/components/ui';
import { useCompoundMap, useCompounds, useInventory, useProtocols } from '@/hooks/useData';
import { project, shortfall, STATUS_LABEL, STATUS_ORDER, type Projection } from '@/lib/inventory';
import { DOSE_UNITS, humanizeMass } from '@/lib/units';
import { formatDay, today } from '@/lib/date';
import { num, pluralize, unitLabel } from '@/lib/format';
import { CATEGORY_ICONS } from '@/components/CompoundSheet';

const FORMS: Array<{ value: InventoryForm; label: string }> = [
  { value: 'vial', label: 'Vial' },
  { value: 'capsule', label: 'Capsules' },
  { value: 'tablet', label: 'Tablets' },
  { value: 'powder', label: 'Powder' },
  { value: 'liquid', label: 'Liquid' },
  { value: 'pen', label: 'Pen' },
  { value: 'other', label: 'Other' },
];

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'attention', label: 'Needs attention' },
] as const;

const STATUS_TONE: Record<Projection['status'], string> = {
  ok: 'good',
  low: 'warning',
  critical: 'serious',
  empty: 'critical',
  unknown: '',
};

/**
 * Stock of compounds with a projected run-out date, derived from the active
 * protocols rather than entered by hand.
 */
export default function Inventory() {
  const items = useInventory();
  const protocols = useProtocols();
  const compounds = useCompoundMap();
  const [filter, setFilter] = useState<'all' | 'attention'>('all');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<InventoryItem | null>(null);

  const date = today();

  const projections = useMemo(
    () =>
      items
        .map((item) => project(item, protocols, compounds, date))
        .sort((a, b) => {
          const order = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
          if (order !== 0) return order;
          return (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity);
        }),
    [items, protocols, compounds, date],
  );

  const attention = projections.filter(
    (p) => p.status === 'low' || p.status === 'critical' || p.status === 'empty' || p.expiringSoon,
  );
  const shown = filter === 'attention' ? attention : projections;

  const soonest = projections.find((p) => p.runsOutOn);

  return (
    <Page
      title="Stock"
      actions={
        <button className="btn primary sm" onClick={() => setAdding(true)}>
          + Item
        </button>
      }
    >
      {items.length === 0 ? (
        <Card>
          <EmptyState
            icon="📦"
            title="Nothing in stock yet"
            action={
              <button className="btn primary" onClick={() => setAdding(true)}>
                Add stock
              </button>
            }
          >
            Add what you have on the shelf. BodyView works out how long it lasts from your active
            protocols, and warns you before you run out.
          </EmptyState>
        </Card>
      ) : (
        <>
          <div className="grid grid-2" style={{ marginBottom: 'var(--sp-4)' }}>
            <StatTile
              label="Needs attention"
              value={attention.length}
              icon="⚠️"
              meta={attention.length === 0 ? 'All stocked up' : 'Low, empty or expiring'}
            />
            <StatTile
              label="Next to run out"
              value={soonest ? `${soonest.daysLeft}d` : '—'}
              icon="⏳"
              meta={
                soonest
                  ? `${compounds.get(soonest.item.compoundId)?.name ?? 'Item'} · ${formatDay(soonest.runsOutOn!)}`
                  : 'No active burn rate'
              }
            />
          </div>

          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 'var(--sp-3)' }}>
            <span className="card-title">{pluralize(shown.length, 'item')}</span>
            <Segmented value={filter} options={FILTERS} onChange={setFilter} label="Filter" />
          </div>

          {shown.length === 0 ? (
            <Card>
              <EmptyState icon="✅" title="Nothing needs attention">
                Every item has more than two weeks of supply left.
              </EmptyState>
            </Card>
          ) : (
            <div className="grid grid-wide">
              {shown.map((p) => (
                <InventoryCard key={p.item.id} projection={p} onEdit={() => setEditing(p.item)} />
              ))}
            </div>
          )}
        </>
      )}

      <InventorySheet open={adding} onClose={() => setAdding(false)} />
      {editing && <InventorySheet item={editing} open onClose={() => setEditing(null)} />}
    </Page>
  );
}

function InventoryCard({ projection, onEdit }: { projection: Projection; onEdit: () => void }) {
  const { item, compound, status, daysLeft, runsOutOn, dailyUse, percentLeft } = projection;
  const stock = humanizeMass(projection.totalRemaining, item.unit);
  const gap = shortfall(projection);

  return (
    <button className="card" style={{ textAlign: 'left' }} onClick={onEdit}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="row tight" style={{ minWidth: 0 }}>
          <span aria-hidden="true">{compound ? CATEGORY_ICONS[compound.category] : '📦'}</span>
          <strong className="truncate">{compound?.name ?? item.label ?? 'Item'}</strong>
        </span>
        <span className={`badge ${STATUS_TONE[status]}`}>{STATUS_LABEL[status]}</span>
      </div>

      <div className="row" style={{ alignItems: 'baseline', gap: 'var(--sp-2)', marginTop: 6 }}>
        <span className="stat-value">
          {num(stock.value, 2)}
          <span className="unit">{unitLabel(stock.unit, stock.value)}</span>
        </span>
        {item.sealedCount ? (
          <span className="tiny dim">+{pluralize(item.sealedCount, 'sealed unit')}</span>
        ) : null}
      </div>

      {percentLeft != null && (
        <div style={{ margin: '8px 0' }}>
          <ProgressBar
            value={percentLeft}
            max={100}
            thin
            color={
              status === 'empty' || status === 'critical'
                ? 'var(--critical)'
                : status === 'low'
                  ? 'var(--warning)'
                  : 'var(--accent)'
            }
          />
        </div>
      )}

      <div className="small muted">
        {daysLeft != null && runsOutOn ? (
          <>
            <strong>
              <span className="mono">{daysLeft}</span> {daysLeft === 1 ? 'day' : 'days'}
            </strong>{' '}
            left — runs out {formatDay(runsOutOn)}
          </>
        ) : projection.protocols.length === 0 ? (
          'No active protocol drawing on this'
        ) : projection.coversProtocol ? (
          'Covers your protocol to the end ✓'
        ) : (
          'Lasts beyond the projection window'
        )}
      </div>

      {dailyUse != null && (
        <div className="tiny dim" style={{ marginTop: 2 }}>
          Using {num(dailyUse, 3)} {unitLabel(item.unit, dailyUse)}/day across{' '}
          {pluralize(projection.protocols.length, 'protocol')}
        </div>
      )}

      {gap != null && gap > 0 && (
        <div className="tiny" style={{ marginTop: 4, color: 'var(--serious)' }}>
          Short by {num(gap, 2)} {unitLabel(item.unit, gap)} to finish the cycle
        </div>
      )}

      {projection.unitMismatch && (
        <div className="tiny" style={{ marginTop: 4, color: 'var(--warning)' }}>
          ⚠ A protocol doses in units that can't be converted to {unitLabel(item.unit)} — set both
          to the same kind of unit for an accurate projection.
        </div>
      )}

      {projection.expiringSoon && item.expiresOn && (
        <div className="tiny" style={{ marginTop: 4, color: 'var(--warning)' }}>
          ⚠ Expires {formatDay(item.expiresOn)}
        </div>
      )}
    </button>
  );
}

/** Add or edit a stock item. */
function InventorySheet({
  item,
  open,
  onClose,
}: {
  item?: InventoryItem;
  open: boolean;
  onClose: () => void;
}) {
  const compounds = useCompounds();
  const toast = useToast();

  const [compoundId, setCompoundId] = useState('');
  const [form, setForm] = useState<InventoryForm>('vial');
  const [initial, setInitial] = useState<number | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  // New stock is almost always full, so mirror the unit size until the user
  // says otherwise — leaving this blank was the commonest reason Save stayed
  // disabled with nothing on screen to explain it.
  const [remainingEdited, setRemainingEdited] = useState(false);
  const [unit, setUnit] = useState<DoseUnit>('mg');
  const [sealed, setSealed] = useState<number | null>(0);
  const [reorderDays, setReorderDays] = useState<number | null>(14);
  const [expiresOn, setExpiresOn] = useState('');
  const [vendor, setVendor] = useState('');
  const [cost, setCost] = useState<number | null>(null);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!open) return;
    const seedId = item?.compoundId ?? compounds[0]?.id ?? '';
    setCompoundId(seedId);
    setForm(item?.form ?? 'vial');
    setInitial(item?.initial ?? null);
    setRemaining(item?.remaining ?? null);
    setRemainingEdited(item != null);
    setUnit(item?.unit ?? compounds.find((c) => c.id === seedId)?.defaultUnit ?? 'mg');
    setSealed(item?.sealedCount ?? 0);
    setReorderDays(item?.reorderDays ?? 14);
    setExpiresOn(item?.expiresOn ?? '');
    setVendor(item?.vendor ?? '');
    setCost(item?.cost ?? null);
    setNotes(item?.notes ?? '');
  }, [open, item, compounds]);

  const unitWord = unitLabel(unit, 2);
  const countBased = unit === 'capsule' || unit === 'tablet' || unit === 'drop';

  const missing: string[] = [];
  if (!compoundId) missing.push('compound');
  if (initial == null || initial <= 0) missing.push(countBased ? 'per container' : 'unit size');
  if (remaining == null) missing.push('remaining');
  const valid = missing.length === 0;

  const save = async () => {
    if (!valid) return;
    const record: InventoryItem = {
      id: item?.id ?? uid(),
      compoundId,
      form,
      initial: initial!,
      remaining: remaining!,
      unit,
      sealedCount: sealed ?? 0,
      reorderDays: reorderDays ?? undefined,
      expiresOn: expiresOn || undefined,
      vendor: vendor.trim() || undefined,
      cost: cost ?? undefined,
      notes: notes.trim() || undefined,
      purchasedOn: item?.purchasedOn ?? today(),
      label: item?.label,
    };
    await db.inventory.put(record);
    toast.show(item ? 'Stock updated' : 'Stock added');
    onClose();
  };

  const remove = async () => {
    if (!item) return;
    await removeRecord('inventory', item.id);
    toast.show('Item removed');
    onClose();
  };

  return (
    <Sheet
      open={open}
      title={item ? 'Edit stock' : 'Add stock'}
      onClose={onClose}
      footer={
        <>
          {item ? (
            <button className="btn danger" onClick={remove}>
              Delete
            </button>
          ) : (
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
          )}
          <button className="btn primary" onClick={save} disabled={!valid}>
            Save
          </button>
        </>
      }
    >
      <Field label="Compound" required>
        <select
          className="select"
          value={compoundId}
          onChange={(e) => {
            setCompoundId(e.target.value);
            const c = compounds.find((x) => x.id === e.target.value);
            if (c) setUnit(c.defaultUnit);
          }}
        >
          {compounds.length === 0 && <option value="">Add a compound first</option>}
          {compounds.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Form">
        <select
          className="select"
          value={form}
          onChange={(e) => setForm(e.target.value as InventoryForm)}
        >
          {FORMS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </Field>

      <div className="grid grid-2">
        <Field
          label={countBased ? 'Per container' : 'Unit size'}
          hint={countBased ? 'e.g. 90 capsules in a bottle' : 'e.g. a 10 mg vial'}
          required
        >
          <NumberInput
            value={initial}
            onChange={(value) => {
              setInitial(value);
              if (!remainingEdited) setRemaining(value);
            }}
            min={0}
            step={countBased ? 1 : 0.5}
          />
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

      <Field
        label={`Remaining in the open one (${unitWord})`}
        hint="Counts down automatically as you log doses"
        required
      >
        <div className="row tight">
          <NumberInput
            value={remaining}
            onChange={(value) => {
              setRemainingEdited(true);
              setRemaining(value);
            }}
            min={0}
            step={countBased ? 1 : 0.5}
          />
          <button
            className="btn sm"
            type="button"
            onClick={() => {
              setRemainingEdited(true);
              setRemaining(initial);
            }}
            disabled={initial == null}
          >
            Full
          </button>
        </div>
      </Field>

      <MissingFields missing={missing} />

      <div className="grid grid-2">
        <Field label="Sealed spares" hint="Unopened, opened automatically">
          <NumberInput value={sealed} onChange={setSealed} min={0} step={1} inputMode="numeric" />
        </Field>
        <Field label="Warn at" hint="Days of supply left">
          <NumberInput value={reorderDays} onChange={setReorderDays} min={1} step={1} suffix="days" />
        </Field>
      </div>

      <div className="grid grid-2">
        <Field label="Expires">
          <input
            className="input"
            type="date"
            value={expiresOn}
            onChange={(e) => setExpiresOn(e.target.value)}
          />
        </Field>
        <Field label="Cost">
          <NumberInput value={cost} onChange={setCost} min={0} step={1} />
        </Field>
      </div>

      <Field label="Vendor">
        <input className="input" value={vendor} onChange={(e) => setVendor(e.target.value)} />
      </Field>

      <Field label="Notes">
        <textarea
          className="textarea"
          value={notes}
          placeholder="Lot number, storage, reconstitution volume…"
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>
    </Sheet>
  );
}
