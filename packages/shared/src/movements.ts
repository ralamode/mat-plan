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
