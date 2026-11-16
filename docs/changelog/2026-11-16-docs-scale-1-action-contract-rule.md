- **2026-11-16** — **`SCALE-1`: every new mutation follows the FAM-1 contract, and the time zone is
  passed in** ([plan.md → SCALE-1](../plan.md#scale-1)). AGENTS.md → Server conventions gains two
  lines. **Contract:** a new mutation takes an object parsed by a zod schema in `packages/shared`,
  returns `{ ok:true,… } | { ok:false, reason }` without throwing a refusal, has a zod response shape
  in shared, and sees `FormData` only at the edge (`packages/shared/src/program/actions.ts` is the
  shape). **Time:** `lib/dal` and the writers take the day and the time zone as arguments, and only
  routes and actions read the `tz` cookie. Why both: a native client has no cookie and cannot call a
  Server Action, so a later `/api/v1` handler should be a second transport over the same functions.
  The old "Split:" and "Errors:" lines and Backend's "Contract:" line are folded in ("Split:"
  repeated the Architecture bullet), so AGENTS.md does not grow (4,834 words before and after). The
  `add-server-action` skill marks the four steps the rule changes. Its full rewrite waits for the
  first real contract action, which becomes the example to copy. Docs only; no code changes.
