// Notizen: the session notes as single statements with tag chips. The AI
// suggests chips (shown hollow); only chips confirmed here count anywhere.
// Also: the notes import, the priority view, the tag editor, and the lists
// of the Übersicht.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Chip, ChipRole, ItemDoc, NotesMeta, Section as Sec, TagGroup } from '../types';
import { CATEGORY, SECTION_LABEL } from '../types';
import { distinctPersons, itemsWithRole, type Model } from '../model';
import { linkLabelOf, parseNotes, planNotes } from '../notes';
import type { Change } from '../changes';
import { applyChanges, ChangeModal } from '../ChangeModal';
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
// add a tag (several statements at once): never takes one off; in a
// single-choice group it replaces the group's other tag
export function setChip(item: ItemDoc, g: TagGroup, chip: string): ItemDoc {
  return item.chips.includes(chip) ? item : toggleChip(item, g, chip);
}
export function confirmItem(item: ItemDoc, tags: TagGroup[]): ItemDoc {
  let chips = [...item.chips];
  for (const s of item.suggested) {
    const g = groupOfChip(tags, s);
    if (!g || chips.includes(s)) continue;
    if (!g.multi && chips.some((c) => g.chips.some((x) => x.id === c))) continue; // a choice already made stays
    chips.push(s);
  }
  chips = chips.filter((c) => groupOfChip(tags, c));
  return { ...item, chips, suggested: [], finding: item.finding ?? item.suggestedFinding ?? null, suggestedFinding: null, confirmed: true, status: item.status === 'removed' ? 'removed' : undefined };
}

// ---- AI suggestions ----
// AI suggestions for statements, as changes to check in the review window
// (nothing is stored here): per statement the tags (and the recurring
// finding) it would get; taken over, they are real tags. A tag already chosen
// in a single-choice group stays.
export async function suggestFor(ctx: Ctx, items: ItemDoc[], onProgress?: (done: number, all: number) => void): Promise<Change[]> {
  const { study, model } = ctx;
  const groups = model.tags.map((g) => ({ id: g.id, name: g.name, multi: g.multi, chips: g.chips.filter((c) => c.role !== 'rejected').map((c) => ({ id: c.id, label: c.label })) })).filter((g) => g.chips.length);
  const findings = Object.values(study.docs.findings).map((f) => ({ id: f.id, name: f.name }));
  const findingIds = new Set(findings.map((f) => f.id));
  const byId = new Map(items.map((i) => [i.id, i]));
  const label = (id: string) => {
    const g = model.tags.find((x) => x.chips.some((c) => c.id === id));
    return g ? `${g.name}: ${model.chipLabel.get(id) ?? id}` : '';
  };
  const fieldsOf = (chips: string[], finding: string | null | undefined, newFinding?: string | null): [string, string][] => [
    ...model.tags.map((g): [string, string] => [g.name, chips.filter((c) => g.chips.some((x) => x.id === c)).map((c) => model.chipLabel.get(c) ?? c).join(', ')]).filter(([, v]) => v),
    ...(finding ? [['Befund', study.docs.findings[finding]?.name ?? finding] as [string, string]] : []),
    ...(newFinding ? [['Neuer Befund (Vorschlag)', newFinding] as [string, string]] : []),
  ];
  const out: Change[] = [];
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
      // what the statement would carry afterwards
      const add: string[] = [];
      for (const g of groups) {
        const tg = model.tags.find((x) => x.id === g.id)!;
        const picked = (s.chips?.[g.id] ?? []).filter((c) => g.chips.some((x) => x.id === c));
        const had = cur.chips.some((c) => tg.chips.some((x) => x.id === c));
        for (const c of g.multi ? picked : had ? [] : picked.slice(0, 1)) if (!cur.chips.includes(c)) add.push(c);
      }
      const finding = !cur.finding && s.finding && findingIds.has(s.finding) ? s.finding : null;
      const newFinding = !cur.finding && !finding && s.newFinding ? String(s.newFinding).slice(0, 120) : null;
      if (!add.length && !finding && !newFinding) continue;
      out.push({
        id: `ai:${it.id}`,
        kind: 'konflikt',
        group: it.person,
        label: `KI-Vorschlag: ${[...add.map(label), finding ? `Befund „${study.docs.findings[finding]?.name}“` : '', newFinding ? `neuer Befund „${newFinding}“` : ''].filter(Boolean).join(' · ')}`,
        current: { text: cur.de || cur.text, fields: fieldsOf(cur.chips, cur.finding) },
        incoming: { text: cur.de || cur.text, fields: fieldsOf([...cur.chips, ...add], cur.finding ?? finding, newFinding) },
        choice: 'neu',
        apply: (c, w) => {
          if (c !== 'neu') return;
          const now = w.items[it.id];
          if (!now) return;
          w.items[it.id] = {
            ...now,
            chips: [...new Set([...now.chips, ...add])],
            suggested: now.suggested.filter((x) => !add.includes(x)),
            finding: now.finding ?? finding,
            suggestedFinding: null,
            suggestedNewFinding: newFinding ?? now.suggestedNewFinding ?? null,
          };
        },
      });
    }
    done += batch.length;
    onProgress?.(done, items.length);
  }
  return out;
}

const AI_NAMES: [string, string] = ['Aktuell', 'KI-Vorschlag'];
const AI_INTRO = 'Die KI schlägt Tags und Befunde vor. Alle Vorschläge sind vorausgewählt: abwählen („Aktuell behalten“), was nicht übernommen werden soll; Übernommenes zählt als bestätigter Tag. Vor dem Übernehmen wird der jetzige Stand gesichert.';

// ---- import ----
export function NotesImport() {
  const ctx = useCtx();
  const { study, model } = ctx;
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const notes = study.docs.notes.main;

  const [plan, setPlan] = useState<{ title: string; changes: Change[]; reason: string; ai?: boolean } | null>(null);
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
        const changes = await suggestFor(ctx, todo, (d, a) => setMsg(`KI-Vorschläge: ${d} von ${a} …`));
        if (changes.length) setPlan({ title: `KI-Vorschläge (${changes.length} Aussagen)`, changes, reason: 'KI-Vorschläge', ai: true });
        setMsg(changes.length ? `KI-Vorschläge für ${changes.length} Aussagen: im Fenster prüfen.` : 'KI: keine neuen Vorschläge.');
      } catch (e) {
        setMsg(`Import fertig; KI-Vorschläge nicht verfügbar (${String((e as Error).message)}).`);
      } finally {
        setBusy(false);
      }
    }
  }
  const [applying, setApplying] = useState<string | null>(null);

  return (
    <Section title="Import: Notizen">
      <div className="st-toolbar">
        <label className="st-file">
          Datei wählen (.md, .txt)
          <input
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
          {...(plan.ai ? { names: AI_NAMES, intro: AI_INTRO } : {})}
          onCancel={() => {
            setPlan(null);
            setMsg(plan.ai ? 'KI-Vorschläge verworfen: nichts übernommen.' : 'Abgebrochen: nichts übernommen.');
          }}
          onApply={(choices) => {
            setApplying('Stand wird gesichert, Änderungen werden übernommen …');
            void applyChanges(study, plan.changes, choices, plan.reason)
              .then((summary) => {
                setPlan(null);
                if (plan.ai) return setMsg(`${summary}.`);
                return after(summary);
              })
              .catch((e) => setMsg(`Nicht übernommen: ${String((e as Error).message)}`))
              .finally(() => setApplying(null));
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
  const tag = (chip: string) => (onTag ? onTag(g, chip) : onChange(toggleChip(item, g, chip)));
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
      ) : (
        <button type="button" className="st-linkbtn" onClick={() => setEditDe(true)}>
          + Deutsche Fassung
        </button>
      )}
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
        <p data-notr>{item.text}</p>
      )}
    </div>
  );
  return (
    <div ref={rowRef} className={`st-item${item.confirmed ? ' is-confirmed' : ''}${item.status ? ` is-${item.status}` : ''}${fresh ? ' is-fresh' : ''}${selected ? ' is-selected' : ''}`}>
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
        <div className="st-item-more">
          {!showInt && (
            <button type="button" className="st-linkbtn" onClick={() => setShowInt(true)}>
              + Interpretation
            </button>
          )}
          {!showAdd && (
            <button type="button" className="st-linkbtn" onClick={() => setShowAdd(true)} title="Woran du dich später erinnerst – getrennt von der Originalnotiz">
              + Nachträgliche Ergänzung
            </button>
          )}
        </div>
      </div>
      <div className="st-item-chips">
        {model.tags.map((g) => (
          <ChipCell key={g.id} item={item} g={g} onChange={save} labelOnly onTag={onTag} many={many} />
        ))}
        <div className="st-cell">
          <span className="st-cell-label">Befund</span>
          {sf && (
            <button type="button" className="st-chip is-suggested" title="Vorschlag: klicken zum Bestätigen" onClick={() => save({ ...item, finding: sf.id, suggestedFinding: null })}>
              {sf.name}
            </button>
          )}
          {!sf && item.suggestedNewFinding && !item.finding && <span className="st-chip is-suggested is-new" title="neuer Befund vorgeschlagen (unter „Befunde“ anlegen)">{item.suggestedNewFinding}</span>}
          <select value={item.finding ?? ''} onChange={(e) => save({ ...item, finding: e.target.value || null, suggestedFinding: null })} aria-label="Befund">
            <option value="">–</option>
            {findings.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="st-item-actions">
        <button type="button" className={item.confirmed && !open ? 'is-on' : ''} onClick={() => save(confirmItem(item, model.tags))} title="Vorschläge übernehmen und als geprüft markieren">
          {item.confirmed && !open ? 'Geprüft' : open ? 'Bestätigen' : 'Geprüft?'}
        </button>
        <button type="button" onClick={() => setEditDe(true)} title="Deutsche Fassung bearbeiten">
          Deutsch bearbeiten
        </button>
        <button type="button" onClick={() => setEditOrig(true)} title="Original korrigieren: wird mit altem und neuem Wortlaut protokolliert; neue Zeile teilt die Aussage">
          Original korrigieren
        </button>
        <button type="button" onClick={() => (setQOnlyThis(false), setEditQ(true))} title={item.question ? 'Frage bearbeiten (gilt für alle Aussagen mit dieser Frage, wahlweise nur diese)' : 'Dieser Aussage eine Frage zuordnen'}>
          {item.question ? 'Frage bearbeiten' : 'Frage hinzufügen'}
        </button>
        <button type="button" onClick={() => confirm('Aussage löschen?') && remove(item)} title="Löschen">
          Löschen
        </button>
      </div>
    </div>
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
    const put = selShown.map((i) => (add ? setChip(i, g, pickTag) : { ...i, chips: i.chips.filter((c) => c !== pickTag) })).filter((n, k) => n.chips.join() !== selShown[k].chips.join());
    if (put.length) study.commit(put.map((p) => ({ coll: 'items' as const, id: p.id, data: p })));
  };

  // the AI's suggestions, checked in the review window before anything is stored
  const [aiPlan, setAiPlan] = useState<Change[] | null>(null);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  // a tag clicked on one of several selected statements: set on all of them, or (already on the clicked one) taken off all
  const tagSelected = (clicked: ItemDoc, g: TagGroup, chip: string) => {
    const on = !clicked.chips.includes(chip);
    const put = selShown.map((i) => (on ? setChip(i, g, chip) : { ...i, chips: i.chips.filter((c) => c !== chip) })).filter((n, k) => n.chips.join() !== selShown[k].chips.join());
    if (!put.length) return;
    study.commit(put.map((p) => ({ coll: 'items' as const, id: p.id, data: p })));
    logChange(study, `Tag „${model.chipLabel.get(chip) ?? chip}“ ${on ? 'gesetzt' : 'entfernt'}: ${put.length} ausgewählte Aussagen`);
  };
  async function suggestOpen() {
    setBusy('KI-Vorschläge …');
    try {
      const changes = await suggestFor(ctx, open, (d, a) => setBusy(`KI-Vorschläge: ${d} von ${a} …`));
      setBusy(changes.length ? null : 'KI: keine neuen Vorschläge.');
      if (changes.length) setAiPlan(changes);
    } catch (e) {
      setBusy(`KI nicht verfügbar: ${String((e as Error).message)}`);
    }
  }

  if (!model.allItems.length) return <Empty>Noch keine Notizen. Unter „Import“ einlesen.</Empty>;
  return (
    <>
      <div className="st-toolbar">
        <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Anzeige">
          <option value="all">Alle Aussagen ({live.length})</option>
          <option value="open">Ungeprüft ({open.length})</option>
          <option value="changed">Geändert / neu ({live.filter((i) => i.status).length})</option>
        </select>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suchen" />
        <button type="button" disabled={!open.length || !!busy?.endsWith('…')} onClick={() => void suggestOpen()}>
          KI-Vorschläge für ungeprüfte
        </button>
        {busy && <span className="st-muted">{busy}</span>}
      </div>
      {aiPlan && (
        <ChangeModal
          title={`KI-Vorschläge (${aiPlan.length} Aussagen)`}
          changes={aiPlan}
          names={AI_NAMES}
          intro={AI_INTRO}
          busy={aiBusy}
          onCancel={() => setAiPlan(null)}
          onApply={(choices) => {
            setAiBusy('Wird übernommen …');
            void applyChanges(study, aiPlan, choices, 'KI-Vorschläge')
              .then(() => setAiPlan(null))
              .finally(() => setAiBusy(null));
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
          <section key={pid} className="st-section st-notes-person">
            <header className="st-notes-head">
              <h2>{pid}</h2>
              {meta?.name && <span className="st-name" data-notr>{meta.name}</span>}
              {meta?.link && <span className="st-muted" data-notr>{meta.link}</span>}
              {meta?.slot && <span className="st-muted" data-notr>{meta.slot}</span>}
              {meta?.group && <span className="st-muted">Gruppe {meta.group}</span>}
              {person?.groupMismatch && <span className="st-flag">Tracking: {person.trackedGroup}</span>}
              {person?.excluded && <span className="st-flag">ausgeschlossen</span>}
              <button type="button" onClick={() => study.commit(mine.map((i) => ({ coll: 'items' as const, id: i.id, data: confirmItem(i, model.tags) })))}>
                Alle bestätigen
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
const sectionRank = (s: Sec) => ({ during: 0, followup: 1, survey: 2 })[s];

// ---- Nach Priorität ----
export function Priority() {
  const { model, slice } = useCtx();
  const roles: [ChipRole, string][] = [
    ['essential', 'Essenziell'],
    ['tbd', 'Offen (t.b.d.)'],
    ['nice', 'Nice-to-have'],
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
            {i.finding && study.docs.findings[i.finding] ? ` · ${study.docs.findings[i.finding].name}` : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ---- Tags: groups and chips, editable ----
export function Tags() {
  const { study, model } = useCtx();
  const saveGroup = (g: TagGroup) => study.commit([{ coll: 'tags', id: g.id, data: g }]);
  // a deleted chip leaves every statement
  const dropChips = (ids: string[]) =>
    model.allItems
      .filter((i) => i.chips.some((c) => ids.includes(c)) || i.suggested.some((c) => ids.includes(c)))
      .map((i) => ({ coll: 'items' as const, id: i.id, data: { ...i, chips: i.chips.filter((c) => !ids.includes(c)), suggested: i.suggested.filter((c) => !ids.includes(c)) } }));
  const uses = (id: string) => model.allItems.filter((i) => i.chips.includes(id)).length;
  const ROLES: [ChipRole | '', string][] = [
    ['', '–'],
    ['game', 'Bereich: Spiel'],
    ['survey', 'Bereich: Umfrage'],
    ['process', 'Bereich: Ablauf'],
    ['problem', 'Art: Problem'],
    ['positive', 'Art: Positiv'],
    ['surprise', 'Art: Überraschung'],
    ['remark', 'Art: Anmerkung'],
    ['intervention', 'Moderation: Eingriff'],
    ['essential', 'Priorität: essenziell'],
    ['tbd', 'Priorität: offen'],
    ['nice', 'Priorität: nice-to-have'],
    ['rejected', 'verworfen (zählt nicht)'],
  ];
  const slug = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'tag';
  return (
    <>
      {model.tags.map((g) => (
        <section key={g.id} className="st-section st-taggroup">
          <header className="st-notes-head">
            <input className="st-groupname" defaultValue={g.name} onBlur={(e) => e.target.value !== g.name && saveGroup({ ...g, name: e.target.value })} aria-label="Name der Kategorie" />
            <label className="st-check">
              <input type="checkbox" checked={g.multi} onChange={(e) => saveGroup({ ...g, multi: e.target.checked })} />
              mehrere je Aussage
            </label>
            <button
              type="button"
              onClick={() => {
                if (!confirm(`Kategorie „${g.name}“ mit allen Tags löschen? Die Tags werden von allen Aussagen entfernt.`)) return;
                study.commit(dropChips(g.chips.map((c) => c.id)), [{ coll: 'tags', id: g.id }]);
              }}
            >
              Kategorie löschen
            </button>
          </header>
          <div className="st-chipedit">
            {g.chips.map((c: Chip) => (
              <div key={c.id} className="st-chipedit-row">
                <input defaultValue={c.label} onBlur={(e) => e.target.value !== c.label && saveGroup({ ...g, chips: g.chips.map((x) => (x.id === c.id ? { ...x, label: e.target.value } : x)) })} aria-label="Tag" />
                <select value={c.role ?? ''} onChange={(e) => saveGroup({ ...g, chips: g.chips.map((x) => (x.id === c.id ? { ...x, role: (e.target.value || undefined) as ChipRole } : x)) })} aria-label="Bedeutung">
                  {ROLES.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
                <span className="st-muted">{uses(c.id)}×</span>
                <button
                  type="button"
                  onClick={() => {
                    if (uses(c.id) && !confirm(`„${c.label}“ von ${uses(c.id)} Aussagen entfernen?`)) return;
                    study.commit([{ coll: 'tags', id: g.id, data: { ...g, chips: g.chips.filter((x) => x.id !== c.id) } }, ...dropChips([c.id])]);
                  }}
                >
                  Löschen
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => {
                const label = prompt('Neuer Tag');
                if (!label?.trim()) return;
                let id = slug(label);
                while (model.chipLabel.has(id)) id += '-2';
                saveGroup({ ...g, chips: [...g.chips, { id, label: label.trim() }] });
              }}
            >
              + Tag
            </button>
          </div>
        </section>
      ))}
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

// ---- the Übersicht's lists: essential problems, positive, unexpected ----
export function FeedbackLists() {
  const { model, slice, study } = useCtx();
  const view = useContentView();
  const total = model.included.length;
  const block = (role: ChipRole, title: string) => {
    const items = itemsWithRole(slice.items, model, role);
    const groups = new Map<string, ItemDoc[]>();
    for (const i of items) {
      const k = i.finding && study.docs.findings[i.finding] ? `f:${i.finding}` : `i:${i.id}`;
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
      {block('essential', CATEGORY.essential)}
      {block('positive', CATEGORY.positive)}
      {block('surprise', CATEGORY.surprise)}
      {block('intervention', CATEGORY.intervention)}
    </>
  );
}
