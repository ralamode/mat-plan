# V1-18 — Phase 1 UX exploration: the three options (synthesis)

Grounding: [brief](./v1-18-routine-builder-brief.md). Three design agents each championed a philosophy.
Faithful condensation below for the adversarial review + panels.

## Option A — "What's Next" (kid-first autonomy / minimal cognition)

- **Interaction:** Today becomes ONE vertical checklist of activity cards, weigh-in first. Three states:
  **DONE** (collapsed, quiet, above) · **UP** (exactly one, bright, auto-scrolled, input inline) · **REMAINING**
  (dim, below). Header "3 of 7 done". Kid just does the bright card → it collapses up → next lights. Habit =
  one big ≥56px Done tap; numeric = focused field + Log; strength = a "Start strength →" launcher (heavier
  flow not inlined).
- **Edit:** a small "Edit routine" link (out of the daily flow) → the same list in edit mode: a **checklist**
  (checkbox = in/out — the "picker" is a checklist not a dropdown) + ▲▼ nudge reorder; weigh-in pinned/locked
  at 0; each toggle/nudge auto-saves via a Server Action. Kid (or parent) can edit.
- **Data:** a per-profile `routine_items` table — `{activityKey, metricKey|null, position, enabled,
conditional|null}`; key == `CheckinField.key` (`activityKey` or `activityKey:metricKey`), so items project
  onto existing forms. No new logging widgets.
- **Weigh-in:** system-owned, pinned pos 0, locked in edit; **soft** enforcement — always the UP card on load
  - a persistent "⚠ Weigh-in still needed" chip; NOT a hard gate (avoids dead-ends/fake taps).
- **Conditional strength:** **deferred to V1-10.** Now: strength is always present with a cosmetic "(on
  program)" badge storing `conditional: "programmed_day"`; when V1-10 lands the same flag flips functional
  (auto-hide/"Rest today") — no schema change.
- **Pros:** lowest cognition (one thing at a time + explicit progress); kid ownership; dead-simple setup;
  maximal reuse; RSC-friendly (only UP card hydrates). **Cons:** the "UP" pointer can feel bossy / mis-point
  when a kid works out of order (self-corrects, never blocks); auto-scroll can disorient; **accumulating
  calisthenics never cleanly "completes"** (muddies done/remaining — needs an explicit "finished" affordance);
  soft weigh-in can be ignored; long routines still scroll; strength breaks the "all inline" metaphor.
- **V1-10 seam:** it's the UI+storage of programming minus the schedule; V1-18 owns selection+order, V1-10
  owns _when_. **First slice:** add `routine_items` + seed a default matching today's set; Today renders the
  ordered routine (DONE/UP/REMAINING + counter, weigh-in first); edit screen = checklist toggle + ▲▼. No V1-10
  dependency; meets the success test.

## Option B — Coach-programmed fidelity

- **Interaction:** authority flows one way. **Coach authoring lives OFF Today** at `/p/[id]/program`
  (parent-gated): an ordered list of activity slots from the catalog, add via a picker sheet, ▲▼ reorder, and
  a **per-row 7-day toggle (`day_mask`)**. The **kid's Today is a pure projection** for today's weekday: no
  sections, weigh-in pinned, then each programmed slot whose mask includes today, rendering the existing
  control. A masked-out item is **absent** (not greyed). "↓ N left" counter. Kid can't edit; optional "＋ log
  something else" escape hatch for ad-hoc logs.
- **Data:** `routine_items` table — `{activityKey, metricKey|null, position, day_mask int (7-bit weekday
bitmask), enabled}`; unique (profile_id, position). Today filters `WHERE profile_id=? AND enabled AND
(day_mask >> weekday)&1`. Weigh-in is NOT a row (structural constant).
- **Weigh-in:** structural slot 0, non-authorable (can't be deleted → can't exist a kid without it); soft "N
  left" nudge, not a lockout.
- **Conditional strength:** **handled NOW** via `day_mask` — the model's headline strength. Strength `[M,W,F]`
  is simply absent Tue/Thu; no greying/dead controls. Any day-specific item (finishers, skill days) works the
  same.
- **Pros:** highest fidelity to Ray's mental model (per-kid day-aware plan, his order); lowest kid load (only
  today's real slots; absent ≫ greyed); structurally-correct weigh-in; **clean V1-10 on-ramp — `routine_items`
  IS the programming substrate, V1-10 adds a generator above it, not a rewrite.** **Cons:** **setup burden on
  Ray is the real cost** (every kid hand-built before Today is useful — mitigate: seed a default routine +
  "copy from another kid"); **deep V1-10 coupling** (if V1-10's block model diverges, migrate or maintain
  two); low kid autonomy by design; net-new authoring interactivity.
- **V1-10 seam:** V1-18 = table + read projection + **manual** authoring; V1-10 = **generating/refreshing**
  those rows from block templates + a schedule. **First slice:** add `routine_items`; seed default routine;
  kid Today renders the weekday-filtered projection (ships day-conditional strength _for real_ via day_mask);
  minimal `/program` = picker + ▲▼ + 7-day toggle. Defer drag + escape hatch.

## Option C — "Ordered Blocks" (incremental / minimal-build)

- **Interaction:** the SMALLEST genuinely-per-kid thing. Two dials, both per-kid: (1) **order + presence of
  the 3 movable SECTIONS** (Strength, Check-ins, Life) — Today renders them in the kid's order, an unchecked
  section is hidden; (2) **a per-kid check-in allowlist** over the global `CHECKIN_FIELDS` (this delivers
  "rice bucket, my kids only" — `CheckinForm` already takes `fields`, so pass a subset). Weigh-in hard-rendered
  first, above the map. Config by **Ray on `/p/[id]/routine`** (parent), not the kid, not inline.
- **Render:** `page.tsx` stops hard-coding 4 sections; renders pinned weigh-in then `order.map(switch → existing
<StrengthForm>/<CheckinForm fields=subset>/<LifeForm>)`. Same components, same DAL reads.
- **Data:** ONE additive **nullable JSONB column** on `profiles` — `routineConfig: { order:
RoutineBlockKey[]; checkins: string[]|null }`, zod-validated in `@mat-plan/shared`; `'bodyweight'` is NOT a
  legal `order` member (weigh-in pinned by construction). `null` ⇒ `DEFAULT_ROUTINE` = today's exact page →
  **ships dark**, no backfill.
- **Weigh-in:** structurally first (above the map; `'bodyweight'` illegal in `order`); non-punitive, no gate.
- **Conditional strength:** **deferred.** Strength is an always-available block; NOT hidden on non-programmed
  days. Anti-corner: strength is already a discrete keyed **block**, so V1-10 adds an optional `schedule` +
  a "not programmed today" render state — additive, no Today surgery (vs today's hard-coded inline strength).
- **Pros:** one PR, boring/robust (1 nullable JSONB col, 1 zod schema, 1 settings page + thin action, ~10-line
  page change, all forms reused); genuinely per-kid (order + which habits) incl. the literal rice-bucket
  criterion; backward-compatible/reversible-by-omission/ships-dark; hard rules enforced structurally. **Cons:**
  **section-granular — CANNOT interleave a single habit between Strength and a finisher** (the richest read of
  Ray's flat-list vision); JSONB refs catalog keys with no FK (dangling risk → validate on read, drop
  unknowns); parent-only config defers the kid-edit question.
- **Upgrade path (no rewrite):** widen `ROUTINE_BLOCK_KEYS` from 3 sections to namespaced per-activity blocks
  (`checkin:rice_bucket`) → true interleaved flat flow, same array/`.map`, no migration; add strength
  `schedule` for conditionality; catalog→DB-driven later; drag + kid-edit are pure-UI adds; JSONB→table only if
  versioning ever needed. Monotonic: every step widens a value set or adds an optional field.

## The decision axes (for the panel)

1. **Granularity:** flat per-ACTIVITY list (A, B) vs per-SECTION + check-in subset (C). Ray's "rice bucket
   first" example implies per-activity interleaving — does C's section-granularity satisfy the vision or miss
   it? Does A/B's full Today reshape over-reach for a first slice?
2. **Storage:** new `routine_items` table (A, B) vs one JSONB column on `profiles` (C).
3. **Configured by:** kid on Today (A) vs coach off-Today (B, C).
4. **Conditional strength:** `day_mask` NOW (B) vs deferred-to-V1-10 (A, C). Is doing it now over-scoping into
   V1-10, or is deferring it dodging something Ray explicitly asked for?
5. **Build size vs ~4h/wk:** C = ~1 PR ships dark; A/B = new table + Today reshape + edit/author screen.
6. **V1-10 coupling:** B binds tightest (routine_items = programming substrate); A/C keep V1-18 lighter and let
   V1-10 extend.
