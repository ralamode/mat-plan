'use client';

import { useClerk } from '@clerk/nextjs';

import { Button } from '@/components/ui/button';
import { SIGN_OUT_COPY } from '@/lib/constants';

/**
 * Sign out (AUTH-1 1c-3b) — the app's first real one, and the control `NO_HOUSEHOLD_COPY` spent a
 * chunk promising.
 *
 * 🔴 **It clears the CLERK SESSION, and as of `1d` that is the whole story.** The session is the only
 * boundary, so signing out of Clerk signs you out of the app — full stop.
 *
 * ⚠️ **Between `1c-3b` and `1d` this was a decision with a table behind it** _(settled by the
 * maintainer, 2026-10-29)_, and the reasoning is kept because it is what stops the obvious wrong
 * "fix" coming back. The boundary was then `mp_gate` AND a session, which gave three options:
 * clearing the session only (chosen — the device kept a cookie that granted nothing but the right to
 * be asked to sign in); clearing BOTH, which was a **permanent lockout**, bouncing an invited parent
 * to `/gate` and demanding a shared code they never had, from a button labelled "Sign out"; or
 * clearing `mp_gate` only, which is what #303 did and why #303 was parked.
 * `1d` dissolves the dilemma rather than resolving it: there is no second cookie left.
 *
 * `sign-out.test.tsx` still pins that this file touches no cookie API. The gate-cookie half of that
 * assertion went tautological with the symbol, but the rest did not — **the `tz` cookie exists**, so
 * "sign-out clears cookies" remains a thing a future author could reach for.
 * ⚠️ What actually clears the Clerk cookies is `@clerk/clerk-js`, fetched from a CDN at a floating
 * major and absent from the lockfile — so our assertion can only be about our own code. The runbook
 * carries the manual check.
 *
 * ⚠️ **No `redirectUrl` here.** `app/layout.tsx` already sets `afterSignOutUrl={SIGN_IN_PATH}` on
 * the provider — one source for one value (AGENTS.md → Constants) — and the first time a redirect
 * target comes from a prop or a query parameter it has to go through `safeInternalPath` (SEC-4).
 *
 * **Disabled until `loaded`**, deliberately: a dead-but-enabled button is the worst variant on the
 * one screen whose copy prescribes pressing it. `useClerk()` is reactive here because the provider
 * memoises on `clerkStatus`.
 */
export function SignOutButton() {
  const { signOut, loaded } = useClerk();

  return (
    <Button
      type="button"
      variant="outline"
      // Recessive on purpose: the picker's primary decision is "which tile". Not `destructive`
      // either — red means "this touches data" in this app, and signing out touches none.
      disabled={!loaded}
      aria-describedby={SIGN_OUT_CONSEQUENCE_ID}
      onClick={() => void signOut()}
    >
      {loaded ? SIGN_OUT_COPY.action : SIGN_OUT_COPY.loading}
    </Button>
  );
}

/** Shared so the live control and the placeholder cannot drift apart. */
export const SIGN_OUT_CONSEQUENCE_ID = 'sign-out-consequence';

/**
 * 🔴 **What renders when Clerk is not configured — and it exists for a testability reason, not a
 * cosmetic one.**
 *
 * Both harnesses deliberately blank the Clerk keys (`e2e-local.ts`, `screenshot-ephemeral.ts`), so
 * `clerkIsConfigured()` is false, `app/layout.tsx` renders no `<ClerkProvider>`, and a `useClerk()`
 * component would **throw**. 1c-3a's seam supplied a *principal*, not *keys*, and arming real keys
 * in the harness would permanently destroy `e2e/theme.spec.ts`'s one-way zero-egress assertion.
 *
 * Without this, the control would ship with **no screenshot, no axe scan and no tap-target
 * measurement** — AGENTS.md requires all three for any UI change. So the block renders with the same
 * markup, the same `min-h-11`, and the same consequence line, disabled. The harness captures and
 * measures the shape; the live control is verified by hand against the dev instance
 * (`runbooks.md` → AUTH-1).
 */
export function SignOutPlaceholder() {
  return (
    <Button type="button" variant="outline" disabled aria-describedby={SIGN_OUT_CONSEQUENCE_ID}>
      {SIGN_OUT_COPY.action}
    </Button>
  );
}
