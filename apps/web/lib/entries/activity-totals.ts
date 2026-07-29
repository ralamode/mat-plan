import {
  ACTIVITY_METRIC_MAP,
  ACTIVITY_TYPE_KEYS,
  ENTRY_STATUS,
  foldAggregation,
  type MetricAggregation,
  type SessionType,
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
  /** Each bout's value, oldest → newest (the DAL returns desc, so this is reversed). */
  values: number[];
};

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
    const values = rows.map((r) => r.value as number);
    totals.push({
      metricKey,
      label: rows[0].metricLabel ?? metricKey,
      // aggregation is a per-metric constant; every row for this key carries the same value.
      total: foldAggregation(rows[0].aggregation as MetricAggregation, values),
      readings: rows.length,
      values: [...values].reverse(), // DAL desc(createdAt) → show oldest-first: "20, 30"
    });
  }
  return totals;
}

/**
 * One display row per line of the "Logged entries" list (V1-6a). Non-accumulating entries
 * render individually as before; the day's calisthenics bouts are GROUPED into ONE row per
 * exercise (so N bouts don't read as N duplicate rows). The grouped row appears at the
 * position of the exercise's newest bout, preserving the desc(createdAt) order of the rest.
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
  session: { id: string; type: SessionType | null; feel: string | null };
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
  // desc(createdAt),asc(id) order it is non-adjacent to the originals, and a run collector would split
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

  // Emit each session block at its OLDEST member (list[0] after the id-asc sort) so the block stays
  // where the session STARTED, and a later replay-appended (newer created_at) movement doesn't yank
  // the whole block to the top of the day. For a normal single-tx session (all members one created_at)
  // the oldest member is also the first-encountered, so placement is unchanged.
  const sessionAnchor = new Map<string, string>();
  for (const [sid, list] of sessionMembers) sessionAnchor.set(sid, list[0].id);

  const emitted = new Set<string>(); // calisthenics metric keys
  const rows: TodayRow[] = [];
  for (const e of entries) {
    if (e.activityKey === ACTIVITY_TYPE_KEYS.calisthenics && e.metricKey !== null) {
      // Emit the grouped row once, at the newest bout; skip the rest. Skip entirely if the
      // metric was filtered out of the totals (null value / non-done) so it doesn't render raw.
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
        session: { id: e.sessionId, type: e.sessionType, feel: e.sessionFeel },
        items: buildSessionItems(members),
        movementCount: members.length, // every member is a movement (standalone or in a superset)
      });
      continue;
    }
    rows.push({ kind: 'entry', entry: e });
  }
  return rows;
}
