# ONB-1 — self-serve onboarding: bring-your-own-program

> **Status: BRIEF — exploratory, not finalized, not scoped.** No panel review yet, no file-by-file
> plan, no committed sequencing. Written to be **iterated on**, per Ray (2026-08-11). Nothing here is
> approved for implementation; the point is to fix the _shape_ of the idea while it is cheap to change.
>
> Backlog: [plan.md](../plan.md) row **ONB-1**. Related: **AI-1** (NL logging — same machinery),
> **V1-18** (`routine_config` — half the output already exists), **V1-10** (the programming tables
> this targets), **V1-21** (interaction design).

## The problem

Onboarding a new family today costs **a code change and a deploy**. Verified against the tree:

| Thing            | Today                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------- |
| Athlete profiles | `packages/db/src/seed.ts` is the **only** writer — hardcoded UUIDs and names              |
| Auth / tenancy   | one shared access-gate password; `getProfileByPublicId` is an existence check, not scoped |
| Daily routine    | ✅ **already self-service** — V1-18's per-kid checklist + reorder editor                  |
| Strength program | `PROGRAM_SEED`, a TypeScript const. **No authoring UI exists at all**                     |

The good news, and the reason this is a feature rather than a rewrite: **the data model is already
multi-tenant.** `households` exists, `profiles.household_id` FKs to it, and the DAL was designed around
household scoping from the start. The gap is **authoring surfaces and auth**, not the schema.

## The core idea (Ray, 2026-08-11)

A **questionnaire** on first run that scaffolds the right sections, plus **bring-your-own-program**:
the coach uploads a screenshot of, or pastes, the plan they already use, and the LLM **extracts** it
into our schema for them to confirm.

### Why bring-your-own-program is the key move

An earlier draft of this discussion had the app _generating_ starter plans and, later, an LLM
"calibrating loads once enough data exists." Both were rejected, and BYO-program is what replaced them:

- **It keeps the inviolable rule intact by construction.** The rule is _the LLM never authors
  loads/weights; it may draft **definitions** a human confirms, never live prescriptions._ Extraction is
  **transcription, not authorship** — every load traces back to something a human already wrote down.
  The model is doing what Ray did **by hand** in V1-10 PR 1b, where his own 2-week program was
  transcribed verbatim into `programming.ts`. This feature is _automating that transcription for other
  people_, which is a categorically different act from inventing a load.
- **It makes the confirm gate meaningful for non-experts** — the objection that killed generated plans.
  Asking a parent _"is 70 lb right for your 10-year-old?"_ demands the coaching judgment they came here
  lacking. Asking _"does this row say what your sheet says?"_ demands only literacy, against a source
  they authored. **The confirm question changes from a judgment call to a proofreading task**, which is
  the whole reason this approach survives where template generation did not.
- **It removes a liability surface.** Ray does not become the author of training plans for strangers'
  children. The coach remains the author; the app is a faithful transcriber.

### What the LLM does and does not do here

- **Does:** OCR/parse a screenshot or free text → a **structured draft** matching our zod schemas;
  fuzzy-match free-text goals to `ACTIVITY_CATEGORIES`; suggest movement-name → catalog matches.
- **Does not:** invent, adjust, round, or "sanity-check" a load. Not at import, not later. Ever.
- **Progression stays deterministic.** When load calibration eventually lands it belongs in
  **`packages/engine`** — pure TS, no I/O, golden-vector tested, portable to Python at v3. Linear
  progression, double progression, and RPE autoregulation are solved and **auditable**: when a load goes
  up you can point at the rule that moved it. That is what you want when it is someone else's kid. An
  LLM adds nondeterminism and unexplainability to a problem that has neither. The most an LLM should
  ever do is render an **advisory read-only summary** a human reads before deciding.

## How it fits the existing system

This is the part that makes ONB-1 smaller than it sounds.

### The goal list is already our taxonomy

`ACTIVITY_CATEGORIES` is `strength · conditioning · skill · habit · measurement · routine · life`.
Ray's example questions map almost one-to-one:

| Questionnaire answer       | Existing concept             |
| -------------------------- | ---------------------------- |
| Wrestling strength         | `strength`                   |
| Gas tank                   | `conditioning`               |
| Footwork · shots · defense | `skill`                      |
| Sleep                      | `habit` (check-ins, shipped) |

We are **exposing** a taxonomy, not inventing one — the generalized entity model paying off as intended.

### The "sections" output already exists

V1-18 shipped `routine_config`: a per-kid ordered checklist of the activities that kid actually does.
That **is** "scaffold the appropriate sections." The questionnaire's job is to **write a
`routine_config`** rather than make the coach hand-assemble one in the editor. The editor then becomes
the _edit_ path for a scaffold the questionnaire produced — no new read path, no new storage.

### The program output targets existing tables

`program_blocks → prescriptions → prescription_targets` (V1-10) is the extraction target. Two properties
make it a good fit: per-athlete targets are already modelled (the kids legitimately differ), and
**`load` is already TEXT stored verbatim** — `BW`, `BW +5-10`, `~75-85` are what Ray actually authors, so
an extracted plan does not need a lossy numeric coercion.

## Open questions (the point of this brief)

1. **Equipment is unmodelled, and it may be the highest-leverage question.** `movements` has `pattern`,
   `unit_default`, `is_bodyweight`, `video_url`, `cues` — **no equipment**. A garage with a pull-up bar
   and a band produces a completely different plan than a school weight room, and getting it wrong makes
   the app feel broken on day one. But: is equipment needed at all in a BYO-program world, where the
   coach's own plan already reflects their equipment? **Possibly it only matters if we ever suggest
   movements** — which may now be out of scope. Resolve this before building it.
2. **Movement resolution is the sharp edge.** Extracted names hit `findOrCreateMovementId`, which is
   first-writer-wins on `movements.name` and idempotent by slug. Two open problems: (a) a stranger's
   "DB Bench" and our "Dumbbell Bench Press" are the same movement with different slugs, fragmenting the
   catalog; (b) `movements` is **global, not household-scoped** — one household's free-text names would
   pollute another's catalog. (b) is arguably a schema question that should be settled before any
   multi-tenant writing, not after.
3. **Extraction accuracy, and how to fail safely.** A misread `5x5 @ 70` as `5x5 @ 170` is the injury
   case. Candidate mitigations: source image/text shown **side by side** with extracted rows; per-row
   confirm rather than a single bulk accept; store the raw source for audit; **never** auto-write.
   Needs a golden-eval fixture set like AI-1's, and an explicit accuracy bar before it can ship.
4. **What happens with no program at all?** A profile with no `program_block` is already valid. Is
   BYO-program **optional** at onboarding (log-only day one, import later)? This brief assumes yes — see
   the phasing below — but it is a product call.
5. **Multi-athlete plans.** Ray's own sheet carries per-kid loads in one document. Does extraction handle
   "one sheet, N athletes" (mapping to `prescription_targets`), or one sheet per athlete? The real-world
   input probably has both shapes.
6. **Does the questionnaire write anything irreversible?** Preference: it produces a **draft** the coach
   edits, and every write goes through the same confirm seam. No silent scaffolding.

## Phasing sketch (not committed)

The ordering that gets a stranger a working app soonest, deferring every hard question:

| Slice  | Scope                                                                                 | Why here                                                                         |
| ------ | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **0**  | **Clerk** (v1.5, already planned)                                                     | The tenancy boundary. Nothing below is safe without it.                          |
| **1**  | Profile CRUD — create/edit athletes                                                   | Small. Removes the seed-only blocker.                                            |
| **2**  | Questionnaire → **`routine_config`** only. No program, no LLM, no equipment.          | **A stranger has a working app here.** Deterministic, testable, no AI surface.   |
| **3**  | BYO-program import: paste text → structured draft → per-row confirm → `prescriptions` | The first LLM surface. Reuses AI-1's structured-outputs + golden-eval machinery. |
| **4**  | Screenshot/multimodal import                                                          | Strictly harder than text; same confirm seam, so it is an input widening.        |
| **5+** | Equipment modelling · movement dedup/scoping · engine-based progression               | Only once real users show which of these actually bites.                         |

**Slice 2 is the one worth noticing:** it makes the product usable by someone other than Ray with **no
load logic and no AI at all**. Programming becomes an upgrade path, not a gate.

## Risks / things that could sink this

- **Scope.** This is many PRs at ~4h/wk, and it is **v2+ territory**, not v1. The brief exists so the
  shape survives; it is not a commitment to build it next.
- **Multi-tenant correctness is a prerequisite, not a detail.** Writing another household's data through
  a surface designed around one seeded household is exactly how the documented BOLA gap becomes real.
  Clerk first, no exceptions.
- **The confirm gate must not become a rubber stamp.** If slice 3 ships a single "Accept all" button,
  the entire safety argument above evaporates — the gate's value is that it is per-row and diffable
  against a source the coach wrote.
- **A tempting shortcut to refuse:** having the LLM "fix" an implausible extracted load. That is
  authorship wearing a validation costume. Flag it to the human; never silently correct it.

## Not decided / deliberately open

Questionnaire wording and question set · whether equipment is in scope at all · movement-catalog
scoping · the accuracy bar for extraction · whether templates ever exist as a fallback for coaches with
no plan of their own · pricing/multi-household anything.
