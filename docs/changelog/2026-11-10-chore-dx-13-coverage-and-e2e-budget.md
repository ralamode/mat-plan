---
id: DX-13
pr: pending
---

## Unit coverage is measured after merge, and it gates nothing

`pnpm --filter web test:coverage` produces a v8 report; `.github/workflows/metrics.yml` publishes the
summary to the run's job summary on every push to `main`. First measurement: **71.47% statements**
(2200/3078), 67.38% branches, 64.86% functions, 72% lines, over 171 files.

🔴 **It cannot become a gate, by construction rather than by policy.** The workflow has **no
`pull_request` trigger at all**, so it never appears in a PR's check list — not even as the grey
"skipped" row a push-gated job inside `ci.yml` would leave. There are **no thresholds**, and no
per-PR delta is computed. A reviewer still judges a diff by reading it.

## The number is honest, which took more care than measuring it

**`coverage.include` is the denominator, and it is explicit.** Coverage that counts only files which
already have tests flatters: adding an untested module makes the percentage go **up**. Listing files
explicitly counts them whether or not a test touches them — **46 files currently read 0%**, six of
them in `packages/*/src`, and that is the point.

⚠️ **There is no `all: true` option in vitest 5**, which the first draft of the plan was built on and
defended in prose. `CoverageOptions` has no such key — the only `all?: boolean` in the type file
belongs to istanbul's `FileCoverageData`. Since vitest 4, an explicit `include` **is** that switch.
Had it shipped it would at best have been ignored while a comment claimed an honest denominator.

**Every glob is extension-qualified.** A bare `app/**` sweeps in `globals.css`, `token-sets.css` and
`favicon.ico`; each then reports as **100%** (a 0-statement file is 0-of-0) or is dropped with an
`Excluding it from coverage` log line at **exit 0** — a wrong number on a green run.

**Two exclusions, both load-bearing.** `**/*.test.{ts,tsx}`, and `lib/dal/recording-db.ts` — test
support living in a production directory, whose own docblock says "TEST SUPPORT ONLY; nothing in the
app imports it". `lib/**` would otherwise count a file the app never runs and the tests exercise
thoroughly, inflating the figure by exactly what an honest denominator exists to prevent. Nothing
else is listed: an exclusion that can never match reads as a decision while doing nothing.

## "Could not measure" is never reported as a pass

Six independent assertions fail the run, each probed by breaking it on purpose: the test run exits
non-zero; `coverage-summary.json` is missing or empty; the summary names no `apps/web/` file; it
names no `packages/` file; the log contains `Excluding it from coverage`; or the log has no
`Coverage summary` block at all (`sed` with no match exits 0, so the published fence would go
silently empty).

🔴 **The first of those needed an explicit `shell: bash`, and a review found it missing.** GitHub's
default shell for a `run:` with no `shell:` is `bash -e` — **without** `pipefail` — so
`vitest | tee` exits with `tee`'s status, always 0. Probed: a test file that **passes** while leaking
an unhandled rejection makes vitest exit non-zero, and the step was green anyway. The other five
conditions cannot catch that case, because `reportOnFailure` only suppresses the report when a test
actually _failed_. A comment claiming `pipefail` protection was there before the mechanism was.

🔴 **The fourth exists because of the third, and an earlier draft would have missed it.** That draft
required "no `apps/web/` **and** no `packages/`" — a conjunction. The case it was written for is a
mis-rooted `../../packages/*/src/**` glob, which leaves every `apps/web` key in place, so it would
have published a green number over a silently smaller denominator. Each condition is now its own
assertion. Probing them also caught a real bug in the workflow: `require()` on a path not starting
with `./` is treated as a **module name**, so the check would have thrown `MODULE_NOT_FOUND` every
run instead of measuring anything.

⚠️ **Nobody has confirmed a red post-merge run reaches a human.** `SEC-5b` is gated on exactly that
question and owns the answer; this inherits it rather than assuming one. Do not cite the fail-loud as
a control until SEC-5b closes.

## What earns an end-to-end test, written down where the rule already lived

The Definition of Done's **Speed budget** gains the test: _can the behaviour be proven below the
browser?_ If it can, it belongs lower. Only real navigation and redirects, **native or implicit form
submission** (jsdom implements none, which is why `PROF-1 a-1d`'s hidden submit sentinel could only
be proven end to end), overflow and tap-target geometry at a width, focus moving across a real
document, and a Server Action round trip cannot. Prefer extending an existing spec's flow to adding a
`test()`; a new spec **file** now has its own DoD checkbox asking for a reason.

It went there rather than into AGENTS.md because `definition-of-done.md` already half-stated it, and
AGENTS.md is **4,748 words against DX-10's accepted ≤4,000 ceiling** — DX-10 had just cut that file
29% on "rules stay, stories move". Baseline for the suite as this lands: `playwright test --list` →
**87 tests in 13 files**.

## Three documents would have become false, and are corrected here

- `.claude/skills/review-pr/SKILL.md` said **"There's no coverage tool"** — the single sentence every
  reviewer is told to follow, literally false the moment this merges, and `skills:check` validates
  paths and scripts, not prose. It now says the number measures `main` after merge and is not
  evidence about a diff.
- The same file's red-flag list gains the **inverse**: citing the post-merge number as evidence about
  a PR.
- `AGENTS.md` carried **"No coverage drop on changed files"** — unenforceable prose that starts
  reading as _wired_ the instant a coverage tool exists, while no delta is ever computed. Deleted.

The fact itself is stated **once**, in AGENTS.md's gate list, because that section is already "the
one list of where each gate runs"; the other three sites point at it.
