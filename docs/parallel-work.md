# When can two tracks run in parallel?

A per-**track** checklist, the sibling of [definition-of-done.md](./definition-of-done.md)'s per-PR
one. Run it before starting work that will run alongside something else, not after a conflict.

A "track" here is a worktree — one branch, one PR, possibly one session.
`git worktree list` is the registry of what is in flight
([AGENTS.md](../AGENTS.md) → "Git & branch workflow").

## Gate 1 — the file globs are disjoint, guides included

**This is the gate that actually fails**, and it is the one a roadmap, a contract and a prototype all
pass without noticing. Check it first and mechanically:

1. List the paths each track will change — a plan's file table, or the spec chunk's named files.
2. Intersect them.
3. **Intersect the feature guides too.** `pnpm guides:check` fails a PR that touches an owned file
   without touching its guide (AGENTS.md → "Feature guides"), so two tracks editing different code
   under one guide **still collide on the guide**. This is the non-obvious half.

**Evidence, live right now:** Authoring chunk 2 threads a prescription public id through the log
form, and [v1-30b](./plans/v1-30b-form-stops-inviting.md)'s file table edits
`apps/web/app/p/[profileId]/strength-form.tsx` and `set-fields.tsx`. Both are owned by
[strength-logging.md](./features/strength-logging.md). Same file, same guide, two tracks — and every
other gate on this page is green for that pair.

Disjoint globs are also what a **pillar** means in [roadmap.md](./roadmap.md); it is not a theme, for
exactly this reason.

## The gates, and the three kinds

They are not all the same kind of thing, and conflating them is how "we have a contract ✓" gets
recorded when the contract cannot be built against.

| #   | Gate                                                               | Kind                 | How you check it                                                                                       |
| --- | ------------------------------------------------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------ |
| 1   | **Disjoint file globs**, guides included                           | mechanical           | intersect the path lists and the guides' `owns:`                                                       |
| 2   | **The contract is sufficient**, not merely present                 | artifact sufficiency | the **handoff test** — a session with the contract and its links builds the first slice without asking |
| 3   | **Blocking work is observed landed**, not merely merged            | observed landing     | read the run's **log**, not its green tick                                                             |
| 4   | **The closed questions are written down**                          | artifact sufficiency | the spec's "Decisions already made" section exists and names where each was settled                    |
| 5   | **The human decisions are made** — prototype **and** what it omits | human decision       | an enumerated list of unprototyped cases, each with a decision                                         |
| 6   | **Shared append-only files are sharded**                           | mechanical           | one file per change, never one file every track edits                                                  |

### 2 · The contract is sufficient, not merely present

AGENTS.md already gates a backend/UI split on the data contract existing. Existing is not enough.

**Evidence:** the Authoring spec had a `ProgramEditDTO` and its panel still found it unbuildable — no
`dayRole` and no block identity, so `idx` was ambiguous (`strength_a#0` and `strength_b#0` are both
`push-ups`) and the reorder payload could not be constructed at all; `target` was singular, so the
criterion about leaving siblings untouched had no siblings. A UI track handed that contract would have
guessed four times.

The test is the one [`write-spec`](../.claude/skills/write-spec/SKILL.md) uses: **could a session with
only this and its links execute the first slice without asking a question?**

### 3 · Blocking work is observed landed, not merged

"Merged" is not "applied". A dependent track starts when the dependency is **observed** in the place
it has to be.

**Evidence:** `.github/workflows/migrate.yml:52-54` —

```sh
if [ -z "$DATABASE_URL_UNPOOLED" ]; then
  echo "::warning::… skipping (Neon not wired yet)."
  exit 0
```

A **green** migrate job can mean nothing was applied. So Authoring chunk 2 waits on chunk 1's
migrate **log**, not its tick. The general form: name the observation, not the event — AGENTS.md's
"Do not cite an unwired gate as a safety argument" is the same rule pointed at CI.

### 3b · Read the repo from `origin/main`, not from a working tree

Same rule as gate 3, pointed at the other direction: **"merged" is not "what my checkout has."** A
working tree is a claim about the repo; `origin/main` is the repo. When lanes are in flight, several
checkouts exist at once and none of them is authoritative, so **read shared state with
`git show origin/main:<path>`** rather than opening the file.

**Evidence, 2026-10-07.** The main checkout was parked on a stale branch and then on a local `main`
that had **diverged** — one local commit, sixty-five behind — so `git pull --ff-only` refused rather
than fixing it, and the tree looked ordinary while being ~70 commits old. Reading it produced a
**confidently wrong collision analysis**: `app/page.tsx` appeared to import `listProfiles` (making
ONB-0 look like it collided with TEN-1's seam), when OSS-2 had long since moved the app behind a
landing page and that import no longer existed. The lanes themselves were fine, because
[AGENTS.md](../AGENTS.md) already requires a worktree to be cut from `origin/main` — only the _reads_
were wrong, which is exactly why this is worth writing down separately.

**The discipline, in three lines:**

- `git fetch origin` first, then cite and read `origin/main:<path>`. A stale read is worse than no
  read, because it is indistinguishable from a fresh one.
- **A line number from a working tree is not evidence.** Prefer `path:symbol`, which survives drift —
  the same rule [the `write-spec` skill](../.claude/skills/write-spec/SKILL.md) already records for
  citations.
- If a conclusion rests on a file's contents, **re-derive it against `origin/main` before acting**,
  and say which ref you read. "I read this at `origin/main@<sha>`" is checkable; "I read this file"
  is not.

⚠️ **The guard does not cover this.** `.claude/hooks/guard-main-checkout.mjs` blocks _writes_ to the
main checkout from a Claude session; it cannot stop a human committing there from their own terminal,
and it says nothing about reads. Detection is the only real control, and it belongs in
`session-context.mjs`: it already warns when the main checkout is on the wrong **branch**, which was
not the failure — the failure was being on `main` and **ahead** of `origin/main`, where `--ff-only`
cannot recover and nothing says so.

### 4 · The closed questions are written down

Parallel tracks diverge when a settled question quietly reopens in one of them.

**Evidence:** ADR 0005's item 0 said "nothing in items **1–2** can ship before it", its own round-2
log said "**1–3**", and the spec drafted from both said "**2–3**". Three ranges for one claim across
three documents, with no one track at fault. The fix is one home per decision plus a
"Decisions already made" list, which is why that section is now required.

### 5 · The human decisions are made — including what the prototype never showed

A prototype settles the cases it shows. The risk is the cases it does not, because an approved
prototype reads as approval of the whole surface.

So: **enumerate the unprototyped cases and decide each one, in writing, before the tracks split.**
A list with a decision per row — not "we'll work it out in review", which is where one track invents
an answer and the other invents a different one. The UX panel
([AGENTS.md](../AGENTS.md) → "UI PR rules") is where the enumeration gets argued; the decisions land
in the plan or spec.

### 6 · Shared append-only files are sharded

Two tracks appending to one file conflict every time, on content neither cares about.

**Evidence:** the repo already fixed this once. `docs/changelog/` is **one file per change**
precisely "so PRs never conflict on it" (AGENTS.md → "Status rides with the work", DX-2). Anything
else every track must append to — an index, a registry — wants the same shape.
[roadmap.md](./roadmap.md) is the deliberate exception: it is small, pointer-only, and tracks move
single rows, so a conflict there is a one-line merge.

## How many lanes? — the constraint is seam collisions and the serial path

⚠️ **This section said the opposite until 2026-10-07, and it was wrong.** It claimed _"the constraint
is review, not agents… at ~4h/week the human is the scarce resource"_, and derived a lane count from
how many plans were already panelled. The maintainer corrected it from experience: **review throughput
has not been the bottleneck.** The reasoning was plausible and untested, which is the failure mode this
whole document exists to catch — so the correction is recorded here rather than quietly swapped, and
the old rule's conclusion (open roughly as many lanes as there are panelled plans) should not be cited.

The six gates answer _may these two run at once_. The count of lanes is limited by two different
things, and neither is the reviewer:

1. **Seam collisions.** A seam is a contract two pillars share, and
   [roadmap.md](./roadmap.md) → Seams names them with one owner each. **A seam change does not
   parallelize**: while the owner is changing it, the consuming pillars wait. `TEN-1`'s household
   scope and the design tokens are the live examples — each touches every pillar that has a DAL call
   or a screen, so neither can run beside the work it reshapes. Two lanes are safe when their file
   globs are disjoint _and_ neither is moving a seam the other reads.
2. **The serial critical path.** Some work cannot be parallelized at all, because each step decides
   the shape of the next. Beta 0's is **the household-addressing ADR → `TEN-1` → `AUTH-1`**: the ADR
   decides where authorization comes from, `TEN-1` builds the one scoping seam, `AUTH-1` swaps that
   seam's implementation. Adding lanes to that chain does not shorten it. **The milestone ships when
   the chain ships**, so everything else is scheduled _around_ it, and the chain gets the best
   attention rather than the most agents.

So the practical rule: **run the critical path as one focused lane, and fill the remaining capacity
with work that is disjoint from it and from every seam it moves.** Two further heuristics that do hold:

- **Prefer work that blocks nothing and is already broken.** It is pure throughput and it cannot
  collide with a decision that has not been made yet. `ONB-0` (first run is broken today) is the
  pattern.
- **Start the hidden gates early.** Some work gates the critical path without appearing on it —
  `PRIV-1` gates `AUTH-1`, because the Google consent screen needs a privacy-policy URL. Those are the
  cheapest schedule wins available, and the most commonly missed, because nothing in the dependency
  graph draws them.

Planning in parallel early is still right, for a different reason than the old rule gave: its output
is what lets a lane start at all. A pillar with no plan is not a lane yet; it is a planning task.

## When a gate fails

**Do not parallelize.** Pick an order, write down why, and put it where the next session will see it —
the roadmap's "In flight", or the spec's chunk table.

Worked example, from the pair above: chunk 2 and `v1-30b` fail gate 1. `v1-30b` is already planned and
panelled and chunk 2 is not, so `v1-30b` goes first and chunk 2 rebases onto the form it leaves. That
is one sentence in the roadmap, and it is cheaper than discovering it in a merge.

A gate that fails **often** is a signal about structure, not discipline. If two pillars keep colliding
on one file, the file is doing two jobs — which is a refactor, filed as a row, not a scheduling problem
to be re-litigated every time.

## Keeping the rubric honest

Every gate on this page earns its place with a failure that happened in this repo. **That is the bar
for adding a seventh** — not "this could go wrong", but "this did, here, and here is the diff". When a
parallel-work failure costs more than one attempt to diagnose, it gets a row here and an entry in
[lessons.md](./lessons.md), same PR as the fix.
