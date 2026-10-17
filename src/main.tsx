import { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { fontMetricsOk, loadGameFont, measureChEm, type FontLoad } from './font';
import './styles.css';

// /2/feedback is the crafting-feedback dashboard, not the game. Loaded on
// demand, so it adds nothing to the game's own download.
const Dashboard = lazy(() => import('./feedback/Dashboard'));
const DASHBOARD = /^\/2\/feedback\/?$/.test(window.location.pathname);

const rootEl = document.getElementById('root')!;

function mount(font: FontLoad) {
  // the result, for tests and tools (scripts/bake-fence.mjs waits for it)
  document.documentElement.dataset.font = font;
  rootEl.replaceChildren();
  createRoot(rootEl).render(
    DASHBOARD ? (
      <Suspense fallback={null}>
        <Dashboard />
      </Suspense>
    ) : (
      <App />
    ),
  );
  // a fallback that doesn't come out 0.5em wide bends the grid: say so,
  // never silently
  if (font !== 'ok' && !fontMetricsOk()) {
    const note = document.createElement('div');
    note.className = 'font-note';
    note.textContent = `The game font didn't load and this browser's fallback is ${Math.round(measureChEm() * 100)}% wide instead of 50%: some art may look misaligned. Reload to try again.`;
    note.onclick = () => note.remove();
    document.body.append(note);
  }
}

// Mount only once the bundled font has loaded, so every measurement, canvas
// and glyph atlas uses it. If it fails: say so and offer a retry, or play
// with the emergency fallback (styles.css "Sarasa Fallback …").
async function start() {
  if (DASHBOARD) return mount(await loadGameFont());
  rootEl.innerHTML = '<div class="font-gate"><p>loading…</p></div>';
  const r = await loadGameFont();
  if (r === 'ok') return mount(r);
  const gate = document.createElement('div');
  gate.className = 'font-gate';
  const p = document.createElement('p');
  p.textContent = r === 'timeout' ? 'The game font is taking too long to load.' : "The game font couldn't load.";
  const retry = document.createElement('button');
  retry.textContent = 'Retry';
  retry.onclick = () => void start();
  const play = document.createElement('button');
  play.textContent = 'Play anyway';
  play.onclick = () => mount(r);
  const row = document.createElement('div');
  row.append(retry, play);
  gate.append(p, row);
  rootEl.replaceChildren(gate);
}
void start();
