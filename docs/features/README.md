# Feature guides

**Read the guide before changing the feature.** These exist to make the next change to a large,
atomic feature cost one read instead of an afternoon of tracing — the files it spans, the shape of
the data through it, the invariants that are not obvious from any single file, and the traps.

A guide is **not** a changelog, an API reference, or a summary of what the code says. It is the thing
you would want to have been told before you started: _where the seams are, and what will bite you._

## The rule

**A guide is updated in the same PR as the code it documents.** This is enforced by
[`.github/scripts/check-feature-guides.mjs`](../../.github/scripts/check-feature-guides.mjs), which
runs in CI's `quality` job (a required check) and fails when a PR touches an owned file without
touching its guide. It also fails when a guide claims to own a file that no longer exists, so a
rename cannot quietly drop coverage.

**Why a gate rather than a convention:** this repo has already been burned. `AGENTS.md` listed five
required CI checks for months that did not exist ([tech-debt.md](../tech-debt.md), audited
2026-09-23). A document nobody is forced to update is a document that lies — and a lying guide is
_worse_ than no guide, because it gets trusted instead of verified.

**Escape hatch:** the `docs-skip-feature-map` PR label, mirroring `ci-skip-e2e`. For a change that
genuinely does not affect the guide — a typo, a comment, a dependency bump that touches an owned
file. Use it sparingly; it is visible on the PR, which is the point.

Run it locally before opening a PR:

```bash
node .github/scripts/check-feature-guides.mjs        # vs origin/main
node .github/scripts/check-feature-guides.mjs HEAD~3 # vs an explicit base
```

## What gets a guide

**Large, atomic features** — where "atomic" means _you cannot change one part without understanding
the others_. The test: if a competent change requires reading four or more files across two or more
packages, it earns a guide.

Not every feature. A guide nobody reads and nobody updates is pure cost, and the gate makes that cost
recurring. Add one when a feature's **next** change actually needs it, not speculatively.

## Format

Frontmatter declares the ownership map the gate reads:

```markdown
---
feature: Strength logging
owns:
  - apps/web/app/p/[profileId]/strength-form.tsx
  - packages/db/src/writers/ # a trailing slash owns everything beneath
---
```

Paths are **exact files or directory prefixes** — no globs, because this repo's route directories
contain `[profileId]` and glob-escaping that is a footgun.

Then, in this order:

| Section          | What it holds                                                                                      |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| **What this is** | Two or three sentences. What the feature does for a person, not what the code does.                |
| **The map**      | A Mermaid diagram of the data's path through the files. The one thing that saves the most time.    |
| **Files**        | Each owned file, one line on what it is FOR — the reason you would open it.                        |
| **Invariants**   | The rules that hold across files and are not visible from any one of them. The heart of the guide. |
| **Traps**        | Things that have actually bitten someone here, with the file:line. Not hypotheticals.              |
| **Changing it**  | Where to start for the common kinds of change; what to re-run.                                     |

Mermaid because GitHub renders it and AGENTS.md already mandates it for PR descriptions — the
committed diagram and the PR's should agree. Keep diagrams to the pivotal one or two.

**Link, don't duplicate.** A guide points at the plan, ADR or lesson that holds the reasoning; it
does not restate it. Duplicated prose is the thing that goes stale first.
