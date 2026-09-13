import { useEffect, useMemo, useState } from 'react';
import { db, removeRecord, uid } from '@/db/db';
import type { DoseUnit, Protocol, Schedule, ScheduleKind } from '@/db/types';
import { DOSE_UNITS } from '@/lib/units';
import { shiftDate, today } from '@/lib/date';
import { dailyAverageDose, scheduleLabel, WEEKDAY_LABELS } from '@/lib/schedule';
import { num } from '@/lib/format';
import { useCompounds } from '@/hooks/useData';
import { Field, NumberInput, Segmented, Sheet, Stepper, useToast } from './ui';

const KINDS = [
  { value: 'everyNDays', label: 'Interval' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'cycling', label: 'On / off' },
] as const;

const LENGTH_PRESETS = [4, 6, 8, 10, 12, 16];

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
    setDose(protocol?.dose ?? seedCompound?.defaultDose ?? null);
    setUnit(protocol?.unit ?? seedCompound?.defaultUnit ?? 'mg');
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

  const perDay = dose != null ? dailyAverageDose({ dose, schedule } as Protocol) : 0;
  const valid = !!compoundId && dose != null && dose > 0 && (kind !== 'weekdays' || days.length > 0);

  const save = async () => {
    if (!valid) return;
    const record: Protocol = {
      id: protocol?.id ?? uid(),
      compoundId,
      dose: dose!,
      unit,
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

  const toggleDay = (d: number) =>
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));

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

      <div className="grid grid-2">
        <Field label="Dose">
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
        <Segmented value={kind} options={KINDS} onChange={setKind} block label="Schedule type" />
      </Field>

      {kind === 'everyNDays' && (
        <Field label="Every" hint="1 = daily, 2 = every other day">
          <Stepper
            value={intervalDays}
            onChange={(v) => setIntervalDays(Math.max(1, v ?? 1))}
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
            <Stepper value={daysOn} onChange={(v) => setDaysOn(Math.max(1, v ?? 1))} min={1} max={90} />
          </Field>
          <Field label="Days off">
            <Stepper value={daysOff} onChange={(v) => setDaysOff(Math.max(0, v ?? 0))} min={0} max={90} />
          </Field>
        </div>
      )}

      <Field label="Doses per dosing day">
        <Stepper
          value={timesPerDay}
          onChange={(v) => setTimesPerDay(Math.max(1, v ?? 1))}
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
          {scheduleLabel(schedule)} · averages{' '}
          <strong className="mono">
            {num(perDay, 2)} {unit === 'iu' ? 'IU' : unit}
          </strong>{' '}
          per day
        </div>
        <div className="tiny dim" style={{ marginTop: 4 }}>
          Used to project when your stock runs out.
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
