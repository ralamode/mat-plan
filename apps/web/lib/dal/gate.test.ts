import { beforeEach, describe, expect, it, vi } from 'vitest';

// The gate re-check every Server Action and gated page runs first (SEC-1). Exercised as a plain fn
// with next/headers mocked; the shared code is vitest.config's ACCESS_GATE_PASSWORD.
const cookieValue = { current: undefined as string | undefined };
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: () => (cookieValue.current === undefined ? undefined : { value: cookieValue.current }),
  })),
}));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
}));

import { GATE_PATH, gateTokenFor } from '@/lib/access-gate';
import { env } from '@/lib/env';

import { hasGateAccess, requireGatedPage } from './gate';

beforeEach(() => {
  cookieValue.current = undefined;
});

describe('hasGateAccess', () => {
  it('refuses a request with no gate cookie', async () => {
    expect(await hasGateAccess()).toBe(false);
  });

  it('refuses a cookie that is not the token for the current code', async () => {
    cookieValue.current = await gateTokenFor('some-other-code-9999');
    expect(await hasGateAccess()).toBe(false);
  });

  it('accepts the token for the current code', async () => {
    cookieValue.current = await gateTokenFor(env.ACCESS_GATE_PASSWORD);
    expect(await hasGateAccess()).toBe(true);
  });
});

describe('requireGatedPage', () => {
  it('redirects an un-gated render to the gate', async () => {
    await expect(requireGatedPage()).rejects.toThrow(`redirect:${GATE_PATH}`);
  });

  it('lets a gated render through', async () => {
    cookieValue.current = await gateTokenFor(env.ACCESS_GATE_PASSWORD);
    await expect(requireGatedPage()).resolves.toBeUndefined();
  });
});
