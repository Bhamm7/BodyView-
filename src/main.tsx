import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/global.css';
import { seedIfEmpty } from './db/seed';

// Reference catalogues are populated before first paint so the library screens
// are never briefly empty on a fresh install.
seedIfEmpty().catch((err) => console.error('Seeding failed', err));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
