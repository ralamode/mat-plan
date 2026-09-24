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

/**
 * A profile's stable **path segment** — the `<athlete>` directory in the CSV export's
 * `data/<type>/<athlete>/<YYYY-MM>.csv` layout (V1-13).
 *
 * KEBAB, not the underscores `movementSlug` produces: the legacy directories are kebab-case, and the
 * export's `movement` column is kebab too. Two slug shapes in one repo is a trap, so they are named
 * distinctly and each documents which form it emits.
 *
 * ⚠️ **This is a SEED-TIME default, not the identity.** The identity is the stored `profiles.slug`
 * column. Deriving the directory from the mutable display name at export time would make a filesystem
 * path a function of a display string — rename "Liam" to "Liam B" and the whole exported tree
 * relocates, and the Claude workflow sees a new athlete with no history. Same reasoning the schema
 * already records for `movements.slug` / `program_blocks.slug`: "slug (not raw name) is the identity".
 */
export function profileSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // any run of non-alphanumerics collapses to ONE hyphen
    .replace(/^-+|-+$/g, ''); // never a leading/trailing hyphen — it would read as a hidden file
}
