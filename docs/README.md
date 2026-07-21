# docs/

Project documentation — plain Markdown, versioned with the code. Open this
folder directly in VS Code, or as an [Obsidian](https://obsidian.md) vault for a
wiki-style writing experience (Obsidian works on these same `.md` files and
leaves the Git repo untouched).

## Structure

```
docs/
├── devlogs/                     weekly summaries (not daily — a chore-free cadence)
│   ├── _template.md             copy this to start a new week
│   └── YYYY-MM-weekN.md         one file per week
├── design-decisions/           Design Decision Records (ADRs)
│   ├── 000-template.md          copy this for a new decision
│   └── NNN-short-title.md       one file per major decision, numbered
└── GamePitch.md                 the elevator pitch + thesis framing
```

## How to use it

- **Weekly summary** — each Friday/Monday, copy `devlogs/_template.md` to
  `devlogs/YYYY-MM-weekN.md` and fill: Goals, Accomplishments, Blockers/Bugs,
  Next Steps. Keep the **TL;DR / Key Facts** block at the top so you (and your
  professors) can scan a week in seconds.
- **Design decision** — whenever you make a real pivot (mechanics, art style, a
  cut feature, an architecture choice), copy `design-decisions/000-template.md`
  to the next number and record **Context / Decision / Consequences**. These
  show the *evolution* of your ideas, which is what the HTW examiners want.

## Naming

- Dev logs: `YYYY-MM-weekN.md` (e.g. `2026-07-week2.md`) — sorts chronologically.
- ADRs: `NNN-short-title.md` with a zero-padded, ever-increasing number.
