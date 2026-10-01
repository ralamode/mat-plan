- **2026-09-30** — **SEC-2: every GitHub Action is SHA-pinned, and CI keeps it that way**
  ([plan](../plans/sec-2-pin-actions.md)). 18 tag refs pinned to their current commits (no version
  change), including `pnpm/action-setup` in the prod-credential `migrate.yml`. `check-action-pins.mjs`
  fails a tag or a stale-able comment in `verify` and in `quality`; there, `--resolve` also proves each
  SHA is its tag's real commit (no fork "imposter" commits). The rule lives in SECURITY.md.
