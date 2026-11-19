import {
  databaseNameOf,
  hasHostOverride,
  isLocalDbHost,
  namesPreviewDatabase,
} from '@mat-plan/shared';

/**
 * The gates of the fresh start's one-shot erasure (CAT-3 R0; plan
 * `docs/plans/priv-3-fresh-start-prep.md`, D1). Pure, so every branch is unit-tested here
 * (`erasure-gates.test.ts`) rather than only through a database.
 *
 * 🔴 **There is no positive test for production**: its database is named `mat_plan`, like a local
 * one. So the gate refuses everything it CAN recognise as not production, before connecting (the URL)
 * and again on the connection that writes (`current_database()`).
 */

/**
 * The total the dry run printed, which `--apply` must be given back. A number with no personal data.
 * It ties an apply to THIS sitting's dry run: a bare `--apply`, or one with an earlier sitting's
 * number, refuses.
 */
export const EXPECT_ERASED_ROWS = 'EXPECT_ERASED_ROWS';

/**
 * Why the one-shot erasure must not run against this target, or `null` when it may.
 *
 * - `url`: the target from `correctionTargetUrl({ kind: 'erasure' })` (the direct string only).
 * - `observed`: `current_database()` on the connection that writes, or `null` before connecting.
 *
 * Every message is fixed text: no part of the URL, which holds a password, is ever echoed.
 */
export function seededHouseholdErasureIssue(
  url: string | undefined,
  observed: string | null,
): string | null {
  if (url === undefined || url === '') {
    return 'DATABASE_URL_UNPOOLED is not set: this erasure reads the direct string only; nothing erased';
  }
  if (hasHostOverride(url)) {
    return 'the target URL carries a host override (host= or hostaddr=); nothing erased';
  }
  if (isLocalDbHost(url)) {
    return 'the target is a local database: this erasure runs against production only; nothing erased';
  }
  const named = databaseNameOf(url);
  if (named === null) {
    return 'the target URL names no database, so which one would be written is unknown; nothing erased';
  }
  if (namesPreviewDatabase(named)) {
    return 'the target is the preview database: this erasure runs against production only; nothing erased';
  }
  if (observed !== null) {
    if (namesPreviewDatabase(observed)) {
      return 'the connected database is the preview: this erasure runs against production only; nothing erased';
    }
    if (observed !== named) {
      return 'the connected database is not the one the URL names; nothing erased';
    }
  }
  return null;
}

/**
 * `EXPECT_ERASED_ROWS` parsed: a whole number of rows (0 or more), or `null` when it is unset or not
 * one. `null` refuses before the core is called.
 */
export function parseExpectedRows(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d{1,9}$/.test(raw.trim())) return null;
  return Number(raw.trim());
}
