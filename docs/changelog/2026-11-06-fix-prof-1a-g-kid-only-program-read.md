- **2026-11-06** — **Only a child reads the household's program, enforced in the query**
  (`PROF-1` a-g, Q15 stopgap, [plan](../plans/prof-1-athletes.md) D4). The adult would otherwise
  inherit the kids' PPL block on his own day page, which is not his training.
  **One predicate, `readsHouseholdProgram(kind)` in `packages/shared`**, and the enforcement is a
  `profiles.kind` conjunct inside `programDayRows`' block subquery — the row `isLiveProfile` has
  already pinned. An adult resolves no `blockId` and the query returns `[]`, the same "nothing
  programmed" shape the DAL and page already handle.
  🔴 **Guarded in the QUERY, not the page or the DAL, because one query feeds three readers:** the
  day card, the scaffold/prefill through `getProgramDay`, and the export's `prescribedFor`. Guarding
  the latter two separately would be two copies, and `db:verify` drives the query rather than the
  DAL — so the copies would have gone unproven.
  ⚠️ **The consequence to understand before `a-r` ships: `kind` is read at QUERY time.** Flipping a
  kid to adult empties `prescribed` in every **past** month of their export, and flipping back
  restores it. Nothing is snapshotted. Deliberate — a program a non-child should not have been
  reading is not retroactively theirs — and proved in both directions by a `db:verify` flip case.
  **Two mutation patches, because a missing conjunct and a wrong constant are different defects.**
  `11` drops the conjunct (an adult then reads the kids' program); `12` inverts `PROGRAM_READ_KIND`
  from `kid` to `adult` (kids read nothing, adults read). Patch `11` passes against a wrong constant,
  so one patch could not have covered both. Both RED; the gate is now 12 mutations.
  **The UI half** reads the same predicate: an adult gets no day-role label and `null` as the form
  default ("Not a programmed day"). When the household **does** program and the athlete is an adult,
  a muted line under the Strength heading says why the card is empty —
  `householdProgramsAnything()` exists only to tell that apart from "this household programs
  nothing", which says nothing because there is nothing to explain. `programBlockInHousehold(scope)`
  is the second **prefixed** ownership helper, per that module's own convention.
  **A new `--state adult-athlete`** flips the seeded profile, because the seed writes two kids and no
  adult — so this state could not be rendered at all before. Captured at 390/820/1280.
  🔴 **Two traps hit while verifying it, both now in [lessons.md](../lessons.md).** The screenshot
  harness **reuses `.next` without `--build`**, so a capture taken after an edit showed the code from
  two edits earlier — it produced one false "it works" and one false "I broke it" in the same
  session. And underneath that, **a prop reached the component and rendered nothing**: a batched edit
  added `programNote` to the signature and the type while the render line silently failed to match,
  which `tsc` accepts (an unused destructured prop is legal) and 1385 tests did not cover. The
  stale build hid it. Both are the same family as the GAP-1 inert-field lesson.
