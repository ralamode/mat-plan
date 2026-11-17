- **2026-11-17** — **FAM-1: changing a logged number keeps the unit it was logged in**
  ([guide](../features/program-contract.md); contract change C28, asked for by the day-data lane).
  If a workout's unit is edited after a set was logged (pounds to kilograms, say), a correction to
  that set is checked in the unit it was logged in, so a kilogram number can never be saved onto a
  set recorded in pounds. The preview page's stand-in now follows the same rule the real save will.
  Nothing a person sees changes yet: the day page already offers no correction on such a set.
