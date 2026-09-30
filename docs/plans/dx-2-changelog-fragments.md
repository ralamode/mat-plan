# DX-2 — changelog fragments: no shared insertion point

> Backlog: [plan.md](../plan.md) row **DX-2**. Branch: `docs/dx-2-changelog-fragments`.
> Status: **engineering panel round 1 (4 standing lenses) resolved; awaiting Ray's review.** No
> implementation code until approved. **This PR:** the plan and the `docs/plan.md` row. **The
> implementation PR** does everything in the file table, after #179 and #181 merge (it edits files
> both touch).

## Goal

Remove the **changelog** merge conflicts. On 2026-09-30 every approved PR was re-conflicted by the
merge before it, and each was fixed by hand. The main cause is structural: each PR inserts its entry
at **one shared line**, the top of `docs/status.md` → Changelog (`@@ -258,6` in 11 of the last 12
status.md commits). The skills README's changelog, appended at `:87`, has the same shape.

**What it won't fix, stated up front.** Of the 09-30 conflicts, #172, #173, #174 and #177 were the
status.md changelog alone; #178 and #179 were the status.md changelog **plus** the skills README
(changelog and table) and, for #179, a `package.json` script line; #176 was `docs/plan.md`. So this
removes the changelog share, most of it, but not the skills-README table, `package.json` scripts or
`docs/plan.md` appends. `keep-mergeable` (#181) keeps handling those.

## Acceptance

No `docs/plan.md` criterion exists yet (the row is new with this plan). Done when:

- A product branch cut after DX-2 passes `pnpm status:check` **only** by adding a correctly named
  fragment. Touching `docs/status.md` alone fails.
- A branch cut before DX-2 still passes on a status.md entry, and fails once `main` is merged into it,
  so `keep-mergeable` converts its entry into a fragment instead of it landing silently in the old
  section.
- The old history stays where it is, unrewritten.
- Every doc and skill that says where the changelog entry goes says the same new thing, checked with
  the grep in the test plan.

## Design

**One file per change: `docs/changelog/<YYYY-MM-DD>-<branch>.md`.** `<branch>` is the full branch name
with `/` → `-` (`feat/v1-24-1a-bodyweight-receipt` → `feat-v1-24-1a-bodyweight-receipt`), so `feat/x`
and `fix/x` differ. The date is the day it was written. The file holds exactly the entry that used to
go into status.md. Different PRs add different files, so there is no shared line. `docs/plans/` and
`docs/features/` already work this way.

- **`docs/changelog/README.md` is the one source for the rule and the entry format**, including the
  link forms a fragment needs from one level deeper (`../plans/…`, `../../.claude/…`). ship-pr,
  AGENTS.md and the guard's messages link to it and never restate it (today the format lives inline in
  `ship-pr/SKILL.md:48-50`, with a `./plans/` link that would break from `docs/changelog/`).
- **History stays where it is.** The status.md heading is **not renamed**. A line above it points to
  `docs/changelog/` for everything after DX-2. Renaming it would file post-DX-2 entries under a heading
  that says the history ended. (Three lenses expected a rename to conflict with every open branch.
  Tested: it doesn't, because a blank line separates the heading from the insertion point; see the log.)
  The skills README's `## Changelog` gets the same pointer. Skill PRs write a fragment like any other,
  so there is **one** changelog mechanism.
- **Reading it, in merge order, with no script.** `docs/changelog/README.md` documents:
  `git log --diff-filter=A --format='%cs %s' -- docs/changelog/ | head -20`. That is the true merge
  date and the squash subject, which carries `(#n)`, newest first. Run it on `main`: on a feature
  branch it lists the branch's own commits, and a shallow clone shows one entry. The filename date is only for the
  folder listing and is documented as the authoring date. **No `pnpm changelog`** (see the log).
- **The guard** (`check-status-touched.mjs`) becomes a **changelog-entry** check, and says so:
  - **Is the branch post-DX-2?** Does `docs/changelog/README.md` exist **in the working tree**? That is
    what the branch will merge as, so it covers a clean merge of `main`, and also an uncommitted or
    conflicted one. (Round 2: the first draft used the merge base, which still points at the pre-DX-2
    base while keep-mergeable's merge is uncommitted, so a legacy branch passed. Reproduced by the
    correctness lens; see the log.)
  - If so, an owing branch must **add** a fragment, and status.md alone fails. Added means: committed
    (`git diff --diff-filter=A --no-renames <mb>...HEAD`), staged (`git diff --cached --diff-filter=A
--no-renames`), or untracked (`ls-files --others --exclude-standard`), each restricted to
    `docs/changelog/`. A modified or deleted fragment, `README.md`, or a nested path doesn't count.
  - **The name** must be `<YYYY-MM-DD>-<branch>.md`. It is checked as a date prefix
    (`/^\d{4}-\d{2}-\d{2}-/`), then a **literal** comparison `rest === branch.replaceAll('/', '-') + '.md'`.
    It's never a regex built from the branch name, which may hold `.`, `+` or `(`.
  - **The branch name** comes from `STATUS_BRANCH` when set, otherwise from `rev-parse --abbrev-ref HEAD`.
    keep-mergeable works in a **detached** worktree, so it passes `STATUS_BRANCH=<headRefName>` from
    `gh pr view`. That keeps the "owes" test (a `db/…` branch whose commits say `chore(db):`) and the
    exact name check. With no name available, the owes test uses commit subjects only (as today), and
    the name must match `^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9._-]*\.md$`.
  - If not post-DX-2 (legacy), today's rule applies: status.md touched.
  - The header comment and messages stop saying "must update status.md" and say what it checks. It no
    longer proves the status.md **pointer and rows** were looked at. That drift (#156) goes back to
    review, and ship-pr's red flag is reworded to it (see Risks).

## File-by-file changes (the implementation PR)

| Path                                           | Change  | What & why                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/changelog/README.md`                     | NEW     | The rule, the filename, the entry format with correct relative links, and the `git log` reading recipe. The single source.                                                                                                                                                                                                                                                                                                                                     |
| `docs/changelog/<date>-docs-dx-2-…md`          | NEW     | This change's own entry, the first fragment.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `docs/status.md`                               | EDIT    | One pointer line above the Changelog heading. Nothing moved, renamed or rewritten.                                                                                                                                                                                                                                                                                                                                                                             |
| `.claude/skills/README.md`                     | EDIT    | Pointer above `## Changelog`; the index row for `keep-mergeable` and the "status:check" guard row reworded.                                                                                                                                                                                                                                                                                                                                                    |
| `.github/scripts/check-status-touched.mjs`     | EDIT    | The merge-base rule, the name regex, `--no-renames`, the added-file set built from `--diff-filter=A` + staged + untracked (not today's name-only `--diff-filter=d` set, `:76-80`), and the docblock and messages (`:3-20`, `:89`, `:95-100`) reworded to link the README.                                                                                                                                                                                      |
| `.github/scripts/check-status-touched.test.sh` | EDIT    | Post-DX-2: a fragment passes (committed, staged, untracked); status-row-only fails; misnamed fails; nested fails; a modified old fragment fails; README-only fails; a rename-shaped add passes; a branch with regex metacharacters (`fix/v1.2-x`) is named and matched literally; detached HEAD with and without `STATUS_BRANCH`. **A legacy branch with main merged via `--no-commit` fails** (the round-2 case). Legacy: status.md passes. Mutation-checked. |
| `.claude/skills/ship-pr/SKILL.md`              | EDIT    | `:3` description; step 3 (`:44-54`) links the README instead of restating the format; `:128` red flag becomes "backlog item merged but its status.md row/pointer unchanged".                                                                                                                                                                                                                                                                                   |
| `.claude/skills/review-pr/SKILL.md`            | EDIT    | Dimension 7 (`:105`) and the P1 example (`:128`) name the fragment, plus the row/pointer check.                                                                                                                                                                                                                                                                                                                                                                |
| `.claude/skills/keep-mergeable/SKILL.md`       | EDIT    | `:3` and `:10` reworded. Step 4 runs `STATUS_BRANCH=<headRefName> pnpm status:check`. The status.md-changelog row becomes: "a pre-DX-2 branch fails `status:check` after the merge; **move only its changelog entry lines** into a fragment named from `headRefName`, and keep its backlog-row and pointer edits". Afterwards `git diff origin/main HEAD -- docs/status.md` shows only rows or pointer. The skills-README-changelog row goes.                  |
| `.claude/skills/start-task/SKILL.md`           | EDIT    | `:44` greps `docs/changelog/` too, so recent history for an id is found.                                                                                                                                                                                                                                                                                                                                                                                       |
| `AGENTS.md`                                    | EDIT    | `:64` lists `docs/changelog/` among `docs/`; `:204-205` "Status rides with the work": the entry is a fragment (link the README); pointer and rows stay in status.md.                                                                                                                                                                                                                                                                                           |
| `docs/spec.md` · `README.md`                   | EDIT    | `docs/spec.md:50` directory tree; `README.md:45` docs table: add `docs/changelog/`.                                                                                                                                                                                                                                                                                                                                                                            |
| `docs/plan.md`                                 | NEW row | **This PR:** the DX-2 row, linking this plan.                                                                                                                                                                                                                                                                                                                                                                                                                  |

## Alternatives considered and rejected

- **No hand-written entry at all: `git log` of squash subjects is the changelog.** It's the cheapest
  option and removes a per-PR chore instead of moving it. Rejected: the entries carry _what is now true
  and why it matters_, written from the diff, which a Conventional Commit subject can't hold. #156 is
  what happened when that record was reconstructed from memory. Kept in mind: if fragments stop being
  written well, this is the fallback.
- **`merge=union` in `.gitattributes`.** One line, and locally it keeps both entries (git 2.54
  verified). GitHub's mergeability and "Update branch" very likely ignore repo `.gitattributes`
  (community #9288 and several issue reports; no official statement), the order is documented as
  random, and it can interleave neighbouring edits. Rejected: it fixes the local symptom, not the one
  on GitHub.
- **An assembled `CHANGELOG.md` committed from fragments.** A committed generated file is a shared line
  again, unless only a bot on `main` writes it, which is a CI change with a push-capable token. Rejected.
- **A `pnpm changelog` script.** Filename order is authoring order, not merge order, and a script
  sorting filenames adds nothing over `ls`. The `git log --diff-filter=A` recipe gives merge order and
  the PR number with no code, no second "what is a fragment" definition, and no `package.json` line (a
  known conflict point). Rejected; add one when a second consumer needs it.
- **Append at the bottom; one file per month; towncrier/changesets.** Still a shared line, conflicts
  within the month, and a dependency for ~0 gain. Rejected.

## Risks / rollback

| Risk                                                                                                  | Mitigation                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The guard no longer forces status.md open, so a merged backlog item's row/pointer goes stale          | Stated in the guard's docblock. ship-pr's `:128` red flag and review-pr dimension 7 check the row/pointer by hand. Making that mechanical is a separate question. |
| A pre-DX-2 branch's entry merges cleanly into the old section                                         | The merge-base rule makes `status:check` fail after `main` is merged in; keep-mergeable step 4 runs it and moves the entry.                                       |
| Two fragments with the same name                                                                      | The full branch name plus a date; the guard enforces the shape. A reused branch name on another day differs by date.                                              |
| A fragment's relative link breaks (one level deeper than status.md)                                   | The README states the link forms. `skills:check` (#179) doesn't scan `docs/`; accepted, and review-pr dimension 7 reads the fragment.                             |
| The `Where we are` pointer, `Last updated`, the skills-README table and `package.json` still conflict | Named in the Goal as not fixed. keep-mergeable handles them.                                                                                                      |
| Rollback                                                                                              | Revert the implementation PR. Fragments are plain markdown and can be pasted back into status.md.                                                                 |

## Out of scope

- Moving or rewriting existing entries. Wiring `status:check` into CI (a CI change; its own plan).
- Mechanically checking that the status.md row/pointer moved with a backlog item.
- The skills-README table, `package.json` and `docs/plan.md` as conflict sources.
- Showing recent fragments in the #179 session briefing (a one-line follow-up using the `git log` recipe).

## Test plan (the implementation PR)

1. `check-status-touched.test.sh`: the cases in the file table, each mutation-checked (merge-base rule
   off, name regex off, `--no-renames` off, untracked source off; each must turn a case red).
2. **The design demonstration, run once and pasted into the PR description, not committed:** two
   branches each adding a fragment merge cleanly in both orders, while two status.md top-inserts
   conflict. It proves git, not this repo, so it doesn't earn a place in the suite.
3. Before shipping:
   `git grep -n 'status\.md\|[Cc]hangelog' -- AGENTS.md README.md docs/spec.md .claude .github/scripts`,
   and every hit either points to the README or is the frozen history.
4. `pnpm verify` · `guides:check` · `skills:check` · `hold-the-bar`. The implementation PR is a
   `docs/` branch, so `status:check` exits at "doesn't owe": the new path is proven by the self-test,
   and the first owing PR after DX-2 is its first real run.

## Open questions

None blocking. The `pnpm changelog` question is resolved (rejected; see the log).

## Review-response log

### Engineering panel, round 1 (correctness · scope · architecture · reuse; the #178 panel agents' first run)

| #   | Lens                          | Critique (short)                                                                                                                              | Verdict                                         | Resolution                                                                                                                                                                      |
| --- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Correctness (BLOCKING), Reuse | "status.md touched" still passes, so there are two mechanisms, and a legacy entry merges **cleanly** into the frozen section                  | **accepted**                                    | The merge-base rule; the legacy path drains through keep-mergeable. Acceptance rewritten around it                                                                              |
| C2  | Correctness, Arch             | Filename date isn't merge order; "add `(#n)` later" is an extra commit                                                                        | **accepted**                                    | `git log --diff-filter=A` recipe: merge date + `(#n)` from the squash subject                                                                                                   |
| C3  | Correctness                   | Name uniqueness and shape were prose; `feat/x` vs `fix/x` collide; `notes.md` sorts "newest"                                                  | **accepted**                                    | Full branch name, `/`→`-`; the guard enforces the regex; tests for misnamed and nested files                                                                                    |
| C4  | Correctness                   | The goal over-claims; the merge test proves git                                                                                               | **accepted**                                    | Goal states what's fixed and what isn't, per 09-30 PR; the demonstration goes in the PR description, not the suite                                                              |
| C5  | Correctness                   | Rename detection turns an add into `R`; untracked fragment untested                                                                           | **accepted**                                    | `--no-renames` on every source; staged and untracked cases                                                                                                                      |
| S1  | Scope, Reuse                  | Cut `pnpm changelog`                                                                                                                          | **accepted**                                    | Rejected in Alternatives; the `git log` recipe also answers C2 without code                                                                                                     |
| S2  | Scope                         | Don't commit the git-invariant merge test                                                                                                     | **accepted**                                    | Test plan item 2                                                                                                                                                                |
| S3  | Scope, Arch                   | A permanent "legacy" row keeps two mechanisms alive                                                                                           | **accepted**                                    | Drain-on-merge via the guard; the row says "move it into a fragment"                                                                                                            |
| S4  | Scope                         | Argue "no hand-written entry at all"                                                                                                          | **considered, rejected**                        | Alternatives, with the reason and the fallback                                                                                                                                  |
| A1  | Arch, Reuse                   | Renaming the heading next to the insertion point conflicts with every open branch                                                             | **heading kept; conflict claim not reproduced** | Probed with the real layout (heading, blank line, entries): the rename merges clean (exit 0). The heading is kept anyway, so post-DX-2 entries can't land under "history ended" |
| A2  | Arch, Reuse                   | The file table missed places stating the old rule                                                                                             | **accepted**                                    | Rows for AGENTS.md `:64`/`:204-205`, spec, README, start-task, ship-pr `:3`/`:128`, review-pr `:128`, keep-mergeable `:3`/`:10`, the guard's docblock; grep in the test plan    |
| A3  | Arch                          | New tests in the wrong file, not wired into anything                                                                                          | **moot**                                        | No `changelog.mjs`; all cases are the guard's own, already in `guards:test` (#179)                                                                                              |
| A5  | Arch                          | The guard stops guarding status.md freshness, silently                                                                                        | **accepted**                                    | Said in the docblock, Risks and the reworded red flag; mechanising it is out of scope                                                                                           |
| R1  | Reuse                         | The entry format in three copies, one with a broken link                                                                                      | **accepted**                                    | The README is the single source; others link it                                                                                                                                 |
| R4  | Reuse                         | Fragment dir and filter hand-typed in two scripts                                                                                             | **moot**                                        | One script now                                                                                                                                                                  |
| —   | NITs (all)                    | `docs/plan.md` row is NEW; which PR owns which row; "branch names are unique" over time; "slug" ambiguous; link forms; heading date ambiguity | **accepted**                                    | Header, file table, Risks, Design                                                                                                                                               |

C1 reshaped the guard, so the revised plan went back to the correctness lens.

### Engineering panel, round 2 (correctness re-review of the reshaped guard)

| #   | Critique (short)                                                                                                                                                 | Verdict      | Resolution                                                                                                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------- |
| R1  | **BLOCKING:** the merge base is read before keep-mergeable's merge commit exists, so a conflicted (uncommitted) merge still passes the legacy branch. Reproduced | **accepted** | Detection is `docs/changelog/README.md` in the working tree; a `--no-commit` merge test is added and mutation-listed |
| R2  | "Take main's status.md" silently drops the branch's row/pointer edits                                                                                            | **accepted** | Move only the entry lines; keep row/pointer; verified by `git diff origin/main HEAD -- docs/status.md`               |
| R3  | Detached HEAD (keep-mergeable) loses the branch type and the exact name                                                                                          | **accepted** | `STATUS_BRANCH=<headRefName>`; a pinned fallback pattern                                                             |
| R4  | A regex built from the branch name breaks on `.`, `+`, `(`                                                                                                       | **accepted** | Date-prefix regex + literal comparison; `fix/v1.2-x` test                                                            |
| —   | NITs: test-plan item 4 was wrong (a `docs/` branch doesn't owe); the `git log` recipe needs "run on main / not shallow"; silence `cat-file`                      | **accepted** | Test plan item 4; README caveat; detection no longer uses `cat-file`                                                 |

C2–C5 confirmed sound by the same lens. **Blocking concerns remaining: none.**
