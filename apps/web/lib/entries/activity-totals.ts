import {
  ACTIVITY_METRIC_MAP,
  ACTIVITY_TYPE_KEYS,
  ENTRY_STATUS,
  foldAggregation,
  type MetricAggregation,
  type DayRole,
  type SessionType,
  SEED_METRIC_KEYS,
} from '@mat-plan/shared';

import type { EntryDTO } from '@/lib/dal/entries';

/**
 * Calisthenics daily totals (V1-6a) — the digital tally sheet. Pure and route-agnostic
 * (no `server-only`, type-only `EntryDTO` import), like `entry-label.ts`.
 *
 * Folds each metric's same-day readings into one total via the shared `foldAggregation`
 * kernel (sum for the counters, max for the skill step), dispatching on `aggregation`
 * carried on the DTO — NOT reaching into the seed catalog. Order follows
 * `ACTIVITY_METRIC_MAP.calisthenics` (the display order), not global seed order.
 *
 * In-memory over the day's already-fetched rows — no query, no engine. (Weekly SQL
 * adherence is V1-6b, where pulling a week into memory would be wrong.)
 */
export type MetricTotal = {
  metricKey: string;
  label: string;
  /** The rolled-up value: Σ reps for the counters, best single reading for the skill step. */
  total: number;
  /** How many bouts were logged today — the paper tally's "sets". */
  readings: number;
  /** Each bout's value, oldest → newest — the DAL now returns oldest-first (V1-17), so this is the
   *  input order. Rendered in the grouped "Logged entries" row (the "Calisthenics today" tally card
   *  shows only `total` + `readings`, not `values`). */
  values: number[];
};

// Precondition (V1-17): `entries` arrive OLDEST-FIRST (`listEntriesForDay` orders asc(created_at), asc(id)).
// `values` is displayed oldest→newest directly; the fold kernel keeps its NEWEST-FIRST precondition (for
// `last`), so it is fed a reversed copy — see `total` below.

export function calisthenicsTotals(entries: readonly EntryDTO[]): MetricTotal[] {
  const byMetric = new Map<string, EntryDTO[]>();
  for (const e of entries) {
    // Only 'done' readings count. V1-9 may add 'skipped' — a skipped bout must not sum into
    // the total, so filter here even though every V1-6a write is 'done' today.
    if (
      e.activityKey !== ACTIVITY_TYPE_KEYS.calisthenics ||
      e.metricKey === null ||
      e.value === null ||
      e.aggregation === null ||
      e.status !== ENTRY_STATUS.done
    ) {
      continue;
    }
    const list = byMetric.get(e.metricKey) ?? [];
    list.push(e);
    byMetric.set(e.metricKey, list);
  }

  const totals: MetricTotal[] = [];
  for (const metricKey of ACTIVITY_METRIC_MAP[ACTIVITY_TYPE_KEYS.calisthenics]) {
    const rows = byMetric.get(metricKey);
    if (!rows?.length) continue;
    const values = rows.map((r) => r.value as number); // oldest-first (DAL asc, V1-17)
    totals.push({
      metricKey,
      label: rows[0].metricLabel ?? metricKey,
      // aggregation is a per-metric constant; every row for this key carries the same value. `foldAggregation`
      // documents a NEWEST-FIRST precondition (`last` returns values[0]), so feed it a reversed copy — keeps
      // the shared kernel's contract true and future-proofs a `last`/`avg` calisthenics metric (today all are
      // sum/max → order-independent, so `total` is unchanged either way).
      total: foldAggregation(rows[0].aggregation as MetricAggregation, [...values].reverse()),
      readings: rows.length,
      values, // oldest → newest for display: "20, 30"
    });
  }
  return totals;
}

/**
 * One display row per line of the "Logged entries" list (V1-6a). Non-accumulating entries
 * render individually as before; the day's calisthenics bouts are GROUPED into ONE row per
 * exercise (so N bouts don't read as N duplicate rows). Input is OLDEST-FIRST (DAL asc, V1-17),
 * so the grouped row appears at the position of the exercise's OLDEST bout, preserving the
 * performed (oldest→newest) order of the rest.
 */
/** One item inside a session block (V1-8-3d): a standalone movement, or a superset bracketing 2+
 *  movements performed alternating. */
export type SessionItem =
  | { kind: 'movement'; entry: EntryDTO }
  | { kind: 'superset'; superset: { id: string }; members: EntryDTO[] };

/** A logged strength session, grouped: a header (type/feel + movement count) + its items. Superset
 *  members sub-bracket within (V1-8-3d); standalone movements render individually. */
export type SessionRow = {
  kind: 'session';
  session: {
    id: string;
    type: SessionType | null;
    /** GAP-1 P0-1: the asserted programmed day, preferred over `type` for the block heading. */
    dayRole: DayRole | null;
    feel: string | null;
  };
  items: SessionItem[];
  movementCount: number; // total movements (standalone + all superset members) — computed here, read by the view
};

export type TodayRow =
  { kind: 'entry'; entry: EntryDTO } | { kind: 'calisthenics'; total: MetricTotal } | SessionRow;

/**
 * Group a session's id-sorted members into two-level items (V1-8-3d). Superset members (same public
 * `supersetId`) collapse into ONE `{kind:'superset'}` item at their EARLIEST member's position (the
 * members are already id-sorted, so first-encounter = earliest); the bracket's members re-sort by
 * `supersetOrder` (the alternating order — robust under LWW where id order isn't). Two degradation
 * cases render standalone rather than a broken bracket: a member whose superset was soft-deleted has
 * `supersetId` NULL (the join missed), and a group reduced to a LONE surviving member (a member
 * soft-deleted at v1.5-sync / V1-9) fails the ≥2 guard below — the write path enforces ≥2, but a
 * later delete can drop a group under it, so the read path must not bracket a single movement.
 * Everything else is a `{kind:'movement'}` item.
 */
function buildSessionItems(members: readonly EntryDTO[]): SessionItem[] {
  const supersetMembers = new Map<string, EntryDTO[]>();
  for (const m of members) {
    if (m.supersetId === null) continue;
    const list = supersetMembers.get(m.supersetId) ?? [];
    list.push(m);
    supersetMembers.set(m.supersetId, list);
  }
  for (const list of supersetMembers.values()) {
    list.sort((a, b) => (a.supersetOrder ?? 0) - (b.supersetOrder ?? 0));
  }

  const emittedSupersets = new Set<string>();
  const items: SessionItem[] = [];
  for (const m of members) {
    // A superset brackets 2+ members. A group that still has ≥2 emits ONE bracket at its earliest
    // member; a group down to a lone survivor falls through to a standalone movement (no 1-member
    // bracket) — same graceful degradation as the supersetId-NULL (deleted-superset) case.
    const group = m.supersetId !== null ? supersetMembers.get(m.supersetId)! : null;
    if (group !== null && group.length >= 2) {
      if (emittedSupersets.has(m.supersetId!)) continue;
      emittedSupersets.add(m.supersetId!);
      items.push({ kind: 'superset', superset: { id: m.supersetId! }, members: group });
      continue;
    }
    items.push({ kind: 'movement', entry: m });
  }
  return items;
}

export function todayRows(entries: readonly EntryDTO[]): TodayRow[] {
  const totalByMetric = new Map(calisthenicsTotals(entries).map((t) => [t.metricKey, t]));

  // V1-8-3a: gather each session's members in a FULL PASS keyed by sessionId (the `byMetric` idiom) —
  // NOT a contiguous run: a replay-appended member has a later created_at, so in the DAL's
  // asc(createdAt),asc(id) order it is non-adjacent to the originals, and a run collector would split
  // one session into two blocks. Members are then sorted by public id (== insertion order: uuidv7 is
  // monotonic and the writer mints ids in insertion order) so an appended member re-orders into place.
  const sessionMembers = new Map<string, EntryDTO[]>();
  for (const e of entries) {
    if (e.sessionId === null) continue;
    const list = sessionMembers.get(e.sessionId) ?? [];
    list.push(e);
    sessionMembers.set(e.sessionId, list);
  }
  for (const list of sessionMembers.values()) list.sort((a, b) => a.id.localeCompare(b.id));

  // Emit each session block at its OLDEST member (list[0] after the id-asc sort) so the block anchors
  // where the session STARTED, not at a later replay-appended (newer created_at) member. Like the
  // calisthenics group below, block PLACEMENT follows the DAL's asc iteration order (both emit at the
  // first-encountered = oldest occurrence); both would need revisiting together if the DAL order flips.
  // The anchor differs from the calisthenics `emitted` Set only because a session member isn't uniquely
  // keyed by the loop var the way a metricKey is — it needs the precomputed "which member is the anchor".
  const sessionAnchor = new Map<string, string>();
  for (const [sid, list] of sessionMembers) sessionAnchor.set(sid, list[0].id);

  const emitted = new Set<string>(); // calisthenics metric keys
  const rows: TodayRow[] = [];
  for (const e of entries) {
    if (e.activityKey === ACTIVITY_TYPE_KEYS.calisthenics && e.metricKey !== null) {
      // Emit the grouped row once, at the OLDEST bout (first-encountered under asc); skip the rest. Skip
      // entirely if the metric was filtered out of the totals (null value / non-done) so it doesn't render.
      if (emitted.has(e.metricKey)) continue;
      emitted.add(e.metricKey);
      const total = totalByMetric.get(e.metricKey);
      if (total) rows.push({ kind: 'calisthenics', total });
      continue;
    }
    if (e.sessionId !== null) {
      // Emit the block once, at its anchor (oldest member); skip every other member.
      if (e.id !== sessionAnchor.get(e.sessionId)) continue;
      const members = sessionMembers.get(e.sessionId)!; // e is in it (anchor came from this map)
      rows.push({
        kind: 'session',
        // per-session data, same on every member — read from the anchor (first-encountered) member.
        session: {
          id: e.sessionId,
          type: e.sessionType,
          dayRole: e.sessionDayRole,
          feel: e.sessionFeel,
        },
        items: buildSessionItems(members),
        movementCount: members.length, // every member is a movement (standalone or in a superset)
      });
      continue;
    }
    rows.push({ kind: 'entry', entry: e });
  }
  return rows;
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
 * requires a value).
 */
export function loggedBodyweight(entries: readonly EntryDTO[]): LoggedBodyweight[] {
  const logged: LoggedBodyweight[] = [];
  for (const e of entries) {
    if (e.metricKey === SEED_METRIC_KEYS.bodyweight && e.value !== null) {
      logged.push({ entryId: e.id, value: e.value, unit: e.unit });
    }
  }
  return logged;
}
