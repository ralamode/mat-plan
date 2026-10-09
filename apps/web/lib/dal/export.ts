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
} from '@mat-plan/shared/csv';

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

/** Fold the flat (entry × set × quantity) join into one row per movement. */
function foldStrengthRows(rows: Awaited<ReturnType<typeof strengthMonthRows>>): StrengthLogRow[] {
  const byEntry = new Map<number, StrengthLogRow>();
  // Set identity is the SET ROW, not its index — a partial skip leaves gaps in `idx`.
  const setsByEntry = new Map<number, Map<number, StrengthLogRow['sets'][number]>>();

  for (const r of rows) {
    if (!byEntry.has(r.entryId)) {
      byEntry.set(r.entryId, {
        date: r.date,
        dayRole: r.dayRole,
        sessionType: r.sessionType,
        movementSlug: r.movementSlug,
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
async function prescribedFor(
  profilePublicId: string,
  dayRoles: ReadonlySet<string>,
  scope: HouseholdScope,
) {
  const byKey = new Map<string, string | null>(); // `${dayRole}:${slug}` → text, or null if ambiguous
  for (const role of dayRoles) {
    if (!(DAY_ROLES as readonly string[]).includes(role)) continue;
    const rows = await programDayRows(db, { profilePublicId, dayRole: role as DayRole, scope });
    const seen = new Map<string, number>();
    for (const p of rows) {
      const key = `${role}:${p.movementSlug}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
      // `sets x reps [@ load]` — the plan as one human string, per the contract.
      const reps = p.reps ?? p.targetReps ?? '';
      const text = [p.sets ? `${p.sets}x${reps}` : reps, p.load ? `@ ${p.load}` : '']
        .filter(Boolean)
        .join(' ');
      byKey.set(key, seen.get(key)! > 1 ? null : text);
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

    const roles = new Set(
      strengthRows.map((r) => r.dayRole).filter((r): r is string => r !== null),
    );
    const prescribed = await prescribedFor(profilePublicId, roles, scope);
    for (const row of strengthRows) {
      const key = `${row.dayRole}:${row.movementSlug}`;
      row.prescribed = prescribed.get(key) ?? '';
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
