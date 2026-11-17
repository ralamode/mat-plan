import { DrizzleQueryError } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { CorrectionRefusal, redactedFailure } from './redact';

/** Visibly synthetic: never read off a dashboard. */
const ID = 'user_rcfixture000a';

/** Everything `scripts/correct.ts` prints from an error: the message, the cause and the stack. */
const printed = (e: Error) =>
  [
    e.message,
    e.cause instanceof Error ? e.cause.message : String(e.cause ?? ''),
    e.stack ?? '',
  ].join('\n');

/** A pg-shaped unique violation, as node-postgres raises it. */
function uniqueViolation(): Error {
  return Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
    constraint: 'uq_household_members_clerk_user',
    detail: `Key (clerk_user_id)=(${ID}) already exists.`,
  });
}

describe('redactedFailure (PRIV-3 RC, D2)', () => {
  it('returns a refusal unchanged — its message is already counts and positions', () => {
    const refusal = new CorrectionRefusal('account 2 of 2 is not shaped like a Clerk user id');
    expect(redactedFailure('c', refusal)).toBe(refusal);
  });

  it('🔴 a drizzle query error loses every id, its detail and its cause; it keeps code + constraint', () => {
    const err = new DrizzleQueryError('insert into "household_members" …', [ID], uniqueViolation());
    expect(err.message, 'non-vacuity: the input error does carry the id').toContain(ID);

    const out = redactedFailure('create-household-x', err);
    expect(out.message).toBe(
      'create-household-x failed (nothing committed): 23505 uq_household_members_clerk_user',
    );
    expect(out.cause).toBeUndefined();
    expect(printed(out)).not.toContain(ID);
  });

  it('reads code and constraint off the error itself when nothing wraps it', () => {
    const out = redactedFailure('c', uniqueViolation());
    expect(out.message).toBe('c failed (nothing committed): 23505 uq_household_members_clerk_user');
    expect(printed(out)).not.toContain(ID);
  });

  it('prints "unknown" for a field that is missing or is not an identifier — never the value', () => {
    const cause = Object.assign(new Error(ID), { code: `x ${ID}`, constraint: undefined });
    const out = redactedFailure('c', new Error(ID, { cause }));
    expect(out.message).toBe('c failed (nothing committed): unknown unknown');
    expect(printed(out)).not.toContain(ID);
  });

  it.each([
    [
      'code',
      { code: ID, constraint: 'uq_household_members_clerk_user' },
      'unknown uq_household_members_clerk_user',
    ],
    ['constraint', { code: '23505', constraint: ID }, '23505 unknown'],
    ['both', { code: ID, constraint: ID }, 'unknown unknown'],
    [
      'a lower-case account in constraint',
      { code: '23505', constraint: 'user_rcfixture000a' },
      '23505 unknown',
    ],
  ])('🔴 never prints an account id that arrives in %s', (_label, fields, tail) => {
    const out = redactedFailure('c', Object.assign(new Error('x'), fields));
    expect(out.message).toBe(`c failed (nothing committed): ${tail}`);
    expect(printed(out)).not.toContain(ID);
  });

  it('keeps a Node system code', () => {
    expect(redactedFailure('c', Object.assign(new Error('x'), { code: 'ENOTFOUND' })).message).toBe(
      'c failed (nothing committed): ENOTFOUND unknown',
    );
  });

  it('survives a thrown non-Error', () => {
    expect(redactedFailure('c', ID).message).toBe('c failed (nothing committed): unknown unknown');
    expect(redactedFailure('c', null).message).toBe(
      'c failed (nothing committed): unknown unknown',
    );
  });
});
