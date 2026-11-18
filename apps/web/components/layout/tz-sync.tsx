'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { COOKIE_MAX_AGE, TZ_COOKIE_NAME } from '@/lib/constants';

/**
 * Reports the device's IANA timezone to the server via the `tz` cookie, so the RSC can
 * compute the local calendar day (V1-6c). On first paint the server rendered with
 * DEFAULT_TIME_ZONE (cookie absent) or a stale cookie (after travel); when the detected
 * zone differs from the one the server used, we `router.refresh()` so the workout day
 * corrects to the phone's local calendar. When they match — the common case for the
 * household, and every later visit — we write the cookie but DON'T refresh (no flicker).
 * Imports only zero-dep constants (never `lib/date`), so no `zod` reaches this client
 * chunk. Renders nothing.
 */
export function TimeZoneSync({ serverTimeZone }: { serverTimeZone: string }) {
  const router = useRouter();
  useEffect(() => {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!detected) return;
    // Non-httpOnly (the client must write it) + SameSite=Lax. Rewritten each mount so travel updates it.
    document.cookie = `${TZ_COOKIE_NAME}=${detected}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
    if (detected !== serverTimeZone) router.refresh();
  }, [serverTimeZone, router]);
  return null;
}
