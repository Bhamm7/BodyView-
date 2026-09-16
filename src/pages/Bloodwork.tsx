import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { BLOOD_MARKERS, markerDef } from '@/db/bloodMarkers';
import type { BloodPanel } from '@/db/types';
import { Page } from '@/components/Layout';
import { Card, EmptyState, Segmented } from '@/components/ui';
import { TrendChart, type Series } from '@/components/charts';
import { BloodPanelSheet } from '@/components/BloodPanelSheet';
import { MarkerPicker, type PickerOption } from '@/components/MarkerPicker';
import {
  FLAG_LABEL,
  FLAG_TONE,
  groupForCharts,
  referenceFor,
  summarise,
  type MarkerSummary,
} from '@/lib/blood';
import { formatDay, relativeDay } from '@/lib/date';
import { num, pluralize, signed } from '@/lib/format';

type Tab = 'charts' | 'panels';

const TABS = [
  { value: 'charts', label: 'Charts' },
  { value: 'panels', label: 'Panels' },
] as const;

/** Series colours, in the fixed order the palette defines. */
const SERIES_COLORS = ['var(--c-1)', 'var(--c-2)', 'var(--c-3)', 'var(--c-4)', 'var(--c-5)', 'var(--c-6)'];

const STORAGE_KEY = 'bodyview.blood.selected';

/** Bloodwork: panels in, charts and comparisons out. */
export default function Bloodwork() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('charts');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<BloodPanel | null>(null);

  const panels = useLiveQuery(() => db.bloodPanels.reverse().sortBy('date'), [], []) ?? [];
  const results = useLiveQuery(() => db.bloodResults.toArray(), [], []) ?? [];

  const summaries = useMemo(() => summarise(results), [results]);
  const byMarker = useMemo(
    () => new Map(summaries.map((s) => [s.marker, s])),
    [summaries],
  );

  // Remembered per device: which markers you look at is a personal habit, not
  // data worth syncing.
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setSelected(JSON.parse(stored));
    } catch {
      /* private mode, or cleared storage — the default is fine */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(selected));
    } catch {
      /* not worth surfacing */
    }
  }, [selected]);

  // Default to whatever has the most history, so the page is never blank.
  useEffect(() => {
    if (selected.length > 0 || summaries.length === 0) return;
    const withHistory = summaries.filter((s) => s.points.length > 1);
    const pick = (withHistory.length > 0 ? withHistory : summaries).slice(0, 4);
    setSelected(pick.map((s) => s.marker));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summaries.length]);

  const options: PickerOption[] = useMemo(() => {
    const recorded = summaries.map((s) => ({
      key: s.marker,
      label: s.label,
      unit: s.unit || '—',
      category: (s.def?.category ?? 'other') as PickerOption['category'],
      count: s.points.length,
    }));
    const seen = new Set(recorded.map((o) => o.key));
    const rest = BLOOD_MARKERS.filter((m) => !seen.has(m.key)).map((m) => ({
      key: m.key,
      label: m.label,
      unit: m.unit,
      category: m.category,
      count: 0,
    }));
    return [...recorded, ...rest];
  }, [summaries]);

  const chosen = useMemo(
    () => selected.map((key) => byMarker.get(key)).filter((s): s is MarkerSummary => !!s),
    [selected, byMarker],
  );

  const groups = useMemo(() => groupForCharts(chosen), [chosen]);

  return (
    <Page
      title="Bloodwork"
      actions={
        <button className="btn primary sm" onClick={() => setAdding(true)}>
          + Panel
        </button>
      }
    >
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 'var(--sp-4)' }}>
        <button className="btn ghost sm" onClick={() => navigate('/health')}>
          ‹ Metrics
        </button>
        <Segmented value={tab} options={TABS} onChange={setTab} label="Section" />
      </div>

      {panels.length === 0 ? (
        <Card>
          <EmptyState
            icon="🩸"
            title="No blood panels yet"
            action={
              <button className="btn primary" onClick={() => setAdding(true)}>
                Add a panel
              </button>
            }
          >
            Paste a report from MyHealth Alberta, upload a CSV, or type the markers in. Results are
            saved against the collection date, so they line up with everything else on that day.
          </EmptyState>
        </Card>
      ) : tab === 'charts' ? (
        <>
          <Card title="Markers to chart">
            <MarkerPicker options={options} selected={selected} onChange={setSelected} />
            <p className="tiny dim" style={{ marginTop: 'var(--sp-2)', marginBottom: 0 }}>
              Markers sharing a unit are drawn on one chart; others get their own, so no chart ever
              carries two scales.
            </p>
          </Card>

          {chosen.length === 0 ? (
            <Card>
              <EmptyState icon="📈" title="Pick some markers">
                Choose from the list above to chart them over time.
              </EmptyState>
            </Card>
          ) : (
            <>
              {groups.map((group) => {
                const dates = [
                  ...new Set(group.markers.flatMap((m) => m.points.map((p) => p.date))),
                ].sort();

                const series: Series[] = group.markers.map((marker, i) => {
                  const byDate = new Map(marker.points.map((p) => [p.date, p.value]));
                  return {
                    key: marker.marker,
                    label: marker.label,
                    color: SERIES_COLORS[i % SERIES_COLORS.length],
                    data: dates.map((d) => ({ x: d, y: byDate.get(d) ?? null })),
                    unit: marker.unit,
                    precision: marker.def?.precision ?? 2,
                  };
                });

                const title =
                  group.markers.length === 1
                    ? `${group.markers[0].label} (${group.unit})`
                    : `${group.unit}`;

                return (
                  <Card key={`${group.unit}-${group.markers.map((m) => m.marker).join('-')}`} title={title}>
                    <TrendChart series={series} band={group.band} height={220} showDots />
                    {group.band && (
                      <p className="tiny dim" style={{ marginTop: 'var(--sp-2)' }}>
                        Shaded band is the reference interval
                        {group.markers[0].latest && referenceFor(group.markers[0].latest.result).fromLab
                          ? ' from your report'
                          : ' (typical adult range)'}
                        .
                      </p>
                    )}
                  </Card>
                );
              })}

              <ComparisonTable markers={chosen} />
            </>
          )}
        </>
      ) : (
        <PanelList panels={panels} onEdit={setEditing} />
      )}

      <BloodPanelSheet open={adding} onClose={() => setAdding(false)} />
      {editing && <BloodPanelSheet panel={editing} open onClose={() => setEditing(null)} />}
    </Page>
  );
}

/** Latest against previous, which is the comparison people actually want. */
function ComparisonTable({ markers }: { markers: MarkerSummary[] }) {
  const comparable = markers.filter((m) => m.latest);
  if (comparable.length === 0) return null;

  return (
    <Card title="Latest vs previous">
      <div className="scroll-x">
        <table className="data">
          <thead>
            <tr>
              <th>Marker</th>
              <th className="num">Latest</th>
              <th className="num">Previous</th>
              <th className="num">Change</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {comparable.map((m) => {
              const precision = m.def?.precision ?? 2;
              return (
                <tr key={m.marker}>
                  <td style={{ whiteSpace: 'normal' }}>
                    <div>{m.label}</div>
                    <div className="tiny dim">
                      {m.latest ? formatDay(m.latest.date) : ''} · {m.unit}
                    </div>
                  </td>
                  <td className="num">
                    <strong>{num(m.latest!.value, precision)}</strong>
                  </td>
                  <td className="num dim">
                    {m.previous ? num(m.previous.value, precision) : '—'}
                  </td>
                  <td className="num">
                    {m.delta != null ? (
                      <>
                        {signed(m.delta, precision)}
                        {m.percentChange != null && (
                          <span className="dim tiny"> ({signed(m.percentChange, 0)}%)</span>
                        )}
                      </>
                    ) : (
                      <span className="dim">—</span>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${FLAG_TONE[m.flag]}`}>{FLAG_LABEL[m.flag]}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="tiny dim" style={{ marginTop: 'var(--sp-3)', marginBottom: 0 }}>
        Change is against the previous panel containing that marker, which may not be the panel
        immediately before it.
      </p>
    </Card>
  );
}

function PanelList({
  panels,
  onEdit,
}: {
  panels: BloodPanel[];
  onEdit: (panel: BloodPanel) => void;
}) {
  const results = useLiveQuery(() => db.bloodResults.toArray(), [], []) ?? [];

  const countsByPanel = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of results) counts.set(r.panelId, (counts.get(r.panelId) ?? 0) + 1);
    return counts;
  }, [results]);

  const outOfRange = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of results) {
      const def = markerDef(r.marker);
      const low = r.refLow ?? def?.ref?.low;
      const high = r.refHigh ?? def?.ref?.high;
      if ((low != null && r.value < low) || (high != null && r.value > high)) {
        counts.set(r.panelId, (counts.get(r.panelId) ?? 0) + 1);
      }
    }
    return counts;
  }, [results]);

  return (
    <Card title={`Panels · ${panels.length}`}>
      <div className="list">
        {panels.map((panel) => {
          const flagged = outOfRange.get(panel.id) ?? 0;
          return (
            <button key={panel.id} className="list-row" onClick={() => onEdit(panel)}>
              <span className="lead" aria-hidden="true">
                🩸
              </span>
              <span className="body">
                <span className="title">{relativeDay(panel.date)}</span>
                <span className="sub">
                  {formatDay(panel.date)} · {pluralize(countsByPanel.get(panel.id) ?? 0, 'result')}
                  {panel.lab ? ` · ${panel.lab}` : ''}
                </span>
              </span>
              <span className="trail">
                {flagged > 0 ? (
                  <span className="badge serious">{flagged} out of range</span>
                ) : (
                  <span className="badge good">All in range</span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
