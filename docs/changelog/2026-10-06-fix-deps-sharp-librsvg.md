- **2026-10-06** — **A high advisory in `sharp` (GHSA-wq5f-xc86-pv6w, a librsvg vulnerability) reached
  `main` and was caught by accident — the fourth time.** `sharp` is Next's image optimizer and sits on
  the **prod** path (`next > sharp`, and again under `@sentry/nextjs`). `next` declares `^0.35.4` and
  the fix is `0.35.5`, so it was already in range: a lockfile bump, no override to maintain — the same
  shape as `fast-uri` in #227. ⚠️ **It surfaced during unrelated feature work**, because `audit --prod`
  runs only inside local `pnpm verify` and **no workflow runs `pnpm verify`**. That is now four
  advisories found by luck rather than by a gate (`next` RCE, `source-map-js`, `proxy-addr`/`fast-uri`,
  and this). **SEC-5** is the fix and is being planned.
