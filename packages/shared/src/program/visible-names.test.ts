import { describe, expect, it } from 'vitest';

import { foldName } from '../text';

import { programNameSchema, supersetGroupSchema, workoutNameSchema } from './pieces';
import { heavyADraft } from './fixtures';
import {
  createProgramSchema,
  renameProgramSchema,
  saveWorkoutSchema,
  workoutDraftSchema,
} from './program-shapes';

/**
 * A required name has something to read (FAM-1 contract change C12, from step 6a's review). A name
 * made only of zero-width characters is one character long and passed `min(1)`; it then showed as
 * a blank line in the Programs list and could not be told from another such name.
 */
const INVISIBLE = [
  '\u200b',
  '\u200b\u200b',
  '\u200d',
  '\u200c\u200d',
  '\u2060',
  ' \u200b ',
  '\ufeff\u200b',
];
const VISIBLE = ['A', 'a\u200b', 'Heavy A', '💪', '7', '—', 'Ünïcode', 'م'];

/**
 * Blank-looking characters `foldName` keeps, so they still pass. Pinned so that closing them (in
 * `foldName`, for every name in the app) is a deliberate change.
 */
const BLANK_BUT_KEPT = ['\u2800', '\u3164', '\u115f', '\u1160', '\uffa0'];

describe('a required name is not made only of characters that fold away', () => {
  const schemas = { programNameSchema, workoutNameSchema, supersetGroupSchema };

  it('the probe names really are invisible: each folds to nothing', () => {
    for (const name of INVISIBLE) expect(foldName(name), JSON.stringify(name)).toBe('');
    for (const name of VISIBLE) expect(foldName(name), name).not.toBe('');
  });

  it.each(Object.entries(schemas))(
    '%s refuses a name of invisible characters only',
    (_n, schema) => {
      for (const name of INVISIBLE) {
        expect(schema.safeParse(name).success, JSON.stringify(name)).toBe(false);
      }
    },
  );

  it.each(Object.entries(schemas))(
    '%s still takes every name with something to read',
    (_n, schema) => {
      for (const name of VISIBLE) expect(schema.safeParse(name).success, name).toBe(true);
    },
  );

  it('a name of combining marks only is refused; one of blank-looking letters is the known gap', () => {
    for (const name of ['\u0301', '\u0e31', '\u093f']) {
      expect(programNameSchema.safeParse(name).success, JSON.stringify(name)).toBe(false);
    }
    for (const name of BLANK_BUT_KEPT) {
      expect(foldName(name), JSON.stringify(name)).not.toBe('');
      expect(programNameSchema.safeParse(name).success, JSON.stringify(name)).toBe(true);
    }
  });

  it('so do the write schemas that hold a name', () => {
    const id = '019826b4-0000-7000-8000-000000000001';
    const draft = (name: string) => ({ ...heavyADraft, name });
    // The controls: with a name that can be read, each of these parses.
    expect(createProgramSchema.safeParse({ clientId: id, name: 'Strength' }).success).toBe(true);
    expect(renameProgramSchema.safeParse({ programPublicId: id, name: 'Strength' }).success).toBe(
      true,
    );
    expect(saveWorkoutSchema.safeParse(draft('Heavy A')).success).toBe(true);
    for (const name of INVISIBLE) {
      const shown = JSON.stringify(name);
      expect(createProgramSchema.safeParse({ clientId: id, name }).success, shown).toBe(false);
      expect(renameProgramSchema.safeParse({ programPublicId: id, name }).success, shown).toBe(
        false,
      );
      expect(saveWorkoutSchema.safeParse(draft(name)).success, shown).toBe(false);
      // A draft being typed is as strict about a name that is there; only '' is "not named yet".
      expect(workoutDraftSchema.safeParse(draft(name)).success, shown).toBe(false);
    }
    expect(workoutDraftSchema.safeParse(draft('')).success).toBe(true);
  });
});
