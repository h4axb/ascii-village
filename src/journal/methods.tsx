// Methods & Methodology: the methods catalogue and the methodical process
// model. A task names the methods it used (Task.methods); the page shows them
// as a table (type W / D / H / A, phase = macro, area = meso) and as the
// process model, where every method row tells how often it was used.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { JournalStore, Put } from './store';
import { ALONGSIDE, METHOD_TYPES, PHASE_TONES, fmtDate, fmtMinutes, isInstrument, newId, taskMinutes, type Entry, type Method, type MethodPhase, type MethodType, type PhaseTone, type Task } from './types';
import { Icon, IconBtn, Modal } from './ui';
import { citeShort, ZoteroPicker, ZoteroSource } from './zotero';

// a method's source as one short line: the Zotero item's cite (it follows
// changes made in Zotero), else the typed text
const sourceText = (m: Pick<Method, 'source' | 'zotero'>, store: JournalStore) => {
  const it = m.zotero ? store.docs.zotero?.[m.zotero] : undefined;
  return it ? citeShort(it) || it.title : (m.source ?? '');
};

export type MethodTab = 'entries' | 'methods' | 'model';
const typeOf = (t: MethodType) => METHOD_TYPES.find((x) => x.id === t) ?? METHOD_TYPES[0];
export const sortedPhases = (store: JournalStore) => Object.values(store.docs.phases ?? {}).sort((a, b) => a.order - b.order);
const byOrder = (a: Method, b: Method) => a.order - b.order || a.name.localeCompare(b.name);
const phaseLabel = (p?: MethodPhase) => (!p ? '–' : p.id === ALONGSIDE ? 'Projektbegleitend' : `${p.code} ${p.name}`);

// W01, D01 …: numbered per type in the order of the model (phase, area, row)
export function methodCodes(store: JournalStore): Map<string, string> {
  const phases = sortedPhases(store);
  const pi = (m: Method) => {
    const i = phases.findIndex((p) => p.id === m.phase);
    return i < 0 ? 999 : i;
  };
  const ai = (m: Method) => store.docs.phases?.[m.phase]?.areas.indexOf(m.area) ?? 0;
  const all = Object.values(store.docs.methods ?? {}).sort((a, b) => pi(a) - pi(b) || ai(a) - ai(b) || byOrder(a, b));
  const n: Record<string, number> = {};
  return new Map(all.map((m) => [m.id, `${m.type}${String((n[m.type] = (n[m.type] ?? 0) + 1)).padStart(2, '0')}`]));
}

// ---- usage: which tasks name a method ----
export interface Use {
  e: Entry;
  t: Task;
}
export interface Usage {
  uses: Use[];
  last: string;
  minutes: number;
}
export function methodUsage(entries: Record<string, Entry>): Map<string, Usage> {
  const out = new Map<string, Usage>();
  for (const e of Object.values(entries))
    for (const t of e.tasks ?? [])
      for (const id of new Set(t.methods ?? [])) {
        const u = out.get(id) ?? { uses: [], last: '', minutes: 0 };
        u.uses.push({ e, t });
        if ((e.date || '') > u.last) u.last = e.date || '';
        u.minutes += taskMinutes(t) ?? 0;
        out.set(id, u);
      }
  for (const u of out.values()) u.uses.sort((a, b) => (b.e.date || '').localeCompare(a.e.date || '') || (b.t.start || '').localeCompare(a.t.start || ''));
  return out;
}
// the methods most often named in the same task as these
function together(entries: Record<string, Entry>, ids: string[], n = 3): string[] {
  if (!ids.length) return [];
  const c = new Map<string, number>();
  for (const e of Object.values(entries))
    for (const t of e.tasks ?? []) {
      const ms = t.methods ?? [];
      if (!ms.some((m) => ids.includes(m))) continue;
      for (const m of ms) if (!ids.includes(m)) c.set(m, (c.get(m) ?? 0) + 1);
    }
  return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([id]) => id);
}

// a method's coloured dot (its type)
export function TypeDot({ t }: { t: MethodType }) {
  return <span className="jr-mdot" style={{ '--c': typeOf(t).color } as React.CSSProperties} aria-hidden="true" />;
}

// ---- the tabs of Methods & Methodology ----
export function MethodTabs({ tab, onTab, counts }: { tab: MethodTab; onTab: (t: MethodTab) => void; counts: { entries: number; methods: number } }) {
  const tabs: [MethodTab, string, number | null][] = [
    ['entries', 'Entries', counts.entries],
    ['methods', 'Methods', counts.methods],
    ['model', 'Process model', null],
  ];
  return (
    <div className="jr-mtabs" role="tablist" aria-label="Methods & Methodology">
      {tabs.map(([id, label, n]) => (
        <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'is-on' : ''} onClick={() => onTab(id)}>
          {label}
          {n != null && <span className="jr-muted">{n}</span>}
        </button>
      ))}
    </div>
  );
}

// ---- the Methods / Process model tabs ----
export function MethodsPane({ store, tab, openEntry }: { store: JournalStore; tab: MethodTab; openEntry: (id: string, task?: string) => void }) {
  const [open, setOpen] = useState<string | null>(null); // a method id, or 'new'
  const [phasesOpen, setPhasesOpen] = useState(false);
  const usage = useMemo(() => methodUsage(store.docs.entries), [store.docs.entries]);
  const codes = useMemo(() => methodCodes(store), [store.docs.methods, store.docs.phases]);
  return (
    <>
      {tab === 'methods' ? (
        <MethodTable store={store} usage={usage} codes={codes} onOpen={setOpen} onNew={() => setOpen('new')} />
      ) : (
        <ProcessModel store={store} usage={usage} onOpen={setOpen} onEditPhases={() => setPhasesOpen(true)} />
      )}
      {open && <MethodDrawer key={open} store={store} id={open === 'new' ? null : open} usage={usage} codes={codes} onClose={() => setOpen(null)} onOpen={setOpen} openEntry={openEntry} />}
      {phasesOpen && <PhaseEditor store={store} onClose={() => setPhasesOpen(false)} />}
    </>
  );
}

// ---- table ----
function MethodTable({ store, usage, codes, onOpen, onNew }: { store: JournalStore; usage: Map<string, Usage>; codes: Map<string, string>; onOpen: (id: string) => void; onNew: () => void }) {
  const [q, setQ] = useState('');
  const [type, setType] = useState<MethodType | ''>('');
  const [phase, setPhase] = useState('');
  const [use, setUse] = useState<'' | 'used' | 'planned'>('');
  const phases = sortedPhases(store);
  const all = Object.values(store.docs.methods ?? {});
  const rows = all
    .filter((m) => (!type || m.type === type) && (!phase || m.phase === phase) && (!use || (use === 'used') === !!usage.get(m.id)))
    .filter((m) => !q.trim() || `${m.name} ${m.desc} ${m.area}`.toLowerCase().includes(q.trim().toLowerCase()));
  const groups = phases.map((p) => ({ p, ms: rows.filter((m) => m.phase === p.id).sort((a, b) => p.areas.indexOf(a.area) - p.areas.indexOf(b.area) || byOrder(a, b)) })).filter((g) => g.ms.length);
  const lost = rows.filter((m) => !phases.some((p) => p.id === m.phase));
  const max = Math.max(1, ...all.map((m) => usage.get(m.id)?.uses.length ?? 0));
  return (
    <div className="jr-mtable">
      <div className="jr-filters jr-mfilters" role="search">
        <label className="jr-search">
          <Icon name="search" />
          <input type="search" value={q} placeholder="Search methods…" aria-label="Search methods" onChange={(e) => setQ(e.target.value)} />
        </label>
        <span className="jr-chips" role="group" aria-label="Type">
          <button type="button" className={`jr-chip is-small${!type ? ' is-on' : ''}`} onClick={() => setType('')}>
            All <span className="jr-mcount">{all.length}</span>
          </button>
          {METHOD_TYPES.map((t) => (
            <button key={t.id} type="button" className={`jr-chip is-small${type === t.id ? ' is-on' : ''}`} aria-pressed={type === t.id} onClick={() => setType(type === t.id ? '' : t.id)}>
              <TypeDot t={t.id} />
              {t.label} <span className="jr-mcount">{all.filter((m) => m.type === t.id).length}</span>
            </button>
          ))}
        </span>
        <select value={phase} aria-label="Phase" onChange={(e) => setPhase(e.target.value)}>
          <option value="">All phases</option>
          {phases.map((p) => (
            <option key={p.id} value={p.id}>
              {phaseLabel(p)}
            </option>
          ))}
        </select>
        <select value={use} aria-label="Usage" onChange={(e) => setUse(e.target.value as typeof use)}>
          <option value="">Used + planned</option>
          <option value="used">Used</option>
          <option value="planned">Planned</option>
        </select>
        <span className="jr-spacer" />
        <button type="button" onClick={onNew}>
          <Icon name="plus" /> New method
        </button>
      </div>
      {rows.length ? (
        <div className="jr-table jr-mt" role="table" aria-label="Methods">
          <div className="jr-mt-row is-head" role="row">
            <span role="columnheader">ID</span>
            <span role="columnheader">Method · Mikro</span>
            <span role="columnheader">Type</span>
            <span role="columnheader">Phase · Makro</span>
            <span role="columnheader">Area · Meso</span>
            <span role="columnheader">Used</span>
            <span role="columnheader">Last used</span>
          </div>
          {[...groups, ...(lost.length ? [{ p: undefined as MethodPhase | undefined, ms: lost }] : [])].map((g) => (
            <div key={g.p?.id ?? 'lost'} role="rowgroup">
              <div className="jr-mt-group" role="row">
                <span className={`jr-mt-tone is-${g.p?.tone ?? 'fu'}`} aria-hidden="true" />
                {g.p ? phaseLabel(g.p) : 'Without phase'}
              </div>
              {g.ms.map((m) => {
                const u = usage.get(m.id);
                return (
                  <button key={m.id} type="button" className="jr-mt-row" role="row" onClick={() => onOpen(m.id)}>
                    <span className="jr-mt-code">{codes.get(m.id)}</span>
                    <span className="jr-mt-name">
                      <strong>{m.name}</strong>
                      {m.desc && <small>{m.desc}</small>}
                      {(m.source || m.zotero) && <small className="jr-mt-src">{sourceText(m, store)}</small>}
                    </span>
                    <span>
                      <span className="jr-mtype">
                        <TypeDot t={m.type} />
                        {typeOf(m.type).label}
                      </span>
                    </span>
                    <span className="jr-mt-phase">
                      <span className={`jr-mt-tone is-${g.p?.tone ?? 'fu'}`} aria-hidden="true" />
                      {g.p ? (g.p.id === ALONGSIDE ? 'Begleitend' : g.p.code) : '–'}
                    </span>
                    <span className="jr-mt-area">{m.area || '–'}</span>
                    <span className={`jr-mt-use${u ? '' : ' is-zero'}`}>
                      {u ? (
                        <>
                          {u.uses.length}×<span className="jr-mt-bar" style={{ width: `${Math.round((u.uses.length / max) * 56)}px` }} />
                        </>
                      ) : (
                        'planned'
                      )}
                    </span>
                    <span className={u ? '' : 'jr-muted'}>{u?.last ? fmtDate(u.last) : '–'}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      ) : (
        <p className="jr-empty">{all.length ? 'No method matches the filters.' : 'No methods yet. “New method” adds the first.'}</p>
      )}
    </div>
  );
}

// ---- the process model (the look of the methodical framework figure) ----
function ProcessModel({ store, usage, onOpen, onEditPhases }: { store: JournalStore; usage: Map<string, Usage>; onOpen: (id: string) => void; onEditPhases: () => void }) {
  const [show, setShow] = useState<'all' | 'used' | 'planned'>('all');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const phases = sortedPhases(store);
  const everything = Object.values(store.docs.methods ?? {});
  const methods = everything.filter((m) => !isInstrument(m));
  const instruments = everything.filter(isInstrument);
  const along = phases.find((p) => p.id === ALONGSIDE);
  const flow = phases.filter((p) => p.id !== ALONGSIDE);
  const visible = (m: Method) => show === 'all' || (show === 'used') === !!usage.get(m.id);
  const row = (m: Method) => {
    const n = usage.get(m.id)?.uses.length ?? 0;
    return (
      <button key={m.id} type="button" className={`vm-mi${n ? '' : ' is-planned'}`} onClick={() => onOpen(m.id)} title={`${m.name} · ${typeOf(m.type).label}${n ? ` · used ${n}×` : ' · planned'}`}>
        <span className="vm-tx">
          <b>{m.name}</b>
          {m.desc && <span>{m.desc}</span>}
        </span>
        <span className="vm-rs">
          <em>{n ? `${n}×` : 'geplant'}</em>
          <i>{typeOf(m.type).tag}</i>
        </span>
      </button>
    );
  };
  const exportPng = async () => {
    if (!ref.current) return;
    setBusy(true);
    try {
      await downloadPng(ref.current, 'vorgehensmodell.png');
    } catch (e) {
      alert(`The image could not be made: ${String((e as Error).message)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="jr-pm">
      <div className="jr-filters jr-pm-tools">
        <span className="jr-chips" role="group" aria-label="Show">
          {(
            [
              ['all', 'All methods'],
              ['used', 'Used only'],
              ['planned', 'Planned only'],
            ] as const
          ).map(([id, l]) => (
            <button key={id} type="button" className={`jr-chip is-small${show === id ? ' is-on' : ''}`} aria-pressed={show === id} onClick={() => setShow(id)}>
              {l}
            </button>
          ))}
        </span>
        <span className="jr-spacer" />
        <button type="button" onClick={onEditPhases}>
          <Icon name="layers" /> Edit phases
        </button>
        <button type="button" className="is-primary" disabled={busy} onClick={() => void exportPng()}>
          {busy ? 'Exporting …' : 'Export PNG'}
        </button>
      </div>
      <div className="jr-pm-canvas">
        <style>{VM_CSS}</style>
        <div className="jr-vm" ref={ref}>
          <h3>Methodisches Vorgehensmodell</h3>
          <div className="vm-top">
            <div>
              <div className="vm-sec">Legende</div>
              <div className="vm-leg">
                <div className="vm-bar">
                  <span className="vm-vt">MAKRO - Projektphase</span>
                </div>
                <div className="vm-in">
                  <div className="vm-meso">
                    <div className="vm-mt">MESO - Tätigkeitsbereich</div>
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="vm-lmi">
                        <b>MIKRO - Methoden, Instrumente und Arbeitsschritte</b>
                        <span>Kurzbeschreibung der Methode</span>
                      </div>
                    ))}
                  </div>
                  <div className="vm-lerg">
                    <b>ERGEBNIS</b>Resultat der Projektphase
                  </div>
                </div>
              </div>
            </div>
            <div>
              <div className="vm-sec">Farbkodierung</div>
              <div className="vm-fk">
                {PHASE_TONES.map((t) => (
                  <div key={t.id} className={`vm-k is-${t.id}`}>
                    {t.label}
                  </div>
                ))}
                <div className="vm-k is-pb">Projektbegleitende Tätigkeiten</div>
                <div className="vm-tl">
                  {METHOD_TYPES.map((t) => (
                    <span key={t.id}>
                      <i>{t.tag}</i>
                      {t.de}
                    </span>
                  ))}
                </div>
                <div className="vm-tl">
                  <span>
                    <i>3×</i>verwendet
                  </span>
                  <span>
                    <i className="is-planned">geplant</i>noch nicht verwendet
                  </span>
                </div>
              </div>
            </div>
          </div>
          {along && (
            <>
              <div className="vm-sec">Projektbegleitende Tätigkeiten</div>
              <div className="vm-pb">
                {methods
                  .filter((m) => m.phase === ALONGSIDE && visible(m))
                  .sort(byOrder)
                  .map((m) => {
                    const n = usage.get(m.id)?.uses.length ?? 0;
                    return (
                      <button key={m.id} type="button" onClick={() => onOpen(m.id)}>
                        {m.name}
                        {n > 0 && <em>{n}×</em>}
                      </button>
                    );
                  })}
              </div>
            </>
          )}
          {instruments.some(visible) && (
            <>
              <div className="vm-sec">Instrumente, Techniken und Werkzeuge</div>
              <div className="vm-ins">
                {instruments
                  .filter(visible)
                  .sort((a, b) => (store.docs.phases?.[a.phase]?.order ?? 99) - (store.docs.phases?.[b.phase]?.order ?? 99) || byOrder(a, b))
                  .map((m) => {
                    const n = usage.get(m.id)?.uses.length ?? 0;
                    const p = store.docs.phases?.[m.phase];
                    return (
                      <button key={m.id} type="button" className={n ? '' : 'is-planned'} onClick={() => onOpen(m.id)}>
                        <b>{m.name}</b>
                        <span>{[p ? (p.id === ALONGSIDE ? 'projektbegleitend' : p.code) : '', m.desc].filter(Boolean).join(' · ')}</span>
                        {n > 0 && <em>{n}×</em>}
                      </button>
                    );
                  })}
              </div>
            </>
          )}
          <div className="vm-sec">Projektablauf</div>
          {flow.map((p) => {
            const mine = methods.filter((m) => m.phase === p.id);
            const used = mine.filter((m) => usage.get(m.id)).length;
            const areas = [...p.areas, ...[...new Set(mine.map((m) => m.area))].filter((a) => !p.areas.includes(a))];
            return (
              <section key={p.id} className={`vm-ph is-${p.tone}`}>
                <div className="vm-bar">
                  <span className="vm-vt">{`${p.code} - ${p.name}`}</span>
                </div>
                <div className="vm-body">
                  <div className="vm-grid" style={{ '--cols': Math.max(1, Math.min(p.cols || 3, areas.length || 1)) } as React.CSSProperties}>
                    {areas.map((a) => {
                      const ms = mine.filter((m) => m.area === a && visible(m)).sort(byOrder);
                      return (
                        <div key={a} className="vm-meso">
                          <div className="vm-mz">{a || 'Ohne Bereich'}</div>
                          {ms.length ? ms.map(row) : <div className="vm-none">{show === 'all' ? 'Noch keine Methode' : '–'}</div>}
                        </div>
                      );
                    })}
                  </div>
                  <div className="vm-erg">
                    <b>ERGEBNIS</b>
                    <span>{p.result || '–'}</span>
                    {mine.length > 0 && (
                      <span className="vm-pg">
                        {`${used}/${mine.length} verwendet`}
                        <i>
                          <u style={{ width: `${Math.round((used / mine.length) * 100)}%` }} />
                        </i>
                      </span>
                    )}
                  </div>
                </div>
              </section>
            );
          })}
          {!flow.length && <p className="vm-none">No phases yet. “Edit phases” adds the first.</p>}
        </div>
      </div>
    </div>
  );
}

// the model as a PNG: its own markup and styles in an SVG <foreignObject>, drawn at 3×
async function downloadPng(node: HTMLElement, name: string) {
  const w = Math.ceil(node.scrollWidth);
  const h = Math.ceil(node.scrollHeight);
  const font = await fetch('/fonts/inter-latin-wght-normal.woff2')
    .then((r) => (r.ok ? r.blob() : null))
    .then((b) => (b ? new Promise<string>((res) => { const rd = new FileReader(); rd.onload = () => res(String(rd.result)); rd.readAsDataURL(b); }) : ''))
    .catch(() => '');
  const css = `${font ? `@font-face{font-family:Inter;font-weight:100 900;src:url(${font}) format('woff2')}` : ''}${VM_CSS}.jr-vm{background:#fff}`;
  const html = new XMLSerializer().serializeToString(node);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${w}px"><style>${css.replace(/</g, '\\3c ')}</style>${html}</div></foreignObject></svg>`;
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const k = 3;
  const c = document.createElement('canvas');
  c.width = w * k;
  c.height = h * k;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.scale(k, k);
  g.drawImage(img, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'));
  if (!blob) throw new Error('no image');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// the model's look (also embedded in the exported PNG, so kept in one place)
const VM_CSS = `
.jr-vm{--exB:#3d9be0;--exL:#e6f1fa;--exR:#4fa6e4;--exC:#c4def3;--exE:#d3e7f7;--fuB:#6c7be0;--fuL:#eeeffa;--fuR:#7b89e6;--fuC:#d2d6f5;--fuE:#dfe2f7;--waB:#2aab6f;--waL:#e5f4eb;--waR:#33b878;--waC:#bfe5cf;--waE:#d1ecdc;font-family:Inter,system-ui,sans-serif;color:#2b2d33;padding:34px 38px 40px;box-sizing:border-box;min-width:0}
.jr-vm *{box-sizing:border-box}
.jr-vm h3{font-size:24px;font-weight:550;margin:0 0 30px;letter-spacing:-.2px;color:#2b2d33}
.jr-vm button{all:unset;cursor:pointer;box-sizing:border-box}
.jr-vm .vm-sec{font-size:10.5px;letter-spacing:.6px;color:#5d6068;border-left:1.5px solid #5d6068;padding-left:6px;margin:0 0 10px;text-transform:uppercase}
.jr-vm .vm-top{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-bottom:22px}
.jr-vm .vm-leg{background:#f1f2f6;padding:10px;display:flex;gap:10px;max-width:350px}
.jr-vm .vm-bar{width:30px;flex:none;color:#fff;display:flex;align-items:center;justify-content:center;background:#5f636e}
.jr-vm .vm-leg .vm-bar{width:26px}
.jr-vm .vm-vt{writing-mode:vertical-rl;transform:rotate(180deg);font-weight:700;font-size:12px;white-space:nowrap;letter-spacing:.2px;padding:10px 0}
.jr-vm .vm-in{flex:1;display:flex;flex-direction:column;gap:8px;min-width:0}
.jr-vm .vm-leg .vm-meso{background:#fff;border:1px solid #d6d8de;padding:8px}
.jr-vm .vm-mt{font-size:9.5px;font-weight:700;margin-bottom:6px}
.jr-vm .vm-lmi{background:#5f636e;color:#fff;padding:5px 7px;margin-top:5px}
.jr-vm .vm-lmi b{font-size:9.5px;display:block}.jr-vm .vm-lmi span{font-size:7.5px;opacity:.75}
.jr-vm .vm-lerg{display:flex;align-items:center;background:#e2e4ea;font-size:9.5px;padding:7px 8px;gap:8px}
.jr-vm .vm-lerg b{font-size:9px;letter-spacing:.3px;padding-right:8px;border-right:1px solid #b9bcc6}
.jr-vm .vm-fk{display:flex;flex-direction:column;gap:5px;max-width:380px}
.jr-vm .vm-k{font-size:10.5px;padding:5px 7px}
.jr-vm .vm-k.is-ex{background:var(--exL);color:var(--exB)}.jr-vm .vm-k.is-fu{background:var(--fuL);color:var(--fuB)}.jr-vm .vm-k.is-wa{background:var(--waL);color:var(--waB)}.jr-vm .vm-k.is-pb{background:#ecedf0;color:#444}
.jr-vm .vm-tl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 20px;margin-top:14px}
.jr-vm .vm-tl+.vm-tl{border-top:1px solid #ecedf0;padding-top:12px}
.jr-vm .vm-tl span{display:flex;align-items:center;font-size:10px;color:#444;white-space:nowrap;min-width:0}
.jr-vm .vm-tl i{font-style:normal;display:inline-flex;align-items:center;justify-content:center;flex:none;width:46px;font-size:7px;font-weight:700;letter-spacing:.4px;background:#5f636e;color:#fff;border-radius:2px;padding:3px 0;line-height:1;margin-right:8px}
.jr-vm .vm-tl i.is-planned{background:transparent;color:#6c7be0;outline:1px dashed #6c7be0;outline-offset:-1px}
.jr-vm .vm-pb{background:#ecedf0;padding:20px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin-bottom:24px}
.jr-vm .vm-pb button{background:#c9ccd4;text-align:center;font-size:10.5px;font-weight:700;padding:8px;color:#3b3d44;display:flex;align-items:center;justify-content:center;gap:8px}
.jr-vm .vm-pb em{font-style:normal;font-weight:600;font-size:9px;opacity:.7}
.jr-vm .vm-ins{background:#f4f2ec;padding:14px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:24px}
.jr-vm .vm-ins button{background:#fff;border:1px solid #ddd8c8;padding:6px 8px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:1px 6px;align-items:baseline}
.jr-vm .vm-ins button.is-planned{border-style:dashed}
.jr-vm .vm-ins b{font-size:10px;font-weight:650;color:#4a4636;overflow-wrap:anywhere}
.jr-vm .vm-ins span{grid-column:1;font-size:8px;color:#8a8470}
.jr-vm .vm-ins em{grid-column:2;grid-row:1;font-style:normal;font-size:8.5px;font-weight:700;color:#8a7a3e}
.jr-vm .vm-ph{display:flex;margin-bottom:22px}
.jr-vm .vm-body{flex:1;min-width:0;padding:12px 12px 12px 10px}
.jr-vm .vm-grid{display:grid;grid-template-columns:repeat(var(--cols),minmax(0,1fr));gap:12px}
.jr-vm .vm-meso{background:#fff;padding:9px 9px 11px;min-width:0}
.jr-vm .vm-mz{font-size:10.5px;font-weight:600;margin:0 0 8px 2px;padding-bottom:7px;border-bottom:1px solid}
.jr-vm .vm-mi{display:flex;width:100%;align-items:stretch;gap:6px;color:#fff;padding:6px 7px;margin-top:5px;min-height:31px}
.jr-vm .vm-mi:hover{filter:brightness(1.06)}
.jr-vm .vm-mi:focus-visible{outline:2px solid #1d1d1b;outline-offset:2px}
.jr-vm .vm-tx{flex:1;min-width:0}
.jr-vm .vm-tx b{display:block;font-size:10.5px;font-weight:650;line-height:1.25;overflow-wrap:anywhere}
.jr-vm .vm-tx span{display:block;font-size:8px;opacity:.82;line-height:1.3;margin-top:1px}
.jr-vm .vm-rs{display:flex;flex-direction:column;align-items:flex-end;justify-content:space-between;gap:4px;flex:none;padding:1px 0}
.jr-vm .vm-rs em{font-style:normal;font-size:8.5px;font-weight:700;opacity:.92;line-height:1}
.jr-vm .vm-rs i{font-style:normal;display:inline-flex;align-items:center;justify-content:center;min-width:34px;font-size:7px;font-weight:700;letter-spacing:.4px;background:rgba(255,255,255,.2);border-radius:2px;padding:2px 4px;line-height:1;white-space:nowrap}
.jr-vm .vm-mi.is-planned{background:transparent!important;border:1px dashed}
.jr-vm .vm-mi.is-planned .vm-tx span{opacity:.75}
.jr-vm .vm-mi.is-planned .vm-rs i{background:transparent;box-shadow:inset 0 0 0 1px currentColor}
.jr-vm .vm-mi.is-planned .vm-rs em{font-weight:600;opacity:.8;font-size:7.5px;letter-spacing:.2px}
.jr-vm .vm-none{font-size:9.5px;color:#8a8c94;padding:6px 2px}
.jr-vm .vm-erg{display:flex;align-items:center;flex-wrap:wrap;margin-top:12px;padding:9px 10px;gap:6px 10px;font-size:10.5px}
.jr-vm .vm-erg b{font-size:9.5px;letter-spacing:.3px;padding-right:10px;border-right:1px solid rgba(0,0,0,.18);color:#3e4048}
.jr-vm .vm-pg{margin-left:auto;font-size:9.5px;display:flex;align-items:center;gap:6px}
.jr-vm .vm-pg i{display:inline-block;width:70px;height:5px;border-radius:3px;background:rgba(0,0,0,.1);position:relative;overflow:hidden}
.jr-vm .vm-pg u{position:absolute;left:0;top:0;bottom:0;background:currentColor}
${(['ex', 'fu', 'wa'] as const)
  .map((t) => `.jr-vm .vm-ph.is-${t}{background:var(--${t}L)}.jr-vm .is-${t} .vm-bar{background:var(--${t}B)}.jr-vm .is-${t} .vm-meso{outline:1px solid var(--${t}C)}.jr-vm .is-${t} .vm-mz{color:var(--${t}B);border-color:var(--${t}C)}.jr-vm .is-${t} .vm-mi{background:var(--${t}R)}.jr-vm .is-${t} .vm-mi.is-planned{border-color:var(--${t}B);color:var(--${t}B)}.jr-vm .is-${t} .vm-erg{background:var(--${t}E)}.jr-vm .is-${t} .vm-pg{color:var(--${t}B)}`)
  .join('\n')}
@media (max-width:700px){
.jr-vm{padding:18px 12px 24px}
.jr-vm h3{font-size:19px;margin-bottom:20px}
.jr-vm .vm-top{grid-template-columns:1fr;gap:16px}
.jr-vm .vm-pb{grid-template-columns:1fr;padding:12px;gap:8px}
.jr-vm .vm-ins{grid-template-columns:repeat(2,minmax(0,1fr));padding:10px}
.jr-vm .vm-grid{grid-template-columns:minmax(0,1fr)}
.jr-vm .vm-bar{width:26px}
.jr-vm .vm-pg{margin-left:0;width:100%}
}
`;

// ---- a method: details, uses, edit ----
function MethodDrawer({ store, id, usage, codes, onClose, onOpen, openEntry }: { store: JournalStore; id: string | null; usage: Map<string, Usage>; codes: Map<string, string>; onClose: () => void; onOpen: (id: string) => void; openEntry: (id: string, task?: string) => void }) {
  const m = id ? store.docs.methods?.[id] : undefined;
  const [editing, setEditing] = useState(!id);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const phase = m ? store.docs.phases?.[m.phase] : undefined;
  const u = m ? usage.get(m.id) : undefined;
  const with_ = m ? together(store.docs.entries, [m.id]).map((x) => store.docs.methods?.[x]).filter(Boolean) as Method[] : [];
  const remove = () => {
    if (!m) return;
    const n = u?.uses.length ?? 0;
    if (!confirm(`Delete “${m.name}”?${n ? ` It is removed from ${n} ${n === 1 ? 'task' : 'tasks'}.` : ''}`)) return;
    const put = new Map<string, Entry>();
    for (const x of u?.uses ?? []) {
      const e = put.get(x.e.id) ?? x.e;
      put.set(e.id, { ...e, tasks: (e.tasks ?? []).map((t) => (t.id === x.t.id ? { ...t, methods: (t.methods ?? []).filter((y) => y !== m.id) } : t)), updated: Date.now() });
    }
    void store.commit([...put.values()].map((e): Put => ({ coll: 'entries', id: e.id, data: e })), [{ coll: 'methods', id: m.id }]);
    onClose();
  };
  return (
    <>
      <div className="jr-drawer-scrim" onClick={onClose} />
      <aside className="jr-drawer jr-mdrawer" role="dialog" aria-modal="true" aria-labelledby="jr-md-h">
        <header className="jr-drawer-head">
          <div>
            <span className="jr-eyebrow">{m ? [isInstrument(m) ? 'Instrument' : 'Method', codes.get(m.id), phaseLabel(phase)].filter(Boolean).join(' · ') : 'Methods'}</span>
            <h2 id="jr-md-h">{m ? m.name : 'New method'}</h2>
          </div>
          <IconBtn icon="x" label="Close" onClick={onClose} />
        </header>
        <div className="jr-drawer-body">
          {editing ? (
            <MethodForm store={store} m={m} onDone={(saved) => (saved && !m ? onOpen(saved) : setEditing(false), !saved && !m ? onClose() : undefined)} />
          ) : m ? (
            <>
              <div className="jr-chips">
                <span className="jr-mtype">
                  <TypeDot t={m.type} />
                  {typeOf(m.type).label}
                </span>
                <span className="jr-mtype">
                  <span className={`jr-mt-tone is-${phase?.tone ?? 'fu'}`} aria-hidden="true" />
                  {[phase ? (phase.id === ALONGSIDE ? 'Projektbegleitend' : phase.code) : '–', m.area].filter(Boolean).join(' › ')}
                </span>
                <span className="jr-mtype">{u ? `Used ${u.uses.length}×` : 'Planned'}</span>
              </div>
              <dl className="jr-mfacts">
                <dt>Description</dt>
                <dd>{m.desc || <span className="jr-muted">–</span>}</dd>
                <dt>Makro</dt>
                <dd>{phaseLabel(phase)}</dd>
                <dt>Meso</dt>
                <dd>{m.area || '–'}</dd>
                <dt>Source</dt>
                <dd>{m.zotero ? <ZoteroSource s={{ label: m.source ?? '', url: '', zotero: m.zotero }} zotero={store.docs.zotero} /> : m.source || <span className="jr-muted">–</span>}</dd>
                {u && u.minutes > 0 && (
                  <>
                    <dt>Time logged</dt>
                    <dd>{`${fmtMinutes(u.minutes)} across ${u.uses.length} ${u.uses.length === 1 ? 'task' : 'tasks'}`}</dd>
                  </>
                )}
              </dl>
              <div className="jr-task-part">
                <span className="jr-task-label">Used in</span>
                {u ? (
                  <ul className="jr-muses">
                    {u.uses.map(({ e, t }) => (
                      <li key={`${e.id}/${t.id}`}>
                        <button type="button" onClick={() => openEntry(e.id, t.id)}>
                          <span className="jr-muted">{fmtDate(e.date)}</span>
                          <span>
                            {t.title || 'Untitled task'}
                            <small>{e.title}</small>
                          </span>
                          <span className="jr-muted">{taskMinutes(t) != null ? fmtMinutes(taskMinutes(t)!) : ''}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="jr-muted jr-small">Not used in a task yet. A task names it under “Methods” in the Project Log.</p>
                )}
              </div>
              {with_.length > 0 && (
                <div className="jr-task-part">
                  <span className="jr-task-label">Often used together</span>
                  <div className="jr-chips">
                    {with_.map((x) => (
                      <button key={x.id} type="button" className="jr-chip is-small" onClick={() => onOpen(x.id)}>
                        <TypeDot t={x.type} />
                        {x.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="jr-muted">This method no longer exists.</p>
          )}
        </div>
        {m && !editing && (
          <footer className="jr-drawer-foot">
            <button type="button" onClick={() => setEditing(true)}>
              <Icon name="edit" /> Edit method
            </button>
            <button type="button" className="is-danger" onClick={remove}>
              <Icon name="trash" /> Delete
            </button>
          </footer>
        )}
      </aside>
    </>
  );
}

// name, description, type, phase, area; a new area is added to its phase
function MethodForm({ store, m, init, onDone }: { store: JournalStore; m?: Method; init?: Partial<Method>; onDone: (savedId: string | null) => void }) {
  const phases = sortedPhases(store);
  const [f, setF] = useState(() => ({ name: m?.name ?? init?.name ?? '', desc: m?.desc ?? '', source: m?.source ?? '', zotero: m?.zotero ?? '', type: m?.type ?? init?.type ?? ('W' as MethodType), phase: m?.phase ?? init?.phase ?? phases.find((p) => p.id !== ALONGSIDE)?.id ?? ALONGSIDE, area: m?.area ?? init?.area ?? '' }));
  const [newArea, setNewArea] = useState('');
  const [pick, setPick] = useState(false);
  const ph = store.docs.phases?.[f.phase];
  const areas = ph?.areas ?? [];
  const area = f.area === '__new' ? newArea.trim() : f.area || areas[0] || '';
  const ok = f.name.trim() && (f.area !== '__new' || newArea.trim());
  const save = async () => {
    if (!ok) return;
    const id = m?.id ?? newId('mt');
    const order = m?.order ?? Object.values(store.docs.methods ?? {}).filter((x) => x.phase === f.phase && x.area === area).length;
    const put: Put[] = [{ coll: 'methods', id, data: { id, name: f.name.trim(), desc: f.desc.trim(), type: f.type, phase: f.phase, area, order, created: m?.created ?? Date.now(), ...(f.source.trim() ? { source: f.source.trim() } : {}), ...(f.zotero ? { zotero: f.zotero } : {}) } satisfies Method }];
    if (ph && !ph.areas.includes(area)) put.push({ coll: 'phases', id: ph.id, data: { ...ph, areas: [...ph.areas, area] } });
    await store.commit(put);
    onDone(id);
  };
  return (
    <form
      className="jr-mform"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label className="jr-field">
        <span>Name</span>
        <input value={f.name} autoFocus onChange={(e) => setF({ ...f, name: e.target.value })} />
      </label>
      <label className="jr-field">
        <span>
          Short description <span className="jr-muted">optional</span>
        </span>
        <input value={f.desc} onChange={(e) => setF({ ...f, desc: e.target.value })} />
      </label>
      <div className="jr-field">
        <span>
          Source <span className="jr-muted">optional · from Zotero or typed</span>
        </span>
        {f.zotero ? (
          <ZoteroSource
            s={{ label: f.source, url: '', zotero: f.zotero }}
            zotero={store.docs.zotero}
            actions={<IconBtn icon="x" label="Remove the Zotero source" onClick={() => setF({ ...f, zotero: '', source: '' })} />}
          />
        ) : (
          <span className="jr-msrc">
            <input value={f.source} placeholder="e.g. Floyd (1984)" aria-label="Source" onChange={(e) => setF({ ...f, source: e.target.value })} />
            <button type="button" className="jr-btn" onClick={() => setPick(true)}>
              <Icon name="book" /> Zotero
            </button>
          </span>
        )}
      </div>
      {pick && (
        <ZoteroPicker
          store={store}
          initial={f.source}
          onPick={(key) => {
            const it = store.docs.zotero[key];
            setF({ ...f, zotero: key, source: it ? citeShort(it) || it.title : f.source });
            setPick(false);
          }}
          onClose={() => setPick(false)}
        />
      )}
      <div className="jr-field">
        <span>Type</span>
        <span className="jr-seg jr-mseg" role="radiogroup" aria-label="Type">
          {METHOD_TYPES.map((t) => (
            <button key={t.id} type="button" role="radio" aria-checked={f.type === t.id} className={f.type === t.id ? 'is-on' : ''} onClick={() => setF({ ...f, type: t.id })}>
              <TypeDot t={t.id} />
              {t.label}
            </button>
          ))}
        </span>
      </div>
      <div className="jr-mform-2">
        <label className="jr-field">
          <span>Macro · phase</span>
          <select value={f.phase} onChange={(e) => setF({ ...f, phase: e.target.value, area: '' })}>
            {phases.map((p) => (
              <option key={p.id} value={p.id}>
                {phaseLabel(p)}
              </option>
            ))}
          </select>
        </label>
        <label className="jr-field">
          <span>Meso · area</span>
          <select value={f.area && (areas.includes(f.area) || f.area === '__new') ? f.area : areas[0] ?? '__new'} onChange={(e) => setF({ ...f, area: e.target.value })}>
            {areas.map((a) => (
              <option key={a} value={a}>
                {a || '(no area)'}
              </option>
            ))}
            <option value="__new">New area …</option>
          </select>
        </label>
      </div>
      {(f.area === '__new' || !areas.length) && (
        <label className="jr-field">
          <span>New area</span>
          <input value={newArea} placeholder="e.g. Testdurchführung" onChange={(e) => (setNewArea(e.target.value), setF({ ...f, area: '__new' }))} />
        </label>
      )}
      <p className="jr-muted jr-small">{`Shown in the process model under ${ph ? (ph.id === ALONGSIDE ? 'Projektbegleitende Tätigkeiten' : ph.code) : '–'}${area ? ` › ${area}` : ''}.`}</p>
      <div className="jr-mform-foot">
        <button type="button" onClick={() => onDone(null)}>
          Cancel
        </button>
        <button type="submit" className="is-primary" disabled={!ok}>
          {m ? 'Save' : 'Add method'}
        </button>
      </div>
    </form>
  );
}

// ---- the phases (macro) and their areas (meso) ----
interface AreaRow {
  key: string;
  orig: string | null;
  name: string;
}
interface PhaseRow extends Omit<MethodPhase, 'areas'> {
  areas: AreaRow[];
  isNew?: boolean;
}
function PhaseEditor({ store, onClose }: { store: JournalStore; onClose: () => void }) {
  const [rows, setRows] = useState<PhaseRow[]>(() => sortedPhases(store).map((p) => ({ ...p, areas: p.areas.map((a) => ({ key: newId('a'), orig: a, name: a })) })));
  const methods = Object.values(store.docs.methods ?? {});
  const set = (i: number, p: Partial<PhaseRow>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const move = (i: number, d: number) => setRows((r) => {
    const n = [...r];
    const j = i + d;
    if (j < 0 || j >= n.length || n[j].id === ALONGSIDE || n[i].id === ALONGSIDE) return r;
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });
  const save = async () => {
    const put: Put[] = [];
    const del: { coll: 'phases'; id: string }[] = [];
    const moved = new Map<string, Method>();
    rows.forEach((p, i) => {
      const areas = p.areas.map((a) => a.name.trim()).filter((a, k, all) => (a || p.id === ALONGSIDE) && all.indexOf(a) === k);
      const { isNew: _n, ...rest } = p;
      put.push({ coll: 'phases', id: p.id, data: { ...rest, order: p.id === ALONGSIDE ? 0 : i + 1, areas } satisfies MethodPhase });
      // a renamed area takes its methods along; a removed one gives them to the first area
      for (const m of methods.filter((x) => x.phase === p.id)) {
        const row = p.areas.find((a) => a.orig === m.area);
        const to = row ? row.name.trim() : areas[0] ?? '';
        if (to !== m.area) moved.set(m.id, { ...m, area: to });
      }
    });
    for (const p of sortedPhases(store)) if (!rows.some((r) => r.id === p.id)) del.push({ coll: 'phases', id: p.id });
    await store.commit([...put, ...[...moved.values()].map((m): Put => ({ coll: 'methods', id: m.id, data: m }))], del);
    onClose();
  };
  const removed = methods.filter((m) => {
    const p = rows.find((r) => r.id === m.phase);
    return p && !p.areas.some((a) => a.orig === m.area);
  }).length;
  return (
    <Modal
      title="Phases and areas"
      wide
      onClose={onClose}
      footer={
        <>
          {removed > 0 && <span className="jr-warn jr-small">{`${removed} ${removed === 1 ? 'method moves' : 'methods move'} to the first area of its phase.`}</span>}
          <span className="jr-spacer" />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="is-primary" onClick={() => void save()}>
            Save
          </button>
        </>
      }
    >
      <p className="jr-muted jr-small">Makro = phase, Meso = area. Renaming an area keeps its methods in it.</p>
      <ul className="jr-phedit">
        {rows.map((p, i) => {
          const n = methods.filter((m) => m.phase === p.id).length;
          const along = p.id === ALONGSIDE;
          return (
            <li key={p.id}>
              <div className="jr-phedit-head">
                {along ? (
                  <strong>Projektbegleitende Tätigkeiten</strong>
                ) : (
                  <>
                    <input className="jr-phedit-code" value={p.code} aria-label="Code" onChange={(e) => set(i, { code: e.target.value })} />
                    <input value={p.name} aria-label="Phase name" onChange={(e) => set(i, { name: e.target.value })} />
                    <select value={p.tone} aria-label="Colour" onChange={(e) => set(i, { tone: e.target.value as PhaseTone })}>
                      {PHASE_TONES.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                    <select value={p.cols} aria-label="Columns" onChange={(e) => set(i, { cols: Number(e.target.value) })}>
                      {[1, 2, 3].map((c) => (
                        <option key={c} value={c}>{`${c} ${c === 1 ? 'column' : 'columns'}`}</option>
                      ))}
                    </select>
                    <IconBtn icon="up" label="Move up" disabled={i <= 1} onClick={() => move(i, -1)} />
                    <IconBtn icon="down" label="Move down" disabled={i === rows.length - 1} onClick={() => move(i, 1)} />
                    <IconBtn icon="trash" label={n ? `Has ${n} methods – move them first` : 'Remove phase'} danger disabled={n > 0} onClick={() => setRows((r) => r.filter((x) => x.id !== p.id))} />
                  </>
                )}
              </div>
              {!along && <input className="jr-phedit-res" value={p.result} placeholder="Ergebnis der Phase" aria-label="Result" onChange={(e) => set(i, { result: e.target.value })} />}
              {!along && (
                <div className="jr-chips">
                  {p.areas.map((a, k) => (
                    <span key={a.key} className="jr-phedit-area">
                      <input value={a.name} aria-label="Area" onChange={(e) => set(i, { areas: p.areas.map((x) => (x.key === a.key ? { ...x, name: e.target.value } : x)) })} />
                      <IconBtn icon="x" label="Remove area" onClick={() => set(i, { areas: p.areas.filter((_, j) => j !== k) })} />
                    </span>
                  ))}
                  <button type="button" className="jr-chip is-small is-suggested" onClick={() => set(i, { areas: [...p.areas, { key: newId('a'), orig: null, name: 'Neuer Bereich' }] })}>
                    <Icon name="plus" /> Area
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <button type="button" onClick={() => setRows((r) => [...r, { id: newId('ph'), code: `M${r.filter((x) => x.id !== ALONGSIDE).length + 1}`, name: 'Neue Phase', tone: 'fu', result: '', cols: 3, areas: [{ key: newId('a'), orig: null, name: 'Neuer Bereich' }], order: r.length, isNew: true }])}>
        <Icon name="plus" /> Phase
      </button>
    </Modal>
  );
}

// ---- in a task: the methods it used ----
export function MethodField({ store, chosen, label, onChange }: { store: JournalStore; chosen: string[]; label: string; onChange: (ids: string[]) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const all = store.docs.methods ?? {};
  const phases = sortedPhases(store);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) (setOpen(false), setCreating(null));
    };
    document.addEventListener('mousedown', down);
    return () => document.removeEventListener('mousedown', down);
  }, [open]);
  const usage = useMemo(() => (open ? methodUsage(store.docs.entries) : new Map<string, Usage>()), [open, store.docs.entries]);
  const toggle = (id: string) => onChange(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]);
  const needle = q.trim().toLowerCase();
  const hits = Object.values(all).filter((m) => !needle || `${m.name} ${m.desc} ${m.area}`.toLowerCase().includes(needle));
  const meth = hits.filter((m) => !isInstrument(m));
  const instr = hits.filter(isInstrument).sort((a, b) => (store.docs.phases?.[a.phase]?.order ?? 99) - (store.docs.phases?.[b.phase]?.order ?? 99) || byOrder(a, b));
  const groups = [
    ...phases
      .map((p) => ({ key: p.id, tone: p.tone, title: p.id === ALONGSIDE ? 'Projektbegleitend' : `${p.code} ${p.name}`, areas: [...new Set([...p.areas, ...meth.filter((m) => m.phase === p.id).map((m) => m.area)])].map((a) => ({ a, ms: meth.filter((m) => m.phase === p.id && m.area === a).sort(byOrder) })).filter((x) => x.ms.length) }))
      .filter((g) => g.areas.length),
    ...(instr.length ? [{ key: 'instr', tone: 'instr', title: 'Instrumente, Techniken und Werkzeuge', areas: [{ a: '', ms: instr }] }] : []),
  ];
  const exact = hits.some((m) => m.name.toLowerCase() === needle);
  const sug = together(store.docs.entries, chosen).filter((id) => all[id]);
  return (
    <div className="jr-task-part">
      <span className="jr-task-label">{`Methods · ${chosen.length}`}</span>
      <div className="jr-chips jr-mfield" ref={wrap}>
        {chosen.map((id) => {
          const m = all[id];
          if (!m) return null;
          const p = store.docs.phases?.[m.phase];
          return (
            <span key={id} className="jr-chip is-small jr-mchip" title={`${typeOf(m.type).label} · ${phaseLabel(p)}${m.area ? ` › ${m.area}` : ''}`}>
              <TypeDot t={m.type} />
              {m.name}
              {p && p.id !== ALONGSIDE && <small>{p.code}</small>}
              <button type="button" className="jr-chip-x" aria-label={`Remove method ${m.name}`} onClick={() => toggle(id)}>
                ×
              </button>
            </span>
          );
        })}
        <span className="jr-mpick-wrap">
          <input
            className="jr-chip-input"
            value={q}
            placeholder="+ method"
            aria-label={`Add a method to ${label}`}
            aria-expanded={open}
            onFocus={() => setOpen(true)}
            onChange={(e) => (setQ(e.target.value), setOpen(true), setCreating(null))}
            onKeyDown={(e) => {
              if (e.key === 'Escape') (setOpen(false), setCreating(null));
              if (e.key === 'Enter') {
                e.preventDefault();
                const first = groups[0]?.areas[0]?.ms[0];
                if (needle && first && first.name.toLowerCase().startsWith(needle) && !chosen.includes(first.id)) (toggle(first.id), setQ(''));
                else if (needle && !exact) setCreating(q.trim());
              }
            }}
          />
          {open && (
            <div className="jr-mpick" role="listbox" aria-label="Methods">
              {creating != null ? (
                <div className="jr-mpick-new">
                  <strong>New method</strong>
                  <MethodForm
                    store={store}
                    init={{ name: creating }}
                    onDone={(id) => {
                      setCreating(null);
                      if (id) (onChange([...chosen, id]), setQ(''), setOpen(false));
                    }}
                  />
                </div>
              ) : (
                <>
                  <div className="jr-mpick-list">
                    {groups.map(({ key, tone, title, areas }) =>
                      areas.map(({ a, ms }) => (
                        <div key={`${key}/${a}`}>
                          <div className="jr-mpick-grp">
                            <span className={`jr-mt-tone is-${tone}`} aria-hidden="true" />
                            {[title, a].filter(Boolean).join(' › ')}
                          </div>
                          {ms.map((m) => {
                            const on = chosen.includes(m.id);
                            const n = usage.get(m.id)?.uses.length ?? 0;
                            return (
                              <button key={m.id} type="button" role="option" aria-selected={on} className={`jr-mpick-it${on ? ' is-on' : ''}`} onClick={() => toggle(m.id)}>
                                <span className={`jr-mck${on ? ' is-on' : ''}`} aria-hidden="true" />
                                <span className="jr-mpick-nm">
                                  {m.name}
                                  {m.desc && <small>{m.desc}</small>}
                                </span>
                                <span className="jr-mtype">
                                  <TypeDot t={m.type} />
                                  {typeOf(m.type).label}
                                </span>
                                <span className="jr-muted jr-small">{n ? `${n}×` : ''}</span>
                              </button>
                            );
                          })}
                        </div>
                      )),
                    )}
                    {!groups.length && <p className="jr-muted jr-small jr-mpick-empty">No method matches.</p>}
                  </div>
                  <button type="button" className="jr-mpick-foot" onClick={() => setCreating(q.trim())}>
                    <Icon name="plus" />
                    {needle && !exact ? (
                      <span>
                        Create <strong>“{q.trim()}”</strong> as a new method
                      </span>
                    ) : (
                      'New method'
                    )}
                  </button>
                </>
              )}
            </div>
          )}
        </span>
      </div>
      {sug.length > 0 && (
        <div className="jr-chips">
          <span className="jr-muted jr-small">Often used together:</span>
          {sug.map((id) => (
            <button key={id} type="button" className="jr-chip is-suggested is-small" onClick={() => toggle(id)}>
              <Icon name="plus" />
              <TypeDot t={all[id].type} />
              {all[id].name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// a task's methods, read-only (the entry view)
export function MethodChips({ store, ids }: { store: JournalStore; ids: string[] }) {
  const ms = ids.map((id) => store.docs.methods?.[id]).filter(Boolean) as Method[];
  if (!ms.length) return null;
  return (
    <div className="jr-chips jr-mchips">
      {ms.map((m) => (
        <span key={m.id} className="jr-mtype" title={`${typeOf(m.type).label} · ${phaseLabel(store.docs.phases?.[m.phase])}`}>
          <TypeDot t={m.type} />
          {m.name}
        </span>
      ))}
    </div>
  );
}
