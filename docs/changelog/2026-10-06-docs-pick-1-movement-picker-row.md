- **2026-10-06** — **PICK-1: the movement picker is Logging & Measurement's next item, and AI-1 is
  parked behind it** ([backlog row](../plan.md#pick-1) · [parked plan](../plans/ai-1-nl-logging.md)).
  The only way to name a movement the day's program does not prescribe is to **type it** — V1-19's
  `fillFromProgram` covers the prescribed case, and for the rest **Add movement** gives a blank card
  whose **Movement** field is a plain text input with no catalog behind it, upserted by slug through
  `findOrCreateMovementId`, so a near-miss spelling mints a second catalog row and splits that
  movement's history with no delete action to undo it. ⚠️ **The row records a correction to its own
  framing:** the ad-hoc case is not unreachable, it is reachable only over that hazard; there is no
  _picker_, there has always been a text box. So `PICK-1` is filed with
  an acceptance criterion a test can fail: on a day with no prescription for it, an athlete selects a
  movement, submits a set, the stored row resolves to the **existing** catalog movement rather than a
  near-duplicate minted by `findOrCreateMovementId`, and no magnitude arrives prefilled. It is
  **not a P0** — nothing is broken, a capability is absent — and it is deliberately only the _what_ and
  the _why it is next_; the design is a later PR with its own plan and panels. **The decision rests on
  a measurement, not a preference.** Against the production database that day: 49 live entries (23
  metric, 19 movement-arm, 7 neither-arm); the 19 movement-arm entries name 8 distinct movements and
  **all 8 are prescribed by the program** — zero ad-hoc entries, which is zero instances of the case
  AI-1's own Goal names (_"everything NOT in the program"_); `entries.notes`, `entries.context` and
  `entries.scheme` are **0, 0, 0 non-empty out of 49**, and those are the fields that carry the context
  a sentence expresses and a picker cannot; catalog reach is 35 movements in the live `movements`
  table, 25 prescribed, 8 ever logged. ⚠️ **The limit is stated in the row rather than argued around:**
  movement-arm logging spans two days (2026-09-28 → 2026-09-29), so the data cannot separate "ad-hoc
  never happens" from "nobody will type it" — which argues _for_ the picker, because the picker is what
  makes that case cheap enough to observe. **AI-1 moves off P0 to parked, pending that
  usage data**, in [plan.md](../plan.md), [roadmap.md](../roadmap.md) (pillar table, in-flight row and
  the per-pillar Next) and [status.md](../status.md). Its plan is kept on file, unrewritten, with a new
  § "Parked 2026-10-06" recording that the engineering + security panels returned **eleven blocking
  findings across three lenses** — among them that `@upstash/ratelimit`'s internal timeout resolves
  `{success: true}`, so decision **S9**'s fail-closed limiter fails **open** on the one outage it
  exists for; that `anthropicAIIntegration()` is a **default** `@sentry/node` integration while
  `x-api-key` is absent from the scrubber's denylist; that the per-IP spend bound is rotatable and a
  global cap needing no identity was never considered; and that **S7**'s "closed vocabulary" is a bare
  `z.string()` in the contract that was supposed to enforce it. The re-grounding work stays valid: the
  reason to wait is evidence, not defect count.
