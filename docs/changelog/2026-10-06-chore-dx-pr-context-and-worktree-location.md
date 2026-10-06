- **2026-10-06** — **Two conventions codified rather than left as session habits.** (1) **A PR that
  advances something larger now opens with a "Where this sits" block** — pillar, milestone (linked, so
  the overall plan is one click away), what this PR is within it, and what comes next including
  anything that next step is gated on. Four lines, carried by the PR template and filled by `ship-pr`
  from [roadmap.md](../roadmap.md) rather than from memory. The reviewer's problem is real: with six
  chunks across two lanes, a diff cannot say whether a PR is _the gate_ or _the payoff_ — #232 **was**
  the gate for chunk 2 and nothing in its files said so. ⚠️ **Deliberately NOT every PR.** A dependency
  bump, a one-off bug, a typo or a config one-liner **omits the section**; `Milestone: none` is noise,
  and a field that is empty half the time trains reviewers to skip it, which costs the signal on the
  half that matters. The test is whether you can name the milestone, spec or multi-PR track being
  advanced — a plan or spec PR counts, even though its type is `docs`. (2) **The worktree location
  gains a second sanctioned form.** `.claude/worktrees/<slug>` stays the default, and
  **`~/workspace/tmp<n>/mat-plan`** joins it for a parallel lane that will be opened in an editor — the
  nested gitignored path makes a file in one lane invisible from another checkout's window, which is a
  real cost once two lanes run at once. Numbered one per lane, removed once its PR ships so the number
  frees up. Writing it down clarified what the rule was always protecting: not the path, but that
  `git worktree list` **registers** the worktree, because that listing is the registry
  [parallel-work.md](../parallel-work.md) gate 1 is run against. Both forms satisfy it; `/tmp` fails
  for a different reason — wiped on reboot. The main-checkout guard only ever _suggested_ a location,
  so nothing needed unblocking; its message just stopped being wrong.
