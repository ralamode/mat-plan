# V1-18 — Phase 2 adversarial Staff-design review (synthesis)

Reviews the [three options](./v1-18-exploration-options.md) against the [brief](./v1-18-routine-builder-brief.md).

## Killer criticisms per option

- **A ("What's Next", kid-autonomy):** (1) the done/UP/remaining **checklist metaphor breaks on accumulating
  calisthenics** — `checkin-fields.ts` marks those `accumulates:true` and DELIBERATELY excludes them from
  `loggedFieldKeys` so they never go inert; A's whole UI imposes completion on data engineered not to
  complete, and "add a finished affordance" is undesigned. (2) **Kid-editable programming is the wrong actor
  - a permission hole** — Ray authors ("MY kids' order"), and profile tiles are "a UX switch, not a security
    boundary," so any kid could mutate anyone's routine. (3) Biggest build, and STILL defers day-conditional
    strength — most expensive, misses Ray's headline.
- **B (coach-programmed):** (1) **`day_mask` encodes the WRONG model now** — "strength if they have it that
  day" means the program's block/phase day (= V1-10), not "Tuesday"; a weekday bitmask is wrong the first
  deload/shifted-meet week, and it's the TIGHTEST coupling to a substrate shape committed before V1-10 exists.
  (2) **It punishes honest reporting** — a masked-out item is _absent_ and the escape hatch is deferred, so a
  kid who DID strength off-plan has no control to log it (directly violates "honest reporting > enforced fake
  data"). (3) Highest setup cost (per-kid hand-build, per-row 7-day toggle) against the tightest budget.
- **C (Ordered Blocks, minimal):** (1) **Section granularity can't express Ray's literal sentence** — "rice
  bucket → brush teeth → strength → finishers" interleaves individual habits around strength; C orders the
  Check-ins _block_, so every habit is trapped inside it. (2) **"Finishers" have no home** among Strength/
  Check-ins/Life. (3) BUT it's the only option that respects 4h/wk, ships dark, and its miss is **recoverable**
  (monotonic upgrade), and the per-kid check-in allowlist via `CheckinForm`'s existing `fields` prop is a near-
  free real win.

## Axis verdicts

1. **Granularity → per-ACTIVITY, but don't conflate data granularity with UI teardown.** Ray interleaves, so
   per-section (C) misses fidelity; but "flat list" ≠ rip out the 4 sections (A/B over-reach). Right target: a
   stored ordered list of **activity keys** rendered `order.map(switch → existing form)` — interleaving with no
   Today rewrite.
2. **Storage → JSONB for the first slice.** Nothing queries INTO the list (only B's `day_mask WHERE` does, and
   that's the feature to cut); all options validate keys on read anyway. Promote to `routine_items` when V1-10
   needs to generate/join rows. (Honest caveat: AGENTS.md prefers typed columns / JSONB-for-opaque-metadata —
   routine config is borderline; accept it for the first slice.)
3. **Config actor → coach, OFF the logging surface.** Kid-inline (A) is wrong-actor + a permission hole; kid
   autonomy belongs over _logging_, never _programming_.
4. **Conditional strength → defer.** B doesn't "do it," it MIS-does it (weekday hard-code). First slice:
   strength always available, kid logs it if they did it (honest reporting); real conditionality = V1-10's
   schedule.
5. **Build vs 4h/wk → C wins decisively.** A/B are both new-table + Today-reshape + net-new authoring; B's
   per-row 7-day toggle is the worst offender. This axis alone disqualifies A/B _as a first slice_.
6. **V1-10 coupling → loose (A/C) beats B's "substrate" bet** placed before V1-10 is designed.

## Traps nobody named

- **A routine is NOT a checklist — the accumulation problem is the whole ballgame.** The page already computes
  `loggedFieldKeys → inert` per field but EXCLUDES accumulating calisthenics so it stays editable. Any
  done/remaining framing breaks on the highest-volume activity.
- **The parent-gated config page has no gate** — Clerk is v1.5; today only an access-gate stopgap, and tiles
  aren't a security boundary. Nobody costed the auth dependency.
- **Cold start / multi-kid / rest days** — only C's `null → DEFAULT_ROUTINE` ships dark; no option designs the
  **rest-day** Today (a real recurring day).
- **Edit/undo on the gym floor** — chalky mis-taps guaranteed; logging has `EditableSet` but the routine has no
  un-log / "wrong Done tap" correction.
- **Weigh-in-first assumes weigh-in happens in THIS session** — kids often weigh at home earlier; none handle
  "already weighed elsewhere."

## Recommendation (going in): a HYBRID, not any option as-drawn

**C's build + A/B's per-activity data granularity.** One additive `routineConfig` on `profiles` (JSONB, ships
dark via `null → DEFAULT_ROUTINE`), **Ray-authored on a parent config page** (gated behind the access-gate
stopgap until Clerk), reusing every existing form — but storing an **ordered list of per-activity keys**
(namespaced `checkin:rice_bucket`, `strength`, `finisher:*`), NOT three section keys, rendered by
`order.map(switch)`. **Drop `day_mask`** — strength stays always-available; conditionality is V1-10. Keep the
per-kid check-in allowlist (cheapest real win).

**The one thing the design MUST get right:** reconcile the routine's "what's left / what's next" state with the
**accumulating** reality in `checkin-fields.ts`. Derive each item's status from actual entries (the page
already computes `loggedFieldKeys`), and give accumulating activities a distinct "logged N so far, still open"
state — never a binary done/not-done. Everything else is recoverable; this is the decision that isn't.
