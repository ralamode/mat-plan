import { z } from 'zod';

/**
 * `movement.pattern` — the movement-pattern taxonomy used to group lifts (spec.md §4).
 * Text + CHECK (a structural enum, not a reference table). One list; the DB CHECK on
 * `movements` mirrors these literals (coverage test with the catalogs at V1-2).
 */
export const MOVEMENT_PATTERNS = [
  'squat',
  'hinge',
  'horizontal_push',
  'vertical_push',
  'horizontal_pull',
  'vertical_pull',
  'lunge',
  'jump',
  'core',
  'carry',
  'isolation',
] as const;

export type MovementPattern = (typeof MOVEMENT_PATTERNS)[number];

export const movementPatternSchema = z.enum(MOVEMENT_PATTERNS);

/**
 * Derive a `movements.slug` from a free-text movement name — the v0→v1 bridge
 * (the v0 strength form submits a free-text name; the movement picker is V1-8).
 * ONE definition so the DAL's find-or-create and the V1-1b migration backfill
 * produce the SAME slug (AGENTS.md constants convention — reuse small logic too).
 * The migration's SQL mirrors this exactly:
 *   `lower(regexp_replace(btrim(name), '\s+', '_', 'g'))`.
 */
export function movementSlug(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '_');
}
