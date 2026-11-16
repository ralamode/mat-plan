- **2026-11-16** — **FAM-1 contract change C7: a real contract action can pass the entry check and
  run the mandatory boundary tests** ([plan](../plans/fam-1-family-program.md) §4;
  [write-path](../features/write-path.md) invariant 1; [contract](../features/program-contract.md)
  invariant 14). `enterMutation` and the action matrix spoke only the form envelope (`ActionState`,
  `FormData`), so the program builder's and the day page's first real actions, which take a typed
  input and resolve a `ProgramResult` or a `RowResult`, could not have used either. Now:
  `TRANSPORT_REFUSALS` in `@mat-plan/shared` names what a transport answers before an action runs (no
  session is `not_found`, the same as another household's id; over the rate limit is `retry`);
  `enterMutation(TRANSPORT_REFUSALS)` is an overload of the one entry function, so the session and
  limiter checks and their order are still written once and the source guard is unchanged; and the
  matrix drives an action registered with `refusal: TRANSPORT_REFUSALS` through the same rows (no
  session, the limiter and its policy, the wrong household or scope miss, byte-identical refusals).
  Proved on three actions defined in a test, since no real one exists yet; four deliberate breaks
  each turned their rows red. Known cost: a rate-limited contract action shows the screen's ordinary
  "Couldn't save. Try again." No existing action, screen or stored data changes; no schema change;
  no new dependency.
