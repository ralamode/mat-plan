import { createDb } from '@mat-plan/db';

/**
 * A Drizzle client over a **recording** pg pool — the harness the app DAL's emitted-SQL proofs run
 * on. TEST SUPPORT ONLY; nothing in the app imports it.
 *
 * ## Why this exists at all
 *
 * `db:verify` cannot execute the app DAL (it is `server-only` and imports the app's env), so for a
 * read that lives in `lib/dal` the only way to assert what reaches Postgres is to run the real
 * Drizzle builder over a fake client and inspect the SQL it emits. `entries.test.ts` has done that
 * since DAL-1; TEN-1 1b needs the same for `listProfiles` and `getProfileByPublicId`, and **a second
 * copy of the harness is the occurrence AGENTS.md makes the trigger to extract** — so it lands here
 * with both consumers converted in the same PR.
 *
 * ## What an emitted-SQL proof does and does not prove
 *
 * It proves the **builder appended the conjunct** and bound the value. It says nothing about which
 * rows come back — only a real database with two households in it can say that, which is why the
 * picker's real proof is `db:verify`'s `householdProfileRows` matrix and this is the second vehicle.
 *
 * ## `rowsFor` is load-bearing, not a convenience
 *
 * The pool the first version of this returned `{ rows: [] }` for **every** query. Every scoped DAL
 * read now resolves `getHouseholdScope()` first, so zero rows meant *no live household*, the
 * function short-circuited, and the query under test **was never emitted** — `queries[0]` was the
 * households probe. A harness that answers per-SQL is what makes the proof execute at all.
 */
export type RecordedQuery = { text: string; values: unknown[] };

export type RecordingDb = {
  /** Every query the builder sent, in order. Mutate `length = 0` between cases. */
  queries: RecordedQuery[];
  /** The Drizzle client to pass where the app would use `db`. */
  db: ReturnType<typeof createDb>;
  /** The rows the pool answers a query with — keyed on the SQL text. */
  rowsFor: (sql: string) => unknown[][];
};

/** One live household, so a scoped DAL read gets past `getHouseholdScope()` and emits its query. */
export const ONE_HOUSEHOLD_ID = 4242;

/**
 * The default answer: one row for the households probe, nothing for anything else. The id is
 * arbitrary but FIXED, so a test can assert it appears in the scoped query's bound values — which is
 * the assertion that distinguishes "a household conjunct" from "the right household's conjunct".
 *
 * ⚠️ **Rows are ARRAYS, not objects.** drizzle's node-postgres session queries with
 * `rowMode: 'array'` and maps columns by position, so an object row yields `undefined` for every
 * field — which surfaced here as `household id must be a safe integer, got NaN` rather than as a
 * wrong value. The order is the order of the `.select({…})` under test.
 */
export function oneHouseholdThenEmpty(sql: string): unknown[][] {
  return /from "households"/.test(sql) ? [[ONE_HOUSEHOLD_ID]] : [];
}

export function createRecordingDb(
  rowsFor: (sql: string) => unknown[][] = oneHouseholdThenEmpty,
): RecordingDb {
  const queries: RecordedQuery[] = [];
  const pool = {
    // node-postgres is called as query(config) or query(config, params); record both shapes.
    query: async (q: { text: string; values?: unknown[] }, params?: unknown[]) => {
      queries.push({ text: q.text, values: params ?? q.values ?? [] });
      const rows = rowsFor(q.text);
      return { rows, rowCount: rows.length, fields: [] };
    },
  };
  return {
    queries,
    db: createDb(pool as unknown as Parameters<typeof createDb>[0]),
    rowsFor,
  };
}

/** The first recorded query whose text matches — never `queries[0]`, which is the households probe. */
export function queryMatching(rec: RecordingDb, pattern: RegExp): RecordedQuery {
  const found = rec.queries.find((q) => pattern.test(q.text));
  if (!found) {
    throw new Error(
      `no emitted query matched ${pattern}; got:\n${rec.queries.map((q) => q.text).join('\n---\n')}`,
    );
  }
  return found;
}

/** The `WHERE …` tail of a statement, lower-cased comparison but original text returned. */
export function whereOf(query: RecordedQuery): string {
  const at = query.text.toLowerCase().indexOf(' where ');
  if (at === -1) throw new Error(`emitted query has no WHERE clause: ${query.text}`);
  return query.text.slice(at);
}
