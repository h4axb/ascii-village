// The journal's data in the browser: loaded once, every change sent to
// /api/journal and shown at once. Signed in with the dashboard's password
// (the same session as /feedback); on the site, the unlock cookie does it.
import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_MILESTONES, DEFAULT_OVERVIEW, OVERVIEW_V2, type Coll, type FileMeta, type JournalDocs, type OverviewSection } from './types';

const PASS_KEY = 'asciia-feedback-pass'; // shared with /feedback
const EMPTY: JournalDocs = { entries: {}, milestones: {}, deadlines: {}, pages: {}, overview: {}, settings: {}, days: {}, weeks: {}, files: {} };

export interface Put {
  coll: Coll;
  id: string;
  data: unknown;
}
export interface Del {
  coll: Coll;
  id: string;
}
export interface JournalStore {
  docs: JournalDocs;
  state: 'loading' | 'locked' | 'ready' | 'error';
  error: string | null;
  saving: boolean;
  signIn: (pass: string) => Promise<void>;
  commit: (put: Put[], del?: Del[]) => Promise<void>;
  history: (coll: Coll, id: string) => Promise<{ at: number; data: unknown }[]>;
  upload: (f: File) => Promise<FileMeta>;
  removeFile: (id: string) => Promise<void>;
  fileUrl: (id: string) => string;
}

export function useJournal(): JournalStore {
  const [docs, setDocs] = useState<JournalDocs>(EMPTY);
  const [state, setState] = useState<JournalStore['state']>('loading');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const pass = useRef(sessionStorage.getItem(PASS_KEY) ?? '');
  const headers = (json = false): HeadersInit => ({ ...(pass.current ? { Authorization: `Bearer ${pass.current}` } : {}), ...(json ? { 'Content-Type': 'application/json' } : {}) });

  const load = useCallback(async () => {
    setState('loading');
    try {
      const r = await fetch('/api/journal', { headers: headers() });
      if (r.status === 401) {
        sessionStorage.removeItem(PASS_KEY);
        setState('locked');
        return;
      }
      if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
      const d = { ...EMPTY, ...((await r.json()) as Partial<JournalDocs>) };
      // first visit: the Overview's sections and the example milestones, all editable
      if (!d.settings.seeded) {
        const put: Put[] = [
          ...DEFAULT_OVERVIEW.map((s) => ({ coll: 'overview' as const, id: s.id, data: s })),
          ...(Object.keys(d.milestones).length ? [] : DEFAULT_MILESTONES.map((m) => ({ coll: 'milestones' as const, id: m.id, data: m }))),
          { coll: 'settings', id: 'seeded', data: { at: Date.now() } },
          { coll: 'settings', id: 'overviewV2', data: { at: Date.now() } },
        ];
        await fetch('/api/journal/batch', { method: 'POST', headers: headers(true), body: JSON.stringify({ put }) });
        for (const p of put) (d[p.coll] as Record<string, unknown>)[p.id] = p.data;
      }
      // once, for an Overview made before the dashboard layout: the tiles, the
      // timeline and the three cards first; every other section stays as it was
      if (!d.settings.overviewV2) {
        const secs = Object.values(d.overview);
        const top = Math.min(0, ...secs.map((x) => x.order));
        const ms = secs.find((x) => x.kind === 'milestones');
        const put: Put[] = [
          ...OVERVIEW_V2.filter((x) => !secs.some((y) => y.kind === x.kind)).map((x) => ({ coll: 'overview' as const, id: x.id, data: { ...x, order: top - (x.kind === 'stats' ? 3 : 1) } as OverviewSection })),
          ...(ms ? [{ coll: 'overview' as const, id: ms.id, data: { ...ms, order: top - 2 } }] : []),
          { coll: 'settings', id: 'overviewV2', data: { at: Date.now() } },
        ];
        const r2 = await fetch('/api/journal/batch', { method: 'POST', headers: headers(true), body: JSON.stringify({ put }) });
        if (r2.ok) for (const p of put) (d[p.coll] as Record<string, unknown>)[p.id] = p.data;
      }
      setDocs(d);
      setState('ready');
    } catch (e) {
      setError(String((e as Error).message));
      setState('error');
    }
  }, []);
  useEffect(() => void load(), [load]);

  const signIn = async (p: string) => {
    pass.current = p.trim();
    sessionStorage.setItem(PASS_KEY, pass.current);
    await load();
  };

  // shown at once, stored in the background; a failure is reported and the stored state reloaded
  const commit = async (put: Put[], del: Del[] = []) => {
    setDocs((d) => {
      const n = { ...d } as JournalDocs;
      for (const p of put) (n[p.coll] as Record<string, unknown>) = { ...(n[p.coll] as Record<string, unknown>), [p.id]: p.data };
      for (const x of del) {
        const c = { ...(n[x.coll] as Record<string, unknown>) };
        delete c[x.id];
        (n[x.coll] as Record<string, unknown>) = c;
      }
      return n;
    });
    setPending((n) => n + 1);
    try {
      const r = await fetch('/api/journal/batch', { method: 'POST', headers: headers(true), body: JSON.stringify({ put, del }) });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? String(r.status));
      setError(null);
    } catch (e) {
      setError(`Not saved: ${String((e as Error).message)}`);
      void load();
      throw e;
    } finally {
      setPending((n) => n - 1);
    }
  };

  const history = async (coll: Coll, id: string) => {
    const r = await fetch(`/api/journal/history/${coll}/${encodeURIComponent(id)}`, { headers: headers() });
    return r.ok ? ((await r.json()) as { at: number; data: unknown }[]) : [];
  };

  const upload = async (f: File) => {
    if (f.size > 8 * 1024 * 1024) throw new Error(`${f.name} is larger than 8 MB`);
    const data = await new Promise<string>((res, rej) => {
      const rd = new FileReader();
      rd.onload = () => res(String(rd.result));
      rd.onerror = () => rej(rd.error);
      rd.readAsDataURL(f);
    });
    const r = await fetch('/api/journal/files', { method: 'POST', headers: headers(true), body: JSON.stringify({ name: f.name, type: f.type || 'application/octet-stream', data }) });
    if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? String(r.status));
    const meta = (await r.json()) as FileMeta;
    setDocs((d) => ({ ...d, files: { ...d.files, [meta.id]: meta } }));
    return meta;
  };
  const removeFile = async (id: string) => {
    await fetch(`/api/journal/files/${encodeURIComponent(id)}`, { method: 'DELETE', headers: headers() });
    setDocs((d) => {
      const files = { ...d.files };
      delete files[id];
      return { ...d, files };
    });
  };
  // files are fetched with the password (an <img> cannot send it): see FileLink
  const fileUrl = (id: string) => `/api/journal/files/${encodeURIComponent(id)}`;

  return { docs, state, error, saving: pending > 0, signIn, commit, history, upload, removeFile, fileUrl };
}

// a file's content as a blob URL (sent with the password)
export async function fileBlobUrl(id: string): Promise<string> {
  const p = sessionStorage.getItem(PASS_KEY) ?? '';
  const r = await fetch(`/api/journal/files/${encodeURIComponent(id)}`, { headers: p ? { Authorization: `Bearer ${p}` } : {} });
  if (!r.ok) throw new Error(String(r.status));
  return URL.createObjectURL(await r.blob());
}
