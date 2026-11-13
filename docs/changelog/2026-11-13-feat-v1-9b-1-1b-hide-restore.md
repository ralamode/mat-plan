- **2026-11-13** — **V1-9b B1-1b: the hide/restore core — one writer for `deleted_at`, one reader for
  tombstones, and the audit that every other query filters them**
  ([plan](../plans/v1-9b-delete-and-restore.md) → B1-1,
  [guide](../features/delete-and-restore.md)). CRUD-1 step 3 / Beta 0 gate item 1, `packages/` only.
  `writers/hide.ts` is now **the only module in the app that writes `entries.deleted_at`** (ADR 0008
  decision 3.3), which is what makes "every reader is audited" a finite claim rather than a hope, and
  `queries/hidden-entries.ts` is the repo's first read that deliberately returns
  `deleted_at IS NOT NULL`. 🔴 **The trap the reader audit exists for:** `ON DELETE CASCADE` is
  hard-delete only, so hiding an entry leaves its sets and quantities with `deleted_at IS NULL` —
  live children of a dead parent — and a reader that filters only its own table still returns them.
  `db:verify` now hides a strength entry, asserts its children are still live, and proves the month
  export drops both; restoring brings the month back **deep-equal**, which is criterion 16's
  self-serve half. The hide event is `(profile, day, deleted_at)` carried as **fixed-format UTC
  text**: one transaction shares one `now()`, so a folded row is one event, and the token never
  passes through a JS `Date`. ⚠️ **That proof was vacuous on the first attempt and the mutation gate
  said so** — PGlite's `now()` resolves to milliseconds, so there was nothing for a `Date` to
  truncate; the fixture now writes `.123456` by hand, which is what the plan's test plan had asked
  for. [lessons.md](../lessons.md) carries the general form: pin a precision-sensitive value in the
  fixture rather than sampling it from the environment the proof runs in. The swap ("use this one
  instead") runs **one savepoint per item** in Decision 8's order — the holder is touched only after
  the item is proved hidden under the token — and both bad orders are driven: a stale token answers
  `changed` with the holder **untouched**, and naming a row that does not hold the slot refuses
  rather than guessing. All-or-nothing on hide, replays answer `ok` with the same token, and
  household B can neither hide nor read household A's rows. 41 mutations, all RED.
