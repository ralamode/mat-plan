import { z } from 'zod';

/**
 * Canonical unit codes — the single source of truth (AGENTS.md constants
 * convention). This one definition feeds three consumers with zero drift:
 *   1. the zod validator (`unitSchema`) used at app trust boundaries,
 *   2. the `Unit` TS type,
 *   3. the `units` reference-table seed in packages/db.
 * No native pgEnum: the DB stores `unit` as text with an FK → units(code).
 */
export const UNIT_CODES = ['lb', 'kg', 'count', 'sec', 'min', 'bool', 'timing'] as const;

export type Unit = (typeof UNIT_CODES)[number];

export const unitSchema = z.enum(UNIT_CODES);

export const UNIT_LABELS: Record<Unit, string> = {
  lb: 'Pounds',
  kg: 'Kilograms',
  count: 'Count / reps',
  sec: 'Seconds',
  min: 'Minutes',
  bool: 'Done / not done',
  timing: 'Point in time',
};

/** Rows for the `units` reference-table seed (idempotent). */
export const UNITS = UNIT_CODES.map((code) => ({ code, label: UNIT_LABELS[code] }));
