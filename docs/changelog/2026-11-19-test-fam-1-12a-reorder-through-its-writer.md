### Changed

- **The reorder replay goes through lane P's writer** (FAM-1 12a-ii). `db:verify` replays
  `today-stretching-first` through `reorderPrograms` instead of the board's stand-in, a direct `idx`
  update (Q6), now that the writer exists, so the day resolver is proved against the rows the real
  writer leaves. The owed line it closes is deleted. Two comment fixes ride with it:
  `programEndsToday` sits below `currentPrograms` in `day-plan.ts`, and a rules proof's comment no
  longer says Put on reopens a row at the last place (D41 puts it back where it was).
