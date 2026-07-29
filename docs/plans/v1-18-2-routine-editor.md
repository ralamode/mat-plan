# V1-18 PR 2 — coach routine editor — plan & panel log

> The **authoring half** of V1-18. Slice 1 (PR 1a data + PR 1b render, both merged) let each kid's Today
> render their `routine_config`, but the only way to SET it is the seed. PR 2 gives Ray a screen to build /
> reorder a kid's routine. Grounding: [ux-decision](./v1-18-ux-decision.md) · [eng-plan](./v1-18-eng-plan.md).
> Base: `main` (slice 1 in). **No migration.** Significant PR → committed plan + 4-lens panel before code.

## Goal

A parent-facing screen to author a kid's routine: pick which activities are in it, order them, and copy
another kid's routine as a starting point. Reuses the PR 1a contract (`routineConfigSchema`) + the PR 1b
catalog (`ROUTINE_CATALOG`). No new activity types; no kid-facing edit affordance.

## Design decisions (post-panel — see the review log below)

**E1 — Route: `apps/web/app/p/[profileId]/routine/page.tsx` (RSC).** Loads the profile's resolved routine
(`getProfileByPublicId`) + the labelled catalog (E5), renders a client `<RoutineEditor>`. `export const runtime
= 'nodejs'` as an **inline literal** (Next can't follow an imported const — the sibling `page.tsx` rule).
Unknown id → `notFound()`. **URL-only entry** (open Q1): any picker/Today link is kid-visible, violating "no
kid-facing edit affordance"; the gate is UX-not-security so discoverability isn't a security concern, and the
Clerk-era parent nav will place it properly. No sibling-routines load (copy-from-kid is cut — see Out of scope).

**E2 — `<RoutineEditor>` (client) — a checklist + ▲▼ reorder.** Local state = the ordered list of in-routine
**`RoutineItem`s** (`{ key, conditional? }`, seeded from `profile.routine.order` — already resolved by the DAL,
NOT re-resolved client-side). **Preserves `conditional`** through every transform (C3 — Scarlett's `strength`
carries it; dropping it silently defeats the V1-10 down-payment). Renders: a **caption** "Weigh-in always comes
first" (NOT a locked row — a non-interactive row is markup + an a11y mis-tap trap, and it must never emit an
`order` input; C-note + simplicity #3); then each in-routine item as a row with **remove** + **▲▼ nudge**;
then an **"Add"** list = `routineCatalogItems()` minus the present keys (checkbox → append). A single **Save**
serializes to a hidden JSON input and submits (open Q3 — auto-save deferred). **Save is disabled at 0 items**
(C1 — an empty routine is not authorable; `resolveRoutine` maps an empty `order` back to the full default on
read, so "save nothing" would silently render everything). ≥44px targets; ▲▼ not drag (RSC-friendly, keyboard).
Reuse `Button`, `INITIAL_ACTION_STATE`/`ActionState` from `./action-state`, `INPUT_CLASS`, and the
`checkin-form` "reset via state-during-render" idiom — no new envelope type/primitive (DRY #8).

**E3 — `editRoutineAction` (Server Action) — public POST, so re-validate; complex payload = ONE hidden JSON
input (the `strength-form` idiom).** Guard `typeof raw === 'string'`, `try/catch` the `JSON.parse` → typed
envelope (never throw to `error.tsx`), then hand the parsed value to **`validateRoutineForWrite`** (E-shared).
Re-resolve the profile via `getProfileByPublicId` (reuses the UUID guard + existence check — C7), call the DAL,
`revalidatePath(/p/${id})` + the editor path, typed `ActionState`. Reuse `INITIAL_ACTION_STATE`. `null` from
the DAL → typed error. `withServerActionInstrumentation` like its siblings.

**E-shared — `validateRoutineForWrite(raw, orderedCatalogKeys): RoutineConfig | null` in
`packages/shared/src/routine.ts` — the STRICT write validator, single-sourcing the rule via `resolveRoutine`
(C1 + C2 + DRY #1).** Not a speculative helper (simplicity #4) — C1/C2 make it load-bearing, and it wraps the
existing authority rather than forking a parallel membership loop: (1) `routineConfigSchema.safeParse` (strict
grammar, rejects unknown fields); (2) **reject an empty `order`** (C1); (3) `const resolved =
resolveRoutine(parsed, catalog)` — the sole grammar+membership+dedupe authority; (4) **clean iff resolving
changed NOTHING** (same length + same `key`+`conditional` at each index) — any drop (non-catalog key, dupe)
means the body wasn't clean → `null` (rejects, where the read path forgivingly drops; C2). Returns the
validated config or `null`. A colocated test covers empty/dupe/non-catalog/`conditional`-preservation.

**E4 — DAL-local `updateProfileRoutine(profilePublicId, config)` in `profiles.ts` (open Q4 — DAL-local, firmly).**
`UPDATE profiles SET routine_config = $config WHERE public_id = $id AND deleted_at IS NULL` `.returning({ id })`;
empty result → `null` (no live row → typed error, the `editStrengthSet` idiom). **DAL-local, NOT `packages/db`:**
the `packages/db` writers exist to single-source _IDOR-load-bearing SQL_ (`updateStrengthSetById`'s ownership
join, proven by `db:verify`); this write has none — it's a one-column update like the DAL-local `logBodyweight`
/`logCheckinEntries`. Promoting it would deviate from THAT precedent for zero drift-benefit. `db:verify` still
gets an inline JSONB round-trip assertion (it already operates on `db`/`schema`) — proof without the package move.

**E5 — `routineCatalogItems()` in `lib/routine/catalog.ts` — the labelled catalog, built FROM existing pieces
(DRY #2/#3).** `ROUTINE_CATALOG.map` → `parseRoutineKey(key)` → dispatch: `checkin:` → `CHECKIN_FIELD_BY_KEY`,
`life:` → `LIFE_ACTIVITY_BY_KEY` (the already-hoisted maps), `strength` → **`STRENGTH_LABEL`** (a new hoisted
const in `catalog.ts`; `entry-label.ts:77`'s inline `'Strength'` refactors to import it — kills the 2nd-occurrence
drift the constants rule targets). Order comes free from `ROUTINE_CATALOG` (single-sourced, anti-drift).

**E-const — `ROUTINE_VERSION = 1` in `packages/shared/src/routine.ts`.** `routineConfigSchema`,
`buildDefaultRoutine`, `resolveRoutine`, and the editor's keys→config serialization all source the version from
it (DRY #4 — the version literal must not drift across files at the next shape bump).

**E6 — Auth: the access-gate stopgap, UX-not-security (accepted, documented debt).** Clerk is v1.5; tiles are
"a UX switch, not a security boundary" → ANY gate-holder can edit ANY kid's routine — acceptable for a trusted
single-household tool pre-Clerk. `tech-debt.md` gets the auth-gap entry (closes when Clerk lands with real
per-household authz in the DAL), plus **C4** (authoring a null-config kid materializes the current default →
opts that kid OUT of future catalog growth) and **C6** (last-write-wins: a stale second tab clobbers the first;
no race with logging — that writes `entries`, a different table) as named accepted limitations for PR 2.

**E7 — Tests + screenshots.** Pure transforms (`toggle`, `moveUp`/`moveDown` — `conditional`-preserving) →
`lib/routine/editor.ts` + colocated test (the `strength-form-supersets` idiom; no existing reorder util to
reuse — DRY #7). `validateRoutineForWrite` test (E-shared). Action boundary (AGENTS.md mandatory): non-string/
malformed JSON → reject; empty order → reject; dupe/non-catalog key → reject; unknown profile → typed error;
valid → persists + revalidates. Tri-viewport screenshots of the editor (empty, populated, reordered).

## File-by-file

| Path                                                              | Change                                                                                                  |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/routine.ts`                                  | `ROUTINE_VERSION` const; `validateRoutineForWrite` (E-shared) + reuse the const in the schema/builders. |
| `apps/web/lib/routine/catalog.ts`                                 | `routineCatalogItems()` + hoisted `STRENGTH_LABEL` (E5).                                                |
| `apps/web/lib/entries/entry-label.ts`                             | import `STRENGTH_LABEL` (drop the inline `'Strength'`).                                                 |
| `apps/web/lib/routine/editor.ts` **(new)**                        | Pure `toggle`/`moveUp`/`moveDown` transforms (conditional-preserving) + test.                           |
| `apps/web/app/p/[profileId]/routine/page.tsx` **(new)**           | The editor route (RSC, E1).                                                                             |
| `apps/web/app/p/[profileId]/routine/routine-editor.tsx` **(new)** | `<RoutineEditor>` client (E2).                                                                          |
| `apps/web/app/p/[profileId]/actions.ts`                           | `editRoutineAction` (E3).                                                                               |
| `apps/web/lib/dal/profiles.ts`                                    | DAL-local `updateProfileRoutine` (E4).                                                                  |
| `packages/db/scripts/verify.ts`                                   | inline JSONB round-trip assertion for the routine write (E4).                                           |
| `docs/tech-debt.md`                                               | auth-gap + C4 (default-freeze) + C6 (LWW clobber).                                                      |
| docs/plan.md, docs/status.md                                      | PR 2 in-flight; PR 3 folded (see below).                                                                |

## Out of scope (→ later)

- **Copy-from-kid → a later slice (PR 2.5)** (simplicity #1): it drags in a sibling-routines read (`listProfiles`
  deliberately carries no routine), a picker control, and clone semantics — none needed for PR 2's job (make ONE
  kid settable via UI); the A≠B success test is already met by the seed. Deferring it also moots C5.
- **PR 3 (per-kid check-in allowlist) is FOLDED IN / dropped as a separate PR** (open Q2, simplicity #2):
  unchecking a `checkin:*` key removes it from `order` → `resolveRoutine` keeps only present keys →
  `buildRoutineBlocks` never emits it. That IS the allowlist — no separate field needed.
- Drag-reorder, auto-save, real per-household authz (Clerk v1.5), day-conditional strength (V1-10).

---

## Adversarial panel review log

_(4 lenses — correctness · simplicity/scope · architecture/consistency · code-reuse/DRY. No DB-safety lens (no
migration). Every finding reconciled; the decisions above already fold in the outcomes.)_

**Correctness.** C1 (HIGH, empty routine → silent revert to default) → editor disables Save at 0 + `validateRoutineForWrite`
rejects empty. C2 (HIGH, dupes slip past the "strict" write) → `validateRoutineForWrite` rejects any body
`resolveRoutine` would alter. C3 (MEDIUM, `conditional` stripped) → local state holds full `RoutineItem`s,
transforms preserve it, round-trip test. C4 (MEDIUM, null-config Save freezes out catalog growth) →
**documented** accepted behavior (authoring = opt-out of default-tracking). C5 (copy clones a resolved default)
→ **moot** (copy-from-kid cut). C6 (no LWW on blind overwrite; no logging race — different table) →
**documented** accepted limitation. C7 (non-UUID id → 500) → action re-resolves via `getProfileByPublicId`
first; DAL uses `.returning()`. Verified-sound: bodyweight cannot leak into `order`; `finisher:*`/unknown
namespaces consistently rejected; `revalidatePath` targets; `.strict()` write vs forgiving read asymmetry is
intentional.

**Simplicity/scope.** #1 cut copy-from-kid → deferred. #2 fold PR 3 → done. #3 caption not a locked row → done.
#4 "drop the speculative validate helper" → **partially overridden**: C1/C2 make it load-bearing, but it's
implemented by REUSING `resolveRoutine` (not a parallel loop), satisfying the DRY intent behind the objection.
#5 keep `editor.ts` minimal, no `copy` transform → done (copy cut). #6 keep the `/routine` route → done. Open
Qs answered: URL-only entry / fold PR3 / single Save / DAL-local.

**Architecture/consistency.** Q4 DAL-local (firmly, per the `logBodyweight` vs `writeStrengthSession` two-tier
precedent — this write has no IDOR join) → adopted (this OVERRIDES simplicity's "wrap a `packages/db` writer"
lean; the promotion criterion is IDOR-load-bearing SQL, absent here). #2 complex payload = single hidden JSON
input (strength-form idiom) + parse guards → adopted. #3 dedicated sibling read not widening `listProfiles` →
**moot** (copy cut). #4 `runtime='nodejs'` inline literal → noted. #5 hoist `STRENGTH_LABEL` (2nd-occurrence
rule) → adopted. #6 pure-transform + `'use server'` placement consistent → confirmed.

**Code-reuse/DRY.** #1 (headline) write validation reuses `resolveRoutine` via `validateRoutineForWrite` →
adopted. #2 `routineCatalogItems` from `parseRoutineKey` + the hoisted maps + `ROUTINE_CATALOG` → adopted. #3
`STRENGTH_LABEL` single-source → adopted. #4 source the `version` literal (`ROUTINE_VERSION`) → adopted. #5/#6
copy/sibling reuse → **moot** (copy cut). #7 `editor.ts` transforms genuinely new (no reorder util exists) →
confirmed. #8 reuse `Button`/`INITIAL_ACTION_STATE`/`INPUT_CLASS`/checkin-form idiom, no new envelope → adopted.
