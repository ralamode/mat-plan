import * as Sentry from '@sentry/nextjs';
import { buildExportZip } from '@/lib/dal/export';
import { getProfileByPublicId } from '@/lib/dal/profiles';
import { sessionUserOrNull } from '@/lib/dal/session';
import { checkExportLimit } from '@/lib/rate-limit';
import { NO_STORE, notFound } from '@/lib/route-miss';
import { NextResponse } from 'next/server';

/**
 * `GET /p/<public_id>/export` — the whole CSV tree for one athlete, as a zip (V1-13b).
 *
 * ## Why a Route Handler and not a Server Action
 *
 * AGENTS.md: mutations are Server Actions, **reads / external / batch are Route Handlers**. This is a
 * batch read returning a binary body, which an action cannot do.
 *
 * ## Why it lives under `/p/[profileId]/` and not `/api/`
 *
 * ⚠️ **This docblock used to say the gate matcher excludes `/api`, and quoted a matcher that is no
 * longer in the file.** `api` was dropped from the exclusion at **AUTH-1 1a** — `proxy.ts`'s matcher
 * is `'/((?!_next/static/|_next/image(?:/|$)|favicon\.ico$).*)'`, and both `proxy.ts` and
 * `.github/SECURITY.md` record the hole as closed. Siting the handler under `/p/` was the right call
 * when `/api` was outside, and it stays here because the URL is where the reader already is; it is
 * no longer load-bearing. Corrected on review of #323 — `/api/sync` is the very next surface, and
 * two committed files contradicting each other about whether `/api` is inside the matcher is how the
 * next author gets it wrong.
 *
 * ## The session is re-checked here
 *
 * Required regardless, and not defence in depth: every Route Handler is a **public endpoint**
 * ([write-path](../../../../../docs/features/write-path.md) invariant 1). Middleware is not an
 * authorization boundary — a matcher edit or a rewrite would silently expose it, and SEC-1's scar
 * was a prefetch header skipping the matcher. The checks are cheap and they are what actually holds.
 */
/**
 * 🔴 **SECURITY, not a test artifact.** A Route Handler inherits no segment config, and under ADR
 * 0006 the URL carries no tenant — so a cached response is **one household's CSV served to another**.
 *
 * 🔴 **As of `1d` this directive is the ONLY runtime signal, and that is why it must not be removed.**
 * It used to be belt-and-braces: the gate's unconditional `cookies()` read made every request dynamic
 * anyway, so the directive changed nothing in practice. `1d` deletes that read, and the session half
 * CAN return before touching any dynamic API — the 1c-3a bypass, an env read, `!clerkIsConfigured()`.
 * So on those paths nothing else marks this handler dynamic, and a cached CSV is one household's data
 * served to another. ⚠️ Previously written as a future obligation ("do not remove it at 1d"); the date
 * has arrived, so it is now a present-tense invariant rather than a note to a later author.
 *
 * 📌 It is also the only thing satisfying `tenancy-is-not-cached.test.ts` for this file since the
 * cookie read moved into the DAL — not a second reason any more, the live one.
 */
export const dynamic = 'force-dynamic';

/** The handler itself. Session, then the DAL — see the two blocks above for both. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ profileId: string }> },
) {
  // 🔴 **The session, in-process — AUTH-1 1d.** `getHouseholdScope()` resolves the principal's
  // `household_members` row, so a session proves WHOSE export this is rather than only that the
  // caller is someone this Clerk instance admits. That was the obligation 1d was blocked on.
  //
  // ⚠️ **One conjunct now, and that is a narrowing of the CHECK, not of the boundary.** Until `1d`
  // this read `hasGateAccess()` AND a session: the gate was a shared code anyone holding it could
  // use, so it never identified a caller, and deleting it removes a deterrent rather than an
  // authorization step. The thing that authorizes is the household-scoped session, and it is still
  // re-checked here rather than inherited from the proxy (CVE-2025-29927; SEC-1's scar was a prefetch
  // header skipping the matcher).
  //
  // 404, not 401: an un-authed caller learns nothing about whether this profile exists. Unauth, no
  // session, unknown id and another household's profile are byte-identical to a caller (ADR 0006).
  const user = await sessionUserOrNull();
  if (!user) return notFound();

  const { profileId } = await params;
  // Re-validate the URL-supplied public id server-side — the V1-3 ownership seam. Profile tiles are
  // a UX switch, not a security boundary, so the id is untrusted input here.
  const profile = await getProfileByPublicId(profileId);
  if (!profile) return notFound();

  // 🔴 **The export limit, AFTER the profile check and never before it** (FAM-1 export follow-up,
  // plan PR A). This is a GET, and a session cookie rides a cross-site top-level navigation. A
  // limiter in front of the id check would let any page drain a signed-in parent's budget with
  // `/p/anything/export`; here a drain needs a real, non-enumerable id of the caller's own household,
  // and a miss above still answers the one 404 with no Redis call. Keyed on the principal, never the
  // URL's id. `route.test.ts` pins the order.
  const limit = await checkExportLimit(user.userId);
  if (!limit.allowed) {
    // A fixed string: no profile id, no count. Nothing reads `retry-after` on an `<a download>`, and
    // a second spelling of the window would drift from `EXPORT_RATE_LIMIT`.
    return new NextResponse('Too many downloads. Try again in a few minutes.', {
      status: 429,
      headers: NO_STORE,
    });
  }
  if (limit.reason === 'limiter-error') {
    // The fail-open limiter's only signal, id-free, as `enterMutation` leaves for the ✓ budget.
    Sentry.addBreadcrumb({
      category: 'rate-limit',
      level: 'warning',
      message: 'export limiter unavailable',
    });
  }

  const zip = await buildExportZip(profileId);

  return new NextResponse(zip as BodyInit, {
    headers: {
      'content-type': 'application/zip',
      // `public_id` in the filename, matching the directory inside — so two athletes' exports never
      // collide in a downloads folder.
      'content-disposition': `attachment; filename="mat-plan-${profileId}.zip"`,
      // Per-user data: never cached, never stored by a shared cache.
      ...NO_STORE,
      'content-length': String(zip.byteLength),
    },
  });
}
