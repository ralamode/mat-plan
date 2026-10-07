import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SENTRY_DATA_COLLECTION } from '@/lib/sentry-scrub';

/**
 * The wiring half of SENTRY_DATA_COLLECTION's guarantee: both runtime configs actually pass it. The
 * constant's own test pins its values; this pins that nothing ships `Sentry.init` without it.
 */
const init = vi.hoisted(() => vi.fn());
vi.mock('@sentry/nextjs', () => ({ init }));
vi.mock('@/lib/env', () => ({ env: { SENTRY_DSN: undefined } }));

describe.each([
  ['server', () => import('./sentry.server.config')],
  ['edge', () => import('./sentry.edge.config')],
])('sentry.%s.config', (_runtime, load) => {
  beforeEach(() => {
    init.mockClear();
    vi.resetModules();
  });

  it('passes the shared dataCollection, so no field falls back to its collect-everything default', async () => {
    await load();
    expect(init).toHaveBeenCalledTimes(1);
    expect(init.mock.calls[0]?.[0]).toMatchObject({ dataCollection: SENTRY_DATA_COLLECTION });
  });
});
