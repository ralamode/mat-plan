# mat-plan — Product Spec

> **What this document is.** The product: who it is for, why it should exist, what it simplifies, and
> where it is going. Written to be readable by a human who has never opened the codebase.
>
> **What it is not.** Architecture and data model live in [spec.md](./spec.md). The PR backlog lives in
> [plan.md](./plan.md). Build rules live in [../AGENTS.md](../AGENTS.md). This file holds **product**
> decisions only — when the two disagree, `spec.md` wins on _how_ and this file wins on _why_.
>
> **Version 1** · 2026-09-16 · Reviewed by a 3-lens panel (Director of Product Development · Senior
> Product Manager · Staff SWE). Review-response log at the end.
>
> **Honesty rule.** This spec describes a product mid-build. Every capability claim is marked
> **Shipped**, **Next**, or **Later**. If a sentence here reads as present-tense fact, it is Shipped —
> that is the standard this document is held to, because the repo's own README currently fails it (see
> [§9](#9-known-gaps-between-the-docs-and-the-build)).

---

## 1. In one paragraph

**mat-plan is a training log for a youth athlete and the adult who programs for them.** A parent or
coach sets up the athlete's daily routine and their strength program; the athlete taps through the day
on a phone — wake, weigh-in, drill work, lifts, conditioning — and it gets recorded against what was
planned. It is built for the place it is actually used: a gym floor, on a phone, between sets, by a
twelve-year-old with cold hands. Its defining constraint is what it **refuses** to do — no language
model ever writes a training load into this system, because a wrong load is an injury, and a
suggestion no human authored is not worth the risk it carries.

---

## 2. Why this should exist

### The problem, stated plainly

A kid who trains seriously generates a surprising amount of data in a day: what they weighed, when
they woke, the drill block, the lift, the sets, the reps, whether the last set failed, whether they
did the thing they were supposed to do at all. Almost none of it gets recorded, because **recording it
is more work than doing it.**

The honest incumbent is not a competitor product. It is a **notes app, a paper sheet on the fridge, or
nothing.** That matters, and it sets the bar: a logger that is slower than typing into Notes loses to
Notes, no matter how good its data model is.

### Why the existing options don't fit

| What exists                                  | Why it misses                                                                                                                             |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Adult lifting apps** (Hevy, Strong)        | Built for one adult logging their own barbell work. No concept of an adult who programs _for_ someone else, and no vocabulary for drills. |
| **Team platforms** (TeamBuildr, TrainHeroic) | Built for a coach issuing a program to a squad, priced and shaped for a school or club. A parent with two kids is not the customer.       |
| **Spreadsheets**                             | Infinitely flexible, and that is the problem — every family invents a schema, and none of it aggregates or survives a season.             |
| **Nothing**                                  | The most common option, and the real competitor.                                                                                          |

The gap is the **household**: one adult, one to three athletes, a program the adult is responsible for,
and a kid who has to record against it without an adult standing over them.

### Why now, and why it's tractable

Youth sport has professionalized — a middle-school wrestler may lift three days a week on a written
program. The tooling has not followed. And the piece that used to make this expensive, turning "Liam
did three sets of eight pull-ups" into structured data, is now cheap enough to be a feature rather than
a company (see [§5](#5-the-one-inviolable-rule)).

---

## 3. Who this is for

Two roles, and they are genuinely different people with different jobs. Conflating them is how this
product goes wrong.

### The adult — parent or coach _(authoring)_

Sets up athletes, builds each one's daily routine, enters the strength program, and reviews the week.
**Not necessarily an S&C expert** — that is the whole premise, and it is why every "just confirm this"
interaction in the app is treated as suspect. They own every training load in the system, because
someone qualified has to.

> **Job:** _"Get the program my kid is supposed to follow into a thing they'll actually use, without
> becoming a developer or a data-entry clerk."_

### The athlete — the kid _(logging)_

Taps through their day. Phone or iPad, gym floor, between sets, one-handed, distracted. Zero expertise
assumed and none required — **everything they log is a record of something they already did.**

> **Job:** _"Record what I just did without losing my place, and without my dad having to do it for
> me."_

### On the boundary between them

The athlete logs performance. The adult authors prescription. That line is the product's spine, and it
is not a legal hedge — it is how coached sport actually works, and it is the same line the safety model
draws in [§5](#5-the-one-inviolable-rule).

It is **deliberately not a wall.** A kid logging a set they just performed needs no permission, and an
athlete doing the workout they've done all season without a written program is a first-class case, not
an edge case — the app supports logging with no plan at all. What the athlete never does is originate a
load they weren't given.

> **Note on a correction.** An earlier pass through this roadmap drifted toward parent-only logging out
> of a misplaced worry about minors and programming. That conflated two different things: **authoring a
> program** (an adult's job, for real injury-risk reasons) and **recording a set you already
> performed** (nobody's risk). The drift is corrected here. The roadmap still carries its fingerprints
> — see [§9](#9-known-gaps-between-the-docs-and-the-build).

### Explicitly not the user

A **team or squad**. One coach issuing to thirty athletes is a different product with different
pricing, different permissions, and a different buyer. The data model would stretch; the product would
not.

---

## 4. What it simplifies

### Before

The program lives in a document. The day lives in the kid's head. What actually got done lives nowhere
by dinner. If an adult wants to know whether the last four weeks of programming worked, the honest
answer is that the evidence was never collected.

### After

The day is a list on a phone. Each item is one tap or one number. The strength work is checked against
what was prescribed, so "did we do the program" stops being a memory test. At the end of the week
there is a record that can be read, exported, and compared against the plan.

### The three things that are genuinely hard, and what we do about them

**1. Logging has to be faster than not logging.** Every activity is one tap or one number
(**Shipped**). Weigh-in is pinned first. Each athlete's routine is their own ordered list, so nobody
scrolls past four things they don't do. The remaining offender is strength: the athlete still types
each movement name and adds a row per set. We know. It is the most-cited weakness in this document and
has three separate backlog items pointed at it (**Next** — V1-19, V1-21, AI-1). Concretely: a
3-movement, 3-set session is ~30 interactions, and the movement name is retyped freehand each time with
browser autocomplete disabled — even though the program card directly above it already knows the name.
Everything else in the day is one tap or one number, and already beats the alternative.

**2. Setup can't require a developer.** Today a new athlete's routine is editable in-app
(**Shipped**); the strength program is still code. Closing that is the single largest piece of work
between here and other families using this (**Later** — ONB-0, ONB-1).

**3. Recording anything shouldn't require a migration.** The app models _activities_ generically rather
than hard-coding a table per thing. A wrestling drill, a wake time, a bodyweight, and a barbell squat
are the same kind of record with different shapes. In practice: two whole new activities shipped
without a schema change (**Shipped** — see [§7](#7-what-makes-this-defensible)).

---

## 5. The one inviolable rule

> **No language model ever authors a training load.**

This is the product's sharpest position and its best engineering. It deserves to be stated precisely,
because the precision is the point.

**Why.** A training load is not a suggestion, it is a physical instruction to a child's body. A wrong
one is an injury. A load carries authority only if a human performed it or a rule a parent can read
derived it — and once written to a row, those origins are indistinguishable from a number a model
produced. So the origin has to be constrained before the write, not audited after.

**How, and why it's not a slogan.** The constraint lives in the schema: the model's output type **has
no load field**. Not "the prompt says not to" — a prompt can only ask; a schema can refuse. The
extraction is shown back to the human as a chip, they confirm it, and it **prefills a form with the
load field empty**. A person types every load.

**What the confirm step is actually for.** Catching parse errors — wrong movement, wrong reps, wrong
kid. It is explicitly **not** the safety mechanism, because approving something fifty days running
becomes reflex, and a guarantee that depends on a tired parent's attention on day fifty is not a
guarantee. You cannot test that a human will pay attention; you can test that a field does not exist.

**How we prove it.** The accuracy of the extraction and the never-writes-a-load property are gated
**separately** in CI — the first is a threshold you can average, the second is binary and any violation
fails outright. Averaging them would let a safety breach hide inside a 93% pass rate.

**Status: Later.** No AI feature has shipped. The rule is already binding on humans, though — a
planned feature that would have pre-filled prescribed loads into the log form was rejected in review on
exactly this reasoning, and the real program was transcribed by hand rather than generated.

Full reasoning: [plans/ai-1-nl-logging.md](./plans/ai-1-nl-logging.md).

---

## 6. Target market

**Beachhead: wrestling families.** It is the sport this was built inside, the vocabulary is already
modeled (drill blocks, shots, bridges, rice bucket, weigh-ins), and weight management makes daily
logging a habit wrestling families already have. Weigh-ins are the wedge — the one thing they'd track
anyway.

**Adjacent, and reachable without a rewrite:** any youth sport with an off-mat strength component —
gymnastics, swimming, track, hockey. The activity model is generic; the wrestling vocabulary is seed
data, not schema. That is a real architectural claim, and it is the main thing the generic data model
was bought for.

**The buyer is the parent.** They feel the problem, they own the program, and they have the phone.

**Rollout, in order.** (1) **Ray's own athletes** — the real users today, wrestling programming, the
only validation that currently matters. (2) **Friends' kids**, onboarded by invitation. This is the
first outside test, and the reason self-serve onboarding and real sign-in are being built now rather
than later — the channel has to exist before anyone can walk through it. (3) **Wrestling families
generally**, if and only if step 2 produces evidence anyone wants this. Each step is a real gate, not
a phase of a launch plan.

**Honest evidence gap — read this before treating the market as validated.** No customer discovery has
been done. No interviews, no survey, no waitlist, no second family. The market case above is reasoning
from one household's experience, and reasoning is not evidence. The cheapest way to get real signal is
to finish the open-source release and see whether anyone outside this house asks for it. Until then,
every sentence in this section is a hypothesis.

---

## 7. What makes this defensible

**1. The safety position.** In a market rushing to put language models into coaching, "our AI is
structurally incapable of telling your kid how much to lift" is a real differentiator, and it costs
almost nothing to hold — the mechanism is a missing field.

**2. The activity model.** One record type with a checked either/or — an entry points at a movement or
a metric, never both, enforced by the database rather than by app code. A squat, a wake time, a
bodyweight, and a drill block are all the same shape. Adding an activity is usually a catalog row
rather than a migration, and that has been demonstrated, not just claimed.

**3. Built for the gym floor, and enforced.** ≥44px tap targets and a 360px-wide layout aren't design
guidance here, they're a **CI check that fails the build** — measured in a real browser at phone width.

**4. The proof harness.** A 2,900-line verification suite runs against a real Postgres and asserts that
the exact queries the app runs behave correctly, that constraints reject what they should, that seeds
are idempotent, and that no database constraint has drifted from its TypeScript definition. This is
infrastructure most funded teams don't build, and no product-facing document has ever mentioned it.

---

## 8. Where the product actually is

Precision matters more than optimism. **Shipped** means merged and working today.

| Capability                                                                         | Status                                        |
| ---------------------------------------------------------------------------------- | --------------------------------------------- |
| Per-athlete daily routine, in each athlete's own order                             | ✅ Shipped                                    |
| Weigh-ins, measurements, habit check-ins, one-tap life activities (wake, practice) | ✅ Shipped                                    |
| Calisthenics counters with a weekly target + adherence bar                         | ✅ Shipped                                    |
| Strength sessions: multi-movement, supersets, per-set feel, skipped, sub-failure   | ✅ Shipped                                    |
| Fix a mistyped set                                                                 | ✅ Shipped                                    |
| "Today's program" card — the day's prescribed movements, read-only                 | ✅ Shipped                                    |
| In-app routine editor for the adult                                                | ✅ Shipped _(reachable by URL only)_          |
| Rate limiting + error monitoring                                                   | ✅ Shipped                                    |
| **CSV export**                                                                     | 🔜 Next _(blocked — see §9)_                  |
| **One-tap "start today's program"** — builds the log form from the plan            | 🔜 Next                                       |
| **Real accounts** — one-tap OAuth household sign-in                                | ⏳ Later — today: one shared password         |
| **Offline**                                                                        | ⏳ Later                                      |
| **Natural-language logging**                                                       | ⏳ Later                                      |
| **Progression suggestions** from logged history                                    | ⏳ Later — the engine is an empty placeholder |
| **History / past days / dashboard**                                                | ⏳ Later                                      |
| **Self-serve setup for a new family** — sign in, add athletes, author a program    | ⏳ Later — first run is broken for strangers  |

### What protects the app today

One shared password, hashed into a cookie. Its own source comments call it a deliberate stopgap and
not an authorization boundary. **Profile tiles are a UX switch, not a security boundary** — any user
can open any athlete. That is acceptable for one family and unacceptable the moment a second one
exists.

---

## 9. Known gaps between the docs and the build

Found by the review panel, verified against the tree on 2026-09-16. Listed because a product spec that
inherits its own README's errors is worthless.

| Claim in the repo today                           | Reality                                                                                        |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| README: "works **offline**"                       | **False.** No service worker, no offline storage, no sync endpoint. The _data model_ is ready. |
| README lists **Clerk** in the stack               | **False.** Not a dependency. Auth is the shared-password stopgap.                              |
| Spec: "coexists with the Claude + CSV workflow"   | **Not yet.** No exporter exists in any source file.                                            |
| "The progression engine"                          | **Empty.** A three-line placeholder.                                                           |
| Spec §1: the app is for the kids to log their day | **Drifted.** Nearly every feature added since July serves the adult. See below.                |

**The drift, and what it costs.** The premise is a kid logging their day. But the last several months
of work — routine editor, program card, cross-athlete editing, program import — all serve the adult,
while the one item that asks whether the kid's logging screen is usable at all sits below the MVP line.
The kid's hardest task, logging a strength session, is still hand-typing every movement name and
adding a row per set. **Correcting this is the main product action arising from this spec**: the
athlete's path is the premise, and it should be prioritized like the premise.

**The bottleneck.** CSV export has been blocked since early August on four legacy sample files that
only Ray can produce, and that block now sits in front of the typed-measurement rework, CSV export, the
AI feature, and the open-source release. It is the highest-leverage unblock in the project and it is a
find-four-files task, not engineering.

---

## 10. Goals and non-goals

**Goals**

1. An athlete logs a full training day on a phone faster than they could type it into Notes.
2. An adult sets up an athlete, their routine, and their program without a developer — signing in
   with **one-tap OAuth**, not a form. Onboarding friction decides whether an invited family ever
   becomes a user, so it is a product requirement, not a setup detail.
3. What was prescribed and what was performed are both recorded, and comparable.
4. The data belongs to the family — exportable in a format they can read.
5. Nothing in the system originates a training load except a human or a rule that human can read.

**Non-goals**

1. **Writing training programs for people.** The app records and organizes a program; it never
   authors one.
2. **Coaching advice.** No form correction, no injury guidance, no "you should be lifting X."
3. **Teams and squads.** A different product for a different buyer.
4. **A social network.** No feeds, no leaderboards, no comparing kids to other kids.
5. **Nutrition and weight cutting.** Bodyweight is recorded because the sport requires it. Advising a
   minor on making weight is a line this product does not go near.

---

## 11. How we'll know it works

Product success and portfolio success are different things and get measured separately.

**Product**

1. **Unassisted logging:** the athlete logs ≥80% of training days across two consecutive weeks with no
   adult touching the device.
2. **Speed:** a full strength session logged in ≤60 seconds of interaction.
3. **It survives a season:** one athlete logs ≥4 consecutive weeks with no gap longer than three days.
   _(Retention appears in no other document in this repo.)_
4. **Workflow parity:** a weekly review generated from exported data is as useful as the hand-maintained
   version it replaces.
5. **Zero model-authored loads in production.** Binary, and already gateable in CI.

**The first real test is unrun.** No athlete has used this yet. Until #1 has been attempted for two
weeks, everything above is a plan, and the build is unvalidated against the only user who matters.

---

## 12. Risks

| Risk                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Severity          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| **Nobody logs.** The premise is behavior change; the app is all schema. Today the only motivational surface in the product is one adherence bar. **Being answered** by the **MOT** group — streaks, reminders, a daily quote ([plan.md](./plan.md)) — which did not exist as a coherent workstream until this spec named the risk.                                                                                                                                                                                                                      | **High**          |
| **The strength-logging path is slower than Notes.** ~30 interactions for a 3×3 session — every movement name retyped freehand with autocomplete off, a tap per set row — while the program card above already knows the movement names. Narrowly scoped on purpose: the one-tap activities (wake, weigh-in, rice bucket) already beat Notes. V1-19 targets exactly this.                                                                                                                                                                                | **High**          |
| **Children's data.** ~~Decided: post-MVP.~~ **No longer deferred — the review is done** (PRIV-1, 2026-10-07: [docs/privacy/](./privacy/)). It was gated on "before the first friend's kid onboards", and that is Beta 0. What exists now: a notice listing what is stored and every processor, a retention policy, a defined household deletion, and the consent requirements AUTH-1 must wire. ⚠️ **Still open, and named in the notice rather than hidden:** three vendor retention windows, the contact route, and whether any of it needs a lawyer. | **Done — PRIV-1** |
| **No market evidence.** §6 is a hypothesis. Building the onboarding story before anyone asks is the expensive version of being wrong.                                                                                                                                                                                                                                                                                                                                                                                                                   | **Medium**        |
| **A second household hard-fails today.** Movement names are globally unique, so the second family to add a common lift hits a write error. Known; unfixed.                                                                                                                                                                                                                                                                                                                                                                                              | **Medium**        |
| **Units.** Pounds only. No kilograms, no heights or distances. A metric household is unrepresentable.                                                                                                                                                                                                                                                                                                                                                                                                                                                   | **Medium**        |
| **~4 hours a week** against a backlog with 20+ open items.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | **Medium**        |

---

## 13. Open questions

1. **Is the kid's logging experience good enough to test?** Should the entry-UI review be pulled above
   the MVP line, ahead of export? The premise says yes; the roadmap currently says no.
2. **What is the minimum honest export?** Two of the four legacy CSVs have no real rows. Does the
   smaller, real export unblock the chain sooner?
3. **How does a second family actually get in?** Needs first-run, household-scoped movement names, and
   real accounts. Which is the true first domino?
4. **Where does the market signal come from?** If the open-source release is the cheapest source, does
   it move ahead of the AI feature it currently sits behind?
5. **Which OAuth provider, and what does an invited family's first 60 seconds look like?** "Quick" is
   the requirement; the flow is unspecified.

---

## Review-response log

Panel run 2026-09-16 — Director of Product Development · Senior PM · Staff SWE. Each critique is
incorporated or pushed back on, per [AGENTS.md](../AGENTS.md).

| #   | Lens     | Critique                                                                                                 | Response                                                                                                                                                                                                          |
| --- | -------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Director | Cut the market claim entirely; frame as one family's tool published as portfolio evidence.               | **Pushed back — owner's decision.** Ray's stated intent is a real product for sports parents. Their underlying point is kept in full: §6 carries an explicit evidence gap, and no market is claimed as validated. |
| 2   | Director | Don't lead with portfolio; leading with "families like yours" makes a hiring manager smell a demo.       | **Incorporated.** §1 leads with the product and the user. Portfolio framing is absent — it belongs in the README rewrite, a different document for a different reader.                                            |
| 3   | Director | No customer discovery exists anywhere in the repo.                                                       | **Incorporated** as a bolded evidence gap in §6 and a Medium risk in §12.                                                                                                                                         |
| 4   | Director | The real incumbent is a notes app or nothing; the repo is all schema and zero behavior change.           | **Incorporated** — §2 names the honest incumbent, and "nobody logs" is the top risk in §12.                                                                                                                       |
| 5   | Director | Add a dogfood metric; no document states one.                                                            | **Incorporated** as §11's first criterion, with the admission that it is unrun.                                                                                                                                   |
| 6   | PM       | The product in the docs is no longer the product in the backlog — everything since July is adult-facing. | **Incorporated as the spec's central correction.** §3 makes two roles explicit; §9 names the drift and the cost. Root cause supplied by Ray: an over-correction about minors and programming, recorded in §3.     |
| 7   | PM       | Be exact about shipped vs. aspirational.                                                                 | **Incorporated** — §8 is a three-state table, and §9 lists the specific false claims, each verified against the tree.                                                                                             |
| 8   | PM       | Promote day-navigation into the MVP; a logger you can't read back is a write-only database.              | **Partially incorporated.** Raised as Open Question 1 rather than decided — reordering the MVP is Ray's call, not this document's.                                                                                |
| 9   | PM       | Retention appears in no document.                                                                        | **Incorporated** — §11 criterion 3, flagged as novel.                                                                                                                                                             |
| 10  | SWE      | README claims offline and Clerk; neither exists. No exporter, no API directory, empty engine.            | **Incorporated** — independently verified before writing, tabled in §9. No capability claim in this spec is unmarked.                                                                                             |
| 11  | SWE      | The entity model is the real differentiator and is explainable to a non-engineer.                        | **Incorporated** — §4 item 3 and §7 item 2, in plain language, citing the no-migration proof rather than the claim.                                                                                               |
| 12  | SWE      | The safety invariant is strong precisely because it costs nothing — a missing field, not a slogan.       | **Incorporated** — §5 is built on that distinction, including the separate CI gates and why averaging them would hide a breach.                                                                                   |
| 13  | SWE      | lb-only, one household, routine editor unprotected.                                                      | **Incorporated** — §8 and §12.                                                                                                                                                                                    |
| 14  | SWE      | The 2,900-line verification harness is the most under-sold thing in the repo.                            | **Incorporated** — §7 item 4, first time it appears in any product-facing doc.                                                                                                                                    |
