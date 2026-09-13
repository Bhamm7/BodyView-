import { useMemo, type ReactNode } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ISODate } from '@/db/types';
import { formatShort, formatDay } from '@/lib/date';
import { niceDomain, tickDecimals } from '@/lib/stats';
import { num } from '@/lib/format';

/**
 * Chart conventions used across the app:
 *  - one y-axis per chart, never a second scale;
 *  - recessive grid and axis ink, 2px data lines, >=8px active dots;
 *  - a legend whenever two or more series share a chart;
 *  - a crosshair tooltip on every time series.
 */

const AXIS = {
  stroke: 'var(--axis)',
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const;

const GRID_STROKE = 'var(--grid)';

export interface Point {
  x: ISODate;
  y: number | null;
}

export interface Series {
  key: string;
  label: string;
  color: string;
  data: Point[];
  /** Rendered dashed, and excluded from the legend's identity count. */
  dashed?: boolean;
  unit?: string;
  precision?: number;
}

/**
 * Recharts types its `content` render props very loosely (dataKey may even be
 * an accessor function), so the tooltip takes a narrow shape of its own and
 * the render props are cast into it at the call site.
 */
interface TooltipRenderProps {
  active?: boolean;
  label?: unknown;
  payload?: ReadonlyArray<{
    dataKey?: unknown;
    value?: unknown;
    color?: string;
    name?: unknown;
  }>;
}

function ChartTooltip({
  active,
  label,
  payload,
  series,
  formatLabel,
}: TooltipRenderProps & {
  series: Series[];
  formatLabel?: (label: string) => string;
}) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => p.value != null);
  if (rows.length === 0) return null;

  return (
    <div
      style={{
        background: 'var(--surface-3)',
        border: '1px solid var(--border-strong)',
        borderRadius: 10,
        padding: '8px 10px',
        boxShadow: 'var(--shadow-2)',
        fontSize: 12,
        minWidth: 120,
      }}
    >
      <div style={{ color: 'var(--text-3)', fontWeight: 700, marginBottom: 4 }}>
        {formatLabel ? formatLabel(String(label)) : formatDay(String(label))}
      </div>
      {rows.map((row) => {
        const key = String(row.dataKey ?? '');
        const s = series.find((x) => x.key === key);
        return (
          <div
            key={key}
            style={{ display: 'flex', alignItems: 'center', gap: 6, lineHeight: 1.6 }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: row.color ?? s?.color,
                flex: '0 0 auto',
              }}
            />
            <span style={{ color: 'var(--text-2)', flex: 1 }}>{s?.label ?? String(row.name ?? '')}</span>
            <span style={{ color: 'var(--text)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
              {num(Number(row.value), s?.precision ?? 1)}
              {s?.unit ? ` ${s.unit}` : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Identity is never carried by colour alone — the swatch always has a label. */
export function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <div className="row wrap tight tiny" style={{ marginTop: 'var(--sp-2)' }}>
      {series.map((s) => (
        <span key={s.key} className="row tight" style={{ gap: 5 }}>
          <span
            aria-hidden="true"
            className="dot"
            style={{
              background: s.dashed ? 'transparent' : s.color,
              border: s.dashed ? `2px dashed ${s.color}` : undefined,
              width: 9,
              height: 9,
            }}
          />
          <span className="dim">{s.label}</span>
        </span>
      ))}
    </div>
  );
}

/** Merges several series into the row-per-date shape Recharts expects. */
function toRows(series: Series[]): Array<Record<string, number | string | null>> {
  const byDate = new Map<string, Record<string, number | string | null>>();
  for (const s of series) {
    for (const p of s.data) {
      const row = byDate.get(p.x) ?? { x: p.x };
      row[s.key] = p.y;
      byDate.set(p.x, row);
    }
  }
  return [...byDate.values()].sort((a, b) => String(a.x).localeCompare(String(b.x)));
}

export function TrendChart({
  series,
  height = 200,
  band,
  yDomain,
  connectNulls = true,
  showDots,
}: {
  series: Series[];
  height?: number;
  /** Healthy reference range, drawn behind the data. */
  band?: { from: number; to: number; label?: string };
  yDomain?: [number, number];
  connectNulls?: boolean;
  showDots?: boolean;
}) {
  const rows = useMemo(() => toRows(series), [series]);
  const domain = useMemo(() => {
    if (yDomain) return yDomain;
    const values = series.flatMap((s) => s.data.map((p) => p.y).filter((v): v is number => v != null));
    if (band) values.push(band.from, band.to);
    return niceDomain(values);
  }, [series, yDomain, band]);

  if (rows.length === 0) return <NoData height={height} />;

  return (
    <>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid stroke={GRID_STROKE} strokeDasharray="2 4" vertical={false} />
          {band && (
            <ReferenceArea
              y1={band.from}
              y2={band.to}
              fill="var(--good)"
              fillOpacity={0.07}
              stroke="none"
              ifOverflow="hidden"
            />
          )}
          <XAxis
            dataKey="x"
            {...AXIS}
            tickFormatter={(v: string) => formatShort(v)}
            minTickGap={28}
          />
          <YAxis
            {...AXIS}
            domain={domain}
            width={46}
            tickFormatter={(v: number) => num(v, tickDecimals(domain))}
          />
          <Tooltip
            cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1 }}
            content={(props) => <ChartTooltip {...(props as TooltipRenderProps)} series={series} />}
          />
          {series.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              strokeDasharray={s.dashed ? '4 4' : undefined}
              dot={showDots ? { r: 2.5, strokeWidth: 0, fill: s.color } : false}
              activeDot={{ r: 4.5, strokeWidth: 2, stroke: 'var(--surface)' }}
              connectNulls={connectNulls}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <Legend series={series} />
    </>
  );
}

export function AreaTrend({
  series,
  height = 180,
  target,
}: {
  series: Series;
  height?: number;
  /** Horizontal goal line, e.g. a calorie target. */
  target?: { value: number; label: string };
}) {
  const rows = useMemo(() => toRows([series]), [series]);
  if (rows.length === 0) return <NoData height={height} />;

  const gradientId = `grad-${series.key}`;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: -12 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={series.color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={series.color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID_STROKE} strokeDasharray="2 4" vertical={false} />
        <XAxis dataKey="x" {...AXIS} tickFormatter={(v: string) => formatShort(v)} minTickGap={28} />
        <YAxis {...AXIS} width={44} tickFormatter={(v: number) => num(v, 0)} />
        <Tooltip
          cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1 }}
          content={(props) => <ChartTooltip {...(props as TooltipRenderProps)} series={[series]} />}
        />
        {target && (
          <ReferenceLine
            y={target.value}
            stroke="var(--text-3)"
            strokeDasharray="4 4"
            label={{ value: target.label, position: 'insideTopRight', fill: 'var(--text-3)', fontSize: 10 }}
          />
        )}
        <Area
          type="monotone"
          dataKey={series.key}
          stroke={series.color}
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          connectNulls
          isAnimationActive={false}
          activeDot={{ r: 4.5, strokeWidth: 2, stroke: 'var(--surface)' }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function BarSeries({
  data,
  color = 'var(--c-1)',
  height = 180,
  unit,
  precision = 0,
  target,
  label = 'Value',
  colorFor,
  labelFormatter,
}: {
  data: Point[];
  color?: string;
  height?: number;
  unit?: string;
  precision?: number;
  target?: { value: number; label: string };
  label?: string;
  /** Per-bar colour, e.g. to mark days over target. */
  colorFor?: (point: Point) => string;
  labelFormatter?: (label: string) => string;
}) {
  const series: Series = { key: 'y', label, color, data, unit, precision };
  const rows = useMemo(() => toRows([series]), [data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (rows.length === 0) return <NoData height={height} />;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: -12 }}>
        <CartesianGrid stroke={GRID_STROKE} strokeDasharray="2 4" vertical={false} />
        <XAxis
          dataKey="x"
          {...AXIS}
          tickFormatter={(v: string) => (labelFormatter ? labelFormatter(v) : formatShort(v))}
          minTickGap={18}
        />
        <YAxis {...AXIS} width={44} tickFormatter={(v: number) => num(v, 0)} />
        <Tooltip
          cursor={{ fill: 'var(--surface-2)' }}
          content={(props) => (
            <ChartTooltip
              {...(props as TooltipRenderProps)}
              series={[series]}
              formatLabel={labelFormatter}
            />
          )}
        />
        {target && (
          <ReferenceLine
            y={target.value}
            stroke="var(--text-3)"
            strokeDasharray="4 4"
            label={{ value: target.label, position: 'insideTopRight', fill: 'var(--text-3)', fontSize: 10 }}
          />
        )}
        {/* 4px rounded data-end, anchored to the baseline. */}
        <Bar dataKey="y" radius={[4, 4, 0, 0]} isAnimationActive={false} maxBarSize={42}>
          {rows.map((row, i) => (
            <Cell
              key={i}
              fill={colorFor ? colorFor({ x: String(row.x), y: row.y as number | null }) : color}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function NoData({ height }: { height: number }): ReactNode {
  return (
    <div
      className="dim tiny"
      style={{ height, display: 'grid', placeItems: 'center' }}
    >
      Not enough data yet
    </div>
  );
}
