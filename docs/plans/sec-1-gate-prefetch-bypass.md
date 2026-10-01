# SEC-1 — the access gate holds for prefetch-flagged requests

> Status: **expedited security fix; panel = security lens post-implementation.** A live bypass was
> confirmed on a Vercel preview on 2026-09-30, so this skipped the pre-implementation panel that
> AGENTS.md requires for an auth change. The security lens reviews the PR instead, and its findings
> are logged below. AUDIT-1 row 3 ([report](../audits/2026-09-30-baseline.md), P1-1) is this item.

## Goal

The access gate must hold for every request. The proxy matcher excluded prefetch-flagged requests,
so they bypassed the gate. Any client can send a prefetch header, so the profile picker, each
profile's Today page and every Server Action were reachable without the gate cookie.

## Acceptance

1. A prefetch-flagged request with no gate cookie gets a redirect to `/gate`, never the page.
2. Every Server Action refuses an un-gated caller before any DAL call, with its existing not-found
   copy (the refusal says nothing about why).
3. Every gated page re-checks the gate itself, so a future matcher edit, rewrite or route move cannot
   reopen the app. With the proxy check removed, no app content is served (verified by mutation).
4. Tests that fail when each layer is removed.

## File-by-file changes

| File                                                                                        | Change                                                                                                             |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `apps/web/proxy.ts`                                                                         | Drop the matcher's `missing:` prefetch exclusion; the comment says why it must never return.                       |
| `apps/web/lib/dal/gate.ts` (new)                                                            | `hasGateAccess()` (server-only; cookie + env read here, same check as the export route) and `requireGatedPage()`.  |
| `apps/web/app/p/[profileId]/actions.ts`                                                     | All six actions call `hasGateAccess()` first. The not-found copy becomes two constants.                            |
| `apps/web/app/page.tsx`, `app/p/[profileId]/page.tsx`, `app/p/[profileId]/routine/page.tsx` | `await requireGatedPage()` first.                                                                                  |
| `apps/web/lib/dal/gate.test.ts` (new), `actions.test.ts`                                    | Missing / wrong / valid cookie; each action's unauth → reject.                                                     |
| `apps/web/e2e/gate-prefetch.spec.ts` (new)                                                  | Both prefetch headers × `/` and a profile route, no cookie → redirect to the gate, and no app content in the body. |

The export Route Handler already re-checked the gate and is unchanged.

## Test plan

Unit (`hasGateAccess`, `requireGatedPage`, the six actions), the e2e above, and mutation checks:
each guard removed turns a named test red. The proxy fix and the page guard are each sufficient to
keep content out. The e2e status assertion pins the proxy; the content assertion pins the outcome.

## Risks / rollback

Low. A gated user's prefetches carry the cookie and pass, so navigation is unchanged. One extra
cookie hash per action and page render. Rollback is a revert, which reopens the bypass.

## Out-of-scope / deferred

- **SEC-3:** a failed DB call inside an action can send bodyweight values to Sentry in the
  `DrizzleQueryError` message (`params:`), which `scrubSentryEvent` doesn't strip.
- **DAL-2:** the live-profile ownership predicate is still hand-written at nine sites.
- The gate is a shared code, not a household. Clerk (v1.5) replaces it.

## Review-response log

- Security lens on #192 (2026-09-30) found the bypass outside that PR's diff and supplied the probe;
  the probe was confirmed against #192's preview before this PR was cut.
