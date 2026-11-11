/**
 * Resolving the `prescribed` CSV cell: frozen value first, live program only as a fallback
 * (V1-22 chunk 2).
 *
 * 🔴 **Pure, and in its own module, so the one line that matters can be TESTED.** The resolution
 * lived inline in `lib/dal/export.ts`, which is `server-only` and async and needs a database —
 * meaning the single most dangerous expression in this chunk had no unit-level pin at all. A probe
 * found that out: `||` in place of `??` is harmless at the writer, and catastrophic here, and
 * nothing could tell the two apart until this function existed.
 */

/** One folded export row, reduced to what the resolution actually reads. */
export type PrescribedResolutionRow = {
  /** `null` = never snapshotted. `''` = a real frozen rendering of an open prescription. */
  prescribedSnapshot: string | null;
  dayRole: string | null;
  movementId: number | null;
};

/** The live map's key. One definition, so its writer and its reader cannot drift. */
export function prescribedKey(dayRole: string | null, movementId: number | null): string {
  return `${dayRole}:${movementId}`;
}

/**
 * 🔴 **`??`, never `||`.** They differ on exactly the dominant shape: an `open()` prescription
 * freezes as `''` — 11 of the 13 seeded — and `||` sends every one of those rows back to today's
 * program, which is the entire defect this chunk exists to close. It would also be invisible in an
 * end-to-end test, because a re-derived row emits the same bytes until something edits the program.
 *
 * `''` is an ANSWER ("we recorded that nothing specific was asked"), not a missing value.
 */
export function resolvePrescribed(
  row: PrescribedResolutionRow,
  live: ReadonlyMap<string, string | null> | null,
): string {
  return row.prescribedSnapshot ?? live?.get(prescribedKey(row.dayRole, row.movementId)) ?? '';
}

/**
 * Which day roles still need the live program read — only those with NULL snapshots.
 *
 * Returning an empty set is what lets the export skip the query entirely once every row is frozen,
 * which is the steady state after chunk 3's backfill.
 */
export function rolesNeedingLiveMatch(rows: readonly PrescribedResolutionRow[]): Set<string> {
  const roles = new Set<string>();
  for (const r of rows) {
    // ⚠️ `=== null`, not `!r.prescribedSnapshot`: a frozen `''` needs no live read, and treating it
    // as if it did is the same defect as `||` above, one layer up.
    if (r.prescribedSnapshot === null && r.dayRole !== null) roles.add(r.dayRole);
  }
  return roles;
}
