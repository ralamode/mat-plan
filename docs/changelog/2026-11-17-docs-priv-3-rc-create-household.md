- **2026-11-17** — **A plan for the one tool that can create a household on purpose**, for the fresh
  start before FAM-1's trial week ([plan](../plans/priv-3-rc-create-household.md); `CAT-3` chunk
  RC). Plan only, no code.

  The correction:
  - takes no household id, and binds the household's sign-in accounts to one new household in one
    transaction;
  - refuses, and writes nothing, if any of those accounts already has a live membership;
  - prints counts only, database errors included.

  `SEED_PUBLIC_IDS` arrives with it. The existing claim correction then refuses a seed household
  except on a local or preview database.

  A seven-lens panel raised three blocking findings, all resolved:
  - a column a committed guard keeps unnamed in scripts;
  - two refusals proven only by unit tests, not wired into their corrections;
  - a refusal that would have failed an existing `db:verify` case in CI and cut off preview sign-in.

  No roadmap item moved.
