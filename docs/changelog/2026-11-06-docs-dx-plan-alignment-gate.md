- **2026-11-06** — **A plan must name the row that already owns its question, and answer `ID-1`'s six**
  (`plan-with-panel` + `review-pr` skills). Two rules that existed and were not enforced, added at the
  two points that would have caught them.
  🔴 **`ID-1` says _"a plan for AUTH-1 1c, or any later auth chunk, answers these six in its
  review-response log"_ — and nothing checks it.** No reviewer agent's standing checklist carries the
  obligation, so on `PROF-1` (2026-11-06) three independent lenses reviewed an owner-only
  authorization decision, a new scope field and a new brand, and none of them raised it. The six were
  answered only after the maintainer asked whether the current work aligned with the longer-term
  roadmap. They were cheap to answer, and **two turned out to be load-bearing**: "the principal is a
  login, never a profile" and "no age-based permission logic" are independently why the superseded
  _"or the athlete themself when not a child"_ authority is unbuildable — the second more sharply,
  because `profiles.kind` is writable by any member via rename, so the discriminator would be
  editable by the people it authorizes.
  **The fix is a prompt line, not a new document.** A plan touching identity, the household scope,
  roles, sharing or the catalog adds one sentence to a lens's prompt, and the answers go in the
  review-response log as a short table. `review-pr`'s dimension 8 now asks for the same thing from
  the other side, so a plan that skipped it is caught at review rather than at merge.
  **Second rule: never assert a backlog row does not exist without grepping for it.** `PROF-1`'s plan
  shipped the sentence _"No backlog row exists for this yet"_ about an athlete ageing out of a
  household — a question [`ID-1`](../plan.md) had owned since 2026-10-24, **by name, and already
  naming the same complication** the plan had just derived from the schema ("custom movements and
  programs belong to the household, so 'take your history' must decide what happens to the movements
  that history names"). Two readers designing the same thing twice is the cost, and the grep that
  prevents it searches for the **capability**, not the id you expect.
  ⚠️ **Both rules say explicitly that a REFRESH counts**, because that is the case that was missed.
  A refresh does not feel like planning, and it is precisely where the roadmap has moved most since
  the last read — `PROF-1`'s refresh ran three lenses and a full re-verification gate without either
  check firing.
