import { useEffect, useState } from 'react';
import { Card, Field, useConfirm, useToast } from './ui';
import { useSyncState } from '@/hooks/useSync';
import {
  normalizeServerUrl,
  replaceLocalWithServer,
  setSyncState,
  sync,
  testConnection,
} from '@/lib/sync';
import { agoLabel } from '@/lib/date';

/** Connects this device to the BodyView server that holds the shared database. */
export function SyncSettings() {
  const state = useSyncState();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();

  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!state) return;
    // The server that holds the database is nearly always the one that served
    // this page, so offer that rather than making the user type an address.
    setUrl(state.serverUrl || window.location.origin);
    setToken(state.token ?? '');
  }, [state?.serverUrl, state?.token]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!state) return null;

  const connect = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const base = normalizeServerUrl(url);
      const result = await testConnection(base, token || undefined);
      if (!result.ok) {
        setProblem(result.error ?? 'Could not connect.');
        return;
      }
      await setSyncState({
        serverUrl: base,
        token: token.trim() || undefined,
        enabled: true,
      });
      const outcome = await sync();
      if (outcome.ok) {
        toast.show(`Synced — sent ${outcome.pushed}, received ${outcome.pulled}`);
      } else {
        setProblem(outcome.error ?? 'Sync failed.');
      }
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    const ok = await confirm(
      'Stop syncing this device? Its data stays here, and the server keeps its copy. Nothing is deleted.',
      'Disconnect',
    );
    if (!ok) return;
    await setSyncState({ enabled: false });
    toast.show('Sync turned off');
  };

  const pullFresh = async () => {
    const ok = await confirm(
      'Replace everything on this device with the server’s copy? Anything here that has never been synced will be lost. Use this when a device has built up its own duplicate catalogues.',
      'Replace local data',
    );
    if (!ok) return;
    setBusy(true);
    try {
      const outcome = await replaceLocalWithServer();
      toast.show(outcome.ok ? `Restored ${outcome.pulled} records` : (outcome.error ?? 'Failed'));
    } finally {
      setBusy(false);
    }
  };

  const connected = state.enabled && !!state.serverUrl;

  return (
    <>
      <Card title="Sync">
        {connected ? (
          <>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="grow truncate">
                <strong className="small">{state.serverUrl}</strong>
                <div className="tiny dim">
                  {state.lastError
                    ? `Last attempt failed: ${state.lastError}`
                    : state.lastSuccessAt
                      ? `Last synced ${agoLabel(new Date(state.lastSuccessAt).toISOString().slice(0, 10))}`
                      : 'Not synced yet'}
                </div>
              </span>
              <span className={`badge ${state.lastError ? 'warning' : 'good'}`}>
                {state.lastError ? 'Needs attention' : 'Connected'}
              </span>
            </div>

            <div className="col tight" style={{ marginTop: 'var(--sp-3)' }}>
              <button
                className="btn block"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const outcome = await sync();
                  setBusy(false);
                  toast.show(
                    outcome.ok
                      ? `Synced — sent ${outcome.pushed}, received ${outcome.pulled}`
                      : (outcome.error ?? 'Sync failed'),
                  );
                }}
              >
                {busy ? 'Syncing…' : 'Sync now'}
              </button>
              <button className="btn subtle block" disabled={busy} onClick={pullFresh}>
                Replace this device with the server’s copy
              </button>
              <button className="btn ghost block" onClick={disconnect}>
                Disconnect
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="small muted">
              Point this device at your BodyView server and every device shares one database. Log a
              weigh-in on your phone and it is on your desktop. The app keeps working offline and
              catches up when it can reach the server again.
            </p>

            <Field label="Server address" hint="e.g. mini.your-tailnet.ts.net">
              <input
                className="input"
                value={url}
                placeholder="https://…"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                onChange={(e) => setUrl(e.target.value)}
              />
            </Field>

            <Field label="Access token" hint="Only if your server sets BODYVIEW_TOKEN">
              <input
                className="input"
                type="password"
                value={token}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                onChange={(e) => setToken(e.target.value)}
              />
            </Field>

            {problem && (
              <p className="tiny" style={{ color: 'var(--critical)' }}>
                {problem}
              </p>
            )}

            <button className="btn primary block" disabled={busy || !url.trim()} onClick={connect}>
              {busy ? 'Connecting…' : 'Connect'}
            </button>

            <p className="tiny dim">
              Connecting merges what is on this device into the server. If this device has been used
              on its own, expect duplicate library entries — use “Replace this device with the
              server’s copy” afterwards to clear them.
            </p>
          </>
        )}
      </Card>
      {dialog}
    </>
  );
}
