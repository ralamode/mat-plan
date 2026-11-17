/**
 * CAT-3's contract, chunk C0a ([spec](../../../../docs/specs/cat-3-movement-library.md)): the
 * vocabularies and the shape of one library entry. Client-safe.
 *
 * Not exported here, on purpose: the library itself (`@mat-plan/shared/catalog/data`, hundreds of
 * entries, server only) and the test library (`@mat-plan/shared/catalog/fixture`).
 */
export * from './vocabulary';
export * from './entry';
export * from './option';
export * from './families';
