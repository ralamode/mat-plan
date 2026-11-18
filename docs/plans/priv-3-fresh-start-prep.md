# PRIV-3: preparing the fresh start (CAT-3 chunks R0 and R1)

## Where this sits

- **Pillar:** privacy and operations (`PRIV-3`'s owner). **Milestone:** Beta 0, the fresh start before
  FAM-1's trial week ([CAT-3 spec](../specs/cat-3-movement-library.md) → "The fresh start, in order").
- **This plan:** the last two chunks to build before R2, which is the fresh start itself.
  - **R0** is three things:
    - the deltas to `PRIV-3`'s plan, applied in this PR;
    - the deltas to `OPS-2`'s plan and the `SEC-6` row, written out here and applied after #592 merges;
    - the dated one-shot correction that erases the seeded household, built in R0's code PR.
  - **R1** is the runbook section, step 5's correction and R4's report.
- **Built already:** RC, `create-household` (#546), and `PRIV-3` PR 1, the graph (#520).
- **Gates for R0's code PR:** `PRIV-3` PR 2a (the core).
- **Gates for R2:** the spec's preconditions: FAM-1 step 15, P11 and B3 in production; `OPS-2` PR 1
  and A2 deployed; 2a, RC, R0 and R1 merged; the maintainer's go.

_Roadmap alignment (2026-11-18): advances `PRIV-3` and `CAT-3` chunks R0 and R1; consumes K7 (the
fresh start removes everything) and K15 (not a normal deletion); closes `SEC-6`'s production exposure
by deletion rather than by a re-key; `OPS-3` has moved to Beta 1 and gates nothing here; `ID-1`'s six
items are answered by RC's plan for the accounts this binds, and nothing here adds a column, a scope or
an authority check; checked against the private roadmap, nothing else to add._

## Goal

Everything R2 needs exists on `main` and has been dry-run against production:

- a correction that erases the seeded household and refuses to run twice;
- a correction that deletes the old global movements and refuses while anything references them;
- a report that shows the result;
- a runbook section an operator can follow in one sitting.

## Acceptance

The spec's R1 to R5 (`cat-3-movement-library.md` → "The fresh start (chunk R)"), and its R0 row:

> `PRIV-3`: a dated one-shot correction that takes no target, erases the seeded household through
> 2a's core, refuses outside production and once the target is gone, has a pure, unit-tested gate,
> and leaves `erase-household`'s seed-id refusal and its proof unchanged (or `OPS-2` D9's re-key run
> just before; the owner chooses); `PRIV-3`'s order no longer puts `OPS-3` ahead of 2a for this run,
> and `SEED_PUBLIC_IDS` moves from its 2b to chunk RC.

Done when:

- `erase-seeded-household-<date>` and `delete-global-movements-<date>` are in `registry.ts`, each with
  a dry run that prints counts only, a pure gate with a colocated test, and a `db:verify` case.
- Each new refusal has a mutation that turns it RED (numbers from this lane's 279–289).
- `movementsOwnershipReport` prints R4's four counts.
- `runbooks.md` has "The fresh start", steps 1–9 in the spec's order. Each step says what makes a
  second run of it safe, and the section uses placeholders only.
- `data-inventory.md` §5 lists the two new removal paths.

## Design

### D1. R0: `erase-seeded-household-<date>`, a one-shot entry beside `erase-household`

- **No target.** It resolves `SEED_HOUSEHOLD_PUBLIC_ID` itself, with an unfiltered
  `householdScopeByPublicId` (a hidden household is still erased). It refuses if
  `ERASE_HOUSEHOLD_PUBLIC_ID` or `ERASE_ATHLETE_PUBLIC_ID` is set, so it can never be read as the
  general erasure.
- **Through 2a's core**, `src/erasure/erase.ts`, at household grain, so it takes the same pre-flights
  (a)–(h), the same lock and the same 21-row order as every other household deletion. It is not a
  second walk.
- **The owner's choice, as the R0 row allows:** `erase-household`'s seed-id refusal (D4) and its proof
  stay **unchanged**, and no re-key runs first. Under K7 the seeded household is deleted outright, so
  re-keying it first would buy nothing.
  - The refusal lives in 2b's `erasure-gates.ts`, not in the core. The one-shot entry simply does not
    call that gate.
  - The general erasure keeps refusing a live seed id for the rest of the project's life.
- **"Refuses outside production":**
  - There is no positive test for production; its database is named `mat_plan`, like a local one
    (`target-url.ts:57-62`). So the gate refuses on everything it can recognise:
    - `correctionTargetIsLocal()`;
    - `correctionTargetIsPreview()`;
    - `hasHostOverride`;
    - an unset `DATABASE_URL_UNPOOLED`.
  - What remains is production by elimination. The operator reading the `target:` line is the last
    check, as RC's plan says for `create-household`.
  - The gate is one pure function, `seededHouseholdErasureIssue(env, found)`, which returns a fixed
    refusal code or `null`. `erasure-gates.test.ts` drives every branch.
- **"Refuses once the target is gone":**
  - When the household is not found, a dry run prints "NOT FOUND — nothing erased" and exits 0;
    `--apply` exits non-zero. This is D4's not-found string.
  - So a second run deletes nothing, and says so.
- **Accounts are kept (K15).** The core deletes the `household_members` rows (row 13) and never calls
  Clerk. The runbook step says not to delete any Clerk user, and RC binds the same accounts afterwards
  (its in-transaction check finds no live membership, because row 13 removed it).
- **The runner pieces it needs come forward from 2b:** `kind: 'erasure'`, its three strings and the
  redacted catch, which adopts RC's `corrections/redact.ts` (RC's plan: "2b adopts this module and
  does not write its own"). The fresh start does not wait for 2b (K15). 2b then adds `erase-household`
  on a runner that already has the kind.
- **Applied:** a dated entry, `issue: 'PRIV-3 · CAT-3 R0'`, with R5's Applied line:
  - the maintainer's go, its date and role;
  - K15's departures by name: no waiting period, accounts kept, no restore drill.

### D2. R3: `delete-global-movements-<date>`, step 5's correction

- **What it deletes:** every `movements` row with `household_id IS NULL`, and its `movement_equipment`
  and `movement_muscles` rows first.
- **The references are read from the catalog, not a hand list (R3):** every FK whose `confrelid` is
  `'movements'::regclass`, from `pg_constraint`, the two join tables excepted. For each one it counts
  the rows that reference a global movement.
  - A non-zero count is a refusal that names the table and the count, never an id.
  - A new referencing table therefore cannot slip past, which is the household graph's lesson (P2).
- **Lock, then count, then delete:**
  - It takes `SELECT … FOR UPDATE` on the global rows inside the transaction.
  - It counts, deletes the join rows and then the movements, and requires each deleted count to equal
    the count read in the same transaction.
  - It also requires them to equal the dry run's counts, which the operator passes in as
    `EXPECT_GLOBAL_MOVEMENTS`. That is a number, not personal data. A mismatch rolls back.
- **Second-run safety:**
  - It also refuses while **any household row exists, live or hidden**. Step 4 makes that true, and
    from step 7 on it is false. So after the household signs in, the correction can never delete the
    new catalog under it.
  - A second run before step 6 finds no global rows and deletes nothing.
  - A run between steps 6 and 7 would delete the fresh catalog. Nothing references it yet, and
    re-dispatching step 6 restores it. The runbook says so at step 5. ⚠️ _Unverified:_ that A2's
    seed re-inserts a deleted catalog row with a new minted id and reports zero skipped. R1's build
    checks it against A2 on `main`.
- **Its gate** is a pure function, `globalMovementDeletionIssue({ households, references, expected,
found })`, with a colocated test.

### D3. R4: four counts on `movementsOwnershipReport`

`registry.ts:637` already reads every `movements` row. The entry gains, as aggregate counts:

1. households and profiles whose `public_id` is in `SEED_PUBLIC_IDS`;
2. `movements` rows whose `public_id` is in the seed namespace (`MOVEMENT_SEED_PUBLIC_IDS`);
3. global movements that are not catalog rows (`modality IS NULL`);
4. catalog entries the seed skipped, from the same comparison A2's seed logs.

Every count must be 0 after the fresh start. A hand `UPDATE` that gave an old row a `modality` shows
in (2), not in (3), which is why both are counted. The report is still a report: counts only, no
names, slugs or ids.

### D4. R1: the runbook section "The fresh start (CAT-3 R2)"

- **Where:** after ["Delete a household"](../runbooks.md#delete-a-household-and-everyone-in-it-priv-1),
  so it can point at that section's transaction shape and ledger.
- **What it contains:**
  - R5's line above the first command;
  - the spec's steps 1–9, each with a **"Second run:"** line;
  - the never-re-run warning for pre-`OPS-2` and pre-A2 `migrate.yml` runs;
  - the "never restored from the step-2 branch after step 7" rule.
- **The restore-branch procedure the runbook lacks today:**
  - Cut a branch of the production project's default branch, with no compute attached and readable by
    the project's members only.
  - Record its name and the expiry date (7 days) in the ledger, not in git.
  - Delete it on that date.
  - Where the household delete's step "cut a Neon restore branch" is cited, it points here.
- **Placeholders only:** `<restore-branch>`, `<ledger-entry>`; no project, endpoint, branch name, id or
  timestamp.
- **Step 7** carries RC's "What R1 must carry" list:
  - the ids come from the production Clerk dashboard, read at step 7;
  - they are entered through `read -rs`, used once and `unset`;
  - the operator says the expected count before the dry run.

### D5. The notice and inventory sentences land when they become true

The R0 row lists the notice's sentences on the seeded athletes and on shared movement names, and
inventory §1b's paragraph on leftover global rows and §8. All of them describe production **after** R2.

- If they landed with R0 or R1, the published notice would be false from that merge until R2.
- So their text is drafted below, and they land in R2's close-out PR, the day the fresh start is done.
- Inventory §5's two removal paths are different: they exist from R1's merge, so they land with R1.

This moves the sentences from R0 to R2's close-out, and the roadmap thread owns that spec row
(§ Asked of the spec's owner).

**Drafted for R2's close-out** (`notice.md` → "Deleting your data", replacing "An athlete added through
the app can be erased today; the three athletes the app started with cannot yet, because setup would
put them back."): _"Any athlete can be erased."_ And under "Movement names", the two sentences on a
name another household typed first become: _"Every movement in the app's own list is written by the
project; a name your household types belongs to your household alone."_ The inventory's §1b paragraph
on leftover global rows is deleted, and §8 gains the fresh start's ledger entry fields (household grain,
no account ids).

## R0's deltas to other plans

### Applied in this PR: `priv-3-guarded-deletion.md`

- **The order section** drops `OPS-3`. It moved to Beta 1 (board, 2026-11-18), so it gates nothing in
  Beta 0. The new order is RC, then 2a, then R0's code PR, then R1, then R2, then 2b, 3 and 3b.
- **D4's printed checklist** reads "the restore drill (`OPS-3`, Beta 1) rehearsed, or the maintainer's
  go recorded without it". This waits on a question to the maintainer (§ Questions).
- **D4's `SEED_PUBLIC_IDS` row** says RC created the set (#546), and 2b reads it.
- **2b adopts `corrections/redact.ts`** and moves `kind: 'erasure'` forward into R0's code PR (D1).
- **A new D8** points here.

### Applied after #592 merges (it edits the same files): `OPS-2`'s plan, `plan.md`'s `SEC-6` row

- **`OPS-2` Q2 and D8:**
  - Q2's decided option (a), re-key first, stands for every deletion **except** the fresh start.
  - Under K7 the seeded household is erased outright (R0), and no live production row keeps a seed id.
  - D8's table is unchanged. Old code run after R2 can at worst re-create role-named fixture rows,
    which R4's second run finds.
- **`OPS-2` D9 and `SEC-6`:**
  - The acceptance is narrowed to _"no live production household, profile or movement carries a
    committed seed constant as its `public_id`"_.
  - After R2 that holds by deletion, and R4 checks it.
  - The re-key correction is no longer on any Beta 0 path.
  - The `rate-limit.ts` docblock clause keeps an owner: `SEC-6`, as a docs-only follow-up that
    states only what is true.

## File-by-file

### This PR (plan only)

| Path                                    | Change | What                                                                                                                          |
| --------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `docs/plans/priv-3-fresh-start-prep.md` | NEW    | This plan                                                                                                                     |
| `docs/plans/priv-3-guarded-deletion.md` | EDIT   | The order section without `OPS-3`; D4's `SEED_PUBLIC_IDS` row and checklist line; 2b adopts `redact.ts`; a pointer section D8 |
| `docs/plan.md`                          | EDIT   | `PRIV-3`'s row links this plan                                                                                                |

### R0's code PR: `db/priv-3-r0-erase-seeded-household` (after 2a; about 200 lines)

| Path                                                            | Change | What                                                                                                                                 |
| --------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/db/scripts/corrections/registry.ts`                   | EDIT   | The `kind` union gains `erasure`; the dated entry (D1)                                                                               |
| `packages/db/scripts/corrections/erasure-gates.ts` + `.test.ts` | NEW    | `seededHouseholdErasureIssue` (D1)                                                                                                   |
| `packages/db/scripts/correct.ts`                                | EDIT   | `kind: 'erasure'`: the three strings; the catch goes through `redact.ts`                                                             |
| `packages/db/scripts/verify/erasure.ts`                         | EDIT   | The entry erases a seeded household built on PGlite; a second run finds nothing; the general entry's seed-id refusal is still proven |
| `packages/db/scripts/mutations/279-*`, `280-*`                  | NEW    | The gate stops refusing a preview target; the not-found branch exits 0 under `--apply`                                               |
| `packages/db/scripts/corrections/README.md`                     | EDIT   | The Applied row                                                                                                                      |

### R1's PR: `db/priv-3-r1-fresh-start-runbook` (about 250 lines plus the runbook)

| Path                                                             | Change | What                                                                                                                                                    |
| ---------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/scripts/corrections/registry.ts`                    | EDIT   | `delete-global-movements-<date>` (D2); `movementsOwnershipReport`'s four counts (D3)                                                                    |
| `packages/db/scripts/corrections/movement-gates.ts` + `.test.ts` | NEW    | `globalMovementDeletionIssue` (D2)                                                                                                                      |
| `packages/db/scripts/verify/erasure.ts`                          | EDIT   | The `pg_constraint` read finds every referencing table today; a planted reference refuses; a household row refuses; the counts equal the dry run's      |
| `packages/db/scripts/mutations/281-*` … `284-*`                  | NEW    | The reference check reads a hand list; the household check is dropped; the expected count is ignored; the report's seed-namespace count drops movements |
| `docs/runbooks.md`                                               | EDIT   | "The fresh start (CAT-3 R2)" (D4)                                                                                                                       |
| `docs/privacy/data-inventory.md`                                 | EDIT   | §5's two removal paths                                                                                                                                  |

## Test plan

- **Unit (vitest):** each gate, every branch. The not-found output contains no id.
- **`db:verify`:** D1's three cases and D2's four. Hidden rows are included, as in every erasure
  proof.
- **Mutations:** 279–284, each RED under `pnpm db:mutations`.
- **Production, before R2:** both dry runs, printing counts only (R2). No copy of production is made.

## Risks / rollback

- **Run against the wrong database:** refused on local, preview and a host override. Production is
  recognised by elimination, so the `target:` line is read before every `--apply`.
- **R3 deletes the catalog after the household is back:** refused while any household exists (D2).
- **Old seed code writes the seeded household back after step 3:** R4's second run, at the start of
  the trial week, finds it. The corrections are kept until that run is clean.
- **Rollback:** before step 7, restore from the step-2 branch and start again. After step 7, never
  restore from it (the spec's rule); fix forward.

## Alternatives considered

- **Re-key the seeded household first (`SEC-6`), then the ordinary erasure.** The R0 row offers it.
  Rejected: K7 deletes the household, so the re-key is a write whose only purpose is to be deleted, and
  it puts `SEC-6` on the fresh start's critical path.
- **Let `erase-household` take the seed id with an override flag.** Rejected: that would weaken the
  general erasure's refusal for good, and the flag would be one more input to get wrong. A dated
  entry with no target cannot be pointed at anything else.
- **A hand list of the tables that reference `movements`.** Rejected by R3 itself.

## Out of scope

- 2b, 3 and 3b, which come after R2.
- `OPS-3`'s drill (Beta 1).
- `SEC-6`'s `rate-limit.ts` docblock follow-up.
- R2 itself, which the maintainer runs.

## Questions

### For the maintainer (sent to the board word for word)

See the PR description. They concern deletions in Beta 0 now that `OPS-3` is in Beta 1, the pause
for a program removal, and a typed item that a log still names.

### Asked of the spec's owner (the roadmap thread)

- D5 moves the notice and inventory sentences from R0 to R2's close-out, so the notice stays true
  between the merge and the fresh start.
- D2 deletes every global movement, as the spec says, and refuses while a household exists. Is that
  what step 5 means, given that a run between steps 6 and 7 would delete the fresh catalog?

## Review-response log (adversarial panel)

_Pending._
