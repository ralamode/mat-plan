- **2026-10-08** — **TEN-1 1c: the last hand-written ownership predicate is gone**
  ([plan](../plans/ten-1-household-scope.md)). `logCheckinEntries`, `writeStrengthSession`'s
  in-transaction resolve, `programDayRows`'s `isThisProfile`, `export-month`'s three month reads and
  `seedProgram`'s plural variant all run the single-sourced household-scoped predicate — so the
  repo-wide count of hand-typed copies went from **eleven at V1-24, to five after 1b, to zero**, which
  is the precondition 1d's structural guard needs to be absolute instead of an allowlist that shrinks.
  1b had recorded these five as still existence-scoped and argued it was a worse _error shape_ rather
  than a leak, because `getProfileByPublicId` fails closed first; that argument is now unnecessary.
  `programDayRows` gains a property its two-hop correlation could not express: the **requester's**
  household is asserted independently of the profile's own row, so a repointed `household_id` can no
  longer read the new household's program unchecked. `db:verify`'s matrix grew from two scoped reads to
  **six**, each still proved **four** ways (own household, other household, and both reverses), plus
  `writeStrengthSession` refused across the seam with the whole transaction rolled back, plus
  `seedProgram` refusing a cross-household prescription target with nothing written. A third committed
  mutation patch undoes all seven conversions and asserts the proofs go red, on the **named** first
  assertion — each patch now carries a `.expect` file the runner compares, so "something went red" is
  no longer enough and two patches breaking the same proof are no longer indistinguishable. ⚠️ Note
  the gate shows the first failure is a 1c assertion, **not** that every 1b assertion stays green:
  `db:verify` is fail-fast, so those are unreached rather than green, and the claim rests on the
  per-predicate runs recorded in the plan. ⚠️ Still **consistent
  scoping, not authorization** (AUTH-1), and `findOrCreateMovementId` is still unscopable, so a
  **refused** strength write has already committed its caller-supplied movement name to the shared
  catalog — 1d records that proof and the **TEN-2** go/no-go.
