# Notes for Claude

## User-test dashboard (`/feedback`, `src/study/`): previews for every UI change

For every change to the dashboard's UI, show a before/after preview, before
implementing it (from a mockup) and again after it (from the real app):

- **Before and after**, each at **desktop (1300 × 1000), tablet (834 × 1112)
  and mobile (390 × 844)**, for the states that matter to the change (e.g.
  default, editing, edited before saving).
- **One separate PNG per screenshot**, all framed in the same portfolio style
  so they read as one portfolio piece:
  - background #fafafa;
  - a small light-grey caption "Aktuell · Desktop · Standard" / "Neu · …" (Inter);
  - rounded corners, a soft shadow, 2× resolution.

  Frame them with `node scripts/portfolio-frame.cjs <in-dir> <out-dir>`
  (raw files named `aktuell|neu-desktop|tablet|mobile-<n>-<state>.png`).
- Take the "Aktuell" screenshots from the app **before** changing the code.
- Take each screenshot as a **viewport shot after scrolling** to the part shown
  (not a cut from a full-page capture). That way the sidebar is always complete,
  from "Übersicht" down to "Ergebnisse & Export", and so is the sticky page head.

## Qualitatives Feedback: keep the statement rows as they are

The statement rows keep their original UI/UX when the page layout around them
changes (restored on request after a redesign):
- the square checkbox;
- the P-ID badge and the Abschnitt dropdown (Beobachtung / Nachgespräch);
- "+ Interpretation hinzufügen";
- the tag chips (suggestions to click) and the "Tags bearbeiten" link that opens the tag editor;
- on the right, "Geprüft?" / "Geprüft ✓" and "Bearbeiten ⋯".

Reference images that show simpler rows are about the layout around the
rows (card, filters, search), not a reason to change the rows themselves.
