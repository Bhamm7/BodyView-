import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { metricDef } from '@/db/metrics';
import { Page } from '@/components/Layout';
import { Card, EmptyState, Segmented, StatTile } from '@/components/ui';
import { TrendChart, type Series } from '@/components/charts';
import { VitalsSessionSheet } from '@/components/VitalsSessionSheet';
import { useSettings } from '@/hooks/useData';
import { formatDay, formatShort, shiftDate, today } from '@/lib/date';
import { num, pluralize, signed } from '@/lib/format';
import { trendTone } from '@/lib/metricSeries';
import {
  type BpAverage,
  bpSessions,
  SESSION_LABEL,
  sessionsBetween,
  splitAverage,
  weeklyAverages,
} from '@/lib/vitals';

const WINDOWS = [
  { value: '8', label: '8w' },
  { value: '12', label: '12w' },
  { value: '26', label: '6m' },
] as const;

const BP = metricDef('bloodPressure');
const HR = metricDef('restingHr');
const SYS_COLOR = BP.fields[0].color;
const DIA_COLOR = BP.fields[1].color;
const AM_COLOR = 'var(--c-1)';
const PM_COLOR = 'var(--c-5)';

const bpText = (a: BpAverage | null) => (a ? `${num(a.systolic, 0)}/${num(a.diastolic, 0)}` : '—');

/**
 * Morning and night blood pressure: today's sessions, rolling 7-day averages,
 * and the week-by-week trend. Built only from readings tagged as a morning or
 * night session; a midday reading is left out.
 */
export default function Vitals() {
  const navigate = useNavigate();
  const [settings] = useSettings();
  const [weeks, setWeeks] = useState<(typeof WINDOWS)[number]['value']>('12');
  const [logging, setLogging] = useState(false);

  const bp = useLiveQuery(() => db.metrics.where('metric').equals('bloodPressure').toArray(), [], []) ?? [];
  const hr = useLiveQuery(() => db.metrics.where('metric').equals('restingHr').toArray(), [], []) ?? [];

  const date = today();
  const sessions = useMemo(() => bpSessions(bp, hr), [bp, hr]);
  const todays = splitAverage(sessionsBetween(sessions, date, date));
  const last7 = splitAverage(sessionsBetween(sessions, shiftDate(date, -6), date));
  const prev7 = splitAverage(sessionsBetween(sessions, shiftDate(date, -13), shiftDate(date, -7)));

  const weekly = useMemo(
    () => weeklyAverages(sessions, date, Number(weeks), settings.weekStartsOn),
    [sessions, date, weeks, settings.weekStartsOn],
  );

  const combined: Series[] = [
    {
      key: 'sys',
      label: 'Systolic',
      color: SYS_COLOR,
      unit: 'mmHg',
      precision: 0,
      data: weekly.map((w) => ({ x: w.start, y: w.all?.systolic ?? null })),
    },
    {
      key: 'dia',
      label: 'Diastolic',
      color: DIA_COLOR,
      unit: 'mmHg',
      precision: 0,
      data: weekly.map((w) => ({ x: w.start, y: w.all?.diastolic ?? null })),
    },
  ];
  const amPm: Series[] = [
    {
      key: 'am',
      label: 'Morning',
      color: AM_COLOR,
      unit: 'mmHg',
      precision: 0,
      data: weekly.map((w) => ({ x: w.start, y: w.am?.systolic ?? null })),
    },
    {
      key: 'pm',
      label: 'Night',
      color: PM_COLOR,
      unit: 'mmHg',
      precision: 0,
      data: weekly.map((w) => ({ x: w.start, y: w.pm?.systolic ?? null })),
    },
  ];
  const hasWeekly = weekly.some((w) => w.all);

  const change = (now: BpAverage | null, before: BpAverage | null) =>
    now && before ? now.systolic - before.systolic : null;
  const weekChange = change(last7.all, prev7.all);
  const hrChange = last7.all?.hr != null && prev7.all?.hr != null ? last7.all.hr - prev7.all.hr : null;

  return (
    <Page
      title="🩺 Vitals"
      actions={
        <button className="btn primary sm" onClick={() => setLogging(true)}>
          + Session
        </button>
      }
    >
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 'var(--sp-4)' }}>
        <button className="btn ghost sm" onClick={() => navigate('/health')}>
          ‹ Health
        </button>
        <Segmented value={weeks} options={WINDOWS} onChange={setWeeks} label="Weeks shown" />
      </div>

      {sessions.length === 0 ? (
        <Card>
          <EmptyState
            icon="🩺"
            title="No morning or night readings yet"
            action={
              <button className="btn primary" onClick={() => setLogging(true)}>
                Log a session
              </button>
            }
          >
            Take two or three blood pressure readings together each morning and night, with your
            resting heart rate. Averages and weekly trends build up here.
          </EmptyState>
        </Card>
      ) : (
        <>
          <Card title="Today">
            <div className="grid grid-2">
              {(['am', 'pm'] as const).map((s) => {
                const a = todays[s];
                return (
                  <div key={s} data-testid={`today-${s}`}>
                    <div className="stat-label">{SESSION_LABEL[s]}</div>
                    <div className="stat-value">
                      {bpText(a)}
                      {a && <span className="unit">mmHg</span>}
                    </div>
                    <div className="tiny dim">
                      {a
                        ? `${pluralize(sessions.find((x) => x.date === date && x.session === s)!.readings, 'reading')}${
                            a.hr != null ? ` · HR ${num(a.hr, 0)}` : ''
                          }`
                        : 'Not logged'}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <div className="grid grid-2 section" style={{ marginTop: 'var(--sp-4)' }}>
            <StatTile
              label="7-day average"
              value={bpText(last7.all)}
              unit="mmHg"
              delta={
                weekChange != null
                  ? { text: `${signed(weekChange, 0)} SYS vs prior 7d`, tone: trendTone(BP, weekChange) }
                  : undefined
              }
              meta={last7.all ? pluralize(last7.all.sessions, 'session') : 'No sessions'}
            />
            <StatTile
              label="Resting HR · 7d"
              value={last7.all?.hr != null ? num(last7.all.hr, 0) : '—'}
              unit="bpm"
              delta={
                hrChange != null
                  ? { text: `${signed(hrChange, 0)} vs prior 7d`, tone: trendTone(HR, hrChange) }
                  : undefined
              }
            />
            <StatTile
              label="Morning · 7d"
              value={bpText(last7.am)}
              unit="mmHg"
              meta={last7.am ? pluralize(last7.am.sessions, 'session') : 'No sessions'}
            />
            <StatTile
              label="Night · 7d"
              value={bpText(last7.pm)}
              unit="mmHg"
              meta={last7.pm ? pluralize(last7.pm.sessions, 'session') : 'No sessions'}
            />
          </div>

          <Card title="Weekly average">
            {hasWeekly ? (
              <TrendChart series={combined} height={200} showDots connectNulls={false} />
            ) : (
              <p className="small dim">No sessions in this range.</p>
            )}
          </Card>

          <Card title="Morning vs night · systolic" className="section">
            {hasWeekly ? (
              <TrendChart series={amPm} height={180} showDots connectNulls={false} />
            ) : (
              <p className="small dim">No sessions in this range.</p>
            )}
          </Card>

          <Card title="By week" className="section">
            <div style={{ overflowX: 'auto' }}>
              <table className="data" data-testid="weekly-table">
                <thead>
                  <tr>
                    <th>Week of</th>
                    <th className="num">Morning</th>
                    <th className="num">Night</th>
                    <th className="num">Avg</th>
                    <th className="num">HR</th>
                  </tr>
                </thead>
                <tbody>
                  {[...weekly]
                    .reverse()
                    .filter((w) => w.all)
                    .map((w) => (
                      <tr key={w.start}>
                        <td>{formatShort(w.start)}</td>
                        <td className="num mono">{bpText(w.am)}</td>
                        <td className="num mono">{bpText(w.pm)}</td>
                        <td className="num mono">
                          <strong>{bpText(w.all)}</strong>
                        </td>
                        <td className="num mono">{w.all?.hr != null ? num(w.all.hr, 0) : '—'}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Recent sessions" className="section">
            <div className="list">
              {sessions.slice(0, 14).map((s) => (
                <div key={`${s.date}-${s.session}`} className="list-row">
                  <span className="lead" aria-hidden="true">
                    {s.session === 'am' ? '🌅' : '🌙'}
                  </span>
                  <span className="body">
                    <span className="title mono">
                      {num(s.systolic, 0)}/{num(s.diastolic, 0)} <span className="dim small">mmHg</span>
                    </span>
                    <span className="sub">
                      {formatDay(s.date)} · {SESSION_LABEL[s.session]} · {pluralize(s.readings, 'reading')}
                      {s.hr != null ? ` · HR ${num(s.hr, 0)}` : ''}
                    </span>
                  </span>
                </div>
              ))}
            </div>
            <button
              className="btn ghost sm"
              style={{ marginTop: 'var(--sp-2)' }}
              onClick={() => navigate('/health/bloodPressure')}
            >
              Every reading, to edit or delete ›
            </button>
          </Card>

          <p className="tiny dim" style={{ marginTop: 'var(--sp-3)' }}>
            Only morning and night sessions count here. A reading logged at midday, or without a
            session, is left out. Each session is averaged first, so a three-reading session counts
            the same as a two-reading one. Not medical advice.
          </p>
        </>
      )}

      <VitalsSessionSheet open={logging} onClose={() => setLogging(false)} />
    </Page>
  );
}
