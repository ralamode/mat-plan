- **2026-11-17** — **PRIV-3 RC: a guarded correction that creates a household and binds its
  accounts** ([plan](../plans/priv-3-rc-create-household.md)). `create-household-2026-11-17` creates
  one new household with freshly minted ids and binds one or more sign-in accounts to it as owners,
  in one transaction. It takes no household id, reads the accounts from the environment, refuses
  (writing nothing) on a malformed or repeated account, the e2e fixture account off a local database,
  the preview database, or any account that already has a household, and prints counts and positions
  only, errors included. The claim correction now refuses a seed household id outside a local or
  preview database, and `db:verify` holds what the seed writes equal to the new `SEED_PUBLIC_IDS`.
  Proved in `db:verify` (cases 6g–6k) and by mutations 271–275. Not applied anywhere yet: production
  waits for `OPS-2` PR 1.
