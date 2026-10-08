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
7. **All writes in one `db.transaction`.** The runner's refusal message tells the operator a failure
   rolled back; that is only true when every write is inside one transaction.
8. **A DELETION correction inverts rules 2 and 5, and that is the only sanctioned exception.** A
   household deletion under
   [PRIV-1](../../../../docs/runbooks.md) ("Delete a household and everyone in it") must remove
   **soft-deleted rows too** — they are exactly what has to go — so `deleted_at` appears in no
   `WHERE`, and **existence is the guard**: a second run finds nothing, which is what keeps it
   idempotent. Rule 4 is meaningless for a delete, and rule 6's **Applied** table must **not** record
   which household was deleted — that would publish a permanent register of who asked to be erased,
   in a public repo. The exception is written here, next to the rules it excuses, for the same reason
   a `-- squawk-ignore` sits above its statement. ⚠️ `PRIV-3` is the row that builds it, and it is
   **not** a drop-in entry: `Correction.run` takes no target and the runner ignores positional args,
   so it needs a `--household <public_id>` flag — a runner change, with its own plan.
9. **Redact privileged values before pasting output.** This repo is public. A dry run may print a
   privileged value (a child's bodyweight, on its own marked line); never paste that into a PR, issue
   or commit — replace it with `…`.

10. **A correction's `name` describes the DEFECT, never the person.** `kb-swings-2026-09-28`, not a
    child's first name — this repo is public and these rows belong to minors (AGENTS.md → "No personal
    names"; `OSS-1`). Same for the identifiers and the prose: the target is "an athlete", resolved by
    `public_id`. A `name` is only the `db:correct` selector — nothing persists it — so it is safe to fix
    a bad one, and the **Applied** table below is the record that survives the change.

## Adding one

Add an entry to `registry.ts`. A correction is a `name`, a one-line `what`, the `issue` row that
fixes the cause, and a `run(db, apply)` that returns what it changed. Nothing else to wire —
`db:correct` lists what it finds.

## Applied

**`Applied`** is the date `--apply` actually ran, or `pending` — the `Correction` type carries no
applied flag and `--apply` leaves no artifact, so this column is the only record. A correction merges
before it is run, so a row lands here as `pending` and is dated in a follow-up commit.

| Name                               | What                                                                                   | Cause fixed by | Applied        |
| ---------------------------------- | -------------------------------------------------------------------------------------- | -------------- | -------------- |
| `kb-swings-2026-09-28`             | 5 KB-swing sets logged `20 × BW`; they were `10 reps × 20 lb`                          | V1-24          | **2026-09-30** |
| `bodyweight-duplicates-2026-09-30` | 3 weigh-ins on one day; the 12:17 morning row is the keeper                            | V1-24          | **2026-10-01** |
| `null-routine-to-full-2026-10-07`  | Live profiles on `routine_config = NULL` rode the whole-catalog default ONB-0 narrowed | ONB-0          | `pending`      |

<sub>⚠️ **The first two `Name`s changed under `OSS-1` (2026-10-08)** — they used to start with a child's
first name, which this public repo should not carry (AGENTS.md → "No personal names"). Safe to rename:
the `Correction` type has no applied flag and `--apply` leaves no artifact, so a `name` is only the
`db:correct` selector, never a key stored in a database. Both were already applied, and both are guarded,
so a re-run under either name would be a no-op anyway. A correction's name describes the DEFECT from now
on, not the person it happened to.</sub>

<sub>The KB-swings date is read off the rows themselves (`entry_sets.updated_at =
2026-09-30 00:26:52+00`), not recalled — the column was added after that correction ran.</sub>
