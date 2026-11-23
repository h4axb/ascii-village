// Figures of a method: images with their caption for the thesis. The caption
// is plain text for Word (Word numbers the figures, "Abb. X"). Zotero is
// optional: link the original source, or make an Artwork item from the image
// with the image attached (functions/api/zotero.ts, figure()).
import { useEffect, useState } from 'react';
import { fileBlobUrl, type JournalStore } from './store';
import type { Figure, FigureOrigin, ZoteroItem } from './types';
import { Icon, IconBtn } from './ui';
import { authorsShort, citeShort, ZoteroPicker } from './zotero';

export const ORIGINS: { id: FigureOrigin; label: string }[] = [
  { id: 'own', label: 'Own' },
  { id: 'foreign', label: 'Third-party' },
  { id: 'adapted', label: 'Adapted' },
];
const ORIGIN_DE: Record<FigureOrigin, string> = { own: 'Eigene Darstellung', foreign: 'Fremde Abbildung', adapted: 'Abgewandelt' };

// the original's short cite for the caption: "Norman 2013"
const citeOf = (f: Figure, zotero: Record<string, ZoteroItem>) => {
  const it = f.zotero && !f.zoteroOwn ? zotero[f.zotero] : undefined;
  if (it) return [authorsShort(it.creators) || it.title, it.year].filter(Boolean).join(' ');
  // typed names: last names only ("Don Norman" or "Norman, Don" → Norman)
  const names = (f.creator ?? '')
    .split(/\s*(?:&|;|\bund\b|\band\b)\s*/)
    .map((n) => (n.includes(',') ? n.split(',')[0] : n.trim().split(/\s+/).pop() ?? '').trim())
    .filter(Boolean);
  return [authorsShort(names), f.year?.trim()].filter(Boolean).join(' ');
};
// the year shown: the linked original's, else the typed one
const yearOf = (f: Figure, zotero: Record<string, ZoteroItem>) => (f.zotero && !f.zoteroOwn ? zotero[f.zotero]?.year : undefined) || f.year;
// the caption, e.g. "Crafting-Interface, Variante A (Quelle: eigene Darstellung)."
export const captionOf = (f: Figure, zotero: Record<string, ZoteroItem>) => {
  const c = citeOf(f, zotero) || '…';
  const src = f.origin === 'own' ? 'eigene Darstellung' : f.origin === 'adapted' ? `eigene Darstellung in Anlehnung an ${c}` : c;
  return `${f.title.trim().replace(/[.\s]+$/, '') || 'Titel'} (Quelle: ${src}).`;
};
export const newFigure = (file: string, name: string): Figure => ({ file, title: name.replace(/\.[a-z0-9]+$/i, ''), origin: 'own', year: String(new Date().getFullYear()), caption: '' });

// the image, fetched with the password; a click opens it in full
function FigImage({ id, alt }: { id: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    void fileBlobUrl(id)
      .then((x) => setUrl((u = x)))
      .catch(() => setUrl(null));
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [id]);
  return (
    <a className="jr-fig-img" href={url ?? undefined} target="_blank" rel="noreferrer" title="Open the image">
      {url ? <img src={url} alt={alt} /> : <Icon name="clip" />}
    </a>
  );
}

// the Zotero state of a figure, as one short line
const zoteroLine = (f: Figure, zotero: Record<string, ZoteroItem>) => {
  const it = f.zotero ? zotero[f.zotero] : undefined;
  if (f.zoteroOwn) return f.zotero ? 'Zotero item with the image' : 'New Zotero item · made on saving';
  if (f.zotero) return `Zotero source: ${it ? citeShort(it) || it.title : f.zotero}`;
  return 'Project Log only';
};

// ---------- the form: add images, title, origin, Zotero and caption ----------

export function FigureEditor({ store, figures, onChange }: { store: JournalStore; figures: Figure[]; onChange: (f: Figure[]) => void }) {
  const z = store.docs.zotero ?? {};
  const [busy, setBusy] = useState<string | null>(null);
  const [linking, setLinking] = useState<number | null>(null);
  // a change; the caption follows until it is edited by hand
  const set = (i: number, patch: Partial<Figure>) =>
    onChange(
      figures.map((f, j) => {
        if (j !== i) return f;
        const n = { ...f, ...patch };
        return n.captionEdited ? n : { ...n, caption: captionOf(n, z) };
      }),
    );
  return (
    <div className="jr-figedit">
      {figures.length > 0 && (
        <ul className="jr-figs">
          {figures.map((f, i) => {
            const mode = f.zoteroOwn ? 'new' : f.zotero ? 'link' : 'log';
            return (
              <li key={f.file} className="jr-fig is-edit">
                <FigImage id={f.file} alt={f.title} />
                <div className="jr-fig-body">
                  <label className="jr-fig-in">
                    <span>Title</span>
                    <input value={f.title} aria-label="Figure title" onChange={(e) => set(i, { title: e.target.value })} />
                  </label>
                  <span className="jr-seg" role="radiogroup" aria-label="Origin">
                    {ORIGINS.map((o) => (
                      <button key={o.id} type="button" role="radio" aria-checked={f.origin === o.id} className={f.origin === o.id ? 'is-on' : ''} onClick={() => set(i, { origin: o.id })}>
                        {o.label}
                      </button>
                    ))}
                  </span>
                  <span className="jr-fig-row">
                    <input value={f.creator ?? ''} placeholder={f.origin === 'own' ? 'Creator (optional)' : 'Creator of the original'} aria-label="Creator" onChange={(e) => set(i, { creator: e.target.value })} />
                    <input value={f.year ?? ''} placeholder="Year" aria-label="Year" inputMode="numeric" onChange={(e) => set(i, { year: e.target.value })} />
                  </span>
                  <label className="jr-fig-in">
                    <span>
                      Zotero <span className="jr-muted">optional</span>
                    </span>
                    <select
                      value={mode}
                      aria-label="Zotero"
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === 'link') setLinking(i);
                        else set(i, v === 'new' ? { zotero: undefined, zoteroOwn: true } : { zotero: undefined, zoteroOwn: undefined });
                      }}
                    >
                      <option value="log">Project Log only</option>
                      <option value="link">{mode === 'link' ? 'Linked Zotero source' : 'Link a Zotero source …'}</option>
                      <option value="new">{f.zoteroOwn && f.zotero ? 'Zotero item with the image' : 'New Zotero item with the image'}</option>
                    </select>
                  </label>
                  {(mode === 'link' || (mode === 'new' && !f.zotero)) && (
                    <small className="jr-muted">
                      {zoteroLine(f, z)}
                      {mode === 'link' && (
                        <>
                          {' · '}
                          <button type="button" className="jr-linkbtn" onClick={() => setLinking(i)}>
                            change
                          </button>
                        </>
                      )}
                    </small>
                  )}
                  <label className="jr-fig-in">
                    <span>
                      Caption <span className="jr-muted">plain text for Word · Word numbers it</span>
                    </span>
                    <textarea rows={2} value={f.caption} aria-label="Caption" onChange={(e) => onChange(figures.map((x, j) => (j === i ? { ...x, caption: e.target.value, captionEdited: true } : x)))} />
                  </label>
                  {f.captionEdited && (
                    <button type="button" className="jr-linkbtn jr-fig-regen" onClick={() => set(i, { captionEdited: false })}>
                      <Icon name="refresh" /> Generate again
                    </button>
                  )}
                </div>
                <IconBtn icon="trash" label="Remove figure" danger onClick={() => onChange(figures.filter((_, j) => j !== i))} />
              </li>
            );
          })}
        </ul>
      )}
      <label className="jr-btn">
        <Icon name="plus" /> Add figure
        <input
          type="file"
          accept="image/*"
          multiple
          onChange={async (e) => {
            const list = [...(e.target.files ?? [])];
            e.target.value = '';
            const added: Figure[] = [];
            for (const file of list) {
              setBusy(`Uploading ${file.name} …`);
              try {
                const meta = await store.upload(file);
                const f = newFigure(meta.id, file.name);
                added.push({ ...f, caption: captionOf(f, z) });
              } catch (err) {
                setBusy(`${file.name}: ${String((err as Error).message)}`);
                return;
              }
            }
            setBusy(null);
            onChange([...figures, ...added]);
          }}
        />
      </label>
      {busy && (
        <p className="jr-muted" role="status">
          {busy}
        </p>
      )}
      {linking !== null && (
        <ZoteroPicker
          store={store}
          initial={figures[linking]?.creator ?? ''}
          onPick={(key) => {
            set(linking, { zotero: key, zoteroOwn: undefined });
            setLinking(null);
          }}
          onClose={() => setLinking(null)}
        />
      )}
    </div>
  );
}

// on saving: a Zotero item for every figure that asks for one; a failure keeps
// the figure in the journal (it asks again on the next save)
export async function syncFigures(store: JournalStore, figures: Figure[]): Promise<{ figures: Figure[]; errors: string[] }> {
  const errors: string[] = [];
  const out: Figure[] = [];
  for (const f of figures) {
    if (!f.zoteroOwn || f.zotero) {
      out.push(f);
      continue;
    }
    try {
      const res = await store.zotero.figure({ file: f.file, title: f.title.trim() || 'Untitled figure', creator: f.creator, year: f.year });
      if (res.warning) errors.push(`${f.title}: ${res.warning}`);
      out.push({ ...f, zotero: res.item.key });
    } catch (e) {
      errors.push(`${f.title}: ${String((e as Error).message)}`);
      out.push(f);
    }
  }
  return { figures: out, errors };
}

// ---------- the drawer: the figures with their caption, to copy into Word ----------

export function FigureList({ store, figures }: { store: JournalStore; figures: Figure[] }) {
  const z = store.docs.zotero ?? {};
  const [copied, setCopied] = useState<number | null>(null);
  return (
    <ul className="jr-figs">
      {figures.map((f, i) => (
        <li key={f.file} className="jr-fig">
          <FigImage id={f.file} alt={f.title} />
          <div className="jr-fig-body">
            <strong>{f.title || 'Untitled figure'}</strong>
            <small className="jr-muted">{[ORIGIN_DE[f.origin], yearOf(f, z), zoteroLine(f, z)].filter(Boolean).join(' · ')}</small>
            <span className="jr-fig-cap-h">Caption</span>
            <p className="jr-fig-cap">{f.caption}</p>
            <button
              type="button"
              className="jr-btn jr-fig-copy"
              onClick={() =>
                void navigator.clipboard.writeText(f.caption).then(() => {
                  setCopied(i);
                  setTimeout(() => setCopied((c) => (c === i ? null : c)), 1600);
                })
              }
            >
              <Icon name={copied === i ? 'check' : 'doc'} /> {copied === i ? 'Copied' : 'Copy for Word'}
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
