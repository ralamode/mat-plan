# CI — auto-skip the e2e smoke for docs/tooling-only PRs

> Branch: `chore/ci-e2e-auto-skip-docs`. Extends the merged e2e gating (#25, `ci-skip-e2e` label +
> PR-28 required plan). No backlog id — a CI-workflow refinement.

## Goal

The `e2e` smoke (build + Chromium + Postgres, ~2–4 min) runs on every PR, including pure docs/status
PRs where it proves nothing. Add an **automatic** skip for PRs whose every changed file is provably
inert — while keeping the job **required-check-safe** (it must still report success, never leave a
required check "pending" once e2e is required at PR 28). Complements the manual `ci-skip-e2e` label
(which covers known-irrelevant changes that _do_ touch code).

## Acceptance

- A PR that changes only inert files → the `e2e` job runs, **skips the heavy steps, and succeeds**
  (a `core.notice` explains why).
- A PR touching any `apps/**`, `packages/**`, `.github/workflows/**`, config, `package.json`, or the
  lockfile → the smoke **runs** (default-to-run).
- `push` to `main` → always runs the smoke (auto-skip is PR-only).
- No job-level `if:`/`paths-ignore` — the required check never stalls unreported.

## File-by-file changes

| Path                             | Change | What & why                                                                                                                                                                                                                                                                                                                  |
| -------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/ci.yml`       | EDIT   | Add `permissions: pull-requests: read` to the `e2e` job (to list PR files). Extend the `Resolve e2e override` github-script: keep the label check, then — on PRs only — list changed files and set `skip=true` iff ALL match an `INERT` allowlist (default-to-run). Heavy steps already gate on `steps.guard.outputs.skip`. |
| `AGENTS.md`                      | EDIT   | Document the auto-skip + the conservative allowlist + the required-check-safe (step-level only) invariant, alongside the existing label/admin-merge overrides.                                                                                                                                                              |
| `docs/plans/ci-e2e-auto-skip.md` | NEW    | This plan.                                                                                                                                                                                                                                                                                                                  |

**INERT allowlist** (skip only if every changed file matches): `docs/**`, root `*.md`, `.claude/**`,
`.github/{ISSUE_TEMPLATE,PULL_REQUEST_TEMPLATE}`, `.github/SECURITY.md`, `LICENSE`, image extensions.

## Test plan

Verified in CI by construction: this PR itself is docs/tooling + a workflow edit. Because it edits
`.github/workflows/ci.yml` (NOT inert), the smoke should **run** on this PR (proving default-to-run).
A follow-up docs-only PR is the positive case (smoke auto-skips, job green). Locally: `node --check`
the extracted script body + `prettier --check` the workflow.

## Risks / rollback

- **Wrong-skip merges an unverified prod change.** Mitigation: conservative allowlist + default-to-run
  (unknown path ⇒ run); the allowlist is tight regexes, reviewed here.
- **Required-check stall.** Mitigation: skip is always step-level; the job always runs and reports.
- **Perms.** Mitigation: `pull-requests: read` added at job scope only (least privilege).
- **Rollback:** revert the `ci.yml` guard hunk; purely additive, no app/runtime impact.

## Out-of-scope / deferred

Making `e2e` required (PR 28, branch-protection); skipping other jobs (`quality` stays on every PR —
it's fast and catches typecheck/lint/build regressions that docs PRs can still cause via config).
