# CI's PR guards compare against the main the PR was merged with

**Type:** `fix`, CI. Standalone (no backlog row). Closes the deferral recorded as C2-2 in
[dx-5b](./dx-5b-local-gates-in-ci.md) § Review-response log. Roadmap alignment (2026-11-14): checked
against the private roadmap; nothing to add here. Advances nothing; gates nothing.

## The defect

On `pull_request`, `actions/checkout` checks out the **merge ref** (`refs/pull/<n>/merge`): the PR head
merged into `main` as `main` stood when GitHub built that ref. Six steps in `quality` diff against
`github.event.pull_request.base.sha`, which is `main` as it stood when the **event** was created. When
`main` moves in between, every commit and file that landed on `main` in the gap is read as the PR's.

**Observed:** #388 (`docs/milestone-family-program`, a docs branch) failed the Status guard on run
43662580861 with _"this is a feat branch and it adds no changelog fragment"_. `BASE_SHA` was
`ac2b105`. #387 (`feat(v1-9b): …`, `315c368`, whose parent is `ac2b105`) merged at 00:43Z, and the run
started at 01:19Z. The run's checkout log reads `Merge f59ab0c… into 315c368…`: the merge ref already
contained #387, and the base the guard was handed did not.

## Acceptance

1. A docs PR whose merge ref includes a `feat` commit that landed on `main` after the PR's
   `base.sha` passes the Status guard.
2. A docs PR with **its own** `feat` commit and no fragment still fails it, in the same merge-ref shape.
3. Every `quality` step that needs a PR base reads **one** resolved value: the merge ref's first
   parent, `HEAD^1`, the exact `main` the checked-out commit was built from.
4. The resolver fails the step (exit 2) unless the checkout **is** the merge ref: `HEAD` equals
   `$GITHUB_SHA` and has a second parent. A head-ref checkout whose tip merged `main` (two parents,
   the update method AGENTS.md mandates) is refused, never silently compared against its own
   previous commit.
5. On `push`, the resolved base is empty, so the two steps that run on push (action pins, audit) keep
   their "no base → strictest mode" branches.
6. Per DX-14 item 1, a test fails on the parent commit **for the defect**, and the PR shows that run.

## Design

`.github/scripts/resolve-pr-base.sh` prints the base SHA, or nothing when the event isn't a PR. A step
`id: base` right after checkout runs it:

```bash
sha="$(bash .github/scripts/resolve-pr-base.sh)"   # assignment: a failure aborts under bash -e
echo "sha=$sha" >> "$GITHUB_OUTPUT"
```

The six `BASE_SHA: ${{ github.event.pull_request.base.sha }}` lines become
`BASE_SHA: ${{ steps.base.outputs.sha }}`. No consumer's `run:` changes; the guard scripts are
untouched, so local `pnpm status:check [base]` and `guides:check [base]` behave exactly as today.

The script reads `GITHUB_EVENT_NAME` and `GITHUB_SHA` (both set by the runner, neither
attacker-controlled) and runs git through argv only.

## File-by-file

| File                                                              | Change                                                                                                                                          |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/scripts/resolve-pr-base.sh`                              | New, ≈ 30 lines.                                                                                                                                |
| `.github/scripts/resolve-pr-base.test.sh`                         | New self-test; added to `guards:test`.                                                                                                          |
| `.github/workflows/ci.yml`                                        | The `base` step; six `BASE_SHA` lines; the comments at the checkout (`:29`) and the audit's three-dot note (`:317`), which describe `base.sha`. |
| `.github/scripts/check-status-touched.test.sh`                    | Merge-ref-shape cases (Test plan 2).                                                                                                            |
| `package.json`                                                    | `guards:test` gains the new self-test.                                                                                                          |
| `docs/lessons.md`                                                 | CI / secrets: the `BASE_SHA` entry's "because CI passes `BASE_SHA`" is corrected, and the stale-base trap gets its symptom → cause → fix.       |
| `AGENTS.md`                                                       | "Local hooks vs CI merge-gates": the guard self-test count (`all eleven`) becomes twelve.                                                       |
| `docs/changelog/2026-11-14-fix-ci-status-guard-merge-ref-base.md` | Fragment.                                                                                                                                       |

## Test plan

1. **`resolve-pr-base.test.sh`**, in a throwaway repo:
   - merge-ref shape, `HEAD == GITHUB_SHA` → prints `HEAD^1`;
   - `GITHUB_SHA` differs from `HEAD` → exit 2;
   - single-parent `HEAD` → exit 2;
   - a branch tip that merged `main` (two parents) with `GITHUB_SHA` set to something else → exit 2;
   - `GITHUB_EVENT_NAME=push` → prints nothing, exit 0.
     The test sets `GITHUB_SHA` and `GITHUB_EVENT_NAME` itself: CI's self-test step inherits real ones.
     **Pin:** `ci.yml` contains no `pull_request.base.sha`, and every `BASE_SHA:` line reads
     `steps.base.outputs.sha`.
2. **`check-status-touched.test.sh`**, merge-ref shape (main gains `feat(y):` after the branch point):
   - docs branch, base `HEAD^1` → exit 0;
   - same repo, the stale branch point as base → exit 1 (documents the defect);
   - docs branch with its own `feat:` commit and no fragment, base `HEAD^1` → exit 1 (the base
     cannot be degenerate: `HEAD` as base would pass this).

**Red on the parent, honestly:** the pin in 1 fails on the parent because the defect _is_
`ci.yml`'s `base.sha` argument. That's the test red for the right reason. The resolver cases fail
there only because the script doesn't exist yet, and the status-guard cases in 2 pass on the parent
(the guard was never wrong; its input was). The PR says exactly this.

## Out of scope

- **A stacked child that merged `main` before its parent did** still sees the parent's commits
  (`HEAD^1` is the parent's tip). It is unchanged by this PR, and `base.sha` had the same behaviour.

## Risks / rollback

- A `pull_request_target` workflow would check out the base tip and fail the resolver's assertion.
  None exists; the failure is loud.
- Rollback: revert; the six lines go back to `base.sha`.

## Review-response log

Engineering panel, 2026-11-14, three lenses: correctness, security, scope. Each finding was checked
against the code or by probe before it was accepted.

| #   | Lens        | Critique (short)                                                                                                                                  | Verdict                    | Resolution                                                                                     |
| --- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------- |
| S1  | Scope       | A `--merge-ref` flag in the status guard is unnecessary: probed, the unmodified guard given `HEAD^1` passes. And it protects one of six consumers | **accepted**               | One resolver step for all six; the guard is untouched.                                         |
| S2  | Scope       | The flag's "fails on parent" case fails on an unknown argument, not on the defect                                                                 | **accepted**               | Test plan says which test is red for the right reason (the pin), and that the others are not.  |
| S3  | Scope       | `ci.yml:51` is the action-pins `--resolve` switch, not the e2e skip                                                                               | **accepted**               | Corrected; the e2e skip uses `pulls.listFiles` and needs no base.                              |
| S4  | Scope       | Keep the lessons edit; the comments at `:29` and `:317` also describe `base.sha`                                                                  | **accepted**               | Both in the file table.                                                                        |
| Se1 | Security    | A two-parent check can't tell the merge ref from a head tip that merged `main`; probed: exits 0 and hides the branch's own commits                | **accepted**               | Acceptance 4: also require `HEAD == $GITHUB_SHA`.                                              |
| Se2 | Security    | A pin on the workflow text doesn't prove the value arrives                                                                                        | **accepted, reshaped**     | Moot for a flag (there is none); the resolver prints the SHA it resolved, so the log shows it. |
| C1  | Correctness | Same as Se1; proposed matching the merge subject `Merge <HEAD^2> into <HEAD^1>`                                                                   | **accepted via Se1's fix** | `HEAD == $GITHUB_SHA` is the stronger check and doesn't depend on GitHub's subject format.     |
| C2  | Correctness | Case 1 can't tell `HEAD^1` from a degenerate base (`HEAD` also passes)                                                                            | **accepted**               | Test plan 2's third case: the branch's own `feat` still fails.                                 |
| C3  | Correctness | Red-on-parent holds only trivially                                                                                                                | **accepted**               | Same as S2.                                                                                    |
| C4  | Correctness | Flag parsing would drop a flag after a positional                                                                                                 | **moot**                   | No flag.                                                                                       |
| C5  | Correctness | The plan splits C2-2's recorded deferral without citing it                                                                                        | **accepted**               | Cited in the header; this PR fixes both steps C2-2 named, and the other four.                  |
| C6  | Correctness | Stacked child inherits the parent's subjects                                                                                                      | **recorded**               | Out of scope, unchanged behaviour.                                                             |
