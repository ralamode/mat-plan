### V1-9b B1-2 — Restore all for a cleared day, and the banner's read

- **Restore all** (`restoreClearAction`, `app/p/[profileId]/clear-day-actions.ts`) brings back one
  clear of an athlete's day, named by its token. Today and yesterday only; an archived athlete's day
  is closed; no program-assignment check (C24). It answers how many entries came back and how many
  stay hidden because the day has a newer one in their place. A clear with nothing left answers 0
  and 0 rather than a refusal. **No caller until B2** renders the banner.
- **The banner's read** (`clearEventsForDay`): every clear of a day, newest first, as a token and a
  count. One predicate (`queries/clear-events.ts`) now serves it, `clearDay`'s replay and
  `restoreClear`.
- The contract is `packages/shared/src/clear-day-shapes.ts`, built from the row contract.
- `db:verify` proofs 10–13 and mutations 162–167
  ([plan](../plans/v1-9b-delete-and-restore.md), § B1-2 as amended).
