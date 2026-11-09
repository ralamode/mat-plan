---
id: PROF-1 b
pr: pending
---

## PROF-1 b's plan, reshaped by four lenses before any code

`PROF-1 b` (archive + restore an athlete, and a new Household settings screen) was planned and
panelled on 2026-10-23, before `AUTH-1` completed and before `a-g`, `a-r` and `b-s` shipped. A UX
panel (interaction · a11y/360px · trust) plus a security lens ran against the refreshed repo. Four
findings were **BLOCKING**, and all four were things the plan asserted about code that had **already
shipped differently** — none reachable by reading the plan alone:

- **An archive path a member could call.** The writers row named a third, boolean-taking
  `setProfileArchived(exec, scope, publicId, archived)` whose `WHERE` carried no owner conjunct. Read
  as the shared core it looked like, a member archives, `isOwnerOf` has no caller, and the planned
  `db:verify` row — which only exercises the household conjunct — stays green. Now exactly two
  exported writers, each with its predicate written out.
- **A `/settings` row that shatters at 360px without moving `scrollWidth`.** The row described one
  flex row of four items; the plan's own width math leaves **101px for a 40-char name**. Neither CI
  gate can see it: overflow doesn't grow and the tap-target check measures height. The row now
  carries the two-line structure an implementer actually reads.
- **A live-region API that does not exist.** The plan specified `components/announcer.tsx` with an
  `announce()` context; what shipped at a-r is `components/ui/announcer.tsx`, a controlled
  `<Announcer message>`. The row is struck, and the plan now notes that its one shipped consumer
  passes `empty:hidden` — which defeats the component's own rule 1 and is the trap, not the template.
- **Copy that sends a member away from a recovery they already have.** Two lines still told a member
  to _"ask the person who set up this household"_ to restore — written before the decision, recorded
  two bullets above them, that made restore any-member. The plan contradicted itself, and the
  misdirection landed in the exact scenario the split exists for.

Thirteen more were accepted (the refusal order's justification was **inverted**, and the order now
belongs to the DAL rather than to a call sequence; `canManageAthletes` → `canArchiveAthletes`, since
it gates archive alone; the restore negative-mutation was vacuous because a **type-only** patch is
erased at runtime; the first in-household authority refusal had no telemetry; the notice row still
published a decision that had been superseded). One was examined and accepted as designed (no confirm
step on archive), and one was deferred to [tech-debt](../tech-debt.md): an athlete with no logged
months exports an EOCD-only zip, which `b` makes reachable in one tap without having caused it.

No implementation code is in this PR. `docs/plan.md`'s row and the roadmap are unchanged — `b` was
already the next chunk and still is.
