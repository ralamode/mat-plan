# The migration snapshot chain check, as a script that runs everywhere

> Backlog: [tech-debt.md](../tech-debt.md) → "`drizzle-kit check` is not run anywhere" (closed by
> #711). That entry's ⚠️ line records the gap this PR closes: the chain check runs on pull requests
> only. Assigned by the board, 2026-11-19. Branch: `ci/dx-snapshot-chain-script`.

## Goal

The snapshot chain check is inline bash in `ci.yml`'s **Forward-only migration guard**
(`ci.yml:155-178`), which runs only on a pull request (`ci.yml:106`). It reads nothing but the
snapshot files in the tree, so it needs no base commit. Moving it into a script with a self-test
gains:

- **a self-test**, which the loop never had;
- **`pnpm verify`** runs it locally;
- **a push to `main`** runs it. That catches a PR merged while red (no check is required, AGENTS.md
  → CI checks) and a direct push. It does not catch two PRs racing for one snapshot number: those
  add the same `meta/00NN_snapshot.json` and cannot both merge, and `drizzle-kit check` (#711)
  catches two snapshots claiming one parent.

`drizzle-kit check` alone is not enough: it passes a snapshot whose `prevId` is its own `id`, the
break that shipped in #139 (probed on 0.31.11 in #711).

## Acceptance

1. `.github/scripts/check-snapshot-chain.mjs` reads every `*_snapshot.json` in
   `packages/db/migrations/meta/` (or `--dir`), compares **adjacent files in name order**, and
   exits:
   - **1** when a snapshot's `prevId` is not the `id` of the snapshot before it, or when any
     snapshot's `prevId` equals its own `id`;
   - **2** when it cannot check: no directory, no snapshots, a name that does not match
     `^\d{4}_snapshot\.json$`, a file that is not a JSON object with a string `id` and `prevId`, or
     any unexpected throw (one top-level catch);
   - **0** otherwise. Precedence: every file is read first, and any unreadable file exits 2 before
     a link is judged.
2. **Gaps in the numbering are allowed.** Main has no `0018_snapshot.json`, and `0019`'s `prevId` is
   `0017`'s `id`. Only adjacent existing files are compared. The script's header says so, so nobody
   tightens it into requiring consecutive numbers and turns `main` red.
3. Output: each finding names the file and the ids, printed with `JSON.stringify` so a value cannot
   inject a workflow command, then the repair text moved from `ci.yml:187-197`, with the gap rule added. On CI it
   ends with one fixed `::error::` line of its own.
4. CI runs it on **every** event as its own step, `Migration snapshot chain`, with no `if:`, directly
   BEFORE the forward-only guard (a red guard would skip a step after it) and before `Setup pnpm`, as `node .github/scripts/check-snapshot-chain.mjs`.
   It runs on the runner's preinstalled Node, so it uses `readdirSync` and a regex, no `fs.glob*`.
   It is the second pre-pnpm exception to "CI runs the `package.json` script", next to
   `actions:check`, and AGENTS.md says so.
5. `pnpm verify` runs it as `snapshots:check`, before `db:check`.
6. `check-snapshot-chain.test.sh` is in `guards:test`. See the Test plan.

## File-by-file changes

| Path                                           | Change | What                                                                                                                                                                                                                                                                            |
| ---------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/scripts/check-snapshot-chain.mjs`     | NEW    | Acceptance 1–3. No dependencies. Header: the #139 history moved from `ci.yml:156-165`, the gap rule, the exit codes.                                                                                                                                                            |
| `.github/scripts/check-snapshot-chain.test.sh` | NEW    | The Test plan's cases, on small synthetic `{id, prevId}` files written with `node` (no `jq`), plus one copy of the real `meta/` for "clean". The `expect` harness copies `check-audit.test.sh`'s.                                                                               |
| `.github/workflows/ci.yml`                     | EDIT   | New step (Acceptance 4). The guard loses the loop (`:155-178`), `CHAIN_BAD` and its message (`:185-198`); its comments at `:121-124`, its OK line (`:181`) and its `::error::` line (`:239`) stop naming the chain. The DB step's comment at `:423-426` points at the new step. |
| `package.json`                                 | EDIT   | `snapshots:check`; in `verify:run` before `db:check`; the self-test in `guards:test`.                                                                                                                                                                                           |
| `AGENTS.md`                                    | EDIT   | The `verify` gate list, the CI checks list, the DB section's `CI gates:` line (`:456`), and the sentence naming the pre-pnpm exceptions.                                                                                                                                        |
| `.claude/skills/debug-ci-failure/SKILL.md`     | EDIT   | A row for the new step: `pnpm snapshots:check`.                                                                                                                                                                                                                                 |
| `.claude/skills/db-migration/SKILL.md`         | EDIT   | "CI adds" names `snapshots:check` and points at AGENTS.md for where it runs, instead of listing the chain under the forward-only guard.                                                                                                                                         |
| `docs/lessons.md`                              | EDIT   | The #139 entry's "Now CI-enforced" line names `snapshots:check` and points at AGENTS.md.                                                                                                                                                                                        |
| `docs/tech-debt.md`                            | EDIT   | The #711 entry's ⚠️ line ("only the inline chain check … on PRs only") becomes a dated line pointing here. No new entry.                                                                                                                                                        |
| `docs/changelog/<date>-<branch>.md`            | NEW    | Fragment.                                                                                                                                                                                                                                                                       |

## Test plan

`check-snapshot-chain.test.sh`, each case asserting the exit code and a literal line:

| Case                                         | Exit | Asserts                                                               |
| -------------------------------------------- | ---- | --------------------------------------------------------------------- |
| the real `meta/` (with the 0018 gap)         | 0    | the OK line                                                           |
| a synthetic gap (0000, 0001, 0003)           | 0    | the OK line                                                           |
| a broken link                                | 1    | the file and both ids                                                 |
| a self-reference on **0000**                 | 1    | `prevId === id (self-referential)`; only this check can fail it there |
| the #139 shape (a later file, `prevId = id`) | 1    | both lines, two asserts                                               |
| no snapshots                                 | 2    | the "cannot check" line                                               |
| a bad name (`00010_snapshot.json`)           | 2    | the name                                                              |
| malformed JSON; a `null` body; a missing id  | 2    | the file                                                              |

RED probes, run and linked in the PR body (not acceptance items): `pnpm probe` mutating the
self-reference comparison to never match (`--expect "✗ a self-reference on 0000"`), and the
zero-snapshot refusal to exit 0 (`--expect "✗ no snapshots"`).

## Alternatives rejected

- **A vitest scanner test in `packages/db/scripts/`** (scope S1). It would run in `pnpm test` on every
  event, in `pnpm verify` and on pre-push, with no new gate name. Rejected: it runs after install,
  format, lint and typecheck, so an earlier red step hides it, which is the case that matters for a
  break that surfaces in a later PR. The forward-only guard runs before install for that reason
  (`ci.yml:101-103`), and two lenses asked to keep that placement.
- **Leave the loop inline and drop the `if:` for the chain only.** No self-test, and no local run.
- **Run the base's copy of the script on a PR**, so a PR cannot weaken it (security). Rejected: the
  repo accepts that a PR runs its own copy of every script (`ci.yml:320-324`). Risks says an edit to
  the script or its test needs a reviewer's scrutiny.
- **Rely on `drizzle-kit check`.** It passes the self-reference.

## Risks / rollback

- **An edit to the script, its self-test or `snapshots:check` in the same PR** can weaken the check.
  Nothing stops it; a reviewer has to look. Same residual as every guard here.
- **A false red on `main`:** the chain is intact (the loop and `drizzle-kit check` both pass on main,
  and the correctness lens walked it 0000 → 0017 → 0019 → 0032). The gap rule is what keeps it so.
- Rollback: revert the PR. The guard's other checks (immutability, journal append-only, time order)
  need the base and do not move.

## Out of scope

- **The journal time-order check** (`ci.yml:149-153`). It is HEAD-only too, but it was not assigned.
- **Cross-checking snapshots against the journal** (security S4): a deleted or orphaned snapshot
  still links cleanly. Not assigned, and the existing 0018 gap shows a missing snapshot does not
  break drizzle, which diffs only the latest. Recorded here, not as a tech-debt entry.

## Review-response log

_Approved (maintainer, 2026-11-19, relayed by the board): both deviations from the brief accepted, a
pre-install step and no new tech-debt entry._

### Engineering panel (round 1)

> Models: correctness, scope, reuse, security: opus.
> _Roadmap alignment (2026-11-19): no `docs/plan.md` row owns migration-metadata checks
> (`git grep -in "snapshot\|prevId" -- docs/plan.md docs/roadmap.md` finds only history); checked
> against the private roadmap, nothing to add. No roadmap item moves._

| #   | Lens                                                  | Critique (short)                                                                                                                | Verdict      | Resolution                                                                                                                                                      |
| --- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | correctness S1, security S3                           | A mid-chain self-reference also trips the link check, so it cannot fail alone                                                   | **accepted** | Planted on 0000; the #139 case asserts both lines.                                                                                                              |
| 2   | correctness S2, scope N2                              | "Dangling prevId" is the same branch as "broken link"                                                                           | **accepted** | Dropped.                                                                                                                                                        |
| 3   | correctness S3, security S4                           | Main has no 0018 snapshot; a contiguity rule would turn main red                                                                | **accepted** | Acceptance 2, the header, and a gap case.                                                                                                                       |
| 4   | correctness S4, security N2                           | The glob hides bad names, so the refusal can never fire                                                                         | **accepted** | Lists every `*_snapshot.json`; 4-digit names only; a case.                                                                                                      |
| 5   | correctness S5, security S1/S2, reuse S1              | Late in the DB step it is hidden by earlier failures, and `node` there breaks the one-definition rule                           | **accepted** | Its own pre-pnpm step, the second named exception; `readdirSync`, no glob.                                                                                      |
| 6   | correctness S6, reuse S2/S3/S4, scope S4, security N4 | Stale texts: ci.yml :121-124/:181/:239/:423-426, tech-debt, debug-ci-failure                                                    | **accepted** | All in the file table.                                                                                                                                          |
| 7   | scope S1                                              | A vitest scanner test is smaller and also runs on pre-push                                                                      | **rejected** | Hidden behind earlier failures; see Alternatives.                                                                                                               |
| 8   | scope S2                                              | The Goal overstated what the push run catches                                                                                   | **accepted** | Rewritten.                                                                                                                                                      |
| 9   | scope S3, reuse S3                                    | A new tech-debt entry opened and closed in one PR is ceremony                                                                   | **accepted** | Anchored on the #711 entry; its ⚠️ line is updated.                                                                                                             |
| 10  | security S4                                           | No snapshot ↔ journal cross-check                                                                                               | **deferred** | Out of scope with the reason.                                                                                                                                   |
| 11  | security (question)                                   | A PR can weaken its own copy of the script                                                                                      | **rejected** | Repo-accepted residual; Risks says so.                                                                                                                          |
| 12  | correctness N7, security N1                           | Exit-code precedence; a crash exits 1 as "broken"                                                                               | **accepted** | Read all first; a top-level catch exits 2; a `null` case.                                                                                                       |
| 13  | security N3                                           | File content reaches the log and could inject a workflow command                                                                | **accepted** | `JSON.stringify` and one fixed `::error::` line.                                                                                                                |
| 14  | correctness N8                                        | Copying the 2.6 MB tree per case; `jq` in local runs                                                                            | **accepted** | Synthetic files written with `node`; one real copy.                                                                                                             |
| 15  | reuse N5, N6, N7; scope N3, N4, N5                    | Restated gate locations; AGENTS :456; the mirror clause; the probe as an acceptance item; the time-order option; template shape | **accepted** | Pointers to AGENTS.md; :456 added; clause dropped; probes in the PR body; time order out of scope with no entry; Test plan section added; no "Where this sits". |
| 16  | scope N1                                              | Exit 2 is YAGNI for a tree-only check                                                                                           | **rejected** | It keeps "could not check" from reading as "broken", the repo's audit rule; both exit codes fail CI.                                                            |

### Implementation review (#724)

| #   | Lens        | Critique (short)                                                       | Verdict      | Resolution                                                                    |
| --- | ----------- | ---------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------- |
| R1  | correctness | No case pins the string-`prevId` refusal, or a non-string `id`         | **accepted** | Two cases.                                                                    |
| R2  | correctness | The injection case passed even if the script crashed                   | **accepted** | It asserts exit 1 and the escaped value too.                                  |
| R3  | correctness | Acceptance 4 said "after the guard"; the step is before it, rightly    | **accepted** | Acceptance 4 reworded. Acceptance 3 says the repair text gained the gap rule. |
| R4  | correctness | The self-reference line names no id                                    | **accepted** | It prints the id.                                                             |
| R5  | correctness | The db-migration skill's sentence was split by the pointer             | **accepted** | The pointer is its own sentence.                                              |
| R6  | correctness | No local case catches a missing sort (APFS lists in order)             | **accepted** | A comment in the test: the real-`meta/` case on the Linux runner catches it.  |
| R7  | correctness | The ci.yml pre-pnpm list omitted the catalog records step (since #531) | **accepted** | Added.                                                                        |
