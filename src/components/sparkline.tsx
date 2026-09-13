import { num } from '@/lib/format';

/**
 * Chart pieces that are plain SVG/CSS. Kept apart from `charts.tsx` so screens
 * that only need a sparkline do not pull the charting library into their bundle.
 */

/** Compact trend line for stat tiles — no axes, no tooltip. */
export function Sparkline({
  data,
  color = 'var(--accent)',
  height = 34,
}: {
  data: Array<number | null>;
  color?: string;
  height?: number;
}) {
  const points = data.filter((v): v is number => v != null);
  if (points.length < 2) return null;

  const lo = Math.min(...points);
  const hi = Math.max(...points);
  const range = hi - lo || 1;
  const w = 100;
  const stepX = w / Math.max(1, data.length - 1);

  let d = '';
  let started = false;
  data.forEach((v, i) => {
    if (v == null) return;
    const x = i * stepX;
    const y = height - ((v - lo) / range) * (height - 4) - 2;
    d += `${started ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`;
    started = true;
  });

  return (
    <svg
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="none"
      height={height}
      width="100%"
      aria-hidden="true"
      style={{ display: 'block', overflow: 'visible' }}
    >
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Horizontal magnitude bars — used for per-muscle set counts and macro splits. */
export function HBars({
  items,
  max,
  unit,
}: {
  items: Array<{ label: string; value: number; color?: string }>;
  max?: number;
  unit?: string;
}) {
  const ceiling = max ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="col tight">
      {items.map((i) => (
        <div key={i.label}>
          <div className="row tiny" style={{ justifyContent: 'space-between', marginBottom: 3 }}>
            <span className="muted">{i.label}</span>
            <span className="mono">
              {num(i.value, 0)}
              {unit ? ` ${unit}` : ''}
            </span>
          </div>
          <div className="bar thin">
            <span
              style={{
                width: `${Math.min(100, (i.value / ceiling) * 100)}%`,
                background: i.color ?? 'var(--c-1)',
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
