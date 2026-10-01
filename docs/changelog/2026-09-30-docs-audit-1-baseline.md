- **2026-09-30** — **AUDIT-1: the first baseline audit** ([report](../audits/2026-09-30-baseline.md)).
  `review-pr` in audit mode over the whole repo found **2 P0s**: V1-30 (7 of 9 offered units rejected by
  the server) and V1-27 (partial sets unsubmittable), both already filed. It also found **5 P1s**, among
  them: the access gate rests on undocumented Next behaviour for prefetch-flagged requests (probed, no
  bypass today, nothing pins it); a tag-pinned action in the job holding the **production database
  credential**; `audit --prod` running nowhere in CI; and a "Where we are" headline advertising
  removed routes. Every finding was verified before reporting, and the 10 doc-vs-code seeds from the
  skills README got verdicts. The fix queue is AUDIT-1 in [plan.md](../plan.md), one concern per PR.
