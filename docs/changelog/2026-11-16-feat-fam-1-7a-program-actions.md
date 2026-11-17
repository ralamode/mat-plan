- **2026-11-16** — **FAM-1 step 7a-i: creating, renaming a program and saving a workout are server
  actions on the household's own data** ([guide](../features/program-builder.md) invariant 19; plan
  §5, lane B). Three actions in `apps/web/app/programs/actions.ts`, each wrapped for Sentry with no
  options, behind the session and the mutation limiter, parsed by the contract's schema, and
  answering the contract's typed result. They call `apps/web/lib/dal/program/`, which resolves the
  caller's household and runs lane P's writers; a database error reaches the log without the data
  being written. When an id the request carries is not the household's, the DAL reports which one
  through the existing scope-miss event (contract change C11), once. The editor's workout read is
  in the DAL too. **No page imports the actions until step 7b**, so no request can reach them yet; a
  source test holds that, and lists what the privacy notice owes when 7b lifts it. Another source
  test now requires each action in the session-checked modules to be wrapped for Sentry under its own name. No schema
  change, no new dependency.
