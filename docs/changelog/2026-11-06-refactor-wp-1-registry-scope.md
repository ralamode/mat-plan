- **2026-11-06** — **A second Server Action module can no longer escape every refusal matrix**
  (`WP-1`, [plan](../plans/wp-1-shard-actions.md), CRUD-1 step 0 — **unblocks `PROF-1` a-r**). No
  behaviour change; the whole PR is the evidence layer.
  🔴 **The hole, measured rather than argued.** `ALL_ACTIONS` is built from `MUTATING_ACTIONS`' keys
  and every refusal matrix iterates it — but the only cross-check tying actions to the registry
  hard-coded `actions.ts` in its own directory. So a new `app/p/*-actions.ts` could be added, pass the
  pinned module list, pass the source-text boundary guard, and face **no** unauth, rate-limit,
  wrong-household or byte-identical-refusal test at all. The source guard proves the call is
  **present, not that it runs before the DAL**, so that was the only thing covering it. Demonstrated
  with a throwaway second module: the old hard-coded read does **not** see its action; the new
  scan-based read does.
  **The cross-check now reads every scanned module**, which closes it in the direction that matters:
  an exported action missing from the registry fails, and once registered
  `Record<MatrixActionName, Binding>` forces a binding and all six iteration sites run it. ⚠️ An
  ownership check against the guide would **not** have been equivalent — that detects an unlisted
  module, and the action would still be untested.
  **`MUTATING_ACTIONS` becomes one discriminated union:** `{ refusal, scope }` or
  `{ excluded: { reason, provenBy } }`. So **"a household-addressed action may never be excluded" is
  a type error rather than prose**, the cross-check stays plain equality with no second list to
  subtract, and `excludedActionNames()` is pinned `[]` so every future exclusion is an edit a human
  reads. `scope` is **addressing**, never `HouseholdScope` — the docblock says so, because the word
  already means the capability elsewhere in this repo.
  **One table per action instead of three.** `ACTION_FNS`, the hand-written `ALL_WRITERS` array and
  `VALID_BODY` were keyed by the same names, so a new action had three places to be forgotten — and
  `updateProfileRoutine` was missing from the array, which is why every refusal case carried a
  separate `expect(updateProfileRoutine).not.toHaveBeenCalled()`. `ACTION_BINDINGS` carries `fn` and a
  **non-empty writer tuple**, `ALL_WRITERS` is derived, and a writer no binding declares is now
  asserted by construction. ⚠️ `writers` is typed loosely rather than `Mock`: these are the real DAL
  imports, which `vi.mock` replaces at runtime while their static types stay the originals.
  🔴 **One new assertion ties each registration to the function it names** (`fn.name === name`).
  Shorthand properties hide a copy-paste: `fooAction: { fn: logBodyweightAction }` would pass every
  matrix while the real `fooAction` was never called.
  **`mutation-entry.ts` moves up to `app/p/`** so the household-level action modules `PROF-1` and
  `V1-9b` add can reach it. 🔴 **The obvious fix for the guard was forbidden.** Widening
  `ENTRY_IMPORT` to accept `'./'` or `'../'` is the alternation `write-path.md` invariant 1 rules out
  — _"one matching either passes on either and proves neither"_ — and here it opens a concrete hole:
  a new local `app/p/[profileId]/mutation-entry.ts`, a weaker `enterMutation` with no limiter, would
  satisfy the relative form from `actions.ts` while the order assertion inspects only the canonical
  file. **One pinned specifier instead, the alias `@/app/p/mutation-entry`** — depth-independent, so
  it also survives the third depth the spec already plans for V1-22's program actions. Both failure
  modes were **probed RED**: a relative import, and a planted shadow module.
  ⚠️ **The move breaks two assertions, and that is the point** — `ENTRY_IMPORT` and the
  session-before-limiter order `it`, which hard-coded the old path and throws ENOENT. Both were seen
  failing before being fixed. The failure message now names the alias rather than the old relative
  path, so a future break sends the reader to the right fix.
  **Unauth and rate-limit stay over ALL registry entries; only the three profile-specific sites
  filter on `scope`** — a household action must still be rate-limited, and `addAthleteAction` is the
  one that grows a table without bound.
  ✅ **`guides:check` caught the moved `owns:` path, which it could not have done before
  [#341](https://github.com/ralamode/mat-plan/pull/341)** landed this morning: the parser was reading
  3 of `write-path.md`'s 13 entries, and `mutation-entry.ts` was among the ten unguarded. Both rot
  checks fired here.
