import { z } from 'zod';

/**
 * `day_readiness.gate_color` — the per-day readiness gate (spec.md §4: readiness is
 * per-day, not per-session). Text + CHECK (a structural enum, not a reference table).
 * One list; the DB CHECK on `day_readiness` mirrors these literals.
 */
export const GATE_COLORS = ['green', 'yellow', 'red'] as const;

export type GateColor = (typeof GATE_COLORS)[number];

export const gateColorSchema = z.enum(GATE_COLORS);
