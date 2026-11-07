- **2026-11-06** — **The CWV budget is unfalsifiable, so bundle bytes become the thing to measure**
  (tech-debt, filed as a **priority** item _(maintainer, 2026-11-06)_, to be picked up in its own
  thread). AGENTS.md commits to **LCP < 2.5s · INP < 200ms · CLS < 0.1 at p75 mobile**, and
  `review-pr`'s rubric already admits nothing measures it. The entry separates the two reasons,
  because only one is fixable now: the budget is a **RUM** budget — p75-over-real-users cannot be
  produced in CI, **INP cannot be produced in a lab at all**, and RUM is blocked behind `OBS-1`'s
  `connect-src` decision — while **lab timings in CI measure CI**, swinging between identical commits
  enough that a gate on them produces alerts you learn to ignore.
  🔴 **What is deterministic is bytes, and nothing captures them.** `next build` prints First Load JS
  per route; CI runs `pnpm build` (`ci.yml:362`) and discards the output. Verified 2026-11-06: no
  `@next/bundle-analyzer`, no `size-limit`, no Lighthouse, no size assertion anywhere in
  `.github/workflows` or either `package.json`.
  **The three regressions it would catch are habits, not config** — ⚠️ **tree shaking and per-route
  code splitting are already ON** (App Router default plus ESM; the deliberately minimal
  `next.config.ts` adds nothing that defeats them), so this is not a bundler setting anyone forgot:
  `'use client'` creep, a barrel file defeating shaking, and a heavy dependency on a hot route.
  **A live example from the same day it was filed:** `site-footer.tsx` became a client component in
  `AUTH-1` 1d PR 0 — correct, necessary, reviewed, and its bundle cost invisible to every gate.
  **The sketch owes its own plan and panel**, and carries two warnings from today's work: the baseline
  must be a **deliberate committed diff** so growth is approved rather than drifted into (the
  `ALLOWLIST`-pinned-empty idiom), and **it needs a self-test and a RED probe before it is trusted** —
  a guard that parses build output is exactly the shape that goes quietly vacuous when the format
  changes, which is [lessons.md](../lessons.md) → "Guards that pass while guarding nothing", where a
  CI gate enforced 3 of 13 paths for two releases because it had no self-test.
  **Severity: medium now, high later.** Nothing is slow today and no regression is known; the cost is
  that a committed budget is unfalsifiable, so the first real one gets found by a person on a gym
  floor instead of a gate. Not a Beta 0 blocker.
