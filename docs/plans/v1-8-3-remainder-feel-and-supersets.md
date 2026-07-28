# V1-8-3 remainder — session feel + supersets (3-way split) — Staff plan & panel log

> Backlog: [plan.md](../plan.md) **V1-8-3** remainder, closing **V1-8** (master:
> [v1-8-strength-sessions.md](./v1-8-strength-sessions.md); ADR:
> [0003](../decisions/0003-superset-log-grouping.md); 3a:
> [v1-8-3-session-grouping-and-supersets.md](./v1-8-3-session-grouping-and-supersets.md)). V1-8-3a (#55)
> shipped the session read grouping. The 4-lens panel (§10) split the remaining "supersets + feel" work —
> a ~500–650-line mix of a write branch, a form interaction, and an unrelated feel vertical — into **three**
> shippable slices. This plan details **3b (feel)** and sketches **3c/3d (supersets)**. Base: `main` (3a merged).

## The split (panel B1/B2)

| Slice                        | Scope                                                                                                                                                    | R11-safe?                                                                   | ~Size |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----- |
| **3b — session feel** ← THIS | The `sessions.feel` vertical end-to-end: schema field + writer thread + DAL + action + form input + header display. Zero coupling to supersets.          | n/a (full vertical)                                                         | ~70   |
| **3c — superset write core** | Schema superset fields + `superRefine` + `insertSupersetRow` + the writer branch, proven by `db:verify`. **No app UI** (DAL/action/form/read stay flat). | yes — caller is `db:verify` (V1-8-1 precedent)                              | ~180  |
| **3d — superset UI + read**  | DAL/action superset threading + group-as-superset form + the two-level `SessionItem` read refactor + page render. **Closes V1-8.**                       | yes — ships write-branch caller + boundary tests + UI together (master R11) | ~300  |

**Why split:** the combined slice is ~500–650 lines mixing an independent feel vertical, a transactional
write branch, and a form-interaction + read refactor — the mixing the <400/one-concern rules forbid.
`feel` has no coupling to supersets (the "3d reopens the form anyway" argument is efficiency, not scope).
3c is a legitimate DB-core-proven-by-`db:verify` slice (not the caller-less anti-pattern R11 forbids —
that's an _app-layer_ export with no caller; here the write branch lives in the single-sourced
`packages/db` core and `db:verify` is its caller, exactly the V1-8-1 shape). Precedent: V1-8-1/8-2/8-3a.

---

# PART A — V1-8-3b (session feel) — the detailed slice

## Goal

The optional session **feel** ("how did it feel?") logs to `sessions.feel` and shows in the 3a session-block
header. A self-contained write→read vertical; no migration (the column exists, `schema.ts:314`), no superset
work, no grouping refactor (feel is a header field, additive to 3a's block).

## Design decisions

**F1 — `feel` schema field, blank→NULL.** `logStrengthSessionSchema` gains
`feel: z.string().trim().max(FREE_TEXT_NOTE_MAX).transform((v) => v || undefined).optional()`. The
`transform(v => v || undefined)` maps a **left-blank** (`''`) or **whitespace-only** (`'  '`→trim→`''`) input
to `undefined`→NULL — the common path (most sessions log no feel), and the correctness fix the 3a panel
flagged. This is a **correctness improvement over** the bodyweight-`notes` precedent (which stores `''`), NOT
a reuse of an identical trap — do not mis-cite it.

**F2 — `FREE_TEXT_NOTE_MAX` hoist (panel: the 2nd-occurrence extract trigger).** `bodyweight.ts:27`'s bare
`z.string().max(500)` is the first free-text-note bound; `feel` is the second → hoist
`export const FREE_TEXT_NOTE_MAX = 500` to `packages/shared` and **also refactor `bodyweight.ts:27` to
import it** (a const beside a surviving literal is still drift). Do NOT fold in `movementName`'s `max(100)`
(a name bound, different meaning).

**F3 — `feel` is a discrete top-level scalar, not in the movements JSON.** The action reads
`feel: formData.get('feel') ?? undefined` (the `logBodyweightAction` `notes` idiom) — a session-level scalar,
parallel to `profileId`/`clientId`, NOT part of the `movements` JSON array (that stays the movements array).
The form adds one `<input name="feel">` in `StrengthFormBody`, reusing `inputClass` + the key-remount reset
(no new state machinery — the `gen` bump clears it for free).

**F4 — thread + write-once.** `LogStrengthSessionArgs` + `writeStrengthSession` args + `insertStrengthSessionRow`
gain `feel?`; the insert sets `feel: args.feel ?? null` (the `notes ?? null` writer-edge idiom). The DAL
wrapper stays thin (feel needs no catalog resolution). **Write-once:** `insertStrengthSessionRow`'s
`onConflictDoNothing` means a replay never updates `feel` (LWW is v1.5) — acknowledged, correct.

**F5 — read + display.** `listEntriesForDay` selects `sessionFeel: schema.sessions.feel` (the 3a `sessions`
LEFT JOIN already exists) → `EntryDTO.sessionFeel: string | null` (additive/nullable) → `todayRows` carries
it onto `SessionRow.session.feel` (read from the first collected member, like `type`) → `page.tsx` shows it
in the header **when truthy** (`feel ? … : null`, so `''` never renders — belt-and-suspenders with F1).

## File-by-file (3b)

| Path                                                  | Change | What                                                                                                                    |
| ----------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/strength-session.ts`             | EDIT   | `feel?` field (F1); import `FREE_TEXT_NOTE_MAX`.                                                                        |
| `packages/shared/src/bodyweight.ts` (+ a consts home) | EDIT   | Hoist `FREE_TEXT_NOTE_MAX`; refactor `notes` to it (F2).                                                                |
| `packages/db/src/writers/strength-session.ts`         | EDIT   | `feel?` on the arg bag + `insertStrengthSessionRow` → `sessions.feel = feel ?? null` (F4).                              |
| `apps/web/lib/dal/entries.ts`                         | EDIT   | `feel` in `LogStrengthSessionArgs` + hand-off; `sessionFeel` select + `EntryDTO` (F5).                                  |
| `apps/web/lib/entries/activity-totals.ts`             | EDIT   | `SessionRow.session.feel`; carry from the first member.                                                                 |
| `apps/web/app/p/[profileId]/actions.ts`               | EDIT   | `feel: formData.get('feel') ?? undefined` (F3).                                                                         |
| `apps/web/app/p/[profileId]/strength-form.tsx`        | EDIT   | One `<input name="feel">` (F3).                                                                                         |
| `apps/web/app/p/[profileId]/page.tsx`                 | EDIT   | Feel in the session header when truthy (F5).                                                                            |
| `packages/db/scripts/verify.ts`                       | EDIT   | The flat-session round-trip also asserts `feel` persists (non-conflict path).                                           |
| tests                                                 | EDIT   | schema (blank/whitespace→undefined); action (feel threads / omitted→undefined); grouping (feel on the row).             |
| docs/plan.md, docs/status.md                          | EDIT   | V1-8-3a → merged; V1-8-3 → 3b/3c/3d split; **+ the two new backlog rows** (performed-order log, per-kid routine order). |

**No migration.** Tri-viewport screenshots of a session block **with** feel.

---

# PART B — V1-8-3c (superset write core) — sketch

- **Schema** (`strength-session.ts`): `movements` gain `supersetClientId?: uuid` + `supersetOrder?: int`
  (1-based, matching `entry_sets.idx`); add a **top-level** `supersets?: [{ clientId: uuid, label?: string }]`
  (bounded `.max(6)` = floor(12/2); `label` `.max(FREE_TEXT_NOTE_MAX)`). `superRefine` (append to the existing
  distinct-movement-clientId check — do NOT replace it):
  - **distinct `supersets[].clientId`** (else `insertSupersetRow`'s ON-CONFLICT silently merges two groups).
  - **membership**: every `movement.supersetClientId` ∈ `supersets[].clientId` (a dangling ref → `undefined`
    in the writer map).
  - **≥2 members**: iterate `val.supersets` and assert `movements.filter(m => m.supersetClientId === s.clientId).length >= 2` — the `supersets[]`-driven direction (a `movements`-grouped count misses a **0-member** superset → an orphan `supersets` row; panel correctness #1).
  - **DROP** the pairing (`supersetClientId ⟺ supersetOrder`) and distinct-`supersetOrder`-per-superset checks
    — the DB `entries_superset_order_check` + `uq_entries_superset_order` already enforce them; zod would only
    prettify a crafted-body error (panel simplicity #5 + correctness #2/#3, which were traps in _implementing_
    those now-dropped checks). State they're DB-enforced.
- **Writer** (`strength-session.ts`): module-private `insertSupersetRow(exec, { sessionId, clientId, label })`
  → `{ id, publicId }`, ON-CONFLICT by client_id + **`deleted_at`-guarded** re-select (the
  `insertStrengthSessionRow` twin — use the guarded form, not the `verify.ts:upsertReturningId` shortcut).
  `writeStrengthSession` (still one tx): insert `supersets` → build `Map<supersetClientId, supersetId>` →
  in the movement loop resolve `supersetId` from the map and pass it + `supersetOrder` into the **existing**
  `writeSessionStrengthEntry` (its `supersetId?`/`supersetOrder?` params were pre-wired — no fork). **Throw**
  if `m.supersetClientId != null` but the map lookup is `undefined` (belt-and-suspenders for the schema-less
  `verify.ts`/future callers; mirrors `if (!profile) throw`). `ResolvedSessionMovement` gains
  `supersetClientId?`/`supersetOrder?` (**NOT** `supersetId` — the superset row doesn't exist until the tx;
  the writer owns the map). **Do NOT re-export** `insertSupersetRow`/`insertStrengthSessionRow`/
  `writeSessionStrengthEntry` — the branch stays in-tx; **correct the stale `:43`/`:85` comments** that
  anticipated an export (panel architecture #1).
- **`db:verify`**: a 2- and a 3-movement superset round-trip **via `writeStrengthSession`** (members carry
  `superset_id` + `superset_order`, ordered; idempotent replay → one graph). The existing V1-8-1 **raw-SQL
  rejection block stays** (those rejections can't be produced through the writer).
- **No app DAL/action/form/read change** (flat sessions still write; the schema fields are optional + unused
  by the app until 3d). Tests: schema `superRefine` rejections (dangling, <2, dup-clientId) + the verify proof.

# PART C — V1-8-3d (superset UI + read bracketing) — sketch

- **Cleanup (from the 3c panel, A2):** correct the stale `apps/web/lib/dal/entries.ts` comment that
  mis-attributes `EntryDTO.supersetId`/`supersetOrder` to "V1-8-3b" — those fields + their bracketing reader
  land HERE (3d). 3c is packages-only so it couldn't touch it.
- **DAL/action**: parse a **second sibling hidden JSON field** `supersets` (its own `JSON.parse` + try/catch,
  symmetric to `movements` — NOT folded into the movements array); thread `supersetClientId`/`supersetOrder`
  - `supersets[]` to `writeStrengthSession` (add `LogStrengthSessionArgs.supersets` + one pass-through line).
    Add `supersetId`(public_id, via a `supersets` LEFT JOIN, `deleted_at` in the ON) + `supersetOrder` (an
    `entries` column) to `EntryDTO`.
- **Read** (`activity-totals.ts`): **refactor** `SessionRow.movements: EntryDTO[]` → a two-level
  `items: SessionItem[]` where `SessionItem = { kind:'movement'; entry } | { kind:'superset'; superset:{ id;
label: string|null }; members: EntryDTO[] }`. Group members by **`supersetId !== null`** (NOT
  `supersetOrder` — a soft-deleted superset yields `supersetId` NULL but a live `supersetOrder`; keying on
  order would bracket an orphan); members within a superset sorted by `supersetOrder` asc; item order by
  earliest member `id` (the 3a anchor); standalone members → `{kind:'movement'}`. A soft-deleted-superset
  member renders as a standalone movement (test it). Contained to the pure module + `page.tsx`'s session arm
  - its test (the honest 3a-flagged non-additive refactor).
- **Form**: "group as superset" — a `selected`/`onToggleSelect` prop on `MovementCard` + a "Group" button;
  tags 2+ selected cards with a shared `supersetClientId` (minted via `newId()` in parent state) +
  1-based `supersetOrder`; a `supersets` parent state serializes to the new hidden field. **Dissolve** a
  superset (strip `supersetClientId`/`supersetOrder`, drop its `supersets[]` entry) whenever its membership
  drops below 2 — on `removeMovement` **and** explicit ungroup (else the ≥2 `superRefine` rejects on submit;
  panel architecture #6). Reuse `inputClass` + the key-remount reset.
- **`page.tsx`**: render a `{kind:'superset'}` item as a labeled sub-bracket (container markup only) with each
  member via the shared `<MovementLine>`; a `{kind:'movement'}` via `<MovementLine>`. **Null-label fallback**
  ("Superset" or member names — mirror the `?? DEFAULT_SESSION_TYPE` fallback); **fix the header count** to
  sum members (post-refactor `items.length` ≠ movement count).
- Tests: two-level grouping (bracket order; mixed superset+standalone; soft-deleted-superset orphan) +
  action boundary. Screenshots of a superset bracket.
- **Stored label:** cut the auto-"A + B" default (leave `label` NULL from the form; derive/generic at read) —
  the members already carry the names; storing a derivable label duplicates data (panel simplicity #3).
  Schema keeps `label?` optional for a future user override (expand-only, no cost).

---

## 8. Risks / recorded gaps

- **3d two-level refactor churns 3a's render arm + test** — contained (pure module + one arm + one test), the
  3a-flagged non-additive change.
- **Partial offline replay** can collide a `superset_order` with an already-persisted (not-in-body) member →
  raw `uq_entries_superset_order` 500. Unreachable today (the form re-sends all cards); a **v1.5-sync
  limitation**, recorded alongside feel write-once.
- **DTO accretion** (~11 nullable fields after 3d) — the recorded trend; a per-kind discriminated-DTO refactor
  is a future cleanup, not a 3c/3d trigger (panel architecture #4).
- No migration in any slice.

## 9. Open questions — resolved by the panel

- **Split?** YES → 3b (feel) / 3c (write core) / 3d (UI). §The split.
- **feel in the superset slice?** No — its own slice (3b), first. **Stored superset label?** Cut the default
  (derive at read); schema keeps optional. **superRefine set?** distinct-clientId + membership + ≥2-members;
  drop pairing + distinct-order (DB-enforced). **Wire shape?** `supersets` = a second sibling JSON field.
  **Two-level vs inline marker?** Two-level (ADR-0003's two-axis model; architecture-endorsed; the honest 3a
  refactor).

## 10. Review-response log (adversarial panel)

Four lenses. Net: **the work splits into 3b/3c/3d**; feel carved out as an independent vertical; the superset
`superRefine` trimmed to the 3 non-DB-redundant invariants (≥2 via `supersets[]`-iteration); the wire shape
pinned to a second sibling JSON field; a UI dissolve-below-2 gap closed; helpers stay un-exported; the
`FREE_TEXT_NOTE_MAX` hoist made (incl. `bodyweight.ts`). No blocking defect survives.

| #   | Lens(es)                   | Critique                                                                                                                                                                   | Resolution                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | simplicity (BLOCKING)      | `feel` is an independent write vertical bolted onto the superset slice; bundling mixes two concerns.                                                                       | **Split feel into 3b** (its own ~70-line vertical, first).                                                                                                                                                                                                                                                                                                                                                      |
| B2  | simplicity (BLOCKING)      | ~380 estimate is really ~500–650 (form UI + two-level refactor + write branch + feel + tests).                                                                             | **Split supersets into 3c (write core, `db:verify`-proven, R11-safe) + 3d (UI + read).**                                                                                                                                                                                                                                                                                                                        |
| C1  | correctness                | ≥2-members implemented by grouping `movements` misses a **0-member** superset → orphan `supersets` row.                                                                    | **Iterate `supersets[]`**, count members per clientId ≥2 (subsumes 0- and 1-member).                                                                                                                                                                                                                                                                                                                            |
| C2  | correctness + simplicity   | Distinct-`supersetOrder` and pairing `superRefine` checks duplicate the DB CHECKs; global-distinctness is a trap (rejects legal two-superset orders).                      | **Drop both** (DB-enforced); keep distinct-clientId + membership + ≥2. State DB-enforced.                                                                                                                                                                                                                                                                                                                       |
| A1  | architecture (real gap)    | Removing a member (or ungroup) leaves a lone member tagged `supersetClientId` → the ≥2 rule rejects on submit, unlocatable.                                                | **UI dissolves the superset** when membership drops below 2 (on remove + ungroup) — a parent-state invariant.                                                                                                                                                                                                                                                                                                   |
| A2  | architecture               | "supersets ride the movements JSON" breaks the "movements field IS the array" invariant.                                                                                   | **A second sibling `<input name="supersets">` JSON field** (symmetric to movements); `feel` stays a scalar.                                                                                                                                                                                                                                                                                                     |
| A3  | architecture               | Stale `:43`/`:85` comments anticipate exporting the helpers; a direct external caller never materializes (branch stays in-tx).                                             | **Do not export** `insertSupersetRow`/`insertStrengthSessionRow`/`writeSessionStrengthEntry`; correct the comments.                                                                                                                                                                                                                                                                                             |
| A4  | architecture + correctness | Grouping/soft-delete: a soft-deleted superset yields `supersetId` NULL but a live `supersetOrder`.                                                                         | **Group on `supersetId !== null`** (not order); the orphan renders standalone. `deleted_at` in the JOIN ON. + a test.                                                                                                                                                                                                                                                                                           |
| R1  | code-reuse                 | `insertSupersetRow` is the 3rd copy of the guarded-upsert idiom; `verify.ts:upsertReturningId` proves a generic extraction — but its re-select is **un**guarded.           | **Typed twin** (matches the production tolerance; V1-8-2 kept separate typed fns), using the **guarded** re-select. Not the generic (loses per-table types via `as never`).                                                                                                                                                                                                                                     |
| R2  | code-reuse + architecture  | `FREE_TEXT_NOTE_MAX` — feel's `500` is the 2nd occurrence of bodyweight `notes`' `500`.                                                                                    | **Hoist to `packages/shared` + refactor `bodyweight.ts` to it** (3b). Not `movementName`'s 100.                                                                                                                                                                                                                                                                                                                 |
| S3  | simplicity + code-reuse    | Stored superset `label` "A + B" duplicates data the members already carry.                                                                                                 | **Cut the default** (leave NULL; derive/generic at read); schema keeps `label?` optional for a future override. Read renders the **stored** label (no read-side "A + B" rebuild).                                                                                                                                                                                                                               |
| C6  | correctness                | `supersets[]` + `label` unbounded (a crafted body → megabyte payload).                                                                                                     | Bound `supersets.max(6)` + `label.max(FREE_TEXT_NOTE_MAX)`.                                                                                                                                                                                                                                                                                                                                                     |
| —   | correctness + architecture | Various: 1-based `supersetOrder` + `!= null` presence; writer throw on dangling ref; header count after refactor; preserve the distinct-movement-clientId refine (append). | **All incorporated** into the 3c/3d sketches.                                                                                                                                                                                                                                                                                                                                                                   |
| —   | all (confirmations)        | —                                                                                                                                                                          | **Confirmed:** member CHECK envelope holds (kind=NULL+movement_id+superset_id+order passes all six); one-tx per-row `ON CONFLICT` graph + session-scoped map (no cross-session leak); `writeSessionStrengthEntry` reuse (no fork); `<MovementLine>` reuse; two-level in the pure module + ADR-0003 two-axis order; public-id anti-IDOR join; additive-nullable DTO; feel normalization + write-once + thin DAL. |
