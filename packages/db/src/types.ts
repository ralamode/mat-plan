import type {
  activityTypeCategories,
  activityTypes,
  dayReadiness,
  entries,
  entrySets,
  households,
  metricDefinitions,
  movements,
  profiles,
  rampTargets,
  sessions,
  units,
} from './schema';

// Row types inferred from the schema — the DAL maps these to DTOs (never returns
// a raw row). `$inferSelect` = read shape, `$inferInsert` = write shape.
export type UnitRow = typeof units.$inferSelect;
export type ProfileRow = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;
export type EntryRow = typeof entries.$inferSelect;
export type NewEntry = typeof entries.$inferInsert;
export type EntrySetRow = typeof entrySets.$inferSelect;
export type NewEntrySet = typeof entrySets.$inferInsert;

// V1-1a additive catalog + log tables (spec.md §4).
export type HouseholdRow = typeof households.$inferSelect;
export type NewHousehold = typeof households.$inferInsert;
export type ActivityTypeCategoryRow = typeof activityTypeCategories.$inferSelect;
export type ActivityTypeRow = typeof activityTypes.$inferSelect;
export type NewActivityType = typeof activityTypes.$inferInsert;
export type MovementRow = typeof movements.$inferSelect;
export type NewMovement = typeof movements.$inferInsert;
export type MetricDefinitionRow = typeof metricDefinitions.$inferSelect;
export type NewMetricDefinition = typeof metricDefinitions.$inferInsert;
export type SessionRow = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type DayReadinessRow = typeof dayReadiness.$inferSelect;
export type NewDayReadiness = typeof dayReadiness.$inferInsert;
// V1-6b: per-profile weekly calisthenics ramp targets (spec.md §4 adherence).
export type RampTargetRow = typeof rampTargets.$inferSelect;
export type NewRampTarget = typeof rampTargets.$inferInsert;
