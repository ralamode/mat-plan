# V1-18 PR 1b — render Today from the routine config — plan & panel log

> The **render half** of V1-18 slice 1. Consumes PR 1a's `profiles.routine_config` (merged, #63): the Today
> page renders the per-kid routine in order, reusing the existing forms. Grounding:
> [ux-decision](./v1-18-ux-decision.md) · [eng-plan](./v1-18-eng-plan.md) · [PR 1a](./v1-18-1a-routine-config.md).
> Base: `main` (V1-17 #62 + V1-18 PR 1a #63 in). **No migration.** Significant UI PR → committed plan +
> 4-lens panel (no DB-safety lens — no migration) before code.

## Goal

Replace the four hard-coded `<section>`s on Today with a **per-kid ordered render** driven by
`profile.routine.order`, reusing `BodyweightForm`/`StrengthForm`/`CheckinForm`/`LifeForm` **untouched**
(save one additive `LifeForm` prop). `null → DEFAULT_ROUTINE` reproduces today's exact page (a visual
no-op — ships dark proven by screenshots). **No new status layer** — each form brings its own logged/tally
state.

## Design decisions

**R1 — App-side routine catalog (the single ordered source).** New `apps/web/lib/routine/catalog.ts`:
`ROUTINE_CATALOG` = `[STRENGTH_KEY, ...CHECKIN_FIELDS.map(f => \`checkin:${f.key}\`), ...LIFE_ACTIVITY_KEYS.map(k
=> \`life:${k}\`)]`— the ordered list that IS both the default routine order (via`buildDefaultRoutine`) and
`resolveRoutine`'s membership set. Derived from the live catalogs → can't drift (the code-reuse fix from PR 1a).
Bodyweight is NOT in it (weigh-in pinned separately).

**R2 — DAL resolves the routine (the reader deferred from PR 1a).** Extend `getProfileByPublicId`: add
`routineConfig` to the `.select`, resolve via `resolveRoutine(raw, ROUTINE_CATALOG)`, widen `ProfileDTO` with
`routine: RoutineConfig` (**always resolved — never null/raw**). One read, no second query. `listProfiles`
untouched. (Fixes the deferred N2: update the `actions.test.ts` ProfileDTO mock to carry `routine`.)

**R3 — Render dispatch via a pure `buildRoutineBlocks(order)` helper (contiguous-run collapse).** New pure
`apps/web/lib/routine/render.ts`: walk `order`, collapsing a **contiguous run of `checkin:*` keys into ONE
block** (and `life:*` likewise), so `CheckinForm` is called EXACTLY as today with a `fields` subset — the
batch submit + single hydration island survive; `DEFAULT_ROUTINE` (check-ins contiguous) = today's one
`CheckinForm`. Output blocks: `{ kind:'strength' } | { kind:'checkins', keys } | { kind:'life', keys }`
(`finisher:*` → dropped, not emitted in slice 1). Pure + unit-tested (a contiguous run → one block; a split →
two blocks; interleave preserved). Dispatch on `parseRoutineKey(key).namespace`.

**R4 — `page.tsx`: pinned weigh-in + `blocks.map`.** Replace ONLY the 4-section `<div>` (the
`log-bw/str/checkins/life` sections): render `BodyweightForm` **unconditionally first** (weigh-in pinned by
construction — `bodyweight` isn't a legal `order` key), then `buildRoutineBlocks(profile.routine.order).map`
→ `strength`→`<StrengthForm>` · `checkins`→`<CheckinForm fields={fieldsFor(keys)} loggedFieldKeys={…}>` (an
empty resolved `fields` renders nothing — mirrors the current `CHECKIN_FIELDS.length>0` guard) ·
`life`→`<LifeForm activityKeys={keys} loggedLifeKeys={…}>`. As a semantic **`<ol>`** of compact muted `<h2>`
rows (the `text-sm font-medium text-muted-foreground` legend style), NOT the four `text-lg` billboards, so a
7-item routine stays scannable; one `<h1>` preserved, no skipped heading level. **No new `'use client'`.**

**R5 — The one form-touch: `LifeForm` gains an additive `activityKeys?` filter.** `LifeForm` maps
`LIFE_ACTIVITIES` internally with no subset; add an optional `activityKeys?: readonly string[]` prop → when
present, render only those life activities (default = all, so existing callers/DEFAULT are unchanged).
Additive, not a refactor.

**R6 — State composition is unchanged.** The entry-derived `loggedFieldKeys`/`loggedLifeKeys`/`calisTotals`/
`todayRows` (order-independent Sets/sums) compute once as today; the "Calisthenics today" tally +
logged-entries list + adherence render **below** the routine, byte-stable. Each form owns self-contained
per-instance state, so reorder/split just mints independent trees (disjoint idempotency keys). No status layer.

**R7 — Tests + screenshots.** Unit: `buildRoutineBlocks` (contiguous collapse, split, interleave, finisher
dropped, empty); `ROUTINE_CATALOG` derivation (matches the live catalog). Update `actions.test.ts` ProfileDTO
mock (`routine`). **Tri-viewport Playwright screenshots** (visible layout change) — including a seeded kid
(Scarlett, an explicit routine) so the reorder is visible; assert `DEFAULT_ROUTINE` == today's order (ships-dark
no-op) in the block test. One minimal ordering smoke.

## File-by-file

| Path                                            | Change                                                                                   |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `apps/web/lib/routine/catalog.ts` **(new)**     | `ROUTINE_CATALOG` derived from `CHECKIN_FIELDS` + `LIFE_ACTIVITY_KEYS` + `STRENGTH_KEY`. |
| `apps/web/lib/routine/render.ts` **(new)**      | `buildRoutineBlocks(order)` — contiguous-run collapse (R3).                              |
| `apps/web/lib/routine/render.test.ts` **(new)** | R7 unit cases.                                                                           |
| `apps/web/lib/dal/profiles.ts`                  | Resolve + `ProfileDTO.routine` (R2).                                                     |
| `apps/web/app/p/[profileId]/page.tsx`           | The `blocks.map` reshape (R4) — replace only the 4-section region.                       |
| `apps/web/app/p/[profileId]/life-form.tsx`      | Additive `activityKeys?` prop (R5).                                                      |
| `apps/web/app/p/[profileId]/actions.test.ts`    | ProfileDTO mock carries `routine`.                                                       |
| docs/plan.md, docs/status.md                    | V1-18 PR 1b in-flight → the render shipped.                                              |

## Out of scope (→ later)

Coach config UI (PR 2), per-kid check-in allowlist (PR 3), day-conditional strength / rest-day (V1-10),
net-new finisher types (V1-10 catalog), drag-reorder, kid-edit. `finisher:*` keys validate but render nothing.

---

## Adversarial panel review log

_(4 lenses — correctness · simplicity/scope · architecture/consistency+code-reuse. No DB-safety (no
migration). Reconciled below.)_

**Key correction the panel surfaced:** the SEEDED Scarlett routine
(`[checkin:rice_bucket, strength, checkin:brush_teeth:stance, life:wake]`, merged in PR 1a) already produces
BOTH a scattered check-in **split** (→ two `CheckinForm` blocks) AND a life **subset** — so simplicity's
"those shapes are unreachable in slice 1, cut them" is wrong: both are reachable and must work. Correctness
verified the split is SAFE (disjoint clientIds per form; `logCheckinsAction` skips fields absent from a
form's FormData; whole `loggedFieldKeys` is fine since inertness keys on each form's own `fields`; the
`accumulates` tally is entry-derived + order-independent). So the full collapse + the `LifeForm` subset stay.

### Dispositions

**BLOCKING — accepted:**

- **[correctness B1] Don't widen the shared `ProfileDTO`.** A required `routine` would break `listProfiles`
  (returns `{id,name,kind,avatar}`) and `profile-tile.test.tsx` (a `ProfileDTO` literal). Fix: give
  **`getProfileByPublicId` its own return type** `ProfileDTO & { routine: RoutineConfig }` — the picker tiles
  don't carry the routine. (The plan's `actions.test.ts` mock is untyped → not a break; nothing to change there.)
- **[arch B1] One `makeRoutineKey(namespace, tail)` builder in `packages/shared/src/routine.ts`**, symmetric with
  `parseRoutineKey`, so the `checkin:`/`life:` prefix + separator are defined ONCE (build == parse). Named
  namespace consts off `ROUTINE_NAMESPACES`. `ROUTINE_CATALOG`, the render dispatch, and the tests all use it.

**SHOULD-FIX — accepted:**

- **[simplicity S1 + arch S5 + correctness S1] Drop the `<ol>`/muted-`<h2>` restyle — render into the EXISTING
  `<section aria-labelledby>` + `text-lg <h2>` markup.** DEFAULT then truly ships dark (byte-stable order AND
  style); the only visible diff is a seeded kid's reorder. The per-block heading labels ("Log strength" /
  "Check-ins" / "Life") live in one `as const` map (arch N9), not scattered JSX. Heading restyle = a later
  cosmetic PR if wanted.
- **[correctness S2] Block `keys` = `parseRoutineKey(key).catalogKey` (the bare tail).** `fieldsFor` matches
  `CheckinField.key`, `LifeForm activityKeys` matches `LIFE_ACTIVITIES[].key` — a raw namespaced key would match
  nothing → empty forms. Strip via `parseRoutineKey`, never `slice(8)` (breaks two-colon keys).
- **[correctness S3] Guard `fieldsFor(keys).length > 0`** at the check-in block render (an empty `CheckinForm`
  renders a stray form + button, not nothing — mirror the current `CHECKIN_FIELDS.length>0` guard). Unreachable
  via the real path but the stated guard must be correct.
- **[arch S2/S4] Reuse, don't parallel:** `ROUTINE_CATALOG` replaces the inline `realCatalog` in the existing
  `lib/routine.test.ts`; `fieldsFor` filters `CHECKIN_FIELDS` (the one registry) preserving routine order (so
  DEFAULT's group-by-`groupLabel` render is identical to today's `fields={CHECKIN_FIELDS}`).
- **[simplicity N4 + arch S3] One `lib/routine/` module + reconcile the existing test home.** `lib/routine/catalog.ts`
  (`ROUTINE_CATALOG` + the render builder) — MOVE `lib/routine.test.ts` into `lib/routine/` and split its
  shared-contract vs app-render concerns (don't leave both `lib/routine.test.ts` and `lib/routine/`).

**Adopted trims / notes:**

- **[simplicity S3 + correctness N1] No `finisher:*` arm** — `resolveRoutine` strips it (not in `ROUTINE_CATALOG`),
  so it can't reach `buildRoutineBlocks`; the builder just skips unknown namespaces (defensive default), no
  dedicated arm/test needed.
- **[simplicity N5] Trim the test matrix but KEEP the split** (reachable via Scarlett): DEFAULT-contiguous → ONE
  check-in block (the ships-dark assertion) · Scarlett scatter → TWO check-in blocks · empty · the
  `ROUTINE_CATALOG`-derivation anti-drift test.
- **[correctness N2] Scarlett's scatter → two "Log check-ins" buttons** — the honest consequence of scattering
  check-ins (per the eng-plan); confirm it in the tri-viewport screenshots.
- **[arch N7] `catalog.ts` stays pure** (no `server-only`/React) so the `server-only` DAL importing it drags no
  client boundary — the transitive `checkin-fields`/`life-activities` are already pure.

### Net PR 1b

`makeRoutineKey` (shared) → `lib/routine/catalog.ts` (`ROUTINE_CATALOG` + `buildRoutineBlocks`, keys = bare
tails, skips unknown namespaces) → `getProfileByPublicId` returns `… & { routine }` (resolve; `listProfiles`
untouched) → `page.tsx` maps blocks into the EXISTING section markup (labels from an `as const` map;
`fieldsFor` over `CHECKIN_FIELDS`; empty-run guard) → `LifeForm` gains an additive `activityKeys?` → tests
(moved/split; DEFAULT==today, scatter, empty, catalog-derivation) → tri-viewport screenshots (Liam DEFAULT =
today; Scarlett reordered + two check-in blocks).
