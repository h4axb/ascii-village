// The check of the AI's proposals before anything is stored: per statement
// the current version (left) and the new one (right, editable by hand), each
// with "Aktuell behalten" / "Neu übernehmen" – the new one preselected. Then a
// summary; "Jetzt übernehmen" saves the current state first.
//   RewriteReview  statements reworded (the German version is what changes)
//   TagReview      tags and finding suggested for statements
import { useEffect, useState, type ReactNode } from 'react';
import type { ItemDoc, TagGroup } from './types';
import type { Study } from './store';
import type { Put } from './store';
import { diffWords } from './changes';
import { Words } from './ChangeModal';
import { logChange } from './ui';
import { effectiveChips, findingsOf, setFindings } from './model';

type Pick = 'alt' | 'neu';
interface Row {
  id: string;
  group: string; // the participant
  label: string; // a short name of the statement
}

// the frame both share: rows with their two sides, the choice, the summary step
function Shell({
  title,
  intro,
  rows,
  picks,
  setPick,
  render,
  onApply,
  onCancel,
  busy,
  edited = new Set<string>(),
  blocked = false,
  extra,
}: {
  title: string;
  intro: string;
  rows: Row[];
  picks: Record<string, Pick>;
  setPick: (id: string, p: Pick) => void;
  render: (id: string) => ReactNode;
  onApply: () => void;
  onCancel: () => void;
  busy: string | null;
  edited?: Set<string>; // statements whose wording or question was edited (stored whichever side is picked)
  blocked?: boolean; // a confirmation is open on top
  extra?: ReactNode; // shown above the window (the confirmation)
}) {
  const [review, setReview] = useState(false);
  const taken = rows.filter((r) => picks[r.id] === 'neu' || edited.has(r.id));
  const kept = rows.filter((r) => picks[r.id] !== 'neu' && !edited.has(r.id));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || busy || blocked) return;
      if (review) setReview(false);
      else onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, review, onCancel, blocked]);
  const groups = [...new Set(rows.map((r) => r.group))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const summary = (list: Row[], cls: string) =>
    list.length ? (
      <ul className="st-review-list">
        {groups
          .filter((g) => list.some((r) => r.group === g))
          .map((g) => (
            <li key={g} className={cls}>
              <strong data-notr>{g}</strong>
              <ul>
                {list
                  .filter((r) => r.group === g)
                  .map((r) => (
                    <li key={r.id} data-notr>
                      {r.label}
                      {edited.has(r.id) && <span className="st-muted">{picks[r.id] === 'neu' ? ' · mit bearbeiteter Aussage/Frage' : ' · nur Aussage/Frage bearbeitet'}</span>}
                    </li>
                  ))}
              </ul>
            </li>
          ))}
      </ul>
    ) : (
      <p className="st-muted">nichts</p>
    );
  return (
    <div className="st-modal-back" role="presentation">
      <div className="st-modal" role="dialog" aria-modal="true" aria-label={title}>
        <header className="st-modal-head">
          <h2>{review ? `Bestätigen: ${title}` : title}</h2>
          <p className="st-muted">{review ? 'So wird es übernommen. „Zurück“ ändert die Auswahl; erst „Jetzt übernehmen“ speichert (der jetzige Stand wird vorher gesichert).' : intro}</p>
          {!review && rows.length > 1 && (
            <div className="st-modal-all">
              <span className="st-muted">Alle:</span>
              <button type="button" onClick={() => rows.forEach((r) => setPick(r.id, 'alt'))}>
                Aktuell behalten
              </button>
              <button type="button" onClick={() => rows.forEach((r) => setPick(r.id, 'neu'))}>
                Neu übernehmen
              </button>
            </div>
          )}
        </header>
        <div className="st-modal-body">
          {review ? (
            <div className="st-review">
              <section>
                <h3 className="is-applied">Wird übernommen ({taken.length})</h3>
                {summary(taken, 'is-applied')}
              </section>
              <section>
                <h3 className="is-stays">Bleibt wie bisher ({kept.length})</h3>
                {summary(kept, 'is-stays')}
              </section>
            </div>
          ) : (
            groups.map((g) => (
              <section key={g} className="st-modal-group">
                <h3 data-notr>{g}</h3>
                {rows
                  .filter((r) => r.group === g)
                  .map((r) => (
                    <div key={r.id} className="st-change is-konflikt">
                      <div className="st-change-head">
                        <span className="st-change-label st-muted">{picks[r.id] === 'neu' ? 'wird übernommen' : edited.has(r.id) ? 'Aussage/Frage bearbeitet' : 'bleibt wie bisher'}</span>
                        <span className="st-change-pick">
                          <button type="button" className={picks[r.id] === 'alt' ? 'is-on' : ''} onClick={() => setPick(r.id, 'alt')}>
                            Aktuell behalten
                          </button>
                          <button type="button" className={picks[r.id] === 'neu' ? 'is-on' : ''} onClick={() => setPick(r.id, 'neu')}>
                            Neu übernehmen
                          </button>
                        </span>
                      </div>
                      {render(r.id)}
                    </div>
                  ))}
              </section>
            ))
          )}
        </div>
        <footer className="st-modal-foot">
          {busy && <span className="st-muted">{busy}</span>}
          <span className="st-selbar-gap" />
          {review ? (
            <>
              <button type="button" onClick={() => setReview(false)} disabled={!!busy}>
                Zurück
              </button>
              <button type="button" className="is-primary" onClick={onApply} disabled={!!busy || !taken.length}>
                Jetzt übernehmen
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={onCancel} disabled={!!busy}>
                Abbrechen
              </button>
              <button type="button" className="is-primary" onClick={() => setReview(true)} disabled={!!busy || !taken.length}>
                {`${taken.length} ${taken.length === 1 ? 'Änderung' : 'Änderungen'} übernehmen …`}
              </button>
            </>
          )}
        </footer>
      </div>
      {extra}
    </div>
  );
}

const short = (t: string) => (t.length > 70 ? `${t.slice(0, 70)} …` : t);

// ---- a statement's wording and question, edited in the window ----
export interface StatementEdit {
  text: string;
  question: string;
}
const editOf = (i: ItemDoc): StatementEdit => ({ text: workingText(i), question: i.question ?? '' });
const sameEdit = (a: StatementEdit, b: StatementEdit) => a.text.trim() === b.text.trim() && a.question.trim() === b.question.trim();
// the item with an edited wording / question: the German version when there is
// one (the original note stays), else the note itself (its first wording kept)
function withEdit(i: ItemDoc, e: StatementEdit, orig: StatementEdit, text: boolean): ItemDoc {
  let out = i;
  if (e.question.trim() !== orig.question.trim()) out = { ...out, question: e.question.trim() || undefined, questionOwn: true };
  if (text && e.text.trim() && e.text.trim() !== orig.text.trim())
    out = out.de ? { ...out, de: e.text.trim(), deAuto: false, deStale: false } : { ...out, text: e.text.trim(), original: out.original ?? out.text };
  return out;
}

function ResetBtn({ disabled, onClick, what }: { disabled: boolean; onClick: () => void; what: string }) {
  return (
    <button type="button" className="st-reset" disabled={disabled} onClick={onClick} aria-label={`${what} zurücksetzen`} title={disabled ? `${what}: unverändert` : `${what} auf den Stand beim Öffnen zurücksetzen`}>
      <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 12a8 8 0 1 0 2.6-5.9M4 4v4.5h4.5" />
      </svg>
    </button>
  );
}

// a small confirmation above the window (Esc or "Abbrechen" keeps everything)
function ConfirmReset({ text, onYes, onNo }: { text: string; onYes: () => void; onNo: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onNo();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onNo]);
  return (
    <div className="st-confirm-back" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onNo()}>
      <div className="st-confirm" role="alertdialog" aria-modal="true" aria-labelledby="st-confirm-title">
        <h3 id="st-confirm-title">Zurücksetzen?</h3>
        <p>{text}</p>
        <div className="st-confirm-actions">
          <button type="button" onClick={onNo} autoFocus>
            Abbrechen
          </button>
          <button type="button" className="is-primary" onClick={onYes}>
            Zurücksetzen
          </button>
        </div>
      </div>
    </div>
  );
}

// the question (when the statement has one) and the wording, editable
function StatementFields({ e, orig, onChange }: { e: StatementEdit; orig: StatementEdit; onChange: (e: StatementEdit) => void }) {
  return (
    <div className="st-stmt-edit">
      {(orig.question || e.question) && (
        <label className="st-stmt-q">
          <span className="st-muted">Frage</span>
          <input value={e.question} onChange={(x) => onChange({ ...e, question: x.target.value })} aria-label="Frage bearbeiten" data-notr />
        </label>
      )}
      <label className="st-stmt-t">
        <span className="st-muted">Aussage</span>
        <textarea rows={Math.min(7, Math.max(2, Math.ceil(e.text.length / 52)))} value={e.text} onChange={(x) => onChange({ ...e, text: x.target.value })} aria-label="Aussage bearbeiten" data-notr />
      </label>
    </div>
  );
}
// the version a statement is shown and reworded in
export const workingText = (i: ItemDoc) => i.de || i.text;

async function store(study: Study, put: Put[], reason: string, what: string) {
  await study.saveVersion(`vor ${reason}`);
  if (put.length) study.commit(put);
  logChange(study, what);
}

// ---- statements reworded ----
export interface Rewrite {
  id: string;
  text: string;
}
export function RewriteReview({ study, items, rewrites, criteria, onClose }: { study: Study; items: Map<string, ItemDoc>; rewrites: Rewrite[]; criteria: string; onClose: (msg?: string) => void }) {
  const list = rewrites.filter((r) => items.has(r.id) && r.text.trim() !== workingText(items.get(r.id)!).trim());
  const [texts, setTexts] = useState<Record<string, string>>(() => Object.fromEntries(list.map((r) => [r.id, r.text])));
  const [picks, setPicks] = useState<Record<string, Pick>>(() => Object.fromEntries(list.map((r) => [r.id, 'neu' as Pick])));
  const [busy, setBusy] = useState<string | null>(null);
  const setPick = (id: string, p: Pick) => setPicks((x) => ({ ...x, [id]: p }));
  // one statement again, by a short hint of what should change; the text before is kept for "↶"
  const [hints, setHints] = useState<Record<string, string>>({});
  const [before, setBefore] = useState<Record<string, string>>({});
  const [working, setWorking] = useState<Record<string, string | null>>({});
  // the current wording and question, editable here; the AI's proposal as it came (for ↺)
  const [orig] = useState<Record<string, StatementEdit>>(() => Object.fromEntries(list.map((r) => [r.id, editOf(items.get(r.id)!)])));
  const [edits, setEdits] = useState<Record<string, StatementEdit>>(() => Object.fromEntries(list.map((r) => [r.id, editOf(items.get(r.id)!)])));
  const [proposed] = useState<Record<string, string>>(() => Object.fromEntries(list.map((r) => [r.id, r.text])));
  const [ask, setAsk] = useState<{ text: string; yes: () => void } | null>(null);
  const edited = new Set(list.filter((r) => !sameEdit(edits[r.id], orig[r.id])).map((r) => r.id));
  async function regenerate(id: string) {
    const hint = (hints[id] ?? '').trim();
    if (!hint || working[id] === 'KI arbeitet …') return;
    const i = study.latest().items[id] ?? items.get(id)!;
    setWorking((x) => ({ ...x, [id]: 'KI arbeitet …' }));
    try {
      const [r] = await study.rewrite({ items: [{ id, text: edits[id]?.text.trim() || workingText(i), question: edits[id]?.question.trim() || i.question, hint, previous: texts[id] }], criteria });
      if (!r?.text.trim()) throw new Error('keine Antwort');
      setBefore((x) => ({ ...x, [id]: texts[id] }));
      setTexts((x) => ({ ...x, [id]: r.text.trim() }));
      setPick(id, 'neu');
      setWorking((x) => ({ ...x, [id]: null }));
    } catch (e) {
      setWorking((x) => ({ ...x, [id]: `Nicht neu generiert: ${String((e as Error).message)}` }));
    }
  }
  const rows: Row[] = list.map((r) => {
    const i = items.get(r.id)!;
    return { id: r.id, group: i.link ?? i.person, label: short(workingText(i)) };
  });
  const apply = () => {
    setBusy('Stand wird gesichert, wird übernommen …');
    const put: Put[] = list
      .filter((r) => (picks[r.id] === 'neu' && texts[r.id].trim()) || edited.has(r.id))
      .map((r) => {
        const i = study.latest().items[r.id] ?? items.get(r.id)!;
        const neu = picks[r.id] === 'neu' && !!texts[r.id].trim();
        // the edited question always; the edited current wording when it is kept
        // (or when the statement has no German version yet: then it is the note)
        const base = withEdit(i, edits[r.id], orig[r.id], !neu || !i.de);
        // (the original note stays as it is; the German version is the reworded one)
        return { coll: 'items' as const, id: r.id, data: neu ? { ...base, de: texts[r.id].trim(), deAuto: false, deStale: false } : base };
      });
    void store(study, put, 'KI-Umformulierung', `KI-Umformulierung: ${put.length} Aussagen übernommen`)
      .then(() => onClose(`${put.length} ${put.length === 1 ? 'Aussage' : 'Aussagen'} übernommen.`))
      .catch((e) => setBusy(`Nicht übernommen: ${String((e as Error).message)}`));
  };
  if (!list.length) {
    queueMicrotask(() => onClose('KI: keine Änderungen an den Aussagen vorgeschlagen.'));
    return null;
  }
  return (
    <Shell
      title={`KI-Umformulierung prüfen (${list.length} ${list.length === 1 ? 'Aussage' : 'Aussagen'})`}
      intro="Links die jetzige Fassung, rechts der Vorschlag der KI – rechts frei bearbeitbar. Alle Vorschläge sind vorausgewählt; „Aktuell behalten“, wo nichts geändert werden soll. Übernommen wird in die deutsche Fassung; die Originalnotiz bleibt unverändert."
      rows={rows}
      picks={picks}
      setPick={setPick}
      busy={busy}
      onCancel={() => onClose('KI-Umformulierung verworfen: nichts übernommen.')}
      onApply={apply}
      edited={edited}
      blocked={!!ask}
      extra={ask && <ConfirmReset text={ask.text} onNo={() => setAsk(null)} onYes={() => (ask.yes(), setAsk(null))} />}
      render={(id) => {
        const cur = edits[id].text;
        const d = diffWords(cur, texts[id]);
        const on = picks[id];
        return (
          <div className="st-panes">
            <div className={`st-pane is-current${on === 'alt' ? ' is-chosen' : ' is-dropped'}`}>
              <div className="st-pane-head">
                Aktuell (bearbeitbar)
                <ResetBtn
                  what="Aktuelle Aussage"
                  disabled={sameEdit(edits[id], orig[id])}
                  onClick={() => setAsk({ text: 'Die aktuelle Aussage und ihre Frage auf den gespeicherten Stand zurücksetzen? Deine Änderungen hier gehen verloren.', yes: () => setEdits((x) => ({ ...x, [id]: orig[id] })) })}
                />
              </div>
              <StatementFields e={edits[id]} orig={orig[id]} onChange={(e) => setEdits((x) => ({ ...x, [id]: e }))} />
              <p className="st-pane-text st-pane-diff" data-notr>
                <Words pieces={d.left} />
              </p>
            </div>
            <div className={`st-pane is-incoming${on === 'neu' ? ' is-chosen' : ' is-dropped'}`}>
              <div className="st-pane-head">
                Neu (bearbeitbar)
                <ResetBtn
                  what="Neuer Vorschlag"
                  disabled={texts[id] === proposed[id]}
                  onClick={() =>
                    setAsk({
                      text: 'Den neuen Vorschlag auf den Stand beim Öffnen zurücksetzen (den ersten Vorschlag der KI)? Deine Änderungen und neu generierte Fassungen gehen verloren.',
                      yes: () => {
                        setTexts((x) => ({ ...x, [id]: proposed[id] }));
                        setBefore((x) => {
                          const n = { ...x };
                          delete n[id];
                          return n;
                        });
                      },
                    })
                  }
                />
              </div>
              <textarea
                className="st-pane-edit"
                rows={3}
                value={texts[id]}
                onChange={(e) => {
                  setTexts((x) => ({ ...x, [id]: e.target.value }));
                  setPick(id, 'neu');
                }}
                aria-label="Neue Fassung bearbeiten"
              />
              <p className="st-pane-text st-pane-diff" data-notr>
                <Words pieces={d.right} />
              </p>
              <div className="st-regen">
                <input
                  value={hints[id] ?? ''}
                  onChange={(e) => setHints((x) => ({ ...x, [id]: e.target.value }))}
                  onKeyDown={(e) => e.key === 'Enter' && void regenerate(id)}
                  placeholder="Was soll sich ändern? z. B. kürzer, ohne Wertung, Präsens"
                  aria-label="Hinweis an die KI für diese Aussage"
                />
                <button
                  type="button"
                  disabled={!(hints[id] ?? '').trim() || working[id] === 'KI arbeitet …'}
                  onClick={() => void regenerate(id)}
                  title={'Die KI formuliert nur diese Aussage noch einmal – nach deinem Hinweis links daneben. Der bisherige Vorschlag lässt sich mit „↶“ zurückholen.\nBeispiel: Hinweis „kürzer“ → „Crafting-Menü schwer auffindbar.“'}
                >
                  Neu generieren
                </button>
                {before[id] != null && (
                  <button
                    type="button"
                    className="st-linkbtn"
                    onClick={() => {
                      const back = before[id];
                      setBefore((x) => ({ ...x, [id]: texts[id] }));
                      setTexts((x) => ({ ...x, [id]: back }));
                    }}
                    title="Den Vorschlag vor dem letzten Neu-Generieren zurückholen (noch einmal: wieder vor)"
                  >
                    ↶ vorheriger Vorschlag
                  </button>
                )}
              </div>
              {working[id] && <p className="st-muted st-regen-msg">{working[id]}</p>}
            </div>
          </div>
        );
      }}
    />
  );
}

// ---- tags suggested ----
export interface TagProposal {
  id: string;
  chips: string[]; // the whole set it would carry
  findings: string[]; // the recurring findings it would belong to (its own plus the suggested one)
  newFinding: string | null;
}
// the review window for tags: the AI's suggestions, or a coding file (source
// 'file': its own title and intro, the file's review note per statement, and a
// statement marked "Prüfung erforderlich" is set back to unchecked)
export interface TagSource {
  title: string;
  intro: string;
  reason: string; // the version saved before ("vor …") and the log line
  notes: Record<string, { review: boolean; reason: string | null }>;
}
export function TagReview({ study, tags, items, proposals, onClose, source }: { study: Study; tags: TagGroup[]; items: Map<string, ItemDoc>; proposals: TagProposal[]; onClose: (msg?: string) => void; source?: TagSource }) {
  const list = proposals.filter((p) => items.has(p.id));
  const [sets, setSets] = useState<Record<string, { chips: string[]; findings: string[] }>>(() => Object.fromEntries(list.map((p) => [p.id, { chips: p.chips, findings: p.findings }])));
  const [picks, setPicks] = useState<Record<string, Pick>>(() => Object.fromEntries(list.map((p) => [p.id, 'neu' as Pick])));
  const [busy, setBusy] = useState<string | null>(null);
  const setPick = (id: string, p: Pick) => setPicks((x) => ({ ...x, [id]: p }));
  // the wording and question, editable here; ↺ brings back the state at opening
  const [orig] = useState<Record<string, StatementEdit>>(() => Object.fromEntries(list.map((p) => [p.id, editOf(items.get(p.id)!)])));
  const [edits, setEdits] = useState<Record<string, StatementEdit>>(() => Object.fromEntries(list.map((p) => [p.id, editOf(items.get(p.id)!)])));
  const [ask, setAsk] = useState<{ text: string; yes: () => void } | null>(null);
  const edited = new Set(list.filter((p) => !sameEdit(edits[p.id], orig[p.id])).map((p) => p.id));
  const sameSet = (a: { chips: string[]; findings: string[] }, p: TagProposal) => a.chips.join() === p.chips.join() && a.findings.join() === p.findings.join();
  const findings = Object.values(study.docs.findings).sort((a, b) => a.name.localeCompare(b.name));
  const groupOf = (c: string) => tags.find((g) => g.chips.some((x) => x.id === c));
  const label = (c: string) => tags.flatMap((g) => g.chips).find((x) => x.id === c)?.label ?? c;
  const edit = (id: string, f: (s: { chips: string[]; findings: string[] }) => { chips: string[]; findings: string[] }) => {
    setSets((x) => ({ ...x, [id]: f(x[id]) }));
    setPick(id, 'neu');
  };
  const add = (id: string, chip: string) =>
    edit(id, (s) => {
      const g = groupOf(chip);
      // (a single-choice group: the new tag replaces the group's other one)
      const rest = g && !g.multi ? s.chips.filter((c) => !g.chips.some((x) => x.id === c)) : s.chips;
      return { ...s, chips: [...rest, chip] };
    });
  const rows: Row[] = list.map((p) => {
    const i = items.get(p.id)!;
    return { id: p.id, group: i.link ?? i.person, label: short(workingText(i)) };
  });
  const apply = () => {
    setBusy('Stand wird gesichert, wird übernommen …');
    const put: Put[] = list
      .filter((p) => picks[p.id] === 'neu' || edited.has(p.id))
      .map((p) => {
        // the edited wording and question, whichever tags are kept
        const i = withEdit(study.latest().items[p.id] ?? items.get(p.id)!, edits[p.id], orig[p.id], true);
        if (picks[p.id] !== 'neu') return { coll: 'items' as const, id: p.id, data: i };
        const s = sets[p.id];
        // (tags of categories that do not apply are not stored)
        const chips = effectiveChips(s.chips, tags, new Map(tags.flatMap((g) => g.chips.map((c) => [c.id, c.role] as const))));
        const recheck = source?.notes[p.id]?.review;
        return { coll: 'items' as const, id: p.id, data: { ...setFindings(i, s.findings), chips, suggested: i.suggested.filter((c) => !chips.includes(c)), suggestedFinding: null, suggestedNewFinding: p.newFinding ?? i.suggestedNewFinding ?? null, ...(recheck ? { confirmed: false } : {}) } };
      });
    const reason = source?.reason ?? 'KI-Tags';
    void store(study, put, reason, `${reason}: ${put.length} Aussagen übernommen`)
      .then(() => onClose(`Tags für ${put.length} ${put.length === 1 ? 'Aussage' : 'Aussagen'} übernommen.`))
      .catch((e) => setBusy(`Nicht übernommen: ${String((e as Error).message)}`));
  };
  if (!list.length) {
    queueMicrotask(() => onClose(source ? 'Tag-Datei: keine abweichenden Tags.' : 'KI: keine neuen Tags vorgeschlagen.'));
    return null;
  }
  return (
    <Shell
      title={source ? `${source.title} (${list.length} ${list.length === 1 ? 'Aussage' : 'Aussagen'})` : `KI-Tags prüfen (${list.length} ${list.length === 1 ? 'Aussage' : 'Aussagen'})`}
      intro={source?.intro ?? 'Links die jetzigen Tags, rechts der Vorschlag der KI (neu hinzukommende hervorgehoben). Rechts lässt sich alles anpassen: × entfernt einen Tag, „+ Tag“ fügt einen hinzu, der Befund ist wählbar. Alle Vorschläge sind vorausgewählt; „Aktuell behalten“, wo nichts geändert werden soll.'}
      rows={rows}
      picks={picks}
      setPick={setPick}
      busy={busy}
      onCancel={() => onClose(source ? 'Tag-Datei verworfen: nichts übernommen.' : 'KI-Tags verworfen: nichts übernommen.')}
      onApply={apply}
      edited={edited}
      blocked={!!ask}
      extra={ask && <ConfirmReset text={ask.text} onNo={() => setAsk(null)} onYes={() => (ask.yes(), setAsk(null))} />}
      render={(id) => {
        const i = items.get(id)!;
        const s = sets[id];
        const p = list.find((x) => x.id === id)!;
        const on = picks[id];
        const free = tags.filter((g) => g.chips.some((c) => !s.chips.includes(c.id)));
        return (
          <>
            {source?.notes[id] && (
              <p className={`st-tagrev-note${source.notes[id].review ? ' is-review' : ''}`}>
                <strong>{source.notes[id].review ? 'Prüfung erforderlich' : 'Sicher'}</strong>
                {source.notes[id].review ? ' · wird beim Übernehmen auf „ungeprüft“ gesetzt' : ''}
                {source.notes[id].reason && <span data-notr>{` – ${source.notes[id].reason}`}</span>}
              </p>
            )}
            <div className="st-panes">
              <div className={`st-pane is-current${on === 'alt' ? ' is-chosen' : ' is-dropped'}`}>
                <div className="st-pane-head">
                  Aktuell
                  <ResetBtn
                    what="Aktuelle Aussage"
                    disabled={sameEdit(edits[id], orig[id])}
                    onClick={() => setAsk({ text: 'Aussage und Frage auf den gespeicherten Stand zurücksetzen? Deine Änderungen hier gehen verloren.', yes: () => setEdits((x) => ({ ...x, [id]: orig[id] })) })}
                  />
                </div>
                <StatementFields e={edits[id]} orig={orig[id]} onChange={(e) => setEdits((x) => ({ ...x, [id]: e }))} />
                <div className="st-tagrev">
                  {i.chips.length ? i.chips.map((c) => <span key={c} className="st-chip is-on is-small" title={groupOf(c)?.name}>{label(c)}</span>) : <span className="st-muted">keine Tags</span>}
                </div>
                <p className="st-muted st-tagrev-finding">{`Befund: ${findingsOf(i).map((f) => study.docs.findings[f]?.name ?? '?').join('; ') || '–'}`}</p>
              </div>
              <div className={`st-pane is-incoming${on === 'neu' ? ' is-chosen' : ' is-dropped'}`}>
                <div className="st-pane-head">
                  Neu (bearbeitbar)
                  <ResetBtn
                    what="Neue Tags"
                    disabled={sameSet(s, p)}
                    onClick={() => setAsk({ text: `Tags und Befund rechts auf den Stand beim Öffnen zurücksetzen (${source ? 'wie in der Datei' : 'den Vorschlag der KI'})? Deine Änderungen rechts gehen verloren.`, yes: () => setSets((x) => ({ ...x, [id]: { chips: p.chips, findings: p.findings } })) })}
                  />
                </div>
                <div className="st-tagrev">
                  {s.chips.map((c) => (
                    <span key={c} className={`st-chip is-on is-small${i.chips.includes(c) ? '' : ' is-added'}`} title={groupOf(c)?.name}>
                      {label(c)}
                      <button type="button" className="st-chip-x" onClick={() => edit(id, (x) => ({ ...x, chips: x.chips.filter((y) => y !== c) }))} aria-label={`${label(c)} entfernen`}>
                        ×
                      </button>
                    </span>
                  ))}
                  {free.length > 0 && (
                    <select className="st-chip-add" value="" onChange={(e) => e.target.value && add(id, e.target.value)} aria-label="Tag hinzufügen">
                      <option value="">+ Tag</option>
                      {free.map((g) => (
                        <optgroup key={g.id} label={g.name}>
                          {g.chips
                            .filter((c) => !s.chips.includes(c.id))
                            .map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.label}
                              </option>
                            ))}
                        </optgroup>
                      ))}
                    </select>
                  )}
                </div>
                <div className="st-tagrev st-tagrev-finding">
                  <span className="st-muted">Befund</span>
                  {s.findings.map((f) => (
                    <span key={f} className={`st-chip is-finding is-small${findingsOf(i).includes(f) ? '' : ' is-added'}`}>
                      {study.docs.findings[f]?.name ?? '?'}
                      <button type="button" className="st-chip-x" onClick={() => edit(id, (x) => ({ ...x, findings: x.findings.filter((y) => y !== f) }))} aria-label={`Befund ${study.docs.findings[f]?.name ?? ''} entfernen`}>
                        ×
                      </button>
                    </span>
                  ))}
                  {findings.some((f) => !s.findings.includes(f.id)) && (
                    <select className="st-chip-add" value="" onChange={(e) => e.target.value && edit(id, (x) => ({ ...x, findings: [...x.findings, e.target.value] }))} aria-label="Befund hinzufügen">
                      <option value="">+ Befund</option>
                      {findings
                        .filter((f) => !s.findings.includes(f.id))
                        .map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                    </select>
                  )}
                </div>
                {p.newFinding && <p className="st-muted">{`Vorschlag neuer Befund: „${p.newFinding}“ (unter Wiederkehrende Befunde anlegen)`}</p>}
              </div>
            </div>
          </>
        );
      }}
    />
  );
}
