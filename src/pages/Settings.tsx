import { useEffect, useRef, useState } from 'react';
import { eraseAll } from '@/db/db';
import { METRICS } from '@/db/metrics';
import type { MetricKey, ThemePref } from '@/db/types';
import { Page } from '@/components/Layout';
import { Card, Field, NumberInput, Segmented, useConfirm, useToast } from '@/components/ui';
import { useSettings } from '@/hooks/useData';
import {
  downloadBackup,
  importBackup,
  requestPersistence,
  storageEstimate,
} from '@/lib/backup';
import { num } from '@/lib/format';

/** Units, theme, dashboard layout, backup and data management. */
export default function SettingsPage() {
  const [settings, update] = useSettings();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const fileInput = useRef<HTMLInputElement>(null);
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);

  useEffect(() => {
    storageEstimate().then(setStorage);
    navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
  }, []);

  const togglePinned = (key: MetricKey) => {
    const current = settings.dashboardMetrics;
    const next = current.includes(key)
      ? current.filter((k) => k !== key)
      : [...current, key].slice(0, 6);
    update({ dashboardMetrics: next });
  };

  const onImport = async (file: File) => {
    try {
      const raw = JSON.parse(await file.text());
      const mode = (await confirm(
        'Replace everything currently in BodyView with this backup? Choose Cancel to merge instead, keeping existing records.',
        'Replace all',
      ))
        ? 'replace'
        : 'merge';
      const result = await importBackup(raw, mode);
      const count = Object.values(result.imported).reduce((a, b) => a + b, 0);
      toast.show(`Imported ${count} records`);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Import failed');
    }
  };

  return (
    <Page title="Settings">
      <Card title="Units">
        <div className="col">
          <Field label="Body weight">
            <Segmented
              value={settings.weightUnit}
              options={[
                { value: 'kg', label: 'Kilograms' },
                { value: 'lb', label: 'Pounds' },
              ]}
              onChange={(v) => update({ weightUnit: v })}
              block
              label="Weight unit"
            />
          </Field>
          <Field label="Measurements">
            <Segmented
              value={settings.lengthUnit}
              options={[
                { value: 'cm', label: 'Centimetres' },
                { value: 'in', label: 'Inches' },
              ]}
              onChange={(v) => update({ lengthUnit: v })}
              block
              label="Length unit"
            />
          </Field>
          <p className="tiny dim">
            Readings are stored in metric and converted for display, so switching units never
            changes your history.
          </p>
        </div>
      </Card>

      <Card title="Appearance">
        <Field label="Theme">
          <Segmented
            value={settings.theme}
            options={[
              { value: 'auto', label: 'Auto' },
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' },
            ]}
            onChange={(v) => update({ theme: v as ThemePref })}
            block
            label="Theme"
          />
        </Field>
        <Field label="Week starts on">
          <Segmented
            value={String(settings.weekStartsOn)}
            options={[
              { value: '1', label: 'Monday' },
              { value: '0', label: 'Sunday' },
            ]}
            onChange={(v) => update({ weekStartsOn: v === '1' ? 1 : 0 })}
            block
            label="Week start"
          />
        </Field>
      </Card>

      <Card title="Dashboard metrics">
        <p className="tiny dim">Pick up to six to pin to the Today screen.</p>
        <div className="chip-row" style={{ flexWrap: 'wrap' }}>
          {METRICS.map((def) => (
            <button
              key={def.key}
              className="chip"
              aria-pressed={settings.dashboardMetrics.includes(def.key)}
              onClick={() => togglePinned(def.key)}
            >
              <span aria-hidden="true">{def.icon}</span> {def.label}
            </button>
          ))}
        </div>
      </Card>

      <Card title="About you">
        <div className="grid grid-2">
          <Field label="Height" hint="Used for BMI-style context">
            <NumberInput
              value={settings.heightCm ?? null}
              onChange={(v) => update({ heightCm: v ?? undefined })}
              min={100}
              max={250}
              suffix="cm"
            />
          </Field>
          <Field label="Birth year">
            <NumberInput
              value={settings.birthYear ?? null}
              onChange={(v) => update({ birthYear: v ?? undefined })}
              min={1900}
              max={new Date().getFullYear()}
              step={1}
              inputMode="numeric"
            />
          </Field>
        </div>
      </Card>

      <Card title="Your data">
        <p className="small muted">
          BodyView stores everything in this browser on this device. Nothing is uploaded, and there
          is no account. That also means a cleared browser takes your history with it — export a
          backup regularly, and use it to move between your phone and desktop.
        </p>

        <div className="col tight" style={{ marginTop: 'var(--sp-3)' }}>
          <button className="btn block" onClick={() => downloadBackup().then(() => toast.show('Backup downloaded'))}>
            ⬇ Export backup (JSON)
          </button>
          <button className="btn block" onClick={() => fileInput.current?.click()}>
            ⬆ Import backup
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onImport(file);
              e.target.value = '';
            }}
          />
        </div>

        {storage && (
          <p className="tiny dim" style={{ marginTop: 'var(--sp-3)' }}>
            Using {num(storage.usage / 1024 / 1024, 1)} MB
            {storage.quota > 0 ? ` of about ${num(storage.quota / 1024 / 1024, 0)} MB available` : ''}.
          </p>
        )}

        {persisted === false && (
          <button
            className="btn sm block"
            style={{ marginTop: 'var(--sp-2)' }}
            onClick={async () => {
              const ok = await requestPersistence();
              setPersisted(ok);
              toast.show(ok ? 'Storage will persist' : 'The browser declined');
            }}
          >
            Ask the browser to keep this data
          </button>
        )}
        {persisted === true && (
          <p className="tiny" style={{ color: 'var(--good)', marginTop: 'var(--sp-2)' }}>
            ✓ Storage is marked persistent — the browser will not evict it automatically.
          </p>
        )}
      </Card>

      <Card title="Danger zone">
        <button
          className="btn danger block"
          onClick={async () => {
            const ok = await confirm(
              'This permanently deletes every metric, dose, meal, workout and stock item on this device. Export a backup first if you want to keep it.',
              'Erase everything',
            );
            if (!ok) return;
            await eraseAll();
            toast.show('All data erased');
          }}
        >
          Erase all data
        </button>
      </Card>

      <Card title="About">
        <p className="small muted">
          BodyView is a personal tracker. It records what you enter and does the arithmetic — it
          does not give medical or dosing advice. Talk to a clinician about anything that matters.
        </p>
        <p className="tiny dim">
          Apple Health import is not available yet: iOS does not expose HealthKit to web apps. The
          JSON import above is the way in for now.
        </p>
      </Card>

      {dialog}
    </Page>
  );
}
