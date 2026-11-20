import { ACTIVITY_TYPE_KEYS, ENTRY_STATUS, SEED_METRIC_KEYS } from '@mat-plan/shared';

import type { EntryDTO } from '@/lib/dal/entries';

/**
 * Selectors over the day's already-fetched entries: the logged life activities the Life section
 * lists (and which of them is a practice), and the logged bodyweight the weigh-in receipt shows. Pure and route-agnostic
 * (no `server-only`, type-only `EntryDTO` import), like `entry-label.ts`. In memory, no query.
 *
 * The file kept its name when 12f deleted the calisthenics totals and the strength-session rows it
 * first held: eight files import it.
 */

/** One logged life activity, as the Life section's row reads it (V1-24 3b-page). */
export type LoggedLifeActivity = {
  entryId: string;
  activityKey: string;
  /** `null` only for a row that carries no value; the row then shows the label alone. */
  value: number | null;
  unit: EntryDTO['unit'];
};

/**
 * Is this entry a wrestling practice? The Life section's own test (V1-9b B2): one predicate, so the
 * clear's summary and the section name the same rows. A practice is keyed on its activity, not its
 * metric, as the section renders it.
 */
export function isPracticeEntry(entry: Pick<EntryDTO, 'activityKey'>): boolean {
  return entry.activityKey === ACTIVITY_TYPE_KEYS.wrestling_practice;
}

/**
 * Every entry on the day for one of `activityKeys`, in the DAL's order (oldest first). Which
 * activities the page SHOWS (no Wake) is `LifeSection`'s rule, not this one's.
 */
export function loggedLifeActivities(
  entries: readonly EntryDTO[],
  activityKeys: readonly string[],
): LoggedLifeActivity[] {
  const logged: LoggedLifeActivity[] = [];
  for (const e of entries) {
    if (e.activityKey === null || !activityKeys.includes(e.activityKey)) continue;
    logged.push({ entryId: e.id, activityKey: e.activityKey, value: e.value, unit: e.unit });
  }
  return logged;
}

/** One logged bodyweight, as the receipt reads it (V1-24 PR 1a). */
export type LoggedBodyweight = {
  /** `entries.public_id` — the id PR 1b's amend will address. Carried now so the receipt and the
   *  Change control read the same row rather than re-deriving it. */
  entryId: string;
  value: number;
  unit: EntryDTO['unit'];
};

/**
 * **Every** live bodyweight row on the day, oldest first — `[]` when there is none (V1-24 PR 1a).
 * What makes the weigh-in surface render a RECEIPT instead of an empty input.
 *
 * ## Why every row, and not "the" one
 *
 * Until V1-24 PR 1d's unique index lands, a day can hold MORE than one bodyweight row (the pre-1c
 * duplicates in prod, or two phones submitting at once), and 1a's UI does not stop the concurrent
 * case. Collapsing them to one would show a clean receipt over a day whose export carries two
 * weights — hiding exactly the rows a parent needs to see to correct. So the receipt lists them all
 * (`2 weights logged: …`) and never silently picks one.
 *
 * ## Why this lives here and not inline in `page.tsx`
 *
 * It is the third "what is already logged" derivation on that page, beside `loggedFieldKeys` and
 * `loggedLifeKeys`. This one is tested because getting it wrong has a specific cost: returning `[]`
 * when a row exists re-opens the second-submit path this PR removes.
 *
 * ## Why `metric_key`, not `kind`
 *
 * `entries.kind` is the legacy discriminant and is scheduled for deletion (`schema.ts` — "Dropped in
 * V1-1d"), so keying on it would be born dead. `metricKey` is the generalized one every V1-4+ writer
 * sets, and the constant comes from `SEED_METRIC_KEYS` rather than a re-typed `'bodyweight'`.
 *
 * `listEntriesForDay` already excludes soft-deleted rows and orders ascending (V1-17), so "live" and
 * "oldest first" come from the DAL; this only filters. A value-less row is skipped: it has nothing to
 * show, and must not suppress the form (the bodyweight writer cannot produce one — its schema
 * requires a value). A non-`done` row is skipped too (V1-24 PR 1b): the amend refuses it, so showing
 * it would put a Change control on the screen that can only ever fail.
 */
export function loggedBodyweight(entries: readonly EntryDTO[]): LoggedBodyweight[] {
  const logged: LoggedBodyweight[] = [];
  for (const e of entries) {
    if (
      e.metricKey === SEED_METRIC_KEYS.bodyweight &&
      e.value !== null &&
      e.status === ENTRY_STATUS.done
    ) {
      logged.push({ entryId: e.id, value: e.value, unit: e.unit });
    }
  }
  return logged;
}
