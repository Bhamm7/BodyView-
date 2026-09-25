import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSyncState } from '@/hooks/useSync';
import { normalizeServerUrl, setSyncState, sync, testConnection } from '@/lib/sync';
import { Card, useToast } from './ui';

/**
 * Says, where it will actually be seen, when this device is keeping its data
 * to itself.
 *
 * Serving the app and syncing its data are separate things, and nothing about
 * opening the page from the Mac implies the two are connected — so a device
 * can be used for weeks before anyone discovers its records never left the
 * browser. Sync settings live on the Settings screen, which is exactly where
 * nobody looks when everything appears to be working.
 *
 * Connecting is one tap here, because the server that holds the database is
 * nearly always the one that served this page.
 */
export function SyncBanner() {
  const state = useSyncState();
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  if (!state) return null;

  const connected = state.enabled && !!state.serverUrl;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const servedOverHttp = origin.startsWith('http');

  if (connected) {
    if (!state.lastError) return null;
    return (
      <Card className="section">
        <div className="row" style={{ justifyContent: 'space-between', gap: 'var(--sp-3)' }}>
          <span className="grow" style={{ minWidth: 0 }}>
            <strong className="small">Sync needs attention</strong>
            <div className="tiny dim truncate">{state.lastError}</div>
          </span>
          <button className="btn sm" onClick={() => navigate('/settings')}>
            Open
          </button>
        </div>
      </Card>
    );
  }

  const connectHere = async () => {
    setBusy(true);
    try {
      const base = normalizeServerUrl(origin);
      const result = await testConnection(base);
      if (!result.ok) {
        toast.show(result.error ?? 'Could not reach the server.');
        navigate('/settings');
        return;
      }
      await setSyncState({ serverUrl: base, enabled: true });
      const outcome = await sync();
      toast.show(
        outcome.ok
          ? `Syncing — sent ${outcome.pushed}, received ${outcome.pulled}`
          : (outcome.error ?? 'Sync failed'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="section">
      <div className="row" style={{ justifyContent: 'space-between', gap: 'var(--sp-3)' }}>
        <span className="grow" style={{ minWidth: 0 }}>
          <strong className="small">This device isn’t syncing</strong>
          <div className="tiny dim">
            Everything logged here stays in this browser. Connect it and every device shares one
            database on your server.
          </div>
        </span>
        <span className="badge warning">Local only</span>
      </div>
      <div className="row tight" style={{ marginTop: 'var(--sp-3)' }}>
        {servedOverHttp && (
          <button className="btn primary sm grow" disabled={busy} onClick={connectHere}>
            {busy ? 'Connecting…' : 'Connect to this server'}
          </button>
        )}
        <button className="btn sm" onClick={() => navigate('/settings')}>
          Sync settings
        </button>
      </div>
    </Card>
  );
}
