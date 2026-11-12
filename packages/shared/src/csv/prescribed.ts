import type { PrescriptionSeedRow, PrescriptionTargetSeedRow } from '../programming';

/**
 * The `prescribed` CSV column: ONE renderer, ONE live-match composer, three callers (V1-22 chunk 2).
 *
 * The contract and the reasoning are `docs/plans/v1-22-2-renderer-and-writer.md`. ⚠️ Read its
 * **§ Decisions** first — the maintainer's D1 reshaped this chunk after the panel, and the sections
 * above it in that document describe the superseded design.
 *
 * ## Why both functions live here, in `packages/shared/src/csv/`
 *
 * Three callers, and the home has to serve all of them:
 *
 * 1. the log-time writer — `packages/db/src/writers/prescribed-snapshot.ts`;
 * 2. the backfill correction — `packages/db/scripts/corrections/` (chunk 3);
 * 3. the export fallback — `apps/web/lib/dal/export.ts`.
 *
 * (2) **cannot import the `server-only` DAL** and cannot cross the app→packages edge at all — the
 * same constraint that put the strength write core in `packages/db`.
 *
 * The **`csv/` subpath**, not the root barrel, for the reason `csv/index.ts` already gives: the
 * barrel is an `export *` that `'use client'` components import, and CSV formatting has no business
 * in a client bundle.
 *
 * 🔴 **`liveMatchesByKey` is here, and not left inline in the export, because that is what makes
 * acceptance 11 TRUE rather than asserted.** The writer and the export must answer "what was
 * prescribed" identically; while the export's composer was a private `async` function inside a
 * `server-only` module, `packages/db` could not call it, and the planned "feed one fixture through
 * both paths" test was unimplementable — it could only have compared this file's renderer to
 * itself. Three review lenses reached that conclusion independently. One function, two callers.
 */

/**
 * The four authored values the column is composed from, DERIVED from the two seed row schemas so a
 * nullability change there cannot leave this renderer claiming a shape the tables no longer have.
 * Type-only import, so this subpath pulls in no runtime code from `programming.ts`.
 */
export type PrescribedParts = Pick<PrescriptionSeedRow, 'sets' | 'targetReps'> &
  Pick<PrescriptionTargetSeedRow, 'load' | 'reps'>;

/**
 * The per-kid reps override WINS over the prescription's shared `target_reps`.
 *
 * ⚠️ **Returns `string | null`, NOT `''`.** The two READ callers want different empties: the CSV
 * renderer wants `''` to concatenate, and `ProgramDayDTO.targetReps` is `string | null` and is
 * null-checked by the day card's own formatter. Coalescing here would quietly change the DTO's
 * contract to share a one-line helper — so the shared thing is the PRECEDENCE, which is the part
 * that must not drift, and each caller keeps its own empty.
 *
 * ⚠️ **READ path only.** The spec is explicit that this collapse is **not** reusable on the EDIT
 * path: reusing it there would write one athlete's override into the shared field for every
 * sibling. Chunk 4 must not reach for this.
 */
export function effectiveReps(p: Pick<PrescribedParts, 'reps' | 'targetReps'>): string | null {
  return p.reps ?? p.targetReps;
}

/**
 * `SETSxREPS [@ load]` — the plan as one human string, per `docs/csv-export-contract.md`.
 *
 * ⚠️ **Hoisted VERBATIM from `export.ts`, truthiness included.** `p.sets ?` (not `p.sets != null`)
 * and `p.load ?` are kept exactly as the inline composer wrote them, because this renders bytes that
 * already exist in every exported month. `sets = 0` is unreachable (`prescriptions_sets_check`) and
 * `load = ''` is authored-empty, so changing either to a null check would be a silent byte change on
 * an edge the type permits but the data does not. Both are pinned by a test, so a future "cleanup"
 * fails instead of rewriting history.
 *
 * 🔴 **An `open()` prescription renders `''` — the DOMINANT shape, 11 of the 13 seeded.** `''` is a
 * real value here and must survive storage as `''`; it is NOT the same as "no prescription", which
 * is NULL. Every truthiness guard between this function and the column is a bug that silently
 * collapses eleven of thirteen rows (see `prescribedSnapshotsFor`, and `db:verify`'s `''` case).
 */
export function formatPrescribedForExport(p: PrescribedParts): string {
  const reps = effectiveReps(p) ?? '';
  return [p.sets ? `${p.sets}x${reps}` : reps, p.load ? `@ ${p.load}` : '']
    .filter(Boolean)
    .join(' ');
}

/** What `liveMatchesByKey` needs off a program row: the parts, plus which movement they name. */
export type PrescribedRowForMatch = PrescribedParts & { movementId: number };

/**
 * One day role's program, folded to `movementId → rendered string`, with the ambiguity rule.
 *
 * 🔴 **An ambiguous match renders `''`, never an arbitrary pick.** The same movement can legitimately
 * appear twice in one day — warm-up and working sets of the same lift — and the column's whole
 * purpose is being *not* reconciled with actuals, so a wrong plan is worse than no plan. That rule
 * came from `export.ts` and had **no test at all** until this function existed to be called directly.
 *
 * ⚠️ **Keyed on `movement_id`, not on the slug the export used to key on** (D1). The writer has the
 * resolved internal id in hand, and a slug compare is only ever a proxy for "the row the entry's
 * `movement_id` names" — a proxy `MOV-1`'s rename breaks, since a rename changes a slug.
 * ✅ **Nothing is pending here.** This comment used to say a `PICK-1` invariant "schedules a later PR
 * to replace" the proxy; chunk 2 keyed BOTH sides on `movement_id` when it shipped, so there is no
 * proxy left and no later PR owes the switch — `movement-picker.md` invariant 7 records it closed
 * (retired by `PICK-1` PR 3). Byte-identical today because movement resolution is global-first, so a
 * typed name lands on the same global row a prescription names; the export's determinism test is
 * what proves that rather than this comment.
 */
export function liveMatchesByKey(
  rows: readonly PrescribedRowForMatch[],
): Map<number, string | null> {
  const byMovement = new Map<number, string | null>();
  const seen = new Map<number, number>();
  for (const p of rows) {
    const count = (seen.get(p.movementId) ?? 0) + 1;
    seen.set(p.movementId, count);
    byMovement.set(p.movementId, count > 1 ? null : formatPrescribedForExport(p));
  }
  return byMovement;
}
