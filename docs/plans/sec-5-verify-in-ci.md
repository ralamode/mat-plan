# SEC-5 — `pnpm audit --prod` becomes a CI gate

> Backlog: [docs/plan.md](../plan.md) → **SEC-5** (`:528-543`), the audit third of **DX-5(b)**
> (`:615-621`). Pillar: Platform ([roadmap](../roadmap.md):87). Branch: `chore/sec-5-audit-in-ci`,
> after the SEC-2 precedent (`chore/sec-2-pin-actions`).
>
> ⚠️ This plan lands on `docs/sec-5-verify-in-ci` ahead of the code, not in the implementing PR as
> [plans/README.md](./README.md) prescribes — a parallel-lane deviation, noted so it is not copied.

## Goal

Make the production audit a thing that **fails a build** instead of a thing that happens to be
running on someone's laptop. `audit --prod --audit-level high` lives inside `pnpm verify`
(`package.json:25`) and **no workflow runs `pnpm verify`**, so a critical advisory reaches `main` with
CI fully green. That is not a theory: it has happened three times and all three were found by
accident.

| Advisory                                                       | Severity            | In `--prod`?                          | How it was actually caught                                                                                                                     |
| -------------------------------------------------------------- | ------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| GHSA-vcvr-r3jv-pc5j (`next` RCE)                               | critical            | yes                                   | a local `verify` during unrelated work, 2026-09-30 (#182) — `plan.md:534`                                                                      |
| GHSA-68fv-2mgg-jv7q (`source-map-js` DoS)                      | high                | yes                                   | a local `verify` during unrelated **docs** work, 2026-10-06, #222 — [fragment](../changelog/2026-10-06-fix-deps-source-map-js-advisory.md):5-7 |
| GHSA-hrr3-gc8f-f4qj (`fast-uri`) + a **critical** `proxy-addr` | moderate / critical | `fast-uri` yes; `proxy-addr` dev-only | a sweep during unrelated work, 2026-10-06, #227 — [fragment](../changelog/2026-10-06-fix-deps-audit-sweep.md):1-6                              |

Three accidents in five weeks. `roadmap.md:115-116` states the consequence plainly, and
`tech-debt.md:496` draws the right conclusion: **"the gap is the gate, not the advisories."** Each
previous fix patched the advisory. This one patches the gate.

**Why it is a plan and not a one-liner** (`plan.md:539-543`): an advisory can be published against a
dependency nobody touched, which turns **every** open PR red through no fault of its author; and the
one advisory class that cannot be fixed at all — a `high` whose patched range was never published —
would wedge `main` permanently. The step is four lines. The exception mechanism is the work.

## Acceptance

SEC-5's row has no single criterion line; these are its requirement sentences, verbatim
(`plan.md:538-543`):

> **The job is small** — `pnpm audit --prod --audit-level high` as a step in `ci.yml`'s `quality`
> job, which already runs `pnpm install`. […] a new advisory against an unchanged dependency turns
> **every** PR red through no fault of its author, so it needs an agreed escape hatch (a label, or an
> allowlist with an expiry date and a reason, the way `.squawk.toml` handles its exclusions) and a
> decision on whether it blocks or annotates. Offline by default like `actions:check`, so a registry
> outage is not a merge outage.

Done when:

- A `high` or `critical` advisory in the **production** tree **fails** `quality` — on pull requests
  **and** on push to `main` (`ci.yml:3-6` gives both for free).
- A `moderate` or below does not fail anything, and the run log prints the full
  `metadata.vulnerabilities` counts, so nobody has to trust that the gate ran.
- A dev-only advisory does not fail anything, and is **visible** in the daily run's report step.
- An unfixable prod advisory can be accepted only as an allowlist entry carrying a reason, a
  `docs/tech-debt.md` pointer, and an expiry **≤90 days out**; it prints a `::warning::` on every
  single run, and the guard **fails** once it expires, once it goes stale, or once the advisory is
  re-scored.
- A registry outage does **not** turn a PR red **unless that PR changes a dependency**, in which case
  it fails, because a PR that adds a dependency must never pass unchecked.
- `pnpm audit:check` is the single definition, run identically by `pnpm verify` and by both
  workflows. There is no second copy of the threshold or the allowlist.
- `bash .github/scripts/check-audit.test.sh` passes, **in CI**, covering every branch above —
  including the vacuity cases — with no network.
- `pnpm actions:check --resolve` passes on the PR (it touches workflows, so `ci.yml:39-41` turns
  `--resolve` on automatically).
- One green `workflow_dispatch` run of `audit.yml` **after merge** (a `schedule:` trigger only ever
  runs the default branch's copy of the file, so this cannot be proven pre-merge).

## Two claims in the backlog row this plan corrects

1. **"Offline by default like `actions:check`" is not achievable.** `actions:check` is offline because
   a SHA pin is checkable by reading the file (`check-action-pins.mjs:6-9`). `pnpm audit` is a query
   against the registry's advisory endpoint; there is no local advisory database. The only honest
   reading of the requirement is its clause: **"so a registry outage is not a merge outage."** That is
   what Decision 1b delivers, by distinguishing _"could not check"_ from _"checked, found nothing"_ —
   which `check-action-pins.mjs:143-148` already does for the GitHub API.
2. **"the way `.squawk.toml` handles its exclusions" is the shape to reject for suppressions.**
   `.squawk.toml:17-28` is excellent _documentation_ — each exclusion carries a paragraph of reasoning
   — but it has no expiry and nothing notices when it stops being needed, which is exactly why
   `require-concurrent-index-creation` (`:22-27`) has now outlived two audits. A Squawk exclusion
   suppresses a _stylistic_ rule. An audit exception hides a _live vulnerability_. Same prose
   discipline; added expiry and staleness enforcement.
3. `plan.md:528` still says "an advisory has now reached `main` **twice**" where `roadmap.md:115` says
   three. The implementing PR corrects it.

## Decision 1 — both triggers, one guard

### 1a. A blocking step in `quality` (the PR that _adds_ a bad dependency)

A step, not a job. `ci.yml` states the reason three separate times — `:72-74`, `:193-195`,
`:228-229`: _"a new job is not a REQUIRED check until branch protection is edited, so it would look
wired while blocking nothing."_ With branch protection off (`AGENTS.md:331-333`) nothing is required
anyway, and the `review-pr` shipit bar reads the `quality` check; a fourth job would have to be
learned by a human before it meant anything.

**Placement: immediately after `Install (frozen lockfile)` (`ci.yml:250-251`), before `Format check`
(`:253`).** `pnpm verify` runs the audit last (`package.json:25`) and in CI that is the wrong order: a
formatting miss is something the author fixes in 10 seconds, while an advisory is the one failure that
needs a decision. It should land in the first ~40s of the job, not after `pnpm build`. This is also
the only step that needs the install, which is why it cannot sit with the pre-install guards at
`:42-239`.

Cost: the audit itself is ~2-5s on a tree this size. No new install, no new job, no new runner.

### 1b. A daily `audit.yml` (the advisory that _arrives_ with no code change)

`quality` on push to `main` already re-audits every merge, so the PR gate alone narrows worst-case
detection to "the next merge". The schedule buys two things over that:

- detection during a quiet stretch (at ~4h/wk there are weeks with no merge), bounded at 24h; and
- it is the first thing to see an **allowlist expiry**, up to a day before any PR trips on it.

Modelled on `codeql.yml` and reusing its reasoning verbatim where it applies: `schedule` +
`workflow_dispatch` (`codeql.yml:23-28`), cron off the hour because _"GitHub's cron queue is congested
at :00 and a scheduled run can be delayed or dropped there"_ (`:25-26`), `timeout-minutes` (`:45`),
and explicitly **not a PR check** so nothing here is ever cited as a per-PR gate (`:5-9`).

**Daily, not weekly** (`cron: '23 6 * * *'`, offset from CodeQL's `17 6 * * 1` so the two never
contend). Weekly is right for CodeQL because its input — the query pack — moves fortnightly
(`codeql.yml:14-18`). The npm advisory feed moves daily, and the three escapes here were ~6 days
apart. Cost is ~1 runner-minute/day (~30/mo against 2000 free); the cost that actually matters is
human triage, and `--prod` advisories arrive at ~3 per five weeks, so a daily run is silent almost
always. **If it ever produces churn, drop the cron to weekly — that is a one-line change and the
documented fallback.**

**The scheduled job fails on exit 2.** Nothing is blocked by it, and a scheduled job that quietly
no-ops is precisely the failure mode of this entire ticket.

### Rejected: `schedule:` on `ci.yml`

It would drag `e2e` (minutes, an ephemeral Postgres and a Chromium download) and `gitleaks` into a
daily run, needing a `github.event_name != 'schedule'` guard on every job and muddying which jobs mean
what. A 55-line second workflow is cheaper and reads as one thing.

## Decision 2 — what fails the build

**`high` and `critical`, on the `--prod` tree only.**

- **Why `high`, not `moderate`:** it is the bar `pnpm verify` already sets (`package.json:25`) and the
  bar `tech-debt.md:301` already claims ("fail high/critical"). This PR wires a claimed gate; it does
  not also raise it. Two of the three escapes were high-or-critical in `--prod`. The third's
  `--prod`-visible half was a _moderate_ (`fast-uri`) and was fixed anyway by a four-line lockfile bump
  ([fragment](../changelog/2026-10-06-fix-deps-audit-sweep.md):2-4) — fixed because someone looked,
  not because a gate shouted, which is the right division of labour at ~4h/wk.
- **Why `--prod`, not the whole tree:** the whole tree **cannot** pass today.
  `braces@3.0.3` is a high whose advisory names `>=3.0.4` as patched and **that version has never been
  released** (`tech-debt.md:482-485`); `esbuild@0.18.20` is a moderate pinned by a deprecated loader
  inside `drizzle-kit` (`:486-489`). Both are dev-only and `audit --prod` is clean of them (`:490`).
  Gating the full tree at `high` would wedge `main` on day one, with no edit that unwedges it.
- **Dev-only is not harmless, so it is reported, not ignored.** The daily run adds a second step,
  `pnpm audit --audit-level high` over the full tree, with `continue-on-error: true`. That is a
  deliberate yellow ⚠ on the step rather than a `|| true` that hides inside a green log — the
  difference between an honest non-gate and a vacuous gate. Its step name says _REPORT, NOT A GATE_,
  following `codeql.yml:5-9`'s precedent of writing the non-gate status into the file.

### The `braces` wedge is historical fact, not a hypothetical

The brief's framing deserves one correction and it strengthens the case. `braces` is out of `--prod`
scope **today** — but it was _in_ scope until 2026-10-03, when moving `shadcn` to devDependencies
cleared it. The fragment records the exact state a naive high gate would have met:

> `pnpm audit --prod` goes from 1 high + 3 moderate to 1 moderate (`fast-uri`), under `verify`'s
> `high` bar. […] No patched `braces` is published yet (3.0.3 is `latest`), so a bump or override was
> not possible.
> — [2026-10-03-fix-braces-3.0.4-ghsa-vfj7.md](../changelog/2026-10-03-fix-braces-3.0.4-ghsa-vfj7.md):1-7

So for some days this repo had an unfixable `high` in its production tree. The escape used then —
re-classifying the dependency as dev — was a genuine fix, but it required an afternoon of reasoning
about whether `@import 'shadcn/tailwind.css'` is a runtime import, and it is not always available. The
allowlist exists for the next time it is not. The generalisable lesson from that week is in
[the sweep fragment](../changelog/2026-10-06-fix-deps-audit-sweep.md):9-10: _"before trusting a
'patched versions' field: in-range is not the same as published."_

**The allowlist therefore ships EMPTY (`[]`).** `audit --prod` is clean
([sweep](../changelog/2026-10-06-fix-deps-audit-sweep.md):6), so seeding an entry would be inventing
an exception the repo does not have. The consequence is that the allowlist path is dead code until the
first emergency — which is exactly why its self-test is not optional. A suppression mechanism whose
first real execution is during an incident is a second incident.

## Decision 3 — the exception mechanism (the crux)

`.github/audit-allowlist.json`, read by `.github/scripts/check-audit.mjs`. In `.github/` because that
is where the guards and their inputs live; `.squawk.toml` is at the root only because `squawk-cli`
looks for it there. Prettier already formats `*.json` (`package.json:40-43`).

### Entry shape

```json
[
  {
    "ghsa": "GHSA-v6h2-p8h4-qcjw",
    "package": "braces",
    "severity": "high",
    "reason": "The advisory names >=3.0.4 as patched and that version has never been released; 3.0.3 is latest, and pinning >=3.0.4 makes the install unresolvable. Nothing to upgrade to.",
    "expires": "2026-12-31",
    "debt": "docs/tech-debt.md#two-dev-only-advisories-with-no-fix-available-2026-10-06"
  }
]
```

(Illustrative — this entry is **not** shipped; `braces` is out of `--prod` scope. It is the worked
example of what an entry must say, drawn from `tech-debt.md:482-485`.)

### Why JSON with a required `reason` field, and not a YAML comment

`pnpm` has a built-in suppression — `auditConfig.ignoreGhsas` — and the reuse argument for it is
real: zero custom code, and `pnpm-workspace.yaml:26-36` already carries exactly the right
documentation idiom for `overrides` (_"Each entry names the advisory and the path, so it can be
removed the moment the parent ships a fixed range"_). It is rejected because it is **silent and
unexpiring**: a YAML comment is not enforced, nobody is told when the entry stops being needed, and
the result is `.squawk.toml:22-27` — a correct-when-written exclusion that has outlived two audits. A
required `reason` field with a minimum length is a comment the build checks. If the panel prefers
`ignoreGhsas` anyway, the guard can emit it, but the metadata stays authoritative.

### What the guard enforces about the allowlist itself (each → exit 1)

| #   | Rule                                                                  | Why                                                                            |
| --- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| V1  | every required key present, no unknown keys                           | a typo'd key must not read as a missing rule                                   |
| V2  | `ghsa` matches `^GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}$`           | the key is the identity; a malformed one matches nothing                       |
| V3  | no duplicate `ghsa`                                                   | two entries, one deleted, the other forgotten                                  |
| V4  | `expires` is a real `YYYY-MM-DD`                                      | `2026-13-01` must not parse to something                                       |
| V5  | `expires` is in the future                                            | **an expired exception fails the build**                                       |
| V6  | `expires` ≤ today + 90 days                                           | stops `expires: 2099-01-01`                                                    |
| V7  | `reason` ≥ 40 characters                                              | "wontfix" is not a reason                                                      |
| V8  | the file part of `debt` exists on disk                                | a dead pointer is worse than none                                              |
| V9  | the entry matches a **live** high+ advisory in this report            | **self-invalidating:** once upstream fixes it, the suppression must be deleted |
| V10 | the matched advisory's `module_name` and `severity` equal the entry's | a re-score (high → critical) forces re-triage, not silent inheritance          |

**V9 is the property that makes this different from every suppression mechanism in the repo.** A
`squawk-ignore` survives forever once the statement it annotates is committed; an allowlist entry
cannot outlive the advisory it excuses. It also means a dev-only advisory **cannot** be allowlisted
(`--prod` never reports it), which keeps the file about this gate and nothing else.

V9 has a deliberate sharp edge: the day upstream publishes a fix, `main`'s daily run goes **red** with
_"stale exception: no current high+ advisory matches GHSA-xxxx — delete the entry"_. That is a true
statement with a one-line fix in the message, and the alternative (silently tolerating stale
suppressions) is the failure this ticket exists to stop.

### Why expiry does not reintroduce the wedge

An expiry is date-driven, so without care it fails an unrelated PR on a Tuesday for a reason its
author knows nothing about — the exact complaint in `plan.md:540-541`. Three things prevent it:

1. **Every active entry prints a `::warning::` on every run** — PR, push and schedule. The exception
   is never silent; it is on the Actions annotation list of every build.
2. **The last 14 days print a countdown** (`::warning:: GHSA-xxxx expires in 9 days`), so expiry
   arrives as a window, not a surprise.
3. **The daily run sees it first**, up to 24h before any PR, and it is the only run that is _supposed_
   to be red when something needs attention.

And if `main` is ever genuinely wedged, the escape is to add an entry — visible, expiring, reviewed —
in the same PR, with its `docs/tech-debt.md` section. Last resort: merge red, which `AGENTS.md:331-333`
records as always available since nothing is a required check.

### Rejected: a `ci-skip-audit` label

The `ci-skip-e2e` / `docs-skip-feature-map` idiom (`ci.yml:313-318`, `:233-239`) is the right tool for
a **scope** claim — _this change provably cannot affect that check_ — and `ci.yml:313-318` is careful
to pair the manual label with an automatic, conservative, default-to-run inert-file rule. A
vulnerability is not a scope question. A label would be per-PR rather than per-advisory, carry no
reason, never expire, and bypass the whole gate including advisories nobody has looked at. The three
escapes prove the failure mode here is _"nobody noticed"_, and a one-click label is the easiest
possible way not to notice. The allowlist is the escape hatch, and it is strictly better.

## Decision 4 — `skills:check` and `guards:test`: deferred to DX-5(b), with one carve-out

`AGENTS.md:317-318` says wiring them in _"is a CI change that needs its own plan"_, and that plan
already exists as a row: `plan.md:619-621` — _"(b) a CI change to run audit, `skills:check` and
`guards:test`, which needs its own plan and panel; `status:check` (DX-2's guard, also local-only)
belongs on that list."_

**SEC-5 delivers the audit third. `skills:check`, `guards:test` and `status:check` stay with
DX-5(b).** Not an oversight — a scope decision with a reason: `guards:test` is seven bash suites
(`package.json:31`) that have never run on ubuntu. bash 3.2 vs 5, BSD vs GNU `sed`/`grep`/`mktemp`,
and the `gh` stubbing in `review-prefetch.test.sh` / `review-post.test.sh` are each a plausible
first-run failure, and debugging seven of them is an unbounded cost inside a PR whose concern is the
audit gate. It is filed, not forgotten, and this plan narrows DX-5(b) to its remaining three.

**The carve-out:** `bash .github/scripts/check-audit.test.sh` runs as its own step in `quality`.
Shipping a new guard whose self-test only ever runs locally would reproduce, in the same PR, the
precise smell `plan.md:621` records — _"SEC-2's `check-action-pins.mjs` already runs in `quality`; its
self-test, in `guards:test`, does not."_ The new self-test is node + bash + crafted fixtures, no
network, ~1s. It also goes into `guards:test` so it rides the local loop too.

## File-by-file changes

| Path                                                       | Change                 | What & why                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/scripts/check-audit.mjs`                          | **NEW** (~170)         | Runs the audit, parses the report, applies the threshold and the allowlist. The single definition.                                                                                                                                                                                                               |
| `.github/scripts/check-audit.test.sh`                      | **NEW** (~150)         | Offline self-test over crafted reports: every pass/fail/vacuity branch.                                                                                                                                                                                                                                          |
| `.github/audit-allowlist.json`                             | **NEW** (1 line: `[]`) | Ships empty — `audit --prod` is clean.                                                                                                                                                                                                                                                                           |
| `.github/workflows/audit.yml`                              | **NEW** (~55)          | Daily + `workflow_dispatch`: the `--prod` gate on `main`, plus the full-tree report.                                                                                                                                                                                                                             |
| `.github/workflows/ci.yml`                                 | EDIT (+~35)            | Two steps in `quality` after `Install` (`:251`): the self-test, then the audit with the registry-outage rule.                                                                                                                                                                                                    |
| `package.json`                                             | EDIT (3 lines)         | New `audit:check`; `verify` (`:25`) swaps `pnpm audit --prod --audit-level high` → `pnpm audit:check`; `guards:test` (`:31`) gains the new self-test.                                                                                                                                                            |
| `.claude/skills/hold-the-bar/check.sh`                     | EDIT (+1)              | `"ghsa"[[:space:]]*:` joins the suppression regex at `:37`, so an added allowlist entry is a **finding** needing justification, not a notice. `code_paths` (`:17-19`) already covers `*.json`.                                                                                                                   |
| `.claude/skills/hold-the-bar/check.test.sh`                | EDIT (+~7)             | One case for that alternative, in the `expect` harness at `:21-30`. A regex with no test is how the next one gets dropped.                                                                                                                                                                                       |
| `AGENTS.md`                                                | EDIT (~12)             | `:313-318`: `audit --prod` → `audit:check`, and the local-only sentence now names only `skills:check` / `guards:test`. `:331-335`: the audit gate joins the CI list. **`:336-339`: delete the ⚠️ "`audit --prod` is NOT a CI gate" paragraph** — leaving it is how `tech-debt.md:116-118`'s class of lie starts. |
| `.github/SECURITY.md`                                      | EDIT (~6)              | `:87`'s bare _"`pnpm audit` gate"_ becomes the precise statement — scope, threshold, both triggers, the allowlist — in the _"this is the one statement of the rule"_ style of `:88-91`.                                                                                                                          |
| `docs/tech-debt.md`                                        | EDIT (~10)             | Flip the `pnpm audit` row (`:301`) from ❌ local-only to ✅ wired, naming both triggers. Add to `:476-496` that the dev tree is report-only by design. Record the DX-5(b) remainder.                                                                                                                             |
| `docs/changelog/2026-10-XX-chore-sec-5-audit-in-ci.md`     | **NEW** (~8)           | One fragment, per [changelog/README.md](../changelog/README.md):12-19.                                                                                                                                                                                                                                           |
| `docs/plans/sec-5-verify-in-ci.md`                         | **NEW**                | This plan + its review-response log.                                                                                                                                                                                                                                                                             |
| `docs/plan.md`, `docs/status.md`, `docs/roadmap.md`        | EDIT                   | SEC-5 → shipped; narrow DX-5(b) to `skills:check` / `guards:test` / `status:check`; fix `plan.md:528`'s "twice" → "three times"; `roadmap.md:87` and `:115-116`. ⚠️ **Owned by another lane in this parallel session** — coordinate before editing.                                                              |
| `.claude/skills/ship-pr/SKILL.md`, `hold-the-bar/SKILL.md` | EDIT (2 lines)         | `ship-pr:41` and `hold-the-bar:47` both describe `verify`'s step list including `audit --prod`; update the names.                                                                                                                                                                                                |

No feature guide owns `.github/**` (checked: `docs/features/` holds only `programming.md`,
`strength-logging.md`, `write-path.md`, and none claims these paths), so `guides:check` (`ci.yml:233-239`)
has nothing to say about this PR.

### `.github/scripts/check-audit.mjs`

Header comment carries the rule and the entry shape, following `check-action-pins.mjs:2-24`.

```
Usage:
  node .github/scripts/check-audit.mjs [--report <file>|-] [--allowlist <file>]
Exit: 0 ok (allowlisted advisories warned) · 1 a blocking advisory, or a bad/expired/stale
      allowlist entry · 2 could not check — registry unreachable, unparseable or incoherent
      report, missing allowlist
```

The 0/1/2 contract is `check-action-pins.mjs:24` verbatim, and so is its principle: _"a check that
couldn't check never passes"_ (`:12-13`).

1. **Get the report.** Without `--report`, spawn `pnpm audit --prod --json`.
   ⚠️ **Do not read the exit code.** `pnpm audit` exits non-zero whenever it finds anything, so
   "non-zero" is the normal case; the verdict is the JSON on stdout. Use `execFileSync` with
   `encoding: 'utf8'`, a 120s `timeout`, a generous `maxBuffer`, and read `e.stdout` from the thrown
   error. No `--audit-level` is passed — the guard owns the threshold, and the full report is needed
   for the counts line and for the coherence check below.
2. **Refuse an incoherent report (exit 2).** This is the anti-vacuity gate.
   - no `metadata.vulnerabilities` object → _"a report without severity counts is not a verdict"_;
   - `metadata.vulnerabilities.high + .critical > 0` but **zero** high+ advisories parsed, or the
     reverse → _"the report's own counts disagree with its advisory list"_.
     ⚠️ **Compare zero-ness, not counts.** `metadata` counts findings and `advisories` counts
     advisories, so one advisory with three paths legitimately gives 3 vs 1; strict equality would fire
     spuriously. Zero-ness is the property that matters and it is the one a future pnpm output-shape
     change would break — without this check, such a change yields "0 advisories, green forever," which
     is `tech-debt.md:116-118`'s _"a green check that proves nothing, which is strictly worse than no
     check, because it is trusted."_ Directly answers `tech-debt.md:123`: _can this go vacuous, and
     would anyone notice?_
3. **Normalise.** Per advisory: `github_advisory_id ?? cves[0] ?? String(id)`, `module_name`,
   `severity`, `patched_versions`, `url`, `recommendation`, and the first few `findings[].paths` for
   the "how is it reached" line that every one of the three fragments found worth writing down.
4. **Validate the allowlist** (V1-V10 above). Validation runs _before_ the verdict, so a malformed
   file can never read as "no exceptions".
5. **Verdict.** High+ advisories minus unexpired matched entries. Empty → exit 0, printing the
   counts. Non-empty → exit 1 with one line per advisory (`severity  package  GHSA  patched: <range>
via <path>`) and the `::error::` annotation form `ci.yml:173` uses.
6. **Always print the counts line**, pass or fail, so a human reading a green log can see what was
   seen. A guard that reports nothing is indistinguishable from one that ran nothing —
   `check-action-pins.mjs:159-165`.

`--report` exists for the self-test. It is never passed in CI, and step 2 means an empty or truncated
file exits 2 rather than passing, so it cannot be used to make the gate vacuous.

### `.github/workflows/ci.yml` — the two new steps

```yaml
- name: Audit guard self-test
  run: bash .github/scripts/check-audit.test.sh

- name: Production audit (high+, --prod; SEC-5)
  env:
    BASE_SHA: ${{ github.event.pull_request.base.sha }}
  run: |
    # A registry outage must not be a merge outage (plan.md:543) — but a PR that
    # CHANGES a dependency must never pass unchecked. So leniency applies only when
    # this PR touches no dependency input. On push to main BASE_SHA is empty and
    # there is no leniency: main's audit always has to be a real verdict.
    deps=1
    if [ -n "$BASE_SHA" ]; then
      # Captured FIRST: a failing `git diff` must abort the step (bash -e) rather
      # than read as "no dependency changed" and silently grant leniency. Exactly
      # the trap documented at ci.yml:49-50 for the action-pin --resolve switch.
      changed="$(git diff --name-only "$BASE_SHA" HEAD -- \
        pnpm-lock.yaml pnpm-workspace.yaml '*package.json' \
        .github/audit-allowlist.json .github/scripts/check-audit.mjs)"
      [ -z "$changed" ] && deps=
    fi
    set +e; node .github/scripts/check-audit.mjs; code=$?; set -e
    if [ "$code" -eq 2 ] && [ -z "$deps" ]; then
      echo "::warning::pnpm audit could not reach the registry. This PR changes no
    dependency input, so the gate is advisory here; main's daily audit is the backstop."
      exit 0
    fi
    exit "$code"
```

Notes: `'*package.json'` is a git pathspec, where `*` crosses `/`, so it covers every workspace
package. It over-matches (`foo-package.json`), and over-matching only ever makes the gate **stricter** —
the right direction for a default. `deps=1` is the default, so any path through the `if` that fails to
decide leaves the gate strict. No step-level `if:`, so this runs on push to `main` too — the one place
an advisory published since the PR's last run gets caught at merge time.

### `.github/workflows/audit.yml`

```yaml
name: Audit

# The production audit as a gate on main, on a schedule, because an advisory can be
# published against a dependency nobody touched. The per-PR half of SEC-5 is a step in
# ci.yml's `quality` job; this is the half that needs no code change to fire.
#
# DELIBERATELY NOT A PULL-REQUEST CHECK and not a required check — ci.yml's `quality`
# step is the PR gate (codeql.yml:5-9 sets this precedent). Nothing here should be
# cited as a per-PR gate.
#
# Daily, not weekly: the npm advisory feed moves daily (CodeQL's query packs move
# fortnightly, which is why that one is weekly). The three advisories that reached main
# were ~6 days apart. :23 off the hour — GitHub's cron queue is congested at :00 and a
# scheduled run can be delayed or dropped there (codeql.yml:25-26) — and offset from
# CodeQL's 06:17 so the two never contend.
on:
  schedule:
    - cron: '23 6 * * *'
  workflow_dispatch:

concurrency:
  group: audit-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read # no security-events, no issues: the signal is the failed run

jobs:
  prod:
    name: audit (--prod, high+)
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      # Pins copied from ci.yml:21, :242, :245 — no new SHA for actions:check --resolve
      # to resolve, and one place to bump all four.
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86 # v6.0.10
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: 22
          cache: pnpm

      # Only if precondition P1 says the audit needs a node_modules tree. If it reads
      # the lockfile alone, this step is dropped — same trade codeql.yml:63-68 makes,
      # for the same reason: it removes a minute and a lockfile-drift failure mode from
      # a job whose job is to be trustworthy on a quiet morning.
      - name: Install (frozen lockfile)
        run: pnpm install --frozen-lockfile

      # No leniency on exit 2 here (unlike ci.yml's step): nothing is blocked by this
      # job, so a silent no-op is the only way for it to fail, and that is the exact
      # failure SEC-5 exists to stop.
      - name: Production audit (same guard as ci.yml)
        run: node .github/scripts/check-audit.mjs

      # REPORT, NOT A GATE. The dev tree cannot pass at `high`: braces@3.0.3's advisory
      # names a >=3.0.4 that was never published (docs/tech-debt.md:482-485). Visible as
      # a yellow step rather than hidden behind `|| true`.
      - name: Full-tree audit (dev included) — REPORT, NOT A GATE
        continue-on-error: true
        run: pnpm audit --audit-level high
```

## Test plan

**`bash .github/scripts/check-audit.test.sh`** — the `expect <name> <exit> <text>` harness from
`check-action-pins.test.sh:14-24`, fixtures in `mktemp -d` under `trap 'rm -rf' EXIT`, each case a
crafted report + allowlist passed via `--report` / `--allowlist`. **Offline**, like its sibling
(`check-action-pins.test.sh:1-3` makes the same split: the offline behaviour is self-tested, the
networked path is exercised by CI).

Pass (exit 0):

1. empty report, all counts zero → `Production audit OK`
2. moderate-only advisory → 0, counts printed
3. high + matching unexpired entry → 0 **and** a `::warning::` naming the GHSA
4. high + entry expiring in 10 days → 0 and `expires in 10 day`

Fail (exit 1): 5. critical, no allowlist → names the GHSA, the package and the patched range 6. high, no allowlist 7. high + an entry for a _different_ GHSA 8. entry expired yesterday → `expired` 9. entry `expires` 120 days out → `at most 90 days` 10. entry matching nothing in the report → `stale` 11. entry `package` disagrees with the advisory 12. entry `severity` disagrees (advisory re-scored critical) 13. `reason` missing; `reason` of 10 chars 14. duplicate `ghsa` 15. `debt` pointing at a nonexistent file 16. unknown key in an entry

Could-not-check (exit 2): 17. stdout is `ENOTFOUND registry.npmjs.org` → `not a verdict` 18. advisories present, `metadata` absent 19. **`metadata` says 1 high, advisory list empty** — the vacuity case, and the one that protects
against a future pnpm output change 20. allowlist file missing

**Local:** `pnpm run audit:check`, and `pnpm verify` end-to-end (`AGENTS.md:316` budgets ~35s; the
audit was already in it, so the number does not move).

**CI:** the self-test step and the audit step in `quality`, on this PR. `actions:check --resolve`
fires automatically because the PR touches `.github/workflows` (`ci.yml:39-41`, `:51-53`).

**Negative proof the gate is real — do this before merge.** On a scratch branch, add a dependency with
a known high `--prod` advisory, push, and watch `quality` go red at the audit step; then add an
allowlist entry and watch it go green with a warning; then set the entry's `expires` to yesterday and
watch it go red again. Three pushes. Without this, the PR ships a gate nobody has seen fire — which is
how `tech-debt.md:288-301` ended up with five claimed-but-absent checks, and `lessons.md:287-290`'s
_"whole feature shipped INERT with every gate green"_.

**After merge:** one `workflow_dispatch` run of `audit.yml`, green. A `schedule:` trigger only ever
runs the default branch's copy, so this is the first moment it can be proven.

## Preconditions to verify before coding

Each is one command, and each has a cheap fallback. None is load-bearing on the design.

| #   | Claim                                                                                                                                                                                         | How to check                                                                | If false                                                                                                                    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| P1  | `pnpm audit --prod --json` works from the lockfile alone, no `node_modules`                                                                                                                   | in a fresh clone with no install: `pnpm audit --prod --json \| head -c 400` | `audit.yml` keeps its `Install` step (~1 min). `quality` is unaffected — `ci.yml:250-251` installs anyway.                  |
| P2  | the report shape is `{ advisories: { <id>: { github_advisory_id, module_name, severity, findings[].paths, patched_versions, url } }, metadata: { vulnerabilities: {…} } }` under pnpm 11.13.1 | `pnpm audit --json \| jq 'keys, (.advisories \| to_entries[0])'`            | adapt the parser; the coherence check in step 2 exists precisely so a shape surprise fails loudly instead of passing        |
| P3  | `pnpm audit:check` resolves to the script, not the built-in `audit` command                                                                                                                   | `pnpm audit:check` after adding it                                          | rename to `deps:audit`; document `pnpm run audit:check` either way                                                          |
| P4  | a failed scheduled run actually reaches a human                                                                                                                                               | force one failure after merge and look for the email                        | fall back to checking the Actions tab in the weekly session, and file `issues: write` + an issue-filing step as a follow-up |

Also worth a look while there: `pnpm audit --ignore-registry-errors` and `auditConfig.ignoreGhsas`.
Neither is needed — the exit-2 contract is better than silently passing, and the allowlist carries
metadata `ignoreGhsas` cannot — but if `ignoreGhsas` exists, the guard could emit it so a plain
`pnpm audit` agrees with `audit:check`.

## Risks / rollback

| Risk                                                                                                                             | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A new advisory reds every open PR through no author's fault.** The headline objection (`plan.md:540-541`).                     | It is the correct behaviour — a known high in the production tree _should_ stop merges. The cost is bounded by three facts: `--prod` advisories arrive at ~3/5wk; nine of thirteen cleared with a lockfile bump alone ([sweep](../changelog/2026-10-06-fix-deps-audit-sweep.md):1); and nothing is a required check, so the maintainer can always merge red (`AGENTS.md:331-333`). The allowlist covers the unfixable case. |
| **An unfixable prod high wedges `main`.** The 2026-10-03 state, for real.                                                        | The allowlist, in the same PR, with a reason and a ≤90-day expiry.                                                                                                                                                                                                                                                                                                                                                          |
| **The expiry itself wedges `main`.**                                                                                             | `::warning::` on every run plus a 14-day countdown; the daily run trips first.                                                                                                                                                                                                                                                                                                                                              |
| **Registry outage.**                                                                                                             | exit 2 ≠ exit 1. Lenient only on PRs that touch no dependency input; strict on `main` and on any dependency change.                                                                                                                                                                                                                                                                                                         |
| **The gate goes vacuous after a pnpm output change.** The worst outcome, because it looks fixed.                                 | The coherence check (step 2) and case 19 of the self-test.                                                                                                                                                                                                                                                                                                                                                                  |
| **V9 reds `main` the day upstream ships a fix.**                                                                                 | True, deliberate, and the message is the one-line edit.                                                                                                                                                                                                                                                                                                                                                                     |
| **`guards:test`'s seven suites are still CI-unverified.**                                                                        | Out of scope by Decision 4, filed as DX-5(b). The new guard's own self-test _does_ run in CI.                                                                                                                                                                                                                                                                                                                               |
| **GitHub disables scheduled workflows after ~60 days of repo inactivity.**                                                       | At ~4h/wk this should not trigger; and if it does, `quality` on push to `main` still audits every merge, so the schedule's loss degrades coverage to per-merge rather than to zero. Noted in `docs/tech-debt.md`.                                                                                                                                                                                                           |
| **This PR's own `e2e` smoke runs.** `.github/workflows/**` and `.github/scripts/**` are outside `ci.yml:336-344`'s `INERT` list. | Accepted: minutes of runner time, and arguably correct — a change to the gates is not inert. Do **not** add `.github/audit-allowlist.json` to `INERT`: a suppression should never be classed as a change that proves nothing.                                                                                                                                                                                               |

**Rollback:** delete the two `ci.yml` steps and `audit.yml`, and restore `package.json:25`. The guard,
its self-test and the empty allowlist can stay — harmless and local-only, i.e. precisely the state
SEC-5 is about, which is why the rollback is the _workflow_ edit and not the guard.

## Alternatives considered and rejected

1. **A one-line `pnpm audit --prod --audit-level high` step, no guard.** What `plan.md:538` first
   proposes, and what this plan would be if the `braces` class did not exist. Rejected: no exception
   mechanism at all, so the first unfixable prod high wedges `main` with no edit that unwedges it; and
   no way to distinguish "found nothing" from "could not reach the registry", so an outage is a merge
   outage — the thing `plan.md:543` explicitly asks us to avoid.
2. **`pnpm.auditConfig.ignoreGhsas` as the allowlist.** Tempting on reuse grounds. Rejected: silent,
   unexpiring, no staleness check — `.squawk.toml:22-27`'s fate.
3. **A `ci-skip-audit` label.** See Decision 3. The idiom is right for scope, wrong for vulnerabilities.
4. **Annotate instead of block** (`plan.md:542`'s open question). Rejected for `--prod` high+:
   annotations are what we already have — three of them, each found by accident. Accepted for the dev
   tree and for allowlisted advisories, where a decision has already been taken and recorded.
5. **Gate the whole tree.** Wedges on day one (`tech-debt.md:482-489`).
6. **A new `audit` job in `ci.yml`.** Rejected for the reason `ci.yml` gives three times (`:72-74`,
   `:193-195`, `:228-229`).
7. **`schedule:` on `ci.yml`.** Drags `e2e` and `gitleaks` into a daily run; needs an `if:` on every job.
8. **Dependabot security updates as the mechanism.** Complementary, not a gate: it opens PRs, it does
   not stop one. `SECURITY.md:86-87` already lists Dependabot _and_ a `pnpm audit` gate as two things.

## Out-of-scope / deferred

- **`skills:check`, `guards:test`, `status:check` in CI** → DX-5(b) (`plan.md:615-621`), narrowed by
  this PR to those three. Decision 4 has the reason.
- **Required status checks / branch protection** → DX-5(a). This gate blocks by convention, like every
  other check in the repo (`AGENTS.md:331-333`).
- **Moderate-severity gating**, and gating the **dev** tree. Report-only, by Decision 2.
- **Filing a GitHub issue from the scheduled run.** Needs `issues: write` plus dedupe logic; the
  failed run is the signal until P4 says otherwise.
- **Clearing `braces` / `esbuild`.** Upstream-blocked, with promotion triggers already recorded at
  `tech-debt.md:493-494`.
- **CodeQL on PRs** — a different gate, deliberately not a PR check (`codeql.yml:5-9`).
- **The Neon-branch migration apply** — the other unwired gate (`tech-debt.md:288-301`), untouched.

## Open questions

1. **One PR or two?** ~450 non-doc lines against `AGENTS.md:192`'s "<400" target, ~150 of it the
   self-test. I recommend **one**: `audit.yml` is 55 lines invoking the identical guard, and a second
   review round over the same mechanism costs more than it saves. Documented fallback — **PR 1**:
   guard + self-test + the two `ci.yml` steps + `audit:check` + hold-the-bar + docs (~400); **PR 2**:
   `audit.yml` + the DX-5(b) narrowing (~70). PR 1 alone already closes the headline bug and audits
   every merge to `main`; PR 2 narrows the quiet-stretch gap from "next merge" to 24h and is what sees
   an allowlist expiry first.
2. **Daily or weekly cron?** Daily argued above; weekly is a one-line change.
3. **`.github/audit-allowlist.json` or root `.audit-allowlist.json`?** `.github/` chosen (next to the
   guard that reads it); `.squawk.toml` is at root only because `squawk-cli` demands it.
4. **90-day max expiry and the 14-day warning window** — longer than the ~fortnightly upstream cadence
   that cleared 11 of 13 findings, shorter than a quarter so an exception cannot outlive the reasoning
   behind it. Numbers worth a second opinion.
5. **Preconditions P1-P4** must be run before coding.
6. **`docs/plan.md`, `docs/status.md`, `docs/roadmap.md`** are owned by a parallel lane in this
   session; sequence those edits with it.

## Review-response log (adversarial panel)

_Empty — the panel has not run. Per [plans/README.md](./README.md), this plan gets the four standing
lenses (correctness & data integrity · simplicity & scope · architecture & consistency · code reuse),
plus a **security** lens as SEC-1 and SEC-2 both got. No UX panel: nothing user-facing. Each material
critique is recorded here as **accepted** (what changed) or **rejected** (why) before implementation._
