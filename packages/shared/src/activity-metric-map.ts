import { type ActivityTypeKey, ACTIVITY_TYPE_KEYS } from './catalog-activity-types';
import { type MetricKey, METRIC_KEYS } from './catalog-metrics';

/**
 * Which `metric_definition`s each `activity_type` records (spec.md §4a coverage table).
 * The map is typed against BOTH key sets (`Record<ActivityTypeKey, readonly MetricKey[]>`),
 * so a typo in either an activity key or a metric key fails typecheck — the map can't drift
 * from the catalogs. Activities that record NEITHER a movement nor a metric (boolean/timing:
 * wake, rice_bucket, brain_rep, splits) map to `[]`; strength (`sc_lift`) records a movement,
 * not a metric, so it is `[]` here too. The coverage test walks every entry + key.
 */
export const ACTIVITY_METRIC_MAP: Record<ActivityTypeKey, readonly MetricKey[]> = {
  [ACTIVITY_TYPE_KEYS.weigh_in]: [METRIC_KEYS.bodyweight],
  [ACTIVITY_TYPE_KEYS.sc_lift]: [],
  [ACTIVITY_TYPE_KEYS.wake]: [],
  [ACTIVITY_TYPE_KEYS.rice_bucket]: [],
  [ACTIVITY_TYPE_KEYS.wrestling_practice]: [METRIC_KEYS.practice_minutes],
  [ACTIVITY_TYPE_KEYS.calisthenics]: [
    METRIC_KEYS.pushups,
    METRIC_KEYS.pullups,
    METRIC_KEYS.vsit_crunch,
    METRIC_KEYS.vsit_skill_step,
  ],
  [ACTIVITY_TYPE_KEYS.brush_teeth]: [
    METRIC_KEYS.stance,
    METRIC_KEYS.footwork,
    METRIC_KEYS.bridge,
    METRIC_KEYS.mobility,
    METRIC_KEYS.pressure,
    METRIC_KEYS.reaction,
    METRIC_KEYS.shot,
  ],
  [ACTIVITY_TYPE_KEYS.brain_rep]: [],
  [ACTIVITY_TYPE_KEYS.splits]: [],
  [ACTIVITY_TYPE_KEYS.shots]: [METRIC_KEYS.shot],
  [ACTIVITY_TYPE_KEYS.conditioning]: [METRIC_KEYS.sprint_reps, METRIC_KEYS.aerobic_minutes],
};
