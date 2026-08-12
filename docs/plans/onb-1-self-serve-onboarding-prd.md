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
caused by anything else here**. It should be its own backlog item and can ship long before ONB-1.

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
- **R2.** Time-to-first-value is **one screen and two fields**: an athlete's name, then a weigh-in. The
  app already holds this opinion structurally — `bodyweight` is deliberately not a legal member of
  `order`; weigh-in is pinned first by construction. Onboarding should mirror that, not put six
  questions in front of it.
- **R3.** Athlete creation is a form with "+ Add another", **not** a "how many athletes?" counter that
  gates everything behind it.
- **R4.** Routine authoring **reuses the shipped editor** (`/p/[profileId]/routine`). Building a second
  way to write `routine_config` is the thing to avoid; a wizard that duplicates an existing surface is
  cost with no new capability.
- **R5.** Equipment and "what do you want to get better at?" are **cut from onboarding** until something
  actually reads them. Equipment is unmodelled (`movements` has no equipment column), and the goals
  question is a vaguer version of the routine editor's concrete activity picker.

### Import (only for the structured shape)

- **R6.** Import is **offered contextually** — on the strength surface, when the user hits the gap — not
  as a wall during first run, before they have any reason to trust the app.
- **R7.** The extractor emits only what the source **literally states**. Every field is nullable;
  anything not literally present is `null`, never inferred. `"a couple of sets"` → `sets: null`. This is
  what makes "transcription, not authorship" true rather than aspirational.
- **R8.** **Risky values are not imported at all — they arrive blank**, with the source shown beside the
  empty field, and the coach types them. Risky = _error is not self-limiting_: external load, height,
  distance, rep counts, plus movement identity. Self-limiting values (`BW`, `band`, durations) import
  freely. This is V1-19's "names and structure only, loads stay BLANK" applied to import.
- **R9.** **Units are asked once per import, unskippable, never inferred.** A kg sheet read as lb is a
  2.2× load error that looks entirely plausible on screen. Note `prescription_targets.load` stores `65`
  as verbatim text with **no unit recorded anywhere in the system** today.
- **R10.** **Athlete↔column mapping on a multi-athlete sheet is an explicit human step**, confirmed
  before any row renders. A silent column swap assigns the 13-year-old's loads to the 8-year-old — the
  highest-consequence single failure available in this feature.
- **R11.** Multi-athlete reuses **copy-to-sibling** (V1-11's shape): confirm one athlete, then copy and
  fix only the deltas. Never a two-column confirm on the narrowest screen. In `PROGRAM_SEED`, `both()`
  covers most rows and `perKid()` a minority, so the sibling pass is a handful of edits.
- **R12.** Nothing is written until confirmed, and a partially-finished import **survives leaving the
  page**.

### Safety model

- **R13.** The inviolable rule holds: **the LLM never authors a load.** Extraction is transcription. The
  honest caveat is that this is _weaker_ than the V1-10 precedent, not stronger — see the discussion log.
- **R14.** **Provenance is per-field, not per-row** (`human | imported_unconfirmed | imported_confirmed |
engine`), because a row is legitimately half-imported and half-typed. One marker, one position, on
  every surface a number appears. _Alternative worth costing: a **staging table** for unconfirmed
  imports, which makes "unconfirmed in the live program" unrepresentable and needs no migration on
  `prescription_targets`._
- **R15.** An **`imports` record** holds the raw source, model + version, timestamp, and per-field source
  anchors, with every extracted row FK'd to it — which is what makes **whole-import undo** possible.
- **R16.** **Error recovery has a detection signal, and it already exists in the data.** The app logs
  _performed_ against _prescribed_, and the CSV contract calls that gap "the entire point of the column".
  A persistent gap on an imported-unconfirmed load is the only automated smoke alarm available — and
  computing it is **arithmetic on two human-written values, not authorship**. The dangerous case is not
  `170` for `70` (self-limiting — the kid fails the rep) but `85` for `65`, which they grind while
  nothing notices.
- **R17.** Correction is **one tap from where the load is displayed**, not buried in an editor the coach
  must discover. (The routine editor is URL-only and unreachable today — V1-20. Don't repeat that.)
- **R18.** Progression is deterministic, in `packages/engine`, never an LLM. Two invariants:
  **bounded step** — a load may only move a bounded step from something already performed, never a leap;
  and **staleness** — beyond a threshold the engine **proposes nothing** and the card shows a dated fact
  (`Last performed: 65 lb · 14 Apr`). The absence of a suggestion is the message: no warning, no block,
  no "detraining" (clinical, judgmental, and often wrong — the kid may have been in season).
- **R19.** An imported plan may **never** touch the log path (`entries`/`entry_sets`). Worth an explicit
  invariant test.

### Tone

- **R20.** **The app's voice is a receipt, not a coach.** Every string in the import flow must be
  phraseable as _"your sheet says X"_ or _"you logged X"_. If it can't, it probably shouldn't ship —
  a testable copy rule, enforceable in review like the semantic-HTML rule, that does the liability work
  with no legal furniture. "Import your plan", never "Set up your training program". The empty state is
  the strongest position available and it is free: _"No plan yet — you can log without one."_

## Open questions

**Decision-shaping — these change the design:**

1. **What should a stranger's first Today show** before they've set anything up? Nearly-nothing plus the
   weigh-in / a generic starter you'd pick / blank until they choose. **This decides whether a
   questionnaire is needed at all.**
2. **Of the parent-written plans you've seen, what share are daily rep targets vs. a structured week?**
   If mostly the former, those families need a typed form on machinery that already exists, and
   import only ever serves trainer plans.
3. **Should the extractor refuse free-form prose** and route it to the daily-targets form? Refusing
   removes the worst rule violation entirely (`"a couple sets"` has no ground truth to proofread).
4. **Do you accept deferring confirmation to first use** — the load appears on the existing V1-10
   reference card marked "from your sheet — unconfirmed", and you confirm it the day that movement comes
   up, standing at the bar? This removes the bulk-confirm screen entirely. **Biggest single fork.**
5. **Would you re-read everything against the paper, or just the loads?** ~4× difference in effort.
6. **Is import phone-capable, or explicitly a tablet/desktop setup task?** Both panels landed here
   independently: a photo of a sheet and a legible editable row do not coexist at 390px.
7. **Provenance column, or staging table?** (R14)
8. **Correcting an imported load — version or overwrite?** `prescription_targets` has no versioning, and
   the V1-10 review already found a two-live-rows hazard in the soft-delete + reinsert idiom. Determines
   whether historical `prescribed` export stays faithful.

**Smaller, but real:**

9. Are "Rice bucket" / "Brain rep" / "Brush teeth" names a stranger should see, or family shorthand?
10. Wall-sit: counted in seconds, ticked off as done, or ignored? (No timed calisthenics metric exists.)
11. Do you ever want the app to **suggest** movements? If never, equipment need never be modelled.
12. Retention of an uploaded source image — how long, and where? It is a stranger's child's plan and may
    carry other kids' names (OSS-1's data-audit discipline applies).
13. **How long is too long** for setup before the first weigh-in? Your number is the budget for all of
    the above.
14. **Would you launch with no import at all** — profiles, routine, logging only — and wait to see if
    anyone asks? Import is the majority of the cost in this document.

## Phasing sketch (illustrative, not committed)

| Slice  | Scope                                                          | Why here                                                          |
| ------ | -------------------------------------------------------------- | ----------------------------------------------------------------- |
| **P0** | Fix first-run: real empty state + a neutral default routine    | Independent of everything else; blocks any stranger using the app |
| **0**  | **Clerk** (v1.5, already planned)                              | The tenancy boundary. Nothing below is safe without it            |
| **1**  | Profile CRUD                                                   | Small; `seed.ts` is the only writer today                         |
| **2**  | Daily-targets form → `ramp_targets`                            | **A stranger has a working app here.** No AI, no new tables       |
| **3**  | Import: paste text → literal extraction → blanks → typed loads | The first LLM surface. Reuses AI-1's structured-output machinery  |
| **4**  | Screenshot/multimodal import                                   | **Not** a simple "input widening" — see the discussion log        |
| **5+** | Equipment · movement scoping · engine progression              | Only once real users show which of these bites                    |

**Slices P0–2 contain no AI at all**, and both panels independently concluded that is where the value is.

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

## Out of scope

Pricing, multi-household billing, coach-of-many-athletes (vs parent-of-two), notifications, and anything
touching the daily logging experience — which already works and is not what is broken.
