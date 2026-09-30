---
name: data-correction
description: Fix wrong data in the live mat-plan database that the app cannot fix (no delete action, uneditable shapes) with a guarded, idempotent, dry-run-first correction in packages/db/scripts/corrections/registry.ts, run via db:correct — and make sure the underlying bug gets its own backlog row and PR. Use when the user says data is wrong in prod, "delete that entry", "fix Liam's sets", "I mis-tapped", or asks for a correction.
---

# Data correction

Rules: [packages/db/scripts/corrections/README.md](../../../packages/db/scripts/corrections/README.md).
Procedure: [docs/runbooks.md](../../../docs/runbooks.md) → "Correct wrong data in prod". The model to
copy is `liamKbSwings` in `registry.ts`.

**This writes to real people's training history.** Nothing runs with `--apply` without the user
reading the dry run and saying so.

## 0. Should this be a correction at all?

- The app can fix it (an edit exists)? → have the user do that. No correction.
- The app _should_ be able to fix it? → a correction treats the data, **and** the bug gets its own
  backlog row and PR. Name that row before writing any code. It becomes `issue`.

## 1. Pin down the exact rows (read-only)

Get the profile's `public_id`, the day, and what's wrong from the user. Query read-only first, via
the Neon SQL editor or a dry run. Record the **current (wrong) values**. They become the guard.

## 2. Write the correction (`packages/db/scripts/corrections/registry.ts`)

```ts
/** <date> — <what was wrong, who noticed>. Cause: <app bug + backlog row>. Fix: <per-row change>. */
const shortCamelName: Correction = {
  name: 'short-kebab-name',
  what: 'Corrected <thing> for <who> on <day>', // one line, past tense
  issue: 'V1-xx', // the row that fixes the CAUSE
  async run(db, apply) {
    const rows = await db.select(...)            // join through profiles by publicId
      .where(and(<GUARD: the value being corrected FROM>, isNull(t.deletedAt), ...));
    const changes = rows.map((r) => `<id>: <from> → <to>`);
    if (!apply || rows.length === 0) return changes;
    await db.transaction(async (tx) => {        // all or nothing: half-applied is worse than the bug
      for (const r of rows) await tx.update(t).set({ ..., updatedAt: sql`now()` }).where(<same guard + id>);
    });
    return changes;
  },
};
```

Then add it to `CORRECTIONS`. The rules and why they matter:

- **Guarded**: every WHERE includes the _from_ value, so a second run matches 0 rows. That makes it
  idempotent, and a re-run after a partial failure is safe.
- **Target by `public_id`** (or a slug), never an internal bigint.
- **`deleted_at IS NULL`** on every joined table.
- **`updated_at = now()`** on every update, for LWW.
- **Soft-delete, never `DELETE`**: set `deleted_at`.
- **Keep it after it runs.** It documents the failure.

## 3. Rehearse locally, then dry-run against prod

```bash
pnpm --filter @mat-plan/db db:correct                          # lists corrections
DATABASE_URL_UNPOOLED=<local sandbox> pnpm --filter @mat-plan/db db:correct <name>   # sandbox: apps/web/scripts/local-db.ts
DATABASE_URL_UNPOOLED=<prod direct> pnpm --filter @mat-plan/db db:correct <name>     # DRY RUN (default)
```

**Check the printed target host before reading anything else.** It is the only environment guard;
there is no confirmation prompt. Show the user the `·` change lines and get an explicit go-ahead.

## 4. Apply, then prove it's done

```bash
DATABASE_URL_UNPOOLED=<prod direct> pnpm --filter @mat-plan/db db:correct <name> --apply
DATABASE_URL_UNPOOLED=<prod direct> pnpm --filter @mat-plan/db db:correct <name>     # must print 0 changes
```

Add a row to the README's **Applied** table (name / what / cause). Note that the README mentions an
`applied` flag in the registry, but the `Correction` type has none; the table is the record. Ship
it with `ship-pr` (`feat(db): …` or `fix(db): …`), with the backlog row for the cause linked.

## Red flags

- `--apply` before the user has seen the dry run.
- A guard that doesn't include the wrong value, so a re-run would change rows again.
- `DELETE`, or an update that misses `updated_at`.
- No backlog row for the cause ("we'll fix the app later" with nothing filed).
- There are no automated tests for corrections. The dry run and the 0-change re-run are the only
  proof, so don't skip either.
