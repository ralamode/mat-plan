import { addDays, localWeekday, WEEKDAYS, weekdaySchema, type Weekday } from '../../day';
import { TRACKING_TYPE } from '../../movements';
import { QUANTITY_SLOT, type QuantitySlot } from '../../quantity-slots';
import { unitSchema, type Unit } from '../../units';
import type { DayPlan } from '../day-shapes';
import { hasSetRows, type RowValues } from '../pieces';
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
 * `openStart` and `vPrograms` in `docs/prototypes/beta-0/index.html`.
 *
 * Fixture support only. This is NOT the day resolver (step 12a) or a query (6a, 6c): those are
 * written against the database and must deep-equal what this produces, which is the test that the
 * two sides mean the same thing.
 */

type DayWorkout = DayPlan['workouts'][number];
type DayItem = DayWorkout['items'][number];

/** What a logged row was logged against, frozen when it was logged (plan D7; the prototype's `stamp`). */
type Stamp = { text: string; name: string; label: string; unit: Unit | null; values: RowValues };

/** A world whose entries carry their stamps. An edit to the program afterwards leaves them alone. */
export type World = ProtoWorld & { stamps: Record<number, Stamp> };

/** Monday first, as the program page lists a week. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const satisfies readonly Weekday[];

function programOf(world: ProtoWorld, id: string): ProtoProgram {
  const program = world.programs.find((p) => p.id === id);
  if (!program) throw new Error(`fixture world: no program ${id}`);
  return program;
}

function workoutOf(program: ProtoProgram, wid: string): ProtoWorkout {
  const workout = program.workouts.find((w) => w.wid === wid);
  if (!workout) throw new Error(`fixture world: no workout ${wid} in ${program.id}`);
  return workout;
}

function weekdayOf(day: string): Weekday {
  return weekdaySchema.parse(localWeekday(day));
}

/** The unit an item logs in: fixed by its type, or the one its prescription names. */
function unitOf(world: ProtoWorld, item: ProtoItem): Unit | null {
  switch (world.catalog[item.iid].type) {
    case TRACKING_TYPE.weight_reps:
      return 'lb';
    case TRACKING_TYPE.time_sets:
      return 'sec';
    case TRACKING_TYPE.duration:
      return 'min';
    case TRACKING_TYPE.count:
    case TRACKING_TYPE.distance:
      return unitSchema.parse(item.unit);
    case TRACKING_TYPE.check:
    case TRACKING_TYPE.reps:
      return null;
  }
}

/** A prototype value set as the contract's `RowValues`, for an item of this type and unit. */
function rowValues(world: ProtoWorld, item: ProtoItem, v: ProtoValues): RowValues {
  const unit = unitOf(world, item);
  const one = (slot: QuantitySlot, value: number | undefined) =>
    unit === null || value === undefined ? [] : [{ slot, unit, value }];
  const reps = v.reps === undefined ? {} : { reps: v.reps };
  switch (world.catalog[item.iid].type) {
    case TRACKING_TYPE.check:
      return { quantities: [] };
    case TRACKING_TYPE.reps:
      return { ...reps, quantities: [] };
    case TRACKING_TYPE.weight_reps:
      return { ...reps, quantities: one(QUANTITY_SLOT.primary, v.load) };
    case TRACKING_TYPE.time_sets:
      return { quantities: one(QUANTITY_SLOT.primary, v.sec) };
    case TRACKING_TYPE.duration:
      return { quantities: one(QUANTITY_SLOT.primary, v.min) };
    case TRACKING_TYPE.count:
      return { quantities: one(QUANTITY_SLOT.primary, v.n) };
    case TRACKING_TYPE.distance:
      return { quantities: one(QUANTITY_SLOT.distance, v.dist) };
  }
}

function draftItem(world: ProtoWorld, workout: ProtoWorkout, item: ProtoItem): WorkoutDraftItem {
  const { name, type } = world.catalog[item.iid];
  const index = workout.items.indexOf(item);
  const group = item.ss;
  const inGroup = (other: ProtoItem) => group !== null && other.ss === group;
  const isLastOfGroup = !workout.items.slice(index + 1).some(inGroup);
  return {
    prescriptionClientId: fixtureIds.prescriptionClient(workout.wid, item.iid),
    itemPublicId: fixtureIds.item(item.iid),
    itemName: name,
    trackingType: type,
    sets: hasSetRows(type) ? (item.sets ?? null) : null,
    targetReps: item.reps === undefined ? null : String(item.reps),
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
    const slot = program.week[weekdayOf(entry.day)].find((s) => s.wid === entry.wid);
    stamps[entry.n] = {
      text: prescribedText(draftItem(world, workout, item)),
      name: world.catalog[item.iid].name,
      label: slot?.label ?? '',
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

/** The athlete's current programs (not ended as of today), in their own order. */
function currentPrograms(world: World, athlete: string) {
  return (world.assign[athlete] ?? []).filter((a) => !a.to || a.to > world.today);
}

/**
 * PREVIOUS: the same item and set number on the most recent earlier day. When the item was logged
 * twice that day (Splits stretch is in two workouts), the row logged first is the one, as the
 * prototype's scan finds it.
 */
function previous(world: World, athlete: string, iid: FixtureItemKey, set: number, day: string) {
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

  for (const item of workout.items) {
    const draft = draftItem(world, workout, item);
    const mine = logged.filter((e) => e.iid === item.iid);
    const count = hasSetRows(draft.trackingType)
      ? Math.max(item.sets ?? 1, ...mine.map((e) => e.set))
      : 1;
    const rows =
      showing === 'preview'
        ? []
        : Array.from({ length: count }, (_, i) => i + 1)
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

    const live = prescribedText(draft);
    // Where only logged rows show, the heading is what they were logged against.
    const loggedAgainst =
      showing === 'logged'
        ? mine.map((e) => stampOf(world, e).text).find((t) => t !== live)
        : undefined;
    items.push({
      prescriptionPublicId: fixtureIds.prescription(workout.wid, item.iid),
      itemPublicId: draft.itemPublicId,
      name: draft.itemName,
      trackingType: draft.trackingType,
      prescribedText: loggedAgainst ?? live,
      notes: draft.notes,
      unit: unitOf(world, item),
      superset: draft.superset,
      rows,
    });
  }

  // Rows logged against an item that has since left the workout: built from the entry alone, with
  // no instructions, no superset and no PREVIOUS (plan D7).
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
      prescribedText: first.text,
      notes: null,
      unit: first.unit,
      superset: null,
      rows: rows.map((e) => ({ set: e.set, previous: null, logged: loggedRow(world, e) })),
    });
  }

  // A group left with one item is dissolved, and its rest goes with it (plan D14).
  const groupSize = (group: string) => workout.items.filter((it) => it.ss === group).length;
  return {
    programPublicId: fixtureIds.program(program.id),
    workoutPublicId: fixtureIds.workout(workout.wid),
    label: slot.label || null,
    name: workout.name,
    description: workout.desc || null,
    scheduled,
    items,
    restAfter: Object.fromEntries(
      Object.entries(workout.rests).filter(([group]) => groupSize(group) > 1),
    ),
  };
}

export function dayPlan(world: World, athlete: string, day: string): DayPlan {
  const writable = day === world.today || day === addDays(world.today, -1);
  const future = day > world.today;
  const on = onPrograms(world, athlete, day);

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
    const slot = { wid: entry.wid, label: stampOf(world, entry).label };
    slots.push({ program, slot, scheduled: false });
  }

  const showing = (scheduled: boolean): Showing =>
    future ? 'preview' : writable && scheduled ? 'all' : 'logged';
  return {
    profilePublicId: fixtureIds.athlete(athlete),
    day,
    writable,
    future,
    athletes: world.athletes.map((a) => ({
      profilePublicId: fixtureIds.athlete(a.id),
      name: a.name,
    })),
    onProgram: on.length
      ? 'yes'
      : currentPrograms(world, athlete).length
        ? 'not-this-day'
        : 'never',
    canGoForward: !(day >= world.today && onPrograms(world, athlete, addDays(day, 1)).length === 0),
    programs: on.map((a, order) => ({
      programPublicId: fixtureIds.program(a.prog),
      name: programOf(world, a.prog).name,
      order,
    })),
    workouts: slots.map((s) =>
      dayWorkout(world, athlete, day, s.program, s.slot, s.scheduled, showing(s.scheduled)),
    ),
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

export function programList(world: World): ProgramList {
  return world.programs.map((program) => ({
    programPublicId: fixtureIds.program(program.id),
    name: program.name,
    athletes: world.athletes
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
    programPublicId: fixtureIds.program(program.id),
    name: program.name,
    athletes: world.athletes.flatMap((a) => {
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
    candidates: world.athletes.map((a) => ({
      profilePublicId: fixtureIds.athlete(a.id),
      name: a.name,
      on: assignmentOf(a.id) !== undefined,
      keeps: namesOf(a.id),
    })),
    workouts: program.workouts.map((workout) => ({
      workoutPublicId: fixtureIds.workout(workout.wid),
      name: workout.name,
      itemCount: workout.items.length,
      usedOn: WEEK_ORDER.filter((k) => program.week[k].some((s) => s.wid === workout.wid)),
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

export { programOf, workoutOf };
