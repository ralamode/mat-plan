import assert from 'node:assert/strict';

import {
  ENTRY_KIND,
  ENTRY_STATUS,
  newId,
  SEED_ACTIVITY_TYPE_KEYS,
  SEED_METRIC_KEYS,
} from '@mat-plan/shared';
import { and, eq, inArray, isNull, ne } from 'drizzle-orm';

import { schema } from '../../src/client';
import { lastBodyweightBefore } from '../../src/queries/last-bodyweight';
import { insertBodyweightEntry } from '../../src/writers/bodyweight';
import { householdScopeForScript } from '../../src/writers/household-scope-script';
import { bodyweightRowForAmend, clearBodyweight } from '../../src/writers/single-value';
import { asPg, db, type VerifyContext } from './harness';

/**
 * `db:verify` proofs for SINGLE VALUES (bodyweight, practice) and Clear this day.
 *
 * **Owner: lane S**, the feature thread (`docs/plans/fam-1-family-program.md` §5 → "Lane S · single
 * values and Clear this day"). Only lane S edits this file. The proofs are the ones its own plans
 * name, and those plans hold the detail:
 *
 * - `docs/plans/v1-24-3b-logs-in-place.md` (V1-24 3b): 3b-bw, 3b-0 (one practice per day; the
 *   restore's slot check), 3b-life;
 * - `docs/plans/v1-9b-delete-and-restore.md` (V1-9b B2): B1-2, B2-0 (`entries.hide_reason`), B2.
 *
 * What a module can rely on when it runs, and the helpers to import, are in `./harness` →
 * `VerifyContext`. This module writes into a household of its own, so nothing `verify.ts` left behind
 * can satisfy or break an assertion here.
 */
export async function verifySingleValues(ctx: VerifyContext): Promise<void> {
  await verifyBodyweightClear(ctx);
}

const HH_PUBLIC_ID = '019826b4-0000-7000-8000-00000003b000';
const ATHLETE_PUBLIC_ID = '019826b4-0000-7000-8000-00000003b001';
const SIBLING_PUBLIC_ID = '019826b4-0000-7000-8000-00000003b002';

// ── V1-24 3b-bw — Clear a weigh-in, the pre-read, and "Last time" (plan W9, W10) ─────────────────────
async function verifyBodyweightClear({ B_SCOPE }: VerifyContext): Promise<void> {
  const [hh] = await db
    .insert(schema.households)
    .values({ publicId: HH_PUBLIC_ID, name: 'Verify 3b-bw HH' })
    .returning({ id: schema.households.id });
  const S_SCOPE = householdScopeForScript(hh.id);
  const [athlete, sibling] = await db
    .insert(schema.profiles)
    .values([
      {
        publicId: ATHLETE_PUBLIC_ID,
        name: 'Verify 3b-bw Athlete',
        kind: 'kid',
        householdId: hh.id,
      },
      {
        publicId: SIBLING_PUBLIC_ID,
        name: 'Verify 3b-bw Sibling',
        kind: 'kid',
        householdId: hh.id,
      },
    ])
    .returning({ id: schema.profiles.id });

  const [weighIn] = await db
    .select({ id: schema.activityTypes.id })
    .from(schema.activityTypes)
    .where(eq(schema.activityTypes.key, SEED_ACTIVITY_TYPE_KEYS.weighIn));
  // Any other NUMERIC metric: the wrong-metric refusal needs a row that is otherwise amendable.
  const [otherMetric] = await db
    .select({ key: schema.metricDefinitions.key, unit: schema.metricDefinitions.unit })
    .from(schema.metricDefinitions)
    .where(ne(schema.metricDefinitions.key, SEED_METRIC_KEYS.bodyweight))
    .limit(1);
  assert.ok(weighIn && otherMetric, '3b-bw: the weigh-in type and a second metric are seeded');

  let n = 0;
  const weighInRow = async (
    profileId: number,
    day: string,
    value: number,
    extra: Partial<typeof schema.entries.$inferInsert> = {},
  ) => {
    n += 1;
    const publicId = `019826b4-0000-7000-8000-00000003b${String(100 + n).padStart(3, '0')}`;
    await db.insert(schema.entries).values({
      publicId,
      clientId: newId(),
      profileId,
      activityDate: day,
      kind: ENTRY_KIND.bodyweight,
      unit: 'lb',
      valueNum: String(value),
      activityTypeId: weighIn.id,
      metricKey: SEED_METRIC_KEYS.bodyweight,
      status: ENTRY_STATUS.done,
      ...extra,
    });
    return publicId;
  };
  const deletedAt = async (publicId: string) =>
    (
      await db
        .select({ deletedAt: schema.entries.deletedAt })
        .from(schema.entries)
        .where(eq(schema.entries.publicId, publicId))
    )[0]?.deletedAt ?? null;
  const asAthlete = { profilePublicId: ATHLETE_PUBLIC_ID, scope: S_SCOPE };

  // ── clearBodyweight ────────────────────────────────────────────────────────────────────────────
  const DAY = '2026-10-10';
  const bw = await weighInRow(athlete.id, DAY, 84.5);
  // A second live entry on the same day, of another metric: the clear must leave it alone, and its
  // id must not be clearable through this endpoint.
  const other = await weighInRow(athlete.id, DAY, 7, {
    kind: null,
    metricKey: otherMetric.key,
    unit: otherMetric.unit,
  });
  const siblingBw = await weighInRow(sibling.id, DAY, 60);
  const clear = (entryId: string, over: Partial<{ unit: string; seenValue: number }> = {}) =>
    clearBodyweight(asPg, { ...asAthlete, entryId, unit: 'lb', seenValue: 84.5, ...over });

  assert.deepEqual(
    await clear(other, { unit: otherMetric.unit, seenValue: 7 }),
    { notFound: true },
    "3b-bw: clearBodyweight refuses another metric's entry — the metric is pinned, not posted",
  );
  assert.deepEqual(
    await clear(bw, { seenValue: 85 }),
    { stale: true },
    '3b-bw: clearBodyweight refuses a stale seenValue (another phone changed the weight)',
  );
  assert.deepEqual(
    await clear(bw, { unit: 'kg' }),
    { stale: true },
    '3b-bw: clearBodyweight refuses a unit the row does not hold',
  );
  assert.deepEqual(
    // seenValue deliberately NOT the sibling's 60: without the profile pin the row is found and the
    // answer is `stale`, so the assertion (not hideEntries' own scope) is what goes red.
    await clear(siblingBw, { seenValue: 61 }),
    { notFound: true },
    "3b-bw: clearBodyweight refuses a sibling's weigh-in named under this athlete",
  );
  assert.deepEqual(
    await clearBodyweight(asPg, {
      profilePublicId: ATHLETE_PUBLIC_ID,
      scope: B_SCOPE,
      entryId: bw,
      unit: 'lb',
      seenValue: 84.5,
    }),
    { notFound: true },
    "3b-bw: clearBodyweight refuses this household's weigh-in under another household's scope",
  );
  assert.equal(await deletedAt(bw), null, '3b-bw: no refusal hid the row');

  // The rows on the day, live before the clear: exactly ONE changes.
  const liveBefore = await db
    .select({ publicId: schema.entries.publicId })
    .from(schema.entries)
    .where(
      and(
        eq(schema.entries.activityDate, DAY),
        inArray(schema.entries.profileId, [athlete.id, sibling.id]),
        isNull(schema.entries.deletedAt),
      ),
    );
  assert.deepEqual(
    await clear(bw),
    { cleared: true },
    '3b-bw: clearBodyweight clears a live weigh-in',
  );
  assert.notEqual(await deletedAt(bw), null, '3b-bw: the cleared weigh-in is hidden');
  for (const { publicId } of liveBefore) {
    if (publicId === bw) continue;
    assert.equal(
      await deletedAt(publicId),
      null,
      "3b-bw: a clear hides exactly one row — the day's other entries, and the sibling's, stay live",
    );
  }
  const token = await deletedAt(bw);
  assert.deepEqual(await clear(bw), { cleared: true }, '3b-bw: a replayed clear succeeds');
  assert.deepEqual(await deletedAt(bw), token, '3b-bw: …and changes nothing (same tombstone)');

  // The pre-read sees the hidden row: its day and the flag, nothing else.
  assert.deepEqual(
    await bodyweightRowForAmend(asPg, { ...asAthlete, entryId: bw }),
    { day: DAY, hidden: true },
    '3b-bw: bodyweightRowForAmend reports a hidden row as hidden, with its own day',
  );

  // A new weigh-in on the cleared day inserts: the day index is live-only.
  const relog = await insertBodyweightEntry(asPg, {
    profileId: athlete.id,
    publicId: newId(),
    clientId: newId(),
    day: DAY,
    unit: 'lb',
    value: 85,
    notes: null,
    activityTypeId: weighIn.id,
    kind: ENTRY_KIND.bodyweight,
  });
  assert.ok(
    'id' in relog,
    '3b-bw: a weigh-in re-entered on a cleared day inserts (the index is live-only)',
  );
  assert.deepEqual(
    await clear(bw),
    { stale: true },
    '3b-bw: a replayed clear after the day was re-entered is stale, not a success over the new weight',
  );
  assert.equal(await deletedAt(relog.id), null, '3b-bw: …and the re-entered weigh-in stays live');

  // ── bodyweightRowForAmend ──────────────────────────────────────────────────────────────────────
  assert.deepEqual(
    await bodyweightRowForAmend(asPg, { ...asAthlete, entryId: relog.id }),
    { day: DAY, hidden: false },
    '3b-bw: bodyweightRowForAmend reports a live row with its own day',
  );
  for (const [entryId, scope, why] of [
    [siblingBw, S_SCOPE, "a sibling's weigh-in"],
    [relog.id, B_SCOPE, 'another household'],
    [other, S_SCOPE, 'another metric'],
  ] as const) {
    assert.equal(
      await bodyweightRowForAmend(asPg, { profilePublicId: ATHLETE_PUBLIC_ID, scope, entryId }),
      null,
      `3b-bw: bodyweightRowForAmend is null for ${why}`,
    );
  }

  // ── lastBodyweightBefore ───────────────────────────────────────────────────────────────────────
  const D = '2026-10-20';
  await weighInRow(athlete.id, '2026-10-15', 70);
  const cleared = await weighInRow(athlete.id, '2026-10-19', 72);
  await clearBodyweight(asPg, { ...asAthlete, entryId: cleared, unit: 'lb', seenValue: 72 });
  await weighInRow(athlete.id, '2026-10-18', 99, { status: ENTRY_STATUS.skipped });
  await weighInRow(athlete.id, D, 73);
  await weighInRow(athlete.id, '2026-10-21', 74);
  assert.deepEqual(
    await lastBodyweightBefore(asPg, { ...asAthlete, day: D }),
    { value: 70, unit: 'lb', day: '2026-10-15' },
    '3b-bw: "Last time" is the latest LIVE done weigh-in strictly before the day — a cleared one, a skipped one, the day itself and a later day are all skipped',
  );
  assert.equal(
    await lastBodyweightBefore(asPg, {
      profilePublicId: SIBLING_PUBLIC_ID,
      scope: S_SCOPE,
      day: '2026-10-01',
    }),
    null,
    '3b-bw: "Last time" is null for a profile with nothing before the day',
  );
  assert.equal(
    await lastBodyweightBefore(asPg, {
      profilePublicId: ATHLETE_PUBLIC_ID,
      scope: B_SCOPE,
      day: D,
    }),
    null,
    '3b-bw: "Last time" is null under another household\'s scope',
  );

  // The tiebreak: two live weigh-ins on one day can exist (a second slot), and the newer wins.
  const TIE = '2026-09-10';
  await weighInRow(sibling.id, TIE, 50, { createdAt: new Date('2026-09-10T07:00:00Z') });
  await weighInRow(sibling.id, TIE, 51, {
    context: 'evening',
    createdAt: new Date('2026-09-10T19:00:00Z'),
  });
  assert.deepEqual(
    await lastBodyweightBefore(asPg, {
      profilePublicId: SIBLING_PUBLIC_ID,
      scope: S_SCOPE,
      day: '2026-09-11',
    }),
    { value: 51, unit: 'lb', day: TIE },
    '3b-bw: "Last time" breaks a same-day tie by created_at, newest first',
  );

  console.log(
    '✓ V1-24 3b-bw: clearBodyweight hides exactly one owned weigh-in (metric, unit, seenValue, profile and household pinned; a replay is a replay unless the day was re-entered); the pre-read sees a hidden row; "Last time" skips cleared, non-done, same-day and later rows',
  );
}
