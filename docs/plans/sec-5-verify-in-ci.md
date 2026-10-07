# SEC-5 — `pnpm audit --prod` becomes a CI gate

> Backlog: [docs/plan.md](../plan.md) → **SEC-5**. Branch: `chore/sec-5-audit-in-ci`.
> Owning feature guides: none — no guide claims `.github/**` (checked).

## Revised 2026-10-06 — what five panels changed

The first draft (merged as #237, plan-only) was reviewed by a security lens and then by the four
standing lenses. **It was not ready.** The panels found a permanent-green bypass, a dead leniency
branch the revision itself introduced, and three design claims that did not survive measurement.
Every finding and its verdict is in § "Review-response log"; the three that reshaped the plan:

1. **The gate could be switched off by one line of committed config** — and the coherence check that
   detects it returned the one exit code the leniency path discarded. Reproduced end to end.
2. **Scope.** The backlog row asks for _one_ thing: a step in `ci.yml`'s `quality` job. The draft also
   built a daily workflow and a 90-day expiring allowlist — **60% of the guard and 17 of its 26 test
   cases, for a file that ships empty.** Both are now their own rows (**SEC-5b**, **SEC-5c**).
3. **Enumerating hostile config keys is unwinnable.** The draft named two; four more were measured,
   and the real surface is the audit command's whole rc list. Four _generic_ rules replace the
   blocklist and cover more (§ "Decision 5").

Net effect: **~120 implementation lines instead of ~450**, and the gate closes all four historical
accidents on the first merge.

## Goal

**What's broken.** `pnpm audit --prod --audit-level high` lives inside `pnpm verify`
(`package.json:25`) and **no workflow runs `pnpm verify`**, so an advisory reaches `main` with CI
fully green. That is not a theory: it has happened **four times** and all four were found by accident.

| Advisory                                                       | Severity            | In `--prod`?                                     | How it was actually caught                                                                                        |
| -------------------------------------------------------------- | ------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| GHSA-vcvr-r3jv-pc5j (`next` RCE)                               | critical            | yes                                              | a local `verify` during unrelated work, 2026-09-30 (#182)                                                         |
| GHSA-68fv-2mgg-jv7q (`source-map-js` DoS)                      | high                | yes                                              | a local `verify` during unrelated **docs** work, 2026-10-06 (#222)                                                |
| GHSA-hrr3-gc8f-f4qj (`fast-uri`) + a **critical** `proxy-addr` | moderate / critical | `fast-uri` yes; `proxy-addr` dev-only            | a sweep during unrelated work, 2026-10-06 (#227)                                                                  |
| GHSA-wq5f-xc86-pv6w (`sharp` → librsvg)                        | high                | yes (`next > sharp`, and under `@sentry/nextjs`) | unrelated **feature** work, 2026-10-06 (#235) — [fragment](../changelog/2026-10-06-fix-deps-sharp-librsvg.md):1-8 |

Four accidents in five weeks. `tech-debt.md:496` draws the conclusion: **"the gap is the gate, not the
advisories."** Each previous fix patched the advisory. This one patches the gate.

## Acceptance

Each is stated so a test can fail it.

1. **A `high` or `critical` advisory in the `--prod` tree fails `quality`**, naming the package, the
   GHSA and the path it is reached by.
2. **The guard never passes when it could not check.** An unparseable report, an incoherent one, or a
   missing lockfile exits non-zero and is **never** downgraded to advisory.
3. **A registry outage does not red a PR that changes no dependency input** — and this is proved by a
   test against pnpm's real outage bytes, not an invented string (the first draft's was unreachable).
4. **`pnpm audit:check` is the single definition**, run identically by `pnpm verify` and by `quality`.
5. The self-test covers every classifier branch, including each vacuity case.

## Decision 1 — a step in `quality`, and nothing else in this PR

`ci.yml`'s `quality` job already installs (`:250-251`), so the audit is a step, not a job: a fourth
job would re-checkout and re-install for ~20s of work, and the `review-pr` shipit bar reads `quality`.

**The daily workflow is deferred to SEC-5b.** The backlog row asks for the `quality` step only, and
the cron's value is unproven in the one way that matters: **nobody has confirmed a failed scheduled
run reaches a human** (it was precondition P4 of the draft, still open, with the fallback "check the
Actions tab in the weekly session"). `dependabot.yml:11-16` already opens PRs on security advisories,
so an untouched dependency is not unwatched. SEC-5b wires the cron **after** forcing one failure and
confirming the notification arrives — which is the right order, and was the draft's own Open question 1.

## Decision 2 — what fails the build

**`high` and `critical`, on the `--prod` tree only.**

- **Why `high`, not `moderate`:** it is the bar `pnpm verify` already sets and the bar
  `tech-debt.md:301` already claims. This PR wires a claimed gate; it does not also raise it.
- **Why `--prod`, not the whole tree:** the whole tree **cannot** pass today. `braces@3.0.3` is a high
  whose advisory names `>=3.0.4` as patched and **that version has never been released**;
  `esbuild@0.18.20` is a moderate pinned inside `drizzle-kit`; `@modelcontextprotocol/sdk` is a high
  (GHSA-6qxp-vccf-f47h, new 2026-10-06). All three are dev-only and `audit --prod` is clean of them.
  Gating the full tree at `high` would wedge `main` on day one with no edit that unwedges it.
  ⚠️ `tech-debt.md:482-489` still records **two** dev findings; there are now three. Fix in this PR.

### The `braces` wedge is historical fact, and it is why SEC-5c exists

`braces` is out of `--prod` scope **today** — but it was _in_ scope until 2026-10-03, when moving
`shadcn` to devDependencies cleared it. So this repo really did hold an unfixable `high` in its
production tree for some days. The escape used then (re-classify as dev) was a genuine fix, but it
took an afternoon of reasoning about whether `@import 'shadcn/tailwind.css'` is a runtime import, and
it is not always available. The generalisable lesson is in
[the sweep fragment](../changelog/2026-10-06-fix-deps-audit-sweep.md):9-10: _"before trusting a
'patched versions' field: in-range is not the same as published."_

## Decision 3 — no allowlist in this PR; the escape is fix, reclassify, or merge red

The draft built a JSON allowlist with eleven validation rules and a 90-day expiry. It **ships empty**
(`audit --prod` is clean: 0 advisories over 409 prod deps), so it is dead code until the first
emergency — and it was **60% of the guard and 17 of 26 test cases**.

**Deferred to SEC-5c, built the first time an unfixable `--prod` high actually appears.** Until then
the escape hatch is: fix it, re-classify it to dev if that is honest, or **merge red**, which
`AGENTS.md:331-333` already permits because no check is required. The draft's own V11 reasoning
already conceded this for criticals — _"a critical is fixed, or the maintainer merges red"_ — and it
is hard to argue merge-red is unacceptable for an unfixable high for the days it takes to write
SEC-5c, when it is the accepted answer for a critical forever.

**The residual, stated plainly:** if an unfixable `--prod` high lands before SEC-5c, every PR goes red
until it is fixed, reclassified, or merged red. That is a real cost. It is smaller than shipping, and
having to maintain, a suppression mechanism for a situation the repo is not in — and the four
accidents this gate exists to catch were all _fixable_, every one cleared by a bump or a
re-classification.

## Decision 4 — `skills:check` and `guards:test` stay with DX-5(b), with one carve-out

`AGENTS.md:317-318` says wiring them in _"is a CI change that needs its own plan"_, and that plan is
already a row. **SEC-5 delivers the audit third only.** `guards:test` is seven bash suites that have
never run on ubuntu (bash 3.2 vs 5, BSD vs GNU `sed`/`grep`/`mktemp`, `gh` stubbing), and debugging
seven of them is unbounded cost inside a PR about the audit gate.

**The carve-out:** `check-audit.test.sh` runs as its own step in `quality`. Shipping a guard whose
self-test only runs locally would reproduce, in the same PR, the smell `plan.md:621` records about
SEC-2. It also goes into `guards:test` so it rides the local loop.

⚠️ **Noted for DX-5(b):** when it wires `guards:test` into CI this step becomes redundant and should be
deleted. Its sibling `check-action-pins.test.sh` is offline, fixture-only and ~1s, so DX-5(b) could
reasonably take it too — deliberately **not** done here, to keep this PR to one concern.

## Decision 5 — the exit-code contract, and why four generic rules beat a blocklist

This is the heart of the revision. The draft tried to enumerate config keys that disarm the audit. The
surface turned out to be the audit command's whole rc list, because project settings bypass pnpm's
`isConfigFileKey` filter entirely — `addSettingsFromWorkspaceManifestToConfig` copies **every**
camelCase key from `pnpm-workspace.yaml` into config with no whitelist. Measured (§ "Measured facts"),
each as one appended line, with the guard's own argv:

| line in `pnpm-workspace.yaml` | exit | what the guard would see                             |
| ----------------------------- | ---- | ---------------------------------------------------- |
| `auditLevel: critical`        | 0    | valid JSON, counts intact, advisory list **emptied** |
| `auditConfig.ignoreGhsas`     | 0    | same shape                                           |
| `ignoreUnfixable: true`       | 0    | **not JSON**                                         |
| `ignore: ['GHSA-…']`          | 0    | **not JSON**                                         |
| `fix: true`                   | 0    | **not JSON** (and it rewrites the lockfile)          |

A blocklist loses this race permanently — the next pnpm minor adds a key. **Four rules cover the whole
class by shape:**

1. **Classify pnpm's error envelope first.** `--json` failures are `{"error":{"code","message"}}`.
   Retryable (`code:"pnpm"` with `/fetch failed|ENOTFOUND|ETIMEDOUT/`, `ERR_PNPM_AUDIT_BAD_RESPONSE`)
   → **exit 2**. Not retryable (`ERR_PNPM_AUDIT_NO_LOCKFILE`) → **exit 3**.
2. **Parse failure → exit 3.** This catches `ignore`, `ignoreUnfixable` and `fix` generically, with no
   keyword list, because all three emit prose instead of JSON.
3. **Per-severity exact equality** between `metadata.vulnerabilities` and the list-derived counts
   catches `ignoreGhsas`, which emits valid JSON with the counts intact and the list emptied.
4. **`--audit-level info` on the CLI** neutralises `auditLevel`, because a CLI flag beats the config
   file. This flag is load-bearing in a second way: `AUDIT_LEVEL_NUMBER` filters the advisory **list**
   and not `metadata`, so dropping it makes rule 3 fail on any `info` advisory — i.e. **exit 3 on
   every run**. The self-test therefore asserts the argv.

**Exit 2 is the only lenient code, and it is reachable only from rule 1's retryable set.** The draft
collapsed every could-not-check cause into 2 and then downgraded them together, which is the bypass.
Its revision then over-corrected: "no `metadata` → exit 3" also matches a real outage, which made the
lenient branch **dead code** and would have redded every PR during an npm incident. Rule 1 exists to
separate those two, and only that.

⚠️ **The 0/1/2/3 contract deliberately extends `check-action-pins.mjs:24`'s 0/1/2.** That guard's exit
2 is a **union** — API unreachable _and_ nothing-scanned — which is safe only because its caller has
no leniency path. This PR adds two lines to its header saying so, because the next person to add
leniency there would otherwise inherit exactly the bypass above.

## File-by-file changes

| Path                                                       | Change            | What & why                                                                                                                                                                                                                                           |
| ---------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/scripts/check-audit.mjs`                          | **NEW** (~90)     | Runs the audit, classifies the result, applies the threshold. The single definition.                                                                                                                                                                 |
| `.github/scripts/check-audit.test.sh`                      | **NEW** (~70)     | Offline self-test over crafted reports + an argv assertion. Every classifier branch.                                                                                                                                                                 |
| `.github/workflows/ci.yml`                                 | EDIT (+~20)       | Two steps in `quality`: the self-test **before** the install (§ placement), the audit after it.                                                                                                                                                      |
| `package.json`                                             | EDIT (3 lines)    | New `audit:check`; `verify` (`:25`) swaps `pnpm audit --prod --audit-level high` → `pnpm audit:check`; `guards:test` (`:31`) gains the self-test.                                                                                                    |
| `.github/scripts/check-action-pins.mjs`                    | EDIT (+2 comment) | Record that its exit 2 is a union, safe only while its caller has no leniency (§ Decision 5).                                                                                                                                                        |
| `AGENTS.md`                                                | EDIT (~12)        | `audit --prod` → `audit:check`; the audit joins the CI gate list; **delete the ⚠️ "`audit --prod` is NOT a CI gate" paragraph** — leaving it is how `tech-debt.md:116-118`'s class of lie starts.                                                    |
| `.github/SECURITY.md`                                      | EDIT (~6)         | `:87`'s bare _"`pnpm audit` gate"_ becomes **the one statement of the rule** (scope, threshold, trigger), in the style of `:88-91`. The guard header then _points_ at it rather than restating it — the SEC-2 precedent (`check-action-pins.mjs:3`). |
| `docs/tech-debt.md`                                        | EDIT (~12)        | Flip the `pnpm audit` row (`:301`) to ✅ wired. **Fix the wrong `braces` GHSA at `:482`** (`GHSA-v6h2-p8h4-qcjw` → `GHSA-vfj7-8cjw-p6xm`). Record that the dev tree now holds **three** findings, not two. Update `:251`'s `verify` step list.       |
| `docs/working-with-agents.md`                              | EDIT (1 line)     | `:50` says of five once-unwired gates _"The other two are still unwired"_ — one of those two **is** `pnpm audit`. False on merge, in the document that teaches this exact lesson.                                                                    |
| `docs/plan.md`                                             | EDIT              | SEC-5 → shipped; `:528`'s "twice" → **"four times"**; narrow DX-5(b); **reconcile `:760`**, where AUDIT-1 row 5 still carries this work as `chore/ci-1-audit-in-ci` · _"plan-exempt one-liner (say so)"_. File **SEC-5b** and **SEC-5c** rows.       |
| `docs/status.md`, `docs/roadmap.md`                        | EDIT              | Pointer + Platform's next. Cite by **heading, not line** — other lanes are editing these files in this session.                                                                                                                                      |
| `.claude/skills/ship-pr/SKILL.md`, `hold-the-bar/SKILL.md` | EDIT (2 lines)    | Both describe `verify`'s step list including `audit --prod`; update the names.                                                                                                                                                                       |
| `docs/changelog/2026-10-XX-chore-sec-5-audit-in-ci.md`     | **NEW** (~8)      | One fragment.                                                                                                                                                                                                                                        |

No `.github/audit-allowlist.json`, no `audit.yml`, no `hold-the-bar` regex change — all three belong
to SEC-5c / SEC-5b.

### `.github/scripts/check-audit.mjs`

Header is a **pointer** to `SECURITY.md`'s statement of the rule plus the mechanics, following
`check-action-pins.mjs:3`. Resolve any path from `import.meta.url`, never cwd, so `pnpm audit:check`
works from a workspace subdirectory (`check-action-pins.mjs:47` is the precedent).

```
Usage: node .github/scripts/check-audit.mjs [--report <file>|-]
Exit: 0 clean · 1 a blocking advisory · 2 could not check, RETRYABLE (registry unreachable)
      · 3 could not check, NOT retryable (unparseable/incoherent report, no lockfile)
```

One const block, read by every rule below, so the vocabulary is defined once (the draft wrote it four
times):

```js
const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical']; // pnpm's isKnownSeverity set
const BLOCKING = new Set(['high', 'critical']);
```

It must **not** import from `packages/shared`: `pnpm verify` runs it post-install, but a guard in
`.github/scripts/` is expected to run with no `node_modules` (`ci.yml:233-239` runs its siblings
pre-install), and SEC-5b's workflow will have no install step at all.

1. **Spawn** `pnpm audit --prod --json --audit-level info`. ⚠️ **Do not read the exit code** — `pnpm
audit` exits non-zero whenever it finds anything, so non-zero is the normal case; the verdict is
   stdout. `execFileSync`, `encoding: 'utf8'`, generous `maxBuffer`, read `e.stdout` from the throw.
   The timeout must exceed pnpm's own retry budget (`fetchRetries` × `fetchRetryMaxtimeout`) or the
   likeliest outage shape is a signal kill with empty stdout; **empty stdout → exit 2** (treat a kill
   as retryable), and say so in the header.
2. **Classify an error envelope** (`{"error":{"code","message"}}`) **before anything else** — rule 1
   of Decision 5. Unknown `code` → exit 3, because an unrecognised failure is not a known-retryable one.
3. **Parse.** Failure → exit 3.
4. **Coherence, all → exit 3.** No `metadata.vulnerabilities`; a severity key set that is not exactly
   `SEVERITIES` with finite numbers; any advisory `severity` outside it; per-severity counts not
   **exactly** equal to the list-derived counts; `metadata.dependencies` not > 0 (_"a guard that checked
   nothing must not pass"_, `check-action-pins.mjs:56-60`).
   ⚠️ **Not** `devDependencies === 0` and **not** a `totalDependencies` floor: if `--prod` stopped
   excluding dev, the dev tree's unfixable `braces` high would red every PR already — maximally loud —
   so the assertion converts loud into loud while adding a way to wedge `main` with no escape. Both
   counts are **printed** instead.
5. **Normalise.** Identity is `github_advisory_id` — ⚠️ **not** `github_advisory_id ?? cves[0]`: pnpm's
   advisory has **no `cves` field**, and `deriveGithubAdvisoryId` returns **`""`** (not nullish) when
   the url carries no GHSA, so `??` never falls through. Fall back on `String(id)` by **emptiness**, not
   nullishness. Carry `module_name`, `severity`, `url` and the first few `findings[].paths`.
   ⚠️ `patched_versions` is **inferred by pnpm** from the vulnerable range (trailing `< x.y.z` only) and
   is `undefined` for ranges it cannot parse — so it is printed as context and **never** cited as
   evidence that a fix exists. That is this repo's own `braces` lesson.
6. **Verdict.** Any `BLOCKING` advisory → exit 1, one line each
   (`severity  package  GHSA  patched: <range>  via <path>`) plus a single-line `::error::`.
7. **Always print the counts line**, pass or fail, including `dependencies` and `devDependencies`. A
   guard that reports nothing is indistinguishable from one that ran nothing
   (`check-action-pins.mjs:159-165`).

### `.github/workflows/ci.yml`

Policy prose goes in the `# ── ... ──` banner above the step, matching every other guard step in
`quality` (`:29-41`, `:57-74`, `:176-195`, `:217-232`); only shell traps stay inline. Step names carry
no backlog id — no sibling does.

- **Self-test step goes BEFORE the install** (with the pre-install guards, before `:241`). It is bash +
  node + crafted fixtures and never spawns `pnpm`, so `ci.yml:231-232`'s rule applies verbatim: a broken
  guard then fails in ~5s instead of after install + test.
- **Audit step goes after the install** (`:250-251`) — it is the one that needs it.

```yaml
- name: Production audit (high+, --prod)
  env:
    BASE_SHA: ${{ github.event.pull_request.base.sha }}
  run: |
    deps=1
    if [ -n "$BASE_SHA" ]; then
      # Captured FIRST so a failing git diff aborts under `bash -e` rather than
      # reading as "no dependency changed" and granting leniency (ci.yml:49-50).
      # THREE-dot: base.sha is main's tip at event time, not the merge base, so a
      # two-dot diff reports files that moved on main as changed by this PR.
      # Measured: two-dot listed pnpm-lock.yaml for a branch that never touched it.
      # ci.yml:96 (forward-only) and :206 (Squawk) already use three-dot.
      changed="$(git diff --name-only "$BASE_SHA...HEAD" -- \
        pnpm-lock.yaml pnpm-workspace.yaml '*package.json' .npmrc '**/.npmrc')"
      [ -z "$changed" ] && deps=
    fi
    set +e; node .github/scripts/check-audit.mjs; code=$?; set -e
    if [ "$code" -eq 2 ] && [ -z "$deps" ]; then
      echo '::warning::pnpm audit could not reach the registry; this PR changes no dependency input, so the gate is advisory here.'
      exit 0
    fi
    exit "$code"
```

`'*package.json'` is a git pathspec where `*` crosses `/` — verified: `git ls-files -- '*package.json'`
returns all five manifests, root included. It over-matches (`foo-package.json`), and over-matching only
makes the gate **stricter**. `.npmrc` is listed although none exists today, precisely because adding
one changes the audit's inputs (it carries `registry=` and `audit-level`). `deps=1` is the default, so
any path through the `if` that fails to decide leaves the gate strict. No step-level `if:`, so this runs
on push to `main` too. ⚠️ Annotations are **single-line** — `echo` with embedded newlines annotates only
the first line and prints the rest as log noise (`ci.yml:173` is the idiom).

## Test plan

`bash .github/scripts/check-audit.test.sh` — the `expect <name> <exit> <text>` harness from
`check-action-pins.test.sh:14-24`, fixtures in `mktemp -d` under `trap 'rm -rf' EXIT`, **offline**.
Emit `::error::` on failure when `GITHUB_ACTIONS` is set: this is the first bash suite to run in a
workflow, and none of its six siblings annotates, so a failure would otherwise be a bare `✗` in the log.

**Fixtures are the measured bytes, recorded in § "Measured facts" so nobody re-derives them.**

| #   | Case                                                                                                       | Exit |
| --- | ---------------------------------------------------------------------------------------------------------- | ---- |
| 1   | clean report, counts all zero, `dependencies: 297`                                                         | 0    |
| 2   | moderate-only advisory                                                                                     | 0    |
| 3   | one `high` → names package, GHSA, patched range, path                                                      | 1    |
| 4   | one `critical`                                                                                             | 1    |
| 5   | `{"error":{"code":"pnpm","message":"fetch failed"}}` — a real outage                                       | 2    |
| 6   | empty stdout (timeout kill)                                                                                | 2    |
| 7   | `{"error":{"code":"ERR_PNPM_AUDIT_NO_LOCKFILE",…}}`                                                        | 3    |
| 8   | `{"error":{"code":"ERR_PNPM_AUDIT_BAD_RESPONSE",…}}`                                                       | 2    |
| 9   | unknown error `code`                                                                                       | 3    |
| 10  | not JSON at all (`ignoreUnfixable`/`ignore`/`fix` shape)                                                   | 3    |
| 11  | advisories present, `metadata` absent                                                                      | 3    |
| 12  | `metadata` says 1 high, advisory list empty (the `ignoreGhsas` shape)                                      | 3    |
| 13  | counts disagree by one — what exact equality catches and zero-ness does not                                | 3    |
| 14  | a severity renamed `"HIGH"` — case 12 as zero-ness would have **passed** this                              | 3    |
| 15  | `dependencies: 0`                                                                                          | 3    |
| 16  | an advisory whose `github_advisory_id` is `""` → identity falls back, still blocks                         | 1    |
| 17  | **argv assertion**: a `PATH`-shimmed fake `pnpm` records `"$@"`; assert `--prod --json --audit-level info` | 0    |

Case 17 is the one that matters most for a reason the draft never stated: dropping `--audit-level info`
flips the gate between "always red" and "quietly partial", and no report-fixture test can see it.

**Local:** `pnpm audit:check`, then `pnpm verify` end-to-end.
**CI:** both new steps, on this PR. `actions:check --resolve` fires automatically because the PR touches
`.github/workflows` (`ci.yml:39-41`).

**Negative proof the gate is real — before merge.** On a scratch branch, add a dependency with a known
high `--prod` advisory, push, and watch `quality` go red at the audit step. Without this the PR ships a
gate nobody has seen fire, which is how `tech-debt.md:288-301` collected five claimed-but-absent checks
and `lessons.md:287-290` records a _"whole feature shipped INERT with every gate green."_

## Measured facts (2026-10-06, pnpm 11.13.1, this worktree)

All of these were **measured, not read** — three of the draft's design claims were wrong and these are
the replacements. Probes ran against a copy of the lockfile + manifests outside the repo.

| What                                            | Result                                                                                                                                                                                                                                                               |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does the audit need `node_modules`?             | **No.** `loadAuditContext` = `readWantedLockfile` + `readEnvLockfile`; no `node_modules` path. (Matters for SEC-5b.)                                                                                                                                                 |
| `metadata` shape                                | `{vulnerabilities:{info,low,moderate,high,critical}, dependencies:297, devDependencies:0, optionalDependencies:112, totalDependencies:409}`                                                                                                                          |
| `pnpm audit --prod` today                       | clean — 0 advisories over 409 prod deps                                                                                                                                                                                                                              |
| Full tree today                                 | 3 findings: `esbuild` moderate, `braces` high, `@modelcontextprotocol/sdk` high                                                                                                                                                                                      |
| Per-severity exact equality available?          | **Yes.** 3 advisories / 5 paths; `metadata` and list-derived counts byte-identical. pnpm increments once per advisory, inside the per-advisory loop — paths never enter it.                                                                                          |
| A real registry outage                          | exit 1, 70 bytes: `{"error":{"code":"pnpm","message":"fetch failed"}}` — **valid JSON, no `metadata`**                                                                                                                                                               |
| `auditLevel: critical` in `pnpm-workspace.yaml` | full tree: counts `{moderate:1,high:2}`, **advisory list empty, exit 0** — the bypass                                                                                                                                                                                |
| `ignoreUnfixable: true` / `ignore: [...]`       | exit 0, **non-JSON** prose on stdout                                                                                                                                                                                                                                 |
| Why config reaches the audit at all             | **Not** via `isConfigFileKey`. `audit-level` is in **`excludedPnpmKeys`** (81 entries), not `pnpmConfigFileKeys` (67) — membership there _excludes_. Project settings bypass that filter: `addSettingsFromWorkspaceManifestToConfig` copies **every** camelCase key. |
| Two-dot vs three-dot diff                       | two-dot listed `pnpm-lock.yaml` for a branch that never touched it; three-dot listed nothing                                                                                                                                                                         |
| `git ls-files -- '*package.json'`               | all five manifests, root included                                                                                                                                                                                                                                    |
| `ignore-registry-errors` a config-file key?     | **No** — so no committed config can turn a registry error into a pass                                                                                                                                                                                                |
| `package.json` → `pnpm.auditConfig`             | **ignored** in pnpm 11 (`MIGRATED_PNPM_FIELD_KEYS`), so only `pnpm-workspace.yaml` + `.npmrc` matter — coupled to `packageManager`                                                                                                                                   |

## Risks / rollback

- **Exit 3 has no escape hatch, by design.** A future pnpm that counts per finding, renames a metadata
  field or adds a severity turns every run red with **no edit that unwedges it**. Response: merge red
  (`AGENTS.md:331-333`) and fix the guard — the same answer Decision 2 gives for a wedged tree. Named
  here because the draft's Risks table only recorded the opposite direction.
- **An unfixable `--prod` high before SEC-5c** reds every PR. See Decision 3's residual.
- **The step's own shell policy has no regression test.** It was verified by hand across all eight
  combinations of guard exit code (0/1/2/3) × dependency-change (yes/no/push-to-main), and all eight
  are correct — exit 3 never lenient, exit 2 lenient only without a dependency change, no leniency on
  `main`. But nothing guards it against a later edit, and it **fails open** if the `grep`/pathspec is
  broken. Accepted for now rather than papered over: the fix is to move the decision behind guard
  flags so the self-test reaches it, which is the filed follow-up from round 4 (A2) and round 5 (R3).
- **Rollback** is deleting two steps from `ci.yml`; nothing persists and no data is touched.

## Alternatives considered and rejected

- **`auditConfig.ignoreGhsas` as the exception mechanism** — rejected, and now actively caught. It
  leaves **no trace a guard can key on**: `metadata.vulnerabilities` is read _before_ the ignored ids
  are stripped from `advisories` and is never decremented, so it produces the same counts-say-N /
  list-empty shape as the bypass. The only human-visible trace is `(N ignored)` in the non-JSON path CI
  never reads.
- **A `ci-skip-audit` label** — rejected: _"a one-click label is the easiest possible way not to
  notice."_ ⚠️ The draft then added an `audit-allowlist-with-deps` override label, which is the same
  object; it is cut, along with the same-PR co-change check it guarded. The allowlist is a reviewed JSON
  diff in a one-maintainer repo, and that control's expected catch count is zero.
- **A fourth CI job** — rejected: re-checkout and re-install for ~20s of work.
- **`schedule:` on `ci.yml`** — rejected: it would run every job daily.
- **Gating the whole tree at `high`** — impossible today (Decision 2).

## Out-of-scope / deferred

- **SEC-5b — the daily scheduled audit.** Wired after confirming a failed scheduled run reaches a
  human. When built: no install step (measured above), `persist-credentials: false`,
  `cancel-in-progress: false` (a cancelled run notifies nobody), and the full-tree report step must go
  through the guard in a `--report-only --include-dev` mode rather than a bare `pnpm audit`, or it
  re-states the threshold **and** is subject to every config bypass in Decision 5.
- **SEC-5c — the expiring audit allowlist.** Built on first need. The draft's design is preserved in
  this plan's history (#237) and its validation rules are worth re-reading then — including that **V10
  is load-bearing for V11**: without the entry-vs-advisory severity check, an advisory re-scored to
  `critical` is still suppressed by a `high` entry.
- **DX-5(b)** — `skills:check`, `guards:test`, `status:check`.
- **DX-8** — every root `pnpm --filter` script passes when its filter matches nothing (#246). Same
  class of bug, one level below this one.

## Review-response log (adversarial panel)

Five lenses ran: **security**, then the four standing ones (correctness · scope · architecture ·
reuse). No UX panel — nothing user-facing. Every BLOCKING finding was **re-verified against pnpm
11.13.1's own bundle or the live tree before being accepted**; the measurements are in § "Measured
facts", not taken on any lens's word. Two claims did not survive that check and are recorded as such.

### Round 1 — security / supply-chain

| #   | Critique                                                                                            | Verdict                                                           | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Exit-2 leniency swallows the anti-vacuity verdict; one config line makes the gate permanently green | **accepted**                                                      | Reproduced end to end. Exit codes split (Decision 5). ⚠️ The first fix was itself wrong — see C1.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| B2  | Zero-ness is weaker than needed and its justification is false                                      | **accepted**                                                      | Measured: pnpm counts per advisory, not per path. Per-severity exact equality + a vocabulary assertion.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| B3  | No input-vacuity check                                                                              | **partly**                                                        | `dependencies > 0` kept. `devDependencies === 0` and a `totalDependencies` floor **rejected** — see S4.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| S4  | An entry can land in the same PR as the dependency it excuses                                       | **rejected**                                                      | Moot: the allowlist is deferred (SEC-5c). The control it proposed was also cut — see Sc3.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| S5  | `critical` is suppressible                                                                          | **deferred**                                                      | Becomes SEC-5c's V11, with V10 noted as load-bearing for it.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| S6  | `.npmrc` is a dependency input the pathspec misses                                                  | **accepted**                                                      | `.npmrc`, `**/.npmrc` added. The **registry assertion** was accepted then **reverted** — see C8.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| S7  | The one worked allowlist example carries a GHSA that matches nothing                                | **accepted**                                                      | `GHSA-v6h2-p8h4-qcjw` → `GHSA-vfj7-8cjw-p6xm`. `tech-debt.md:482` carries the same wrong id; fixed in this PR.                                                                                                                                                                                                                                                                                                                                                                                                          |
| S8  | The evidence table is stale by one                                                                  | **accepted**                                                      | Fourth row (`sharp`, #235); "three accidents" → **four**; `plan.md:528` → "four times".                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| —   | Drop `audit.yml`'s install step; `persist-credentials: false`; `cancel-in-progress: false`          | **accepted → SEC-5b**                                             | All three recorded in § Out-of-scope. An install would run `allowBuilds` postinstalls unattended, daily, beside a token in `.git/config`.                                                                                                                                                                                                                                                                                                                                                                               |
| —   | `audit-level` is in `pnpmConfigFileKeys`                                                            | **REJECTED — the claim is false, and so was my acceptance of it** | My first extraction found `pnpmConfigFileKeys` does **not** contain it. I overrode my own correct result on a misread of a neighbouring array, and recorded the override here as a lesson. The array ending `…"os","audit-level","yes"` is **`excludedPnpmKeys`**, where membership _excludes_. The bypass is real — measured twice — but the mechanism is `addSettingsFromWorkspaceManifestToConfig`, which whitelists nothing, so the surface is **broader** than either of us said. Corrected in § "Measured facts". |

### Round 2 — correctness & tests

| #   | Critique                                                                                                                                      | Verdict                            | Resolution                                                                                                                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | **B1's fix made the retryable path unreachable**: a real outage has no `metadata`, so it lands on exit 3 and the leniency branch is dead code | **accepted**                       | Measured the outage bytes (valid JSON, `{"error":{"code":"pnpm"}}`, no `metadata`). Rule 1 of Decision 5 now classifies the envelope **before** the coherence rules. This was my bug, introduced fixing B1. |
| C2  | The 0/1/2/3 contract contradicts itself on unparseable stdout                                                                                 | **accepted**                       | Stated positively: parse failure → 3; exit 2 only from rule 1's retryable set.                                                                                                                              |
| C3  | The config-disarm list is incomplete; four more keys measured                                                                                 | **accepted, by deleting the list** | Enumeration is unwinnable. Four generic rules replace it and cover more (Decision 5).                                                                                                                       |
| C4  | Case 18 asserts `ENOTFOUND registry.npmjs.org`, a string pnpm never emits                                                                     | **accepted**                       | Test plan rebuilt on measured bytes; the fixtures are recorded in § "Measured facts".                                                                                                                       |
| C5  | The spawn argv is exercised by no test, and `--audit-level info` is load-bearing                                                              | **accepted**                       | Case 17 shims `pnpm` on `PATH` and asserts the argv. The reason is now stated in Decision 5.                                                                                                                |
| C6  | Expiry has no timezone basis; V1/V2/V4 and every boundary untested                                                                            | **deferred**                       | Allowlist → SEC-5c. The finding carries over, with `check-status-touched.mjs:248-251`'s local-date convention.                                                                                              |
| C7  | S4's co-change grep is narrower than the strictness pathspec it pairs with                                                                    | **moot**                           | Both the check and the label are cut (Sc3).                                                                                                                                                                 |
| C8  | S6's registry assertion **cannot be implemented** — the report has no such field, and pnpm resolves `registry` from four layers               | **accepted**                       | Reverted. Worth keeping as a `pnpm config get registry` comparison in SEC-5b, with its own test; not guessable from the report.                                                                             |
| C9  | Normalisation is wrong twice: no `cves` field, and `deriveGithubAdvisoryId` returns `""` not nullish                                          | **accepted**                       | Fall back by **emptiness**. Case 16 pins it. Would have made such an advisory unsuppressible under SEC-5c's V2.                                                                                             |
| C10 | `patched_versions` is **inferred** by pnpm, so it never evidences a fix exists                                                                | **accepted**                       | Printed as context, never cited as evidence. It is this repo's own `braces` lesson.                                                                                                                         |
| C11 | Multi-line `::error::` annotates only its first line                                                                                          | **accepted**                       | Single-line annotations; `ci.yml:173` is the idiom.                                                                                                                                                         |
| C12 | Exit 3's no-escape-hatch risk is unrecorded                                                                                                   | **accepted**                       | Named in § Risks with its response.                                                                                                                                                                         |

### Round 3 — simplicity & scope

| #   | Critique                                                                                     | Verdict             | Resolution                                                                                                                                                                                                                                            |
| --- | -------------------------------------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sc1 | `audit.yml` is a second concern the backlog row never asks for, and P4 is unanswered         | **accepted**        | → **SEC-5b**. Confirmed the row asks only for a step in `quality`, and that Dependabot already watches untouched deps.                                                                                                                                |
| Sc2 | Guard step 2 is redundant with step 3 and would be the first guard to parse YAML             | **accepted**        | Deleted. Rules 2-4 catch the whole class by shape.                                                                                                                                                                                                    |
| Sc3 | The same-PR check and its new label are a bypass dressed as a control                        | **accepted**        | Both cut. ⚠️ It also corrected my own justification: I wrote that `hold-the-bar/check.sh` "runs in no workflow" — true, and **materially misleading**, since `ship-pr:43` and `review-pr`'s prefetch run it on every PR, which is the real loop here. |
| Sc4 | `devDependencies === 0` and `totalDependencies >= 50` are self-wedge risk for no catch value | **accepted**        | Dropped to printed context. If `--prod` stopped excluding dev, the dev tree's `braces` high reds every PR already.                                                                                                                                    |
| Sc5 | The allowlist is 60% of the guard and 17 of 26 test cases, dead on arrival                   | **accepted**        | → **SEC-5c**, with the residual stated in Decision 3.                                                                                                                                                                                                 |
| Sc6 | The backlog row doesn't link the plan; the plan narrates itself three times                  | **accepted**        | Link added; the inline re-litigation is cut to one clause each, and the measurements live in one table.                                                                                                                                               |
| Sc7 | The self-test carve-out contradicts Decision 4's own risk assessment                         | **partly**          | The asymmetry is now stated as a decision in Decision 4, and flagged for DX-5(b). Taking the sibling suite here would be a second concern.                                                                                                            |
| —   | Drop V3/V8/V10 from the allowlist                                                            | **rejected on V10** | V10 is load-bearing for V11: entry `high` + advisory re-scored `critical` passes V9 and V11, so without V10 the critical is silently suppressed. Recorded for SEC-5c.                                                                                 |

### Round 4 — architecture & consistency

| #   | Critique                                                                                        | Verdict               | Resolution                                                                                                                                                           |
| --- | ----------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | The step uses a **two-dot** base diff, which reports files moved on `main` as changed by the PR | **accepted**          | Measured: two-dot listed `pnpm-lock.yaml` for a branch that never touched it. Three-dot, matching `ci.yml:96`.                                                       |
| A2  | The step itself has no tests, and it fails open                                                 | **accepted**          | The verdict moves inside the guard where the self-test reaches it; what remains in YAML is the `changed` capture, following `ci.yml:46-55`'s flag-not-verdict split. |
| A3  | The exit-code extension silently makes `check-action-pins.mjs`'s exit 2 a trap                  | **accepted**          | Two lines added to its header. Deliberately **not** retrofitting it to 0/1/2/3 — inert for it, and scope.                                                            |
| A4  | The doc-truth sweep misses three live claims                                                    | **accepted**          | `working-with-agents.md:50`, `plan.md:760`'s duplicate AUDIT-1 row, `tech-debt.md:251` — all in File-by-file. The irony is noted: this is the PR's own subject.      |
| A5  | Self-test placed after `Install` against the plan's own placement rule                          | **accepted**          | Moved before the install; banner comments; backlog id out of the step name.                                                                                          |
| A6  | The YAML-scan parse method is unstated                                                          | **moot**              | The scan is deleted (Sc2). Its measured inputs are kept in § "Measured facts".                                                                                       |
| A7  | Multi-line annotations; the third label is undocumented                                         | **accepted**          | Single-line (= C11); the label is cut (= Sc3).                                                                                                                       |
| —   | `cache: pnpm` with no install step caches a store nothing uses                                  | **accepted → SEC-5b** | Recorded in § Out-of-scope.                                                                                                                                          |
| —   | Cite by heading, not line, for files other lanes are editing                                    | **accepted**          | Applied in File-by-file.                                                                                                                                             |

### Round 5 — code reuse / DRY

| #   | Critique                                                                                                 | Verdict                 | Resolution                                                                                                                                                          |
| --- | -------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | `audit.yml`'s report step re-states the `high` threshold and is an unguarded second audit                | **accepted → SEC-5b**   | Recorded with the fix: route it through the guard in a report-only mode.                                                                                            |
| R2  | The severity vocabulary is written four times; make it one const, **not** in `packages/shared`           | **accepted**            | One const block in the guard. The reasoning is right and now stated: a `.github/scripts/` guard must run with no `node_modules`.                                    |
| R3  | The `changed`/fail-closed idiom is written a second time; extract a helper                               | **rejected (deferred)** | Real duplication, but extracting a shared bash helper means also migrating `ci.yml`'s working step — a second concern in a PR being cut down. Filed as a follow-up. |
| R4  | V8 re-implements the already-exported `cleanPath`, and its deferred nit is an existing shared limitation | **deferred → SEC-5c**   | Good catch; carries over with the allowlist, including that the `#anchor` behaviour is `cleanPath`'s documented one, not SEC-5-specific.                            |
| R5  | Two canonical statements of the rule; the SEC-2 precedent says which wins                                | **accepted**            | `SECURITY.md` carries the rule; the guard header points at it.                                                                                                      |
| R6  | `90`/`14` need names, and the date basis must reuse the one the repo already got wrong once              | **deferred → SEC-5c**   | With C6.                                                                                                                                                            |
| R7  | The new label has no registry entry                                                                      | **moot**                | Cut (= Sc3).                                                                                                                                                        |
| R8  | The self-test is the 7th copy of the `expect` harness and the first in CI, and none annotates            | **partly**              | Accepted the minimum: the new suite emits `::error::` under `GITHUB_ACTIONS`. A shared `_assert.sh` plus migrating six suites is DX-5(b)'s business, not this PR's. |

### What the panels changed, in one line

The plan went from **~450 implementation lines to ~120**, lost a workflow and an allowlist to their own
rows, replaced an unwinnable config blocklist with four rules that cover more, and had **two of its own
corrections corrected** — the `audit-level` mechanism (my misread) and the exit-code split (my bug).
Both are recorded above rather than quietly fixed, because a plan that hides its own wrong turns
teaches the next reader nothing.
