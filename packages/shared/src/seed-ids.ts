/**
 * Fixed UUIDv7s for the single-tenant v0/v1 seed rows — the stable identities that make a re-seed conflict on
 * the natural key / public_id instead of inserting duplicates. Hoisted to `shared` (from `packages/db`) so
 * BOTH the DB seed and the app-authored `PROGRAM_SEED` (which references the household + specific kids by
 * public_id) can single-source them — `packages/shared` can't import `packages/db`, so the consts live here
 * and `packages/db/src/seed.ts` re-exports them for back-compat.
 */

/** The root household ("Home"). */
export const SEED_HOUSEHOLD_PUBLIC_ID = '019826b4-0000-7000-8000-000000000010';

// The two kid profiles under the root household (V1-3). SEED_PROFILE_PUBLIC_ID keeps the v0 id (Liam);
// SEED_PROFILE_2_PUBLIC_ID is Scarlett.
export const SEED_PROFILE_PUBLIC_ID = '019826b4-0000-7000-8000-000000000001';
export const SEED_PROFILE_2_PUBLIC_ID = '019826b4-0000-7000-8000-000000000002';
