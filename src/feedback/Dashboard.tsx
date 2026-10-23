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
//   run log (GET /api/events, quest/runlog.ts) time per quest step, hints
//           per step, technical errors; with one participant picked, their
//           whole run: steps, hints, every craft with its conversation,
//           settings and reworks, errors
//   Participants tab: make personal invite links and help a player live
//           (an extra token or rework, more time, another device)
// Loaded on demand from main.tsx, so the game never downloads it.
//
// Colours (validated with the dataviz skill's validator on this dark
// surface): blue = "I like it" / the "less" end of a preference, red = "Not
// quite" / the "more" end, gray = Keep. Text never wears a series colour.
// ---------------------------------------------------------------------------
import { RATING_QUESTIONS } from '../quest/quests';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FitSprite } from '../ui';
import { conditionOf, designOf, FEEDBACK_REASONS, POSITIVE_REASONS, type FeedbackRecord } from './schema';
import { topTags } from '../../functions/api/feedback';
import { KIND_LABEL, PREF_INFO, PREF_KEYS, isKind } from '../craft/prefs';
import type { RunEvent } from '../quest/runlog';
import { endOf, participantFile, studyFiles, zip } from './studyExport';
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
  const [who, setWho] = useState('all'); // one participant, or everyone
  // participants left out of the evaluation (ticked off in "Include"; '' =
  // records without a participant, the open test links), kept in this browser
  const [left, setLeft] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(LEFT_KEY) ?? '[]') as string[]);
    } catch {
      return new Set();
    }
  });
  const toggleLeft = (ids: string[], out: boolean) =>
    setLeft((cur) => {
      const next = new Set(cur);
      for (const id of ids) {
        if (out) next.add(id);
        else next.delete(id);
      }
      try {
        localStorage.setItem(LEFT_KEY, JSON.stringify([...next]));
      } catch {
        // storage blocked: only for this visit
      }
      return next;
    });
  const [tab, setTab] = useState<'feedback' | 'participants'>('feedback');
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
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
        // the run log and the invite links (empty when not set up yet)
        const auth = { headers: { Authorization: `Bearer ${p}` } };
        const ev = await fetch('/api/events', auth).then((r) => (r.ok ? r.json() : [])).catch(() => []);
        const inv = await fetch('/api/admin/invites', auth).then((r) => (r.ok ? r.json() : [])).catch(() => []);
        setEvents(Array.isArray(ev) ? ev : []);
        setInvites(Array.isArray(inv) ? inv : []);
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
  const people = useMemo(
    () =>
      [
        ...new Set([
          ...(rows ?? []).map((r) => r.participant ?? ''),
          ...events.map((e) => e.participant),
          ...invites.map((i) => i.participant_id ?? ''),
        ]),
      ]
        .filter(Boolean)
        .sort(),
    [rows, events, invites],
  );
  let data = useMemo(() => {
    const since = range === 'all' ? 0 : Date.now() - Number(range) * DAY;
    return (rows ?? []).filter(
      (r) => r.at >= since && (kind === 'all' || r.kind === kind) && (link === 'all' || r.link === link) && (who === 'all' || r.participant === who) && !left.has(r.participant ?? ''),
    );
  }, [rows, range, kind, link, who, left]);
  const evs = useMemo(() => {
    const since = range === 'all' ? 0 : Date.now() - Number(range) * DAY;
    return events.filter((e) => e.at >= since && (link === 'all' || e.link === link) && (who === 'all' || e.participant === who) && !left.has(e.participant ?? ''));
  }, [events, range, link, who, left]);

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
        <Seg value={tab} onChange={setTab} options={[['feedback', 'Evaluation'], ['participants', 'Participants']]} />
        <div className="fbd-filters" style={tab !== 'feedback' ? { display: 'none' } : undefined}>
          <label>
            Participant{' '}
            <select value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="all">All participants</option>
              {people.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <Include people={people} anon={(rows ?? []).some((r) => !r.participant)} left={left} onToggle={toggleLeft} />
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
          <button className="fbd-save-all" onClick={() => saveAll(events, rows, invites)} title="Every participant, all time: one JSON file each (links, summary, the whole run with every craft and rating), in one ZIP">
            Save all participants (ZIP)
          </button>
          <button onClick={() => download('feedback.csv', toCsv(all), 'text/csv')} title="Only what the filters show">
            Save view (CSV)
          </button>
          <button onClick={() => download('feedback.json', JSON.stringify(all, null, 1), 'application/json')} title="Only what the filters show">
            Save view (JSON)
          </button>
          <button onClick={() => download('run-log.csv', eventsCsv(evs), 'text/csv')} title="Only what the filters show">
            Save view (run log CSV)
          </button>
        </div>
      </header>
      {error && <p className="fbd-error">{error}</p>}

      {tab === 'participants' ? (
        <Participants pass={pass} invites={invites} events={events} feedback={rows} reload={() => void load(pass)} />
      ) : (
        <>
      {who !== 'all' && (
        <>
          <p>
            <button onClick={() => saveOne(who, events, rows, invites)} title="Everything about this participant, all time, in one JSON file">
              Save {who} (JSON)
            </button>
          </p>
          <ParticipantRun
            id={who}
            events={evs}
            feedback={all}
            invites={invites.filter((i) => i.participant_id === who).sort((a, b) => (a.started ?? a.created) - (b.started ?? b.created))}
          />
        </>
      )}
      {who === 'all' && evs.length > 0 && (
        <section className="fbd-grid">
          <Card title="Time per quest step (median)">
            <StepTimes events={evs} />
          </Card>
          <Card title="Hints per quest step">
            <Bars
              rows={Object.entries(group(evs.filter((e) => e.type === 'hint'), (e) => String(e.data.step ?? e.step ?? '?')))
                .sort((a, b) => b[1].length - a[1].length)
                .map(([st, es]) => ({ label: st, value: es.length, text: `${es.length} (${new Set(es.map((e) => e.participant)).size} players)` }))}
              note={`${evs.filter((e) => e.type === 'hint').length} hints in all`}
            />
          </Card>
          <Card title="Crafts drawn offline, per design">
            <Bars
              rows={(['A', 'B'] as const).map((dz) => {
                const rs = evs
                  .filter((e) => e.type === 'craft' && designOf(e.cond) === dz)
                  .flatMap((e) => ((e.data.results as { ok?: boolean; fallback?: unknown }[] | undefined) ?? []).filter((r) => r.ok !== false));
                const off = rs.filter((r) => r.fallback).length;
                return { label: `Design ${dz}`, value: pct(off, rs.length), max: 100, text: `${off} of ${rs.length} (${pct(off, rs.length)}%)` };
              })}
              note="Results the AI couldn't make, drawn by the offline fallback instead"
            />
          </Card>
          <Card title="Technical errors">
            <Bars
              rows={Object.entries(group(evs.filter((e) => e.type === 'error'), errorKind))
                .sort((a, b) => b[1].length - a[1].length)
                .map(([k, es]) => ({ label: k, value: es.length, text: `${es.length} (${new Set(es.map((e) => e.participant)).size} players)` }))}
              note="AI unreachable, crafts drawn offline, feedback not sent, page errors"
            />
          </Card>
        </section>
      )}

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
            <Card title="Crafting library: missing references" wide>
              <MissingRefs data={all.filter((r) => r.ref)} />
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

// "Include": a checkbox per participant; the ones ticked off are left out
// of every chart, table and "Save view" export (not of "Save all")
const LEFT_KEY = 'asciia-dashboard-left-out';
function Include({ people, anon, left, onToggle }: { people: string[]; anon: boolean; left: Set<string>; onToggle: (ids: string[], out: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // a click anywhere else closes it
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  const all = [...people, ...(anon ? [''] : [])];
  const inCount = all.filter((p) => !left.has(p)).length;
  return (
    <div className="fbd-include" ref={box}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} title="Choose which participants the evaluation includes">
        Include: {inCount === all.length ? 'everyone' : `${inCount} of ${all.length}`} ▾
      </button>
      {open && (
        <div className="fbd-include-pop">
          <div className="fbd-include-all">
            <button className="fbd-link" onClick={() => onToggle(all, false)}>
              all
            </button>
            <button className="fbd-link" onClick={() => onToggle(all, true)}>
              none
            </button>
          </div>
          {all.map((p) => (
            <label key={p || '(none)'}>
              <input type="checkbox" checked={!left.has(p)} onChange={(e) => onToggle([p], !e.target.checked)} /> {p || 'no participant (test links)'}
            </label>
          ))}
        </div>
      )}
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
            <th>Design · cond. · order</th>
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
                {r.fallback && <div className="fbd-error-text">drawn offline: {r.fallback.why}</div>}
              </td>
              <td className="fbd-muted">
                {designOf(r.cond) ?? '–'} · {conditionOf(r.order, r.cond) ?? '–'} · {r.order ?? '–'}
                {r.participant && <div>{r.participant}</div>}
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

// ---- crafting from the reference library: what it could not build ----
// Words from crafts that fell back to the shape planner (no reference body
// fit) and words the matcher could not place: the next references to make.
function MissingRefs({ data }: { data: FeedbackRecord[] }) {
  if (!data.length) return <p className="fbd-muted">Nothing missing yet (or no crafts from the library in this range).</p>;
  const planner = data.filter((r) => r.ref?.via === 'planner');
  const count = new Map<string, number>();
  for (const r of planner)
    for (const w of new Set(r.prompt.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((x) => x.length > 2)))
      count.set(w, (count.get(w) ?? 0) + 1);
  const unplaced = new Map<string, number>();
  for (const r of data) for (const w of r.ref?.miss ?? []) unplaced.set(w, (unplaced.get(w) ?? 0) + 1);
  const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  return (
    <div className="fbd-grid">
      <div>
        <Bars
          rows={top(count).map(([w, n]) => ({ label: w, value: n, text: String(n) }))}
          note={`${planner.length} crafts with no fitting reference body (drawn from shapes instead): their most common words`}
        />
      </div>
      <div>
        <Bars
          rows={top(unplaced).map(([w, n]) => ({ label: w, value: n, text: String(n) }))}
          note="Words the library could not place (details or parts it has no picture of)"
        />
      </div>
    </div>
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
    'participant', 'order', 'run_order', 'condition', 'design', 'fallback_used', 'fallback_reason',
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
      r.participant,
      r.order,
      r.order,
      conditionOf(r.order, r.cond),
      designOf(r.cond),
      r.fallback ? 1 : 0,
      r.fallback?.why,
    ]
      .map(cell)
      .join(','),
  );
  return [cols.join(','), ...lines].join('\n');
}

function download(name: string, text: string | Blob, type: string) {
  const url = URL.createObjectURL(typeof text === 'string' ? new Blob([text], { type }) : text);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

// Everything about every participant, unfiltered: one JSON file each, in a
// ZIP (studyExport.ts); or one participant's file alone
function saveAll(events: RunEvent[], feedback: FeedbackRecord[], invites: Invite[]) {
  download(`asciia-study-${new Date().toISOString().slice(0, 10)}.zip`, zip(studyFiles(events, feedback, invites)), 'application/zip');
}
function saveOne(id: string, events: RunEvent[], feedback: FeedbackRecord[], invites: Invite[]) {
  download(`${id}.json`, JSON.stringify(participantFile(id, events, feedback, invites), null, 1), 'application/json');
}

// ---- the run log (quest/runlog.ts) ----

// Which of a person's links an event belongs to: the link it came from
// (newer events carry its key), else the link of that person that had
// started last by then (older events)
function linkOfEvent(e: RunEvent, invites: Invite[]): Invite | null {
  if (e.key) return invites.find((i) => i.key === e.key) ?? null;
  const mine = invites.filter((i) => i.participant_id === e.participant && i.started && i.started <= e.at + 60000);
  return mine.sort((a, b) => (b.started ?? 0) - (a.started ?? 0))[0] ?? null;
}
// a link's run as the run log saw it: its crafts, and when the survey opened
function linkRun(i: Invite, events: RunEvent[], invites: Invite[]) {
  const mine = events.filter((e) => e.participant === i.participant_id && linkOfEvent(e, invites)?.key === i.key);
  return {
    crafts: mine.filter((e) => e.type === 'craft' && !e.data.recraftOf && e.data.outcome === 'crafted').length,
    surveyAt: mine.find((e) => e.type === 'session' && e.data.what === 'survey')?.at ?? null,
  };
}

// The id the next person gets: the highest P-number among the links + 1,
// the server's own rule when a link starts (functions/api/session.ts NEXT_P)
function nextId(invites: Invite[]): string {
  const max = Math.max(0, ...invites.map((i) => Number(/^P(\d+)$/.exec(i.participant_id ?? '')?.[1] ?? 0)));
  return `P${String(max + 1).padStart(3, '0')}`;
}

// The links in the table: one person's several links together (oldest
// first), marked "link n of m"; the people in the list's own order
function grouped(invites: Invite[]): { i: Invite; n: number; of: number }[] {
  const out: { i: Invite; n: number; of: number }[] = [];
  const done = new Set<string>();
  for (const i of invites) {
    if (!i.participant_id) {
      out.push({ i, n: 1, of: 1 });
      continue;
    }
    if (done.has(i.participant_id)) continue;
    done.add(i.participant_id);
    const mine = invites.filter((x) => x.participant_id === i.participant_id).sort((a, b) => (a.started ?? a.created) - (b.started ?? b.created));
    mine.forEach((x, k) => out.push({ i: x, n: k + 1, of: mine.length }));
  }
  return out;
}

// one personal invite link (functions/api/session.ts, GET /api/admin/invites)
interface Invite {
  key: string;
  link: string;
  note: string;
  created: number;
  started: number | null;
  device: string | null;
  completed: number | null;
  participant_id: string | null;
  crafts_allowed: number;
  crafts_used: number;
  bonus_tokens: number;
  talk_used: number;
  consented?: number | null;
  reopened?: number | null;
  expiresAt: number | null;
  recrafts: Record<string, number>;
  itemExtras: Record<string, number>;
}

const errorKind = (e: RunEvent) => {
  const k = String(e.data.kind ?? 'other');
  return k === 'ai' ? `AI ${String(e.data.failure ?? '')}`.trim() : k === 'fallback-craft' ? 'Crafted offline' : k === 'feedback-unsent' ? 'Feedback not sent' : `Page error (${k})`;
};
const mins = (ms: number) =>
  ms >= 3600000
    ? `${Math.floor(ms / 3600000)} h ${Math.floor((ms % 3600000) / 60000)} min`
    : ms >= 60000
      ? `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`
      : `${Math.round(ms / 1000)} s`;
const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

const when = (t: number) => new Date(t).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
// when a run ended: the survey opened, or its time ran out (null: still on)
function inviteStatus(i: Invite): string {
  if (i.completed) return 'finished';
  if (!i.started) return 'not opened';
  if (i.expiresAt && Date.now() > i.expiresAt) return 'expired';
  return 'playing';
}

// median time per quest step, over everyone in the filter
function StepTimes({ events }: { events: RunEvent[] }) {
  const steps = events.filter((e) => e.type === 'step');
  if (!steps.length) return <p className="fbd-muted">No finished quest steps yet.</p>;
  const by = group(steps, (e) => `${e.data.part ?? ''} · ${e.data.step ?? '?'}`);
  return (
    <Bars
      rows={Object.entries(by).map(([k, es]) => {
        const m = median(es.map((e) => Number(e.data.ms) || 0));
        return { label: k, value: m, text: `${mins(m)} (${es.length})` };
      })}
      note="Per step: the median, and how many players finished it"
    />
  );
}

// one participant's whole run, in order
// (several links of one person: together, from the first start to the end
// of the last one, or the survey)
function ParticipantRun({ id, events, feedback, invites }: { id: string; events: RunEvent[]; feedback: FeedbackRecord[]; invites: Invite[] }) {
  const list = [...events].sort((a, b) => a.at - b.at);
  const started = invites.map((i) => i.started).filter((t): t is number => !!t);
  const invite: Invite | null = invites.length
    ? {
        ...invites[invites.length - 1],
        started: started.length ? Math.min(...started) : null,
        link: invites.map((i) => i.link).join(' + '),
        note: invites.map((i) => i.note).filter(Boolean).join(' · '),
        crafts_used: invites.reduce((a, i) => a + i.crafts_used, 0),
        crafts_allowed: invites.reduce((a, i) => a + i.crafts_allowed, 0),
        completed: invites.map((i) => i.completed).filter((t): t is number => !!t).sort((a, b) => b - a)[0] ?? null,
        expiresAt: Math.max(...invites.map((i) => i.expiresAt ?? 0)) || null,
      }
    : null;
  const first = invite?.started ?? list[0]?.at ?? null;
  const surveyAt = list.find((e) => e.data.what === 'survey')?.at ?? null;
  // the survey opening ends the run, whichever link it was on
  const end = surveyAt ? { at: surveyAt, how: 'finished' as const } : invite ? endOf(invite) : null;
  const last = end?.at ?? list[list.length - 1]?.at ?? null;
  const running = !end;
  const crafts = list.filter((e) => e.type === 'craft');
  const hints = list.filter((e) => e.type === 'hint').length;
  const errors = list.filter((e) => e.type === 'error');
  const steps = list.filter((e) => e.type === 'step');
  const ratings = feedback.filter((r) => r.participant === id && r.rating);
  const order = list[0]?.order ?? feedback.find((r) => r.participant === id)?.order ?? '';
  return (
    <section className="fbd-run">
      <section className="fbd-tiles">
        <Tile label="Participant (Tally tallyid)" value={id} sub={[order && `order ${order}`, invite?.link ?? list[0]?.link, invite?.note].filter(Boolean).join(' · ')} />
        <Tile
          label="Start · end"
          value={surveyAt ? 'finished' : invite ? inviteStatus(invite) : list.length ? 'playing' : '–'}
          sub={[
            first ? `start ${when(first)}` : '',
            running ? 'end: still running' : last ? `end ${when(last)}${end?.how === 'expired' ? ' (expired)' : ''}` : '',
            invite?.consented ? `consent ${when(invite.consented)}` : '',
          ]
            .filter(Boolean)
            .join(' · ')}
        />
        <Tile label={running ? 'Time so far' : 'Total time'} value={first && last ? mins((running ? Date.now() : last) - first) : '–'} sub={steps.length ? `avg step ${mins(steps.reduce((a, e) => a + (Number(e.data.ms) || 0), 0) / steps.length)}` : undefined} />
        <Tile label="Crafts / reworks" value={`${crafts.filter((c) => !c.data.recraftOf).length} / ${crafts.reduce((a, c) => a + (Number(c.data.reworks) || 0), 0)}`} sub={invite ? `budget ${invite.crafts_used} of ${invite.crafts_allowed} crafts${invites.length > 1 ? ` (${invites.length} links)` : ''}` : undefined} />
        <Tile label="Hints · errors" value={`${hints} · ${errors.length}`} />
      </section>
      {ratings.length > 0 && (
        <Card title="Rating questions" wide>
          <RatingCompare data={ratings} />
        </Card>
      )}
      <Card title="Timeline" wide>
        {list.length === 0 ? (
          <p className="fbd-muted">No run log for {id} in this range.</p>
        ) : (
          <ol className="fbd-timeline">
            {list.map((e) => (
              <li key={`${e.id}-${e.at}`} className={`fbd-ev ${e.type}`}>
                <span className="fbd-ev-time">{clock(e.at)}</span>
                <span className="fbd-ev-where">{[e.cond && (e.cond === 'pre' ? 'A' : 'B'), e.part, e.step].filter(Boolean).join(' · ')}</span>
                <div className="fbd-ev-body">
                  <EventBody e={e} />
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </section>
  );
}

const PREF_WORD: Record<string, Record<string, string>> = {
  detail: { '-1': 'fewer glyphs', '0': 'normal detail', '1': 'more glyphs' },
  color: { '-1': 'pastel', '0': 'normal colour', '1': 'vivid' },
  surprise: { '-1': 'controlled', '0': 'keep', '1': 'surprise me' },
};
const prefText = (p: unknown) =>
  p && typeof p === 'object'
    ? Object.entries(p as Record<string, number>)
        .map(([k, v]) => PREF_WORD[k]?.[String(v)] ?? `${k} ${v}`)
        .join(', ')
    : '';

function EventBody({ e }: { e: RunEvent }) {
  const d = e.data as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  switch (e.type) {
    case 'step':
      return (
        <span>
          <b>Finished “{d.step}”</b> in {mins(d.ms)} · {d.hints} hint{d.hints === 1 ? '' : 's'} · {mins(d.sinceStart)} into the run
        </span>
      );
    case 'hint':
      return <span>Hint on “{d.step}” ({d.shows})</span>;
    case 'session':
      return (
        <span>
          {d.what === 'start' ? 'Run started' : d.what === 'resume' ? 'Run resumed (reload)' : d.what === 'survey' ? 'Opened the final survey' : d.what === 'extra-token' ? `Got ${d.count} extra token(s)` : d.what === 'budget-refused' ? `AI budget refused: ${d.detail}` : String(d.what)}
          {d.screen && <span className="fbd-muted"> · {d.screen}</span>}
        </span>
      );
    case 'error':
      return (
        <span className="fbd-error-text">
          {errorKind(e)}: {String(d.detail ?? d.why ?? d.message ?? d.id ?? '')}
          {d.prompt && <span className="fbd-muted"> · “{d.prompt}”</span>}
        </span>
      );
    case 'craft':
      return <CraftLog d={d} cond={conditionOf(e.order, e.cond)} />;
  }
}

// one crafting panel: results with their settings, the conversation, ratings
function CraftLog({ d, cond }: { d: Record<string, any>; cond: 1 | 2 | null }) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const [open, setOpen] = useState(false);
  const results: Record<string, any>[] = d.results ?? []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const ratings: Record<string, any>[] = d.ratings ?? []; // eslint-disable-line @typescript-eslint/no-explicit-any
  return (
    <div className="fbd-craft">
      <div>
        <b>{d.recraftOf ? `Recraft of ${d.recraftOf}` : 'Craft'}</b> · design {d.design === 'pre' ? 'A (pre-clarification)' : d.design === 'post' ? 'B (post-reflection)' : d.design}
        {cond && ` · condition ${cond}`} ·{' '}
        {d.outcome === 'crafted' ? 'kept' : 'left without keeping'} · {mins(d.ms)}
        {d.reworksOf > 1 && ` · reworks ${d.reworks} of ${d.reworksOf}`}
      </div>
      <div className="fbd-craft-results">
        {results.map((r, i) => (
          <div key={i} className="fbd-craft-result">
            {r.sprite?.lines?.length > 0 && (
              <span className="fbd-thumb">
                <FitSprite look={{ sprite: r.sprite.lines, colors: r.sprite.colors, palette: r.sprite.palette }} fill={0.85} maxScale={1.4} />
              </span>
            )}
            <div>
              <b>{r.ok === false ? 'Failed' : r.name}</b> {r.rework && <span className="fbd-muted">(rework)</span>}
              <div className="fbd-muted">“{r.prompt}”</div>
              {prefText(r.applied) && <div className="fbd-muted">settings: {prefText(r.applied)}</div>}
              {r.clarify?.questions?.length > 0 && (
                <div className="fbd-muted">answers: {r.clarify.questions.map((q: { topic: string; pick: string | null }) => `${q.topic}=${q.pick ?? 'You decide'}`).join(', ')}</div>
              )}
              {r.fallback && (
                <div className="fbd-error-text">
                  drawn offline ({r.fallback.via === 'library' ? 'library picture' : 'built-in shape'}): {r.fallback.why}
                </div>
              )}
              {r.note && <div className="fbd-muted">{r.note}</div>}
            </div>
          </div>
        ))}
      </div>
      {ratings.map((r, i) => (
        <div key={i} className="fbd-muted">
          rated “{r.name}”: {r.vote === 'up' ? '▲ like' : r.vote === 'down' ? '▼ not quite' : '–'}
          {[...(r.reasons ?? []), ...(r.positive ?? []), ...(r.tags ?? [])].length > 0 && ` · ${[...(r.reasons ?? []), ...(r.positive ?? []), ...(r.tags ?? [])].join(', ')}`}
          {r.comment && ` · “${r.comment}”`}
          {r.answers && ` · tuned: ${prefText(r.answers)}${r.scope ? ` (${r.scope})` : ''}`}
        </div>
      ))}
      <button className="fbd-link" onClick={() => setOpen((o) => !o)}>
        {open ? 'Hide the conversation' : `Show the conversation (${(d.thread ?? []).length} lines)`}
      </button>
      {open && (
        <div className="fbd-chat">
          {(d.thread ?? []).map((t: Record<string, any>, i: number) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
            <div key={i} className={`fbd-chat-line ${t.who}`}>
              <b>{t.who === 'me' ? 'Player' : 'Mitchy'}:</b>{' '}
              {t.result ? <i>[result: {t.result}]</i> : t.concepts ? <i>[ideas: {t.concepts.join(' / ')}]</i> : t.text}
              {t.options && <span className="fbd-muted"> [{t.options.join(' / ')}]</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function eventsCsv(events: RunEvent[]): string {
  const cell = (v: unknown) => {
    const s = v === undefined || v === null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const cols = ['at', 'participant', 'run_order', 'condition', 'design', 'fallback_used', 'link', 'cond', 'part', 'step', 'type', 'data'];
  const fallbackUsed = (e: RunEvent) =>
    (e.type === 'error' && e.data.kind === 'fallback-craft') ||
    (e.type === 'craft' && ((e.data.results as { fallback?: unknown }[] | undefined) ?? []).some((r) => !!r?.fallback))
      ? 1
      : 0;
  return [
    cols.join(','),
    ...[...events]
      .sort((a, b) => a.at - b.at)
      .map((e) =>
        [new Date(e.at).toISOString(), e.participant, e.order, conditionOf(e.order, e.cond), designOf(e.cond), fallbackUsed(e), e.link, e.cond, e.part, e.step, e.type, e.data]
          .map(cell)
          .join(','),
      ),
  ].join('\n');
}

// ---- the Participants tab: personal links, and live help ----
function Participants({
  pass,
  invites,
  events,
  feedback,
  reload,
}: {
  pass: string;
  invites: Invite[];
  events: RunEvent[];
  feedback: FeedbackRecord[];
  reload: () => void;
}) {
  const [deleting, setDeleting] = useState<{ key: string; data: boolean } | null>(null);
  const [count, setCount] = useState(1);
  const [link, setLink] = useState('/intro/1');
  const [note, setNote] = useState('');
  const [made, setMade] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    const iv = window.setInterval(() => tick((n) => n + 1), 1000); // the countdowns
    const re = window.setInterval(reload, 30000);
    return () => {
      window.clearInterval(iv);
      window.clearInterval(re);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const linkOf = (i: { key: string; link: string }) => `${window.location.origin}${i.link}?k=${i.key}`;
  async function post(path: string, body: Record<string, unknown>) {
    setMsg(null);
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pass}` },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (!res?.ok) {
      setMsg(`That didn't work (${res?.status ?? 'offline'}).`);
      return null;
    }
    const d = await res.json().catch(() => ({}));
    reload();
    return d;
  }
  async function create() {
    const d = (await post('/api/admin/invites', { count, link, note })) as { keys?: string[]; link?: string } | null;
    if (d?.keys) setMade(d.keys.map((k) => linkOf({ key: k, link: d.link ?? link })));
  }
  // the items a player crafted (their chain ids), for "+1 rework"
  const itemsOf = (pid: string | null) => {
    const out = new Map<string, string>();
    for (const e of events) {
      if (e.participant !== pid || e.type !== 'craft') continue;
      const rs = (e.data.results as { name?: string }[] | undefined) ?? [];
      const r = rs[rs.length - 1];
      if (r?.name && typeof e.data.chain === 'string') out.set(e.data.chain, r.name);
    }
    return out;
  };
  const copy = (t: string) => void navigator.clipboard?.writeText(t);
  return (
    <section className="fbd-admin">
      <Card title="Create personal links" wide>
        <p className="fbd-next">
          Next new participant: <b>{nextId(invites)}</b>
          <span className="fbd-muted"> · given when a link is first opened (not when it's created), so the next link someone opens gets it</span>
        </p>
        <div className="fbd-filters">
          <label>
            How many <input type="number" min={1} max={100} value={count} onChange={(e) => setCount(Number(e.target.value) || 1)} style={{ width: 64 }} />
          </label>
          <Seg value={link} onChange={setLink} options={[['/intro/1', '/intro/1 (A then B)'], ['/intro/2', '/intro/2 (B then A)']]} />
          <label>
            Note <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional, e.g. a name" maxLength={80} />
          </label>
          <button onClick={() => void create()}>Create</button>
        </div>
        {made.length > 0 && (
          <div className="fbd-made">
            {made.map((l) => (
              <div key={l}>
                <code>{l}</code> <button onClick={() => copy(l)}>Copy</button>
              </div>
            ))}
            {made.length > 1 && <button onClick={() => copy(made.join('\n'))}>Copy all</button>}
          </div>
        )}
        <p className="fbd-muted fbd-note">
          Each link works for one person, in the first browser that opens it, for 3 hours from the first start, and closes when they open the final survey.
          Budget per person: 6 crafts (3 per design), 3 reworks per crafted item.
        </p>
      </Card>
      {msg && <p className="fbd-error">{msg}</p>}
      <p>
        <button onClick={() => saveAll(events, feedback, invites)} title="Every participant, all time: one JSON file each, in one ZIP">
          Save all participants (ZIP)
        </button>
      </p>
      <Card title={`Links (${invites.length})`} wide>
        <div className="fbd-table-wrap">
          <table className="fbd-table">
            <thead>
              <tr>
                <th>Participant</th>
                <th>Link · note</th>
                <th>Status</th>
                <th>Start</th>
                <th>End</th>
                <th>Time left</th>
                <th>Crafts</th>
                <th>Reworks</th>
                <th>Help</th>
              </tr>
            </thead>
            <tbody>
              {grouped(invites).map(({ i, n, of }) => {
                const run = linkRun(i, events, invites);
                // the survey opened on this link but it wasn't marked finished
                const unmarked = !i.completed && run.surveyAt !== null;
                const st = unmarked ? 'finished (survey seen)' : inviteStatus(i);
                const left = i.expiresAt ? i.expiresAt - Date.now() : null;
                const items = itemsOf(i.participant_id);
                return (
                  <tr key={i.key} className={of > 1 ? `fbd-multi${n === 1 ? ' first' : ''}${n === of ? ' last' : ''}` : undefined}>
                    <td>
                      {of > 1 && <div className="fbd-badge" title={`${i.participant_id} has ${of} links`}>link {n} of {of}</div>}
                      <IdEdit
                        id={i.participant_id}
                        onSave={async (id) => {
                          const d = (await post('/api/admin/participant', { key: i.key, id })) as { id?: string; moved?: Record<string, number>; next?: string } | null;
                          if (!d?.id) return false;
                          const n = Object.values(d.moved ?? {}).reduce((a, b) => a + b, 0);
                          setMsg(`This link is now ${d.id}${n ? ` (${n} records moved along)` : ''}. The next new participant gets ${d.next}.`);
                          return true;
                        }}
                      />
                    </td>
                    <td>
                      {i.link}{' '}
                      <NoteEdit note={i.note} onSave={(note) => post('/api/admin/note', { key: i.key, note }).then((d) => !!d)} />
                      <div>
                        <button className="fbd-link" onClick={() => copy(linkOf(i))}>
                          copy link
                        </button>
                      </div>
                    </td>
                    <td>
                      {st}
                      {i.reopened && !i.completed && <div className="fbd-muted">reopened {when(i.reopened)}</div>}
                      {unmarked && (
                        <div>
                          <button className="fbd-link" onClick={() => void post('/api/admin/finish', { key: i.key, at: run.surveyAt })} title="Saves this link as finished, at the time the survey opened">
                            mark finished
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="fbd-muted">
                      {i.started ? when(i.started) : '–'}
                      {i.consented && <div>consent {when(i.consented)}</div>}
                    </td>
                    <td className="fbd-muted">
                      {(() => {
                        const e = unmarked ? { at: run.surveyAt!, how: 'finished' as const } : endOf(i);
                        if (!e || !i.started) return '–';
                        return (
                          <>
                            {e.how === 'expired' ? 'expired ' : 'survey '}
                            {when(e.at)}
                            <div>({mins(e.at - i.started)})</div>
                            {e.how === 'expired' && !run.surveyAt && <div>no survey logged</div>}
                          </>
                        );
                      })()}
                    </td>
                    <td className="fbd-muted">{st === 'playing' && left !== null ? mins(Math.max(0, left)) : '–'}</td>
                    <td>
                      {i.crafts_used} of {i.crafts_allowed}
                      {i.bonus_tokens > 0 && <span className="fbd-muted"> (+{i.bonus_tokens})</span>}
                      {/* what the run log saw crafted on this link (the budget counts AI calls) */}
                      {i.started && <div className="fbd-muted">crafted {run.crafts}</div>}
                    </td>
                    <td className="fbd-muted">
                      {Object.entries(i.recrafts).length
                        ? Object.entries(i.recrafts)
                            .map(([item, n]) => `${items.get(item) ?? item.slice(-6)} ${n}/${3 + (i.itemExtras[item] ?? 0)}`)
                            .join(', ')
                        : '–'}
                    </td>
                    <td className="fbd-help">
                      <button disabled={!i.started || !!i.completed} onClick={() => void post('/api/admin/token', { key: i.key })} title="Puts a crafting token in their inventory within 20 s">
                        +1 token
                      </button>
                      {items.size > 0 && (
                        <select
                          value=""
                          onChange={(e) => e.target.value && void post('/api/admin/recraft', { key: i.key, item: e.target.value })}
                          title="One more rework for an item"
                        >
                          <option value="">+1 rework…</option>
                          {[...items].map(([chain, name]) => (
                            <option key={chain} value={chain}>
                              {name}
                            </option>
                          ))}
                        </select>
                      )}
                      <button disabled={!i.started || !!i.completed} onClick={() => void post('/api/admin/extend', { key: i.key })}>
                        +1 hour
                      </button>
                      <button disabled={!i.device} onClick={() => void post('/api/admin/reset-device', { key: i.key })} title="The next browser that opens the link takes it over">
                        Other device
                      </button>
                      {i.completed && <button onClick={() => void post('/api/admin/reopen', { key: i.key })}>Reopen</button>}
                      {i.participant_id && (
                        <button onClick={() => saveOne(i.participant_id!, events, feedback, invites)} title="Everything about this participant in one JSON file">
                          Save
                        </button>
                      )}
                      {deleting?.key !== i.key ? (
                        <button className="fbd-danger" onClick={() => setDeleting({ key: i.key, data: false })}>
                          Delete
                        </button>
                      ) : (
                        <div className="fbd-confirm">
                          {i.participant_id ? `Delete link ${i.participant_id}?` : 'Delete this link?'}
                          {i.participant_id && (
                            <label>
                              <input type="checkbox" checked={deleting.data} onChange={(e) => setDeleting({ key: i.key, data: e.target.checked })} /> also delete
                              everything {i.participant_id} recorded ({feedback.filter((r) => r.participant === i.participant_id).length} ratings,{' '}
                              {events.filter((e) => e.participant === i.participant_id).length} run-log events)
                            </label>
                          )}
                          <span>
                            <button
                              className="fbd-danger"
                              onClick={() => {
                                const data = deleting.data;
                                setDeleting(null);
                                void post('/api/admin/delete', { key: i.key, data });
                              }}
                            >
                              Delete
                            </button>{' '}
                            <button onClick={() => setDeleting(null)}>Cancel</button>
                          </span>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </section>
  );
}

// a link's note, edited in place: click it, Enter or leaving saves, Esc cancels
// The participant id, rewritable: several links of one person under one id
// (also before the link is started); the counter goes on from the highest
// id in use (functions/api/session.ts /api/admin/participant)
function IdEdit({ id, onSave }: { id: string | null; onSave: (id: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState<string | null>(null);
  if (editing === null)
    return (
      <button className="fbd-link fbd-note-edit" onClick={() => setEditing(id ?? '')} title="Change the participant id (e.g. to put several links of one person under one id)">
        <b>{id ?? '–'}</b> ✎
      </button>
    );
  const save = async () => {
    const v = editing.trim();
    setEditing(null);
    if (!v || v === id) return;
    await onSave(v);
  };
  return (
    <input
      className="fbd-note-input"
      style={{ width: '6em' }}
      autoFocus
      value={editing}
      maxLength={8}
      placeholder="P003"
      onChange={(e) => setEditing(e.target.value)}
      onBlur={() => void save()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') void save();
        else if (e.key === 'Escape') setEditing(null);
      }}
    />
  );
}

function NoteEdit({ note, onSave }: { note: string; onSave: (note: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  if (editing === null)
    return (
      <>
        <button className="fbd-link fbd-note-edit" onClick={() => setEditing(note)} title="Edit the note">
          {note ? `· ${note}` : '+ add note'}
        </button>
        {saved && <span className="fbd-muted"> saved</span>}
      </>
    );
  const save = async () => {
    const v = editing.trim();
    setEditing(null);
    if (v === note) return;
    if (await onSave(v)) {
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1500);
    }
  };
  return (
    <input
      className="fbd-note-input"
      autoFocus
      value={editing}
      maxLength={80}
      placeholder="e.g. a name"
      onChange={(e) => setEditing(e.target.value)}
      onBlur={() => void save()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') void save();
        else if (e.key === 'Escape') setEditing(null);
      }}
    />
  );
}
