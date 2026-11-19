- **2026-11-19** — **Two names that had to match their definitions are now imported instead of retyped**
  (tech-debt entry paid off). `db:verify`'s weigh-in-uniqueness cases now name the index through
  `BODYWEIGHT_DAY_UNIQUE_INDEX` from the schema, and the seed household and profile ids are built with
  `seedPublicId`. Neither value changes; a rename of either now carries through instead of leaving a
  stale copy that still passes.
