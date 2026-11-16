- **2026-11-16** — **FAM-1 step 5b: the legacy program reads never see a program a household builds**
  ([plan](../plans/fam-1-family-program.md) §5 lane A row "5b"; ADR 0007 Amendment 2 §1).
  `programDayRows`, which feeds the day card, the prefill, the export's prescribed fallback and the
  prescribed snapshot frozen onto an entry, and `householdHasProgram` now read `kind = 'legacy'`
  blocks only. `db:verify` proves the legacy output byte-identical with a newer template block
  programming the same day, and that `householdHasProgram` counts a live legacy block but never a
  template one; mutations 55 and 56 prove both can fail. No schema change. Privacy inventory §4, §6
  and §8 re-read for this step: nothing changes (the filter only narrows what is read).
