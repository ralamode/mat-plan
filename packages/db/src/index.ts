// @mat-plan/db — Drizzle schema, migrations, and seed (catalogs).
// The app imports the client factory + schema/types from here; migrations and
// seeds are run via the scripts in ./scripts (GH Actions is the single migrator).
export * from './client';
export type * from './types';
// The fixed-identity seed public_ids (household + kid profiles) — re-exported so
// tooling (e.g. the ephemeral screenshot fixture) can target the seeded profile by
// its stable id instead of re-typing the UUID (constants convention, single source).
export { SEED_HOUSEHOLD_PUBLIC_ID, SEED_PROFILE_PUBLIC_ID, SEED_PROFILE_2_PUBLIC_ID } from './seed';
