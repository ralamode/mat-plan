import { describe, expect, it } from 'vitest';

import { WORKOUT_NAME_MAX } from '../programming';

import { COPY_NAME_SUFFIX, copyName, workoutNameSchema } from './pieces';

/**
 * The default name of a copy in its own program, and the Copy dialog's prefill (FAM-1 contract
 * change C15). The prototype's rule: the name and " (copy)", cut so the whole fits the limit.
 */
describe('copyName: a copy’s default name', () => {
  it('adds the suffix to a name that has room', () => {
    expect(copyName('Heavy A')).toBe('Heavy A (copy)');
    expect(COPY_NAME_SUFFIX).toBe(' (copy)');
  });

  it('cuts a long name so the copy’s still fits, as the prototype does', () => {
    const longest = 'x'.repeat(WORKOUT_NAME_MAX);
    const copied = copyName(longest);
    expect(copied).toHaveLength(WORKOUT_NAME_MAX);
    expect(copied.endsWith(COPY_NAME_SUFFIX)).toBe(true);
    expect(copied.startsWith('x'.repeat(WORKOUT_NAME_MAX - COPY_NAME_SUFFIX.length))).toBe(true);
  });

  it('is always a name the workout-name schema takes, for any name it takes', () => {
    for (const name of [
      'A',
      'Heavy A',
      'Stretch, 10 min',
      'y'.repeat(WORKOUT_NAME_MAX),
      '💪 day',
    ]) {
      expect(workoutNameSchema.safeParse(name).success, name).toBe(true);
      expect(workoutNameSchema.safeParse(copyName(name)).success, name).toBe(true);
    }
  });

  /** No half of a surrogate pair: what a database would store as a replacement mark. */
  const wellFormed = (text: string) =>
    !/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(text);

  it('🔴 never keeps half of an emoji (C33)', () => {
    // 16 letters and seven emoji: 30 by `length`. A cut at 23 lands inside the fourth emoji.
    const name = `Leg day 12345678${'💪'.repeat(7)}`;
    expect(name).toHaveLength(WORKOUT_NAME_MAX);
    expect(workoutNameSchema.safeParse(name).success).toBe(true);
    expect(wellFormed(name.slice(0, 23))).toBe(false);
    const copied = copyName(name);
    expect(copied).toBe('Leg day 12345678💪💪💪 (copy)');
    expect(wellFormed(copied)).toBe(true);
    expect(workoutNameSchema.safeParse(copied).success).toBe(true);
    // An emoji that fits exactly is kept whole.
    expect(copyName(`${'a'.repeat(21)}💪 and more`)).toBe(`${'a'.repeat(21)}💪 (copy)`);
    expect(copyName(`${'a'.repeat(22)}💪 and more`)).toBe(`${'a'.repeat(22)} (copy)`);
  });

  it('🔴 leaves no double space where the cut lands after a space (C33)', () => {
    const name = `${'a'.repeat(22)} bcdefgh`;
    expect(name).toHaveLength(WORKOUT_NAME_MAX);
    expect(copyName(name)).toBe(`${'a'.repeat(22)} (copy)`);
    expect(copyName(`${'a'.repeat(20)}   bcdefgh`)).toBe(`${'a'.repeat(20)} (copy)`);
  });

  it('🔴 drops a joiner the cut left joining nothing', () => {
    // A family emoji is people joined by zero-width joiners. After 19 letters the room ends
    // right after the first joiner: 19 + 2 (a person) + 1 (the joiner) is 22, and the next
    // person needs 2 more than the 23 there are.
    const family = '👨‍👩‍👧';
    const name = `${'a'.repeat(19)}${family} day`;
    expect(name.slice(0, 22).endsWith('‍')).toBe(true);
    const copied = copyName(name);
    expect(copied).toBe(`${'a'.repeat(19)}👨 (copy)`);
    expect(copied.includes('‍')).toBe(false);
    expect(wellFormed(copied)).toBe(true);
    // A joiner that still joins is kept: here the cut lands after the second person.
    expect(copyName(`${'a'.repeat(18)}${family} day`)).toBe(`${'a'.repeat(18)}👨‍👩 (copy)`);
  });

  it('a name with room is kept exactly as it is, whatever it ends with', () => {
    // The clean-up is for a cut. A short name ending in a joiner passes the schema and is kept.
    const odd = 'Heavy‍';
    expect(workoutNameSchema.safeParse(odd).success).toBe(true);
    expect(copyName(odd)).toBe(`${odd}${COPY_NAME_SUFFIX}`);
    expect(copyName('x'.repeat(23))).toBe(`${'x'.repeat(23)}${COPY_NAME_SUFFIX}`);
  });

  it('a cut that would leave nothing keeps the name as cut: a copy still has a name', () => {
    const name = `‍${' '.repeat(22)}x`;
    expect(workoutNameSchema.safeParse(name).success).toBe(true);
    const copied = copyName(name);
    expect(copied).toBe(`‍${' '.repeat(22)}${COPY_NAME_SUFFIX}`);
    expect(workoutNameSchema.safeParse(copied)).toMatchObject({ success: true, data: copied });
  });

  it('for any name the schema takes: well formed, within the limit, one space before the suffix', () => {
    let seed = 20261117;
    const next = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const pieces = [
      'a',
      'B',
      '7',
      ' ',
      '-',
      'é',
      '💪',
      '🤼',
      '👨\u200d👩\u200d👧',
      '🏳\ufe0f\u200d🌈',
      'ñ',
    ];
    let checked = 0;
    for (let i = 0; i < 4000; i += 1) {
      const name = Array.from({ length: 1 + next(30) }, () => pieces[next(pieces.length)])
        .join('')
        .trim();
      if (!workoutNameSchema.safeParse(name).success) continue;
      const copied = copyName(name);
      expect(wellFormed(copied), name).toBe(true);
      expect(copied.length, name).toBeLessThanOrEqual(WORKOUT_NAME_MAX);
      expect(copied.endsWith(COPY_NAME_SUFFIX), name).toBe(true);
      // Nothing left hanging before the suffix where a cut was made.
      if (name.length > WORKOUT_NAME_MAX - COPY_NAME_SUFFIX.length) {
        expect(/[\s‍] \(copy\)$/u.test(copied), name).toBe(false);
      }
      // The stored name is the prefilled one: the schema's trim changes nothing.
      expect(workoutNameSchema.safeParse(copied), name).toMatchObject({ data: copied });
      expect(workoutNameSchema.safeParse(copied).success, name).toBe(true);
      // A name with room is kept whole.
      if (name.length <= WORKOUT_NAME_MAX - COPY_NAME_SUFFIX.length) {
        expect(copied, name).toBe(`${name}${COPY_NAME_SUFFIX}`);
      }
      checked += 1;
    }
    expect(checked).toBeGreaterThan(2000);
  });

  it('a copy of a copy is cut the same way, never past the limit', () => {
    let name = 'Conditioning circuit';
    for (let i = 0; i < 4; i += 1) {
      name = copyName(name);
      expect(name.length).toBeLessThanOrEqual(WORKOUT_NAME_MAX);
    }
    expect(name.endsWith(COPY_NAME_SUFFIX)).toBe(true);
  });
});
