import { beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_HOME_PATH, GATE_COPY } from '@/lib/constants';

/**
 * The gate action's redirect target (OSS-2). Only the target is under test here: the code check, the
 * rate limit and the cookie are covered where they live (`access-gate.test.ts`, `rate-limit`).
 */

// Records instead of throwing: the action's last statement is the redirect, so nothing runs after it.
const redirect = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ redirect }));
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ set: vi.fn() })),
  headers: vi.fn(async () => new Headers()),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, reason: 'ok' })),
}));

const { submitGate } = await import('./actions');

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
}

async function landing(fields: Record<string, string>): Promise<string> {
  await submitGate({ error: null }, form(fields));
  expect(redirect).toHaveBeenCalledTimes(1);
  return redirect.mock.calls[0]![0];
}

describe('submitGate redirect target', () => {
  const password = process.env.ACCESS_GATE_PASSWORD!;
  beforeEach(() => redirect.mockClear());

  it('goes to the app home, not the public landing, when there is no from', async () => {
    expect(await landing({ password })).toBe(APP_HOME_PATH);
  });

  it.each(['/', '/?x=1', '/#top'])(
    'goes to the app home when from is the landing (%s)',
    async (from) => {
      expect(await landing({ password, from })).toBe(APP_HOME_PATH);
    },
  );

  it('goes to the app home when from is hostile', async () => {
    expect(await landing({ password, from: '//evil.example' })).toBe(APP_HOME_PATH);
  });

  it('keeps a safe internal from', async () => {
    expect(await landing({ password, from: '/p/abc/routine' })).toBe('/p/abc/routine');
  });

  it('does not redirect on a wrong code', async () => {
    expect(await submitGate({ error: null }, form({ password: 'wrong' }))).toEqual({
      error: GATE_COPY.incorrect,
    });
    expect(redirect).not.toHaveBeenCalled();
  });
});
