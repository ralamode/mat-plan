# Tech debt — a strength replay answers only with its own athlete's rows

> Debt row: [tech-debt.md](../tech-debt.md) → "The strength writer's replay re-select is not scoped
> to the profile" (found 2026-10-02, #212 review). Branch: `fix/td-strength-reselect-scope`.
> No `plan.md` row: a tech-debt payoff, like #535.

## Where this sits

Standalone tech-debt payoff, not a milestone step. The row's trigger was "fold into AUTH-1's
ownership pass"; AUTH-1 shipped without it, so household login is live and the gap is now the
cross-household shape the row predicted.

_Roadmap alignment (2026-11-17): checked against the private roadmap; nothing to add here. Advances
no milestone; gates nothing._

## Goal

`writeStrengthSession` (`packages/db/src/writers/strength-session.ts`) makes every graph row
idempotent with `INSERT … ON CONFLICT (client_id) DO NOTHING`, then answers a conflict with
`reselectLiveByClientId`, which matches on **`client_id` alone**. `client_id` is UNIQUE across the
whole table, not per athlete, so a conflict can be with **another athlete's row**, including one in
another household. Today that re-select returns the foreign row:

- **Session:** profile B's request carrying A's session `client_id` gets A's session id. B's new
  entries attach to A's session (`entries.session_id` → A's row, `entries.profile_id` → B), and B is
  told `sessionId` = A's public id.
- **Superset:** a superset `client_id` from another session returns that superset's id, and this
  session's members are stamped with it.
- **Entry:** an entry `client_id` held by another athlete's entry returns that entry as a successful
  replay: nothing is saved, and success is reported. The same "silently not saved" shape
  `insertBodyweightEntry` already refuses (`writers/bodyweight.ts:240`, branch (a) pins
  `profile_id`).

After this PR a conflict is answered only by a row the request owns: the session by its profile, a
superset and an entry by the session just resolved. Any other holder is a **refusal** (the existing
`no live row for client_id` throw, the same one V1-9b B0's hidden-row replay reaches), and the
transaction rolls back, so nothing is written.

**What a cross-owner attach exposes on the read side** (security lens): `listEntriesForDay`
(`apps/web/lib/dal/entries.ts:168-186`) and the month export (`packages/db/src/queries/export-month.ts:97`)
join an entry to its session and superset by id alone. An entry that was attached to another athlete's
session would show that session's `feel` (free text), `day_role`, type and public id on its own
athlete's day page and export. Separately, because `entries.session_id` is `ON DELETE no action`, an
entry of another household inside household A's session would make erasing household A fail on the
FK (correctness lens). Both effects need a row the bug already wrote, so this PR only stops new ones.
Whether any exist is the pre-merge read below.

**Reach today:** a crafted POST only. The strength form is unmounted (tech-debt → "The old log forms
are unmounted"), but `logStrengthSessionAction` is still a public endpoint. The attacker needs a
`client_id` someone else used. Those are device-generated UUIDv7s that no DTO or export returns, so
this is a hardening fix, not an incident. It removes the last client_id read in the strength graph
that ignores ownership.

## Acceptance

- A replay under the **same** athlete still returns the same session id, writes no duplicate entry
  and does not double the sets. V1-8-2 and V1-8-3c stay green.
- The same session `client_id` sent for a **different athlete in the same household** is refused.
  No entry of that athlete exists afterwards, and A's session still has exactly its own entries.
- The same session `client_id` sent from **another household** is refused, with nothing written.
- An entry `client_id` held by an entry of **another session**, even the same athlete's, is refused
  rather than reported as a replay. A different athlete's entry is refused for the same reason.
- A superset `client_id` held by another session's superset is refused.
- Each refusal arm has a committed mutation that turns `db:verify` red when its conjunct is removed,
  and each `.expect` names its own case.
- **Pre-merge, read-only:** the maintainer runs the two counts in § Pre-merge production read against
  production and the result is recorded in this plan. Zero → nothing to treat. Non-zero → stop; it
  becomes a correction (`db:correct`), its own PR.

## File-by-file changes

| Path                                                                  | Change | What & why                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/writers/strength-session.ts`                         | EDIT   | `reselectLiveByClientId` takes an `owner: SQL` conjunct; each caller passes its own (below). Docblock: the owner conjunct is load-bearing, and why. ~25 lines.                                                                                                                                                             |
| `packages/db/scripts/verify.ts`                                       | EDIT   | One new block after V1-9b B0 (both scopes exist there): four refusal cases plus the same-athlete replay control. ~110 lines.                                                                                                                                                                                               |
| `packages/db/scripts/mutations/440-session-replay-ignores-profile.*`  | NEW    | Drops the session's `profile_id` conjunct. Expect: the same-household other-athlete refusal.                                                                                                                                                                                                                               |
| `packages/db/scripts/mutations/441-entry-replay-ignores-session.*`    | NEW    | Drops the entry's `session_id` conjunct. Expect: case 4, the same athlete's other session.                                                                                                                                                                                                                                 |
| `packages/db/scripts/mutations/442-superset-replay-ignores-session.*` | NEW    | Drops the superset's `session_id` conjunct. Expect: the superset refusal.                                                                                                                                                                                                                                                  |
| `packages/db/scripts/mutations/README.md`                             | EDIT   | Three rows.                                                                                                                                                                                                                                                                                                                |
| `docs/features/strength-logging.md`, `docs/features/write-path.md`    | EDIT   | Both own `writers/strength-session.ts` (`guides:check`; write-path.md through the `writers/` prefix). One invariant line in strength-logging.md, "a replay is answered only by a row the request owns". Widen `write-path.md:516` and `strength-logging.md:236`, which describe this throw as the hidden-row outcome only. |
| `docs/tech-debt.md`                                                   | EDIT   | Delete the entry.                                                                                                                                                                                                                                                                                                          |
| `docs/changelog/<date>-fix-td-strength-reselect-scope.md`             | NEW    | Fragment.                                                                                                                                                                                                                                                                                                                  |

### The writer change

```ts
async function reselectLiveByClientId(
  exec: Executor,
  table: GraphTable,
  clientId: string,
  owner: SQL, // the row must belong to THIS request: see each caller
): Promise<{ id: number; publicId: string }> {
  const [row] = await exec
    .select({ id: table.id, publicId: table.publicId })
    .from(table)
    .where(and(eq(table.clientId, clientId), isNull(table.deletedAt), owner))
    .limit(1);
  if (!row) throw new Error(`no live row for client_id ${clientId}`);
  return row;
}
```

| Caller                      | `owner`                                                                                                                     |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `insertStrengthSessionRow`  | `eq(sessions.profileId, args.profileId)`: the profile `isLiveProfile(publicId, scope)` resolved in-tx, so household-scoped. |
| `insertSupersetRow`         | `eq(supersets.sessionId, args.sessionId)`                                                                                   |
| `writeSessionStrengthEntry` | `eq(entries.sessionId, args.sessionId)`                                                                                     |

The parameter is required, not optional: a new graph insert that forgets it is a compile error.
That is the same mechanism TEN-1 used for `scope` (`writeStrengthSession`'s docblock).

**Why the entry pins `session_id`, and only that:** a true replay re-selects the same session first,
so the entry it wrote is under that session. An entry `client_id` that the same athlete holds under
a **different** session is not a replay of this request, and answering it as success is the
"silently not saved" shape, which a `profile_id` pin would leave open. The session was itself
resolved under the request's profile, so `session_id` implies the profile. A second `profile_id`
conjunct could not be isolated by any mutation, so it is left out rather than carried as decoration
(correctness and DB-safety lenses).

## Test plan

`db:verify`, one block (`TD: a strength replay is answered only by a row the request owns`), placed
after V1-9b B0 so `A_SCOPE`, `B_SCOPE`, `sessionProfileA/B` and `VERIFY_PROFILE_PUBLIC_ID` all exist.

- **Fixtures:** `client_id`s under `…-0000000e8xxx` (`git grep` finds none). Days in **2026-06**,
  which no `verify.ts` or `verify/*.ts` block uses for any profile. Not 2027-03, which B1-1b's
  `AUDIT_DAY` reserves (`verify.ts:9762`). Movements are `movX`/`movY`, seeded and global, so
  `assertMovementsAreAvailable` passes under either scope.
- **Every `assert.rejects` pins `/no live row for client_id/` and carries a unique message**, which
  is what each `.expect` holds. Without a message, all three patches would fail on the same
  "Missing expected rejection." line.

1. **Control:** athlete A logs session S (one movement, one set), then replays it unchanged. Same
   session id, still one entry, still one set. This keeps the refusals below from passing because the
   writer throws on every replay.
2. **Same household, other athlete:** athlete B (`sessionProfileB`, `A_SCOPE`) sends S's
   `sessionClientId` with a new entry `client_id`. Refused. Afterwards no entry with that `client_id`
   exists, and S still has exactly A's one entry. **Mutation 440's expect.**
3. **Other household:** first the positive control: `VERIFY_PROFILE_PUBLIC_ID` under `B_SCOPE` logs a
   fresh session, so the profile does resolve there. Then it sends S's `sessionClientId`. Refused,
   with nothing written by the transaction. The block comment says it cannot be isolated: anything
   that reddens it reddens case 2 first.
4. **Entry, same athlete, other session:** athlete A logs a new session T whose movement carries S's
   entry `client_id`. Refused. Afterwards T does not exist (the rollback) and S's entry is unchanged.
   **Mutation 441's expect.**
5. **Superset:** the block's own session W has superset `…e8510` with members at orders 1 and 2.
   Then A logs session U whose superset reuses `…e8510`, with its member at **order 3**, so under 442
   the mutated write succeeds silently instead of tripping `uq_entries_superset_order`. Refused.
   Afterwards U does not exist and `…e8510` still has exactly W's two members. **Mutation 442's
   expect.**

Local: `pnpm --filter @mat-plan/db db:verify` (PGlite), then `db:mutations` for 440–442, each only
with the board's heavy-run slot. Otherwise CI. `pnpm verify` before the PR.

## Pre-merge production read

Read-only, run by the maintainer (an operator action against production). Each count is expected to
be 0:

```sql
-- entries attached to a session of a different profile
SELECT count(*) FROM entries e JOIN sessions s ON s.id = e.session_id
 WHERE s.profile_id <> e.profile_id;
-- entries stamped with a superset of a different session
SELECT count(*) FROM entries e JOIN supersets ss ON ss.id = e.superset_id
 WHERE ss.session_id IS DISTINCT FROM e.session_id;
```

Result: _pending the maintainer's go._ Production data predates a planned fresh-start reset, so the
count confirms rather than gates; the fix is forward-safe either way.

## Risks / rollback

- **A legitimate replay starts refusing.** Only if the owner conjunct is wrong for a real retry. A
  real retry is the same profile and the same session `client_id`, so the session re-select returns
  the same row and every child carries that session id. Case 1 pins it, and V1-8-2 and V1-8-3c's
  replays are a second witness.
- **Supersets: does a retry always reach the same session?** Yes. The session row is resolved before
  any superset (`writeStrengthSession`, sessions first), and a superset's `session_id` is written
  once.
- **The refusal is an existence answer about a `client_id`.** Success versus refusal tells the caller
  that some row holds the UUID. Before this PR it was worse: the call returned the other athlete's
  public id. It is only useful with a candidate id, and none is exposed: no DTO, export or query
  selects a session, superset or entry `client_id`, and each is a UUIDv7 with 74 random bits. Two
  properties to keep: an own hidden row and another athlete's row give the same refusal, and when
  `B1-2` types this throw it must not separate "held by someone else" from "unknown".
- **A refusal reaches `error.tsx`, not an envelope.** It is the same throw B0's hidden replay
  reaches, behind `quietDbErrors`. It is only reachable by a crafted request, so a typed envelope is
  not worth a contract change here.
- **The message names the `client_id`.** It is the caller's own id, not personal data, and B0 already
  throws it.
- **"Nothing written" is the writer's claim, not the endpoint's.** `logStrengthSession` resolves typed
  movement names before the transaction (`apps/web/lib/dal/entries.ts:510-531`), so a refused request
  can still commit a household catalog row. That residual is already recorded (`TEN-2b-1`), and this
  PR does not widen it.
- **Rollback:** revert the PR. No schema change, and no data change from this PR. Existing rows are
  the pre-merge read's concern.

## Out-of-scope / deferred

- **Ownership on the two read joins**, as defence in depth: `sessions.profile_id =
entries.profile_id`, which `queries/day/day-plan.ts:376` already does. Both files belong to other
  lanes, so the board routes them. The day read (`apps/web/lib/dal/entries.ts:168-186`) is queued with
  lane S. The month export (`packages/db/src/queries/export-month.ts:97`) is in lane E's FAM-1 14a,
  whose plan is #582 (open). **Until that merges, the export on `main` still joins by id alone.**
- `isNull(sessions.workout_id)` on the session re-select: unreachable today, because day-page sessions
  get server-minted ids (`writers/day/log-row.ts:288,315`).
- The other graph writers: `insertBodyweightEntry` already pins profile and metric;
  `classifyRowHolder` (`writers/day/log-row.ts`) reads the holder unscoped on purpose and decides by
  its `pinned` flag (`verify/day.ts` 3i); `checkin.ts` classifies by outcome. `profileByClientId` (`ownership.ts:393`) and
  `programBlockByClientId` (`ownership.ts:681`) are household-scoped. Re-checked; none changes.
- A typed refusal envelope for `logStrengthSessionAction`.
- Moving catalog resolution inside the transaction (`TEN-2b-1`).

## Open questions

None.

## Gate results

- `db:verify` green, with the new block (2026-11-17).
- `db:mutations`: 306 mutations, all RED; `440`, `441` and `442` each fail on their own case's
  message (2026-11-17).

## Review-response log (adversarial panel)

> Panel cost: correctness: 117k tokens · 7.4 min, db-safety: 81k · 3.0 min, security: 103k · 4.4 min.
> Models: high-stakes writer (`packages/db/src/writers/**`) · all three lenses on `opus` (Fable spend
> limit until 2026-11-19 03:00 ET).

| #   | Lens                             | Sev | Critique                                                                                                                                              | Response                                                                                                                                                                                |
| --- | -------------------------------- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | correctness, db-safety, security | P1  | Case 4 used a different athlete and session, so neither half of the entry conjunct was proven; the plan's own reason for the session pin had no test. | **Accepted.** The entry pins `session_id` only (the profile is implied by the session). Case 4 is now the same athlete's other session; 441 drops that conjunct.                        |
| 2   | security                         | P1  | Rows the bug already wrote keep leaking through the day read and the export, which join by id alone; "no data change" was assumed.                    | **Accepted in part.** A pre-merge read-only production count is added, and the read-side exposure is written into the Goal. Hardening the two read joins goes to the board: lane files. |
| 3   | db-safety                        | P1  | Reusing V1-8-3c's superset under 442 hits `uq_entries_superset_order`, so the mutation fails on a unique violation, not the refusal.                  | **Accepted.** The block owns its superset (also the correctness NIT), and U's member uses order 3.                                                                                      |
| 4   | correctness                      | P2  | `.expect` files need a message: a bare `assert.rejects` gives every patch the same failure line.                                                      | **Accepted.** Each rejects pins the regex and a unique message.                                                                                                                         |
| 5   | correctness                      | P2  | "Days no earlier block uses" is the wrong rule; 2027-03 is reserved; the `d4xx` id range is taken.                                                    | **Accepted.** 2026-06 (no block uses it) and `…e8xxx` (no matches).                                                                                                                     |
| 6   | correctness                      | P2  | An entry of another household in A's session blocks erasing household A (`ON DELETE no action`).                                                      | **Accepted.** The same pre-merge read covers it.                                                                                                                                        |
| 7   | security                         | P2  | Case 3 could pass on "Profile not found".                                                                                                             | **Accepted.** A positive control first, and the regex pinned. Marked not isolable.                                                                                                      |
| 8   | db-safety                        | P2  | "Nothing written" is not true of the endpoint (catalog rows before the tx).                                                                           | **Accepted.** Scoped to the transaction; `TEN-2b-1` cited.                                                                                                                              |
| 9   | db-safety                        | P2  | Case 3 needs a global movement.                                                                                                                       | **Accepted.** `movX`/`movY` are seeded globals; the regex makes a wrong one fail loudly.                                                                                                |
| 10  | security                         | P2  | The refusal is an existence answer.                                                                                                                   | **Accepted as a recorded property, no change.** It is weaker than today's leak, and no candidate id is exposed. The two properties to keep are in Risks.                                |
| 11  | db-safety, correctness           | P2  | Mutation numbers should be confirmed with the board.                                                                                                  | **Already done:** the board assigned 440–469 to this lane on 2026-11-17.                                                                                                                |
| 12  | correctness                      | NIT | The guides describe the throw as hidden-row only.                                                                                                     | **Accepted.** Both lines are widened.                                                                                                                                                   |
| 13  | security                         | NIT | Pin `workout_id IS NULL` on the session re-select; list the two household-scoped re-selects in the sweep.                                             | **Listed, not built:** unreachable today. The sweep now names both.                                                                                                                     |

### Second-pass review (PR #589, 2026-11-17)

> Models: high-stakes writer · correctness: opus, reuse: opus (the Fable spend limit runs until
> 2026-11-19 03:00 ET). Docs, process and the personal-data scan were done by the author session.

| Lens        | Sev | Finding                                                                                                                           | Response                                                                                                                          |
| ----------- | --- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| correctness | P1  | The PR body and this plan said the export's join already carries the owner conjunct. #582 is an open plan PR; `main` joins by id. | **Fixed.** Out-of-scope now says the export is lane E's FAM-1 14a (plan #582, open), and that until it merges `main` joins by id. |
| correctness | P2  | Case 3's comment overstated what its positive control proves.                                                                     | **Fixed.** It says what it proves: the profile and `movX` resolve under `B_SCOPE`.                                                |
| correctness | P2  | The other-household arm has no mutation of its own.                                                                               | **No change.** Already stated in the README row for 440 and in the block comment.                                                 |
| reuse       | P2  | `upsertReturningId`'s comment said it was the writer's re-select shape, which it no longer is.                                    | **Fixed.** It says it mirrors only the `deleted_at` guard.                                                                        |
| reuse       | P2  | The two fixture profile ids were typed out again.                                                                                 | **Fixed.** The fixtures return `publicId`; the block uses `sessionProfileA/B.publicId`.                                           |
| reuse       | P2  | The refusal regex had two copies (B0's and this block's).                                                                         | **Fixed.** One module-level `REPLAY_REFUSED`, used by both.                                                                       |
| reuse       | P2  | "Was this entry written" was queried twice.                                                                                       | **Fixed.** A local `entryExists`.                                                                                                 |

Found outside the diff (correctness): the session re-select matches the profile but not
`activity_date`, so the athlete's own replay with a different `day` attaches entries to a session on
another date. It is the athlete's own data and predates this PR; sent to the board.
