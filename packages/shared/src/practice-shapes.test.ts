import { describe, expect, it } from 'vitest';

import { METRIC_DEFINITION_SEED_ROWS, METRIC_KEYS } from './catalog-metrics';
import {
  editPracticeSchema,
  isPracticeMinutesInRange,
  parsePracticeMinutes,
  practiceMinutesProblem,
  logPracticeSchema,
  PRACTICE_AMEND_REFUSALS,
  PRACTICE_MINUTES_MAX,
  PRACTICE_MINUTES_MIN,
  PRACTICE_UNIT,
} from './practice-shapes';
import { ROW_REFUSALS } from './program/day-shapes';

const ID = '019826b4-0000-7000-8000-000000000001';
const input = (value: unknown) => ({ profilePublicId: ID, entryId: ID, value, seenValue: 90 });

describe('practice-shapes — the contract (V1-24 3b-life)', () => {
  it('pins the range: 10 to 300, both inclusive (maintainer, 2026-11-16)', () => {
    expect(PRACTICE_MINUTES_MIN).toBe(10);
    expect(PRACTICE_MINUTES_MAX).toBe(300);
    expect([9, 10, 300, 301].map(isPracticeMinutesInRange)).toEqual([false, true, true, false]);
  });

  it("the unit is the seed row's own, so the writers' pin cannot drift from it", () => {
    const seeded = METRIC_DEFINITION_SEED_ROWS.find((r) => r.key === METRIC_KEYS.practice_minutes);
    expect(PRACTICE_UNIT).toBe('min');
    expect(PRACTICE_UNIT).toBe(seeded!.unit);
  });

  it('whole digits only, trimmed', () => {
    expect(parsePracticeMinutes(' 45 ')).toBe(45);
    for (const text of ['45.5', '45,5', '1e2', '+45', '-45', '1:30', 'abc', '']) {
      expect(parsePracticeMinutes(text)).toBeNull();
    }
  });

  it('a blank string clears; an absent, null or non-string value is refused', () => {
    expect(editPracticeSchema.parse(input('  ')).value).toBeNull();
    expect(editPracticeSchema.parse(input('10')).value).toBe(10);
    expect(editPracticeSchema.parse(input('300')).value).toBe(300);
    for (const value of [undefined, null, 45, '9', '301', '45.5']) {
      expect(editPracticeSchema.safeParse(input(value)).success).toBe(false);
    }
    // `seenValue` is a whole number the form rendered; a fractional or missing one is `bad_value`.
    expect(editPracticeSchema.safeParse({ ...input('45'), seenValue: 45.5 }).success).toBe(false);
    const { seenValue: _omit, ...noSeen } = input('45');
    expect(editPracticeSchema.safeParse(noSeen).success).toBe(false);
  });

  it("borrows the row contract's words where the meaning is the same", () => {
    for (const shared of ['bad_value', 'closed_day', 'not_found'] as const) {
      expect(ROW_REFUSALS).toContain(shared);
      expect(PRACTICE_AMEND_REFUSALS).toContain(shared);
    }
  });

  it('classifies a typed entry the same way for the form and the action (3b-life-b B2)', () => {
    expect(practiceMinutesProblem('  ')).toBe('blank');
    for (const t of ['1', '2', '9', '1.5', '1,5', '1:30'])
      expect(practiceMinutesProblem(t)).toBe('hours');
    for (const t of ['0', '301', 'abc', '-45', '1e2'])
      expect(practiceMinutesProblem(t)).toBe('range');
    for (const t of ['10', ' 90 ', '300']) expect(practiceMinutesProblem(t)).toBeNull();
  });

  it('the log schema takes whole minutes in range and refuses the rest', () => {
    const base = { profileId: ID, clientId: ID, day: '2026-11-16' };
    expect(logPracticeSchema.parse({ ...base, minutes: '45' }).minutes).toBe(45);
    for (const minutes of ['', '9', '301', undefined, 45]) {
      expect(logPracticeSchema.safeParse({ ...base, minutes }).success).toBe(false);
    }
  });
});
