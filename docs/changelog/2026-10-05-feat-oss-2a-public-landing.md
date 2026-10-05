- **2026-10-05** — **OSS-2 §A: `/` is a public landing page; the app moves behind it to `/p`**
  ([plan](../plans/oss-2-public-landing.md)). A visitor from the resume link now sees what mat-plan is
  and a link to the source instead of a bare password prompt. The page reads no cookie and queries
  nothing. The gate is unchanged for every other route: a cookie-holder going to `/` lands on the picker
  at `/p` in one hop, and a new test fails the build if any page forgets `requireGatedPage()` or if a
  public page's import graph pulls in a Server Action. The proxy matcher's exclusions are now
  segment-anchored, so `/apiary` and `/favicon.icon` are gated (closing the prefix half of a tech-debt
  entry). `/gate` drops "Private preview." and links back to the landing.
