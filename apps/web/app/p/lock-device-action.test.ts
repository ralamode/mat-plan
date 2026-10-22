import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GATE_COOKIE_NAME, GATE_PATH } from '@/lib/access-gate';

/**
 * Boundary tests for the picker's "Lock this device" action. A Server Action is a PUBLIC POST, so the
 * two that matter are: an UNGATED caller clears nothing, and a gated one clears exactly the gate
 * cookie. `pages-are-gated.test.ts` proves the `hasGateAccess()` call is *present*; this proves it is
 * *reached before* the cookie is touched — neither alone is the claim.
 */

// Records instead of throwing: the real `redirect` throws, and the action's own control flow depends
// on nothing running after it, so a recording stub keeps both assertions observable in one call.
const redirect = vi.hoisted(() => vi.fn());
const deleteCookie = vi.hoisted(() => vi.fn());
const hasGateAccess = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({ redirect }));
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ delete: deleteCookie })) }));
vi.mock('@/lib/dal/gate', () => ({ hasGateAccess }));

const { lockDeviceAction } = await import('./lock-device-action');

describe('lockDeviceAction', () => {
  beforeEach(() => {
    redirect.mockClear();
    deleteCookie.mockClear();
    hasGateAccess.mockReset();
  });

  it('an ungated caller clears NOTHING and is sent to the gate', async () => {
    hasGateAccess.mockResolvedValue(false);
    await lockDeviceAction();
    expect(deleteCookie).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith(GATE_PATH);
  });

  it('a gated caller clears the gate cookie and lands on the explained gate', async () => {
    hasGateAccess.mockResolvedValue(true);
    await lockDeviceAction();
    expect(deleteCookie).toHaveBeenCalledWith(GATE_COOKIE_NAME);
    expect(redirect).toHaveBeenCalledWith(`${GATE_PATH}?locked=1`);
  });

  it('clears the cookie by the shared const, never a re-typed string', async () => {
    hasGateAccess.mockResolvedValue(true);
    await lockDeviceAction();
    expect(deleteCookie.mock.calls[0]![0]).toBe(GATE_COOKIE_NAME);
  });
});
