import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 🔴 **The read-side seam this chunk exists for, which NOTHING else can fail on.**
 *
 * `buildExportEntries` must prefer the stored `prescribed_snapshot` over the live program. A review
 * found that reverting that one line — back to reading the live map unconditionally — left **every**
 * gate green: the pure-module tests exercise `resolvePrescribed` itself rather than its caller,
 * `db:verify` cannot run `export.ts` (it is `server-only`), and the e2e logs and exports under an
 * unchanged program, so the frozen and live bytes coincide there by construction.
 *
 * That is the read-side twin of `docs/lessons.md`'s "a whole feature shipped INERT with every gate
 * green". This file is the pin.
 */

const strengthMonthRows = vi.hoisted(() => vi.fn());
const programDayRows = vi.hoisted(() => vi.fn());
const loggedMonths = vi.hoisted(() => vi.fn());
const bodyweightMonthRows = vi.hoisted(() => vi.fn());
const checkinMonthRows = vi.hoisted(() => vi.fn());

vi.mock('@mat-plan/db', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  strengthMonthRows,
  programDayRows,
  loggedMonths,
  bodyweightMonthRows,
  checkinMonthRows,
}));
vi.mock('./db', () => ({ db: {} }));
vi.mock('./household', () => ({
  getHouseholdScope: async () => ({ householdId: 1, role: 'owner' }),
}));
vi.mock('./profiles', () => ({
  getProfileByPublicId: async () => ({ publicId: 'p-1', name: 'A' }),
}));

const { buildExportEntries } = await import('./export');

/** One flat join row, in the shape `strengthMonthRows` returns. */
const flatRow = (over: Record<string, unknown> = {}) => ({
  entryId: 1,
  date: '2026-03-02',
  dayRole: 'strength_a',
  sessionType: 'strength',
  movementSlug: 'back_squat',
  movementId: 7,
  prescribedSnapshot: null as string | null,
  entryStatus: 'done',
  notes: '',
  setId: 1,
  setIdx: 0,
  reps: 5,
  value: '100',
  unit: 'lb',
  quantityKind: 'load',
  ...over,
});

const prescribedCellOf = (csv: string) => {
  const [header, row] = csv.split('\n');
  return row.split(',')[header.split(',').indexOf('prescribed')];
};

const strengthCsv = async () => {
  const entries = await buildExportEntries('p-1');
  const file = entries.find((e) => e.path.includes('strength-log'));
  expect(file, 'the export produced a strength-log file').toBeTruthy();
  return file!.content;
};

beforeEach(() => {
  for (const m of [
    strengthMonthRows,
    programDayRows,
    loggedMonths,
    bodyweightMonthRows,
    checkinMonthRows,
  ])
    m.mockReset();
  loggedMonths.mockResolvedValue([{ month: '2026-03' }]);
  bodyweightMonthRows.mockResolvedValue([]);
  checkinMonthRows.mockResolvedValue([]);
  programDayRows.mockResolvedValue([
    { movementId: 7, sets: 9, targetReps: 'LIVE', load: null, reps: null },
  ]);
});

describe('buildExportEntries — the frozen value wins over the live program', () => {
  it('emits the SNAPSHOT, and does not read the program at all', async () => {
    strengthMonthRows.mockResolvedValue([flatRow({ prescribedSnapshot: '3x10 @ 45' })]);
    expect(prescribedCellOf(await strengthCsv())).toBe('3x10 @ 45');
    // The live program says `9xLIVE`. If this call happened, the row was re-derived.
    expect(programDayRows).not.toHaveBeenCalled();
  });

  /**
   * 🔴 The case that turns red under `||` AT THE CALL SITE — the regression the pure-module test
   * cannot see. An `open()` prescription freezes as `''`, which is 11 of the 13 seeded.
   */
  it("keeps a frozen '' empty rather than re-deriving it from today's program", async () => {
    strengthMonthRows.mockResolvedValue([flatRow({ prescribedSnapshot: '' })]);
    expect(prescribedCellOf(await strengthCsv())).toBe('');
    expect(programDayRows).not.toHaveBeenCalled();
  });

  it('falls back to the live program only when the snapshot is NULL', async () => {
    strengthMonthRows.mockResolvedValue([flatRow({ prescribedSnapshot: null })]);
    expect(prescribedCellOf(await strengthCsv())).toBe('9xLIVE');
    expect(programDayRows).toHaveBeenCalledTimes(1);
  });

  it('reads the program once for a mixed month, and only for the NULL rows', async () => {
    strengthMonthRows.mockResolvedValue([
      flatRow({ entryId: 1, prescribedSnapshot: '3x10 @ 45' }),
      flatRow({ entryId: 2, setId: 2, prescribedSnapshot: null }),
    ]);
    const csv = await strengthCsv();
    expect(csv).toContain('3x10 @ 45');
    expect(csv).toContain('9xLIVE');
    expect(programDayRows).toHaveBeenCalledTimes(1);
  });
});
