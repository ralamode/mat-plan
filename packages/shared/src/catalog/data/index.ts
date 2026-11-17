import type { CatalogMovement } from '../entry';

/**
 * The movement library ([spec](../../../../../docs/specs/cat-3-movement-library.md), rule 3): the
 * source of truth for a catalog row's content. **Empty until the first reviewed batch.**
 *
 * 🔴 **Every entry here was reviewed by the maintainer, in a batch** (decision K9), and the library
 * is authored and reviewed in-house (K16). An entry, and any later edit to one, needs its line in
 * `./approved.json`; its slug and tracking type need their line in `./shipped.json`
 * (`../approvals.test.ts`). A batch PR is merged by the maintainer.
 *
 * ⚠️ **Import this through `@mat-plan/shared/catalog/data`, never the root barrel**: it grows to
 * hundreds of entries and must not reach a client bundle (`../catalog.test.ts`).
 *
 * Literal exports only (spec D2).
 */
export const CATALOG_MOVEMENTS: readonly CatalogMovement[] = [];

/** The slug of every entry: what a lookup by slug (an alias, a supervision label) reads. */
export const CATALOG_SLUGS: ReadonlySet<string> = new Set(CATALOG_MOVEMENTS.map((m) => m.slug));
