import { describe, expect, it } from 'vitest';

import {
  assertFixturesTargetAllowed,
  FIXTURES_TARGET_REFUSED,
  resolveSeedOptions,
  SEED_FIXTURES_ENV,
  seedFixturesRequested,
} from './seed';

/**
 * FAM-1 step 1 (plan D10): the program fixtures are seeded only on request, and only into a database
 * the connection string proves is not production. `scripts/seed.ts` calls these two before it
 * connects; `verify/schema.ts` proves what `seed()` writes either way.
 */
describe('SEED_FIXTURES: the flag', () => {
  // The contract pin, once: the workflows and the harness spell this name as a literal.
  it('is named SEED_FIXTURES', () => {
    expect(SEED_FIXTURES_ENV).toBe('SEED_FIXTURES');
  });

  it('turns on only for the exact value 1', () => {
    expect(seedFixturesRequested('1')).toBe(true);
    for (const off of [undefined, '', '0', 'true', 'yes', ' 1', '1 ', 'TRUE']) {
      expect(seedFixturesRequested(off), String(off)).toBe(false);
    }
  });
});

/** The message `assertFixturesTargetAllowed` throws for `url`, or `null` when it allows it. */
function refusalOf(url: string): string | null {
  try {
    assertFixturesTargetAllowed(url);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

describe('assertFixturesTargetAllowed: an allowlist on the URL itself', () => {
  it.each([
    'postgres://u:p@localhost:5432/mat_plan',
    'postgres://u:p@127.0.0.1:54329/mat_plan_e2e',
    'postgres://u:p@[::1]:5432/mat_plan',
    'postgres://u:p@ep-x.us-east-2.aws.neon.tech/mat_plan_preview?sslmode=require',
  ])('allows %s', (url) => {
    expect(refusalOf(url)).toBeNull();
  });

  it.each([
    // A remote database that is not the preview one: production, with EXPECTED_DB_ENV unset.
    'postgres://u:p@ep-prod.us-east-2.aws.neon.tech/mat_plan?sslmode=require',
    // A libpq host override that LOOKS local and connects to Neon.
    'postgres://u:p@localhost/mat_plan?host=ep-prod.us-east-2.aws.neon.tech',
    'postgres://u:p@localhost/mat_plan?%68ost=ep-prod.us-east-2.aws.neon.tech',
    // No database named at all; unparseable.
    'postgres://u:p@ep-prod.us-east-2.aws.neon.tech/',
    'not a url',
  ])('refuses %s', (url) => {
    expect(refusalOf(url)).toBe(FIXTURES_TARGET_REFUSED);
  });

  // The refusal lands in a world-readable Actions log: fixed text, nothing from the URL. Asserted as
  // EQUALITY with the fixed text — a `toThrow(string)` is a substring match, and `not.toContain(secret)`
  // on the constant would pass however the message were built (db-environment.ts's own rule).
  it('names nothing from the connection string', () => {
    const url = 'postgres://someuser:s3cret@ep-prod-host.aws.neon.tech/prod_db_name';
    const message = refusalOf(url);
    expect(message).toBe(FIXTURES_TARGET_REFUSED);
    for (const part of ['someuser', 's3cret', 'ep-prod-host', 'prod_db_name']) {
      expect(message).not.toContain(part);
    }
  });
});

// `scripts/seed.ts` is one call to this, so deleting the guard or hard-coding `fixtures` is a test edit.
describe('resolveSeedOptions: what db:seed decides before it connects', () => {
  const PROD = 'postgres://u:p@ep-prod.us-east-2.aws.neon.tech/mat_plan?sslmode=require';
  const LOCAL = 'postgres://u:p@localhost:5432/mat_plan';

  it('flag off: no fixtures, whatever the URL', () => {
    expect(resolveSeedOptions({}, PROD)).toEqual({ fixtures: false });
    expect(resolveSeedOptions({ [SEED_FIXTURES_ENV]: '0' }, PROD)).toEqual({ fixtures: false });
  });

  it('flag on against a local database: fixtures', () => {
    expect(resolveSeedOptions({ [SEED_FIXTURES_ENV]: '1' }, LOCAL)).toEqual({ fixtures: true });
  });

  it('flag on against production: refused, before anything connects', () => {
    expect(() => resolveSeedOptions({ [SEED_FIXTURES_ENV]: '1' }, PROD)).toThrow(
      new Error(FIXTURES_TARGET_REFUSED),
    );
  });
});
