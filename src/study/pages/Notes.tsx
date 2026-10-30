// Notizen: the session notes as single statements with tag chips. The AI
// suggests chips (shown hollow); only chips confirmed here count anywhere.
// Also: the notes import, the priority view, the tag editor, and the lists
// of the Übersicht.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Chip, ChipRole, ItemDoc, NotesMeta, Section as Sec, TagGroup } from '../types';
import { CATEGORY, hintOf, ROLE_NAME, SECTION_LABEL, type BuiltinRole, type CategoryRole, type MeaningsSetting } from '../types';
import { categoryMeanings, distinctPersons, effectiveChips, findingsOf, groupActive, itemsWithRole, linkKeyOf, meaningsSetting, setFindings, shortName, withFinding, withoutFinding, type Model, type Person } from '../model';
import { linkLabelOf, parseNotes, planNotes } from '../notes';
import type { Change } from '../changes';
import { applyChanges, ChangeModal } from '../ChangeModal';
import { RewriteReview, TagReview, workingText, type Rewrite, type TagProposal } from '../AiReview';
import { planFreeText } from '../tallyPlan';
import { designOfItem } from './Codes';
import { itemText, setContentView, translateNotes, useContentView, type ContentView } from '../translations';
import { Empty, LazyArea, logChange, Section, useCtx, type Ctx } from '../ui';

// ---- chip logic ----
const groupOfChip = (tags: TagGroup[], chip: string) => tags.find((g) => g.chips.some((c) => c.id === chip));
export function toggleChip(item: ItemDoc, g: TagGroup, chip: string): ItemDoc {
  const inGroup = new Set(g.chips.map((c) => c.id));
  if (item.chips.includes(chip)) return { ...item, chips: item.chips.filter((c) => c !== chip) };
  const chips = g.multi ? [...item.chips, chip] : [...item.chips.filter((c) => !inGroup.has(c)), chip];
  const suggested = g.multi ? item.suggested.filter((c) => c !== chip) : item.suggested.filter((c) => !inGroup.has(c));
  return { ...item, chips, suggested };
}
// the tags of categories that no longer apply leave the statement (hidden is not
// kept: e.g. "Problem" → "Anmerkung" drops the priority, it never counts unseen)
export function pruneHidden(item: ItemDoc, tags: TagGroup[]): ItemDoc {
  const role = new Map(tags.flatMap((g) => g.chips.map((c) => [c.id, c.role] as const)));
  const chips = effectiveChips(item.chips, tags, role);
  const suggested = item.suggested.filter((c) => effectiveChips([...chips, c], tags, role).includes(c));
  return chips.length === item.chips.length && suggested.length === item.suggested.length ? item : { ...item, chips, suggested };
}
// add a tag (several statements at once): never takes one off; in a
// single-choice group it replaces the group's other tag
export function setChip(item: ItemDoc, g: TagGroup, chip: string): ItemDoc {
  return item.chips.includes(chip) ? item : toggleChip(item, g, chip);
}
// checked: only the tags chosen count; suggestions not clicked are dropped, never taken over
export function confirmItem(item: ItemDoc, tags: TagGroup[]): ItemDoc {
  const chips = item.chips.filter((c) => groupOfChip(tags, c));
  return { ...item, chips, suggested: [], suggestedFinding: null, confirmed: true, status: item.status === 'removed' ? 'removed' : undefined };
}

// ---- AI suggestions ----
// AI suggestions for statements, as proposals to check in TagReview (nothing
// is stored here): per statement the whole set of tags it would carry (its
// own plus the suggested ones; a tag already chosen in a single-choice group
// stays) and the recurring finding
export async function suggestFor(ctx: Ctx, items: ItemDoc[], onProgress?: (done: number, all: number) => void): Promise<TagProposal[]> {
  const { study, model } = ctx;
  const groups = model.tags.map((g) => ({ id: g.id, name: g.name, multi: g.multi, chips: g.chips.filter((c) => c.role !== 'rejected').map((c) => ({ id: c.id, label: c.label })) })).filter((g) => g.chips.length);
  const findings = Object.values(study.docs.findings).map((f) => ({ id: f.id, name: f.name }));
  const findingIds = new Set(findings.map((f) => f.id));
  const byId = new Map(items.map((i) => [i.id, i]));
  const out: TagProposal[] = [];
  let done = 0;
  // (10 at a time: shorter answers, which the model finishes)
  for (let i = 0; i < items.length; i += 10) {
    const batch = items.slice(i, i + 10);
    const answer = (await study.suggest({ items: batch.map((x) => { const cur = study.latest().items[x.id] ?? x; return { id: x.id, text: cur.de || cur.text, section: SECTION_LABEL[x.section], question: x.question }; }), groups, findings })) as {
      id?: string;
      chips?: Record<string, string[]>;
      finding?: string | null;
      newFinding?: string | null;
    }[];
    for (const s of answer) {
      const it = s.id ? byId.get(s.id) : undefined;
      if (!it) continue;
      const cur = study.latest().items[it.id] ?? it;
      const add: string[] = [];
      for (const g of groups) {
        const tg = model.tags.find((x) => x.id === g.id)!;
        const picked = (s.chips?.[g.id] ?? []).filter((c) => g.chips.some((x) => x.id === c));
        const had = cur.chips.some((c) => tg.chips.some((x) => x.id === c));
        for (const c of g.multi ? picked : had ? [] : picked.slice(0, 1)) if (!cur.chips.includes(c)) add.push(c);
      }
      // (a suggested finding joins the ones it already has)
      const own = findingsOf(cur);
      const finding = s.finding && findingIds.has(s.finding) && !own.includes(s.finding) ? s.finding : null;
      const newFinding = !finding && s.newFinding ? String(s.newFinding).slice(0, 120) : null;
      if (!add.length && !finding && !newFinding) continue;
      // (no tags of categories that would not apply, e.g. a priority for a remark)
      out.push({ id: it.id, chips: effectiveChips([...cur.chips, ...add], model.tags, model.chipRole), findings: finding ? [...own, finding] : own, newFinding });
    }
    done += batch.length;
    onProgress?.(done, items.length);
  }
  return out;
}

// ---- import ----
export function NotesImport() {
  const ctx = useCtx();
  const { study, model } = ctx;
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const notes = study.docs.notes.main;

  const [plan, setPlan] = useState<{ title: string; changes: Change[]; reason: string } | null>(null);
  const tagLabel = (id: string) => model.chipLabel.get(id) ?? '';

  // read the file and show what it would change; nothing is stored yet
  function run(src: string, file?: string) {
    const parsed = parseNotes(src);
    if (!parsed.meta.length) return setMsg('Keine Teilnehmenden gefunden (jeder Block beginnt mit der P-ID, z. B. „P001“).');
    // the header's link names which of a person's links the block is about
    for (const s of parsed.statements) {
      const meta = parsed.meta.find((m) => m.id === s.person);
      const raw = s.link ?? meta?.link ?? '';
      s.link = /^P\d+\.\d$/.test(raw) ? raw : meta ? linkLabelOf({ ...meta, link: raw }, model) : undefined;
    }
    setMsg(null);
    setPlan({ title: `Notizen-Import${file ? `: ${file}` : ''} (${parsed.meta.map((m) => m.id).join(', ')})`, changes: planNotes(parsed, study.latest(), tagLabel, file, src), reason: `Notizen-Import${file ? ` (${file})` : ''}` });
  }

  // after "Übernehmen": German drafts and AI suggestions for what came in new or changed
  async function after(summary: string) {
    setMsg(`${summary}.`);
    setBusy(true);
    try {
      const n = await translateNotes(study, undefined, (d, a) => setMsg(`Deutsche Fassungen: ${d} von ${a} …`));
      if (n) setMsg(`${summary}. ${n} deutsche Fassungen erstellt (automatisch, bitte prüfen).`);
    } catch (e) {
      setMsg(`${summary}. Deutsche Fassungen nicht verfügbar (${String((e as Error).message)}).`);
    } finally {
      setBusy(false);
    }
    const todo = Object.values(study.latest().items).filter((p) => (p.status === 'new' || p.status === 'changed') && !p.confirmed && !p.chips.length);
    if (todo.length) {
      setBusy(true);
      try {
        const found = await suggestFor(ctx, todo, (d, a) => setMsg(`KI-Vorschläge: ${d} von ${a} …`));
        if (found.length) setTagPlan(found);
        setMsg(found.length ? `KI-Tags für ${found.length} Aussagen: im Fenster prüfen.` : 'KI: keine neuen Tags vorgeschlagen.');
      } catch (e) {
        setMsg(`Import fertig; KI-Vorschläge nicht verfügbar (${String((e as Error).message)}).`);
      } finally {
        setBusy(false);
      }
    }
  }
  const [applying, setApplying] = useState<string | null>(null);
  const [tagPlan, setTagPlan] = useState<TagProposal[] | null>(null);

  return (
    <Section title="Testnotizen: Datei oder Text" id="st-notes-detail">
      <div className="st-toolbar">
        <label className="st-file">
          Datei wählen (.md, .txt)
          <input
            id="st-notes-file"
            type="file"
            accept=".md,.txt,text/plain,text/markdown"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = ''; // (the same file again opens the check again)
              if (f) void f.text().then((t) => run(t, f.name));
            }}
          />
        </label>
        {notes && <span className="st-muted">{`${notes.file ?? 'eingefügt'} · ${new Date(notes.importedAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}`}</span>}
      </div>
      <textarea className="st-paste" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={'P001\nName\nLink\nZeitfenster\nAB\n## During Usertesting\n- …\n## Follow-up\n- Frage?\n  - Antwort …'} />
      <div className="st-toolbar">
        <button type="button" disabled={!text.trim() || busy} onClick={() => run(text)}>
          Einlesen
        </button>
        <TallyFreeText />
      </div>
      {msg && <p className="st-note">{msg}</p>}
      {plan && (
        <ChangeModal
          title={plan.title}
          changes={plan.changes}
          busy={applying}
          onCancel={() => {
            setPlan(null);
            setMsg('Abgebrochen: nichts übernommen.');
          }}
          onApply={(choices) => {
            setApplying('Stand wird gesichert, Änderungen werden übernommen …');
            void applyChanges(study, plan.changes, choices, plan.reason)
              .then((summary) => {
                setPlan(null);
                return after(summary);
              })
              .catch((e) => setMsg(`Nicht übernommen: ${String((e as Error).message)}`))
              .finally(() => setApplying(null));
          }}
        />
      )}
      {tagPlan && (
        <TagReview
          study={study}
          tags={model.tags}
          items={new Map(Object.values(study.latest().items).map((i) => [i.id, i]))}
          proposals={tagPlan}
          onClose={(m) => {
            setTagPlan(null);
            if (m) setMsg(m);
          }}
        />
      )}
    </Section>
  );
}

// the Tally free-text answers as statements (section "Umfrage")
function TallyFreeText() {
  const { study, model } = useCtx();
  const [plan, setPlan] = useState<Change[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const cols = model.mapping.map((m, j) => (m.role === 'text' ? { j, label: m.label } : null)).filter((x): x is { j: number; label: string } => !!x);
  if (!cols.length) return null;
  // (shown as changes first: a statement that no longer matches its participant's answer is a conflict)
  const build = (): Change[] => planFreeText(study.latest(), model);
  return (
    <>
      <button type="button" onClick={() => setPlan(build())} title="Freitext-Antworten der Umfrage als Aussagen anlegen bzw. an die aktuelle Zuordnung anpassen">
        Umfrage-Aussagen abgleichen …
      </button>
      {plan && (
        <ChangeModal
          title="Umfrage-Aussagen abgleichen"
          changes={plan}
          busy={busy}
          onCancel={() => setPlan(null)}
          onApply={(choices) => {
            setBusy('Wird übernommen …');
            void applyChanges(study, plan, choices, 'Tally-Freitexte')
              .then(() => setPlan(null))
              .finally(() => setBusy(null));
          }}
        />
      )}
    </>
  );
}

// ---- one statement, Excel-like: text | a cell of chips per tag group | finding ----
// (onTag: a click that sets or removes the tag on all selected statements at once)
function ChipCell({ item, g, onChange, labelOnly, onTag, many }: { item: ItemDoc; g: TagGroup; onChange: (i: ItemDoc) => void; labelOnly?: boolean; onTag?: (g: TagGroup, chip: string) => void; many?: number }) {
  const { model } = useCtx();
  const tag = (chip: string) => (onTag ? onTag(g, chip) : onChange(pruneHidden(toggleChip(item, g, chip), model.tags)));
  const shown = g.multi || g.chips.length > 5 ? g.chips.filter((c) => item.chips.includes(c.id) || item.suggested.includes(c.id)) : g.chips;
  const rest = g.chips.filter((c) => !shown.includes(c));
  return (
    <div className="st-cell" data-group={g.id}>
      {labelOnly && <span className="st-cell-label">{g.name}</span>}
      {shown.map((c) => (
        <button
          key={c.id}
          type="button"
          className={`st-chip${item.chips.includes(c.id) ? ' is-on' : item.suggested.includes(c.id) ? ' is-suggested' : ''}`}
          title={many ? `gilt für alle ${many} ausgewählten Aussagen` : item.suggested.includes(c.id) ? 'Vorschlag: klicken zum Bestätigen' : undefined}
          onClick={() => tag(c.id)}
        >
          {c.label}
        </button>
      ))}
      {rest.length > 0 && (
        <select className="st-chip-add" value="" onChange={(e) => e.target.value && tag(e.target.value)} aria-label={`${g.name} hinzufügen`}>
          <option value="">+</option>
          {rest.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

// ---- a participant's header: name, links, slot, group; editable, links can be added ----
// (each link with a ?k= key counts as this participant's run, so all their runs are tracked)
function PersonInfo({ pid, meta, person }: { pid: string; meta?: NotesMeta; person?: Person }) {
  const { study } = useCtx();
  const [edit, setEdit] = useState(false);
  const blank: NotesMeta = { id: pid, name: '', link: '', slot: '', group: '' };
  const [draft, setDraft] = useState<NotesMeta>(meta ?? blank);
  const links = (m: NotesMeta) => [m.link, ...(m.links ?? [])].filter((l) => l.trim());
  const shown = links(meta ?? blank);
  // a link the game knows: its label (P005.2); otherwise not found
  const tracked = (l: string) => {
    const k = linkKeyOf(l);
    return k ? person?.links.find((x) => x.key === k)?.label ?? null : null;
  };
  const open = () => {
    const m = meta ?? blank;
    setDraft({ ...m, links: m.links ?? [] });
    setEdit(true);
  };
  const saveIt = () => {
    const ls = links(draft).map((l) => l.trim());
    const next: NotesMeta = { ...draft, id: pid, name: draft.name.trim(), slot: draft.slot.trim(), group: draft.group.trim(), link: ls[0] ?? '', links: ls.slice(1) };
    const all = { ...((study.latest().settings.notesMeta ?? {}) as Record<string, NotesMeta>), [pid]: next };
    study.commit([{ coll: 'settings', id: 'notesMeta', data: all }]);
    logChange(study, `${pid}: Profil bearbeitet (${[next.name && 'Name', 'Links', next.slot && 'Termin', next.group && 'Gruppe'].filter(Boolean).join(', ')})`);
    setEdit(false);
  };
  if (edit) {
    const ls = [draft.link, ...(draft.links ?? [])];
    const setLink = (k: number, v: string) => {
      const n = [...ls];
      n[k] = v;
      setDraft({ ...draft, link: n[0] ?? '', links: n.slice(1) });
    };
    return (
      <div className="st-pinfo-edit">
        <h2>{pid}</h2>
        <label>
          <span className="st-cell-label">Name (nur hier sichtbar)</span>
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </label>
        <label>
          <span className="st-cell-label">Termin</span>
          <input value={draft.slot} onChange={(e) => setDraft({ ...draft, slot: e.target.value })} placeholder="11:00-12:00 (21.10.26)" />
        </label>
        <label>
          <span className="st-cell-label">Gruppe</span>
          <input value={draft.group} onChange={(e) => setDraft({ ...draft, group: e.target.value })} />
        </label>
        <div className="st-pinfo-links">
          <span className="st-cell-label">Links (je Durchlauf einer)</span>
          {ls.map((l, k) => (
            <div key={k} className="st-pinfo-link">
              <span className="st-muted">{`Link ${k + 1}`}</span>
              <input value={l} onChange={(e) => setLink(k, e.target.value)} placeholder="https://…/intro/1?k=…" aria-label={`Link ${k + 1}`} />
              <span className="st-pinfo-state">{l.trim() && (tracked(l) ? <span className="st-badge">{`getrackt als ${tracked(l)}`}</span> : linkKeyOf(l) ? <span className="st-muted">wird nach dem Speichern zugeordnet</span> : <span className="st-flag">kein ?k=-Schlüssel</span>)}</span>
              <button type="button" className="st-linkbtn" onClick={() => setDraft({ ...draft, link: k === 0 ? (ls[1] ?? '') : draft.link, links: k === 0 ? ls.slice(2) : ls.slice(1).filter((_, j) => j !== k - 1) })} aria-label={`Link ${k + 1} entfernen`}>
                entfernen
              </button>
            </div>
          ))}
          <button type="button" className="st-linkbtn" onClick={() => setDraft({ ...draft, links: [...(draft.links ?? []), ''] })}>
            + Link
          </button>
        </div>
        <div className="st-pinfo-foot">
          <button type="button" onClick={() => setEdit(false)}>
            Abbrechen
          </button>
          <button type="button" className="is-primary" onClick={saveIt}>
            Speichern
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="st-pinfo" onClick={open} title="Klicken: Angaben bearbeiten, Links hinzufügen">
      <h2>{pid}</h2>
      {meta?.name && <span className="st-name" data-notr>{meta.name}</span>}
      {shown.map((l, k) => (
        <span key={k} className="st-muted" data-notr>
          {shown.length > 1 && !/^link\s*\d/i.test(l) ? `Link ${k + 1}: ${l}` : l}
          {linkKeyOf(l) && !tracked(l) && <span className="st-flag">nicht im Spiel gefunden</span>}
        </span>
      ))}
      {meta?.slot && <span className="st-muted" data-notr>{meta.slot}</span>}
      {meta?.group && <span className="st-muted">Gruppe {meta.group}</span>}
      {person?.groupMismatch && <span className="st-flag">Tracking: {person.trackedGroup}</span>}
      {person?.excluded && <span className="st-flag">ausgeschlossen</span>}
      {!!person?.links.length && <span className="st-muted">{`getrackt: ${person.links.map((x) => x.label).join(', ')}`}</span>}
      <button type="button" className="st-linkbtn" onClick={(e) => (e.stopPropagation(), open())}>
        bearbeiten · + Link
      </button>
    </div>
  );
}

const EDITORS_KEY = 'asciia-study-tag-editors';
function openEditors(): Set<string> {
  try {
    const v = JSON.parse(sessionStorage.getItem(EDITORS_KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}
function rememberEditor(id: string, open: boolean) {
  try {
    const s = openEditors();
    if (open) s.add(id);
    else s.delete(id);
    sessionStorage.setItem(EDITORS_KEY, JSON.stringify([...s]));
  } catch {
    // (not remembered)
  }
}

function ItemRow({ item, model, save, remove, fresh, selected, onSelect, onTag, many }: { item: ItemDoc; model: Model; save: (i: ItemDoc) => void; remove: (i: ItemDoc) => void; fresh?: boolean; selected?: boolean; onSelect?: (shift: boolean) => void; onTag?: (g: TagGroup, chip: string) => void; many?: number }) {
  const { study } = useCtx();
  const view = useContentView();
  const [editDe, setEditDe] = useState(false);
  const [editQ, setEditQ] = useState(false);
  // (a question shared by several statements is changed for all of them, unless "nur diese Aussage")
  const [qOnlyThis, setQOnlyThis] = useState(false);
  // a statement just added: open for typing and scrolled into view
  const [editOrig, setEditOrig] = useState(!!fresh);
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (fresh) rowRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [fresh]);
  // a new statement left without text goes again
  useEffect(() => {
    if (!editOrig && !item.text && item.manual) remove(item);
  }, [editOrig]); // eslint-disable-line react-hooks/exhaustive-deps
  const [showInt, setShowInt] = useState(!!item.interpretation);
  const [showAdd, setShowAdd] = useState(!!item.addition);
  // (open editors are remembered for the tab, so a reload comes back to the same page height)
  const [tagsOpen, setTagsOpenState] = useState(() => openEditors().has(item.id));
  const setTagsOpen = (f: (x: boolean) => boolean) =>
    setTagsOpenState((x) => {
      const v = f(x);
      rememberEditor(item.id, v);
      return v;
    });
  // the statement before "Geprüft", for undoing it
  const before = useRef<ItemDoc | null>(null);
  const tagIt = (g: TagGroup, chip: string) => (onTag ? onTag(g, chip) : save(pruneHidden(toggleChip(item, g, chip), model.tags)));
  // (a category that does not apply to this statement is hidden, e.g. Priorität without "Problem")
  const applies = (g: TagGroup) => groupActive(g, item.chips.filter((c) => !g.chips.some((x) => x.id === c)), model.chipRole);
  const chipsOf = (ids: string[]) => model.tags.filter(applies).flatMap((g) => g.chips.filter((c) => ids.includes(c.id)).map((c) => ({ g, c })));
  const onChips = chipsOf(item.chips);
  const sugChips = chipsOf(item.suggested.filter((c) => !item.chips.includes(c)));
  const findings = Object.values(study.docs.findings).sort((a, b) => a.name.localeCompare(b.name));
  const sf = item.suggestedFinding ? study.docs.findings[item.suggestedFinding] : null;
  const open = item.suggested.length > 0 || !!item.suggestedFinding;
  const d = designOfItem(item);
  // the original: corrections are logged with before and after; new lines split the statement
  const saveOriginal = (draft: string) => {
    // a new statement: its first wording (not a correction); left empty, it goes again
    if (!item.text) {
      const t = draft.trim();
      if (!t) return remove(item);
      return save({ ...item, text: t, original: t });
    }
    const parts = draft
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean);
    if (!parts.length || (parts.length === 1 && parts[0] === item.text)) return;
    logChange(study, `${item.person}: Original korrigiert „${item.text}“ → „${parts.join(' | ')}“`);
    save({ ...item, original: item.original ?? item.text, text: parts[0], deStale: !!item.de });
    parts.slice(1).forEach((t, i) => save({ ...item, id: `${item.id}-${Date.now().toString(36)}${i}`, original: t, text: t, de: undefined, deAuto: undefined, order: item.order + (i + 1) / 100, chips: [...item.chips], suggested: [], manual: true }));
  };
  // the follow-up question: changed on every answer of that person under the same question
  const sharing = () => Object.values(study.latest().items).filter((i) => i.person === item.person && i.section === item.section && i.question === item.question);
  const saveQuestion = (draft: string) => {
    const q = draft.trim().replace(/\s*\n\s*/g, ' ') || undefined;
    if (q === item.question) return;
    logChange(study, `${item.person}: Frage geändert „${item.question ?? ''}“ → „${q ?? ''}“`);
    const same = item.question && !qOnlyThis ? sharing() : [item];
    for (const i of same) save({ ...i, question: q, questionOwn: true });
  };
  const saveDe = (de: string) => save({ ...item, de: de.trim() || undefined, deAuto: false, deStale: false });
  const deBlock = (
    <div className="st-de">
      {editDe ? (
        <LazyArea value={item.de ?? ''} onSave={saveDe} autoFocus onDone={() => setEditDe(false)} placeholder="Deutsche Fassung" />
      ) : item.de ? (
        <p data-notr onClick={() => setEditDe(true)} title="Klicken: bearbeiten">
          {item.de}
        </p>
      ) : !showInt ? (
        <button type="button" className="st-linkbtn" onClick={() => setShowInt(true)}>
          + Interpretation hinzufügen
        </button>
      ) : null}
      {item.de && (item.deAuto || item.deStale) && (
        <div className="st-item-meta">
          {item.deAuto && <span className="st-badge">automatisch</span>}
          {item.deStale && <span className="st-flag">Original geändert – Übersetzung prüfen</span>}
          <button type="button" className="st-linkbtn" onClick={() => save({ ...item, deAuto: false, deStale: false })}>
            als geprüft übernehmen
          </button>
        </div>
      )}
    </div>
  );
  const origBlock = (
    <div className={view === 'both' ? 'st-orig is-secondary' : 'st-orig'}>
      {view === 'both' && <span className="st-cell-label">Original</span>}
      {editOrig ? (
        <>
          <LazyArea value={item.text} onSave={saveOriginal} autoFocus onDone={() => setEditOrig(false)} placeholder="Neue Aussage …" />
          {item.text && <div className="st-muted">Korrektur wird protokolliert · neue Zeile teilt die Aussage · Esc: fertig</div>}
        </>
      ) : (
        <p data-notr className="st-editable" onClick={() => setEditOrig(true)} title="Klicken: Original korrigieren">
          {item.text}
        </p>
      )}
    </div>
  );
  // ---- the tag editor: the main categories first, the rest under "Weitere Details";
  // a category that depends on a tag (e.g. Priorität on "Problem") opens in a darker
  // box right under that tag's row until one is chosen, then sits in the row ----
  const isSub = (g: TagGroup) => !!g.showIf?.length;
  const mainIds = ['bereich', 'art', 'thema'];
  const plain = model.tags.filter((g) => !isSub(g));
  const mainGroups = plain.some((g) => mainIds.includes(g.id)) ? plain.filter((g) => mainIds.includes(g.id)) : plain.slice(0, 3);
  const restGroups = plain.filter((g) => !mainGroups.includes(g));
  const [moreOpen, setMoreOpen] = useState(false);
  const [editingSub, setEditingSub] = useState<string | null>(null);
  // the row a dependent category belongs under: the category of the tag that opened it
  const parentOf = (c: TagGroup) => model.tags.find((g) => g.chips.some((x) => item.chips.includes(x.id) && (c.showIf!.includes(x.id) || c.showIf!.includes(x.role ?? ''))))?.id;
  const subsOf = (g: TagGroup) => model.tags.filter((c) => isSub(c) && applies(c) && parentOf(c) === g.id);
  const head = (g: TagGroup) => (
    <div className="st-tagrow-head">
      <strong>{g.name}</strong>
      {hintOf(g) && <span className="st-muted">{hintOf(g)}</span>}
    </div>
  );
  const plainRow = (g: TagGroup) => (
    <div key={g.id} className="st-tagrow">
      {head(g)}
      <ChipCell item={item} g={g} onChange={save} onTag={onTag} many={many} />
    </div>
  );
  const tagRow = (g: TagGroup) => {
    const subs = subsOf(g);
    return (
      <div key={g.id} className="st-tagrow">
        {head(g)}
        <div className="st-tagrow-main">
          <ChipCell item={item} g={g} onChange={save} />
          {/* (a dependent category already chosen: part of the row, a click changes it) */}
          {subs
            .filter((c) => editingSub !== c.id && c.chips.some((x) => item.chips.includes(x.id)))
            .map((c) => (
              <button key={c.id} type="button" className="st-subchosen" title={`${c.name} ändern`} onClick={() => setEditingSub(c.id)}>
                <span className="st-muted">{c.name}:</span> {c.chips.filter((x) => item.chips.includes(x.id)).map((x) => x.label).join(', ')}
              </button>
            ))}
        </div>
        {subs
          .filter((c) => editingSub === c.id || !c.chips.some((x) => item.chips.includes(x.id)))
          .map((c) => (
            <div key={c.id} className="st-subbox" role="group" aria-label={c.name}>
              <div className="st-subbox-head">
                <strong>{`${c.name} wählen`}</strong>
                {hintOf(c) && <span>{hintOf(c)}</span>}
              </div>
              <ChipCell
                item={item}
                g={c}
                onChange={(i) => {
                  save(i);
                  // (chosen: the box closes and the choice joins the row)
                  if (c.chips.some((x) => i.chips.includes(x.id))) setEditingSub(null);
                }}
              />
            </div>
          ))}
      </div>
    );
  };
  const findingRow = (
    <div className="st-tagrow">
      <div className="st-tagrow-head">
        <strong>Befund</strong>
        <span className="st-muted">Wiederkehrender Befund, zu dem die Aussage gehört (Seite „Wiederkehrende Befunde“).</span>
      </div>
      <div className="st-cell">
        {/* (several possible: a click on one takes it off) */}
        {findingsOf(item).map((f) => (
          <button key={f} type="button" className="st-chip is-finding" title="Klicken: Befund entfernen" onClick={() => save(withoutFinding(item, f))}>
            {study.docs.findings[f]?.name ?? '?'}
          </button>
        ))}
        {sf && (
          <button type="button" className="st-chip is-suggested" title="Befund-Vorschlag: klicken zum Übernehmen" onClick={() => save(withFinding(item, sf.id))}>
            {sf.name}
          </button>
        )}
        {!sf && item.suggestedNewFinding && <span className="st-chip is-suggested is-new" title="neuer Befund vorgeschlagen (unter „Befunde“ anlegen)">{item.suggestedNewFinding}</span>}
        {findings.some((f) => !findingsOf(item).includes(f.id)) && (
          <select className="st-chip-add" value="" onChange={(e) => e.target.value && save(withFinding(item, e.target.value))} aria-label="Befund hinzufügen">
            <option value="">+</option>
            {findings
              .filter((f) => !findingsOf(item).includes(f.id))
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
          </select>
        )}
      </div>
    </div>
  );
  return (
    <div ref={rowRef} data-anchor={`i-${item.id}`} className={`st-item${item.confirmed ? ' is-confirmed' : ''}${item.status ? ` is-${item.status}` : ''}${fresh ? ' is-fresh' : ''}${selected ? ' is-selected' : ''}`}>
      <div className="st-item-text">
        <div className="st-item-meta">
          {onSelect && <input type="checkbox" className="st-item-sel" checked={!!selected} onChange={() => undefined} onClick={(e) => onSelect(e.shiftKey)} aria-label="Auswählen (Umschalt: Bereich)" title="Auswählen (Umschalt: Bereich)" />}
          <span className="st-pid">
            {item.link ?? item.person}
            {d ? ` · ${d}` : ''}
          </span>
          {item.section === 'survey' ? (
            <span>{SECTION_LABEL[item.section]}</span>
          ) : (
            <select
              className="st-item-section"
              value={item.section}
              onChange={(e) => {
                const section = e.target.value as 'during' | 'followup';
                logChange(study, `${item.person}: Bereich „${SECTION_LABEL[item.section]}“ → „${SECTION_LABEL[section]}“ (${item.text.slice(0, 40)}${item.text.length > 40 ? ' …' : ''})`);
                save({ ...item, section, sectionOwn: true });
              }}
              aria-label="Bereich"
              title="Bereich: woher die Aussage stammt (bleibt beim Neu-Import erhalten)"
            >
              <option value="during">{SECTION_LABEL.during}</option>
              <option value="followup">{SECTION_LABEL.followup}</option>
            </select>
          )}
          {item.status === 'changed' && <span className="st-flag">geändert – prüfen</span>}
          {item.status === 'new' && <span className="st-flag">neu</span>}
        </div>
        {editQ ? (
          <div className="st-item-qedit">
            <LazyArea value={item.question ?? ''} onSave={saveQuestion} autoFocus onDone={() => setEditQ(false)} placeholder="Frage zu dieser Aussage …" />
            <div className="st-muted">
              Leer lassen = keine Frage · Esc: fertig
              {item.question && sharing().length > 1 && (
                <label className="st-check">
                  <input type="checkbox" checked={qOnlyThis} onMouseDown={(e) => e.preventDefault()} onChange={(e) => setQOnlyThis(e.target.checked)} />
                  nur diese Aussage (sonst alle {sharing().length} mit dieser Frage)
                </label>
              )}
            </div>
          </div>
        ) : (
          item.question && (
            <div className="st-item-q" data-notr onClick={() => setEditQ(true)} title="Klicken: Frage bearbeiten">
              {item.question}
            </div>
          )
        )}
        {/* (while correcting it, the original is shown in every view) */}
        {view === 'orig' ? origBlock : view === 'de' && !editOrig ? (item.de || editDe ? deBlock : (
          <>
            {origBlock}
            {deBlock}
          </>
        )) : (
          <>
            {origBlock}
            {deBlock}
          </>
        )}
        {showInt && (
          <label className="st-extra">
            <span className="st-cell-label">Interpretation</span>
            <LazyArea value={item.interpretation ?? ''} onSave={(v) => save({ ...item, interpretation: v.trim() || undefined })} autoFocus={!item.interpretation} />
          </label>
        )}
        {showAdd && (
          <label className="st-extra is-addition">
            <span className="st-cell-label">Nachträgliche Ergänzung</span>
            <LazyArea value={item.addition ?? ''} onSave={(v) => save({ ...item, addition: v.trim() || undefined })} autoFocus={!item.addition} />
          </label>
        )}
        {/* the tags in one line; the full editor only on request */}
        <div className="st-tagline">
          {onChips.map(({ g, c }) => (
            <span key={c.id} className="st-chip is-on is-small" title={hintOf(g) ? `${g.name}: ${hintOf(g)}` : g.name}>
              {c.label}
            </span>
          ))}
          {sugChips.map(({ g, c }) => (
            <button key={c.id} type="button" className="st-chip is-suggested is-small" title={many ? `Vorschlag „${g.name}“: übernehmen für alle ${many} ausgewählten` : `Vorschlag „${g.name}“: klicken zum Übernehmen`} onClick={() => tagIt(g, c.id)}>
              {c.label}
            </button>
          ))}
          {findingsOf(item).map((f) => (
            <span key={f} className="st-chip is-finding is-small">{`Befund: ${study.docs.findings[f]?.name ?? '?'}`}</span>
          ))}
          {sf && (
            <button type="button" className="st-chip is-suggested is-small" title="Befund-Vorschlag: klicken zum Übernehmen" onClick={() => save(withFinding(item, sf.id))}>
              {`Befund: ${sf.name}`}
            </button>
          )}
          {!onChips.length && !sugChips.length && !findingsOf(item).length && <span className="st-muted">noch keine Tags</span>}
          {(sugChips.length > 0 || sf) && <span className="st-muted st-sughint">Vorschläge anklicken, um sie zu übernehmen</span>}
          <button type="button" className="st-linkbtn st-tagtoggle" aria-expanded={tagsOpen} onClick={() => setTagsOpen((x) => !x)}>
            {tagsOpen ? 'Tags schließen' : many ? `Tags für ${many} ausgewählte` : 'Tags bearbeiten'}
          </button>
        </div>
      </div>
      <div className="st-item-side">
        <button
          type="button"
          className={item.confirmed && !open ? 'is-on' : ''}
          onClick={() => {
            if (!(item.confirmed && !open)) {
              before.current = item;
              return save(confirmItem(item, model.tags));
            }
            // again: undone; the suggestions it dropped come back (while the page stays open)
            const b = before.current;
            before.current = null;
            save({ ...item, confirmed: b?.confirmed ?? false, ...(b ? { status: b.status, suggested: b.suggested.filter((c) => !item.chips.includes(c)), suggestedFinding: b.suggestedFinding && !findingsOf(item).includes(b.suggestedFinding) ? b.suggestedFinding : null } : {}) });
          }}
          title={item.confirmed && !open ? 'Geprüft. Nochmal klicken: rückgängig' : 'Als geprüft markieren. Nur angeklickte Tags zählen; nicht angeklickte Vorschläge werden verworfen.'}
        >
          {item.confirmed && !open ? 'Geprüft ✓' : 'Geprüft?'}
        </button>
        <MoreMenu
          actions={[
            ['Deutsch bearbeiten', () => setEditDe(true)],
            ['Original korrigieren', () => setEditOrig(true)],
            [item.question ? 'Frage bearbeiten' : 'Frage hinzufügen', () => (setQOnlyThis(false), setEditQ(true))],
            ...(!showInt ? [['Interpretation hinzufügen', () => setShowInt(true)] as [string, () => void]] : []),
            ...(!showAdd ? [['Nachträgliche Ergänzung', () => setShowAdd(true)] as [string, () => void]] : []),
            ['Löschen', () => confirm('Aussage löschen?') && remove(item), true],
          ]}
        />
      </div>
      {tagsOpen && (
        <div className="st-tageditor">
          {many && <p className="st-note">{`Jeder Klick gilt für alle ${many} ausgewählten Aussagen; ein schon gesetzter Tag wird bei allen entfernt.`}</p>}
          {many ? (
            <>
              {model.tags.map((g) => plainRow(g))}
              {findingRow}
            </>
          ) : (
            <>
              {mainGroups.map((g) => tagRow(g))}
              <button type="button" className="st-linkbtn st-moretoggle" aria-expanded={moreOpen} onClick={() => setMoreOpen((x) => !x)}>
                {moreOpen ? 'Weitere Details ausblenden' : `Weitere Details: ${[...restGroups.map((g) => g.name), 'Befund'].join(', ')}`}
              </button>
              {moreOpen && (
                <>
                  {restGroups.map((g) => tagRow(g))}
                  {findingRow}
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// "Bearbeiten ⋯": the rarer actions of a statement, out of the way until needed
function MoreMenu({ actions, up, label = 'Bearbeiten ⋯' }: { actions: [string, () => unknown, boolean?][]; up?: boolean; label?: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current?.open && !ref.current.contains(e.target as Node)) ref.current.open = false;
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);
  return (
    <details ref={ref} className={`st-more${up ? ' is-up' : ''}`}>
      <summary>{label}</summary>
      <div className="st-more-list" role="menu">
        {actions.map(([label, run, danger]) => (
          <button
            key={label}
            type="button"
            role="menuitem"
            className={danger ? 'is-danger' : undefined}
            onClick={() => {
              if (ref.current) ref.current.open = false;
              run();
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </details>
  );
}

// Deutsch / Original / Beides: which text of notes and survey the dashboard shows
export function ContentSwitch() {
  const v = useContentView();
  const OPTS: [ContentView, string][] = [
    ['de', 'Deutsch'],
    ['orig', 'Original'],
    ['both', 'Beides'],
  ];
  return (
    <div className="st-seg" role="group" aria-label="Textfassung">
      {OPTS.map(([k, l]) => (
        <button key={k} type="button" className={v === k ? 'is-on' : ''} onClick={() => setContentView(k)}>
          {l}
        </button>
      ))}
    </div>
  );
}

// ---- the page ----
export default function Notes() {
  const ctx = useCtx();
  const { study, model, scope, omitted } = ctx;
  const [filter, setFilter] = useState<'all' | 'open' | 'changed'>('all');
  const [q, setQ] = useState('');
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const metas = (study.docs.settings.notesMeta ?? {}) as Record<string, NotesMeta>;
  const save = (i: ItemDoc) => study.commit([{ coll: 'items', id: i.id, data: i }]);
  const remove = (i: ItemDoc) => study.commit([], [{ coll: 'items', id: i.id }]);

  const scoped = useMemo(() => {
    const ids = scope.kind === 'all' ? null : scope.kind === 'link' ? (model.links.find((l) => l.key === scope.key)?.person ?? scope.id) : scope.id;
    return model.allItems.filter((i) => (!ids || i.person === ids) && !omitted.includes(i.person) && (scope.kind !== 'link' || !i.link || i.link === scope.id));
  }, [model.allItems, model.links, scope, omitted]);
  const removed = scoped.filter((i) => i.status === 'removed');
  const live = scoped.filter((i) => i.status !== 'removed');
  const shown = live.filter(
    (i) =>
      (filter === 'all' || (filter === 'open' ? !i.confirmed || i.suggested.length > 0 : i.status === 'changed' || i.status === 'new')) &&
      (!q || `${i.text} ${i.de ?? ''}`.toLowerCase().includes(q.toLowerCase())),
  );
  const byPerson = [...new Set(shown.map((i) => i.person))].sort();
  const open = live.filter((i) => !i.confirmed);
  const mineOf = (pid: string) => shown.filter((i) => i.person === pid).sort((a, b) => sectionRank(a.section) - sectionRank(b.section) || a.order - b.order);

  // several statements at once: select (Umschalt: a range, in the order shown), then set or remove a tag
  const [sel, setSel] = useState<Set<string>>(() => new Set());
  const [pickTag, setPickTag] = useState('');
  const lastClicked = useRef<string | null>(null);
  const ordered = byPerson.flatMap(mineOf);
  const selShown = ordered.filter((i) => sel.has(i.id));
  const select = (id: string, shift: boolean) => {
    const from = shift ? lastClicked.current : null; // (read now: the update below runs later)
    setSel((cur) => {
      const n = new Set(cur);
      const to = !cur.has(id);
      const a = from ? ordered.findIndex((i) => i.id === from) : -1;
      const b = ordered.findIndex((i) => i.id === id);
      for (const i of a >= 0 && b >= 0 ? ordered.slice(Math.min(a, b), Math.max(a, b) + 1) : ordered.slice(b, b + 1)) {
        if (to) n.add(i.id);
        else n.delete(i.id);
      }
      return n;
    });
    lastClicked.current = id;
  };
  const selectAll = (items: ItemDoc[]) => setSel((cur) => new Set([...cur, ...items.map((i) => i.id)]));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target instanceof HTMLElement && e.target.closest('input:not([type=checkbox]), textarea, select'))) setSel(new Set());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const applyTag = (add: boolean) => {
    const g = model.tags.find((x) => x.chips.some((c) => c.id === pickTag));
    if (!g) return;
    const put = selShown.map((i) => pruneHidden(add ? setChip(i, g, pickTag) : { ...i, chips: i.chips.filter((c) => c !== pickTag) }, model.tags)).filter((n, k) => n.chips.join() !== selShown[k].chips.join());
    if (put.length) study.commit(put.map((p) => ({ coll: 'items' as const, id: p.id, data: p })));
  };

  // the AI's proposals (tags; reworded statements), checked in a review window before anything is stored
  const [tagPlan, setTagPlan] = useState<TagProposal[] | null>(null);
  const [rewritePlan, setRewritePlan] = useState<Rewrite[] | null>(null);
  const [showCriteria, setShowCriteria] = useState(false);
  const criteria = ((study.docs.settings.rewrite as { criteria?: string } | undefined)?.criteria ?? '').trim() || DEFAULT_CRITERIA;
  // what the AI works on: the selected statements, else (tags) the unchecked ones / (wording) the ones shown
  const forTags = selShown.length ? selShown : open;
  const forRewrite = selShown.length ? selShown : shown;
  // the selection bar's own actions: on every selected statement at once
  const [bulk, setBulk] = useState<null | 'frage' | 'befund' | 'befund-weg'>(null);
  const [bulkQ, setBulkQ] = useState('');
  const putAll = (items: ItemDoc[], what: string) => {
    if (!items.length) return;
    study.commit(items.map((i) => ({ coll: 'items' as const, id: i.id, data: i })));
    logChange(study, `${what}: ${items.length} ausgewählte Aussagen`);
  };
  const bulkQuestion = (q: string | undefined) => {
    putAll(selShown.map((i) => ({ ...i, question: q, questionOwn: true })), q ? `Frage „${q}“ gesetzt` : 'Frage entfernt');
    setBulk(null);
    setBulkQ('');
  };
  const bulkSection = (section: 'during' | 'followup') =>
    putAll(
      selShown.filter((i) => i.section !== 'survey' && i.section !== section).map((i) => ({ ...i, section, sectionOwn: true })),
      `Bereich → ${SECTION_LABEL[section]}`,
    );
  async function bulkDelete() {
    const n = selShown.length;
    if (!confirm(`${n} ausgewählte ${n === 1 ? 'Aussage' : 'Aussagen'} löschen? Der jetzige Stand wird vorher gesichert.`)) return;
    await study.saveVersion(`vor dem Löschen von ${n} Aussagen`);
    study.commit([], selShown.map((i) => ({ coll: 'items' as const, id: i.id })));
    logChange(study, `${n} ausgewählte Aussagen gelöscht`);
    setSel(new Set());
  }
  const findingList = Object.values(study.docs.findings).sort((a, b) => a.name.localeCompare(b.name));

  // a tag clicked on one of several selected statements: set on all of them, or (already on the clicked one) taken off all
  const tagSelected = (clicked: ItemDoc, g: TagGroup, chip: string) => {
    const on = !clicked.chips.includes(chip);
    const put = selShown.map((i) => pruneHidden(on ? setChip(i, g, chip) : { ...i, chips: i.chips.filter((c) => c !== chip) }, model.tags)).filter((n, k) => n.chips.join() !== selShown[k].chips.join());
    if (!put.length) return;
    study.commit(put.map((p) => ({ coll: 'items' as const, id: p.id, data: p })));
    logChange(study, `Tag „${model.chipLabel.get(chip) ?? chip}“ ${on ? 'gesetzt' : 'entfernt'}: ${put.length} ausgewählte Aussagen`);
  };
  async function suggestOpen() {
    setBusy('KI schlägt Tags vor …');
    try {
      const found = await suggestFor(ctx, forTags, (d, a) => setBusy(`KI schlägt Tags vor: ${d} von ${a} …`));
      setBusy(found.length ? null : 'KI: keine neuen Tags vorgeschlagen.');
      if (found.length) setTagPlan(found);
    } catch (e) {
      setBusy(`KI nicht verfügbar: ${String((e as Error).message)}`);
    }
  }
  async function rewriteShown() {
    const todo = forRewrite.filter((i) => workingText(i).trim());
    setBusy('KI formuliert um …');
    try {
      const out: Rewrite[] = [];
      for (let k = 0; k < todo.length; k += 20) {
        const batch = todo.slice(k, k + 20);
        out.push(...(await study.rewrite({ items: batch.map((i) => ({ id: i.id, text: workingText(study.latest().items[i.id] ?? i), question: i.question })), criteria })));
        setBusy(`KI formuliert um: ${Math.min(k + 20, todo.length)} von ${todo.length} …`);
      }
      const changed = out.filter((r) => {
        const i = study.latest().items[r.id];
        return i && r.text.trim() !== workingText(i).trim();
      });
      setBusy(changed.length ? null : 'KI: keine Änderungen an den Aussagen vorgeschlagen.');
      if (changed.length) setRewritePlan(changed);
    } catch (e) {
      setBusy(`KI nicht verfügbar: ${String((e as Error).message)}`);
    }
  }

  if (!model.allItems.length)
    return (
      <Empty>
        Noch keine Notizen. Unter <a href="#daten">Daten &amp; Validierung → Hochladen</a> einlesen.
      </Empty>
    );
  return (
    <>
      <PageIntro />
      <div className="st-toolbar st-notes-bar">
        <div className="st-barpart" role="group" aria-label="Anzeigen">
          <span className="st-barlabel">Anzeigen</span>
          <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Anzeige">
            <option value="all">Alle Aussagen ({live.length})</option>
            <option value="open">Ungeprüft ({open.length})</option>
            <option value="changed">Geändert / neu ({live.filter((i) => i.status).length})</option>
          </select>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suchen in Aussagen" />
        </div>
        <div className="st-barpart" role="group" aria-label="KI">
          <span className="st-barlabel">KI</span>
          <button
            type="button"
            disabled={!forTags.length || !!busy?.endsWith('…')}
            onClick={() => void suggestOpen()}
            title={`Die KI schlägt passende Tags und einen Befund vor – für ${selShown.length ? 'die ausgewählten' : 'alle ungeprüften'} Aussagen. Du prüfst und änderst alles im Fenster, bevor etwas gespeichert wird.\nBeispiel: „Crafting-Menü schwer zu finden“ → Bereich: Spiel · Art: Problem · Thema: Crafting.`}
          >
            {`KI: Tags vorschlagen (${forTags.length})`}
          </button>
          <button
            type="button"
            disabled={!forRewrite.length || !!busy?.endsWith('…')}
            onClick={() => void rewriteShown()}
            title={`Die KI formuliert ${selShown.length ? 'die ausgewählten' : 'die angezeigten'} Aussagen nach deinen Kriterien neu (Bedeutung bleibt gleich). Du vergleichst alt und neu im Fenster und kannst jeden Vorschlag selbst anpassen. Die Originalnotiz bleibt erhalten.\nBeispiel: „menü crafting nich gefunden, hat lange gesucht“ → „Die Testperson fand das Crafting-Menü nicht und suchte lange danach.“`}
          >
            {`KI: Aussagen umformulieren (${forRewrite.length})`}
          </button>
          <button type="button" className="st-linkbtn" aria-expanded={showCriteria} onClick={() => setShowCriteria((x) => !x)} title="Festlegen, wie die KI umformulieren soll (z. B. sachlich, Präsens, vollständige Sätze).">
            Kriterien
          </button>
        </div>
        {busy && <span className="st-muted">{busy}</span>}
      </div>
      {showCriteria && (
        <div className="st-criteria">
          <label className="st-fprop-field">
            <span className="st-cell-label">Kriterien für „KI: Aussagen umformulieren“</span>
            <LazyArea
              value={criteria}
              onSave={(v) => {
                const next = v.trim();
                study.commit([{ coll: 'settings', id: 'rewrite', data: { criteria: next && next !== DEFAULT_CRITERIA ? next : undefined } }]);
                logChange(study, 'Kriterien für die KI-Umformulierung geändert');
              }}
              placeholder={DEFAULT_CRITERIA}
            />
          </label>
          <p className="st-muted">Gilt für jede Umformulierung. Immer gilt zusätzlich: Bedeutung bleibt gleich, nichts wird hinzugefügt oder weggelassen, IDs, Namen und Zahlen bleiben.</p>
          <div className="st-toolbar">
            <button
              type="button"
              disabled={criteria === DEFAULT_CRITERIA}
              onClick={() => {
                study.commit([{ coll: 'settings', id: 'rewrite', data: {} }]);
                logChange(study, 'Kriterien für die KI-Umformulierung: Standard');
              }}
            >
              Standard wiederherstellen
            </button>
            <button type="button" onClick={() => setShowCriteria(false)}>
              Schließen
            </button>
          </div>
        </div>
      )}
      {tagPlan && (
        <TagReview
          study={study}
          tags={model.tags}
          items={new Map(model.allItems.map((i) => [i.id, i]))}
          proposals={tagPlan}
          onClose={(m) => {
            setTagPlan(null);
            setBusy(m ?? null);
          }}
        />
      )}
      {rewritePlan && (
        <RewriteReview
          study={study}
          criteria={criteria}
          items={new Map(model.allItems.map((i) => [i.id, i]))}
          rewrites={rewritePlan}
          onClose={(m) => {
            setRewritePlan(null);
            setBusy(m ?? null);
          }}
        />
      )}

      {removed.length > 0 && (
        <div className="st-removed">
          <h3>In der neuen Fassung nicht mehr enthalten ({removed.length})</h3>
          {removed.map((i) => (
            <div key={i.id} className="st-removed-row">
              <span className="st-pid">{i.person}</span> <span data-notr>{i.text}</span>
              <button type="button" onClick={() => remove(i)}>
                Löschen
              </button>
              <button type="button" onClick={() => save({ ...i, status: undefined, manual: true })}>
                Behalten
              </button>
            </div>
          ))}
          <button type="button" onClick={() => study.commit([], removed.map((i) => ({ coll: 'items' as const, id: i.id })))}>
            Alle löschen
          </button>
        </div>
      )}

      {byPerson.map((pid) => {
        const meta = metas[pid];
        const mine = mineOf(pid);
        const person = model.persons.find((p) => p.id === pid);
        return (
          <section key={pid} className="st-section st-notes-person" data-anchor={`p-${pid}`}>
            <header className="st-notes-head">
              <PersonInfo pid={pid} meta={meta} person={person} />
              <div className="st-notes-actions">
              <button type="button" onClick={() => study.commit(mine.map((i) => ({ coll: 'items' as const, id: i.id, data: confirmItem(i, model.tags) })))}>
                Alle als geprüft markieren
              </button>
              <button type="button" onClick={() => selectAll(mine)}>
                Alle auswählen
              </button>
              <button
                type="button"
                onClick={() => {
                  const id = `m-${pid}-${Date.now().toString(36)}`;
                  // (shown at once, opened for typing; filters that would hide it are reset)
                  setFilter('all');
                  setQ('');
                  setFresh(id);
                  save({ id, person: pid, section: 'during', text: '', order: Math.max(0, ...mine.map((x) => x.order)) + 1, chips: [], suggested: [], manual: true });
                }}
              >
                + Aussage
              </button>
              </div>
            </header>
            {mine.map((i) => (
              <ItemRow key={i.id} item={i} model={model} save={save} remove={remove} fresh={i.id === fresh} selected={sel.has(i.id)} onSelect={(shift) => select(i.id, shift)} {...(sel.has(i.id) && selShown.length > 1 ? { onTag: (g: TagGroup, chip: string) => tagSelected(i, g, chip), many: selShown.length } : {})} />
            ))}
          </section>
        );
      })}

      {selShown.length > 0 && (
        <div className="st-selbar" role="region" aria-label="Auswahl">
          <strong>{selShown.length} ausgewählt</strong>
          <select value={pickTag} onChange={(e) => setPickTag(e.target.value)} aria-label="Tag">
            <option value="">Tag wählen …</option>
            {model.tags.map((g) => (
              <optgroup key={g.id} label={g.name}>
                {g.chips
                  .filter((c) => c.role !== 'rejected')
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
          <button type="button" disabled={!pickTag} onClick={() => applyTag(true)}>
            Tag setzen
          </button>
          <button type="button" disabled={!pickTag} onClick={() => applyTag(false)}>
            Tag entfernen
          </button>
          <MoreMenu
            up
            label="Ausgewählte bearbeiten ⋯"
            actions={[
              ['Als geprüft markieren', () => putAll(selShown.map((i) => confirmItem(i, model.tags)), 'Als geprüft markiert')],
              ['Frage setzen …', () => setBulk('frage')],
              ['Bereich: Beobachtung', () => bulkSection('during')],
              ['Bereich: Nachgespräch', () => bulkSection('followup')],
              ['Befund zuordnen …', () => setBulk('befund')],
              ['Befund entfernen …', () => setBulk('befund-weg')],
              ['Löschen', () => void bulkDelete(), true],
            ]}
          />
          {bulk === 'frage' && (
            <span className="st-selbar-form">
              <input value={bulkQ} onChange={(e) => setBulkQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && bulkQ.trim() && bulkQuestion(bulkQ.trim())} placeholder="Frage für alle ausgewählten …" aria-label="Frage für alle ausgewählten" autoFocus />
              <button type="button" disabled={!bulkQ.trim()} onClick={() => bulkQuestion(bulkQ.trim())}>
                Setzen
              </button>
              <button type="button" onClick={() => bulkQuestion(undefined)} title="Die Frage bei allen ausgewählten entfernen">
                Frage entfernen
              </button>
              <button type="button" className="st-linkbtn" onClick={() => setBulk(null)}>
                Abbrechen
              </button>
            </span>
          )}
          {bulk === 'befund' && (
            <span className="st-selbar-form">
              <select
                value=""
                autoFocus
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) return;
                  // (added to the ones they have; "keiner" takes all off)
                  putAll(selShown.map((i) => (v === '-' ? setFindings(i, []) : withFinding(i, v))), v === '-' ? 'Alle Befunde entfernt' : `Befund „${study.docs.findings[v]?.name}“ zugeordnet`);
                  setBulk(null);
                }}
                aria-label="Befund für alle ausgewählten"
              >
                <option value="">Befund hinzufügen …</option>
                <option value="-">alle Befunde entfernen</option>
                {findingList.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
              <button type="button" className="st-linkbtn" onClick={() => setBulk(null)}>
                Abbrechen
              </button>
            </span>
          )}
          {bulk === 'befund-weg' && (
            <span className="st-selbar-form">
              <select
                value=""
                autoFocus
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) return;
                  putAll(selShown.map((i) => withoutFinding(i, v)), `Befund „${study.docs.findings[v]?.name}“ entfernt`);
                  setBulk(null);
                }}
                aria-label="Befund bei allen ausgewählten entfernen"
              >
                <option value="">Befund entfernen …</option>
                {findingList
                  .filter((f) => selShown.some((i) => findingsOf(i).includes(f.id)))
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
              </select>
              <button type="button" className="st-linkbtn" onClick={() => setBulk(null)}>
                Abbrechen
              </button>
            </span>
          )}
          <span className="st-selbar-gap" />
          <button type="button" className="st-linkbtn" onClick={() => selectAll(shown)}>
            Alle sichtbaren auswählen
          </button>
          <button type="button" className="st-linkbtn" onClick={() => setSel(new Set())}>
            Auswahl aufheben
          </button>
        </div>
      )}
    </>
  );
}
// how the AI rewords statements unless set otherwise (Kriterien)
const DEFAULT_CRITERIA = 'Sachlich und neutral, in vollständigen Sätzen und im Präsens, auf Deutsch; Umgangssprache und Stichworte in klare Standardsprache; kurz und eindeutig; aus Sicht der Beobachtung („Die Testperson …“).';

// a short guide for whoever opens the page first; closed, it stays closed
const INTRO_KEY = 'asciia-study-notes-intro';
function PageIntro() {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(INTRO_KEY) !== 'closed';
    } catch {
      return true;
    }
  });
  return (
    <details
      className="st-intro"
      open={open}
      onToggle={(e) => {
        const now = (e.target as HTMLDetailsElement).open;
        setOpen(now);
        try {
          localStorage.setItem(INTRO_KEY, now ? 'open' : 'closed');
        } catch {
          // (not remembered)
        }
      }}
    >
      <summary>So funktioniert diese Seite</summary>
      <ol>
        <li>
          <strong>Aussagen lesen:</strong> je Testperson die Beobachtungen, das Nachgespräch und die Umfrage-Freitexte. Oben rechts wählst du Deutsch, Original oder beides.
        </li>
        <li>
          <strong>Tags setzen:</strong> unter jeder Aussage stehen ihre Tags in einer Zeile; „Tags bearbeiten“ öffnet alle Gruppen mit Erklärung. Gestrichelte Tags sind Vorschläge: anklicken übernimmt sie.
        </li>
        <li>
          <strong>Prüfen:</strong> „Geprüft?“ markiert eine Aussage als geprüft; es zählen nur die angeklickten Tags, nicht angeklickte Vorschläge werden dabei verworfen. Nochmal klicken macht es rückgängig. Weitere Aktionen (Deutsch, Original korrigieren, Frage, Löschen) unter „Bearbeiten ⋯“.
        </li>
        <li>
          <strong>Mehrere auf einmal:</strong> Kästchen links anhaken (Umschalt: ganzer Bereich); ein Tag-Klick bei einer davon gilt dann für alle.
        </li>
        <li>
          <strong>KI und Auswertung:</strong> „KI: Tags vorschlagen“ und „KI: Aussagen umformulieren“ (nach deinen „Kriterien“) arbeiten mit den ausgewählten Aussagen, sonst mit allen ungeprüften bzw. angezeigten; jedes Ergebnis prüfst und bearbeitest du in einem Fenster, bevor es gespeichert wird. Über jedem Button erklärt ein Hinweis mit Beispiel, was er tut. Links unter Qualitatives Feedback: Nach Priorität, Codes, Wiederkehrende Befunde und die Tag-Gruppen.
        </li>
      </ol>
    </details>
  );
}

const sectionRank = (s: Sec) => ({ during: 0, followup: 1, survey: 2 })[s];

// ---- Nach Priorität ----
export function Priority() {
  const { model, slice } = useCtx();
  const roles: [ChipRole, string][] = [
    ['essential', shortName(model, 'essential', 'Essenziell')],
    ['tbd', shortName(model, 'tbd', 'Offen (t.b.d.)')],
    ['nice', shortName(model, 'nice', 'Nice-to-have')],
  ];
  const none = slice.items.filter((i) => !i.chips.some((c) => ['essential', 'tbd', 'nice'].includes(model.chipRole.get(c) ?? '')));
  return (
    <div className="st-columns">
      {roles.map(([role, name]) => {
        const items = itemsWithRole(slice.items, model, role);
        return (
          <section key={role} className="st-section">
            <h2>
              {name} <span className="st-muted">{items.length}</span>
            </h2>
            <ItemList items={items} model={model} />
          </section>
        );
      })}
      {none.length > 0 && (
        <section className="st-section">
          <h2>
            Ohne Priorität <span className="st-muted">{none.length}</span>
          </h2>
          <ItemList items={none} model={model} />
        </section>
      )}
    </div>
  );
}

function ItemList({ items, model }: { items: ItemDoc[]; model: Model }) {
  const { study } = useCtx();
  const view = useContentView();
  if (!items.length) return <Empty>Keine.</Empty>;
  return (
    <ul className="st-list">
      {items.map((i) => (
        <li key={i.id}>
          <span className="st-pid">{i.link ?? i.person}</span> <span data-notr>{itemText(view, i)}</span>
          <span className="st-tags">
            {i.chips
              .filter((c) => !['essential', 'tbd', 'nice'].includes(model.chipRole.get(c) ?? ''))
              .map((c) => model.chipLabel.get(c))
              .filter(Boolean)
              .join(' · ')}
            {findingsOf(i)
              .filter((f) => study.docs.findings[f])
              .map((f) => ` · ${study.docs.findings[f].name}`)
              .join('')}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ---- Tags: groups and chips, editable; both in an order set by drag and drop ----
// (a drag runs on pointer events, so it works with a mouse and on touch screens)
type Drag = { kind: 'group'; id: string } | { kind: 'chip'; id: string; from: string };
type Drop = { kind: 'group'; index: number } | { kind: 'chip'; group: string; index: number };
// where a drag at height y lands among the elements (their middles decide)
const indexAt = (els: Element[], y: number) => {
  let k = 0;
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (y > r.top + r.height / 2) k++;
  }
  return k;
};
export function Tags() {
  const { study, model } = useCtx();
  const saveGroup = (g: TagGroup) => study.commit([{ coll: 'tags', id: g.id, data: g }]);
  // a deleted chip leaves every statement
  const dropChips = (ids: string[]) =>
    model.allItems
      .filter((i) => i.chips.some((c) => ids.includes(c)) || i.suggested.some((c) => ids.includes(c)))
      .map((i) => ({ coll: 'items' as const, id: i.id, data: { ...i, chips: i.chips.filter((c) => !ids.includes(c)), suggested: i.suggested.filter((c) => !ids.includes(c)) } }));
  const uses = (id: string) => model.allItems.filter((i) => i.chips.includes(id)).length;
  const slug = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'tag';

  // categories shown compact (only description and tags), remembered for the tab
  const [compact, setCompact] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(sessionStorage.getItem('asciia-study-tag-compact') ?? '[]') as string[]);
    } catch {
      return new Set();
    }
  });
  const toggleCompact = (id: string) =>
    setCompact((x) => {
      const n = new Set(x);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      try {
        sessionStorage.setItem('asciia-study-tag-compact', JSON.stringify([...n]));
      } catch {
        // (not remembered)
      }
      return n;
    });

  // ---- the order: categories and tags ----
  const [drag, setDrag] = useState<Drag | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const dropRef = useRef<Drop | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const reorderGroups = (id: string, index: number) => {
    const rest = model.tags.filter((g) => g.id !== id);
    const moved = model.tags.find((g) => g.id === id);
    if (!moved) return;
    const next = [...rest.slice(0, index), moved, ...rest.slice(index)];
    if (next.every((g, k) => g.id === model.tags[k].id)) return;
    study.commit(next.map((g, k) => ({ coll: 'tags' as const, id: g.id, data: { ...g, order: k } })));
    logChange(study, `Reihenfolge der Kategorien: ${next.map((g) => g.name).join(', ')}`);
  };
  const moveChip = (id: string, from: string, to: string, index: number) => {
    const src = model.tags.find((g) => g.id === from);
    const dst = model.tags.find((g) => g.id === to);
    const chip = src?.chips.find((c) => c.id === id);
    if (!src || !dst || !chip) return;
    if (from === to) {
      const rest = src.chips.filter((c) => c.id !== id);
      const chips = [...rest.slice(0, index), chip, ...rest.slice(index)];
      if (chips.every((c, k) => c.id === src.chips[k].id)) return;
      saveGroup({ ...src, chips });
      logChange(study, `Tag „${chip.label}“ in „${src.name}“ verschoben`);
      return;
    }
    // (a single-choice category: statements could end up with two of its tags)
    if (!dst.multi) {
      const both = model.allItems.filter((i) => i.chips.includes(id) && i.chips.some((c) => dst.chips.some((x) => x.id === c))).length;
      if (both && !confirm(`${both} Aussagen haben dann zwei Tags in „${dst.name}“ (nur einer je Aussage vorgesehen). Trotzdem verschieben?`)) return;
    }
    study.commit([
      { coll: 'tags', id: src.id, data: { ...src, chips: src.chips.filter((c) => c.id !== id) } },
      { coll: 'tags', id: dst.id, data: { ...dst, chips: [...dst.chips.slice(0, index), chip, ...dst.chips.slice(index)] } },
    ]);
    logChange(study, `Tag „${chip.label}“ von „${src.name}“ nach „${dst.name}“ verschoben`);
  };
  const finish = (d: Drag, to: Drop | null) => {
    if (!to) return;
    if (d.kind === 'group' && to.kind === 'group') reorderGroups(d.id, to.index);
    if (d.kind === 'chip' && to.kind === 'chip') moveChip(d.id, d.from, to.group, to.index);
  };
  // the place under the pointer (the dragged element itself left out)
  const placeAt = (d: Drag, x: number, y: number): Drop | null => {
    const root = listRef.current;
    if (!root) return null;
    if (d.kind === 'group') {
      const cards = [...root.querySelectorAll('[data-gid]')].filter((el) => el.getAttribute('data-gid') !== d.id);
      return { kind: 'group', index: indexAt(cards, y) };
    }
    const lists = [...root.querySelectorAll('[data-chips-of]')];
    // the category under the pointer, else the nearest one
    let best: Element | null = null;
    let dist = Infinity;
    for (const el of lists) {
      const r = el.closest('[data-gid]')!.getBoundingClientRect();
      const dd = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      if (dd < dist) (dist = dd), (best = el);
    }
    if (!best) return null;
    void x;
    const rows = [...best.querySelectorAll('[data-cid]')].filter((el) => el.getAttribute('data-cid') !== d.id);
    return { kind: 'chip', group: best.getAttribute('data-chips-of')!, index: indexAt(rows, y) };
  };
  const startDrag = (d: Drag) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setDrag(d);
    dropRef.current = null;
    let lastY = e.clientY;
    // (near the window's edge the page scrolls along)
    const timer = window.setInterval(() => {
      const edge = 70;
      const v = lastY < edge ? -(edge - lastY) / 3 : lastY > window.innerHeight - edge ? (lastY - (window.innerHeight - edge)) / 3 : 0;
      if (v) window.scrollBy(0, v);
    }, 16);
    const move = (ev: PointerEvent) => {
      lastY = ev.clientY;
      const to = placeAt(d, ev.clientX, ev.clientY);
      dropRef.current = to;
      setDrop(to);
    };
    const end = (ev: Event) => {
      window.clearInterval(timer);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('keydown', esc);
      const to = ev.type === 'pointerup' ? dropRef.current : null;
      setDrag(null);
      setDrop(null);
      finish(d, to);
    };
    const esc = (ev: KeyboardEvent) => ev.key === 'Escape' && end(ev);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('keydown', esc);
  };
  // the keyboard: ↑/↓ moves one place; Alt+↑/↓ moves a tag to the category before / after
  const keyMove = (d: Drag) => (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const up = e.key === 'ArrowUp';
    if (d.kind === 'group') {
      const k = model.tags.findIndex((g) => g.id === d.id);
      const to = up ? k - 1 : k + 1;
      if (to >= 0 && to < model.tags.length) reorderGroups(d.id, to);
      return;
    }
    const gk = model.tags.findIndex((g) => g.id === d.from);
    const g = model.tags[gk];
    const k = g.chips.findIndex((c) => c.id === d.id);
    if (e.altKey) {
      const other = model.tags[up ? gk - 1 : gk + 1];
      if (other) moveChip(d.id, d.from, other.id, up ? other.chips.length : 0);
    } else if (up ? k > 0 : k < g.chips.length - 1) moveChip(d.id, d.from, d.from, up ? k - 1 : k + 1);
  };
  const handle = (d: Drag, label: string) => (
    <button type="button" className="st-draghandle" onPointerDown={startDrag(d)} onKeyDown={keyMove(d)} aria-label={`${label} verschieben (Pfeiltasten)`} title="Ziehen zum Verschieben · Pfeiltasten ↑/↓">
      ⠿
    </button>
  );
  const line = <div className="st-dropline" aria-hidden="true" />;

  return (
    <>
      <Meanings />
      <div ref={listRef} className={drag ? 'st-sorting' : undefined}>
        {model.tags.map((g, gi) => (
          <div key={g.id}>
            {drag?.kind === 'group' && drop?.kind === 'group' && drop.index === model.tags.filter((x) => x.id !== drag.id).findIndex((x) => x.id === g.id) && line}
            <section data-gid={g.id} className={`st-section st-taggroup st-tgcard${drag?.kind === 'group' && drag.id === g.id ? ' is-dragging' : ''}`}>
              <header className="st-tgcard-head">
                {handle({ kind: 'group', id: g.id }, `Kategorie ${g.name}`)}
                <input className="st-groupname" defaultValue={g.name} onBlur={(e) => e.target.value !== g.name && saveGroup({ ...g, name: e.target.value })} aria-label="Name der Kategorie" />
                <button type="button" className="st-iconbtn" aria-expanded={!compact.has(g.id)} onClick={() => toggleCompact(g.id)} aria-label={compact.has(g.id) ? 'Einstellungen zeigen' : 'Einstellungen ausblenden'} title={compact.has(g.id) ? 'Einstellungen zeigen' : 'Einstellungen ausblenden'}>
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
                    <circle cx="16" cy="7" r="2" />
                    <circle cx="10" cy="17" r="2" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="st-iconbtn is-danger"
                  aria-label={`Kategorie ${g.name} löschen`}
                  title="Kategorie löschen"
                  onClick={() => {
                    if (!confirm(`Kategorie „${g.name}“ mit allen Tags löschen? Die Tags werden von allen Aussagen entfernt.`)) return;
                    study.commit(dropChips(g.chips.map((c) => c.id)), [{ coll: 'tags', id: g.id }]);
                  }}
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
                  </svg>
                </button>
              </header>
              <label className="st-tgfield">
                <span className="st-tglabel">Beschreibung</span>
                <textarea
                  className="st-autogrow"
                  rows={1}
                  defaultValue={hintOf(g)}
                  placeholder="Wofür steht diese Kategorie? (beim Taggen sichtbar)"
                  ref={(el) => {
                    if (el) (el.style.height = 'auto'), (el.style.height = `${el.scrollHeight + 2}px`);
                  }}
                  onInput={(e) => ((e.currentTarget.style.height = 'auto'), (e.currentTarget.style.height = `${e.currentTarget.scrollHeight + 2}px`))}
                  onBlur={(e) => e.target.value.trim() !== hintOf(g) && saveGroup({ ...g, hint: e.target.value.trim() || undefined })}
                />
              </label>
              {!compact.has(g.id) && <Visibility g={g} save={saveGroup} />}
              <div className="st-tgsection">
                <div className="st-tgsection-head">
                  <span className="st-tglabel">Tags</span>
                  <span className="st-muted">{`${g.chips.length} ${g.chips.length === 1 ? 'Eintrag' : 'Einträge'}`}</span>
                </div>
                <div className="st-chipedit" data-chips-of={g.id}>
                  {g.chips.map((c: Chip) => {
                    const others = g.chips.filter((x) => !(drag?.kind === 'chip' && x.id === drag.id));
                    const here = drag?.kind === 'chip' && drop?.kind === 'chip' && drop.group === g.id && drop.index === others.findIndex((x) => x.id === c.id);
                    return (
                      <div key={c.id}>
                        {here && line}
                        <div data-cid={c.id} className={`st-chipedit-row${drag?.kind === 'chip' && drag.id === c.id ? ' is-dragging' : ''}`}>
                          {handle({ kind: 'chip', id: c.id, from: g.id }, `Tag ${c.label}`)}
                          <input defaultValue={c.label} onBlur={(e) => e.target.value !== c.label && saveGroup({ ...g, chips: g.chips.map((x) => (x.id === c.id ? { ...x, label: e.target.value } : x)) })} aria-label="Tag" />
                          <MeaningSelect value={c.role} onChange={(role) => saveGroup({ ...g, chips: g.chips.map((x) => (x.id === c.id ? { ...x, role } : x)) })} />
                          <span className="st-muted st-tguses" title={`bei ${uses(c.id)} Aussagen`}>{uses(c.id)}×</span>
                          <button
                            type="button"
                            className="st-iconbtn"
                            aria-label={`Tag ${c.label} löschen`}
                            title="Tag löschen"
                            onClick={() => {
                              if (uses(c.id) && !confirm(`„${c.label}“ von ${uses(c.id)} Aussagen entfernen?`)) return;
                              study.commit([{ coll: 'tags', id: g.id, data: { ...g, chips: g.chips.filter((x) => x.id !== c.id) } }, ...dropChips([c.id])]);
                            }}
                          >
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                              <path d="M6 6l12 12M18 6L6 18" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {drag?.kind === 'chip' && drop?.kind === 'chip' && drop.group === g.id && drop.index >= g.chips.filter((x) => x.id !== drag.id).length && line}
                  <button
                    type="button"
                    className="st-tgadd"
                    onClick={() => {
                      const label = prompt('Neuer Tag');
                      if (!label?.trim()) return;
                      let id = slug(label);
                      while (model.chipLabel.has(id)) id += '-2';
                      saveGroup({ ...g, chips: [...g.chips, { id, label: label.trim() }] });
                    }}
                  >
                    + Tag hinzufügen
                  </button>
                </div>
              </div>
              {!compact.has(g.id) && (
                <div className="st-tgsection">
                  <span className="st-tglabel">Weitere Einstellungen</span>
                  <label className="st-check">
                    <input type="checkbox" checked={g.multi} onChange={(e) => saveGroup({ ...g, multi: e.target.checked })} />
                    Mehrere Tags pro Aussage erlauben
                  </label>
                </div>
              )}
            </section>
            {gi === model.tags.length - 1 && drag?.kind === 'group' && drop?.kind === 'group' && drop.index >= model.tags.length - 1 && line}
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => {
          const name = prompt('Neue Kategorie');
          if (!name?.trim()) return;
          let id = slug(name);
          while (study.docs.tags[id]) id += '-2';
          saveGroup({ id, name: name.trim(), multi: true, order: model.tags.length, chips: [] });
        }}
      >
        + Kategorie
      </button>
    </>
  );
}

// ---- when a category applies: always, or only when another category has a tag ----
// (stored as TagGroup.showIf; a meaning there, e.g. "problem", stands for the tags with it)
function Visibility({ g, save }: { g: TagGroup; save: (g: TagGroup) => void }) {
  const { model, study } = useCtx();
  const cond = g.showIf ?? [];
  const others = model.tags.filter((x) => x.id !== g.id && x.chips.length);
  const matches = (c: Chip) => cond.includes(c.id) || (!!c.role && cond.includes(c.role));
  // the condition as "category = tag" (the first one, if several are stored)
  const first = others.flatMap((x) => x.chips.filter(matches).map((c) => ({ g: x, c })))[0];
  const [pickG, setPickG] = useState(first?.g.id ?? others[0]?.id ?? '');
  const groupNow = others.find((x) => x.id === (first?.g.id ?? pickG));
  const set = (ids: string[] | undefined, log: string) => {
    save({ ...g, showIf: ids?.length ? ids : undefined });
    logChange(study, `Kategorie „${g.name}“: ${log}`);
  };
  const more = others.flatMap((x) => x.chips.filter(matches)).length;
  const [open, setOpen] = useState(false);
  const always = !cond.length;
  const onlyWhen = () => {
    const x = groupNow ?? others[0];
    if (x?.chips[0]) set([x.chips[0].id], `nur bei „${x.chips[0].label}“`);
  };
  return (
    // (folded: what applies; unfolded: the two choices as chips on a darker ground)
    <div className={`st-tgsection st-vis${open ? ' is-open' : ''}`}>
      <button type="button" className="st-vis-head" aria-expanded={open} onClick={() => setOpen((x) => !x)}>
        <span className="st-tglabel">Sichtbarkeit</span>
        <span className="st-vis-sum" data-notr>{!always && first ? `Nur anzeigen, wenn ${first.g.name} = ${first.c.label}${more > 1 ? ` (+ ${more - 1})` : ''}` : 'Immer anzeigen'}</span>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <>
      <div className="st-vis-choice" role="group" aria-label="Sichtbarkeit">
        <button type="button" className={`st-chip${always ? ' is-on' : ''}`} aria-pressed={always} onClick={() => !always && set(undefined, 'immer anzeigen')}>
          Immer anzeigen
        </button>
        <button type="button" className={`st-chip${!always ? ' is-on' : ''}`} aria-pressed={!always} onClick={() => always && onlyWhen()}>
          Nur anzeigen, wenn …
        </button>
      </div>
      {cond.length > 0 && (
        <div className="st-vis-cond">
          <select
            value={groupNow?.id ?? ''}
            aria-label="Kategorie der Bedingung"
            onChange={(e) => {
              const x = others.find((y) => y.id === e.target.value);
              setPickG(e.target.value);
              if (x?.chips[0]) set([x.chips[0].id], `nur bei „${x.chips[0].label}“`);
            }}
          >
            {others.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
          <span className="st-vis-eq" aria-hidden="true">
            =
          </span>
          <select
            value={groupNow?.chips.find(matches)?.id ?? ''}
            aria-label="Tag der Bedingung"
            onChange={(e) => {
              const c = groupNow?.chips.find((y) => y.id === e.target.value);
              if (c) set([c.id], `nur bei „${c.label}“`);
            }}
          >
            {groupNow?.chips.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          {more > 1 && <span className="st-muted">{`(+ ${more - 1} weitere)`}</span>}
          <p className="st-muted">Beim Wechsel werden nicht mehr zutreffende Tags dieser Kategorie entfernt; bis dahin zählen sie nicht.</p>
        </div>
      )}
        </>
      )}
    </div>
  );
}

// the meaning of a tag: grouped by kind ("Priorität"), each by its short name ("Essenziell")
function MeaningSelect({ value, onChange }: { value?: ChipRole; onChange: (v: ChipRole | undefined) => void }) {
  const { model } = useCtx();
  const groups = new Map<string, { id: ChipRole; short: string }[]>();
  for (const m of model.meanings) {
    const k = m.label.indexOf(': ');
    const head = k > 0 ? m.label.slice(0, k) : 'Sonstige';
    groups.set(head, [...(groups.get(head) ?? []), { id: m.id, short: k > 0 ? m.label.slice(k + 2) : m.label }]);
  }
  return (
    <select className="st-meaningsel" value={value ?? ''} onChange={(e) => onChange((e.target.value || undefined) as ChipRole | undefined)} aria-label="Bedeutung" title="Bedeutung in der Auswertung">
      <option value="">– keine Bedeutung</option>
      {[...groups].map(([head, list]) => (
        <optgroup key={head} label={head}>
          {list.map((x) => (
            <option key={x.id} value={x.id}>
              {x.short}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

// ---- the meanings a tag can have: the analysis' own (renamable) and the user's ----
function Meanings() {
  const { study, model } = useCtx();
  const ms = meaningsSetting(study.docs);
  const save = (next: MeaningsSetting, log: string) => {
    study.commit([{ coll: 'settings', id: 'meanings', data: next as unknown as Record<string, unknown> }]);
    logChange(study, log);
  };
  const chipsWith = (id: string) => model.tags.flatMap((g) => g.chips.filter((c) => c.role === id));
  const count = (id: string) => chipsWith(id).length;
  const setName = (id: BuiltinRole, v: string) => {
    const names = { ...ms.names };
    if (!v.trim() || v.trim() === ROLE_NAME[id]) delete names[id];
    else names[id] = v.trim();
    save({ ...ms, names }, `Bedeutung „${ROLE_NAME[id]}“ → „${v.trim() || ROLE_NAME[id]}“`);
  };
  const setCategory = (id: CategoryRole, v: string) => {
    const categories = { ...ms.categories };
    if (!v.trim() || v.trim() === CATEGORY[id]) delete categories[id];
    else categories[id] = v.trim();
    save({ ...ms, categories }, `Titel „${CATEGORY[id]}“ → „${v.trim() || CATEGORY[id]}“`);
  };
  const custom = ms.custom ?? [];
  const setCustom = (id: string, patch: Partial<{ label: string; category?: string }>, log: string) => save({ ...ms, custom: custom.map((c) => (c.id === id ? { ...c, ...patch } : c)) }, log);
  const isCat = (id: string): id is CategoryRole => ['essential', 'positive', 'surprise', 'intervention'].includes(id);
  return (
    <details className="st-section st-taggroup st-meanings">
      <summary>
        <strong>Bedeutungen</strong> <span className="st-muted">{`(${model.meanings.length}) – wofür ein Tag in der Auswertung zählt`}</span>
      </summary>
      <p className="st-note">
        Jeder Tag kann eine Bedeutung haben. Die vorgegebenen zählen in der Auswertung (Übersicht Abb. 6 und ihre Listen, „Nach Priorität“, „verworfen“, die Prüfungen) und lassen sich umbenennen. Eigene Bedeutungen sind zunächst nur Beschriftungen; mit „als eigene Kategorie zählen“ bekommen sie eine eigene Zeile in Abb. 6 und eine eigene Liste in der Übersicht.
      </p>
      <div className="st-meaning-list">
        {model.meanings.map((m) => {
          const own = custom.find((c) => c.id === m.id);
          return (
            <div key={`${m.id}-${m.label}-${m.category ?? ''}`} className="st-meaning-row">
              <input defaultValue={m.label} onBlur={(e) => e.target.value.trim() !== m.label && (own ? e.target.value.trim() && setCustom(own.id, { label: e.target.value.trim() }, `Bedeutung „${own.label}“ → „${e.target.value.trim()}“`) : setName(m.id as BuiltinRole, e.target.value))} aria-label="Name der Bedeutung" />
              {m.builtin && isCat(m.id) && (
                <label className="st-meaning-cat">
                  <span className="st-cell-label">Titel in Abbildungen</span>
                  <input defaultValue={m.category} onBlur={(e) => e.target.value.trim() !== m.category && setCategory(m.id as CategoryRole, e.target.value)} aria-label="Titel in Abbildungen" />
                </label>
              )}
              {own && (
                <label className="st-check">
                  <input type="checkbox" checked={!!own.category} onChange={(e) => setCustom(own.id, { category: e.target.checked ? own.label : undefined }, `Bedeutung „${own.label}“: ${e.target.checked ? 'zählt als Kategorie' : 'zählt nicht mehr als Kategorie'}`)} />
                  als eigene Kategorie zählen
                </label>
              )}
              {own?.category !== undefined && own.category && (
                <label className="st-meaning-cat">
                  <span className="st-cell-label">Titel in Abbildungen</span>
                  <input defaultValue={own.category} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== own.category && setCustom(own.id, { category: e.target.value.trim() }, `Titel „${own.category}“ → „${e.target.value.trim()}“`)} aria-label="Titel in Abbildungen" />
                </label>
              )}
              <span className="st-muted">{`${count(m.id)} ${count(m.id) === 1 ? 'Tag' : 'Tags'}`}</span>
              {m.builtin && m.renamed && (
                <button
                  type="button"
                  className="st-linkbtn"
                  onClick={() => {
                    const names = { ...ms.names };
                    const categories = { ...ms.categories };
                    delete names[m.id as BuiltinRole];
                    if (isCat(m.id)) delete categories[m.id];
                    save({ ...ms, names, categories }, `Bedeutung „${m.label}“ zurückgesetzt`);
                  }}
                >
                  zurücksetzen
                </button>
              )}
              {own && (
                <button
                  type="button"
                  onClick={() => {
                    const n = count(own.id);
                    if (n && !confirm(`Bedeutung „${own.label}“ löschen? ${n} Tags verlieren sie (die Tags selbst bleiben).`)) return;
                    study.commit([
                      { coll: 'settings', id: 'meanings', data: { ...ms, custom: custom.filter((c) => c.id !== own.id) } as unknown as Record<string, unknown> },
                      ...model.tags.filter((g) => g.chips.some((c) => c.role === own.id)).map((g) => ({ coll: 'tags' as const, id: g.id, data: { ...g, chips: g.chips.map((c) => (c.role === own.id ? { ...c, role: undefined } : c)) } })),
                    ]);
                    logChange(study, `Bedeutung „${own.label}“ gelöscht`);
                  }}
                >
                  Löschen
                </button>
              )}
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => {
          const label = prompt('Neue Bedeutung (z. B. „Art: Bug“)');
          if (!label?.trim()) return;
          const base = `m-${label
            .toLowerCase()
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '') || 'eigen'}` as `m-${string}`;
          let id = base;
          while (model.meanings.some((m) => m.id === id)) id = `${id}-2` as `m-${string}`;
          save({ ...ms, custom: [...custom, { id, label: label.trim() }] }, `Bedeutung „${label.trim()}“ angelegt`);
        }}
      >
        + Bedeutung
      </button>
    </details>
  );
}

// ---- the Übersicht's lists: essential problems, positive, unexpected ----
export function FeedbackLists() {
  const { model, slice, study } = useCtx();
  const view = useContentView();
  const total = model.included.length;
  const block = (role: ChipRole, title: string) => {
    const items = itemsWithRole(slice.items, model, role);
    const groups = new Map<string, ItemDoc[]>();
    for (const i of items) {
      // (grouped under its first finding)
      const f0 = findingsOf(i).find((f) => study.docs.findings[f]);
      const k = f0 ? `f:${f0}` : `i:${i.id}`;
      groups.set(k, [...(groups.get(k) ?? []), i]);
    }
    const rows = [...groups].map(([k, list]) => ({ k, title: k.startsWith('f:') ? study.docs.findings[k.slice(2)].name : itemText(view, list[0]), list, persons: distinctPersons(list) })).sort((a, b) => b.persons - a.persons || a.title.localeCompare(b.title));
    return (
      <Section key={role} title={`${title} (${items.length})`}>
        {rows.length ? (
          <ol className="st-findings">
            {rows.map((r) => (
              <li key={r.k}>
                <div className="st-finding-head">
                  <span className="st-finding-title" data-notr>{r.title}</span>
                  <span className="st-muted">
                    {r.persons}/{total} · {[...new Set(r.list.map((i) => i.person))].sort().join(', ')}
                  </span>
                </div>
                {r.k.startsWith('f:') && (
                  <ul className="st-quotes-inline">
                    {r.list.map((i) => (
                      <li key={i.id}>
                        <span className="st-pid">{i.link ?? i.person}</span> <span data-notr>{itemText(view, i)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <Empty>Keine bestätigten Einträge.</Empty>
        )}
      </Section>
    );
  };
  return (
    <>
      {categoryMeanings(model).map((m) => block(m.id, m.category!))}
    </>
  );
}
