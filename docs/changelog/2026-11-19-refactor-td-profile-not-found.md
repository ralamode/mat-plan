- **2026-11-19** — **"Profile not found" is one named const, `PROFILE_NOT_FOUND`** (`packages/shared`).
  The data layer threw it from seven places and the strength writer from one, and four test files
  asserted the text by hand, so a change to the wording could leave the tests checking the old one.
  Every throw and every test now uses the const. Mutation patches `03` and `38`, which carried the old
  line as context, are regenerated with their edits unchanged.
