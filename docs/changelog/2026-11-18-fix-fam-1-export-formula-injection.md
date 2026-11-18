- **2026-11-18** — **The export's cells open as text, never as a spreadsheet formula** (the
  maintainer's decision, 2026-11-18, from #582's review). A value starting with `=`, `+`, `-`, `@` or a
  tab is written with a leading `'`, so a workout name, a note or a typed movement such as
  `=HYPERLINK(…)` shows as text when a family opens its own export. The rule is in
  `packages/shared/src/csv/row.ts`, the one place every cell is written, so it covers the strength log,
  bodyweight and check-ins. The privacy notice says so.
