// ---------------------------------------------------------------------------
// The world editor's side panel (dev only). Presentational: every change goes
// through the hook in ./useWorldEditor.ts. See docs/Editor.md for the
// workflow and the keys.
// ---------------------------------------------------------------------------
import { useMemo, useState } from 'react';
import { ColoredSprite } from '../ColoredSprite';
import { MARKER_REGISTRY } from '../sceneMarkers';
import { DevImageTab } from '../DevImageTab';
import { DevIntroTab } from '../DevIntroTab';
import { ThemeTab } from './ThemeTab';
import { GroundTab } from './GroundTab';
import type { IntroNarrationTool } from '../devIntroNarration';
import type { Ent, EntityKind } from '../world';
import { FIXED_ASSETS, type AssetDef } from '../assets';
import { PLACEABLE_KINDS, locksOf, isEditable } from './useWorldEditor';
import type { WorldEditor, EditorTab } from './useWorldEditor';

const TABS: { id: EditorTab | 'image' | 'theme'; label: string }[] = [
  { id: 'objects', label: 'Objects' },
  { id: 'assets', label: 'Assets' },
  { id: 'markers', label: 'Markers' },
  { id: 'colliders', label: 'Colliders' },
  { id: 'intro', label: 'Intro' },
  { id: 'ground', label: 'Ground' },
  { id: 'theme', label: 'Theme' },
  { id: 'start', label: 'Start screen' },
];

// thumbnails: shrink a sprite to fit a 64x44 box (6.6 x 11 px per cell at
// the panel's 11px font)
function thumbScale(sprite: string[]): number {
  const cols = Math.max(1, ...sprite.map((l) => l.length));
  const rows = Math.max(1, sprite.length);
  return Math.min(0.5, 60 / (cols * 6.6), 40 / (rows * 11));
}

// Big sprites (the house, the shop) would shrink their glyphs below a pixel,
// which the browser doesn't draw at all: those get a coloured-cell preview.
function CellThumb({ a }: { a: AssetDef }) {
  const draw = (c: HTMLCanvasElement | null) => {
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const cols = Math.max(1, ...a.sprite.map((l) => l.length));
    const rows = a.sprite.length;
    // a character cell is 0.6 as wide as it is tall
    const cell = Math.min(64 / (cols * 0.6), 44 / rows);
    const cw = cell * 0.6;
    const ox = (64 - cols * cw) / 2;
    const oy = (44 - rows * cell) / 2;
    ctx.clearRect(0, 0, 64, 44);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < a.sprite[y].length; x++) {
        if (a.sprite[y][x] === ' ') continue;
        ctx.fillStyle = a.palette?.[a.colors?.[y]?.[x] ?? '.'] ?? '#c9c2b0';
        ctx.fillRect(ox + x * cw, oy + y * cell, Math.ceil(cw), Math.ceil(cell));
      }
    }
  };
  return (
    <div className="wed-thumb">
      <canvas ref={draw} width={64} height={44} />
    </div>
  );
}

function Thumb({ a }: { a: AssetDef }) {
  if (thumbScale(a.sprite) < 0.2) return <CellThumb a={a} />;
  return (
    <div className="wed-thumb">
      <ColoredSprite
        sprite={a.sprite}
        colors={a.colors}
        palette={a.palette}
        color={a.colors ? undefined : '#c9c2b0'}
        style={{ transform: `scale(${thumbScale(a.sprite)})` }}
      />
    </div>
  );
}

function Num({
  label,
  value,
  step,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  disabled?: boolean;
  onChange(v: number): void;
}) {
  return (
    <label className="wed-field">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        value={value}
        disabled={disabled}
        onChange={(ev) => {
          const v = parseFloat(ev.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
      />
    </label>
  );
}

function Inspector({ ed, e }: { ed: WorldEditor; e: Ent }) {
  const lock = locksOf(e.id);
  const added = ed.doc.added.find((a) => a.id === e.id);
  const asset = ed.assets.find((a) => a.slug === e.asset);
  const isNew = asset?.file !== undefined;
  const custom = added ? added.scale !== undefined || added.rotation : ed.doc.moved[e.id];
  return (
    <div className="wed-inspector">
      <div className="wed-insp-head">
        <b>{e.id}</b>
        <span className="wed-dim">
          {e.kind}
          {e.asset ? ` · ${e.asset}` : ''}
          {added ? ' · placed' : ' · built-in'}
        </span>
      </div>
      <div className="wed-row">
        <Num label="x" value={e.x} step={1} onChange={(x) => ed.setPose(e.id, { x })} />
        <Num label="y" value={e.y} step={1} onChange={(y) => ed.setPose(e.id, { y })} />
        <Num
          label="scale"
          value={e.scale ?? 1}
          step={0.05}
          disabled={lock.scale}
          onChange={(scale) => ed.setPose(e.id, { scale })}
        />
        <label className="wed-field">
          <span>rot</span>
          <select
            value={e.rotation ?? 0}
            disabled={lock.rotate}
            onChange={(ev) => ed.setPose(e.id, { rotation: Number(ev.target.value) as 0 | 1 | 2 | 3 })}
          >
            <option value={0}>0°</option>
            <option value={1}>90°</option>
            <option value={2}>180°</option>
            <option value={3}>270°</option>
          </select>
        </label>
      </div>
      {added && (
        <div className="wed-row">
          <label className="wed-field wed-grow">
            <span>kind</span>
            <select
              value={added.kind ?? ''}
              onChange={(ev) => ed.setAdded(e.id, { kind: (ev.target.value || undefined) as EntityKind | undefined })}
            >
              <option value="">asset default ({asset?.kind})</option>
              {PLACEABLE_KINDS.map((k) => (
                <option key={k.kind} value={k.kind}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {added && (
        <div className="wed-row">
          <label className="wed-check" title="drawn on the start screen only, never in the game">
            <input type="checkbox" checked={!!added.startOnly} onChange={(ev) => ed.setStartOnly(e.id, ev.target.checked)} />
            start screen only
          </label>
        </div>
      )}
      {added && /^pond/.test(added.asset) && (
        <div className="wed-group">
          <div className="wed-group-name">Pond design</div>
          <div className="wed-hint">Click a design to give this pond that look, in the same place.</div>
          <div className="wed-assets">
            {ed.assets
              .filter((a) => /^pond/.test(a.slug) && a.sprite.length > 0)
              .map((a) => (
                <button
                  key={a.slug}
                  className={'wed-asset' + (added.asset === a.slug ? ' on' : '')}
                  title={a.slug}
                  onClick={() => ed.setAdded(e.id, { asset: a.slug })}
                >
                  <Thumb a={a} />
                  <span>{a.label}</span>
                </button>
              ))}
          </div>
        </div>
      )}
      <div className="wed-row wed-btns">
        <button onClick={() => ed.duplicate(e.id)} disabled={lock.duplicate || !e.asset}>
          duplicate
        </button>
        <button onClick={() => ed.resetPose(e.id)} disabled={!custom}>
          {added ? 'reset scale/rot' : 'reset to code'}
        </button>
        <button className="wed-danger" onClick={() => ed.remove(e.id)} disabled={lock.remove}>
          delete
        </button>
      </div>
      {isNew && asset && (
        <div className="wed-asset-settings">
          <div className="wed-dim">asset settings — every copy of {asset.slug}</div>
          <div className="wed-row">
            <label className="wed-field wed-grow">
              <span>label</span>
              <input
                value={ed.meta[asset.slug]?.label ?? ''}
                placeholder={asset.slug}
                onChange={(ev) => ed.setMeta(asset.slug, { label: ev.target.value || undefined })}
              />
            </label>
            <Num
              label="default scale"
              value={asset.scale}
              step={0.05}
              onChange={(scale) => ed.setMeta(asset.slug, { scale })}
            />
          </div>
          <div className="wed-row">
            <label className="wed-field wed-grow">
              <span>default kind</span>
              <select
                value={asset.kind}
                onChange={(ev) => ed.setMeta(asset.slug, { kind: ev.target.value as EntityKind })}
              >
                {PLACEABLE_KINDS.map((k) => (
                  <option key={k.kind} value={k.kind}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

function ObjectsTab({ ed, onFocus }: { ed: WorldEditor; onFocus(id: string): void }) {
  const [q, setQ] = useState('');
  const list = useMemo(
    () =>
      ed.structEnts
        .filter(isEditable)
        .filter((e) => !q || e.id.includes(q.toLowerCase()) || e.kind.includes(q.toLowerCase())),
    [ed.structEnts, q],
  );
  const removed = ed.doc.removed.filter((id) => !id.startsWith('house-'));
  return (
    <div>
      <input className="wed-search" placeholder="filter objects…" value={q} onChange={(ev) => setQ(ev.target.value)} />
      <div className="wed-list">
        {list.map((e) => (
          <div
            key={e.id}
            className={'wed-list-row' + (ed.selected === e.id ? ' on' : '')}
            onClick={() => {
              ed.select(e.id);
              onFocus(e.id);
            }}
          >
            <span>{e.id}</span>
            <span className="wed-dim">
              {e.kind} ({Math.round(e.x * 100) / 100}, {Math.round(e.y * 100) / 100})
            </span>
          </div>
        ))}
      </div>
      {removed.length > 0 && (
        <div className="wed-removed">
          <div className="wed-dim">removed built-ins (click to restore)</div>
          {removed.map((id) => (
            <button key={id} onClick={() => ed.restore(id)}>
              ↺ {id}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AssetsTab({ ed, startScreen }: { ed: WorldEditor; startScreen?: boolean }) {
  const [q, setQ] = useState('');
  const [image, setImage] = useState(false);
  const groups = useMemo(() => {
    const m = new Map<string, AssetDef[]>();
    for (const a of ed.assets) {
      if (q && !a.slug.includes(q.toLowerCase()) && !a.label.toLowerCase().includes(q.toLowerCase())) continue;
      if (a.kind === 'cat') continue; // a look for Mitchy, listed apart below
      m.set(a.group, [...(m.get(a.group) ?? []), a]);
    }
    return [...m];
  }, [ed.assets, q]);
  const looks = useMemo(
    () => [FIXED_ASSETS.find((a) => a.slug === 'mitchy')!, ...ed.assets.filter((a) => a.kind === 'cat')],
    [ed.assets],
  );
  return (
    <div>
      <div className="wed-hint">
        {startScreen ? (
          <>Click an asset, then click inside the frame: it's placed on the start screen only (Shift+click keeps placing).</>
        ) : (
          <>
            Click an asset, then click the map to place it (Shift+click keeps placing). New asset files in{' '}
            <code>src/data/assets/</code> show up here under <b>New</b> after a reload.
          </>
        )}
      </div>
      <input className="wed-search" placeholder="filter assets…" value={q} onChange={(ev) => setQ(ev.target.value)} />
      {!startScreen && <div className="wed-group">
        <div className="wed-group-name">Mitchy's look</div>
        <div className="wed-hint">
          There is only one Mitchy: click a look to give it to him, in the world, his chat portrait, the map and the menus.
          Saved with the world. Files of kind <code>cat</code> in <code>src/data/assets/</code> show up here.
        </div>
        <div className="wed-assets">
          {looks.map((a) => (
            <button
              key={a.slug}
              className={'wed-asset' + (ed.mitchyLook === a.slug ? ' on' : '')}
              title={a.slug === 'mitchy' ? "Mitchy's original look" : `${a.slug} · Mitchy's look`}
              onClick={() => ed.setMitchyLook(a.slug)}
            >
              <Thumb a={a} />
              <span>{a.slug === 'mitchy' ? 'Original' : a.label.replace(/^Mitchy:\s*/, '')}</span>
            </button>
          ))}
        </div>
      </div>}
      {groups.map(([group, list]) => (
        <div key={group} className="wed-group">
          <div className="wed-group-name">{group}</div>
          <div className="wed-assets">
            {list.map((a) => (
              <button
                key={a.slug}
                className={'wed-asset' + (ed.armed?.type === 'asset' && ed.armed.id === a.slug ? ' on' : '')}
                title={`${a.slug} · ${a.kind} · scale ${a.scale}`}
                onClick={() => (ed.armed?.id === a.slug ? ed.disarm() : ed.arm('asset', a.slug))}
              >
                <Thumb a={a} />
                <span>{a.label}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      {!startScreen && (
        <button className="wed-link" onClick={() => setImage((v) => !v)}>
          {image ? '▾' : '▸'} make an asset from an image
        </button>
      )}
      {image && !startScreen && <DevImageTab />}
    </div>
  );
}

// The start screen's layout: the frame on the map (what it shows), the
// player, the title + buttons, and the objects only it has. Everything here
// is saved with the world (Save / Ctrl+S); reload the start screen to see it.
function StartTab({ ed, onFocus }: { ed: WorldEditor; onFocus(id: string): void }) {
  const ss = ed.startScreen;
  const [upload, setUpload] = useState<string | null>(null);
  // a new title picture: written to public/start-title.png at once (vite's
  // dev server); its shape and a new version go into the layout, saved with
  // the world
  async function uploadTitle(file: File) {
    if (file.type !== 'image/png') {
      setUpload('Pick a PNG file.');
      return;
    }
    setUpload('Uploading…');
    try {
      const bmp = await createImageBitmap(file);
      const aspect = Math.round((bmp.height / bmp.width) * 10000) / 10000;
      bmp.close();
      const res = await fetch('/__dev/save-title', { method: 'POST', body: file });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setUpload(res.status === 404 ? 'Uploading only works under `pnpm dev`.' : `Not uploaded: ${body.error ?? res.statusText}`);
        return;
      }
      ed.setStartScreen({ title: { ...ss.title, aspect, v: Date.now().toString(36) } });
      setUpload('New title saved to public/start-title.png. Save the world (Ctrl+S) to keep its size and place.');
    } catch (err) {
      setUpload(`Not uploaded: ${String(err)}`);
    }
  }
  const own = ed.structEnts.filter((e) => e.startOnly);
  const slider = (label: string, value: number, min: number, max: number, set: (v: number) => void) => (
    <label className="wed-theme-slider">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={0.01} value={value} onChange={(ev) => set(Number(ev.target.value))} />
      <span className="wed-dim">{value.toFixed(2)}</span>
    </label>
  );
  return (
    <div>
      <div className="wed-hint">
        The yellow frame is what the start screen shows. Drag its label to move it and its corner to zoom; drag the title, the
        buttons box and the player inside it. Objects placed here are on the start screen only.
      </div>
      <div className="wed-row wed-btns">
        <button onClick={() => onFocus('start')}>go to frame</button>
        <button onClick={() => window.open('/', '_blank')} title="save first: the start screen reads the saved world">
          open start screen
        </button>
      </div>
      <div className="wed-group">
        <div className="wed-group-name">View</div>
        {slider('zoom', ss.zoom, 0.4, 3, (zoom) => ed.setStartScreen({ zoom }))}
        <div className="wed-row">
          <Num label="centre x" value={ss.view.x} step={1} onChange={(x) => ed.setStartScreen({ view: { ...ss.view, x } })} />
          <Num label="centre y" value={ss.view.y} step={1} onChange={(y) => ed.setStartScreen({ view: { ...ss.view, y } })} />
        </div>
      </div>
      <div className="wed-group">
        <div className="wed-group-name">Player</div>
        <div className="wed-row">
          <Num label="x" value={ss.player.x} step={1} onChange={(x) => ed.setStartScreen({ player: { ...ss.player, x } })} />
          <Num label="y" value={ss.player.y} step={1} onChange={(y) => ed.setStartScreen({ player: { ...ss.player, y } })} />
        </div>
      </div>
      <div className="wed-group">
        <div className="wed-group-name">Title</div>
        <div className="wed-hint">Drag the title on the map to move it.</div>
        <label className="wed-btn-file">
          upload PNG…
          <input
            type="file"
            accept="image/png"
            onChange={(ev) => {
              const file = ev.target.files?.[0];
              ev.target.value = '';
              if (file) void uploadTitle(file);
            }}
          />
        </label>
        {upload && <div className="wed-hint">{upload}</div>}
        {slider('size', ss.title.width, 0.05, 0.9, (width) => ed.setStartScreen({ title: { ...ss.title, width } }))}
        <label className="wed-theme-slider">
          <span>rotate</span>
          <input
            type="range"
            min={-180}
            max={180}
            step={1}
            value={ss.title.rotation}
            onChange={(ev) => ed.setStartScreen({ title: { ...ss.title, rotation: Number(ev.target.value) } })}
          />
          <span className="wed-dim">{ss.title.rotation}°</span>
        </label>
        {slider('centre x', ss.title.x, 0, 1, (x) => ed.setStartScreen({ title: { ...ss.title, x } }))}
        {slider('centre y', ss.title.y, 0, 1, (y) => ed.setStartScreen({ title: { ...ss.title, y } }))}
      </div>
      <div className="wed-group">
        <div className="wed-group-name">Subtitle + buttons</div>
        {slider('size', ss.ui.scale, 0.5, 2, (scale) => ed.setStartScreen({ ui: { ...ss.ui, scale } }))}
        {slider('left', ss.ui.x, 0, 0.95, (x) => ed.setStartScreen({ ui: { ...ss.ui, x } }))}
        {slider('middle', ss.ui.y, 0.05, 0.95, (y) => ed.setStartScreen({ ui: { ...ss.ui, y } }))}
        <div className="wed-hint">Phones keep their own layout: the title on top, the player below the buttons.</div>
      </div>
      {own.length > 0 && (
        <div className="wed-group">
          <div className="wed-group-name">On the start screen only</div>
          <div className="wed-list">
            {own.map((e) => (
              <div
                key={e.id}
                className={'wed-list-row' + (ed.selected === e.id ? ' on' : '')}
                onClick={() => {
                  ed.select(e.id);
                  onFocus(e.id);
                }}
              >
                <span>{e.id}</span>
                <span className="wed-dim">scale {Math.round((e.scale ?? 1) * 100) / 100}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="wed-group">
        <div className="wed-group-name">Add</div>
        <AssetsTab ed={ed} startScreen />
      </div>
    </div>
  );
}

function MarkersTab({ ed, onFocus }: { ed: WorldEditor; onFocus(id: string): void }) {
  return (
    <div>
      <div className="wed-hint">Named positions cutscenes read by id. Place, then drag on the map.</div>
      {MARKER_REGISTRY.map((cat) => (
        <div key={cat.id} className="wed-group">
          <div className="wed-group-name">{cat.label}</div>
          {cat.groups.map((g) => (
            <div key={g.id} className="wed-marker-group">
              <div className="wed-dim">{g.label}</div>
              {g.markers.map((m) => {
                const p = ed.markers[m.id];
                const sel = ed.selected === `marker:${m.id}`;
                const armed = ed.armed?.type === 'marker' && ed.armed.id === m.id;
                return (
                  <div key={m.id} className={'wed-list-row' + (sel ? ' on' : '')}>
                    <span
                      onClick={() => {
                        if (!p) return;
                        ed.select(`marker:${m.id}`);
                        onFocus(`marker:${m.id}`);
                      }}
                    >
                      {m.label}
                    </span>
                    <span className="wed-dim">{p ? `(${p.x}, ${p.y})` : 'not placed'}</span>
                    <span className="wed-btns">
                      <button className={armed ? 'on' : ''} onClick={() => (armed ? ed.disarm() : ed.arm('marker', m.id))}>
                        {p ? 'move' : 'place'}
                      </button>
                      {p && <button onClick={() => ed.setMarker(m.id, null)}>×</button>}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function CollidersTab({ ed, sel }: { ed: WorldEditor; sel: Ent | null }) {
  const painted = sel?.asset ? ed.doc.colliders[sel.asset] : undefined;
  return (
    <div>
      <div className="wed-hint">
        Click a tile to flip it: a blocking tile (red) stops blocking, an empty one starts. Drag to flip many — a drag
        keeps doing what its first tile did. Blocking tiles stop the player's feet.
      </div>
      <div className="wed-hint">
        A new tile inside the <b>selected</b> object becomes part of that object's collider (it moves with it, and every
        copy of the asset gets it). Anywhere else it's a map tile of its own (orange). Clearing a tile on an object
        changes that asset's collider for every copy.
      </div>
      <div className="wed-row wed-btns">
        <span>
          {(ed.doc.blockedTiles ?? []).length} map tile{(ed.doc.blockedTiles ?? []).length === 1 ? '' : 's'}
        </span>
        <button onClick={ed.clearBlockedTiles} disabled={!(ed.doc.blockedTiles ?? []).length}>
          clear map tiles
        </button>
      </div>
      <label className="wed-check">
        <input type="checkbox" checked={ed.showColliders} onChange={(ev) => ed.setShowColliders(ev.target.checked)} />
        show colliders in the other tabs too
      </label>
      {sel ? (
        sel.asset ? (
          (sel.rotation ?? 0) !== 0 ? (
            <div className="wed-hint">Rotated objects block their whole box — set rotation to 0° to change it.</div>
          ) : (
            <div className="wed-row wed-btns">
              <span>
                <b>{sel.asset}</b> — {painted ? 'painted collider' : 'default collider'}
              </span>
              <button onClick={() => ed.resetCollider(sel.asset!)} disabled={!painted}>
                reset to default
              </button>
            </div>
          )
        ) : (
          <div className="wed-hint">{sel.id} has no asset, so its collider can't be painted.</div>
        )
      ) : (
        <div className="wed-hint">No object selected — new tiles become map tiles.</div>
      )}
      <div className="wed-hint">
        The house, shop and cliff only collide with the player's feet, so their tall art stays walk-behind.
      </div>
    </div>
  );
}

export function EditorPanel({
  ed,
  introTool,
  onFocus,
}: {
  ed: WorldEditor;
  introTool: IntroNarrationTool;
  onFocus(id: string): void;
}) {
  const [tab, setTab] = useState<EditorTab | 'image' | 'theme'>(ed.tab);
  const [collapsed, setCollapsed] = useState(false);
  if (!ed.open) return null;
  const selEnt = ed.selected && !ed.selected.startsWith('marker:') ? (ed.structEnts.find((e) => e.id === ed.selected) ?? null) : null;
  const pick = (t: EditorTab | 'image' | 'theme') => {
    setTab(t);
    if (t !== 'image' && t !== 'theme') ed.setTab(t);
  };
  return (
    <div className={'wed-panel' + (collapsed ? ' collapsed' : '')}>
      <div className="wed-head">
        <b>WORLD EDITOR</b>
        {ed.dirty && <span className="wed-dirty" title="unsaved changes" />}
        <span className="wed-grow" />
        <button onClick={ed.undo} disabled={!ed.canUndo} title="Ctrl+Z">
          undo
        </button>
        <button onClick={ed.redo} disabled={!ed.canRedo} title="Ctrl+Y">
          redo
        </button>
        <button className="wed-save" onClick={ed.save} disabled={ed.saving || !ed.dirty} title="Ctrl+S">
          {ed.saving ? 'saving…' : 'save'}
        </button>
        <button onClick={ed.discard} disabled={!ed.dirty} title="throw away unsaved changes">
          discard
        </button>
        <button onClick={() => setCollapsed((c) => !c)} title="collapse">
          {collapsed ? '▸' : '▾'}
        </button>
        <button onClick={() => ed.setOpen(false)} title="close (E)">
          ✕
        </button>
      </div>
      {ed.status && <div className={'wed-status ' + ed.status.kind}>{ed.status.text}</div>}
      {ed.recovered > 0 && (
        <div className="wed-status info">
          Brought in {ed.recovered} unsaved change{ed.recovered === 1 ? '' : 's'} from the old editor. Save to keep them, or
          discard.
        </div>
      )}
      {!collapsed && (
        <>
          <div className="wed-tabs">
            {TABS.map((t) => (
              <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => pick(t.id)}>
                {t.label}
              </button>
            ))}
            <label className="wed-check">
              <input type="checkbox" checked={ed.showIds} onChange={(ev) => ed.setShowIds(ev.target.checked)} />
              ids
            </label>
          </div>
          {(tab === 'objects' || tab === 'colliders' || tab === 'assets' || tab === 'start') && selEnt && <Inspector ed={ed} e={selEnt} />}
          <div className="wed-body">
            {tab === 'objects' && <ObjectsTab ed={ed} onFocus={onFocus} />}
            {tab === 'assets' && <AssetsTab ed={ed} />}
            {tab === 'markers' && <MarkersTab ed={ed} onFocus={onFocus} />}
            {tab === 'colliders' && <CollidersTab ed={ed} sel={selEnt} />}
            {tab === 'intro' && <DevIntroTab tool={introTool} />}
            {tab === 'ground' && <GroundTab />}
            {tab === 'theme' && <ThemeTab />}
            {tab === 'start' && <StartTab ed={ed} onFocus={onFocus} />}
          </div>
          <div className="wed-keys">
            click select · drag move (Shift: ¼ tile) · empty drag / WASD pan · arrows nudge · R rotate · +/− or Alt+wheel
            scale · Del delete · Ctrl+D duplicate · Ctrl+Z/Y undo/redo · Ctrl+S save · Esc deselect · E close
          </div>
        </>
      )}
    </div>
  );
}
