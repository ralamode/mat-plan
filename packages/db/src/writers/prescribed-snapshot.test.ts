import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prescribedSnapshotsFor } from './prescribed-snapshot';

const programDayRows = vi.hoisted(() => vi.fn());
vi.mock('../queries/program-day', () => ({ programDayRows }));

/**
 * The log-time snapshot resolver's two rules (V1-22 chunk 2). The contract is
 * `docs/plans/v1-22-2-renderer-and-writer.md` → § Decisions and A2.
 *
 * ⚠️ **This is the tier that can prove "no query was issued".** `db:verify` runs on PGlite with no
 * statement counter, so a case there could assert the returned map and nothing about whether the
 * program was read — the plan originally specified that proof at the wrong tier. Here the mock is
 * the counter.
 */

const row = (movementId: number, over = {}) => ({
  movementId,
  sets: null,
  targetReps: null,
  load: null,
  reps: null,
  ...over,
});

const args = (over = {}) => ({
  profilePublicId: 'p-1',
  scope: { householdId: 1 } as never,
  dayRole: 'strength_a',
  movementIds: [7],
  ...over,
});

beforeEach(() => programDayRows.mockReset());

describe('rule 1 — no asserted day role means no snapshot AND no query', () => {
  /**
   * 🔴 Not an optimisation. The legacy fallback keys on `sessions.day_role`, so a session logged as
   * "Not a programmed day" — one tap on the form's empty option — emits `''` for every row.
   * Snapshotting it would make the frozen and live paths disagree on a shape the form produces
   * trivially.
   */
  it('returns an empty map, without reading the program, when no day role is asserted', async () => {
    const out = await prescribedSnapshotsFor({} as never, args({ dayRole: undefined }));
    expect(out.size).toBe(0);
    expect(programDayRows).not.toHaveBeenCalled();
  });

  it('refuses a day role that is not in the schema, rather than querying with it', async () => {
    // ⚠️ Narrowed by `dayRoleSchema`, not an `as DayRole` cast: `verify.ts` and a future `/api/sync`
    // reach this writer without passing through the app's zod boundary. A cast would hand an
    // unknown role to a typed query, which would silently return no rows and look identical.
    const out = await prescribedSnapshotsFor({} as never, args({ dayRole: 'not-a-role' }));
    expect(out.size).toBe(0);
    expect(programDayRows).not.toHaveBeenCalled();
  });

  it('does not query when the session carries no movements', async () => {
    const out = await prescribedSnapshotsFor({} as never, args({ movementIds: [] }));
    expect(out.size).toBe(0);
    expect(programDayRows).not.toHaveBeenCalled();
  });
});

describe('rule 2 — a day role IS asserted, so every movement freezes', () => {
  it('freezes the rendered prescription when the movement is programmed', async () => {
    programDayRows.mockResolvedValue([row(7, { sets: 3, targetReps: '10', load: '45' })]);
    const out = await prescribedSnapshotsFor({} as never, args());
    expect(out.get(7)).toBe('3x10 @ 45');
  });

  /**
   * 🔴 **The empty string is a REAL frozen value.** An `open()` prescription renders `''` — 11 of
   * the 13 seeded — and a truthiness guard anywhere on this path stores NULL for all of them, which
   * sends every one back to the live fallback at export time. That is the defect this chunk exists
   * to close, and it would be invisible: by acceptance 11 the fallback emits identical bytes.
   */
  it("freezes an open() prescription as '' — not as absent", async () => {
    programDayRows.mockResolvedValue([row(7)]);
    const out = await prescribedSnapshotsFor({} as never, args());
    expect(out.has(7)).toBe(true);
    expect(out.get(7)).toBe('');
  });

  /**
   * 🔴 The amendment the UX lens raised as BLOCKING. Leaving NULL here is not "degrades to today's
   * behaviour" once chunk 4 lands: a NULL row re-runs the LIVE fallback at every export, so every
   * later edit rewrites it — for every hand-typed movement and every day-role flip. Freezing what
   * the live path would have emitted at this moment makes the row stable instead.
   */
  it("freezes '' for a movement this day does not program", async () => {
    programDayRows.mockResolvedValue([row(9, { sets: 3, targetReps: '10' })]);
    const out = await prescribedSnapshotsFor({} as never, args());
    expect(out.has(7)).toBe(true);
    expect(out.get(7)).toBe('');
  });

  it("freezes '' when the day programs the movement twice — matching what the export emits", async () => {
    programDayRows.mockResolvedValue([
      row(7, { sets: 2, targetReps: '5' }),
      row(7, { sets: 3, targetReps: '8' }),
    ]);
    const out = await prescribedSnapshotsFor({} as never, args());
    expect(out.get(7)).toBe('');
  });

  it('resolves several movements in one read', async () => {
    programDayRows.mockResolvedValue([
      row(7, { sets: 3, targetReps: '10' }),
      row(9, { sets: 4, targetReps: '6' }),
    ]);
    const out = await prescribedSnapshotsFor({} as never, args({ movementIds: [7, 9] }));
    expect(Object.fromEntries(out)).toEqual({ 7: '3x10', 9: '4x6' });
    expect(programDayRows).toHaveBeenCalledTimes(1);
  });

  it('scopes the program read to the same household the write is authorized for', async () => {
    // The snapshot read sits OUTSIDE the transaction, so it carries the scope explicitly. A foreign
    // scope returns no rows here and the transaction then refuses the write anyway — but the read
    // must not be the place that forgets.
    programDayRows.mockResolvedValue([]);
    const scope = { householdId: 42 } as never;
    await prescribedSnapshotsFor({} as never, args({ scope }));
    expect(programDayRows).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ profilePublicId: 'p-1', dayRole: 'strength_a', scope }),
    );
  });
});
