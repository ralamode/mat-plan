import {
  type CatalogMovement,
  type DayItem,
  type DayPlan,
  type DayRow,
  type DayWorkout,
  hasSetRows,
  ON_PROGRAM,
  type RowValues,
  showsOnlyLogged,
  type Supervision,
  TRACKING_TYPE_FIELDS,
  type TrackingType,
  trackingTypeSchema,
  unitSchema,
} from '@mat-plan/shared';
import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';

import { schema } from '../../client';
import type { HouseholdScope } from '../../scope';
import type { Executor } from '../../writers/executor';
import {
  athleteTemplateBlockIn,
  isLiveProfile,
  movementIsAvailableTo,
  workoutIsLive,
} from '../../writers/ownership';
import { rowDayOpen } from './day-window';
import {
  liveQuantities,
  type PrescriptionQuantityRow,
  prescriptionTerms,
} from './prescription-terms';
import { previousKey, type PreviousKey, previousRows } from './previous';
import { byFirstLogged, programItemKey, programRowOf } from './program-rows';
import { type DayAssignment, dayAssignments, weekSlotsOn } from './scheduled';
import { readRowValues } from './stored-row-values';

/**
 * FAM-1 step 12a — **the day resolver**: an athlete and a day → the `DayPlan` the day page shows,
 * every field but `athletes` (the DAL's, 12b). The plan is
 * [fam-1-12a-day-resolver.md](../../../../../docs/plans/fam-1-12a-day-resolver.md) (decisions R1–R8,
 * E1–E7, the field table); the field rules are `DayPlan`'s docblocks
 * (`packages/shared/src/program/day-shapes.ts`); the invariants are in
 * [day-writers.md](../../../../../docs/features/day-writers.md).
 *
 * **Two anchors (E1).** The LIVE branch (what is on the day) starts from the athlete's assignments,
 * on live template blocks of the scope and of the athlete's own household (`dayAssignments`). The
 * LOGGED branch (what was logged that day) starts from the athlete's program rows (`programRowOf`)
 * that carry a movement (E4), and reaches each row's workout and prescription through SCOPED
 * subqueries, dropping a row whose pointer is foreign. A read, no writes; one query per kind.
 *
 * Returns `null` for a profile that is not live in the scope, uniform with a missing one (no oracle).
 */

/** The day page's DayPlan without `athletes`, which the DAL adds. */
export type ResolvedDayPlan = Omit<DayPlan, 'athletes'>;

/** `all`: a writable day. `logged`: a day that is not writable, or a workout that left the week. `preview`: a future day. */
type Showing = 'all' | 'logged' | 'preview';

/** One live logged program row of the day, through E1's scoped joins. */
type LoggedRow = Awaited<ReturnType<typeof loggedRows>>[number];

/** A live prescription of a workout, with its live quantities' rows. */
type LivePrescription = {
  id: number;
  publicId: string;
  workoutId: number;
  movementId: number;
  idx: number;
  sets: number | null;
  targetReps: string | null;
  notes: string | null;
  restAfter: string | null;
  supersetLabel: string | null;
  supersetOrder: number | null;
  /** The LEFT JOIN's rows, as `liveQuantities` takes them. */
  quantities: PrescriptionQuantityRow[];
};

type Movement = {
  publicId: string;
  name: string;
  trackingType: TrackingType;
  /** C32: the library's label for a GLOBAL movement whose entry carries one; absent otherwise. */
  supervision?: Supervision;
};

export async function resolveDayPlan(
  exec: Executor,
  args: {
    scope: HouseholdScope;
    profilePublicId: string;
    day: string;
    today: string;
    /**
     * C32: the movement library the database was seeded from, read by slug for each GLOBAL movement's
     * `supervision` label. The DAL passes `CATALOG_MOVEMENTS`; the proofs pass the test library.
     * Handed in, so the query never decides which library a database holds.
     */
    catalog: readonly CatalogMovement[];
  },
): Promise<ResolvedDayPlan | null> {
  const { scope, day, today } = args;

  const [profile] = await exec
    .select({ id: schema.profiles.id, archivedAt: schema.profiles.archivedAt })
    .from(schema.profiles)
    .where(isLiveProfile(args.profilePublicId, scope))
    .limit(1);
  if (!profile) return null;

  // R1: future first (the preview, archived or not); else writable only inside the window and not
  // archived (`rowDayOpen`, the writer's own rule); else logged rows only.
  const writable = rowDayOpen(day, today, profile.archivedAt);
  const future = day > today;
  // `showsOnlyLogged` (C23) is the one spelling of "this day shows only what was logged", shared with
  // the fixture builder and the day screen; a future day is checked inside it, so it previews.
  const scheduledShowing: Showing = showsOnlyLogged({ writable, future })
    ? 'logged'
    : future
      ? 'preview'
      : 'all';

  // ── The live branch: assignments, then the day's week slots ─────────────────────────────────────
  const assignments = await dayAssignments(exec, scope, profile.id, { day, today });
  const current = currentPrograms(assignments, today);
  const orderOf = new Map(current.map((p, i) => [p.blockId, i]));
  const onDay = programsOnDay(assignments, orderOf);
  const programRank = new Map(onDay.map((p, i) => [p.blockId, i]));
  const slots = (
    await weekSlotsOn(
      exec,
      onDay.map((p) => p.blockId),
      day,
    )
  ).sort((x, y) => programRank.get(x.blockId)! - programRank.get(y.blockId)! || x.idx - y.idx);
  const programOfBlock = new Map(onDay.map((p) => [p.blockId, p.programPublicId]));

  // ── The logged branch ───────────────────────────────────────────────────────────────────────────
  const logged = await loggedRows(exec, scope, profile.id, day);

  // The workouts whose live items show: every scheduled one, and a live workout that left the week.
  const scheduledIds = new Set(slots.map((s) => s.workoutId));
  const liveWorkoutIds = new Set([
    ...scheduledIds,
    ...logged.filter((r) => r.workoutId !== null && r.workoutLive).map((r) => r.workoutId!),
  ]);
  const prescriptions = await livePrescriptions(exec, [...liveWorkoutIds]);

  // E2: one movement read, under `movementIsAvailableTo`, for the live items and the logged rows.
  const movements = await availableMovements(
    exec,
    scope,
    [
      ...prescriptions.map((p) => p.movementId),
      ...logged.flatMap((r) => (r.movementId === null ? [] : [r.movementId])),
    ],
    supervisionBySlug(args.catalog),
  );

  // E3: a live entry with no live set is a broken row.
  const values = await readRowValues(
    exec,
    logged.map((r) => r.id),
  );
  for (const row of logged) {
    if (!values.has(row.id)) throw new Error(`program row entry ${row.id} has no live set`);
  }

  // Group the logged rows by workout: its id, or, once it is purged, its session.
  const byWorkout = new Map<string, LoggedRow[]>();
  for (const row of logged) {
    // E4 keeps a row without a movement out of the read; one here means the read lost it.
    if (row.movementId === null) throw new Error(`program row entry ${row.id} has no movement`);
    if (!movements.has(row.movementId)) continue; // E2
    const key = workoutKey(row);
    byWorkout.set(key, [...(byWorkout.get(key) ?? []), row]);
  }

  const drafts: WorkoutDraft[] = [
    ...slots.map((slot) => ({
      programPublicId: programOfBlock.get(slot.blockId)!,
      workoutPublicId: slot.workoutPublicId,
      label: slot.label,
      liveName: slot.name,
      description: slot.description,
      scheduled: true,
      showing: scheduledShowing,
      prescriptions: prescriptions.filter((p) => p.workoutId === slot.workoutId),
      rows: byWorkout.get(`w:${slot.workoutId}`) ?? [],
    })),
    // R6: the workouts that left the week, in the order their first row that day was logged.
    ...[...byWorkout.entries()]
      .filter(([key]) => !slots.some((s) => `w:${s.workoutId}` === key))
      .map(([, rows]) => {
        const [first] = rows;
        // C21: an id only for what is live: the program's while its block is live, the workout's
        // while it and its block are. C24: read from the live block itself, not the day's
        // assignments, so a live workout logged on a day no assignment covers any more keeps both
        // (its program is then not in `programs`).
        return {
          programPublicId: first.blockLive ? first.programPublicId : null,
          workoutPublicId: first.workoutLive ? first.workoutPublicId : null,
          // R2: a workout that left the week has no label.
          label: null,
          liveName: null,
          // C21: a hidden program's or workout's has none; one that only left the week keeps it.
          description: first.workoutLive ? first.workoutDescription : null,
          scheduled: false,
          showing: 'logged' as const,
          prescriptions:
            first.workoutId !== null && first.workoutLive
              ? prescriptions.filter((p) => p.workoutId === first.workoutId)
              : [],
          rows,
        };
      }),
  ];

  // PREVIOUS, one query for the day: on a writable day, for every live item's rows.
  const keys: PreviousKey[] = writable
    ? drafts.flatMap((d) =>
        liveItemsOf(d, movements).flatMap(({ prescription, movement }) =>
          setsOf(prescription, movement.trackingType, d.rows).map((set) => ({
            movementId: prescription.movementId,
            set,
          })),
        ),
      )
    : [];
  const previous = await previousRows(exec, profile.id, day, keys);

  const workouts = drafts
    .map((d) => dayWorkout(d, { movements, values, previous, writable }))
    // On a day that shows only logged rows, a workout with none is absent.
    .filter((w, i) => drafts[i].showing !== 'logged' || w.items.length > 0);

  return {
    profilePublicId: args.profilePublicId,
    day,
    today,
    writable,
    future,
    onProgram: onDay.length
      ? ON_PROGRAM.yes
      : current.length
        ? ON_PROGRAM['not-this-day']
        : ON_PROGRAM.never,
    canGoForward: day < today || assignments.some((a) => a.onNextDay),
    // C37: `endsToday` is present, and `true`, only on a program ending today (Amendment 5's rank);
    // absent on one that stays.
    currentPrograms: current.map((p) => ({
      programPublicId: p.programPublicId,
      name: p.name,
      ...(programEndsToday(p, today) ? { endsToday: true as const } : {}),
    })),
    programs: onDay.map((p) => ({
      programPublicId: p.programPublicId,
      name: p.name,
      order: p.order,
    })),
    workouts,
  };
}

// ── Programs ──────────────────────────────────────────────────────────────────────────────────────

export type ProgramOnDay = { blockId: number; programPublicId: string; name: string };

/**
 * A current program with its PLACING row's days (the row `currentPrograms` placed it by), so a reader
 * that shows "since" or "last day" (lane P's `readProgramView`) takes them from here instead of
 * re-deriving the rank rule.
 */
export type CurrentProgram = ProgramOnDay & { activeFrom: string; activeTo: string | null };

/**
 * `DayPlan.currentPrograms` (R7): each program the athlete is on now or starts later, ONCE, placed
 * by its open or upcoming row's `idx`, else by its closed row's (`schema.ts` → `programAssignments`).
 * **Ordered `(rank, idx, id)`** (ADR 0007 Amendment 5): every program that stays (an open or upcoming
 * row) comes before every program ending today, then by `idx`, then by row id.
 * Exported within `queries/day/` for step 6c's program order, its second consumer.
 */
/**
 * **A program ends today** (ADR 0007 Amendment 5; C37): its placing row has a last day and has
 * started. The one rule for `currentPrograms`' rank (such programs sort after every one that stays)
 * and for `DayPlan.currentPrograms[].endsToday`. Lane P's reorder writer (6d-ii) imports it too.
 */
export function programEndsToday(
  row: { activeFrom: string; activeTo: string | null },
  today: string,
): boolean {
  return row.activeTo !== null && row.activeFrom <= today;
}

export type CurrentProgramRow = Pick<
  DayAssignment,
  | 'id'
  | 'blockId'
  | 'programPublicId'
  | 'programName'
  | 'idx'
  | 'activeFrom'
  | 'activeTo'
  | 'current'
>;

export function currentPrograms(
  assignments: readonly CurrentProgramRow[],
  today: string,
): CurrentProgram[] {
  const placing = new Map<number, CurrentProgramRow>();
  // 0: an open row, or one starting after today; 1: a row closing today or later.
  const rank = (a: CurrentProgramRow) => (programEndsToday(a, today) ? 1 : 0);
  for (const a of assignments) {
    if (!a.current) continue;
    const held = placing.get(a.blockId);
    // `assignments` is in `(idx, id)` order, so the first row of a rank is its lowest.
    if (!held || rank(a) < rank(held)) placing.set(a.blockId, a);
  }
  // ⚠️ RANK FIRST (ADR 0007 Amendment 5, the maintainer, 2026-11-18). A put-on compacts the OPEN rows'
  // `idx` (`writers/program/assign.ts`) and leaves a row closing today where it was, so `(idx, id)`
  // could let an unrelated put-on swap two programs (lane P's #588 review). Ranking first keeps every
  // program that stays in its own `idx` order, whatever the ids, and puts the ones ending today after.
  return [...placing.values()]
    .sort((x, y) => rank(x) - rank(y) || x.idx - y.idx || x.id - y.id)
    .map((a) => ({
      blockId: a.blockId,
      programPublicId: a.programPublicId,
      name: a.programName,
      activeFrom: a.activeFrom,
      activeTo: a.activeTo,
    }));
}

/**
 * `DayPlan.programs` (R6, R7): the programs on the viewed day, once each. The current ones by their
 * `currentPrograms` order, then the ones since left, by `(idx, id)`.
 */
function programsOnDay(
  assignments: readonly DayAssignment[],
  orderOf: ReadonlyMap<number, number>,
): (ProgramOnDay & { order: number | null })[] {
  const seen = new Map<number, DayAssignment>();
  for (const a of assignments) if (a.onDay && !seen.has(a.blockId)) seen.set(a.blockId, a);
  const on = [...seen.values()];
  const ref = (a: DayAssignment) => ({
    blockId: a.blockId,
    programPublicId: a.programPublicId,
    name: a.programName,
    order: orderOf.get(a.blockId) ?? null,
  });
  return [
    ...on
      .filter((a) => orderOf.has(a.blockId))
      .sort((x, y) => orderOf.get(x.blockId)! - orderOf.get(y.blockId)!),
    ...on.filter((a) => !orderOf.has(a.blockId)),
  ].map(ref);
}

// ── The reads ─────────────────────────────────────────────────────────────────────────────────────

/**
 * **The day's logged program rows** (E1's logged anchor, E3, E4), in the order they were logged
 * (`created_at`, then id).
 *
 * Anchored on the athlete: `programRowOf(profileId, day)` ∧ a movement (E4) ∧ live (E3). Each row's
 * workout and prescription are LEFT JOINed through a SCOPED subquery, each joined to ITS OWN block
 * under `templateBlockIn(scope)` ∧ `programBlockOfProfile`. 🔴 **The drop is in the WHERE, on the raw
 * FK, testing the id the scoped subquery PROJECTS**: a pointer that is set but did not resolve in scope
 * is foreign (runbook (f), (g)), and the row is dropped. A NULL pointer (a purge) keeps the row, with
 * null ids (`day-shapes.ts`). An ON condition could only null the joined columns, never drop the row.
 */
async function loggedRows(exec: Executor, scope: HouseholdScope, profileId: number, day: string) {
  const e = schema.entries;
  const s = schema.sessions;
  const b = schema.programBlocks;
  const w = schema.workouts;
  const p = schema.prescriptions;

  const scopedWorkout = exec
    .select({
      id: w.id,
      publicId: w.publicId,
      description: w.description,
      blockId: w.blockId,
      programPublicId: sql<string>`${b.publicId}`.as('program_public_id'),
      blockLive: sql<boolean>`(${b.deletedAt} is null)`.as('block_live'),
      live: sql<boolean>`${workoutIsLive()}`.as('workout_live'),
    })
    .from(w)
    .innerJoin(b, eq(b.id, w.blockId))
    .where(athleteTemplateBlockIn(scope, profileId))
    .as('scoped_workout');
  const scopedPrescription = exec
    .select({ id: p.id, publicId: p.publicId })
    .from(p)
    .innerJoin(b, eq(b.id, p.blockId))
    .where(athleteTemplateBlockIn(scope, profileId))
    .as('scoped_prescription');

  return exec
    .select({
      id: e.id,
      publicId: e.publicId,
      set: e.prescriptionSet,
      createdAt: e.createdAt,
      snapshot: e.prescribedSnapshot,
      unit: e.unit,
      movementName: e.movementName,
      movementId: e.movementId,
      sessionId: s.id,
      frozenName: s.workoutName,
      workoutId: scopedWorkout.id,
      workoutPublicId: scopedWorkout.publicId,
      workoutDescription: scopedWorkout.description,
      workoutLive: scopedWorkout.live,
      workoutBlockId: scopedWorkout.blockId,
      programPublicId: scopedWorkout.programPublicId,
      blockLive: scopedWorkout.blockLive,
      prescriptionId: scopedPrescription.id,
      prescriptionPublicId: scopedPrescription.publicId,
    })
    .from(e)
    .leftJoin(s, eq(s.id, e.sessionId))
    .leftJoin(scopedWorkout, eq(scopedWorkout.id, s.workoutId))
    .leftJoin(scopedPrescription, eq(scopedPrescription.id, e.prescriptionId))
    .where(
      and(
        programRowOf(profileId, day),
        isNotNull(e.movementId),
        isNull(e.deletedAt),
        // The entry's session is this athlete's own (runbook pre-flight (i)): a session of another
        // profile never lends its frozen name.
        or(isNull(e.sessionId), eq(s.profileId, profileId)),
        or(isNull(s.workoutId), isNotNull(scopedWorkout.id)),
        or(isNull(e.prescriptionId), isNotNull(scopedPrescription.id)),
      ),
    )
    .orderBy(asc(e.createdAt), asc(e.id));
}

/**
 * The live prescriptions of these workouts, with their live quantities, in `(workout, idx)` order.
 * The workout ids come from the live anchor or the scoped workout subquery; the composite FK
 * (`prescriptions_workout_block_fkey`) keeps each prescription in its workout's block.
 */
async function livePrescriptions(
  exec: Executor,
  workoutIds: readonly number[],
): Promise<LivePrescription[]> {
  if (workoutIds.length === 0) return [];
  const p = schema.prescriptions;
  const q = schema.prescriptionQuantities;
  const rows = await exec
    .select({
      id: p.id,
      publicId: p.publicId,
      workoutId: p.workoutId,
      movementId: p.movementId,
      idx: p.idx,
      sets: p.sets,
      targetReps: p.targetReps,
      notes: p.notes,
      restAfter: p.restAfter,
      supersetLabel: p.supersetLabel,
      supersetOrder: p.supersetOrder,
      slot: q.slot,
      unit: q.unit,
      valueMin: q.valueMin,
      valueMax: q.valueMax,
    })
    .from(p)
    .leftJoin(q, and(eq(q.prescriptionId, p.id), isNull(q.deletedAt)))
    .where(and(inArray(p.workoutId, [...workoutIds]), isNull(p.deletedAt)))
    .orderBy(asc(p.workoutId), asc(p.idx), asc(p.id), asc(q.id));
  const byId = new Map<number, LivePrescription>();
  for (const r of rows) {
    let held = byId.get(r.id);
    if (!held) {
      held = { ...r, workoutId: r.workoutId!, quantities: [] };
      byId.set(r.id, held);
    }
    held.quantities.push({
      slot: r.slot,
      unit: r.unit,
      valueMin: r.valueMin,
      valueMax: r.valueMax,
    });
  }
  return [...byId.values()];
}

/** E2: the movements of these ids that the scope may use (`movementIsAvailableTo`), by id. */
async function availableMovements(
  exec: Executor,
  scope: HouseholdScope,
  ids: readonly number[],
  labels: ReadonlyMap<string, Supervision>,
): Promise<Map<number, Movement>> {
  const found = new Map<number, Movement>();
  if (ids.length === 0) return found;
  const m = schema.movements;
  const rows = await exec
    .select({
      id: m.id,
      publicId: m.publicId,
      name: m.name,
      trackingType: m.trackingType,
      slug: m.slug,
      householdId: m.householdId,
    })
    .from(m)
    .where(and(inArray(m.id, [...new Set(ids)]), movementIsAvailableTo(scope)));
  for (const r of rows) {
    // C32: only a GLOBAL movement (no household) reads the library; a household's own item on
    // the same slug never carries a label.
    const supervision = r.householdId === null ? labels.get(r.slug) : undefined;
    found.set(r.id, {
      publicId: r.publicId,
      name: r.name,
      trackingType: trackingTypeSchema.parse(r.trackingType),
      ...(supervision ? { supervision } : {}),
    });
  }
  return found;
}

/** C32: each library entry's label, by slug; an entry with none is left out. */
function supervisionBySlug(catalog: readonly CatalogMovement[]): Map<string, Supervision> {
  return new Map(catalog.flatMap((e) => (e.supervision ? [[e.slug, e.supervision] as const] : [])));
}

/** C32: the item's `supervision` key, present only when the movement carries a label. */
function supervisionOf(movement: Movement): Pick<DayItem, 'supervision'> {
  return movement.supervision ? { supervision: movement.supervision } : {};
}

// ── Assembly ──────────────────────────────────────────────────────────────────────────────────────

/** A workout the page lists, before its items are built. */
type WorkoutDraft = {
  programPublicId: string | null;
  workoutPublicId: string | null;
  label: string | null;
  /** The live name, for a scheduled workout; `null` for one that left the week. */
  liveName: string | null;
  description: string | null;
  scheduled: boolean;
  showing: Showing;
  prescriptions: LivePrescription[];
  /** Its live logged rows, in logged order, after E2. */
  rows: LoggedRow[];
};

function workoutKey(row: LoggedRow): string {
  if (row.workoutId !== null) return `w:${row.workoutId}`;
  if (row.sessionId === null) throw new Error(`program row entry ${row.id} has no session`);
  return `s:${row.sessionId}`;
}

/**
 * E6: a workout's live items in page order. A superset sits at its first member's `idx`; its members
 * are ordered by `(superset_order, idx)`. An item whose movement is not available is absent (E2).
 */
function liveItemsOf(draft: WorkoutDraft, movements: ReadonlyMap<number, Movement>) {
  const live = draft.prescriptions.flatMap((prescription) => {
    const movement = movements.get(prescription.movementId);
    return movement ? [{ prescription, movement }] : [];
  });
  const groupStart = new Map<string, number>();
  for (const { prescription: p } of live) {
    if (p.supersetLabel === null) continue;
    groupStart.set(p.supersetLabel, Math.min(groupStart.get(p.supersetLabel) ?? p.idx, p.idx));
  }
  const place = (p: LivePrescription) =>
    p.supersetLabel === null ? p.idx : groupStart.get(p.supersetLabel)!;
  return live.sort(
    ({ prescription: x }, { prescription: y }) =>
      place(x) - place(y) ||
      (x.supersetOrder ?? 0) - (y.supersetOrder ?? 0) ||
      x.idx - y.idx ||
      x.id - y.id,
  );
}

/** R3, R7: the prescribed sets 1..N (one row for a one-row type), then each LOGGED set beyond N. */
function setsOf(
  prescription: LivePrescription,
  trackingType: TrackingType,
  rows: readonly LoggedRow[],
): number[] {
  if (!hasSetRows(trackingType)) return [1];
  const prescribed = prescription.sets ?? 1;
  const extra = rows
    .filter((r) => r.prescriptionId === prescription.id && r.set! > prescribed)
    .map((r) => r.set!)
    .sort((a, b) => a - b);
  return [...Array.from({ length: prescribed }, (_, i) => i + 1), ...extra];
}

/** The first-logged of some rows: the lowest set where `bySet`, else the earliest; `created_at`, then id. */
function firstOf(rows: readonly LoggedRow[], bySet = false): LoggedRow | undefined {
  return [...rows].sort(byFirstLogged(bySet))[0];
}

function snapshotOf(row: LoggedRow): string {
  if (row.snapshot === null) throw new Error(`program row entry ${row.id} has no snapshot`);
  return row.snapshot;
}

function loggedOf(row: LoggedRow, values: ReadonlyMap<number, RowValues>): DayRow['logged'] {
  return {
    entryPublicId: row.publicId,
    values: values.get(row.id)!,
    prescribedText: snapshotOf(row),
  };
}

function dayWorkout(
  draft: WorkoutDraft,
  ctx: {
    movements: ReadonlyMap<number, Movement>;
    values: ReadonlyMap<number, RowValues>;
    previous: ReadonlyMap<string, RowValues>;
    writable: boolean;
  },
): DayWorkout {
  const { showing } = draft;
  const live = liveItemsOf(draft, ctx.movements);
  const items: DayItem[] = [];
  // Over the workout's live items, whatever `items` ends up showing.
  const progress = { done: 0, total: 0 };
  const claimed = new Set<number>();

  // The superset groups of the live items, in E6 order: `superset.order` is the place in the group.
  const members = new Map<string, LivePrescription[]>();
  for (const { prescription: p } of live) {
    if (p.supersetLabel === null) continue;
    members.set(p.supersetLabel, [...(members.get(p.supersetLabel) ?? []), p]);
  }

  for (const { prescription, movement } of live) {
    const mine = draft.rows.filter((r) => r.prescriptionId === prescription.id);
    for (const r of mine) claimed.add(r.id);
    const terms = prescriptionTerms({
      trackingType: movement.trackingType,
      sets: prescription.sets,
      targetReps: prescription.targetReps,
      quantities: liveQuantities(prescription.id, prescription.quantities),
    });
    const hasSets = hasSetRows(movement.trackingType);
    const all = setsOf(prescription, movement.trackingType, draft.rows).map((set) => {
      // R7: a one-row type has exactly one row, whatever its entries' set numbers.
      const entry = hasSets ? mine.find((r) => r.set === set) : firstOf(mine, true);
      return {
        set,
        previous: ctx.writable
          ? (ctx.previous.get(previousKey({ movementId: prescription.movementId, set })) ?? null)
          : null,
        logged: entry ? loggedOf(entry, ctx.values) : null,
      };
    });
    progress.total += all.length;
    progress.done += all.filter((row) => row.logged !== null).length;
    const rows =
      showing === 'preview'
        ? []
        : showing === 'all'
          ? all
          : all.filter((row) => row.logged !== null);
    if (showing === 'logged' && rows.length === 0) continue;

    const group = prescription.supersetLabel;
    items.push({
      prescriptionPublicId: prescription.publicId,
      itemPublicId: movement.publicId,
      name: movement.name,
      trackingType: movement.trackingType,
      ...supervisionOf(movement),
      // Where only logged rows show, the heading is what the first-logged row was logged against.
      prescribedText: showing === 'logged' ? snapshotOf(firstOf(mine)!) : terms.text,
      target: terms.target,
      notes: prescription.notes,
      unit: terms.unit,
      superset:
        group === null ? null : { group, order: members.get(group)!.indexOf(prescription) + 1 },
      rows,
    });
  }

  // R4: the rows logged against a prescription no longer live in this workout, one item per
  // prescription (the movement once it is purged), in first-logged order, after the live items.
  const removed = new Map<string, LoggedRow[]>();
  for (const row of draft.rows) {
    if (claimed.has(row.id)) continue;
    const key = programItemKey(row);
    removed.set(key, [...(removed.get(key) ?? []), row]);
  }
  for (const rows of removed.values()) {
    const first = firstOf(rows, true)!;
    const movement = ctx.movements.get(first.movementId!)!;
    items.push({
      prescriptionPublicId: null,
      itemPublicId: movement.publicId,
      name: first.movementName ?? movement.name,
      trackingType: movement.trackingType,
      // C32: it follows the MOVEMENT, so a removed prescription's item carries it too.
      ...supervisionOf(movement),
      prescribedText: snapshotOf(first),
      target: { reps: null, quantities: [] },
      notes: null,
      unit:
        TRACKING_TYPE_FIELDS[movement.trackingType].slot === null
          ? null
          : unitSchema.parse(first.unit),
      superset: null,
      rows: [...rows]
        .sort(byFirstLogged(true))
        .map((row) => ({ set: row.set!, previous: null, logged: loggedOf(row, ctx.values) })),
    });
  }

  // A rest only for a group of two or more with an item showing (D14), off its last member.
  const shown = new Set(items.flatMap((it) => (it.superset ? [it.superset.group] : [])));
  const restAfter: Record<string, string> = {};
  for (const [group, list] of members) {
    const rest = list[list.length - 1]!.restAfter;
    if (list.length > 1 && shown.has(group) && rest !== null) restAfter[group] = rest;
  }

  // R2: where only logged rows show, the session's frozen name; else the live one.
  const firstLogged = firstOf(draft.rows);
  const frozen = showing === 'logged' && firstLogged ? firstLogged.frozenName : null;
  const name = frozen ?? draft.liveName;
  if (name === null) throw new Error('a workout that left the week has no frozen name');
  return {
    programPublicId: draft.programPublicId,
    workoutPublicId: draft.workoutPublicId,
    label: draft.label,
    name,
    description: draft.description,
    scheduled: draft.scheduled,
    progress,
    items,
    restAfter,
  };
}
