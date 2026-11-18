import { NextResponse } from 'next/server';

import { catalogHowToSchema } from '@mat-plan/shared';

import { getHowTo } from '@/lib/dal/program/picker';
import { sessionUserOrNull } from '@/lib/dal/session';

/**
 * "How to" for one picker option (FAM-1 7b; CAT-3 P16): the movement's name, its steps and its
 * supervision label, or a 404. Built as the export handler is (`app/p/[profileId]/export/route.ts`):
 *
 * - **The session, in-process** (`sessionUserOrNull`), never inherited from the proxy.
 * - **One answer for every miss: a 404**, byte-identical whether the caller is signed out, the id is
 *   not a uuid, it names nothing, it is another household's, it is the household's own item, or a
 *   built-in with no library entry (ADR 0006). A 200 always has a body.
 * - **Never cached:** `force-dynamic` (a handler inherits no segment config) and `no-store, private`
 *   on every response.
 *
 * The answer is built with the strict `catalogHowToSchema`, so no slug or id rides along.
 */
export const dynamic = 'force-dynamic';

const NO_STORE = { 'cache-control': 'no-store, private' } as const;

/** The one miss answer. */
const notFound = () => new NextResponse('Not found', { status: 404, headers: NO_STORE });

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ optionId: string }> },
) {
  if (!(await sessionUserOrNull())) return notFound();
  const { optionId } = await params;
  const howTo = await getHowTo(optionId);
  if (!howTo) return notFound();
  return NextResponse.json(catalogHowToSchema.parse(howTo), { headers: NO_STORE });
}
