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

/** Session log status — reuses the entry status vocabulary (single source). */
export const SESSION_STATUSES = ENTRY_STATUSES;

export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const sessionStatusSchema = z.enum(SESSION_STATUSES);
