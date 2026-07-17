# Security

## Threat model

Single adult operator (Clerk) + in-app profiles for the adult + 2 kids (**no child accounts**).
**BOLA/IDOR is the #1 risk** given the multi-profile household. **Kid bodyweight is the one
sensitive field.** The future MCP/REST API is consumed by an LLM (a Claude skill) via a scoped
machine token.

## Authorization (the top priority)

- All data access goes through the **server-only DAL** with ownership checks; every query is scoped
  by `household_id`. Never trust a `householdId` / `profileId` from the request body/params.
- Public/URL/API IDs are **UUIDv7** (non-enumerable → anti-IDOR).
- **Middleware is NOT the auth boundary** (CVE-2025-29927) — the real checks live in the DAL, on
  every read and write. Keep Next.js patched.

## Sensitive data

- Kid **bodyweight** is privileged: never returned outside the household operator, never logged,
  never included in the LLM/MCP payload unless a scoped, explicit purpose requires it.

## Input

- zod at every trust boundary; whitelist mutable fields (`zod .pick` — no mass assignment).
- Drizzle parameterized queries only (no `sql.raw` / string interpolation). No `dangerouslySetInnerHTML`.

## Tokens / secrets

- The MCP/REST token is a **separate, org-scoped, least-privilege (reads + one narrow write),
  revocable Clerk API key — NEVER the human session.** Rotation = revoke + reissue. Idempotency-Key honored.
- Secrets live in Vercel env; only the DAL reads `process.env`; no secret gets a `NEXT_PUBLIC_` prefix.

## API shape

- `/v1` prefix; RFC 9457 Problem Details error shape; cursor pagination with a max limit; 403 on
  wrong household.

## Transport / headers

- HSTS, nonce-based CSP (middleware), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `Permissions-Policy`. Secure / HttpOnly / SameSite cookies.
- **CORS closed** — the LLM calls server-to-server, so no browser origin needs opening.

## Privacy (minors)

- Data-minimization + a defined retention/delete path. **No child accounts, no third-party sharing**
  — this is what keeps COPPA deferred; changing either triggers a privacy review. (2025 FTC COPPA
  amendments: compliance by 2026-04-22.)

## Logging

- Never log tokens, secrets, PII, or bodyweight. Audit sensitive/mutating actions (actor, action,
  resource, timestamp), kept separate from the data.

## Rate limiting

- `@upstash/ratelimit` (sliding window) on auth, mutations, `/api/sync`, and the LLM-facing API.
  In-memory counters don't work on serverless.

## Supply chain

- Commit the lockfile; CI uses `--frozen-lockfile`; Dependabot with a cooldown / min-age
  (post-Shai-Hulud); `pnpm audit` gate; minimize dependencies.
