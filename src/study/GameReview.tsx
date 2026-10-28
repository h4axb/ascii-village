// New game data waits here until it is checked: a strip on every page says
// how much came in or changed since the accepted stand, and its dialog takes
// over what is chosen (new records ticked, every conflict to decide).
import { useMemo, useState } from 'react';
import { ChangeModal } from './ChangeModal';
import { gameChoice, planGame, type GameKept } from './gamePlan';
import { logChange, useCtx } from './ui';
import { fmtBerlin } from './match';

export function GameReview() {
  const { study } = useCtx();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const keptDoc = study.docs.settings.gameKept;
  const kept = useMemo(() => (keptDoc ?? {}) as GameKept, [keptDoc]);
  const plan = useMemo(() => (study.live && study.stand ? planGame(study.game, study.live, kept) : null), [study.game, study.live, study.stand, kept]);
  if (study.viewing || !plan) return null;
  const conflicts = plan.changes.filter((c) => c.kind === 'konflikt').length;
  const fresh = plan.changes.length - conflicts;
  if (!plan.changes.length && !msg) return null;
  return (
    <div className="st-gamebar" role="status">
      {plan.changes.length > 0 ? (
        <>
          <span>
            Neue Spieldaten seit {study.stand ? fmtBerlin(study.stand.at) : '–'}: {fresh} neu{conflicts ? ` · ${conflicts} geändert oder entfernt` : ''} – noch nicht übernommen.
          </span>
          <button
            type="button"
            onClick={() => {
              setMsg(null);
              void study.refreshLive().then(() => setOpen(true));
            }}
          >
            Prüfen
          </button>
        </>
      ) : (
        <span>{msg}</span>
      )}
      {open && plan.changes.length > 0 && (
        <ChangeModal
          title="Neue Spieldaten prüfen"
          changes={plan.changes}
          names={['Übernommen', 'Im Spiel jetzt']}
          intro="Die Auswertung rechnet nur mit übernommenen Spieldaten. Neues, Änderungen und Löschungen im Spiel sind vorausgewählt; abwählen bzw. „Aktuell behalten“, was nicht übernommen werden soll. Der jetzige Stand wird vorher gesichert."
          busy={busy}
          onCancel={() => setOpen(false)}
          onApply={(choices) => {
            const { accept, drop, n, kept: nextKept } = gameChoice(plan, choices, study.live!, kept);
            setBusy('Wird gesichert und übernommen …');
            void study
              .saveVersion('vor Spieldaten übernehmen')
              .then(() => study.acceptGame(accept, drop, `Spieldaten: ${n} Änderungen übernommen`))
              .then(() => {
                study.commit([{ coll: 'settings', id: 'gameKept', data: nextKept }]);
                const kept = plan.changes.filter((c) => c.kind === 'konflikt' && choices[c.id] === 'alt').length;
                const summary = `Spieldaten: ${n} Änderungen übernommen${kept ? `, ${kept} Konflikte beim übernommenen Stand belassen` : ''}`;
                logChange(study, summary);
                setMsg(`${summary}.`);
                setOpen(false);
              })
              .catch((e) => setMsg(`Nicht übernommen: ${String((e as Error).message)}`))
              .finally(() => setBusy(null));
          }}
        />
      )}
    </div>
  );
}
