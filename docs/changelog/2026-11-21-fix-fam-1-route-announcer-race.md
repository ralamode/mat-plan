### Fixed

- **Tests (FAM-1):** the day-page e2e no longer asserts what Next's route announcer says. That
  announcement is best-effort, because the page title can arrive after the announcer reads it, and
  the assertion failed on unrelated PRs. The title assertions stay, and the race is recorded in
  `docs/tech-debt.md` with its proposed fix. This narrows #798's entry: the day is usually, not
  always, announced.
