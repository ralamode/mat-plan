- **2026-11-15** — **FAM-1 step 0b, first half: a Server Action module adds three files and edits no
  shared table** ([plan](../plans/fam-1-family-program.md) §4, §5's 0b row, §6;
  [guide](../features/write-path.md) invariant 1). The action registry was one literal
  (`MUTATING_ACTIONS`), and the boundary test held two more (`ACTION_BINDINGS`, `VALID_BODY`), so
  every new action in any module edited the same three, and the first is owned by `write-path.md`.
  Each module now carries its own registry in a sibling file (`actions.registry.ts`,
  `profile-actions.registry.ts`), and the refusal matrices (unauth, rate-limited, wrong household,
  household scope miss, byte-identical refusals) are one function,
  `describeActionMatrices` in `apps/web/test/action-matrix.ts`, which each module's own test calls
  with its own mocks, bindings and valid bodies. `MUTATING_ACTIONS` is still the answer to "which
  actions does the app expose", composed by file name in `apps/web/test/action-registry.ts`. The same
  per-action rows run as before over the same eleven actions: 44 for name, unauth, rate limit and
  limiter key, 10 wrong-household and 2 household scope-miss. A module with
  no registry, or no test that runs the matrices, fails `actions.test.ts`; a registry entry with no
  binding or body is a compile error, pinned in `test/action-matrix.test.ts`. Two things changed in
  what is asserted, both stated in the guide: a refusal asserts that none of its own module's writers
  ran (it was every module's), and the household matrix's "drives at least one action" floor became
  "every action is in exactly one addressing matrix", since a module may have no household action.
  **Also in this PR, all without a caller:** `enterMutation` takes a limiter policy, defaulting to
  `MUTATION_RATE_LIMIT`, and `lib/rate-limit.ts` gains `ROW_WRITE_RATE_LIMIT` (600 per 5 minutes,
  D23) with its own limiter instance and key prefix, so the day page's row writes will not spend the
  default budget; the matrix asserts every action is still limited by the default. The tenancy scan
  (`lib/dal/scoped.test.ts`) reads every directory under `lib/dal`, shown on a planted nested leak.
  `moveUp` / `moveDown` in `lib/routine/editor.ts` are generic over the element.
  **From review, in the same PR:** `use-server-exports.test.ts` found Server Action modules by
  matching the directive against raw source, so a module that opened with a comment was skipped by
  the one guard that checks what it exports; it now reads `serverActionModules()`, shown on a planted
  module. The actions that enter with the row-write policy are a pinned list compared with a source
  scan (empty today), the matrix compares the policy by identity, and the hand-edited pins are one
  entry per line so two lanes adding a module merge. No schema change, no migration, no new
  dependency, no change to production behaviour.
