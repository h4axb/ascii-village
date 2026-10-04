// ---------------------------------------------------------------------------
// /2/feedback — the crafting-feedback dashboard (crafting panel 2). Reads
// every record from GET /api/feedback (functions/api/feedback.ts, or the dev
// store under `pnpm dev`) with the admin password, and shows:
//   tiles   ratings, like rate, players, tuned, adjusted
//   charts  votes per day · like rate per kind · "Not quite" reasons ·
//           how each preference question was answered · where answers were
//           remembered
//   table   every rating (the charts' table view), comments first; export
//           as CSV or JSON for a spreadsheet
// Loaded on demand from main.tsx, so the game never downloads it.
//
// Colours (validated with the dataviz skill's validator on this dark
// surface): blue = "I like it" / the "less" end of a preference, red = "Not
// quite" / the "more" end, gray = Keep. Text never wears a series colour.
// ---------------------------------------------------------------------------
import { RATING_QUESTIONS } from '../quest/quests';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { FitSprite } from '../ui';
import { FEEDBACK_REASONS, POSITIVE_REASONS, type FeedbackRecord } from './schema';
import { topTags } from '../../functions/api/feedback';
import { KIND_LABEL, PREF_INFO, PREF_KEYS, isKind } from '../craft/prefs';
import './dashboard.css';

const PASS_KEY = 'asciia-feedback-pass';
const DAY = 86400000;

type Range = '7' | '30' | 'all';

const kindName = (k: string) => (isKind(k) ? KIND_LABEL[k].one : 'Unknown');
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);

// ---- hover tooltip (one per page) ----
type Tip = { x: number; y: number; text: ReactNode } | null;
let showTip: (t: Tip) => void = () => {};
const hover = (text: ReactNode) => ({
  onMouseMove: (e: React.MouseEvent) => showTip({ x: e.clientX, y: e.clientY, text }),
  onMouseLeave: () => showTip(null),
});

export default function Dashboard() {
  const [pass, setPass] = useState(() => sessionStorage.getItem(PASS_KEY) ?? '');
  const [typed, setTyped] = useState('');
  const [rows, setRows] = useState<FeedbackRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [range, setRange] = useState<Range>('30');
  const [kind, setKind] = useState('all');
  const [link, setLink] = useState('all');
  const [tip, setTip] = useState<Tip>(null);
  showTip = setTip;

  async function load(p: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/feedback', { headers: { Authorization: `Bearer ${p}` } });
      const body = await res.json().catch(() => null);
      if (res.status === 401) {
        sessionStorage.removeItem(PASS_KEY);
        setPass('');
        setError('Wrong password.');
      } else if (res.status === 503) {
        setError(`Feedback storage isn't set up yet: ${body?.error ?? ''}. See docs/Deploy-Cloudflare.md → Crafting feedback.`);
      } else if (!res.ok || !Array.isArray(body)) {
        setError(`Couldn't load (${res.status}).`);
      } else {
        sessionStorage.setItem(PASS_KEY, p);
        setPass(p);
        setRows(body as FeedbackRecord[]);
      }
    } catch (e) {
      setError(`Couldn't reach the server: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (pass) void load(pass);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const links = useMemo(() => [...new Set((rows ?? []).map((r) => r.link))].sort(), [rows]);
  let data = useMemo(() => {
    const since = range === 'all' ? 0 : Date.now() - Number(range) * DAY;
    return (rows ?? []).filter((r) => r.at >= since && (kind === 'all' || r.kind === kind) && (link === 'all' || r.link === link));
  }, [rows, range, kind, link]);

  if (!rows) {
    return (
      <div className="fbd">
        <form
          className="fbd-gate"
          onSubmit={(e) => {
            e.preventDefault();
            if (typed) void load(typed);
          }}
        >
          <h1>Crafting feedback</h1>
          <p className="fbd-muted">Panel 2 ratings from every player. Enter the dashboard password.</p>
          <input type="password" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Password" autoFocus />
          <button disabled={!typed || loading}>{loading ? 'Loading…' : 'Open'}</button>
          {error && <p className="fbd-error">{error}</p>}
        </form>
      </div>
    );
  }

  // records without a vote are /1 clarifications that never reached a
  // rating (the craft failed or the player left) — only in the /1 section
  const all = data;
  const clar = all.filter((r) => r.clarify);
  data = all.filter((r) => r.vote);
  const ups = data.filter((r) => r.vote === 'up').length;
  const tuned = data.filter((r) => r.answers && Object.keys(r.answers).length).length;
  return (
    <div className="fbd">
      <header className="fbd-head">
        <h1>Crafting feedback</h1>
        <div className="fbd-filters">
          <Seg value={range} onChange={setRange} options={[['7', '7 days'], ['30', '30 days'], ['all', 'All time']]} />
          <label>
            Kind{' '}
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="all">All kinds</option>
              {Object.entries(KIND_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.one}
                </option>
              ))}
              <option value="">Unknown</option>
            </select>
          </label>
          <label>
            Link{' '}
            <select value={link} onChange={(e) => setLink(e.target.value)}>
              <option value="all">All links</option>
              {links.map((l) => (
                <option key={l} value={l}>
                  {l || '(none)'}
                </option>
              ))}
            </select>
          </label>
          <button onClick={() => void load(pass)} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          <button onClick={() => download('feedback.csv', toCsv(all), 'text/csv')}>CSV</button>
          <button onClick={() => download('feedback.json', JSON.stringify(all, null, 1), 'application/json')}>JSON</button>
        </div>
      </header>
      {error && <p className="fbd-error">{error}</p>}

      <section className="fbd-tiles">
        <Tile label="Ratings" value={data.length} />
        <Tile label="Like rate" value={data.length ? `${pct(ups, data.length)}%` : '–'} sub={`${ups} ▲ · ${data.length - ups} ▼`} />
        <Tile label="Players" value={new Set(data.map((r) => r.player)).size} />
        <Tile label="Tuned future crafts" value={data.length ? `${pct(tuned, data.length)}%` : '–'} sub={`${tuned} ratings`} />
        <Tile label="Adjusted results rated" value={data.filter((r) => r.adjusted).length} />
      </section>

      {data.length === 0 ? (
        <p className="fbd-muted fbd-empty">No ratings in this range yet.</p>
      ) : (
        <>
          <section className="fbd-grid">
            <Card title="Votes per day" wide>
              <VotesPerDay data={data} />
            </Card>
            <Card title="Like rate by link">
              <Bars
                rows={Object.entries(group(data, (r) => r.link)).map(([l, rs]) => {
                  const u = rs.filter((r) => r.vote === 'up').length;
                  return { label: l || '(none)', value: pct(u, rs.length), max: 100, text: `${pct(u, rs.length)}% of ${rs.length}` };
                })}
              />
            </Card>
            <Card title="Like rate by kind">
              <Bars
                rows={Object.entries(group(data, (r) => r.kind)).map(([k, rs]) => {
                  const u = rs.filter((r) => r.vote === 'up').length;
                  return { label: kindName(k), value: pct(u, rs.length), max: 100, text: `${pct(u, rs.length)}% of ${rs.length}` };
                })}
              />
            </Card>
            <Card title="Why “Not quite”">
              <Bars
                rows={[...FEEDBACK_REASONS, 'One-sentence comment']
                  .map((reason) => ({
                    label: reason,
                    value:
                      reason === 'One-sentence comment'
                        ? data.filter((r) => r.comment).length
                        : data.filter((r) => r.reasons.includes(reason as (typeof FEEDBACK_REASONS)[number])).length,
                  }))
                  .map((r) => ({ ...r, text: String(r.value) }))}
                note={`${data.filter((r) => r.vote === 'down').length} “Not quite” ratings; up to 3 reasons each`}
              />
            </Card>
            <Card title="Why “I like it” (/1)">
              <Bars
                rows={POSITIVE_REASONS.map((reason) => {
                  const v = data.filter((r) => (r.positive ?? []).includes(reason)).length;
                  return { label: reason, value: v, text: String(v) };
                })}
                note={`${data.filter((r) => r.vote === 'up' && r.clarify).length} “I like it” ratings on /1`}
              />
            </Card>
            <Card title="Player tags (/1)">
              <Bars
                rows={topTags(data).map(({ tag, count }) => ({ label: tag, value: count, text: String(count) }))}
                note="Own tags players wrote, and other players' tags they picked"
              />
            </Card>
            <Card title="Pre-clarification (/1)" wide>
              <ClarifyStats data={clar} />
            </Card>
            <Card title="User test: rating questions per condition" wide>
              <RatingCompare data={all.filter((r) => r.rating)} />
            </Card>
            <Card title="How the preference questions were answered" wide>
              <Answers data={data} />
            </Card>
            <Card title="Where answers were remembered">
              <Bars
                rows={(['kind', 'all', 'session'] as const).map((s) => {
                  const v = data.filter((r) => r.scope === s).length;
                  return { label: s === 'kind' ? 'Same kind' : s === 'all' ? 'All crafts' : 'This session', value: v, text: String(v) };
                })}
                note={`${tuned} ratings with tuning`}
              />
            </Card>
          </section>

          <Card title="Ratings (comments first)" wide>
            <RatingsTable data={data} />
          </Card>
        </>
      )}
      {tip && (
        <div className="fbd-tip" style={{ left: tip.x + 14, top: tip.y + 14 }}>
          {tip.text}
        </div>
      )}
    </div>
  );
}

// ---- pieces ----

function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="fbd-seg" role="group">
      {options.map(([v, l]) => (
        <button key={v} className={v === value ? 'on' : ''} onClick={() => onChange(v)} aria-pressed={v === value}>
          {l}
        </button>
      ))}
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="fbd-tile">
      <div className="fbd-tile-value">{value}</div>
      <div className="fbd-tile-label">{label}</div>
      {sub && <div className="fbd-muted fbd-tile-sub">{sub}</div>}
    </div>
  );
}

function Card({ title, wide, children }: { title: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={'fbd-card' + (wide ? ' wide' : '')}>
      <h2>{title}</h2>
      {children}
    </div>
  );
}

function group<T>(list: T[], key: (t: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const t of list) (out[key(t)] ??= []).push(t);
  return out;
}

// single-series horizontal bars, value labels in text ink
function Bars({ rows, note }: { rows: { label: string; value: number; max?: number; text: string }[]; note?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.max ?? r.value));
  return (
    <div className="fbd-bars">
      {rows.map((r) => (
        <div key={r.label} className="fbd-bar-row" {...hover(`${r.label}: ${r.text}`)}>
          <span className="fbd-bar-label">{r.label}</span>
          <span className="fbd-bar-track">
            <span className="fbd-bar s1" style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
          <span className="fbd-bar-value">{r.text}</span>
        </div>
      ))}
      {note && <div className="fbd-muted fbd-note">{note}</div>}
    </div>
  );
}

// stacked columns per day: ▲ (blue) under ▼ (red), 2px gap between them
function VotesPerDay({ data }: { data: FeedbackRecord[] }) {
  const days = group(data, (r) => dayKey(r.at));
  const first = Math.min(...data.map((r) => r.at));
  const keys: string[] = [];
  for (let t = Date.parse(dayKey(first)); t <= Date.now(); t += DAY) keys.push(dayKey(t));
  const shown = keys.slice(-45);
  const max = Math.max(1, ...shown.map((k) => (days[k] ?? []).length));
  const H = 160;
  return (
    <div>
      <div className="fbd-legend">
        <span>
          <i className="sw s1" /> I like it
        </span>
        <span>
          <i className="sw s2" /> Not quite
        </span>
      </div>
      <div className="fbd-cols" style={{ height: H }}>
        <span className="fbd-axis-max fbd-muted">{max}</span>
        {shown.map((k) => {
          const rs = days[k] ?? [];
          const u = rs.filter((r) => r.vote === 'up').length;
          const d = rs.length - u;
          return (
            <div
              key={k}
              className="fbd-col"
              {...hover(
                <>
                  <b>{k}</b>
                  <br />▲ {u} · ▼ {d}
                  {rs.length ? ` · ${pct(u, rs.length)}% liked` : ''}
                </>,
              )}
            >
              {d > 0 && <span className="fbd-seg-bar s2" style={{ height: (d / max) * (H - 18) }} />}
              {u > 0 && <span className="fbd-seg-bar s1" style={{ height: (u / max) * (H - 18) }} />}
            </div>
          );
        })}
      </div>
      <div className="fbd-axis fbd-muted">
        <span>{shown[0]}</span>
        <span>{shown[shown.length - 1]}</span>
      </div>
    </div>
  );
}

// one 100% bar per question: less (blue) · keep (gray) · more (red)
function Answers({ data }: { data: FeedbackRecord[] }) {
  return (
    <div className="fbd-answers">
      {PREF_KEYS.map((k) => {
        const answered = data.filter((r) => r.answers && r.answers[k] !== undefined);
        const n = answered.length;
        const counts = ([-1, 0, 1] as const).map((v) => answered.filter((r) => r.answers![k] === v).length);
        const labels = ([-1, 0, 1] as const).map((v) => PREF_INFO[k].labels[v]);
        return (
          <div key={k} className="fbd-ans-row">
            <span className="fbd-bar-label">{PREF_INFO[k].title}</span>
            <span className="fbd-stack">
              {n === 0 ? (
                <span className="fbd-muted">not answered yet</span>
              ) : (
                counts.map((c, i) =>
                  c ? (
                    <span
                      key={i}
                      className={'fbd-stack-seg ' + ['d1', 'd0', 'd2'][i]}
                      style={{ width: `${(c / n) * 100}%` }}
                      {...hover(`${PREF_INFO[k].title} · ${labels[i]}: ${c} of ${n} (${pct(c, n)}%)`)}
                    />
                  ) : null,
                )
              )}
            </span>
            <span className="fbd-bar-value fbd-ans-text">
              {n ? labels.map((l, i) => `${l} ${pct(counts[i], n)}%`).join(' · ') : ''}
            </span>
          </div>
        );
      })}
      <div className="fbd-legend">
        <span>
          <i className="sw d1" /> less / softer / essentials / controlled
        </span>
        <span>
          <i className="sw d0" /> keep
        </span>
        <span>
          <i className="sw d2" /> more / vivid / every detail / surprise
        </span>
      </div>
    </div>
  );
}

function RatingsTable({ data }: { data: FeedbackRecord[] }) {
  const [all, setAll] = useState(false);
  const sorted = [...data].sort((a, b) => Number(!!b.comment) - Number(!!a.comment) || b.at - a.at);
  const list = all ? sorted : sorted.slice(0, 50);
  return (
    <div className="fbd-table-wrap">
      <table className="fbd-table">
        <thead>
          <tr>
            <th>Craft</th>
            <th>Prompt</th>
            <th>Kind</th>
            <th>Vote</th>
            <th>Reasons · comment</th>
            <th>Tuned</th>
            <th>When</th>
          </tr>
        </thead>
        <tbody>
          {list.map((r) => (
            <tr key={r.id}>
              <td className="fbd-thumb">
                {r.sprite.lines.length > 0 && (
                  <FitSprite look={{ sprite: r.sprite.lines, colors: r.sprite.colors, palette: r.sprite.palette }} fill={0.85} maxScale={1.4} />
                )}
              </td>
              <td>
                <b>{r.name}</b>
                <div className="fbd-muted">{r.prompt}</div>
                {r.adjusted && <div className="fbd-muted">(adjusted)</div>}
              </td>
              <td>{kindName(r.kind)}</td>
              <td>{r.vote === 'up' ? '▲ like' : '▼ not quite'}</td>
              <td>
                {r.reasons.join(' · ')}
                {r.comment && <div className="fbd-comment">“{r.comment}”</div>}
              </td>
              <td className="fbd-muted">
                {r.answers
                  ? PREF_KEYS.filter((k) => r.answers![k] !== undefined)
                      .map((k) => PREF_INFO[k].labels[r.answers![k]!])
                      .join(', ') + (r.scope ? ` (${r.scope})` : '')
                  : '–'}
              </td>
              <td className="fbd-muted">{new Date(r.at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {sorted.length > 50 && (
        <button className="fbd-more" onClick={() => setAll((a) => !a)}>
          {all ? 'Show fewer' : `Show all ${sorted.length}`}
        </button>
      )}
    </div>
  );
}

// ---- /1 pre-clarification ----
function ClarifyStats({ data }: { data: FeedbackRecord[] }) {
  if (!data.length) return <p className="fbd-muted">No /1 crafts in this range yet.</p>;
  const asked = data.filter((r) => r.clarify!.questions.length > 0);
  const answers = asked.flatMap((r) => r.clarify!.questions);
  const picked = answers.filter((q) => q.pick).length;
  const n = (f: (r: FeedbackRecord) => boolean) => data.filter(f).length;
  const rows = [
    { label: 'Questions asked', value: asked.length },
    { label: 'Crafted without questions', value: data.length - asked.length },
    { label: 'Skipped with Esc', value: n((r) => r.clarify!.skipped) },
    { label: 'Answers picked', value: picked },
    { label: 'Answers left to Mitchy', value: answers.length - picked },
    { label: 'Craft failed', value: n((r) => r.clarify!.outcome === 'failed') },
    { label: 'Left before crafting', value: n((r) => r.clarify!.outcome === 'left') },
  ];
  const likeAsked = asked.filter((r) => r.vote);
  const likeNot = data.filter((r) => r.vote && !r.clarify!.questions.length);
  const rate = (rs: FeedbackRecord[]) => (rs.length ? `${pct(rs.filter((r) => r.vote === 'up').length, rs.length)}% of ${rs.length}` : '–');
  const failures = data
    .filter((r) => r.clarify!.outcome === 'failed' && r.clarify!.error)
    .sort((a, b) => b.at - a.at)
    .slice(0, 5);
  return (
    <>
      <Bars
        rows={rows.map((r) => ({ ...r, text: String(r.value) }))}
        note={`Like rate with questions: ${rate(likeAsked)} · without: ${rate(likeNot)} · median time answering: ${median(asked.map((r) => r.clarify!.ms)) / 1000}s`}
      />
      {failures.length > 0 && (
        <ul className="fbd-muted">
          {failures.map((r) => (
            <li key={r.id}>
              Failed “{r.prompt}”: {r.clarify!.error}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
// ---- the quest user test: Mitchy's rating questions, per condition ----
const COND_LABEL = { pre: 'Pre-clarification', post: 'Post-reflection' } as const;
function RatingCompare({ data }: { data: FeedbackRecord[] }) {
  if (!data.length) return <p className="fbd-muted">No rating answers in this range yet.</p>;
  const ids = RATING_QUESTIONS.map((q) => q.id);
  const stat = (cond: 'pre' | 'post', id: string) => {
    const v = data
      .filter((r) => r.cond === cond)
      .map((r) => r.rating?.[id])
      .filter((x): x is number => typeof x === 'number');
    return v.length ? `${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2)} (n=${v.length})` : '–';
  };
  return (
    <table className="fbd-table">
      <thead>
        <tr>
          <th>Question (1-5)</th>
          <th>{COND_LABEL.pre}</th>
          <th>{COND_LABEL.post}</th>
        </tr>
      </thead>
      <tbody>
        {ids.map((id, i) => (
          <tr key={id}>
            <td>{RATING_QUESTIONS[i].text}</td>
            <td>{stat('pre', id)}</td>
            <td>{stat('post', id)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function median(v: number[]): number {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  return Math.round(s[Math.floor(s.length / 2)] / 100) * 100;
}

// ---- export ----
function toCsv(rows: FeedbackRecord[]): string {
  const cols = [
    'at', 'link', 'player', 'name', 'prompt', 'kind', 'adjusted', 'vote', 'reasons', 'positive', 'tags', 'comment',
    ...PREF_KEYS.map((k) => `applied_${k}`), ...PREF_KEYS.map((k) => `answer_${k}`), 'scope',
    'clarify_questions', 'clarify_answers', 'clarify_skipped', 'clarify_outcome', 'clarify_ms', 'clarify_error', 'cond', 'rating',
  ];
  const cell = (v: unknown) => {
    const s = v === undefined || v === null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) =>
    [
      new Date(r.at).toISOString(),
      r.link,
      r.player,
      r.name,
      r.prompt,
      r.kind,
      r.adjusted,
      r.vote,
      r.reasons.join('; '),
      (r.positive ?? []).join('; '),
      (r.tags ?? []).join('; '),
      r.comment,
      ...PREF_KEYS.map((k) => r.applied[k]),
      ...PREF_KEYS.map((k) => r.answers?.[k]),
      r.scope,
      r.clarify?.questions.length,
      r.clarify?.questions.map((q) => `${q.topic}=${q.pick ?? 'You decide'}`).join('; '),
      r.clarify?.skipped,
      r.clarify?.outcome,
      r.clarify?.ms,
      r.clarify?.error,
      r.cond,
      r.rating ? JSON.stringify(r.rating) : '',
    ]
      .map(cell)
      .join(','),
  );
  return [cols.join(','), ...lines].join('\n');
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
