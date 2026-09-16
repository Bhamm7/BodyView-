import { useEffect, useMemo, useRef, useState } from 'react';
import { CATEGORY_LABELS, markerDef, type MarkerCategory } from '@/db/bloodMarkers';
import { pluralize } from '@/lib/format';

export interface PickerOption {
  key: string;
  label: string;
  unit: string;
  category: MarkerCategory | 'recorded';
  /** Number of readings on record, so the picker can lead with what exists. */
  count: number;
}

/**
 * Multi-select marker picker.
 *
 * Grouped by panel section, searchable, and showing each marker's unit —
 * because the unit is what decides which markers can share a chart, so it is
 * worth seeing while choosing.
 */
export function MarkerPicker({
  options,
  selected,
  onChange,
}: {
  options: PickerOption[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matching = q
      ? options.filter((o) => `${o.label} ${o.unit}`.toLowerCase().includes(q))
      : options;

    const recorded = matching.filter((o) => o.count > 0);
    const rest = matching.filter((o) => o.count === 0);

    const byCategory = new Map<string, PickerOption[]>();
    for (const option of rest) {
      const list = byCategory.get(option.category) ?? [];
      list.push(option);
      byCategory.set(option.category, list);
    }

    const out: Array<[string, PickerOption[]]> = [];
    if (recorded.length > 0) out.push(['On record', recorded]);
    for (const [category, list] of byCategory) {
      out.push([CATEGORY_LABELS[category as MarkerCategory] ?? category, list]);
    }
    return out;
  }, [options, query]);

  const toggle = (key: string) =>
    onChange(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]);

  const summary =
    selected.length === 0
      ? 'Choose markers…'
      : selected.length <= 2
        ? selected.map((k) => markerDef(k)?.label ?? k).join(', ')
        : `${pluralize(selected.length, 'marker')} selected`;

  return (
    <div className="picker" ref={root}>
      <button
        className="select"
        style={{ textAlign: 'left', minHeight: 46 }}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="truncate">{summary}</span>
      </button>

      {open && (
        <div className="picker-panel" role="listbox" aria-multiselectable="true">
          <input
            className="input"
            placeholder="Search markers…"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            style={{ marginBottom: 'var(--sp-2)' }}
          />

          {selected.length > 0 && (
            <button className="btn ghost sm block" onClick={() => onChange([])}>
              Clear selection
            </button>
          )}

          {groups.length === 0 && (
            <p className="dim small center" style={{ padding: 'var(--sp-4)' }}>
              No marker matches “{query}”.
            </p>
          )}

          {groups.map(([group, list]) => (
            <div key={group}>
              <div className="picker-group">{group}</div>
              {list.map((option) => (
                <button
                  key={option.key}
                  className="picker-option"
                  role="option"
                  aria-pressed={selected.includes(option.key)}
                  aria-selected={selected.includes(option.key)}
                  onClick={() => toggle(option.key)}
                >
                  <span className="box" aria-hidden="true">
                    {selected.includes(option.key) ? '✓' : ''}
                  </span>
                  <span className="truncate">{option.label}</span>
                  <span className="opt-unit">{option.unit}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
