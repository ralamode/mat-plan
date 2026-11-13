- **2026-11-13** — **V1-9b B1-1a: the check-in insert moves to `packages/db`, where a real database
  can finally test it** ([plan](../plans/v1-9b-delete-and-restore.md) → B1-1,
  [guide](../features/write-path.md)). CRUD-1 step 3 / Beta 0 gate item 1. The statement lived in
  `apps/web/lib/dal/entries.ts`, whose only coverage was an **emitted-SQL assertion** — the shape of
  the query, never what it does to rows — and `verify.ts` imports only `../src/*`, so no mutation
  patch could redden anything about it. That was tolerable while the answer was one boolean. **B0
  ended that:** making the five `client_id` arbiters non-partial means a hidden row no longer
  _shares_ its `client_id`, it **holds** it, so a replay of a hidden check-in conflicts instead of
  twinning — and "did not insert" stopped having one meaning. The writer now returns four outcomes:
  `created`, `replay` (this profile's own live row), **`own_hidden`** (this profile's own deleted row
  holds the id, so it is never `ok`) and `conflict` (another profile's row). Its re-select is
  deliberately **not** `deleted_at`-guarded, the opposite of `reselectLiveByClientId`, because a
  hidden holder is the answer it exists to report rather than a row to skip. ⚠️ **Nothing a person
  sees changes yet**: the DAL collapses the four back to `{ created, id }`, so no action, test or
  screen moved in this PR — `B1-2` owns the mapping and the copy. What changed is that the behaviour
  is now provable, and `db:verify` proves it: one call replays a live row, this profile's hidden row
  and another profile's row, and gets three different answers. Mutation **40** removes the
  `own_hidden` branch and the proof goes red.
