# DX-14 item 5a — `skills:check` fails when one skill's trigger phrase reaches another

**Backlog:** [DX-14](../plan.md) item 5. **Split:** this is **5a**, the routing guard and the trims it
forces. **5b**, an exit checklist for every skill, is a separate PR: it edits every skill body, and
nothing in it depends on the guard. **Roadmap alignment (2026-11-14):** advances `DX-14`; `DX-15`
lists the routing guard as one of its tests, so the check is an exported pure function DX-15 can lift.
Checked against the private roadmap; nothing to add here.

## The problem, measured (2026-11-14, 14 skills, description values without the `description: ` key)

- **"shipit" vs "ship it":** `keep-mergeable` is built around the `shipit` comment and `ship-pr`
  triggers on "ship it". No matcher, lexical or semantic, separates them. **Decided (maintainer,
  2026-11-14): "shipit" starts `keep-mergeable`;** `ship-pr` drops "ship it" and keeps "open the PR",
  "commit and push" and "wrap this up". (`review-pr`'s description never named the word, so the
  backlog row's "three skills" is corrected here.)
- **Length:** four descriptions exceed 500 characters (`write-spec` 554, `hold-the-bar` 508,
  `db-migration` 506, `doubt-check` 501). Every description loads in every session.
- **Coverage:** `ui-screenshot`'s description quotes no phrase anyone types.

## Acceptance

1. **Triggers are derived, not copied.** A skill's triggers are the double-quoted phrases in its
   **trigger clause**: the description from the first `Use when`, `Use for`, `Use on`, `Use whenever`
   or `Run it` to the end. There's no fixture file, so there's nothing to keep in sync.
2. **Collision fails `skills:check`.** Tokenise (lowercase `[a-z0-9]+`; drop the placeholder tokens
   `x`, `y`, `n` and anything in `<…>`). Trigger _t_ of skill _A_ **reaches** skill _B_ when _t_'s
   tokens occur as a contiguous run in _B_'s trigger-clause tokens, **or** _t_'s tokens joined occur
   as a contiguous run of _B_'s tokens joined (so `shipit` meets "ship it"). Whole tokens only:
   "ownership itself" does not contain `shipit`, and "new format" does not contain "new form".
3. **Every skill has a trigger clause with at least one quoted phrase.** A trigger left with no
   token after the placeholders are dropped is refused.
4. **A description is at most 500 characters.**
5. Problems exit 1, like every other `skills:check` problem. The OK line counts what it checked:
   `N trigger(s) across M skill(s)`.
6. **The limit is stated:** Claude Code routes semantically. This catches literal and near-literal
   collisions only, and says so in the guard header and the skills README.

## Design

- **In `check-skills.mjs`:** an exported `checkRouting(skills)`. It's pure (input: name and
  description per skill; output: problems), called from the entry point over `.claude/skills/*/SKILL.md`
  only. Agents, the README and `reporting-contract.md` aren't skills.
- **The description** is the single-line `description:` frontmatter value (true for all 14). A
  `SKILL.md` without one is a problem.
- **Self-test harness:** `expect` and the entry-point loop write a body-only `SKILL.md` today. They
  gain a minimal valid frontmatter, so the 27 existing cases keep testing what they test.

## File-by-file

| File                                                                         | Change                                                                                         |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `.github/scripts/check-skills.mjs`                                           | `checkRouting`; entry point reads the skills' descriptions; header and OK line.                |
| `.github/scripts/check-skills.test.sh`                                       | Frontmatter in the harness; the routing cases.                                                 |
| `.claude/skills/{write-spec,hold-the-bar,db-migration,doubt-check}/SKILL.md` | Descriptions trimmed to ≤ 500; steps stay in the body.                                         |
| `.claude/skills/{keep-mergeable,ship-pr}/SKILL.md`                           | The "shipit" decision.                                                                         |
| `.claude/skills/ui-screenshot/SKILL.md`                                      | Quoted triggers.                                                                               |
| `.claude/skills/README.md`                                                   | "How to write a skill here": the trigger clause, the cap, the lexical limit. Guards table row. |
| `AGENTS.md`                                                                  | The `skills:check` gloss in "Local hooks vs CI merge-gates" names the routing check.           |
| `docs/plan.md`                                                               | DX-14 item 5: the corrected measurements, 5a shipped, 5b remaining.                            |
| changelog fragment                                                           | `docs/changelog/2026-11-14-chore-dx-14-5-skill-routing-guard.md`                               |

## Test plan

Pure-function cases through `node -e` importing `checkRouting`, plus the real repo:

1. Distinct triggers → no problems.
2. Same phrase in two skills → collision naming both.
3. `"shipit"` vs `"ship it"` → collision (joined form).
4. "ownership itself" in another skill's clause does not reach `shipit`; "new format" does not reach
   "new form" (word boundaries).
5. A phrase that appears only in the **what** clause of another skill → no collision.
6. Placeholders: `"save X"` vs `"save"` collide; `"X"` alone is refused.
7. No trigger clause, or no quoted phrase → problem. A 501-character description → problem.
8. The real repo → OK, printing the counts.

## Review-response log

Engineering panel, 2026-11-14: correctness, scope, architecture. Measurements re-checked in the repo
before acceptance.

| #                | Lens               | Critique (short)                                                                                                                            | Verdict      | Resolution                                                                                                                                |
| ---------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| S1 / C4          | Scope, correctness | `routing.json` is a second copy of the descriptions; the miss check is tautological                                                         | **accepted** | Triggers derived from the descriptions; no fixture, no miss check.                                                                        |
| C1 / A2          | Correctness, arch  | Substring of the whole description can't tell a mention from a trigger (`migration` reaches `doubt-check`'s prose; skill names cross-reach) | **accepted** | Match trigger clauses only (acceptance 1–2).                                                                                              |
| C2               | Correctness        | No word boundaries (`shipit` ⊂ "ownership itself")                                                                                          | **accepted** | Token runs; joined form for spacing.                                                                                                      |
| C3               | Correctness        | Placeholders compared as literals                                                                                                           | **accepted** | Placeholder tokens dropped; an all-placeholder trigger refused.                                                                           |
| S2 / C6 / A-also | All three          | Measurements wrong: nine >450 not ten, the key counted, `review-pr` never names shipit, six lack "Use when"                                 | **accepted** | § The problem re-measured; the row corrected.                                                                                             |
| S3               | Scope              | The 450 cap is ceremony (≈ 6% saved; the README rejected 5–11% trims before)                                                                | **accepted** | Cap 500: four trims.                                                                                                                      |
| C7               | Correctness        | A total cap can't catch a step list                                                                                                         | **rejected** | A what-clause cap would force rewording 8 skills for a heuristic. 500 total is the cheap guard; the README rule covers the rest.          |
| S1 (part)        | Scope              | Drop "≥ 2 phrases" and "must say Use when"                                                                                                  | **partly**   | ≥ 1 quoted phrase kept (`ui-screenshot` has none: a real gap). The clause may start with any of five openers, not only "Use when".        |
| S4 / C5 / A4     | All three          | The existing harness writes body-only SKILL.md                                                                                              | **accepted** | Harness gains frontmatter.                                                                                                                |
| C5 / A4          | Correctness, arch  | Scope: the guard walks agents and READMEs too                                                                                               | **accepted** | Routing runs over `skills/*/SKILL.md` only.                                                                                               |
| A1               | Arch               | Posting `shipit` is `review-pr`'s; `keep-mergeable` only sweeps existing ones                                                               | **noted**    | The maintainer chose `keep-mergeable` with that known. `review-pr` keeps posting the verdict, and its description doesn't claim the word. |
| A3               | Arch               | One central `routing.json` restores a shared insertion point; DX-15 would split it                                                          | **moot**     | No fixture.                                                                                                                               |
| A5               | Arch               | Export the routing pass as a pure function for DX-15                                                                                        | **accepted** | `checkRouting`.                                                                                                                           |
| A6               | Arch               | AGENTS.md's `skills:check` gloss goes stale                                                                                                 | **accepted** | Updated.                                                                                                                                  |
| A7               | Arch               | Exit 2 is "could not run" in sibling guards                                                                                                 | **accepted** | Exit 1.                                                                                                                                   |
| S5               | Scope              | The backlog row is stale                                                                                                                    | **accepted** | Corrected.                                                                                                                                |
