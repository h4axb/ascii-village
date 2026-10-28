// Loading and saving /feedback's data: the study documents (/api/study) and
// the game's records, with the dashboard password (the same one, and the same
// browser memory of it, as /2/feedback). Changes show at once and are saved
// in the background; a failed save says so.
import { useCallback, useEffect, useRef, useState } from 'react';
import { optionColumns, partOf } from './tally';
import { DEFAULT_TAGS, type Coll, type GameData, type StudyDocs, type TagGroup } from './types';

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
export interface GameStand {
  id: string;
  at: number;
  reason: string;
  data: GameData;
}
export type GameIds = Partial<Record<keyof GameData, string[]>>;
export interface Version {
  id: string;
  at: number;
  reason: string;
  size: number;
}
// a saved state opened by link (/feedback?stand=<id>): shown, never changed
const VIEW_ID = new URLSearchParams(window.location.search).get('stand');

export function useStudy() {
  const [pass, setPass] = useState(() => sessionStorage.getItem(PASS_KEY) ?? '');
  const [state, setState] = useState<'loading' | 'locked' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [docs, setDocs] = useState<StudyDocs>(empty);
  const [game, setGame] = useState<GameData>({ invites: [], events: [], feedback: [] });
  const [saving, setSaving] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Version | null>(null);
  // the game data the dashboard works with: an accepted stand; the live data
  // beside it only to show what is new or changed (taken over on "accept")
  const [live, setLive] = useState<GameData | null>(null);
  const [stand, setStand] = useState<GameStand | null>(null);
  const docsRef = useRef(docs);
  const passRef = useRef(pass);
  passRef.current = pass;

  const auth = (p = passRef.current) => ({ Authorization: `Bearer ${p}` });

  const load = useCallback(async (p: string, quiet = false) => {
    setState('loading');
    setError(null);
    try {
      const res = await fetch(VIEW_ID ? `/api/study/versions/${encodeURIComponent(VIEW_ID)}` : '/api/study', { headers: auth(p) });
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
      const { _game: gameId, ...saved } = body as StudyDocs & { _game?: string | null };
      const d = { ...empty(), ...(saved as StudyDocs) };
      if (VIEW_ID) {
        // (a saved state: shown as it was, with the game data accepted then; no migrations, nothing stored)
        const list = (await fetch('/api/study/versions', { headers: auth(p) }).then((r) => (r.ok ? r.json() : [])).catch(() => [])) as Version[];
        setViewing(list.find((v) => v.id === VIEW_ID) ?? { id: VIEW_ID, at: 0, reason: '', size: 0 });
        const g = gameId ? ((await fetch(`/api/study/game/${encodeURIComponent(gameId)}`, { headers: auth(p) }).then((r) => (r.ok ? r.json() : null)).catch(() => null)) as { stand?: GameStand | null } | null) : null;
        docsRef.current = d;
        setDocs(d);
        setStand(g?.stand ?? null);
        setGame(g?.stand?.data ?? { feedback: [], events: [], invites: [] });
        setState('ready');
        return;
      }
      const gres = (await fetch('/api/study/game', { headers: auth(p) }).then((r) => (r.ok ? r.json() : null)).catch(() => null)) as { stand: GameStand | null; live: GameData } | null;
      const liveData = gres?.live ?? { feedback: [], events: [], invites: [] };
      let gameStand = gres?.stand ?? null;
      // the very first visit: the live data becomes the first stand (nothing is replaced)
      if (gres && !gameStand) {
        const r = await fetch('/api/study/game', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...auth(p) },
          body: JSON.stringify({ reason: 'erster Stand der Spieldaten', accept: { invites: liveData.invites.map((i) => i.key), events: liveData.events.map((e) => e.id), feedback: liveData.feedback.map((f) => f.id) } }),
        });
        gameStand = ((await r.json().catch(() => null)) as { stand?: GameStand } | null)?.stand ?? null;
      }
      // the first visit stores the default tag sets
      if (!Object.keys(d.tags).length) {
        d.tags = Object.fromEntries(DEFAULT_TAGS.map((g) => [g.id, g]));
        d.settings = { ...d.settings, tagsAdded: { ids: DEFAULT_TAGS.map((g) => g.id) } };
        void fetch('/api/study/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...auth(p) },
          body: JSON.stringify({ put: [...DEFAULT_TAGS.map((g) => ({ coll: 'tags', id: g.id, data: g })), { coll: 'settings', id: 'tagsAdded', data: d.settings.tagsAdded }] }),
        });
      }
      docsRef.current = d;
      // tag sets added after the first visit, once each (deleting one keeps it deleted)
      const added = ((d.settings.tagsAdded as { ids?: string[] } | undefined)?.ids ?? []);
      const later: Record<string, (t: TagGroup[]) => boolean> = {
        moderation: (t) => t.some((g) => g.chips.some((c) => c.role === 'intervention')),
        code: (t) => t.some((g) => g.id === 'code'),
      };
      const missing = DEFAULT_TAGS.filter((g) => later[g.id] && !added.includes(g.id) && !later[g.id](Object.values(d.tags)));
      if (missing.length) {
        d.tags = { ...d.tags, ...Object.fromEntries(missing.map((g) => [g.id, { ...g, order: Object.keys(d.tags).length }])) };
        d.settings = { ...d.settings, tagsAdded: { ids: [...added, ...missing.map((g) => g.id)] } };
        void fetch('/api/study/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...auth(p) },
          body: JSON.stringify({ put: [...missing.map((g) => ({ coll: 'tags', id: g.id, data: d.tags[g.id] })), { coll: 'settings', id: 'tagsAdded', data: d.settings.tagsAdded }] }),
        });
      }
      // (once: choice questions in Teil 2/3 were counted as A/B comparisons; now single choice)
      const t = d.tally.main;
      if (t?.parts && !d.settings.choiceMigrated) {
        const mapping = t.mapping.map((m, j) => (m.role === 'p1' && partOf(j, t.parts!) >= 2 ? { role: 'choice' as const, question: m.question } : m));
        d.settings = { ...d.settings, choiceMigrated: { at: Date.now() } };
        const changed = mapping.some((m, j) => m !== t.mapping[j]);
        if (changed) d.tally = { ...d.tally, main: { ...t, mapping } };
        void fetch('/api/study/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...auth(p) },
          body: JSON.stringify({ put: [...(changed ? [{ coll: 'tally', id: 'main', data: d.tally.main }] : []), { coll: 'settings', id: 'choiceMigrated', data: d.settings.choiceMigrated }] }),
        });
      }
      // (once: questions exported as one column per option were single fields "true/false")
      const tm = d.tally.main;
      if (tm && !d.settings.optionsMigrated) {
        const opts = optionColumns(tm.headers, tm.rows);
        const mapping = tm.mapping.map((m, j) => {
          const op = opts.get(j);
          return op && (m.role === 'info' || m.role === 'p1' || m.role === 'text' || m.role === 'choice' || m.role === 'ignore') ? { role: 'option' as const, question: op.question, option: op.option } : m;
        });
        const changed = mapping.some((m, j) => m !== tm.mapping[j]);
        if (changed) d.tally = { ...d.tally, main: { ...tm, mapping } };
        d.settings = { ...d.settings, optionsMigrated: { at: Date.now() } };
        void fetch('/api/study/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...auth(p) },
          body: JSON.stringify({ put: [...(changed ? [{ coll: 'tally', id: 'main', data: d.tally.main }] : []), { coll: 'settings', id: 'optionsMigrated', data: d.settings.optionsMigrated }] }),
        });
      }
      setDocs(d);
      setLive(liveData);
      setStand(gameStand);
      setGame(gameStand?.data ?? liveData);
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
    if (VIEW_ID) {
      setSaveError('Ein gespeicherter Stand wird nur angesehen: Änderungen werden nicht gespeichert.');
      return;
    }
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

  // AI: similar statements of several participants as proposed findings
  const cluster = useCallback(async (body: unknown) => {
    const res = await fetch('/api/study/cluster', { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() }, body: JSON.stringify(body) });
    const d = (await res.json().catch(() => null)) as { groups?: { name: string; description: string; ids: string[]; finding: string | null }[]; error?: string } | null;
    if (!res.ok) throw new Error(d?.error ?? String(res.status));
    return d?.groups ?? [];
  }, []);

  // which AI answers the dashboard's AI functions (name only)
  const aiInfo = useCallback(async () => {
    const res = await fetch('/api/study/ai', { headers: auth() }).catch(() => null);
    const d = res?.ok ? ((await res.json().catch(() => null)) as { name?: string; claude?: boolean } | null) : null;
    return { name: d?.name ?? 'unbekannt', claude: !!d?.claude };
  }, []);

  // AI: statements reworded by the criteria set (proposals)
  const rewrite = useCallback(async (body: { items: { id: string; text: string; question?: string; hint?: string; previous?: string }[]; criteria: string }) => {
    const res = await fetch('/api/study/rewrite', { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() }, body: JSON.stringify(body) });
    const d = (await res.json().catch(() => null)) as { rewrites?: { id: string; text: string }[]; error?: string } | null;
    if (!res.ok) throw new Error(d?.error ?? String(res.status));
    return d?.rewrites ?? [];
  }, []);

  // AI translations (drafts), in batches; throws when the AI is unavailable
  const translate = useCallback(async (texts: { id: string; text: string }[], to: 'de' | 'en' = 'de', onProgress?: (done: number, all: number) => void) => {
    const out = new Map<string, string>();
    for (let i = 0; i < texts.length; i += 40) {
      const batch = texts.slice(i, i + 40);
      const res = await fetch('/api/study/translate', { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() }, body: JSON.stringify({ texts: batch, to }) });
      const d = (await res.json().catch(() => null)) as { translations?: { id: string; text: string }[]; error?: string } | null;
      if (!res.ok) throw new Error(d?.error ?? String(res.status));
      for (const t of d?.translations ?? []) out.set(t.id, t.text);
      onProgress?.(Math.min(texts.length, i + 40), texts.length);
    }
    return out;
  }, []);

  // saved states of all documents (before every import and restore, or by hand)
  const versions = useCallback(async (): Promise<Version[]> => {
    const res = await fetch('/api/study/versions', { headers: auth() });
    if (!res.ok) throw new Error(String(res.status));
    return (await res.json()) as Version[];
  }, []);
  const saveVersion = useCallback(async (reason: string): Promise<string> => {
    const res = await fetch('/api/study/versions', { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() }, body: JSON.stringify({ reason }) });
    const d = (await res.json().catch(() => null)) as { id?: string; error?: string } | null;
    if (!res.ok || !d?.id) throw new Error(d?.error ?? String(res.status));
    return d.id;
  }, []);
  const loadVersion = useCallback(async (id: string): Promise<StudyDocs> => {
    const res = await fetch(`/api/study/versions/${encodeURIComponent(id)}`, { headers: auth() });
    if (!res.ok) throw new Error(String(res.status));
    return { ...empty(), ...((await res.json()) as StudyDocs) };
  }, []);

  // take over chosen records of the live game data (ids per kind); the rest stays as accepted
  const acceptGame = useCallback(async (accept: GameIds, drop: GameIds, reason: string) => {
    if (VIEW_ID) throw new Error('nur ansehen');
    const res = await fetch('/api/study/game', { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() }, body: JSON.stringify({ accept, drop, reason }) });
    const d = (await res.json().catch(() => null)) as { stand?: GameStand; error?: string } | null;
    if (!res.ok || !d?.stand) throw new Error(d?.error ?? String(res.status));
    setStand(d.stand);
    setGame(d.stand.data);
  }, []);
  // (a fresh look at the live game data, for the check of what is new)
  const refreshLive = useCallback(async () => {
    const g = (await fetch('/api/study/game', { headers: auth() }).then((r) => (r.ok ? r.json() : null)).catch(() => null)) as { live?: GameData } | null;
    if (g?.live) setLive(g.live);
    return g?.live ?? null;
  }, []);

  // (the newest documents, for changes that build on the one just made)
  const latest = useCallback(() => docsRef.current, []);
  return { state, error, docs, game, live, stand, acceptGame, refreshLive, saving, saveError, load, commit, suggest, cluster, rewrite, aiInfo, translate, pass, latest, viewing, versions, saveVersion, loadVersion };
}
export type Study = ReturnType<typeof useStudy>;
