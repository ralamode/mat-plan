- **2026-11-19** — **A programmed set's numbers can be changed only from the day page**
  ([plan](../plans/td-fix-a-set-window.md); tech-debt entry paid off). The older "fix a set" edit,
  from before programs existed, accepted a programmed set too, on any day and without the day page's
  checks (today or yesterday only, and not on a workout that has since been taken off or hidden). No
  screen offered it for a programmed set, so only a hand-crafted request could use it. It now refuses
  a programmed set, including one whose prescription was later deleted; an old strength session's
  sets stay editable as before. `db:verify` proves both refusals, and mutation patches `449` and `450`
  prove each check can fail.
