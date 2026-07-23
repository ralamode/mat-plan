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

/** Log status — shared by entries and entry_sets. */
export const ENTRY_STATUSES = ['done', 'skipped', 'sub_failure'] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];
export const entryStatusSchema = z.enum(ENTRY_STATUSES);
export const ENTRY_STATUS = keyBySelf(ENTRY_STATUSES);
