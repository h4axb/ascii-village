// The game's own records for the participants shown (or one person): ratings
// and like rates per variant and kind, why "Not quite" / "I like it", tuning,
// recrafts, hints, errors with time, the pre-clarification step and the words
// the crafting library could not build. The same numbers as the game's own
// feedback dashboard, limited to the user test's participants.
import { designOf, FEEDBACK_REASONS, POSITIVE_REASONS, type FeedbackRecord } from '../feedback/schema';
import { KIND_LABEL, isKind } from '../craft/prefs';
import type { RunEvent } from '../quest/runlog';
import { fmtBerlin } from './match';

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const rate = (up: number, n: number) => (n ? `${pct(up, n)} % (${up}/${n})` : '–');

export const ERROR_LABEL = (e: RunEvent) => {
  const k = String(e.data.kind ?? 'other');
  if (k === 'ai') return `KI nicht erreichbar${e.data.failure ? ` (${String(e.data.failure)})` : ''}`;
  if (k === 'fallback-craft') return 'offline gezeichnet (Ersatzergebnis)';
  if (k === 'feedback-unsent') return 'Bewertung nicht gesendet';
  return `Seitenfehler (${k})`;
};

export function gameStats(events: RunEvent[], feedback: FeedbackRecord[]) {
  // (Mitchy's rating questions are records of their own, not ratings of a result)
  const votes = feedback.filter((r) => !r.rating && r.vote);
  const byDesign = (d: 'A' | 'B') => {
    const rs = votes.filter((r) => designOf(r.cond) === d);
    return { up: rs.filter((r) => r.vote === 'up').length, n: rs.length };
  };
  const kinds = new Map<string, { up: number; n: number }>();
  for (const r of votes) {
    const k = isKind(r.kind) ? KIND_LABEL[r.kind].one : 'unbekannt';
    const x = kinds.get(k) ?? { up: 0, n: 0 };
    kinds.set(k, { up: x.up + (r.vote === 'up' ? 1 : 0), n: x.n + 1 });
  }
  const downs = votes.filter((r) => r.vote === 'down');
  const ups = votes.filter((r) => r.vote === 'up');
  const clar = feedback.filter((r) => !r.rating && r.clarify);
  const asked = clar.filter((r) => r.clarify!.questions.length > 0);
  const answers = asked.flatMap((r) => r.clarify!.questions);
  const picked = answers.filter((q) => q.pick).length;
  const hints = events.filter((e) => e.type === 'hint');
  const hintSteps = new Map<string, number>();
  for (const e of hints) {
    const st = String(e.data.step ?? e.step ?? '?');
    hintSteps.set(st, (hintSteps.get(st) ?? 0) + 1);
  }
  const missing = new Map<string, number>();
  for (const r of feedback) for (const w of r.ref?.miss ?? []) missing.set(w, (missing.get(w) ?? 0) + 1);
  return {
    ratings: votes.length,
    like: { A: byDesign('A'), B: byDesign('B'), all: { up: ups.length, n: votes.length } },
    likeByKind: [...kinds].sort((a, b) => b[1].n - a[1].n),
    tuned: votes.filter((r) => r.answers && Object.keys(r.answers).length).length,
    adjusted: votes.filter((r) => r.adjusted).length,
    recrafted: events.filter((e) => e.type === 'craft' && e.data.recraftOf).length,
    hints: { n: hints.length, steps: [...hintSteps].sort((a, b) => b[1] - a[1]) },
    errors: events
      .filter((e) => e.type === 'error')
      .sort((a, b) => a.at - b.at)
      .map((e) => ({ at: e.at, person: e.participant, label: ERROR_LABEL(e), detail: String(e.data.message ?? e.data.error ?? '').slice(0, 160) })),
    notQuite: { n: downs.length, reasons: [...FEEDBACK_REASONS].map((x) => [x, downs.filter((r) => r.reasons.includes(x)).length] as const).filter(([, n]) => n), comments: downs.filter((r) => r.comment).length },
    iLike: { n: ups.length, reasons: [...POSITIVE_REASONS].map((x) => [x, ups.filter((r) => (r.positive ?? []).includes(x)).length] as const).filter(([, n]) => n) },
    clarify: {
      crafts: clar.length,
      asked: asked.length,
      without: clar.length - asked.length,
      skipped: clar.filter((r) => r.clarify!.skipped).length,
      picked,
      left: answers.length - picked,
      failed: clar.filter((r) => r.clarify!.outcome === 'failed').length,
      leftBefore: clar.filter((r) => r.clarify!.outcome === 'left').length,
      failures: clar.filter((r) => r.clarify!.outcome === 'failed' && r.clarify!.error).map((r) => ({ at: r.at, prompt: r.prompt, error: String(r.clarify!.error) })),
    },
    missing: [...missing].sort((a, b) => b[1] - a[1]).slice(0, 12),
  };
}
export type GameStats = ReturnType<typeof gameStats>;

// the numbers as compact lists; persons: show who an error belongs to
export function GameStatsView({ s, persons }: { s: GameStats; persons?: boolean }) {
  const kv = (rows: [string, string | number][]) => (
    <dl className="st-gskv">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
  return (
    <div className="st-gamestats">
      <div className="st-gs-block">
        <h4>Bewertungen</h4>
        {kv([
          ['Bewertungen', s.ratings],
          ['Like-Rate gesamt', rate(s.like.all.up, s.like.all.n)],
          ['Like-Rate Variante A', rate(s.like.A.up, s.like.A.n)],
          ['Like-Rate Variante B', rate(s.like.B.up, s.like.B.n)],
          ['Künftige Crafts angepasst', s.tuned],
          ['Überarbeitete Ergebnisse bewertet', s.adjusted],
          ['Recrafts', s.recrafted],
        ])}
      </div>
      <div className="st-gs-block">
        <h4>Like-Rate je Art</h4>
        {s.likeByKind.length ? kv(s.likeByKind.map(([k, x]) => [k, rate(x.up, x.n)])) : <p className="st-muted">keine Bewertungen</p>}
      </div>
      <div className="st-gs-block">
        <h4>{`Warum „Not quite“ (${s.notQuite.n})`}</h4>
        {s.notQuite.reasons.length || s.notQuite.comments ? kv([...s.notQuite.reasons.map(([r, n]) => [r, n] as [string, number]), ...(s.notQuite.comments ? [['Kommentar (ein Satz)', s.notQuite.comments] as [string, number]] : [])]) : <p className="st-muted">–</p>}
      </div>
      <div className="st-gs-block">
        <h4>{`Warum „I like it“ (${s.iLike.n})`}</h4>
        {s.iLike.reasons.length ? kv(s.iLike.reasons.map(([r, n]) => [r, n] as [string, number])) : <p className="st-muted">–</p>}
      </div>
      <div className="st-gs-block">
        <h4>{`Vorab-Klärung (${s.clarify.crafts} Crafts)`}</h4>
        {kv([
          ['Fragen gestellt', s.clarify.asked],
          ['Ohne Fragen gecraftet', s.clarify.without],
          ['Mit Esc übersprungen', s.clarify.skipped],
          ['Antworten gewählt', s.clarify.picked],
          ['Antworten Mitchy überlassen', s.clarify.left],
          ['Craft fehlgeschlagen', s.clarify.failed],
          ['Vor dem Craften verlassen', s.clarify.leftBefore],
        ])}
        {s.clarify.failures.length > 0 && (
          <ul className="st-gs-list">
            {s.clarify.failures.map((f) => (
              <li key={f.at}>
                <span className="st-muted">{fmtBerlin(f.at)}</span> <span data-notr>{`„${f.prompt}“: ${f.error}`}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="st-gs-block">
        <h4>{`Hinweise (${s.hints.n})`}</h4>
        {s.hints.steps.length ? kv(s.hints.steps.map(([st, n]) => [st, n] as [string, number])) : <p className="st-muted">keine</p>}
      </div>
      <div className="st-gs-block st-gs-wide">
        <h4>{`Fehler (${s.errors.length})`}</h4>
        {s.errors.length ? (
          <ul className="st-gs-list">
            {s.errors.map((e, k) => (
              <li key={k}>
                <span className="st-muted">{fmtBerlin(e.at)}</span>
                {persons && <span className="st-pid">{e.person}</span>} {e.label}
                {e.detail && <span className="st-muted" data-notr>{` – ${e.detail}`}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="st-muted">keine</p>
        )}
      </div>
      <div className="st-gs-block st-gs-wide">
        <h4>Crafting-Bibliothek: fehlende Referenzen</h4>
        {s.missing.length ? <p data-notr>{s.missing.map(([w, n]) => `${w} (${n})`).join(', ')}</p> : <p className="st-muted">keine</p>}
      </div>
    </div>
  );
}
