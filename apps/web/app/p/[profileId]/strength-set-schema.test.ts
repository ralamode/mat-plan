import {
  BLANK_SET_MESSAGE,
  editStrengthSetSchema,
  ENTRY_STATUS,
  ENTRY_STATUSES,
  LOGGABLE_DIMENSIONS,
  LOGGABLE_UNITS,
  numericSetSchema,
  QUANTITY_SLOT,
  QUANTITY_SLOT_DIMENSIONS_BY_CODE,
  SET_STATUSES,
  strengthSetSchema,
  UNIT_DIMENSION_BY_CODE,
  unitsOfDimension,
} from '@mat-plan/shared';
import { describe, expect, it } from 'vitest';

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

describe('strengthSetSchema — per-set status (GAP-1 P1-1b)', () => {
  it('accepts sub_failure and KEEPS the real reps', () => {
    const out = strengthSetSchema.parse({ reps: '3', weight: '60', status: 'sub_failure' });
    // reps stays required + positive: the CSV loses the number into `notes`, but that is a limitation
    // of the FILE, not an instruction to lose it in the DB. The export re-derives `sub-failure`.
    expect(out).toEqual({
      reps: 3,
      weight: 60,
      status: 'sub_failure',
    });
  });

  it('omits `status` entirely when not supplied — so the writer omits the column', () => {
    const out = strengthSetSchema.parse({ reps: '5', weight: '60' });
    expect(out).toEqual({ reps: 5, weight: 60 });
    expect('status' in out).toBe(false); // NOT `status: undefined` — the DB default depends on absence
  });

  it('carries status alongside a MODE-only set too', () => {
    const out = strengthSetSchema.parse({ reps: '4', isBodyweight: true, status: 'sub_failure' });
    expect(out).toEqual({ reps: 4, isBodyweight: true, weight: null, status: 'sub_failure' });
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

// ── GAP-3 PR 4a — the structured wire replaces parseLoad ────────────────────────────────────────
// `parseLoad` is DELETED. The form always knew whether the athlete meant a number, a mode or a
// measurement — it had the controls — so it sends that instead of a string to reverse-engineer.

describe('strengthSetSchema — the structured load', () => {
  it('parses a plain numeric set', () => {
    expect(strengthSetSchema.parse({ reps: '5', weight: '60' })).toEqual({ reps: 5, weight: 60 });
  });

  it('keeps a false flag ABSENT, so an untouched set serializes as it always did', () => {
    const out = strengthSetSchema.parse({ reps: '5', weight: '60' });
    expect('isBodyweight' in out).toBe(false);
    expect('isBand' in out).toBe(false);
    expect('status' in out).toBe(false);
  });

  it('parses a bodyweight set with NO magnitude', () => {
    expect(strengthSetSchema.parse({ reps: '8', isBodyweight: true })).toEqual({
      reps: 8,
      weight: null,
      isBodyweight: true,
    });
  });

  it('parses a band set with no magnitude', () => {
    expect(strengthSetSchema.parse({ reps: '12', isBand: true })).toMatchObject({
      weight: null,
      isBand: true,
    });
  });

  // THE pairing this PR unlocks: a mode and a magnitude together. Under the old string wire the two
  // were mutually exclusive by construction — the chip OVERWROTE the field.
  it('allows bodyweight AND a weight together — the BW+8 (vest) shape', () => {
    expect(strengthSetSchema.parse({ reps: '8', weight: '8', isBodyweight: true })).toEqual({
      reps: 8,
      weight: 8,
      isBodyweight: true,
    });
  });

  it('maps a blank weight to null, never 0 — "blank" and "zero pounds" are different claims', () => {
    expect(strengthSetSchema.parse({ reps: '8', weight: '   ', isBodyweight: true })).toMatchObject(
      {
        weight: null,
      },
    );
  });

  it('keeps 0 as a real logged weight (an unloaded bar)', () => {
    expect(strengthSetSchema.parse({ reps: '8', weight: '0' })).toMatchObject({ weight: 0 });
  });
});

describe('strengthSetSchema — a set must carry SOME load (replaces parseLoad blank-check)', () => {
  // Without this the unrecoverable state returns: reps with no load renders `5 × ?`, and
  // `isEditableSet` then refuses to fix it — permanently, since the app has no delete action.
  it('REJECTS reps with no weight and no mode', () => {
    const r = strengthSetSchema.safeParse({ reps: '5' });
    expect(r.success).toBe(false);
    const issue = r.success ? undefined : r.error.issues.find((i) => i.path[0] === 'weight');
    expect(issue?.message).toBe(BLANK_SET_MESSAGE);
  });

  it('REJECTS an explicitly blank weight with no mode', () => {
    expect(strengthSetSchema.safeParse({ reps: '5', weight: '' }).success).toBe(false);
  });

  it('accepts as soon as ANY of the three is present', () => {
    expect(strengthSetSchema.safeParse({ reps: '5', weight: '60' }).success).toBe(true);
    expect(strengthSetSchema.safeParse({ reps: '5', isBodyweight: true }).success).toBe(true);
    expect(strengthSetSchema.safeParse({ reps: '5', isBand: true }).success).toBe(true);
  });
});

describe('strengthSetSchema — free text is gone, not merely discouraged', () => {
  // These were the shapes parseLoad spent ~90 lines recognising in order to refuse. A number field
  // cannot express them at all, so the boundary no longer has to know about them.
  it.each(['BW', 'band', '30in', '~75-85', '12-15', 'seventy five', '1e3', 'SKIPPED'])(
    'rejects %j in the weight field',
    (raw) => {
      expect(strengthSetSchema.safeParse({ reps: '5', weight: raw }).success).toBe(false);
    },
  );

  it('still rejects a negative', () => {
    expect(strengthSetSchema.safeParse({ reps: '5', weight: '-5' }).success).toBe(false);
  });

  // V1-30b-ii — the CEILING moved to the session refine, where the unit is known. A set schema cannot
  // judge `3219`: it is an absurd `lb` and a real 2-mile run in metres. `99999` now passes HERE and is
  // refused there; see strength-session-schema.test.ts.
  it('no longer judges the magnitude — that needs the unit (V1-30b-ii)', () => {
    expect(strengthSetSchema.safeParse({ reps: '5', weight: '99999' }).success).toBe(true);
  });

  it('keeps the AUTHORED per-field message on the weight path', () => {
    const r = strengthSetSchema.safeParse({ reps: '5', weight: 'BW' });
    expect(r.success).toBe(false);
    const issue = r.success ? undefined : r.error.issues.find((i) => i.path.includes('weight'));
    expect(issue?.message ?? '').toMatch(/plain number|BW/i);
  });
});

describe('LOGGABLE_UNITS is DERIVED, so it cannot drift from the slot vocabulary', () => {
  it("is exactly the primary slot's dimensions, expanded to their units", () => {
    expect([...LOGGABLE_DIMENSIONS]).toEqual([
      ...QUANTITY_SLOT_DIMENSIONS_BY_CODE[QUANTITY_SLOT.primary],
    ]);
    expect([...LOGGABLE_UNITS]).toEqual(LOGGABLE_DIMENSIONS.flatMap(unitsOfDimension));
  });

  // The guarantee that matters: every unit the form can offer is one the composite FK will accept in
  // the primary slot. A hand-written list could silently include one that is not.
  it('every loggable unit is legal in the primary slot', () => {
    for (const u of LOGGABLE_UNITS) {
      expect(QUANTITY_SLOT_DIMENSIONS_BY_CODE[QUANTITY_SLOT.primary]).toContain(
        UNIT_DIMENSION_BY_CODE[u],
      );
    }
  });

  it('excludes count / bool / timing — none is a load', () => {
    for (const u of ['count', 'bool', 'timing'] as const) {
      expect(LOGGABLE_UNITS).not.toContain(u);
    }
  });
});

// V1-30b-ii — the ceiling is PER UNIT and lives in the session refine now; the copy itself is still
// NUMBER_TOO_HIGH_MESSAGE. See strength-session-schema.test.ts for the per-unit cases.
