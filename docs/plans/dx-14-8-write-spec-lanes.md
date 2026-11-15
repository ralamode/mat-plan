# DX-14 item 8 — `write-spec` splits a milestone into lanes, and the guides guard checks they're disjoint

**Backlog:** [DX-14](../plan.md) item 8 _(maintainer, 2026-11-14)_. **Roadmap alignment
(2026-11-14):** advances `DX-14`; FAM-1 is its first user. Checked against the private roadmap;
nothing to add here.

## Acceptance

1. `write-spec` § 3 extends its existing **data contract** and **chunks** subsections, without
   restating them, so a milestone spec gets:
   - **chunk 0, a contract PR**: the zod schemas in `packages/shared`, named fixtures, and the list
     of tests not yet written, reviewed by the lenses;
   - **lanes**: per lane, the paths it owns, the contract it reads, its fixtures, its exit, declared
     in frontmatter (below);
   - **integration slices**: thin first, then widened, never a sprint at the end.
     FAM-1's "Lanes and the contract" is the worked example, linked and not copied.
2. **`guides:check` fails when two declared lanes of one document collide**:
   - (a) **paths**: equal, or one is a path-segment prefix of the other (`packages/db` and
     `packages/db/` and `packages/db/src/x.ts` all collide);
   - (b) **guides**: both lanes reach one feature guide. A lane entry reaches a guide when it
     collides with one of the guide's `owns:` entries **or equals the guide's own path**. The second
     form is how a lane that will add new files declares the guide it will edit.
3. **Malformed lanes exit 2, never pass.** Any of these is a typo, not a pass: a glob (`*`), a
   leading `./` or `/`, `..`, `//`, quotes, a lane with no entries, a duplicate lane key, an
   unrecognised line inside a lane's list, or CRLF/BOM frontmatter in a document that mentions
   `lane-`.
4. **The OK line counts what it read**: `N lane(s) in M document(s)`. A guard that parses nothing
   can't pass a test that asserts the count. Today it prints `0 lane(s) in 0 document(s)`.
5. A self-test pins every rule above.

## Design

**Declared in frontmatter**, flat keys, the same list syntax as `owns:` (scope and reuse lenses: a
nested map would need a second hand-written walker, and that parser class has already failed once,
[lessons](../lessons.md) → "a comment inside `owns:`"):

```yaml
---
lane-a-schema-and-writers:
  - packages/db/
  - docs/features/write-path.md
lane-b-builder-ui:
  - apps/web/app/p/[profileId]/program/
---
```

**Which lanes are declared:** only lanes that **run concurrently**. Integration steps run between
slices, so they're not a lane and aren't declared; whatever no lane owns is theirs. That's how "give a
guide's files to integration only" is expressed: no declared lane reaches it.

**Where:** `docs/milestones/*.md` and `docs/specs/*.md`, compared within one document, never across.
If a milestone and a spec with the same file name both declare lanes, exit 2: one home per milestone
(reuse lens). The format's one home is `write-spec` § 3 → Lanes. `docs/parallel-work.md` gate 1
links it, and FAM-1's remedy for a shared guide moves into gate 1 so the guard's message can point
there.

**In the guides guard, not a new script** (scope lens): `check-feature-guides.mjs` already has the
parser, `ownsFile` and the guide loader, and CI already runs it. The lanes check is whole-tree, so it
runs **before** the "no changed files" exit. One parser loop reads any top-level list key; `owns:`
uses it unchanged.

**Trade-off, stated:** the `docs-skip-feature-map` label skips the lanes check with the rest of the
step. The label is visible on the PR, and lanes change rarely.

## FAM-1 on paper (correctness lens, P1-4)

FAM-1's table as drafted (`fam-1-family-program.md` § Lanes) **fails rule (b)**, as it should:

- lane A (`packages/db/**`) and lane C reach `strength-logging.md`;
- lane A and lane B reach `programming.md`;
- lane D's seed sits inside lane A's `packages/db/`.

FAM-1 already names the remedy ("split it per lane in d2, or let only integration PRs edit it"). The
guard makes d2 settle it before a lane starts, which is gate 1's purpose. `write-path.md` is reached
by lane A only once Integration is undeclared, so the writers and the DAL stay one guide. The test
uses a FAM-1-shaped fixture for both the fail and the fixed shape.

## File-by-file

| File                                           | Change                                                                                                                                                     |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/scripts/check-feature-guides.mjs`     | `parseFrontmatterLists` (the existing loop, any key); `normalizeLaneEntry` (rule 3); `segmentsCollide`; the lanes check before the diff part.              |
| `.github/scripts/check-feature-guides.test.sh` | Lane cases (below), in the existing harness; first, extraction-proof cases for the list loop.                                                              |
| `.claude/skills/write-spec/SKILL.md`           | § 3: the contract subsection gains chunk 0; the chunks subsection gains lanes and integration slices; a "Lanes" subsection holds the format. One red flag. |
| `docs/parallel-work.md`                        | Gate 1: lanes are checked by `guides:check`; the shared-guide remedy.                                                                                      |
| `docs/plan.md`                                 | DX-14 item 8 → shipped, linking this plan.                                                                                                                 |
| changelog fragment                             | `docs/changelog/2026-11-14-chore-dx-14-8-write-spec-lanes.md`                                                                                              |

No `package.json`, `ci.yml` or `AGENTS.md` change.

## Test plan (added to `check-feature-guides.test.sh`)

**Before the parser change, in its own commit:** list termination at the next top-level key, a
document with no frontmatter is skipped, `README.md` is excluded. These pin today's behaviour, so
the refactor can't move it.

Lanes, each asserting exit code **and** text:

1. Two disjoint lanes, no shared guide → 0, `2 lane(s) in 1 document(s)`; once in `docs/milestones/`
   and once in `docs/specs/`.
2. Same path in two lanes → 1, names both lanes and the path.
3. `packages/db` vs `packages/db/src/x.ts`, both orders → 1. `src/a/` vs `src/ab.ts` → 0.
4. Two lanes reach one guide through different paths → 1, names the guide and both entries.
5. A lane lists a guide's own path and another lane owns a file that guide owns → 1.
6. One lane with two entries under one guide, and a within-lane duplicate → 0.
7. A `#` comment, whole-line and trailing, inside a lane's list doesn't end it: a later entry still
   collides → 1.
8. Each rule-3 malformation → 2.
9. A milestone and a spec with the same name both declaring lanes → 2.
10. FAM-1-shaped fixture: as drafted → 1; with its guides split → 0.
11. The repo itself → 0, `0 lane(s) in 0 document(s)`.

## Out of scope

- FAM-1's real lane frontmatter: d2 sets it.
- Checking that a PR stays inside its lane: a later, diff-based guard, once lanes exist.

## Review-response log

Engineering panel, 2026-11-14: correctness, scope, reuse.

| #     | Lens        | Critique (short)                                                                                                                  | Verdict           | Resolution                                                                                       |
| ----- | ----------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------ |
| S1    | Scope       | A new script, a lib and four wiring edits where the guides guard already has the parser, matcher, test harness and CI step        | **accepted**      | Folded into `check-feature-guides.mjs`. No `package.json`, `ci.yml` or `AGENTS.md` edit.         |
| S2    | Scope       | "Armed for d2" is untested; rule (b) is red on FAM-1's own table                                                                  | **accepted**      | § FAM-1 on paper; fixture 10. The red is correct, and d2 must resolve it.                        |
| S3    | Scope       | The nested map is a new hand-parsed shape                                                                                         | **accepted**      | Flat `lane-<name>:` keys through the existing loop.                                              |
| S4    | Scope       | The plan row doesn't link the plan; the roadmap has no DX-14 entry                                                                | **accepted**      | Row links this plan; the PR says "none moved".                                                   |
| R1    | Reuse       | `review-prefetch.test.sh` copies the guard alone, so an import would break it silently                                            | **moot**          | No new module.                                                                                   |
| R2    | Reuse       | A nested parser would duplicate the comment-safe loop                                                                             | **accepted**      | Same as S3.                                                                                      |
| R3    | Reuse       | One milestone's lanes could live in two homes                                                                                     | **accepted**      | Same-name pair declaring lanes exits 2.                                                          |
| R4–R6 | Reuse       | No named home for the format; write-spec already covers the contract and parallelism; the guard message would copy FAM-1's remedy | **accepted**      | Extend the existing subsections; the format lives in write-spec § 3; the remedy moves to gate 1. |
| R7–R8 | Reuse       | Lib details; self-test shape                                                                                                      | **moot / partly** | No lib. The lanes cases use the existing harness's `write_guide`.                                |
| C1    | Correctness | The overlap rule misses `packages/db` vs `packages/db/`, `**`, `./`, quotes (probed)                                              | **accepted**      | Segment-prefix rule; malformations exit 2 (acceptance 3).                                        |
| C2    | Correctness | The guide rule is blind to new files                                                                                              | **accepted**      | A lane entry equal to a guide's path reaches it (acceptance 2b).                                 |
| C3    | Correctness | The parser silently truncates on an unrecognised line                                                                             | **accepted**      | Inside a lane's list, an unrecognised line exits 2. Only a column-0 key ends a list.             |
| C4    | Correctness | FAM-1's table can't pass; Integration undefined                                                                                   | **accepted**      | Only concurrent lanes are declared; Integration isn't one.                                       |
| C5    | Correctness | Pass cases can't fail                                                                                                             | **accepted**      | The OK line counts lanes and documents; tests assert it.                                         |
| C6    | Correctness | The extraction proof is thin                                                                                                      | **accepted**      | Pinning cases land first, in their own commit.                                                   |
| C7    | Correctness | CRLF/BOM frontmatter reads as "no lanes"                                                                                          | **accepted**      | Exit 2 when such a document mentions `lane-`.                                                    |
