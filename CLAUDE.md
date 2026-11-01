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

## Qualitatives Feedback: keep the statement rows' editing UI

The statement rows keep their working tools when the layout changes:
- tag chips with suggestions to click;
- the tag editor behind the tag icon;
- the "Als geprüft markieren" / "✓ Geprüft" toggle;
- the "⋯" menu (Deutsch, Original, Frage, Abschnitt, Interpretation, Löschen);
- the round selection.

A reference image that shows only text and a status is about the layout
around the rows, not a reason to drop these.
