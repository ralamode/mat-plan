# Engineering specs

One spec per piece of work that **several PRs have to agree on** — a milestone, a large feature, or any
change where the PRs share acceptance criteria, a data contract, or an order that cannot move. Written
after the model is settled and before the first plan. The procedure is the
[`write-spec`](../../.claude/skills/write-spec/SKILL.md) skill.

**Not to be confused with [`docs/spec.md`](../spec.md)**, which is the standing architecture and data
model. Same singular/plural split the backlog already uses: [`docs/plan.md`](../plan.md) is the backlog,
[`docs/plans/`](../plans/) holds one plan per PR.

|                               | Scope                        | Answers                                                      |
| ----------------------------- | ---------------------------- | ------------------------------------------------------------ |
| [`decisions/`](../decisions/) | a decision, outliving any PR | why it is this way, and what was rejected                    |
| `specs/`                      | work spanning several PRs    | what is true when it is done, and what the PRs must agree on |
| [`plans/`](../plans/)         | one PR                       | which files change, and how                                  |

## The specs

| Spec                                                                      | Covers                                                                    |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [`v1-22-authoring-program-editing`](./v1-22-authoring-program-editing.md) | Authoring — the program gets a write path (beta-1 §3b, ADR 0005, V1-22 A) |

A spec that is really about one PR belongs in `plans/`. If you cannot name what the PRs have to agree
on, there is nothing for a spec to hold.
