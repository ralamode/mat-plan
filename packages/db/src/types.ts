import type { entries, entrySets, profiles, units } from './schema';

// Row types inferred from the schema — the DAL maps these to DTOs (never returns
// a raw row). `$inferSelect` = read shape, `$inferInsert` = write shape.
export type UnitRow = typeof units.$inferSelect;
export type ProfileRow = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;
export type EntryRow = typeof entries.$inferSelect;
export type NewEntry = typeof entries.$inferInsert;
export type EntrySetRow = typeof entrySets.$inferSelect;
export type NewEntrySet = typeof entrySets.$inferInsert;
