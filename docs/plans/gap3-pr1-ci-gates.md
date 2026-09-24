# GAP-3 PR 1 — wire the two missing DB CI gates

> Backlog: [plan.md](../plan.md) → GAP-3. Parent plan:
> [gap3-typed-measurements.md](./gap3-typed-measurements.md) §7.6a, where this is **PR 1 of 6**.
> Audit that found the gap: [tech-debt.md](../tech-debt.md) · corrected in #132.
> **Two PRs, merged in order** — 1a then 1b, each verified green on `main` before the next.

## Goal

AGENTS.md has claimed for months that CI enforces a **forward-only migration guard** and **Squawk**. It
enforces neither — audited 2026-09-23, verified against `.github/workflows/`. The rules were written as
the intended end state and never re-verified, and because the drift guard and `db:verify` _are_ real, the
DB section reads as covered at a glance.

This was tolerable while every migration was additive and single-author. **GAP-3 ends that.** Its arc
finishes by dropping `weight_num` — a column with live data in every logged set — and nothing in CI would
stop that landing beside app code. That is why this is **PR 1** rather than a follow-on: it gates the
destructive end of the arc rather than trailing it.

## Acceptance

**1a — forward-only guard**

- A PR that **modifies or deletes** an existing `packages/db/migrations/*.sql` fails, naming the file.
- A PR that **adds** a new one passes.
- A PR that touches `packages/db/migrations/meta/_journal.json` or a `*_snapshot.json` **passes** — those
  are legitimately rewritten by `drizzle-kit generate` on every new migration (see Risks).
- The check is a no-op on pushes to `main` (there is no base to diff against).

**1b — Squawk**

- Squawk lints the migration SQL and fails on the rules AGENTS.md already names.
- **Existing migrations on `main` must pass, or the gate ships with an explicit, documented baseline** —
  a gate that is red on arrival gets disabled, not fixed.

## The trap that decides 1a's implementation

`packages/db/migrations/` contains **both** the reviewed artifacts and drizzle's bookkeeping:

```
packages/db/migrations/
  0000_busy_lockheed.sql … 0009_illegal_sabretooth.sql   ← forward-only applies to THESE
  meta/_journal.json                                      ← REWRITTEN on every generate
  meta/0000_snapshot.json …                               ← REWRITTEN on every generate
```

A guard globbing `packages/db/migrations/**` would fail **every** DB PR, because `_journal.json` is
modified whenever a migration is added. **Scope to `packages/db/migrations/*.sql`.** This is the single
most likely way to get this wrong, and it would look like the guard working — it fails loudly on exactly
the PRs it is supposed to allow.

Second trap, and it has a clean answer already in the repo: `actions/checkout@v7` is configured with
**no `fetch-depth`**, so the clone is shallow and a `git diff` against the base ref has nothing to compare
against — a guard that silently always passes, which is worse than no guard and is precisely the failure
this PR exists to correct.

**Use the repo's existing idiom instead of `git diff`.** The e2e auto-skip already solves this class of
problem with `actions/github-script` + `github.rest.pulls.listFiles` (`ci.yml:101-145`), and that API
returns each file's **`status`** — `added` · `modified` · `removed` · `renamed`. That is exactly the
signal the forward-only guard needs, it sidesteps `fetch-depth` entirely, and it matches a pattern already
reviewed and running here. Reuse it rather than inventing a git-based check.

Its "default to RUN" comment is worth copying too: the e2e guard skips only if there is **at least one**
file and every one is inert, so an empty list fails safe. The forward-only guard should fail safe the same
way — an empty or errored file list must not read as "nothing was modified".

## Sequencing

|        | PR                 | Why this order                                                                                                                                                             |
| ------ | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1a** | Forward-only guard | Cheapest, no new dependency, and the one that protects against an _edit_ to applied history — which is unrecoverable in a way a bad new migration is not.                  |
| **1b** | Squawk             | Adds a dependency and a config, and its risk is unknown until it is run against the existing ten migrations. If it fails them, 1b changes shape and 1a is still delivered. |

Merged in order, each confirmed green on `main` before the next — Ray's constraint, and the right one for
CI changes, where the only real test is trunk.

## Risks

| Risk                                                              | Mitigation                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The guard fails every DB PR via `meta/_journal.json`              | Scope to `*.sql`. Verified empirically against real history before merge.                                                                                                                                                                         |
| Shallow clone makes the diff empty → guard silently passes always | Fetch the base ref explicitly; assert the diff command returned something meaningful rather than trusting an empty result. **A guard that can never fail is worse than none** — it is the exact failure this whole PR exists to correct.          |
| Squawk fails the ten existing migrations                          | Investigated **before** wiring. If drizzle-generated SQL cannot satisfy Squawk's defaults (no `lock_timeout`, no `CONCURRENTLY`), the config is narrowed to the rules AGENTS.md actually names, and the gap is recorded rather than papered over. |
| A legitimate emergency needs an applied migration edited          | Branch-protection admin merge, as with the `e2e` gate. Documented, not silently possible.                                                                                                                                                         |

## Out of scope

**CodeQL** and **`pnpm audit`** — also claimed by AGENTS.md, also absent, but neither gates GAP-3. Filed
in tech-debt; separate PRs.

## Review-response log

Two investigation agents ran **before** implementation, following the repo's panel process. Both
findings were re-verified against the tree and against real history before being accepted.

### Forward-only (1a)

| Finding                                                                                                                                                                                                                                                                                          | Response                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`git diff` + `fetch-depth: 0` beats the `github-script` approach I had drafted**, and for a reason I had not considered: the `meta/_journal.json` exclusion is a **hole**. The journal's `tag` maps 1:1 to a migration filename, so excluding it lets an applied migration's tag be rewritten. | **Accepted — my draft shipped that hole.** The journal is now excluded from the _path_ check and verified **append-only** instead (`.entries` at base must be an exact prefix of head's). Proven: rewriting `entries[0].tag` fails the guard.                                                 |
| Put it in the **`quality` job**, not its own job.                                                                                                                                                                                                                                                | **Accepted, and it matters more than it looks.** A new job is not a required check until branch protection is edited — so a separate job would have _looked_ wired while blocking nothing, which is the exact failure this PR exists to fix. In `quality` it blocks immediately.              |
| `--no-renames`, because a rename reports as `R100` and could be mis-paired with a genuinely new migration.                                                                                                                                                                                       | **Accepted.** Forcing `D`+`A` trips the `D`. Verified: renaming `0007` fails.                                                                                                                                                                                                                 |
| `if: github.event_name == 'pull_request'` — on push to `main` the violation is already merged, and `github.event.before` is all-zeros on force-push, which would crash rather than protect.                                                                                                      | **Accepted.**                                                                                                                                                                                                                                                                                 |
| `fetch-depth: 0` is required — a shallow checkout gives `fatal: Invalid symmetric difference expression`, and even a targeted `--depth=1` fetch fails with `no merge base`.                                                                                                                      | **Accepted**; `gitleaks` already uses it on this 8.7MB repo, so it is precedent rather than new cost.                                                                                                                                                                                         |
| **Unresolved:** a drizzle-kit major that rewrites old `meta/*_snapshot.json` would trip the guard with no escape.                                                                                                                                                                                | **Accepted as a known gap, deliberately not solved here.** A `ci-allow-migration-edit` label (mirroring `ci-skip-e2e`) is the fix if it ever bites; note the existing drift guard would fail in that scenario too, so the guard is not the only thing to fix. Recorded rather than pre-built. |

**Verified independently before commit**, not taken on the agent's word: all **10** historical
migration commits PASS (zero false positives), and the three tamper cases — modify, rename, journal-tag
rewrite — each FAIL.

### Squawk (1b)

| Finding                                                                                                                                                                                                                     | Response                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The drizzle tension I worried about is not real.** All 10 migrations already hand-add `SET lock_timeout` / `statement_timeout`, so `require-statement-timeout` passes everywhere — this repo edits generated SQL by hand. | **Accepted; my concern was wrong.** Verified: 10 of 10 files contain `lock_timeout`. Squawk does **not** blanket-fail drizzle output.                                                                                                                                                                                                                                                                          |
| `--assume-in-transaction` is load-bearing: 188 findings → 33. Drizzle's migrator wraps each file in a transaction, so without the flag `prefer-robust-stmts` fires 99 times spuriously.                                     | **Accepted.**                                                                                                                                                                                                                                                                                                                                                                                                  |
| Scope to **files added in the PR**, not all files — 20 residual findings remain on `main` and Squawk has no baseline feature.                                                                                               | **Accepted.** Forward-only (1a) makes migrations add-only, so "changed" is exactly "new" — the two gates compose.                                                                                                                                                                                                                                                                                              |
| `require-concurrent-index-creation` must be excluded: `CONCURRENTLY` cannot run inside drizzle's transaction, and the transaction-stripping runner AGENTS.md describes **does not exist**.                                  | **Accepted, and the residual gap recorded** — Squawk will not enforce the `CONCURRENTLY` rule. That is a real hole this PR does not close.                                                                                                                                                                                                                                                                     |
| **Convention consequence:** new migrations must split `NOT VALID` and `VALIDATE` across separate PRs, or Squawk flags them.                                                                                                 | **Accepted, and the repo already agrees** — `0009`'s own comment reaches the same conclusion independently: splitting them inside one file "would … be inside one transaction, which buys nothing." Must be stated in AGENTS.md or the first new migration goes red and someone reaches for an exclusion.                                                                                                      |
| The existing `constraint-missing-not-valid` findings on 0001/0003/0005 and the bare `CHECK`s in 0008/0009.                                                                                                                  | **Accepted as findings, pushed back on the framing.** These are **not** latent bugs: `0009` names Squawk explicitly and justifies the exception — the column was created in the same statement, so every existing row is NULL and the validating scan "reads rows that cannot fail, on a table of a few dozen". Deliberate and documented, which is why changed-files-only scope is right rather than a dodge. |
