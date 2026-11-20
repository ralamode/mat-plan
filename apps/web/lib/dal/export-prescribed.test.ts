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
const reportAuthorityRefusal = vi.hoisted(() => vi.fn());
/** The caller's scope, per test. `null` is "no household"; the role decides the export (PR B). */
const scope = vi.hoisted(() => ({ current: null as { householdId: number; role: string } | null }));
const profile = vi.hoisted(() => ({ current: { publicId: 'p-1', name: 'A' } as object | null }));

vi.mock('@mat-plan/db', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  strengthMonthRows,
  programDayRows,
  loggedMonths,
  bodyweightMonthRows,
  checkinMonthRows,
}));
vi.mock('./db', () => ({ db: {} }));
vi.mock('./household', async () => ({
  // The real const, so the assertion below cannot pass on a re-typed string.
  AUTHORITY_ACTION: (await vi.importActual<typeof import('./household')>('./household'))
    .AUTHORITY_ACTION,
  getHouseholdScope: async () => scope.current,
  reportAuthorityRefusal,
}));
vi.mock('./profiles', () => ({
  getProfileByPublicId: async () => profile.current,
}));

import type { CheckinMonthRow, StrengthMonthRow } from '@mat-plan/db';
import { ACTIVITY_TYPE_KEYS, HOUSEHOLD_ROLE, METRIC_KEYS, PRACTICE_UNIT } from '@mat-plan/shared';
import { bodyweightPath, checkinsPath, readCsvLine, strengthLogPath } from '@mat-plan/shared/csv';

const { buildExportEntries } = await import('./export');
const { AUTHORITY_ACTION } = await import('./household');

/**
 * One flat join row. ⚠️ **Typed as `StrengthMonthRow`**, so `pnpm typecheck` guards the shape: the
 * mocks are untyped `vi.fn()`s, and the first version of this fixture carried `value`/`quantityKind`
 * where the query returns `valueNum`/`slot` — a drift nothing would have reported.
 */
const flatRow = (over: Partial<StrengthMonthRow> = {}): StrengthMonthRow => ({
  entryId: 1,
  date: '2026-03-02',
  entryStatus: 'done',
  notes: null,
  movementSlug: 'back_squat',
  movementId: 7,
  prescribedSnapshot: null,
  dayRole: 'strength_a',
  sessionType: 'strength',
  sessionId: 1,
  entrySessionId: 1,
  createdAt: new Date('2026-03-02T12:00:00Z'),
  prescriptionId: null,
  prescriptionSet: null,
  isProgramRow: false,
  workoutName: null,
  setId: 1,
  setIdx: 0,
  reps: 5,
  setStatus: 'done',
  isBodyweight: false,
  isBand: false,
  slot: 'load',
  unit: 'lb',
  valueNum: '100',
  ...over,
});

const prescribedCellOf = (csv: string) => {
  const [header, row] = csv.split('\n');
  return readCsvLine(row)[readCsvLine(header).indexOf('prescribed')];
};

const strengthCsv = async () => {
  const entries = (await buildExportEntries('p-1'))!;
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
  reportAuthorityRefusal.mockReset();
  scope.current = { householdId: 1, role: HOUSEHOLD_ROLE.owner };
  profile.current = { publicId: 'p-1', name: 'A' };
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

describe('buildExportEntries — the check-ins file (FAM-1 14b)', () => {
  it('writes each logged check-in, and never the read’s entry id', async () => {
    strengthMonthRows.mockResolvedValue([]);
    const row: CheckinMonthRow = {
      entryId: 4242,
      date: '2026-03-02',
      activity: ACTIVITY_TYPE_KEYS.wrestling_practice,
      metric: METRIC_KEYS.practice_minutes,
      valueNum: '90.000',
      valueText: null,
      unit: PRACTICE_UNIT,
      notes: null,
    };
    checkinMonthRows.mockResolvedValue([row]);
    const entries = (await buildExportEntries('p-1'))!;
    const file = entries.find((e) => e.path.includes('checkins'))!.content;
    expect(file).toBe(
      'date,activity,metric,value,unit,notes\n2026-03-02,wrestling-practice,practice-minutes,90,min,\n',
    );
    expect(file).not.toContain('4242');
    expect(checkinMonthRows.mock.calls[0][1]).toMatchObject({
      profilePublicId: 'p-1',
      month: '2026-03',
    });
  });
});

/**
 * FAM-1 export follow-up, PR B (the maintainer's Q1, 2026-11-19): only the household's owner gets
 * an export. The real `ownerScope` narrows the mocked scope, so a role check written any other way
 * shows up here.
 */
describe('buildExportEntries — the export is the owner’s', () => {
  it('🔴 the owner: three files a month, in order, as before', async () => {
    strengthMonthRows.mockResolvedValue([]);
    loggedMonths.mockResolvedValue([{ month: '2026-03' }, { month: '2026-02' }]);
    const entries = (await buildExportEntries('p-1'))!;
    expect(entries.map((e) => e.path)).toEqual(
      ['2026-03', '2026-02'].flatMap((m) => [
        strengthLogPath('p-1', m),
        bodyweightPath('p-1', m),
        checkinsPath('p-1', m),
      ]),
    );
    expect(reportAuthorityRefusal).not.toHaveBeenCalled();
  });

  it('🔴 a member: refused (null), no month or file read, one authority refusal', async () => {
    scope.current = { householdId: 1, role: HOUSEHOLD_ROLE.member };
    expect(await buildExportEntries('p-1')).toBeNull();
    for (const read of [loggedMonths, strengthMonthRows, bodyweightMonthRows, checkinMonthRows]) {
      expect(read).not.toHaveBeenCalled();
    }
    expect(reportAuthorityRefusal).toHaveBeenCalledTimes(1);
    expect(reportAuthorityRefusal).toHaveBeenCalledWith(AUTHORITY_ACTION.exportProfile);
  });

  it('an unknown profile and a missing household are refusals too, never an empty zip', async () => {
    profile.current = null;
    expect(await buildExportEntries('p-1')).toBeNull();
    profile.current = { publicId: 'p-1', name: 'A' };
    scope.current = null;
    expect(await buildExportEntries('p-1')).toBeNull();
    expect(loggedMonths).not.toHaveBeenCalled();
    expect(reportAuthorityRefusal).not.toHaveBeenCalled();
  });
});
