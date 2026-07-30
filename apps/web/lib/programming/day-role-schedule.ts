import { type DayRole } from '@mat-plan/shared';

import { localWeekday } from '@/lib/date';

/**
 * Which `day_role` a weekday programs (V1-10 slice 2) — Ray's split: **Mon → Strength A, Wed → Strength B,
 * Fri → Strength C**; every other day programs no strength (→ the Today page shows no program card).
 *
 * DELIBERATE STOPGAP — app policy, not shared contract. This lives in `apps/web` (not `packages/shared`)
 * and as a const (not a DB `block_schedule` table) because the app serves exactly ONE household today, and
 * a table would buy per-block schedules nobody can author yet. **Promotion trigger:** Clerk /
 * multi-household (v1.5) — at which point this becomes a per-block schedule row and the map is deleted.
 * Tracked in docs/tech-debt.md, same as the access-gate stopgap.
 *
 * Keyed by the `0=Sun … 6=Sat` weekday that `localWeekday` returns. Typed `DayRole | null` against the
 * shared enum so a typo can't invent a role the DB CHECK would reject.
 */
export const DAY_ROLE_BY_WEEKDAY: Record<number, DayRole | null> = {
  0: null, // Sun — rest
  1: 'strength_a', // Mon
  2: null, // Tue — conditioning (no prescription model yet)
  3: 'strength_b', // Wed
  4: null, // Thu — conditioning (no prescription model yet)
  5: 'strength_c', // Fri
  6: null, // Sat — rest
};

/**
 * The `day_role` programmed for the LOCAL calendar date `day` (`YYYY-MM-DD`), or null on a non-strength
 * day. Pure + unit-tested; the RSC feeds it the active-tz `localDayIso` day so the card and the page
 * header can never disagree about which weekday it is.
 */
export function resolveDayRole(day: string): DayRole | null {
  return DAY_ROLE_BY_WEEKDAY[localWeekday(day)] ?? null;
}
