// @mat-plan/db — Drizzle schema, migrations, and seed (catalogs).
// The app imports the client factory + schema/types from here; migrations and
// seeds are run via the scripts in ./scripts (GH Actions is the single migrator).
export * from './client';
export type * from './types';
// TEN-1: the household scope. Named re-exports, NOT `export *` — `makeHouseholdScope` (the shared
// brand application) must not reach `apps/web` on a bare specifier, and neither must
// `householdScopeForScript`, which is why that one lives in a module this barrel never names at all
// (writers/household-scope-script.ts → reachable only by relative path from packages/db/scripts/**).
export { householdScopeForRequest, type HouseholdScope } from './scope';
// The single-sourced weekly-adherence query (V1-6b-2), run by both the app DAL and db:verify.
export * from './queries/weekly-adherence';
// The single-sourced programmed-day query (V1-10 slice 2), run by both the app DAL and db:verify.
export * from './queries/program-day';
export * from './queries/export-month';
// The single-sourced profile-picker query (TEN-1 1b). Under ADR 0006's session-only addressing `/p`
// is byte-identical for every household, so this query is the app front door's whole isolation
// boundary — db:verify must run the DAL's own function, not a lookalike.
export * from './queries/household-profiles';
// The single-sourced pre-AUTH-1 scope resolution (TEN-1 1b) — db:verify proves the soft-deleted
// household case against a real database, which prose cannot.
export * from './queries/household-scope';
// The single-sourced strength-session write core (V1-8-2), run by both the app DAL and db:verify.
export * from './writers/bodyweight';
export * from './writers/ownership';
export * from './writers/strength-session';
// The fixed-identity seed public_ids (household + kid profiles) — re-exported so
// tooling (e.g. the ephemeral screenshot fixture) can target the seeded profile by
// its stable id instead of re-typing the UUID (constants convention, single source).
export {
  SEED_HOUSEHOLD_PUBLIC_ID,
  SEED_PROFILE_PUBLIC_ID,
  SEED_PROFILE_2_PUBLIC_ID,
  SEED_PROFILE_NAME,
  SEED_PROFILE_2_NAME,
  SEED_FULL_ROUTINE,
  SEED_ATHLETE_TWO_ROUTINE,
} from './seed';
