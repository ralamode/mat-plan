# ONB-1 — self-serve onboarding (PRD)

> **Status: PRD — a product requirements draft, NOT a plan.** No file-by-file breakdown, no
> sequencing commitment, no engineering panel. It states what the product must do and why; **how** is a
> later plan (or several). Written to be iterated on. **v2+ territory** — nothing here is approved.
>
> Backlog: [plan.md](../plan.md) row **ONB-1**. Related: **AI-1** (NL logging — same machinery),
> **V1-18** (`routine_config` + its editor — already shipped), **V1-10** (the programming tables),
> **V1-19** (the "names and structure only, loads stay BLANK" boundary), **V1-21** (interaction design).
>
> Reviewed by a **2-lens UX panel** (first-run/cognitive-load; trust/safety/data-entry) on 2026-08-12.
> Their findings are folded in below; the discussion log at the end records what changed and why.
>
> **Ray answered the decision-shaping questions on 2026-08-20** ([PR #106](https://github.com/ralamode/mat-plan/pull/106)).
> Six of the eight are now closed and are written into the requirements as decisions, not options; the
> discussion log records each one. The largest consequence: **no questionnaire is needed at all**, and
> **`movements` gets household scoping** before any multi-tenant writing.

## The problem

Onboarding a new family today costs **a code change and a deploy**. Verified against the tree:

| Thing            | Today                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------- |
| Athlete profiles | `packages/db/src/seed.ts` is the **only** writer — hardcoded UUIDs and names              |
| Auth / tenancy   | one shared access-gate password; `getProfileByPublicId` is an existence check, not scoped |
| Daily routine    | ✅ **already self-service** — V1-18's per-kid checklist + reorder editor                  |
| Strength program | `PROGRAM_SEED`, a TypeScript const. **No authoring UI exists at all**                     |

The good news, and why this is a feature rather than a rewrite: **the data model is already
multi-tenant.** `households` exists, `profiles.household_id` FKs to it, and the DAL was designed around
household scoping. The gap is **authoring surfaces and auth**, not the schema.

### P0, and independent of everything else: first-run is broken today

A new household has `routine_config = null`, which `resolveRoutine` maps to `buildDefaultRoutine` over
the seeded catalog — **Rice bucket · Brain rep · Splits · Brush teeth**. So a stranger's first screen is
_Ray's family's routine_, in Ray's family's shorthand ("Brush teeth" is a wrestling drill block with
stance/ladder/bridge/pressure sub-metrics — a new coach reads it as dental hygiene). And before that,
`apps/web/app/page.tsx:25` renders, to a human: **"No profiles found. Seed the database to get
started."**

This is the cheapest thing in this document to fix, it blocks any self-serve onboarding, and **it is not
caused by anything else here**. Filed as its own backlog row — **ONB-0** in [plan.md](../plan.md) — and it
can ship long before ONB-1. Ray's Q1 answer (R2) is its spec: an explained empty state plus a route into
the movement editor, not a questionnaire.

## Who this is for

A wrestling parent or coach setting up for their kid(s). **Phone-first** (per AGENTS.md), used at home
or on a gym floor. They are not necessarily an S&C expert — that is the whole premise, and it is what
makes every "just confirm this" interaction suspect.

## Goals / non-goals

**Goals.** A stranger can create athletes, get a sensible daily routine, and log real data — without a
developer. If they already have a training plan, they can get it into the app without retyping it from
scratch.

**Non-goals.** Authoring training plans _for_ people. Generating programs. Any LLM involvement in
choosing a load — see the safety model. Nothing here changes the daily logging experience, which is the
part that already works.

## Two plan shapes, and only one of them needs AI

The single most important product finding. **"100 push-ups a day + 50 pull-ups a day + a couple sets of
wall sit"** is not a prescription and must never be routed through prescription machinery.

**They arrive together.** Ray (Q2): a daily calisthenics goal — 100 push-ups, 50 pull-ups — is a **common
add-on** to a structured plan. _(Note the precise claim: common add-on. Ray explicitly does **not** know
what share of parents use them, and nothing here should assume a prevalence he didn't state.)_ Parents give it —
**on top of** a structured 2–5×/week S&C plan, because calisthenics is the baseline thing a wrestler can
do anywhere, at practice or at home. So the two shapes are not a fork the user picks between; **one
document routinely contains both**, and the extractor's job is to **split** it: structured rows to
prescriptions, daily counts to `ramp_targets`, prose to neither (R7a).

| Shape                                                      | Storage                                                        | How it gets in                                                    |
| ---------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Daily targets on a counter** ("100 push-ups a day")      | `ramp_targets` on accumulating calisthenics metrics (V1-6a/6b) | **Typed. Three numbers in a form.** No LLM, no confirm gate, ~30s |
| **Structured program** (a trainer's sheet, sets×reps×load) | `program_blocks → prescriptions → prescription_targets`        | Import — where extraction earns its cost                          |

Both already exist in shipped code. `CALISTHENICS_METRIC_KEYS` covers push-ups / pull-ups / v-sits with
a daily totals card, and `ramp_targets` is a per-week numeric target per metric with SQL adherence.

**A daily target must never render as `1 × 100`.** The kid does 20 at a time across the day and the
totals card accumulates toward 100 — coercing that into sets×reps breaks the accumulation model the
V1-6 design review called "the whole ballgame". One real gap: there is **no timed calisthenics metric**,
so "a couple sets of wall sit" has nowhere to go. That is one catalog row, not a subsystem.

## Product requirements

### First run

- **R1.** A new household must never see another household's routine or any developer-facing string.
- **R2. There is no questionnaire.** _(Ray, Q1.)_ A stranger's first Today is an **explained empty
  state**: what this app is, what happens next, and a control that takes them to — or inlines — the
  place they author their movements. Time-to-first-value is still one screen and two fields (a name,
  then a weigh-in; `bodyweight` is deliberately not a legal member of `order`, so weigh-in is pinned
  first by construction), but nothing is _asked_ before that. This removes an entire subsystem from the
  document: the first-run flow is now an empty state plus surfaces that already exist.
- **R3.** Athlete creation is a form with "+ Add another", **not** a "how many athletes?" counter that
  gates everything behind it.
- **R4.** Routine authoring **reuses the shipped editor** (`/p/[profileId]/routine`). Building a second
  way to write `routine_config` is the thing to avoid; a wizard that duplicates an existing surface is
  cost with no new capability. With R2, this is the whole of "setup".
- **R5. Equipment is cut, permanently, not deferred.** _(Ray: the parent/coach authoring the plan
  already knows their own equipment situation and will only write movements their kid can do.)_ Combined
  with "the app never suggests movements" (Q11, closed), **nothing will ever read an equipment column**,
  so it should not be modelled. "What do you want to get better at?" is likewise cut — it is a vaguer
  version of the routine editor's concrete activity picker.

### Import (only for the structured shape)

- **R6.** Import is **offered contextually** — on the strength surface, when the user hits the gap — not
  as a wall during first run, before they have any reason to trust the app.
- **R7.** The extractor emits only what the source **literally states**. Every field is nullable;
  anything not literally present is `null`, never inferred. `"a couple of sets"` → `sets: null`. This is
  what makes "transcription, not authorship" true rather than aspirational.
- **R7a. The extractor refuses free-form prose outright.** _(Ray, Q3: "Yes it should refuse prose.")_
  When it cannot find structure, it does **not** guess — it says so and routes the user to the
  daily-targets form. The reasoning: a structured row (`Back squat 3×8 @ 65`) is _transcribable_ — every
  number is on the page, so the model copies and the human proofreads. Prose has **no ground truth**:
  `"a couple" → 2` is the model inventing a number, and once that number sits in a field the human's
  confirm is a rubber stamp against nothing. Refusing removes the only real rule violation in the
  feature. Because both shapes arrive in one document (above), "refuse" means **refuse that fragment**
  and route it — never reject the whole import.
- **R7a-1. Import normalizes to OUR schema — never the reverse.** _(Ray, 2026-08-26: "when they upload
  their CSV it could look any way; we need AI to scrape the data and normalize it to fit our system, not
  the other way around.")_ The extractor's job is **conformance**, not accommodation. A value that cannot
  be normalized into a typed field is **surfaced for a human — never stored as a string "for later."**
  This is the rule that stops import from silently re-widening the schema every time someone uploads an
  odd sheet, and it is why a **native** user — one who authors their program in the app and performs it
  there — can never produce these shapes at all. Depends on **GAP-3**
  ([ADR 0004](../decisions/0004-typed-measurements.md)), which removes free-text values from the log path
  so there is a typed target to normalize _into_.
- **R8. Risky values are never model-written — but they are one tap to fill.** _(Ray, revising the
  panel's "type it" position.)_ Risky = _error is not self-limiting_: external load, height, distance,
  rep counts, plus movement identity. The extracted text is shown as **static, unwritable source**
  beside an **empty** field — _"your sheet says 65"_ — and a **tap fills it**. Self-limiting values
  (`BW`, `band`, durations) import directly.
  - **What makes tap-to-fill safe here, and the constraints that must hold.** It is a single deliberate
    gesture on **one** value, at the **moment of use** (R8a), with the source **visible beside it**.
    That is categorically different from a bulk confirm screen, where one habituated gesture accepts
    twenty numbers the user never read. The safety is entirely in those three properties, so:
    **there is no "fill all", no "accept remaining", and no multi-load bulk affordance — ever.** A
    control that fills more than one load at a time re-creates exactly the theatre R8 exists to prevent.
  - The value written is **still the human's act**, and nothing is written to `prescription_targets`
    until the tap. Note `program-reference.tsx` is currently read-only by deliberate design (~90% of
    authored loads are text a `type="number"` field cannot hold, and prefilling would let a
    **prescribed** load be submitted as a **performed** one). **The edit target here is the
    prescription, not the log field** — that distinction is load-bearing and must survive into the plan.
  - **Placeholder, not value (Ray, 2026-08-26).** On the **performed** field the suggestion is a
    `placeholder`, never a `value`: the field is `required`, and **a placeholder cannot satisfy
    `required`**, so affirmative human entry is enforced _mechanically_ rather than by discipline. Its
    one flaw — a placeholder clears on the first keystroke — is already covered here, because
    `program-reference.tsx` renders the card **directly above the form** and states the load durably as
    `65 suggested`. Placeholder-**only** would be wrong: it signals "suggestion, not entry" through grey
    styling alone, which the card's own comment (`:58-59`) deliberately refuses. Tap-to-fill is retained
    for the **import** flow, where no such card exists and 20 loads of typing is the burden import exists
    to remove.
  - **Superseded premise:** the V1-10 card was read-only partly because ~90% of authored loads were text
    a `type="number"` field could not hold. GAP-1 P0-2 removed that constraint, and **GAP-3 removes text
    loads entirely** — so under GAP-3 the performed field is numeric again and this argument is spent.
    What survives is the _other_ half: a prescribed load must never be submittable as a performed one.
- **R8a. Confirmation is deferred to first use.** _(Ray, Q4.)_ There is **no bulk confirm screen.** An
  imported load surfaces on the existing V1-10 reference card the day that movement comes up, and is
  filled/confirmed there, standing at the bar. This deletes the majority of the import UI, and with it
  the "20+ rows on a 390px screen" problem both panels raised.
- **R9. Units are selected by the human — at first run and again at import — never inferred.** _(Ray.)_
  **The gap is wider than import.** Verified against the tree: `entry_sets.weight_num` is `numeric` with
  **no unit column** (`packages/db/src/schema.ts:191`), and `prescription_targets.load` is verbatim text
  with no unit (`:544`). `movements.unit_default` exists and FKs to `units.code` (`:255`) but **nothing
  in the app reads it**. Only weigh-ins carry `lb | kg`. So **a kg household is unrepresentable across
  the entire strength path today** — ONB-1 merely exposes it. **Now owned by GAP-3**
  ([ADR 0004 §6](../decisions/0004-typed-measurements.md)), which absorbed the standalone UNIT-1 row:
  units come from the reference table, the movement declares the dimension, the household sets the
  magnitude once, and **the resolved unit is stored on the row** — because a household-preference-only
  design silently reinterprets all history the day the preference changes (45 lb → 45 kg, the same 2.2×
  error class). Still a **prerequisite** for import, not a sub-task of it.
- **R10.** **Athlete↔column mapping on a multi-athlete sheet is an explicit human step**, confirmed
  before any row renders. A silent column swap assigns the 13-year-old's loads to the 8-year-old — the
  highest-consequence single failure available in this feature.
- **R11.** Multi-athlete reuses **copy-to-sibling** (V1-11's shape): confirm one athlete, then copy and
  fix only the deltas. Never a two-column confirm on the narrowest screen. In `PROGRAM_SEED`, `both()`
  covers most rows and `perKid()` a minority, so the sibling pass is a handful of edits.
- **R12.** Nothing is written until confirmed, and a partially-finished import **survives leaving the
  page**. With R8a, "unfinished" is the normal steady state — loads fill in over the first cycle, not in
  one sitting — so this is a permanent property of the model, not a crash-recovery nicety.

### Tenancy — `movements` is scoped by household

- **R12a. `movements` gets household scoping, and it lands before any multi-tenant writing.** _(Ray,
  closing an open question.)_ Free-text names are the **right** product call — different coaches
  genuinely say "RDL" and "Romanian deadlift" and neither should be forced to adopt the other's word.
  The defect is not the free text, it is that `movements` is a **single global table with no
  `household_id`** (`packages/db/src/schema.ts:247-268`). Four consequences, all verified:
  1. **`slug` is `.notNull().unique()` globally** (`:252`) — two households both adding "RDL" **collide
     at the database level**. That is a hard write failure, not an annoyance.
  2. **Every movement picker shows every household's names** — a stranger's catalog fills with other
     families' shorthand.
  3. **Split history.** Progression and "last performed" key off `movement_id`, so one kid's "RDL" and
     "Romanian deadlift" accumulate as two unrelated histories of the same lift — which silently
     corrupts exactly the input R18's progression engine depends on.
  4. **Leakage.** Free text carries a child's name or a gym's name into a globally-visible table
     (OSS-1's data-audit discipline applies).
- **R12b.** The shape: `movements.household_id` **nullable** — `null` = the seeded global catalog
  everyone sees, non-null = this household's own — with the uniqueness constraint moving from `slug` to
  **`(household_id, slug)`**. Aliases/synonyms are a later, optional refinement, not part of this.

### Safety model

- **R13.** The inviolable rule holds: **the LLM never authors a load.** Extraction is transcription. The
  honest caveat is that this is _weaker_ than the V1-10 precedent, not stronger — see the discussion log.
- **R14.** **Provenance is per-field, not per-row** (`human | imported_unconfirmed | imported_confirmed |
engine`), because a row is legitimately half-imported and half-typed. One marker, one position, on
  every surface a number appears. _Alternative worth costing: a **staging table** for unconfirmed
  imports, which makes "unconfirmed in the live program" unrepresentable and needs no migration on
  `prescription_targets`._
- **R14a. The marker is visible for the first workout after import, then it clears.** _(Ray, Q4.)_ It
  earns its place exactly once — the first time you meet that movement, when the number in front of you
  came off a sheet you haven't checked in the app yet. After that first use it is noise on a number the
  human filled themselves. **Provenance is still stored permanently** (R14/R15 need it for drift
  detection and whole-import undo); what expires is the **display**, not the record.
- **R15.** An **`imports` record** holds the raw source, model + version, timestamp, and per-field source
  anchors, with every extracted row FK'd to it — which is what makes **whole-import undo** possible.
- **R16.** **Error recovery has a detection signal, and it already exists in the data.** The app logs
  _performed_ against _prescribed_, and the CSV contract calls that gap "the entire point of the column".
  A persistent gap on an imported-unconfirmed load is the only automated smoke alarm available — and
  computing it is **arithmetic on two human-written values, not authorship**. The dangerous case is not
  `170` for `70` (self-limiting — the kid fails the rep) but `85` for `65`, which they grind while
  nothing notices. _(Ray agrees `170`-for-`70` is not a real scenario — a parent won't load it and the
  kid can't lift it. That is the case this requirement already discounts; `85`-for-`65` is what it is
  for. And with R8 — no model-written load — the misread case is largely designed out rather than
  detected.)_
- **R16a. Verification after import is loads-only.** _(Ray, Q5.)_ Nothing asks the coach to re-read the
  whole plan against the paper. A wrong movement name or rep count is **visible and self-correcting** the
  first time the card is read; only the numbers that can hurt get a check. This is ~4× less work than a
  full field-by-field re-read, and it largely dissolves under R8 + R8a anyway: a load the human tapped to
  fill, at the moment of use, with the source beside it, **has already been verified by construction.**
- **R17.** Correction is **one tap from where the load is displayed**, not buried in an editor the coach
  must discover. (The routine editor is URL-only and unreachable today — V1-20. Don't repeat that.)
  Ray's framing for the reference card: the load is right there, editable, with a light nudge that it
  can be changed — _"this is the suggested load, feel free to change it."_
- **R18.** Progression is deterministic, in `packages/engine`, never an LLM. Two invariants:
  **bounded step** — a load may only move a bounded step from something already performed, never a leap;
  and **staleness** — beyond a threshold the engine **proposes nothing** and the card shows a dated fact
  (`Last performed: 65 lb · 14 Apr`). The absence of a suggestion is the message: no warning, no block,
  no "detraining" (clinical, judgmental, and often wrong — the kid may have been in season).
- **R18a. Suggested loads are an explicit goal — and this requirement is how they arrive.** _(Ray: the
  model should not write loads, but eventually the app should suggest a load and reps from past
  performance using known progressive-overload systems.)_ That is precisely R18's engine, and the
  distinction that makes it safe is worth stating plainly rather than leaving implicit:
  - The input is the **athlete's own logged, human-entered performance** — so a suggestion is
    arithmetic over human-written values, the same principle that makes R16's drift check legitimate.
  - The rule is a **named, published progression scheme**, not a judgment. It is deterministic, covered
    by golden vectors, and **auditable** — you can point at the rule that moved the load, which an LLM
    can never offer.
  - It stays a **suggestion on a card the human fills**, subject to R8's bounded step and R18's
    staleness rule. The engine proposing a number is not the engine writing one.
  - **This is where "calibration" lives, and it is not an AI feature.** Nothing in it needs a model, and
    routing it through one would trade determinism and explainability for nothing.
- **R19.** An imported plan may **never** touch the log path (`entries`/`entry_sets`). Worth an explicit
  invariant test.

### Tone

- **R20.** **The app's voice is a receipt, not a coach.** Every string in the import flow must be
  phraseable as _"your sheet says X"_ or _"you logged X"_. If it can't, it probably shouldn't ship —
  a testable copy rule, enforceable in review like the semantic-HTML rule, that does the liability work
  with no legal furniture. "Import your plan", never "Set up your training program". The empty state is
  the strongest position available and it is free: _"No plan yet — you can log without one."_

## Closed (Ray, 2026-08-20)

The decision-shaping set is answered. Each is now written into a requirement; kept here so a later
reader can see what was chosen and what it displaced.

| #                    | Question                               | Decision                                                                                                                    | Lands in     |
| -------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 1                    | Stranger's first Today                 | Explained empty state + a route into the movement/workout editor. **No questionnaire.**                                     | R2, R4       |
| 2                    | Daily targets vs. structured week      | **Both, layered** — calisthenics goals are a _common add-on_ to a structured plan (share unknown). One document, two paths. | "Two shapes" |
| 3                    | Refuse prose?                          | **Yes** — refuse the fragment, route it to the daily-targets form.                                                          | R7a          |
| 4                    | Defer confirmation to first use?       | **Yes**, with a marker for the **first workout after import** only.                                                         | R8a, R14a    |
| 5                    | Re-read everything, or just the loads? | **Just the loads.**                                                                                                         | R16a         |
| 6                    | Is import phone-capable?               | **Yes for CSV / Sheets**; a photo of a paper sheet is a separate, later, non-phone problem.                                 | phasing      |
| 11                   | Ever suggest movements?                | **No** → equipment is never modelled. Cut permanently.                                                                      | R5           |
| _(also, unprompted)_ | `movements` scoping                    | **Scope by household**, before any multi-tenant writing.                                                                    | R12a, R12b   |
| _(also)_             | Units                                  | **Human selects** — at first run and at import.                                                                             | R9           |
| _(also)_             | Load suggestion                        | Wanted eventually, from past performance + a published overload scheme — **the engine, not AI.**                            | R18a         |

## Open questions

**Still need a decision:**

1. **Provenance column, or staging table?** (R14) — R8a makes this sharper, not softer: with
   confirmation deferred across a whole cycle, "unconfirmed rows live in the program for weeks" is the
   normal state, which is an argument for the staging table _or_ an argument that the column is
   unavoidable. Worth costing both.
2. **Correcting an imported load — version or overwrite?** `prescription_targets` has no versioning, and
   the V1-10 review already found a two-live-rows hazard in the soft-delete + reinsert idiom. Determines
   whether historical `prescribed` export stays faithful.
3. Are "Rice bucket" / "Brain rep" / "Brush teeth" names a stranger should see, or family shorthand?
   (Bears directly on the P0 default routine.)
4. Wall-sit: counted in seconds, ticked off as done, or ignored? (No timed calisthenics metric exists —
   and with R7a refusing `"a couple sets of wall sit"`, this is now the question of where that input
   goes instead.)
5. Retention of an uploaded source image — how long, and where? It is a stranger's child's plan and may
   carry other kids' names (OSS-1's data-audit discipline applies). _Deferred with photo import._
6. **How long is too long** for setup before the first weigh-in? Your number is the budget for the rest.
   Much cheaper to hit now that R2 removed the questionnaire.
7. **Would you launch with no import at all** — profiles, routine, logging only — and wait to see if
   anyone asks? Import is still the majority of the cost in this document, even after R8a deleted its
   biggest screen.

## Phasing sketch (illustrative, not committed)

| Slice   | Scope                                                                           | Why here                                                                     |
| ------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **P0**  | Fix first-run: real empty state (R2) + a neutral default routine                | Independent of everything else; blocks any stranger using the app            |
| **0**   | **Clerk** (v1.5, already planned)                                               | The tenancy boundary. Nothing below is safe without it                       |
| **0.5** | **`movements` household scoping** (R12a/R12b) + **units on the load path** (R9) | Both are **prerequisites**, not cleanups — a global `slug` UNIQUE fails hard |
| **1**   | Profile CRUD                                                                    | Small; `seed.ts` is the only writer today                                    |
| **2**   | Daily-targets form → `ramp_targets`                                             | **A stranger has a working app here.** No AI, no new tables                  |
| **3**   | Import: paste/CSV → literal extraction → prose refused → tap-to-fill loads      | The first LLM surface. Reuses AI-1's structured-output machinery             |
| **4**   | Photo / multimodal import                                                       | **Not** a simple "input widening" — and the one part that isn't phone-shaped |
| **5+**  | Engine progression + suggested loads (R18a)                                     | Wanted, deterministic, and independent of import                             |

**Slices P0–2 contain no AI at all**, and both panels independently concluded that is where the value is.

Ray's answers moved two things: **0.5 came into existence** (scoping and units were open questions and
are now blocking prerequisites), and **equipment left the table entirely** rather than sitting in "5+".

## Discussion log — what the UX panel changed

- **"Extraction keeps the rule intact by construction" was overstated.** The V1-10 panel refused to
  prefill loads that were _Ray's own, hand-transcribed, verbatim_. Import's loads are
  **model-transcribed — one trust level lower** — and were proposed for direct write into the table whose
  docblock reads _"HUMAN-AUTHORED — the LLM never authors loads"_. A comment is not an invariant. → R7/R8
  respond: don't import the risky value at all.
- **"Proofreading, not judgment" does not survive Ray's own unstructured case.** `"a couple sets of wall
sit"` has **no ground truth to proofread against**; `a couple → 2` is authorship with a human rubber
  stamp. → Q3 asks whether to refuse prose outright.
- **Per-row confirmation was the brief's only mitigation, and it is the weakest real option.** Checkboxes,
  master confirms, confidence badges and "are you sure?" modals are theatre — one habituated gesture
  defeats all of them. → R8 (blank the field) and Q4 (defer to first use) replace it.
- **Error recovery was entirely absent.** → R16.
- **Units were never mentioned**, and are the largest silent-error surface. → R9.
- **Multi-athlete was a shape question; it is a safety question.** → R10.
- **Slice 2 duplicated a shipped surface** (the routine editor). → R4.
- **Photo import is not "an input widening" over text.** It needs per-field source anchors designed in
  from the start, or the confirm UI gets rebuilt. → moved down the phasing with that noted.
- **First-run brokenness was invisible to both the brief and to me** until the panel walked the flow. →
  the new P0 section.

### 2026-08-20 — Ray's decisions, and what they changed

- **The questionnaire is gone.** Q1's answer — an explained empty state and a route into the editor —
  removes the feature the original brief was _named for_. Setup is now "fix the empty state and point at
  V1-18's shipped editor," which is a materially smaller document. → R2.
- **Tap-to-fill replaces "type it".** The panel's R8 said risky values arrive blank and the coach
  **types** them; Ray asked for a cheaper gesture. Accepted, with the reasoning recorded: the panel's
  objection was always to **bulk** confirmation, where one habituated gesture accepts twenty unread
  numbers. A single tap on **one** load, at the **moment of use**, with the source **visible beside
  it**, is a different act — and the value is still written by a human decision, not by the model. The
  constraint that keeps this true is now explicit and absolute: **no "fill all" affordance, ever.**
  → R8.
- **Prose is refused outright**, which closes the one place the "transcription, not authorship" claim
  genuinely broke. → R7a.
- **Q2's answer was more consequential than the question anticipated.** "Both, layered" means the two
  plan shapes are not a fork the user picks — one document contains both, so the extractor must **split**
  rather than classify. That is a design consequence the PRD did not previously have.
- **Ray is right about `170`-for-`70`**, and it is the case R16 already discounted; `85`-for-`65` stands.
  With loads no longer model-written, this is mostly designed out rather than detected.
- **Units turned out to be an app-wide gap, not an import requirement.** Checking the tree to write R9:
  `entry_sets.weight_num` and `prescription_targets.load` are both unitless, and `movements.unit_default`
  is read by nothing. **A kg household is broken today, with or without ONB-1.** Promoted to a
  prerequisite slice and worth its own backlog row. → R9, slice 0.5.
- **`movements` scoping moved from open question to blocking prerequisite.** Writing R12a surfaced that
  `slug` is **globally `UNIQUE`** — so this is not a tidiness concern that can wait for real users; the
  second household to type "RDL" gets a **write failure**. → R12a/R12b, slice 0.5.
- **Suggested loads are an explicit product goal now**, not a someday. Stated as R18a rather than left
  implicit in R18, because "the app suggests a load" and "an LLM suggests a load" are one word apart in
  conversation and very far apart in this codebase.

## Out of scope

Pricing, multi-household billing, coach-of-many-athletes (vs parent-of-two), notifications, and anything
touching the daily logging experience — which already works and is not what is broken.
