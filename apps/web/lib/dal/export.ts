import 'server-only';

import {
  bodyweightMonthRows,
  type HouseholdScope,
  loggedMonths,
  programDayRows,
  strengthMonthRows,
} from '@mat-plan/db';
import { type DayRole, DAY_ROLES } from '@mat-plan/shared';
import {
  bodyweightPath,
  type BodyweightRow,
  buildBodyweight,
  buildCheckins,
  buildStrengthLog,
  buildZip,
  checkinsPath,
  type StrengthLogRow,
  strengthLogPath,
  type ZipEntry,
  liveMatchesByKey,
} from '@mat-plan/shared/csv';

import {
  prescribedKey,
  resolvePrescribed,
  rolesNeedingLiveMatch,
} from '../programming/prescribed-snapshot';
import { db } from './db';
import { getHouseholdScope } from './household';
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
 * A folded row plus the two values the `prescribed` resolution needs and the CSV does NOT emit.
 *
 * ⚠️ They are kept OFF `StrengthLogRow`, which is the byte contract for the file: a resolution input
 * is not a column, and widening the contract type to carry one is how a column appears by accident.
 */
type FoldedStrengthRow = StrengthLogRow & {
  /** `null` = never snapshotted; `''` = a real frozen rendering. The distinction is load-bearing. */
  prescribedSnapshot: string | null;
  /**
   * Nullable because `entries.movement_id` is — the tagged union lets an entry name a metric
   * instead. This query inner-joins `movements`, so a strength row always has one; typed honestly
   * rather than asserted, and a null simply misses the live map and falls through to `''`.
   */
  movementId: number | null;
};

/** Fold the flat (entry × set × quantity) join into one row per movement. */
function foldStrengthRows(
  rows: Awaited<ReturnType<typeof strengthMonthRows>>,
): FoldedStrengthRow[] {
  const byEntry = new Map<number, FoldedStrengthRow>();
  // Set identity is the SET ROW, not its index — a partial skip leaves gaps in `idx`.
  const setsByEntry = new Map<number, Map<number, StrengthLogRow['sets'][number]>>();

  for (const r of rows) {
    if (!byEntry.has(r.entryId)) {
      byEntry.set(r.entryId, {
        date: r.date,
        dayRole: r.dayRole,
        sessionType: r.sessionType,
        movementSlug: r.movementSlug,
        movementId: r.movementId,
        prescribedSnapshot: r.prescribedSnapshot,
        status: r.entryStatus,
        sets: [],
        prescribed: '',
        notes: r.notes ?? '',
      });
      setsByEntry.set(r.entryId, new Map());
    }
    if (r.setId === null) continue; // a skipped movement: zero set rows, by design

    const sets = setsByEntry.get(r.entryId)!;
    if (!sets.has(r.setId)) {
      sets.set(r.setId, {
        reps: r.reps,
        // `?? false` because these arrive through a LEFT JOIN — null means "no set row", which the
        // `r.setId === null` guard above already skipped, so this is a type narrowing, not a default.
        isBodyweight: r.isBodyweight ?? false,
        isBand: r.isBand ?? false,
        quantities: [],
        status: r.setStatus ?? '',
      });
    }
    if (r.slot !== null && r.unit !== null && r.valueNum !== null) {
      const set = sets.get(r.setId)!;
      (set.quantities as ExportQuantityMutable[]).push({
        slot: r.slot as never,
        unit: r.unit as never,
        value: r.valueNum,
      });
    }
  }

  for (const [entryId, entry] of byEntry) {
    entry.sets = [...setsByEntry.get(entryId)!.values()];
  }
  // Map preserves insertion order, which is the query's ORDER BY — so the contract's row order
  // survives the fold without a second sort.
  return [...byEntry.values()];
}

type ExportQuantityMutable = StrengthLogRow['sets'][number]['quantities'][number];

/**
 * Reconstruct the `prescribed` column.
 *
 * There is **no `entries.prescription_id`** (GAP-1 P1-2 is unbuilt), so the plan is matched back by
 * `(day_role, movement)` at export time rather than stored at log time.
 *
 * ⚠️ **That key is documented NON-UNIQUE** — `schema.ts`: *"a movement may legitimately appear twice
 * in a day — warm-up + working — so the key is NOT movement_id."* On an ambiguous match this emits
 * **empty**, never an arbitrary pick: the column's entire purpose is being *not* reconciled with
 * actuals, so a wrong plan is worse than no plan.
 *
 * ⚠️ **It reads TODAY's program, not the program as it was.** Safe while prescriptions are
 * seed-immutable; **V1-22 breaks it**, and that is recorded on the V1-22 row as a blocker it must
 * solve.
 */
async function liveMatchesFor(
  profilePublicId: string,
  dayRoles: ReadonlySet<string>,
  scope: HouseholdScope,
) {
  // `${dayRole}:${movementId}` → text, or null if that day programs the movement twice.
  const byKey = new Map<string, string | null>();
  for (const role of dayRoles) {
    if (!(DAY_ROLES as readonly string[]).includes(role)) continue;
    const rows = await programDayRows(db, { profilePublicId, dayRole: role as DayRole, scope });
    // 🔴 The SAME function the log-time writer calls. The rendering and the ambiguity rule used to
    // live inline here, where `packages/db` could not reach them — so "the frozen path and the live
    // path agree" could only ever have been asserted by a test, and the test the plan specified was
    // unimplementable. Now it is one function with two callers.
    for (const [movementId, text] of liveMatchesByKey(rows)) {
      byKey.set(prescribedKey(role, movementId), text);
    }
  }
  return byKey;
}

/** Every CSV file for one athlete, as zip entries. */
export async function buildExportEntries(profilePublicId: string): Promise<ZipEntry[]> {
  // The gate: a foreign (or unknown) id returns nothing before any month query runs. `getProfileByPublicId`
  // is itself household-scoped since TEN-1 1b, so a null scope also lands here.
  const profile = await getProfileByPublicId(profilePublicId);
  if (!profile) return [];
  const scope = await getHouseholdScope();
  if (!scope) return [];

  const months = (await loggedMonths(db, { profilePublicId, scope })).map((r) => r.month);
  const entries: ZipEntry[] = [];

  for (const month of months) {
    const strengthRows = foldStrengthRows(
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

    entries.push(
      { path: strengthLogPath(profilePublicId, month), content: buildStrengthLog(strengthRows) },
      { path: bodyweightPath(profilePublicId, month), content: buildBodyweight(bodyweightRows) },
      // Header-only, always: the real files have never carried a row, and a MISSING file and an
      // EMPTY file are different inputs to the workflow.
      { path: checkinsPath(profilePublicId, month), content: buildCheckins([]) },
    );
  }

  return entries;
}

/** The whole export as a zip. Deterministic: re-exporting the same data is byte-identical. */
export async function buildExportZip(profilePublicId: string): Promise<Uint8Array> {
  return buildZip(await buildExportEntries(profilePublicId));
}
