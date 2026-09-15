import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

/* ------------------------------------------------------------------ Sheet */

interface SheetProps {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Rendered in the sticky footer, typically Cancel / Save. */
  footer?: ReactNode;
}

/**
 * Bottom sheet on phones, centred dialog on desktop. Locks background scroll
 * and closes on Escape or scrim tap.
 */
export function Sheet({ open, title, onClose, children, footer }: SheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <>
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <div className="sheet-grab" aria-hidden="true" />
        <div className="sheet-head">
          <h2 className="truncate">{title}</h2>
          <button className="btn ghost sm icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </>,
    document.body,
  );
}

/* --------------------------------------------------------------- Controls */

export interface Option<T extends string> {
  value: T;
  label: string;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  block,
  label,
}: {
  value: T;
  options: ReadonlyArray<Option<T>>;
  onChange: (value: T) => void;
  block?: boolean;
  label?: string;
}) {
  return (
    <div className={`seg${block ? ' block' : ''}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: ReactNode;
  /** Marks the field as needed before the form can be saved. */
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label>
        {label}
        {required && (
          <span className="req" aria-hidden="true">
            *
          </span>
        )}
        {required && <span className="sr-only"> (required)</span>}
      </label>
      {children}
      {hint && <span className="tiny dim">{hint}</span>}
    </div>
  );
}

/**
 * Explains why a form cannot be saved yet.
 *
 * A disabled Save button with no explanation is a dead end — the user can see
 * that something is wrong but not what, so name the fields that are missing.
 */
export function MissingFields({ missing }: { missing: string[] }) {
  if (missing.length === 0) return null;
  return (
    <p className="tiny missing-note" role="status">
      Still needed: {missing.join(', ')}
    </p>
  );
}

/**
 * Numeric input that keeps an empty string while the user is mid-edit rather
 * than snapping to 0 — typing "1.5" over "70" should not fight the cursor.
 */
export function NumberInput({
  value,
  onChange,
  step = 1,
  min,
  max,
  suffix,
  placeholder,
  big,
  autoFocus,
  inputMode = 'decimal',
  'aria-label': ariaLabel,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
  placeholder?: string;
  big?: boolean;
  autoFocus?: boolean;
  inputMode?: 'decimal' | 'numeric';
  'aria-label'?: string;
}) {
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  const lastEmitted = useRef(value);

  useEffect(() => {
    if (value !== lastEmitted.current) {
      setDraft(value == null ? '' : String(value));
      lastEmitted.current = value;
    }
  }, [value]);

  const commit = (raw: string) => {
    setDraft(raw);
    if (raw.trim() === '') {
      lastEmitted.current = null;
      onChange(null);
      return;
    }
    const parsed = Number(raw.replace(',', '.'));
    if (Number.isFinite(parsed)) {
      lastEmitted.current = parsed;
      onChange(parsed);
    }
  };

  const input = (
    <input
      className={`input numeric${big ? ' big' : ''}`}
      type="text"
      inputMode={inputMode}
      value={draft}
      step={step}
      min={min}
      max={max}
      placeholder={placeholder}
      autoFocus={autoFocus}
      aria-label={ariaLabel}
      onChange={(e) => commit(e.target.value)}
      onBlur={() => {
        if (draft.trim() === '') return;
        const parsed = Number(draft.replace(',', '.'));
        if (!Number.isFinite(parsed)) {
          setDraft(value == null ? '' : String(value));
          return;
        }
        let next = parsed;
        if (min != null) next = Math.max(min, next);
        if (max != null) next = Math.min(max, next);
        setDraft(String(next));
        lastEmitted.current = next;
        onChange(next);
      }}
    />
  );

  if (!suffix) return input;
  return (
    <div className="input-affix">
      {input}
      <span className="suffix">{suffix}</span>
    </div>
  );
}

/** Number entry flanked by −/+ so a value can be nudged without a keyboard. */
export function Stepper({
  value,
  onChange,
  step = 1,
  min = 0,
  max,
  suffix,
  'aria-label': ariaLabel,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
  'aria-label'?: string;
}) {
  const bump = (delta: number) => {
    const base = value ?? 0;
    // Re-round to the step's precision so 0.1 + 0.2 does not leak float noise.
    const decimals = (String(step).split('.')[1] ?? '').length;
    let next = Number((base + delta).toFixed(decimals));
    if (min != null) next = Math.max(min, next);
    if (max != null) next = Math.min(max, next);
    onChange(next);
  };

  return (
    <div className="stepper">
      <button type="button" onClick={() => bump(-step)} aria-label="Decrease">
        −
      </button>
      <NumberInput
        value={value}
        onChange={onChange}
        step={step}
        min={min}
        max={max}
        suffix={suffix}
        aria-label={ariaLabel}
      />
      <button type="button" onClick={() => bump(step)} aria-label="Increase">
        +
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ Cards */

export function Card({
  title,
  action,
  children,
  className = '',
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`.trim()}>
      {(title || action) && (
        <div className="card-head">
          {typeof title === 'string' ? <h2 className="card-title">{title}</h2> : title}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon" aria-hidden="true">{icon}</div>}
      <strong>{title}</strong>
      {children && <p className="small">{children}</p>}
      {action}
    </div>
  );
}

export function StatTile({
  label,
  value,
  unit,
  meta,
  delta,
  icon,
  onClick,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  meta?: ReactNode;
  delta?: { text: string; tone: 'up' | 'down' | 'flat' };
  icon?: string;
  onClick?: () => void;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag className="stat" onClick={onClick} type={onClick ? 'button' : undefined}>
      <span className="stat-label">
        {icon && <span aria-hidden="true">{icon}</span>}
        {label}
      </span>
      <span className="stat-value">
        {value}
        {unit && <span className="unit">{unit}</span>}
      </span>
      <span className="stat-meta">
        {delta && <span className={`delta ${delta.tone}`}>{delta.text}</span>}
        {delta && meta ? ' · ' : ''}
        {meta}
      </span>
    </Tag>
  );
}

export function ProgressBar({
  value,
  max,
  color,
  thin,
}: {
  value: number;
  max: number;
  color?: string;
  thin?: boolean;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className={`bar${thin ? ' thin' : ''}`}>
      <span style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

/* ------------------------------------------------------------------ Toast */

interface ToastContext {
  show: (message: string) => void;
}

const ToastCtx = createContext<ToastContext>({ show: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((next: string) => {
    setMessage(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), 2600);
  }, []);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const ctx = useMemo(() => ({ show }), [show]);

  return (
    <ToastCtx.Provider value={ctx}>
      {children}
      {message && (
        <div className="toast" role="status" aria-live="polite">
          {message}
        </div>
      )}
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

/* ----------------------------------------------------------- Confirmation */

/** Minimal confirm dialog; returns a promise so callers can `await` it. */
export function useConfirm() {
  const [state, setState] = useState<{
    message: string;
    confirmLabel: string;
    resolve: (ok: boolean) => void;
  } | null>(null);

  const confirm = useCallback(
    (message: string, confirmLabel = 'Delete') =>
      new Promise<boolean>((resolve) => setState({ message, confirmLabel, resolve })),
    [],
  );

  const settle = (ok: boolean) => {
    state?.resolve(ok);
    setState(null);
  };

  const dialog = (
    <Sheet
      open={state !== null}
      title="Are you sure?"
      onClose={() => settle(false)}
      footer={
        <>
          <button className="btn" onClick={() => settle(false)}>
            Cancel
          </button>
          <button className="btn danger" onClick={() => settle(true)}>
            {state?.confirmLabel ?? 'Delete'}
          </button>
        </>
      }
    >
      <p className="muted">{state?.message}</p>
    </Sheet>
  );

  return { confirm, dialog };
}
