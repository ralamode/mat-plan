import assert from 'node:assert/strict';

import { newId } from '@mat-plan/shared';
import { describe, expect, it } from 'vitest';

import { idLabel, normalizeFixture, TIMESTAMP_PLACEHOLDER } from './normalize-fixture';

/**
 * The normalizer's contract (FAM-1 step 0c): two values that describe the same state compare equal
 * after it, whatever ids and timestamps each side minted, and two that differ in MEANING still
 * differ.
 *
 * ⚠️ The sample below is hand-written in the shape of the plan's `DayPlan`
 * (`docs/plans/fam-1-family-program.md` §4), not a contract fixture: step 0a's fixtures were not on
 * `main` when this was written. The comparisons against the real named fixtures are lane P's and
 * lane E's, in `./program.ts` and `./day.ts`.
 */

/** Fixed, readable ids for the "fixture" side. The database side mints its own (`reminted`). */
const ID = {
  athleteOne: '019826b4-0000-7000-8000-00000000a001',
  athleteTwo: '019826b4-0000-7000-8000-00000000a002',
  program: '019826b4-0000-7000-8000-00000000b001',
  workout: '019826b4-0000-7000-8000-00000000c001',
  squatPrescription: '019826b4-0000-7000-8000-00000000d001',
  plankPrescription: '019826b4-0000-7000-8000-00000000d002',
  squat: '019826b4-0000-7000-8000-00000000e001',
  plank: '019826b4-0000-7000-8000-00000000e002',
  squatEntry: '019826b4-0000-7000-8000-00000000f001',
} as const;

/** One athlete's day: one program, one workout, a logged set, an unlogged set and a timed item. */
const dayPlanSample = (id: Record<keyof typeof ID, string> = ID) => ({
  profilePublicId: id.athleteOne,
  day: '2026-11-16',
  writable: true,
  future: false,
  athletes: [
    { profilePublicId: id.athleteOne, name: 'Athlete One' },
    { profilePublicId: id.athleteTwo, name: 'Athlete Two' },
  ],
  onProgram: 'yes',
  canGoForward: true,
  programs: [{ programPublicId: id.program, name: 'Family program', order: 1 }],
  workouts: [
    {
      programPublicId: id.program,
      workoutPublicId: id.workout,
      label: 'After school',
      name: 'Heavy A',
      description: null,
      scheduled: true,
      items: [
        {
          prescriptionPublicId: id.squatPrescription,
          itemPublicId: id.squat,
          name: 'Front Squat',
          trackingType: 'weight_reps',
          prescribedText: '2 × 5 @ 65 lb',
          notes: null,
          unit: 'lb',
          superset: { group: 'A', order: 1 },
          rows: [
            {
              set: 1,
              previous: { reps: 5, quantities: [{ slot: 'load', unit: 'lb', value: 60 }] },
              logged: {
                entryPublicId: id.squatEntry,
                values: { reps: 5, quantities: [{ slot: 'load', unit: 'lb', value: 65 }] },
                prescribedText: '2 × 5 @ 65 lb',
              },
            },
            { set: 2, previous: null, logged: null },
          ],
        },
        {
          prescriptionPublicId: id.plankPrescription,
          itemPublicId: id.plank,
          name: 'Plank',
          trackingType: 'duration',
          prescribedText: '1 × 45 sec',
          notes: 'Elbows under shoulders',
          unit: 'sec',
          superset: { group: 'A', order: 2 },
          rows: [{ set: 1, previous: null, logged: null }],
        },
      ],
      restAfter: { A: '90 sec' },
    },
  ],
});

/** The same state as the database would return it: every id freshly minted, one for one. */
const reminted = (): Record<keyof typeof ID, string> =>
  Object.fromEntries(Object.keys(ID).map((name) => [name, newId()])) as Record<
    keyof typeof ID,
    string
  >;

/** Rebuild every object with its keys in reverse order: the same value, built differently. */
const reverseKeys = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(reverseKeys);
  if (node === null || typeof node !== 'object') return node;
  return Object.fromEntries(
    Object.entries(node)
      .reverse()
      .map(([key, held]) => [key, reverseKeys(held)]),
  );
};

describe('normalizeFixture: the same state compares equal', () => {
  it('a DayPlan-shaped result with freshly minted ids deep-equals the fixture', () => {
    const fixture = dayPlanSample();
    const queried = dayPlanSample(reminted());

    // The premise: as written, the two differ (otherwise the next assertion proves nothing).
    assert.notDeepEqual(queried, fixture);
    // `node:assert/strict`, as the proof modules use, so `undefined` handling is the same here.
    assert.deepEqual(normalizeFixture(queried), normalizeFixture(fixture));
  });

  it('labels ids by first appearance, and one id gets one label everywhere', () => {
    const normalized = normalizeFixture(dayPlanSample()) as ReturnType<typeof dayPlanSample>;

    // Keys are visited in sorted order, so `athletes` is reached first: Athlete One, then Two.
    expect(normalized.athletes.map((a) => a.profilePublicId)).toEqual([idLabel(1), idLabel(2)]);
    // …and the top-level `profilePublicId` is the SAME athlete, so the same label.
    expect(normalized.profilePublicId).toBe(idLabel(1));
    // The program is named twice (the list, and the workout that belongs to it).
    expect(normalized.workouts[0].programPublicId).toBe(normalized.programs[0].programPublicId);
    // Nine distinct ids in the sample, nine labels, and no raw id left anywhere.
    const text = JSON.stringify(normalized);
    expect(text).toContain(idLabel(Object.keys(ID).length));
    expect(text).not.toContain(idLabel(Object.keys(ID).length + 1));
    for (const raw of Object.values(ID)) expect(text).not.toContain(raw);
  });

  it('does not depend on the order either side built its objects in', () => {
    const fixture = dayPlanSample();
    assert.deepEqual(
      normalizeFixture(reverseKeys(dayPlanSample(reminted()))),
      normalizeFixture(fixture),
    );
  });

  it('treats an upper-case id as the same id', () => {
    assert.deepEqual(
      normalizeFixture([ID.program.toUpperCase(), ID.program]),
      normalizeFixture([ID.program, ID.program]),
    );
  });

  it('drops an undefined property, as JSON does', () => {
    assert.deepEqual(
      normalizeFixture({ reps: undefined, quantities: [] }),
      normalizeFixture({ quantities: [] }),
    );
  });

  it('is idempotent', () => {
    const once = normalizeFixture(dayPlanSample());
    assert.deepEqual(normalizeFixture(once), once);
  });

  it('does not change its input', () => {
    const fixture = dayPlanSample();
    normalizeFixture(fixture);
    assert.deepEqual(fixture, dayPlanSample());
  });
});

describe('normalizeFixture: a difference in meaning still fails', () => {
  const differs = (change: (plan: ReturnType<typeof dayPlanSample>) => void) => {
    const queried = dayPlanSample(reminted());
    change(queried);
    assert.notDeepEqual(normalizeFixture(queried), normalizeFixture(dayPlanSample()));
  };

  it('a row logged against the wrong prescription', () => {
    differs((plan) => {
      const [squat, plank] = plan.workouts[0].items;
      squat.prescriptionPublicId = plank.prescriptionPublicId;
    });
  });

  it('two ids that should be different are the same one', () => {
    differs((plan) => {
      plan.athletes[1].profilePublicId = plan.athletes[0].profilePublicId;
    });
  });

  it('items in a different order', () => {
    differs((plan) => {
      plan.workouts[0].items.reverse();
    });
  });

  it('a different calendar day (days are never rewritten)', () => {
    differs((plan) => {
      plan.day = '2026-11-17';
    });
  });

  it('a different logged number', () => {
    differs((plan) => {
      plan.workouts[0].items[0].rows[0].logged!.values.quantities[0].value = 70;
    });
  });
});

describe('normalizeFixture: timestamps, only in the fields the caller names', () => {
  // Shaped like the plan's `RowResult` after an un-tick: `{ ok, entryPublicId, hiddenAt }`.
  const fixture = {
    ok: true,
    entryPublicId: ID.squatEntry,
    hiddenAt: '2026-11-16T15:04:05.123456Z',
  };
  const options = { timestampFields: ['hiddenAt'] };

  it('a string and a Date both become the placeholder', () => {
    const queried = { ok: true, entryPublicId: newId(), hiddenAt: new Date(1_800_000_000_000) };

    expect(normalizeFixture(queried, options)).toEqual({
      ok: true,
      entryPublicId: idLabel(1),
      hiddenAt: TIMESTAMP_PLACEHOLDER,
    });
    assert.deepEqual(normalizeFixture(queried, options), normalizeFixture(fixture, options));
  });

  it('a field that is not named keeps its value, so two timestamps still differ', () => {
    const queried = { ...fixture, hiddenAt: '2026-11-16T15:04:06.000000Z' };

    assert.notDeepEqual(normalizeFixture(queried), normalizeFixture(fixture));
  });

  it('null stays null: "never hidden" does not equal "hidden"', () => {
    const queried = { ...fixture, hiddenAt: null };

    expect(normalizeFixture(queried, options)).toMatchObject({ hiddenAt: null });
    assert.notDeepEqual(normalizeFixture(queried, options), normalizeFixture(fixture, options));
  });

  it('refuses a named field that holds something that is not a timestamp', () => {
    expect(() => normalizeFixture({ hiddenAt: { at: 'x' } }, options)).toThrow(/'hiddenAt'/);
    expect(() => normalizeFixture({ hiddenAt: 5 }, options)).toThrow(/a number/);
  });
});

describe('normalizeFixture: only plain JSON-like data', () => {
  it('refuses a Map or a class instance instead of emptying it', () => {
    expect(() => normalizeFixture({ rows: new Map() })).toThrow(/a Map/);
  });

  it('keeps a Date outside a named field, compared by value', () => {
    const at = new Date(1_800_000_000_000);

    assert.deepEqual(normalizeFixture({ at }), { at: new Date(1_800_000_000_000) });
  });

  it('passes scalars and null through', () => {
    expect(normalizeFixture(null)).toBeNull();
    expect(normalizeFixture(3)).toBe(3);
    expect(normalizeFixture('Heavy A')).toBe('Heavy A');
    expect(normalizeFixture('2026-11-16')).toBe('2026-11-16');
  });
});
