import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import type { ISODate } from '@/db/types';
import { METRICS } from '@/db/metrics';
import { Page } from '@/components/Layout';
import { Card, EmptyState } from '@/components/ui';
import { DoseChecklist } from '@/components/DoseChecklist';
import { useCompoundMap, useExerciseMap, useSettings } from '@/hooks/useData';
import { formatDayLong, formatTime, relativeDay, shiftDate, today } from '@/lib/date';
import { dose as formatDose, num, pluralize } from '@/lib/format';
import { toDisplay, metricUnit } from '@/lib/metricUnits';
import { markerDef } from '@/db/bloodMarkers';
import { FLAG_LABEL, FLAG_TONE, flagFor } from '@/lib/blood';
import { totalMacros } from '@/lib/nutrition';
import { workingSets, workoutTitle, workoutVolume } from '@/lib/training';

/** Everything recorded on one day, and the doses still due. */
export default function DayDetail() {
  const { date: param } = useParams<{ date: string }>();
  const navigate = useNavigate();
  const date = param && /^\d{4}-\d{2}-\d{2}$/.test(param) ? param : today();

  return (
    <Page
      title={relativeDay(date)}
      actions={
        <>
          <button className="btn ghost sm icon" onClick={() => navigate(`/day/${shiftDate(date, -1)}`)} aria-label="Previous day">
            ‹
          </button>
          <button className="btn ghost sm icon" onClick={() => navigate(`/day/${shiftDate(date, 1)}`)} aria-label="Next day">
            ›
          </button>
        </>
      }
    >
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 'var(--sp-4)' }}>
        <button className="btn ghost sm" onClick={() => navigate('/calendar')}>
          ‹ Calendar
        </button>
        <span className="small dim">{formatDayLong(date)}</span>
      </div>

      <Card title="Doses">
        <DoseChecklist date={date} />
      </Card>

      <DayBody date={date} />
    </Page>
  );
}

/** Compact read-only rundown, reused inside the calendar page. */
export function DaySummary({ date }: { date: ISODate }) {
  const [settings] = useSettings();
  const compounds = useCompoundMap();

  const doses = useLiveQuery(() => db.doses.where('date').equals(date).toArray(), [date], []) ?? [];
  const metrics = useLiveQuery(() => db.metrics.where('date').equals(date).toArray(), [date], []) ?? [];
  const meals = useLiveQuery(() => db.meals.where('date').equals(date).toArray(), [date], []) ?? [];
  const workouts = useLiveQuery(() => db.workouts.where('date').equals(date).toArray(), [date], []) ?? [];
  const blood = useLiveQuery(() => db.bloodResults.where('date').equals(date).toArray(), [date], []) ?? [];

  const taken = doses.filter((d) => !d.skipped);
  const macros = totalMacros(meals);

  if (
    taken.length === 0 &&
    metrics.length === 0 &&
    meals.length === 0 &&
    workouts.length === 0 &&
    blood.length === 0
  ) {
    return <p className="tiny dim">Nothing recorded on this day.</p>;
  }

  return (
    <div className="col tight small">
      {metrics.length > 0 && (
        <div className="row tight">
          <span aria-hidden="true">❤️</span>
          <span className="muted">
            {metrics
              .map((m) => {
                const def = METRICS.find((d) => d.key === m.metric);
                if (!def) return null;
                return `${def.label} ${def.fields
                  .map((f) => num(toDisplay(def, m.values[f.key], settings), def.precision))
                  .join('/')} ${metricUnit(def, settings)}`;
              })
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
      )}
      {taken.length > 0 && (
        <div className="row tight">
          <span aria-hidden="true">💊</span>
          <span className="muted truncate">
            {taken
              .map((d) => `${compounds.get(d.compoundId)?.name ?? 'Dose'} ${formatDose(d.dose, d.unit)}`)
              .join(' · ')}
          </span>
        </div>
      )}
      {meals.length > 0 && (
        <div className="row tight">
          <span aria-hidden="true">🍽️</span>
          <span className="muted">
            {num(macros.kcal, 0)} kcal · P{num(macros.protein, 0)} C{num(macros.carbs, 0)} F
            {num(macros.fat, 0)}
          </span>
        </div>
      )}
      {workouts.length > 0 && (
        <div className="row tight" style={{ alignItems: 'flex-start' }}>
          <span aria-hidden="true">🏋️</span>
          <span className="muted">
            {workouts.map((w, i) => (
              <span key={w.id}>
                {i > 0 ? ', ' : ''}
                {workoutTitle(w)}
                {w.tags && w.tags.length > 0 && (
                  <span className="tag-pills" style={{ marginLeft: 5 }}>
                    {w.tags.map((tag) => (
                      <span key={tag} className="tag-pill">
                        {tag}
                      </span>
                    ))}
                  </span>
                )}
                {w.notes && <span title={w.notes}> 📝</span>}
              </span>
            ))}
          </span>
        </div>
      )}
      {blood.length > 0 && (
        <div className="row tight">
          <span aria-hidden="true">🩸</span>
          <span className="muted">{pluralize(blood.length, 'blood marker')}</span>
        </div>
      )}
    </div>
  );
}

function DayBody({ date }: { date: ISODate }) {
  const navigate = useNavigate();
  const [settings] = useSettings();
  const exercises = useExerciseMap();

  const metrics = useLiveQuery(() => db.metrics.where('date').equals(date).toArray(), [date], []) ?? [];
  const meals = useLiveQuery(() => db.meals.where('date').equals(date).toArray(), [date], []) ?? [];
  const workouts = useLiveQuery(() => db.workouts.where('date').equals(date).toArray(), [date], []) ?? [];
  const allSets = useLiveQuery(() => db.sets.toArray(), [], []) ?? [];
  const bloodResults =
    useLiveQuery(() => db.bloodResults.where('date').equals(date).toArray(), [date], []) ?? [];

  const macros = useMemo(() => totalMacros(meals), [meals]);

  return (
    <>
      <Card title="Body metrics">
        {metrics.length === 0 ? (
          <EmptyState title="No readings" icon="❤️">
            Log weight, blood pressure or anything else from the Health tab.
          </EmptyState>
        ) : (
          <div className="list">
            {metrics.map((m) => {
              const def = METRICS.find((d) => d.key === m.metric);
              if (!def) return null;
              return (
                <button
                  key={m.id}
                  className="list-row"
                  onClick={() => navigate(`/health/${def.key}`)}
                >
                  <span className="lead" aria-hidden="true">
                    {def.icon}
                  </span>
                  <span className="body">
                    <span className="title">
                      {def.fields
                        .map((f) => num(toDisplay(def, m.values[f.key], settings), def.precision))
                        .join(' / ')}{' '}
                      <span className="dim small">{metricUnit(def, settings)}</span>
                    </span>
                    <span className="sub">
                      {def.label} · {formatTime(m.recordedAt)}
                      {m.note ? ` · ${m.note}` : ''}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </Card>

      <Card
        title="Nutrition"
        action={
          meals.length > 0 ? (
            <span className="small mono">{num(macros.kcal, 0)} kcal</span>
          ) : undefined
        }
      >
        {meals.length === 0 ? (
          <EmptyState title="Nothing logged" icon="🍽️" />
        ) : (
          <div className="list">
            {meals
              .slice()
              .sort((a, b) => a.loggedAt.localeCompare(b.loggedAt))
              .map((m) => (
                <div key={m.id} className="list-row">
                  <span className="body">
                    <span className="title truncate">{m.name}</span>
                    <span className="sub">
                      {m.slot} · P{num(m.macros.protein, 0)} C{num(m.macros.carbs, 0)} F
                      {num(m.macros.fat, 0)}
                    </span>
                  </span>
                  <span className="trail mono">{num(m.macros.kcal, 0)}</span>
                </div>
              ))}
          </div>
        )}
      </Card>

      {bloodResults.length > 0 && (
        <Card
          title="Bloodwork"
          action={
            <button className="btn ghost sm" onClick={() => navigate('/bloodwork')}>
              Charts
            </button>
          }
        >
          <div className="list">
            {bloodResults.map((r) => {
              const flag = flagFor(r);
              return (
                <div key={r.id} className="list-row">
                  <span className="lead" aria-hidden="true">
                    🩸
                  </span>
                  <span className="body">
                    <span className="title">
                      {num(r.value, markerDef(r.marker)?.precision ?? 2)}{' '}
                      <span className="dim small">{r.unit}</span>
                    </span>
                    <span className="sub">{r.label}</span>
                  </span>
                  <span className="trail">
                    <span className={`badge ${FLAG_TONE[flag]}`}>{FLAG_LABEL[flag]}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Card title="Training">
        {workouts.length === 0 ? (
          <EmptyState title="Rest day" icon="😴" />
        ) : (
          <div className="list">
            {workouts.map((w) => {
              const sets = allSets.filter((s) => s.workoutId === w.id);
              const top = workingSets(sets)
                .slice(0, 4)
                .map((s) => `${exercises.get(s.exerciseId)?.name ?? '—'} ${s.weight ?? ''}×${s.reps ?? ''}`);
              return (
                <button key={w.id} className="list-row" onClick={() => navigate(`/workout/${w.id}`)}>
                  <span className="lead" aria-hidden="true">
                    🏋️
                  </span>
                  <span className="body">
                    <span className="title">
                      {workoutTitle(w)}
                      {w.tags && w.tags.length > 0 && (
                        <span className="tag-pills" style={{ marginLeft: 6 }}>
                          {w.tags.map((tag) => (
                            <span key={tag} className="tag-pill">
                              {tag}
                            </span>
                          ))}
                        </span>
                      )}
                    </span>
                    <span className="sub truncate">
                      {pluralize(workingSets(sets).length, 'set')} ·{' '}
                      {num(workoutVolume(sets), 0)} {settings.weightUnit}
                      {top.length ? ` · ${top.join(', ')}` : ''}
                    </span>
                    {w.notes && (
                      <span className="sub" style={{ whiteSpace: 'normal', marginTop: 4 }}>
                        📝 {w.notes}
                      </span>
                    )}
                  </span>
                  <span className="trail dim">›</span>
                </button>
              );
            })}
          </div>
        )}
      </Card>
    </>
  );
}
