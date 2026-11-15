/**
 * FAM-1's contract (chunk 0a): the shapes the builder, the day page, their writers and their
 * queries agree on ([plan §4](../../../../docs/plans/fam-1-family-program.md)).
 *
 * Two parts of the contract are deliberately NOT exported from here, because this file is in the
 * root barrel that `'use client'` components import:
 *
 * - `prescribedText` is the `@mat-plan/shared/program/prescribed-text` subpath. It builds on the
 *   CSV's renderer, and `csv/` is kept out of the barrel on purpose.
 * - The named fixtures are the `@mat-plan/shared/program/fixtures` subpath: preview and test data.
 */
export * from './pieces';
export * from './program-shapes';
export * from './day-shapes';
export * from './actions';
