import { lazy, Suspense } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ToastProvider } from './components/ui';
import Dashboard from './pages/Dashboard';
import Health from './pages/Health';

/**
 * Only the two screens the app opens on are in the entry bundle. Everything
 * else — in particular the charting library — is fetched on first visit and
 * then served from the service-worker cache, which keeps the initial load
 * small on a phone.
 */
const MetricDetail = lazy(() => import('./pages/MetricDetail'));
const Bloodwork = lazy(() => import('./pages/Bloodwork'));
const Calendar = lazy(() => import('./pages/Calendar'));
const DayDetail = lazy(() => import('./pages/DayDetail'));
const Cycles = lazy(() => import('./pages/Cycles'));
const Inventory = lazy(() => import('./pages/Inventory'));
const Nutrition = lazy(() => import('./pages/Nutrition'));
const Training = lazy(() => import('./pages/Training'));
const WorkoutSession = lazy(() => import('./pages/WorkoutSession'));
const ExerciseDetail = lazy(() => import('./pages/ExerciseDetail'));
const SettingsPage = lazy(() => import('./pages/Settings'));

function RouteFallback() {
  return (
    <main className="app-main">
      <p className="dim small center" style={{ paddingTop: 'var(--sp-6)' }}>
        Loading…
      </p>
    </main>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <HashRouter>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/health" element={<Health />} />
              <Route path="/bloodwork" element={<Bloodwork />} />
              <Route path="/health/:metric" element={<MetricDetail />} />
              <Route path="/calendar" element={<Calendar />} />
              <Route path="/day/:date" element={<DayDetail />} />
              <Route path="/cycles" element={<Cycles />} />
              <Route path="/inventory" element={<Inventory />} />
              <Route path="/nutrition" element={<Nutrition />} />
              <Route path="/training" element={<Training />} />
              <Route path="/training/exercise/:id" element={<ExerciseDetail />} />
              <Route path="/workout/:id" element={<WorkoutSession />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </Suspense>
      </HashRouter>
    </ToastProvider>
  );
}
