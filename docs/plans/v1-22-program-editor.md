# V1-22 — the program editor: author programming without a deploy

> Backlog: [plan.md](../plan.md) row **V1-22** _(new)_. Branch: `feat/v1-22-program-editor`.
> **PLAN ONLY — not yet panelled.** Supersedes the authoring half of **V1-20**.
> Evidence: [youth-daily-program](../samples/youth-daily-program/README.md) (a second real program, and
> the harder one). Depends on **SCHED-1**; informs **ONB-1**.

## Goal

**Changing a single load today means editing TypeScript and deploying.** Verified: `PROGRAM_SEED`
(`packages/shared/src/programming.ts:162`) → `packages/db/src/seed.ts` is the **only** writer of
`prescriptions` and `prescription_targets` — there is no write path anywhere in `apps/web`. The V1-18
editor at `/p/[profileId]/routine` edits the _daily routine_ (which activities, in what order); it does
not touch the strength program at all.

This PR gives the coach a screen to author a program — its movements, sets, target reps, and per-athlete
loads — and to assign it to one athlete or several. It is the missing half of the product: the app can
_log_ against a program and _display_ one, but a human cannot _write_ one.

## Acceptance

- A coach can create a block, add/reorder/remove prescriptions within a `day_role`, and set
  `sets` / `target_reps` — no deploy.
- Per-athlete **loads and reps overrides** are editable on the same screen, with a visible per-athlete
  column, because that is the only thing that differs between Ray's two kids today.
- A block can be **assigned to one athlete or to several**, which is the "group or individual" ask.
- Editing is **BOLA-scoped**: a coach can only reach blocks in their own household, re-verified in the
  DAL on every read and write.
- The **LLM authors nothing** here. This screen is where a human types a load; that is its whole point.
- Existing seeded programs keep working unchanged — the editor writes the same tables the seed does.

## The decision this plan exists to force

**Two scopes, and they are not the same PR.**

|                            | Scope                                                                                                     | Size                          |
| -------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------- |
| **A — edit what exists**   | CRUD over `prescriptions` + `prescription_targets` within the shipped schema. No migration.               | ~1 PR                         |
| **B — author any program** | A: plus an assignment model, a third schedule shape, and the measurement shapes GAP-3 is still designing. | A migration + SCHED-1 + GAP-3 |

**Recommended: A first — and A is itself 3–4 PRs, not one.** The V1-18 routine editor was 9 files over
**one** table and a single JSONB column. A here is three tables, a per-athlete matrix, a reorder against a
partial UNIQUE index, a new `packages/db` writer, a new query module, routes, and `db:verify` proofs.
Realistically 1,200–1,600 lines against a <400 target at ~4h/wk. Split **where the risk changes**:

|        | Scope                                                                          | Why the seam is here                                                                                                               |
| ------ | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| **A1** | Read-only: query + DAL reads + the program view + the Today link               | Zero write surface. Also closes V1-20's discoverability half on its own.                                                           |
| **A2** | **Edit values on existing rows** — `load`/`reps` targets, `sets`/`target_reps` | **This alone removes the stated pain.** No add/remove/reorder, so the renumber-vs-UNIQUE hazard is _absent_ rather than mitigated. |
| **A3** | Add / remove / reorder                                                         | Where the renumber proof lives.                                                                                                    |
| **A4** | Create a block                                                                 | Open Q2; needs assignment to be useful.                                                                                            |

**The smallest thing that fixes "changing a load requires a deploy" is A2** — one column's worth of
editing. That is the honest MVP of this feature.

### They are not phases. They must CO-EXIST — permanently

_(Ray, 2026-09-23 — and this reframes the whole plan.)_ A-then-B reads like a migration where B replaces
A. **It is not**, because **Ray's own athletes run both program shapes at the same time:**

- the **weekday S&C block** — `day_role`, assigned days, prescribed per-kid loads → the **A** shape
- the **daily A/B program** — every day, session-indexed, no prescribed loads → the **B** shape

Off-season he adds the first **on top of** the second. So "does the app support A or B" was the wrong
question: **it has to hold both at once, for one athlete, on the same day.**

Three consequences, and they make the design simpler rather than harder:

1. **The schedule shape is a per-program field, never a global mode or a setting.** It belongs on
   SCHED-1's block↔athlete assignment row — `schedule_kind ∈ { assigned_days, session_rotation }` plus
   its shape-specific config. A household can then run one of each, which is exactly Ray's case.
2. **B is additive in its TABLES, not in its behaviour — an earlier draft claimed "purely additive,
   byte-identical", and that is false.** Co-existence breaks a shipped query on purpose:
   `programDayRows` returns **one** block by design, because "a bare join would fan the day out across
   all of them", and its own docblock already names the fix — _"an explicit active-block marker is the
   real fix **when multi-block authoring lands**; this keeps the MVP's 'the household's one block' honest
   until then."_ Two programs on one athlete on one day is precisely the case it forbids.

   So B forces: **multi-block selection** (that marker), a **rotation vocabulary** (`A`/`B` is not a
   weekday role, and `day_role`'s accepted set is inlined in a CHECK pinned by `db:verify`, feeding
   `DAY_ROLE_TO_SESSION_TYPE` and the log form's picker), the **Today card and V1-19's scaffold** (both
   assume one program per day), and a schedule control in this editor.

   **What survives is A's tables** — which is still the right reason to ship A first, just not the reason
   the draft gave. Shipping A costs nothing B has to _undo_; it does not mean B is free.

3. **One editor, not two.** The screen's shape is the same — a list of movements with per-athlete
   values. B adds a schedule control and more measurement field types to the _same_ rows. Two editors
   would be the real error: a coach should not have to know which kind of program they are editing
   before they can open it.

**So the revised recommendation is A first _because_ B is additive** — not as a compromise, and not as a
phase to be superseded. The question "could they co-exist?" has to be answered **yes** for the product to
serve the household it was built for.

**What A alone cannot do, stated plainly so it is not discovered later:** it cannot author the daily A/B
program in [`samples/youth-daily-program`](../samples/youth-daily-program/README.md). That program needs
session-indexed rotation (SCHED-1's missing third shape), three simultaneous load slots on Stance in
Motion (GAP-3), and a box-height field (no length dimension exists). **A coach could author Ray's
weekday block with A; they could not author the program his kids actually run daily.** That asymmetry is
the argument for B, and the reason this plan names it rather than quietly shipping A as "the program
editor".

## Shape

### Route

**`/p/[profileId]/program`** — and an earlier draft of this plan got this exactly backwards.

That draft argued for a household-scoped `/programs/[blockPublicId]` on the grounds that a block is a
household object, not a property of one athlete. **The modelling claim is right; the routing conclusion
was wrong**, because it removes the only ownership seam the codebase has.

Every BOLA guarantee here is derived from a **profile public id**. `programDayRows` resolves ownership
_inside the query_ — `profiles.public_id → household_id → program_blocks.household_id` — and its docblock
is explicit that "the caller never supplies (and `ProfileDTO` never exposes) a household id"
(`packages/db/src/queries/program-day.ts`). There is no `getCurrentUser()` in the tree; `getProfileByPublicId`
is an existence check with no household predicate. So a URL carrying only a block id gives the DAL
**nothing to scope by**, and this PR would ship the repo's first _config_-mutating endpoint as a globally
addressable unscoped write.

**The profile in the URL is the authorization subject; the block stays the screen's subject.** Promote to
`/programs` when Clerk makes a household addressable (v1.5) — not before.

Entry points: a link from each athlete's Today page and from the profile picker — closing the **V1-20**
complaint that the routine editor is URL-only, for this screen from the start.

### The editing surface — cards, not a table

The draft sketched a row per prescription with per-athlete load columns side by side. **It does not fit.**
At 360px, `main` is `px-4` inside `max-w-2xl` → 328px content, 302px inside a bordered row. Priced with the
_real_ seed strings — `Overhead Shoulder Press` (~150px), a `reps` field holding
`3 (top triple, then 2 back-offs)`, two load fields — and every control at the CI-mandated 44px, the row
needs **~590px**. That is ~2× over, and a horizontal-scroll table is worse: the frozen column would be the
movement name while the _edited_ cells sit off-screen.

**A card per prescription, athletes stacked:**

```
2.  Trap-Bar Deadlift                      [↑] [↓] [⋯]
    Sets [4]   Reps [3 (top triple, then 2 back-offs)]

    ☑ Same load for both      · applies to Athlete One and Athlete Two
    Load  [~145-150]
```

unchecking expands to a per-athlete pair. Full-width inputs, 44px, inside 302px. At `md:` promote to a grid
with athlete columns — the desktop affordance the draft wanted, **earned by breakpoint rather than assumed.**

**"Same load for both" defaults ON**, because the data says so: `PROGRAM_SEED` is **15 `both(...)` vs 9
`perKid(...)`**. It halves the fields on the common path _and_ is the honest scope-A answer to "group or
individual". Requirement: the collapsed state must **name the athletes beside the field**, so it can never
hide who a load applies to.

**Reorder is ▲▼, not drag.** V1-18 chose that deliberately — keyboard-usable, RSC-friendly — and
`routine-editor.tsx:83-90` documents why the bound buttons use `aria-disabled` rather than `disabled`
(`disabled` drops focus to `<body>`). Reuse that component pattern verbatim.

**Explicit Save, never autosave.** A blur-save on a half-typed `14` before `145` writes a wrong prescribed
load for a 10-year-old. Match the routine editor's `useActionState` + `showSaved` during-render idiom. One
deviation in scope: a block is N rows × M athletes, so add a **sticky bottom save bar** with a dirty count
(`Save 3 changes`) and a `beforeunload` guard — a 21-row page whose Save sits three screens down is how
edits get lost.

**`inputmode="numeric"` on `sets` ONLY.** `reps` and `load` must keep the default keyboard or `AMRAP`,
`to failure` and `15-20 lb ball` become unenterable — the same iOS trap `load-chips.tsx` already documents.

### The answer to "a parent who isn't an S&C coach is authoring loads"

Not examples, and never a suggestion — **the athlete's own history**, which already exists in `entry_sets`:

> Athlete One last did **3 × 60** here on Sep 15 · **[Use 60]**

One gesture, one value, source visible. That is ONB-1 **R8a** exactly: the extracted text shows beside the
field and the coach taps to fill it, at the moment of use. It is _not_ the app suggesting a load — it is
the kid's own recorded performance. **No "fill all", no per-block accept** (R8's absolute line).

And **blank must read as fine, not unfinished**: _"Leave blank to decide at the gym."_ A form that looks
incomplete pressures a non-expert into inventing a number, which is the failure ONB-1 designs against.

### Assignment

Blocked on SCHED-1's assignment row. Until it lands, a block is household-wide and per-athlete
_targets_ are the only per-athlete thing — which is exactly today's model, so **scope A ships with no
assignment UI** and the "group vs individual" distinction is expressed only through which athletes have
targets. Say this in the UI rather than implying more.

## File-by-file — scope A

| Path                                                       | Change | What                                                                                                                                                                                  |
| ---------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/writers/program.ts`                       | NEW    | The write core — upsert/reorder/delete a prescription, upsert a target. Single-sourced here so `db:verify` and the DAL run the identical path (the `writeStrengthSession` precedent). |
| `packages/db/src/queries/program-blocks.ts`                | NEW    | List blocks + load one for editing, household-scoped.                                                                                                                                 |
| `packages/shared/src/programming.ts`                       | EDIT   | Zod schemas for the edit payloads, reusing the existing seed-row shapes.                                                                                                              |
| `apps/web/lib/dal/programming.ts`                          | EDIT   | `listProgramBlocks`, `getProgramBlockForEdit`, and the mutating wrappers — auth → ownership → DTO.                                                                                    |
| `apps/web/app/programs/page.tsx`                           | NEW    | Block list (RSC).                                                                                                                                                                     |
| `apps/web/app/programs/[blockPublicId]/page.tsx`           | NEW    | Editor shell (RSC).                                                                                                                                                                   |
| `apps/web/app/programs/[blockPublicId]/program-editor.tsx` | NEW    | The client editor.                                                                                                                                                                    |
| `apps/web/app/programs/actions.ts`                         | NEW    | Server Actions — thin: re-auth, re-authorize, zod, DAL, revalidate.                                                                                                                   |
| `packages/db/scripts/verify.ts`                            | EDIT   | Proofs: BOLA, reorder integrity, idempotent upsert.                                                                                                                                   |
| `apps/web/app/p/[profileId]/page.tsx`                      | EDIT   | Link to the editor (the V1-20 discoverability fix).                                                                                                                                   |

## Test plan

- **Boundary tests are mandatory** (AGENTS.md): unauth → reject · wrong-household block → forbid · bad
  body → zod-reject. These are the first _mutating_ endpoints that write config rather than a kid's own
  log, so a wrong-owner write here edits someone's training.
- **`db:verify`**: a reorder preserves every prescription and leaves `idx` contiguous; a re-run of the
  same edit is idempotent; a second household cannot read or write block rows.
- **Unit**: the reorder/renumber pure function, against the UNIQUE-index constraint.
- **Component**: editing a load writes only that athlete's target; blank clears rather than inheriting.
- **E2E + tri-viewport screenshots** — it is a new screen, so the UX panel is required and the captures
  ship with the implementation PR.

## The write path — settled, because the obvious approaches are unsafe

### W1 — Reorder: a lock plus a shifted band. NOT a deferred check

An earlier draft proposed "renumber in one statement with a deferred check, or a temporary offset band".
**The first half is unbuildable and the second needs a correction:**
`uq_prescriptions_block_day_role_idx` is a **partial unique INDEX**, not a constraint
(`migrations/0007_little_stone_men.sql:67`). Postgres supports `DEFERRABLE` only on _constraints_, and a
UNIQUE constraint cannot be partial — so there is no `SET CONSTRAINTS` path, and converting it would break
soft-delete (a dead row would occupy its slot forever) and the seed's `onConflictDoNothing` arbiter. A
**negative** offset band is also blocked: `check('prescriptions_idx_check', idx >= 0)` (`schema.ts:519`).

The approach, one transaction in `writers/program.ts`:

1. `SELECT … FROM program_blocks WHERE id = ? FOR UPDATE` — these are config rows with **no `client_id`**,
   so a row lock is the only concurrency arbiter available.
2. Re-read the live prescriptions for `(block_id, day_role)` and **assert the submitted ordered
   `public_id` list equals the live set exactly.** Mismatch → a typed `stale` error, never a write. This is
   also the **double-submit answer**: a replayed reorder finds the order already applied and no-ops.
3. `UPDATE … SET idx = idx + OFFSET` with `OFFSET > max(idx)` — the whole group shifts together, so source
   and target sets are disjoint and stay positive.
4. `UPDATE … FROM (VALUES …)` down to the final `0..n-1`, all currently in the band — disjoint again.

`db:verify` runs on single-connection PGlite, so it **cannot** prove the concurrent case. The `FOR UPDATE`
must be correct by construction, and the plan says so rather than pretending a proof covers it.

### W2 — Idempotency is `public_id`, never the slot key

Config rows have no `client_id`, so none of `writeStrengthSession`'s replay machinery applies. And
`ON CONFLICT` on the natural key is **actively unsafe**: `(block_id, day_role, idx)` is a **slot arbiter**
— the schema comment says a re-seed is deliberately INSERT-ONLY because `DO UPDATE` there would _replace a
different movement_. Two coaches both "add at end" compute `idx = max+1`; `DO NOTHING` loses one silently,
`DO UPDATE` overwrites the other's movement.

**So:** the client mints a UUIDv7 `public_id`; insert is
`onConflictDoNothing({ target: publicId, targetWhere: isNull(deletedAt) })`, then re-select. Updates
address rows by `public_id`, never by slot. The `targetWhere` is not optional — against a partial index
Postgres errors _"no unique or exclusion constraint matching"_ without it, which the seed already handles.

### W3 — The writer must prove the target's profile is in the block's household

`schema.ts:528-531` states this invariant explicitly and says it is **"writer-enforced, not schema"**. So a
crafted `profilePublicId` would write a foreign profile's target into your block — and the editor's own
read would then render that profile's load. Resolve profile ids with
`inArray(publicId, …) AND eq(householdId, block.householdId)` and reject anything that does not resolve.
**This is a mandatory boundary test**, and an earlier draft's test list missed it entirely.

### W4 — Clearing a cell soft-deletes the whole target row

`load` and `reps` are independent columns read independently. Clearing only `load` would leave a **ghost
per-kid reps override** that silently keeps overriding `target_reps` forever. Clearing a cell therefore
soft-deletes the `prescription_targets` row; re-adding inserts a new one (the partial unique ignores dead
rows). The writer must **never** set `deleted_at = null` on an ON-CONFLICT update — that would resurrect a
dead row into an occupied slot.

Soft-deleting a prescription must also soft-delete its targets, or they are orphaned against a dead parent.

## Risks / rollback

| Risk                                                                                                                                                                                                                                                                                                                                                                                                  | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Creating a block silently hijacks every athlete's Today card.** `programDayRows` picks the newest block by `id DESC LIMIT 1` among those programming that `day_role`. Add one `strength_a` row to a new block and the seeded program is replaced household-wide — no warning, no undo. Symmetrically, deleting the last live prescription for a `day_role` silently falls back to an _older_ block. | **Scope A edits existing blocks only; creation is hard-disabled** (this answers open Q2 — it was never a UX question). The real fix is the **active-block marker** `program-day.ts` already names as needed "when multi-block authoring lands". That marker is B's, not A's.                                                                                                                                     |
| Reorder corrupts `idx` or collides with the partial unique index                                                                                                                                                                                                                                                                                                                                      | W1. The lock + shifted band, with a `db:verify` proof of contiguity and preservation.                                                                                                                                                                                                                                                                                                                            |
| A double-submit duplicates or overwrites a movement                                                                                                                                                                                                                                                                                                                                                   | W2. `public_id` idempotency + the W1 stale check.                                                                                                                                                                                                                                                                                                                                                                |
| Cross-household target write                                                                                                                                                                                                                                                                                                                                                                          | W3. Writer-enforced, boundary-tested.                                                                                                                                                                                                                                                                                                                                                                            |
| A ghost per-kid reps override survives a cleared load                                                                                                                                                                                                                                                                                                                                                 | W4.                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Editing a prescription rewrites history's meaning**                                                                                                                                                                                                                                                                                                                                                 | Correct **today**: there is no FK from `entries`/`entry_sets` to `prescriptions`, and performed values live in `entries.raw_load`/`raw_reps`. But **GAP-1 P1-2 proposes persisting `prescription_id` at log time** — at which point an edit _would_ change history. Recorded as a **constraint on P1-2** (store the prescribed string alongside the id, or version the prescription), not merely as a risk here. |
| Unbounded authored text behind one shared gate cookie                                                                                                                                                                                                                                                                                                                                                 | Rate-limit the mutations (`apps/web/lib/rate-limit.ts`), per AGENTS.md.                                                                                                                                                                                                                                                                                                                                          |

**Rollback:** app code plus one new writer module; no migration in scope A. Revert restores seed-only
authoring. No data to undo — the editor writes the same tables the seed does.

## Out-of-scope / deferred

- **Assignment to athletes** — needs SCHED-1's assignment row (scope B).
- **Session-indexed rotation**, **three-slot loads**, **box height** — SCHED-1 / GAP-3 (scope B).
- **Creating movements** from this screen — `movements.slug` is globally UNIQUE, so multi-tenant
  authoring hard-fails on the second household adding "RDL" (ONB-1's blocking prerequisite).
- **Program import** — ONB-1.
- **Suggesting loads.** Never here. A human types every one.

## Open questions

1. ~~Scope A or B?~~ **Both, permanently** — A first because A's _tables_ survive B (not because B is free).
2. ~~Does the editor create blocks in A?~~ **No — hard-disabled.** Not a UX question: creating a block
   silently hijacks every athlete's Today card via `id DESC LIMIT 1`. Creation needs the active-block
   marker, which is B's.
3. ~~Where does the daily A/B program get authored meanwhile?~~ **Seed-authored, until B.**
4. ~~Audit trail?~~ **No.** Spend the budget on the active-block marker and the reorder lock.
5. **Still open — which A-slice ships first?** A2 alone removes the stated pain; A1 is zero-risk and closes
   V1-20's discoverability half. Ray's call.

## Review-response log (adversarial panel)

Panels run 2026-09-23 on the first draft, **before implementation**: correctness/data-integrity/DB-safety ·
simplicity/scope/architecture/DRY · the required UX panel. Every claim re-verified against the tree before
acceptance.

### Blocking

| #   | Lens                                      | Critique                                                                                                                                                                                                           | Response                                                                                                                                                                                                     |
| --- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B1  | DB-safety                                 | "Renumber with a deferred check" is **unbuildable** — it is a partial unique INDEX, and Postgres defers only _constraints_, which cannot be partial. The negative-offset fallback is blocked by `idx >= 0`.        | **Accepted; the plan's own mitigation was wrong.** Verified at `0007_little_stone_men.sql:67` and `schema.ts:519`. Replaced by **W1** — `FOR UPDATE` on the block + a stale check + a positive shifted band. |
| B2  | Scope · DB-safety _(both, independently)_ | `/programs/[blockPublicId]` carries no profile, and **every** BOLA guarantee in the repo derives from `profiles.public_id → household_id`. The Acceptance line promising DAL-scoped ownership was unimplementable. | **Accepted.** Route moved to `/p/[profileId]/program`; the profile is the authorization subject, the block stays the screen's subject. Promote to `/programs` at Clerk.                                      |
| B3  | DB-safety                                 | **Creating a block silently hijacks every athlete's Today card** (`id DESC LIMIT 1`), and deleting a day's last prescription falls back to an older block.                                                         | **Accepted — the sharpest finding.** Creation is hard-disabled in A; open Q2 answered. The active-block marker `program-day.ts` already names is B's.                                                        |
| B4  | UX                                        | The table **does not fit**: ~590px needed against 302px available, priced with real seed strings at 44px controls. Horizontal scroll makes it worse.                                                               | **Accepted.** Card-per-prescription with athletes stacked, grid promoted at `md:`.                                                                                                                           |
| B5  | UX                                        | Drag handles regress V1-18's deliberate ▲▼ choice and its `aria-disabled` focus fix.                                                                                                                               | **Accepted.** Reuse the component pattern verbatim.                                                                                                                                                          |
| B6  | UX                                        | Autosave on a load field writes `14` before `145` — a wrong prescribed load for a child.                                                                                                                           | **Accepted.** Explicit Save + sticky bar with a dirty count + `beforeunload`.                                                                                                                                |

### Major

| #   | Lens      | Critique                                                                                                                                                                                                  | Response                                                                                                                                                                                                           |
| --- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M1  | Scope     | **"B is purely additive" is false** — `programDayRows` returns one block by design; co-existence forces multi-block selection, a rotation vocabulary, and changes to the Today card and V1-19's scaffold. | **Accepted, and it corrects something I asserted to Ray with confidence.** The claim is now "additive in its _tables_, not its behaviour", with the forced changes listed. The code's own docblock predicted this. |
| M2  | Scope     | Scope A is 1,200–1,600 lines — 3–4× the target.                                                                                                                                                           | **Accepted.** Split A1/A2/A3/A4 **where the risk changes**, with the note that A2 alone removes the stated pain.                                                                                                   |
| M3  | DB-safety | **`ON CONFLICT` on the slot key is actively unsafe** — the natural key is a slot arbiter, so `DO UPDATE` replaces a _different movement_.                                                                 | **Accepted.** **W2** — `public_id` is the idempotency key, with the `targetWhere` the partial index requires.                                                                                                      |
| M4  | DB-safety | The **cross-household target write** is unguarded and the test list missed it; the schema says the invariant is _writer-enforced_.                                                                        | **Accepted.** **W3**, plus a mandatory boundary test.                                                                                                                                                              |
| M5  | DB-safety | Clearing only `load` leaves a **ghost per-kid reps override**; deleting a prescription orphans its targets.                                                                                               | **Accepted.** **W4**.                                                                                                                                                                                              |
| M6  | DB-safety | Don't reuse seed-row schemas at a mutation boundary — `profilePublicId` is bare `z.string()` and would 500 on a non-UUID.                                                                                 | **Accepted.** Separate edit-payload schemas reusing the _primitives_ (`uuidSchema`, the `freeTextNoteSchema` bounds), not the seed rows.                                                                           |
| M7  | UX        | The trust answer is **history, not examples** — surface the athlete's own last logged set with a one-tap fill.                                                                                            | **Accepted, and it is the best idea in the review.** It is ONB-1 R8a exactly, and it is not a suggestion — it is the kid's own record.                                                                             |
| M8  | UX        | Blank must read as _fine_, not unfinished, or a non-expert invents a number.                                                                                                                              | **Accepted** — explicit copy.                                                                                                                                                                                      |
| M9  | Scope     | Reuse is asserted, not specified.                                                                                                                                                                         | **Accepted** — the V1-18 idioms are now named individually; only `moveUp`/`moveDown` is genuinely _extracted_.                                                                                                     |
| M10 | DB-safety | No rate limiting named.                                                                                                                                                                                   | **Accepted.**                                                                                                                                                                                                      |
| M11 | UX        | Changing one load happens on the gym floor, not seated — don't force it through the full editor.                                                                                                          | **Accepted as a follow-on**, not scope A: an edit-this-load affordance on the Today card. Recorded in Out-of-scope.                                                                                                |

### Minor — accepted

`inputmode="numeric"` on `sets` only, or `AMRAP` becomes unenterable · per-input `aria-label`s (a `<th>` does
not label an input) · add the new routes to `a11y.spec.ts`'s `ROUTES` in the same PR · `<details>` per
`day_role` for a 21-row page · nav labels "Daily routine" / "Strength program" · reuse V1-11's
"Copy to \<sibling\>" wording · state in the UI that the movement picker is catalog-only.

### Pushed back

| #   | Lens      | Critique                                                                                                               | Why not                                                                                                                                                                                              |
| --- | --------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Scope     | "V1-22 supersedes V1-20's authoring half" is wrong; V1-20 is about the **routine** editor, which V1-22 does not touch. | **Accepted, actually — not a pushback.** The claim was mine and it was wrong. V1-20 is rewritten as cross-athlete _routine_ editing; V1-22 claims only the program surface.                          |
| P2  | DB-safety | Record the no-retroactive-derivation ruling as a constraint on **GAP-1 P1-2** rather than a risk row here.             | **Accepted in substance, deferred in placement** — noted in the risk table with the P1-2 pointer. Editing P1-2's row belongs to the PR that implements it, not to a plan that merely anticipates it. |
