- **2026-11-19** — **Clerk's SDK moves to `@clerk/nextjs` 7.9.26**, which brings `@clerk/backend` 3.28.0
  and with it the fix for GHSA-wpqf-h9rq-rg73 (an OIDC ID token accepted as a session token by
  `verifyToken()`; this app calls `verifyToken` nowhere, so the exposure was nil). The newest release
  past the 7-day supply-chain cooldown, installed with a 7-day minimum release age so nothing it pulls
  in is newer. The runbook's re-checks for a Clerk bump hold: the same two `'use server'` modules, the
  telemetry and keyless switches still read, identical CSP directives. Dependabot now gives `@clerk/*`
  its own PR instead of riding in the weekly group.
