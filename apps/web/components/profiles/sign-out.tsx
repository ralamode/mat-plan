'use client';

import { useClerk } from '@clerk/nextjs';

import { Button } from '@/components/ui/button';
import { SIGN_OUT_COPY } from '@/lib/constants';

/**
 * Sign out (AUTH-1 1c-3b) — the app's first real one, and the control `NO_HOUSEHOLD_COPY` spent a
 * chunk promising.
 *
 * 🔴 **It clears the CLERK SESSION ONLY, and that is a decision with a table behind it.**
 * _(Settled by the maintainer, 2026-10-29.)_ Between 1c-3b and 1d the boundary is `mp_gate` AND a
 * session, so:
 *
 *  - **Clerk session only** — everything the session protects is gone. The device keeps `mp_gate`,
 *    which on its own grants nothing but the right to be asked to sign in. Re-entry is one tap.
 *  - **Clerk + `mp_gate`** — a PERMANENT LOCKOUT. The user is bounced to `/gate` and now needs the
 *    shared household code to get back into their own household; after 1c-4 that reader is an
 *    invited parent who does not have it. And the button that did it said "Sign out".
 *  - **`mp_gate` only** — what #303 did, and why #303 was parked.
 *
 * `sign-out.test.tsx` pins that this file names no cookie, because "sign-out doesn't clear the gate
 * cookie" reads as an oversight to the next author and the obvious "fix" is the lockout above.
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
