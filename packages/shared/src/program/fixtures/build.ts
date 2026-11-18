import {
  addDays,
  dayOpenFor,
  localWeekday,
  MONDAY_FIRST,
  type Weekday,
  WEEKDAYS,
  weekdaySchema,
} from '../../day';
import { CATALOG_FIXTURE } from '../../catalog/fixture';
import type { Supervision } from '../../catalog/vocabulary';
import { TRACKING_TYPE, type TrackingType } from '../../movements';
import { unitSchema, type Unit } from '../../units';
import { showsOnlyLogged, type DayItem, type DayPlan, type DayWorkout } from '../day-shapes';
import { prescribedTarget, TRACKING_TYPE_FIELDS, type RowValues } from '../pieces';
import { prescribedText } from '../prescribed-text';
import type { ProgramList, ProgramView, WorkoutDraft, WorkoutDraftItem } from '../program-shapes';
import { fixtureIds, type FixtureItemKey } from './ids';
import type {
  ProtoEntry,
  ProtoItem,
  ProtoProgram,
  ProtoValues,
  ProtoWorkout,
  ProtoWorld,
} from './world';

/**
 * Turns the transcribed prototype (`./world`) into the contract's shapes, by the prototype's own
 * rules: `vDayProgram`, `renderWorkout`, `renderCard`, `removedCards`, `previous`, `vProgram`,
 * `openStart`, `openCopy` and `vPrograms` in `docs/prototypes/beta-0/index.html`.
 *
 * Fixture support only. This is NOT the day resolver (step 12a) or a query (6a, 6c): those are
 * written against the database and must deep-equal what this produces, which is the test that the
 * two sides mean the same thing.
 *
 * Where the contract decides something the prototype does differently, the contract wins and the
 * line says so: PREVIOUS is `null` on a day that is not writable, a closed day lists only workouts
 * with a logged row, and a rest is carried only for a superset that has an item showing.
 */

/** What a logged row was logged against, frozen when it was logged (plan D7; the prototype's `stamp`). */
export type Stamp = {
  text: string;
  name: string;
  /** The workout's name when the row was logged: what the session freezes (`sessions.workout_name`). */
  workout: string;
  unit: Unit | null;
  values: RowValues;
};

/** A world whose entries carry their stamps. An edit to the program afterwards leaves them alone. */
export type World = ProtoWorld & { stamps: Record<number, Stamp> };

/** The prototype's name for each type's quantity (`it.load`, `it.sec`, …). */
const PROTO_FIELD: Record<TrackingType, keyof ProtoValues | null> = {
  check: null,
  count: 'n',
  reps: null,
  weight_reps: 'load',
  duration: 'min',
  time_sets: 'sec',
  distance: 'dist',
};

export function programOf(world: ProtoWorld, id: string): ProtoProgram {
  const program = world.programs.find((p) => p.id === id);
  if (!program) throw new Error(`fixture world: no program ${id}`);
  return program;
}

export function workoutOf(program: ProtoProgram, wid: string): ProtoWorkout {
  const workout = program.workouts.find((w) => w.wid === wid);
  if (!workout) throw new Error(`fixture world: no workout ${wid} in ${program.id}`);
  return workout;
}

function weekdayOf(day: string): Weekday {
  return weekdaySchema.parse(localWeekday(day));
}

/**
 * Today and yesterday (plan D32), and never for an archived athlete: the row writer refuses them, so
 * their day reads like a closed one (`DayPlan.writable`; maintainer, 2026-11-17).
 */
function isWritable(world: ProtoWorld, athlete: string, day: string): boolean {
  const archived = world.athletes.find((a) => a.id === athlete)?.archived === true;
  return dayOpenFor({ archived }, day, world.today);
}

/** The unit an item logs in: fixed by its type, or the one its prescription names. */
function unitOf(world: ProtoWorld, item: ProtoItem): Unit | null {
  const { type } = world.catalog[item.iid];
  const fields = TRACKING_TYPE_FIELDS[type];
  if (fields.slot === null) return null;
  if (fields.unit !== null) return fields.unit;
  // The prototype's weights are all in pounds; a Count and a Distance name their own unit.
  return type === TRACKING_TYPE.weight_reps ? 'lb' : unitSchema.parse(item.unit);
}

/** A prototype value set as the contract's `RowValues`, for an item of this type and unit. */
function rowValues(world: ProtoWorld, item: ProtoItem, v: ProtoValues): RowValues {
  const { type } = world.catalog[item.iid];
  const fields = TRACKING_TYPE_FIELDS[type];
  const unit = unitOf(world, item);
  const field = PROTO_FIELD[type];
  const value = field === null ? undefined : v[field];
  return {
    ...(fields.reps && v.reps !== undefined ? { reps: v.reps } : {}),
    quantities:
      fields.slot === null || unit === null || value === undefined
        ? []
        : [{ slot: fields.slot, unit, value }],
  };
}

/**
 * The library's coach label for an item, as a key to spread: `{ supervision }` for a library
 * movement whose entry carries one, `{}` otherwise (`DayItem.supervision` is absent, never `null`).
 * A world item that names a library entry must be that entry, by name and tracking type.
 */
function supervisionOf(world: ProtoWorld, key: FixtureItemKey): { supervision?: Supervision } {
  const { library, name, type } = world.catalog[key];
  if (library === undefined) return {};
  const entry = CATALOG_FIXTURE.find((movement) => movement.slug === library);
  if (!entry || entry.name !== name || entry.trackingType !== type) {
    throw new Error(`fixture world: ${key} is not the test library's ${library}`);
  }
  return entry.supervision === undefined ? {} : { supervision: entry.supervision };
}

function draftItem(world: ProtoWorld, workout: ProtoWorkout, item: ProtoItem): WorkoutDraftItem {
  const { name, type } = world.catalog[item.iid];
  const fields = TRACKING_TYPE_FIELDS[type];
  const index = workout.items.indexOf(item);
  const group = item.ss;
  const inGroup = (other: ProtoItem) => group !== null && other.ss === group;
  const isLastOfGroup = !workout.items.slice(index + 1).some(inGroup);
  return {
    prescriptionClientId: fixtureIds.prescriptionClient(workout.wid, item.iid),
    itemPublicId: fixtureIds.item(item.iid),
    itemName: name,
    trackingType: type,
    sets: fields.sets ? (item.sets ?? null) : null,
    targetReps: fields.reps && item.reps !== undefined ? String(item.reps) : null,
    // The prescribed numbers are the item's own fields, so they convert as a logged row's do.
    quantities: rowValues(world, item, item).quantities,
    notes: item.note || null,
    superset:
      group === null
        ? null
        : { group, order: workout.items.slice(0, index).filter(inGroup).length + 1 },
    restAfter: group !== null && isLastOfGroup ? (workout.rests[group] ?? null) : null,
  };
}

/** Stamp every entry against the program as it stands now. Call once, on the seeded world. */
export function stamped(world: ProtoWorld): World {
  const stamps: World['stamps'] = {};
  for (const entry of world.entries) {
    const program = programOf(world, entry.prog);
    const workout = workoutOf(program, entry.wid);
    const item = workout.items.find((it) => it.iid === entry.iid);
    // Adult One's Easy run is in `mi`, which is not a unit until step 3 (see `ProtoItem`). It gets no
    // stamp, and a fixture that reaches it throws in `stampOf` rather than inventing a unit.
    if (!item || (item.unit !== undefined && !unitSchema.safeParse(item.unit).success)) continue;
    stamps[entry.n] = {
      text: prescribedText(draftItem(world, workout, item)),
      name: world.catalog[item.iid].name,
      workout: workout.name,
      unit: unitOf(world, item),
      values: rowValues(world, item, entry.v),
    };
  }
  return { ...world, stamps };
}

function stampOf(world: World, entry: ProtoEntry): Stamp {
  const stamp = world.stamps[entry.n];
  if (!stamp)
    throw new Error(`fixture world: e${entry.n} has no stamp (its unit is not a unit yet)`);
  return stamp;
}

/** The athlete's assignments that are live on `day`, in their own order. */
function onPrograms(world: World, athlete: string, day: string) {
  return (world.assign[athlete] ?? []).filter((a) => day >= a.from && (!a.to || day < a.to));
}

/**
 * The athlete's current programs (on now, or starting later), in their own order, **a program
 * ending today after every one that stays** (ADR 0007 Amendment 5; contract change C37): the sort
 * is stable, so each group keeps the athlete's order. `to` is the first day OFF the program, so a
 * program ending today has `to` = tomorrow and has started.
 *
 * **A started program with a later end is not a state**: Take off is the only writer of an end, and
 * it ends on today. A world that holds one is refused here, so "has an end and has started", which
 * is how the day's read ranks a row, always means "ends today".
 */
function currentPrograms(world: World, athlete: string) {
  const current = (world.assign[athlete] ?? []).filter((a) => !a.to || a.to > world.today);
  const tomorrow = addDays(world.today, 1);
  for (const a of current) {
    if (a.to !== undefined && a.to !== tomorrow && a.from <= world.today) {
      throw new Error(
        `fixture world: ${a.prog} has started and ends after today, which no writer makes`,
      );
    }
  }
  return [
    ...current.filter((a) => !endsToday(world, a)),
    ...current.filter((a) => endsToday(world, a)),
  ];
}

/** Its last day is today: `to`, the first day off, is tomorrow, and it has started. */
function endsToday(world: World, a: { from: string; to?: string }): boolean {
  return a.to === addDays(world.today, 1) && a.from <= world.today;
}

function programRef(world: World, programId: string) {
  return {
    programPublicId: fixtureIds.program(programId),
    name: programOf(world, programId).name,
  };
}

/**
 * PREVIOUS: the same item and set number on the most recent earlier day. When the item was logged
 * twice that day (Splits stretch is in two workouts), the row logged first is the one, as the
 * prototype's scan finds it.
 *
 * `null` on a day that is not writable: the contract's rule. (The prototype still fills the
 * Previous column of a closed day's set rows; it hides "Last time" there.)
 */
function previous(world: World, athlete: string, iid: FixtureItemKey, set: number, day: string) {
  if (!isWritable(world, athlete, day)) return null;
  let best: ProtoEntry | null = null;
  for (const entry of world.entries) {
    if (entry.ath !== athlete || entry.iid !== iid || entry.set !== set || entry.day >= day)
      continue;
    if (!best || entry.day > best.day) best = entry;
  }
  return best ? stampOf(world, best).values : null;
}

function loggedRow(world: World, entry: ProtoEntry) {
  const stamp = stampOf(world, entry);
  return {
    entryPublicId: fixtureIds.entry(entry.n),
    values: stamp.values,
    prescribedText: stamp.text,
  };
}

/** `all`: a writable day. `logged`: a closed day, or a workout that left the week. `preview`: a future day. */
type Showing = 'all' | 'logged' | 'preview';

function dayWorkout(
  world: World,
  athlete: string,
  day: string,
  program: ProtoProgram,
  slot: { wid: string; label: string },
  scheduled: boolean,
  showing: Showing,
): DayWorkout {
  const workout = workoutOf(program, slot.wid);
  const logged = world.entries.filter(
    (e) => e.ath === athlete && e.day === day && e.prog === program.id && e.wid === workout.wid,
  );
  const items: DayItem[] = [];
  // Over the live items, whatever `items` ends up showing: the prototype's "6 of 10".
  const progress = { done: 0, total: 0 };

  for (const item of workout.items) {
    const draft = draftItem(world, workout, item);
    const mine = logged.filter((e) => e.iid === item.iid);
    // Every prescribed set, plus each LOGGED set beyond them (`DayItem.rows`): an added set is a row
    // only while it is logged, so a gap below a logged extra set is not a row and is not counted.
    // A type with one row (a Check, a Count, a Duration) has exactly that row.
    const hasSets = TRACKING_TYPE_FIELDS[draft.trackingType].sets;
    const prescribed = hasSets ? (item.sets ?? 1) : 1;
    const sets = [
      ...Array.from({ length: prescribed }, (_, i) => i + 1),
      ...mine
        .map((e) => e.set)
        .filter((set) => hasSets && set > prescribed)
        .sort((a, b) => a - b),
    ];
    progress.total += sets.length;
    progress.done += mine.length;
    const rows =
      showing === 'preview'
        ? []
        : sets
            .map((set) => {
              const entry = mine.find((e) => e.set === set);
              return {
                set,
                previous: previous(world, athlete, item.iid, set, day),
                logged: entry ? loggedRow(world, entry) : null,
              };
            })
            .filter((row) => showing === 'all' || row.logged !== null);
    if (showing === 'logged' && rows.length === 0) continue;

    // Where only logged rows show, the heading is what the item's first-logged row was logged
    // against (`DayItem.prescribedText`); each row still carries its own.
    const [firstLoggedRow] = [...mine].sort((x, y) => x.n - y.n);
    const heading =
      showing === 'logged' && firstLoggedRow
        ? stampOf(world, firstLoggedRow).text
        : prescribedText(draft);
    items.push({
      prescriptionPublicId: fixtureIds.prescription(workout.wid, item.iid),
      itemPublicId: draft.itemPublicId,
      name: draft.itemName,
      trackingType: draft.trackingType,
      ...supervisionOf(world, item.iid),
      prescribedText: heading,
      target: prescribedTarget(draft.targetReps, draft.quantities),
      notes: draft.notes,
      unit: unitOf(world, item),
      superset: draft.superset,
      rows,
    });
  }

  // Rows logged against an item that has since left the workout: built from the entry alone, with
  // no target, no instructions, no superset and no PREVIOUS (plan D7).
  const liveKeys = workout.items.map((it) => it.iid);
  const removedKeys = [...new Set(logged.map((e) => e.iid).filter((k) => !liveKeys.includes(k)))];
  for (const key of removedKeys) {
    const rows = logged.filter((e) => e.iid === key).sort((a, b) => a.set - b.set);
    const [firstRow] = rows;
    if (!firstRow) continue;
    const first = stampOf(world, firstRow);
    items.push({
      prescriptionPublicId: null,
      itemPublicId: fixtureIds.item(key),
      name: first.name,
      trackingType: world.catalog[key].type,
      // The label follows the movement, not the prescription that is gone.
      ...supervisionOf(world, key),
      prescribedText: first.text,
      target: { reps: null, quantities: [] },
      notes: null,
      unit: first.unit,
      superset: null,
      rows: rows.map((e) => ({ set: e.set, previous: null, logged: loggedRow(world, e) })),
    });
  }

  // A group left with one item is dissolved, and its rest goes with it (plan D14). And a rest is
  // carried only for a group that has an item showing: no rest for a superset that is not there.
  const groupSize = (group: string) => workout.items.filter((it) => it.ss === group).length;
  const shownGroups = new Set(items.map((it) => it.superset?.group));
  // Where only logged rows show, the name is the session's frozen one (`sessions.workout_name`,
  // plan D7: the page and the export agree), so a later rename does not rewrite an old day. Here
  // that is the first logged row's stamp: every stamp of a day carries the same workout name.
  const [firstLogged] = [...logged].sort((a, b) => a.n - b.n);
  const frozenName =
    showing === 'logged' && firstLogged ? stampOf(world, firstLogged).workout : null;
  return {
    programPublicId: fixtureIds.program(program.id),
    workoutPublicId: fixtureIds.workout(workout.wid),
    label: slot.label || null,
    name: frozenName ?? workout.name,
    description: workout.desc || null,
    scheduled,
    progress,
    items,
    restAfter: Object.fromEntries(
      Object.entries(workout.rests).filter(
        ([group]) => groupSize(group) > 1 && shownGroups.has(group),
      ),
    ),
  };
}

export function dayPlan(world: World, athlete: string, day: string): DayPlan {
  const writable = isWritable(world, athlete, day);
  const future = day > world.today;
  const current = currentPrograms(world, athlete);
  // One order for `programs` and for `workouts`: the programs the athlete is on this day, the
  // current ones in their own order, then any they have since come off, in theirs
  // (`DayPlan.programs`). **Current is a property of a program, not of an assignment row**: an
  // athlete taken off a program and put on it again is on a current program on a day of the
  // earlier stretch too, so this matches by program.
  const orderOf = (a: { prog: string }) => current.findIndex((c) => c.prog === a.prog);
  const onThatDay = onPrograms(world, athlete, day);
  const on = [
    ...onThatDay.filter((a) => orderOf(a) >= 0).sort((x, y) => orderOf(x) - orderOf(y)),
    ...onThatDay.filter((a) => orderOf(a) < 0),
  ];

  // The athlete's program order, then each program's own week order. A label never sorts.
  const slots = on.flatMap((a) => {
    const program = programOf(world, a.prog);
    return program.week[weekdayOf(day)].map((slot) => ({ program, slot, scheduled: true }));
  });
  // A workout logged on this day but no longer on the week still shows, after the others.
  for (const entry of world.entries) {
    if (entry.ath !== athlete || entry.day !== day) continue;
    const program = programOf(world, entry.prog);
    if (slots.some((s) => s.program === program && s.slot.wid === entry.wid)) continue;
    // No label: it was the slot's heading, and the slot is gone (maintainer, 2026-11-17). The
    // prototype shows the label the slot had; the database keeps a workout's name, not that.
    const slot = { wid: entry.wid, label: '' };
    slots.push({ program, slot, scheduled: false });
  }

  const showing = (scheduled: boolean): Showing =>
    future ? 'preview' : writable && scheduled ? 'all' : 'logged';
  return {
    profilePublicId: fixtureIds.athlete(athlete),
    day,
    today: world.today,
    writable,
    future,
    // The switcher's list, as the picker lists a household: an archived athlete is not in it,
    // their own day included (`DayPlan.athletes`).
    athletes: unarchived(world).map((a) => ({
      profilePublicId: fixtureIds.athlete(a.id),
      name: a.name,
    })),
    onProgram: on.length ? 'yes' : current.length ? 'not-this-day' : 'never',
    canGoForward: !(day >= world.today && onPrograms(world, athlete, addDays(day, 1)).length === 0),
    currentPrograms: current.map((a) => ({
      ...programRef(world, a.prog),
      // `to` is the first day OFF the program, so a program ending today has `to` = tomorrow.
      ...(endsToday(world, a) ? { endsToday: true as const } : {}),
    })),
    programs: on.map((a) => {
      const order = orderOf(a);
      return { ...programRef(world, a.prog), order: order < 0 ? null : order };
    }),
    workouts: slots
      .map((s) =>
        dayWorkout(world, athlete, day, s.program, s.slot, s.scheduled, showing(s.scheduled)),
      )
      // The contract's rule: where only what was logged shows, a workout nobody logged is not listed.
      .filter((workout) => !showsOnlyLogged({ writable, future }) || workout.items.length > 0),
  };
}

export function workoutDraft(world: World, programId: string, wid: string): WorkoutDraft {
  const workout = workoutOf(programOf(world, programId), wid);
  return {
    programPublicId: fixtureIds.program(programId),
    workoutClientId: fixtureIds.workoutClient(wid),
    workoutPublicId: fixtureIds.workout(wid),
    name: workout.name,
    description: workout.desc || null,
    items: workout.items.map((item) => draftItem(world, workout, item)),
  };
}

/** The household's athletes as every list shows them: the ones who are not archived. */
const unarchived = (world: World) => world.athletes.filter((a) => !a.archived);

export function programList(world: World): ProgramList {
  return world.programs.map((program) => ({
    ...programRef(world, program.id),
    // Who is on it, of the athletes who are not archived (C36): as every list of a household.
    athletes: unarchived(world)
      .filter((a) => currentPrograms(world, a.id).some((asg) => asg.prog === program.id))
      .map((a) => a.name),
  }));
}

export function programView(world: World, programId: string): ProgramView {
  const program = programOf(world, programId);
  const namesOf = (athlete: string) =>
    currentPrograms(world, athlete).map((a) => programOf(world, a.prog).name);
  const assignmentOf = (athlete: string) =>
    currentPrograms(world, athlete).find((a) => a.prog === programId);
  return {
    ...programRef(world, programId),
    today: world.today,
    // An archived athlete is in neither list (C36): their assignment stays, and so they are back
    // on the page when restored. Put on would refuse them, so they are no candidate either.
    athletes: unarchived(world).flatMap((a) => {
      const assignment = assignmentOf(a.id);
      if (!assignment) return [];
      return {
        profilePublicId: fixtureIds.athlete(a.id),
        name: a.name,
        since: assignment.from,
        lastDay: assignment.to ? addDays(assignment.to, -1) : null,
        alsoOn: namesOf(a.id).filter((name) => name !== program.name),
      };
    }),
    candidates: unarchived(world).map((a) => ({
      profilePublicId: fixtureIds.athlete(a.id),
      name: a.name,
      on: assignmentOf(a.id) !== undefined,
      keeps: namesOf(a.id),
    })),
    workouts: program.workouts.map((workout) => ({
      workoutPublicId: fixtureIds.workout(workout.wid),
      name: workout.name,
      itemCount: workout.items.length,
      // Monday first, as the program page lists a week.
      usedOn: MONDAY_FIRST.filter((k) => program.week[k].some((s) => s.wid === workout.wid)),
      copiedFrom: workout.from ? { programName: workout.from.prog, on: workout.from.on } : null,
    })),
    week: Object.fromEntries(
      WEEKDAYS.map((k) => [
        k,
        program.week[k].map((s) => ({
          workoutPublicId: fixtureIds.workout(s.wid),
          label: s.label || null,
        })),
      ]),
    ) as ProgramView['week'],
    otherPrograms: world.programs
      .filter((other) => other.id !== programId)
      .map((other) => programRef(world, other.id)),
  };
}

/**
 * The prototype's `normalize`: a group that is no longer one consecutive run splits, and a group
 * left with one item dissolves.
 */
export function normalizeSupersets(items: ProtoItem[]): void {
  const seen = new Set<string>();
  let prev: string | null = null;
  let n = 0;
  for (const item of items) {
    if (item.ss && item.ss !== prev && seen.has(item.ss)) item.ss = `${item.ss}_${++n}`;
    if (item.ss) seen.add(item.ss);
    prev = item.ss;
  }
  for (const item of items) {
    if (item.ss && items.filter((other) => other.ss === item.ss).length < 2) item.ss = null;
  }
}

/** A copy of the world to edit, with the same stamps: an edit never rewrites what was logged. */
export function edit(world: World, change: (draft: World) => void): World {
  const draft = structuredClone(world);
  change(draft);
  return draft;
}
