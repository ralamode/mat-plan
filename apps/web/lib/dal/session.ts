import 'server-only';

import { cache } from 'react';

import { auth } from '@clerk/nextjs/server';
import { redirect, unstable_rethrow } from 'next/navigation';

import * as Sentry from '@sentry/nextjs';

import { clerkIsConfigured } from '@/lib/clerk';
import { sessionBypassUserId } from '@/lib/env';
import { SIGN_IN_PATH } from '@/lib/constants';

/**
 * THE principal for this request, and the two refusals built on it (AUTH-1 1c-1).
 *
 * **Ships DARK.** Nothing imports this module yet: `1c-3` switches the eleven call sites and `1c-4`
 * switches the resolver. It lands first and alone so the fail-closed contract below can be reviewed
 * and tested on its own, rather than inside the diff that moves the boundary.
 *
 * **ONE module, not two.** The plan's first draft split `user.ts` (the principal) from `session.ts`
 * (the refusals) and the panel rejected it: the second file's functions would be thin wrappers over
 * the first's one, which is a split personality rather than a seam. `lib/dal/gate.ts` — the module
 * this replaces — holds its predicate and its redirect together in 28 lines.
 *
 * ⚠️ **`lib/dal/gate.ts` is NOT deleted here.** Through `1c` both exist: the gate stays the boundary
 * until `1c-3`, and `1d` removes it.
 */

/**
 * AGENTS.md → DAL: _"(1) `getCurrentUser()` (Clerk `auth()`, React-`cache()`d)"_. The **one** place
 * `auth()` is called, for the same reason `getHouseholdScope()` is the one place a household is
 * derived: a second call site is a second place the fail-closed branch can be written differently.
 *
 * 🔴 **FAILS CLOSED, and that is the whole contract.** `auth()` **throws** when `clerkMiddleware()`
 * did not run on this request — SEC-1's lesson generalised: the matcher is not the boundary, so a
 * route the matcher misses must **refuse** rather than resolve. It returns `null` for "no session"
 * and for "`auth()` could not tell" alike, **because a caller that cannot distinguish them cannot get
 * the distinction wrong.**
 *
 * ⚠️ `clerkIsConfigured()` is checked FIRST, and it is not a convenience. With no keys
 * `<ClerkProvider>` is never rendered and `clerkMiddleware()` is never composed (1a's shape), so
 * `auth()` would throw on every request. Returning `null` there is the same fail-closed answer by a
 * cheaper route — and it is why a keys-absent deployment refuses everything rather than erroring
 * everywhere.
 *
 * `cache()` is per-REQUEST, so the seven actions and four pages that call this on one request share a
 * single `auth()`. It is **not** a cross-request cache: AGENTS.md forbids caching per-user data
 * across users, and `app/tenancy-is-not-cached.test.ts` is the standing guard on that.
 */
/** Module-level: the capture below fires once per process, not once per probe. */
let authUnavailableReported = false;

export const getCurrentUser = cache(async (): Promise<{ userId: string } | null> => {
  // AUTH-1 1c-3a — the test session seam, and the ONLY read of it in the repo
  // (`apps/web/test/bypass-is-contained.test.ts` fails the build on a second one).
  //
  // Ahead of `clerkIsConfigured()` deliberately: the harness runs with no Clerk keys, which is the
  // property `e2e/theme.spec.ts` asserts one-way, so there is nothing to fall through to.
  // `lib/env.ts` owns the arming decision and REFUSES AT BOOT if the variable is set anywhere that
  // is not a local throwaway database — so by the time this runs, a non-null answer has already been
  // proved safe. Nothing is re-checked here, because a second predicate is a second thing to get
  // wrong.
  const bypassUserId = sessionBypassUserId();
  if (bypassUserId) return { userId: bypassUserId };

  if (!clerkIsConfigured()) return null;

  try {
    const { userId } = await auth();
    return userId ? { userId } : null;
  } catch (error) {
    // 🔴 NOT every throw means "no session", and swallowing the two that don't is a correctness bug
    // with a long fuse. `@clerk/nextjs@7.9.15`'s `buildRequestLike` deliberately RETHROWS two kinds:
    //
    //  - Next's prerender-bailout signal (`DynamicServerError`, digest `DYNAMIC_SERVER_USAGE`), which
    //    Next itself catches to mark a route dynamic. Swallowed, "this route must render dynamically"
    //    silently becomes "there is no session" — baked into a cached output.
    //  - `ClerkUseCacheError`, which exists precisely so calling `auth()` inside `'use cache'` is a
    //    loud, actionable error rather than a silently cached `null`.
    //
    // `unstable_rethrow` is Next's own list of control-flow errors, so this does not hand-maintain a
    // set that the framework owns. ⚠️ A Route Handler does NOT inherit a layout's `force-dynamic`
    // (`app/tenancy-is-not-cached.test.ts` says so), and 1c-3 switches the export handler — which is
    // exactly where this would otherwise answer "unauthenticated" instead of bailing out.
    unstable_rethrow(error);
    // ⚠️ `ClerkUseCacheError` is NOT exported from any public entry at 7.9.15, so this checks the
    // global-registry symbol — which is what Clerk's own `isClerkUseCacheError` checks.
    if (
      typeof error === 'object' &&
      error !== null &&
      Symbol.for('clerk_use_cache_error') in error
    ) {
      throw error;
    }

    // § Design 1's third property, panel-added: a wholly misconfigured Clerk refuses EVERYONE while
    // emitting nothing distinguishable from ordinary anonymous probing. Tagged, carrying no headers,
    // no cookie and no params — the `scope_outcome` precedent.
    //
    // ⚠️ BOUNDED. This path is reachable by an unauthenticated request to any route the matcher
    // misses, so an uncapped capture is a Sentry-quota drain anyone can pull. Once per process is
    // enough to tell "misconfigured" from "anonymous", which is the whole question it answers.
    if (!authUnavailableReported) {
      authUnavailableReported = true;
      Sentry.captureMessage('auth() unavailable', {
        level: 'warning',
        tags: { auth_outcome: 'auth_unavailable' },
      });
    }

    // `clerkMiddleware()` did not run on this request. Refuse; never resolve.
    return null;
  }
});

/**
 * The principal, or `null` — for the **seven Server Actions**, which must return their typed refusal
 * envelope rather than redirect.
 *
 * 🔴 **Returns the principal, not a boolean.** A boolean cannot supply the `userId` the per-user
 * mutation limit needs, so every action would call `getCurrentUser()` a second time to fetch the key
 * it had just proved exists — two shapes asking one question at one call site, and the source guard
 * in `pages-are-gated.test.ts` would then match the weaker of the two. `lib/rate-limit.ts`'s own
 * docblock predicted this shape: _"Mutation limits land with Clerk at v1.5, when `getCurrentUser()`
 * provides a real identifier."_
 */
export async function sessionUserOrNull(): Promise<{ userId: string } | null> {
  return getCurrentUser();
}

/**
 * For the **four gated pages**: no session → the sign-in screen, as the proxy would have sent it.
 * Mirrors `requireGatedPage()`'s shape exactly, so `1c-3` is a symbol swap at the call sites rather
 * than a reshaping of them, and `1d` is a deletion rather than a rewrite.
 */
export async function requireSession(): Promise<{ userId: string }> {
  const user = await getCurrentUser();
  if (!user) redirect(SIGN_IN_PATH);
  return user;
}
