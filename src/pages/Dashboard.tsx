import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, uid } from '@/db/db';
import type { MetricKey } from '@/db/types';
import { METRICS, metricDef } from '@/db/metrics';
import { Page } from '@/components/Layout';
import { Card, EmptyState, ProgressBar, Sheet, StatTile } from '@/components/ui';
import { Sparkline } from '@/components/sparkline';
import { DoseChecklist } from '@/components/DoseChecklist';
import { MetricEntrySheet } from '@/components/MetricEntrySheet';
import {
  useActiveProtocols,
  useActiveTarget,
  useCompoundMap,
  useInventory,
  useMealsOn,
  useOpenWorkout,
  useProtocols,
  useSettings,
} from '@/hooks/useData';
import { agoLabel, formatDay, lastNDays, nowISO, relativeDay, today } from '@/lib/date';
import { num, pluralize, signed } from '@/lib/format';
import { metricUnit, toDisplay } from '@/lib/metricUnits';
import { dailyValues, latestEntry, trendTone } from '@/lib/metricSeries';
import { project, STATUS_LABEL } from '@/lib/inventory';
import { dueDoses } from '@/lib/doses';
import { totalMacros } from '@/lib/nutrition';
import { workoutTitle } from '@/lib/training';

/** The landing screen: what is due today and where every area stands. */
export default function Dashboard() {
  const navigate = useNavigate();
  const [settings] = useSettings();
  const [logging, setLogging] = useState<MetricKey | null>(null);
  const [quickPick, setQuickPick] = useState(false);

  const date = today();
  const dates = useMemo(() => lastNDays(30, date), [date]);

  const protocols = useProtocols();
  const activeProtocols = useActiveProtocols();
  const compounds = useCompoundMap();
  const inventory = useInventory();
  const meals = useMealsOn(date);
  const target = useActiveTarget();
  const openWorkout = useOpenWorkout();

  const metricEntries = useLiveQuery(() => db.metrics.toArray(), [], []) ?? [];
  const todaysDoses = useLiveQuery(() => db.doses.where('date').equals(date).toArray(), [date], []) ?? [];
  const recentWorkouts =
    useLiveQuery(() => db.workouts.reverse().sortBy('date').then((w) => w.slice(0, 5)), [], []) ?? [];

  const due = useMemo(
    () => dueDoses(date, activeProtocols, todaysDoses),
    [date, activeProtocols, todaysDoses],
  );
  const dosesTaken = due.filter((d) => d.log && !d.log.skipped).length;

  const macros = useMemo(() => totalMacros(meals), [meals]);

  const alerts = useMemo(
    () =>
      inventory
        .map((item) => project(item, protocols, compounds, date))
        .filter((p) => p.status === 'critical' || p.status === 'empty' || p.status === 'low')
        .sort((a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999)),
    [inventory, protocols, compounds, date],
  );

  const pinned = settings.dashboardMetrics.length
    ? settings.dashboardMetrics
    : (['weight', 'bloodPressure', 'restingHr'] as MetricKey[]);

  const lastWorkout = recentWorkouts.find((w) => w.finishedAt);

  return (
    <Page
      title={relativeDay(date)}
      actions={
        <button className="btn ghost sm icon" onClick={() => navigate('/settings')} aria-label="Settings">
          ⚙️
        </button>
      }
    >
      {alerts.length > 0 && (
        <Card className="section">
          <div className="card-head">
            <h2 className="card-title">⚠️ Stock alerts</h2>
            <button className="btn ghost sm" onClick={() => navigate('/inventory')}>
              Manage
            </button>
          </div>
          <div className="list">
            {alerts.slice(0, 4).map((p) => (
              <button key={p.item.id} className="list-row" onClick={() => navigate('/inventory')}>
                <span className="lead" aria-hidden="true">
                  📦
                </span>
                <span className="body">
                  <span className="title truncate">{p.compound?.name ?? 'Item'}</span>
                  <span className="sub">
                    {p.daysLeft != null
                      ? `${pluralize(p.daysLeft, 'day')} left · runs out ${formatDay(p.runsOutOn!)}`
                      : STATUS_LABEL[p.status]}
                  </span>
                </span>
                <span className="trail">
                  <span
                    className={`badge ${p.status === 'low' ? 'warning' : p.status === 'critical' ? 'serious' : 'critical'}`}
                  >
                    {STATUS_LABEL[p.status]}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </Card>
      )}

      <Card
        title="Today's doses"
        action={
          <button className="btn ghost sm" onClick={() => navigate('/cycles')}>
            All cycles
          </button>
        }
        className="section"
      >
        {due.length > 0 && (
          <div className="row tiny dim" style={{ justifyContent: 'space-between', marginBottom: 'var(--sp-2)' }}>
            <span>
              {dosesTaken} of {due.length} taken
            </span>
            <span style={{ width: 120 }}>
              <ProgressBar value={dosesTaken} max={due.length} thin />
            </span>
          </div>
        )}
        <DoseChecklist date={date} compact />
      </Card>

      <div className="section">
        <div className="section-head">
          <h2 className="card-title">Body metrics</h2>
          <button className="btn ghost sm" onClick={() => setQuickPick(true)}>
            + Log
          </button>
        </div>
        <div className="grid grid-auto">
          {pinned.map((key) => {
            const def = metricDef(key);
            const mine = metricEntries.filter((e) => e.metric === key);
            const latest = latestEntry(mine);
            const field = def.fields[0];
            const byDate = dailyValues(mine, field.key);
            const points = dates.map((d) => {
              const raw = byDate.get(d);
              return raw == null ? null : toDisplay(def, raw, settings);
            });
            const seen = points.filter((p): p is number => p != null);
            const delta = seen.length >= 2 ? seen[seen.length - 1] - seen[0] : null;

            return (
              <button
                key={key}
                className="stat"
                style={{ cursor: 'pointer' }}
                onClick={() => (latest ? navigate(`/health/${key}`) : setLogging(key))}
              >
                <span className="stat-label">
                  <span aria-hidden="true">{def.icon}</span> {def.label}
                </span>
                <span className="stat-value">
                  {latest
                    ? def.fields
                        .map((f) => num(toDisplay(def, latest.values[f.key], settings), def.precision))
                        .join('/')
                    : '—'}
                  <span className="unit">{metricUnit(def, settings)}</span>
                </span>
                <span className="stat-meta">
                  {delta != null ? (
                    <span className={`delta ${trendTone(def, delta)}`}>
                      {signed(delta, def.precision)} 30d
                    </span>
                  ) : latest ? (
                    agoLabel(latest.date)
                  ) : (
                    'Tap to log'
                  )}
                </span>
                {seen.length >= 2 && (
                  <span style={{ marginTop: 4 }}>
                    <Sparkline data={points} color={field.color} height={26} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-2 section">
        <StatTile
          label="Calories today"
          value={num(macros.kcal, 0)}
          icon="🍽️"
          meta={
            target
              ? `${num(Math.max(0, target.macros.kcal - macros.kcal), 0)} left of ${num(target.macros.kcal, 0)}`
              : `P${num(macros.protein, 0)} C${num(macros.carbs, 0)} F${num(macros.fat, 0)}`
          }
          onClick={() => navigate('/nutrition')}
        />
        <StatTile
          label="Protein today"
          value={num(macros.protein, 0)}
          unit="g"
          icon="🥩"
          meta={target ? `of ${num(target.macros.protein, 0)} g target` : undefined}
          onClick={() => navigate('/nutrition')}
        />
      </div>

      <Card
        title="Training"
        action={
          <button className="btn ghost sm" onClick={() => navigate('/training')}>
            Open
          </button>
        }
      >
        {openWorkout ? (
          <button
            className="btn primary block lg"
            onClick={() => navigate(`/workout/${openWorkout.id}`)}
          >
            Resume “{workoutTitle(openWorkout)}”
          </button>
        ) : (
          <>
            <button className="btn primary block lg" onClick={() => startQuickWorkout(navigate)}>
              Start a workout
            </button>
            {lastWorkout ? (
              <p className="tiny dim" style={{ marginTop: 'var(--sp-3)', marginBottom: 0 }}>
                Last session: {workoutTitle(lastWorkout)} · {agoLabel(lastWorkout.date)}
              </p>
            ) : (
              <p className="tiny dim" style={{ marginTop: 'var(--sp-3)', marginBottom: 0 }}>
                No sessions logged yet.
              </p>
            )}
          </>
        )}
      </Card>

      {activeProtocols.length === 0 && metricEntries.length === 0 && (
        <Card className="section">
          <EmptyState icon="👋" title="Welcome to BodyView">
            Everything is stored on this device. Start by logging a weigh-in, adding a protocol, or
            opening the calendar to see it all come together.
          </EmptyState>
        </Card>
      )}

      <Sheet open={quickPick} title="Log a metric" onClose={() => setQuickPick(false)}>
        <div className="list">
          {METRICS.map((def) => (
            <button
              key={def.key}
              className="list-row"
              onClick={() => {
                setQuickPick(false);
                setLogging(def.key);
              }}
            >
              <span className="lead" aria-hidden="true">
                {def.icon}
              </span>
              <span className="body">
                <span className="title">{def.label}</span>
                <span className="sub">{metricUnit(def, settings)}</span>
              </span>
            </button>
          ))}
        </div>
      </Sheet>

      {logging && <MetricEntrySheet metric={logging} open onClose={() => setLogging(null)} />}
    </Page>
  );
}

/** Creates an empty session and jumps straight into it. */
async function startQuickWorkout(navigate: (path: string) => void) {
  const id = uid();
  await db.workouts.add({
    id,
    date: today(),
    name: 'Workout',
    startedAt: nowISO(),
  });
  navigate(`/workout/${id}`);
}
