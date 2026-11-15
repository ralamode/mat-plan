import type { Weekday } from '../../day';
import { TRACKING_TYPE, type TrackingType } from '../../movements';
import { SEED_PROFILE_2_NAME, SEED_PROFILE_NAME } from '../../seed-ids';
import type { FixtureItemKey } from './ids';

/**
 * The accepted prototype's data, transcribed from `docs/prototypes/beta-0/index.html` (v12):
 * `baseCatalog()`, `baseProgram()`, `stretchProgram()`, `adultProgram()` and `seed()`.
 *
 * Kept in the prototype's own shape and order on purpose, so this file can be read beside that
 * script and a difference is a transcription error. `./build` turns it into the contract's shapes.
 *
 * Every person here is synthetic: "Athlete One", "Athlete Two", "Adult One".
 */

/** The prototype's TODAY: a Saturday. */
export const FIXTURE_TODAY = '2026-11-14';
/** The Monday the household moved onto the family program (the prototype's SWITCH). */
export const FIXTURE_SWITCH_DAY = '2026-11-09';

/** A prescribed or logged number, by the prototype's field name. */
export type ProtoValues = {
  sets?: number;
  reps?: number;
  load?: number;
  sec?: number;
  min?: number;
  n?: number;
  dist?: number;
};

/**
 * `unit` is a string, not a `Unit`: the prototype's Easy run is prescribed in `mi`, which becomes a
 * unit in FAM-1 step 3. `./build` parses the unit where a fixture needs it, so the run fails loudly
 * if a fixture reaches it before then. None of the named fixtures does.
 */
export type ProtoItem = ProtoValues & {
  iid: FixtureItemKey;
  note: string;
  ss: string | null;
  unit?: string;
};

export type ProtoWorkout = {
  wid: string;
  name: string;
  desc: string;
  rests: Record<string, string>;
  items: ProtoItem[];
  /** Set on a copy: the source program's name, frozen, and the day it was copied. */
  from?: { prog: string; on: string };
};

export type ProtoProgram = {
  id: string;
  name: string;
  workouts: ProtoWorkout[];
  /** 0 = Sunday … 6 = Saturday. An empty day is a rest day. */
  week: Record<Weekday, Array<{ label: string; wid: string }>>;
};

/** One logged row (`cat: 'row'` in the prototype). Bodyweight and Life entries are lane S's. */
export type ProtoEntry = {
  /** The prototype's `e<n>`. */
  n: number;
  ath: string;
  day: string;
  /** A logged workout is keyed by its program and workout (the prototype's `slot`), never its position. */
  prog: string;
  wid: string;
  iid: FixtureItemKey;
  set: number;
  v: ProtoValues;
};

export type ProtoWorld = {
  today: string;
  athletes: Array<{ id: string; name: string }>;
  catalog: Record<FixtureItemKey, { name: string; type: TrackingType }>;
  programs: ProtoProgram[];
  /** Each person's programs, in their own order. `to` is the first day they are off it. */
  assign: Record<string, Array<{ prog: string; from: string; to?: string }>>;
  entries: ProtoEntry[];
};

const { check, count, reps, weight_reps, duration, time_sets, distance } = TRACKING_TYPE;

export function baseCatalog(): ProtoWorld['catalog'] {
  return {
    grip: { name: 'Grip: rice bucket', type: check },
    film: { name: 'Watch one technique clip', type: check },
    stance: { name: 'Stance-motion drill', type: check },
    neck: { name: 'Neck bridge', type: time_sets },
    splits: { name: 'Splits stretch', type: duration },
    pushups: { name: 'Push-ups', type: reps },
    vest: { name: 'Vest weight', type: count },
    dbbench: { name: 'DB bench press', type: weight_reps },
    pullup: { name: 'Pull-up', type: reps },
    goblet: { name: 'Goblet squat', type: weight_reps },
    sprawl: { name: 'Sprawls', type: reps },
    hollow: { name: 'Hollow-body hold', type: time_sets },
    pushpress: { name: 'Push press', type: weight_reps },
    invrow: { name: 'Inverted row', type: reps },
    splitsq: { name: 'Split squat', type: weight_reps },
    wallsit: { name: 'Wall sit', type: time_sets },
    rope: { name: 'Jump rope', type: duration },
    sprint: { name: 'Sprints', type: distance },
    burpee: { name: 'Burpees', type: reps },
    kbswing: { name: 'KB swings', type: weight_reps },
    boxjump: { name: 'Box jump', type: reps },
    plank: { name: 'Side plank', type: time_sets },
    squat: { name: 'Bodyweight squat', type: reps },
    run: { name: 'Easy run', type: distance },
    hamstring: { name: 'Hamstring stretch', type: duration },
    hipflex: { name: 'Hip-flexor stretch', type: duration },
  };
}

function mk(
  iid: FixtureItemKey,
  p: ProtoValues & { unit?: string },
  note = '',
  ss: string | null = null,
): ProtoItem {
  return { iid, note, ss, ...p };
}

export function baseProgram(): ProtoProgram {
  return {
    id: 'p1',
    name: 'Family program',
    workouts: [
      {
        wid: 'w1',
        name: 'Morning habits',
        desc: 'Before school. About 15 minutes.',
        rests: {},
        items: [
          mk('grip', {}, 'Two minutes each hand.'),
          mk('film', {}, 'One clip from this week. Say out loud what you noticed.'),
          mk('neck', { sets: 3, sec: 30 }, 'Front and back. Stop if anything pinches.'),
          mk('splits', { min: 5 }),
          mk('pushups', { sets: 3, reps: 15 }),
          mk('vest', { n: 10, unit: 'lb' }, 'Worn for the push-ups.'),
        ],
      },
      {
        wid: 'w2',
        name: 'Heavy A',
        desc: 'A1 then A2, rest, repeat. Then B. About 40 minutes.',
        rests: { a: '90 s after each round', b: '60 s after each round' },
        items: [
          mk('dbbench', { sets: 4, reps: 8, load: 25 }, 'Feet flat. Two seconds down.', 'a'),
          mk('pullup', { sets: 4, reps: 5 }, 'Full hang at the bottom.', 'a'),
          mk('goblet', { sets: 3, reps: 10, load: 30 }, '', 'b'),
          mk('sprawl', { sets: 3, reps: 10 }, 'Hips to the mat, then back to stance.', 'b'),
          mk('hollow', { sets: 3, sec: 20 }),
        ],
      },
      {
        wid: 'w3',
        name: 'Heavy B',
        desc: 'A1 then A2, rest, repeat. About 35 minutes.',
        rests: { a: '90 s after each round' },
        items: [
          mk('pushpress', { sets: 4, reps: 6, load: 20 }, '', 'a'),
          mk('invrow', { sets: 4, reps: 8 }, 'Body straight like a plank.', 'a'),
          mk('splitsq', { sets: 3, reps: 8, load: 15 }, 'Each side.'),
          mk('wallsit', { sets: 3, sec: 45 }),
        ],
      },
      {
        wid: 'w4',
        name: 'Conditioning',
        desc: 'Easy pace: you can still talk.',
        rests: {},
        items: [
          mk('rope', { min: 10 }),
          mk('sprint', { sets: 6, dist: 40, unit: 'yd' }, 'Walk back between each.'),
          mk('burpee', { sets: 3, reps: 10 }),
        ],
      },
    ],
    week: {
      0: [],
      1: [
        { label: 'Morning', wid: 'w1' },
        { label: 'After school', wid: 'w2' },
      ],
      2: [
        { label: 'Morning', wid: 'w1' },
        { label: 'After school', wid: 'w4' },
      ],
      3: [
        { label: 'Morning', wid: 'w1' },
        { label: 'After school', wid: 'w3' },
      ],
      4: [
        { label: 'Morning', wid: 'w1' },
        { label: 'After school', wid: 'w4' },
      ],
      5: [
        { label: 'Morning', wid: 'w1' },
        { label: 'After school', wid: 'w2' },
      ],
      6: [
        { label: 'Morning', wid: 'w1' },
        { label: 'After lunch', wid: 'w3' },
        { label: 'Evening', wid: 'w4' },
      ],
    },
  };
}

export function stretchProgram(): ProtoProgram {
  const evening = () => [{ label: 'Evening', wid: 'w5' }];
  return {
    id: 'p2',
    name: 'Stretching',
    workouts: [
      {
        wid: 'w5',
        name: 'Evening stretch',
        desc: 'Ten minutes, any time after dinner.',
        rests: {},
        items: [
          mk('hamstring', { min: 3 }),
          mk('hipflex', { min: 3 }, 'Each side.'),
          mk('splits', { min: 4 }),
        ],
      },
    ],
    week: {
      0: evening(),
      1: evening(),
      2: evening(),
      3: evening(),
      4: evening(),
      5: evening(),
      6: evening(),
    },
  };
}

export function adultProgram(): ProtoProgram {
  return {
    id: 'p3',
    name: 'Adult One’s program',
    workouts: [
      {
        wid: 'w6',
        name: 'Run and core',
        desc: '',
        rests: {},
        items: [
          mk('run', { sets: 1, dist: 2, unit: 'mi' }),
          mk('plank', { sets: 3, sec: 30 }, 'Each side.'),
        ],
      },
    ],
    week: {
      0: [],
      1: [],
      2: [{ label: 'Morning', wid: 'w6' }],
      3: [],
      4: [{ label: 'Morning', wid: 'w6' }],
      5: [],
      6: [{ label: 'Morning', wid: 'w6' }],
    },
  };
}

/**
 * The prototype's `seed()` entries, numbered as it numbers them.
 *
 * Its two Bodyweight and Life entries (`e48`, `e63`) take a number and are not kept: those sections
 * are lane S's, and a `DayPlan` holds workouts only.
 */
function seedEntries(): ProtoEntry[] {
  const entries: ProtoEntry[] = [];
  let n = 0;
  const skip = () => {
    n += 1;
  };
  function row(
    ath: string,
    day: string,
    program: string,
    wid: string,
    iid: FixtureItemKey,
    set: number,
    v: ProtoValues,
  ) {
    n += 1;
    entries.push({ n, ath, day, prog: program, wid, iid, set, v });
  }
  function sets(
    ath: string,
    day: string,
    program: string,
    wid: string,
    iid: FixtureItemKey,
    list: ProtoValues[],
  ) {
    list.forEach((v, i) => row(ath, day, program, wid, iid, i + 1, v));
  }
  /** Morning habits, as far as its first `upTo` items. */
  function morning(ath: string, day: string, upTo: number) {
    const all = [
      () => row(ath, day, 'p1', 'w1', 'grip', 1, {}),
      () => row(ath, day, 'p1', 'w1', 'film', 1, {}),
      () => sets(ath, day, 'p1', 'w1', 'neck', [{ sec: 30 }, { sec: 30 }, { sec: 25 }]),
      () => row(ath, day, 'p1', 'w1', 'splits', 1, { min: 5 }),
      () => sets(ath, day, 'p1', 'w1', 'pushups', [{ reps: 15 }, { reps: 15 }, { reps: 12 }]),
      () => row(ath, day, 'p1', 'w1', 'vest', 1, { n: 10 }),
    ];
    all.slice(0, upTo).forEach((log) => log());
  }

  // On the family program since Monday Nov 9.
  morning('a1', '2026-11-09', 6);
  sets('a1', '2026-11-09', 'p1', 'w2', 'dbbench', [
    { load: 25, reps: 8 },
    { load: 25, reps: 8 },
    { load: 25, reps: 8 },
    { load: 25, reps: 7 },
  ]);
  sets('a1', '2026-11-09', 'p1', 'w2', 'pullup', [
    { reps: 5 },
    { reps: 5 },
    { reps: 4 },
    { reps: 4 },
  ]);
  sets('a1', '2026-11-09', 'p1', 'w2', 'goblet', [
    { load: 30, reps: 10 },
    { load: 30, reps: 10 },
    { load: 30, reps: 10 },
  ]);
  sets('a1', '2026-11-09', 'p1', 'w2', 'sprawl', [{ reps: 10 }, { reps: 10 }, { reps: 10 }]);
  sets('a1', '2026-11-09', 'p1', 'w2', 'hollow', [{ sec: 20 }, { sec: 20 }, { sec: 15 }]);
  morning('a1', '2026-11-11', 4);
  sets('a1', '2026-11-11', 'p1', 'w3', 'pushpress', [
    { load: 20, reps: 6 },
    { load: 20, reps: 6 },
    { load: 20, reps: 6 },
    { load: 20, reps: 5 },
  ]);
  sets('a1', '2026-11-11', 'p1', 'w3', 'invrow', [
    { reps: 8 },
    { reps: 8 },
    { reps: 7 },
    { reps: 6 },
  ]);
  sets('a1', '2026-11-11', 'p1', 'w3', 'splitsq', [
    { load: 15, reps: 8 },
    { load: 15, reps: 8 },
    { load: 15, reps: 8 },
  ]);
  sets('a1', '2026-11-11', 'p1', 'w3', 'wallsit', [{ sec: 45 }, { sec: 40 }, { sec: 40 }]);
  skip(); // Athlete One's bodyweight on Nov 13
  morning('a1', '2026-11-13', 6);
  sets('a1', '2026-11-13', 'p1', 'w2', 'dbbench', [
    { load: 27.5, reps: 8 },
    { load: 27.5, reps: 8 },
  ]);
  sets('a1', '2026-11-13', 'p1', 'w2', 'pullup', [{ reps: 5 }, { reps: 5 }]);
  skip(); // Athlete One's wrestling practice on Nov 13
  morning('a1', '2026-11-14', 2);
  morning('a2', '2026-11-12', 3);
  // Stretching since Thursday Nov 12; Adult One on their own program.
  for (const day of ['2026-11-12', '2026-11-13']) {
    row('a1', day, 'p2', 'w5', 'hamstring', 1, { min: 3 });
    row('a1', day, 'p2', 'w5', 'hipflex', 1, { min: 3 });
    row('a1', day, 'p2', 'w5', 'splits', 1, { min: 4 });
  }
  row('a3', '2026-11-12', 'p3', 'w6', 'run', 1, { dist: 2 });
  sets('a3', '2026-11-12', 'p3', 'w6', 'plank', [{ sec: 30 }, { sec: 30 }, { sec: 25 }]);
  return entries;
}

export function seedWorld(): ProtoWorld {
  return {
    today: FIXTURE_TODAY,
    athletes: [
      // The seed's own made-up names, read from the constants that hold them. The prototype's third
      // person is Adult One, a name no constant holds.
      { id: 'a1', name: SEED_PROFILE_NAME },
      { id: 'a2', name: SEED_PROFILE_2_NAME },
      { id: 'a3', name: 'Adult One' },
    ],
    catalog: baseCatalog(),
    programs: [baseProgram(), stretchProgram(), adultProgram()],
    assign: {
      a1: [
        { prog: 'p1', from: FIXTURE_SWITCH_DAY },
        { prog: 'p2', from: '2026-11-12' },
      ],
      a2: [{ prog: 'p1', from: FIXTURE_SWITCH_DAY }],
      a3: [{ prog: 'p3', from: FIXTURE_SWITCH_DAY }],
    },
    entries: seedEntries(),
  };
}
