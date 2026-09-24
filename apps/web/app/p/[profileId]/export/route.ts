import { GATE_COOKIE_NAME, isValidGateCookie } from '@/lib/access-gate';
import { buildExportZip } from '@/lib/dal/export';
import { getProfileByPublicId } from '@/lib/dal/profiles';
import { env } from '@/lib/env';
import { cookies } from 'next/headers';
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
 * ⚠️ **The access gate's matcher explicitly excludes `/api`** (`proxy.ts`:
 * `'/((?!api|_next/static|_next/image|favicon.ico).*)'`). A handler at `/api/export` would be
 * **completely ungated** — the athletes' whole training history downloadable by anyone with the URL.
 * Siting it under `/p/` puts it back inside the matcher.
 *
 * That exclusion is a real hazard for the `/api/sync` AGENTS.md plans; recorded in tech-debt.
 *
 * ## The gate is ALSO re-checked here
 *
 * Defence in depth, and required regardless: every Route Handler is a **public endpoint**
 * ([write-path](../../../../../docs/features/write-path.md) invariant 1). Middleware is not an
 * authorization boundary — a matcher edit, a rewrite, or a future `/api` move would silently expose
 * it. The check is cheap and it is the thing that actually holds.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ profileId: string }> },
) {
  const authed = await isValidGateCookie(
    (await cookies()).get(GATE_COOKIE_NAME)?.value,
    env.ACCESS_GATE_PASSWORD,
  );
  // 404, not 401: an un-authed caller learns nothing about whether this profile exists.
  if (!authed) return new NextResponse('Not found', { status: 404 });

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
