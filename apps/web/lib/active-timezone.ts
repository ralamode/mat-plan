import 'server-only';

import { cookies } from 'next/headers';

import { DEFAULT_TIME_ZONE, TZ_COOKIE_NAME } from '@/lib/constants';
import { isIanaTimeZone, localDayIso } from '@/lib/date';

/**
 * The active IANA timezone for THIS request (V1-6c). Resolution order (highest wins):
 *   1. household/schedule override — DEFERRED. When `households.timezone` lands this reads
 *      it (given household context), inverting to household-primary + cookie-fallback; that
 *      is a separate, signature-changing refactor, NOT a free plug-in.
 *   2. the client's `tz` cookie   — validated as a real IANA zone (public input → never
 *      trusted raw; anything unresolvable is ignored).
 *   3. DEFAULT_TIME_ZONE          — before the cookie exists (first paint).
 */
export async function getActiveTimeZone(): Promise<string> {
  const cookieTz = (await cookies()).get(TZ_COOKIE_NAME)?.value;
  return isIanaTimeZone(cookieTz) ? cookieTz : DEFAULT_TIME_ZONE;
}

/** Today's LOCAL calendar date in the active tz — the tz-aware replacement for todayIso(). */
export async function getActiveLocalDay(now: Date = new Date()): Promise<string> {
  return localDayIso(await getActiveTimeZone(), now);
}
