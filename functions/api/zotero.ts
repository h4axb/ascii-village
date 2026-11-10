// The journal's sources from Zotero (/journal, src/journal/zotero.tsx). The
// Zotero library stays the one place where sources are kept: the journal
// stores a short copy of each item (title, authors, year, APA line …) to show
// and search, and an entry's source keeps only the item's key. A sync
// replaces those copies, so every entry shows the current data.
//
//   POST /api/journal/zotero/sync           {full?} → {added, changed, removed, count, items, state}
//   POST /api/journal/zotero/preview        {input: DOI | ISBN | URL} → {item, existing?}
//   POST /api/journal/zotero/items          {item, collection?} → {item, existing?}  (new in Zotero)
//
// The API key is a Worker secret (ZOTERO_API_KEY): it is sent to
// api.zotero.org only and never appears in a response. Library:
// ZOTERO_LIBRARY_TYPE (user | group) and ZOTERO_LIBRARY_ID. Dev only:
// ZOTERO_FAKE=1 answers from a small made-up library (vite.config.ts).
//
// The copies are kept in the journal table (coll "zotero") in 16 buckets by
// key, so a sync writes at most 16 rows, whatever the library's size.
import { json, type D1Database } from './session';

export interface ZoteroEnv {
  ZOTERO_API_KEY?: string;
  ZOTERO_LIBRARY_TYPE?: string;
  ZOTERO_LIBRARY_ID?: string;
  ZOTERO_FAKE?: string;
}

// what the journal keeps of an item
export interface ZItem {
  key: string;
  version: number;
  itemType: string;
  title: string;
  creators: string[]; // last names (or the one name)
  year: string;
  date: string;
  doi: string;
  isbn: string;
  url: string;
  publication: string;
  bib: string; // the APA reference, as plain text
  tags: string[];
  collections: string[];
  modified: string;
}
export interface ZState {
  version: number;
  at: number;
  count: number;
  write?: boolean;
  library?: string;
  collections?: { key: string; name: string; parent: string | null }[];
  error?: string;
}

const API = 'https://api.zotero.org';
const BUCKETS = 16;
const bucketOf = (key: string) => `zb-${[...key].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7) % BUCKETS}`;

// ---------- reading Zotero's JSON ----------

interface ZData {
  key?: string;
  version?: number;
  itemType: string;
  title?: string;
  creators?: { creatorType?: string; firstName?: string; lastName?: string; name?: string }[];
  date?: string;
  DOI?: string;
  ISBN?: string;
  url?: string;
  publicationTitle?: string;
  proceedingsTitle?: string;
  bookTitle?: string;
  websiteTitle?: string;
  blogTitle?: string;
  publisher?: string;
  university?: string;
  institution?: string;
  extra?: string;
  tags?: { tag: string }[];
  collections?: string[];
  dateModified?: string;
  [k: string]: unknown;
}
interface ZApiItem {
  key: string;
  version: number;
  data: ZData;
  bib?: string;
}

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();

export const normDoi = (s: string) => (s.match(/10\.\d{4,9}\/[^\s"<>?#]+/i)?.[0] ?? '').replace(/[.,;)\]]+$/, '').toLowerCase();
export const normUrl = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, '')
    .replace(/[#?].*$/, '')
    .replace(/\/+$/, '');

function reduce(a: ZApiItem): ZItem {
  const d = a.data;
  const doi = d.DOI || (d.extra ?? '').match(/^DOI:\s*(\S+)/im)?.[1] || '';
  return {
    key: a.key,
    version: a.version,
    itemType: d.itemType,
    title: d.title ?? '',
    creators: (d.creators ?? []).map((c) => (c.lastName || c.name || c.firstName || '').trim()).filter(Boolean),
    year: (d.date ?? '').match(/\d{4}/)?.[0] ?? '',
    date: d.date ?? '',
    doi: normDoi(doi),
    isbn: (d.ISBN ?? '').split(/\s+/)[0] ?? '',
    url: d.url ?? '',
    publication: d.publicationTitle || d.proceedingsTitle || d.bookTitle || d.websiteTitle || d.blogTitle || d.publisher || d.university || d.institution || '',
    bib: a.bib ? decode(a.bib) : '',
    tags: (d.tags ?? []).map((t) => t.tag),
    collections: d.collections ?? [],
    modified: d.dateModified ?? '',
  };
}

// ---------- the library: Zotero's web API, or the made-up one in dev ----------

interface Lib {
  write: boolean | null;
  get(path: string): Promise<Response>;
  post(path: string, body: unknown, headers?: Record<string, string>): Promise<Response>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function zoteroLib(env: ZoteroEnv): Lib | string {
  const key = env.ZOTERO_API_KEY?.trim();
  const id = env.ZOTERO_LIBRARY_ID?.trim();
  if (!key || !id) return 'Zotero is not set up on the server (ZOTERO_API_KEY, ZOTERO_LIBRARY_ID)';
  const base = `${API}/${env.ZOTERO_LIBRARY_TYPE === 'group' ? 'groups' : 'users'}/${encodeURIComponent(id)}`;
  const call = async (path: string, init: RequestInit): Promise<Response> => {
    const go = () => fetch(path.startsWith('/keys') ? `${API}${path}` : `${base}${path}`, { ...init, headers: { 'Zotero-API-Key': key, 'Zotero-API-Version': '3', ...(init.headers as Record<string, string>) } });
    let r = await go();
    // asked to wait: once, for up to 10 s
    if (r.status === 429 || r.status === 503) {
      const wait = Number(r.headers.get('Retry-After') ?? 2);
      if (wait <= 10) {
        await sleep(wait * 1000);
        r = await go();
      }
    }
    const backoff = Number(r.headers.get('Backoff') ?? 0);
    if (backoff > 0 && backoff <= 10) await sleep(backoff * 1000);
    return r;
  };
  return {
    write: null,
    get: (path) => call(path, { method: 'GET' }),
    post: (path, body, headers = {}) => call(path, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...headers } }),
  };
}

// dev: a small library in memory (ZOTERO_FAKE=1), with the same answers as Zotero's
interface Fake {
  version: number;
  items: Map<string, ZApiItem & { deletedAt?: number }>;
}
const g = globalThis as unknown as { __zfake?: Fake };
function fakeBib(d: ZData) {
  const names = (d.creators ?? []).map((c) => `${c.lastName ?? c.name ?? ''}${c.firstName ? `, ${c.firstName[0]}.` : ''}`).join(', ');
  const year = (d.date ?? '').match(/\d{4}/)?.[0] ?? 'n.d.';
  const pub = d.publicationTitle || d.proceedingsTitle || d.publisher || d.websiteTitle || '';
  return `<div class="csl-bib-body"><div class="csl-entry">${names} (${year}). <i>${d.title ?? ''}</i>.${pub ? ` ${pub}.` : ''}${d.DOI ? ` https://doi.org/${d.DOI}` : d.url ? ` ${d.url}` : ''}</div></div>`;
}
function fakeLib(): Lib {
  if (!g.__zfake) {
    const seed: ZData[] = [
      { itemType: 'book', title: 'The Design of Everyday Things', creators: [{ creatorType: 'author', firstName: 'Don', lastName: 'Norman' }], date: '2013', publisher: 'Basic Books', ISBN: '9780465050659', tags: [{ tag: 'usability' }] },
      { itemType: 'conferencePaper', title: 'Guidelines for Human-AI Interaction', creators: [{ creatorType: 'author', firstName: 'Saleema', lastName: 'Amershi' }, { creatorType: 'author', firstName: 'Dan', lastName: 'Weld' }], date: '2019', proceedingsTitle: 'Proceedings of the 2019 CHI Conference on Human Factors in Computing Systems', DOI: '10.1145/3290605.3300233', url: 'https://dl.acm.org/doi/10.1145/3290605.3300233', tags: [{ tag: 'human-ai' }, { tag: 'control' }] },
      { itemType: 'journalArticle', title: 'Human-Centered Artificial Intelligence: Reliable, Safe & Trustworthy', creators: [{ creatorType: 'author', firstName: 'Ben', lastName: 'Shneiderman' }], date: '2020', publicationTitle: 'International Journal of Human–Computer Interaction', DOI: '10.1080/10447318.2020.1741118', tags: [{ tag: 'control' }] },
      { itemType: 'webpage', title: '10 Usability Heuristics for User Interface Design', creators: [{ creatorType: 'author', firstName: 'Jakob', lastName: 'Nielsen' }], date: '1994', websiteTitle: 'Nielsen Norman Group', url: 'https://www.nngroup.com/articles/ten-usability-heuristics/', tags: [{ tag: 'heuristics' }] },
    ];
    const items = new Map<string, ZApiItem>();
    seed.forEach((d, i) => {
      const key = `FAKE000${i + 1}`;
      items.set(key, { key, version: 1, data: { ...d, key, version: 1, collections: i % 2 ? ['FCOLL001'] : [], dateModified: '2026-11-01T10:00:00Z' }, bib: fakeBib(d) });
    });
    g.__zfake = { version: 1, items };
  }
  const f = g.__zfake;
  const ok = (body: unknown, version = f.version) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json', 'Last-Modified-Version': String(version) } });
  return {
    write: true,
    get: async (path) => {
      const u = new URL(`https://x${path}`);
      const since = Number(u.searchParams.get('since') ?? 0);
      if (u.pathname === '/collections') return ok([{ key: 'FCOLL001', data: { key: 'FCOLL001', name: 'Bachelorarbeit', parentCollection: false } }]);
      if (u.pathname === '/deleted') return ok({ items: [...f.items.values()].filter((i) => i.deletedAt && i.deletedAt > since).map((i) => i.key) });
      if (u.pathname.startsWith('/items/') && u.pathname !== '/items/top') {
        const it = f.items.get(u.pathname.split('/')[2]);
        return it && !it.deletedAt ? ok(it) : new Response('Not found', { status: 404 });
      }
      const start = Number(u.searchParams.get('start') ?? 0);
      const limit = Number(u.searchParams.get('limit') ?? 100);
      const all = [...f.items.values()].filter((i) => !i.deletedAt && i.version > since);
      return new Response(JSON.stringify(all.slice(start, start + limit)), { status: 200, headers: { 'Content-Type': 'application/json', 'Last-Modified-Version': String(f.version), 'Total-Results': String(all.length) } });
    },
    post: async (path, body) => {
      // dev only: change or delete an item, as if done in Zotero
      if (path === '/_fake') {
        const b = body as { op: 'edit' | 'delete'; key: string; title?: string };
        const it = f.items.get(b.key);
        if (!it) return new Response('Not found', { status: 404 });
        f.version++;
        if (b.op === 'delete') it.deletedAt = f.version;
        else {
          it.data = { ...it.data, title: b.title ?? it.data.title, dateModified: new Date().toISOString() };
          it.bib = fakeBib(it.data);
        }
        it.version = f.version;
        return ok({ ok: true });
      }
      const list = body as ZData[];
      const successful: Record<string, ZApiItem> = {};
      list.forEach((d, i) => {
        f.version++;
        const key = `FAKE${String(f.items.size + 1).padStart(4, '0')}`;
        const it = { key, version: f.version, data: { ...d, key, version: f.version, dateModified: new Date().toISOString() }, bib: fakeBib(d) };
        f.items.set(key, it);
        successful[i] = it;
      });
      return ok({ successful, success: {}, unchanged: {}, failed: {} });
    },
  };
}

const libOf = (env: ZoteroEnv): Lib | string => (env.ZOTERO_FAKE === '1' ? fakeLib() : zoteroLib(env));

async function zError(r: Response): Promise<string> {
  const text = (await r.text().catch(() => '')).slice(0, 200);
  if (r.status === 403) return 'Zotero refused the request (403): check the API key and its access to this library';
  if (r.status === 404) return 'Zotero library not found (404): check ZOTERO_LIBRARY_TYPE and ZOTERO_LIBRARY_ID';
  return `Zotero answered ${r.status}${text ? `: ${text}` : ''}`;
}

// ---------- the stored copies ----------

async function readItems(db: D1Database): Promise<Map<string, ZItem>> {
  const { results } = await db.prepare("SELECT data FROM journal WHERE coll = 'zotero'").all<{ data: string }>();
  const out = new Map<string, ZItem>();
  for (const r of results) for (const it of Object.values((JSON.parse(r.data) as { items?: Record<string, ZItem> }).items ?? {})) out.set(it.key, it);
  return out;
}
async function writeBuckets(db: D1Database, items: Map<string, ZItem>, touched: Set<string>, at: number) {
  const by = new Map<string, Record<string, ZItem>>();
  for (const b of touched) by.set(b, {});
  for (const it of items.values()) {
    const b = bucketOf(it.key);
    if (touched.has(b)) by.get(b)![it.key] = it;
  }
  for (const [id, its] of by) {
    if (!Object.keys(its).length) await db.prepare("DELETE FROM journal WHERE coll = 'zotero' AND id = ?").bind(id).run();
    else
      await db
        .prepare("INSERT INTO journal (coll, id, data, updated) VALUES ('zotero', ?, ?, ?) ON CONFLICT (coll, id) DO UPDATE SET data = excluded.data, updated = excluded.updated")
        .bind(id, JSON.stringify({ items: its }), at)
        .run();
  }
}
async function readState(db: D1Database): Promise<ZState | null> {
  const { results } = await db.prepare("SELECT data FROM journal WHERE coll = 'settings' AND id = 'zoteroSync'").all<{ data: string }>();
  return results.length ? (JSON.parse(results[0].data) as ZState) : null;
}
async function writeState(db: D1Database, s: ZState, at: number) {
  await db.prepare("INSERT INTO journal (coll, id, data, updated) VALUES ('settings', 'zoteroSync', ?, ?) ON CONFLICT (coll, id) DO UPDATE SET data = excluded.data, updated = excluded.updated").bind(JSON.stringify(s), at).run();
}

// ---------- sync ----------

async function sync(db: D1Database, env: ZoteroEnv, full: boolean, now: number): Promise<Response> {
  const lib = libOf(env);
  const prev = await readState(db);
  const fail = async (error: string, status = 502) => {
    await writeState(db, { ...(prev ?? { version: 0, count: 0 }), at: now, error }, now);
    return json(status, { error });
  };
  if (typeof lib === 'string') return fail(lib, 503);
  const since = full ? 0 : prev?.version ?? 0;
  const stored = await readItems(db);
  const items = new Map(stored);
  const touched = new Set<string>();
  let added = 0,
    changed = 0,
    removed = 0,
    version = since;

  // what the key may do (read / write), and the library's collections
  let write = lib.write;
  if (write === null) {
    const r = await lib.get('/keys/current');
    if (r.ok) {
      const k = (await r.json()) as { userID?: number; access?: { user?: { library?: boolean; write?: boolean }; groups?: Record<string, { library?: boolean; write?: boolean }> } };
      write = env.ZOTERO_LIBRARY_TYPE === 'group' ? !!(k.access?.groups?.[env.ZOTERO_LIBRARY_ID ?? '']?.write ?? k.access?.groups?.all?.write) : !!k.access?.user?.write;
    } else if (r.status === 403) return fail(await zError(r));
  }
  let collections = prev?.collections ?? [];
  const rc = await lib.get('/collections?limit=100&format=json');
  if (rc.ok) collections = ((await rc.json()) as { key: string; data: { name: string; parentCollection: string | false } }[]).map((c) => ({ key: c.key, name: c.data.name, parent: c.data.parentCollection || null }));

  // every top item changed since the last sync (all of them on a full sync), 100 at a time
  const seen = new Set<string>();
  for (let start = 0; ; start += 100) {
    const r = await lib.get(`/items/top?format=json&include=data,bib&style=apa&limit=100&start=${start}&since=${since}`);
    if (!r.ok) return fail(await zError(r));
    version = Number(r.headers.get('Last-Modified-Version') ?? version);
    const page = (await r.json()) as ZApiItem[];
    for (const a of page) {
      if (a.data.itemType === 'note' || a.data.itemType === 'attachment' || a.data.itemType === 'annotation') continue;
      const it = reduce(a);
      seen.add(it.key);
      const old = items.get(it.key);
      if (!old) added++;
      else if (old.version !== it.version || JSON.stringify(old) !== JSON.stringify(it)) changed++;
      else continue;
      items.set(it.key, it);
      touched.add(bucketOf(it.key));
    }
    const total = Number(r.headers.get('Total-Results') ?? 0);
    if (page.length < 100 || start + 100 >= total) break;
  }
  // removed in Zotero (a full sync: everything it no longer lists)
  const gone: string[] = [];
  if (full) for (const k of items.keys()) if (!seen.has(k)) gone.push(k);
  if (!full && since > 0) {
    const r = await lib.get(`/deleted?since=${since}`);
    if (r.ok) gone.push(...((await r.json()) as { items?: string[] }).items ?? []);
  }
  for (const k of gone)
    if (items.delete(k)) {
      removed++;
      touched.add(bucketOf(k));
    }

  await writeBuckets(db, items, touched, now);
  const state: ZState = { version, at: now, count: items.size, write: write ?? undefined, library: `${env.ZOTERO_LIBRARY_TYPE === 'group' ? 'groups' : 'users'}/${env.ZOTERO_LIBRARY_ID ?? 'dev'}`, collections };
  await writeState(db, state, now);
  return json(200, { added, changed, removed, count: items.size, items: Object.fromEntries(items), state });
}

// ---------- a new source: metadata from a DOI, ISBN or web address ----------

// the fields each item type takes (Zotero refuses others)
const FIELDS: Record<string, string[]> = {
  journalArticle: ['title', 'creators', 'date', 'publicationTitle', 'volume', 'issue', 'pages', 'DOI', 'ISSN', 'url', 'abstractNote', 'accessDate', 'extra'],
  conferencePaper: ['title', 'creators', 'date', 'proceedingsTitle', 'conferenceName', 'publisher', 'place', 'pages', 'DOI', 'ISBN', 'url', 'abstractNote', 'accessDate', 'extra'],
  book: ['title', 'creators', 'date', 'publisher', 'place', 'edition', 'numPages', 'ISBN', 'url', 'abstractNote', 'accessDate', 'extra'],
  bookSection: ['title', 'creators', 'date', 'bookTitle', 'publisher', 'place', 'pages', 'ISBN', 'url', 'abstractNote', 'accessDate', 'extra'],
  report: ['title', 'creators', 'date', 'institution', 'reportNumber', 'pages', 'url', 'abstractNote', 'accessDate', 'extra'],
  thesis: ['title', 'creators', 'date', 'university', 'thesisType', 'place', 'url', 'abstractNote', 'accessDate', 'extra'],
  webpage: ['title', 'creators', 'date', 'websiteTitle', 'url', 'abstractNote', 'accessDate', 'extra'],
};
export const ITEM_TYPES = Object.keys(FIELDS);
function clean(d: ZData): ZData {
  const type = FIELDS[d.itemType] ? d.itemType : 'webpage';
  const out: ZData = { itemType: type };
  for (const f of FIELDS[type]) {
    const v = d[f];
    if (f === 'creators') {
      const cs = (Array.isArray(v) ? (v as ZData['creators'])! : []).filter((c) => (c.lastName || c.name || '').trim());
      out.creators = cs.map((c) => (c.name && !c.lastName ? { creatorType: 'author', name: c.name.trim() } : { creatorType: c.creatorType || 'author', firstName: (c.firstName ?? '').trim(), lastName: (c.lastName ?? '').trim() }));
    } else if (typeof v === 'string' && v.trim()) out[f] = v.trim().slice(0, 2000);
  }
  // a DOI the type has no field for goes into Extra, as Zotero does it
  const doi = typeof d.DOI === 'string' ? d.DOI.trim() : '';
  if (doi && !FIELDS[type].includes('DOI')) out.extra = [`DOI: ${doi}`, out.extra].filter(Boolean).join('\n');
  return out;
}

const splitName = (n: string) => {
  const s = n.trim();
  if (s.includes(',')) {
    const [last, first] = s.split(',', 2);
    return { creatorType: 'author', lastName: last.trim(), firstName: first.trim() };
  }
  const p = s.split(/\s+/);
  return p.length > 1 ? { creatorType: 'author', lastName: p.pop()!, firstName: p.join(' ') } : { creatorType: 'author', name: s };
};
const today = () => new Date().toISOString().slice(0, 10);
const timed = (url: string, init: RequestInit = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(9000), headers: { 'User-Agent': 'asciia-journal/1.0 (source lookup)', ...(init.headers as Record<string, string>) } });

const CSL_TYPE: Record<string, string> = { 'article-journal': 'journalArticle', article: 'journalArticle', 'paper-conference': 'conferencePaper', book: 'book', chapter: 'bookSection', report: 'report', thesis: 'thesis', webpage: 'webpage', 'post-weblog': 'webpage' };
async function fromDoi(doi: string): Promise<ZData> {
  const r = await timed(`https://doi.org/${encodeURI(doi)}`, { headers: { Accept: 'application/vnd.citationstyles.csl+json' } });
  if (!r.ok) throw new Error(r.status === 404 ? `DOI ${doi} was not found` : `doi.org answered ${r.status}`);
  const c = (await r.json()) as {
    type?: string;
    title?: string | string[];
    author?: { family?: string; given?: string; literal?: string }[];
    editor?: { family?: string; given?: string; literal?: string }[];
    issued?: { 'date-parts'?: number[][] };
    'container-title'?: string | string[];
    'event-title'?: string;
    event?: string | { name?: string };
    volume?: string | number;
    issue?: string | number;
    page?: string;
    publisher?: string;
    'publisher-place'?: string;
    ISBN?: string | string[];
    ISSN?: string | string[];
    URL?: string;
    abstract?: string;
  };
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
  const type = CSL_TYPE[c.type ?? ''] ?? 'journalArticle';
  const container = one(c['container-title']);
  const people = (list: typeof c.author, creatorType: string) => (list ?? []).map((a) => (a.literal ? { creatorType, name: a.literal } : { creatorType, lastName: a.family ?? '', firstName: a.given ?? '' }));
  return {
    itemType: type,
    title: decode(one(c.title)),
    creators: [...people(c.author, 'author'), ...(type === 'bookSection' ? people(c.editor, 'editor') : [])],
    date: (c.issued?.['date-parts']?.[0] ?? []).map((n, i) => (i ? String(n).padStart(2, '0') : String(n))).join('-'),
    publicationTitle: container,
    proceedingsTitle: container,
    bookTitle: container,
    conferenceName: c['event-title'] ?? (typeof c.event === 'string' ? c.event : c.event?.name) ?? '',
    volume: c.volume != null ? String(c.volume) : '',
    issue: c.issue != null ? String(c.issue) : '',
    pages: c.page ?? '',
    publisher: c.publisher ?? '',
    institution: c.publisher ?? '',
    university: c.publisher ?? '',
    place: c['publisher-place'] ?? '',
    ISBN: one(c.ISBN),
    ISSN: one(c.ISSN),
    DOI: doi,
    url: `https://doi.org/${doi}`,
    abstractNote: c.abstract ? decode(c.abstract) : '',
  };
}
async function fromIsbn(isbn: string): Promise<ZData> {
  const r = await timed(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
  if (!r.ok) throw new Error(`openlibrary.org answered ${r.status}`);
  const b = ((await r.json()) as Record<string, { title?: string; subtitle?: string; authors?: { name: string }[]; publish_date?: string; publishers?: { name: string }[]; publish_places?: { name: string }[]; number_of_pages?: number; url?: string }>)[`ISBN:${isbn}`];
  if (!b) throw new Error(`ISBN ${isbn} was not found`);
  return {
    itemType: 'book',
    title: [b.title, b.subtitle].filter(Boolean).join(': '),
    creators: (b.authors ?? []).map((a) => splitName(a.name)),
    date: b.publish_date?.match(/\d{4}/)?.[0] ?? b.publish_date ?? '',
    publisher: b.publishers?.[0]?.name ?? '',
    place: b.publish_places?.[0]?.name ?? '',
    numPages: b.number_of_pages ? String(b.number_of_pages) : '',
    ISBN: isbn,
  };
}
async function fromUrl(url: string): Promise<ZData> {
  const r = await timed(url, { headers: { Accept: 'text/html,application/xhtml+xml' } });
  if (!r.ok) throw new Error(`the page answered ${r.status}`);
  const html = (await r.text()).slice(0, 400_000);
  const metas: [string, string][] = [];
  for (const m of html.matchAll(/<meta\s[^>]*>/gi)) {
    const tag = m[0];
    const name = tag.match(/(?:name|property)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    const content = tag.match(/content\s*=\s*["']([^"']*)["']/i)?.[1];
    if (name && content != null) metas.push([name, decode(content)]);
  }
  const meta = (...names: string[]) => names.map((n) => metas.find(([k]) => k === n)?.[1]).find((v) => v) ?? '';
  const doi = normDoi(meta('citation_doi', 'dc.identifier', 'prism.doi') || '');
  if (doi) return fromDoi(doi).then((d) => ({ ...d, url: url }));
  const authors = metas.filter(([k]) => k === 'citation_author' || k === 'author' || k === 'article:author' || k === 'dc.creator').map(([, v]) => v).filter((v) => v && !/^https?:/.test(v));
  const title = meta('citation_title', 'og:title', 'twitter:title', 'dc.title') || decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
  const date = meta('citation_publication_date', 'citation_date', 'article:published_time', 'dc.date', 'date').slice(0, 10).replace(/\//g, '-');
  const journal = meta('citation_journal_title', 'citation_conference_title');
  return {
    itemType: journal ? (meta('citation_conference_title') ? 'conferencePaper' : 'journalArticle') : 'webpage',
    title,
    creators: [...new Set(authors)].slice(0, 30).map(splitName),
    date,
    websiteTitle: meta('og:site_name') || new URL(url).hostname.replace(/^www\./, ''),
    publicationTitle: journal,
    proceedingsTitle: journal,
    url,
    accessDate: today(),
    abstractNote: meta('citation_abstract', 'description', 'og:description').slice(0, 1000),
  };
}

const ISBN_RE = /^(97[89])?\d{9}[\dX]$/i;
async function lookup(input: string, fake: boolean): Promise<ZData> {
  const s = input.trim();
  const doi = normDoi(s);
  const isbn = s.replace(/^isbn:?\s*/i, '').replace(/[\s-]/g, '');
  try {
    if (/^https?:\/\/\S+$/i.test(s)) return doi ? { ...(await fromDoi(doi)), ...(/doi\.org\//i.test(s) ? {} : { url: s }) } : await fromUrl(s);
    if (doi) return await fromDoi(doi);
    if (ISBN_RE.test(isbn)) return await fromIsbn(isbn.toUpperCase());
  } catch (e) {
    // dev without network: a made-up answer, so the form can be tried out
    if (!fake) throw e;
    return { itemType: doi ? 'journalArticle' : ISBN_RE.test(isbn) ? 'book' : 'webpage', title: `Example source for ${s}`, creators: [{ creatorType: 'author', firstName: 'Ada', lastName: 'Example' }], date: '2024', DOI: doi, ISBN: ISBN_RE.test(isbn) ? isbn : '', url: /^https?:/.test(s) ? s : doi ? `https://doi.org/${doi}` : '', websiteTitle: 'Example', publicationTitle: 'Journal of Examples', accessDate: today() };
  }
  throw new Error('Paste a DOI (10.…), an ISBN or a web address (https://…)');
}

// a source the library already has: the same DOI, ISBN or address
function existingOf(items: Map<string, ZItem>, d: ZData): ZItem | null {
  const doi = normDoi(String(d.DOI ?? '') || String(d.extra ?? ''));
  const isbn = String(d.ISBN ?? '').replace(/[\s-]/g, '').toUpperCase();
  const url = d.url ? normUrl(String(d.url)) : '';
  for (const it of items.values()) {
    if (doi && it.doi === doi) return it;
    if (isbn && it.isbn.replace(/[\s-]/g, '').toUpperCase() === isbn) return it;
    if (url && it.url && normUrl(it.url) === url) return it;
  }
  return null;
}

async function create(db: D1Database, env: ZoteroEnv, body: { item?: ZData; collection?: string }, now: number): Promise<Response> {
  const lib = libOf(env);
  if (typeof lib === 'string') return json(503, { error: lib });
  if (!body.item?.itemType) return json(400, { error: 'no item' });
  const d = clean(body.item);
  if (!d.title) return json(400, { error: 'A source needs a title' });
  const items = await readItems(db);
  const dup = existingOf(items, { ...body.item, ...d });
  if (dup) return json(200, { item: dup, existing: true });
  if (body.collection && /^[A-Z0-9]{8}$/.test(body.collection)) d.collections = [body.collection];
  if (!d.accessDate && d.url && FIELDS[d.itemType].includes('accessDate')) d.accessDate = today();
  const token = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const r = await lib.post('/items', [d], { 'Zotero-Write-Token': token });
  if (!r.ok) return json(r.status === 403 ? 403 : 502, { error: r.status === 403 ? 'The Zotero API key may only read: give it write access to add sources' : await zError(r) });
  const res = (await r.json()) as { successful?: Record<string, ZApiItem>; failed?: Record<string, { message?: string }> };
  const made = res.successful?.['0'];
  if (!made) return json(502, { error: `Zotero did not save the source: ${res.failed?.['0']?.message ?? 'unknown reason'}` });
  // the item again, with its APA line
  const full = await lib.get(`/items/${made.key}?format=json&include=data,bib&style=apa`);
  const it = reduce(full.ok ? ((await full.json()) as ZApiItem) : made);
  items.set(it.key, it);
  await writeBuckets(db, items, new Set([bucketOf(it.key)]), now);
  const st = await readState(db);
  if (st) await writeState(db, { ...st, count: items.size }, now);
  return json(200, { item: it });
}

export async function handleZotero(request: Request, env: ZoteroEnv, db: D1Database, parts: string[], now: number): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'method not allowed' });
  const body = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  try {
    if (parts[0] === 'sync') return await sync(db, env, body.full === true, now);
    if (parts[0] === 'preview') {
      const input = String(body.input ?? '');
      let found: ZData;
      try {
        found = await lookup(input, env.ZOTERO_FAKE === '1');
      } catch (e) {
        return json(422, { error: String((e as Error).message || e) });
      }
      const item = clean(found);
      const dup = existingOf(await readItems(db), { ...item, DOI: normDoi(input) || item.DOI });
      return json(200, { item, existing: dup ?? undefined });
    }
    if (parts[0] === 'items') return await create(db, env, body as { item?: ZData; collection?: string }, now);
    if (parts[0] === '_fake' && env.ZOTERO_FAKE === '1') return await fakeLib().post('/_fake', body);
  } catch (e) {
    return json(502, { error: String((e as Error).message || e) });
  }
  return json(404, { error: 'not found' });
}
