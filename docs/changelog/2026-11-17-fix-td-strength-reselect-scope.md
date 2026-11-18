- **2026-11-17** — **A re-sent strength save can no longer land on another athlete's workout**
  ([plan](../plans/td-strength-replay-scope.md); tech-debt entry paid off). When a strength save is
  sent twice, the writer finds the first copy by its device id. It used to accept a match belonging
  to anyone, so a crafted request could attach one athlete's sets to another athlete's session, or
  be told a set was saved when it was not, or put one day's sets into another day's session. It now accepts only a match the request owns, and refuses
  anything else without writing. Reaching it needed a device id that the app never shows, so this
  closes a gap rather than an incident. A read-only count against production, to confirm no such
  row was ever written, is written up in the plan and has not been run.
