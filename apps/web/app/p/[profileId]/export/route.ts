import { buildExportZip } from '@/lib/dal/export';
import { hasGateAccess } from '@/lib/dal/gate';
import { getProfileByPublicId } from '@/lib/dal/profiles';
import { sessionUserOrNull } from '@/lib/dal/session';
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
 * ## The gate AND the session are re-checked here
 *
 * Required regardless, and not defence in depth: every Route Handler is a **public endpoint**
 * ([write-path](../../../../../docs/features/write-path.md) invariant 1). Middleware is not an
 * authorization boundary — a matcher edit or a rewrite would silently expose it, and SEC-1's scar
 * was a prefetch header skipping the matcher. The checks are cheap and they are what actually holds.
 */
/**
 * 🔴 **SECURITY, not a test artifact.** A Route Handler inherits no segment config, and after 1c-3b
 * this handler can have NO dynamic signal of its own: `getCurrentUser()` returns before touching any
 * dynamic API on two live paths — the 1c-3a bypass (an env read) and `!clerkIsConfigured()`. Under
 * ADR 0006 the URL carries no tenant, so a cached response is **one household's CSV served to
 * another**. `tenancy-is-not-cached.test.ts` also accepts this directive in place of the `cookies()`
 * call, but that is the second reason; do not delete this the day that test changes.
 */
export const dynamic = 'force-dynamic';

/** The handler itself. Gate, then session, then the DAL — see the two blocks above for both. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ profileId: string }> },
) {
  // 🔴 **Gate AND session, both in-process — AUTH-1 1c-3b.** The gate is not swapped out: until
  // 1c-4 `getHouseholdScope()` ignores the principal, so a session alone would mean "anyone this
  // Clerk instance admits", and dropping the in-process gate check would leave `mp_gate` enforced by
  // the proxy alone. The gate half is deleted at 1d, after 1c-4.
  //
  // ⚠️ **`hasGateAccess()`, not a hand-rolled cookie read.** This handler carried its own copy of
  // that function's exact body — `isValidGateCookie(cookies().get(GATE_COOKIE_NAME), env.…)` — since
  // V1-13b, and `gate.ts`'s own docblock acknowledged it as "same check as the export Route
  // Handler". 1c-3b added a second conjunct beside that copy without removing it, which is the
  // thing that chunk's own argument is against: a security predicate written twice is two places for
  // the next author to land one conjunct short. It is also the only reason this file read
  // `process.env` at all (AGENTS.md → the DAL owns every env read).
  // 404, not 401: an un-authed caller learns nothing about whether this profile exists.
  if (!(await hasGateAccess())) return new NextResponse('Not found', { status: 404 });

  // Same 404 for the same reason — unauth, no session, unknown id and another household's profile
  // are byte-identical to a caller (ADR 0006).
  if (!(await sessionUserOrNull())) return new NextResponse('Not found', { status: 404 });

  const { profileId } = await params;
  // Re-validate the URL-supplied public id server-side — the V1-3 ownership seam. Profile tiles are
  // a UX switch, not a security boundary, so the id is untrusted input here.
  const profile = await getProfileByPublicId(profileId);
  if (!profile) return new NextResponse('Not found', { status: 404 });

  const zip = await buildExportZip(profileId);

  return new NextResponse(zip as BodyInit, {
    headers: {
      'content-type': 'application/zip',
      // `public_id` in the filename, matching the directory inside — so two athletes' exports never
      // collide in a downloads folder.
      'content-disposition': `attachment; filename="mat-plan-${profileId}.zip"`,
      // Per-user data: never cached, never stored by a shared cache.
      'cache-control': 'no-store, private',
      'content-length': String(zip.byteLength),
    },
  });
}
