/**
 * Fixed UUIDv7s for the single-tenant v0/v1 seed rows — the stable identities that make a re-seed conflict on
 * the natural key / public_id instead of inserting duplicates. Hoisted to `shared` (from `packages/db`) so
 * BOTH the DB seed and the app-authored `PROGRAM_SEED` (which references the household + specific kids by
 * public_id) can single-source them — `packages/shared` can't import `packages/db`, so the consts live here
 * and `packages/db/src/seed.ts` re-exports them for back-compat.
 */

/** The root household ("Home"). */
export const SEED_HOUSEHOLD_PUBLIC_ID = '019826b4-0000-7000-8000-000000000010';

// The two kid profiles under the root household (V1-3). SEED_PROFILE_PUBLIC_ID keeps the v0 id.
export const SEED_PROFILE_PUBLIC_ID = '019826b4-0000-7000-8000-000000000001';
export const SEED_PROFILE_2_PUBLIC_ID = '019826b4-0000-7000-8000-000000000002';

/**
 * The two seeded profiles' display names — **role names, never a real first name** (AGENTS.md -> "No
 * personal names"; `OSS-1`). Here rather than re-typed in the seed, `db:verify` and the e2e specs,
 * because that re-typing is exactly why the previous names took a fifty-file sweep to remove: the next
 * rename is these two lines.
 *
 * `One`/`Two` rather than `A`/`B` on purpose — the program's day roles are already Day A / Day B, and
 * `athleteADayA` is unreadable. The legacy-CSV evidence set under `docs/samples/legacy-csv/` keeps its
 * own `Athlete A` / `Athlete B` labels: a different corpus, deliberately not fixtures.
 */
export const SEED_PROFILE_NAME = 'Athlete One';
export const SEED_PROFILE_2_NAME = 'Athlete Two';
