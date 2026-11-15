---
name: refine-idea
description: Turn a rough product idea into settled decisions before anyone specs or builds it — one question at a time, each with a proposed answer, stopping for an explicit yes, ending in a Decided list and a "Not doing, and why" list. Use when the user says "I have an idea", "brainstorm X", "help me think through Y", "interview me", "what should X do when…", or before write-spec when the behaviour itself isn't settled yet.
---

# Refine an idea

Settles **what** a feature does, as a person would notice it, before [write-spec](../write-spec/SKILL.md)
settles how several PRs build it. The output is a short list of decisions a later session can't
reopen by accident.

**Why it exists:** it is how MOT-1.5's streak rule was settled (#388): seven sub-rules (what counts,
the per-workout switch, the neutral day, practice, swaps, the first day, excused days), each decided on
its own, with one question still recorded as open. A batch of ten questions gets skimmed and
half-answered. One question with a proposal gets a decision.

**Not for:** an engineering choice (that is a plan, and [plan-with-panel](../plan-with-panel/SKILL.md)),
a decision a spec, ADR or `docs/plan.md` row already records, or a bug.

## 1. Read before you ask

- `git grep -in "<capability phrase>" -- docs/plan.md docs/roadmap.md docs/specs docs/decisions`.
  Grep the **capability**, not the id you expect: a row named differently is still the row.
- The feature guide for the area (`docs/features/`), and the spec's "Decisions already made" if one
  exists.
- **Every question you could answer from the repo is not a question.** Drop it, or state the
  answer as a fact and move on.

## 2. Frame it in three lines

The outcome in one sentence, from the person's side; who it is for; the constraints that bound every
answer: a phone on a gym floor, kids and parents, ~4h/week to build it, and AGENTS.md's product rule
(**the model never authors a load**). Ask for a yes on the frame before the first question.

## 3. One question at a time

Each message carries exactly one question, in this shape:

- **The question**, phrased as what a person would see or do ("When a kid misses a day…").
- **Why it matters:** what the answer changes in what gets built.
- **Proposed answer**, with the reason. Never a bare question: a proposal is cheaper to judge than a
  blank.
- **The alternatives** worth naming, one or two, each with its cost.

Where the harness has a question tool, use it: the proposal is the first option, marked
"(Recommended)".

Then **stop and wait.** Only an explicit answer settles a question. "Sounds fine, keep going", or
moving on without answering, is not a yes. Restate what you understood and ask again. An answer that
raises a new question becomes the next question, not a second one in this message.

**Order:** the question whose answer would change the most comes first. **Stop** when the next
question wouldn't change what gets built. That's the cue to close, not to keep polishing.

## 4. Close: three lists, written down

- **Decided:** one line each, attributed by role and date (`_(maintainer, 2026-11-14)_`). These
  become the spec's "Decisions already made", or the `docs/plan.md` row when no spec follows.
- **Not doing, and why:** every option that was considered and dropped, with its reason. Someone
  will propose each of them again. This list is what lets the answer be "already considered".
- **Open:** what's still undecided, who decides it, and what it blocks.

Show the three lists and ask for a yes on the whole before writing them to a tracked file. Tracked
text is public: product reasoning only, no personal names (AGENTS.md → Git & branch workflow).
Then hand off: `write-spec` if several PRs must agree, otherwise `start-task`.

## Done when

- [ ] The three-line frame got a yes before the first question.
- [ ] Every decision came from an explicit answer, one question at a time.
- [ ] Decided, Not doing and why, and Open are written down, confirmed, and attributed by role and date.
- [ ] It was handed off to `write-spec` or `start-task`.

## Red flags

- Two questions in one message, or a list of questions "to save time". (hypothesis)
- A question without a proposed answer. (hypothesis)
- Treating silence, "ok", or a change of subject as a yes. (hypothesis)
- Re-asking something a spec, ADR or plan row already decided. (hypothesis)
- Drifting into engineering (tables, endpoints, migrations) before the behaviour is settled. (hypothesis)
- Writing the spec during the interview. (hypothesis)
- An empty "Not doing" list. Nothing was weighed, or nothing was written down. (hypothesis)
