# V1-18 — Per-kid routine builder — Design & Engineering brief

> **Reframed** from the backlog's "reorder the 4 logging sections" into what Ray actually wants: a
> **per-kid morning routine** — an ordered, buildable checklist of the activities that kid actually does,
> not a global section order. This brief grounds a staged design → engineering investigation (UX
> exploration → adversarial Staff-design review → UX decision panel → engineering panel).

## The vision (in Ray's words, paraphrased)

- **Weigh-in is mandatory and comes first** for every athlete.
- Then the kid works through **their own ordered list of activities** — e.g. rice bucket → brush teeth →
  strength (only on days it's programmed) → finishers. **"This is my kids' order, not everyone's"** — the
  selection AND order are **per-kid**.
- Activities are **added from a picker** ("a dropdown of what to add" — exact control TBD, that's part of
  the UX debate).
- So the Today page shifts from **4 fixed sections** (Bodyweight / Strength / Check-ins / Life) toward
  **one per-kid ordered sequence of activities**, where an "activity" may be a bodyweight, a check-in habit
  (rice bucket, brush teeth), a strength session, a calisthenics metric, a "finisher", etc.

## Users & context

- **Primary: the kids** — log on the gym floor on **phones/tablets (~390px first)**, often mid-session
  (possibly chalky/sweaty hands): needs big tap targets (≥44px), low cognitive load, fast top-to-bottom
  flow, obvious "what's next / what's left".
- **Secondary: Ray (coach/parent)** — sets up each kid's routine/programming; wants fidelity to the actual
  training plan (including day-specific items like strength).
- Adult-first, clean aesthetic (NOT a kid theme); kid-ergonomics come from good general design.

## What exists today (reuse surface)

- **Catalog** (`@mat-plan/shared`): `activity_type`s + categories, `metric`s, `movement`s — global, seeded.
- **Today page** (`apps/web/app/p/[profileId]/page.tsx`): 4 RSC `<section>`s (bodyweight, strength via
  `StrengthForm`, check-ins via `CheckinForm` over `CHECKIN_FIELDS`, life via `LifeForm`), then a "Logged
  entries" list (V1-17: oldest-first) + a "Calisthenics today" tally + weekly adherence.
- **Check-ins** (`CHECKIN_FIELDS`): the habit/metric fields (rice bucket, brush teeth, splits, calisthenics
  metrics, readiness) — currently **global** (every kid sees every field).
- **`profiles`** table: `id, public_id, name, kind, household_id, birthdate, avatar, pin_hash, timestamps`.
  No per-kid config/order/programming column yet.
- **Entries model**: tagged-union `entries` + `entry_sets`; sessions/supersets; soft-delete; `client_id`
  idempotency; per-profile scoping.

## Key tensions the design must resolve

1. **Granularity** — is the routine a list of the 4 _surfaces_, or a flat list of _activities_ (the richer
   read of Ray's ask)? The latter reshapes Today from sections → a per-kid activity checklist.
2. **Per-kid selection = programming.** "Rice bucket, my kids only" means each kid has their **own set** of
   activities. That per-kid selection is the front half of **V1-10 (block-template / programming)** — so
   V1-18 and V1-10 are the same subsystem. Where's the seam?
3. **Conditional items** — "strength if they have it this day" is **schedule-driven** (which day, which
   block), also V1-10. A first slice may make strength _always available_ and defer true day-scheduling.
4. **Who configures it & where** — the kid on their Today page? A parent-only settings screen? Seeded only
   for now? Drives the control's placement, a11y, and auth.
5. **Enforcing the mandatory weigh-in first** without making it feel punitive.
6. **The picker UX** — add/remove/reorder from a dropdown vs a checklist vs drag-to-reorder (deferred?).

## Constraints (non-negotiable)

- RSC-first, minimal client JS; semantic HTML; ≥44px targets; responsive from ~360px.
- No LLM authoring of loads/weights. Additive DB changes (expand-only, Squawk-safe) if a migration is needed.
- Single-source constants/enums in `@mat-plan/shared`. Scope discipline (~4h/wk) — prefer an incremental
  first slice with a clear path to the full vision.

## Success (first slice, candidate)

- Kid A's Today renders **their** activities in **their** order (weigh-in first); Kid B's differs.
- The order/selection persists per profile and is settable somehow (mechanism = the UX decision).
- Reuses the existing catalog + logging surfaces; true day-scheduling of strength can defer to V1-10.

## Investigation stages

1. **UX exploration** — 3 distinct interaction models (championing different philosophies).
2. **Adversarial Staff-design review** — poke holes in all three (a11y, kid load, gym-floor, mandatory
   weigh-in, conditionals, config burden, failure modes).
3. **UX decision panel** — evaluate against the users and pick/merge the best path.
4. **Engineering panel** — for the chosen UX: data model/migration, API/DAL, RSC-vs-client, the V1-10 seam,
   and an incremental slice plan.
