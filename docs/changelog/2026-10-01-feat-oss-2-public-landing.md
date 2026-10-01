- **2026-10-01** — **OSS-2: the public landing screen is planned, and the plan is three PRs**
  ([plan](../plans/oss-2-public-landing.md)). `mat-plan.dev` is on Ray's resume and currently answers
  with a bare password prompt. The plan makes `/` a public screen with no cookie read and no database
  query, moves the profile picker to `/p`, and defers Google sign-in to AUTH-1 (which sits behind the
  household-addressing ADR). An eight-lens panel found two blocking defects before any code: the hero
  image would have been a **400 for every caller** — `next/image`'s optimizer re-enters the proxy with
  no cookie, verified by probe — and the 44px tap-target acceptance criterion **could not fail**,
  because the a11y helper excludes `<a>` by design. Two pre-existing bugs surfaced with it: the gate
  matcher's lookahead is unanchored (`/apiary` skips the proxy entirely), and the kids' real first
  names are already published in the seed. Ray's brand mark lands with it.
