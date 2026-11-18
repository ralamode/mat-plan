import { ENTRY_STATUS, QUANTITY_SLOT, SESSION_TYPE, SET_STATUS } from '@mat-plan/shared';
import { describe, expect, it } from 'vitest';

import { foldStrengthMonth, type StrengthMonthRow } from './export-month';

/**
 * `foldStrengthMonth` (FAM-1 14a): one strength-log row per program item in a session, and one per
 * entry for everything else. Pure, so these cases run without a database; `db:verify`'s 14a proof
 * runs the same function on rows `logRow` wrote.
 */

let nextId = 1;
const at = (minute: number) => new Date(Date.UTC(2026, 10, 17, 18, minute));

/** One flat row of a program ✓: one entry, one set, one primary quantity in lb. */
const programRow = (o: Partial<StrengthMonthRow> & { load?: string } = {}): StrengthMonthRow => {
  const id = nextId++;
  const { load = '25', ...over } = o;
  return {
    entryId: id,
    date: '2026-11-17',
    entryStatus: ENTRY_STATUS.done,
    notes: null,
    movementSlug: 'bench_press',
    movementId: 1,
    prescribedSnapshot: '3 × 8 @ 25 lb',
    dayRole: null,
    sessionType: SESSION_TYPE.workout,
    sessionId: 10,
    entrySessionId: 10,
    createdAt: at(id),
    prescriptionId: 100,
    prescriptionSet: 1,
    isProgramRow: true,
    workoutName: 'Heavy A',
    setId: id,
    setIdx: 1,
    reps: 8,
    setStatus: SET_STATUS.done,
    isBodyweight: false,
    isBand: false,
    slot: QUANTITY_SLOT.primary,
    unit: 'lb',
    valueNum: load,
    ...over,
  };
};

const shape = (rows: StrengthMonthRow[]) =>
  foldStrengthMonth(rows).map((r) => ({
    slug: r.movementSlug,
    loads: r.sets.map((s) => s.quantities[0]?.value),
    snapshot: r.prescribedSnapshot,
  }));

describe('foldStrengthMonth (FAM-1 14a)', () => {
  it('folds three sets of one prescription into one row, with its workout name', () => {
    const rows = [1, 2, 3].map((set) => programRow({ prescriptionSet: set }));
    const folded = foldStrengthMonth(rows);
    expect(folded).toHaveLength(1);
    expect(folded[0].sets).toHaveLength(3);
    expect(folded[0].workoutName).toBe('Heavy A');
  });

  it('keeps one movement twice in a workout as two rows', () => {
    const rows = [
      programRow({ prescriptionId: 100, prescriptionSet: 1 }),
      programRow({ prescriptionId: 101, prescriptionSet: 1, load: '30' }),
    ];
    expect(shape(rows).map((r) => r.loads)).toEqual([['25'], ['30']]);
  });

  it('keeps two purged prescriptions of different movements as two rows, each its own', () => {
    const rows = [
      programRow({ prescriptionId: null, movementId: 1, movementSlug: 'bench_press' }),
      programRow({ prescriptionId: null, movementId: 2, movementSlug: 'back_squat', load: '40' }),
    ];
    expect(shape(rows).map((r) => [r.slug, r.loads])).toEqual([
      ['bench_press', ['25']],
      ['back_squat', ['40']],
    ]);
  });

  it('folds two purged prescriptions of the SAME movement into one row (the known limit, R4)', () => {
    const rows = [
      programRow({ prescriptionId: null, prescriptionSet: 1 }),
      programRow({ prescriptionId: null, prescriptionSet: 1, load: '30' }),
    ];
    expect(shape(rows)).toHaveLength(1);
    expect(shape(rows)[0].loads).toEqual(['25', '30']);
  });

  it('keeps rows of one foreign session on two dates apart (the date is in the key)', () => {
    const rows = [
      programRow({ sessionId: null, workoutName: null, sessionType: null }),
      programRow({ sessionId: null, workoutName: null, sessionType: null, date: '2026-11-16' }),
    ];
    const folded = foldStrengthMonth(rows);
    expect(folded.map((r) => r.date)).toEqual(['2026-11-17', '2026-11-16']);
    expect(folded.map((r) => r.workoutName)).toEqual([null, null]);
  });

  it('keys on the ENTRY’s own session, not the joined one, which is NULL for a foreign session', () => {
    const foreign = { sessionId: null, workoutName: null, sessionType: null };
    const rows = [
      programRow({ ...foreign, entrySessionId: 10 }),
      programRow({ ...foreign, entrySessionId: 11 }),
    ];
    expect(foldStrengthMonth(rows)).toHaveLength(2);
  });

  it('orders sets by set number and heads the row with the lowest set, whichever was ticked first', () => {
    const rows = [
      programRow({ prescriptionSet: 2, load: '30', prescribedSnapshot: 'after the edit' }),
      programRow({ prescriptionSet: 1, load: '25', prescribedSnapshot: 'before the edit' }),
    ];
    expect(shape(rows)).toEqual([
      { slug: 'bench_press', loads: ['25', '30'], snapshot: 'before the edit' },
    ]);
  });

  it('leaves a row logged outside a program as one row per entry', () => {
    const legacy = (setId: number, load: string) =>
      programRow({
        entryId: 900,
        setId,
        load,
        isProgramRow: false,
        prescriptionId: null,
        prescriptionSet: null,
        workoutName: null,
        sessionType: SESSION_TYPE.strength,
      });
    const folded = foldStrengthMonth([legacy(1, '80'), legacy(2, '85')]);
    expect(folded).toHaveLength(1);
    expect(folded[0].sets.map((s) => s.quantities[0].value)).toEqual(['80', '85']);
  });
});
