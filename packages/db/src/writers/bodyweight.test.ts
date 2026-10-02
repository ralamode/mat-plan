import { DrizzleQueryError } from 'drizzle-orm/errors';
import { describe, expect, it } from 'vitest';

import { BODYWEIGHT_DAY_UNIQUE_INDEX } from '../schema';
import { isBodyweightDayConflict } from './bodyweight';

/** The shape node-postgres gives a unique violation: `code` + the violated `constraint`. */
function pgUniqueViolation(constraint: string) {
  return Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
    constraint,
  });
}

describe('isBodyweightDayConflict (V1-24 1d interim envelope)', () => {
  it('recognises the one-per-day index violation as drizzle wraps it (pg error in `cause`)', () => {
    const wrapped = new DrizzleQueryError(
      'insert into "entries" …',
      [],
      pgUniqueViolation(BODYWEIGHT_DAY_UNIQUE_INDEX),
    );
    expect(isBodyweightDayConflict(wrapped)).toBe(true);
  });

  it('recognises the bare driver error too', () => {
    expect(isBodyweightDayConflict(pgUniqueViolation(BODYWEIGHT_DAY_UNIQUE_INDEX))).toBe(true);
  });

  it('is false for a 23505 on ANY other unique index — the caller must rethrow those', () => {
    const other = new DrizzleQueryError('insert …', [], pgUniqueViolation('uq_entries_client_id'));
    expect(isBodyweightDayConflict(other)).toBe(false);
  });

  it('is false for a non-unique error, a plain Error, and non-objects', () => {
    const timeout = Object.assign(new Error('canceling statement due to statement timeout'), {
      code: '57014',
    });
    expect(isBodyweightDayConflict(new DrizzleQueryError('insert …', [], timeout))).toBe(false);
    expect(isBodyweightDayConflict(new Error('boom'))).toBe(false);
    expect(isBodyweightDayConflict(null)).toBe(false);
    expect(isBodyweightDayConflict('23505')).toBe(false);
  });
});
