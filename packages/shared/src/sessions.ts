import { z } from 'zod';

import { ENTRY_STATUSES, keyBySelf } from './enums';

/**
 * `session` structural enums (spec.md §4). Text + CHECK (not reference tables).
 * `SESSION_STATUSES` deliberately **reuses** the `ENTRY_STATUSES` vocabulary — a
 * session and its entries share one status lexicon, so the values live in exactly
 * one place (AGENTS.md constants convention) rather than being re-typed here.
 * Sessions are first written at V1-8; the CHECKs on `sessions` mirror these lists.
 */

/**
 * The session types that existed before FAM-1: kids' S&C days + the PPL split. `DAY_ROLES`
 * (`programming.ts`) spreads THIS list, not `SESSION_TYPES`, so a new session type never becomes a day
 * role and never widens `sessions_day_role_check` / `prescriptions_day_role_check` (FAM-1 plan D6).
 */
export const LEGACY_SESSION_TYPES = [
  'strength',
  'conditioning',
  'skill',
  'push',
  'pull',
  'legs',
  'core',
] as const;

/**
 * Every session type `sessions_session_type_check` accepts (db:verify pins the CHECK to this list).
 * FAM-1 step 3 appends `workout`: the session a template workout's rows are logged into (plan D6). It
 * is APPENDED, never inserted, because `SESSION_TYPES[0]` is `DEFAULT_SESSION_TYPE`.
 */
export const SESSION_TYPES = [...LEGACY_SESSION_TYPES, 'workout'] as const;

export type SessionType = (typeof SESSION_TYPES)[number];

export const sessionTypeSchema = z.enum(SESSION_TYPES);

/** Branch on a NAMED member (`SESSION_TYPE.workout`), never a bare string (constants convention). */
export const SESSION_TYPE = keyBySelf(SESSION_TYPES);

/**
 * The default session type — a kids' S&C day is 'strength' (Ray's PPL push/pull/legs come at v2).
 * Named off the const (mirroring `DEFAULT_BODYWEIGHT_UNIT`) so a form/schema default is sourced,
 * never a re-typed literal (AGENTS.md constants convention).
 */
export const DEFAULT_SESSION_TYPE: SessionType = SESSION_TYPES[0];

/**
 * Display labels for the session types (V1-8-3a) — the single source for the Today session-block
 * header, mirroring `ACTIVITY_CATEGORY_LABELS`/`UNIT_LABELS`. The enum values are lowercase; the
 * header renders via this map so no component re-types or re-cases a label. (Distinct from
 * `ACTIVITY_CATEGORY_LABELS`, which lacks the PPL push/pull/legs/core types.)
 */
export const LEGACY_SESSION_TYPE_LABELS: Record<(typeof LEGACY_SESSION_TYPES)[number], string> = {
  strength: 'Strength',
  conditioning: 'Conditioning',
  skill: 'Skill',
  push: 'Push',
  pull: 'Pull',
  legs: 'Legs',
  core: 'Core',
};

/** Every session type's label. `DAY_ROLE_LABELS` spreads the LEGACY map, so `workout` is no day role. */
export const SESSION_TYPE_LABELS: Record<SessionType, string> = {
  ...LEGACY_SESSION_TYPE_LABELS,
  workout: 'Workout',
};

/** Heading for a superset bracket in the Today log (V1-8-3d). A single source so the view and its test
 *  can't drift; v1 supersets carry no user label, so this is shown for every bracket. */
export const DEFAULT_SUPERSET_LABEL = 'Superset';

/** Session log status — reuses the entry status vocabulary (single source). */
export const SESSION_STATUSES = ENTRY_STATUSES;

export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const sessionStatusSchema = z.enum(SESSION_STATUSES);
