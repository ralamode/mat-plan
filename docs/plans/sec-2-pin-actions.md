# SEC-2 — SHA-pin every GitHub Action, and keep it that way

> Backlog: [plan.md](../plan.md) → AUDIT-1 row 4 (finding P1-2 in
> [the baseline audit](../audits/2026-09-30-baseline.md)). Branch: `chore/sec-2-pin-actions`.

## Goal

`migrate.yml` runs `pnpm/action-setup@v6`, a third-party action referenced by a **mutable tag**, in
the job that holds the **production database credential**. The secret is only on the later "Apply
migrations" step's `env`, so the action never sees it directly. But an action can write
`$GITHUB_PATH`, `$GITHUB_ENV` or `BASH_ENV`, or replace the `pnpm` binary it installs, and the later
step then runs the attacker's code **with the secret in its env**. Whoever controls that tag (a
compromised maintainer account, a hijacked release) controls that. A full commit SHA can't be moved.

`claude-review.yml` already pins every action. The other four workflows don't. This PR pins all of
them and adds a guard, `check-action-pins.mjs`, so the next workflow edit can't quietly reintroduce
a tag.

**Why a guard, not only GitHub's "require actions pinned to a full-length commit SHA" setting.**
That repo setting fails a workflow **when it runs**:

- `migrate.yml` runs only on push to `main` and on dispatch (`migrate.yml:16-18`);
- `codeql.yml` runs on push to `main`, weekly, and on dispatch;
- `prune-screenshots.yml` runs only when a PR closes.

So a tag-pinned edit to `migrate.yml` would merge green, and then **prod migrations would stop on
`main`**. Only a pre-merge check catches that. The setting is still recommended as defence in depth
(see "For Ray").

## Acceptance

- plan.md: _"P1: SHA-pin the actions in `migrate.yml` (prod DB credential) and third-party ones in
  `ci.yml`"_.
- Done when:
  - **Every remote `uses:` is pinned, in the exact format Dependabot updates.** That covers all
    `.github/workflows/*.y{a,}ml`, step-level and job-level (reusable workflow) refs alike. Each one
    is `owner/repo[/path]@<40-hex SHA> # vX.Y.Z`, with **nothing after the version**. The SHA is the
    commit the previous tag currently resolves to, so no version changes in this PR.
  - **`pnpm actions:check` checks the format (offline).** It exits 1 on:
    - a tag- or branch-pinned ref;
    - a SHA with a missing comment or a comment that isn't exactly the version;
    - any local `./` action ref, except `./.github/workflows/*`.

    It exits 2 on a usage or IO error, or when it finds no workflow or no `uses:` at all. It exits 0
    on the repo after this PR.

  - **The same script, with `--resolve`, checks each pin against GitHub (the canonical repo).**
    For each pin, `repos/<owner>/<repo>/commits/<version>` must return exactly the pinned SHA. That
    catches a mislabelled SHA, a stale comment, and an "imposter" commit: a fork's commit is
    reachable through the parent repo's path, so a SHA that merely _exists_ there proves nothing,
    but a SHA equal to the tag's commit does.
  - **CI runs `--resolve` as a step in `quality`.** Like every CI check today, it is advisory:
    AGENTS.md:284 says none is a required status check, so the `review-pr` "CI green" bar holds the
    line until DX-5. `pnpm verify` runs the offline `actions:check`; `guards:test` runs the
    self-test.
  - **Dependabot keeps bumping the pins, verified from source.** The `github-actions` block already
    exists (`.github/dependabot.yml:62-79`). Its source was read at dependabot-core `f5fd23ee`:
    - `update_checker.rb:286-288` and `:356-367`: a SHA ref moves to the latest version tag that
      respects the cooldown;
    - `version_commenter.rb` `previous_version_from_comment`: the comment is rewritten **only if it
      ends with the version**, which is why the format above allows nothing after it.

    No SHA pin in this repo has been bumped yet (`git log -- .github/workflows/claude-review.yml`
    shows only #185). The first grouped `actions` PR after merge is the live proof.

## Scope: all actions, first-party too

The audit asked for `migrate.yml` plus the third-party actions in `ci.yml`. This plan pins
**every** action:

- **A rule with exceptions needs an allowlist.** A guard can't enforce "third-party only" without
  one, and the allowlist is one more thing to keep in sync. "First-party" is a judgment, not a
  mechanical property.
- **`actions/*` tags are just as mutable.** The risk comes from the mutable tag, not from who owns it.
- **It costs ~14 more one-line edits.** Dependabot's grouped `actions` PR bumps them all.

## Resolved pins (re-verified 2026-09-30 by the author, the correctness lens and the security lens)

| Action                                | Was   | SHA                                        | Version | Sites                                                         |
| ------------------------------------- | ----- | ------------------------------------------ | ------- | ------------------------------------------------------------- |
| `actions/checkout`                    | `@v7` | `3d3c42e5aac5ba805825da76410c181273ba90b1` | v7.0.1  | ci.yml:21,279,391 · migrate.yml:34 · codeql.yml:52 · prune:38 |
| `actions/setup-node`                  | `@v7` | `820762786026740c76f36085b0efc47a31fe5020` | v7.0.0  | ci.yml:218,344 · migrate.yml:40                               |
| `pnpm/action-setup`                   | `@v6` | `0977fd99725f1db4007ccb2928dbb4e90d06cc86` | v6.0.10 | ci.yml:215,340 · **migrate.yml:37**                           |
| `actions/cache`                       | `@v6` | `55cc8345863c7cc4c66a329aec7e433d2d1c52a9` | v6.1.0  | ci.yml:355                                                    |
| `actions/github-script`               | `@v9` | `3a2844b7e9c422d3c10d287c895573f7108da1b3` | v9.0.0  | ci.yml:294                                                    |
| `actions/upload-artifact`             | `@v7` | `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` | v7.0.1  | ci.yml:376                                                    |
| `github/codeql-action/{init,analyze}` | `@v4` | `2892aa5e19bbd11bc0cff5427e3b750a04d9e3c2` | v4.38.2 | codeql.yml:73,82                                              |
| `gitleaks/gitleaks-action`            | `@v3` | `e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e` | v3.0.0  | ci.yml:396                                                    |

That's 18 edits: `ci.yml` 11, `migrate.yml` 3, `codeql.yml` 3, `prune-screenshots.yml` 1.
`checkout` and `upload-artifact` match the pins already reviewed in `claude-review.yml:51,115`.
The pins aren't hand-typed. The implementation re-resolves every tag with the same script's
`--resolve` logic before committing, and the PR description carries that output.

## File-by-file changes

| Path                                                   | Change | What & why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/ci.yml`                             | EDIT   | 11 `uses:` → SHA + `# vX.Y.Z`. New `quality` step **"Action pins"**, see below. Fix the stale "would not be a required check" comment at `:200-202` to match AGENTS.md:284. One line.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `.github/workflows/migrate.yml`                        | EDIT   | 3 `uses:` → SHA. No header comment: the guard protects the file, and the rule lives in SECURITY.md.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `.github/workflows/codeql.yml`                         | EDIT   | 3 `uses:` → SHA (init and analyze share one).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `.github/workflows/prune-screenshots.yml`              | EDIT   | 1 `uses:` → SHA.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `.github/workflows/claude-review.yml`                  | EDIT   | 4 pin comments have prose after the version (`:51`, `:62`, `:135`, `:140`; `:115` is already bare). Move it to a comment line above each step so Dependabot can rewrite the version. **Reword `:62`**, because Dependabot never touches the line above: "the panel read v1.0.237 (`fd1c128`); any other SHA here must be re-read per runbooks → CLAUDE_CODE_OAUTH_TOKEN step 6 before merge". After a bump, the mismatch with the `# vX` below is visible. The other moved prose stays true after a bump. Trim the header at `:13` to what's unique to this file (claude-code-action is never grouped, and why); the general rule moves to SECURITY.md. |
| `.github/scripts/check-action-pins.mjs`                | NEW    | ~70 lines, no dependencies. Shape below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `.github/scripts/check-action-pins.test.sh`            | NEW    | Modelled on `check-skills.test.sh:24-34`: `expect <name> <exit> <text>`, the fixture from a heredoc, the guard run with a dir argument. Offline cases only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `package.json`                                         | EDIT   | `"actions:check": "node .github/scripts/check-action-pins.mjs"`. Add it to `verify` next to `skills:check`, and append the self-test to `guards:test`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `.github/SECURITY.md`                                  | EDIT   | **The one statement of the rule**, under Supply chain: every `uses:` is pinned to a SHA with a bare `# vX.Y.Z` comment, plus why (the mutable tag; the imposter commit), the guard, Dependabot, and the residual risks below.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `AGENTS.md`                                            | EDIT   | A one-clause pointer in the "CI checks" list at `:284-288`: action pins (`check-action-pins.mjs --resolve`, SECURITY.md → Supply chain). Plus a clause in the `:269-273` "only here, not in CI" sentence: `actions:check` is the exception.                                                                                                                                                                                                                                                                                                                                                                                                             |
| `.claude/skills/README.md`                             | EDIT   | A guard-registry row for `check-action-pins.mjs` (CI `quality` + `verify`). Reword the lead-in "(in `verify`, not in CI)", which this guard makes false.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `docs/plan.md`                                         | EDIT   | Link this plan from AUDIT-1 row 4. Add a clause to the DX-5 row: this guard already runs in `quality`; its self-test does not.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `docs/changelog/2026-09-30-chore-sec-2-pin-actions.md` | NEW    | The changelog fragment (DX-2). `docs/status.md` is untouched unless "Where we are" moves.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

### `check-action-pins.mjs`

```
usage:   check-action-pins.mjs [--resolve] [dir]
         dir defaults to <repo>/.github/workflows, resolved from import.meta.url (not cwd)
scan:    every *.yml / *.yaml in dir. Exit 2 if there are none, or if they contain no uses: at all
         (a guard that checked nothing must not pass; ci.yml:24-26 makes the same point)
match:   /^\s*(?:-\s+)?["']?uses["']?\s*:\s*["']?([^\s"'#]+)["']?(.*)$/
         anchored, so `statuses: read # …` and comment lines never match; quoted key/value accepted
local:   `./.github/workflows/*` (a local reusable workflow, scanned anyway as it's in dir) → ok.
         Any other `./` → FAIL: "a local action's own uses: are not scanned; extend this guard
         and Dependabot's directories: first"
pass:    ref  =~ /^[A-Za-z0-9][\w.-]*\/[\w.-]+(\/[\w./-]+)?@[0-9a-f]{40}$/
         rest =~ /^\s+#\s*(v\d+(?:\.\d+)*)\s*$/       (nothing after the version: Dependabot rule)
fail:    `path:line  <ref>  — pin to a full commit SHA with a bare "# vX.Y.Z" comment
          (.github/SECURITY.md → "Supply chain")`; list all, then exit 1
--resolve: per unique (owner/repo, version), GET api.github.com/repos/<o>/<r>/commits/<version>
         (any /path dropped; host fixed), Authorization from GH_TOKEN if set (node fetch).
         Never exit 0 on anything but a 200 (a check that couldn't check must not pass):
           200 + .sha is 40 lowercase hex → must equal the pin, else exit 1
                                            "pin <sha> is not <version>'s commit"
           404 / 422 (GitHub's unknown-ref answer, probed) → exit 1 "tag <v> not found in <o>/<r>"
           5xx / network error → one retry, then exit 2 "API unreachable"
           401 / 403 / 429 / anything else → exit 2
```

Known gap, recorded in a script comment, not in a test: a flow-style mapping (`- {uses: x@v1}`)
isn't matched. None exist, and the form is unidiomatic in workflows.

### The `quality` step

**When `--resolve` runs.** The offline check runs every time. The network check runs only on a push
to `main` and on a PR whose diff against `base.sha` touches `.github/workflows/` or the guard itself,
because a bad pin can only arrive that way. That keeps a GitHub API outage, or a moved tag, from
turning every unrelated PR red (which would block every merge once DX-5 makes `quality` required).
The skip is decided inside the step (AGENTS.md: skips are step-level, never a job `if:`).
`quality`'s checkout is already `fetch-depth: 0` (`ci.yml:21-27`), so the diff is cheap.

It goes **right after `checkout`** and before every other step, so a pin failure shows up even when
an earlier guard (forward-only, feature guides) fails. It uses plain `node` with no install, so it
fails in seconds, and has no `if:` (it runs on push and PR). Its inline comment, like its siblings:

- why it's a step, not a job;
- why it uses `--resolve` here;
- that it can't check the `checkout` that runs before it, which is unavoidable and harmless (that
  `checkout` is itself one of the pins being checked).

```yaml
- name: Action pins (SHA + version; resolved against GitHub when workflows change)
  env:
    GH_TOKEN: ${{ github.token }} # read-only; lifts the 60/h anonymous API limit
    BASE_SHA: ${{ github.event.pull_request.base.sha }}
  run: |
    resolve=--resolve
    if [ -n "$BASE_SHA" ] && ! git diff --name-only "$BASE_SHA" HEAD -- \
         .github/workflows .github/scripts/check-action-pins.mjs | grep -q .; then
      resolve=  # PR touches no workflow: the offline format check is enough
    fi
    node .github/scripts/check-action-pins.mjs $resolve
```

The `quality` job already has `contents: read`. Reading public repos' commits needs nothing more.

## Test plan

- **`check-action-pins.test.sh`**, offline fixtures, one line each:
  - **pass:** SHA + `# v7.0.1`; a `.yaml` file; a job-level reusable workflow `o/r/.github/workflows/x.yml@<sha> # v1.2.3`; a bare `uses:` with no `- ` under `name:`; a quoted key/value; a local `./.github/workflows/y.yml`;
  - **fail (1):** `@v7`; `@main`; `@main # v7`; a 40-hex SHA with no comment; `# pinned`; `# v7.0.1 — note` (text after the version); a 39-hex SHA; an uppercase SHA; `../b/c@<sha> # v1`; `./.github/actions/foo`; a job-level reusable workflow `@v1`;
  - **no match:** `statuses: read # uses: x@v1`;
  - **exit 2:** an empty dir, and a dir with workflows but no `uses:`;
  - **every offender listed:** two offenders in one file, both reported.
- **`--resolve`** isn't run in the self-test (network). It's exercised by this PR's own CI run, and
  the implementation proves it can fail once by hand (a pin with the wrong version comment → exit 1),
  with the output in the PR.
- **Local:** `pnpm verify` (runs `actions:check` + `guards:test`).
- **CI:** this PR's `quality`, `e2e` and `gitleaks` runs use the pinned `checkout`, `setup-node`,
  `pnpm`, `cache`, `github-script` and `gitleaks`. **The merge itself** then triggers `migrate`,
  `codeql` (on push to `main`) and `prune-screenshots` (when the PR closes). Post-merge: confirm all
  three are green.

## Risks / rollback

| Risk                                                                                                                                                            | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A wrong or imposter SHA, in this PR or a later one (an agent-authored workflow edit, say)                                                                       | `--resolve` in `quality` requires the SHA to equal the canonical repo's tag commit. The PR description carries the resolver's output.                                                                                                                                                                                                                                                                                                                      |
| A **hostile** PR adds an imposter pin and, in the same diff, weakens the guard or removes its step (`pull_request` runs the PR head's copy), and CI stays green | **Accepted residual, named in SECURITY.md:** `--resolve` catches honest mistakes and unnoticed agent edits, not a malicious author. A diff touching `check-action-pins.mjs` or its step is itself a review flag. Before merge an imposter pin can't do harm (read-only tokens only); after merge it runs in `migrate`. Not moved to `pull_request_target`, which is a far larger hazard. A CODEOWNERS entry for `.github/` is a candidate once DX-5 lands. |
| A GitHub API hiccup turns `quality` red                                                                                                                         | One retry, then exit 2 with "API unreachable", so the failure is distinguishable from a bad pin. Re-run the job.                                                                                                                                                                                                                                                                                                                                           |
| A maintainer moves a version tag (e.g. re-tags `v7.0.1`), so `--resolve` fails on a pin that didn't change                                                      | This is the signal working: a moved exact-version tag is itself suspicious. Investigate, then re-pin deliberately.                                                                                                                                                                                                                                                                                                                                         |
| `migrate.yml` breaks after merge, and prod migrations stop                                                                                                      | Its 3 actions use the same SHAs as `ci.yml` steps that run green on this PR. A failure is loud and leaves the DB untouched.                                                                                                                                                                                                                                                                                                                                |
| Pins go stale and miss fixes                                                                                                                                    | Dependabot runs weekly, grouped, with a 7-day cooldown. Expect `pnpm/action-setup` → 6.1.0 in the first grouped PR (`v6` hasn't moved to it yet), and read that one: it lands in the prod-credential job.                                                                                                                                                                                                                                                  |
| A remote composite action pulls its own transitive actions by tag                                                                                               | Can't be fixed from here. Pinning the outer SHA freezes its `action.yml` to that commit's references. **Accepted residual**, named in SECURITY.md.                                                                                                                                                                                                                                                                                                         |

Rollback: revert the PR. The tags still resolve.

## Out-of-scope / deferred

- `cache: pnpm` in `migrate.yml` (cache poisoning), and install scripts running during `pnpm install`
  in the prod-credential job. The same class of risk (code that runs before the secret step), but
  separate changes. They get a new AUDIT-1 follow-up row.
- Version bumps. This PR changes only the form of each ref.
- `persist-credentials: false` on the `ci.yml` checkouts. Not made worse here.

## For Ray (repo settings, no code)

- **Recommended:** Settings → Actions → General → "Require actions to be pinned to a full-length
  commit SHA". It enforces the same rule at run time, which covers anything this guard can't see.

## Open questions

None.

## Review-response log (adversarial panel)

### Engineering panel (round 1): correctness, scope, architecture, reuse, security

| #   | Lens                   | Critique (short)                                                                                                                                                                                                            | Verdict             | Resolution                                                                                                                                                                                                                                                                                                                   |
| --- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| X1  | Security               | The `# v…` regex isn't anchored at the end; Dependabot rewrites the comment only if it ends with the version, so `claude-review.yml`'s 5 pins would keep stale comments, and `:62` would make a false claim about the panel | **accepted**        | The pass rule is anchored (`\s*$`). The `claude-review.yml` prose moves to the line above each step (EDIT row added). Acceptance now cites dependabot-core source instead of "relied on since #185", which was never observed. Test `# v7.0.1 — note` fails.                                                                 |
| X2  | Security               | The guard checks shape only; a mislabelled or imposter (fork) SHA passes on later PRs                                                                                                                                       | **accepted**        | Added `--resolve`: the pin must equal the canonical repo's tag commit; it runs in `quality`. This is a judgment call on scope (~30 lines more). The alternative, an accepted residual plus a backlog row, leaves agent-authored workflow edits unchecked, and human review can't verify a SHA by eye.                        |
| X3  | Security · Correctness | `./` refs are skipped, so a local composite action's own `uses:` is never scanned                                                                                                                                           | **accepted**        | Any `./` ref fails, except `./.github/workflows/*`, with a message to extend the guard and Dependabot first. None exist today.                                                                                                                                                                                               |
| X4  | Security · Correctness | Quoted key or value either bypasses the guard or fails with a misleading message; `..` owner passes                                                                                                                         | **accepted**        | The match regex allows optional quotes; the owner must start with an alphanumeric. Both are tested.                                                                                                                                                                                                                          |
| X5  | Security               | The Goal misstates how the action reaches the secret                                                                                                                                                                        | **accepted**        | Goal rewritten: `$GITHUB_PATH`/`$GITHUB_ENV`/`BASH_ENV` or the `pnpm` binary, then the later step that holds the secret.                                                                                                                                                                                                     |
| X6  | Security               | Expect pnpm → 6.1.0 right after merge                                                                                                                                                                                       | **accepted**        | In Risks, and the PR description will say so.                                                                                                                                                                                                                                                                                |
| C1  | Correctness            | The guard passes when it scans zero files; the default dir depends on cwd                                                                                                                                                   | **accepted**        | Exit 2 on no files or no `uses:`; the dir is resolved from `import.meta.url`; two tests.                                                                                                                                                                                                                                     |
| C2  | Correctness · Scope    | `ci.yml` has 11 `uses:`, not 12; the Dependabot citation is `:62-79`                                                                                                                                                        | **accepted**        | Fixed.                                                                                                                                                                                                                                                                                                                       |
| C3  | Correctness            | Tests are missing branches: `.yaml`, a job-level reusable workflow, `@main # v7`, `# pinned`, a bare `uses:`                                                                                                                | **accepted**        | All added. See C4/S2 for how this squares with the scope cap.                                                                                                                                                                                                                                                                |
| C4  | Correctness            | Put the step first so a pin failure always shows                                                                                                                                                                            | **accepted**        | Right after `checkout`.                                                                                                                                                                                                                                                                                                      |
| S1  | Scope                  | Justify the guard against GitHub's own pin-enforcement setting                                                                                                                                                              | **accepted**        | Goal now says why: the setting fails at run time, and `migrate.yml` only runs post-merge. The setting is recommended under "For Ray".                                                                                                                                                                                        |
| S2  | Scope                  | Cap the tests at ~6; drop the real-repo, docker and flow-style cases                                                                                                                                                        | **partly accepted** | Dropped the real-repo case (the named `actions:check` in `verify` covers it, per A3), the docker case and the flow-style case (now a script comment). **Rejected** the cap: each remaining case is one line and exercises a distinct regex branch the correctness/security lenses found reachable. The file stays ~50 lines. |
| S3  | Scope                  | Post-merge: drop the manual codeql dispatch                                                                                                                                                                                 | **accepted**        | The merge triggers `migrate`, `codeql` and `prune`; confirm all three.                                                                                                                                                                                                                                                       |
| R1  | Reuse · Arch · Scope   | The rule is written 4–5 times                                                                                                                                                                                               | **accepted**        | SECURITY.md → Supply chain is the one statement. AGENTS.md only points at it; no `migrate.yml` header; `claude-review.yml:13` is trimmed to what's unique to it.                                                                                                                                                             |
| R2  | Reuse                  | The error message points at a non-existent "AGENTS.md → CI"                                                                                                                                                                 | **accepted**        | It points at `.github/SECURITY.md → "Supply chain"`.                                                                                                                                                                                                                                                                         |
| R3  | Reuse · Arch           | The plan cites `quality` as "a required check"; AGENTS.md:284 says none is                                                                                                                                                  | **accepted**        | The plan says advisory until DX-5; the stale `ci.yml:200-202` comment is fixed (one line, file already touched).                                                                                                                                                                                                             |
| R4  | Reuse                  | Model the test on `check-skills.test.sh`, not `check-status-touched.test.sh`; exit 2 on usage/IO                                                                                                                            | **accepted**        | Both done.                                                                                                                                                                                                                                                                                                                   |
| A1  | Architecture           | The guard registry in `.claude/skills/README.md` is missing a row, and its "not in CI" lead-in becomes false                                                                                                                | **accepted**        | Row added; lead-in reworded.                                                                                                                                                                                                                                                                                                 |
| A2  | Architecture           | Add a named `actions:check` script in `verify`, like its siblings                                                                                                                                                           | **accepted**        | Done.                                                                                                                                                                                                                                                                                                                        |
| A3  | Architecture           | Status goes in a DX-2 changelog fragment, not `status.md`                                                                                                                                                                   | **accepted**        | A NEW fragment file; `status.md` only if "Where we are" moves.                                                                                                                                                                                                                                                               |
| A4  | Architecture           | The AGENTS.md "only here, not in CI" sentence and the DX-5 row understate CI after this PR                                                                                                                                  | **accepted**        | A clause in each.                                                                                                                                                                                                                                                                                                            |
| A5  | Architecture           | The new step needs the inline "why here" comment its siblings have                                                                                                                                                          | **accepted**        | Specified under "The `quality` step".                                                                                                                                                                                                                                                                                        |

No BLOCKING critiques were raised. X2 (`--resolve`) was the one change that grew scope, so it went
back to the security and scope lenses for one light pass.

### Engineering panel (round 2, light pass): security, scope

| #   | Lens     | Critique (short)                                                                                                               | Verdict      | Resolution                                                                                                                                                                                      |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| X7  | Security | Non-200 handling is unspecified; GitHub answers an unknown ref with **422** (probed), so a naive check passes on a missing tag | **accepted** | Full status table in the script shape: only a 200 with a valid SHA is compared; 404/422 → exit 1; everything else → exit 2. The hand-run demo adds "a version tag that doesn't exist → exit 1". |
| X8  | Security | Say what `--resolve` can't stop: a hostile PR can disable its own guard                                                        | **accepted** | A Risks row, and the same residual line in SECURITY.md.                                                                                                                                         |
| X9  | Security | Moving the `:62` prose isn't enough; Dependabot never edits the line above, so it would go false again one line up             | **accepted** | Reworded so a bump can't make it false. The count is corrected to 4 (`:115` is already bare).                                                                                                   |
| S4  | Scope    | A network check on every PR turns unrelated PRs red on an API outage or a moved tag                                            | **accepted** | `--resolve` runs only on push to `main` and on PRs touching `.github/workflows/` or the guard. The offline check always runs. Step-level skip.                                                  |

Round 2 confirmed `--resolve` defeats the imposter commit, that it exposes no new token
(`checkout` already writes the same read-only token into `.git/config`), and that the anchored
comment rule matches dependabot-core. Scope confirmed it is one concern at ~170 changed lines.
No open critiques remain.
