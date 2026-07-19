// @mat-plan/db — Drizzle schema, migrations, and seed (catalogs).
// The app imports the client factory + schema/types from here; migrations and
// seeds are run via the scripts in ./scripts (GH Actions is the single migrator).
export * from './client';
export type * from './types';
