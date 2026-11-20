/**
 * **Every advisory-lock namespace, named once** (FAM-1 caps, C35). A two-key
 * `pg_advisory_xact_lock(namespace, key)` is taken under one of these, so two locks for different
 * purposes never wait on each other by accident. Add a lock here, with its own number, never inline.
 *
 * Transaction-scoped locks only (`_xact_`): the app runs behind PgBouncer, where a session-scoped
 * lock could outlive the request that took it. Call `setLocalLockTimeout` (`executor.ts`) first in
 * the same transaction, so a wait on the lock is bounded.
 */
export const ADVISORY_LOCK = {
  /** A household's own items: `newItem` counts and adds them one at a time (`writers/program/new-item.ts`). */
  householdItems: 600_001,
  /**
   * A household's athletes: `createProfile` counts and adds them one at a time, against
   * `MAX_HOUSEHOLD_ATHLETES` (`writers/profile.ts`).
   */
  householdAthletes: 600_002,
} as const;
