- **2026-10-06** — **AI-1: the NL-logging plan is re-grounded against the schema that actually shipped,
  and names the exact shape the model may emit** ([plan](../plans/ai-1-nl-logging.md)). The plan was
  written 2026-09-16 and closed on **S5 — wait for GAP-3, because the columns it extracts into are
  being replaced**. GAP-3 landed (migration `0011`, `entry_set_quantities`, #137/#139/#141) and V1-13
  landed (#149/#150), so **S5 is discharged** and the plan, not the gate, was the blocker. The
  re-grounding replaces "fields that match this app's entry schema" with a named contract
  (`extractedSessionSchema`: a movement identity and a per-set `reps` array, every bound imported from
  `logStrengthSessionSchema`'s own pieces rather than re-typed) and traces the chain that makes
  **"the LLM never authors a load"** true link by link, from the emit type through the form's blank
  `weight` to the writer skipping the `entry_set_quantities` row. **The one real design consequence of
  GAP-3:** the wire now carries a single dimension-polymorphic magnitude, so a duration and a weight
  are the same field — there is no way to keep durations while dropping loads, and the emit schema
  therefore carries **no magnitude of any dimension** (S6). Three of the draft's acceptance fields are
  overturned with reasons, not edited out: duration (shares the load's field), activity (V1-7 already
  made it one tap), and profile (a model-chosen profile could route a write to another child's log, so
  it is a warning hint and the route's id stays authoritative). S3's rejection argument cited
  `parseLoad`'s permissive fallthrough — **that function is deleted**, and the decision now stands on a
  stronger reason: `~75` and `12-15` are unrepresentable in a field typed `^\d+(\.\d{1,3})?$`, not
  blocklisted. Also new: the extraction endpoint sites under `/p/`, never `/api/`, which the gate
  matcher excludes (S8); its limiter fails **closed**, deliberately unlike the gate's, because what a
  dead limiter widens here is metered third-party spend (S9); and the per-household bound AGENTS.md
  asks for **cannot be keyed yet** — there is no household identifier before AUTH-1 — so the honest
  bound is per-IP burst plus a per-profile daily cost ceiling that says in its own docblock that it is
  not a security boundary. The plan applies the `write-spec` test and concludes AI-1 warrants a
  **spec** (three consumers share one contract, and the gate-before-model order cannot move), proposes
  a four-chunk split each under 400 lines with EVAL-0 first, and records that EVAL-0's own plan cites
  `PRESCRIPTION_SHAPE`, which GAP-3 deleted.
