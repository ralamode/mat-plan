/**
 * CSV export (V1-13) — the format layer, pure and DB-free.
 *
 * Exported as the **`@mat-plan/shared/csv` subpath, deliberately NOT added to the root barrel**:
 * `index.ts` is an `export *` that 8 `'use client'` components import, and CSV formatting has no
 * business in a client bundle.
 *
 * Contract: docs/csv-export-contract.md (authoritative). Plan: docs/plans/v1-13-csv-export.md.
 */
export * from './aggregate';
export * from './columns';
export * from './load';
export * from './row';
export * from './strength-log';
export * from './value';
