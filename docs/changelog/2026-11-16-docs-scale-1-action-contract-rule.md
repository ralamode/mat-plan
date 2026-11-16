- **2026-11-16** — **`SCALE-1`: a new mutation follows the FAM-1 contract, and the DAL takes the day
  and time zone as arguments** ([plan.md → SCALE-1](../plan.md#scale-1)). AGENTS.md → Server
  conventions gains two lines.
  - **Contract:** any request or response change still updates its shared zod schema in the same
    PR. On top of that, a new mutation takes an object parsed by a zod schema in `packages/shared`,
    returns `{ ok:true,… } | { ok:false, reason }` without throwing a refusal, has a zod response
    schema (`rowResultSchema` is the example), and sees `FormData` only at the edge.
  - **Time:** `lib/dal` and the writers take the day and time zone as arguments. Only routes,
    actions, and helpers only they call read the `tz` cookie.

  Why both: a native client has no cookie and cannot call a Server Action, so a later `/api/v1`
  handler should be a second transport over the same functions.

  The old "Split:" and "Errors:" lines and Backend's "Contract:" line are folded in ("Split:"
  repeated the Architecture bullet), so AGENTS.md does not grow (4,834 words before and after).

  The `add-server-action` skill marks which of its steps describe the legacy forms. It names the
  proposed refusal mapping: no session and wrong household answer `not_found`, and rate-limited
  answers `retry`; the contract owner confirms it. It also states that `enterMutation` and the
  action matrix cannot drive a contract action yet. The first real contract action (FAM-1 7a or
  12b) teaches both of them the contract shape. Docs only; no code changes.
