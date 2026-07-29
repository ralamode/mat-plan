# V1-18 — UX decision (Phase 3 panel synthesis → locked direction)

Inputs: [brief](./v1-18-routine-builder-brief.md) · [options](./v1-18-exploration-options.md) ·
[adversarial review](./v1-18-design-review.md) · 3 UX panelists (kid-usability · coach-fit · product-scope).
All three **endorsed the hybrid**; below is the reconciled, locked direction + the one question handed to
the engineering panel.

## The locked direction

A per-kid **routine** = an ordered, per-activity selection that reorders/reuses the EXISTING logging forms.

- **Storage:** one additive **nullable JSONB `routine_config` on `profiles`**; `null → DEFAULT_ROUTINE`
  (today's exact page) so the feature **ships dark**, no backfill. Shape = an ordered list of **namespaced
  per-activity keys** (`checkin:rice_bucket`, `strength`, `life:wake`, `finisher:*` reserved) + (later) a
  per-kid check-in allowlist. Zod schema + `DEFAULT_ROUTINE` + the key scheme single-sourced in
  `@mat-plan/shared`. Validate keys on read; drop unknowns.
- **Render:** `page.tsx` stops hard-coding 4 sections → pinned weigh-in, then `order.map(→ the existing
form for that key)`. Per-activity, interleavable, **existing forms untouched**.
- **Weigh-in:** structurally first (`'bodyweight'` is NOT a legal `order` member — pinned by construction),
  **soft** (no hard gate; a kid who weighed at home isn't dead-ended).
- **Conditional strength:** **`day_mask` is DELETED, not deferred** (weekday ≠ program-day — that's V1-10).
  Strength stays always-available; kid logs it if they did it (honest reporting). Keep ONLY a cosmetic,
  non-functional `conditional` marker on the strength item (opaque string V1-18 never reads) as the near-free
  V1-10 down-payment — V1-10 later flips it functional with no schema change.
- **Config actor:** **Ray, OFF the logging surface** (a parent route). The kid authors NOTHING — Today IS
  the kid's read-only "my routine" (ordering makes ownership legible). No kid-facing edit affordance.

## The reconciliation that resolves the panel tension (LOAD-BEARING)

Kid/coach lenses called the **accumulating-status** the one thing to get right; the product lens said there's
**no new status layer to build**. Both are right, reconciled thus:

> **Do NOT build a new checklist / done-remaining / progress-counter layer** (that's Option A's trap). Get
> per-activity interleaving AND correct accumulation display by **REUSING each existing form's own state** —
> `CheckinForm` already marks logged habits inert (`loggedFieldKeys`) and keeps accumulating calisthenics
> editable + tallied; `EditableSet` handles set edits; the calisthenics tally already computes "N so far".
> The routine is a **projection + ordering over the existing forms**, not a new status surface.

So the accumulation guarantee is met by REUSE, not by a new layer — and the false-binary risk never arises
because there is no binary layer. If a per-item progress counter is ever wanted, it's a later, separate call.

## First-slice must-haves (ranked) vs defers

**Must (slice 1 unless noted):** per-ACTIVITY ordered render (interleave) · weigh-in pinned-soft ·
`null → DEFAULT_ROUTINE` ships-dark · reuse existing forms (no new status layer) · seed ≥2 kids differently
(proves A≠B, satisfies "settable" without a UI). **Must, slice 2:** coach authoring UI (checklist + ▲▼ +
**copy-from-kid** — without copy-from-kid multi-kid setup is the chore that kills adoption) · per-kid check-in
allowlist (near-free via `CheckinForm` `fields`).

**Defer:** real day/block conditional strength → V1-10 (keep only the cosmetic marker) · `day_mask` DELETED ·
rest-day Today render → V1-10 · net-new finisher/activity TYPES → V1-10 DB catalog (slice 1 = existing keys
placed late; position makes a "finisher") · drag-reorder · kid-edit · Option-A UP-pointer/auto-scroll queue ·
`routine_config` JSONB → `routine_items` table (promote when V1-10 needs to query/join/schedule).

## Scope & sequencing (product lens, endorsed)

- **PR 1 — render-from-config + seed** (one concern): migration (nullable JSONB) + shared zod/keys/DEFAULT +
  `page.tsx` reshape + validate-on-read + seed. Passes the success test alone. **No UI, no auth, no status
  layer, no day_mask.**
- **PR 2 — coach config UI** (checklist + ▲▼ + copy-from-kid), behind the site access-gate as
  **UX-not-security** (Clerk is v1.5; tiles aren't a boundary) + a `docs/tech-debt.md` note. Only if
  hand-seeding becomes a bottleneck.
- **PR 3 — per-kid check-in allowlist.**
- **Stacking:** #60 (V1-9 `EditableSet`) and #61 (V1-17 oldest-first) BOTH touch `page.tsx`; PR 1 rewrites the
  same section-render region → max rebase conflict. **Cut PR 1 from a freshly-synced `main` AFTER #60 + #61
  merge.** Until then this waits.
- **Debt:** JSONB is a knowing exception to AGENTS.md "typed columns / JSONB-for-opaque-metadata" → log in
  `docs/tech-debt.md` with the promotion trigger.

## Open question → engineering panel

The reconciliation says "reuse each form's state," but the **mechanism** for per-activity check-ins is
unresolved and is the crux of slice-1 size:

- `CheckinForm` today is ONE form batching N fields with a single "Log check-ins" submit. Rendering
  per-activity (`checkin:rice_bucket` as its own item, interleaved) means either (a) rendering `CheckinForm`
  per-field via its `fields` prop (N single-field forms → N submit buttons, loses the batch), or (b) keeping
  check-ins as ONE block in slice 1 (block-level reorder, per-habit interleave deferred), or (c) a small
  refactor separating the per-field render from the batch submit.
- **The eng panel must decide the rendering mechanism + confirm slice-1 granularity** (true per-habit
  interleave now, vs per-activity data shape with block-level render now + interleave in a later slice),
  balancing Ray's literal interleave example against the ~4h/wk budget and form reuse.
