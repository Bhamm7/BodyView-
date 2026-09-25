import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, removeRecord, removeRecords } from '@/db/db';
import type { LabPanel, LabResult } from '@/db/types';
import { Page } from '@/components/Layout';
import { Card, EmptyState, Segmented, Sheet, useConfirm, useToast } from '@/components/ui';
import { TrendChart } from '@/components/charts';
import { LabImportSheet } from '@/components/LabImportSheet';
import { useProtocols } from '@/hooks/useData';
import { useCompoundMap } from '@/hooks/useData';
import { formatDay } from '@/lib/date';
import { num } from '@/lib/format';
import {
  CATEGORY_LABELS,
  displayDecimals,
  markerDef,
  rangeStatus,
  type MarkerCategory,
} from '@/lib/markers';

type Tab = 'markers' | 'panels';

const TABS = [
  { value: 'markers', label: 'Markers' },
  { value: 'panels', label: 'Draws' },
] as const;

const STATUS_BADGE: Record<string, string> = {
  high: 'badge serious',
  low: 'badge warning',
  in: 'badge good',
};

/** Bloodwork: every draw, and each marker's trend across them. */
export default function Bloodwork() {
  const [tab, setTab] = useState<Tab>('markers');
  const [importing, setImporting] = useState(false);
  const [openMarker, setOpenMarker] = useState<string | null>(null);

  const panels = useLiveQuery(() => db.labPanels.orderBy('date').toArray(), [], []) ?? [];
  const results = useLiveQuery(() => db.labResults.toArray(), [], []) ?? [];

  const dateOf = useMemo(() => new Map(panels.map((p) => [p.id, p.date])), [panels]);

  /** Every marker seen, with its readings oldest first. */
  const series = useMemo(() => {
    const byMarker = new Map<string, Array<LabResult & { date: string }>>();
    for (const result of results) {
      const date = dateOf.get(result.panelId);
      if (!date) continue;
      const key = result.marker ?? `raw:${result.reportedName.toLowerCase()}`;
      const list = byMarker.get(key) ?? [];
      list.push({ ...result, date });
      byMarker.set(key, list);
    }
    return [...byMarker.entries()]
      .map(([key, list]) => {
        const readings = list.sort((a, b) => a.date.localeCompare(b.date));
        const latest = readings[readings.length - 1];
        const def = latest.marker ? markerDef(latest.marker) : undefined;
        return {
          key,
          def,
          label: def?.label ?? latest.label,
          category: (def?.category ?? 'other') as MarkerCategory,
          readings,
          latest,
          previous: readings.length > 1 ? readings[readings.length - 2] : undefined,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [results, dateOf]);

  const byCategory = useMemo(() => {
    const groups = new Map<MarkerCategory, typeof series>();
    for (const entry of series) {
      const list = groups.get(entry.category) ?? [];
      list.push(entry);
      groups.set(entry.category, list);
    }
    return [...groups.entries()].sort((a, b) =>
      CATEGORY_LABELS[a[0]].localeCompare(CATEGORY_LABELS[b[0]]),
    );
  }, [series]);

  const marker = series.find((s) => s.key === openMarker) ?? null;

  return (
    <Page
      title="Bloodwork"
      actions={
        <button className="btn primary sm" onClick={() => setImporting(true)}>
          + Import
        </button>
      }
    >
      {panels.length === 0 ? (
        <Card>
          <EmptyState
            icon="🩸"
            title="No bloodwork yet"
            action={
              <button className="btn primary" onClick={() => setImporting(true)}>
                Import a report
              </button>
            }
          >
            Import the PDF or spreadsheet from MyHealth Records, or paste the results straight from
            a report. Everything is read on this device and stays here.
          </EmptyState>
        </Card>
      ) : (
        <>
          <Segmented value={tab} options={TABS} onChange={setTab} block label="Section" />

          {tab === 'markers' && (
            <div style={{ marginTop: 'var(--sp-4)' }}>
              {byCategory.map(([category, entries]) => (
                <Card key={category} title={CATEGORY_LABELS[category]}>
                  <div className="list">
                    {entries.map((entry) => {
                      const status = rangeStatus(entry.latest.value, {
                        low: entry.latest.low,
                        high: entry.latest.high,
                      });
                      const delta = entry.previous
                        ? entry.latest.value - entry.previous.value
                        : null;
                      const decimals = displayDecimals(entry.latest.value, entry.def);
                      const moved = delta != null && Number(delta.toFixed(decimals)) !== 0;
                      return (
                        <button
                          key={entry.key}
                          className="list-row"
                          onClick={() => setOpenMarker(entry.key)}
                        >
                          <span className="body">
                            <span className="title truncate">{entry.label}</span>
                            <span className="sub">
                              {entry.readings.length === 1
                                ? 'one draw'
                                : `${entry.readings.length} draws`}
                              {delta == null
                                ? ''
                                : moved
                                  ? ` · ${delta > 0 ? '+' : '−'}${num(Math.abs(delta), decimals)} since last`
                                  : ' · unchanged'}
                            </span>
                          </span>
                          <span className="trail row tight">
                            <span className="mono">
                              {num(entry.latest.value, decimals)}{' '}
                              <span className="dim tiny">{entry.latest.unit}</span>
                            </span>
                            {status !== 'unknown' && (
                              <span className={STATUS_BADGE[status]}>
                                {status === 'in' ? '✓' : status === 'high' ? 'H' : 'L'}
                              </span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </Card>
              ))}
            </div>
          )}

          {tab === 'panels' && (
            <div style={{ marginTop: 'var(--sp-4)' }}>
              <PanelList panels={panels} results={results} />
            </div>
          )}
        </>
      )}

      <LabImportSheet open={importing} onClose={() => setImporting(false)} />
      {marker && (
        <MarkerSheet
          title={marker.label}
          unit={marker.latest.unit}
          decimals={displayDecimals(marker.latest.value, marker.def)}
          readings={marker.readings}
          onClose={() => setOpenMarker(null)}
        />
      )}
    </Page>
  );
}

/** One marker over time, with its reference range and the protocols running. */
function MarkerSheet({
  title,
  unit,
  decimals,
  readings,
  onClose,
}: {
  title: string;
  unit: string;
  decimals: number;
  readings: Array<LabResult & { date: string }>;
  onClose: () => void;
}) {
  const protocols = useProtocols();
  const compounds = useCompoundMap();

  const latest = readings[readings.length - 1];
  const band =
    latest.low != null && latest.high != null
      ? { from: latest.low, to: latest.high, label: 'Reference range' }
      : undefined;

  const series = [
    {
      key: 'value',
      label: title,
      color: 'var(--c-1)',
      unit,
      precision: decimals,
      data: readings.map((r) => ({ x: r.date, y: r.value })),
    },
  ];

  /** Protocols that were running when any of these draws were taken. */
  const context = useMemo(() => {
    const first = readings[0].date;
    const last = latest.date;
    return protocols
      .filter((p) => p.startDate <= last && (!p.endDate || p.endDate >= first))
      .map((p) => ({
        id: p.id,
        name: compounds.get(p.compoundId)?.name ?? 'Protocol',
        startDate: p.startDate,
        endDate: p.endDate,
      }))
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
  }, [protocols, compounds, readings, latest.date]);

  return (
    <Sheet open title={title} onClose={onClose}>
      <TrendChart series={series} band={band} height={220} showDots />

      {context.length > 0 && (
        <div>
          <div className="card-title">Running over this window</div>
          <div className="list">
            {context.map((p) => (
              <div key={p.id} className="list-row">
                <span className="body">
                  <span className="title truncate">{p.name}</span>
                  <span className="sub">
                    {formatDay(p.startDate)}
                    {p.endDate ? ` → ${formatDay(p.endDate)}` : ' → ongoing'}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="card-title">Every reading</div>
        <div className="list">
          {[...readings].reverse().map((r) => {
            const status = rangeStatus(r.value, { low: r.low, high: r.high });
            return (
              <div key={r.id} className="list-row">
                <span className="body">
                  <span className="title">{formatDay(r.date)}</span>
                  <span className="sub">
                    {r.low != null || r.high != null
                      ? `range ${r.low != null ? num(r.low, decimals) : '—'} – ${r.high != null ? num(r.high, decimals) : '—'}`
                      : 'no range given'}
                  </span>
                </span>
                <span className="trail row tight">
                  <span className="mono">
                    {num(r.value, decimals)} <span className="dim tiny">{r.unit}</span>
                  </span>
                  {status !== 'unknown' && (
                    <span className={STATUS_BADGE[status]}>
                      {status === 'in' ? '✓' : status === 'high' ? 'H' : 'L'}
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </Sheet>
  );
}

function PanelList({ panels, results }: { panels: LabPanel[]; results: LabResult[] }) {
  const { confirm, dialog } = useConfirm();
  const toast = useToast();

  const countOf = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of results) counts.set(r.panelId, (counts.get(r.panelId) ?? 0) + 1);
    return counts;
  }, [results]);

  const remove = async (panel: LabPanel) => {
    const ok = await confirm(
      `Delete the draw from ${formatDay(panel.date)} and its ${countOf.get(panel.id) ?? 0} results?`,
      'Delete',
    );
    if (!ok) return;
    const ids = results.filter((r) => r.panelId === panel.id).map((r) => r.id);
    await removeRecords('labResults', ids);
    await removeRecord('labPanels', panel.id);
    toast.show('Draw deleted');
  };

  return (
    <Card title={`Draws · ${panels.length}`}>
      <div className="list">
        {[...panels].reverse().map((panel) => (
          <div key={panel.id} className="list-row">
            <span className="lead" aria-hidden="true">
              🩸
            </span>
            <span className="body">
              <span className="title">
                {formatDay(panel.date)}
                {panel.label ? ` · ${panel.label}` : ''}
              </span>
              <span className="sub truncate">
                {countOf.get(panel.id) ?? 0} results
                {panel.fileName ? ` · ${panel.fileName}` : panel.source === 'paste' ? ' · pasted' : ''}
              </span>
            </span>
            <button className="btn ghost sm trail" onClick={() => remove(panel)}>
              Delete
            </button>
          </div>
        ))}
      </div>
      {dialog}
    </Card>
  );
}
