- **2026-11-19** — **A pull request that cannot affect the mutation proof no longer takes CI runners
  for it, and one that can runs four shards instead of eight.** Since the proof moved to CI, every PR
  started all eight shard jobs and the total check just to skip their steps, and with eight PRs open
  runs queued for most of an hour. A new `mutations-plan` job decides once, from `changed-scopes.mjs`,
  whether the shards run; when they do not, the shard and total jobs are skipped and take no runner.
  A pull request runs four shards and every push to `main` still runs eight (DX-18).
