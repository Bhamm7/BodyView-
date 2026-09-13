import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { METRICS } from '@/db/metrics';
import type { MetricKey } from '@/db/types';
import { Page } from '@/components/Layout';
import { Card, EmptyState, Segmented, Sheet } from '@/components/ui';
import { Sparkline } from '@/components/sparkline';
import { MetricEntrySheet } from '@/components/MetricEntrySheet';
import { useSettings } from '@/hooks/useData';
import { agoLabel, lastNDays } from '@/lib/date';
import { num, signed } from '@/lib/format';
import { metricUnit, toDisplay } from '@/lib/metricUnits';
import { dailyValues, latestEntry, trendTone } from '@/lib/metricSeries';

const WINDOWS = [
  { value: '30', label: '30d' },
  { value: '90', label: '90d' },
  { value: '365', label: '1y' },
] as const;

/** Overview of every tracked metric: latest reading, change and a sparkline. */
export default function Health() {
  const navigate = useNavigate();
  const [settings] = useSettings();
  const [days, setDays] = useState<'30' | '90' | '365'>('30');
  const [logging, setLogging] = useState<MetricKey | null>(null);
  const [picking, setPicking] = useState(false);

  const entries = useLiveQuery(() => db.metrics.toArray(), [], []) ?? [];
  const window = Number(days);
  const dates = useMemo(() => lastNDays(window), [window]);

  const cards = useMemo(
    () =>
      METRICS.map((def) => {
        const mine = entries.filter((e) => e.metric === def.key);
        const field = def.fields[0];
        const byDate = dailyValues(mine, field.key);
        const points = dates.map((d) => {
          const raw = byDate.get(d);
          return raw == null ? null : toDisplay(def, raw, settings);
        });
        const seen = points.filter((p): p is number => p != null);
        const latest = latestEntry(mine);
        const delta = seen.length >= 2 ? seen[seen.length - 1] - seen[0] : null;
        return { def, mine, points, latest, delta, count: seen.length };
      }),
    [entries, dates, settings],
  );

  const tracked = cards.filter((c) => c.latest);
  const untracked = cards.filter((c) => !c.latest);

  return (
    <Page
      title="Health"
      actions={
        <button className="btn primary sm" onClick={() => setPicking(true)}>
          + Log
        </button>
      }
    >
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 'var(--sp-4)' }}>
        <span className="card-title">Trends</span>
        <Segmented
          value={days}
          options={WINDOWS}
          onChange={(v) => setDays(v)}
          label="Time range"
        />
      </div>

      {tracked.length === 0 ? (
        <Card>
          <EmptyState
            icon="❤️"
            title="No readings yet"
            action={
              <button className="btn primary" onClick={() => setPicking(true)}>
                Log your first reading
              </button>
            }
          >
            Track weight, blood pressure, resting heart rate and more. Everything stays on this
            device.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid grid-wide">
          {tracked.map(({ def, points, latest, delta, count }) => {
            const unit = metricUnit(def, settings);
            const primary = def.fields[0];
            const value = latest ? toDisplay(def, latest.values[primary.key], settings) : null;
            const tone = delta == null ? 'flat' : trendTone(def, delta);

            return (
              <button
                key={def.key}
                className="card"
                style={{ textAlign: 'left', cursor: 'pointer' }}
                onClick={() => navigate(`/health/${def.key}`)}
              >
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="stat-label">
                    <span aria-hidden="true">{def.icon}</span> {def.label}
                  </span>
                  <span className="tiny dim">{latest ? agoLabel(latest.date) : ''}</span>
                </div>

                <div className="row" style={{ alignItems: 'baseline', gap: 'var(--sp-2)' }}>
                  <span className="stat-value">
                    {def.fields.length > 1 && latest
                      ? def.fields
                          .map((f) => num(toDisplay(def, latest.values[f.key], settings), def.precision))
                          .join('/')
                      : num(value, def.precision)}
                    <span className="unit">{unit}</span>
                  </span>
                  {delta != null && count >= 2 && (
                    <span className={`delta small ${tone}`}>
                      {signed(delta, def.precision)} {WINDOWS.find((w) => w.value === days)?.label}
                    </span>
                  )}
                </div>

                <div style={{ marginTop: 'var(--sp-2)' }}>
                  <Sparkline data={points} color={primary.color} />
                </div>
              </button>
            );
          })}
        </div>
      )}

      {untracked.length > 0 && (
        <Card title="Not tracked yet" className="section">
          <div className="chip-row" style={{ flexWrap: 'wrap' }}>
            {untracked.map(({ def }) => (
              <button key={def.key} className="chip" onClick={() => setLogging(def.key)}>
                <span aria-hidden="true">{def.icon}</span> {def.label}
              </button>
            ))}
          </div>
        </Card>
      )}

      <Sheet open={picking} title="What are you logging?" onClose={() => setPicking(false)}>
        <div className="list">
          {METRICS.map((def) => (
            <button
              key={def.key}
              className="list-row"
              onClick={() => {
                setPicking(false);
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
              <span className="trail dim">›</span>
            </button>
          ))}
        </div>
      </Sheet>

      {logging && (
        <MetricEntrySheet
          metric={logging}
          open
          onClose={() => setLogging(null)}
        />
      )}
    </Page>
  );
}
