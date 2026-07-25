# V1-7 — Life activities (timing / boolean): wake + wrestling practice, one-tap

> Backlog: [plan.md](../plan.md) row V1-7. Branch: `feat/v1-7-life-activities`.
> Concept: **the generality proof** — the generalized `entries` model + a new field source render two NEW
> input shapes (a point-in-time event; a one-tap duration) with **no migration and no new structure**,
> reusing the V1-5 write path.

## Goal

Make the two not-yet-rendered "life" activities loggable in one tap on `/p/[profileId]`: **wake** (a
`timing` event — "I woke up, now") and **wrestling_practice** (a one-tap "practice happened," carrying
`practice_minutes`). Both are already catalog rows (`packages/shared/src/catalog-activity-types.ts`), both
already round-trip in `db:verify`, and the DB columns they need (`event_at`, `value_num`,
`unit ∈ {timing, min}`) already exist. This PR is the **app layer only**: a third field source, a one-tap
UI section, a thin action, and a one-line DAL extension (`event_at`), all reusing the V1-5 seams. It proves
the model absorbs new shapes without touching `entries`.

## Scope decision (up front)

- **In scope — exactly two activities:** `wake` (inputShape `timing`) and `wrestling_practice` (inputShape
  `single_metric`, metric `practice_minutes`). The only two "life activities" from the plan row that are
  seeded but **unrendered**.
- **Already covered, NOT re-touched:** the boolean life/habit activities `rice_bucket`, `brain_rep`,
  `splits` ship as V1-5 checkboxes via `checkin-fields.ts` (`inputShape === 'boolean'` source). V1-7 adds
  nothing for them.
- **Explicitly excluded (different backlog items):** `shots` (canonical `shot` metric — the 10K-shots goal
  work) and `conditioning` (`sprint_reps`/`aerobic_minutes`). Both are `single_metric` and unrendered, but
  they're skill/conditioning, not "life activities," and pulling them in balloons scope. Named so the
  boundary is deliberate.
- **No migration.** `entries.event_at` (nullable `timestamptz`, "timing activities" — schema line 99) and
  `entries.value_text` (line 125) already exist; `unit` codes `timing`/`min` are in `UNIT_CODES`;
  `wake`/`wrestling_practice`/`practice_minutes` are already seeded. Nothing needs a column.
- **Reuse, don't fork, the write path.** Both flow through the existing `logCheckinEntries` DAL — extended
  by exactly one optional field (`eventAt`). No `logLifeActivity` DAL.
- Target: one small, focused PR (well under 400 lines), one concern.

## Acceptance

**Verbatim (plan.md V1-7):** _"One-tap 'wrestling practice' logged."_

**Concrete — done when:**

- On `/p/[profileId]`, a new **"Life"** section shows two ≥44px one-tap `<button>` controls: **Wake** and
  **Wrestling practice**.
- Tapping **Wake** logs one `entries` row: `activity_type_id → wake`, `unit = 'timing'`, `event_at = server
now (UTC)`, `value_num = minutes-since-midnight in the active tz`, `metric_key IS NULL`, `movement_id IS
NULL`, `kind IS NULL` — and it **passes `entries_shape_check`** (value_num is non-NULL). The logged wake
  time renders (via `entry-label`, dispatched on `activityKey`) as a local clock time, tz-stable —
  "Wake — 6:52 AM".
- Tapping **Wrestling practice** logs one row: `activity_type_id → wrestling_practice`, `metric_key =
'practice_minutes'`, `unit = 'min'` (DB-resolved), `value_num = DEFAULT_PRACTICE_MINUTES` (`90`), passing
  the shape CHECK. Renders through the existing default → "Practice minutes — 90 min" (R4).
- Each write carries a fixed per-button `client_id` (UUIDv7, **not** rotated): a same-button double-tap
  reuses it → `ON CONFLICT DO NOTHING` dedupes. Log-once/day is `client_id` + the UI inert state (re-fetch
  after `revalidatePath` hides the button) — the same UI-best-effort guarantee V1-5 gives, **not** a DB
  partial-unique (R10).
- Both are **profile-scoped** and land on the **declared day** the page rendered (bounded ±1 via
  `resolveDeclaredDay`), never a UTC-rolled date.
- **Empty / rest state:** with nothing logged, the Life section shows two live buttons and no "already
  logged" text; after logging, the tapped activity shows its inert logged state.
- `pnpm --filter @mat-plan/db verify` proves the wake + wrestling_practice round-trip against the retained
  `entries_shape_check`.
- Boundary tests (no-profile, bad body / unknown activityKey, wrong-owner, stale day) pass for the new
  action; tri-viewport screenshots (390/820/1280) attached.

## Design decisions (positions taken)

### D1 — `value_num` for wake: **local minutes-since-midnight** (the tz-free-read choice; panel R2)

The shape-CHECK trap (`apps/web/lib/dal/entries.ts` lines 236–247; schema lines 152–156) forces every
kind-NULL row to carry a non-NULL `value_num`. Wake therefore _must_ write `value_num`. It writes the
**local wall-clock minutes-since-midnight** in the active tz.

**Why minutes, not a sentinel `1` (the real reason — panel R2):** acceptance renders the clock ("Woke at
6:52 AM"). A sentinel would force deriving the clock from `event_at` **at read time** → a tz-aware `Intl`
call in the label path → which **breaks the codebase's hard tz-free-read invariant** (`entry-label.ts` and
`formatDayLong` are deliberately tz-free). Storing local minutes lets the read stay tz-free: a **pure**
`minutesToClock(value_num)`, no tz, no `event_at`. That is the justification — _not_ analytics (the
wake-time chart is out-of-scope; the "averageable datum" framing is dropped). Correctness confirmed
wall-clock minutes is the right value for a "wake **clock** time" anyway (DST-invariant for display).

**Honest cost (panel R2):** the aggregation model does not apply to wake (no `metric_key`), so `value_num`
here is a **local-clock projection**, not a metric reading — a shape a generic consumer (V1-13 CSV, V1-16
dashboard) must decode via the **one shared decoder** (`minutesToClock`), dispatched on `activityKey` (D5).
The generality claim is therefore precise: **no new _structure_** (no column, no migration) — but a timing
row is a distinct _shape_, decoded in one place. `event_at` is still written (the precise UTC instant —
the generality thesis + future picker/export), just not surfaced in V1-7 (D5/R7). Spec §4a models wake as
`event_at`-only; the interim `value_num` is forced by the retained shape-CHECK and revisited at V1-1d (Open
Questions).

### D2 — wrestling_practice one-tap: **default duration, no override in V1-7** (panel R6)

`wrestling_practice` is `single_metric` → `practice_minutes` (`valueType 'duration'`, `aggregation 'sum'`,
`unit 'min'`). One tap logs `value_num = DEFAULT_PRACTICE_MINUTES` (a named constant — `90`, a documented
assumption; confirm the household's typical length, it's a one-line change). The optional minutes-override
input is **deferred** (panel R6): verbatim acceptance is one-tap, and the override adds a controlled
`useState`, a `minutes` zod branch, and a test for no V1-7 payoff. Not an LLM-authored load (irrelevant —
a self-reported duration). No `event_at` (practice is day-grain; `activity_date` suffices). It renders
through the **existing `entry-label` default** → "Practice minutes — 90 min" (no new label branch — D5/R4).
`aggregation 'sum'` means a rare second practice would sum — V1-7 keeps it **log-once/day** (D3).

### D3 — Re-loggability & "now" vs picker

Both are **log-once per day** for V1-7, mirroring the V1-5 habit inert pattern (`loggedFieldKeys`): after a
tap the button flips to an inert "Woke at 6:52 AM" / "Practice logged — 90 min" state (focusable +
announced, name dropped so it can't re-submit — same idiom as `checkin-form.tsx` `submitName`). Wake logs
**"now"** (server-stamped `event_at`); **no time picker** in V1-7 (YAGNI — one-tap is the acceptance).
Editing/deleting a mistaken tap, a time picker, and multiple-practices-per-day are deferred.

### D4 — Small keys-const + inline-JSX buttons + thin action, shared DAL (panel R5)

`checkin-fields.ts` (lines 113–119) reserves V1-7 for a source outside `CHECKIN_FIELDS` — honored: **do not
touch `CHECKIN_FIELDS`.** But a full parallel _registry_ is ceremony for two heterogeneous hard-coded items
(panel R5): it earns none of check-in's "derive N fields from seed data" payoff, and `logShape` would be a
4th taxonomy duplicating `input_shape`/`value_type`. So:

- **`lib/life/life-activities.ts`** shrinks to a **trust-boundary const**: `LIFE_ACTIVITY_KEYS`
  (`[ACTIVITY_TYPE_KEYS.wake, ACTIVITY_TYPE_KEYS.wrestling_practice]` — the set the action validates the
  submitted `activityKey` against; never trust the body) + `DEFAULT_PRACTICE_MINUTES`. No `LifeActivityField`
  union, no `logShape`, no catalog-derivation, no dedicated test.
- **`life-form.tsx`** renders the two controls as **explicit JSX** (a Wake button, a Wrestling button) —
  clearer at N=2 than a `.map` with an `if (logShape)`. Each is its own `<form action={logLifeActivitiesAction}>`
  so a tap logs _immediately_ (the check-in batch submit is the wrong model for one-tap). Idempotency
  `client_id` per button via `const [clientId] = useState(newId)` — **no rotation** (the bodyweight-form
  pattern; log-once means a double-tap reuses the same id → `ON CONFLICT` dedupes — R10). Inert logged state
  from `loggedLifeKeys`. Plain field names (`activityKey`/`clientId`), not the check-in `v:`/`c:` scheme
  (those exist for the N-field batch).
- **`logLifeActivitiesAction`** in `actions.ts` — **thin**: validate `profileId` + `resolveDeclaredDay(day)`
  - `activityKey ∈ LIFE_ACTIVITY_KEYS` + `clientId`; for wake, `event_at = new Date()` and `value_num =
localMinutesSinceMidnight(await getActiveTimeZone(), event_at)`; for wrestling, `value_num =
DEFAULT_PRACTICE_MINUTES`, `metricKey = 'practice_minutes'`; delegate to the shared DAL. Reuses the
    `logCheckinsAction` envelope + `created`-based conflict message.

**Why not a new `logLifeActivity` DAL:** `logCheckinEntries` already does profile resolve, catalog resolve,
DB-truth unit resolution, the always-set-`value_num` idiom, per-item `ON CONFLICT` idempotency, and per-item
results. The _only_ missing capability is `event_at`. So extend `CheckinItemInput` with an optional
`eventAt?: Date`. Wake becomes a "neither-source" item (`metricKey: null` → `unit` resolves to
`activity.defaultUnit = 'timing'`) with `eventAt` + `value_num = minutes`; wrestling is an ordinary metric
item. One optional field is the whole DAL delta. **Cohesion debt (panel R11):** this makes
`logCheckinEntries` the de-facto generic entry writer under a "checkin" name — extend now, but comment it and
**rename to `logEntries` / `EntryItemInput` when the 2nd non-checkin caller lands or at V1-1d** (deferred, not
done in this proof PR).

### D5 — tz display: reuse the V1-6c seam, dispatch on `activityKey`, keep `entry-label` tz-free

- **Wake label** renders from `value_num` (local minutes) via a **pure `minutesToClock(value_num)`** — no tz
  at read, so `entry-label.ts` stays tz-agnostic. `minutesToClock` uses an **`Intl` UTC formatter** (panel
  R8: `hour:'numeric', minute:'2-digit', hour12:true, timeZone:'UTC'` over `new Date(min*60000)`) — mirrors
  `formatDayLong`; the 12h edges come free.
- **Dispatch on `activityKey === ACTIVITY_TYPE_KEYS.wake`** (panel R3), **not** `unit==='timing'`: a wake row
  and a bare-habit row are both `metricKey`-null, so the wake branch sits inside `entry-label` branch 3
  **before** the bare-habit `activityLabel` return (order IS load-bearing _within_ branch 3 — correctness
  R3/R14). `activityKey` is the robust discriminant (mutually exclusive with `metricKey`; the
  `activity-totals.ts` precedent), and it avoids the fragile `unit` coupling. → "Wake — 6:52 AM".
- **`wrestling_practice` gets NO new `entry-label` branch** (panel R4): the existing default already emits
  "Practice minutes — 90 min", and a `valueType='duration'` case would also mislabel `aerobic_minutes`
  (conditioning, also `duration`). Falls through unchanged.
- **`event_at` is written but NOT surfaced** (panel R7): no `EntryDTO.eventAt`, no `listEntriesForDay` select
  change, no `<time dateTime>` page logic. The write proves the timing capability (`db:verify` asserts it);
  reading it is a later refinement.
- The action computes minutes via a shared **`localDateParts(tz, now)`** primitive (panel R9) that
  `localDayIso` and `localMinutesSinceMidnight` both derive from, pinning **`hourCycle:'h23'`** (panel R1 —
  else 00:00→720). Uses the existing `getActiveTimeZone()` seam; no UTC reintroduction.

## Migration: NOT needed

Confirmed against the actual schema:

- `entries.event_at timestamptz` (nullable, "timing activities") — schema line 99. Exists.
- `entries.value_text text` — schema line 125. Exists (unused by V1-7; wake's datum is numeric minutes).
- `UNIT_CODES` includes `timing` and `min` (`packages/shared/src/units.ts`), seeded into `units`.
- `activity_types` rows `wake` (timing/timing) and `wrestling_practice` (single_metric/min) and
  `metric_definitions.practice_minutes` (min/duration/sum) are already seeded.
- `entries_shape_check` (retained until V1-1d) passes for both because `value_num` is always written.

No column, no constraint, no seed change ⇒ **no migration file, no Squawk surface, no Neon-branch apply.**
The generality proof _is_ that there's nothing to migrate.

## File-by-file changes

| Path                                         | Change   | What & why                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/lib/life/life-activities.ts`       | NEW (~8) | **Const-only** (not a registry — R5): `LIFE_ACTIVITY_KEYS = [ACTIVITY_TYPE_KEYS.wake, .wrestling_practice]` (the action's trust-boundary set) + `DEFAULT_PRACTICE_MINUTES = 90`. No `LifeActivityField`, no `logShape`, no derivation, no dedicated test.                                                                                                                                                                                                  |
| `apps/web/app/p/[profileId]/life-form.tsx`   | NEW      | Client one-tap section — **two explicit-JSX** `<button>`s (≥44px), each its own `<form action={logLifeActivitiesAction}>`; `useActionState`; `const [clientId]=useState(newId)` per button (**no rotation** — R10); inert state from `loggedLifeKeys`; plain field names (`activityKey`/`clientId`).                                                                                                                                                       |
| `apps/web/app/p/[profileId]/actions.ts`      | EDIT     | Add `logLifeActivitiesAction`: validate `profileId` + `resolveDeclaredDay(day)` + `activityKey ∈ LIFE_ACTIVITY_KEYS` + `clientId`; wake → `event_at = new Date()`, `value_num = localMinutesSinceMidnight(await getActiveTimeZone(), event_at)`; wrestling → `value_num = DEFAULT_PRACTICE_MINUTES`, `metricKey='practice_minutes'`; call `logCheckinEntries` (+`eventAt`); typed envelope + `created`-based conflict. Thin. **No minutes override** (R6). |
| `apps/web/lib/dal/entries.ts`                | EDIT     | `CheckinItemInput` gains optional `eventAt?: Date`; thread `eventAt: i.eventAt` into `values` (→ `undefined` omits it for existing callers). Comment: de-facto shared entry writer — **rename to `logEntries`/`EntryItemInput` at the 2nd non-checkin caller / V1-1d** (R11). **No** `EntryDTO.eventAt`/`listEntriesForDay` change (R7).                                                                                                                   |
| `apps/web/lib/date.ts`                       | EDIT     | Extract `localDateParts(timeZone, now)` (y/m/d/h/m via `Intl…formatToParts`, **`hourCycle:'h23'`** — R1/R9); refactor `localDayIso` onto it; add `localMinutesSinceMidnight(timeZone, now)` (from it) + `minutesToClock(min)` (Intl UTC formatter — R8).                                                                                                                                                                                                   |
| `apps/web/lib/date.test.ts`                  | EDIT     | `localMinutesSinceMidnight` across PT/ET/AZ + a DST boundary, **pinning `00:00→0` and `23:59→1439`** (R1); `minutesToClock` edges (0→"12:00 AM", 720→"12:00 PM", 1439→"11:59 PM").                                                                                                                                                                                                                                                                         |
| `apps/web/lib/entries/entry-label.ts`        | EDIT     | Add ONE `wake` branch inside branch 3, **before** the bare-habit return, on `activityKey === ACTIVITY_TYPE_KEYS.wake` (→ "Wake — {minutesToClock(value)}"). **No `duration` branch** (default already renders "Practice minutes — 90 min"; a `duration` case would mislabel `aerobic_minutes` — R3/R4).                                                                                                                                                    |
| `apps/web/lib/entries/entry-label.test.ts`   | EDIT     | Add the wake label case (activityKey dispatch).                                                                                                                                                                                                                                                                                                                                                                                                            |
| `apps/web/app/p/[profileId]/page.tsx`        | EDIT     | Derive `loggedLifeKeys` (entries where `activityKey ∈ LIFE_ACTIVITY_KEYS`); render a `<section aria-labelledby="life-heading">` with `<LifeForm …/>`. Reuse the existing `timeZone`/`day`. No `<time>`/`eventAt` (R7).                                                                                                                                                                                                                                     |
| `apps/web/app/p/[profileId]/actions.test.ts` | EDIT     | Boundary + happy-path tests for `logLifeActivitiesAction` (see Test plan). Reuse the file's mocks (`next/headers`/tz, DAL, profiles).                                                                                                                                                                                                                                                                                                                      |
| `packages/db/scripts/verify.ts`              | EDIT     | Add a **V1-7 generality block**: insert a `wake` row (`unit='timing'`, `event_at` set, `value_num=`minutes) and a `wrestling_practice` row (`metric_key='practice_minutes'`, `value_num=`minutes), assert both persist with the expected columns and satisfy `entries_shape_check`; pin that a wake row with NULL `value_num` is rejected.                                                                                                                 |
| `docs/plans/v1-7-life-activities.md`         | NEW      | This plan.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `docs/plan.md` · `docs/status.md`            | EDIT     | Link the V1-7 row to this plan; status ride-along (pointer + backlog + changelog).                                                                                                                                                                                                                                                                                                                                                                         |

## Test plan

**Unit (Vitest, sync/pure):** `date.test.ts` (`localMinutesSinceMidnight` across tz/DST, **pinning 00:00→0
& 23:59→1439**; `minutesToClock` edges); `entry-label.test.ts` (the wake `activityKey` branch). No
`life-activities.test.ts` — the collapsed const has nothing to test beyond the action's trust-boundary
check (folded into the action tests).

**Integration — Server Action (mock boundaries, plain async fn; reuse `actions.test.ts` harness):**

- **Happy — wake:** valid body → `logCheckinEntries` called once with `activityKey='wake'`, `metricKey=null`,
  `eventAt` a Date, `value` = minutes from the pinned default tz; `{ok:true}`; `revalidatePath` hit.
- **Happy — wrestling_practice:** default (no minutes) → `value=DEFAULT_PRACTICE_MINUTES`,
  `metricKey='practice_minutes'`, no `eventAt`; override minutes respected.
- **Bad body → zod-reject (mandatory):** unknown/absent `activityKey` (not in `LIFE_FIELDS`),
  non-int/out-of-range minutes → typed `fieldErrors`, DAL not called.
- **No/unknown profile (mandatory):** `getProfileByPublicId → null` → `{ok:false}`, no write. (The V1-3
  existence-only authZ gap — closes at Clerk v1.5 — documented, not introduced.)
- **Stale day:** `day` > ±1 from active-tz today → `DECLARED_DAY_CLOSED_ERROR`, no write.
- **Idempotent conflict:** DAL returns `created:false` for the only item → `{ok:false, "already logged"}`.

**`db:verify` (PGlite, real migration+seed):** the V1-7 block — round-trip both activities, pin the
shape-CHECK boundary. `pnpm --filter @mat-plan/db verify`.

**E2E (Playwright smoke, real DB):** extend the existing spec — gate-login → profile → tap **Wake** →
assert a "Woke at …" `<time>` appears and the button goes inert; tap **Wrestling practice** → assert
"Wrestling practice — 90 min" and inert; reload → state stable. Async RSC path covered here (not Vitest).

**Screenshots:** `ui-screenshot` → Today at **390 / 820 / 1280** showing the Life section (empty + logged);
attach mobile + desktop.

## Risks / rollback

| Risk                                                                               | Mitigation                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `value_num`=local-minutes is a semantic overload a generic consumer mis-reads (R2) | Decoded in **one place** (`minutesToClock`), dispatched on `activityKey` (not `unit`); display reads `value_num` so the read path stays tz-free; `event_at` written but not surfaced. The generality claim is "no new _structure_," not "no shape a consumer decodes." Spec §4a divergence tracked in Open Qs. |
| Wake (morning) reuses the evening-oriented declared-day ±1 bound (R12)             | A stale overnight tab files a morning wake on _yesterday_ (`value_num`/`event_at` from `now`, `activity_date` from the declared day). Within ±1 (never rejected); a reload gives a fresh day. Documented, not silently reused; a future picker recomputes both from the picked instant.                        |
| Shape-CHECK regression (a NULL-`value_num` wake rejected in prod)                  | The action always sets `value_num`; `db:verify` pins **both** directions (passes with value; rejects without). The DAL's always-set idiom is unchanged.                                                                                                                                                        |
| Spec §4a shows `wrestling_practice → unit=timing`, but the metric resolves `min`   | The DAL writes the **DB-resolved** unit (`min` via `practice_minutes`) — the correct real unit; `timing` is wake-only. Flagged as an open question for a one-line spec clarification (follow-up).                                                                                                              |
| One-tap double-fire / offline replay → duplicate rows                              | Per-tap `client_id` UUIDv7 + partial-UNIQUE + `ON CONFLICT DO NOTHING` + per-item `created`; log-once inert state drops the submit name after logging.                                                                                                                                                         |
| Scope creep into shots/conditioning                                                | Explicitly excluded; registry hard-codes only the two life activities.                                                                                                                                                                                                                                         |
| `event_at` added to `listEntriesForDay` select changes the DTO                     | Additive nullable field; existing consumers ignore it. Covered by the entry-label + render tests.                                                                                                                                                                                                              |

**Rollback:** revert the PR. **No migration, no DDL, no data transform** — the schema is untouched; any rows
already written remain valid generalized entries (they simply stop rendering).

## Reuse obligations (import/extend, not re-implement)

- **V1-5 write path:** extend `logCheckinEntries` with one optional `eventAt`; reuse its
  profile/catalog/unit resolution, always-set-`value_num`, `ON CONFLICT` idempotency, per-item results. No
  `logLifeActivity` DAL.
- **tz seam (V1-6c):** `getActiveTimeZone()` for the minutes computation; new date helpers stay
  pure/injectable in `lib/date.ts`. No UTC reintroduction.
- **Declared-day bound (V1-6c):** `resolveDeclaredDay` — the same ±1 seam the other writers use.
- **Constants single-source:** `ACTIVITY_TYPE_KEYS`/`METRIC_KEYS` (shared), `VALUE_NUM_MAX` (reuse from
  `checkin-fields.ts` or hoist to `lib/constants.ts` if a second importer makes it cross-feature),
  `DEFAULT_PRACTICE_MINUTES` (new, named once). Tests assert via consts.
- **UI idioms:** the `checkin-form.tsx` inert/`submitName`/rotated-`client_id`/controlled-value patterns;
  the page's `loggedFieldKeys` derivation; semantic `<button>`/`<time>`, ≥44px, `inputmode="numeric"`.
- **entry-label seam:** extend the existing `duration` branch rather than a parallel labeller.

## Out-of-scope / deferred

Time picker for wake; editing/deleting a mis-tap; multiple practices per day; wake-time / practice-minutes
charts (the analyzable `value_num` is laid down now so they need no backfill); CSV/MCP export (spec §4b:
app-only until v3); shots/conditioning rendering; a runtime DB-driven catalog (V1-10); Clerk
authZ/rate-limit/Sentry (V1-14 / v1.5).

## Open questions

1. **`DEFAULT_PRACTICE_MINUTES` value** — implemented as `90` (a documented assumption); confirm the
   household's typical practice length (a one-line const change).
2. **spec.md §4a divergences (panel R2, follow-up spec note):** §4a models `wake → entry(…, event_at)` with
   **no `value_num`**, but the retained `entries_shape_check` forces a non-null `value_num` today, so V1-7
   writes local-minutes (revisited when V1-1d drops the CHECK — `value_num` may then revert to null). §4a
   also shows `wrestling_practice → unit=timing`, but the seeded catalog resolves `unit=min` (canonical).
   Both warrant a one-line spec.md clarification in a follow-up (kept out of this PR).
3. **Wrestling multiple-per-day** — V1-7 logs once/day; confirm that matches usage before considering the
   `accumulates` path (`aggregation='sum'` already supports it).

## Review-response log (adversarial panel)

Four lenses (correctness · simplicity · architecture · code-reuse). The panel **cut ~⅓ of the moving
parts** (registry, optional-minutes, a redundant label branch, the event_at read), caught one **blocking**
correctness defect (the 12-hour formatter), and converged on making wake's shape robust
(`activityKey`-dispatch, one decoder). Correctness confirmed both rows pass `entries_shape_check` **and**
the real (at-most-one) `entries_value_source_check`. Net: a smaller, more correct generality proof.

| #             | Lens                                                                                                 | Critique                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1 (BLOCKING) | correctness                                                                                          | `localMinutesSinceMidnight` "same technique as `localDayIso`" is under-specified: an `en-US`/2-digit `hour` gives a **12-hour** clock — 00:00→`"12"`→720 (stored as noon), 13:00→60, 23:59→719. Wrong minutes + corrupted display.                                                                                                                                                                                                                                                                                                                                                                          | **Incorporated.** The helper MUST pin **`hourCycle: 'h23'`** (0–23), and `date.test.ts` pins `00:00 → 0` and `23:59 → 1439` (not just the `minutesToClock` edges).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| R2            | architecture (should-fix, ~blocking for the "generality" claim) + simplicity (#1) + correctness (#7) | **`value_num` = minutes-since-midnight is a semantic overload.** Wake has no `metric_key` → the aggregation model can't roll it up; `AVG(value_num) WHERE activity_type=wake` bypasses the model; a generic `value_num` consumer (V1-13 CSV / V1-16 dashboard) mis-reads it (`"412 timing"`). Diverges from spec §4a (`wake → event_at`, no value_num). Simplicity: keep it anyway — a sentinel forces reading `event_at` at render → a tz-aware `Intl` call in the label path → breaks the tz-free read invariant. Correctness: wall-clock minutes is the _right_ datum for "average wake **clock** time." | **Keep minutes, re-justify + harden.** The shape-CHECK forces a non-null `value_num` today, and wall-clock minutes keeps the **read path tz-free** (a pure `minutesToClock`, no `event_at` read) — that is the real justification (the "averageable chart" prose is deleted; the chart is out-of-scope). Robustness (architecture): **one shared decoder** (`minutesToClock` is the single read path), **dispatch/decode by `activityKey`** (R3), and the value_num-is-local-minutes semantic is **owned in code + this plan**, not just implied. The generality claim is narrowed honestly: **no new _structure_** (true), but a timing row is a distinct _shape_ a consumer must decode via the shared helper. Spec §4a divergence (wake carries `value_num`, forced by the CHECK until V1-1d) is added to Open Questions. |
| R3            | architecture (#4) + correctness (#5)                                                                 | **Wake discriminated by `unit==='timing'` is fragile.** It works only because wake is the sole timing-unit activity; it reintroduces order-dependence into `entry-label` (must precede the bare-habit `activityLabel` return in branch 3, or wake renders "Wake" with no time — a real regression vs the file's "order not load-bearing" note); and it couples to the independently-flagged wrestling-unit choice.                                                                                                                                                                                          | **Incorporated.** Dispatch on **`activityKey === ACTIVITY_TYPE_KEYS.wake`** (mutually exclusive with `metricKey`; the robust precedent `activity-totals.ts` already uses), placed inside branch 3 **before** the bare-habit return. `unit` is a display attribute, not a shape discriminant. No `UNIT.timing` const needed (R moot).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| R4            | simplicity (#5) + code-reuse (#1) + correctness (#2)                                                 | **The `entry-label` `duration` branch is redundant AND buggy.** The existing default already renders `metricLabel — value unit` = "Practice minutes — 90 min". A `case duration` keyed on `valueType` would also catch **`aerobic_minutes`** (conditioning is also `valueType:'duration'`) → mislabels an excluded activity; and emitting "Wrestling practice" needs `activityLabel`, departing from branch 1's `metricLabel` convention.                                                                                                                                                                   | **Incorporated — no `duration` branch.** Wrestling falls through the existing default → **"Practice minutes — 90 min"** (arguably clearer, and zero new code / zero `aerobic_minutes` risk). Acceptance updated from "Wrestling practice — 90 min" to the metricLabel form.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| R5            | simplicity (#2) + architecture (#5)                                                                  | **The 3-file registry mirror is ceremony for two heterogeneous hard-coded items** — it earns none of `checkin-fields.ts`'s "derive N fields from seed data" payoff; `logShape` is a 4th taxonomy duplicating `input_shape`/`value_type`; wrestling isn't really a "third source" (it rides along).                                                                                                                                                                                                                                                                                                          | **Incorporated — collapse.** No `LifeActivityField` union, no `logShape`, no catalog-derivation, no dedicated `life-activities.test.ts`. `lib/life/life-activities.ts` shrinks to the **trust-boundary const** `LIFE_ACTIVITY_KEYS` (from `ACTIVITY_TYPE_KEYS.wake`/`.wrestling_practice`) + `DEFAULT_PRACTICE_MINUTES`. `life-form.tsx` renders the two buttons as **explicit JSX**, not a `.map` over a registry. (Code-reuse concurred: keep `LifeActivityField` out; don't reuse the `v:`/`c:` name scheme — per-activity forms use plain names.)                                                                                                                                                                                                                                                                        |
| R6            | simplicity (#4)                                                                                      | The optional wrestling `minutes` override is self-imposed scope; verbatim acceptance is one-tap.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | **Incorporated — defer.** Pure one-tap default-`90`. Cuts the controlled `useState`, the `minutes` zod branch + clamp, and the override test. Override is a trivial later add.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| R7            | simplicity (#5) + correctness (#8)                                                                   | Nothing **reads** `event_at` at render (the clock comes from `value_num`); the `<time dateTime>` machine attribute isn't required by acceptance and needs page-side `activityKey==='wake'` special-casing.                                                                                                                                                                                                                                                                                                                                                                                                  | **Incorporated — write, don't surface.** Still **write** `event_at` (the generality thesis — `db:verify` asserts it round-trips), but **cut** the `EntryDTO.eventAt` field, the `listEntriesForDay` select change, and the `<time>` page logic. Wake renders through `entry-label` (activityKey) from `value_num`. Smaller.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| R8            | code-reuse (#2)                                                                                      | `minutesToClock` hand-rolling AM/PM re-implements an Intl formatter.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | **Incorporated.** `minutesToClock(min)` = `Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit',hour12:true,timeZone:'UTC'})` over `new Date(min*60000)` — mirrors `formatDayLong`'s UTC-anchored, tz-free technique; the 12h edges come free.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| R9            | code-reuse (#3)                                                                                      | `localMinutesSinceMidnight` duplicates `localDayIso`'s `formatToParts` + `parts.find` boilerplate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | **Incorporated.** Extract `localDateParts(timeZone, now)` (year/month/day/hour/minute, `hourCycle:'h23'`); `localDayIso` and `localMinutesSinceMidnight` both derive from it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| R10           | correctness (#3)                                                                                     | Acceptance over-claims "never a duplicate row." A rotated `client_id` makes a distinct 2nd tap insert a 2nd row (no partial-unique on (profile,activity,date)); the once/day guard is UI-inert + re-fetch, not DB-enforced.                                                                                                                                                                                                                                                                                                                                                                                 | **Incorporated — no rotation + honest wording.** `life-form` uses `const [clientId] = useState(newId)` per button (the **bodyweight-form** pattern, no rotation) — so a double-tap reuses the **same** `client_id` → `ON CONFLICT` dedupes; log-once is then `client_id` + UI-inert (matching V1-5's design). The plan no longer claims DB-enforced once/day; no partial-unique added (out of scope). **Side effect:** this moots code-reuse's "extract the reset-during-render hook" concern (#R13) — life-form needs no rotation/reset idiom.                                                                                                                                                                                                                                                                              |
| R11           | architecture (#1) + code-reuse (cohesion note)                                                       | Extending the domain-named `logCheckinEntries` makes it the generic entry writer under a "checkin" name; `CheckinItemInput` grows `eventAt` most callers ignore. Architecture: extract `insertEntries`/rename `logEntries`.                                                                                                                                                                                                                                                                                                                                                                                 | **Deferred with a documented trigger (3 lenses vs 1).** Extend `logCheckinEntries` with the one optional `eventAt` now (simplicity + code-reuse blessed the one-field delta as genuine reuse). Add a code comment: it is now effectively the shared entry writer — **rename to `logEntries` / `EntryItemInput` when the 2nd non-checkin caller lands or at V1-1d.** Code-reuse explicitly recommended deferring the rename to the 2nd caller; renaming now is mechanical churn on a "proof" PR. Accepted as tracked debt (tech-debt note).                                                                                                                                                                                                                                                                                   |
| R12           | correctness (#4) + architecture (#3)                                                                 | Wake is the first **morning** writer reusing the **evening**-oriented declared-day ±1 bound: three time sources on one row (`event_at`/minutes from `now`; `activity_date` from the declared day). A stale overnight tab files a morning wake on **yesterday**.                                                                                                                                                                                                                                                                                                                                             | **Documented (accept).** Within-±1 so never rejected; a reload yields a fresh day, so it needs a stale-overnight-tab to bite. Called out explicitly in D3/risks rather than silently reused; a picker (deferred) would recompute both from the picked instant.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| R13           | code-reuse (#4)                                                                                      | The "reset-on-action-result during render" + client_id rotation idiom would become its 2nd hand-rolled copy.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | **Moot (see R10).** Log-once `life-form` uses `useState(newId)` with **no** rotation/reset — it doesn't reproduce the check-in idiom, so there's nothing to extract. Revisit a shared hook only if a future editable one-tap surface needs rotation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| R14           | correctness + code-reuse (confirmations)                                                             | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | **Kept.** Both rows pass `entries_shape_check` (value_num non-null) **and** the real at-most-one `entries_value_source_check` (`0002`: `movement_id IS NULL OR metric_key IS NULL` — not the XOR AGENTS.md prose); `eventAt: i.eventAt` → `undefined` omits the column for existing callers; the one-field DAL delta, per-button forms, `loggedLifeKeys`, and `resolveDeclaredDay`/`getProfileByPublicId`/`revalidatePath` reuse are all correctly minimal.                                                                                                                                                                                                                                                                                                                                                                  |

**Net change from the panel:** register the two activities via a **tiny keys+default const** (not a registry) with **inline-JSX buttons** (R5, R6); wake writes `value_num`=local-minutes (`hourCycle:'h23'` — R1) via a shared `localDateParts` (R9) + writes `event_at` but **doesn't surface it** (R7); render via `entry-label` **dispatched on `activityKey`** with **no `duration` branch** (R3, R4); `minutesToClock` via Intl (R8); `useState(newId)` no-rotation idempotency (R10); extend `logCheckinEntries` now, rename later (R11). Cut files: `life-activities.test.ts`; cut edits: the `entry-label` duration case, the `EntryDTO.eventAt` read. Still no migration.
