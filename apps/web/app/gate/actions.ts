'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { GATE_COOKIE_NAME, gateTokenFor, safeInternalPath } from '@/lib/access-gate';
import { COOKIE_MAX_AGE } from '@/lib/constants';
import { env } from '@/lib/env';

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
  const parsed = gateSchema.safeParse({
    password: formData.get('password'),
    from: formData.get('from') ?? undefined,
  });
  if (!parsed.success) {
    return { error: 'Enter the access code.' };
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

  redirect(safeInternalPath(parsed.data.from));
}
