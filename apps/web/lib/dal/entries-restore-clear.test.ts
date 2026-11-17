import { RESTORE_REASON } from '@mat-plan/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Restore all's DAL half (V1-9b B1-2): `restoreClear` (which `db:verify` proves against a real
// database) is mocked, and this pins what the DAL makes of its answer: two counts, and nothing else.
const { state, restoreClear, clearEventsForDay } = vi.hoisted(() => ({
  state: { scope: null as unknown },
  restoreClear: vi.fn<(exec: unknown, args: Record<string, unknown>) => Promise<unknown>>(),
  clearEventsForDay: vi.fn<(exec: unknown, args: Record<string, unknown>) => Promise<unknown>>(
    async () => [],
  ),
}));

vi.mock('./db', () => ({ db: {} }));
vi.mock('./household', () => ({ getHouseholdScope: async () => state.scope }));
vi.mock('./catalog', () => ({}));
vi.mock('@mat-plan/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@mat-plan/db')>()),
  restoreClear,
  clearEventsForDay,
}));

import { dayClearEvents, restoreClearedDay } from './entries';

const ARGS = {
  profilePublicId: '019826b4-0000-7000-8000-000000000099',
  day: '2026-11-17',
  hiddenAt: '2026-11-17T18:04:05.123456Z',
};
const item = (n: number, reason: string, extra: object = {}) => ({
  entryPublicId: `019826b4-0000-7000-8000-00000000010${n}`,
  reason,
  ...extra,
});
// A live weigh-in's value, as `restoreOne` puts it on a `slot_taken` item. It must not leave the DAL.
const HELD_VALUE = '112.4';

beforeEach(() => {
  state.scope = { householdId: 1 };
  restoreClear.mockReset();
  clearEventsForDay.mockClear();
});

describe('restoreClearedDay (V1-9b B1-2)', () => {
  it('counts ok as restored and slot_taken as kept hidden; the held value never leaves', async () => {
    restoreClear.mockResolvedValueOnce({
      items: [
        item(1, RESTORE_REASON.ok),
        item(2, RESTORE_REASON.ok),
        item(3, RESTORE_REASON.slot_taken, {
          heldBy: { entryPublicId: 'holder', value: HELD_VALUE, hiddenAt: null },
        }),
      ],
    });
    const result = await restoreClearedDay(ARGS);
    expect(result).toEqual({ restored: 2, keptHidden: 1 });
    expect(JSON.stringify(result)).not.toContain(HELD_VALUE);
    expect(restoreClear.mock.calls[0]![1]).toEqual({ ...ARGS, scope: state.scope });
  });

  it('a race answer (changed, not_found) counts in neither: the revalidated page is the truth', async () => {
    restoreClear.mockResolvedValueOnce({
      items: [
        item(1, RESTORE_REASON.ok),
        item(2, RESTORE_REASON.changed),
        item(3, RESTORE_REASON.not_found),
      ],
    });
    expect(await restoreClearedDay(ARGS)).toEqual({ restored: 1, keptHidden: 0 });
  });

  it('a clear with nothing left under it is 0 and 0, "nothing left to restore"', async () => {
    restoreClear.mockResolvedValueOnce({ notFound: true });
    expect(await restoreClearedDay(ARGS)).toEqual({ restored: 0, keptHidden: 0 });
  });

  it('a null scope THROWS, never a quiet "nothing to restore"', async () => {
    state.scope = null;
    await expect(restoreClearedDay(ARGS)).rejects.toThrow('Profile not found');
    expect(restoreClear).not.toHaveBeenCalled();
  });
});

describe('dayClearEvents (V1-9b B1-2)', () => {
  it('reads the scoped events', async () => {
    const events = [{ hiddenAt: ARGS.hiddenAt, count: 2 }];
    clearEventsForDay.mockResolvedValueOnce(events);
    expect(await dayClearEvents(ARGS.profilePublicId, ARGS.day)).toEqual(events);
    expect(clearEventsForDay.mock.calls[0]![1]).toEqual({
      profilePublicId: ARGS.profilePublicId,
      day: ARGS.day,
      scope: state.scope,
    });
  });

  it('with no scope, reads nothing', async () => {
    state.scope = null;
    expect(await dayClearEvents(ARGS.profilePublicId, ARGS.day)).toEqual([]);
    expect(clearEventsForDay).not.toHaveBeenCalled();
  });
});
