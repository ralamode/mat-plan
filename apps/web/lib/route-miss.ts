import 'server-only';

import { NextResponse } from 'next/server';

/**
 * Per-user responses are never cached and never stored by a shared cache: a Route Handler's success
 * AND its miss carry this, so a 404 for one household's id is not served to another from a cache.
 */
export const NO_STORE = { 'cache-control': 'no-store, private' } as const;

/**
 * **The one miss answer for a per-user Route Handler** (the export, the how-to): a 404,
 * byte-identical whether the caller is signed out, the id is unknown, or it belongs to another
 * household (ADR 0006), so a caller learns nothing about what exists. Never cached.
 */
export function notFound(): NextResponse {
  return new NextResponse('Not found', { status: 404, headers: NO_STORE });
}
