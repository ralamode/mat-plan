# How I work with agents

Most of the code in this repo was written by an AI coding agent. The commit trailers say so, and I'm
not going to pretend otherwise. This page is about the part that isn't visible in the trailers:
which decisions stay with me, how the agent's output is checked before it lands, and what happened
on the occasions the process got something wrong.

It is written for someone deciding whether I can be trusted with a codebase and a team that ships
with agents. The short answer I'd give in an interview: **I treat an agent like a fast, tireless,
confidently-wrong-sometimes engineer, and I build the review system I would build for that
engineer.**

## Who decides what

| I decide                                                                                       | The agent does                                                       |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| The product rules, including the one that isn't negotiable: **the model never authors a load** | Drafts plans, code, tests, migrations and docs                       |
| What is in scope and what is cut (at ~4h/week, cutting is most of the job)                     | Runs the adversarial review panels against its own drafts            |
| Which panel findings are accepted, and when a spec's rule is overridden                        | Reconciles each finding: incorporate it, or push back in writing     |
| Anything touching live data: which row is the keeper, when a correction runs against prod      | Writes the correction, dry-run by default, and rehearses it          |
| Whether a PR merges                                                                            | Opens it, with the gates run and the changelog/status in the same PR |

## The system, briefly

- **Rules the agent reads before it writes.** [AGENTS.md](../AGENTS.md) is the contract: the stack,
  the schema conventions, the "don't" list, and what each kind of PR owes.
- **Plans before code.** Anything that touches CI, a migration, auth or multi-file logic gets a
  committed plan in [docs/plans/](./plans/) first.
- **Adversarial panels.** Nine agents in [.claude/agents/](../.claude/agents/): eight reviewers,
  each with one lens (correctness, scope, architecture, reuse, DB safety, security, privacy, UX), plus
  a fact-sheet researcher that checks claims against the code. The reviewers are prompted to find flaws, not to approve.
  Every finding gets a written verdict in the plan's review-response log, and **the rejections stay
  committed**, because a rejected finding with a reason is the most useful thing a later reader can
  find.
- **Procedures as skills.** Twelve skills in [.claude/skills/](../.claude/skills/README.md) encode
  the task lifecycle (`start-task` → `plan-with-panel` → `ship-pr` → `review-pr`) and the risky
  tasks (migrations, Server Actions, data corrections). `hold-the-bar` checks whether a red check went
  green by lowering the bar: a new `@ts-ignore`, a skipped test, an assertion quietly removed.
- **Hooks for the rules prose couldn't hold.** "Every task in its own git worktree" lasted less than
  a day as a sentence in AGENTS.md. It is now a `PreToolUse` hook that refuses mutating git commands in
  the main checkout and prints the worktree command to run instead. It is a best-effort guard against
  the common forms, not a security boundary, and AGENTS.md says so.

## Five cases from the record

**1. A reviewer agent found that my safety arguments were citing gates that didn't exist.**
GAP-3's plan argued that a dangerous migration couldn't land because Squawk would fail it. The
DB-safety reviewer went to check and found no Squawk in CI at all. The audit that followed (#132)
found **five gates AGENTS.md had claimed for months and never wired**: Squawk, the forward-only guard,
CodeQL, `pnpm audit` and a Neon-branch apply. The two migration gates, forward-only (#133) and Squawk
(#135), were wired before the arc's first migration landed; CodeQL followed (#138). The other two are
still unwired. The lesson I took: rules written as the intended end state are claims, and claims need
re-verifying. That is why AGENTS.md now flags the two that still aren't with a ⚠️.

**2. I overrode the spec, knowingly, and wrote down why.**
The youth program alternates Day A and Day B, and its spec insists the letter comes from the count of
completed sessions, never the calendar. Calendar alternation means a missed day can repeat a workout.
I chose the calendar anyway: the program works on streaks and consistency, and the session-indexed
version needed schema that didn't exist yet. The override is recorded where the next reader (human
or agent) will hit it, so nobody "fixes" it, and the proper version is a backlog row (YDP-1).

**3. The agent pushed back on me, and was right.**
In V1-24 I asked to delete a read-only list on the logging screen. The plan rejected that, quoting
my phrasing: the list was the only mount point for the set editor and the sole renderer of four
other things. The plan demotes it into a collapsed `<details>` instead (PR 3b, not built yet). I'd rather work with a process
that can tell me no with a file reference than one that does whatever I said last.

**4. A panel finding was rejected, with the reasoning in the open.**
In the same plan the DB-safety lens asked for a one-off data correction to scope its UPDATE by
profile through the usual ownership subselect (E33). The author rejected it: the target was a unique
id taken from a committed read, with no request-supplied input and ownership already asserted, so
the attack that makes the subselect necessary in a request-handling writer had no path into a
hard-coded script. The rejection and its reasoning are in the log. Panels are input, not authority.

**5. When the agent got something wrong, the fix was a guard, not a promise.**
The DUALS-1 tournament sheet shipped with an 8-slot bracket mis-paired, which turned two real duals
into byes. They looked plausible on screen. The fix added a schema assertion
(`duals == poolTeamCount - 1`, #154), so a lost dual failed the build instead of rendering. (The
feature was later retired, in #167.) When the status log, hand-written from memory, had drifted from
the merge history and had to be reconciled (#156), the answer was `pnpm status:check` (#177), a local
check that a product branch touches the status record, rather than a note to be more careful. The pattern holds across the repo: a
failure that costs more than one attempt becomes a [lessons](./lessons.md) entry or a check.

## What this costs, honestly

- **Documentation outweighs code** right now: more lines of Markdown than of application
  TypeScript (tests aside). Some of
  that is the point (plans and logs are where the judgment is visible). Some of it is ceremony I'd
  cut on a team with a shared context. Plan-exempt changes exist for this reason, and the scope lens
  exists to say "this is too much process for this change".
- **Review is mine, locally.** The `@claude review` CI workflow exists but is dormant by choice. An
  agent reviewing an agent is a useful lens, but it isn't a second human.
- **No CI check is required yet**, so the bar is held by `review-pr` and by me, not by GitHub. That
  is recorded in AGENTS.md as a known gap, not presented as enforcement.

## Where to look

- A plan with a full review-response log, pushbacks included:
  [v1-24-form-is-the-day.md](./plans/v1-24-form-is-the-day.md).
- A panel that caught nine blocking findings before code existed:
  [v1-13-csv-export.md](./plans/v1-13-csv-export.md).
- The failure log: [lessons.md](./lessons.md). The accepted-shortcut ledger:
  [tech-debt.md](./tech-debt.md).
