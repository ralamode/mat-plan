// @mat-plan/shared — zod schemas, shared TS types, and golden test vectors (the contract).
// The canonical home for domain enums/constants (AGENTS.md constants convention):
// define a value once here, import it in the app, engine, and DB seed.
export * from './db-environment';
export * from './date';
// SCHED-1 1a: the pure calendar-date arithmetic (moved from apps/web/lib/date.ts) and the weekday
// vocabulary. No timezone, no `Intl`.
export * from './day';
// V1-9b — the hide/restore wire contract (ADR 0008's "delete"): the row caps, the fixed-format UTC
// event token, and the per-item restore reasons.
export * from './hide';
export * from './units';
export * from './quantity-slots';
export * from './enums';
export * from './activity-categories';
export * from './activity-shapes';
export * from './metrics';
export * from './aggregation';
export * from './movements';
// PICK-1 PR 3: the picker's pure halves — the "same movement" key and search (Decision 4), and the
// browse groups + aliases keyed by slug (Decision 3). Both are PURE and have no DB or React edge.
export * from './movement-filters';
export * from './movement-search';
export * from './movement-picker-catalog';
export * from './catalog-seed';
export * from './catalog-activity-types';
export * from './catalog-metrics';
export * from './catalog-movements';
export * from './catalog';
export * from './activity-metric-map';
export * from './ramp-schedule';
export * from './sessions';
export * from './readiness';
export * from './id';
export * from './text';
export * from './profiles';
export * from './bodyweight';
export * from './practice-shapes';
export * from './strength';
export * from './strength-session';
export * from './routine';
export * from './seed-ids';
export * from './programming';
// FAM-1 chunk 0a: the contract the program builder and the day page are built against (the shapes and
// the actions interfaces). Its prescribed-text renderer and its fixtures are subpaths, not this barrel.
export * from './program';
