import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Every write in `entries.ts` and `profiles.ts` sends a thrown database error through
 * `quietDbErrors` (V1-9b B1-2; the tech-debt row "A failed query's params reach Vercel's runtime
 * logs"). Each writer is mocked to throw the way drizzle does, with the row's values in the message
 * and the driver's `detail`; what reaches the action must be a `DbWriteError` that carries none of
 * them. The helper itself is `quiet-db-errors.test.ts`'s.
 */
const LEAK = 'LEAK-112.4';
class DrizzleQueryError extends Error {}
const dbFailure = () =>
  new DrizzleQueryError(`Failed query: insert into "entries" …\nparams: ${LEAK}`, {
    cause: Object.assign(new Error(`duplicate key ${LEAK}`), {
      code: '23505',
      detail: `Key (value_num)=(${LEAK}) already exists.`,
    }),
  });

const { writers, state } = vi.hoisted(() => {
  const names = [
    'insertBodyweightEntry',
    'writeCheckinEntries',
    'writeStrengthSession',
    'updateBodyweightEntryById',
    'clearBodyweight',
    'clearPractice',
    'updatePracticeEntryById',
    'updateStrengthSetById',
    'restoreClear',
    'clearDay',
    'renameProfile',
    'archiveProfile',
    'restoreProfile',
    'createProfile',
    'resolveSessionMovements',
  ] as const;
  return {
    writers: Object.fromEntries(names.map((n) => [n, vi.fn()])) as Record<
      (typeof names)[number],
      ReturnType<typeof vi.fn>
    >,
    state: { scope: { householdId: 1 } as unknown },
  };
});

const PROFILE_ROW = {
  publicId: '019826b4-0000-7000-8000-000000000001',
  name: 'Athlete One',
  kind: 'kid',
  avatar: null,
  routineConfig: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  archivedAt: null,
  hasEntries: false,
};

/** A drizzle-shaped builder: every call returns itself; awaiting it runs `settle`. */
function builder(settle: () => Promise<unknown>): unknown {
  const self: unknown = new Proxy(() => {}, {
    get: (_t, prop) =>
      prop === 'then'
        ? (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => settle().then(ok, fail)
        : () => self,
  });
  return self;
}

vi.mock('./db', () => ({
  db: {
    select: () => builder(async () => [PROFILE_ROW]),
    update: () =>
      builder(async () => {
        throw dbFailure();
      }),
  },
}));
vi.mock('./household', () => ({
  getHouseholdScope: async () => state.scope,
  reportScopeMiss: vi.fn(),
  reportAuthorityRefusal: vi.fn(),
  AUTHORITY_ACTION: { archiveProfile: 'archive_profile' },
  SCOPE_MISS_ACTION: { resolveProfile: 'resolve_profile' },
}));
vi.mock('./catalog', () => ({
  getActivityTypeIdByKey: async () => 1,
  assertMetricKeyExists: async () => undefined,
  getActivityTypeByKey: async () => ({ id: 1, defaultUnit: 'count' }),
  getMetricDefinition: async () => ({ unit: 'count' }),
}));
vi.mock('@/lib/routine/catalog', () => ({ resolveProfileRoutine: () => null }));
vi.mock('@mat-plan/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@mat-plan/db')>()),
  ...writers,
  ownerScope: (scope: unknown) => scope,
}));

import * as entries from './entries';
import * as profiles from './profiles';
import { DbWriteError } from './quiet-db-errors';

const ID = PROFILE_ROW.publicId;
const ENTRY = '019826b4-0000-7000-8000-000000000101';
const CLIENT = '019826b4-0000-7000-8000-000000000201';

const WRITES: [string, () => Promise<unknown>][] = [
  [
    'logBodyweight',
    () =>
      entries.logBodyweight({
        profilePublicId: ID,
        clientId: CLIENT,
        day: '2026-11-17',
        unit: 'lb',
        value: 112.4,
      } as Parameters<typeof entries.logBodyweight>[0]),
  ],
  [
    'logCheckinEntries',
    () =>
      entries.logCheckinEntries({
        profilePublicId: ID,
        day: '2026-11-17',
        items: [{ activityKey: 'a', metricKey: null, value: 1, clientId: CLIENT }],
      }),
  ],
  [
    'logStrengthSession',
    () =>
      entries.logStrengthSession({
        profilePublicId: ID,
        sessionType: 'lift',
        clientId: CLIENT,
        day: '2026-11-17',
        movements: [],
      }),
  ],
  [
    'editBodyweight',
    () =>
      entries.editBodyweight({
        profilePublicId: ID,
        entryId: ENTRY,
        value: 1,
        unit: 'lb',
        seenValue: 2,
      }),
  ],
  [
    'clearBodyweightEntry',
    () =>
      entries.clearBodyweightEntry({
        profilePublicId: ID,
        entryId: ENTRY,
        unit: 'lb',
        seenValue: 2,
      }),
  ],
  [
    'clearPracticeEntry',
    () => entries.clearPracticeEntry({ profilePublicId: ID, entryId: ENTRY, seenValue: 2 }),
  ],
  [
    'editPractice',
    () => entries.editPractice({ profilePublicId: ID, entryId: ENTRY, minutes: 1, seenValue: 2 }),
  ],
  [
    'editStrengthSet',
    () => entries.editStrengthSet({ profilePublicId: ID, setId: ENTRY, reps: 5, weight: 100 }),
  ],
  [
    'restoreClearedDay',
    () =>
      entries.restoreClearedDay({
        profilePublicId: ID,
        day: '2026-11-17',
        hiddenAt: '2026-11-17T18:04:05.123456Z',
      }),
  ],
  ['clearDayEntries', () => entries.clearDayEntries({ profilePublicId: ID, day: '2026-11-17' })],
  ['updateProfileRoutine', () => profiles.updateProfileRoutine(ID, {} as never)],
  ['renameAthlete', () => profiles.renameAthlete(ID, 'New Name')],
  ['archiveAthlete', () => profiles.archiveAthlete(ID)],
  ['restoreAthlete', () => profiles.restoreAthlete(ID)],
  ['createAthlete', () => profiles.createAthlete({ name: 'New', kind: 'kid' } as never)],
];

/**
 * Every other export of the two modules, with why it is not a write. Its parameters are ids, a day
 * or a household's own scope, never a logged value, so its failure has nothing to leak.
 */
const READS: Record<string, string> = {
  listEntriesForDay: "a day's rows: a profile id and a day",
  ownedBodyweightValue: "an entry's value: ids only",
  bodyweightRowDay: "an entry's day: ids only",
  practiceRowDay: "an entry's day: ids only",
  ownedPracticeMinutes: "an entry's minutes: ids only",
  lastBodyweight: 'the last weigh-in: a profile id and a day',
  dayClearEvents: "a day's clears: a profile id and a day",
  listProfiles: "the household's athletes: the scope only",
  listHouseholdAthletes: "the household's athletes: the scope only",
  getProfileByPublicId: 'one athlete: a profile id',
};

beforeEach(() => {
  state.scope = { householdId: 1 };
  for (const fn of Object.values(writers)) fn.mockReset().mockRejectedValue(dbFailure());
  // The session cases reach `writeStrengthSession`; the find-or-create has its own case below.
  writers.resolveSessionMovements.mockReset().mockResolvedValue([]);
});

describe('a failed write carries no data out (V1-9b B1-2)', () => {
  it.each(WRITES)('%s rethrows a DbWriteError with no value in it', async (operation, call) => {
    const thrown = await call().catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(DbWriteError);
    const error = thrown as DbWriteError;
    expect(error.message).toBe(`${operation} failed (DrizzleQueryError, SQLSTATE 23505)`);
    expect(String(error.stack)).not.toContain(LEAK);
    expect(error.cause).toBeUndefined();
  });

  // A new export fails here until it is classified: wrapped and in WRITES, or a read in READS.
  it('every function either module exports is a write in WRITES or a read in READS', () => {
    const exported = [...Object.entries(entries), ...Object.entries(profiles)]
      .filter(([, value]) => typeof value === 'function')
      .map(([name]) => name)
      .sort();
    const classified = [...WRITES.map(([name]) => name), ...Object.keys(READS)].sort();
    expect(exported).toEqual(classified);
  });

  it("a typed name's find-or-create INSERT rethrows under its own name, before the session", async () => {
    writers.resolveSessionMovements.mockReset().mockRejectedValue(dbFailure());
    const thrown = await entries
      .logStrengthSession({
        profilePublicId: ID,
        sessionType: 'lift',
        clientId: CLIENT,
        day: '2026-11-17',
        movements: [],
      })
      .catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(DbWriteError);
    expect((thrown as Error).message).toBe(
      'logStrengthSession.resolveMovements failed (DrizzleQueryError, SQLSTATE 23505)',
    );
    expect(String((thrown as Error).stack)).not.toContain(LEAK);
    expect(writers.writeStrengthSession).not.toHaveBeenCalled();
  });

  it('a missing scope is still the plain refusal, never a DbWriteError', async () => {
    state.scope = null;
    const thrown = await entries
      .restoreClearedDay({
        profilePublicId: ID,
        day: '2026-11-17',
        hiddenAt: '2026-11-17T18:04:05.123456Z',
      })
      .catch((error: unknown) => error);
    expect(thrown).not.toBeInstanceOf(DbWriteError);
    expect((thrown as Error).message).toBe('Profile not found');
    expect(writers.restoreClear).not.toHaveBeenCalled();
  });
});
