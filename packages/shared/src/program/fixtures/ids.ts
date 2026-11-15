/**
 * The contract fixtures' ids: one fixed UUID per entity, defined once, keyed by the id the accepted
 * prototype gives the same thing (`a1`, `p1`, `w2`, `dbbench`, `e17`), so a fixture can be read
 * beside the prototype's `seed()`.
 *
 * Placeholders, not rows: nothing seeds these ids. A query's result is compared with a fixture
 * through step 0c's normalizer, which maps real ids to stable labels on both sides.
 *
 * The UUID's last group says what the id names: a four-digit kind, then a number.
 */
const KIND = {
  athlete: 1,
  program: 2,
  workout: 3,
  item: 4,
  prescription: 5,
  prescriptionClient: 6,
  workoutClient: 7,
  entry: 8,
} as const;

function fixtureId(kind: number, n: number): string {
  return `00000000-0000-7000-8000-${String(kind).padStart(4, '0')}${String(n).padStart(8, '0')}`;
}

/** The trailing number of a prototype id: `w2` → 2, `p1001` → 1001. */
function ordinal(protoId: string): number {
  return Number(protoId.replace(/^\D+/, ''));
}

/** The prototype's catalog keys, in its order. An item's number is its place in this list. */
export const FIXTURE_ITEM_KEYS = [
  'grip',
  'film',
  'stance',
  'neck',
  'splits',
  'pushups',
  'vest',
  'dbbench',
  'pullup',
  'goblet',
  'sprawl',
  'hollow',
  'pushpress',
  'invrow',
  'splitsq',
  'wallsit',
  'rope',
  'sprint',
  'burpee',
  'kbswing',
  'boxjump',
  'plank',
  'squat',
  'run',
  'hamstring',
  'hipflex',
] as const;
export type FixtureItemKey = (typeof FIXTURE_ITEM_KEYS)[number];

function itemNumber(key: FixtureItemKey): number {
  return FIXTURE_ITEM_KEYS.indexOf(key) + 1;
}

export const fixtureIds = {
  /** `a1` Athlete One, `a2` Athlete Two, `a3` Adult One; `a9` is the new family's Test Athlete. */
  athlete: (protoId: string) => fixtureId(KIND.athlete, ordinal(protoId)),
  /** `p1` Family program, `p2` Stretching, `p3` Adult One’s program. */
  program: (protoId: string) => fixtureId(KIND.program, ordinal(protoId)),
  workout: (protoId: string) => fixtureId(KIND.workout, ordinal(protoId)),
  workoutClient: (protoId: string) => fixtureId(KIND.workoutClient, ordinal(protoId)),
  item: (key: FixtureItemKey) => fixtureId(KIND.item, itemNumber(key)),
  /** A prescription is an item in a workout: the workout's number, then the item's. */
  prescription: (workoutProtoId: string, key: FixtureItemKey) =>
    fixtureId(KIND.prescription, ordinal(workoutProtoId) * 100 + itemNumber(key)),
  prescriptionClient: (workoutProtoId: string, key: FixtureItemKey) =>
    fixtureId(KIND.prescriptionClient, ordinal(workoutProtoId) * 100 + itemNumber(key)),
  /** The prototype numbers its seeded entries `e1`, `e2`, … in the order `seed()` logs them. */
  entry: (n: number) => fixtureId(KIND.entry, n),
};
