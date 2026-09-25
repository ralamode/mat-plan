import { type DayRole } from '@mat-plan/shared';

/**
 * Which `day_role` a calendar day programs — **the youth daily A/B rotation** (2026-09-24).
 *
 * The program runs **every calendar day** with no rest day, alternating `A → B → A`. So this is a
 * parity over the DATE itself, not a weekday map: a weekday map cannot alternate correctly across a
 * week boundary (seven is odd, so Saturday and Sunday would land on the same letter).
 *
 * ⚠️ **CALENDAR-indexed, and the spec says it should not be.** The source is emphatic that the letter
 * must come from the count of COMPLETED SESSIONS, and names the exact failure mode: *"a
 * calendar-derived letter will silently double up box jumps after any missed day."*
 *
 * **Ray accepted that deliberately** (2026-09-24): _"I don't mind if they miss a day and end up doing
 * the same thing twice, that's on them. The way this works is by streak and consistency, stacking
 * days. For now we can just align A with a day, B, next day etc."_
 *
 * So this is a DECISION, not an oversight — **do not "fix" it without asking.** True session-indexing
 * needs SCHED-1's recorded daily verdicts, since "completed sessions" is a question about history;
 * it is backlog row YDP-1.
 *
 * Replaces the Mon/Wed/Fri S&C map, whose block is archived at
 * `docs/programs/kids-sc-foundation-archived.md`.
 */

/** Days since the Unix epoch for a bare `YYYY-MM-DD`, via the UTC-anchored parse (the V1-6c idiom). */
function epochDay(day: string): number {
  return Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000);
}

/**
 * The `day_role` for the LOCAL calendar date `day` (`YYYY-MM-DD`).
 *
 * EVEN epoch-day → **B**, odd → **A**. The phase is anchored so that 2026-09-24 — the day the kids
 * moved off paper — is a **B day**, matching the sheet they had just filled in.
 *
 * ⚠️ `strength_a`/`strength_b` are REUSED as Day A / Day B. Proper `ydp_a`/`ydp_b` roles need a
 * migration altering two CHECKs; this was the path that let the athletes log the same evening. See
 * `PROGRAM_SEED`'s note.
 */
export function resolveDayRole(day: string): DayRole {
  return epochDay(day) % 2 === 0 ? 'strength_b' : 'strength_a';
}
