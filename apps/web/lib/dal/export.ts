import 'server-only';

import {
  bodyweightMonthRows,
  checkinMonthRows,
  foldStrengthMonth,
  resolvePrescribed,
  rolesNeedingLiveMatch,
  type HouseholdScope,
  loggedMonths,
  ownerScope,
  programDayRows,
  strengthMonthRows,
} from '@mat-plan/db';
import { dayRoleSchema } from '@mat-plan/shared';
import {
  bodyweightPath,
  type BodyweightRow,
  type CheckinsRow,
  buildBodyweight,
  buildCheckins,
  buildStrengthLog,
  buildZip,
  checkinsPath,
  strengthLogPath,
  type ZipEntry,
  liveMatchesByKey,
} from '@mat-plan/shared/csv';

import { db } from './db';
import { AUTHORITY_ACTION, getHouseholdScope, reportAuthorityRefusal } from './household';
import { getProfileByPublicId } from './profiles';

/**
 * Build the CSV export for one athlete (V1-13b).
 *
 * Ownership first: the profile is resolved by `public_id` — never a raw internal id from the request
 * — and everything below is scoped by it. `public_id` is also the `<athlete>` **path segment**, so
 * the directory is rename-proof by construction (Ray, 2026-09-24).
 *
 * **TEN-1 1c: the household scope is resolved ONCE, in `buildExportEntries`, and threaded down.** The
 * `getProfileByPublicId` call there already fails closed on a foreign id, so the four queries below are
 * *depth behind the gate* — which `docs/features/write-path.md` demands anyway (*"a guard that exists
 * only in the DAL is a guard no proof covers"*). It is threaded rather than re-resolved per query
 * because the export runs in a Route Handler, where `cache()` may not memoise: one resolve per export,
 * not one per month per file. The scope is an explicit parameter from here down — `lib/dal` is the only
 * layer allowed to hold it ambiently (invariant 8), and this module is that layer.
 */

/**
 * The FALLBACK half of the `prescribed` column: today's program, for rows that were never
 * snapshotted (V1-22 chunk 2).
 *
 * ⚠️ **This used to be the whole story and no longer is.** The value is frozen onto the entry at log
 * time; this runs only where `prescribed_snapshot IS NULL`, which after chunk 3's backfill means
 * almost nowhere. The rule — including the non-unique key and the empty-on-ambiguous behaviour —
 * lives in `packages/shared/src/csv/prescribed.ts`, which the log-time writer calls too, so the two
 * paths cannot answer differently. See `docs/features/write-path.md`.
 */
async function liveMatchesFor(
  profilePublicId: string,
  dayRoles: ReadonlySet<string>,
  scope: HouseholdScope,
) {
  // day role → (movement id → text, or null if that day programs the movement twice). Nested, so
  // the shared composer's output is consumed as-is rather than re-keyed into a string nobody needs.
  const byRole = new Map<string, ReadonlyMap<number, string | null>>();
  for (const role of dayRoles) {
    // ⚠️ The SAME narrowing the writer uses (`dayRoleSchema.safeParse`), not `.includes` + a cast.
    // These are the one pair of functions that must agree about what a day role is.
    const parsed = dayRoleSchema.safeParse(role);
    if (!parsed.success) continue;
    const rows = await programDayRows(db, { profilePublicId, dayRole: parsed.data, scope });
    // 🔴 The SAME function the log-time writer calls. The rendering and the ambiguity rule used to
    // live inline here, where `packages/db` could not reach them — so "the frozen path and the live
    // path agree" could only ever have been asserted by a test, and the test the plan specified was
    // unimplementable. Now it is one function with two callers.
    byRole.set(role, liveMatchesByKey(rows));
  }
  return byRole;
}

/**
 * Every CSV file for one athlete, as zip entries, or **`null` when this caller may not have them**.
 *
 * `null` is the refusal and `[]` means only "the owner, and no logged months", so the route answers
 * a refusal with its one miss and never sends an empty zip in place of one.
 *
 * 🔴 **Only the household's owner gets an export** (FAM-1 export follow-up, plan PR B; the
 * maintainer's Q1, 2026-11-19: _"otherwise refuse unless it's the owner"_). Any other login gets
 * `null` before any month query, with one id-free authority-refusal event. "An adult member exports
 * their own data" is `ID-1`'s, once a login can be linked to its own athlete. The SQL backstop is
 * `loggedMonths`' `isOwnerOf` (mutation 610).
 */
export async function buildExportEntries(profilePublicId: string): Promise<ZipEntry[] | null> {
  // The gate: a foreign (or unknown) id returns nothing before any month query runs. `getProfileByPublicId`
  // is itself household-scoped since TEN-1 1b, so a null scope also lands here.
  const profile = await getProfileByPublicId(profilePublicId);
  if (!profile) return null;
  const scope = await getHouseholdScope();
  if (!scope) return null;
  const owner = ownerScope(scope);
  if (!owner) {
    await reportAuthorityRefusal(AUTHORITY_ACTION.exportProfile);
    return null;
  }

  const months = (await loggedMonths(db, { profilePublicId, scope: owner })).map((r) => r.month);
  const entries: ZipEntry[] = [];

  for (const month of months) {
    // The fold lives beside the query (FAM-1 14a), so `db:verify` proves the same function this runs.
    const strengthRows = foldStrengthMonth(
      await strengthMonthRows(db, { profilePublicId, month, scope }),
    );

    // 🔴 Only the rows with NO snapshot need the live program read. `IS NULL`, never
    // `coalesce(…,'') = ''`: `''` is a REAL frozen value (an `open()` prescription, 11 of the 13
    // seeded) and must NOT be re-derived from today's program, or every such row goes on moving
    // under the reader exactly as it did before this chunk.
    const roles = rolesNeedingLiveMatch(strengthRows);
    const live = roles.size > 0 ? await liveMatchesFor(profilePublicId, roles, scope) : null;
    for (const row of strengthRows) {
      row.prescribed = resolvePrescribed(row, live);
    }

    const bodyweightRows: BodyweightRow[] = (
      await bodyweightMonthRows(db, { profilePublicId, month, scope })
    ).map((r) => ({
      date: r.date,
      weight: r.value ?? '',
      unit: r.unit,
      // `context` is `morning` on 100% of real rows and the app can NEVER write it —
      // `logBodyweightSchema` has no such field. A known regression of a populated column.
      context: r.context ?? '',
      notes: r.notes ?? '',
    }));

    // FAM-1 14b: every logged check-in. Fields are mapped one by one, so the read's `entryId` (for the
    // proof only) never reaches a row.
    const checkinRows: CheckinsRow[] = (
      await checkinMonthRows(db, { profilePublicId, month, scope })
    ).map((r) => ({
      date: r.date,
      activity: r.activity,
      metric: r.metric,
      valueNum: r.valueNum,
      valueText: r.valueText,
      unit: r.unit,
      notes: r.notes,
    }));

    entries.push(
      { path: strengthLogPath(profilePublicId, month), content: buildStrengthLog(strengthRows) },
      { path: bodyweightPath(profilePublicId, month), content: buildBodyweight(bodyweightRows) },
      // A month with no check-ins still writes the header, so every month's zip holds the same files
      // (an export is only ever the owner's, so there is one shape).
      { path: checkinsPath(profilePublicId, month), content: buildCheckins(checkinRows) },
    );
  }

  return entries;
}

/**
 * The whole export as a zip, or `null` (the refusal, above). Deterministic: re-exporting the same data
 * is byte-identical.
 */
export async function buildExportZip(profilePublicId: string): Promise<Uint8Array | null> {
  const entries = await buildExportEntries(profilePublicId);
  return entries === null ? null : buildZip(entries);
}
