# V1-10 PR 2 — "Today's program" reference card (weekday → day-role → the kid's prescribed movements)

> The payoff of the programming data. On a strength day, a **read-only reference card** sits above the
> **unchanged** strength form, showing that day's programmed movements + each kid's **suggested load**
> (from `prescription_target`, VERBATIM); the coach reads it and types what was actually performed into the
> still-empty, still-required form. Reads the block seeded in PR 1b (#67). Base: `main`. **Pure app code —
> no migration.** Significant PR → committed plan + adversarial panel before code.
>
> **NOTE — the design below (§Design decisions) is the PRE-PANEL draft: an editable, greyed PREFILL.** The
> adversarial panel unanimously rejected it and reframed the slice into the reference card; see
> §"Adversarial panel review log" for the reasoning and §"What shipped" for the final file list. The draft
> is kept because the panel log argues against it point-by-point.

## Assumption (Ray reaffirmed "do slice 2" after option #1)

**Auto-by-weekday + manual override.** Today's weekday → a `day_role` (Ray's split: Mon→`strength_a`,
Wed→`strength_b`, Fri→`strength_c`; other days → no strength prescription), with a selector to override. The
weekday→day-role SCHEDULE has to live somewhere — see open Q1 (an app-config stopgap vs a DB schedule).

## Design decisions

**E1 — DAL read `getProgramDay(profilePublicId, dayRole)` (server-only).** Resolves the whole graph internally
(profile → household → the household's program block → that `day_role`'s prescriptions in `idx` order → the
movement + THIS profile's `prescription_target`), returning a DTO array:
`{ movementName, sets, targetReps, load, reps }[]` (per-kid `reps` falls back to the prescription's
`target_reps`; `load` is the kid's suggested load or null). Never leaks internal ids. Returns `[]` when the kid
has no block / no prescriptions for that day_role (→ the form stays empty, today's behavior).

**E2 — Resolve the day_role in the Today RSC.** `page.tsx` computes `weekdayDayRole` from the active-tz local
date (reusing the V1-6c `localDayIso`/tz plumbing) via the weekday→day-role map (E-config), overridable by a
`?strengthDay=<day_role>` search param (validated against `DAY_ROLES`). Fetch `getProgramDay(profile.id,
dayRole)` alongside the existing reads and pass the result to `<StrengthForm>`. Only relevant when the strength
block is in the kid's routine (the existing `buildRoutineBlocks` gate) — no extra gating.

**E-config — the weekday→day-role schedule (open Q1).** MVP: an app-config `const DAY_ROLE_BY_WEEKDAY`
(single-household stopgap, documented like the access-gate — Mon/Wed/Fri → strength_a/b/c, else none),
promotable to a per-block DB schedule when multi-household/Clerk lands. NO migration. The panel weighs
config-stopgap vs a small `block_schedule` table.

**E3 — `<StrengthForm>` accepts an optional `prefill` prop.** When present, initialize `movements` from it
instead of `[emptyMovement()]`: one movement card per prescription (movementName filled), `sets` count of set
rows, each set's **weight pre-filled from the kid's suggested load, rendered as a GREYED suggestion** (a hint/
muted style + a "suggested" affordance), and reps pre-filled where `targetReps`/`reps` is a clean number (else
left blank with the text shown as a hint — see open Q3 for the "8-12"/"AMRAP" friction). The coach edits/
confirms; **submit logs only the coach's confirmed values** (the existing action + validation are unchanged, so
a blank/edited field is the logged truth — the suggestion is never silently submitted). The existing gen-remount
reset-on-success still applies; after a successful log the form clears (a fresh empty form, not re-prefilled —
the day is logged).

**E4 — Day-role override selector.** A small `<select>`/links above the strength form listing the block's
available day_roles (labelled via `DAY_ROLE_TO_SESSION_TYPE` + the split names), defaulting to the weekday's,
setting `?strengthDay=…` (RSC re-render — no client fetch). Lets the coach pick a different day (e.g. lifting
Strength B on a Tuesday). Deferrable if the panel deems it scope creep (the coach can edit the form).

**E5 — Injury-safety (the one inviolable rule).** The prefilled loads are **Ray-authored** (from
`prescription_target`, seeded from his doc), NOT model-authored — so prefilling them is compliant. The greyed
styling + coach-confirm-before-submit means the LOGGED load is always the coach's deliberate value, never an
auto-submitted suggestion. The plan/PR make this explicit; the panel's correctness lens should stress-test it.

**E6 — Tests + screenshots.** Unit: the weekday→day-role resolution + the prefill→movements transform (pure,
extracted). Integration: `getProgramDay` returns the right per-kid graph (or reuse `db:verify` for the read).
Action boundary unchanged (the log action is untouched). Tri-viewport screenshots: a strength day prefilled
(Athlete Two vs Athlete One differ), a non-strength day (empty), the override selector.

## Out of scope (→ later)

Conditioning-day prefill (needs the conditioning model), the progression engine / adaptive suggestions
(`progression_state`), RIR-cue display (backlogged — no field yet), a real per-block weekday schedule if the
panel keeps the config stopgap, multi-block "active block" selection (MVP = the household's one block).

## Open questions for the panel

1. **Weekday→day-role schedule: app-config stopgap vs a DB `block_schedule`?** Config = no migration, single-
   household hardcode (documented). DB = clean/per-block but a migration (breaks "no-migration slice 2"). Which
   for MVP?
2. **Block selection** when a household has >1 block — MVP is "the one block"; is a query that assumes ≤1 block
   safe, or does it need an explicit "active block"?
3. **`target_reps` text → numeric reps field.** "5" prefills cleanly; "8-12"/"AMRAP"/"5, last AMRAP" don't fit a
   number input. Prefill the parsed low number? Leave reps blank + show the text as a hint? Show the whole
   prescription as a read-only reference card and only prefill the load? Pick the least-lossy, most-honest UX.
4. **Override via `?strengthDay` search param (RSC) vs a client re-fetch** — and is the override in-scope for MVP?
5. **Does prefill fight the existing StrengthForm state model** (gen-remount reset, per-card independent sets)?
   Confirm the prefill seeds initial state cleanly without breaking the reset-on-success or superset logic.

---

## Adversarial panel review log — reconciled (UNANIMOUS: reference card, not form prefill)

_(4 lenses — correctness/injury-safety · simplicity/scope · architecture/consistency · code-reuse/DRY.)_

**THE REFRAME (all 4 lenses).** Replace E3/E5's "prefill the editable weight/reps fields (greyed)" with a
**read-only "Today's program" reference card** above the UNCHANGED, empty strength form. Reasons: (1) ~90% of
the seeded loads are non-numeric text ("BW"/"band"/"~75-85"/"15/DB") that a `type="number"` field renders blank
and the numeric log schema (`z.coerce.number()`; no rawLoad on the write path) cannot store — prefill works for
only 2 of 21 movements; (2) prefilling the `required` weight field destroys the built-in confirm-gate (a
planned load logs as "performed" without an affirmative human entry — a data-integrity + injury-safety hole);
(3) `target_reps` text ("8-12"/"40 yd"/"30-40 s"/"AMRAP") can't be parsed to the numeric reps field without
mis-logging. The reference card shows movement · sets×`target_reps` · this kid's `load` **verbatim**; the coach
reads it and types the actual performed values into the empty (still-`required`) form. This simultaneously makes
injury-safety trivially real, displays the text loads at all, and keeps "logged = performed" clean. **NOTE: an
editable-prefill design is only possible after a separate change letting the log store TEXT loads (rawLoad /
weightLabel) — its own slice, not this one.**

**Cuts (moot under the reference card):** the StrengthForm `prefill` prop + the prefill→movements transform +
reps/load parsing + the gen-remount re-prefill gate (correctness F7 / DRY #1-2) + the greyed `SetRepsWeightFields`
variant. Slice shrinks ~50%; the strength form is untouched.

**Kept structural decisions (apply to the reference card too):**

- **`getProgramDay` splits** (arch A1, DRY #3): query core in `packages/db/src/queries/program-day.ts` (typed
  over `NodePgDatabase<schema>`, `db:verify`-provable — the `weekly-adherence` precedent), thin `server-only`
  `getProgramDay(profilePublicId, dayRole)` wrapper in `apps/web/lib/dal/programming.ts` (DTO map). Resolve
  household INSIDE the query via the `profiles.public_id → household_id → program_blocks` join (arch A2 — do
  NOT expose `householdId` on `ProfileDTO`). `uuidSchema.safeParse` guard on the arg (DRY #3). **Deterministic
  single block** `ORDER BY program_blocks.id DESC LIMIT 1` (correctness F4 — >1 block must not fan out); **LEFT
  join** `prescription_target` scoped to `(prescription_id, this profile)` so a kid with no target → `load =
null`, never the other kid's load; a null-household profile → `[]` (correctness F4). Text-only verbatim DTO
  `{ movementName, sets, targetReps, load }[]` in `idx` order.
- **Weekday → day_role** (arch B1/D1, DRY #4/#7): a new `localWeekday(day): number` export in `lib/date.ts`
  (the `T00:00:00Z`+`getUTCDay()` idiom — NEVER `new Date(day).getDay()`, the V1-6c off-by-one; correctness F6),
  consumed by `DAY_ROLE_BY_WEEKDAY: Record<number, DayRole | null>` (typed against the enum, Mon/Wed/Fri →
  strength_a/b/c) in `apps/web/lib/programming/day-role-schedule.ts` (app policy, not shared) + a pure
  `resolveDayRole(day)` (unit-tested). **tech-debt.md** entry: single-household weekday stopgap, promotion
  trigger = Clerk/multi-household → a per-block DB schedule (arch B2).
- **`DAY_ROLE_LABELS`** in `packages/shared/src/programming.ts` beside `DAY_ROLE_TO_SESSION_TYPE` (arch D2, DRY
  #6): derived from `SESSION_TYPE_LABELS[DAY_ROLE_TO_SESSION_TYPE[r]]` + a " A/B/C" suffix (no re-typed
  "Strength A"), for the card header. `SESSION_TYPE_LABELS` alone collapses A/B/C → "Strength".
- **RSC**: compute `dayRole` (from the already-computed active-tz `day` → `localWeekday` → the map) BEFORE the
  `Promise.all`, add `getProgramDay(profile.id, dayRole)` to it, render `<ProgramReference>` (an RSC, read-only
  — no client JS) inside the existing `buildRoutineBlocks` strength-block gate (arch C2).

**Deferred (simplicity #3, correctness F5 moot):** the day-role override selector + `?strengthDay` search param.
Auto-by-weekday alone hits the acceptance criterion; if the override lands later it must validate against the
STRENGTH subset only (`DAY_ROLE_TO_SESSION_TYPE[x] === 'strength'`), not all `DAY_ROLES` (else conditioning
could be forced into a strength session). **Config const, not a DB `block_schedule`** (simplicity #4, arch B2).

**Reference-card content note:** carry the RIR/AMRAP/failure guidance that lives in `target_reps`/`load` text
verbatim onto the card (it's the coach's safety cue) — the reason `target_reps` was kept lossless text.

---

## What shipped

Pure app code — **no migration**. The strength form is byte-untouched.

| File                                                      | Change                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/queries/program-day.ts`                  | **new** — `programDayRows(db, {profilePublicId, dayRole})`, the single-sourced query. Resolves profile → household → newest live block internally (BOLA; no caller ever names a household), LEFT-joins `prescription_targets` scoped **in the `ON`** to this profile, orders by the coach's `idx`. |
| `packages/db/src/index.ts`                                | export the query (the `weeklyAdherenceRows` precedent).                                                                                                                                                                                                                                            |
| `apps/web/lib/dal/programming.ts`                         | **new** — `server-only` `getProgramDay` wrapper: `uuidSchema` guard, run the shared query, map rows → `ProgramDayDTO` (per-kid `reps ?? targetReps`). Never returns a raw row or an internal id.                                                                                                   |
| `apps/web/lib/date.ts`                                    | **new** `localWeekday(day)` — the `…T00:00:00Z` + `getUTCDay()` idiom, so a bare local date's weekday can't shift west of UTC (the V1-6c off-by-one class).                                                                                                                                        |
| `apps/web/lib/programming/day-role-schedule.ts`           | **new** — `DAY_ROLE_BY_WEEKDAY` (Mon/Wed/Fri → A/B/C) + pure `resolveDayRole(day)`. App policy, NOT `packages/shared`; logged in `docs/tech-debt.md` with Clerk/multi-household as the promotion trigger.                                                                                          |
| `packages/shared/src/programming.ts`                      | `DAY_ROLE_LABELS`, **derived** from `SESSION_TYPE_LABELS` (which alone collapses A/B/C → "Strength"), so no component re-types a label.                                                                                                                                                            |
| `apps/web/app/p/[profileId]/program-reference.tsx`        | **new** RSC (zero client JS) — the card. Verbatim `sets × target_reps · load suggested`, plus a "Reference only — log what you actually did below" caption.                                                                                                                                        |
| `apps/web/app/p/[profileId]/page.tsx`                     | resolve `dayRole` from the already-computed active-tz `day`, add `getProgramDay` to the existing `Promise.all` (skipped entirely on a non-strength day), render the card inside the **existing** `buildRoutineBlocks` strength gate.                                                               |
| `apps/web/scripts/capture.ts` + `screenshot-ephemeral.ts` | `--tz <IANA>` — emulate the browser zone so a weekday-conditional screen can be captured on any host day (the app derives "today" from the device zone, V1-6c).                                                                                                                                    |

### Post-implementation code review (4 lenses)

A second adversarial pass ran against the implemented diff (correctness/data-integrity · architecture ·
simplicity · code-reuse). No CRITICAL findings — the injury-safety property was independently
re-verified (`strength-form.tsx` / `actions.ts` / the entry schemas are byte-unchanged vs `main`; the card
renders as a sibling BEFORE `<StrengthForm>`, outside its `<form>`, emitting only text). Applied:

- **Day-aware block selection (correctness, real bug).** `ORDER BY id DESC LIMIT 1` picked the newest block
  _regardless of whether it programs the requested day_. Seeding next mesocycle under a new slug — the shape
  PR 1b established, and what `uq_program_blocks_household_slug` encourages — would have silently blanked
  Monday's card with no error and no fallback. The candidate set is now restricted to blocks holding a live
  prescription for that `day_role`, so "newest wins" degrades to "the newest block that can answer this".
- **The BOLA assertion didn't prove ownership.** It passed even with household scoping deleted (the
  globally-newest block happened to lack `strength_a` — it was proving fixture ordering). Now probed in
  **both** directions across two households programming disjoint day roles.
- **Zero soft-delete coverage** on the four `deleted_at` filters. Added; the sharpest is
  `prescription_targets`, whose unique index is partial, so a future soft-delete-then-reinsert load edit
  legally leaves two rows — an unfiltered join would render the movement twice with one stale load.
- All three new probes were **mutation-tested**: each fails when its filter is removed.
- `movements.deleted_at` was unfiltered (every other table checked it).
- `DAY_ROLE_LABELS` was `Object.fromEntries(...) as Record<DayRole, string>` — the cast asserted away the
  compile-time exhaustiveness its own comment claimed, and derived the label by string-surgery on the role
  name (a future `conditioning_a` would collide). Now an annotated literal spreading `SESSION_TYPE_LABELS`.
- `4 × 3` collided with the page's established `reps × weight` grammar for a _logged_ set — same glyph, same
  muted style, same screen. Now `4 sets × 3`.
- The row→DTO map and the prescription formatter were unreachable by unit test (one `server-only`, one
  module-private in a `.tsx`). Extracted to a pure `lib/programming/program-day.ts` + tests.
- `<h2>` nested inside the "Log strength" `<section>` announced the card as a sibling of the section it
  belongs to → `<h3>`; the hardcoded DOM id is now derived from the day role; `key={i}` → `key={r.idx}`.
- `dayRole: string` widened a closed shared enum → `DayRole`.
- **`--tz` could silently capture the wrong weekday.** `timezoneId` only changes what the browser reports;
  the RSC reads the `tz` cookie, which `TimeZoneSync` writes only after hydration — a race against
  `networkidle` on the very artifact a reviewer approves from. The cookie is now seeded directly. `--tz` is
  also validated with the app's own `isIanaTimeZone`.
- A dangling `" · "` when both `sets` and `target_reps` are null (a legal movement-only prescription).
- CLS note (first-paint zone fallback can pop the card in) recorded in `docs/tech-debt.md`.

### Proofs

- **`db:verify`** (`packages/db/scripts/verify.ts`) runs the SHIPPED `programDayRows`: `idx` order over Ray's real Strength A; per-kid loads (Athlete One 60 / Athlete Two 65 on the same prescription) and the per-kid reps override; an unprogrammed `day_role` → 0 rows; **BOLA both directions** across two households programming disjoint day roles; a kid with **no target** still sees the movement with a NULL load (never the sibling's); an unknown profile → 0 rows; a household with **two** blocks resolves to one (no fan-out) **and falls back past a newer block that doesn't program that day**; and all four `deleted_at` filters (block / prescription / target / movement). The three ownership- and staleness-critical probes are mutation-tested — each fails when its filter is removed.
- **Unit:** `localWeekday` across the week + an explicit west-of-UTC regression; `resolveDayRole` for all 7 days + a schedule-validity test (only real, only _strength_, day roles); `DAY_ROLE_LABELS` derivation + A/B/C distinctness.
- **Screenshots** (tri-viewport): Athlete One's Strength C, Athlete Two's Strength C (loads visibly differ), and a rest day (no card, form unchanged).

### Deliberately not in this slice

The day-role override selector / `?strengthDay=` (panel-deferred), conditioning-day prescriptions (no model yet), an RIR/cue field, multi-block "active block" selection, and an editable prefill — which stays blocked until the log path can store TEXT loads (`rawLoad`), its own slice.
