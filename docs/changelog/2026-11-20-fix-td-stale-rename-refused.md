# A stale rename tab is refused instead of silently overwriting a newer name

Tech debt: "A stale rename tab silently overwrites a concurrent rename" (the maintainer approved it
with copy option (c), 2026-11-20). Plan: [td-stale-rename-refused.md](../plans/td-stale-rename-refused.md).

- `renameProfile` takes a required `seenName`, the name the edit form showed, and renames only if
  it is still stored. A stale Save answers `stale` with the stored name, before the duplicate
  warning, and writes nothing; a replay of a Save that landed answers `ok`. The UPDATE repeats the
  precondition, so a rename landing between the read and the write is not overwritten.
- The edit form shows "Not saved. This name was changed to “…” on another device. Save anyway to
  replace it, or go back to keep it.", keeps what the parent typed, and only "Save anyway" overwrites;
  Enter re-refuses. The heading shows the stored name.
- `db:verify` proves every arm, with an interleave rig for the race and tenancy both ways;
  mutations 428–430, and 13, 32 and 33 re-cut. `PROFILE_ECHO_MAX` names the echo bound. One e2e at
  360px. A `db:verify` assertion on renaming an archived athlete that could not fail now can.
