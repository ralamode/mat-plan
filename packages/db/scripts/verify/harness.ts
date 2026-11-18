import assert from 'node:assert/strict';

import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { drizzle } from 'drizzle-orm/pglite';

import { schema } from '../../src/client';
import type { HouseholdScope } from '../../src/scope';
import type { Executor } from '../../src/writers/executor';

/**
 * The `db:verify` harness (FAM-1 step 0c): the one database every proof runs against, and the
 * helpers a proof needs, moved out of `verify.ts` unchanged so a proof module under
 * `scripts/verify/` can import them. `verify.ts` imports them from here by the same names.
 *
 * Why it exists: `verify.ts` was one ~10,000-line file that every data lane would append to
 * (`docs/plans/fam-1-family-program.md` §6, "Shared append-only files are sharded"). The lanes' new
 * proofs go in `schema.ts`, `program.ts`, `day.ts` and `single-values.ts` beside this file, one
 * owner each. The proofs already in `verify.ts` stay there.
 *
 * ⚠️ `db` is created when this module is first imported and is the ONLY database: PGlite has one
 * connection. Never construct a second one in a proof module; it would be an empty, unmigrated
 * database that passes nothing meaningful.
 */
export const db = drizzle(new PGlite(), { schema, casing: 'snake_case' });
export const asPg = db as unknown as NodePgDatabase<typeof schema>;

/** The transaction handle `db.transaction` hands its callback — derived here, never re-typed. */
export type VerifyTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The same `as unknown as` widening `asPg` performs, for a TRANSACTION handle.
 *
 * ⚠️ PGlite's `PgTransaction` is structurally incompatible with node-postgres' (`Results` has no
 * `oid`), so a writer typed on `Executor` will not take a PGlite `tx` without it. The runtime shapes
 * agree — `db:verify`'s whole premise — which is exactly what `asPg` already asserts for the database
 * handle; this is that cast at one level down, named once rather than inline per call.
 */
export const asTx = (tx: VerifyTx) => tx as unknown as Executor;

/**
 * The same transaction as the database handle a QUERY or a seed helper takes
 * (`NodePgDatabase`), where `asTx` gives the handle a WRITER takes. One cast for the proof modules,
 * which had each written it inline (FAM-1 contract change C13).
 */
export const asDb = (tx: VerifyTx) => tx as unknown as NodePgDatabase<typeof schema>;

/** Thrown by {@link rolledBack} to roll its transaction back. Private: nothing else throws it. */
class Rollback extends Error {}

/**
 * Run `fn` in a transaction that is ALWAYS rolled back, so a proof's writes never persist.
 *
 * **Proof modules import this one** (`schema.ts`, `program.ts`, `day.ts`, `single-values.ts`), and do
 * not write their own. The modules run on a database every later proof also reads (see
 * `VerifyContext` below), so a proof that writes wraps its writes in this and leaves nothing behind
 * for a later module to count. Lane A's step 3 wrote the first copy, privately in `schema.ts`; it
 * swaps to this one in its next step.
 *
 * - `fn` gets the transaction handle. Issue EVERY statement on that `tx` (`asTx(tx)` for a writer
 *   typed on `Executor`): PGlite has one connection, so a query on the module-level `db` inside the
 *   transaction waits forever.
 * - When `fn` returns, the transaction is rolled back and this resolves.
 * - When `fn` throws (a failed `assert` included), the transaction is rolled back and the error
 *   propagates unchanged, so a failing proof still fails `db:verify` with its own message.
 * - A statement Postgres rejects aborts the transaction. To assert a rejection and carry on, pass
 *   `tx` to `expectRejectedBy`, which runs the probe in a savepoint.
 */
export async function rolledBack(fn: (tx: VerifyTx) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await fn(tx);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}

/**
 * Assert `fn` rejects with a Postgres error whose violated constraint is `constraintName`,
 * read off `cause.constraint` (the node-postgres / PGlite error shape). Extracted from the two
 * inline copies `verify.ts` grew (V1-1c's activity_type_id guard + V1-5's shape-CHECK trap) and
 * reused for the V1-6b-1 ramp_targets rejections — one idiom, so a rename fails in one place.
 *
 * **TEN-2a: pass `tx` when the probe runs inside an enclosing transaction.** A failed statement
 * aborts the whole transaction, so a second probe would fail `25P02` and this helper would report
 * `got '(none)'` for a constraint that is working perfectly. With `tx` each probe runs in its own
 * nested `tx.transaction(...)` — drizzle emits `SAVEPOINT` / `ROLLBACK TO SAVEPOINT` — so the
 * enclosing transaction survives every rejection. `fn` must issue its statements on that same `tx`:
 * PGlite has ONE connection, so a query on the module-level `db` inside a transaction waits forever.
 */
export async function expectRejectedBy(
  constraintName: string,
  fn: () => Promise<unknown>,
  tx?: VerifyTx,
): Promise<void> {
  let violated: string | undefined;
  try {
    if (tx) {
      await tx.transaction(async () => {
        await fn();
      });
    } else {
      await fn();
    }
  } catch (e) {
    violated = (e as { cause?: { constraint?: string } })?.cause?.constraint;
  }
  assert.equal(
    violated,
    constraintName,
    `expected rejection by constraint '${constraintName}', got '${violated ?? '(none)'}'`,
  );
}

/**
 * A reference table must equal its shared-const source EXACTLY, in BOTH directions — a row the const
 * doesn't know about is drift just as much as a const member with no row.
 *
 * Extracted at GAP-3 (reuse panel): `units` open-coded this as two loops, and `quantity_slots` was
 * about to open-code it a second time. Both now call this, so the parity RULE lives once even though
 * the two tables' columns differ.
 */
export function assertRefTableMatches(
  table: string,
  dbRows: readonly Record<string, unknown>[],
  constRows: readonly Record<string, unknown>[],
): void {
  const norm = (rows: readonly Record<string, unknown>[]) =>
    rows.map((r) => JSON.stringify(Object.entries(r).sort())).sort();
  assert.deepEqual(
    norm(dbRows),
    norm(constRows),
    `${table} rows equal their shared const EXACTLY (both directions)`,
  );
}

/**
 * The column set of a table, keyed by name → data_type — the `information_schema.columns` cast shape
 * lives ONCE here (the routine_config + entries checks both call it, plus the V1-10 tables).
 *
 * It carries `data_type` only. Nullability and the column default are catalog facts this shape
 * cannot express, so a check that needs them calls `columnCatalogShape` below rather than widening
 * this Map and churning its four existing callers.
 */
export async function columnsOf(tableName: string): Promise<Map<string, string>> {
  const res = await db.execute(
    sql`select column_name, data_type from information_schema.columns where table_name = ${tableName}`,
  );
  const rows = (res as unknown as { rows: { column_name: string; data_type: string }[] }).rows;
  return new Map(rows.map((r) => [r.column_name, r.data_type]));
}

/**
 * The three catalog facts about ONE column that `columnsOf` cannot carry: declared type, NULLability
 * and the stored default. Returns `undefined` when the column does not exist.
 *
 * Extracted at TEN-2a, its second consumer (TEN-1 1a's `households.synthetic` readback was the
 * first, converted in the same PR). ⚠️ `expectRejectedBy` cannot reach NULLability either — a NOT
 * NULL violation is `23502`, which carries a column, not a named constraint — so this readback is
 * the only way to assert that a column shipped nullable, or didn't.
 */
export async function columnCatalogShape(
  tableName: string,
  columnName: string,
): Promise<{ data_type: string; is_nullable: string; column_default: string | null } | undefined> {
  const res = await db.execute(
    sql`select data_type, is_nullable, column_default from information_schema.columns
        where table_name = ${tableName} and column_name = ${columnName}`,
  );
  return (
    res as unknown as {
      rows: { data_type: string; is_nullable: string; column_default: string | null }[];
    }
  ).rows[0];
}

/** One constraint's definition as Postgres renders it (`pg_get_constraintdef`); the cast lives here once. */
export async function constraintDef(conname: string): Promise<string> {
  const res = await db.execute(
    sql`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ${conname}`,
  );
  const rows = (res as unknown as { rows: { def: string }[] }).rows;
  assert.equal(rows.length, 1, `${conname} exists`);
  return rows[0].def;
}

/**
 * Run `fn` with `console.warn` captured, and return what it warned. The seed's TEN-2c shadow guard is
 * a WARNING, not a `throw`, so `assert.rejects` cannot reach it, and what must be true of its text (it
 * names the seed slug; it does NOT name a household's free text) is a privacy proof. Restores the real
 * `console.warn` in a `finally`. Moved here from `verify.ts` at OPS-2 PR 1, its second caller.
 */
export async function captureWarnings(fn: () => Promise<void>): Promise<string> {
  const real = console.warn;
  const lines: string[] = [];
  console.warn = (...args: unknown[]) => void lines.push(args.map(String).join(' '));
  try {
    await fn();
  } finally {
    console.warn = real;
  }
  return lines.join('\n');
}

/** The rows of a raw `execute` result, typed by the caller (the cast lives here once). */
export function rowsOf<T>(res: unknown): T[] {
  return (res as { rows: T[] }).rows;
}

/** The `id` column of a raw `execute` result, as numbers (an audit query's flagged rows). */
export function idsOf(res: unknown): number[] {
  return (res as { rows: { id: number | string }[] }).rows.map((r) => Number(r.id));
}

// CHECK ↔ shared-const parity: each DB text-enum CHECK definition must list EVERY member of
// its shared const (pins the schema CHECKs to the single source of truth — one can't drift
// from the other without this failing). V1-2 extends this from input_shape to the movement
// pattern + metric value_type/aggregation CHECKs (their columns are now catalog-populated).
export async function assertCheckCoversConst(
  conname: string,
  values: readonly string[],
): Promise<void> {
  const def = await constraintDef(conname);
  for (const value of values) {
    assert.ok(def.includes(`'${value}'`), `${conname} includes shared const member '${value}'`);
  }
  // BOTH directions: the CHECK's accepted set must equal the shared const EXACTLY — an inlined literal the
  // const doesn't have (a misspelling, or a value the app can't map) is drift the coverage loop above misses.
  // pg_get_constraintdef quotes enum literals with single quotes (identifiers use double quotes), so every
  // single-quoted token IS an accepted value.
  const inlined = [...new Set([...def.matchAll(/'([^']*)'/g)].map((m) => m[1]))].sort();
  assert.deepEqual(
    inlined,
    [...values].sort(),
    `${conname} accepts EXACTLY its shared const (no extra/misspelled literal)`,
  );
}

/**
 * What `verify.ts` hands each proof module: the run-time state a module cannot import.
 *
 * Today that is the three household scopes `verify.ts` mints, under the names it gives them, so a
 * proof reads the same in a module as it would in `verify.ts`, and a wrong scope is still a wrong
 * NAME. The reason for each is in `src/scope.test.ts` → `MINTED_SCOPES`. Everything else a proof
 * needs (`db`, `asPg`, `asTx`, `rolledBack`, `expectRejectedBy`, the catalog readers) is a plain
 * import from this file.
 *
 * ## What a proof module can rely on
 *
 * `verify.ts` calls the six modules once each, in the order schema → program → day →
 * single-values → erasure → catalog, as the LAST thing it does. So when a module runs:
 *
 * - every migration is applied and `seed()` has run (several times);
 * - 🔴 the database is NOT pristine: every row `verify.ts` wrote is still there, in household A
 *   (the seed's), household B and the others it creates. A proof that reads a whole table, or that
 *   must deep-equal a contract fixture, creates its OWN household and athletes and reads through
 *   that scope;
 * - ⚠️ two constraints are not as the migrations left them: `verify.ts`'s V1-1b backfill simulation
 *   drops and re-adds `entries_activity_type_id_not_null` and the movements global-row CHECK by
 *   hand. A `convalidated` read of either belongs beside the TEN-2c block at the top of `verify.ts`,
 *   which exists for that reason. Every other catalog object is the migrations' own.
 *
 * **The one exception to "last":** `catalog.ts` → `verifyCatalogMigrationFacts` (`CAT-3` A1) runs
 * right after `migrate()`, before `seed()`, because it proves the global-row CHECK the V1-1b
 * simulation later replaces. It takes no `VerifyContext` (none exists yet) and reads no seeded row.
 *
 * Why last: nothing in `verify.ts` runs after the modules, so rows a lane writes cannot change what
 * an existing whole-table assertion counts, and a lane's proof cannot become the FIRST failure under
 * an existing mutation patch (`scripts/mutations/*.expect` names the first failure).
 *
 * ## A module that needs its own household
 *
 * Mint its scope ONCE, as a named const (`const X_SCOPE = householdScopeForScript(row.id)`), never
 * inline at a call site: `src/scope.test.ts` fails the build on an inline mint here, as it does in
 * `verify.ts`.
 *
 * ## ⚠️ Two allowlists name `verify.ts` only, so two things go red in a proof module BY DESIGN
 *
 * A proof moved or copied from `verify.ts` can trip these. Neither is a bug in the proof module, and
 * neither is this lane's to widen: ask the contract owner.
 *
 * - **An `as OwnerScope` cast** (or `<OwnerScope>`): `src/scope.test.ts` → `ALLOWED_CAST` permits it
 *   in `scope.ts` and in `verify.ts`'s one named forgery. In a proof module, call `ownerScope()` and
 *   branch on `null`.
 * - **Naming `households.synthetic`**: `apps/web/lib/household-synthetic-is-dark.test.ts` → `ALLOWED`
 *   permits the word only in `schema.ts` and `verify.ts`. The column ships dark, and a proof module
 *   that reads it fails that test.
 */
export interface VerifyContext {
  /** Household A (the seed's household), as its OWNER. */
  readonly A_SCOPE: HouseholdScope;
  /** Household A, as a MEMBER: for "a member of this household is refused" proofs. */
  readonly A_MEMBER_SCOPE: HouseholdScope;
  /** Household B ("Verify Programming HH"), as its OWNER: the other side of a cross-household refusal. */
  readonly B_SCOPE: HouseholdScope;
}

/**
 * Run a writer, and turn a throw into a failed assertion that names the proof: a mutation that makes
 * the writer throw then fails on `what`, which is what its `.expect` file matches (mutations README).
 * Lifted from `single-values.ts` (V1-9b B2-0); `day.ts`'s `settle` and `program.ts`'s `threw` are the
 * same idea in their lanes' files.
 */
export async function orFail<T>(what: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    assert.fail(`${what} (threw: ${String((e as Error).message).slice(0, 120)})`);
  }
}
