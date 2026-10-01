import { describe, expect, it } from 'vitest';

import { BODYWEIGHT_UNITS, DEFAULT_BODYWEIGHT_UNIT } from './bodyweight';
import { EXPORTABLE_UNITS } from './csv/value';
import { sessionMovementSchema } from './strength-session';
import { isLoggableUnit, LOGGABLE_DIMENSIONS, loggableUnitsOf, UNIT_CODES } from './units';

/**
 * **The chain (V1-30): every unit the form can put in state is one the server accepts, and every unit
 * the server accepts is one the export can write.**
 *
 * V1-30 was this chain broken in the middle: the form offered 9 units, the session schema accepted 2,
 * and the export could write 4. Each link was "true by construction" in its own file and nobody
 * checked them against each other. This test runs the WIRED field (`sessionMovementSchema.shape.unit`,
 * what the action actually validates with), not a helper, so reverting the field to
 * `z.enum(BODYWEIGHT_UNITS)` turns it red.
 */
describe('offerable ⊆ accepted ⊆ exportable', () => {
  const wiredUnit = sessionMovementSchema.shape.unit;

  // Every way a unit reaches the form's movement state: the Unit select (per dimension), the
  // household default, and the bodyweight units the default is drawn from. A catalog default is
  // filtered through `isLoggableUnit` in the scaffold, so it is already one of these.
  const offerable = [
    ...new Set([
      ...LOGGABLE_DIMENSIONS.flatMap(loggableUnitsOf),
      DEFAULT_BODYWEIGHT_UNIT,
      ...BODYWEIGHT_UNITS,
    ]),
  ];

  it.each(offerable)('the server accepts %s', (unit) => {
    expect(wiredUnit.safeParse(unit).success).toBe(true);
  });

  it.each(wiredUnit.options)('the export can write %s', (unit) => {
    expect(EXPORTABLE_UNITS).toContain(unit);
  });
});

describe('the units no form offers', () => {
  const NON_LOGGABLE = UNIT_CODES.filter((u) => !isLoggableUnit(u));

  // The one literal pin of this set (AGENTS.md → constants). A new unit code lands in exactly one of
  // the two lists, and this says which.
  it('are exactly bool, count and timing', () => {
    expect([...NON_LOGGABLE].sort()).toEqual(['bool', 'count', 'timing']);
  });

  it.each(NON_LOGGABLE)('%s is refused by the server and has no CSV spelling', (unit) => {
    expect(sessionMovementSchema.shape.unit.safeParse(unit).success).toBe(false);
    expect(EXPORTABLE_UNITS).not.toContain(unit);
  });
});
