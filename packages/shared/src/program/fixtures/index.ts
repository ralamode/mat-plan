import { addDays, type Weekday } from '../../day';
import type { DayPlan } from '../day-shapes';
import type { ProgramList, ProgramView, WorkoutDraft } from '../program-shapes';
import {
  dayPlan,
  edit,
  normalizeSupersets,
  programList,
  programOf,
  programView,
  stamped,
  workoutDraft,
  workoutOf,
} from './build';
import { FIXTURE_ITEM_KEYS, fixtureIds } from './ids';
import {
  baseCatalog,
  baseProgram,
  FIXTURE_SWITCH_DAY,
  FIXTURE_TODAY,
  type ProtoItem,
  type ProtoProgram,
  seedWorld,
} from './world';

/**
 * The contract's named fixtures (FAM-1 plan §4, §8): **the accepted prototype's data, state for
 * state.** Each one is the state a prototype "Jump to…" entry shows, built from the transcription in
 * `./world` by the prototype's own rules in `./build`.
 *
 * Both sides test against them. A screen renders a fixture on the preview route; the data lane seeds
 * the state a fixture describes and asserts its query deep-equals it (through step 0c's normalizer).
 *
 * Every fixture is deep-frozen: one object is shared by every test in a process, so a consumer that
 * needs to change one clones it first (`structuredClone`).
 *
 * `picker-options` is not here: it uses the web's `MovementOptionDTO`, so it is step 0b's
 * (`apps/web/app/design/program/picker-options.ts`), built from `FIXTURE_ITEMS` below.
 */

export { FIXTURE_SWITCH_DAY, FIXTURE_TODAY } from './world';
export { FIXTURE_ITEM_KEYS, fixtureIds, type FixtureItemKey } from './ids';

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

const YESTERDAY = '2026-11-13';
const seeded = stamped(seedWorld());

// ── The item catalog ────────────────────────────────────────────────────────────────────────────

/**
 * The prototype's item catalog (`baseCatalog()`), in its order, under the contract's ids: every item
 * a fixture names, with its tracking type. The item picker's `picker-options` fixture is built from
 * this list, so an item has one id and one type on both sides of the picker.
 */
export const FIXTURE_ITEMS = deepFreeze(
  FIXTURE_ITEM_KEYS.map((key) => ({
    itemPublicId: fixtureIds.item(key),
    name: seeded.catalog[key].name,
    trackingType: seeded.catalog[key].type,
  })),
);

// ── DayPlan ─────────────────────────────────────────────────────────────────────────────────────

/** "Athlete One · today, on two programs": Saturday, three workouts and the evening stretch. */
export const todayTwoPrograms: DayPlan = deepFreeze(dayPlan(seeded, 'a1', FIXTURE_TODAY));

/** "Athlete One · yesterday, half done": Heavy A has two of four sets logged on its first superset. */
export const yesterdayHalfDone: DayPlan = deepFreeze(dayPlan(seeded, 'a1', YESTERDAY));

/** "Sunday": today is Sunday Nov 15. A rest day on the Family program; Stretching only. */
export const sundayRestStretchOnly: DayPlan = deepFreeze(
  dayPlan({ ...seeded, today: '2026-11-15' }, 'a1', '2026-11-15'),
);

/** "A new athlete, not on a program yet": a new test family with one athlete and no programs. */
export const noProgram: DayPlan = deepFreeze(
  dayPlan(
    stamped({
      today: FIXTURE_TODAY,
      athletes: [{ id: 'a9', name: 'Test Athlete' }],
      catalog: baseCatalog(),
      programs: [],
      assign: {},
      entries: [],
    }),
    'a9',
    FIXTURE_TODAY,
  ),
);

/**
 * The same day with Athlete One's programs in the other order: Stretching, then the Family program.
 * The evening stretch comes first, ahead of the workout labelled Morning, because order is the
 * athlete's and a label never sorts (plan D8). The prototype reaches it from "the order of their
 * programs", by moving Stretching up.
 */
export const todayStretchingFirst: DayPlan = deepFreeze(
  dayPlan(
    edit(seeded, (world) => {
      world.assign.a1?.reverse();
    }),
    'a1',
    FIXTURE_TODAY,
  ),
);

/**
 * Tomorrow, the nearest future day: read-only, always (plan D32). It is a Sunday, so only the
 * evening stretch is coming up.
 */
export const tomorrowReadOnly: DayPlan = deepFreeze(
  dayPlan(seeded, 'a1', addDays(FIXTURE_TODAY, 1)),
);

/**
 * "Not on a program on this day": Athlete One on the Sunday before the Family program started.
 * No "Jump to…" entry opens it; paging back from today reaches it.
 */
export const notOnAProgramThatDay: DayPlan = deepFreeze(dayPlan(seeded, 'a1', '2026-11-08'));

/**
 * Heavy A with nothing logged, so both supersets show every row and their rest: Athlete Two's
 * yesterday (a Friday), on the Family program alone. No "Jump to…" entry opens it; switching to
 * Athlete Two on yesterday does.
 */
export const heavyASupersets: DayPlan = deepFreeze(dayPlan(seeded, 'a2', YESTERDAY));

/**
 * "Yesterday, after the program was edited": the prototype's `edited` jump. After yesterday was
 * logged, Heavy A's bench went to 3 sets at 30 lb and lost Pull-up, and Morning habits' Push-ups went
 * to 2 sets. A logged row keeps what it was logged against; the third logged Push-ups set still
 * shows; Pull-up shows its logged rows as removed; the bench's unlogged third set shows the edit.
 */
export const yesterdayEditedAfterLogging: DayPlan = deepFreeze(
  dayPlan(
    edit(seeded, (world) => {
      const heavyA = workoutOf(programOf(world, 'p1'), 'w2');
      heavyA.items = heavyA.items.filter((item) => item.iid !== 'pullup');
      normalizeSupersets(heavyA.items);
      for (const item of heavyA.items) {
        if (item.iid === 'dbbench') Object.assign(item, { sets: 3, load: 30 });
      }
      for (const item of workoutOf(programOf(world, 'p1'), 'w1').items) {
        if (item.iid === 'pushups') item.sets = 2;
      }
    }),
    'a1',
    YESTERDAY,
  ),
);

/**
 * Heavy A was taken off Fridays after yesterday (a Friday) was logged. It still shows on that day,
 * after the scheduled workouts, with its logged rows only and `scheduled: false`. Its second
 * superset has no row logged, so neither its items nor its rest are here. The prototype renders
 * this state but has no "Jump to…" entry for it.
 */
export const workoutLeftTheWeek: DayPlan = deepFreeze(
  dayPlan(
    edit(seeded, (world) => {
      const week = programOf(world, 'p1').week;
      week[5] = week[5].filter((slot) => slot.wid !== 'w2');
    }),
    'a1',
    YESTERDAY,
  ),
);

/** "Athlete One · Nov 11 (closed day)": read-only, logged rows only. */
export const closedDayLoggedOnly: DayPlan = deepFreeze(dayPlan(seeded, 'a1', '2026-11-11'));

/** "Athlete One · look ahead to Monday": a future day. Items and prescriptions, no rows. */
export const futurePreview: DayPlan = deepFreeze(dayPlan(seeded, 'a1', '2026-11-16'));

/**
 * One item of each tracking type, in `TRACKING_TYPES` order, each with its first row logged as
 * prescribed. NOT a prototype state (no prototype workout holds exactly one of each): the items,
 * prescriptions and instructions are the prototype's, put in one workout of a program with no
 * earlier history, so every type's prescribed text, unit and logged row is in one small fixture.
 */
export const everyTypeOnce: DayPlan = deepFreeze(dayPlan(everyTypeWorld(), 'a1', FIXTURE_TODAY));

function everyTypeWorld() {
  const family = baseProgram();
  const from = (wid: string, iid: ProtoItem['iid']): ProtoItem => {
    const item = workoutOf(family, wid).items.find((it) => it.iid === iid);
    if (!item) throw new Error(`fixture world: no ${iid} in ${wid}`);
    return { ...item, ss: null };
  };
  const items = [
    from('w1', 'grip'),
    from('w1', 'vest'),
    from('w1', 'pushups'),
    from('w2', 'dbbench'),
    from('w1', 'splits'),
    from('w1', 'neck'),
    from('w4', 'sprint'),
  ];
  const everyDay = () => [{ label: '', wid: 'w900' }];
  const program: ProtoProgram = {
    id: 'p900',
    name: 'Every type',
    workouts: [{ wid: 'w900', name: 'One of each', desc: '', rests: {}, items }],
    week: {
      0: everyDay(),
      1: everyDay(),
      2: everyDay(),
      3: everyDay(),
      4: everyDay(),
      5: everyDay(),
      6: everyDay(),
    },
  };
  return stamped({
    ...seedWorld(),
    programs: [program],
    assign: { a1: [{ prog: 'p900', from: FIXTURE_SWITCH_DAY }] },
    // An empty ✓ on a prescribed row logs the prescription (plan D13).
    entries: items.map((item, i) => ({
      n: 901 + i,
      ath: 'a1',
      day: FIXTURE_TODAY,
      prog: 'p900',
      wid: 'w900',
      iid: item.iid,
      set: 1,
      v: item,
    })),
  });
}

// ── WorkoutDraft ────────────────────────────────────────────────────────────────────────────────

/** "Edit a workout: Heavy A, with supersets". */
export const heavyADraft: WorkoutDraft = deepFreeze(workoutDraft(seeded, 'p1', 'w2'));

/** "+ New workout" on the Family program: no name yet, no items, nothing saved. */
export const newWorkoutEmpty: WorkoutDraft = deepFreeze({
  programPublicId: fixtureIds.program('p1'),
  workoutClientId: fixtureIds.workoutClient('w1001'),
  workoutPublicId: null,
  name: '',
  description: null,
  items: [],
});

// ── ProgramList, ProgramView ────────────────────────────────────────────────────────────────────

/** "Programs: the list, with who's on each". */
export const programsList: ProgramList = deepFreeze(programList(seeded));

/** "One program": the Family program's page. Also what the Put-on and Copy dialogs open with. */
export const familyProgram: ProgramView = deepFreeze(programView(seeded, 'p1'));

/**
 * The Family program's page after "Take off" on Athlete Two, today: they stay listed until the end
 * of today, with today as their last day.
 */
export const familyProgramAfterTakeOff: ProgramView = deepFreeze(
  programView(
    edit(seeded, (world) => {
      const assignment = world.assign.a2?.find((a) => a.prog === 'p1');
      if (assignment) assignment.to = addDays(world.today, 1);
    }),
    'p1',
  ),
);

const emptyWeek = (): Record<Weekday, []> => ({ 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] });

/**
 * "Build a new program from scratch", right after it was created: nobody on it, no workouts, an
 * empty week.
 *
 * **A program is created by naming it** (`createProgram` takes the name), so there is no unnamed
 * program on the server and no fixture for one. The prototype's screen before that, an untitled
 * program with its name field open, holds nothing a query could return; this fixture is the first
 * state that does, under the prototype's placeholder name.
 */
export const newProgramEmpty: ProgramView = deepFreeze(
  programView(
    edit(seeded, (world) => {
      world.programs.push({ id: 'p1001', name: 'New program', workouts: [], week: emptyWeek() });
    }),
    'p1001',
  ),
);

/**
 * "A copied workout, showing where it came from": Conditioning copied from the Family program into
 * Adult One's, on Mondays, labelled Evening.
 */
export const adultProgramWithCopy: ProgramView = deepFreeze(
  programView(
    edit(seeded, (world) => {
      const copy = structuredClone(workoutOf(programOf(world, 'p1'), 'w4'));
      copy.wid = 'w1001';
      copy.from = { prog: 'Family program', on: world.today };
      const adult = programOf(world, 'p3');
      adult.workouts.push(copy);
      adult.week[1].push({ label: 'Evening', wid: copy.wid });
    }),
    'p3',
  ),
);

// ── The lists a suite iterates ──────────────────────────────────────────────────────────────────

export const DAY_PLAN_FIXTURES = {
  'today-two-programs': todayTwoPrograms,
  'yesterday-half-done': yesterdayHalfDone,
  'sunday-rest-stretch-only': sundayRestStretchOnly,
  'no-program': noProgram,
  'not-on-a-program-that-day': notOnAProgramThatDay,
  'today-stretching-first': todayStretchingFirst,
  'tomorrow-read-only': tomorrowReadOnly,
  'heavy-a-supersets': heavyASupersets,
  'yesterday-edited-after-logging': yesterdayEditedAfterLogging,
  'workout-left-the-week': workoutLeftTheWeek,
  'closed-day-logged-only': closedDayLoggedOnly,
  'future-preview': futurePreview,
  'every-type-once': everyTypeOnce,
} as const satisfies Record<string, DayPlan>;

export const WORKOUT_DRAFT_FIXTURES = {
  'heavy-a-draft': heavyADraft,
  'new-workout-empty': newWorkoutEmpty,
} as const satisfies Record<string, WorkoutDraft>;

export const PROGRAM_LIST_FIXTURES = {
  'programs-list': programsList,
} as const satisfies Record<string, ProgramList>;

export const PROGRAM_VIEW_FIXTURES = {
  'family-program': familyProgram,
  'family-program-after-take-off': familyProgramAfterTakeOff,
  'new-program-empty': newProgramEmpty,
  'adult-program-with-copy': adultProgramWithCopy,
} as const satisfies Record<string, ProgramView>;
