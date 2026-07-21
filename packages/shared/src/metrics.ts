import { z } from 'zod';

/**
 * `metric_definition` structural enums (spec.md §4): the value shape a metric
 * carries and how repeated readings roll up. Text + CHECK (structural enums, not
 * reference tables). One list each; the DB CHECKs on `metric_definitions` mirror
 * these literals (coverage test with the catalogs at V1-2).
 */

/** How a metric reading is typed (a raw number, a count, a 1–10 scale, etc.). */
export const METRIC_VALUE_TYPES = [
  'number',
  'count',
  'scale_10',
  'bool',
  'duration',
  'text',
] as const;

export type MetricValueType = (typeof METRIC_VALUE_TYPES)[number];

export const metricValueTypeSchema = z.enum(METRIC_VALUE_TYPES);

/** How repeated readings of a metric aggregate (e.g. `pullup_max` = max; shots = sum). */
export const METRIC_AGGREGATIONS = ['sum', 'last', 'max', 'avg'] as const;

export type MetricAggregation = (typeof METRIC_AGGREGATIONS)[number];

export const metricAggregationSchema = z.enum(METRIC_AGGREGATIONS);
