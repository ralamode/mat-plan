- **2026-11-14** — **V1-9b B1-2a: logging yesterday's practice after today's did nothing, and said it
  worked** ([plan](../plans/v1-9b-delete-and-restore.md) → B1-2,
  [guide](../features/delete-and-restore.md)). CRUD-1 step 3 / Beta 0 gate item 1. 🔴 **The bug this
  fixes is reachable in two taps today and has nothing to do with deleting:** `LifeButton` held its
  `client_id` in `useState` and was keyed `a.key`, while the `<section>` around it is keyed by block
  index — so React kept the same instance, and the same id, when the person pressed ‹ to another
  day. Tap Wrestling practice today, go to yesterday, tap it again: the submit replays **today's**
  row, writes nothing for yesterday, and the action reports success. That is the evening path this
  app is built for. The button's key now carries the day and the logged row's id, so a fresh id is
  minted per day and after a delete. The page passes a key → entry-id **map** instead of a set of
  keys, picking the first row in `(created_at, id)` order when a day somehow holds two. And the id
  **rotates on any refused submit**, because otherwise the recovery the copy offers is a dead end —
  the same instance would re-submit the same dead id forever. Second half: `logLifeActivitiesAction`
  **discarded the writer's result entirely** and returned `ok` unconditionally, so B1-1's
  `own_hidden` could never reach a person. It is now a typed refusal, and the batch check-in path
  reports it **per field** — `fieldErrors` is already wired to `aria-describedby`, and a form-level
  "something failed" over ten rows tells nobody which row to re-tap. ⚠️ **After the key fix,
  `own_hidden` is not reachable from the UI at all** — a UX panel walked every path — so
  `HIDE_COPY.loggedThenDeleted` is a contract string for `/api/sync` (v1.5), no-JS resubmits and
  crafted POSTs, and its docblock says so rather than inviting someone to build UI around it. Both
  new guards probed RED. **`LIFE-1` is filed**, not fixed: Wake on a past day writes **today's**
  wake and can write a second one, because Wake is a "now" event while the page renders it on any
  writable day. Pre-existing — but B1-2 mints a fresh id per day, which removes the accidental
  collision that sometimes masked the duplicate, so it widened a hole it did not dig.
