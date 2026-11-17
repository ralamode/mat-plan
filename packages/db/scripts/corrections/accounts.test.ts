import { E2E_SESSION_BYPASS_USER } from '@mat-plan/shared';
import { DrizzleQueryError } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Database } from '../../src/client';
import { accountIssue, CREATE_HOUSEHOLD_ACCOUNTS_ENV, parseAccountList } from './accounts';
import { CorrectionRefusal } from './redact';
import { CORRECTIONS, CREATE_HOUSEHOLD_NAME } from './registry';

/**
 * `PRIV-3` RC, D2 and D9 — the account checks the two `household_members` corrections share, and
 * the proof that `create-household-…`'s catch is WIRED. Every account literal is visibly synthetic.
 */
const A = 'user_rcfixture000a';
const B = 'user_rcfixture000b';
const LOCAL = 'postgres://u:p@localhost:5432/mat_plan';

const ENV_KEYS = ['DATABASE_URL', 'DATABASE_URL_UNPOOLED', CREATE_HOUSEHOLD_ACCOUNTS_ENV] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

/** The refusal `fn` throws, so its message can be checked for what it must not contain. */
function refusalOf(fn: () => unknown): CorrectionRefusal {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(CorrectionRefusal);
    return e as CorrectionRefusal;
  }
  throw new Error('expected a refusal');
}

describe('parseAccountList', () => {
  it.each([
    ['one space', `${A} ${B}`],
    ['a newline', `${A}\n${B}`],
    ['a tab and surrounding whitespace', `  ${A}\t${B}\n`],
  ])('splits on %s', (_label, raw) => {
    expect(parseAccountList(raw)).toEqual([A, B]);
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['whitespace only', ' \n\t '],
  ])('refuses a list that is %s, naming the variable', (_label, raw) => {
    expect(refusalOf(() => parseAccountList(raw)).message).toContain(CREATE_HOUSEHOLD_ACCOUNTS_ENV);
  });

  it('refuses a repeated account by POSITION, never by id', () => {
    const refusal = refusalOf(() => parseAccountList(`${A} ${B} ${A}`));
    expect(refusal.message).toBe('account 3 of 3 repeats account 1; nothing written');
    expect(refusal.message).not.toContain(A);
  });
});

describe('accountIssue', () => {
  it('passes a well-shaped id', () => {
    expect(accountIssue(A)).toBeNull();
  });

  it.each(['user_rc,fixture', 'someone@example.com', `user_${'a'.repeat(65)}`])(
    'calls %j a shape problem',
    (id) => {
      expect(accountIssue(id)).toBe('shape');
    },
  );

  it('refuses the fixture principal when no local target is set', () => {
    expect(accountIssue(E2E_SESSION_BYPASS_USER)).toBe('fixture-remote');
  });

  it('allows the fixture principal on a local target', () => {
    process.env.DATABASE_URL = LOCAL;
    expect(accountIssue(E2E_SESSION_BYPASS_USER)).toBeNull();
  });
});

describe('create-household: the catch is wired (D9)', () => {
  it('🔴 a database error inside the transaction reaches the runner with no input id anywhere', async () => {
    const create = CORRECTIONS.find((c) => c.name === CREATE_HOUSEHOLD_NAME);
    expect(create, 'the correction is in the registry').toBeDefined();

    process.env.DATABASE_URL = LOCAL;
    process.env[CREATE_HOUSEHOLD_ACCOUNTS_ENV] = `${A} ${B}`;

    // A real `DrizzleQueryError` wrapping a pg-shaped `23505` whose `detail` names the account,
    // which is exactly what a lost race on `uq_household_members_clerk_user` raises.
    const pgError = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      constraint: 'uq_household_members_clerk_user',
      detail: `Key (clerk_user_id)=(${B}) already exists.`,
    });
    const stub = {
      transaction: () =>
        Promise.reject(
          new DrizzleQueryError('insert into "household_members" …', [B, 'owner'], pgError),
        ),
    } as unknown as Database;

    let thrown: unknown;
    try {
      await create!.run(stub, true);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    const err = thrown as Error;
    expect(err.message).toBe(
      `${CREATE_HOUSEHOLD_NAME} failed (nothing committed): 23505 uq_household_members_clerk_user`,
    );
    expect(err.cause).toBeUndefined();
    for (const text of [err.message, String(err.cause ?? ''), err.stack ?? '']) {
      expect(text).not.toContain(A);
      expect(text).not.toContain(B);
    }
  });
});
