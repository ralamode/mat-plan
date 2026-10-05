'use server';

import { ipAddress } from '@vercel/functions';
import * as Sentry from '@sentry/nextjs';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { GATE_COOKIE_NAME, gateTokenFor, safeInternalPath } from '@/lib/access-gate';
import { APP_HOME_PATH, COOKIE_MAX_AGE } from '@/lib/constants';
import { env } from '@/lib/env';
import { checkRateLimit } from '@/lib/rate-limit';

/**
 * Server Action for the access-gate stopgap. A Server Action is a PUBLIC POST
 * endpoint, so it validates its own input (zod) and never trusts the form — the
 * same discipline every mutation follows (see AGENTS.md server conventions).
 */

const gateSchema = z.object({
  password: z.string().min(1),
  from: z.string().optional(),
});

export type GateState = { error: string | null };

export async function submitGate(_prev: GateState, formData: FormData): Promise<GateState> {
  // NOTE: deliberately NOT wrapped in `withServerActionInstrumentation`, and deliberately not passing
  // `formData` anywhere near Sentry — this action's form field is the plaintext access code.
  const parsed = gateSchema.safeParse({
    password: formData.get('password'),
    from: formData.get('from') ?? undefined,
  });
  if (!parsed.success) {
    return { error: 'Enter the access code.' };
  }

  // RATE LIMIT (V1-14a). This is the app's only unauthenticated password oracle, guarding its only
  // shared secret — SECURITY.md lists "auth" first for rate limiting. Keyed by the client IP as
  // computed by VERCEL PROXY (`x-real-ip`), which the client cannot set; the gate cookie would be
  // useless here, since a brute-forcer by definition doesn't have one.
  //
  // Returns the SAME typed envelope as a wrong code — a throw here would render `error.tsx` and, on a
  // `useActionState` form, lose the user's place. Fails OPEN when Upstash is unconfigured or unhealthy
  // (see lib/rate-limit.ts): locking Ray out of his own app is worse than a briefly wider guess window.
  const ip = ipAddress({ headers: await headers() }) ?? 'unknown';
  const limit = await checkRateLimit(`gate:${ip}`);
  if (!limit.allowed) {
    return { error: 'Too many attempts. Try again in a few minutes.' };
  }
  if (limit.reason === 'limiter-error') {
    // A breadcrumb, not an event: one blip is noise, but a permanently-dead limiter should be visible
    // in the trail of any later incident rather than failing open in total silence.
    Sentry.addBreadcrumb({
      category: 'rate-limit',
      level: 'warning',
      message: 'gate rate limiter unavailable — failed open',
    });
  }

  // Compare derived tokens, not raw strings — the code is never string-compared directly.
  const [submitted, expected] = await Promise.all([
    gateTokenFor(parsed.data.password),
    gateTokenFor(env.ACCESS_GATE_PASSWORD),
  ]);
  if (submitted !== expected) {
    return { error: 'Incorrect access code.' };
  }

  const cookieStore = await cookies();
  cookieStore.set(GATE_COOKIE_NAME, expected, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });

  // No usable `from` → the app home (OSS-2), in ONE hop. `safeInternalPath`'s `'/'` fallback is now the
  // public landing, which the proxy would bounce to the picker anyway — a second redirect. Resolved
  // here rather than inside `safeInternalPath`, the hostile-input sink SEC-4 hardened.
  const to = safeInternalPath(parsed.data.from);
  redirect(to === '/' ? APP_HOME_PATH : to);
}
