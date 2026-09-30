# Data corrections

**Reusable, guarded, idempotent one-off fixes for wrong data in a live database.**

`pnpm --filter @mat-plan/db db:correct <name> [--apply]`

Every correction is **dry-run by default**: it prints the rows it would change and exits without
writing. `--apply` is the only thing that writes.

## When you need one

When data is wrong in a way the **app cannot fix**. That is not a hypothetical — the app has no
delete action, and several shapes are deliberately not editable (a bodyweight set, a labelled set, a
non-`done` set), so a mis-tap can be genuinely unrecoverable through the UI. See
[docs/features/strength-logging.md](../../../../docs/features/strength-logging.md) → Traps.

**Prefer fixing the app.** A correction is for data already on the board; the bug that produced it
still needs its own PR. Each correction below names the row that fixes the cause.

## The rules, and they are not optional

1. **Dry run first, always.** The script refuses to write without `--apply`. Read the diff it prints.
2. **Guarded.** Every `WHERE` includes the value being corrected FROM, so re-running is a no-op
   rather than a second, wrong write. This is what makes them idempotent.
3. **Targeted by `public_id`**, never an internal `bigint` id — ids differ between environments, and
   a correction aimed at the wrong row in prod is worse than the bug.
4. **`updated_at = now()`** on every touched row, for LWW hygiene (v1.5's sync compares it).
5. **Soft-delete aware** — `deleted_at IS NULL` everywhere, so a correction never resurrects a
   deleted row.
6. **Keep them after they run.** A correction is a record of what was wrong and when. They are cheap
   to keep and they document the failure; a row in the **Applied** table below marks one as done.

## Adding one

Add an entry to `registry.ts`. A correction is a `name`, a one-line `what`, the `issue` row that
fixes the cause, and a `run(db, apply)` that returns what it changed. Nothing else to wire —
`db:correct` lists what it finds.

## Applied

| Name                        | What                                                          | Cause fixed by |
| --------------------------- | ------------------------------------------------------------- | -------------- |
| `liam-kb-swings-2026-09-28` | 5 KB-swing sets logged `20 × BW`; they were `10 reps × 20 lb` | V1-24          |
