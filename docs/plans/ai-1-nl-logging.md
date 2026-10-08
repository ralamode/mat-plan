# AI-1 — NL logging via Anthropic structured outputs (plan)

> Backlog: [docs/plan.md](../plan.md) → **AI-1** · architecture: [spec.md](../spec.md).
> Branch: `docs/ai-1-nl-logging` (off `main`). **Design + decisions only** — no implementation code.
> Gate: **[EVAL-0](./eval-0-gate-before-model.md) ships before the model** (§ "EVAL-0 is the gate").
> Owning feature guides, both of which this work edits:
> [strength-logging](../features/strength-logging.md) · [write-path](../features/write-path.md).
> **Not yet panelled.** The engineering panel (≥3 lenses) and the UX panel are owed before any code.
> ⏸ **Superseded 2026-10-06:** the engineering + security panels have since run and this plan is
> **parked**. Read § "Parked 2026-10-06" first; everything below it stands as written.

## Parked 2026-10-06 — panel outcome and why this is not next

**Status: parked, pending [`PICK-1`](../plan.md#pick-1) usage data.** _(the maintainer, 2026-10-06.)_
Off P0 and out of the pillar's "next" slot. **This plan is kept on file, unrewritten**, because the
re-grounding below remains valid — the target schema is still a fact, S1–S9 are still the decisions,
and EVAL-0 is still the gate. It is not wasted; it is not next.

**The engineering + security panels returned eleven blocking findings across three lenses**
(correctness, scope, security). Five are recorded here because each was **verified against pinned
sources in-session**, not reasoned about, and each would have had to be answered before any code:

1. **The fail-closed rate limit cannot work as specified.** `@upstash/ratelimit@2.2.0` resolves
   `{success: true}` on its internal timeout (`dist/index.mjs:908`–`:912`), and
   `apps/web/lib/rate-limit.ts:84`–`:90` maps that to `{allowed: true, reason: 'ok'}` —
   **indistinguishable from a genuine under-limit allow**. The `catch` only fires on a throw, so
   **S9**'s fail-closed limiter fails **open** on exactly the outage it exists for, and
   `rate-limit.test.ts` has no timeout case.
2. **Sentry auto-instruments the Anthropic SDK.** `anthropicAIIntegration()` is a **default**
   integration in `@sentry/node` (`build/esm/integrations/tracing/index.js:58`), so adding the SDK
   wires it with **no opt-in**. Prompt and response capture are off only because
   `sendDefaultPii: false`. And `x-api-key` — what the Anthropic SDK sends — is **not** in the
   scrubber's denylist (`apps/web/lib/sentry-scrub.ts:33`: `cookie`, `set-cookie`, `authorization`,
   `proxy-authorization`), in a file whose own comment calls scrubbing "the security-critical part of
   the Sentry wiring".
3. **The spend bound is not a bound.** § "Cost, the key, and the bound" prices the worst case as
   per-IP × window × $0.04, calling the Vercel IP "the only one an attacker cannot rotate"; a proxy
   pool makes that unbounded. A **global** daily cap keyed on a constant needs no identity at all, so
   the plan's deferral of bounding to AUTH-1/TEN-1 does not apply to it — and it was never considered.
   An Anthropic-side **workspace spend limit** (free, outside the code path) was never considered
   either.
4. **S7's "closed vocabulary" is absent from the contract it writes.** The emit schema's
   `movementSlug: z.string().max(120).nullable()` (§ "`packages/shared/src/nl-extraction.ts`") is
   **free text**, and the confirm chip's warning keys on `null` rather than on **membership failure** —
   so a hallucinated-but-plausible slug gets **no warning** and silently mints an unrecoverable catalog
   row, which is the precise hazard S7 exists to close.
5. **No boundary tests** on what would be the app's first metered endpoint, and `hasGateAccess()`
   — the gate check every shipped Server Action performs (`apps/web/app/p/[profileId]/actions.ts:84`)
   — is **never named in this plan**, despite **S8** resting on the handler re-checking the gate.

**Why parked rather than fixed — the scope lens, and the probe that settled it.** Every finding above
is answerable. The scope lens' conclusion was that answering them buys the wrong thing first: after
**S1**/**S6** do their work, the model's entire output is _which movements_ plus _how many sets of how
many reps_ — a selection from a closed catalog plus two small integers — and this plan already accepts
that _"a 30-second plank extracts as one set of one rep and the human types the 30"_. So a sentence
saves taps on movement **identity**, not on the data entry that actually hurts, and identity is what a
picker gives for no key, no vendor, no spend bound, no scrubbing, no prompt-injection surface through
the catalog and no eval harness as a prerequisite.

**The probe, measured against the production database 2026-10-06**, agreed: 49 live entries (**23
metric, 19 movement-arm, 7 neither-arm**); the 19 movement-arm entries name **8 distinct movements,
all 8 prescribed by the program** — **zero** instances of the ad-hoc case this plan's own Goal names
(_"everything NOT in the program"_). `entries.notes`, `entries.context` and `entries.scheme` are **0,
0, 0 non-empty out of 49**, and those are the fields carrying the context a sentence expresses and a
picker cannot. Catalog reach: **35 movements in the live `movements` table, 25 prescribed, 8 ever
logged**.

⚠️ **The limit of that probe, stated plainly, because it is what un-parks this plan.** Movement-arm
logging spans **two days** (2026-09-28 → 2026-09-29, 19 entries), and the data cannot distinguish
_"ad-hoc never happens"_ from _"the only path to it is a free-text box, so it goes unlogged"_ — today
the ad-hoc movement is reachable **only** by typing its name into `strength-form.tsx:812`, which
`findOrCreateMovementId` then upserts by slug, the hazard **S7** was written to close. That argues
**for** [`PICK-1`](../plan.md#pick-1) first: the picker makes the ad-hoc case cheap enough to observe,
and only then can anyone say whether typing a sentence still beats tapping. **Un-park on that
observation**, and answer the eleven findings before any code.

## Re-grounded 2026-10-06 — what changed and why

The first draft was written 2026-09-16 and closed on **S5: AI-1 sequences behind GAP-3**, because the
measurement columns it extracts into were being replaced. **That gate is discharged.** GAP-3 landed
(migration `0011`, `entry_set_quantities`, #137/#139/#141) and V1-13 landed (#149/#150), so the target
schema is now a fact and can be named column by column instead of as "fields that match this app's
entry schema". Everything below is verified against the code at `d1a7fdc`, not against the old draft.

Three things the draft said are **overturned** here, each with its reason, and one of its rejection
arguments now rests on a function that no longer exists. They are collected in
§ "What the re-grounding overturns" rather than quietly edited out.

## Goal

**What's broken.** Logging a strength session is hand-typing, on a phone, between sets. V1-19's
`fillFromProgram` (`apps/web/app/p/[profileId]/strength-form.tsx:322`) fixed that for everything the
program prescribes — one tap builds the cards. **AI-1 is the answer for everything NOT in the
program:** the ad-hoc set, the substitution, the thing a kid did that nobody planned, which no prefill
can reach because there is no prescription to prefill from.

**What it does.** A parent or coach types what happened in one sentence. One Anthropic structured-output
call extracts it into a **movement list with per-set rep counts and nothing else**. The extraction
surfaces as a **chip** — the parse, shown back for correction, not approval theatre (**S2**).

**Confirm prefills the form; it does not write.** The chip's confirm lands the extracted values in the
existing strength form — movement names, set rows, reps — with **every magnitude field empty**. The
human types the magnitudes and submits through the shipped V1-8-2 write path, which stays the single
writer. Two things fall out of that rather than being bolted on: **S1** holds structurally (the model's
output never reaches a magnitude field, because it never reaches the database at all — a human does),
and the whole validated write path, its zod schemas and its error envelope are reused rather than
duplicated for a second caller. It is the same shape V1-19 uses, for the same reason, through a second
filler beside `fillFromProgram`.

The friction is real and accepted: a 30-second plank extracts as one set of one rep and the human types
the 30. § "The inviolable rule under typed quantities" explains why that cost is structural and not a
first-cut simplification.

## Acceptance

Each is stated so a test can fail it. (1)–(4) are the gates; (5)–(9) are the behaviour.

1. **The model's output shall carry no magnitude of any kind.** `extractedSessionSchema` shall have no
   numeric field other than `reps`, and shall be a `z.strictObject`, so an emitted `weight`, `value`,
   `seconds`, `load` or `unit` key is a **parse failure** rather than a silently dropped one. Asserted
   at the type level (the `ScaffoldRow` precedent) **and** by feeding a crafted model response.
2. **Confirming an extraction shall write nothing.** Exercising the extraction path end to end shall
   leave `sessions`, `entries`, `entry_sets` and `entry_set_quantities` row counts unchanged. The
   V1-8-2 write path stays the only writer.
3. **When the prefilled form is submitted untouched, the submit shall be refused**, by the already
   shipped blank-set refine (`packages/shared/src/strength.ts:117`, `BLANK_SET_MESSAGE`) — i.e. there
   is no path from an extraction to a stored `entry_set_quantities` row that does not pass through a
   human keystroke.
4. **The eval shall run on every PR as a required check, under two separate gates** — an accuracy
   threshold over the accuracy class and a **100%** invariant class, failing with **different
   messages** (**S4**). Delivered by [EVAL-0](./eval-0-gate-before-model.md), not by AI-1.
5. **The extraction shall match what was performed**, as field-level equality against expected output
   on exactly the fields the model may emit: movement identity (catalog slug or verbatim name) and the
   per-set `reps` array. The 15-case golden set is the artifact.
6. **If the utterance names a load**, then the extraction **shall still carry no magnitude**, and the
   chip **shall say so in one line** ("weights stay blank — type them in") rather than silently
   dropping the number the human just said.
7. **Where the utterance names a movement in the household catalog**, the extraction **shall** carry
   that movement's `slug`, so confirm resolves an existing catalog row rather than creating a near-duplicate
   through `findOrCreateMovementId` (`apps/web/lib/dal/catalog.ts:76`).
8. **If the utterance names a profile other than the one in the route**, then the chip **shall** warn
   and **shall not** change which profile the form submits under. The route's `profileId` is
   authoritative.
9. **The extraction endpoint shall be unavailable** — and the UI shall not offer it — whenever the API
   key or the rate limiter is unconfigured. Absent credentials is a first-class state (the V1-14a
   precedent), not a degraded one that quietly spends.

## The target shape, named exactly

### Where a magnitude actually lives, since GAP-3

A load is no longer a column on the set. It is a **row** in `entry_set_quantities`
(`packages/db/src/schema.ts:334`):

| Column                     | Where it comes from                                                            |
| -------------------------- | ------------------------------------------------------------------------------ |
| `entry_set_id`             | the parent `entry_sets` row                                                    |
| `slot`                     | `QUANTITY_SLOT.primary` for the log path (`writers/strength-session.ts:251`)   |
| `dimension`                | **derived** `UNIT_DIMENSION_BY_CODE[unit]` (`writers/strength-session.ts:252`) |
| `unit`                     | the **movement's** unit, not the set's                                         |
| `value_num` `numeric(8,3)` | the magnitude, `NOT NULL` (`schema.ts:345`), `>= 0` (`schema.ts:374`)          |

`weight_num`, `weight_label` and `seconds` were **dropped** in `0011`; `entry_sets` keeps only
`reps` (`schema.ts:281`) plus the two mode booleans `is_bodyweight` / `is_band` (`schema.ts:291`),
which are modes and not quantities. The two composite FKs (`schema.ts:352`, `schema.ts:357`) mean
there is no spelling that gets a mass unit into a length quantity.

**So "the model never emits a load" has a precise schema-level form: the model's output cannot
contribute a value to `entry_set_quantities.value_num`.** The chain that makes that true, each link
already shipped:

```
extractedSessionSchema (no magnitude field)
  → MovementVals / SetVals with reps: '<n>', weight: ''          strength-form.tsx:65,77
  → strengthSetSchema's transform: '' → null                     strength.ts:64-67
  → the writer skips a set with no magnitude: no quantity row    writers/strength-session.ts:247
```

### The write contract is `logStrengthSessionSchema`, and it is not the emit contract

`logStrengthSessionSchema` (`packages/shared/src/strength-session.ts:103`) stays the single write
contract and is **not** forked. But it cannot be the model's output schema, for three reasons that are
properties of the schema rather than preferences:

- it requires `profileId` and `clientId` as UUIDv7s (`:105`, `:106`), and
  `scaffoldMovements`' docblock (`strength-form-scaffold.ts:61`) records why client ids must be minted
  per call at the client and never carried in from elsewhere — a reused entry `client_id` turns the
  next submit into a silent `ON CONFLICT` no-op;
- every set requires a magnitude or a mode (`strength.ts:109-123`), which is exactly what the model
  must not supply;
- it requires `unit` per movement (`:61`), and invariant 4b of the
  [strength-logging guide](../features/strength-logging.md) holds that **the athlete picks the
  dimension and the catalog's `unit_default` only seeds it** — so the unit is not the model's to choose.
  (It is also the smuggling hole: a model free to say `unit: 'sec'` on a back squat would get a number
  past any mass-only check.)

**The reuse is therefore per-field, not per-schema**: the emit schema is built from
`logStrengthSessionSchema`'s own pieces, so no rule is re-typed.

### `packages/shared/src/nl-extraction.ts` — the emit contract

```ts
export const extractedMovementSchema = z.strictObject({
  /** A catalog slug when the utterance names a known movement; null when it does not (S7). */
  movementSlug: z.string().max(120).nullable(),
  /** What to put in the card. Reuses the write path's own rule — ≤100, no comma, no line break. */
  movementName: sessionMovementSchema.shape.movementName,
  /** Reps AS PERFORMED, one entry per set. LENGTH is the set count — one field, not two. */
  reps: z.array(numericSetSchema.shape.reps).min(1).max(MAX_SETS_PER_MOVEMENT),
});

export const extractedSessionSchema = z.strictObject({
  /** A HINT for acceptance 8's warning. Never selects a profile; the route does. */
  profileName: z.string().max(60).nullable(),
  movements: z.array(extractedMovementSchema).min(1).max(MAX_SESSION_MOVEMENTS),
});
```

Everything bounded is bounded by an **imported** const, never a re-typed literal:
`MAX_SETS_PER_MOVEMENT` (`strength-session.ts:33`), `MAX_SESSION_MOVEMENTS` (`:28`),
`numericSetSchema.shape.reps` (`strength.ts:21` — int, `> 0`, `≤ 1000`), and the movement-name
refinement at `strength-session.ts:51-59`. `reps` is a plain array rather than a `{count, reps}` pair
because two fields that must agree are the drift this repo keeps paying for.

`reps` is **required and ≥ 1** because `strengthSetSchema` requires reps: a timed hold is already
logged as 1 rep × a duration, so the model emits `[1]` and the human types the duration.

### How confirm maps it onto the form

Confirm builds `MovementVals[]` the way `scaffoldMovements` already does
(`strength-form-scaffold.ts:65`), and that function is the shape to follow, not to duplicate:

| `MovementVals` field                   | Source on confirm                                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `clientId`                             | `newId()`, minted in the handler (`strength-form-scaffold.ts:61`)                                                  |
| `movementName`                         | the catalog row's `name` when `movementSlug` resolves, else the verbatim `movementName`                            |
| `unit`                                 | `declaredUnit(row.unitDefault) ?? defaultUnit` — the catalog, exactly as the scaffold does (`:83`)                 |
| `declaredLoaded` / `declaredDimension` | derived from the same catalog row (`:91`, `:98`) — so the V1-26/V1-30b hints work identically                      |
| `sets[].reps`                          | the extracted rep, as a string                                                                                     |
| `sets[].weight`                        | **`''`** — and there is nothing in the emit type that could fill it                                                |
| `scaffolded`                           | `true` — an extracted card the human never touches must drop at submit the same way a scaffolded one does (`:112`) |

## The inviolable rule under typed quantities

AGENTS.md: _"the LLM never authors loads/weights"_ — bad loads are an injury risk.
[strength-logging](../features/strength-logging.md) invariant 1 (`:99`) already states it and already
names the mechanism: `ScaffoldRow` (`strength-form-scaffold.ts:36`) carries no `load` field at all,
"enforced by the **type**, not by care." AI-1 gets the identical mechanism.

**The thing GAP-3 changed, and the one real design consequence.** Before GAP-3 a load was a distinct
field and "omit the load field" was a complete statement. Since GAP-3 PR 4a the wire carries **one
dimension-polymorphic magnitude** — `strengthSetSchema.weight` (`strength.ts:64`) is a weight on a
mass movement, a duration on a `sec` movement and a height on an `in` movement, with the dimension
derived from the movement's unit. There is no separate "duration" field to keep while dropping
"weight."

So there are exactly two ways to express S1, and they are not equivalent:

| Option                                                                                      | Verdict                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **(a) The emit schema has no magnitude field at all.** No weight, no duration, no distance. | **Taken.** Binary, type-enforced, and survives any later unit work. One `grep` over the schema settles it.                                                                                                                                                                                                                                                                           |
| **(b) Emit a magnitude plus the dimension, refuse it when the dimension is `mass`.**        | **Rejected.** It makes the gate conditional on a value the model also supplies, so the dimension would have to be resolved server-side from the catalog — and a typed-in movement has no catalog declaration, so the refusal would have to fall back to "refuse", which is (a) with extra machinery. Worse, it converts the binary property S4 insists on into a per-case judgement. |

**What the model may emit:** a movement identity, and an integer rep count per set.
**What it may not emit:** any magnitude, any unit, any dimension, any mode flag (`is_bodyweight` /
`is_band` are modes of a weight and belong to the same decision), any profile id, any `client_id`, any
date. `movementSlug` is chosen from a closed vocabulary; `movementName` is free text treated as
untrusted at the boundary exactly like `FormData`.

**Why reps are allowed when loads are not**, since both pass through the model and both can be
mis-transcribed: the asymmetry is AGENTS.md's own — a wrong rep count is a bad record, a wrong load is
an injury. A mis-parsed `8 → 18` is visible on the chip and recoverable through V1-9's edit path; a
mis-parsed `65 → 165` is a number a child then lifts. The chip is the correctness check on reps
(**S2**); nothing but absence is accepted for loads (**S1**).

**How the gate is tested** — three layers, each independently able to fail:

1. **Type.** `extractedSessionSchema`'s inferred type has no magnitude member, asserted the way
   `strength-form-scaffold.test.ts:241` asserts the scaffold's ("carries no prescribed load, however
   the declaration is shaped").
2. **Boundary.** A crafted model response carrying `weight: 95` fails `z.strictObject` with an
   unknown-key issue. This is the test that distinguishes `strictObject` from `.object()`, which would
   silently strip the key and pass.
3. **Eval, invariant class, 100%.** Inputs that state loads in prose ("Athlete One squatted 3×8 at 95") →
   the parse carries no magnitude, and the prefill + submit of that parse is refused by acceptance 3.
   This is the class EVAL-0 builds and the class that must fail with the boundary message, not the
   accuracy message.

## What the server already refuses — do not re-implement any of it

All of it is on the submit path the human uses, so it guards the extraction for free.

| Refusal                                                                                                              | Where                                                                                  |
| -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Movement unit ∈ `LOGGABLE_UNITS` only (`count`/`bool`/`timing` excluded; derived from the primary slot's dimensions) | `packages/shared/src/units.ts:132`, derived at `:122`–`:125`                           |
| **Refine 6** — BW / band on a non-mass unit, one issue per set                                                       | `packages/shared/src/strength-session.ts:246`–`:261` (the `isMassUnit` skip at `:247`) |
| **The format check** — `^\d+(\.\d{1,3})?$`, built from `QUANTITY_DECIMALS`                                           | `packages/shared/src/strength.ts:75`; the const at `units.ts:183`                      |
| The magnitude ceiling, with `NUMBER_TOO_HIGH_MESSAGE`                                                                | `packages/shared/src/strength.ts:82`; message at `:9`                                  |
| A set must carry some magnitude or mode — blank is unrepresentable                                                   | `packages/shared/src/strength.ts:117`–`:123`                                           |
| Movement name: no comma, no line break, ≤ 100                                                                        | `packages/shared/src/strength-session.ts:51`–`:59`                                     |
| Session bounds: ≤ 12 movements, ≤ 20 sets per movement                                                               | `packages/shared/src/strength-session.ts:28`, `:33`, applied at `:78`, `:118`          |
| `value_num >= 0`, and the unit/dimension pair guard                                                                  | `packages/db/src/schema.ts:374`, `:352`, `:357`                                        |

The format check is the one worth naming twice. It is why **S3 is now cheap**: `~75`, `12-15`,
`seventy five pounds` and `BW` are not "refused by a blocklist", they are **unrepresentable** in a
field typed `^\d+(\.\d{1,3})?$`. The draft's S3 argued against emitting a raw string by citing
`parseLoad`'s permissive fallthrough at `strength.ts:137`. **That function no longer exists** — GAP-3
PR 4a deleted it (`strength.ts:46`–`:54`). The decision survives, with a stronger reason; the citation
does not. See § "What the re-grounding overturns".

⚠️ **The ceiling is flat, not per-unit.** One `2000` for every unit (`strength.ts:82`, and `:31` on
the numeric edit path). The per-unit `MAX_QUANTITY_BY_UNIT` / `quantityCeiling` is **V1-30b-ii's**
work, not shipped (`docs/plans/v1-30b-form-stops-inviting.md:220`). AI-1 must not implement it and
must not assume it.

## Decisions

**S1–S5 are prior commitments** (2026-09-16). Their text stands in git history; here is each one's
state after contact with the shipped schema.

**S1 — a load is safe to write only by provenance.** A load may only be written if a human performed
it, or a readable rule derived it. An LLM never emits a load. **Holds, unchanged, and is now
expressible more precisely than when it was written** (§ "The inviolable rule under typed
quantities"). The rejected alternative — enforce it in the prompt — is rejected for the same reason: a
write path can refuse, a prompt can only ask, and a prompt-enforced invariant is not testable as an
invariant, which is the scalar/binary confusion S4 exists to prevent. `packages/engine` is still
`export {}`; the engine becomes the second legitimate origin at v2, not at AI-1.

**S2 — the confirm chip is UX, not the safety mechanism.** Approval is a behaviour and behaviours
become reflexive under repetition; the 50th chip is not inspected. The chip catches **parse errors**
— wrong movement, wrong reps, wrong kid. Different failure, different mechanism. **Holds, unchanged.**
Acceptance 6 and 8 are the two chip duties this re-grounding makes concrete.

**S3 — the structured output carries performed facts only.** A prescription is a target and may be a
range; a performance is a single fact. **Holds; the rationale is re-grounded** — see the `parseLoad`
note above and ADR 0004 §3's "conformance, not accommodation".

**S4 — accuracy and the invariant get separate gates.** A threshold may only average over
measurements that fail the same way. 14/15 = 93.3% cannot tell you whether a bodyweight entry parsed
slightly wrong or a model-authored load reached the database. **Holds, and is now a separate
deliverable:** [EVAL-0](./eval-0-gate-before-model.md) builds the two-gate harness ahead of the model.

**S5 — AI-1 waits for GAP-3, because the schema it extracts into is being replaced.**
**DISCHARGED, not overturned.** The sequence S5 named — legacy CSV samples → GAP-3 plan + panels →
GAP-3 → V1-13 → AI-1 ([docs/plan.md](../plan.md):160) — has run: GAP-3 is `0011` + #137/#139/#141,
V1-13 is #149/#150. The extractor is written once, against the schema it will live on, which is what
S5 was buying. **AI-1's remaining gate is EVAL-0, and it is a smaller one.**

New decisions from the re-grounding _(maintainer lane, 2026-10-06)_:

**S6 — the emit schema has no magnitude field of any dimension.** Stated and argued in § "The
inviolable rule under typed quantities". This is the decision the draft could not have made, because
the dimension-polymorphic magnitude field did not exist in September.

**S7 — the model chooses a movement from the household catalog, or says it cannot.** Not a free-text
name. `findOrCreateMovementId` (`apps/web/lib/dal/catalog.ts:76`) upserts by `movementSlug`, so a
model emitting "Bulgarian Split Squats" against a catalog holding "Bulgarian Split Squat" creates a
**second** catalog row and fragments that movement's history — exactly what ONB-1 R12a forbids, and
unrecoverable through the UI (there is no delete action; it needs a `db:correct` correction). So the
emit schema carries `movementSlug` from a closed vocabulary built from the catalog at call time, with
`movementSlug: null` as the explicit "not in the catalog" answer, which the chip surfaces as "this
will add a new movement" before confirm.

Rejected: free-text names plus fuzzy matching at the seam. Tempting because `findOrCreateMovementId`
already slugs and dedupes, so it reads like the problem is solved. It costs the distinction between
"the catalog has this" and "the catalog has something close to this", which is precisely the judgement
a slug upsert makes silently and irreversibly.

**S8 — the extraction endpoint is a Route Handler under `/p/[profileId]/`, never under `/api/`.**
AGENTS.md routes external calls to Route Handlers, not Server Actions — and the gate matcher
**excludes `/api`** (`apps/web/proxy.ts:113`). A handler at `/api/extract` would be completely
ungated: an open, metered Anthropic proxy on a public repo. The precedent and the full reasoning are
already written on the export handler (`apps/web/app/p/[profileId]/export/route.ts:16`–`:23`), which
sites itself under `/p/` for this exact reason and **re-checks the gate inside the handler anyway**,
because middleware is not an authorization boundary.

**S9 — the extraction's limiter fails CLOSED.** This is a deliberate departure from
`checkRateLimit`'s contract, which fails **open** on purpose (`apps/web/lib/rate-limit.ts:72`–`:91`):
"a Redis outage locking Ray out of his own app is a worse outcome than an outage briefly widening the
brute-force window." That trade is right for the gate and wrong here — what a dead limiter widens on
this endpoint is **metered third-party spend**, and the feature is a convenience whose fallback (type
the movement names) is the status quo, not a lockout. See § "Cost, the key, and the bound".

## EVAL-0 is the gate

[eval-0-gate-before-model.md](./eval-0-gate-before-model.md) is AI-1's accuracy/safety gate and it
ships **before** the model. Its phasing already anticipates this plan:

| Phase      | What it delivers                                                                                                       | AI-1's dependency                                                                                                              |
| ---------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **EVAL-0** | The two-gate harness, the CI check, the write-path refusal assertions, the 15 NL inputs with expectations left unbound | **Hard.** No AI-1 chunk that calls the model may merge before the invariant class is green in CI.                              |
| **EVAL-1** | Binds the 15 expected outputs to the real schema                                                                       | **Became possible when GAP-3 landed.** It binds to `extractedSessionSchema`, which is why that contract is AI-1's first chunk. |
| **EVAL-2** | Wires the model call                                                                                                   | **Is** AI-1's model chunk; the runner, gates, CI check and inputs already exist.                                               |

Precisely: AI-1 chunks 2–4 depend on EVAL-0 phase 1 being **merged and green**. Chunk 2 delivers what
EVAL-1 binds against. Chunk 3 is EVAL-2.

⚠️ **One stale anchor to fix when EVAL-0 is implemented, not here.** EVAL-0 says its invariant
enforcement "lives in `PRESCRIPTION_SHAPE` (`packages/shared/src/strength.ts`)". **`PRESCRIPTION_SHAPE`
no longer exists** — GAP-3 PR 4a deleted it with `parseLoad`; `grep -rn PRESCRIPTION_SHAPE packages
apps` returns only a docblock mention at `strength.ts:53`. The claim it was making is still true and
now cheaper: the prescription shapes are refused by the **format check** (`strength.ts:75`), which is a
type rather than a regex blocklist. Plans are kept as-merged, so this is recorded here rather than
edited into EVAL-0; its implementation PR should cite the format check.

## Plan or spec? — spec, and here is what it must hold

[write-spec](../../.claude/skills/write-spec/SKILL.md)'s test is **shared agreement, not size**:
"several PRs sharing acceptance criteria, a data contract, or an order that cannot move → **Spec**."
AI-1 is all three:

- **Shared acceptance criteria** — the two gates of S4 are asserted by EVAL-0 and depended on by every
  later chunk.
- **A shared data contract** — `extractedSessionSchema` in `packages/shared` is the seam between the
  endpoint, the chip and the eval's expected outputs. Three consumers, one definition.
- **An order that cannot move** — the gate precedes the model, for the reason EVAL-0 states: "a gate
  retrofitted around a working feature gets its thresholds tuned until the feature passes."

**Recommendation for the panel to ratify:** lift § "The target shape", § "Decisions", § "Chunks" and
§ "Cost, the key, and the bound" into `docs/specs/ai-1-nl-logging.md`, and give each chunk its own
plan. This file then stays what it already is — the **design and decision record** (it has never had a
file-by-file table) — and the per-chunk plans carry the tables. Doing it the other way round, one
400-line plan, would re-decide the contract in each PR, which is the failure the spec skill exists to
prevent.

## Chunks, in order, with the constraint that fixes the order

| #   | Chunk                                                                                                                                                                                                                                                                                                   | Why it cannot move                                                                                                                                                                                            | Est.               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 1   | **EVAL-0** — the two-gate harness, the CI check, write-path refusal assertions, the 15 inputs with unbound expectations, placeholder accuracy cases, and the two deliberate-break CI runs linked from its own plan.                                                                                     | **A gate built after the feature gets tuned until the feature passes.** It is also the only chunk with zero dependency on anything below, so it can start today.                                              | ~300, mostly tests |
| 2   | **The contract** — `packages/shared/src/nl-extraction.ts` (`extractedSessionSchema`), a `listMovementCatalog()` read in `lib/dal/catalog.ts` (none exists today — `grep -rn 'schema.movements' apps/web/lib/dal` shows only the find-or-create), and EVAL-1's binding of the 15 expected outputs to it. | Both the endpoint and the chip are written **against** this type, and EVAL-1 cannot bind expectations to a shape with no name. No migration, so there is no DB ordering constraint — the contract is pure TS. | ~200               |
| 3   | **The call** — the Route Handler at `/p/[profileId]/extract` (**S8**), `lib/dal/nl-extract.ts` (`server-only`, owns the key), the second rate limiter (**S9**), `ANTHROPIC_API_KEY` in `lib/env.ts`, the typed error envelope, Sentry context. **No UI.** This is EVAL-2.                               | Needs chunk 2's contract to validate against, and must not merge before chunk 1 is green — the invariant class has to be able to fail before anything exists that could violate it.                           | ~250               |
| 4   | **The chip** — the input, the call, the chip, correction, and `fillFromExtraction` beside `fillFromProgram` (`strength-form.tsx:322`), reusing its undo stash and announcement.                                                                                                                         | Last because it is the only chunk whose correctness cannot be proven without the other three, and because it is the chunk whose scope is most negotiable if the budget runs out. **Gets the UX panel.**       | ~350               |

**Parallel:** chunks 1 and 2 touch disjoint files and share no contract (EVAL-0's expectations are
deliberately unbound), so they can run concurrently. Chunks 3 and 4 are serial after both.
Every chunk is under the <400-line target.

## Cost, the key, and the bound

**Where the key lives.** `ANTHROPIC_API_KEY` is added to `apps/web/lib/env.ts` (which is
`import 'server-only'` at `:1` and the single `process.env` reader, `:15`), as `.optional()` —
following the V1-14a precedent at `:24`–`:32`: local dev, CI and un-wired previews must boot without
it. It is read **only** from `lib/dal/nl-extract.ts`, which is `server-only`; no `NEXT_PUBLIC_`
prefix, ever (AGENTS.md "don't" list). The Route Handler stays thin: gate check → zod → DAL →
envelope, the write-path three-layer seam applied to a read.

**The SDK and the mechanism.** `@anthropic-ai/sdk`, `claude-opus-5-5`, with **structured outputs**
(`output_config: { format: … }` on `messages.create`, or the SDK's `messages.parse()` helper), and
**not** a forced tool call — `tool_choice: {type:'any'|'tool'}` returns a 400 on this model. The
response is re-validated through `extractedSessionSchema` server-side regardless of what the helper
did: an SDK helper is a convenience, never the trust boundary.

**The cost shape, measured not assumed.** Input is a system prompt plus the movement catalog (36
seeded rows — `grep -c 'slug:' packages/shared/src/catalog-movements.ts`) plus one sentence: on the
order of 1.5K input tokens. Output is a handful of movements: a few hundred tokens, plus adaptive
thinking, which bills as output. At `claude-opus-5-5`'s $4/$20 per MTok that is roughly **$0.01–0.04
per extraction**, so a 20-extraction evening is pennies and an unbounded endpoint is not.
Two consequences:

- **Effort starts at `low`** (`output_config: { effort: 'low' }`) because this is a short extraction,
  with the eval's accuracy class as the evidence for whether it holds. Thinking cannot be disabled on
  this model, so effort is the lever.
- **Prompt caching is NOT claimed.** The minimum cacheable prefix is model-dependent and in the
  512–4096 token range, and a ~1.2K-token stable prefix may simply never cache — silently. If caching
  is wired, `usage.cache_read_input_tokens` must be asserted non-zero across repeated calls, or the
  claim is unverified.

**The bound, and what it can honestly be keyed on.** AGENTS.md requires a rate limit on the LLM API.
Two facts constrain the design:

1. **There is no household identifier yet.** Clerk is not installed (`grep -rn clerk apps/web/package.json`
   → nothing), there is no `getCurrentUser()`, and `rate-limit.ts:13`–`:18` records why the mutating
   actions are deliberately unlimited: their only identifier is a caller-supplied `profileId`, so an
   attacker rotates a fresh UUID per request for a fresh bucket. The same is true here. A
   per-household bound becomes real at AUTH-1/TEN-1; **AI-1 must not claim one it cannot key.**
2. **`limiter` is one module-level instance bound to `GATE_RATE_LIMIT`** (`rate-limit.ts:36`, `:53`).
   A second policy needs a second named instance, not a reused one.

So the bound is **two limits, both named consts in `apps/web/lib/rate-limit.ts`** (app-only policy
values, per AGENTS.md's blast-radius rule — the same class as `GATE_RATE_LIMIT`, not `packages/shared`):

| Bound                                                            | Identifier                                                                                                                            | What it holds                                                                                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Burst** — a sliding window on the order of 20 calls / 10 min   | the Vercel-computed client IP (`x-real-ip` via `@vercel/functions`), the gate's identifier and the only one an attacker cannot rotate | the spend bound that actually holds                                                                                              |
| **Daily** — a fixed-window per-day cap on the order of 100 calls | the route's `profileId`                                                                                                               | a **cost ceiling and a UX signal, explicitly not a security bound** — stated in the docblock so nobody later mistakes it for one |

Both **fail closed** (**S9**), and both are a single knob to tune when the real evening pattern is
known (the household logs after 6:30pm, so the daily cap is sized against a session, not a day of
browsing). With the burst limit the worst case an attacker holding the gate code can spend is bounded
by IP × window × ~$0.04; without it, it is not bounded at all.

## Risks / rollback

| Risk                                                                                            | Mitigation                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A near-duplicate catalog row from an extracted movement name — **unrecoverable through the UI** | **S7**: closed vocabulary + explicit `null`, and the chip names a new movement before confirm. If one lands anyway, it is a `db:correct` correction plus its own bug PR, per AGENTS.md.                                                                                                                         |
| The emit schema is widened later and a magnitude creeps in                                      | Acceptance 1's three layers, and the widening lesson is already written on `ScaffoldRow` (`strength-form-scaffold.ts:34`: "A future post-GAP-3 load chip widens this Pick deliberately; it cannot inherit the access by accident").                                                                             |
| An un-gated metered endpoint                                                                    | **S8** — sited under `/p/`, gate re-checked in the handler, per the export route's precedent.                                                                                                                                                                                                                   |
| A dead limiter silently un-bounds spend                                                         | **S9** fail-closed, plus `isRateLimitConfigured` (`rate-limit.ts:69`) already exists so "off" is distinguishable from "broken".                                                                                                                                                                                 |
| The model's text is rendered unsafely                                                           | Treated as untrusted data: zod at the boundary, rendered as text, never `dangerouslySetInnerHTML` (AGENTS.md "don't" list). The movement name reaches `movements.name` and `entries.movement_name` verbatim, which is why the comma/newline refusal at `strength-session.ts:51`–`:59` is load-bearing here too. |
| Minors' utterances leave the household to a third party                                         | **Privacy is its own review lens** (AGENTS.md). The utterance is sent; nothing is logged beyond a correlation id; no utterance or model output in Sentry breadcrumbs. This needs the `privacy-reviewer` lens on chunk 3, and the question "should we hold this at all" answered in the open, not assumed.       |
| The eval fixture seeds real names                                                               | `docs/plan.md`:264 already requires the 15-case fixture be synthetic from the start. EVAL-0 owns it.                                                                                                                                                                                                            |

**Rollback:** nothing here is a migration, so every chunk reverts by revert. Chunk 3 additionally
reverts by removing `ANTHROPIC_API_KEY` from the environment — acceptance 9 makes the feature
unavailable rather than broken when the key is absent, which is the cheapest kill switch available.

## What the re-grounding overturns

| Draft said                                                                                   | Now                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Field-level equality on "profile, movement, activity, set count, reps, **duration**"         | **Duration is not emitted.** It shares the one dimension-polymorphic magnitude field a load lives in (`strength.ts:64`), so emitting it would reopen the load. **S6**, and the accepted cost in the Goal.                                     |
| …"**activity**"…                                                                             | **Out of scope.** V1-7 made wake and practice one tap through a trusted key set (`logLifeActivitiesAction`); a sentence is strictly more work than the tap that exists. AI-1 is the strength session.                                         |
| …"**profile**"…                                                                              | **A hint, never a selector.** The route's `profileId` is authoritative (acceptance 8). A model-chosen profile would let an utterance route a write to another child's log — a BOLA-shaped hole in a feature whose whole point is convenience. |
| S3's rejection cited `parseLoad`'s permissive fallthrough at `strength.ts:137`               | **`parseLoad` is deleted** (GAP-3 PR 4a; `strength.ts:46`–`:54`, and `grep -rn parseLoad packages/shared/src` returns only docblocks). The decision stands with a better reason: the shapes are now **unrepresentable**, not blocklisted.     |
| S5: "GAP-3 must land first"                                                                  | **Discharged.** The remaining gate is EVAL-0.                                                                                                                                                                                                 |
| "the fields the model emits … will be shapes compatible with the entry schema" (S3, unnamed) | Named exactly: `extractedSessionSchema`, § "The target shape".                                                                                                                                                                                |

## Out-of-scope / deferred

- **Life activities, check-ins, bodyweight** — strength sessions only (above).
- **`status: 'skipped'`** on an extracted movement. The write path requires a skipped movement to
  carry **zero** sets (`strength-session.ts:186`–`:200`), so emitting it needs a cross-field refine
  mirroring that rule. Not worth chunk 4's budget; `reps.min(1)` keeps the emit schema flat.
- **Supersets.** Expressible on the write path (`supersets`, `strength-session.ts:121`) and plausible
  in an utterance, but it adds a second grouping payload the chip has to show and correct. Deferred.
- **`dayRole`.** The athlete asserts which programmed day it was (GAP-1 P0-1); never derived, and a
  model saying it is a derivation.
- **Voice input.** The input is a textarea. Speech is the phone keyboard's job.
- **Per-unit ceilings** — V1-30b-ii's work (`docs/plans/v1-30b-form-stops-inviting.md:220`).
- **A per-household bound** — needs AUTH-1/TEN-1 for an identifier that is not caller-supplied.
- **Offline.** The extraction needs the network; v1.5's outbox covers the submit, not the call.

## Open questions

1. **Chunk 4's entry point.** Does the input sit on the strength form (a second filler beside "Start
   today's program") or above it as its own affordance? A form that opens with a prose box may read as
   "type a sentence instead of logging", which is not what it is. **For the UX panel.**
2. **The 15 cases' source.** EVAL-0 holds the sentences; they must be synthetic
   ([docs/plan.md](../plan.md):264) and still representative of how this household actually talks.
   Who authors them, and against what?
3. **Does the chip show `movementSlug` resolution at all,** or only the resolved display name? Showing
   "matched: Front Squat" is honest about what confirm will do; it is also a word a parent did not ask
   for. **For the UX panel.**

## Context read

`packages/db/src/schema.ts` (`entries`, `entry_sets`, `entry_set_quantities`, `quantity_slots`,
`movements`) · `packages/db/src/writers/strength-session.ts` · `packages/shared/src/strength.ts`,
`strength-session.ts`, `units.ts`, `quantity-slots.ts`, `catalog-movements.ts` ·
`apps/web/app/p/[profileId]/actions.ts`, `strength-form.tsx`, `strength-form-scaffold.ts`(+ test),
`export/route.ts` · `apps/web/lib/{env,rate-limit}.ts`, `lib/dal/catalog.ts` · `apps/web/proxy.ts` ·
[features/strength-logging.md](../features/strength-logging.md) (invariants 1, 2, 4, 4b),
[features/write-path.md](../features/write-path.md) ·
[ADR 0004](../decisions/0004-typed-measurements.md) · [eval-0 plan](./eval-0-gate-before-model.md) ·
[v1-30b plan](./v1-30b-form-stops-inviting.md) · [v1-22 spec](../specs/v1-22-authoring-program-editing.md)
(chunk-ordering format) · [v1-22-1 plan](./v1-22-1-prescribed-snapshot.md) (quality bar) ·
[write-spec skill](../../.claude/skills/write-spec/SKILL.md).

## Review-response log (adversarial panel)

⏸ **Superseded 2026-10-06.** The engineering + security panels have since run; their eleven blocking
findings — five of them transcribed with their pinned sources — are in § "Parked 2026-10-06", which is
also why this plan is parked. The **UX panel and the privacy lens are still owed**, along with a full
reconciliation log, before any implementation code. The paragraph below stands as written.

_Empty — the panels have not run._ Owed before any implementation code
([AGENTS.md](../../AGENTS.md), [plans/README.md](./README.md)): the **engineering panel** (≥3 lenses —
correctness/data-integrity, simplicity/scope, architecture/consistency, reuse/DRY), the
**privacy lens** (a third-party call carrying minors' training data), and — because chunk 4 is UI —
the **UX panel**. The panel's first job is to rule on § "Plan or spec?": if it agrees, this file's
sections become `docs/specs/ai-1-nl-logging.md` and each chunk gets its own plan.
