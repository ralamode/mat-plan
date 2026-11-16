# The unit suite uses half the machine's cores, so parallel sessions stop failing each other's UI tests

`apps/web/vitest.config.ts` now sets `maxWorkers: '50%'`; vitest's default is every core but one. Several sessions run `pnpm test` (pre-push, `pnpm verify`) on one machine at once. With each suite taking every core, Testing Library's render chains outran `waitFor`'s 1-second limit, and 4–5 component tests failed per run across lanes. That was contention, not a test bug. The async timeout is deliberately unchanged, so a genuinely slow render still fails.
