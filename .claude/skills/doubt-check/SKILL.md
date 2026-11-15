---
name: doubt-check
description: Get a fresh, unanchored second opinion on ONE decision made mid-implementation — a deviation from the plan, a call the plan left open, a migration step, a correction's keeper row, an auth or ownership change — by handing a lens agent the artifact and its contract but never the reasoning, for at most three rounds. Use when you're about to commit a choice nobody reviewed, when you catch yourself writing "I decided to…", or when the user says "doubt this", "sanity-check this call", "second opinion".
---

# Doubt-check one decision

Panels review the **plan** and [review-pr](../review-pr/SKILL.md) reviews the **diff**. Neither sees
a call made halfway through: the step order a migration ended up needing, the row a correction keeps,
the branch an auth check took when the plan said nothing. This puts one such call in front of a
reviewer who has **not** seen why you made it.

⚠️ **Hypothesis, not yet earned:** no incident in this repo has been caught this way yet. The first
use goes in the log (step 5), with whether it found anything.

## When

- The code departs from its plan, or settles something the plan left open.
- The decision touches a migration, a data correction, auth or ownership, or what a write stores.
- You're about to write the reason for a choice into a commit body or a PR description. That's the
  moment it's still cheap to be wrong.

**Not** for a plan (that's [plan-with-panel](../plan-with-panel/SKILL.md)), a whole PR (review-pr),
or a choice the plan already made and the panel already saw.

## 1. Write the brief: artifact and contract, never the reasoning

- **The artifact:** the file and line range, or the hunk (`git diff -- <path>`).
- **The contract it must satisfy:** the plan section, the spec criterion, and the AGENTS.md section,
  feature-guide invariant or lessons entry that applies. Cite them by path; the agent reads them.
- **The decision, as one neutral sentence:** "Step 2 runs the backfill before the NOT VALID check."

**Leave out** why you chose it, the alternatives you rejected, and how confident you are. Reasoning
anchors: a reviewer handed the argument checks the argument, not the code. 🔴 **Never use a `fork`
for this.** A fork inherits your context, which is the anchor this skill exists to remove. Start a
fresh named agent.

## 2. Pick one lens by the risk

| The decision touches                         | Lens                   |
| -------------------------------------------- | ---------------------- |
| a migration, seed, correction or constraint  | `db-safety-reviewer`   |
| auth, ownership, secrets, CI                 | `security-reviewer`    |
| what personal data is stored, logged or sent | `privacy-reviewer`     |
| anything else, including write-path logic    | `correctness-reviewer` |

The agents are in [`.claude/agents/`](../../agents/) and follow the
[reporting contract](../review-pr/reporting-contract.md). One lens, not a panel: this is meant to be
cheap enough to run several times a PR. Pick by risk, never by which lens is likely to agree.

## 3. Ask it to break the decision

> Here is `<artifact>`. It must satisfy `<contract>`. The decision under review: `<sentence>`. Find
> the input, state or ordering under which it fails the contract. Follow the reporting contract;
> "sound" is an acceptable answer.

Not "is this OK?", which invites a yes.

## 4. Three rounds at most

- A finding you confirm in the code: fix it, then send **only the revised artifact** for the next
  round. Never your rebuttal; that is reasoning again.
- A finding you think is wrong: probe it (the agent proposes the probe; you run it). If the probe
  backs you, note it and stop.
- **After round three with a live finding, stop.** It is the maintainer's call now: put it under
  `## Needs a decision` in the PR, with both positions and the probe.

## 5. Record it

One row in the plan's review-response log under **Mid-build checks** (or in the PR description for
a plan-exempt change): the decision, the lens, the rounds, and the outcome (changed, held with a
probe, or escalated). A check nobody can find didn't happen.

## Red flags

- The brief explains why ("I went with X because…").
- Using `fork`, or resuming an agent that has seen the plan's debate.
- Asking a yes/no question.
- Choosing the lens least likely to object.
- A fourth round.
- "Too small to doubt-check" on a migration, correction or auth change: the size of the diff isn't
  the size of the risk.
- Treating a clean doubt-check as a substitute for the panel or for review-pr.
