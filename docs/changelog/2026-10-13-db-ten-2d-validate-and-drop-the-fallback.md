- **2026-10-13** — **TEN-2d: the end-state CHECK is `VALIDATE`d against real production rows, the
  `23505` fallback is deleted, and TEN-2's last mechanical gate is discharged.** Migration `0018` runs
  `ALTER TABLE movements VALIDATE CONSTRAINT movements_global_row_has_pattern` — **the only time this
  arc scans production data**, because `db:verify` runs on PGlite and never against prod. `VALIDATE`
  takes `SHARE UPDATE EXCLUSIVE`, not `ACCESS EXCLUSIVE`, which is the point of the split: `0017` took
  the strong lock for an O(1) catalog edit, and the row scan runs here under a weak one.
  `db:verify`'s `convalidated` assertion flips `false` → `true`, which is how _"do not forget the
  `VALIDATE`"_ stays a red build rather than a reminder. `findOrCreateMovement`'s `23505` `catch` goes
  with it: `0017` had already made it unreachable, and it outlived the drop by exactly one PR because
  nothing couples `migrate.yml` to the Vercel deploy, so a catch-less resolver meeting the old schema
  would have raised a raw `23505` out of a child's session write.
  ✅ **The precondition was measured, not assumed.** The report-only correction
  `movements-ownership-2026-10-11` ran against **production** on 2026-10-13 and returned **zero**
  global rows with `pattern IS NULL`, so the scan could not wedge `migrate.yml`. `TEN-2c-1` did not
  need to land first.
  🔴 **The census is the fact worth keeping:** 35 `movements` rows — **35 global
  (`household_id IS NULL`), 0 household-owned** — and all 35 global rows are exact members of
  `MOVEMENT_SEED_PUBLIC_IDS`, so **0** non-curated global rows, **0** `TEN-2c-1` input, **0**
  `TEN-2b-2` input, and **0** [`runbooks.md`](../runbooks.md) pre-flight (d) rows across `entries`
  **and** `prescriptions`. `0 household-owned` means **nobody has ever typed a free-text movement
  name in production**: every log resolved to a curated row, so **the hazard was latent for the whole
  arc.** Said honestly and no further — that is not "the work was unnecessary". The defect was
  reachable the moment a second household existed, which is precisely what
  [beta-1](../milestones/beta-1.md)'s invite creates.
  🔴 **So `TEN-2c-1` is a NO-OP on current data, and it is NOT closed.** The split backfill has
  nothing to split, but ⚠️ **a dated zero is not an invariant** — the discipline `TEN-2a` wrote for
  its own zero. Its row becomes **"re-measure immediately before the invite; implement only if
  non-zero"**, and the now-validated CHECK prevents new ones. **TEN-2 is four of five rows landed,
  the fifth a conditional**: `2a` (`0015`), `2b` (`0016`), `2c` (`0017`), `2d` (`0018`), plus `2c-1`.
  **What the invite waits on is now `AUTH-1` and the self-serve step** — not this arc. ⚠️
  [SECURITY.md](../../.github/SECURITY.md)'s three-row rule **still stands**, because `AUTH-1` has not
  landed; what changed inside it is TEN-2's status, not the rule.
  ✅ **The stale claim `TEN-2c` knowingly left behind is cleared.**
  `.github/workflows/migrate.yml`'s header no longer describes `db:seed` as **refusing** and unable to
  "clear itself by re-running" — `TEN-2c` made that false when it demoted the shadow guard to a
  report, and this is the PR that touches the workflow.
