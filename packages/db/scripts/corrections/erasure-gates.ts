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
 * ⚠️ **It makes `--apply` restate the CURRENT total, which is not a binding to one dry run**: a bare
 * `--apply` refuses, and so does an earlier number once the count has changed since, but a stale
 * number that still equals the count passes (security lens, #708). It is a "type back the size"
 * confirmation, run inside the transaction that writes.
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
  const hostIssue = hostIssueOf(url);
  if (hostIssue) return hostIssue;
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
 * Hosts that mean "this machine" however they are spelled. A `postgres:` URL is a non-special scheme,
 * so `URL` does not normalise its host: `LOCALHOST`, `127.1`, `localhost.` and `%6cocalhost` all reach
 * `pg` as loopback while reading as remote (security lens, #708).
 */
function looksLocal(host: string): boolean {
  let h: string;
  try {
    h = decodeURIComponent(host).toLowerCase().replace(/\.$/, '');
  } catch {
    return true; // undecodable: refuse
  }
  h = h.replace(/^\[|\]$/g, '');
  return (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h === '0.0.0.0' ||
    h === '::1' ||
    /^127(\.\d+){0,3}$/.test(h) ||
    /^::ffff:(127\.|7f[0-9a-f]{2}:)/.test(h)
  );
}

/**
 * The host must be a named, remote host in a `postgres:` URL. An EMPTY host lets `$PGHOST` (or a local
 * socket) decide, and a host that decodes to a path (`%2Ftmp`) IS a unix socket: either way the URL
 * does not say which server is written, which is the same case as a URL with no database name.
 */
function hostIssueOf(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'the target URL cannot be parsed; nothing erased';
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    return 'the target URL is not a postgres:// URL; nothing erased';
  }
  if (parsed.hostname === '') {
    return 'the target URL names no host, so the environment would choose the server; nothing erased';
  }
  let decoded = parsed.hostname;
  try {
    decoded = decodeURIComponent(parsed.hostname);
  } catch {
    return "the target URL's host cannot be decoded; nothing erased";
  }
  if (decoded.includes('/')) {
    return "the target URL's host is a unix socket path; nothing erased";
  }
  if (looksLocal(parsed.hostname)) {
    return 'the target is a local database: this erasure runs against production only; nothing erased';
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
