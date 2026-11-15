# DX-14 item 9 — a lane guide relieves the broad guide above it

**Backlog:** [DX-14](../plan.md) item 9, first bullet _(maintainer, 2026-11-14)_. Its second bullet
(`write-spec`'s contract tests and pending-column fields) is a separate, skills-only PR. **Roadmap
alignment (2026-11-14):** advances `DX-14`; FAM-1's lane guides depend on it
([features README → lanes](../features/README.md#guides-for-work-run-in-lanes)). Checked against the
private roadmap; nothing to add here.

## The rule, as decided

**A narrower directory entry wins over a broader one.** _(maintainer, 2026-11-14, narrowing the row's
"a narrower `owns:` entry".)_

- When a changed file is matched by **directory** entries in several guides, only the guide(s) with
  the **longest** matching directory entry owe an edit. A tie means all of them owe.
- An **exact-file** entry always owes, and never removes another guide's claim. It adds, as today.

**Why narrower than the row's wording:** measured on 2026-11-14, two files sit under two guides
today, both through an exact-file entry under `write-path.md`'s `packages/db/src/writers/`:
`hide.ts` (also `delete-and-restore.md`) and `strength-session.ts` (also `strength-logging.md`).
"Any narrower entry wins" would stop both from owing `write-path.md`, which holds the invariants every
writer shares. The directory-only rule relieves exactly the lane-guide case and loses no coverage
today.

## Acceptance

1. A file under `writers/program/`, with guide A owning `packages/db/src/writers/` and guide B owning
   `packages/db/src/writers/program/`, owes **B only**.
2. A file listed exactly in guide B and under guide A's directory owes **both** (today's `hide.ts`).
3. Two guides owning the same directory: both owe.
4. **No change on today's repo**, measured once rather than tested: 907 tracked files through the old
   and new rules, 0 differ, and no guide's directory entry nests inside another's (2026-11-14). A
   permanent test would go red by design on the first lane guide. `hide.ts`'s case is pinned by a
   fixture instead.
5. **The lanes check uses the same rule.** A lane entry reaches the guide(s) whose directory entry is
   the longest one covering it, plus every guide with an exact entry it covers, plus every guide with
   an entry strictly inside it, plus a guide named by path. So a lane owning `writers/program/` under
   a lane guide no longer collides, through `write-path.md`, with another lane's `writers/other/`.

## Design

One function, `owingGuides(file, guides)`, replaces the per-guide `ownsFile` loop in rot check #2
(`ownsFile` had no other caller and is removed). The lanes check's `guidesReached` gets the same
longest-directory rule. Both diffs run with `--no-renames`, and rot check #1 also refuses a directory
entry written without its `/` (after the panel; see the log).

## File-by-file

| File                                           | Change                                                                           |
| ---------------------------------------------- | -------------------------------------------------------------------------------- |
| `.github/scripts/check-feature-guides.mjs`     | `owingGuides`; rot check #2 uses it; `guidesReached` applies the rule.           |
| `.github/scripts/check-feature-guides.test.sh` | A two-guide harness: cases 1–3, the rename, the slashless entry, and 5.          |
| `docs/features/README.md`                      | The ⚠️ "Rule 1 needs the gate to change" note becomes the rule as it now stands. |
| `docs/milestones/fam-1-family-program.md`      | Names the steps the rule relieves and the seams that still owe `write-path.md`.  |
| `docs/plan.md`                                 | Item 9's first bullet shipped, linking this plan, with the narrowing recorded.   |
| changelog fragment                             | `docs/changelog/2026-11-14-chore-dx-14-9-most-specific-owner.md`                 |

## Review-response log

Engineering panel, 2026-11-14: correctness, scope, architecture.

| #            | Lens              | Critique (short)                                                                                  | Verdict      | Resolution                                                                                                               |
| ------------ | ----------------- | ------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------ |
| C1 / S1 / A1 | All three         | Acceptance 4 as a permanent test is near-vacuous today and goes red on the first lane guide       | **accepted** | Measured once (907 files, 0 differ); recorded above.                                                                     |
| C2 / A3      | Correctness, arch | Lanes can't be declared before their guides exist: the lanes check reads the guides at HEAD       | **accepted** | Features README rule 1: chunk 0 creates every lane's directory and guide. A test covers both states.                     |
| C3           | Correctness       | A rename into a lane directory escapes the broad guide: `git diff --name-only` drops the old path | **accepted** | `--no-renames` on both diffs; a case; probed red without it.                                                             |
| C4           | Correctness       | One-guide cases pass on the old rule                                                              | **accepted** | A two-guide harness; "relieves the broader one" probed red under the old rule.                                           |
| C5           | Correctness       | A slashless directory entry owns nothing, silently                                                | **accepted** | Rot check #1 refuses it (none exist today).                                                                              |
| S2           | Scope             | Keep the lanes reach change, shrunk to its delta                                                  | **accepted** | Only "entries covering it" changed, to the longest directory.                                                            |
| A2           | Arch              | FAM-1's lanes text overclaims: only new files in new directories are relieved                     | **accepted** | FAM-1 names the relieved steps (6, maybe 11a) and the seams that still owe.                                              |
| A4           | Arch              | README "a trailing slash owns everything beneath"; ownership comments; `write-path.md:30`         | **partly**   | README and comments updated. `write-path.md:30` stays true: an exact entry under another guide's prefix still owes both. |
| A5           | Arch              | A narrower directory strips the broad guide's claim with no edit to it                            | **accepted** | README: a lane guide links up to the broad guide's invariants that still apply.                                          |
| A6           | Arch              | `review-prefetch.sh` runs the caller checkout's copy of the guard                                 | **noted**    | Until this merges, a local review from an older checkout applies the old rule to a lane PR.                              |
| A-out        | Arch              | Features README called `quality` "a required check"                                               | **accepted** | Corrected (found outside the diff).                                                                                      |
