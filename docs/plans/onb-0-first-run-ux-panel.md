# ONB-0 — first-run UX panel

**Date:** 2026-08-26 · **Status:** panel complete, awaiting Ray · **Scope:** ONB-0 (first-run is broken)

Run per [AGENTS.md](../../AGENTS.md) → **UI PR rules**: a new screen/flow gets the full multi-lens
panel, **before** implementation. Three standing lenses, each prompted to find flaws. Every critique
below is grounded in code that was opened; line references are to `main` at 8f4e807.

**The spec under review** is ONB-1 **R2**: _"A stranger's first Today is an explained empty state:
what this app is, what happens next, and a control that takes them to — or inlines — the place they
author their movements."_ Plus a neutral default routine.

---

## What the code actually does today

Read before critiquing, because two of the three lenses turned on details the spec didn't have.

| Surface                                  | Behaviour                                                                                           |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `apps/web/app/page.tsx:25`               | With zero profiles: `<EmptyState>No profiles found. Seed the database to get started.</EmptyState>` |
| `packages/shared/src/routine.ts:100,117` | `routine_config = null` → `buildDefaultRoutine(ROUTINE_CATALOG)`                                    |
| `apps/web/lib/routine/catalog.ts:16`     | `ROUTINE_CATALOG` = `strength` + **every** `CHECKIN_FIELDS` entry + **every** life activity         |
| `apps/web/lib/dal/profiles.ts:24`        | `listProfiles()` is **not household-scoped** — it returns every profile in the DB                   |
| `apps/web/app/p/[profileId]/routine/`    | The editor exists; **nothing links to it** (only an outbound link back to Today) — V1-20            |
| `packages/db/src/seed.ts`                | The **only** writer of profiles                                                                     |

**The default routine, counted.** Not "some family shorthand" — the entire catalog:

- weigh-in (pinned) + the strength form
- **3 habit checkboxes** — Rice bucket · Brain rep · Splits
- **7 numeric fields grouped under the label "Brush teeth"** — stance, ladder, bridge, mobility,
  pressure, reaction, shot (`ACTIVITY_METRIC_MAP.brush_teeth`)
- **4 calisthenics counters**
- **2 life controls** — Wake, Wrestling practice

**≈17 controls**, on the first screen a stranger ever sees.

---

## Lens A — interaction design · first-run · cognitive load

**A1 — BLOCKING. ONB-0 is two defects with different dependencies, and one of them cannot be
exercised by any real user yet.** The row bundles (a) the zero-profiles empty state and (b) the
null-`routine_config` default. But **no new household can exist**: `seed.ts` is the only writer of
profiles, so defect (b) is unreachable until profile CRUD (ONB-1 slice 1). Shipping them together
means the half that works today waits on the half that has no user.

**A2 — BLOCKING. The default-routine problem is an order of magnitude worse than "wrong names."**
The PRD frames it as a stranger seeing _Ray's family's routine_. The real failure is that the default
is `ROUTINE_CATALOG` — **everything** — so the first screen is ~17 controls with no explanation. Even
if every label were perfect, this is the wrong first screen. Renaming fixes nothing.

**A3 — "Brush teeth" is the single worst string in the product.** It groups seven wrestling drills
(stance/ladder/bridge/mobility/pressure/reaction/shot) under dental hygiene. A stranger doesn't read
it as odd naming; they read it as _the app is broken_.

**A4 — R2's CTA has no destination.** "A control that takes them to the editor" — but at zero
profiles there is **no `profileId`** to route to, and the editor is unreachable anyway (V1-20, no
inbound link). As written, R2 specifies a button that cannot be built.

**A5 — the reachable audience today is not who the spec describes.** `listProfiles()` is unscoped and
prod is seeded, so the "No profiles found" screen never appears to a family. It appears to **anyone
who clones the repo and runs it** — which is the OSS-1 audience, and is a real, current, first-
impression defect. That's a _better_ justification for the fix, not a worse one, but it changes the
copy: the reader is a developer evaluating the project, not a parent.

## Lens B — a11y · adaptive/responsive

**B1 — `EmptyState` renders a `<p>`** (`components/ui/empty-state.tsx`). A CTA placed inside it must
be **phrasing content** — an `<a>` or `<button>` is legal; a `<div>`-wrapped card is **invalid HTML**
and will nest-break. The obvious implementation ("drop a CTA card in the empty state") is the one that
breaks. Either use phrasing content or render the CTA as a sibling.

**B2 — a text link inside a muted `<p>` will fail the 44px CI gate.** `e2e/a11y.spec.ts` asserts a
bound-label ≥44px bound — the same gate the V1-9/P1-1c panel caught an `aria-label`-only checkbox on.
An inline link styled as body text is very likely under it. Do the math before implementing, don't
discover it in CI.

**B3 — heading order.** `/` already has `<h1>` _"Who's logging today?"_ (`page.tsx:20`). Explanatory
first-run content must slot beneath it without inventing a second `<h1>` or skipping to `<h3>`.

**B4 — 360px is unverified for anything new here.** The P1-1c panel found an existing row already at
~262/296px surviving on wrap luck. Any CTA + explanatory copy needs the width math done explicitly.

**B5 — the empty state is a `<p>` with no landmark or live region.** If first-run content is going to
explain _what happens next_, a screen-reader user should meet it as structured content, not one long
muted sentence.

## Lens C — trust · data-entry burden

**C1 — the current copy leaks implementation at a human** ("Seed the database to get started"), but
the fix must not overcorrect into marketing. ONB-1 **R20** already binds this: _the app's voice is a
receipt, not a coach._ Every string must be phraseable as a plain statement of fact.

**C2 — the burden, not the naming, is what makes first-run hostile.** ~17 controls, none explained,
before the user has any reason to trust the app. R2's own instinct — one screen, a name, then a
weigh-in — is contradicted by the default routine sitting behind it.

**C3 — nothing here asks for consequential judgment**, so this lens is thin by design. Worth stating
explicitly: ONB-0 involves no loads, no confirmations, no imported values. The trust lens has little
purchase, and that is a _feature_ of the scope — it is why this is the cheapest onboarding fix.

---

## Author's reconciliation (review-response log)

| #      | Lens       | Critique → resolution                                                                                                                                                                                                                                                    |
| ------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A1** | ID (BLOCK) | **Accepted — split ONB-0.** `ONB-0a` = the zero-profiles empty state (ships now, real audience per A5). `ONB-0b` = the neutral default routine (blocked on profile CRUD; sequence it with ONB-1 slice 1). Bundling them gates a shippable fix behind an unreachable one. |
| **A2** | ID (BLOCK) | **Accepted, and it reframes ONB-0b.** The fix is not "rename the defaults" but "**what is the smallest defensible default?**" Candidate: weigh-in + strength only — everything else opt-in via the editor. Needs Ray (Q3 below).                                         |
| **A3** | ID         | **Accepted.** Folded into ONB-0b, not treated as a separate copy fix — renaming `brush_teeth` in the shared catalog changes a CSV-facing key and is its own decision.                                                                                                    |
| **A4** | ID         | **Accepted — R2 is not buildable as written.** For ONB-0a the CTA cannot be "go to the editor". It becomes an explanation of what to do, with no fake affordance. V1-20 is a prerequisite for R2's real CTA.                                                             |
| **A5** | ID         | **Accepted, and it changes the copy target.** ONB-0a's reader is a developer running the repo, not a parent. Copy addresses that honestly rather than pretending to onboard a family who cannot yet exist.                                                               |
| **B1** | a11y       | **Accepted.** CTA is phrasing content inside the `<p>`, or a sibling element — never a `<div>` inside `EmptyState`. Pinned as an implementation note so it isn't rediscovered.                                                                                           |
| **B2** | a11y (CI)  | **Accepted.** Any interactive element gets the 44px math done up front; if it can't clear it inline, it renders as a sibling button rather than an inline link.                                                                                                          |
| **B3** | a11y       | **Accepted.** Content nests under the existing `<h1>`; no new `<h1>`, no skipped level.                                                                                                                                                                                  |
| **B4** | responsive | **Accepted.** Width math at 360px before implementation, per the standing rule.                                                                                                                                                                                          |
| **B5** | a11y       | **Accepted with a scope note.** ONB-0a's content is short enough that a `<p>` is honest; if ONB-0b adds real explanatory structure it gets proper markup then. Not worth restructuring `EmptyState` for one sentence.                                                    |
| **C1** | trust      | **Accepted.** Copy is checked against R20 — every string phraseable as a statement of fact.                                                                                                                                                                              |
| **C2** | trust      | **Accepted** — it is A2 from the burden side, and resolves with A2.                                                                                                                                                                                                      |
| **C3** | trust      | **Noted, no action.** Recorded so a later reader knows the lens was run and found little, rather than assuming it was skipped.                                                                                                                                           |

**No critique was pushed back on.** Two (A1, A2) are blocking and change the shape of the work.

---

## What the panel changed

ONB-0 went in as "fix a bad string and a bad default." It comes out as:

- **ONB-0a — the empty state.** Ships now. No dependency. Audience is a developer running the repo
  (A5), so the copy says what the app is and what to do next, with **no CTA that cannot work** (A4).
- **ONB-0b — the neutral default routine.** Blocked on profile CRUD (A1). The real question is not
  naming but **how small the default should be** (A2/C2).

## Open questions for Ray

1. **Split ONB-0 into 0a/0b as above?** (A1)
2. **ONB-0a's copy** — audience is someone who cloned the repo. Is that the right call, or do you want
   it to read for a parent even though no parent can reach it yet? (A5)
3. **What is the smallest defensible default routine?** Weigh-in + strength only, or something else?
   This is the actual ONB-0b decision. (A2)
4. **`brush_teeth`** — rename in the shared catalog, or leave it and fix it at the default-routine
   level? A rename touches a CSV-facing key. (A3, and ONB-1 open question 3)
