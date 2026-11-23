// Coaching Questions (/journal/log/coaching), a sub page of the Project Log:
// every block of a coaching category ("Coaching …", isCoachingKind) from the
// log's entries and tasks, at once, with its answer typed right in. The
// answer is stored on the question's own block (Block.answer), so the entry
// in the Project Log shows it too: one record, shown in two places.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Markdown } from './markdown';
import { PageHead } from './pages';
import type { JournalStore } from './store';
import { blockKindOf, blockKinds, blockTitle, fmtDate, isCoachingKind, type Block, type Entry, type Task } from './types';
import { Icon } from './ui';

interface Question {
  e: Entry;
  t?: Task;
  b: Block;
}
type Show = 'all' | 'open' | 'answered';

// the answer into the entry as it is now (not as it was when the page drew),
// on the block of that id: the entry's own blocks or a task's
async function saveAnswer(store: JournalStore, entryId: string, blockId: string, answer: string) {
  const e = store.docs.entries[entryId];
  if (!e) return;
  const set = (bs: Block[]) => bs.map((b) => (b.id === blockId ? { ...b, answer: answer.trim() ? answer : undefined } : b));
  const next: Entry = { ...e, blocks: set(e.blocks), tasks: (e.tasks ?? []).map((t) => ({ ...t, blocks: set(t.blocks ?? []) })), updated: Date.now() };
  await store.commit([{ coll: 'entries', id: e.id, data: next }]);
}

// the answer box: always editable (a click and type), stored a moment after
// typing stops and when leaving the box
function AnswerBox({ store, q }: { store: JournalStore; q: Question }) {
  const saved = q.b.answer ?? '';
  const [text, setText] = useState(saved);
  const [state, setState] = useState<'idle' | 'typing' | 'saved'>('idle');
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  // a change from elsewhere (the entry editor) while not typing here
  useEffect(() => {
    if (!focused.current) setText(saved);
  }, [saved]);
  const flush = (v: string) => {
    clearTimeout(timer.current);
    if (v === saved) return setState('idle');
    void saveAnswer(store, q.e.id, q.b.id, v).then(() => setState('saved'));
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <div className="jr-coach-answer">
      <span className="jr-coach-answer-h">
        Answer
        <span className="jr-muted jr-small" role="status">
          {state === 'typing' ? 'Typing …' : state === 'saved' ? 'Saved' : ''}
        </span>
      </span>
      <textarea
        value={text}
        rows={Math.min(14, Math.max(3, text.split('\n').length + 1))}
        placeholder="Type the answer …"
        aria-label={`Answer to: ${blockTitle(q.b) || q.b.md.slice(0, 60)}`}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false;
          flush(text);
        }}
        onChange={(x) => {
          const v = x.target.value;
          setText(v);
          setState('typing');
          clearTimeout(timer.current);
          timer.current = setTimeout(() => flush(v), 900);
        }}
      />
    </div>
  );
}

export function CoachingPage({ store, openEntry }: { store: JournalStore; openEntry: (id: string, task?: string) => void }) {
  const kinds = blockKinds(store.docs.settings);
  const coach = kinds.filter(isCoachingKind);
  const ids = new Set(coach.map((k) => k.id));
  const [show, setShow] = useState<Show>('all');
  const [q, setQ] = useState('');
  const all = useMemo(() => {
    const out: Question[] = [];
    for (const e of Object.values(store.docs.entries)) {
      for (const b of e.blocks) if (ids.has(blockKindOf(b)) && b.md.trim()) out.push({ e, b });
      for (const t of e.tasks ?? []) for (const b of t.blocks ?? []) if (ids.has(blockKindOf(b)) && b.md.trim()) out.push({ e, t, b });
    }
    // newest first
    return out.sort((a, b) => (b.e.date || '0').localeCompare(a.e.date || '0'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.docs.entries, [...ids].join()]);
  const open = all.filter((x) => !x.b.answer?.trim()).length;
  const needle = q.trim().toLowerCase();
  const list = all.filter((x) => (show === 'all' || (show === 'open') === !x.b.answer?.trim()) && (!needle || `${x.b.md} ${x.b.answer ?? ''} ${x.e.title} ${x.t?.title ?? ''}`.toLowerCase().includes(needle)));
  return (
    <div className="jr-log jr-coach">
      <PageHead store={store} id="coaching" />
      {!coach.length ? (
        <p className="jr-muted">No coaching category yet. In an entry, add a block, choose “New category” and name it “Coaching …”: its blocks are listed here.</p>
      ) : (
        <>
          <div className="jr-coach-bar">
            <span className="jr-seg" role="radiogroup" aria-label="Show">
              {(
                [
                  ['all', `All ${all.length}`],
                  ['open', `Open ${open}`],
                  ['answered', `Answered ${all.length - open}`],
                ] as [Show, string][]
              ).map(([id, label]) => (
                <button key={id} type="button" role="radio" aria-checked={show === id} className={show === id ? 'is-on' : ''} onClick={() => setShow(id)}>
                  {label}
                </button>
              ))}
            </span>
            <label className="jr-search">
              <Icon name="search" />
              <input type="search" value={q} placeholder="Search questions and answers …" aria-label="Search questions and answers" onChange={(x) => setQ(x.target.value)} />
            </label>
          </div>
          {!list.length ? (
            <p className="jr-muted">{all.length ? 'No question matches.' : `No ${coach.map((k) => k.label).join(' / ')} block in the Project Log yet.`}</p>
          ) : (
            <ul className="jr-coach-list">
              {list.map((x) => {
                const k = kinds.find((y) => y.id === blockKindOf(x.b))!;
                const title = blockTitle(x.b);
                return (
                  <li key={x.b.id} className="jr-coach-item" style={{ '--k': k.color } as React.CSSProperties}>
                    <div className="jr-coach-q">
                      <span className="jr-coach-meta">
                        <span className="jr-bcard-kind">{k.label}</span>
                        <span className="jr-muted jr-small">{[fmtDate(x.e.date), x.e.title, x.t?.title].filter(Boolean).join(' · ')}</span>
                        <button type="button" className="jr-linkbtn jr-small" onClick={() => openEntry(x.e.id, x.t?.id)}>
                          Open in Project Log
                        </button>
                      </span>
                      {title && <strong className="jr-bcard-title">{title}</strong>}
                      <Markdown md={x.b.md} />
                    </div>
                    <AnswerBox store={store} q={x} />
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
