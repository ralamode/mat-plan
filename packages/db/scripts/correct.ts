import { createDb, createDbPool } from '../src/client';
import { CORRECTIONS } from './corrections/registry';

/**
 * Apply a guarded, idempotent data correction (`pnpm --filter @mat-plan/db db:correct <name>`).
 *
 * **Dry run by default.** Without `--apply` this prints what it WOULD change and writes nothing —
 * because the whole category exists for data that is already wrong, and a correction aimed at the
 * wrong rows is worse than the bug it fixes.
 *
 * Runs against `DATABASE_URL_UNPOOLED` (the direct string), like migrate: a correction is DDL-adjacent
 * ops work, not app traffic, and should not go through PgBouncer.
 *
 * See `scripts/corrections/README.md` for the rules and how to add one.
 */
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const name = args.find((a) => !a.startsWith('--'));

if (!name) {
  console.log('Usage: pnpm --filter @mat-plan/db db:correct <name> [--apply]\n');
  console.log('Available corrections:');
  for (const c of CORRECTIONS) {
    console.log(`  ${c.name}`);
    console.log(`      ${c.what}  (cause: ${c.issue})`);
  }
  process.exit(CORRECTIONS.length === 0 ? 1 : 0);
}

const correction = CORRECTIONS.find((c) => c.name === name);
if (!correction) {
  console.error(`No correction named '${name}'. Run without a name to list them.`);
  process.exit(1);
}

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) {
  console.error('Set DATABASE_URL_UNPOOLED (or DATABASE_URL) to the database to correct.');
  process.exit(1);
}

// Show WHICH database, so a prod correction is never run against a local one by accident (or the
// reverse). Host only — never the credentials.
const host = (() => {
  try {
    return new URL(url).host;
  } catch {
    return '(unparseable)';
  }
})();

const pool = createDbPool(url);
const db = createDb(pool);

console.log(`\n${correction.name}`);
console.log(`  ${correction.what}`);
console.log(`  cause: ${correction.issue}`);
console.log(`  target: ${host}`);
console.log(`  mode: ${apply ? 'APPLY — this writes' : 'dry run — nothing will be written'}\n`);

const changes = await correction.run(db, apply);
await pool.end();

if (changes.length === 0) {
  // Not an error: a guarded correction that matches nothing has almost certainly already run.
  console.log('No matching rows — already corrected, or the guard did not match. Nothing to do.');
  process.exit(0);
}

for (const line of changes) console.log(`  ${apply ? '✓' : '·'} ${line}`);
console.log(
  apply
    ? `\n✓ applied ${changes.length} change(s).`
    : `\n${changes.length} change(s) would be made. Re-run with --apply to write them.`,
);
