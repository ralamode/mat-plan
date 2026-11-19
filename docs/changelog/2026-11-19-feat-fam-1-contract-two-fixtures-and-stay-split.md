- **2026-11-19** — **Two new day states for the preview, and one rule for which programs stay**
  ([guide](../features/program-contract.md), invariants 2, 27 and 33). The preview route can now
  show two states it could not. `today-three-programs-one-ending` is an athlete on three programs,
  one of which ends today, so the Program order dialog has two programs to move and one fixed below
  them. `unit-edited-after-logging` is a day whose bench press and vest weight were changed from lb
  to kg after they were logged: the logged rows stay in lb, the item and its unlogged sets read kg.
  Neither is a prototype state. `programsByStay` splits an athlete's current programs into the ones
  that stay and the ones ending today; the fixture builder and the preview's reorder now use it,
  and a screen can too. These are test data and a helper: nothing a family sees changes until the
  day page uses them. The fixture builder reads a weight's unit from the world when it names one
  (pounds otherwise); every existing fixture is unchanged.
