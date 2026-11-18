import { assertMigrationTarget } from '@mat-plan/shared';

import { createDb, createDbPool } from '../src/client';
import { resolveSeedOptions, seed } from '../src/seed';

// Runs the idempotent seed against DATABASE_URL[_UNPOOLED].
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error('Set DATABASE_URL_UNPOOLED (or DATABASE_URL) to run the seed.');

// OPS-1: same guard as db:migrate. The seed is `ON CONFLICT DO NOTHING`, so seeding the WRONG
// database is the silent failure — hence a refusal before connecting rather than after.
assertMigrationTarget(process.env.EXPECTED_DB_ENV, url, 'db:seed');

// FAM-1 D10 / OPS-2: fixtures (the household, its athletes, the programs) only on request, and only
// where the URL proves it is not production.
const options = resolveSeedOptions(process.env, url);

// OPS-2 PR 1: bounded waits. The seed's statements are short; a lock held by a long write fails the
// run (and is retried on the next push) rather than queueing every writer behind it.
const pool = createDbPool(url, { lockTimeoutMs: 5_000, statementTimeoutMs: 60_000 });
await seed(createDb(pool), options);
await pool.end();
// Fixed text only: this lands in world-readable Actions logs. OPS-2 D11: the runbook's check greps
// the reference-only line, so it also tells this code from a seed that wrote households.
console.log(
  options.fixtures ? '✓ seed complete (fixtures)' : '✓ seed complete (reference data only)',
);
