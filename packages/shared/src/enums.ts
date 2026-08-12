import { z } from 'zod';

/**
 * Small domain enums stored as text + CHECK (per AGENTS.md: `status`-style enums
 * are text+CHECK, not reference tables). Defined once here so the zod validators
 * and TS types stay in sync; the DB CHECK constraints mirror these literal lists
 * (a coverage test asserting the match lands with the catalogs at V1-2).
 */

/**
 * Keyed lookup for an `as const` value list, derived from the list itself so the
 * literals live in exactly one place. Lets app code compare/branch on a NAMED
 * member (`ENTRY_KIND.bodyweight`) instead of a bare string (constants convention).
 */
export function keyBySelf<const T extends readonly string[]>(
  values: T,
): { readonly [K in T[number]]: K } {
  return Object.fromEntries(values.map((v) => [v, v])) as { readonly [K in T[number]]: K };
}

/** Profile kind — a kid or the adult (Ray). */
export const PROFILE_KINDS = ['kid', 'adult'] as const;
export type ProfileKind = (typeof PROFILE_KINDS)[number];
export const profileKindSchema = z.enum(PROFILE_KINDS);
export const PROFILE_KIND = keyBySelf(PROFILE_KINDS);

/** v0 entry discriminator — the thin-slice stand-in for the activity_type catalog (V1-1). */
export const ENTRY_KINDS = ['bodyweight', 'strength'] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];
export const entryKindSchema = z.enum(ENTRY_KINDS);
export const ENTRY_KIND = keyBySelf(ENTRY_KINDS);

/** Log status — the full vocabulary the DB CHECKs allow on entries, entry_sets and sessions. */
export const ENTRY_STATUSES = ['done', 'skipped', 'sub_failure'] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];
export const entryStatusSchema = z.enum(ENTRY_STATUSES);
export const ENTRY_STATUS = keyBySelf(ENTRY_STATUSES);

/**
 * The statuses a MOVEMENT (`entries` row) may carry (GAP-1 P1-1a).
 *
 * Narrower than `ENTRY_STATUSES` on purpose. The criterion, which also settles the set-level
 * vocabulary: **a status belongs on the entry only if it can be true when there are zero sets.**
 * `skipped` can — nothing was attempted. `sub_failure` cannot: it is an observation about an
 * attempt, and an attempt IS a set row, so it lives on `entry_sets` (P1-1b).
 *
 * Constrained HERE and not in the DB CHECK deliberately: all three CHECKs already permit all three
 * values, and widening a CHECK is cheap while narrowing one is a migration. The boundary is the
 * cheap place to be strict. Corollary: do NOT add an `assertCheckCoversConst` for this list — the
 * CHECK is intentionally the wider net, so a coverage assertion would fail by design.
 *
 * Built from `ENTRY_STATUS` members rather than re-typed literals, so renaming or removing a status
 * is a compile error here rather than silent drift (AGENTS.md constants convention).
 */
export const MOVEMENT_STATUSES = [ENTRY_STATUS.done, ENTRY_STATUS.skipped] as const;
export type MovementStatus = (typeof MOVEMENT_STATUSES)[number];
export const movementStatusSchema = z.enum(MOVEMENT_STATUSES);
export const MOVEMENT_STATUS = keyBySelf(MOVEMENT_STATUSES);

/**
 * The statuses a SET (`entry_sets` row) may carry (GAP-1 P1-1b) — the other half of the split above.
 *
 * `sub_failure` means "went to failure short of the prescribed reps". It is an observation about ONE
 * attempt, which is why it lives here and not on the entry: by the same criterion, it cannot be true
 * with zero sets (no attempt means no failed attempt — that is `skipped`).
 *
 * `skipped` is deliberately EXCLUDED. A skipped SET row is never written, and pinning that now is
 * free: the CSV export derives `sets` from `COUNT(entry_sets)`, so a skipped set row would silently
 * over-count and force a `WHERE status <> 'skipped'` nobody would remember to add. A movement that
 * did not happen carries zero set rows (P1-1a), not a placeholder.
 *
 * `satisfies readonly EntryStatus[]` makes the subset relationship a COMPILE-TIME proof against
 * `ENTRY_STATUSES` — a typo or a removed member fails the build here.
 */
export const SET_STATUSES = [
  ENTRY_STATUS.done,
  ENTRY_STATUS.sub_failure,
] as const satisfies readonly EntryStatus[];
export type SetStatus = (typeof SET_STATUSES)[number];
export const setStatusSchema = z.enum(SET_STATUSES);
export const SET_STATUS = keyBySelf(SET_STATUSES);
