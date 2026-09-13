import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/global.css';
import { seedIfEmpty } from './db/seed';
import { isSyncConfigured, sync } from './lib/sync';

/**
 * On a device that already syncs, pull first: the catalogues come down from the
 * server, so seeding is skipped and we avoid creating a second set of compounds
 * and exercises with different ids. Offline, seeding proceeds as normal.
 */
async function boot() {
  try {
    if (await isSyncConfigured()) await sync();
  } catch (err) {
    console.error('Initial sync failed', err);
  }
  await seedIfEmpty();
}

boot().catch((err) => console.error('Startup failed', err));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
