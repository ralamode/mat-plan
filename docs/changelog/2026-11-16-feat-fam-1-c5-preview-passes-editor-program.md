- **2026-11-16** — **FAM-1 contract: the preview passes the workout editor its program**
  ([guide](../features/program-contract.md), invariants). After lane B's step 8 (#434) gave
  `WorkoutEditorScreen` an optional `program` prop, `/design/program`'s workout-editor states pass
  the Programs list's entry for the draft's own program, so the back link names the program and the
  "Used by …" line shows, as they will on the real page from step 7b. The harness test holds the
  entry to the draft's `programPublicId`. Nothing in production changes.
