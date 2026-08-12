import {
  CANONICAL_LOAD_LABELS,
  editStrengthSetSchema,
  ENTRY_STATUS,
  ENTRY_STATUSES,
  LOAD_MAX_LENGTH,
  numericSetSchema,
  parseLoad,
  SET_STATUSES,
  strengthSetSchema,
} from '@mat-plan/shared';
import { describe, expect, it } from 'vitest';

// GAP-1 P0-2. Lives in the WEB tree because vitest's root is `apps/web` — a test under `packages/`
// would never be collected, and would pass by not running.

describe('parseLoad — blank is rejected FIRST, before any label branch', () => {
  // The single most important case in this file. An earlier design said "parses as a number → numeric,
  // otherwise → label", which maps '' to weightLabel: ''. That is silently unrecoverable: formatSetLine
  // uses `??` so an empty label WINS over the weight (the set renders "5 × " with the load hidden), and
  // both isEditableSet and updateStrengthSetById's isNull(weightLabel) guard then refuse to fix it.
  it.each(['', '   ', '\t', '\n'])('rejects blank input %j rather than labelling it', (raw) => {
    const r = parseLoad(raw);
    expect(r.kind).toBe('invalid');
  });

  it('rejects a non-string, non-number (a crafted body)', () => {
    expect(parseLoad(undefined).kind).toBe('invalid');
    expect(parseLoad({}).kind).toBe('invalid');
  });

  it('accepts a raw NUMBER — a JSON body may legitimately send one', () => {
    expect(parseLoad(135)).toEqual({ kind: 'numeric', weight: 135 });
  });
});

describe('parseLoad — the numeric branch', () => {
  it.each([
    ['60', 60],
    ['62.5', 62.5],
    ['0', 0], // a legitimate weight, and NOT a blank
    ['  60  ', 60], // ends trimmed
    ['145.125', 145.125], // scale 3, matching numeric(7,3)
  ])('reads %j as the number %d', (raw, weight) => {
    expect(parseLoad(raw)).toEqual({ kind: 'numeric', weight });
  });

  it('routes a NEGATIVE to the authored message, not to a label', () => {
    // The leading `-?` in the pattern is load-bearing: without it, '-5' would be laundered into a
    // permanent text label instead of failing with a fixable message.
    const r = parseLoad('-5');
    expect(r.kind).toBe('invalid');
    expect(r.kind === 'invalid' && r.message).toMatch(/negative/i);
  });

  it('rejects an absurd weight', () => {
    expect(parseLoad('5000').kind).toBe('invalid');
  });
});

describe('parseLoad — numeric-LOOKING typos are rejected, never labelled', () => {
  // These are numeric INTENT. Storing them as labels would be unrecoverable, since a labeled set has
  // no inline edit. Note '1e3' and '0x10' were silently ACCEPTED as 1000 and 16 by the old schema.
  it.each(['1e3', '0x10', 'Infinity', 'NaN', '.5.5', '1.2345'])('rejects %j', (raw) => {
    expect(parseLoad(raw).kind).toBe('invalid');
  });
});

describe('parseLoad — the label branch', () => {
  it.each(['BW', 'band', '30in', '36in', '30s', '20s', 'BW+8 (vest)', 'BW (unassisted)', '15/DB'])(
    'accepts %j verbatim',
    (raw) => {
      expect(parseLoad(raw)).toEqual({ kind: 'label', weightLabel: raw });
    },
  );

  it('preserves INNER whitespace and casing — the CSV depends on the exact form', () => {
    // `30 (2x 15 DB)` would be corrupted by a whitespace collapse; `BW`/`band` by case folding.
    expect(parseLoad('30 (2x 15 DB)')).toEqual({ kind: 'label', weightLabel: '30 (2x 15 DB)' });
    expect(parseLoad('  BW (modified)  ')).toEqual({ kind: 'label', weightLabel: 'BW (modified)' });
  });

  it('allows a double-quote — inch marks are in active use', () => {
    expect(parseLoad('30"')).toEqual({ kind: 'label', weightLabel: '30"' });
  });

  it('rejects a comma or newline — the CSV joins fields raw, so either would split a row', () => {
    expect(parseLoad('60, ish').kind).toBe('invalid');
    expect(parseLoad('60\nish').kind).toBe('invalid');
  });

  it(`rejects a label longer than ${LOAD_MAX_LENGTH}`, () => {
    expect(parseLoad('x'.repeat(LOAD_MAX_LENGTH + 1)).kind).toBe('invalid');
  });
});

describe('parseLoad — a PRESCRIBED value can never become a PERFORMED one', () => {
  // These are the exact shapes Ray authors in prescription_target.load. The CSV contract states `~`
  // and ranges never appear in the `load` column, and this is the enabler slice for the deferred
  // "start today's program" prefill — so the guard belongs here, not in the prefill.
  it.each(['~90', '~75-85', 'BW +5-10', '35-45/hand', '12-15'])(
    'rejects the prescription shape %j',
    (raw) => {
      expect(parseLoad(raw).kind).toBe('invalid');
    },
  );

  it('rejects SKIPPED — that is a status, not a load', () => {
    expect(parseLoad('SKIPPED').kind).toBe('invalid');
    expect(parseLoad('skipped').kind).toBe('invalid');
  });
});

describe('strengthSetSchema — the wire keeps ONE weight key', () => {
  it('produces a numeric set', () => {
    expect(strengthSetSchema.parse({ reps: '5', weight: '60' })).toEqual({ reps: 5, weight: 60 });
  });

  it('produces a labeled set', () => {
    expect(strengthSetSchema.parse({ reps: '5', weight: 'BW' })).toEqual({
      reps: 5,
      weightLabel: 'BW',
    });
  });

  it('ignores an injected weightLabel key — a crafted body cannot set both', () => {
    const out = strengthSetSchema.parse({ reps: '5', weight: '60', weightLabel: 'BW' });
    expect(out).toEqual({ reps: 5, weight: 60 });
  });

  it('keeps the AUTHORED per-field message (a union would collapse it to "Invalid input")', () => {
    const r = strengthSetSchema.safeParse({ reps: '5', weight: '-5' });
    expect(r.success).toBe(false);
    // Read the ISSUE, not `flatten().fieldErrors.weight`. `flatten()` is typed off the OUTPUT shape,
    // which is a union of the numeric / labeled branches — since GAP-1 P1-1b added `status`, TS can no
    // longer prove `.weight` exists on every branch. Going via the issue is also the stronger
    // assertion: it pins the PATH as well as the message, which is what makes the action render
    // "Movement N: Weight can't be negative." rather than a generic banner.
    const issue = r.success ? undefined : r.error.issues.find((i) => i.path[0] === 'weight');
    expect(issue?.message ?? '').toMatch(/negative/i);
  });

  it('still enforces the reps rules', () => {
    expect(strengthSetSchema.safeParse({ reps: '0', weight: '60' }).success).toBe(false);
    expect(strengthSetSchema.safeParse({ reps: '1.5', weight: '60' }).success).toBe(false);
  });
});

describe('the V1-9 edit contract is untouched', () => {
  const ids = {
    profileId: '019826b4-0000-7000-8000-000000000001',
    setId: '019826b4-0000-7000-8000-0000000000aa',
  };

  it('editStrengthSetSchema still extends the NUMERIC object (it would not compile off a transform)', () => {
    expect(editStrengthSetSchema.parse({ ...ids, reps: '5', weight: '60' })).toEqual({
      ...ids,
      reps: 5,
      weight: 60,
    });
  });

  it('rejects a text load on the edit path — labeled sets are deliberately not editable', () => {
    expect(editStrengthSetSchema.safeParse({ ...ids, reps: '5', weight: 'BW' }).success).toBe(
      false,
    );
  });

  it('numericSetSchema keeps the blank→NaN guard', () => {
    expect(numericSetSchema.safeParse({ reps: '5', weight: '' }).success).toBe(false);
  });
});

describe('CANONICAL_LOAD_LABELS', () => {
  it('are themselves valid labels (a chip can never write something the schema rejects)', () => {
    for (const label of CANONICAL_LOAD_LABELS) {
      expect(parseLoad(label)).toEqual({ kind: 'label', weightLabel: label });
    }
  });
});

// GAP-1 P1-1b — per-set `status` on the wire.
describe('strengthSetSchema — per-set status (GAP-1 P1-1b)', () => {
  it('accepts sub_failure and KEEPS the real reps', () => {
    const out = strengthSetSchema.parse({ reps: '3', weight: '60', status: 'sub_failure' });
    // reps stays required + positive: the CSV loses the number into `notes`, but that is a limitation
    // of the FILE, not an instruction to lose it in the DB. The export re-derives `sub-failure`.
    expect(out).toEqual({ reps: 3, weight: 60, status: 'sub_failure' });
  });

  it('omits `status` entirely when not supplied — so the writer omits the column', () => {
    const out = strengthSetSchema.parse({ reps: '5', weight: '60' });
    expect(out).toEqual({ reps: 5, weight: 60 });
    expect('status' in out).toBe(false); // NOT `status: undefined` — the DB default depends on absence
  });

  it('carries status alongside a TEXT load too', () => {
    const out = strengthSetSchema.parse({ reps: '4', weight: 'BW', status: 'sub_failure' });
    expect(out).toEqual({ reps: 4, weightLabel: 'BW', status: 'sub_failure' });
  });

  it('REJECTS skipped as a set status — a skipped movement carries zero sets, not a placeholder', () => {
    // Load-bearing for the export: `sets` is COUNT(entry_sets), so a skipped set row would over-count.
    expect(
      strengthSetSchema.safeParse({ reps: '5', weight: '60', status: 'skipped' }).success,
    ).toBe(false);
  });

  it.each(['SUB_FAILURE', 'done ', 'subfailure', ''])('rejects the bad status %j', (bad) => {
    expect(strengthSetSchema.safeParse({ reps: '5', weight: '60', status: bad }).success).toBe(
      false,
    );
  });

  it('SET_STATUSES is a strict subset of ENTRY_STATUSES, and excludes skipped', () => {
    expect(ENTRY_STATUSES).toEqual(expect.arrayContaining([...SET_STATUSES]));
    expect(SET_STATUSES).not.toContain(ENTRY_STATUS.skipped);
  });

  it('editStrengthSetSchema is untouched — it still strips an injected status', () => {
    // The V1-9 edit path is numeric-only AND done-only; it must not gain a status lever.
    const parsed = editStrengthSetSchema.parse({
      profileId: '019826b4-0000-7000-8000-000000000001',
      setId: '019826b4-0000-7000-8000-000000000002',
      reps: 5,
      weight: 100,
      status: 'sub_failure',
    });
    expect('status' in parsed).toBe(false);
  });
});
