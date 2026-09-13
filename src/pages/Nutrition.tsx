import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, removeRecord, uid } from '@/db/db';
import type { Food, MealEntry, MealSlot, NutritionTarget } from '@/db/types';
import { Page } from '@/components/Layout';
import { Card, EmptyState, Field, NumberInput, ProgressBar, Segmented, Sheet, useToast } from '@/components/ui';
import { BarSeries } from '@/components/charts';
import { FoodEditorSheet, LogFoodSheet } from '@/components/FoodSheet';
import { useActiveTarget, useFoods, useMealsOn } from '@/hooks/useData';
import { formatShort, lastNDays, relativeDay, shiftDate, today } from '@/lib/date';
import { num } from '@/lib/format';
import {
  groupBySlot,
  kcalFromMacros,
  MACRO_COLORS,
  macroSplit,
  MEAL_SLOTS,
  servingLabel,
  totalMacros,
} from '@/lib/nutrition';

type Tab = 'day' | 'trends' | 'foods';

const TABS = [
  { value: 'day', label: 'Day' },
  { value: 'trends', label: 'Trends' },
  { value: 'foods', label: 'Foods' },
] as const;

/** Diet: what was eaten today against target, weekly trends, and the food library. */
export default function Nutrition() {
  const [tab, setTab] = useState<Tab>('day');
  const [date, setDate] = useState(today());
  const [logging, setLogging] = useState<MealSlot | null>(null);
  const [editingEntry, setEditingEntry] = useState<MealEntry | null>(null);
  const [creatingFood, setCreatingFood] = useState(false);
  const [editingFood, setEditingFood] = useState<Food | null>(null);
  const [editingTarget, setEditingTarget] = useState(false);

  const meals = useMealsOn(date);
  const target = useActiveTarget();
  const foods = useFoods();

  const totals = useMemo(() => totalMacros(meals), [meals]);
  const bySlot = useMemo(() => groupBySlot(meals), [meals]);
  const split = macroSplit(totals);

  return (
    <Page
      title="Nutrition"
      actions={
        <button className="btn primary sm" onClick={() => setLogging('snack')}>
          + Food
        </button>
      }
    >
      <Segmented value={tab} options={TABS} onChange={setTab} block label="Section" />

      {tab === 'day' && (
        <div style={{ marginTop: 'var(--sp-4)' }}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 'var(--sp-3)' }}>
            <button className="btn ghost sm" onClick={() => setDate(shiftDate(date, -1))}>
              ‹
            </button>
            <strong>{relativeDay(date)}</strong>
            <button
              className="btn ghost sm"
              onClick={() => setDate(shiftDate(date, 1))}
              disabled={date >= today()}
            >
              ›
            </button>
          </div>

          <Card
            title="Today's totals"
            action={
              <button className="btn ghost sm" onClick={() => setEditingTarget(true)}>
                {target ? 'Edit target' : 'Set target'}
              </button>
            }
          >
            <div className="row" style={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
              <span className="stat-value">
                {num(totals.kcal, 0)}
                <span className="unit">kcal</span>
              </span>
              {target && (
                <span className="small dim">
                  {totals.kcal <= target.macros.kcal
                    ? `${num(target.macros.kcal - totals.kcal, 0)} left`
                    : `${num(totals.kcal - target.macros.kcal, 0)} over`}{' '}
                  of {num(target.macros.kcal, 0)}
                </span>
              )}
            </div>

            {target && (
              <div style={{ margin: '10px 0 var(--sp-4)' }}>
                <ProgressBar
                  value={totals.kcal}
                  max={target.macros.kcal}
                  color={totals.kcal > target.macros.kcal * 1.05 ? 'var(--warning)' : 'var(--accent)'}
                />
              </div>
            )}

            <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              {(['protein', 'carbs', 'fat'] as const).map((macro) => {
                const value = totals[macro];
                const goal = target?.macros[macro];
                return (
                  <div key={macro}>
                    <div className="row tiny" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                      <span className="row" style={{ gap: 5 }}>
                        <span className="dot" style={{ background: MACRO_COLORS[macro] }} aria-hidden="true" />
                        <span className="dim" style={{ textTransform: 'capitalize' }}>
                          {macro}
                        </span>
                      </span>
                    </div>
                    <div className="mono" style={{ fontWeight: 700 }}>
                      {num(value, 0)}
                      <span className="dim tiny">
                        {goal ? `/${num(goal, 0)}` : ''} g
                      </span>
                    </div>
                    {goal ? (
                      <div style={{ marginTop: 4 }}>
                        <ProgressBar value={value} max={goal} thin color={MACRO_COLORS[macro]} />
                      </div>
                    ) : (
                      <div className="tiny dim">{num(split[macro], 0)}% of energy</div>
                    )}
                  </div>
                );
              })}
            </div>

            {totals.fiber ? (
              <div className="tiny dim" style={{ marginTop: 'var(--sp-3)' }}>
                Fibre {num(totals.fiber, 0)} g
                {target?.macros.fiber ? ` of ${num(target.macros.fiber, 0)} g` : ''}
              </div>
            ) : null}
          </Card>

          {MEAL_SLOTS.map((slot) => {
            const entries = bySlot.get(slot.value) ?? [];
            if (entries.length === 0 && slot.value !== 'breakfast' && slot.value !== 'lunch' && slot.value !== 'dinner') {
              return null;
            }
            const slotTotals = totalMacros(entries);
            return (
              <Card
                key={slot.value}
                title={
                  <h2 className="card-title">
                    <span aria-hidden="true">{slot.icon}</span> {slot.label}
                    {entries.length > 0 && (
                      <span className="dim"> · {num(slotTotals.kcal, 0)} kcal</span>
                    )}
                  </h2>
                }
                action={
                  <button className="btn ghost sm" onClick={() => setLogging(slot.value)}>
                    + Add
                  </button>
                }
              >
                {entries.length === 0 ? (
                  <p className="tiny dim">Nothing logged.</p>
                ) : (
                  <div className="list">
                    {entries.map((entry) => {
                      const food = foods.find((f) => f.id === entry.foodId);
                      return (
                        <button
                          key={entry.id}
                          className="list-row"
                          onClick={() => setEditingEntry(entry)}
                        >
                          <span className="body">
                            <span className="title truncate">{entry.name}</span>
                            <span className="sub">
                              {food ? servingLabel(food, entry.servings) : `${entry.servings} serving`}
                              {' · '}P{num(entry.macros.protein, 0)} C{num(entry.macros.carbs, 0)} F
                              {num(entry.macros.fat, 0)}
                            </span>
                          </span>
                          <span className="trail mono">{num(entry.macros.kcal, 0)}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {tab === 'trends' && <NutritionTrends target={target} />}

      {tab === 'foods' && (
        <div style={{ marginTop: 'var(--sp-4)' }}>
          <Card
            title={`Food library · ${foods.length}`}
            action={
              <button className="btn sm" onClick={() => setCreatingFood(true)}>
                + New
              </button>
            }
          >
            <div className="list">
              {foods.map((food) => (
                <button key={food.id} className="list-row" onClick={() => setEditingFood(food)}>
                  <span
                    className="lead"
                    aria-hidden="true"
                    onClick={(e) => {
                      e.stopPropagation();
                      db.foods.update(food.id, { favorite: !food.favorite });
                    }}
                  >
                    {food.favorite ? '⭐' : '🍽️'}
                  </span>
                  <span className="body">
                    <span className="title truncate">{food.name}</span>
                    <span className="sub">
                      {num(food.per.kcal, 0)} kcal per {food.servingSize}
                      {food.servingUnit} · P{num(food.per.protein, 0)} C{num(food.per.carbs, 0)} F
                      {num(food.per.fat, 0)}
                    </span>
                  </span>
                  <span className="trail dim">›</span>
                </button>
              ))}
            </div>
          </Card>
        </div>
      )}

      {logging && (
        <LogFoodSheet
          date={date}
          slot={logging}
          open
          onClose={() => setLogging(null)}
          onCreateFood={() => {
            setLogging(null);
            setCreatingFood(true);
          }}
        />
      )}
      {editingEntry && (
        <MealEntrySheet entry={editingEntry} open onClose={() => setEditingEntry(null)} />
      )}
      <FoodEditorSheet open={creatingFood} onClose={() => setCreatingFood(false)} />
      {editingFood && <FoodEditorSheet food={editingFood} open onClose={() => setEditingFood(null)} />}
      <TargetSheet target={target} open={editingTarget} onClose={() => setEditingTarget(false)} />
    </Page>
  );
}

/** Calories and protein over the last month, against target. */
function NutritionTrends({ target }: { target?: NutritionTarget }) {
  const [days, setDays] = useState<'14' | '30' | '90'>('30');
  const dates = useMemo(() => lastNDays(Number(days)), [days]);
  const from = dates[0];
  const to = dates[dates.length - 1];

  const meals =
    useLiveQuery(() => db.meals.where('date').between(from, to, true, true).toArray(), [from, to], []) ??
    [];

  const byDate = useMemo(() => {
    const map = new Map<string, MealEntry[]>();
    for (const m of meals) {
      const list = map.get(m.date) ?? [];
      list.push(m);
      map.set(m.date, list);
    }
    return map;
  }, [meals]);

  const kcalPoints = dates.map((d) => {
    const entries = byDate.get(d);
    return { x: d, y: entries ? totalMacros(entries).kcal : null };
  });
  const proteinPoints = dates.map((d) => {
    const entries = byDate.get(d);
    return { x: d, y: entries ? totalMacros(entries).protein : null };
  });

  const logged = kcalPoints.filter((p) => p.y != null);
  const avgKcal = logged.length
    ? logged.reduce((a, p) => a + (p.y ?? 0), 0) / logged.length
    : 0;

  return (
    <div style={{ marginTop: 'var(--sp-4)' }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 'var(--sp-3)' }}>
        <span className="card-title">{logged.length} days logged</span>
        <Segmented
          value={days}
          options={[
            { value: '14', label: '14d' },
            { value: '30', label: '30d' },
            { value: '90', label: '90d' },
          ]}
          onChange={(v) => setDays(v)}
          label="Time range"
        />
      </div>

      {logged.length === 0 ? (
        <Card>
          <EmptyState icon="📊" title="No meals logged yet">
            Log a few days of food and your intake trend will appear here.
          </EmptyState>
        </Card>
      ) : (
        <>
          <Card title={`Calories · ${num(avgKcal, 0)} kcal/day average`}>
            <BarSeries
              data={kcalPoints}
              label="Calories"
              unit="kcal"
              color="var(--c-1)"
              target={target ? { value: target.macros.kcal, label: 'Target' } : undefined}
              colorFor={(p) =>
                target && p.y != null && p.y > target.macros.kcal * 1.05
                  ? 'var(--c-4)'
                  : 'var(--c-1)'
              }
              labelFormatter={(l) => formatShort(l)}
            />
            {target && (
              <p className="tiny dim" style={{ marginTop: 'var(--sp-2)' }}>
                Bars above target are shown in amber.
              </p>
            )}
          </Card>

          <Card title="Protein">
            <BarSeries
              data={proteinPoints}
              label="Protein"
              unit="g"
              color="var(--c-3)"
              target={target ? { value: target.macros.protein, label: 'Target' } : undefined}
              labelFormatter={(l) => formatShort(l)}
            />
          </Card>
        </>
      )}
    </div>
  );
}

/** Edits a single logged food entry. */
function MealEntrySheet({
  entry,
  open,
  onClose,
}: {
  entry: MealEntry;
  open: boolean;
  onClose: () => void;
}) {
  const foods = useFoods();
  const food = foods.find((f) => f.id === entry.foodId);
  const toast = useToast();
  const [servings, setServings] = useState<number | null>(entry.servings);
  const [slot, setSlot] = useState<MealSlot>(entry.slot);

  const save = async () => {
    if (servings == null) return;
    const per = food?.per ?? {
      kcal: entry.macros.kcal / entry.servings,
      protein: entry.macros.protein / entry.servings,
      carbs: entry.macros.carbs / entry.servings,
      fat: entry.macros.fat / entry.servings,
      fiber: (entry.macros.fiber ?? 0) / entry.servings,
    };
    await db.meals.update(entry.id, {
      servings,
      slot,
      macros: {
        kcal: per.kcal * servings,
        protein: per.protein * servings,
        carbs: per.carbs * servings,
        fat: per.fat * servings,
        fiber: (per.fiber ?? 0) * servings,
      },
    });
    toast.show('Entry updated');
    onClose();
  };

  return (
    <Sheet
      open={open}
      title={entry.name}
      onClose={onClose}
      footer={
        <>
          <button
            className="btn danger"
            onClick={async () => {
              await removeRecord('meals', entry.id);
              toast.show('Entry removed');
              onClose();
            }}
          >
            Delete
          </button>
          <button className="btn primary" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <Field label="Servings" hint={food ? `1 serving = ${food.servingSize} ${food.servingUnit}` : undefined}>
        <NumberInput value={servings} onChange={setServings} min={0} step={0.25} big />
      </Field>
      <Field label="Meal">
        <select className="select" value={slot} onChange={(e) => setSlot(e.target.value as MealSlot)}>
          {MEAL_SLOTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </Field>
    </Sheet>
  );
}

/** Sets the active macro target. */
function TargetSheet({
  target,
  open,
  onClose,
}: {
  target?: NutritionTarget;
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const [kcal, setKcal] = useState<number | null>(target?.macros.kcal ?? 2600);
  const [protein, setProtein] = useState<number | null>(target?.macros.protein ?? 190);
  const [carbs, setCarbs] = useState<number | null>(target?.macros.carbs ?? 270);
  const [fat, setFat] = useState<number | null>(target?.macros.fat ?? 80);
  const [fiber, setFiber] = useState<number | null>(target?.macros.fiber ?? 35);

  const implied = kcalFromMacros({ protein: protein ?? 0, carbs: carbs ?? 0, fat: fat ?? 0 });

  const save = async () => {
    const record: NutritionTarget = {
      id: target?.id ?? uid(),
      name: target?.name ?? 'My target',
      macros: {
        kcal: kcal ?? 0,
        protein: protein ?? 0,
        carbs: carbs ?? 0,
        fat: fat ?? 0,
        fiber: fiber ?? 0,
      },
      active: true,
    };
    await db.targets.put(record);
    toast.show('Target saved');
    onClose();
  };

  return (
    <Sheet
      open={open}
      title="Daily target"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <Field label="Calories">
        <NumberInput value={kcal} onChange={setKcal} min={0} step={50} suffix="kcal" big />
      </Field>
      <div className="grid grid-2">
        <Field label="Protein">
          <NumberInput value={protein} onChange={setProtein} min={0} step={5} suffix="g" />
        </Field>
        <Field label="Carbs">
          <NumberInput value={carbs} onChange={setCarbs} min={0} step={5} suffix="g" />
        </Field>
        <Field label="Fat">
          <NumberInput value={fat} onChange={setFat} min={0} step={5} suffix="g" />
        </Field>
        <Field label="Fibre">
          <NumberInput value={fiber} onChange={setFiber} min={0} step={5} suffix="g" />
        </Field>
      </div>
      <p className="tiny dim">
        Those macros add up to {num(implied, 0)} kcal.
        {kcal != null && Math.abs(implied - kcal) > 60
          ? ` Your calorie target is ${num(kcal, 0)} — adjust if that gap is not deliberate.`
          : ''}
      </p>
    </Sheet>
  );
}
