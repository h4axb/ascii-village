// ---------------------------------------------------------------------------
// The world editor's Ground tab: paint dirt, meadow and stone ground onto the
// island, or stamp a path of stepping stones (src/ground.ts). Drag on the map
// with the brush; each stroke repaints only the cells under it. "save ground"
// writes src/data/ground.json (dev server only). The colours are the Theme
// tab's "Ground paint" swatches.
// ---------------------------------------------------------------------------
import { useState, useSyncExternalStore } from 'react';
import {
  MAT_DIRT,
  MAT_MEADOW,
  MAT_STONE,
  brush,
  canRedoGround,
  canUndoGround,
  groundDirty,
  groundDoc,
  markGroundSaved,
  onGroundEdit,
  redoGround,
  revertGround,
  undoGround,
  type BrushTool,
} from '../ground';

const TOOLS: { tool: BrushTool; label: string; hint: string }[] = [
  { tool: MAT_DIRT, label: 'Dirt', hint: 'bare earth with pebbles' },
  { tool: MAT_MEADOW, label: 'Meadow', hint: 'lighter grass with tiny flowers' },
  { tool: MAT_STONE, label: 'Stone', hint: 'stony ground' },
  { tool: 'path', label: 'Stepping stones', hint: 'drag to lay flat stones along a path' },
  { tool: 'erase', label: 'Erase', hint: 'back to grass (also lifts stepping stones)' },
];

let rev = 0;
onGroundEdit(() => {
  rev += 1;
});
const subscribe = (fn: () => void) => onGroundEdit(fn);

export function GroundTab() {
  useSyncExternalStore(subscribe, () => rev);
  const [, bump] = useState(0);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<typeof brush>) => {
    Object.assign(brush, patch);
    bump((n) => n + 1);
  };
  const dirty = groundDirty();

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch('/__dev/save-ground', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(groundDoc()),
      });
      if (!res.ok) throw new Error(await res.text());
      markGroundSaved();
      setStatus({ kind: 'ok', text: 'Saved src/data/ground.json.' });
    } catch (err) {
      setStatus({ kind: 'error', text: `Not saved: ${String(err)}` });
    } finally {
      setSaving(false);
    }
  }

  const sliders: { key: 'size' | 'softness' | 'strength'; label: string; min: number; max: number; step: number }[] = [
    { key: 'size', label: brush.tool === 'path' ? 'stone size' : 'brush size', min: 0.5, max: 12, step: 0.1 },
    ...(brush.tool === 'path'
      ? []
      : ([
          { key: 'softness', label: 'softness', min: 0, max: 1, step: 0.01 },
          { key: 'strength', label: 'strength', min: 0.05, max: 1, step: 0.01 },
        ] as const)),
  ];

  return (
    <div className="wed-theme wed-ground">
      <div className="wed-hint">
        Drag on the map to paint. Soft edges fray into the grass; a low strength gives patchy, worn ground. Colours: Theme
        tab → Ground paint.
      </div>
      <div className="wed-ground-tools">
        {TOOLS.map((t) => (
          <button key={String(t.tool)} className={brush.tool === t.tool ? 'on' : ''} title={t.hint} onClick={() => set({ tool: t.tool })}>
            {t.label}
          </button>
        ))}
      </div>
      {sliders.map((sl) => (
        <label key={sl.key} className="wed-theme-slider">
          <span>{sl.label}</span>
          <input
            type="range"
            min={sl.min}
            max={sl.max}
            step={sl.step}
            value={brush[sl.key]}
            onChange={(ev) => set({ [sl.key]: Number(ev.target.value) })}
          />
          <span className="wed-dim">{brush[sl.key].toFixed(sl.key === 'size' ? 1 : 2)}</span>
        </label>
      ))}
      <div className="wed-row wed-theme-foot">
        <button onClick={undoGround} disabled={!canUndoGround()} title="undo the last stroke">
          undo
        </button>
        <button onClick={redoGround} disabled={!canRedoGround()}>
          redo
        </button>
        <button className="wed-save" onClick={save} disabled={saving || !dirty}>
          {saving ? 'saving…' : 'save ground'}
        </button>
        <button onClick={revertGround} disabled={!dirty} title="back to the saved ground">
          revert
        </button>
        {dirty && <span className="wed-dim">unsaved changes</span>}
      </div>
      {status && <div className={'wed-status ' + status.kind}>{status.text}</div>}
    </div>
  );
}
