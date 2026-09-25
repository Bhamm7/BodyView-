import { useEffect, useMemo, useState } from 'react';
import { db, removeRecord, uid } from '@/db/db';
import type { DoseUnit, Protocol, Schedule, ScheduleKind } from '@/db/types';
import { DOSE_UNITS } from '@/lib/units';
import { shiftDate, today } from '@/lib/date';
import {
  type DoseBasis,
  doseRate,
  dosesPerWeek,
  perDoseFromBasis,
  scheduleLabel,
  WEEKDAY_LABELS,
} from '@/lib/schedule';
import { num } from '@/lib/format';
import { useCompounds } from '@/hooks/useData';
import { Field, NumberInput, Segmented, Sheet, Stepper, useToast } from './ui';

const KINDS = [
  { value: 'everyNDays', label: 'Interval' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'cycling', label: 'On / off' },
] as const;

const LENGTH_PRESETS = [4, 6, 8, 10, 12, 16];

/** The stored per-administration dose, expressed on the basis it was typed on. */
function amountOnBasis(protocol: Protocol, basis: DoseBasis): number {
  if (basis === 'dose') return protocol.dose;
  const rate = doseRate(protocol);
  return Number((basis === 'week' ? rate.perWeek : rate.perDay).toPrecision(6));
}

/**
 * What the amount in the dose field means. Injectables are usually prescribed
 * and discussed as a weekly total, orals and supplements per dose or per day,
 * so the entry has to support all three rather than assuming one.
 */
const BASES = [
  { value: 'dose', label: 'Per dose' },
  { value: 'day', label: 'Per day' },
  { value: 'week', label: 'Per week' },
] as const;

const BASIS_LABEL: Record<DoseBasis, string> = {
  dose: 'Amount per dose',
  day: 'Amount per day',
  week: 'Amount per week',
};

/** Creates or edits a dosing protocol — the schedule that drives a cycle. */
export function ProtocolSheet({
  protocol,
  presetCompoundId,
  open,
  onClose,
}: {
  protocol?: Protocol;
  presetCompoundId?: string;
  open: boolean;
  onClose: () => void;
}) {
  const compounds = useCompounds();
  const toast = useToast();

  const [compoundId, setCompoundId] = useState('');
  const [dose, setDose] = useState<number | null>(null);
  const [unit, setUnit] = useState<DoseUnit>('mg');
  const [basis, setBasis] = useState<DoseBasis>('dose');
  const [scheduleTouched, setScheduleTouched] = useState(false);
  const [kind, setKind] = useState<ScheduleKind>('everyNDays');
  const [intervalDays, setIntervalDays] = useState(1);
  const [days, setDays] = useState<number[]>([1, 4]);
  const [daysOn, setDaysOn] = useState(5);
  const [daysOff, setDaysOff] = useState(2);
  const [timesPerDay, setTimesPerDay] = useState(1);
  const [startDate, setStartDate] = useState(today());
  const [endDate, setEndDate] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!open) return;
    const seedId = protocol?.compoundId ?? presetCompoundId ?? compounds[0]?.id ?? '';
    setCompoundId(seedId);
    const seedCompound = compounds.find((c) => c.id === seedId);
    setDose(
      protocol
        ? amountOnBasis(protocol, protocol.doseBasis ?? 'dose')
        : (seedCompound?.defaultDose ?? null),
    );
    setUnit(protocol?.unit ?? seedCompound?.defaultUnit ?? 'mg');
    setBasis(protocol?.doseBasis ?? 'dose');
    setScheduleTouched(false);
    setKind(protocol?.schedule.kind ?? 'everyNDays');
    setIntervalDays(protocol?.schedule.intervalDays ?? 1);
    setDays(protocol?.schedule.days ?? [1, 4]);
    setDaysOn(protocol?.schedule.daysOn ?? 5);
    setDaysOff(protocol?.schedule.daysOff ?? 2);
    setTimesPerDay(protocol?.schedule.timesPerDay ?? 1);
    setStartDate(protocol?.startDate ?? today());
    setEndDate(protocol?.endDate ?? '');
    setNotes(protocol?.notes ?? '');
  }, [open, protocol, presetCompoundId, compounds]);

  /**
   * Picking "per week" on an untouched form also assumes a weekly injection,
   * which is what a weekly total normally implies; "per dose" and "per day"
   * assume a daily pattern. Once the schedule has been set by hand it is left
   * alone — an inference that overwrites a deliberate choice is a bug.
   */
  const chooseBasis = (next: DoseBasis) => {
    setBasis(next);
    if (scheduleTouched || protocol) return;
    setKind('everyNDays');
    setIntervalDays(next === 'week' ? 7 : 1);
  };

  const editSchedule = <T,>(apply: (value: T) => void) => (value: T) => {
    setScheduleTouched(true);
    apply(value);
  };

  // Adopt the compound's own defaults when the user switches compound.
  const pickCompound = (id: string) => {
    setCompoundId(id);
    const c = compounds.find((x) => x.id === id);
    if (!c) return;
    setUnit(c.defaultUnit);
    if (c.defaultDose != null) setDose(c.defaultDose);
  };

  const schedule = useMemo<Schedule>(
    () => ({
      kind,
      intervalDays,
      days,
      daysOn,
      daysOff,
      timesPerDay: Math.max(1, timesPerDay),
    }),
    [kind, intervalDays, days, daysOn, daysOff, timesPerDay],
  );

  /** The amount as typed, converted to the per-administration dose we store. */
  const perDose = dose != null ? perDoseFromBasis(dose, basis, schedule) : null;
  const rate = perDose != null ? doseRate({ dose: perDose, unit, schedule } as Protocol) : null;
  const perWeek = dosesPerWeek(schedule);
  const valid =
    !!compoundId &&
    perDose != null &&
    perDose > 0 &&
    Number.isFinite(perDose) &&
    (kind !== 'weekdays' || days.length > 0);

  const save = async () => {
    if (!valid) return;
    const record: Protocol = {
      id: protocol?.id ?? uid(),
      compoundId,
      dose: perDose!,
      unit,
      doseBasis: basis,
      schedule,
      startDate,
      endDate: endDate || undefined,
      notes: notes.trim() || undefined,
      cycleId: protocol?.cycleId,
      active: protocol?.active ?? true,
    };
    await db.protocols.put(record);
    toast.show(protocol ? 'Protocol updated' : 'Protocol started');
    onClose();
  };

  const remove = async () => {
    if (!protocol) return;
    await removeRecord('protocols', protocol.id);
    toast.show('Protocol deleted');
    onClose();
  };

  const toggleDay = (d: number) => {
    setScheduleTouched(true);
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
  };

  return (
    <Sheet
      open={open}
      title={protocol ? 'Edit protocol' : 'New protocol'}
      onClose={onClose}
      footer={
        <>
          {protocol ? (
            <button className="btn danger" onClick={remove}>
              Delete
            </button>
          ) : (
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
          )}
          <button className="btn primary" onClick={save} disabled={!valid}>
            Save
          </button>
        </>
      }
    >
      <Field label="Compound">
        <select className="select" value={compoundId} onChange={(e) => pickCompound(e.target.value)}>
          {compounds.length === 0 && <option value="">Add a compound first</option>}
          {compounds.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Dose is entered" hint="Pick how you think about this compound's dose">
        <Segmented value={basis} options={BASES} onChange={chooseBasis} block label="Dose basis" />
      </Field>

      <div className="grid grid-2">
        <Field label={BASIS_LABEL[basis]}>
          <NumberInput value={dose} onChange={setDose} step={0.5} min={0} big />
        </Field>
        <Field label="Unit">
          <select className="select" value={unit} onChange={(e) => setUnit(e.target.value as DoseUnit)}>
            {DOSE_UNITS.map((u) => (
              <option key={u} value={u}>
                {u === 'iu' ? 'IU' : u}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Schedule">
        <Segmented
          value={kind}
          options={KINDS}
          onChange={editSchedule(setKind)}
          block
          label="Schedule type"
        />
      </Field>

      {kind === 'everyNDays' && (
        <Field label="Every" hint="1 = daily, 2 = every other day">
          <Stepper
            value={intervalDays}
            onChange={editSchedule((v: number | null) => setIntervalDays(Math.max(1, v ?? 1)))}
            min={1}
            max={30}
            suffix="days"
            aria-label="Interval in days"
          />
        </Field>
      )}

      {kind === 'weekdays' && (
        <Field label="Days of the week">
          <div className="row tight wrap">
            {WEEKDAY_LABELS.map((label, i) => (
              <button
                key={label}
                type="button"
                className="chip"
                aria-pressed={days.includes(i)}
                onClick={() => toggleDay(i)}
              >
                {label}
              </button>
            ))}
          </div>
        </Field>
      )}

      {kind === 'cycling' && (
        <div className="grid grid-2">
          <Field label="Days on">
            <Stepper
              value={daysOn}
              onChange={editSchedule((v: number | null) => setDaysOn(Math.max(1, v ?? 1)))}
              min={1}
              max={90}
            />
          </Field>
          <Field label="Days off">
            <Stepper
              value={daysOff}
              onChange={editSchedule((v: number | null) => setDaysOff(Math.max(0, v ?? 0)))}
              min={0}
              max={90}
            />
          </Field>
        </div>
      )}

      <Field label="Doses per dosing day">
        <Stepper
          value={timesPerDay}
          onChange={editSchedule((v: number | null) => setTimesPerDay(Math.max(1, v ?? 1)))}
          min={1}
          max={6}
          aria-label="Doses per day"
        />
      </Field>

      <div className="grid grid-2">
        <Field label="Start">
          <input
            className="input"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </Field>
        <Field label="End" hint="Leave empty for ongoing">
          <input
            className="input"
            type="date"
            value={endDate}
            min={startDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </Field>
      </div>

      <Field label="Cycle length">
        <div className="chip-row">
          <button type="button" className="chip" onClick={() => setEndDate('')}>
            Ongoing
          </button>
          {LENGTH_PRESETS.map((weeks) => {
            const end = shiftDate(startDate, weeks * 7 - 1);
            return (
              <button
                key={weeks}
                type="button"
                className="chip"
                aria-pressed={endDate === end}
                onClick={() => setEndDate(end)}
              >
                {weeks} wk
              </button>
            );
          })}
        </div>
      </Field>

      <div className="card" style={{ background: 'var(--surface-2)' }}>
        <div className="card-title">Summary</div>
        <div className="small">
          {scheduleLabel(schedule)} ·{' '}
          <strong className="mono">{rate ? rate.label : '—'}</strong>
        </div>
        {rate && perDose != null && (
          <div className="small" style={{ marginTop: 4 }}>
            <strong className="mono">
              {num(perDose, 2)} {unit === 'iu' ? 'IU' : unit}
            </strong>{' '}
            per dose, {num(perWeek, 2)}× a week
          </div>
        )}
        <div className="tiny dim" style={{ marginTop: 4 }}>
          {rate
            ? `${num(rate.perWeek, 2)} ${unit === 'iu' ? 'IU' : unit} a week · ${num(rate.perDay, 2)} ${unit === 'iu' ? 'IU' : unit} a day — also used to project when your stock runs out.`
            : 'Enter a dose to see the weekly and daily rate.'}
        </div>
      </div>

      <Field label="Notes">
        <textarea
          className="textarea"
          value={notes}
          placeholder="Injection sites, titration plan, bloodwork reminders…"
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>
    </Sheet>
  );
}
