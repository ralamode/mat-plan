import { z } from 'zod';

import { ENTRY_STATUSES } from './enums';

/**
 * `session` structural enums (spec.md §4). Text + CHECK (not reference tables).
 * `SESSION_STATUSES` deliberately **reuses** the `ENTRY_STATUSES` vocabulary — a
 * session and its entries share one status lexicon, so the values live in exactly
 * one place (AGENTS.md constants convention) rather than being re-typed here.
 * Sessions are first written at V1-8; the CHECKs on `sessions` mirror these lists.
 */

/** The kind of training session — kids' S&C days + Ray's PPL split. */
export const SESSION_TYPES = [
  'strength',
  'conditioning',
  'skill',
  'push',
  'pull',
  'legs',
  'core',
] as const;

export type SessionType = (typeof SESSION_TYPES)[number];

export const sessionTypeSchema = z.enum(SESSION_TYPES);

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
export const SESSION_TYPE_LABELS: Record<SessionType, string> = {
  strength: 'Strength',
  conditioning: 'Conditioning',
  skill: 'Skill',
  push: 'Push',
  pull: 'Pull',
  legs: 'Legs',
  core: 'Core',
};

/** Session log status — reuses the entry status vocabulary (single source). */
export const SESSION_STATUSES = ENTRY_STATUSES;

export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const sessionStatusSchema = z.enum(SESSION_STATUSES);
