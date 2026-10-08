# V1-22 chunk 2 — one renderer, the log-time writer, the export fallback

> Backlog: [docs/plan.md](../plan.md) → **V1-22**. Branch: `feat/v1-22-2-renderer-and-writer`.
> Spec: [v1-22-authoring-program-editing](../specs/v1-22-authoring-program-editing.md), chunk 2
> (`spec:145`). Chunk 1: [v1-22-1-prescribed-snapshot](./v1-22-1-prescribed-snapshot.md).
> Model: [ADR 0005](../decisions/0005-programming-model.md) decision 5. Milestone:
> [beta-1](../milestones/beta-1.md) §3b.

## Goal

Make `entries.prescribed_snapshot` **mean something**: one shared renderer for the `prescribed` CSV
column, a log-time writer that freezes what was asked, and an export that reads the frozen string
when it exists and falls back to today's program only when it does not.

Chunk 1 shipped the column dark. Today **nothing writes it and nothing reads it**, so the export
still reconstructs `prescribed` from the live program at export time — the behaviour
`apps/web/lib/dal/export.ts:94-96` already names as the thing V1-22 breaks: _"It reads TODAY's
program, not the program as it was. Safe while prescriptions are seed-immutable; **V1-22 breaks
it**."_ Chunk 4 is the PR that makes prescriptions mutable. This chunk is the one that has to land
first, or chunk 4's first edit silently rewrites every historical month's CSV.

**Why now, and why this is one PR.** The three pieces are one concern — _the rendered prescription
gets exactly one definition, one writer and one reader_. Splitting them produces strictly worse
intermediate states: a renderer with no caller is dead code, a writer with no reader writes a column
nothing consults, and a reader with no writer is a no-op `?? live`. The deploy-order gate that forced
chunks 1/2 apart does not apply within chunk 2: all three pieces name a column that is already live
in prod.

**Gate, before this merges.** `0013` must be **observed applied** in prod — the catalog query in
[runbooks.md](../runbooks.md) (`:64-77`), not the green tick. Already satisfied as of 2026-10-06
(`docs/status.md:13-17`: live, prod is 51 rows). Re-check on the merge SHA anyway: the runbook's own
rule is "check both, don't assume", and a wedge from an unrelated pending migration also looks fine
in the log.

**Sequencing against V1-30b.** `v1-30b-i` merged as `05e0ccd` (#234) and touched
`strength-form.tsx` (+117), `strength-form-scaffold.ts` (+10), `set-fields.tsx`,
`set-mode-toggles.tsx` and their tests. **This chunk edits the same three files**, and its own
commit message names `30b-ii` (per-unit ceilings and history wording) as the next PR on that track.
So: branch from `main` at or after `05e0ccd`, and treat the v1-30b-i tests as the regression contract
(see Test plan → "What must not regress").

## Acceptance

Spec items **9** (`spec:65-68`), **10** (`:69-71`) and **12** (`:74-76`) in full. Item **11**
(`:72-73`) is **closed by chunk 3** per §Integration (`spec:183`); what chunk 2 owes toward it is
stated below and is not deferred silently.

> 9. **When** a strength set is logged against a prescription, the system **shall** store the
>    rendered prescribed string on the entry, produced server-side by the one shared renderer —
>    never read from the submitted form. For a batch replayed through `/api/sync`, the snapshot
>    **shall** be taken at server-receipt time against the program as it then stands.
>
> 10. **While** an entry's `prescribed_snapshot` **is NULL**, the export **shall** fall back to the
>     live `(day_role, movement)` match, including emitting **empty** on an ambiguous match. `''`
>     and `NULL` **shall** be distinct stored values; the predicate is `IS NULL`, never
>     `coalesce(…,'') = ''`.
>
> 11. `prescribed_snapshot` **shall not** be a field of `ScaffoldRow`, of any type reachable from
>     the log form, or of any progression input — enforced by the **type**, the way `ScaffoldRow`
>     already omits `load`. Exactly one query selects it and exactly one writer writes it.

⚠️ **Acceptance 9's wording is corrected here**, as chunk 1 required (`v1-22-1:69-72`): the write is
once per **entry** (per movement), not per set — `prescriptions` has no authored target at set grain
(`schema.ts:659-660`). Chunk 2 also corrects the spec line.

Done when:

- **The renderer exists once.** `formatPrescribedForExport` in `packages/shared/src/csv/prescribed.ts`
  is the only code in the repo that composes a prescribed string for export. `export.ts`'s inline
  composer (`export.ts:108-111`) is **gone**, not duplicated: `grep -n "filter(Boolean).join(' ')"
apps/web packages` returns only the shared module.
- **`formatPrescription` is untouched.** `apps/web/lib/programming/program-day.ts:64-71` still emits
  `"4 sets × 3"` for the UI card and is NOT a caller. Pinned by a test asserting the two renderers
  disagree on the same input (`4 sets × 3` vs `4x3`), so a later "DRY" merge of them fails loudly.
- **The snapshot is server-derived.** The submitted payload carries a prescription **public id** and
  nothing else about the prescription — no `sets`, no `targetReps`, no `load`, no rendered string.
  The string is composed in `packages/db` from rows read by `programDayRows`.
- **The fallback is `snapshot ?? live`.** `??`, never `||` — pinned by a unit case where the stored
  snapshot is `''` and the live match is `'3x10 per side'`, and the expected output is `''`.
- **The live program is not consulted for a snapshotted row.** The set of `day_role`s passed to the
  live match is built **only from rows whose snapshot is NULL**; a month where every row has a
  snapshot issues **zero** `programDayRows` queries. Pinned by a unit test on the pure helper.
- **Exactly one query, exactly one writer.** A source-scanning vitest guard (the
  `use-server-exports.test.ts:42-64` idiom, with its own "the scan works" case) asserts the only
  files naming `prescribedSnapshot` are `packages/db/src/schema.ts`,
  `packages/db/src/queries/export-month.ts`, `packages/db/src/writers/strength-session.ts`,
  `apps/web/lib/dal/export.ts`, `packages/db/scripts/verify.ts` — and that **nothing under
  `apps/web/app/`** mentions it at all.
- **Type-level containment.** `ScaffoldRow` has no `prescribedSnapshot` and no `load`, asserted by a
  `@ts-expect-error` indexing assertion (it inverts: adding the field makes the directive itself an
  error, so the build fails), alongside the existing V1-26 guard at
  `strength-form-scaffold.test.ts:242-243`.
- **`db:verify` proves the writer end to end** over the real seeded program (five cases, below).
- **One e2e** scaffolds a real day, logs the one prescribed movement, exports the zip and asserts the
  `prescribed` cell's bytes.

## There are TWO live composers, and picking wrong rewrites every month

| Composer                                                               | Emits        | Who reads it                                    |
| ---------------------------------------------------------------------- | ------------ | ----------------------------------------------- |
| inline, inside `prescribedFor` (`apps/web/lib/dal/export.ts:108-111`)  | `4x3 @ 145`  | the **CSV bytes** — `StrengthLogRow.prescribed` |
| `formatPrescription` (`apps/web/lib/programming/program-day.ts:64-71`) | `4 sets × 3` | the **UI** card (`program-reference.tsx`)       |

The one to hoist is the **export** composer. The spec settled it (`spec:267`, panel finding A7) and
the reason is byte permanence: the snapshot is written once and read forever, so hoisting the UI
renderer would make every snapshotted row export `4 sets × 3` while every NULL row exported
`4x3 @ 145` — the column forks into two formats mid-corpus, invisibly, and chunk 3's backfill freezes
the fork.

`formatPrescription`'s docblock explains why it will never be the right one: the `"sets"` **noun** is
load-bearing because the same screen renders a logged set as `reps × weight`, _"so a bare `4 × 3` here
would collide with an established visual grammar that means something else"_ (`program-day.ts:57-62`).
That is a rendering decision about a phone screen. The CSV's `4x3 @ 145` is a decision about a
downstream workflow's parser. They are two formats on purpose.

### Where the renderer lives: `packages/shared/src/csv/prescribed.ts`

Three callers, and the home has to serve all three:

1. the log-time writer — `packages/db/src/writers/` (this chunk);
2. the backfill correction — `packages/db/scripts/corrections/registry.ts` (chunk 3);
3. the export fallback — `apps/web/lib/dal/export.ts` (this chunk).

`packages/shared`, because **(2) cannot import the `server-only` DAL** (`export.ts:1`) and cannot
import across the app→packages edge at all — the same constraint that put the strength write core in
`packages/db` rather than `apps/web/lib/dal` (`strength-session.ts:20-28`).

The **`csv/` subpath**, not the root barrel, for the reason `csv/index.ts:1-9` already states:
_"`index.ts` is an `export *` that 8 `'use client'` components import, and CSV formatting has no
business in a client bundle."_ `packages/db` depends on `@mat-plan/shared` (`packages/db/package.json`)
and the `./csv` subpath is exported (`packages/shared/package.json`), so the writer can import it.

**The input type is DERIVED, never re-typed** — the discipline the spec's data contract imposes on
`programEditSchema` (`spec:101-104`), applied here:

```ts
// packages/shared/src/csv/prescribed.ts
import type { PrescriptionSeedRow, PrescriptionTargetSeedRow } from '../programming';

/**
 * The four authored values the `prescribed` column is composed from, derived from the two seed row
 * schemas (`programming.ts:95-102`, `:109-117`) so a nullability change there cannot leave this
 * renderer claiming a shape the tables no longer have. TYPE-ONLY import, so the csv subpath still
 * pulls in no runtime code from `programming.ts` (and no `PROGRAM_SEED`).
 */
export type PrescribedParts = Pick<PrescriptionSeedRow, 'sets' | 'targetReps'> &
  Pick<PrescriptionTargetSeedRow, 'load' | 'reps'>;

export function formatPrescribedForExport(p: PrescribedParts): string {
  // The per-kid reps override WINS over the prescription's shared target_reps. The collapse lives
  // HERE, not at the call sites, so the two consumers cannot drift on the precedence.
  const reps = p.reps ?? p.targetReps ?? '';
  return [p.sets ? `${p.sets}x${reps}` : reps, p.load ? `@ ${p.load}` : '']
    .filter(Boolean)
    .join(' ');
}
```

**Hoisted verbatim, including the truthiness.** `p.sets ?` (not `p.sets != null`) and `p.load ?` are
kept exactly as `export.ts:108-111` wrote them. `sets = 0` is unreachable
(`prescriptions_sets_check`: `sets is null or sets > 0`, `schema.ts:691`) and `load = ''` is
authored-empty; changing either to a null check would be a silent byte change on an edge the type
permits. Both are pinned by a test so a future "cleanup" fails.

⚠️ **The collapse is for the EXPORT path only.** `toProgramDay` performs the same
`r.reps ?? r.targetReps` collapse (`program-day.ts:48`) and the spec is explicit that it is **not**
reusable on the **edit** path (`spec:308-311`) — reusing it there writes one athlete's override into
the shared field for every sibling. Chunk 4 must not reach for this function either; recorded in
Out-of-scope.

## The prescription identity on the submit payload

The writer cannot derive _which_ prescription a movement fulfilled from the submitted data alone —
that is the gap `docs/csv-recording-gaps.md` P1-2 names, and its own text points at the answer:
_"the V1-19 'Start today's program' button would make natural, since that button already knows which
prescription each form row came from."_

So the identity rides the payload, as the spec's chunk-2 row says (`spec:145`). **One opaque uuid per
movement card, and nothing else.**

| Layer                                                                  | Field                                   | Change                                          |
| ---------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------- |
| `packages/db/src/queries/program-day.ts`                               | `prescriptionPublicId`                  | one more column off an already-joined table     |
| `apps/web/lib/programming/program-day.ts` → `ProgramDayDTO`            | `prescriptionId`                        | mapped in `toProgramDay`                        |
| `apps/web/app/p/[profileId]/strength-form-scaffold.ts` → `ScaffoldRow` | `prescriptionId`                        | the third deliberate widening of this Pick      |
| `strength-form.tsx` → `MovementVals`                                   | `prescriptionId?`                       | **serialized**, unlike `scaffolded`/`declared*` |
| `packages/shared/src/strength-session.ts` → `sessionMovementSchema`    | `prescriptionId: uuidSchema.optional()` | the wire contract                               |
| `apps/web/lib/dal/entries.ts` → `SessionMovementInput` (inferred)      | —                                       | flows through the existing spread               |
| `packages/db/.../strength-session.ts` → `ResolvedSessionMovement`      | `prescriptionId?`                       | the **un-resolved wire key**                    |

**Why the name stays `prescriptionId` all the way into `packages/db`.** The established idiom for a
wire key the writer resolves in-transaction is `supersetClientId`, and its docblock
(`strength-session.ts:59-63`) says exactly this: _"`supersetClientId` is deliberately the UN-resolved
wire key (unlike `movementId`): the `supersets` row doesn't exist until the tx."_ The counter-example
is `profileId` → `profilePublicId`, which is renamed because it is the **F7 security seam** and the
rename is the reminder. A prescription id is not that seam (the BOLA guard is inside
`programDayRows`), and a rename would add a mapping step — which is precisely where GAP-1 P0-1's
`dayRole` went inert while both gates stayed green (`actions.ts:357-364`). One name, no mapping.

**`ScaffoldRow` gains an IDENTITY, not a magnitude.** Its docblock (`strength-form-scaffold.ts:30-35`)
says a future widening must be deliberate and _"cannot inherit the access by accident"_; the V1-26
widening (`:42-48`) is the precedent and its own test
(`strength-form-scaffold.test.ts:240-244`) asserts the door stayed shut. A prescription public id is
opaque — it names a row, it does not carry a number a kid could log as performed. `load` is still
absent, by construction; the V1-26 test stays green unmodified and the new `@ts-expect-error`
assertion makes the containment a compile-time property.

**Three clears, and one deliberate non-clear:**

- **Rename clears it.** `onName` (`strength-form.tsx:551-557`) already clears `declaredLoaded`,
  `declaredDimension` and `scaffolded`; `prescriptionId` joins the list, with the same reason —
  _"typing over it makes this a different movement the catalog has said nothing about."_ Without
  this, renaming `Push-Ups` to `Bench Press` would freeze the push-up prescription onto a bench
  entry. (The server refuses it anyway — see the slug guard — so this is defence in depth and a
  correctness-of-state fix, not the boundary.)
- **A Measuring change does NOT clear it.** `setDimensionUnit` (`:353-386`) crosses a dimension and
  clears the set modes; the prescription is unchanged by how the athlete chose to measure it.
- **"Not a programmed day" drops every snapshot**, server-side, because `dayRole` is absent — see
  the next section. No client-side clear, so the athlete can flip the select back and forth with no
  state loss.
- **It is not a "touch".** `MovementDraft` (`strength-form-untouched.ts:25-31`) reads only
  `movementName`, `status` and `sets`, so an untouched scaffolded card carrying a `prescriptionId`
  is still dropped by `dropUntouchedMovements`. **No change to that module** — which is the point:
  the V1-19 submit wedge (`strength-form-scaffold.ts:73-79`) is exactly what a new "touched" field
  would re-open, and `scaffold-submit.spec.ts` exists to catch it. Stated here so a reviewer does
  not add it to `SetDraft`/`MovementDraft` "for consistency".

⚠️ **The zod field is load-bearing and silently droppable.** `z.object` is strip-mode, so without
`prescriptionId` on `sessionMovementSchema` the action's `parsed.data.movements` would arrive at the
DAL with the field **removed** and the whole feature would be inert while `typecheck`, `test` and
`db:verify` all stayed green. That is GAP-1 P0-1's exact failure
(`actions.ts:357-364`: _"both gates stayed green while the feature was inert"_), and its remedy is
copied: an `actions.test.ts` case that asserts the **value** the DAL received, because
`objectContaining` is blind to an absent key.

`sessionMovementSchema` must stay a plain `ZodObject` (no `.superRefine`) — the trap its own comment
documents at `strength-session.ts:72-77`. Adding a field is safe; adding a refine is not.

## Where the snapshot is derived: inside `packages/db`, reusing `programDayRows`

```
writeStrengthSession(db, args)                       ← packages/db/src/writers/strength-session.ts
  ├─ prescribedSnapshotsFor(db, {...})               ← NEW, pre-transaction (a READ)
  │    ├─ programDayRows(db, { profilePublicId, dayRole })    ← the SHIPPED query, unchanged shape
  │    └─ matchPrescribedSnapshot(rows, movement)    ← pure, per movement
  │         └─ formatPrescribedForExport(row)         ← the ONE renderer
  └─ db.transaction(tx => … writeSessionStrengthEntry(tx, { …, prescribedSnapshot }))
```

**Reusing `programDayRows` is the whole design, and it is what makes acceptance 11 true by
construction rather than by two queries agreeing.** The export's live fallback already calls
`programDayRows` (`export.ts:102`). If the writer calls it too, both paths consume _the same rows_
through _the same renderer_, so there is no second query to drift.

It also inherits three guards for free, each already proven:

| Guard                                                         | Where it lives                             | Proof that exists today                               |
| ------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------- |
| **BOLA** — household resolved inside the query                | `program-day.ts:40-62` (`isThisProfile`)   | `verify.ts:3678-3700`, probed in **both** directions  |
| **Day-role scope** — rows are for the session's asserted role | `program-day.ts:109`                       | `verify.ts:3670-3677` (an unprogrammed role → 0 rows) |
| **Newest-block-per-day-role**                                 | `program-day.ts:48-62` (`id DESC LIMIT 1`) | the `spec:112-116` trap, already documented           |

A crafted body naming another household's prescription id, a prescription from a different day role,
or one from a superseded block therefore matches nothing and the snapshot stays NULL — which falls
back to the live match. **No new ownership predicate is written, so there is no new ownership
predicate to get wrong.**

### The two rules that keep the writer honest

```ts
// packages/db/src/writers/prescribed-snapshot.ts — pure, unit-tested, no DB access
import { formatPrescribedForExport } from '@mat-plan/shared/csv';
import { movementSlug } from '@mat-plan/shared';
import type { ProgramDayRow } from '../queries/program-day';

export function matchPrescribedSnapshot(
  rows: readonly ProgramDayRow[],
  movement: { prescriptionId?: string; movementName: string },
): string | undefined {
  if (!movement.prescriptionId) return undefined;
  const row = rows.find((r) => r.prescriptionPublicId === movement.prescriptionId);
  if (!row) return undefined;
  // The MOVEMENT must agree. `movements.slug` is the natural key `findOrCreateMovementId` resolves
  // by (`catalog.ts:76-89`), so comparing slugs compares the same row the entry's movement_id names.
  // Without this, a crafted body could freeze one movement's prescription onto another's entry — and
  // the legacy fallback keys on `(day_role, movement slug)`, so the two paths would disagree.
  if (movementSlug(movement.movementName) !== row.movementSlug) return undefined;
  return formatPrescribedForExport(row);
}
```

1. **No asserted `dayRole` → no snapshot at all**, and no query. `prescribedSnapshotsFor` returns an
   empty map when `args.dayRole` is undefined. This is not an optimisation: the legacy fallback keys
   on `sessions.day_role` (`export.ts:134`), so a session logged as "Not a programmed day" emits
   `''` for every row. Snapshotting it would make the two paths disagree on a shape the form can
   produce in one tap.
2. **No matching row, or a movement-slug mismatch → no snapshot.** Degrades to today's behaviour,
   never to a wrong frozen string.

**Why the read sits OUTSIDE the transaction.** It is the same seam the DAL already uses for catalog
ids — _"resolving them OUTSIDE the tx is safe"_ (`entries.ts:447-453`). Acceptance 9 asks for
"server-receipt time against the program as it then stands", which a point-in-time read satisfies;
putting it inside the tx would not make it more atomic (it would still be one snapshot of one
moment), and it would force `programDayRows`' first parameter to widen from
`NodePgDatabase<typeof schema>` to the `Executor` union — a change that risks degrading
`ProgramDayRow = Awaited<ReturnType<typeof programDayRows>>[number]`
(`program-day.ts:121`) into a union type, in a package `pnpm typecheck` does not cover.

**The snapshot is write-once at creation.** `writeSessionStrengthEntry`'s insert is
`onConflictDoNothing` on `client_id` (`strength-session.ts:192-196`), so a replay does **not** update
the snapshot — the same rule `feel` and `day_role` already carry
(`strength-session.ts:105-108`: _"Write-once at creation… a corrected role resubmitted under the same
client_id is silently ignored"_). A retry of a submit made before an edit keeps the original string,
which is the behaviour the column exists for.

**The column is written with the spread idiom**, not `prescribedSnapshot: x ?? null`:

```ts
...(args.prescribedSnapshot !== undefined ? { prescribedSnapshot: args.prescribedSnapshot } : {}),
```

the established pattern at `strength-session.ts:184-188` — when the caller says nothing the column is
**omitted from the INSERT** and Postgres applies its own default, so every pre-existing caller
(including `verify.ts`'s bare fixtures and `apps/web/scripts/screenshot-ephemeral.ts`) writes a
byte-identical row. And it keeps the writer on an **explicit field list**, never a `NewEntry` — the
obligation chunk 1 left it (`v1-22-1:242`).

## The export fallback

```ts
// The two decisions, pure and unit-testable. `apps/web/lib/programming/prescribed-snapshot.ts`
// (that directory is owned by docs/features/programming.md, so the new file ships with guide
// coverage instead of silently unowned — the gap chunk 1 flagged at v1-22-1:292-298).

export type PrescribedRow = {
  prescribedSnapshot: string | null;
  dayRole: string | null;
  movementSlug: string;
};

export const prescribedKey = (dayRole: string | null, movementSlug: string) =>
  `${dayRole}:${movementSlug}`;

/** The day roles whose LIVE program still has to be read — only the NULL-snapshot rows need it. */
export function rolesNeedingLiveMatch(rows: readonly PrescribedRow[]): Set<string> {
  const roles = new Set<string>();
  for (const r of rows) {
    // `=== null`, never `!r.prescribedSnapshot`: a stored '' is a FROZEN rendering, not a miss.
    if (r.prescribedSnapshot !== null && r.dayRole !== null) continue;
    if (r.dayRole !== null) roles.add(r.dayRole);
  }
  return roles;
}

/** The `prescribed` cell. `??`, NEVER `||`. */
export function resolvePrescribed(
  row: PrescribedRow,
  live: ReadonlyMap<string, string | null>,
): string {
  return row.prescribedSnapshot ?? live.get(prescribedKey(row.dayRole, row.movementSlug)) ?? '';
}
```

**`??`, never `||`, and this is the single most dangerous line in the chunk.**
`StrengthLogRow.prescribed` is a non-nullable `string`
(`packages/shared/src/csv/strength-log.ts:24`), so `||` typechecks, lints clean, and collapses a
stored `''` back into the live match — silently re-enabling the rewrite acceptance 8 forbids. It is
the TypeScript mirror of chunk 1's `IS NULL`, never `coalesce(…,'') = ''`
(`v1-22-1:144-147`). `''` is the **dominant** matched rendering: 11 of 13 live prescriptions are
`open()` (`programming.ts:206-222`), all of which render empty.

**The live program is consulted only for NULL rows.** `rolesNeedingLiveMatch` is what makes
§Integration's `''`-vs-NULL proof possible at all (`spec:185`: _"a `''` row exports empty **without**
consulting the live program; a NULL row does consult it"_) — with the role set built from every row,
that criterion is unobservable. Side benefit: a fully-backfilled month (after chunk 3) issues zero
programming queries, so the export stops depending on today's program entirely.

`prescribedFor` keeps its name and its ambiguity rule (`byKey.set(key, seen > 1 ? null : text)`,
`export.ts:112`) and now calls `formatPrescribedForExport(p)` in place of the inline composer. Its
`DAY_ROLES` membership guard (`export.ts:101`) stays.

**The fold carries the snapshot without putting it on `StrengthLogRow`:**

```ts
type FoldedStrengthRow = {
  readonly prescribedSnapshot: string | null;
  readonly row: StrengthLogRow;
};
```

`foldStrengthRows` (`export.ts:30-79`) returns `FoldedStrengthRow[]`; the snapshot is set once in the
`if (!byEntry.has(r.entryId))` branch (it is an **entry** column, constant across the set/quantity
fan-out). `StrengthLogRow` stays the CSV row shape, with `prescribed` as its only prescription field.

## What chunk 2 owes toward acceptance 11

§Integration assigns acceptance 11 to **chunk 3** (`spec:183`) — a golden-byte test over a real month,
run with the snapshot populated and with it NULL. Chunk 2 cannot run that test: there is nothing to
populate a historical month with until the backfill exists. What chunk 2 owes is **everything that
makes the test capable of passing**, stated so it cannot fall between the chunks:

1. **One renderer, imported not copied** — plus the grep in Acceptance that proves the inline
   composer is _gone_. A copied renderer is the single failure mode acceptance 11 exists to catch.
2. **Both paths consume `programDayRows`.** Stated as a by-construction argument above, and pinned by
   a unit test that feeds _one_ `ProgramDayRow` fixture through both the writer's
   `matchPrescribedSnapshot` and the export's `prescribedFor` composer and asserts **identical
   bytes**. That is acceptance 11 at row grain; chunk 3's is the same claim at month grain over real
   data.
3. **The divergence list**, so chunk 3's fixture author knows which months are legitimate and does
   not chase a "failure" that is the feature working:

   | Case                                     | Snapshot path       | Legacy path           | Agree?                                |
   | ---------------------------------------- | ------------------- | --------------------- | ------------------------------------- |
   | unedited, unambiguous, day role asserted | the rendered string | the same string       | ✅ by construction                    |
   | session with **no** asserted day role    | NULL → fallback     | `''`                  | ✅                                    |
   | day role switched after scaffolding      | NULL → fallback     | the new role's string | ✅ (both take the fallback)           |
   | movement renamed after scaffolding       | NULL → fallback     | no match → `''`       | ✅                                    |
   | prescription **edited** after logging    | the frozen string   | the new string        | ❌ **intended** — this is the feature |
   | `(day_role, movement)` **ambiguous**     | the exact string    | `''`                  | ❌ unreachable today — see 4          |

4. **The ambiguity stays unreachable, as a gate not a claim.** `PROGRAM_SEED` has no duplicate
   `(dayRole, movementSlug)`; chunk 2 adds that as an assertion in
   `apps/web/lib/programming/contract.test.ts` (which already parses `PROGRAM_SEED` against its
   schemas). The day chunk 6 makes a duplicate reachable, that test fails and the chunk-6 author is
   forced to the identity column the spec's chunk-6 row already owes (`spec:149`, ADR 0005 `:306`).
   This is the cheapest possible way to keep P1-2 from closing as "never".
5. **`csv-recording-gaps.md` P1-2 gains one clause**: the prescription identity now exists **on the
   wire at log time** and is discarded after rendering, so chunk 6's FK is one column plus one
   `INSERT` field, not new plumbing. P1-2's "Fix (chosen)" paragraph currently implies the identity
   was never in hand.

## File-by-file changes

| Path                                                               | NEW/EDIT | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/shared/src/csv/prescribed.ts`                            | **NEW**  | `PrescribedParts` (derived from the two seed row schemas) + `formatPrescribedForExport`, the verbatim hoist of `export.ts:108-111`. Docblock: the two composers, why this one, the preserved truthiness, the three callers.                                                                                                                                                                                                                                  |
| `packages/shared/src/csv/index.ts`                                 | EDIT     | `export * from './prescribed';` — the subpath, deliberately not the root barrel (`:1-9`).                                                                                                                                                                                                                                                                                                                                                                    |
| `packages/shared/src/csv/prescribed.test.ts`                       | **NEW**  | The renderer's cases (below). Runs: `apps/web/vitest.config.ts:24` includes `packages/*/src/**/*.test.ts`.                                                                                                                                                                                                                                                                                                                                                   |
| `packages/shared/src/strength-session.ts`                          | EDIT     | `sessionMovementSchema` gains `prescriptionId: uuidSchema.optional()` (`:62` reuses the same `uuidSchema`). Docblock: an identity, never a magnitude; strip-mode means omitting it makes the whole feature inert.                                                                                                                                                                                                                                            |
| `packages/db/src/queries/program-day.ts`                           | EDIT     | One more selected column, `prescriptionPublicId: schema.prescriptions.publicId` (beside `movementSlug` at `:79`). No new join. Docblock: this is the key the log-time snapshot is resolved by, and the warning at `:84-87` ("the movement's TRUTH, never the coach's") grows one line for why a public id is not a magnitude.                                                                                                                                |
| `packages/db/src/writers/prescribed-snapshot.ts`                   | **NEW**  | `matchPrescribedSnapshot` (pure) + `prescribedSnapshotsFor(exec, …)` (one `programDayRows` call, returns `Map<movement clientId, string>`). Short-circuits to an empty map when `dayRole` is absent or no movement carries a `prescriptionId`.                                                                                                                                                                                                               |
| `packages/db/src/writers/prescribed-snapshot.test.ts`              | **NEW**  | The pure match's cases + the byte-identity row test (both paths, one fixture).                                                                                                                                                                                                                                                                                                                                                                               |
| `packages/db/src/writers/strength-session.ts`                      | EDIT     | `ResolvedSessionMovement` gains `prescriptionId?: string` (the un-resolved wire key, `:59-63`'s idiom). `writeStrengthSession` awaits `prescribedSnapshotsFor` **before** `db.transaction`. `writeSessionStrengthEntry` gains `prescribedSnapshot?: string` and writes it with the `:184-188` spread.                                                                                                                                                        |
| `packages/db/src/queries/export-month.ts`                          | EDIT     | `strengthMonthRows` selects `prescribedSnapshot: schema.entries.prescribedSnapshot` (`:44-62`). **The one query.**                                                                                                                                                                                                                                                                                                                                           |
| `apps/web/lib/programming/program-day.ts`                          | EDIT     | `ProgramDayDTO` gains `prescriptionId: string`; `toProgramDay` maps it (`:43-53`). Docblock: opaque identity, the one field on this DTO that is not the coach's authored text.                                                                                                                                                                                                                                                                               |
| `apps/web/lib/programming/prescribed-snapshot.ts`                  | **NEW**  | `prescribedKey` · `rolesNeedingLiveMatch` · `resolvePrescribed`. Pure, non-`server-only`, so the `??`-not-`\|\|` rule has a test that can fail. The `program-day.ts:3-9` precedent for splitting real logic out of the `server-only` DAL.                                                                                                                                                                                                                    |
| `apps/web/lib/programming/prescribed-snapshot.test.ts`             | **NEW**  | The fallback cases, including `''` + a non-empty live match → `''`.                                                                                                                                                                                                                                                                                                                                                                                          |
| `apps/web/lib/programming/prescribed-snapshot-containment.test.ts` | **NEW**  | The source-scanning guard (one query, one writer, nothing under `app/`), with its own "the scan works" case.                                                                                                                                                                                                                                                                                                                                                 |
| `apps/web/lib/dal/export.ts`                                       | EDIT     | `prescribedFor` calls the shared renderer; the inline composer deleted. `foldStrengthRows` → `FoldedStrengthRow[]` carrying the snapshot. `buildExportEntries` builds the role set from `rolesNeedingLiveMatch` and assigns via `resolvePrescribed`. The `:94-96` "V1-22 breaks it" warning is REPLACED by what now holds.                                                                                                                                   |
| `apps/web/lib/dal/entries.ts`                                      | EDIT     | None functionally — `LogStrengthSessionArgs.movements` is `SessionMovementInput[]`, so `prescriptionId` flows through the existing `{...m, movementId}` spread (`:461-467`). One comment: the field is forwarded deliberately, not incidentally.                                                                                                                                                                                                             |
| `apps/web/app/p/[profileId]/strength-form-scaffold.ts`             | EDIT     | `ScaffoldRow` gains `prescriptionId: string` (the third deliberate widening, with the reason); `scaffoldMovements` maps it onto the card (`:69-113`).                                                                                                                                                                                                                                                                                                        |
| `apps/web/app/p/[profileId]/strength-form.tsx`                     | EDIT     | `MovementVals` gains `prescriptionId?: string` — **serialized**, unlike `scaffolded`/`declaredLoaded`/`declaredDimension`; the `movementsJson` spread emits it when present (`:444-478`); `onName` clears it (`:551-557`).                                                                                                                                                                                                                                   |
| `apps/web/app/p/[profileId]/strength-form-scaffold.test.ts`        | EDIT     | The id rides the card; the V1-26 no-`load` guard (`:240-244`) still holds; the `@ts-expect-error` containment assertion.                                                                                                                                                                                                                                                                                                                                     |
| `apps/web/app/p/[profileId]/strength-form.test.tsx`                | EDIT     | The payload carries `prescriptionId` on a scaffolded card, omits it on a hand-added one, and **loses** it on rename. Plus the v1-30b-i regression set, unmodified.                                                                                                                                                                                                                                                                                           |
| `apps/web/app/p/[profileId]/actions.test.ts`                       | EDIT     | The DAL receives `movements[0].prescriptionId === <the uuid>` — asserted on the **value** (`:636-652`'s idiom), because `objectContaining` is blind to an absent key.                                                                                                                                                                                                                                                                                        |
| `apps/web/app/p/[profileId]/strength-session-schema.test.ts`       | EDIT     | `prescriptionId` round-trips; a non-uuid is rejected; absent is accepted.                                                                                                                                                                                                                                                                                                                                                                                    |
| `apps/web/lib/programming/contract.test.ts`                        | EDIT     | `PROGRAM_SEED` has no duplicate `(dayRole, movementSlug)` — the gate that keeps the ambiguity unreachable and forces chunk 6's identity column.                                                                                                                                                                                                                                                                                                              |
| `apps/web/lib/programming/program-day.test.ts`                     | EDIT     | `toProgramDay` carries `prescriptionId`; `formatPrescription` and `formatPrescribedForExport` **disagree** on the same input.                                                                                                                                                                                                                                                                                                                                |
| `packages/db/scripts/verify.ts`                                    | EDIT     | A `// ── V1-22 chunk 2: the log-time snapshot ──` section — the five cases below. Ids from a **local counter** (the `:4065-4070` idiom).                                                                                                                                                                                                                                                                                                                     |
| `apps/web/e2e/prescribed-snapshot.spec.ts`                         | **NEW**  | Athlete Two's today: scaffold → do the hip thrusts → submit → export → unzip → assert the `prescribed` cell.                                                                                                                                                                                                                                                                                                                                                 |
| `apps/web/e2e/steps.ts`                                            | EDIT     | `SEED_PROFILE_2_ROUTE`'s docblock (`:26-32`) records that their **strength** form now belongs to this spec — the day-ownership convention that file already keeps.                                                                                                                                                                                                                                                                                           |
| `apps/web/e2e/export-full-day.spec.ts`                             | EDIT     | One comment only: its determinism loop's claim _"no other spec submits the strength form"_ (`:239-246`) becomes "…for **this athlete**". No assertion changes — its typed movement has no prescription, so `rPrescribed` stays `''` (`:225-226`).                                                                                                                                                                                                            |
| `docs/features/write-path.md`                                      | EDIT     | The two permanent `prescribed` paths and the `snapshot ?? live` rule (owns `apps/web/lib/dal/`, `packages/db/src/writers/`).                                                                                                                                                                                                                                                                                                                                 |
| `docs/features/strength-logging.md`                                | EDIT     | What the form now carries and what it must never carry (owns `strength-form.tsx`, `strength-form-scaffold.ts`, `packages/shared/src/strength-session.ts`, the writer).                                                                                                                                                                                                                                                                                       |
| `docs/features/programming.md`                                     | EDIT     | `programDayRows` has a second consumer — the log-time writer — so the `id DESC LIMIT 1` trap now has a write-path consequence (owns `queries/program-day.ts`, `apps/web/lib/programming/`).                                                                                                                                                                                                                                                                  |
| `docs/architecture.md`                                             | EDIT     | **NEW §2f** — the `prescribed` column's two permanent paths (the view chunk 1 deferred here, `v1-22-1:282-283`). Deliberately **§2f, leaving §2e free** for chunk 4's write-path view (`spec:165`), so two parallel lanes cannot collide on one heading. Plus one edge on §2d's diagram, whose `FORM "UNCHANGED — empty + required"` node and `"coach reads it, TYPES what was performed"` edge are now incomplete: an identity (never a magnitude) crosses. |
| `docs/spec.md`                                                     | EDIT     | The `entry` bullet: the column is now written and read, by whom.                                                                                                                                                                                                                                                                                                                                                                                             |
| `docs/csv-recording-gaps.md`                                       | EDIT     | P1-2: the identity exists on the wire and is discarded; chunk 6's FK is one column.                                                                                                                                                                                                                                                                                                                                                                          |
| `docs/specs/…authoring-program-editing.md`                         | EDIT     | Mark chunk 2 done; correct acceptance 9's "set" → "entry"; name chunk 2's `db:verify` proof in the §`db:verify` paragraph (`spec:158-164` names 1, 5 and 6 only); record the divergence list as what chunk 3's golden test may expect.                                                                                                                                                                                                                       |
| `docs/plan.md`, `docs/status.md`, `docs/roadmap.md`                | EDIT     | V1-22 row links this plan; pointer; pillar row. ⚠️ **A parallel lane owns these three files** — the implementing PR adds its rows last and expects a conflict.                                                                                                                                                                                                                                                                                               |
| `docs/changelog/2026-10-XX-feat-v1-22-2-renderer-and-writer.md`    | **NEW**  | DX-2 fragment.                                                                                                                                                                                                                                                                                                                                                                                                                                               |

## Test plan

Five layers, each proving something the others cannot. The layering is the point: **no single layer
can distinguish "the snapshot was written" from "the live fallback produced the same bytes"** —
which is acceptance 11 working _against_ the tests, and is why the writer needs a DB-level proof.

### 1. The renderer — `packages/shared/src/csv/prescribed.test.ts`

Golden cases, every string drawn from real data, never invented (the spec panel corrected an invented
`8/side` once — `spec:286`):

| `sets` | `targetReps`  | `reps` (per-kid) | `load` | → expected             | why this case                                                                                                                                                                                       |
| ------ | ------------- | ---------------- | ------ | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `3`    | `10 per side` | `null`           | `null` | `3x10 per side`        | the one `fixed()` YDP prescription (`programming.ts:160`)                                                                                                                                           |
| `null` | `null`        | `null`           | `null` | `''`                   | `open()` — **11 of 13 live rows**; the `''` that must be storable                                                                                                                                   |
| `3`    | `5`           | `4, last AMRAP`  | `65`   | `3x4, last AMRAP @ 65` | the per-kid override WINS; and a comma (`verify.ts:3533`)                                                                                                                                           |
| `4`    | `3`           | `null`           | `145`  | `4x3 @ 145`            | the string chunk 1's `db:verify` already pins (`:4051`)                                                                                                                                             |
| `null` | `AMRAP`       | `null`           | `BW`   | `AMRAP @ BW`           | reps with no set count, a non-numeric load                                                                                                                                                          |
| `0`    | `5`           | `null`           | `null` | `5`                    | **pins the preserved truthiness.** `!= null` would emit `0x5`. Unreachable via `prescriptions_sets_check`, so the only thing that can change it is a "cleanup" — this is the test that refuses one. |
| `4`    | `null`        | `''`             | `null` | `4x`                   | `''` is not `null`: the `??` collapse respects an authored empty, exactly as `toProgramDay`'s does (`program-day.ts:41`)                                                                            |

Plus: **the two renderers disagree.** `formatPrescription({sets: 4, targetReps: '3'})` is
`4 sets × 3`; `formatPrescribedForExport({sets: 4, targetReps: '3', reps: null, load: null})` is
`4x3`. One assertion, and it is what fails if someone "DRY"s them together.

### 2. The fallback — `apps/web/lib/programming/prescribed-snapshot.test.ts`

| snapshot          | live match          | → `prescribed`  | kills                                           |
| ----------------- | ------------------- | --------------- | ----------------------------------------------- |
| `'3x10 per side'` | `'9x9'`             | `3x10 per side` | reading the live program when a snapshot exists |
| `''`              | `'3x10 per side'`   | `''`            | **`\|\|` instead of `??`** — the whole point    |
| `null`            | `'3x10 per side'`   | `3x10 per side` | dropping the fallback                           |
| `null`            | `null` (ambiguous)  | `''`            | an arbitrary pick on an ambiguous key           |
| `null`            | absent from the map | `''`            | `undefined` leaking into a non-nullable string  |

`rolesNeedingLiveMatch`: a `''`-snapshot row contributes **no** role; a NULL-snapshot row does; a
NULL-`dayRole` row contributes none (`export.ts:129-131`'s existing filter). The `''` case is the one
that fails under `!r.prescribedSnapshot`.

### 3. The match — `packages/db/src/writers/prescribed-snapshot.test.ts`

Over a hand-built `ProgramDayRow[]`: no `prescriptionId` → `undefined`; unknown id → `undefined`;
**slug mismatch** → `undefined` (the crafted-body case); match → the rendered string. Plus **the
byte-identity row test**: one fixture row, fed through `matchPrescribedSnapshot` and through the
export's live-map composer, `toBe`-equal. That is acceptance 11 at row grain.

### 4. `db:verify` — the writer, against the real seeded program

Chunk 2's owed `db:verify` section (`spec:158-164` names only 1, 5 and 6 — chunk 2's is added to the
spec in this PR). It drives the **shipped** `writeStrengthSession`, so the app DAL and this proof run
the identical path (`strength-session.ts:20-28`), and the fixtures already exist:

1. **The happy path, on real data.** `profilePublicId: SEED_PROFILE_PUBLIC_ID`,
   `dayRole: 'strength_a'`, one movement named `Single-Leg Hip Thrusts` carrying that prescription's
   `public_id` → `entries.prescribed_snapshot = '3x10 per side'`. Read back by `strengthMonthRows`,
   so the one query is proven too.
2. **The per-kid override and a comma.** The `verify_test_block` fixture (`verify.ts:3519-3534`:
   `sets: 3`, `targetReps: '5'`, target `load: '65'`, `reps: '4, last AMRAP'`) →
   `'3x4, last AMRAP @ 65'`. Proves the precedence and that a comma stores verbatim (chunk 1 already
   proved the column tolerates one, `:4128-4130`).
3. **BOLA.** The _other_ household's profile submits a YDP prescription id → snapshot **NULL**. The
   reverse direction too; `verify.ts:3678-3700` proves the query refuses both ways, this proves the
   writer inherits it.
4. **Wrong day role.** A `strength_a` prescription id on a `dayRole: 'strength_b'` session → NULL.
   (Both roles carry the hip thrusts at different `idx`, so this is the realistic stale-scaffold
   case, not a contrived one.)
5. **Movement mismatch.** The right id, a different `movementName` → NULL. Kills the "freeze any
   prescription onto any entry" hole.
6. **No day role.** `dayRole` omitted → NULL on every movement, and the sequence proves no
   `programDayRows` query is needed to reach that answer.

Fixture rules, each from an existing trap (`v1-22-1:206-224`): ids from a **local counter**
(`verify.ts:4065-4070`) — this file hand-assigns ids in 23 places and a `uq_entries_client_id`
collision makes an assertion report the wrong thing while staying green; and **real strings only**.

⚠️ `verify.ts` runs under `tsx` and is **outside** `pnpm typecheck`'s reach (`--filter web`, and
there is no `packages/db/tsconfig.json`) — so these edits are validated only by _running_
`pnpm db:verify`. The new `writers/prescribed-snapshot.ts` **is** typechecked, because it rides the
import graph `apps/web` already pulls through `packages/db/src/index.ts:14`.

### 5. The e2e — `apps/web/e2e/prescribed-snapshot.spec.ts`

The only test where the input is produced by the application rather than by the test — the reason
`export-full-day.spec.ts:30-38` exists. Athlete Two's **today**:

1. `goto(SEED_PROFILE_2_ROUTE)`; tap **Fill in today's movements**.
2. Expand the card named **Single-Leg Hip Thrusts** (located by name, never by index) and fill its
   three set rows.
3. Submit; wait for the folded `logMore` toggle (`export-full-day.spec.ts:163-171`'s signal).
4. Download + `unzip` via `downloadExport`'s approach (`:90-110`) — the **system** `unzip`, an
   independent implementation, so no new dependency.
5. Find the `single-leg-hip-thrusts` row in `strengthLogPath(SEED_PROFILE_2_PUBLIC_ID, month)` and
   assert the 7th cell is **`3x10 per side`**.

**Why this is deterministic.** `resolveDayRole` is total — every calendar day is A or B
(`day-role-schedule.ts:41-43`) — and `single-leg_hip_thrusts` is prescribed on **both**
(`programming.ts:212`, `:222`), so only the card's position changes, never its presence. This is the
one assertion that escapes `export-full-day.spec.ts:103-107`'s reason for avoiding the scaffold
("a scaffold-driven assertion would depend on which day CI happened to run"), and the spec says so.
`3x10 per side` carries no comma, so the row splits on `,` cleanly.

**Why a separate spec and a separate athlete.** `export-full-day` owns Athlete One's yesterday,
`scaffold-submit` his today, and `resolveDeclaredDay` clamps writes to ±1 day. More importantly
`export-full-day`'s determinism loop compares the **whole** strength-log file across two downloads
(`:239-250`), and the CSV is per _month_ — a second spec writing any day of the same month for the
same athlete would race it under `fullyParallel`. Athlete Two's export lives under their own `public_id`
directory, so there is no shared file at all.

⚠️ **What this e2e cannot prove.** By acceptance 11, the snapshot and the live fallback emit the same
bytes for an unedited prescription — so this test is green whether the snapshot was written or the
fallback produced it. It proves the chain does not break and the bytes are right; layers 3 and 4
prove the column was actually written, and chunk 4's edit-then-re-export is the first test where the
two paths can disagree.

### What must not regress (v1-30b-i, merged `05e0ccd`)

Run the whole suite, and specifically keep green, unmodified:

- `strength-form.test.tsx` (+140 lines in #234) — the BW/band chips are **unmounted** on a non-mass
  card; a Measuring change clears every set's modes in one update; the per-dimension field word.
- `strength-form-scaffold.test.ts` (+30) — `declaredDimension` seeding, and the V1-26 no-`load` guard
  at `:240-244`.
- `scaffold-submit.spec.ts` — the collapsed-card submit wedge. The one failure mode a new
  `MovementVals` field could re-open is becoming a "touch"; it is not (see above), and this is the
  spec that proves it.
- `apps/web/lib/constants.test.ts` (+46) — `QUANTITY_FIELD_WORD`, `QUANTITY_DECIMALS`.

The conflict surface with `30b-ii` is the `movementsJson` object literal (`strength-form.tsx:444-478`)
and the `MovementVals` declaration (`:77-102`) — both append-style, so a merge is mechanical, but
**merge `main` into this branch, never the reverse**, and re-run `pnpm e2e:local` after
(`spec:195-198`: after any fan-in, the first PR runs the smoke, not just `verify`).

## Risks / rollback

| Risk                                                                                                                                                                     | Mitigation                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`\|\|` instead of `??`.** Typechecks, lints clean, and silently re-enables the rewrite the milestone exists to prevent — on the dominant shape (11 of 13 render `''`). | The `''` + non-empty-live unit case, which fails under `\|\|`. Plus the rule restated in `write-path.md` and in the `schema.ts:189-197` docblock it already carries.                                                                                                                                                                                        |
| **`prescriptionId` omitted from the zod schema** → stripped → the feature is inert and every gate stays green (GAP-1 P0-1, verbatim).                                    | The `actions.test.ts` **value** assertion, plus the e2e, plus the schema round-trip test.                                                                                                                                                                                                                                                                   |
| **A stale scaffold freezes the wrong prescription** — the athlete scaffolds Day A, switches the day-role select to B, submits.                                           | The day-role scope is inherited from `programDayRows`, so the id matches nothing → NULL → fallback. `db:verify` case 4.                                                                                                                                                                                                                                     |
| **A renamed card freezes the old movement's prescription.**                                                                                                              | `onName` clears it client-side; the slug guard refuses it server-side. `db:verify` case 5 and a form test.                                                                                                                                                                                                                                                  |
| **A crafted body pairs any prescription id with any movement, in any household.**                                                                                        | Three inherited guards (household, day role, movement slug), none newly written. `db:verify` cases 3–5.                                                                                                                                                                                                                                                     |
| **The export silently stops falling back** (e.g. the role set is built from all rows and a query throws on an unprogrammed role).                                        | `prescribedFor` keeps its `DAY_ROLES` membership guard (`export.ts:101`) and its ambiguity rule; `rolesNeedingLiveMatch` is unit-tested in both directions.                                                                                                                                                                                                 |
| **A Vercel instant rollback** to a pre-chunk-2 build reverts the exporter to live reconstruction while snapshots exist.                                                  | Fix-forward only — the spec's own risk row (`spec:225`). Harmless at this point: before chunk 3 the only snapshots are rows logged after this merge, whose live match still agrees (the identity table above). A rollback **after** chunk 4's first edit would be a real byte regression, which is why chunk 3's RESTORE branch is cut before the backfill. |
| **`ProgramDayDTO` widens and leaks a magnitude.** The DTO already carries `load` and is one Pick away from the form.                                                     | `ScaffoldRow` still omits `load`, now by compile-time assertion as well as by construction; the containment scan proves nothing under `app/` names the snapshot column.                                                                                                                                                                                     |
| **`EntryRow`/`NewEntry` widened by chunk 1** and the writer takes a `NewEntry`.                                                                                          | It does not — explicit field list, with the spread idiom. Chunk 1's obligation (`v1-22-1:242`), discharged here.                                                                                                                                                                                                                                            |
| `foldStrengthRows`' return type changes, and its own header is **already stale** ("one row per movement" — it folds by **entry id**, `export.ts:29-36`).                 | The header is corrected in the same edit. Not left to rot a third time (`v1-22-1:69-74`).                                                                                                                                                                                                                                                                   |
| **`strengthMonthRows` grows a column** and `db:verify`'s existing export assertions (`verify.ts:2113-2210`) read positionally.                                           | They destructure by name, not position. Checked; and `db:verify` runs in `pnpm verify`.                                                                                                                                                                                                                                                                     |

**Rollback:** fix-forward. No migration, no backfill, nothing destructive — the worst case is that
new entries carry a snapshot nothing reads, which is where `main` already sits. A revert of this PR
leaves those strings in place; chunk 3's backfill is idempotent over them.

## Alternatives considered and rejected

- **Hoist `formatPrescription` (the UI renderer) instead.** Forks the `prescribed` column into two
  formats mid-corpus and chunk 3 freezes the fork. Settled at `spec:267`; the "sets" noun is a phone
  decision (`program-day.ts:57-62`).
- **Keep two renderers and test them equal.** The equality test is exactly what a shared misreading
  passes. And it would have to be re-derived in `packages/db` for chunk 3, which cannot import the
  app.
- **Put the renderer in `packages/shared/src/programming.ts`** (the root barrel). Puts CSV formatting
  into 8 client bundles, against `csv/index.ts:1-9`'s stated intent. The type-only import of
  `PrescriptionSeedRow` gets the DRY benefit with none of the runtime cost.
- **Resolve the snapshot in the app DAL (`logStrengthSession`) and pass the string to the writer.**
  Fits the "caller owns resolution" seam, but `db:verify` drives the writer directly
  (`verify.ts:1644`), so the resolution — including its three ownership guards — would be proven by
  nothing. Putting it in `packages/db` is the `writeStrengthSession` doctrine applied one level up
  (`strength-session.ts:20-28`).
- **Resolve it INSIDE the transaction.** Requires widening `programDayRows`' first parameter to the
  `Executor` union, which risks degrading `ProgramDayRow` (`program-day.ts:121`) into a union type in
  a package `pnpm typecheck` does not cover (`strength-session.ts:243-247`). Buys nothing: a
  point-in-time read is what acceptance 9 asks for either way.
- **A purpose-built resolution query instead of reusing `programDayRows`.** Two queries that must
  agree forever, re-deriving the household hop, the day-role scope and the `id DESC LIMIT 1` block
  choice — three chances to introduce a BOLA hole, and it makes acceptance 11 a property two queries
  happen to share rather than a construction.
- **Match on `movement_id` instead of the slug** (adding `movements.id` to the query). The slug is
  the natural key `findOrCreateMovementId` resolves by (`catalog.ts:76-89`), already selected
  (`program-day.ts:79`), and avoids putting an internal id on a row type that feeds a client DTO.
- **Persist `entries.prescription_id` (an FK) now.** ADR 0005's real open item, deferred for two
  reasons already recorded: the ambiguity it resolves is unreachable until chunk 6, and the FK needs
  `entries`' 11th index (`v1-22-1:251-260`). Chunk 2 has the identity in hand and discards it — and
  that fact is now written into P1-2 rather than left in a plan nobody reads forward from.
- **A `superRefine` requiring `dayRole` when any `prescriptionId` is present.** The server already
  ignores the ids silently in that case, which is the conservative behaviour and matches "a session
  on a non-programmed day is normal" (`strength-session.ts:111-114`). A refine would reject a body
  the form cannot produce, and would turn a benign case into a user-facing error.
- **A distinctness refine on `prescriptionId` across movements.** Unreachable from the form (every
  card's id comes from a distinct `ScaffoldRow`; "Add movement" mints a blank card). A crafted
  duplicate freezes the same string twice, which the legacy path would also emit. Not worth a rule.
- **Put `prescribedSnapshot` on `StrengthLogRow`.** It is the CSV row shape; `prescribed` is its one
  prescription field. The local `FoldedStrengthRow` keeps the column off a type the formatters share.
- **Mutate `foldStrengthRows` to resolve the fallback itself.** It would need the live map, which
  needs a query, which puts the `??` rule back inside the `server-only` module with no failing-capable
  test. The pure seam is the `program-day.ts:3-9` precedent.
- **One PR per piece** (renderer / writer / fallback). Each intermediate state is worse than both
  ends, and they share no deploy-order constraint: the column is already live.

## Out-of-scope / deferred

- **Spec acceptance 11 at month grain** → **chunk 3** (`spec:183`). What chunk 2 owes toward it is
  enumerated above and is not left implicit.
- **Spec acceptance 8** (an edit changes no exported byte) → **chunk 4** (`spec:184`): it needs an
  editor to do the editing. Its fixture must use a **non-empty** pre-edit string, and after this
  chunk there is exactly one in the live program: `single-leg_hip_thrusts` → `3x10 per side`.
- **The backfill**, and the `''`-for-ambiguous-or-unmatched rule → **chunk 3**, as a listed
  `db:correct` correction (`spec:147`). It must be scoped `WHERE movement_id IS NOT NULL` or it trips
  chunk 1's CHECK on the neither-arm rows (`v1-22-1:284-288`). Its third caller of
  `formatPrescribedForExport` is why the renderer is in `packages/shared` and not in the DAL.
- **`/api/sync`.** Acceptance 9's second sentence names a route that **does not exist** — the only
  `route.ts` under `apps/web/app` is `p/[profileId]/export/route.ts`; the outbox is
  `docs/architecture.md:160-174`, a planned shape. So "server-receipt time" is satisfied vacuously
  today, and the obligation is recorded: whoever builds `/api/sync` must call the same
  `prescribedSnapshotsFor` at receipt, not trust a client-stamped string. Noted in `write-path.md`
  so it is read at the right moment.
- **Any visible UI change.** The form renders byte-identically: `prescriptionId` lives in client
  state and in the hidden `movements` JSON (`strength-form.tsx:487`). No new control, no new copy.
- **`prescriptions.deleted_at` / retired-movement edge cases on the EDIT path** → chunk 4.
- **`packages/db/src/queries/export-month.ts` is owned by no feature guide** — the gap `spec:168-171`
  already files. Not closed here (it would mean inventing a guide mid-chunk); the three guides this
  PR does touch cover every other file it edits, so `guides:check` gates it.
- **A `prescribed_snapshot` column on `entry_sets`.** No authored target exists at set grain
  (`v1-22-1:60-67`); set-shaped prescriptions are out of the whole spec (`spec:187`).

## Open questions

**None blocking.** Two for the panel to rule on, both scoped:

1. **Does this PR owe a UX panel and screenshots?** AGENTS.md:368-385 says every PR touching the UI
   gets one — _"scale the depth, never the existence"_ — and this PR edits `strength-form.tsx`. But
   the rendered output is byte-identical; the only change is invisible client state. My reading:
   **a single-reviewer UX pass, no new screenshots**, re-running the existing
   `screenshot-ephemeral.ts` form states to prove **no** visual diff. The one question worth a
   reviewer's time is whether any athlete-visible consequence follows from the silent clears — a
   rename or a day-role switch quietly drops the snapshot, with no feedback. My answer is that the
   snapshot is invisible by design and its absence degrades to today's behaviour, so silence is
   correct; a reviewer should confirm there is no case where the athlete is _misled_ rather than
   merely uninformed.
2. **`docs/architecture.md` §2f, or extend §2d?** I chose a new **§2f**, leaving §2e free for
   chunk 4 (`spec:165`) so two parallel lanes cannot write the same heading. If the lanes are
   serialised, folding it into §2d is smaller.

## Review-response log (adversarial panel)

⚠️ **Not yet run.** `plan-with-panel` fills this section before any implementation code is written,
per [docs/plans/README.md](./README.md). Owed: the five standing engineering lenses that reviewed
chunk 1 (correctness, scope, architecture, reuse, db-safety — note this chunk has **no DDL**, so
db-safety's remit here is the read/write path and the `''`/NULL predicate, not a migration), plus a
single UX reviewer under AGENTS.md's UI PR rules.

Three places a reviewer should look first, because they are where I am least certain:

- the divergence table in "What chunk 2 owes toward acceptance 11" — I believe it is exhaustive, but
  it is a claim about _every_ way the two paths can be asked the same question;
- the decision to read the program **outside** the transaction;
- whether `ScaffoldRow` carrying an identity is a crack in the wall acceptance 12 builds, or the
  deliberate third widening its docblock anticipated.
