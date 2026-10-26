// Loading and saving /feedback's data: the study documents (/api/study) and
// the game's records, with the dashboard password (the same one, and the same
// browser memory of it, as /2/feedback). Changes show at once and are saved
// in the background; a failed save says so.
import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_TAGS, type Coll, type GameData, type StudyDocs } from './types';

const PASS_KEY = 'asciia-feedback-pass';
// (the same list as functions/api/study.ts STUDY_COLLS)
const STUDY_COLLS: Coll[] = ['tally', 'notes', 'items', 'findings', 'tags', 'people', 'captions', 'hypotheses', 'claims', 'settings'];
const empty = (): StudyDocs => Object.fromEntries(STUDY_COLLS.map((c) => [c, {}])) as unknown as StudyDocs;

export interface Put {
  coll: Coll;
  id: string;
  data: unknown;
}
export interface Del {
  coll: Coll;
  id: string;
}

export function useStudy() {
  const [pass, setPass] = useState(() => sessionStorage.getItem(PASS_KEY) ?? '');
  const [state, setState] = useState<'loading' | 'locked' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [docs, setDocs] = useState<StudyDocs>(empty);
  const [game, setGame] = useState<GameData>({ invites: [], events: [], feedback: [] });
  const [saving, setSaving] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const docsRef = useRef(docs);
  const passRef = useRef(pass);
  passRef.current = pass;

  const auth = (p = passRef.current) => ({ Authorization: `Bearer ${p}` });

  const load = useCallback(async (p: string, quiet = false) => {
    setState('loading');
    setError(null);
    try {
      const res = await fetch('/api/study', { headers: auth(p) });
      if (res.status === 401) {
        sessionStorage.removeItem(PASS_KEY);
        setPass('');
        setState('locked');
        if (!quiet) setError('Falsches Passwort.');
        return;
      }
      const body = (await res.json().catch(() => null)) as StudyDocs | { error?: string } | null;
      if (!res.ok || !body || 'error' in body) {
        setState('error');
        setError(`Laden fehlgeschlagen (${res.status}${body && 'error' in body ? `: ${body.error}` : ''}).`);
        return;
      }
      sessionStorage.setItem(PASS_KEY, p);
      setPass(p);
      const get = (path: string) =>
        fetch(path, { headers: auth(p) })
          .then((r) => (r.ok ? r.json() : []))
          .catch(() => []);
      const [feedback, events, invites] = await Promise.all([get('/api/feedback'), get('/api/events'), get('/api/admin/invites')]);
      const d = { ...empty(), ...(body as StudyDocs) };
      // the first visit stores the default tag sets
      if (!Object.keys(d.tags).length) {
        d.tags = Object.fromEntries(DEFAULT_TAGS.map((g) => [g.id, g]));
        void fetch('/api/study/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...auth(p) },
          body: JSON.stringify({ put: DEFAULT_TAGS.map((g) => ({ coll: 'tags', id: g.id, data: g })) }),
        });
      }
      docsRef.current = d;
      setDocs(d);
      setGame({ feedback: Array.isArray(feedback) ? feedback : [], events: Array.isArray(events) ? events : [], invites: Array.isArray(invites) ? invites : [] });
      setState('ready');
    } catch (e) {
      setState('error');
      setError(`Server nicht erreichbar: ${String(e)}`);
    }
  }, []);

  useEffect(() => {
    void load(pass, !pass);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // store and remove documents: shown at once, saved in the background
  const commit = useCallback((put: Put[], del: Del[] = []) => {
    const n = { ...docsRef.current } as unknown as Record<Coll, Record<string, unknown>>;
    for (const p of put) n[p.coll] = { ...n[p.coll], [p.id]: p.data };
    for (const x of del) {
      const { [x.id]: _gone, ...rest } = n[x.coll];
      n[x.coll] = rest;
    }
    docsRef.current = n as unknown as StudyDocs;
    setDocs(docsRef.current);
    setSaving((s) => s + 1);
    // (large batches in parts, to stay under the request size)
    const parts: { put: Put[]; del: Del[] }[] = [];
    let cur: { put: Put[]; del: Del[] } = { put: [], del };
    let size = 0;
    for (const p of put) {
      const s = JSON.stringify(p.data).length;
      if (size + s > 800_000 && cur.put.length) {
        parts.push(cur);
        cur = { put: [], del: [] };
        size = 0;
      }
      cur.put.push(p);
      size += s;
    }
    parts.push(cur);
    void (async () => {
      try {
        for (const b of parts) {
          const res = await fetch('/api/study/batch', { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() }, body: JSON.stringify(b) });
          if (!res.ok) throw new Error(String(res.status));
        }
        setSaveError(null);
      } catch (e) {
        setSaveError(`Nicht gespeichert (${String((e as Error).message ?? e)}). Bitte neu laden.`);
      } finally {
        setSaving((s) => s - 1);
      }
    })();
  }, []);

  const suggest = useCallback(async (body: unknown) => {
    const res = await fetch('/api/study/suggest', { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() }, body: JSON.stringify(body) });
    const d = (await res.json().catch(() => null)) as { suggestions?: unknown[]; error?: string } | null;
    if (!res.ok) throw new Error(d?.error ?? String(res.status));
    return d?.suggestions ?? [];
  }, []);

  // (the newest documents, for changes that build on the one just made)
  const latest = useCallback(() => docsRef.current, []);
  return { state, error, docs, game, saving, saveError, load, commit, suggest, pass, latest };
}
export type Study = ReturnType<typeof useStudy>;
