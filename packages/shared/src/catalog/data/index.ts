import type { CatalogMovement } from '../entry';

import { CATALOG_BATCH_01 } from './batch-01';
import { CATALOG_BATCH_02 } from './batch-02';
import { CATALOG_BATCH_03 } from './batch-03';
import { CATALOG_BATCH_04 } from './batch-04';
import { CATALOG_BATCH_05 } from './batch-05';
import { CATALOG_BATCH_07 } from './batch-07';
import { CATALOG_BATCH_08 } from './batch-08';
import { CATALOG_BATCH_09 } from './batch-09';
import { CATALOG_BATCH_10 } from './batch-10';
import { CATALOG_BATCH_11 } from './batch-11';

/**
 * The movement library ([spec](../../../../../docs/specs/cat-3-movement-library.md), rule 3): the
 * source of truth for a catalog row's content. One `batch-NN.ts` per reviewed batch, concatenated here in batch order.
 *
 * 🔴 **Every entry here was reviewed by the maintainer, in a batch** (decision K9), and the library
 * is authored and reviewed in-house (K16). An entry, and any later edit to one, needs its line in
 * `./approved.json`; its slug and tracking type need their line in `./shipped.json`
 * (`../approvals.test.ts`). A batch PR merges only once every row of its review reads "lgtm".
 *
 * ⚠️ **Import this through `@mat-plan/shared/catalog/data`, never the root barrel**: it grows to
 * hundreds of entries and must not reach a client bundle (`../catalog.test.ts`).
 *
 * Literal exports only (spec D2).
 */
export const CATALOG_MOVEMENTS: readonly CatalogMovement[] = [
  ...CATALOG_BATCH_01,
  ...CATALOG_BATCH_02,
  ...CATALOG_BATCH_03,
  ...CATALOG_BATCH_04,
  ...CATALOG_BATCH_05,
  ...CATALOG_BATCH_07,
  ...CATALOG_BATCH_08,
  ...CATALOG_BATCH_09,
  ...CATALOG_BATCH_10,
  ...CATALOG_BATCH_11,
];

/** The slug of every entry: what a lookup by slug (an alias, a supervision label) reads. */
export const CATALOG_SLUGS: ReadonlySet<string> = new Set(CATALOG_MOVEMENTS.map((m) => m.slug));
