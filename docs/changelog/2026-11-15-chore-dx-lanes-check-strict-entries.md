# The lanes check refuses a lane entry that is not a two-space-indented `- path` line

`pnpm guides:check` reads each milestone's `lane-*:` lists. A `- path` line written at column 0 used
to end the list without an error, so every entry after it was dropped and the overlap check passed
on paths it never saw. Found in the review of #420, where three paths were dropped this way.

- `.github/scripts/check-feature-guides.mjs`: inside a lane's list, an entry must be exactly two
  spaces, `- `, then the path. A column-0 line that is not a key, and any other indentation, now
  fails with exit 2, and the list goes on, so the entries after it are still checked. A column-0
  `#` comment no longer ends a list either.
- `.github/scripts/check-feature-guides.test.sh`: nine new cases, including the shape from #420.
- `.claude/skills/write-spec/SKILL.md` → Lanes: states the entry format.
