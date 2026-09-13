import { useEffect, useMemo, useState } from 'react';
import { db, uid } from '@/db/db';
import type { Food, MealEntry, MealSlot } from '@/db/types';
import { combineDateTime, nowTime } from '@/lib/date';
import { num } from '@/lib/format';
import { kcalFromMacros, MEAL_SLOTS, scaleMacros, servingLabel } from '@/lib/nutrition';
import { useFoods } from '@/hooks/useData';
import { Field, NumberInput, Sheet, useToast } from './ui';

/** Search the library, pick a food, set servings — the fast path when cooking. */
export function LogFoodSheet({
  date,
  slot,
  entry,
  open,
  onClose,
  onCreateFood,
}: {
  date: string;
  slot: MealSlot;
  entry?: MealEntry;
  open: boolean;
  onClose: () => void;
  onCreateFood: () => void;
}) {
  const foods = useFoods();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Food | null>(null);
  const [servings, setServings] = useState<number | null>(1);
  const [targetSlot, setTargetSlot] = useState<MealSlot>(slot);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setTargetSlot(entry?.slot ?? slot);
    setServings(entry?.servings ?? 1);
    setPicked(entry?.foodId ? (foods.find((f) => f.id === entry.foodId) ?? null) : null);
  }, [open, entry, slot, foods]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q
      ? foods.filter((f) => `${f.name} ${f.brand ?? ''}`.toLowerCase().includes(q))
      : [...foods].sort((a, b) => Number(!!b.favorite) - Number(!!a.favorite));
    return pool.slice(0, 60);
  }, [foods, query]);

  const macros = picked && servings ? scaleMacros(picked.per, servings) : null;

  const save = async () => {
    if (!picked || servings == null) return;
    const record: MealEntry = {
      id: entry?.id ?? uid(),
      date,
      slot: targetSlot,
      foodId: picked.id,
      name: picked.name,
      servings,
      macros: scaleMacros(picked.per, servings),
      loggedAt: entry?.loggedAt ?? combineDateTime(date, nowTime()),
    };
    await db.meals.put(record);
    toast.show(`${picked.name} logged`);
    onClose();
  };

  return (
    <Sheet
      open={open}
      title={entry ? 'Edit food' : 'Add food'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save} disabled={!picked || servings == null}>
            {entry ? 'Save' : 'Add'}
          </button>
        </>
      }
    >
      {picked ? (
        <>
          <div className="card" style={{ background: 'var(--surface-2)' }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div className="grow">
                <strong>{picked.name}</strong>
                <div className="tiny dim">
                  {picked.brand ? `${picked.brand} · ` : ''}
                  {servingLabel(picked, servings ?? 1)}
                </div>
              </div>
              <button className="btn ghost sm" onClick={() => setPicked(null)}>
                Change
              </button>
            </div>
          </div>

          <Field label="Servings" hint={`1 serving = ${picked.servingSize} ${picked.servingUnit}`}>
            <NumberInput value={servings} onChange={setServings} min={0} step={0.25} big />
          </Field>

          <div className="chip-row">
            {[0.5, 1, 1.5, 2, 3].map((v) => (
              <button key={v} className="chip" aria-pressed={servings === v} onClick={() => setServings(v)}>
                {v}×
              </button>
            ))}
          </div>

          {macros && (
            <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
              {(['kcal', 'protein', 'carbs', 'fat'] as const).map((k) => (
                <div key={k} className="stat" style={{ padding: 'var(--sp-2)' }}>
                  <span className="stat-label">{k === 'kcal' ? 'kcal' : k.slice(0, 4)}</span>
                  <span className="stat-value" style={{ fontSize: '1.125rem' }}>
                    {num(macros[k], 0)}
                  </span>
                </div>
              ))}
            </div>
          )}

          <Field label="Meal">
            <select
              className="select"
              value={targetSlot}
              onChange={(e) => setTargetSlot(e.target.value as MealSlot)}
            >
              {MEAL_SLOTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
        </>
      ) : (
        <>
          <input
            className="input"
            placeholder="Search foods…"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="list">
            {results.map((food) => (
              <button key={food.id} className="list-row" onClick={() => setPicked(food)}>
                <span className="lead" aria-hidden="true">
                  {food.favorite ? '⭐' : '🍽️'}
                </span>
                <span className="body">
                  <span className="title truncate">{food.name}</span>
                  <span className="sub">
                    {num(food.per.kcal, 0)} kcal · P{num(food.per.protein, 0)} C
                    {num(food.per.carbs, 0)} F{num(food.per.fat, 0)} per {food.servingSize}
                    {food.servingUnit}
                  </span>
                </span>
              </button>
            ))}
            {results.length === 0 && (
              <p className="dim small center" style={{ padding: 'var(--sp-4)' }}>
                No match for “{query}”.
              </p>
            )}
          </div>
          <button className="btn block" onClick={onCreateFood}>
            + Create a new food
          </button>
        </>
      )}
    </Sheet>
  );
}

/** Creates or edits a library food, entered per serving. */
export function FoodEditorSheet({
  food,
  open,
  onClose,
}: {
  food?: Food;
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [size, setSize] = useState<number | null>(100);
  const [unit, setUnit] = useState('g');
  const [kcal, setKcal] = useState<number | null>(null);
  const [protein, setProtein] = useState<number | null>(null);
  const [carbs, setCarbs] = useState<number | null>(null);
  const [fat, setFat] = useState<number | null>(null);
  const [fiber, setFiber] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(food?.name ?? '');
    setBrand(food?.brand ?? '');
    setSize(food?.servingSize ?? 100);
    setUnit(food?.servingUnit ?? 'g');
    setKcal(food?.per.kcal ?? null);
    setProtein(food?.per.protein ?? null);
    setCarbs(food?.per.carbs ?? null);
    setFat(food?.per.fat ?? null);
    setFiber(food?.per.fiber ?? null);
  }, [open, food]);

  const implied = kcalFromMacros({ protein: protein ?? 0, carbs: carbs ?? 0, fat: fat ?? 0 });
  const mismatch = kcal != null && kcal > 0 && Math.abs(implied - kcal) > Math.max(30, kcal * 0.15);

  const valid = !!name.trim() && size != null && size > 0 && kcal != null;

  const save = async () => {
    if (!valid) return;
    await db.foods.put({
      id: food?.id ?? uid(),
      name: name.trim(),
      brand: brand.trim() || undefined,
      servingSize: size!,
      servingUnit: unit.trim() || 'g',
      per: {
        kcal: kcal!,
        protein: protein ?? 0,
        carbs: carbs ?? 0,
        fat: fat ?? 0,
        fiber: fiber ?? 0,
      },
      favorite: food?.favorite,
    });
    toast.show(food ? 'Food updated' : `${name.trim()} added`);
    onClose();
  };

  return (
    <Sheet
      open={open}
      title={food ? 'Edit food' : 'New food'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save} disabled={!valid}>
            Save
          </button>
        </>
      }
    >
      <Field label="Name">
        <input className="input" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Brand">
        <input className="input" value={brand} onChange={(e) => setBrand(e.target.value)} />
      </Field>

      <div className="grid grid-2">
        <Field label="Serving size">
          <NumberInput value={size} onChange={setSize} min={0} step={10} />
        </Field>
        <Field label="Unit" hint="g, ml, slice, egg…">
          <input className="input" value={unit} onChange={(e) => setUnit(e.target.value)} />
        </Field>
      </div>

      <div className="card-title">Per serving</div>
      <div className="grid grid-2">
        <Field label="Calories">
          <NumberInput value={kcal} onChange={setKcal} min={0} step={10} suffix="kcal" />
        </Field>
        <Field label="Protein">
          <NumberInput value={protein} onChange={setProtein} min={0} step={1} suffix="g" />
        </Field>
        <Field label="Carbs">
          <NumberInput value={carbs} onChange={setCarbs} min={0} step={1} suffix="g" />
        </Field>
        <Field label="Fat">
          <NumberInput value={fat} onChange={setFat} min={0} step={1} suffix="g" />
        </Field>
        <Field label="Fibre">
          <NumberInput value={fiber} onChange={setFiber} min={0} step={1} suffix="g" />
        </Field>
      </div>

      {mismatch && (
        <p className="tiny" style={{ color: 'var(--warning)' }}>
          ⚠ Those macros work out to about {num(implied, 0)} kcal, not {num(kcal, 0)}. Worth a
          double-check.
        </p>
      )}
    </Sheet>
  );
}
