/**
 * FAM-1's contract (chunk 0a): the shapes the builder, the day page, their writers and their
 * queries agree on, and the one renderer for prescribed text
 * ([plan §4](../../../../docs/plans/fam-1-family-program.md)).
 *
 * The named fixtures are deliberately NOT exported from here: they are the
 * `@mat-plan/shared/program/fixtures` subpath, so preview and test data stay out of the root barrel
 * that `'use client'` components import (the same reason `csv/` is a subpath).
 */
export * from './pieces';
export * from './program-shapes';
export * from './day-shapes';
export * from './actions';
export * from './prescribed-text';
