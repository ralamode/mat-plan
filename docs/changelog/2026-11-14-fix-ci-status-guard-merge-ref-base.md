- **2026-11-14** — **CI's PR guards compare against the `main` the PR was merged with**
  ([plan](../plans/ci-pr-base-merge-ref.md), [lessons](../lessons.md) → CI / secrets). #388, a docs
  branch, failed the status guard as "a feat branch" because #387's `feat` landed on `main` after the
  PR event was created: CI checked out a merge ref that contained it, while six steps diffed against
  the event's older `base.sha`. One "Resolve PR base" step now hands all six the merge ref's first
  parent, and refuses (exit 2) a checkout that is not the merge ref. Closes the deferral recorded as
  C2-2 in [dx-5b](../plans/dx-5b-local-gates-in-ci.md).
