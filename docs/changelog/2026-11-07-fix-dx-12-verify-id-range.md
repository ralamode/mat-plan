- **2026-11-07** — **The rename proof gets its own id range; `DX-12` is planned, panelled and
  deferred** ([plan](../plans/dx-12-verify-suites.md)).
  🔴 **A defect in #350, found by a review panel on an unrelated plan.** `db:verify`'s `PROF-1 a-r`
  block used the public_id `…04a001` — which `PROF-1 a-g` also uses, ~3,000 lines earlier — while its
  own comment claimed _"public_ids in its own range"_. The insert succeeded only because a-g
  hard-deletes its row first (_"Leave no adult behind"_), so two blocks that each believed they were
  independent were coupled by ordering. **Proved both directions:** with the old id and a-g's cleanup
  removed, `db:verify` dies on `23505 / profiles_public_id_unique`; with the new `…04d0xx` range it
  passes. ⚠️ **It would always have failed LOUDLY** — nothing was wrong with the proof, only with the
  comment and the coupling. The block now states which range it owns and how to pick one.
  **`DX-12` — sharding `verify.ts` (7,213 lines, 26 commits in six weeks) into per-feature suites —
  is planned, panelled by five lenses, and DEFERRED.** The plan ships with its review-response log
  because the log is the deliverable: the panel rejected the premise, the method, the completeness
  and the scope, and no code was written.
  🔴 **The premise was wrong and the answer already existed.** The split does not unlock parallel
  lanes: `docs/milestones/crud-1-fix-it-yourself.md`'s **2026-10-23** gate run already concluded
  _"Gate 1 fails for every pair, on the guide alone… the lanes below are orders of work, not
  concurrency"_, because every mutating PR edits `write-path.md`. The plan re-derived that analysis
  and reached the opposite conclusion. `start-task` step 2 — _"an existing plan is the contract"_.
  **And the method would not have proved the move safe:** `verify.ts` is fail-fast, so a **deleted**
  assertion changes zero bytes of output and the proposed `✓` diff could not see one — of the 19
  assertions the move touches, **one** is pinned by a mutation patch. Mutation patch `02` patches
  `verify.ts` itself, so "13/13 unchanged" was unachievable. `B_SCOPE` is minted ~3,700 lines in from
  a household a later block inserts, so the proposed bootstrap could not derive it. **Three** guards
  hard-code this path, not the two the plan claimed — `household-synthetic-is-dark.test.ts`'s
  exact-`toEqual` allowlist was missed.
  Both scope lenses independently rejected the proposed hotspot guard: run over the tree, 14 of the
  top 20 are docs that are append-shaped by design, the allowlist opens at ~15 entries, and the
  day-one catch is zero. `tech-debt.md`'s 2026-09-24 entry is re-measured (it said ~3,000 lines; the
  file has since more than doubled) and now points at the log so the next attempt starts from it.
