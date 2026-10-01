import { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// /2/feedback is the crafting-feedback dashboard, not the game. Loaded on
// demand, so it adds nothing to the game's own download.
const Dashboard = lazy(() => import('./feedback/Dashboard'));
const DASHBOARD = /^\/2\/feedback\/?$/.test(window.location.pathname);

createRoot(document.getElementById('root')!).render(
  DASHBOARD ? (
    <Suspense fallback={null}>
      <Dashboard />
    </Suspense>
  ) : (
    <App />
  ),
);
