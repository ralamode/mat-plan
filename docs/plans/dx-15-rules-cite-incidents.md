# DX-15 — every skill rule cites the incident that earned it, or says it's a hypothesis

**Backlog:** [DX-15](../plan.md) → "The rules that make it battle-tested": _every rule cites the
incident that earned it; a rule with no incident is marked a hypothesis._ **Scope, decided
(maintainer, 2026-11-14): narrow.** A "rule" is a skill's **Red flags** bullet, or a line it marks
🔴 or ⚠️. Every other sentence is procedure and is out of scope. **Roadmap alignment (2026-11-14):**
DX-15 groundwork; the config file and the core/adapter split stay gated on FAM-1's slice 1. Checked
against the private roadmap; nothing to add here.

## Measured (2026-11-14, 14 skills)

|                         | Rules | Already citing |
| ----------------------- | ----- | -------------- |
| Red flags bullets       | 72    | 0              |
| 🔴 / ⚠️ lines elsewhere | 25    | 7              |

"Citing" means it carries a PR (`#NNN`), a lessons entry (`lessons.md` link or anchor), a backlog id,
or a dated maintainer ruling.

## Acceptance

1. **Every one of the 97 rules carries one of:**
   - an **incident**: the PR whose failure earned it (`#NNN`), or the `docs/lessons.md` entry that
     records it (a link);
   - a **ruling**: `_(maintainer, YYYY-MM-DD)_` where the rule is a decision rather than a scar;
   - **`(hypothesis)`**: no incident yet. It's an honest label, not a failure.
2. **The citation is real.** Each `#NNN` is a PR whose diff or description shows the failure, not
   merely the PR that added the sentence. A rule whose only trace is "added in #NNN" with no failure
   behind it is a hypothesis.
3. **`skills:check` enforces the form** for every Red flags bullet in `.claude/skills/*/SKILL.md`:
   it must contain `#NNN`, a `lessons.md` link, a `_(maintainer, …)_` ruling, or `(hypothesis)`.
   It checks the form only: whether the incident is the right one is a review question, and the
   guard header says so. The 🔴/⚠️ lines are cited once in this PR and **not** guarded, because the
   markers are also used for warnings that aren't rules, and a guard would force noise.
4. A self-test pins pass, each accepted form, and a bare bullet refused.

## How the citations are found

One read-only research pass per skill group, run in parallel: `git log -S '<distinctive phrase>'`
for the commit that added the rule, then that PR's description and `docs/lessons.md` for the failure
behind it. Each pass returns a table (skill, rule, citation or hypothesis, evidence). **Every proposed
citation is spot-checked before it's written**, because a wrong citation is worse than
`(hypothesis)`: it is the artifact a later reader trusts without re-checking.

## Split

- **PR 1:** the guard (a pure `checkCitations`, its tests), with this plan. The guard ships with
  every Red flags bullet already cited or labelled, or it would go red on `main`. So PR 1 carries all
  72 Red flags citations, and the 🔴/⚠️ lines too, since they come from the same research. If the
  diff passes 400 lines, the 🔴/⚠️ lines move to PR 2.

## File-by-file

| File                                   | Change                                                          |
| -------------------------------------- | --------------------------------------------------------------- |
| `.github/scripts/check-skills.mjs`     | `checkCitations` (pure) on the Red flags section.               |
| `.github/scripts/check-skills.test.sh` | Cases. Harness fixtures gain a cited Red flags bullet.          |
| `.claude/skills/*/SKILL.md`            | Citations or `(hypothesis)` on 97 rules.                        |
| `.claude/skills/README.md`             | "How to write a skill here": the citation rule.                 |
| `docs/plan.md`                         | DX-15: this rule shipped.                                       |
| changelog fragment                     | `docs/changelog/2026-11-14-chore-dx-15-rules-cite-incidents.md` |

## Amendment (2026-11-14, after the panel)

Superseding § Acceptance and § Split where they differ:

- **Scope: Red flags only** _(maintainer, 2026-11-14)_. The 25 🔴/⚠️ lines are out: they can't be
  guarded, several aren't rules, and unguarded citations decay. A rule that must hold goes under Red
  flags. `ui-screenshot`, which had none, gains four, and every skill must have the section.
- **Form:** the citation is the item's **last parenthetical**, checked per item, wrapped lines joined:
  `(#NNN[, #MMM])` with N no higher than the latest merged PR plus 50 (for open PRs);
  `(lessons: "phrase")`, which must occur in `docs/lessons.md`; `(maintainer, YYYY-MM-DD)`;
  ``(enforced by `path`)``; or `(hypothesis)`.
- **Result:** 76 rules; 24 cited, 52 `(hypothesis)`. The OK line prints the split. Every cited PR
  was spot-checked against its title and body. Two research proposals were downgraded to hypothesis
  where the link was thin (`start-task`'s stale-branch rule, `write-spec`'s chunk-order rule). Two
  were upgraded to #132, the PR that found five claimed CI gates missing.

## Review-response log

Engineering panel, 2026-11-14: correctness, scope.

| #   | Lens        | Critique (short)                                                             | Verdict      | Resolution                                                                                      |
| --- | ----------- | ---------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------- |
| C1  | Correctness | `#NNN` anywhere passes (`step #3`, `backlog #4`); a lessons mention passes   | **accepted** | Last parenthetical only; tested.                                                                |
| C2  | Correctness | A section-level regex lets one cited bullet cover bare siblings              | **accepted** | Per-item check; tested.                                                                         |
| C3  | Correctness | Wrapped bullets                                                              | **accepted** | Continuation lines joined; tested.                                                              |
| C4  | Correctness | `ui-screenshot` has no Red flags; a renamed heading drops out                | **accepted** | The section is required, with at least one item.                                                |
| C5  | Correctness | Acceptance 2 can't fail; a fabricated PR or lessons entry reads as authority | **partly**   | PR bound and lessons-phrase lookup are mechanical; a fabricated ruling stays a review question. |
| C6  | Correctness | `(hypothesis)` is a free pass                                                | **accepted** | The OK line prints cited/hypothesis counts.                                                     |
| S1  | Scope       | Cut the 25 marker lines                                                      | **accepted** | Maintainer's call; see the amendment.                                                           |
| S2  | Scope       | Accept a guard name for rules already enforced                               | **accepted** | ``(enforced by `path`)``.                                                                       |
| S3  | Scope       | The order gate needs a dated exception                                       | **accepted** | Recorded in the DX-15 row.                                                                      |
| S4  | Scope       | Expect mostly hypotheses; time-box the research                              | **accepted** | One research hop per rule, then spot-checks.                                                    |
