import { z } from 'zod';

import { keyBySelf } from './enums';

/**
 * `activity_type.input_shape` — the small taxonomy of value shapes an activity can
 * take (spec.md §4): a list of sets, a single metric reading, a boolean done/not,
 * or a point-in-time event. Stored as text + CHECK (a structural enum, not a
 * reference table, per AGENTS.md). One list; the DB CHECK on `activity_types`
 * mirrors these literals (coverage test lands with the catalogs at V1-2).
 */
export const ACTIVITY_INPUT_SHAPES = ['set_list', 'single_metric', 'boolean', 'timing'] as const;

export type ActivityInputShape = (typeof ACTIVITY_INPUT_SHAPES)[number];

export const activityInputShapeSchema = z.enum(ACTIVITY_INPUT_SHAPES);

/** Named members, so code branches on `ACTIVITY_INPUT_SHAPE.boolean`, not a bare string. */
export const ACTIVITY_INPUT_SHAPE = keyBySelf(ACTIVITY_INPUT_SHAPES);
