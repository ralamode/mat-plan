# V1-11 — copy a logged movement to a sibling

> Backlog: [plan.md](../plan.md) row V1-11. Branch: `feat/v1-11-copy-set` (stacked on
> `feat/v1-10-strength-prefill`). **Pure app code — no migration.** Significant PR → committed plan +
> adversarial panel before implementation.

## Goal

The kids train **together**, off the same programmed day (V1-10 just put that day on screen). Ray logs
Athlete One's `Front Squat 5 × 5 @ 60`, then has to retype the identical movement and set structure for Athlete Two
— on a phone, on the gym floor, between sets. This PR adds a **Copy to <sibling>** affordance on a logged
movement: one tap writes that movement and its sets into the sibling's **same-day** session, which the
coach then corrects with the V1-9 inline set edit (Athlete Two squats 65, not 60).

It is the first **cross-profile** write in the app. That is the whole risk of this PR, and the reason it
gets a plan: every other writer scopes to exactly one profile, and this one deliberately reads from A and
writes to B.

## The granularity decision (and why the backlog row's wording is not taken literally)

The backlog says "copy-set-to-other-kid / copy a set to sibling's session". **This PR copies a MOVEMENT
(the `entry` + all its `entry_set`s), not a lone set.** Reasons:

1. **A set has no meaning without its movement.** `entry_sets` has no movement of its own — it hangs off
   an `entry`. Copying "3 × 60" alone would have to _guess_ which of the sibling's movements to attach to,
   or invent one. Both are worse than copying the movement.
2. **It matches what the UI shows.** The day's log renders a session → movements → sets. A movement is a
   row the coach can point at; a set is a sub-line.
3. **It matches the actual workflow.** Both kids do the same _movement_; the thing that differs is the
   load, which V1-9 already lets the coach fix in place.

Copying a whole **session** is the obvious next size up and is deliberately **out of scope** (see below) —
it multiplies the failure modes (partial copies, superset graphs, feel notes) for a slice whose point is
"don't retype the squat".

## Acceptance

- On the day's log, each movement inside a logged strength session shows a **Copy to <name>** control for
  each other profile in the household.
- Tapping it writes that movement + its sets into that sibling's session **for the same day**, creating
  the sibling's session if they have none yet.
- The sibling's Today shows the copied movement; its loads are then editable via V1-9.
- Tapping **twice** produces **one** copy, not two (idempotency, not an app-level "does it exist" check).
- The source is never mutated.

## Design decisions

**D1 — Reuse `writeStrengthSession`, do not write a new writer.** The copy is, in DB terms, exactly "log a
strength session with one movement" for the target profile. `packages/db/src/writers/strength-session.ts`
already does that transactionally, idempotently (`client_id` + partial UNIQUE + ON CONFLICT), and is
`db:verify`-proven. A copy-specific writer would be a second insert path for the same graph — the drift
V1-8-2 single-sourced against. **New code in `packages/db` should be a READ (`copyableMovementRow`),
not a write.**

**D2 — The source read is its own single-sourced query, scoped by the SOURCE profile.** A new
`packages/db/src/queries/copy-movement.ts` exposes `copyableMovementRow(db, { profilePublicId, entryPublicId })`
returning `{ movementName, unit, sets: {reps, weight}[] } | null`, joining `entries → entry_sets` and
requiring the entry to belong to the live source profile. Returning `null` for "not yours" is the IDOR
guard, single-sourced and provable by `db:verify` (the `updateStrengthSetById` precedent — the guard lives
in the SQL, not in a caller's `if`).

**D3 — Both profiles are re-resolved server-side; both must be in the SAME household.** This is the new
authz surface. The action takes `{ sourceProfileId, targetProfileId, entryId }` — all public UUIDs, all
untrusted. It re-resolves both via the DAL and **rejects a cross-household pair**. Today every profile is
in the one seeded household so this cannot fire in production, but the check is the seam Clerk tightens at
v1.5, and without it the action is a documented cross-tenant copy primitive. `getProfileByPublicId` does
not currently expose `householdId` (V1-10's panel deliberately kept it off `ProfileDTO`), so the
household-match check belongs **inside a DAL/query function**, not in the action — same shape as
`programDayRows`: pass both public ids, let the SQL prove they share a household.

**D4 — Idempotency: a DETERMINISTIC client id, derived, not random.** Every other writer takes a
client-generated UUIDv7 from a form. A copy is triggered by a button with no client state, so a random id
per click makes double-tap produce two rows — and "tap twice → one copy" is in the acceptance criteria.
The copy's `client_id`s are therefore **derived deterministically** from `(source entry public_id, target
profile public_id)` via a UUIDv5-style namespaced hash, so a replay hits the existing `client_id` UNIQUE
and the writer's ON CONFLICT no-ops — idempotency at the DB, not an app-level pre-check (AGENTS.md).
**Open Q1** asks the panel to sanity-check the derivation (uuid v5 vs a hash → uuid-shaped string) and
whether the SESSION client id should also be derived (it must be: two different movements copied to the
same kid on the same day must land in the SAME session, so the session key must be
`(target profile, day)`-derived, not per-movement).

**D5 — Target session: same day, reuse-or-create.** The copy lands on the **source entry's
`activity_date`**, not "today" — copying yesterday's log must not write to today. Because the session
`client_id` is derived from `(target profile, day)` (D4), the first copy creates the session and every
later copy that day ON-CONFLICTs onto it. No separate "find the sibling's session" query.

**D6 — UI: a server-rendered form per sibling, not a client island.** The day's log is RSC. The copy
control is a `<form action={copyMovementAction}>` with hidden ids and a real `<button>` — no
`'use client'`, no new client JS, consistent with the read-only session block. With 2 profiles that's ONE
button per movement ("Copy to Athlete Two"). **Open Q2:** at N profiles this becomes N-1 buttons per movement
— does it need a menu, or is "≤3 kids, render them all" right for the MVP?

**D7 — Feedback.** The action `revalidatePath`s BOTH profiles' Today. The coach is on A's page and the
write lands on B's, so success is otherwise invisible. **Open Q3:** is a `useActionState` message needed
(→ a client island, contradicting D6), or does the button suffice with an `aria-live` region? Cheapest
honest option: the source page renders "Copied to Athlete Two" against the movement because the copy is now
discoverable from A's own row — but A's page has no knowledge of B's entries without another read.

**D8 — Tests.** `db:verify`: `copyableMovementRow` returns the graph for the owner, `null` for a
non-owner and for a soft-deleted entry; a cross-household pair resolves to nothing; the derived-id replay
writes ONE row. Unit: the id derivation is pure and stable. Boundary (the AGENTS.md mandate, as plain async
fns with mocked auth/Drizzle): unauth-ish/unknown profile → typed error, wrong-owner entry → typed error,
bad body → zod reject, double-submit → one effect. Tri-viewport screenshots of the control + the sibling's
resulting Today.

## Out of scope (→ later)

Copying a whole **session** (incl. its supersets and feel note); copying to a **different day**; copying
**check-ins** or life activities; an **undo** (the copy is a normal entry — V1-9b's delete covers it when
it lands); a **bulk** "copy the whole day".

## Open questions for the panel

1. **The derived `client_id` (D4).** Is a namespaced UUIDv5 over `(entry public_id, target profile
public_id)` the right idempotency key, or does it need a real UUIDv7 from a client island? Note the
   collision-vs-legitimate-recopy tension: with a derived key, deleting the copy and copying **again**
   would ON-CONFLICT against the soft-deleted row's `client_id` — the partial UNIQUE (`WHERE deleted_at IS
NULL`) means the dead row does NOT block it, but the writer's `reselectLiveByClientId` path must be
   re-checked against exactly this case.
2. **N-1 buttons per movement (D6)** — acceptable at 2–3 profiles, or does the MVP need a menu?
3. **Cross-household check (D3)** — is a household-matching SQL join the right home, or should
   `ProfileDTO` finally carry `householdId` (V1-10's panel said no)?
4. **Is same-day the right target (D5)**, or should the copy always land on _today_ regardless of the
   source entry's date?
5. **Does this belong on a movement inside a SESSION only**, or also on a flat/legacy standalone strength
   entry (pre-V1-8-2 rows)? The latter has no session to copy "into".
6. **Scope check:** is the whole slice worth it before **V1-13 CSV export** (the MVP's actual point), or
   should V1-11 be deferred? The panel should feel free to say "cut this".

---

## Adversarial panel review log — reconciled (VERDICT: **DEFER this slice past the MVP**)

_(Lenses: correctness/security · simplicity/scope/product · architecture/consistency.)_

**All three lenses agree the plan AS WRITTEN does not work. They SPLIT on the verdict**, and the split is
recorded rather than flattened:

- **simplicity/scope: CUT** — the premise is falsified, it re-opens a hazard just closed, and V1-13 hasn't started.
- **correctness/security: RESHAPE, don't cut** — "the core is one guarded read plus one existing writer
  call"; it explicitly withdrew its strongest cut-argument on discovering that bodyweight work logs as
  `weight: 0` (so pull-ups/push-ups ARE copyable, contrary to the labeled-set worry).
- **architecture: no verdict asked** — but found four independent BLOCKING defects in the design.

**Decision: DEFER.** The correctness lens judged _feasibility_ ("this can be built correctly"), which is
true and not in dispute. It did not weigh the two arguments that actually decide it — the falsified premise
(#1) and the fabricated-observation hazard (#2) — because those were outside its brief. On feasibility the
reshape answer is right; on whether to spend the next 2–3 weeks of a 4h/wk budget on it before the MVP
exists, the cut answer is right. Recorded in full so a later revisit starts from the analysis.

### Why it is deferred, not fixed

**1. The premise is falsified by data merged one PR earlier (#67).** The Goal claimed Ray retypes an
identical movement for both kids. He does not: **7 of 21 prescriptions carry per-kid loads** (verified —
`packages/shared/src/programming.ts` has 14 `both(...)` vs 7 `perKid(...)`): Front Squat 60/65, Box Jump
`BW ~30"`/`BW ~36"`, Pull-Up differing in **reps** as well. So ~a third of copies land the WRONG load, and
correcting one costs N sequential V1-9 edits (a server round-trip per set) versus one form submit to type
it fresh. **The feature is net-negative on precisely the loaded barbell lifts that matter most.**

**2. It re-opens the data-integrity hole the V1-10 panel had just closed.** V1-10 refused to pre-fill the
weight field because a PRESCRIBED value would become a PERFORMED one without a human typing it. Copy-to-
sibling writes kid A's **performed** load into kid B's log as **B's performed** load — one tap, nothing
typed — and (per D7's own admission) onto a page the coach is not looking at. Once written it is
indistinguishable from a real observation and feeds both the progression story and the V1-13 CSV/Claude
retro. That is a strictly worse version of what was just rejected, and the plan was silent on it.

**3. The plan was internally contradictory, and both remaining lenses found the same break independently.**
Acceptance says "writes into that sibling's session, creating it if absent"; D5 derives the session
`client_id` from `(target profile, day)` with "no separate find-the-session query". `sessions` has **no**
unique on `(profile_id, activity_date)` — only `uq_sessions_client_id` — so a copy can never join a session
the sibling logged normally (random UUIDv7 from the form). The sibling's day would render **two** session
blocks, and V1-13 would export two sessions for one training session.

**4. Priority.** V1-11 is the only remaining v1 row with **zero downstream dependents** (V1-12/13/14 all
stand alone), while carrying the highest risk of them: the first cross-profile write, a new authz surface,
a novel idempotency scheme, a new `packages/db` query, `db:verify` proofs, four mandated boundary tests.
Meanwhile **V1-13 — "the MVP's whole point" — has not started.**

### Further defects found (relevant only if this is revived)

- **The read shape cannot feed the writer.** `writeStrengthSession` needs `day`, `sessionType`,
  `activityTypeId` and a pre-resolved `movementId`; D2's `{movementName, unit, sets}` supplies none of
  them, so the copy path would silently fabricate all four (defaulting `sessionType`, hardcoding
  `scLift`, and re-running `findOrCreateMovementId` — which can INSERT a movements row — when the source
  entry already carries `movement_id`).
- **Set fidelity is a lie against the schema.** `entry_sets` has nullable `reps`/`seconds`/`weight_num`/
  `weight_label`; the writer takes `{reps: number, weight: number}` and does `String(s.weight)`, so a
  labeled or timed set would write `'null'` into a numeric column → 22P02 → `error.tsx`. Latent today
  (nothing produces labeled sets yet), live the moment V1-8a lands.
- **The sibling list does not exist and is not household-scoped.** The Today page never imports
  `listProfiles`, and `listProfiles` filters only on `deleted_at` — so the buttons would come from an
  unscoped list while the guard is a household join: two different definitions of "sibling".
- **The UI cost is worse than stated.** Strength A is 7 movements → 7 ≥44px buttons injected into the
  logged-session block, ~300px of chrome on a 390px screen, in the coach's _verification_ surface.
- **The derived `client_id` is over-engineered and semantically wrong** — it redefines an idempotency
  token as a permanent "has been copied" natural key, and makes a deliberate re-copy impossible. Minting a
  plain UUIDv7 in the RSC render (as every other form does) satisfies "tap twice → one copy" with none of
  the machinery.
- Superset members would copy as silently-flattened standalone movements; no shared zod schema was
  planned despite promising "bad body → zod reject"; `ProfileDTO` genuinely has no `householdId` (that
  claim was accurate).

### If it is ever revived, build the SMALL version

One **session-level** "Copy to \<sibling\>" control on the logged session block (1 button, not 7 —
`writeStrengthSession` already writes a whole session graph incl. supersets transactionally, so session
copy is _less_ code than movement copy); a plain UUIDv7 minted in the RSC render; `redirect()` to the
sibling's Today for feedback; one combined query returning the full writer inputs; and an explicit written
answer to the fabricated-observation concern (#2) before any of it.

**Cheaper alternative that may make it moot:** prefill the strength form's **movement names + set count
only** (loads and reps left blank) from the V1-10 program data. No cross-profile write, no authz surface,
no idempotency puzzle — and it helps _both_ kids on _every_ strength day. Note this is adjacent to what
V1-10's panel cut, but that cut was reasoned entirely about **loads**; neither argument touches names or
set counts.

### Additional defects found by the correctness/security lens (all relevant to a revival)

- **Self-copy is unguarded.** Nothing rejects `target === source`. The derived session key does not equal
  the source's own random session `client_id`, so a self-copy creates a **second session on the source
  profile containing a duplicate of the movement the coach is looking at**. Reject in the query predicate.
- **A TypeScript household comparison is fail-OPEN.** `profiles.household_id` is nullable at the column
  level (NOT NULL only via a CHECK), so comparing two fetched ids in TS gives `null === null` → **true** →
  a cross-household copy between two household-less profiles. In SQL the same comparison is NULL → row
  filtered → fail-closed. That asymmetry is the real argument for the SQL home, and the plan never made it.
- **The derived `client_id` is PREDICTABLE, which is a fabricated-load path.** Both inputs are public ids
  rendered into A's DOM, and `logStrengthSessionAction` accepts a caller-supplied session/movement
  `clientId` validated only as `uuidSchema`. A caller can **claim the derived key first**; the real copy
  then silently ON-CONFLICTs onto the planted row and the coach sees fabricated loads under a movement he
  believes he copied. Grants nothing beyond what a direct write already allows in today's gate-only model —
  but against "the LLM never authors loads; bad loads are an injury risk" it must be salted (HMAC) or
  explicitly recorded, never left unstated.
- **Q1's premise was wrong in the plan's favour.** The delete→re-copy tension does not exist: the partial
  UNIQUE leaves tombstones outside the index, so copy → soft-delete → copy again inserts a fresh live row.
  Pin it with a `db:verify` case rather than reasoning about it.
- **Silent drops to state, not discover in review:** `status` (a `skipped` source copies as `done` — a lie
  in the log), `notes`/`context`/`scheme`/`raw_load`/`raw_reps` (no writer fields), superset membership,
  and set `idx` (re-derived 1-based, so gaps compact — the copy is not idx-faithful).
- **`entries_shape_check` is satisfied** (kind NULL + movement_name → `FALSE OR NULL` = NULL → passes) —
  one worry that turned out to be a non-issue.
- Feedback is genuinely broken, not just unpolished: because a replay is a silent no-op, the coach cannot
  distinguish "copied" from "already copied" from "rejected". `EditableSet` already crossed the client-JS
  line inside this exact list, so D6's "no new client JS" defends a line that no longer exists.
- Add the copy to the **V1-14 rate-limit list**: it is the first endpoint with an amplification shape
  (1 POST → 1 entry + N sets on a caller-named profile).
