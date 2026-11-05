- **2026-11-05** — **`AUTH-1` 1d has a plan, and it is not the pure delete `1a` framed it as**
  ([plan](../plans/auth-1d-retire-the-gate.md), linked from [plan.md](../plan.md)'s `AUTH-1` row).
  Plan only — no implementation code, no behaviour change. The chunk deletes the shared access code and
  everything that reads it, so the boundary becomes **a session with a membership and nothing else**;
  `1c-4` is what unblocked it, because before the scope resolver read `household_members`, deleting the
  gate would have **widened** access.
  🔴 **The finding that reshaped it: the gate is not only the thing being deleted, it is the thing
  several existing proofs are built on** — `landing.spec.ts`'s only protection, `capture.ts`'s login and
  both harnesses' readiness route. Deleting it removes the evidence along with the subject, which is why
  the chunk needs designed replacements (an e2e entry point, a matcher-shape pin, a `mp_gate` tombstone,
  an enumeration-sweep policy) rather than a `git rm`.
  **Twenty-two adversarial lens-runs across four rounds**, which replaced **both** of the draft's
  original design decisions, recovered two committed prerequisites it had missed, and dropped a whole
  planned PR (the draft's "reversible tail" PR B — its revert-safety argument turned out to be PR A's
  property either way, and three lenses found its contents misassigned).
  ⚠️ **Round 4 reversed three of the author's own fixes** — the matcher pin was a type-level tautology,
  deleting the prefetch spec lost still-observable coverage, and dropping the `mp_gate` const rested on
  arithmetic the test plan falsifies — and recovered `ID-1`'s six keep-open items, which the first
  sixteen runs all missed.
  ⚠️ **A wrong premise is recorded rather than quietly fixed:** the author told three lenses that two
  self-created Clerk accounts were uninvited third parties. They are both the maintainer's own Google
  accounts; the premise was retracted mid-run and the privacy and security lenses withdrew P0 findings
  built on it. **That error is itself a finding** — two independent readers reached the same false P0
  straight from `runbooks.md:1466`'s present-tense claim, so `1d` owes it a dated disposition.
  **`PR A` is ~1,000 lines and knowingly exceeds the <400 target**, said plainly rather than split by
  weight: the two genuinely separable concerns are PR 0 and PR C, and cutting the rest buys ordering
  risk instead of reviewability. 🔴 **It is the point of no easy return** — `ACCESS_GATE_PASSWORD`
  leaves `lib/env.ts`, which validates at import, so a revert does not boot until the secret is restored.
  **Still open, and listed so they gate the next PR rather than being rediscovered:** whether `/privacy`
  becomes indexable, what "Rotate a secret" uses as its worked example, the correction ledger's
  `--apply` date (the maintainer's to supply), and **one production-instance observation** the
  development instance cannot answer and neither existing account can produce.
  ⚠️ **Model override, recorded not hidden:** the pinned review model returned `429`, so the panel ran
  on Opus by agreement, with lens definitions, prompts and checklists unchanged (a `DX-11` deviation).
