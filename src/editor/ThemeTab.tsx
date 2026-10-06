// ---------------------------------------------------------------------------
// The world editor's Theme tab: the environment's colours (src/theme.ts),
// edited live. A preset holds a colour grade (saturation, brightness,
// contrast, warmth, a tint) and every named swatch; the world repaints as you
// drag. "save theme" writes src/data/theme.json (dev server only), and the
// game uses the preset that was selected when it was saved.
// ---------------------------------------------------------------------------
import { useState, useSyncExternalStore } from 'react';
import {
  SWATCH_GROUPS,
  NEUTRAL_GRADE,
  activePresetName,
  addPreset,
  currentPreset,
  deletePreset,
  markThemeSaved,
  onThemeEdit,
  revertTheme,
  selectPreset,
  setGrade,
  setSwatch,
  themeColor,
  themeDirty,
  themeDoc,
  themeForSave,
  themeRevision,
  type Grade,
} from '../theme';

const SLIDERS: { key: keyof Grade; label: string; min: number; max: number; step: number }[] = [
  { key: 'saturation', label: 'saturation', min: 0, max: 2, step: 0.01 },
  { key: 'brightness', label: 'brightness', min: 0.5, max: 1.5, step: 0.01 },
  { key: 'contrast', label: 'contrast', min: 0.5, max: 1.5, step: 0.01 },
  { key: 'warmth', label: 'warmth', min: -1, max: 1, step: 0.01 },
  { key: 'tintAmount', label: 'tint amount', min: 0, max: 1, step: 0.01 },
];

export function ThemeTab() {
  useSyncExternalStore(onThemeEdit, themeRevision);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const preset = currentPreset();
  const g = preset.grade;
  const names = Object.keys(themeDoc().presets);
  const dirty = themeDirty();

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch('/__dev/save-theme', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(themeForSave()),
      });
      if (!res.ok) throw new Error(await res.text());
      markThemeSaved();
      setStatus({ kind: 'ok', text: `Saved src/data/theme.json (the game uses "${activePresetName()}").` });
    } catch (err) {
      setStatus({ kind: 'error', text: `Not saved: ${String(err)}` });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="wed-theme">
      <div className="wed-hint">
        The world's nature colours, live. The grade applies to every swatch below; the house, shop, Mitchy, the pond and the
        player keep their own colours.
      </div>

      <div className="wed-row">
        <label className="wed-field wed-grow">
          <span>preset</span>
          <select value={activePresetName()} onChange={(ev) => selectPreset(ev.target.value)}>
            {names.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <span className="wed-btns">
          <button
            title="a new preset, starting from this one"
            onClick={() => {
              const n = window.prompt('Name of the new preset', `${activePresetName()} copy`)?.trim();
              if (n && !themeDoc().presets[n]) addPreset(n);
            }}
          >
            + new
          </button>
          <button
            className="wed-danger"
            disabled={names.length <= 1}
            title="delete this preset"
            onClick={() => window.confirm(`Delete the preset "${activePresetName()}"?`) && deletePreset(activePresetName())}
          >
            delete
          </button>
        </span>
      </div>

      <div className="wed-group">
        <div className="wed-group-name">
          Grade
          <button className="wed-theme-reset" onClick={() => setGrade({ ...NEUTRAL_GRADE, tint: g.tint })}>
            reset
          </button>
        </div>
        {SLIDERS.map((sl) => (
          <label key={sl.key} className="wed-theme-slider">
            <span>{sl.label}</span>
            <input
              type="range"
              min={sl.min}
              max={sl.max}
              step={sl.step}
              value={g[sl.key] as number}
              onChange={(ev) => setGrade({ [sl.key]: Number(ev.target.value) })}
            />
            <span className="wed-dim">{(g[sl.key] as number).toFixed(2)}</span>
          </label>
        ))}
        <label className="wed-theme-slider">
          <span>tint colour</span>
          <input type="color" value={g.tint} onChange={(ev) => setGrade({ tint: ev.target.value })} />
          <span className="wed-dim">{g.tint}</span>
        </label>
      </div>

      {SWATCH_GROUPS.map((grp) => (
        <details key={grp.title} className="wed-group" open={grp.title === 'Grass' || grp.title === 'Water'}>
          <summary className="wed-group-name">{grp.title}</summary>
          {grp.swatches.map(([name, label]) => (
            <label key={name} className="wed-theme-swatch" title={name}>
              <input type="color" value={preset.swatches[name] ?? '#000000'} onChange={(ev) => setSwatch(name, ev.target.value)} />
              <span>{label}</span>
              {/* what the game draws: the swatch through the grade */}
              <span className="wed-theme-chip" style={{ background: themeColor(name) }} title={`graded: ${themeColor(name)}`} />
              {/* typed hex: applied once it is a full #rrggbb (re-keyed so a
                  picker change shows here too) */}
              <input
                key={preset.swatches[name]}
                className="wed-theme-hex"
                defaultValue={preset.swatches[name] ?? ''}
                spellCheck={false}
                onChange={(ev) => /^#[0-9a-fA-F]{6}$/.test(ev.target.value) && setSwatch(name, ev.target.value.toLowerCase())}
              />
            </label>
          ))}
        </details>
      ))}

      <div className="wed-row wed-theme-foot">
        <button className="wed-save" onClick={save} disabled={saving || !dirty}>
          {saving ? 'saving…' : 'save theme'}
        </button>
        <button onClick={revertTheme} disabled={!dirty} title="back to the saved theme">
          revert
        </button>
        {dirty && <span className="wed-dim">unsaved changes</span>}
      </div>
      {status && <div className={'wed-status ' + status.kind}>{status.text}</div>}
    </div>
  );
}
