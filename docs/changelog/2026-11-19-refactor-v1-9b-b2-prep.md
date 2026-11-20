- **2026-11-19** — **Clear this day's shared pieces are in place, with nothing on screen changed**
  (`V1-9b` B2-prep; [plan](../plans/v1-9b-delete-and-restore.md) § "B2 as amended"):
  - `SheetFormFooter` moved to `components/ui/`, with a `variant` and a `cancel` label; Copy and Put
    on look the same;
  - the `destructive` button variant is solid, with its own `--destructive-foreground` (4.76:1 light,
    6.19:1 dark) and the ✓'s focus outline. No screen uses it yet; `/design/tokens` renders it, so
    the a11y scan covers it;
  - `lib/a11y/focus-handoff.ts`, a one-shot focus hand-off between two islands, and
    `lib/a11y/pointer.ts`'s `prefersFineFocus()`, which the movement picker now reads;
  - the e2e stored-theme seeding and the "actually dark" guard, shared by `a11y.spec.ts` and
    `theme.spec.ts`.
