import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { NodePgDatabase, NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgTransaction } from 'drizzle-orm/pg-core';

import type { Schema } from '../client';

/**
 * A db handle or an open transaction — both satisfy the query-builder surface the writers use.
 *
 * Lifted out of `strength-session.ts` (V1-24 PR 1b) when `ownership.ts` needed it: a shared
 * *ownership* helper importing from the *strength* writer would invert the dependency, since
 * ownership is the lower-level concern. Type-only, so it adds no runtime edge.
 */
export type Executor =
  | NodePgDatabase<Schema>
  | PgTransaction<NodePgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;
