import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { METRICS, metricDef } from '@/db/metrics';
import type { MetricEntry, MetricKey } from '@/db/types';
import { Page } from '@/components/Layout';
import { Card, EmptyState, Segmented, StatTile } from '@/components/ui';
import { TrendChart } from '@/components/charts';
import { MetricEntrySheet } from '@/components/MetricEntrySheet';
import { useSettings } from '@/hooks/useData';
import { formatDay, formatTime } from '@/lib/date';
import { num, signed } from '@/lib/format';
import { metricUnit, toDisplay } from '@/lib/metricUnits';
import { buildMetricChart, sortEntries, trendTone } from '@/lib/metricSeries';
import { max as vmax, mean, min as vmin } from '@/lib/stats';

const WINDOWS = [
  { value: '30', label: '30d' },
  { value: '90', label: '90d' },
  { value: '180', label: '6m' },
  { value: '365', label: '1y' },
] as const;

/** One metric in depth: trend chart, summary statistics and full history. */
export default function MetricDetail() {
  const { metric } = useParams<{ metric: string }>();
  const navigate = useNavigate();
  const [settings] = useSettings();
  const [days, setDays] = useState<(typeof WINDOWS)[number]['value']>('90');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<MetricEntry | null>(null);

  const known = METRICS.some((m) => m.key === metric);
  const key = (known ? metric : 'weight') as MetricKey;
  const def = metricDef(key);

  const entries =
    useLiveQuery(() => db.metrics.where('metric').equals(key).toArray(), [key], []) ?? [];

  const chart = useMemo(
    () => buildMetricChart(def, entries, Number(days), settings),
    [def, entries, days, settings],
  );

  const history = useMemo(() => sortEntries(entries), [entries]);
  const unit = metricUnit(def, settings);
  const primary = def.fields[0];

  const windowValues = useMemo(
    () =>
      (chart.series[0]?.data ?? [])
        .map((p) => p.y)
        .filter((v): v is number => v != null),
    [chart],
  );

  const latest = history[0];
  const trend = chart.trend;

  return (
    <Page
      title={`${def.icon} ${def.label}`}
      actions={
        <button className="btn primary sm" onClick={() => setAdding(true)}>
          + Log
        </button>
      }
    >
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 'var(--sp-4)' }}>
        <button className="btn ghost sm" onClick={() => navigate('/health')}>
          ‹ All metrics
        </button>
        <Segmented value={days} options={WINDOWS} onChange={setDays} label="Time range" />
      </div>

      {history.length === 0 ? (
        <Card>
          <EmptyState
            icon={def.icon}
            title={`No ${def.label.toLowerCase()} readings`}
            action={
              <button className="btn primary" onClick={() => setAdding(true)}>
                Log a reading
              </button>
            }
          >
            Readings you add will chart here with a 7-day average.
          </EmptyState>
        </Card>
      ) : (
        <>
          <Card>
            <div className="card-head">
              <div>
                <div className="stat-label">Latest</div>
                <div className="stat-value">
                  {def.fields
                    .map((f) => num(toDisplay(def, latest.values[f.key], settings), def.precision))
                    .join(' / ')}
                  <span className="unit">{unit}</span>
                </div>
              </div>
              <div className="right tiny dim">
                {formatDay(latest.date)}
                <br />
                {formatTime(latest.recordedAt)}
              </div>
            </div>

            <TrendChart
              series={chart.series}
              height={220}
              band={
                def.band
                  ? {
                      from: toDisplay(def, def.band.from, settings),
                      to: toDisplay(def, def.band.to, settings),
                    }
                  : undefined
              }
              showDots={windowValues.length <= 60}
            />
            {def.band && (
              <p className="tiny dim" style={{ marginTop: 'var(--sp-2)' }}>
                Shaded band shows the commonly cited healthy range
                {' '}({num(toDisplay(def, def.band.from, settings), def.precision)}–
                {num(toDisplay(def, def.band.to, settings), def.precision)} {unit}). Not medical
                advice.
              </p>
            )}
          </Card>

          <div className="grid grid-2 section" style={{ marginTop: 'var(--sp-4)' }}>
            <StatTile
              label={`Change · ${WINDOWS.find((w) => w.value === days)?.label}`}
              value={trend ? signed(trend.delta, def.precision) : '—'}
              unit={unit}
              delta={
                trend
                  ? { text: `${signed(trend.slope * 7, def.precision)}/wk`, tone: trendTone(def, trend.delta) }
                  : undefined
              }
              meta={trend ? `${trend.n} readings` : 'Need 2+ readings'}
            />
            <StatTile
              label="Average"
              value={windowValues.length ? num(mean(windowValues), def.precision) : '—'}
              unit={unit}
              meta={
                windowValues.length
                  ? `${num(vmin(windowValues), def.precision)}–${num(vmax(windowValues), def.precision)} range`
                  : undefined
              }
            />
          </div>

          <Card title={`History · ${history.length}`}>
            <div className="list">
              {history.slice(0, 200).map((entry) => (
                <button key={entry.id} className="list-row" onClick={() => setEditing(entry)}>
                  <span className="lead" style={{ color: primary.color }} aria-hidden="true">
                    {def.icon}
                  </span>
                  <span className="body">
                    <span className="title">
                      {def.fields
                        .map(
                          (f) =>
                            `${num(toDisplay(def, entry.values[f.key], settings), def.precision)}${
                              def.fields.length > 1 ? ` ${f.short ?? f.label}` : ''
                            }`,
                        )
                        .join(' · ')}{' '}
                      <span className="dim small">{unit}</span>
                    </span>
                    <span className="sub">
                      {formatDay(entry.date)} · {formatTime(entry.recordedAt)}
                      {entry.note ? ` · ${entry.note}` : ''}
                    </span>
                  </span>
                  <span className="trail dim">›</span>
                </button>
              ))}
            </div>
          </Card>
        </>
      )}

      <MetricEntrySheet metric={key} open={adding} onClose={() => setAdding(false)} />
      {editing && (
        <MetricEntrySheet
          metric={key}
          entry={editing}
          open
          onClose={() => setEditing(null)}
        />
      )}
    </Page>
  );
}
