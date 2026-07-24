import 'server-only';

import { weeklyAdherenceRows } from '@mat-plan/db';
import { ACTIVITY_TYPE_KEYS, CALISTHENICS_METRIC_KEYS } from '@mat-plan/shared';

import { type AdherenceDTO, toAdherenceList } from '@/lib/entries/adherence';

import { getActivityTypeIdByKey } from './catalog';
import { db } from './db';

export type { AdherenceDTO };

/**
 * This week's calisthenics ramp adherence for a profile (V1-6b-2) — the read side that surfaces what
 * V1-6b-1 made computable. Thin: resolve the cached calisthenics id, run the single-sourced
 * `weeklyAdherenceRows` (so `db:verify` proves this exact query, scoped by `public_id`), and shape
 * the rows via the pure `toAdherenceList`. Returns `[]` when no targets exist (the schedule ships
 * empty) → the page renders nothing.
 */
export async function getWeeklyAdherence(
  profilePublicId: string,
  weekStart: string,
): Promise<AdherenceDTO[]> {
  const activityTypeId = await getActivityTypeIdByKey(ACTIVITY_TYPE_KEYS.calisthenics);
  const rows = await weeklyAdherenceRows(db, {
    profilePublicId,
    weekStart,
    activityTypeId,
    metricKeys: CALISTHENICS_METRIC_KEYS,
  });
  return toAdherenceList(rows);
}
