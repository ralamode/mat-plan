# GAP-1 P1-1b — a SET can be marked `sub_failure` (write path + read DTO)

> Backlog: [plan.md](../plan.md) row GAP-1 · analysis: [csv-recording-gaps.md](../csv-recording-gaps.md).
> Branch: `feat/gap1-p1-1b-subfailure-write` (off `main`). **No migration** — `entry_sets_status_check`
> already allows `('done','skipped','sub_failure')` (schema.ts:193/204).
> PR **3 of 4** splitting P1-1: #99 (CSV-unsafe input) → [1a — skipped entries](./gap1-p1-1a-skipped-write.md)
> → **this** → 1c (form toggles + read badges). The combined
> [gap1-p2-sanitise-p11-skip.md](./gap1-p2-sanitise-p11-skip.md) is **superseded**; its Part B is replaced
> by 1a + this + 1c.

## Goal

`entry_sets.status` has permitted `sub_failure` since 0000 and **nothing has ever written it**. "Got 3 of
the prescribed 5" is a recurring observation in Ray's log (`2 sets sub-failure`, `max 4 clean unassisted`)
that survives only as prose in `notes` — invisible to progression and to the export. This PR makes the
value writable and readable, and closes the latent edit bug that becoming writable activates. No UI.

## Acceptance

- A set can be marked **sub-failure**, storing `entry_sets.status='sub_failure'` **with its real `reps`**.
- A set status of `'skipped'` is **rejected at the boundary** — a skipped SET row is never written.
- `SetDTO` carries `status`, so the read path can render it (PR 4 does the rendering).
- **BUG-2(a) is closed:** a `sub_failure` set is not offered the V1-9 inline edit, **and** a crafted POST
  to `editStrengthSetAction` cannot edit one (a server-side mirror of the same rule).
- The existing `done` path is byte-identical — same wire shape, same stored rows, same messages.

## Decisions

**S1 — `sub_failure` belongs to the SET, not the entry.** The CSV row puts `sub-failure` in the **`reps`
column** of a movement row, which _looks_ like movement granularity. It isn't: the CSV is
one-row-per-movement and `sets`/`reps`/`load` are **all** movement-level aggregates, with the contract's own
rule that `reps`/`load` are "either a scalar (when uniform) or a slash-list with exactly `sets` elements".
So `sub-failure` in `reps` is the **uniform collapse of a per-set list** — structurally identical to
`5/5/5` → `5`. Decisive criterion: _a status belongs on the entry only if it can be true with zero sets._
`skipped` can (PR 1a); `sub_failure` cannot — no attempt means no failed attempt, which _is_ `skipped`.

**S2 — `reps` stays REQUIRED and positive.** The CSV lost the number to `notes`; that is a limitation of
the file, not an instruction to lose it in the DB. `reps=4, status='sub_failure'` is strictly more
information and S3 still emits the observed byte — byte-faithfulness is a property of the **output**, not
the storage. A nullable `reps` would also recreate a known-unrecoverable state: `formatSetLine` renders
`? × BW` and `isEditableSet` then refuses to fix it, exactly the failure `parseLoad`'s blank-check docblock
exists to prevent. (The superseded plan reached this conclusion from a false premise — that the CSV row
shows "a real `reps` value". It does not; that column holds only the literal `sub-failure`.)

**S3 — record the intended EXPORT rule now** (one line into `v1-13-csv-export.md` D7), because **this PR
invents the storage** and D7 today is silent on a mixed set list:

```
reps ← collapse(sets.map(s => s.status === 'sub_failure' ? 'sub-failure' : String(s.reps)))
```

All-sub-failure collapses to the scalar `sub-failure`, reproducing the observed byte **via the collapse
rule the export already has to implement**. A mix emits e.g. `5/5/sub-failure` — a slash-list of exactly
`sets` elements: legal under the contract, unobserved but not illegal. Emitting `3` for a failed set would
silently reclassify it as completed, destroying the entire signal. (This sharpens an **unimplemented**
plan's under-specified decision — not the retro-editing AGENTS.md forbids.)

**S4 — `entry_sets.status` ∈ `{done, sub_failure}` only.** Pin it while it is free: a `'skipped'` set row
would make the export's `sets = COUNT(entry_sets)` over-count, needing a `WHERE status <> 'skipped'` nobody
would remember. Constrained at the **zod boundary**, not the DB CHECK (no migration), as a named subset
derived from the one canonical list:

```ts
// packages/shared/src/enums.ts
export const SET_STATUSES = ['done', 'sub_failure'] as const satisfies readonly EntryStatus[];
export const setStatusSchema = z.enum(SET_STATUSES);
export const SET_STATUS = keyBySelf(SET_STATUSES);
```

`satisfies readonly EntryStatus[]` makes the subset a **compile-time** proof against `ENTRY_STATUSES`.

**S5 — the wire field is `.optional()`; the DB column default supplies `'done'`.**
`status: setStatusSchema.optional()` on `strengthSetSchema`'s object (**not** `numericSetSchema`), carried
through the existing `transform` by a conditional spread. `.optional()` over `.default('done')`
deliberately: `.default()` makes `status` **required in the output type**, churning ~15 bare
`{ reps, weight }` set literals in `verify.ts` for zero benefit and forking the default across zod and the
column. The writer omits the column when undefined — the same "omitted → column default" idiom
`insertStrengthSessionRow` already uses. Existing payloads validate and store identically.

**S6 — `strengthSetSchema` stays object → `superRefine` → `transform`.** Adding a key to the object is
safe; `numericSetSchema` and `editStrengthSetSchema` are **untouched** (the latter `.extend()`s the plain
object and would not compile off a transform). The edit path is numeric-only **and now done-only**.

**S7 — BUG-2(a): fix BOTH guards, here.** `isEditableSet` is
`weightLabel === null && reps !== null && weight !== null`, so a numeric sub-failure set **passes** — edit
its reps 3 → 5 and the row still exports as `sub-failure`. Add `set.status === ENTRY_STATUS.done`, **and**
mirror it with `eq(schema.entrySets.status, ENTRY_STATUS.done)` in `updateStrengthSetById`'s WHERE (that
function's docblock already mandates the two guards stay identical; the client guard is advisory, a crafted
POST is the real threat). No match → `null` → the existing typed error. This lands **now, not in PR 4**:
the moment the schema accepts `status` on the wire the state is craftable, so the guard ships with it.

**S8 — `formatSetLine` does NOT render the status; PR 4 does.** (a) Until PR 4 nothing in the UI can
produce a sub-failure set, so a badge added here is unscreenshottable and unverifiable by hand — and every
UI PR owes tri-viewport screenshots. (b) Status is a distinct visual affordance, not part of the load
string: appending `(sub-failure)` inside `formatSetLine` yields an un-styleable blob that leaks into
`EditableSet`'s read line and any future `aria-label`. PR 4 mirrors `page.tsx:334`'s existing entry-level
`status !== done` badge idiom at the set level. One test here pins that `formatSetLine` **ignores** status.

**S9 — no `actions.ts` change.** `logStrengthSessionAction` passes `parsed.data.movements` straight through
and `SessionMovementInput.sets` is `z.infer<typeof strengthSetSchema>[]`, so the field threads itself.
Stated because its absence from the table would otherwise read as an omission.

## File-by-file changes

| Path                                                     | Change | What & why                                                                                                                                                       |
| -------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/enums.ts`                           | EDIT   | `SET_STATUSES` / `setStatusSchema` / `SET_STATUS`, derived from `ENTRY_STATUSES` (S4).                                                                           |
| `packages/shared/src/strength.ts`                        | EDIT   | optional `status` on `strengthSetSchema`'s object + through the `transform`'s two returns. `numericSetSchema` / `editStrengthSetSchema` untouched (S5/S6).       |
| `packages/db/src/writers/strength-session.ts`            | EDIT   | `entry_sets` insert spreads `...(s.status ? { status: s.status } : {})` (the `weightLabel` idiom); `updateStrengthSetById` gains `eq(status,'done')` + docblock. |
| `apps/web/lib/dal/entries.ts`                            | EDIT   | `SetDTO.status: EntryStatus`; select `schema.entrySets.status` in the sets query (l.164) and map it (l.182). **Per-set status is unrenderable without this.**    |
| `apps/web/app/p/[profileId]/set-display.ts`              | EDIT   | `SetShape` gains `'status'`; `isEditableSet` requires `ENTRY_STATUS.done` (S7). `formatSetLine` unchanged (S8).                                                  |
| `apps/web/app/p/[profileId]/set-display.test.ts`         | EDIT   | fixture gains `status`; the BUG-2(a) regression pins.                                                                                                            |
| `apps/web/app/p/[profileId]/strength-set-schema.test.ts` | EDIT   | wire-level status cases + the subset invariant (tests live in `apps/web` — vitest's root; a test under `packages/` is never collected).                          |
| `packages/db/scripts/verify.ts`                          | EDIT   | round-trip + edit-refusal proof through the **shipped** writer.                                                                                                  |
| `docs/plans/v1-13-csv-export.md`                         | EDIT   | one line into D7 — the collapse rule (S3).                                                                                                                       |
| `docs/plan.md` · `docs/status.md`                        | EDIT   | GAP-1 progress; mark **BUG-2(a) closed** (the BUG-2 row is already on `main`, via #99).                                                                          |

## Test plan

- **Schema:** `{reps:'3',weight:'0',status:'sub_failure'}` parses and keeps `reps: 3` (S2); an omitted
  `status` yields **no** `status` key (S5 — the stored-row-identical proof); `'skipped'` is **rejected**
  (S4), as are `'SUB_FAILURE'` and `'done '`; `SET_STATUSES ⊆ ENTRY_STATUSES` at runtime;
  `editStrengthSetSchema` still strips an injected `status` and still `.extend()`s the numeric object.
- **`set-display.test.ts`:** a `sub_failure` numeric set → `isEditableSet` **false** (the BUG-2(a) pin); a
  `done` numeric set → still true; `formatSetLine` output identical for `done` vs `sub_failure` (S8).
- **`db:verify` (PGlite, required check), via the shipped writer:** a session with
  `[{reps:5,weight:60},{reps:3,weight:60,status:'sub_failure'}]` persists statuses `['done','sub_failure']`
  with reps `[5,3]` **and `COUNT(entry_sets) = 2`** (the S4 arithmetic); an omitted status stores `'done'`;
  `updateStrengthSetById` on the sub-failure set returns `null` and **changes nothing** (S7's server mirror
  — the half a crafted POST would bypass); the existing V1-9 edit of the `done` set still succeeds.
- **Local:** `pnpm --filter web test` · `pnpm --filter @mat-plan/db verify` · `pnpm exec tsc --noEmit`.
- **Screenshots:** none — no UI change (S8).

## Risks / rollback

- **Over-tightening the V1-9 WHERE** would break editing of legacy non-`done` sets. None exist (nothing has
  ever written one), and `db:verify` pins the `done` edit path in the same run.
- **The default lives only in the DB** (S5). A future writer bypassing the omission idiom still gets `'done'`
  from `.notNull().default('done')` — a benign failure mode; noted at the writer edge.
- **A `sub_failure` set is uneditable until PR 4 / V1-9b** — by design (correcting it means changing the
  status), and consistent with how labeled sets already behave.
- Rollback: revert. No migration; `done` rows untouched.

## Out-of-scope / deferred

The UI, both the per-set toggle and the read badge — **PR 4**. `entries.status='skipped'` — PR 1a. Editing
or clearing a sub-failure status — PR 4 / V1-9b. The export itself — V1-13 (S3 records only the rule).
`prescribed` (P1-2) and bodyweight `context` (P1-3). Any DB CHECK change on `entry_sets.status` —
unnecessary while S4 holds at the boundary.

## Open questions

None.

## Review-response log (adversarial panel)

- **[architecture] Put `sub_failure` on the entry — the CSV puts it in a movement row's `reps` column.** →
  **Rejected, reasoning replaced.** That column is a movement-level aggregate like every other, so the
  value is a uniform collapse, not a granularity signal. Adopted the general criterion in S1 (entry-level
  iff true with zero sets), which also cleanly separates this from PR 1a's `skipped`.
- **[correctness] Make `reps` nullable, mirroring the CSV's information loss.** → **Rejected** (S2), and
  the _accepted_ rationale corrected: the superseded plan argued from a CSV "real reps value" that does not
  exist. The real arguments are the file's limitation ≠ the DB's, and nullable reps recreates `? × BW`.
- **[correctness] The export is undefined for a mixed set list.** → **Accepted**: S3 pins the collapse rule
  and writes it into D7 in this PR, since this PR invents the storage.
- **[correctness/security] BUG-2(a) — `isEditableSet` passes a numeric sub-failure set; the superseded plan
  missed it entirely.** → **Accepted, BLOCKING**: S7 fixes the client predicate **and**
  `updateStrengthSetById`'s WHERE, with a `db:verify` case on the server half. This PR activates the bug,
  so this PR fixes it.
- **[correctness] Nothing stops a `'skipped'` SET row, corrupting the export's `sets` count.** →
  **Accepted**: S4's boundary subset, pinned by a schema test and the `COUNT = 2` assertion.
- **[code-reuse] Don't re-type the status literals.** → **Accepted**: `SET_STATUSES` derives from
  `ENTRY_STATUSES` with a `satisfies` proof; comparisons go through `ENTRY_STATUS.done`, never a literal.
- **[simplicity] `.default('done')` reads more explicitly.** → **Rejected** (S5): it makes `status`
  required in the output type, churns ~15 `verify.ts` literals, and duplicates the column's default.
- **[scope] The superseded plan's table omitted `SetDTO`** — per-set status would have been unrenderable.
  → **Accepted**: the DAL change is explicitly in scope here, so PR 4 stays pure UI.
- **[scope] Render the badge now?** → **Rejected** (S8): unproducible and unscreenshottable until PR 4, and
  it belongs beside the load line, not inside it.
