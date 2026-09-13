import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, uid } from '@/db/db';
import type { Compound, DoseUnit, Protocol } from '@/db/types';
import { Page } from '@/components/Layout';
import { Card, EmptyState, Field, NumberInput, ProgressBar, Segmented, Sheet, useToast } from '@/components/ui';
import { DoseChecklist } from '@/components/DoseChecklist';
import { CATEGORY_ICONS, CATEGORY_LABELS, CompoundSheet } from '@/components/CompoundSheet';
import { ProtocolSheet } from '@/components/ProtocolSheet';
import { useCompoundMap, useCompounds, useProtocols } from '@/hooks/useData';
import { combineDateTime, formatDay, lastNDays, nowTime, relativeDay, today } from '@/lib/date';
import { dose as formatDose, num, pluralize } from '@/lib/format';
import { protocolProgress, remainingLabel, scheduleLabel } from '@/lib/schedule';
import { adherence, consumeFromInventory } from '@/lib/doses';
import { DOSE_UNITS } from '@/lib/units';

type Tab = 'today' | 'protocols' | 'library';

const TABS = [
  { value: 'today', label: 'Today' },
  { value: 'protocols', label: 'Protocols' },
  { value: 'library', label: 'Library' },
] as const;

/** Peptides, PEDs and vitamins: what is due today, running cycles, and the library. */
export default function Cycles() {
  const [tab, setTab] = useState<Tab>('today');
  const [newProtocol, setNewProtocol] = useState(false);
  const [editProtocol, setEditProtocol] = useState<Protocol | null>(null);
  const [newCompound, setNewCompound] = useState(false);
  const [editCompound, setEditCompound] = useState<Compound | null>(null);
  const [quickLog, setQuickLog] = useState(false);

  const date = today();
  const protocols = useProtocols();
  const compounds = useCompounds();
  const compoundMap = useCompoundMap();

  const active = protocols.filter((p) => p.active);
  const finished = protocols.filter((p) => !p.active || (p.endDate && p.endDate < date));

  const recentLogs =
    useLiveQuery(() => db.doses.where('date').between(lastNDays(30)[0], date, true, true).toArray(), [date], []) ??
    [];

  const stats = useMemo(
    () => adherence(lastNDays(30, date), active, recentLogs),
    [active, recentLogs, date],
  );

  return (
    <Page
      title="Cycles"
      actions={
        <button className="btn primary sm" onClick={() => setNewProtocol(true)}>
          + Protocol
        </button>
      }
    >
      <Segmented value={tab} options={TABS} onChange={setTab} block label="Section" />

      {tab === 'today' && (
        <div style={{ marginTop: 'var(--sp-4)' }}>
          <Card
            title={relativeDay(date)}
            action={
              <button className="btn ghost sm" onClick={() => setQuickLog(true)}>
                One-off dose
              </button>
            }
          >
            <DoseChecklist date={date} />
          </Card>

          {active.length > 0 && (
            <Card title="Adherence · 30 days">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="stat-value">
                  {num(stats.percent, 0)}
                  <span className="unit">%</span>
                </span>
                <span className="small dim">
                  {stats.taken} of {stats.scheduled} scheduled doses
                </span>
              </div>
              <div style={{ marginTop: 'var(--sp-2)' }}>
                <ProgressBar value={stats.taken} max={Math.max(1, stats.scheduled)} />
              </div>
            </Card>
          )}
        </div>
      )}

      {tab === 'protocols' && (
        <div style={{ marginTop: 'var(--sp-4)' }}>
          {active.length === 0 ? (
            <Card>
              <EmptyState
                icon="💊"
                title="No active protocols"
                action={
                  <button className="btn primary" onClick={() => setNewProtocol(true)}>
                    Start a protocol
                  </button>
                }
              >
                A protocol is a compound plus a schedule — it drives your daily checklist, the
                calendar and your stock projections.
              </EmptyState>
            </Card>
          ) : (
            <div className="grid grid-wide">
              {active.map((p) => {
                const compound = compoundMap.get(p.compoundId);
                const progress = protocolProgress(p, date);
                return (
                  <button
                    key={p.id}
                    className="card"
                    style={{ textAlign: 'left' }}
                    onClick={() => setEditProtocol(p)}
                  >
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <span className="row tight">
                        <span className="dot" style={{ background: compound?.color }} aria-hidden="true" />
                        <strong>{compound?.name ?? 'Unknown'}</strong>
                      </span>
                      <span className="badge accent">{remainingLabel(p, date)}</span>
                    </div>
                    <div className="small muted" style={{ margin: '6px 0' }}>
                      {formatDose(p.dose, p.unit)} · {scheduleLabel(p.schedule)}
                    </div>
                    {progress.percent != null && (
                      <>
                        <ProgressBar value={progress.day} max={progress.total ?? 1} thin />
                        <div className="tiny dim" style={{ marginTop: 4 }}>
                          {progress.label} · started {formatDay(p.startDate)}
                        </div>
                      </>
                    )}
                    {progress.percent == null && (
                      <div className="tiny dim">Ongoing since {formatDay(p.startDate)}</div>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {finished.length > 0 && (
            <Card title={`Past protocols · ${finished.length}`}>
              <div className="list">
                {finished.map((p) => {
                  const compound = compoundMap.get(p.compoundId);
                  return (
                    <button key={p.id} className="list-row" onClick={() => setEditProtocol(p)}>
                      <span className="lead" aria-hidden="true">
                        {compound ? CATEGORY_ICONS[compound.category] : '💊'}
                      </span>
                      <span className="body">
                        <span className="title">{compound?.name ?? 'Unknown'}</span>
                        <span className="sub">
                          {formatDose(p.dose, p.unit)} · {formatDay(p.startDate)}
                          {p.endDate ? ` → ${formatDay(p.endDate)}` : ''}
                        </span>
                      </span>
                      <span className="trail">
                        <span className="badge">{p.active ? 'Ended' : 'Paused'}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </Card>
          )}
        </div>
      )}

      {tab === 'library' && (
        <div style={{ marginTop: 'var(--sp-4)' }}>
          <Card
            title={`Compounds · ${compounds.length}`}
            action={
              <button className="btn sm" onClick={() => setNewCompound(true)}>
                + Add
              </button>
            }
          >
            <div className="list">
              {compounds.map((c) => {
                const count = protocols.filter((p) => p.compoundId === c.id && p.active).length;
                return (
                  <button key={c.id} className="list-row" onClick={() => setEditCompound(c)}>
                    <span className="lead" aria-hidden="true">
                      {CATEGORY_ICONS[c.category]}
                    </span>
                    <span className="body">
                      <span className="title row tight">
                        <span className="dot" style={{ background: c.color }} aria-hidden="true" />
                        {c.name}
                      </span>
                      <span className="sub">
                        {CATEGORY_LABELS[c.category]}
                        {c.defaultDose ? ` · ${formatDose(c.defaultDose, c.defaultUnit)}` : ''}
                        {c.route ? ` · ${c.route}` : ''}
                      </span>
                    </span>
                    <span className="trail">
                      {count > 0 && <span className="badge accent">{pluralize(count, 'protocol')}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </Card>
        </div>
      )}

      <ProtocolSheet open={newProtocol} onClose={() => setNewProtocol(false)} />
      {editProtocol && (
        <ProtocolSheet protocol={editProtocol} open onClose={() => setEditProtocol(null)} />
      )}
      <CompoundSheet open={newCompound} onClose={() => setNewCompound(false)} />
      {editCompound && (
        <CompoundSheet compound={editCompound} open onClose={() => setEditCompound(null)} />
      )}
      <QuickDoseSheet open={quickLog} onClose={() => setQuickLog(false)} />
    </Page>
  );
}

/** Logs a dose that no protocol scheduled — a trial, a one-off, a catch-up. */
function QuickDoseSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const compounds = useCompounds();
  const toast = useToast();
  const [compoundId, setCompoundId] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [unit, setUnit] = useState<DoseUnit>('mg');
  const [note, setNote] = useState('');

  const selected = compounds.find((c) => c.id === compoundId) ?? compounds[0];

  const save = async () => {
    if (!selected || amount == null) return;
    await db.doses.add({
      id: uid(),
      compoundId: selected.id,
      date: today(),
      takenAt: combineDateTime(today(), nowTime()),
      dose: amount,
      unit,
      note: note.trim() || undefined,
    });
    await consumeFromInventory(selected.id, amount, unit);
    toast.show(`${selected.name} logged`);
    setAmount(null);
    setNote('');
    onClose();
  };

  return (
    <Sheet
      open={open}
      title="Log a one-off dose"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save} disabled={!selected || amount == null}>
            Log dose
          </button>
        </>
      }
    >
      <Field label="Compound">
        <select
          className="select"
          value={selected?.id ?? ''}
          onChange={(e) => {
            setCompoundId(e.target.value);
            const c = compounds.find((x) => x.id === e.target.value);
            if (c) {
              setUnit(c.defaultUnit);
              if (c.defaultDose != null) setAmount(c.defaultDose);
            }
          }}
        >
          {compounds.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>

      <div className="grid grid-2">
        <Field label="Dose">
          <NumberInput value={amount} onChange={setAmount} step={0.5} min={0} big />
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

      <Field label="Note">
        <input
          className="input"
          value={note}
          placeholder="Site, reason, how it felt…"
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
    </Sheet>
  );
}
