# PERF-1 (b) — a per-route client JavaScript budget that fails CI

> Backlog: [plan.md](../plan.md) row `PERF-1`, part **(b)** (`docs/plan.md:1778-1784`). Branch:
> `docs/perf-bundle-size-plan` (it carries the plan's PR, #713, and the build, so it keeps its pushed
> name). Debt it closes: [tech-debt.md](../tech-debt.md) → "🔴 PRIORITY — nothing
> measures how much JavaScript ships" (`docs/tech-debt.md:363-413`).

## Where this sits

- **Pillar:** Platform (`docs/roadmap.md:35` lists `PERF-*`). **Milestone:** none. `PERF-1` is
  "Before Beta 1", and the tech-debt entry says it does not block Beta 0 (`docs/tech-debt.md:405-408`).
- **This PR:** all of `PERF-1` (b). **Next:** `PERF-1` (a), real-user monitoring, which is blocked on
  the `connect-src` decision (`docs/plan.md:735-741`). After that comes `PERF-2`, Lighthouse
  (`docs/plan.md:1786-1789`).
- **Roadmap:** `PERF-1` goes into "In flight" while this PR is open and moves to "Recently landed"
  when it merges, recorded as (b) only. (a) does not move.
- _Roadmap alignment (2026-11-19): advances `PERF-1` (b), which already owns this question, and takes
  its acceptance verbatim. Leaves (a) and `PERF-2` alone. Gates nothing. It also supplies the
  "measured before/after bundle delta" that `docs/plan.md:857` asks for. Checked against the private
  roadmap; nothing to add here._

## Goal

AGENTS.md sets a Core Web Vitals budget, and nothing measures it. Most of that budget cannot be
measured in CI: p75 is a statistic over real users, and INP needs real interaction
(`docs/tech-debt.md:369-375`). Bytes can be measured. This PR records how much client JavaScript
each route loads on first visit, and how much client JavaScript the build emits in total. It compares
both with a committed baseline and fails CI when either moves past a tolerance. The output is
**route, before, after, delta**, so a reviewer reads "this PR adds 48 KB to the day page" rather than
waiting for someone to notice on a gym floor.

## 🔴 The tech-debt entry's premise is out of date for Next 16; this plan uses what replaced it

The entry says _"`next build` already prints **First Load JS per route**"_ (`docs/tech-debt.md:376`).
On the pinned Next (`apps/web/package.json:38`, `16.4.5`) that is false. The upgrade guide says
_"Next.js 16 removes the `size` and `First Load JS` metrics from the `next build` output"_
(`node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md:1003`; repeated in
`…/06-cli/next.md:440`). The printed table's header has no size column
(`next/dist/esm/build/utils.js:186-190`).

What replaced it: after a Turbopack build (`next/dist/esm/build/index.js:2854-2856`), Next writes
**`.next/diagnostics/route-bundle-stats.json`** (`next/dist/esm/build/route-bundle-stats.js:5,128-138`),
one row per route: `{ route, firstLoadUncompressedJsBytes, firstLoadChunkPaths[] }`. This app builds
with Turbopack (`apps/web/next.config.ts:55-57`). I read the file from an existing 16.4.5 build in
another worktree. It has 16 routes, ranging from `/` at 691,968 B to `/design/program` at 1,122,149 B.
`/p/[profileId]` is 1,009,905 B uncompressed (308,333 B gzipped).

⚠️ **The file is undocumented.** It appears nowhere in `next/dist/docs`. **The guard uses it only for
two things: the list of routes, and each route's list of chunks.** It sums the bytes itself with
`stat` and ignores `firstLoadUncompressedJsBytes`. That one choice closes the writer's silent
`// ignore missing files` (`:19`). The writer also has two quiet omissions the guard has to catch:

| Writer behaviour                                                   | What the guard does                                                                               |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| A route with no client-reference manifest is skipped (`:104`)      | Number of `/page` manifest keys (minus `/_global-error/page`) must equal the number of stats rows |
| With no app-paths manifest, no app rows are written at all (`:93`) | The same count check, plus refusing zero rows                                                     |
| `/_global-error` is always filtered out (`utils.js:96-100`)        | The one exception in the count check, written as a literal                                        |

## Acceptance

- Verbatim (`docs/plan.md:1782-1783`): _"**(b)** A client-bundle size budget per route that fails CI
  when exceeded, so a dependency's cost is seen in the PR that adds it."_
- Done when:
  1. Whenever CI's `quality` job reaches the new step, it measures every route plus an
     `(all client chunks)` row and compares each with the PR's `.github/bundle-baseline.json`. A move
     of more than **8 KiB** (8,192 B, uncompressed) **either way** exits 1. Each such route gets an
     `::error::` with the route and the delta.
  2. The step summary **always has a status line**. Whenever there is a measurement, it also has the
     table: `route | before | after | delta | vs main's baseline`.
  3. A baseline the PR changed is reported with `::warning::` and in a "Baseline changed in this PR"
     section, and it must equal this run's measurement or the step exits 1. That is how a raise is
     both deliberate and visible.
  4. A skipped Build gives `::notice::bundle size not measured (docs/tooling-only change
(changed-scopes.mjs)); job still reports success.` and exits 0. It never says "pass".
  5. `check-bundle-size.test.sh` runs in `guards:test` and covers every case in the Test plan table.
  6. RED probe 2 ran on this PR's own CI, and all three runs (the two red variants and the revert) are linked from the PR
     description.

## File-by-file changes

| Path                                                      | Change | What & why                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/scripts/check-bundle-size.mjs`                   | NEW    | The guard: plain node, no dependencies, about 170 lines. **Its header comment is the one home** for what is measured, what is not (CWV timings, CSS, server code, Clerk's CDN scripts), the tolerance and the exit codes.                                                                                                     |
| `.github/scripts/check-bundle-size.test.sh`               | NEW    | Offline self-test against crafted `.next` trees in `mktemp -d`, in the `check-audit.test.sh:20-28` style plus `check-skills.test.sh:137-142`'s `pure` harness. About 150 lines.                                                                                                                                               |
| `.github/bundle-baseline.json`                            | NEW    | The committed baseline, next to `.github/audit-exceptions.json` (`check-audit.mjs:54`). About 25 lines.                                                                                                                                                                                                                       |
| `.github/workflows/ci.yml`                                | EDIT   | Add `id: build` to Build (`ci.yml:430-435`) and one step after it (shape below).                                                                                                                                                                                                                                              |
| `package.json`                                            | EDIT   | Append the test to `guards:test` (`package.json:40`). **No `bundle:check` script**: the guard has no local use, and CI calls node directly.                                                                                                                                                                                   |
| `AGENTS.md`                                               | EDIT   | One pointer line, no numbers: "bundle size (CI-only; the guard's header)" added to the CI-checks list (`:343-345`) and to "Not covered by it" (`:337`), next to `next build`.                                                                                                                                                 |
| `.claude/skills/review-pr/SKILL.md`                       | EDIT   | Dimension 11 (`:169`): drop the copied CWV numbers and point at AGENTS.md. Cite the step's delta and "vs main's baseline" column, plus any `baseline … raised` line. In "Merging a PR that is behind" (`:300-312`), add: a `main` commit that moved bundle size is **not unrelated** (R6).                                    |
| `.github/SECURITY.md`                                     | EDIT   | One line under Supply chain (`:349`): the guard, its baseline and its step are all controlled by the PR (the same residual the pin checker accepts), so a diff to any of them is a review flag. `run_build` cannot be reclassified by the PR, because the base's copy of `changed-scopes.mjs` decides (`scopes-step.sh:4-7`). |
| `docs/principles.md`                                      | EDIT   | `:75-77`: (b) is enforced by CI now; (a) and `PERF-2` stay planned.                                                                                                                                                                                                                                                           |
| `docs/architecture.md`                                    | EDIT   | CI diagram: add "bundle size" to the `quality` node (`:849`). Drop the "(required)" labels on `:849` and `:855`, which AGENTS.md:343 contradicts ("none is a required status check").                                                                                                                                         |
| `docs/tech-debt.md`                                       | EDIT   | Close the entry and record the Next 16 premise change. Its stale cites (`ci.yml:362` should be `:430-432`; `pages-need-a-session.test.ts:321` should be `:271`) go away with it.                                                                                                                                              |
| `docs/plan.md`, `docs/roadmap.md`, `docs/status.md`       | EDIT   | Link this plan from `PERF-1` and mark (b) done. Roadmap as in § Where this sits. Status only if its pointer moves.                                                                                                                                                                                                            |
| `docs/changelog/2026-11-19-docs-perf-bundle-size-plan.md` | NEW    | The fragment.                                                                                                                                                                                                                                                                                                                 |

No feature guide owns any of these paths (grep of `docs/features/*.md`).

### `.github/bundle-baseline.json`

```json
{
  "next": "16.4.5",
  "routes": { "(all client chunks)": 0, "/": 691968, "/p/[profileId]": 1009905 }
}
```

The numbers are illustrative. The committed numbers come from CI's first run (R2). `next` is **not a
copy of the `package.json` pin.** It records which Next produced these numbers, so a reader of a later
diff can tell framework growth from app growth. The guard prints it but never gates on it.

### `check-bundle-size.mjs`: the contract (summarised; the header comment is the canonical text)

```
node .github/scripts/check-bundle-size.mjs [--next-dir apps/web/.next] [--summary <path>]
env: BUILD_OUTCOME (steps.build.outcome), BASE_SHA (steps.base.outputs.sha), GITHUB_ACTIONS
exit 0 pass / not measured · 1 budget or baseline violation · 2 cannot measure (any throw)
export const TOLERANCE_BYTES = 8 * 1024
```

**Invariants:** the guard **reads JSON from `.next` only and never imports or `require`s from it**.
The project directory is `--next-dir`'s parent. A whole-body `try/catch` turns any throw into exit 2,
so a crash can never look like a pass. It runs only when it is the main module, using
`changed-scopes.mjs:130`'s `realpathSync` comparison, so the test can import it.

1. **Skip.** `BUILD_OUTCOME == 'skipped'` prints the notice above and exits 0. With any other value,
   or with none (a local run, which `GITHUB_ACTIONS` unset identifies), the guard measures.
   `failure`/`cancelled` exit 2. That is defence in depth only, because the step has the implicit
   `success()` and does not run after a failed Build.
2. **Shape.** `diagnostics/route-bundle-stats.json` has to be a non-empty array. Each row must have
   **exactly** the keys `firstLoadChunkPaths, firstLoadUncompressedJsBytes, route` (sorted and
   joined), checked the same way and with the same wording as `check-audit.mjs:90-92`:
   `… must have exactly [..]; has [..]`. `route` has to be a string and `firstLoadChunkPaths` a
   non-empty `string[]`. If anything fails, exit 2.
3. **Count.** From `server/app-paths-manifest.json`, take the keys ending in `/page` and remove
   `/_global-error/page`. Their count must equal the number of stats rows, or exit 2. There is no
   normalising: the count does not care what a segment looks like. If the manifest is missing, exit 2.
4. **Bytes.** For each route, the guard sums `stat().size` over its chunk paths, taken relative to the
   project directory. The `(all client chunks)` row sums every `.next/static/chunks/**/*.js` except
   `build-manifest.json` → `polyfillFiles`. That catches `dynamic()` code that no route's first load
   includes. Every path's `realpath` has to stay under `<project>/.next/static/`, and a missing file
   exits 2.
5. **Baselines.** The PR's baseline is read from the working tree; it must parse, and `routes` must be
   non-empty, or exit 2. When `BASE_SHA` is non-empty, the guard reads
   `git show "$BASE_SHA:.github/bundle-baseline.json"`. If the path is absent in the base
   (`git ls-tree` prints nothing), it reports "baseline introduced". If the base exists but the read
   fails, exit 2. On a push (`BASE_SHA` empty), the base column and steps 5a–5b are skipped.
   - 5a. Each route whose PR baseline differs from the base's gets
     `::warning::bundle: baseline for <route> raised by +N KiB in this PR` (or "lowered", or "added").
   - 5b. If the PR's baseline differs from the base's at all (or was introduced), **every entry must
     equal this run's measurement within `NOISE_BYTES` (256 B), or exit 1**. That stops padding a
     baseline to make room, and stops hand edits. U1 came back false (2–4 B between two CI builds of
     one app source, on three rows, 2026-11-19), so "exactly" became "within the measured noise",
     re-reviewed below.
6. **Compare** each measured row with the PR's baseline. A row that is new or missing exits 1, with
   "add it" or "remove it". If `|after − before| > TOLERANCE_BYTES`, exit 1, with
   `::error::bundle: /p/[profileId] +12.4 KiB (1,009,905 → 1,022,601); budget ±8.0 KiB`. A shrink fails
   too ("re-baseline: headroom would hide later growth"). If the `next` stamp differs from the
   framework.json version, print `Next 16.4.5 → 16.5.0` as a summary line and **still** draw the table.
   The tolerance governs framework growth like any other growth, so a Dependabot bump fails only if it
   moves a row past the tolerance.
7. **Summary.** A status line, then the table sorted by |delta| with the largest first, then a
   "Baseline changed in this PR" section if one applies, then the measured
   `{ next, routes }` JSON in a `<details>` block. **That block is the only way to update the
   baseline**: paste it in, commit, push.
   **Escaping:** `%`, `\r` and `\n` are percent-encoded in `::error::`/`::warning::` lines, and `|` is
   escaped in table cells. A route name comes from the PR's own file tree, so it is not trusted to be
   free of those characters.

### `ci.yml`: the new step (after Build)

```yaml
- name: Bundle size (PERF-1; .github/scripts/check-bundle-size.mjs)
  env:
    BUILD_OUTCOME: ${{ steps.build.outcome }}
    BASE_SHA: ${{ steps.base.outputs.sha }}
  run: node .github/scripts/check-bundle-size.mjs
```

The step has no `if:`. It runs whenever the job reaches it (the implicit `success()`), and the script
decides what a skipped Build means, so a skipped build can never look like a passing guard. Build is
skipped only when every changed file is `INERT` (`changed-scopes.mjs:30-38,75`). Those are docs, root
markdown and `.claude/`, none of which the bundler reads. A PR that only changes the baseline touches
`.github/`, so it always builds and runs the full CI (`changed-scopes.mjs:61-63,75`). The `base` step
already exists (`ci.yml:45-49`) with `fetch-depth: 0` (`ci.yml:37`). The job stays `contents: read`
(`ci.yml:17-18`), and no new action is needed.

## Alternatives considered and rejected

- **Parse the printed table.** On 16.x it has no sizes (above).
- **`.next/app-build-manifest.json` plus chunk sizes.** That file does not exist in a 16.4.5
  Turbopack build. Rebuilding Next's union of `entryJSFiles` and `rootMainFiles`
  (`route-bundle-stats.js:96-117`) would mean `require()`ing a manifest file that sets a global, which
  breaks the "JSON only" invariant. This is the fallback if Next drops the stats file, and it would
  need its own plan.
- **`next analyze --output` / `export`** (16.4+). It runs a second compile
  (`…/06-cli/next.md:229`), and it outputs a module graph rather than per-route totals. The failure
  message points to it as the tool for finding _why_ a number moved.
- **`size-limit` / `@next/bundle-analyzer`.** Either adds a new dependency to audit, and the analyzer
  only works with webpack (`…/package-bundling.md:144-176`).
- **Build the PR's base and diff the two builds.** That doubles build time and removes the committed
  approval step. Comparing against the base's _committed baseline_ (step 5) gets the base-relative
  view without a second build.
- **Gate on gzip.** It adds a dependency on the zlib version to an exact comparison. Uncompressed
  bytes scale with parse and compile cost anyway.
- **Post a PR comment.** That needs `pull-requests: write` on a job that runs PR code, and it fails on
  forks.
- **A percentage tolerance.** It gives the heaviest routes the most room, and those are the ones
  already overspending.

## The tolerance: 8 KiB uncompressed, absolute, both directions

The correctness lens measured the `cat-3-b3-i` build against the other branches built the same day:
**+7,829 B on `/design/program`, +3,965 B on `/p/[profileId]`, +1,556 B on every route.** So one
day's ordinary feature work comes close to 8 KiB on the heaviest route. **Re-baselining will be
frequent, and that is accepted**: each re-baseline is a paste plus one sentence, and it is the record
of what grew and why. A single small `'use client'` island, like the one `site-footer.tsx` became
(`docs/tech-debt.md:381-384`), shows in the table without failing. Several of them pile up against the
baseline until one PR crosses the line, and the table then shows the cumulative delta. A shrink fails
too. Otherwise unclaimed headroom stays in the baseline and later hides growth up to that size.

## Test plan

**Self-test (`check-bundle-size.test.sh`, offline, in `guards:test`).** Each case builds a fake
project with real chunk files of known sizes (`head -c N /dev/zero`) and a git repo, so that
`BASE_SHA` has something to point at. **The green fixture's manifest is the real 20-key one**,
copied literally, including `/sign-in/[[...rest]]/page`, `/favicon.ico/route`, the two route handlers,
`/_not-found/page` and `/_global-error/page`. Each case checks an exit code and a literal substring.
Expected numbers are written as literals, never computed by the guard (`docs/lessons.md` → "THE
RECURRING ONE"):

| Case                                                                                      | Exit | Must print                                                                 |
| ----------------------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------- |
| equal to baseline, real 20-key manifest                                                   | 0    | `\| / \| 1000 \| 1000 \| 0 \|`                                             |
| +8192 / −8192 (boundary)                                                                  | 0    | `+8.0 KiB` / `-8.0 KiB`                                                    |
| +8193                                                                                     | 1    | `::error::bundle: /p/[profileId]`                                          |
| −8193                                                                                     | 1    | `re-baseline`                                                              |
| `dynamic()`-only chunk grows 8193 (no route moves)                                        | 1    | `(all client chunks)`                                                      |
| stats file missing / `[]`                                                                 | 2    | `route-bundle-stats.json` / `no routes`                                    |
| extra or renamed key                                                                      | 2    | `must have exactly [`                                                      |
| chunk path missing on disk                                                                | 2    | the path                                                                   |
| chunk path escapes `.next/static/` (`../../x.js`, or a symlink)                           | 2    | `outside .next/static`                                                     |
| manifest `/page` count ≠ stats rows (the `:104` omission)                                 | 2    | `count`                                                                    |
| manifest missing / framework.json missing                                                 | 2    | the file                                                                   |
| baseline missing / malformed / `routes: {}`                                               | 2    | `baseline`                                                                 |
| row new / gone vs baseline                                                                | 1    | `add it` / `remove it`                                                     |
| Next stamp ≠ framework version, within tolerance                                          | 0    | `Next 16.4.5 → 16.5.0` **and** the table                                   |
| PR raised a baseline, equal to the measurement                                            | 0    | `::warning::bundle: baseline for` + `raised`                               |
| PR raised a baseline, ≠ measurement (padding)                                             | 1    | `must equal this run's measurement`                                        |
| base has no baseline file                                                                 | 0    | `baseline introduced`                                                      |
| `BASE_SHA` names a missing commit                                                         | 2    | `base`                                                                     |
| `BASE_SHA` empty (push)                                                                   | 0    | no `vs main's baseline` values                                             |
| `BUILD_OUTCOME=skipped`                                                                   | 0    | `bundle size not measured (docs/tooling-only change (changed-scopes.mjs))` |
| `BUILD_OUTCOME=failure`                                                                   | 2    |                                                                            |
| a route named `a\|b%0A` reaches the summary and `::error::` escaped                       | 1    | `a\|b%250A`                                                                |
| contract: `TOLERANCE_BYTES`, via `pure` (`node --input-type=module -e "import * as G …"`) | —    | `8192` (the literal, once)                                                 |

**RED probes.** Each `--expect` string is something the self-test prints **only on failure**
(`✗ <case name>`), never a substring that also shows up in a passing run.

1. `pnpm probe --file .github/scripts/check-bundle-size.mjs --from "> TOLERANCE_BYTES" --to "> Infinity"
--gate "bash .github/scripts/check-bundle-size.test.sh" --expect "✗ +8193"`.
2. **End to end on this PR's CI.** A throwaway commit puts a 16 KiB string literal into
   `components/layout/site-footer.tsx` (a client component imported by `app-shell.tsx`, `app/page.tsx`, `error.tsx`, `not-found.tsx` and `privacy/page.tsx`, but not by `/sign-in`) and makes it
   **reach the DOM** as a `data-probe` attribute, so tree shaking cannot remove it. A second variant
   puts the same literal behind `dynamic()`, so that only `(all client chunks)` should move. `quality`
   has to go red. **Record which routes actually moved**, rather than asserting "every route". Revert,
   go green, and link all three runs.

**Locally:** run only `bash .github/scripts/check-bundle-size.test.sh`, which is light. Do not build
to get numbers: the baseline comes from CI (R2), and `pnpm build` uses the one heavy slot.

## Risks / rollback

- **R1. A Next bump renames, drops or reshapes the stats file.** Steps 2–3 exit 2 and name the file.
  A Dependabot bump (`.github/dependabot.yml`) otherwise fails only if framework growth goes past the
  tolerance. The fallback is the manifest union (Alternatives).
- **R2. CI bytes and local bytes differ.** CI builds with only `DATABASE_URL` (`ci.yml:433-435`), but
  `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is inlined at build time (`apps/web/lib/env.ts:94-108`). So the
  baseline is always pasted from CI's summary. Production's absolute numbers differ from CI's by a
  constant, and the deltas are unaffected.
- **R3. Two builds of the same app source differ** (U1, confirmed 2026-11-19: 2–4 B on the
  all-chunks row, `/p/new` and `/settings`, between runs 44648199695 and 44650574370). The 8 KiB
  tolerance absorbs it; step 5b allows `NOISE_BYTES` (256 B), re-reviewed below.
- **R4. Creep is billed to whichever PR crosses the line.** Accepted; the cumulative delta is in the
  table.
- **R5. The check is not required.** No check is (`AGENTS.md:343`). The "CI green" bar in `review-pr`
  is what enforces it.
- **R6. Two PRs, each under the tolerance, can merge into a red `main`.** Each was green against the
  same baseline, but together they cross it, and the push run on `main` goes red. The fix is a
  re-baseline PR pasted from `main`'s summary. That PR touches `.github/`, so it runs the full CI. To
  stop this from happening silently, `review-pr`'s "behind `main`" rule says a commit that moved
  bundle size is not unrelated. Re-running a behind PR is cheap. Reusing the red-main issue machinery
  is out of scope (log).
- **R7. The guard, its baseline and its step are all PR-controlled.** A hostile PR can edit any of
  them. Step 5's warnings and the SECURITY.md line make such an edit visible in review. They are not a
  boundary, which is the same residual the pin checker accepts.
- **Rollback:** delete the step. Nothing depends on it.

## Out of scope / deferred

- RUM, INP, p75 → `PERF-1` (a). Lighthouse and lab LCP/CLS → `PERF-2`. Synthetic checks after deploy
  → `OBS-2`.
- **Clerk's CDN scripts.** Clerk loads its JS from its own origin, not from `.next/static`, so neither
  row counts it. It is listed in the guard's header as not measured.
- CSS, server bundles, route handlers.
- Explaining _why_ a row moved. The message points to `next analyze`.
- `persist-credentials: false` on the `quality` checkout: a separate PR (log).

## Open questions

- None blocking. U1 decides whether step 5b's "exactly" can stand.

## Unverified claims (the panel attacks these first)

- **U1. Determinism.** ❌ **Settled false (2026-11-19).** Runs 44648199695 and 44650574370 built the
  same app source (the commits between them touched only `.github/` and docs) and differed by 4 B
  on the all-chunks row and 2 B on `/p/new` and `/settings`. Step 5b allows `NOISE_BYTES`.
- **U2. CI's build writes the stats file** (the Turbopack branch, `index.js:2854`). ✅ **Settled
  true:** run 44648199695's build wrote it, and all 16 routes were read.
- **U3. The per-route sum matches what a browser fetches.** Probe: in Playwright, sum the JS bytes
  transferred for `/p/[profileId]` on a prod build. This affects the absolute numbers, not the deltas.
  The `(all client chunks)` row covers lazily loaded code whatever the answer turns out to be.
- **U4. The size of Recharts**, cited only as an example. No probe is needed; RED probe 2 is what
  proves the guard is sensitive.

## Size estimate

**As built:** the script is 435 lines (about 50 of them the header, which is the one home for the
rules) and the test 260, against estimates of 170 and 150. The baseline is 23 lines and `ci.yml` 10.
The docs come to about 60. That is roughly 790 lines plus this plan, well over the 400 estimate.
**The split trigger was answered no:** the `(all client chunks)` row stays, because Acceptance 1
requires it, and splitting it out would save only about 40 lines.

_Approved (maintainer, 2026-11-19, relayed by the board)._

## Review-response log (adversarial panel)

> Panel cost: not recorded in the relay. Models: high-stakes no (a CI step; no auth/schema) ·
> correctness: opus · scope: opus · architecture: opus · reuse: opus · security: opus.

| #   | Lens                                                      | Critique                                                                                                         | Verdict           | Resolution                                                                                                                                                                                                                                                                                        |
| --- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | security B1, correctness 1, architecture 2 (**blocking**) | The PR controls its own baseline, so a PR can raise or pad it silently and pass.                                 | accepted          | Step 5: compares with the base's baseline, adds a "vs main's" column, `::warning::` per raised route plus a section, and a changed baseline must equal the measurement; exit 2 on an unreadable base, "introduced" when there is none, push skips. Dimension 11 and SECURITY.md lines added (R7). |
| 2   | architecture 1, correctness 2 (**blocking**)              | The segment-normalising rule was invented, and it refused routes (`[[...rest]]`, groups) that Next handles fine. | accepted          | Replaced by a count check (`/page` keys minus `/_global-error/page` = number of rows). The green fixture uses the literal 20-key real manifest.                                                                                                                                                   |
| 3   | scope S1, security S1                                     | Stopping on a Next-version mismatch turned every Dependabot bump red before any table was drawn.                 | accepted          | The `next` stamp is kept as a record (why it is not a duplicated constant: § baseline). The summary prints "Next X → Y" and still draws the table; the tolerance gates framework growth.                                                                                                          |
| 4   | scope S3, architecture 8                                  | `RUN_BUILD` plus `BUILD_OUTCOME` was two signals for one fact.                                                   | accepted          | Only `BUILD_OUTCOME` is read. RED probe 2 is dropped. Local run detected by `GITHUB_ACTIONS`. `failure` handling kept as defence in depth.                                                                                                                                                        |
| 5   | scope S4                                                  | `--write` was a second way to produce the baseline.                                                              | accepted          | Dropped. The summary's `<details>` block is the only paste source.                                                                                                                                                                                                                                |
| 6   | scope N1, reuse N4                                        | Cross-checking Next's own byte count was redundant once the guard sums the bytes.                                | accepted          | The guard sums the bytes and ignores Next's number. The shape check reuses `check-audit.mjs:90-92`'s exact-keys wording. Probe 1b dropped.                                                                                                                                                        |
| 7   | scope N2                                                  | The "shared growth" line was guesswork.                                                                          | accepted          | Dropped.                                                                                                                                                                                                                                                                                          |
| 8   | correctness 3                                             | Code that only `dynamic()` loads is in no route's first load, so it grows unmeasured.                            | accepted          | `(all client chunks)` row added (step 4). Clerk's CDN scripts listed as out of scope and in the guard's header.                                                                                                                                                                                   |
| 9   | correctness 5                                             | A shrink that only warns leaves headroom that later hides growth.                                                | accepted          | A shrink past the tolerance fails, with a test case. This rejects the draft's Q2 "warning".                                                                                                                                                                                                       |
| 10  | correctness 6                                             | 8 KiB sits close to one day's measured drift.                                                                    | accepted          | 8 KiB kept, with the measured numbers cited. Frequent re-baselines accepted (§ tolerance).                                                                                                                                                                                                        |
| 11  | reuse S4, architecture 3, reuse N3                        | What is measured was described in four places.                                                                   | accepted          | The script header is the one home. AGENTS.md gets a pointer with no numbers (CI-checks list, "Not covered by it"). Dimension 11 points to AGENTS.md.                                                                                                                                              |
| 12  | reuse S2, architecture 3                                  | `bundle:check` had no local use, and AGENTS.md would then imply one.                                             | accepted          | Dropped. CI calls node, and the AGENTS.md line says CI-only.                                                                                                                                                                                                                                      |
| 13  | reuse S3                                                  | The tolerance pin was a grep, not an import.                                                                     | accepted          | `TOLERANCE_BYTES` exported and pinned through `pure` (`check-skills.test.sh:137-142`). Main-module guard per `changed-scopes.mjs:130`.                                                                                                                                                            |
| 14  | reuse S5, architecture 5, correctness 4, correctness 7    | Probe `--expect` strings also appeared in passing runs, and probe 3's literal could be tree-shaken out.          | accepted          | Every `--expect` is a `✗ <case>` string. Probe 2's literal (formerly probe 3) reaches the DOM through `data-probe`, a `dynamic()` variant was added, and the routes that moved are recorded.                                                                                                      |
| 15  | architecture 7, correctness 7                             | A crash or missing input could exit 0 or 1 instead of "cannot measure".                                          | accepted          | A whole-body `try/catch` gives exit 2. Cases added for missing manifest, framework.json and baseline, and malformed or empty baseline. Acceptance 2 now promises a status line, not always a table.                                                                                               |
| 16  | security N1, reuse N2                                     | Chunk paths come from PR-built output, and the annotations and table were not escaped.                           | accepted          | `realpath` containment under `.next/static/`, escaping, the "JSON only, never import from `.next`" invariant, project dir from `--next-dir`'s parent, flag dropped from `ci.yml`.                                                                                                                 |
| 17  | reuse S1, architecture 4                                  | `principles.md` and the architecture diagram would go stale.                                                     | accepted          | Rows added. The "(required)" labels at `architecture.md:849,855` are also fixed.                                                                                                                                                                                                                  |
| 18  | architecture 6, correctness 8                             | Two green PRs can merge into a red `main`.                                                                       | accepted          | R6: the fix is a re-baseline from `main`'s summary, and a line in review-pr's behind rule.                                                                                                                                                                                                        |
| 19  | architecture 8                                            | The roadmap move was unclear.                                                                                    | accepted          | In flight while open, then Recently landed; (a) does not move.                                                                                                                                                                                                                                    |
| 20  | reuse N1, scope N3                                        | The skip wording differed from the e2e notice, and one line was hard to read.                                    | accepted          | The notice copies the e2e step's wording (`ci.yml:500-505`). The prose was rewritten.                                                                                                                                                                                                             |
| 21  | security (outside the diff)                               | The `quality` checkout should set `persist-credentials: false`.                                                  | **rejected here** | A real issue, but outside this diff. It is a separate one-line PR that Native Scaling will open; already recorded at `sec-2-pin-actions.md:213`.                                                                                                                                                  |
| 22  | architecture 6 (sub-point)                                | Reuse the mutation-red issue machinery when bundle size turns `main` red.                                        | **deferred**      | Not in this PR. R6 documents the fix; adding an issue is a separate decision.                                                                                                                                                                                                                     |

### Implementation review (correctness lens on the build, 2026-11-19)

No P0. Each P1 was proven by a `pnpm probe` that came back GREEN before the fix and RED after it.

| #   | Severity | Finding                                                                                                                     | Resolution                                                                                                                        |
| --- | -------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| I1  | P1       | The escaping case's route had no baseline entry, so it never reached a table row; the match came from the `::error::` line. | Both routes get a baseline entry, and the case asserts the escaped table row. Probe on the cell's `esc()` is RED.                 |
| I2  | P1       | The `next` stamp's two branches (change warned; a changed stamp must equal the build's version) were untested.              | A case edits `next` to `16.4.6` and asserts both messages, exit 1. Both branches probed RED.                                      |
| I3  | P2       | Five shape refusals were untested: duplicate route, `polyfillFiles`, empty chunk list, framework version, baseline value.   | One case each (seven, counting both `polyfillFiles` and both baseline-value shapes). The duplicate check probed RED.              |
| I4  | P2       | A stats row named `constructor` exited 0 (inherited keys through `in`), and a row could overwrite `(all client chunks)`.    | A route must start with `/`; `Object.hasOwn` replaces `in`. Cases for both refusals and for a baseline entry named `constructor`. |
| I5  | P2       | Argument parsing ran outside the top-level `try`, so a bad `--next-dir` could crash rather than exit 2.                     | Parsing moved inside it; a flag with no value exits 2. Case added.                                                                |
| I6  | P2       | The over-budget `::error::` printed only `+8.0 KiB`, which reads as within an 8.0 KiB budget at the boundary.               | It also prints the byte delta (`+8,193 B`).                                                                                       |
| I7  | P2       | The plan named a branch, a fragment and a size that were not what was built, and left the split trigger unanswered.         | Branch, fragment name and size updated; the split trigger answered in § Size estimate; this sub-log added.                        |
| I8  | P2       | The roadmap row restated the mechanism and the tolerance; the roadmap is a pointer document.                                | Cut to the id, the PR and the column.                                                                                             |
| I9  | P2       | A route name containing a backtick run could close the `<details>` block's code fence.                                      | The fence is one backtick longer than the longest run in the JSON (at least three). Case added.                                   |

### U1 re-review (2026-11-19)

U1 came back false, so step 5b's "exactly" became "within `NOISE_BYTES` (256 B)", as the plan said it
would, and went back to the lens that raised B1 (security).

| #   | Lens     | Critique (short)                                                                                                                                            | Verdict      | Resolution                                                                               |
| --- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------- |
| U1a | security | Does 256 B reopen B1? No: a changed baseline is anchored to this run's measurement, so a pad is at most 256 B once per row and never stacks; each is warned | **holds**    | Kept 256; a smaller value trades a trivial headroom for a flake risk on one pair of runs |
| U1b | security | "Changed rows within noise, unchanged rows exact" is a no-op or a flake                                                                                     | **rejected** | Kept "every row within noise once any row changes"                                       |
| U1c | security | No case leaves a stale row beside a changed one                                                                                                             | **accepted** | "a stale row beside a changed one fails"                                                 |
| U1d | security | U2 appeared twice; this section said verdicts followed and none did                                                                                         | **accepted** | One U2 bullet; this table                                                                |
