import {
  buildLoad,
  buildStrengthLog,
  csvMovement,
  csvRow,
  csvSessionType,
  CSV_UNIT_SUFFIX,
  formatNumeric,
  type StrengthLogRow,
  STRENGTH_LOG_HEADER,
  strengthLogPath,
  readCsvLine,
} from '@mat-plan/shared/csv';
import { ENTRY_STATUS, QUANTITY_SLOT, type QuantitySlot, SET_STATUS } from '@mat-plan/shared';
import { describe, expect, it } from 'vitest';

/**
 * Golden vectors for the CSV export, **transcribed from the contract's own examples** — which are
 * real rows out of the real files, not cases we invented. That provenance is the whole point: both
 * the fixtures and the formatter encode one reading of the contract, so a shared misreading would
 * pass both. Using the contract's literal bytes is the closest thing to an independent source until
 * IMP-2 re-exports the imported legacy corpus.
 */

const set = (o: Partial<StrengthLogRow['sets'][number]> = {}) => ({
  reps: 5,
  isBodyweight: false,
  isBand: false,
  quantities: [],
  status: ENTRY_STATUS.done,
  ...o,
});

const mass = (value: string, slot: QuantitySlot = QUANTITY_SLOT.primary) =>
  ({ slot, unit: 'lb' as const, value }) as const;

const row = (o: Partial<StrengthLogRow> = {}): StrengthLogRow => ({
  date: '2020-07-20',
  dayRole: 'strength_a',
  sessionType: null,
  movementSlug: 'front_squat',
  status: ENTRY_STATUS.done,
  sets: [set()],
  prescribed: '',
  notes: '',
  workoutName: null,
  ...o,
});

/** The body of a one-row file, without the header — easier to assert against the contract's lines. */
const bodyOf = (r: StrengthLogRow) => buildStrengthLog([r]).split('\n')[1];

describe('the contract’s own example rows, byte for byte', () => {
  // Every string below is lifted from docs/csv-export-contract.md § "strength-log — the hard one".
  // FAM-1 14a: each ends with the empty `workout_name` cell, since none of them is a program row.
  // Since #621 a note holding `;` is quoted (a `;`-locale spreadsheet would split it).
  it('a per-set ramp with a uniform-looking tail', () => {
    expect(
      bodyOf(
        row({
          movementSlug: 'front_squat',
          prescribed: '5x5 @ ~70 target',
          notes: 'ramped; top 80x5 clean',
          sets: ['70', '75', '75', '75', '80'].map((v) => set({ quantities: [mass(v)] })),
        }),
      ),
    ).toBe(
      '2020-07-20,strength-a,front-squat,5,5,70/75/75/75/80,5x5 @ ~70 target,"ramped; top 80x5 clean",',
    );
  });

  it('a uniform load collapses to a scalar — 80/85/85 does NOT', () => {
    expect(
      bodyOf(
        row({
          movementSlug: 'back_squat',
          prescribed: '3x5 @ ~85-90',
          notes: 'solid',
          sets: ['80', '85', '85'].map((v) => set({ quantities: [mass(v)] })),
        }),
      ),
    ).toBe('2020-07-20,strength-a,back-squat,3,5,80/85/85,3x5 @ ~85-90,solid,');
  });

  it('a SKIPPED movement — zero sets, 0,0,SKIPPED', () => {
    expect(
      bodyOf(
        row({
          date: '2020-06-02',
          dayRole: null,
          sessionType: 'trainer',
          movementSlug: 'bulgarian_split_squat',
          status: ENTRY_STATUS.skipped,
          sets: [],
          prescribed: '2x6/leg',
          notes: 'acceptable — drop-if-yellow item',
        }),
      ),
    ).toBe(
      '2020-06-02,trainer,bulgarian-split-squat,0,0,SKIPPED,2x6/leg,acceptable — drop-if-yellow item,',
    );
  });

  it('sub-failure — the only non-integer reps besides a slash-list', () => {
    expect(
      bodyOf(
        row({
          date: '2020-06-02',
          dayRole: null,
          sessionType: 'trainer',
          movementSlug: 'pull_ups',
          prescribed: '2 sets sub-failure',
          notes: 'max 4 clean unassisted',
          sets: [
            set({ isBodyweight: true, status: SET_STATUS.sub_failure }),
            set({ isBodyweight: true }),
          ],
        }),
      ),
    ).toBe(
      '2020-06-02,trainer,pull-ups,2,sub-failure,BW,2 sets sub-failure,max 4 clean unassisted,',
    );
  });

  it('a per-set rep list with a uniform load', () => {
    expect(
      bodyOf(
        row({
          movementSlug: 'pull_up',
          prescribed: '4x4 last AMRAP',
          notes: 'reps declined across sets',
          sets: [4, 3, 4, 2].map((reps) =>
            set({ reps, isBodyweight: true, quantities: [mass('8', QUANTITY_SLOT.vest)] }),
          ),
        }),
      ),
    ).toBe(
      '2020-07-20,strength-a,pull-up,4,4/3/4/2,BW+8 (vest),4x4 last AMRAP,reps declined across sets,',
    );
  });

  it('a distance-loaded sled — weight, then distance', () => {
    expect(
      bodyOf(
        row({
          date: '2020-06-02',
          dayRole: null,
          sessionType: 'trainer',
          movementSlug: 'sled_push',
          prescribed: '3x50ft',
          notes: 'shared with Athlete B; heavy',
          sets: Array.from({ length: 3 }, () =>
            set({
              reps: 1,
              quantities: [mass('123'), { slot: QUANTITY_SLOT.distance, unit: 'ft', value: '50' }],
            }),
          ),
        }),
      ),
    ).toBe('2020-06-02,trainer,sled-push,3,1,123 (50ft),3x50ft,"shared with Athlete B; heavy",');
  });

  it('a timed movement — duration in LOAD, reps is 1', () => {
    expect(
      bodyOf(
        row({
          date: '2020-06-02',
          dayRole: null,
          sessionType: 'trainer',
          movementSlug: 'wall_sit',
          prescribed: '3x30s',
          notes: 'warmup — cut from 45s',
          sets: Array.from({ length: 3 }, () =>
            set({
              reps: 1,
              quantities: [{ slot: QUANTITY_SLOT.primary, unit: 'sec', value: '30' }],
            }),
          ),
        }),
      ),
    ).toBe('2020-06-02,trainer,wall-sit,3,1,30s,3x30s,warmup — cut from 45s,');
  });

  it('a height — 30in, no parens', () => {
    expect(
      bodyOf(
        row({
          movementSlug: 'box_jump',
          prescribed: '4x3 @ 30in',
          sets: Array.from({ length: 4 }, () =>
            set({
              reps: 3,
              quantities: [{ slot: QUANTITY_SLOT.primary, unit: 'in', value: '30' }],
            }),
          ),
        }),
      ),
    ).toBe('2020-07-20,strength-a,box-jump,4,3,30in,4x3 @ 30in,,');
  });

  it('a band', () => {
    expect(bodyOf(row({ sets: [set({ isBand: true })] }))).toContain(',band,');
  });
});

describe('the two mappings that silently fork history', () => {
  // The workflow groups by the movement string. Underscores would give every movement two series.
  it('movement is kebab, from the SLUG', () => {
    expect(csvMovement('bulgarian_split_squat')).toBe('bulgarian-split-squat');
    expect(csvMovement('bent-over_rows')).toBe('bent-over-rows'); // already part-hyphenated
    expect(csvMovement('1-arm_db_row')).toBe('1-arm-db-row');
  });

  // strength_a is a DAY_ROLE, not a SessionType. Reading session_type collapses A/B/C into `strength`.
  it('session_type comes from day_role, hyphenated, and falls back', () => {
    expect(csvSessionType('strength_a', 'strength')).toBe('strength-a');
    expect(csvSessionType(null, 'strength')).toBe('strength');
    expect(csvSessionType(null, null)).toBe(''); // a sessionless entry emits an empty field
  });
});

describe('numeric formatting — drizzle returns numeric as a STRING', () => {
  it('trims insignificant zeros only after the decimal point', () => {
    expect(formatNumeric('70.000')).toBe('70');
    expect(formatNumeric('67.500')).toBe('67.5');
    expect(formatNumeric('92.000')).toBe('92'); // Ray: a bare integer is read as .0
  });

  // A naive /0+$/ turns 90 into 9 — the bug this guards.
  it('NEVER eats a trailing zero from an integer', () => {
    expect(formatNumeric('90')).toBe('90');
    expect(formatNumeric('100')).toBe('100');
    expect(formatNumeric('90.000')).toBe('90');
  });
});

describe('the unit tripwire — refuse, never convert', () => {
  // A unit with no spelling must never reach the file as a bare number: in this column a bare number
  // is POUNDS, so a bare kg is a 2.2x error in the value that drives load progression. Since V1-30
  // every loggable unit has a spelling, so the tripwire guards the units no form offers.
  // FAM-1 14a: a primary `count` now goes to `reps` (the Count rule), so the tripwire is pinned on a
  // unit that still has no spelling and is no count: `timing`.
  it('REFUSES a unit with no spelling, naming the day but not the movement', () => {
    expect(() =>
      bodyOf(
        row({
          sets: [
            set({ quantities: [{ slot: QUANTITY_SLOT.primary, unit: 'timing', value: '5' }] }),
          ],
        }),
      ),
    ).toThrow(/logged in 'timing'[\s\S]*refuses rather than converting/);
    expect(() =>
      bodyOf(
        row({
          sets: [set({ quantities: [{ slot: QUANTITY_SLOT.primary, unit: 'bool', value: '1' }] })],
        }),
      ),
    ).toThrow(/logged in 'bool'[\s\S]*refuses rather than converting/);
    // The message locates the row by its day; the slug, which can carry typed text, stays out of it.
    let message = '';
    try {
      bodyOf(
        row({
          sets: [set({ quantities: [{ slot: QUANTITY_SLOT.primary, unit: 'bool', value: '1' }] })],
        }),
      );
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('2020-07-20');
    expect(message).not.toContain('front');
  });

  it('writes a Count in `count` in reps, with load empty (the maintainer, 2026-11-17)', () => {
    expect(
      bodyOf(
        row({
          movementSlug: 'plank_taps',
          sets: [
            set({
              reps: null,
              quantities: [{ slot: QUANTITY_SLOT.primary, unit: 'count', value: '25' }],
            }),
          ],
        }),
      ),
    ).toBe('2020-07-20,strength-a,plank-taps,1,25,,,,');
  });

  it('REFUSES a set with reps AND a count, rather than picking one', () => {
    expect(() =>
      bodyOf(
        row({
          sets: [set({ quantities: [{ slot: QUANTITY_SLOT.primary, unit: 'count', value: '5' }] })],
        }),
      ),
    ).toThrow(/has reps and a count/);
  });

  // THE contract pin (AGENTS.md → constants: the literal belongs on the assertion side, exactly once).
  // Corpus-observed: lb (bare), in, ft, sec → s. App-defined in V1-30: kg, cm, m, yd, min; FAM-1: mi.
  it('spells every unit exactly as the contract says', () => {
    expect(CSV_UNIT_SUFFIX).toEqual({
      lb: '',
      kg: 'kg',
      in: 'in',
      cm: 'cm',
      ft: 'ft',
      m: 'm',
      yd: 'yd',
      mi: 'mi',
      sec: 's',
      min: 'min',
      count: null,
      bool: null,
      timing: null,
    });
  });

  it('kg is SUFFIXED, never bare and never converted', () => {
    expect(
      bodyOf(
        row({
          sets: [set({ quantities: [{ slot: QUANTITY_SLOT.primary, unit: 'kg', value: '85' }] })],
        }),
      ),
    ).toContain(',85kg,');
  });

  it('a suffixed slash-list: metres per set', () => {
    const metres = (value: string) => ({ slot: QUANTITY_SLOT.primary, unit: 'm' as const, value });
    expect(
      bodyOf(
        row({
          sets: [
            set({ reps: 1, quantities: [metres('20')] }),
            set({ reps: 1, quantities: [metres('25')] }),
            set({ reps: 1, quantities: [metres('25')] }),
          ],
        }),
      ),
    ).toContain(',3,1,20m/25m/25m,');
  });

  // A worn mass used to be written with formatNumeric, dropping the suffix. Harmless while kg threw;
  // after V1-30 it would have exported an 8 kg vest as `BW+8 (vest)` — read as 8 lb.
  it('a kg vest keeps its unit; an lb vest stays bare', () => {
    const vest = (unit: 'kg' | 'lb') =>
      buildLoad(
        {
          reps: 5,
          isBodyweight: true,
          isBand: false,
          quantities: [{ slot: QUANTITY_SLOT.vest, unit, value: '8' }],
        },
        'x',
      );
    expect(vest('kg')).toBe('BW+8kg (vest)');
    expect(vest('lb')).toBe('BW+8 (vest)');
  });

  it('mass is BARE — there is no `80lb` anywhere in the corpus', () => {
    expect(
      buildLoad({ reps: 5, isBodyweight: false, isBand: false, quantities: [mass('80')] }, 'x'),
    ).toBe('80');
  });

  it('seconds is `s`, not the `sec` unit code', () => {
    expect(
      buildLoad(
        {
          reps: 1,
          isBodyweight: false,
          isBand: false,
          quantities: [{ slot: QUANTITY_SLOT.primary, unit: 'sec', value: '20' }],
        },
        'x',
      ),
    ).toBe('20s');
  });
});

describe('the joiner — no CSV library, RFC 4180 quoting (FAM-1 14a)', () => {
  // The legacy files wrote these raw; ADR 0009 retired that contract, and the maintainer chose
  // standard quoting for the whole file (2026-11-17), so a spreadsheet reads the cell back exactly.
  it('quotes inch marks, doubling each one', () => {
    expect(csvRow(['Athlete A at 30" box (Athlete B did 36")'], ['notes'])).toBe(
      '"Athlete A at 30"" box (Athlete B did 36"")"\n',
    );
  });

  it('quotes a workout name with a comma and a double quote', () => {
    expect(csvRow(['Heavy, "A"'], ['workout_name'])).toBe('"Heavy, ""A"""\n');
  });

  it('quotes a note that opens a quote and never closes it', () => {
    expect(csvRow(['"felt off', 'Heavy A'], ['notes', 'workout_name'])).toBe(
      '"""felt off",Heavy A\n',
    );
  });

  it('quotes a NEW comma-bearing notes value', () => {
    expect(csvRow(['warmup, slow'], ['notes'])).toBe('"warmup, slow"\n');
  });

  // 8 of 21 seeded prescriptions contain a comma — ~38%, the common case.
  it('quotes prescribed, which the seed fills with commas', () => {
    expect(csvRow(['5, last set to failure'], ['prescribed'])).toBe('"5, last set to failure"\n');
  });

  // The maintainer, 2026-11-18: a cell a spreadsheet would run as a formula opens as text.
  it.each([
    ['=HYPERLINK("x")', `"'=HYPERLINK(""x"")"`],
    ['+1 day', "'+1 day"],
    ['-3 sets', "'-3 sets"],
    ['@home', "'@home"],
    ['\tindent', `"'\tindent"`],
    ['=a,b', `"'=a,b"`],
    [' =1+1', "' =1+1"],
    ['＝1+1', "'＝1+1"],
  ])('opens %j as text in any column', (value, written) => {
    expect(csvRow([value, value], ['notes', 'workout_name'])).toBe(`${written},${written}\n`);
  });

  it('quotes a semicolon, so a semicolon-locale spreadsheet keeps one text cell', () => {
    expect(csvRow(['ok;=1+1'], ['notes'])).toBe('"ok;=1+1"\n');
  });

  it('leaves a value that only contains those characters alone', () => {
    expect(csvRow(['3x5 - easy', 'a=b'], ['notes', 'workout_name'])).toBe('3x5 - easy,a=b\n');
  });

  it('quotes a comma in any column, which used to be refused outside notes and prescribed', () => {
    expect(csvRow(['front,squat'], ['movement'])).toBe('"front,squat"\n');
  });

  it('refuses a line break, which would end the row early', () => {
    expect(() => csvRow(['a\nb'], ['notes'])).toThrow(/line break/);
  });

  it('writes trailing empty fields rather than dropping them', () => {
    expect(
      csvRow(['2020-07-09', '92.3', 'morning', ''], ['date', 'weight_lb', 'context', 'notes']),
    ).toBe('2020-07-09,92.3,morning,\n');
  });
});

describe('file shape', () => {
  it('is header + LF, trailing newline, no BOM', () => {
    const out = buildStrengthLog([]);
    expect(out).toBe('date,session_type,movement,sets,reps,load,prescribed,notes,workout_name\n');
    expect(out.endsWith('\n')).toBe(true);
    expect(out.charCodeAt(0)).not.toBe(0xfeff);
    expect(out).not.toContain('\r');
  });

  it('passes non-ASCII through byte-for-byte — em dash AND arrow', () => {
    // The contract names only the em dash; the corpus also carries → U+2192 twice. A test written to
    // the letter of "em dash preserved" passes while an ASCII-folding sanitiser eats the arrow.
    const notes = 'form GOOD — back stayed flat → safe to ramp';
    expect(bodyOf(row({ notes }))).toContain(notes);
  });

  it('the path is keyed on public_id, not a name', () => {
    expect(strengthLogPath('019826b4-0000-7000-8000-000000000001', '2026-09')).toBe(
      'data/strength-log/019826b4-0000-7000-8000-000000000001/2026-09.csv',
    );
  });

  it('header column names use UNDERSCORES while values use hyphens', () => {
    expect(STRENGTH_LOG_HEADER).toContain('session_type');
    expect(bodyOf(row({ dayRole: 'strength_a' }))).toContain(',strength-a,');
  });
});

describe('the assertion a golden diff can never make', () => {
  // The contract: "assert that `sets` equals the element count of any slash-list in reps/load. All
  // eight real files would pass a golden diff while carrying a mismatched list."
  const lists = (r: StrengthLogRow) => {
    const [, , , sets, reps, load] = readCsvLine(bodyOf(r));
    return { sets: Number(sets), reps, load };
  };

  it('sets == slash-list length, for reps and for load', () => {
    const r = lists(
      row({
        sets: [4, 3, 4, 2].map((reps, i) => set({ reps, quantities: [mass(String(70 + i * 5))] })),
      }),
    );
    expect(r.reps.split('/')).toHaveLength(r.sets);
    expect(r.load.split('/')).toHaveLength(r.sets);
  });

  it('a partial skip counts only what happened, so the invariant still holds', () => {
    // 5 prescribed, 3 done, 2 skipped → sets=3 with 3-element lists.
    const r = lists(
      row({
        prescribed: '5x3 progressive',
        sets: [
          set({ reps: 5, quantities: [mass('70')] }),
          set({ reps: 4, quantities: [mass('75')] }),
          set({ reps: 3, quantities: [mass('80')] }),
          set({ status: ENTRY_STATUS.skipped }),
          set({ status: ENTRY_STATUS.skipped }),
        ],
      }),
    );
    expect(r.sets).toBe(3);
    expect(r.reps.split('/')).toHaveLength(3);
    expect(r.load.split('/')).toHaveLength(3);
  });

  it('a 1-set movement is a scalar, never a 1-element list', () => {
    const r = lists(row({ sets: [set({ reps: 5, quantities: [mass('70')] })] }));
    expect(r.reps).toBe('5');
    expect(r.load).toBe('70');
  });
});
