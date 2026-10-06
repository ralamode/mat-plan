- **2026-10-06** — **Two conventions codified rather than left as session habits.** (1) **Every PR now
  opens with a "Where this sits" block** — pillar, milestone (linked, so the overall plan is one click
  away), what this PR is within it, and what comes next including anything that next step is gated on.
  Four lines, carried by the PR template and filled by `ship-pr` from
  [roadmap.md](../roadmap.md) rather than from memory. The reviewer's problem it solves is real: with
  six chunks across two lanes, a diff alone does not say whether this is the gate or the payoff, and
  **"Milestone: none — standing debt, SEC-5" is a valid answer where blank reads as an oversight.**
  (2) **The worktree location gains a second sanctioned form.** `.claude/worktrees/<slug>` stays the
  default, and **`~/workspace/tmp<n>/mat-plan`** joins it for a parallel lane that will be opened in an
  editor — the nested gitignored path makes a file in one lane invisible from another checkout's
  window, which is a real cost once two lanes run at once. Numbered, one per lane, removed once its PR
  ships so the number frees up. The actual requirement was never the path: it is that
  `git worktree list` registers it, because that listing is what
  [parallel-work.md](../parallel-work.md) gate 1 is run against. `/tmp` is still out — wiped on reboot.
  The main-checkout guard hook only ever _suggested_ a location, so nothing needed to be unblocked;
  its message just stopped being wrong.
