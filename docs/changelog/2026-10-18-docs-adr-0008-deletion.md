- **2026-10-18** — **ADR 0008 decides what "delete" means, and the panel overturned its first draft's
  premise.** Seven ADRs preceded it and none was about deleting anything, so six places in the repo had
  each taken a position on `deleted_at` and they did not agree — including one **published** at
  `/privacy`. The decision: a per-item delete **hides from the whole household** (there is no
  `deleted_by` column anywhere, and every read filter is unconditional, so "hidden from me" was not a
  thing the code could deliver), stays **restorable through a visible collapsed `Hidden — Restore` row
  until it is purged at `N`**, and then is actually erased. That **re-scopes
  [`PRIV-3`](../plan.md) item 2 instead of rejecting it**, which is the reverse of the first draft and
  the whole point: the notice told families _"per-item deletion is being built"_, so a hide-only world
  would have **retracted a published promise**, while hide-then-purge makes it true.
  The first draft argued the opposite — that the notice promised hiding — by quoting it with an ellipsis
  that removed all four of its temporal markers (_currently_, _yet_, _being built_, _until then_). The
  notice says how to read itself one page earlier: _"Where something is not yet as good as it should be,
  this notice says so rather than leaving you to find out."_ It was disclosing a defect, not promising a
  state.
  **The load-bearing factual error:** _"every uniqueness arbiter is partial on `deleted_at IS NULL`"_ —
  **fourteen are; the non-partial `public_id` UNIQUE on all fifteen soft-deletable tables is not.** Two
  decisions rested on it. It made undo look free (_"costs one `UPDATE`"_) when a hide **frees its slot**,
  so an un-hide can raise `23505` — which [`runbooks.md`](../runbooks.md) already recorded (_"After 1d
  lands, un-deleting a row would violate its index"_) and `db:verify` constructs and leaves standing in
  production data. And it produced an `/api/sync` rule prescribing the **exact inverse** of a shipped,
  green assertion (V1-24 1e: a replay must answer `dayTaken`, never the dead row), unbuildable anyway
  under the document's own "no migration" since a hidden row cannot be an `ON CONFLICT` target.
  That sentence came from [`data-inventory.md`](../privacy/data-inventory.md) §5, where it was wrong when
  written in PRIV-1 — **fixed there in the same PR**, because an ADR cannot correct a claim while citing
  the document that makes it. Cites into both privacy files are now **by section**, per that file's own
  policy, since this PR moves their lines.
  The panel also found "ADR 0008" was already **reserved** by the strength-ladder spec for work gated
  behind Beta 0; numbers go to the document that gets written, so the ladder's forward reference moved
  to 0009.
