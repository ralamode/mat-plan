import { readFileSync } from 'node:fs';

import { describe, expect, expectTypeOf, it } from 'vitest';
import { CATALOG_MOVEMENTS } from '@mat-plan/shared/catalog/data';
import { CATALOG_FIXTURE } from '@mat-plan/shared/catalog/fixture';

import {
  assertFixturesTargetAllowed,
  seedLibraryOf,
  FIXTURES_TARGET_REFUSED,
  resolveSeedOptions,
  SEED_FIXTURES_ENV,
  seedFixturesRequested,
  type SeedCounts,
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

// The function's behaviour; the next describe pins that `scripts/seed.ts` actually calls it.
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

/**
 * The CALL SITE, pinned by source (as `seed-fixtures-is-contained.test.ts` pins the harness): the
 * unit tests above prove `resolveSeedOptions`, and this proves `db:seed` decides through it and
 * nothing else. Without it, `seed(createDb(pool), { fixtures: true })` in the script would pass
 * every test and every proof.
 */
describe('scripts/seed.ts decides through resolveSeedOptions', () => {
  const script = readFileSync(new URL('../scripts/seed.ts', import.meta.url), 'utf8');

  it('resolves its options from the environment and the URL it connects with', () => {
    expect(script).toContain('const options = resolveSeedOptions(process.env, url);');
    expect(script).toContain('createDbPool(url)');
    // OPS-2 PR 1: every connection the seed opens bounds its waits.
    expect(script).toContain(
      `client.query("SET lock_timeout = '5s'; SET statement_timeout = '60s'")`,
    );
  });

  it('passes exactly those options to seed(), and calls seed() once', () => {
    expect(script).toContain('await seed(createDb(pool), options);');
    expect(script.match(/\bseed\(/g)).toHaveLength(1);
    expect(script).not.toMatch(/fixtures\s*:/);
  });

  // OPS-2 D11: the whole expression, so a swapped ternary fails. `runbooks.md`'s check greps the
  // reference-only line in production's public Actions log.
  it('prints the reference-only line without fixtures, and only then', () => {
    expect(script).toContain(
      "options.fixtures ? '✓ seed complete (fixtures)' : '✓ seed complete (reference data only)'",
    );
  });
});

/**
 * CAT-3 A2-ii (E4): `seed()` names the movement library once, from its flag, through `seedLibraryOf`,
 * and with fixtures checks ownership before any write. Pinned by source, as the fixtures call site is
 * above; `db:verify`'s Proof A, A2 and A3 pin the effect.
 */
describe('seed() picks the movement library by its flag (CAT-3 A2-ii, E4)', () => {
  const source = readFileSync(new URL('./seed.ts', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('export async function seed('));
  const seedBody = body.slice(0, body.indexOf('\n}\n'));

  it('the real library without the flag; the test library alone with it (CAT-3 F1-i)', () => {
    expect(seedLibraryOf('catalog')).toEqual({ entries: CATALOG_MOVEMENTS });
    expect(seedLibraryOf('fixture')).toEqual({ entries: CATALOG_FIXTURE });
  });

  it('seed() names the library once, from the flag, and only through seedLibraryOf', () => {
    expect(seedBody.match(/seedLibraryOf\(fixtures \? 'fixture' : 'catalog'\)/g)).toHaveLength(1);
    expect(source.match(/seedReference\(db,/g)).toHaveLength(1);
    expect(seedBody).toContain('seedReference(db, { library })');
  });

  it('with fixtures, ownership is checked before seedReference writes anything (plan D2)', () => {
    const check = seedBody.indexOf('if (fixtures) await assertSeedOwnsDatabase(db);');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(seedBody.indexOf('seedReference(db,'));
  });
});

/**
 * CAT-3 A2-i (spec rule 7): the seed's report is COUNTS ONLY. Every field of `SeedCounts` is a number,
 * so printing a slug needs a type change first, which review sees. A typecheck pin (`pnpm typecheck`;
 * `expectTypeOf` does nothing at runtime).
 */
describe('SeedCounts holds numbers only (CAT-3 A2-i)', () => {
  it('every field is a number (a type-level pin: a string field fails typecheck)', () => {
    expectTypeOf<SeedCounts>().toEqualTypeOf<Readonly<Record<keyof SeedCounts, number>>>();
  });
});
