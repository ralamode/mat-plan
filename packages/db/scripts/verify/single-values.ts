import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

import {
  ACTIVITY_TYPE_KEYS,
  ENTRY_KIND,
  ENTRY_STATUS,
  METRIC_KEYS,
  newId,
  PRACTICE_UNIT,
  PROFILE_KIND,
  RESTORE_REASON,
  SEED_ACTIVITY_TYPE_KEYS,
  SEED_METRIC_KEYS,
} from '@mat-plan/shared';
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';

import { schema } from '../../src/client';
import { PRACTICE_DAY_UNIQUE_INDEX } from '../../src/schema';
import { writeCheckinEntries, type CheckinInsertValue } from '../../src/writers/checkin';
import { hideEntries, restoreHidden } from '../../src/writers/hide';
import { lastBodyweightBefore } from '../../src/queries/last-bodyweight';
import { insertBodyweightEntry } from '../../src/writers/bodyweight';
import { householdScopeForScript } from '../../src/writers/household-scope-script';
import {
  bodyweightRowForAmend,
  clearBodyweight,
  clearPractice,
  practiceRowForAmend,
} from '../../src/writers/single-value';
import { findAmendablePractice, updatePracticeEntryById } from '../../src/writers/practice';
import { asTx, expectRejectedBy, rolledBack, type VerifyContext } from './harness';

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
  await verifyPracticeOnePerDay();
  await verifyPracticeAmend(ctx);
}

const HH_PUBLIC_ID = '019826b4-0000-7000-8000-00000003b000';
const ATHLETE_PUBLIC_ID = '019826b4-0000-7000-8000-00000003b001';
const SIBLING_PUBLIC_ID = '019826b4-0000-7000-8000-00000003b002';

// ── V1-24 3b-bw — Clear a weigh-in, the pre-read, and "Last time" (plan W9, W10) ─────────────────────
async function verifyBodyweightClear({ B_SCOPE }: VerifyContext): Promise<void> {
  // Every write here is rolled back (`rolledBack`), so no later module counts these rows.
  await rolledBack(async (tx) => {
    const exec = asTx(tx);
    const [hh] = await tx
      .insert(schema.households)
      .values({ publicId: HH_PUBLIC_ID, name: 'Verify 3b-bw HH' })
      .returning({ id: schema.households.id });
    const S_SCOPE = householdScopeForScript(hh.id);
    const [athlete, sibling] = await tx
      .insert(schema.profiles)
      .values([
        {
          publicId: ATHLETE_PUBLIC_ID,
          name: 'Verify 3b-bw Athlete',
          kind: PROFILE_KIND.kid,
          householdId: hh.id,
        },
        {
          publicId: SIBLING_PUBLIC_ID,
          name: 'Verify 3b-bw Sibling',
          kind: PROFILE_KIND.kid,
          householdId: hh.id,
        },
      ])
      .returning({ id: schema.profiles.id });

    const [weighIn] = await tx
      .select({ id: schema.activityTypes.id })
      .from(schema.activityTypes)
      .where(eq(schema.activityTypes.key, SEED_ACTIVITY_TYPE_KEYS.weighIn));
    // Any other NUMERIC metric: the wrong-metric refusal needs a row that is otherwise amendable.
    const [otherMetric] = await tx
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
      await tx.insert(schema.entries).values({
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
    // The tombstone as TEXT, to the microsecond: a `Date` would round it (hide.ts's token rule).
    const deletedAtText = async (publicId: string) =>
      (
        await tx
          .select({ t: sql<string | null>`${schema.entries.deletedAt}::text` })
          .from(schema.entries)
          .where(eq(schema.entries.publicId, publicId))
      )[0]?.t ?? null;
    const deletedAt = async (publicId: string) =>
      (
        await tx
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
    // Two weigh-ins of the WRONG SHAPE, each holding the value the form would post: a non-`done` one,
    // and one carrying a text value beside its number (the shape `verify.ts`'s proof (h) inserts).
    // Without the shape pins either would be found (and cleared), so each refusal proves its pin.
    const skippedBw = await weighInRow(athlete.id, '2026-10-11', 84.5, {
      status: ENTRY_STATUS.skipped,
    });
    const textBw = await weighInRow(athlete.id, '2026-10-12', 84.5, { valueText: 'x' });
    const clear = (entryId: string, over: Partial<{ unit: string; seenValue: number }> = {}) =>
      clearBodyweight(exec, { ...asAthlete, entryId, unit: 'lb', seenValue: 84.5, ...over });

    assert.deepEqual(
      await clear(other, { unit: otherMetric.unit, seenValue: 7 }),
      { notFound: true },
      "3b-bw: clearBodyweight refuses another metric's entry — the metric is pinned, not posted",
    );
    for (const [id, why] of [
      [skippedBw, 'a non-done weigh-in'],
      [textBw, 'a text-valued weigh-in'],
    ] as const) {
      assert.deepEqual(
        await clear(id),
        { notFound: true },
        `3b-bw: clearBodyweight refuses ${why} — the shape is pinned`,
      );
    }
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
      await clearBodyweight(exec, {
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
    const liveBefore = await tx
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
    // 🔴 Pin the tombstone to a hand-written instant first. Every clear here runs in ONE outer
    // transaction, so `now()` is frozen and a replay that re-stamped `deleted_at` would write the same
    // instant: a sampled token could not catch it (docs/lessons.md, "pin the value").
    const PINNED = '2026-10-10 12:00:00.123456+00';
    await tx
      .update(schema.entries)
      .set({ deletedAt: sql`${PINNED}::timestamptz` })
      .where(eq(schema.entries.publicId, bw));
    const token = await deletedAtText(bw);
    assert.deepEqual(await clear(bw), { cleared: true }, '3b-bw: a replayed clear succeeds');
    assert.equal(
      await deletedAtText(bw),
      token,
      '3b-bw: …and changes nothing (the pinned tombstone is untouched)',
    );

    // The pre-read sees the hidden row, and returns its day and nothing else.
    assert.deepEqual(
      await bodyweightRowForAmend(exec, { ...asAthlete, entryId: bw }),
      { day: DAY },
      '3b-bw: bodyweightRowForAmend returns a hidden row’s own day, and nothing else',
    );

    // A new weigh-in on the cleared day inserts: the day index is live-only.
    const relog = await insertBodyweightEntry(exec, {
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
      await bodyweightRowForAmend(exec, { ...asAthlete, entryId: relog.id }),
      { day: DAY },
      '3b-bw: bodyweightRowForAmend returns a live row’s own day',
    );
    for (const [entryId, scope, why] of [
      [siblingBw, S_SCOPE, "a sibling's weigh-in"],
      [relog.id, B_SCOPE, 'another household'],
      [other, S_SCOPE, 'another metric'],
      [skippedBw, S_SCOPE, 'a non-done weigh-in'],
      [textBw, S_SCOPE, 'a text-valued weigh-in'],
    ] as const) {
      assert.equal(
        await bodyweightRowForAmend(exec, { profilePublicId: ATHLETE_PUBLIC_ID, scope, entryId }),
        null,
        `3b-bw: bodyweightRowForAmend is null for ${why}`,
      );
    }

    // ── lastBodyweightBefore ───────────────────────────────────────────────────────────────────────
    const D = '2026-10-20';
    await weighInRow(athlete.id, '2026-10-15', 70);
    const cleared = await weighInRow(athlete.id, '2026-10-19', 72);
    await clearBodyweight(exec, { ...asAthlete, entryId: cleared, unit: 'lb', seenValue: 72 });
    await weighInRow(athlete.id, '2026-10-18', 99, { status: ENTRY_STATUS.skipped });
    await weighInRow(athlete.id, '2026-10-17', 98, { valueText: 'x' });
    await weighInRow(athlete.id, D, 73);
    await weighInRow(athlete.id, '2026-10-21', 74);
    assert.deepEqual(
      await lastBodyweightBefore(exec, { ...asAthlete, day: D }),
      { value: 70, unit: 'lb', day: '2026-10-15' },
      '3b-bw: "Last time" is the latest LIVE done weigh-in strictly before the day — a cleared one, a non-done one, a text one, the day itself and a later day are all skipped',
    );
    assert.equal(
      await lastBodyweightBefore(exec, {
        profilePublicId: SIBLING_PUBLIC_ID,
        scope: S_SCOPE,
        day: '2026-10-01',
      }),
      null,
      '3b-bw: "Last time" is null for a profile with nothing before the day',
    );
    // The sibling's own answer, at the SAME day: the athlete has later weigh-ins, so a missing profile
    // pin would return one of theirs.
    assert.deepEqual(
      await lastBodyweightBefore(exec, {
        profilePublicId: SIBLING_PUBLIC_ID,
        scope: S_SCOPE,
        day: D,
      }),
      { value: 60, unit: 'lb', day: DAY },
      '3b-bw: "Last time" is the profile’s own, never a sibling’s',
    );
    assert.equal(
      await lastBodyweightBefore(exec, {
        profilePublicId: ATHLETE_PUBLIC_ID,
        scope: B_SCOPE,
        day: D,
      }),
      null,
      '3b-bw: "Last time" is null under another household\'s scope',
    );

    // The tiebreak: two live weigh-ins on one day can exist (a second slot), and the newer wins.
    // ⚠️ The LATER created_at is inserted FIRST, so it has the LOWER id: `id desc` alone would answer
    // 50, and only the `created_at` key answers 51.
    const TIE = '2026-09-10';
    await weighInRow(sibling.id, TIE, 51, {
      context: 'evening',
      createdAt: new Date('2026-09-10T19:00:00Z'),
    });
    await weighInRow(sibling.id, TIE, 50, { createdAt: new Date('2026-09-10T07:00:00Z') });
    assert.deepEqual(
      await lastBodyweightBefore(exec, {
        profilePublicId: SIBLING_PUBLIC_ID,
        scope: S_SCOPE,
        day: '2026-09-11',
      }),
      { value: 51, unit: 'lb', day: TIE },
      '3b-bw: "Last time" breaks a same-day tie by created_at, newest first',
    );

    console.log(
      '✓ V1-24 3b-bw: clearBodyweight hides exactly one owned weigh-in (metric, unit, seenValue, profile and household pinned; a replay is a replay unless the day was re-entered); the pre-read sees a hidden row and returns only its day; "Last time" skips cleared, non-done, same-day and later rows',
    );
  });
}

const PRACTICE_HH_PUBLIC_ID = '019826b4-0000-7000-8000-00000003b0a0';
const PRACTICE_ATHLETE_PUBLIC_ID = '019826b4-0000-7000-8000-00000003b0a1';
const PRACTICE_SIBLING_PUBLIC_ID = '019826b4-0000-7000-8000-00000003b0a2';

// ── V1-24 3b-0 — one live practice per day: the index, the insert's outcomes, restore (plan Z1–Z8) ──
async function verifyPracticeOnePerDay(): Promise<void> {
  // The migration's own pre-check, read from disk by its SLUG (the number is fixed at merge, so it is
  // not named here). Read before the transaction: nothing here touches the database.
  const migrationsDir = new URL('../../migrations/', import.meta.url);
  const migrationFile = readdirSync(migrationsDir).find((f) =>
    f.endsWith('_v1_24_3b0_practice_one_per_day.sql'),
  );
  assert.ok(migrationFile, '3b-0: the practice migration ships');
  const doBlock = readFileSync(new URL(migrationFile, migrationsDir), 'utf8')
    .split('--> statement-breakpoint')
    .map((part) => part.trim())
    .find((part) => part.startsWith('DO $$'));
  assert.ok(doBlock, '3b-0: the migration ships its duplicate pre-check');
  // The order is the safety argument (Z2): the timeouts, then the SHARE lock (the one that blocks
  // inserts; ACCESS SHARE would not), then the count, then the build, so the count and the build judge
  // the same rows. The first three are pinned whole, because a regenerate could change a value.
  const statements = readFileSync(new URL(migrationFile, migrationsDir), 'utf8')
    .split('--> statement-breakpoint')
    .map((part) =>
      part
        .split('\n')
        .filter((line) => line.trim() !== '' && !line.trim().startsWith('--'))
        .join(' ')
        .trim(),
    );
  assert.deepEqual(
    [
      ...statements.slice(0, 3),
      statements[3]?.slice(0, 5),
      statements[4]?.slice(0, 'CREATE UNIQUE INDEX'.length),
      statements.length,
    ],
    [
      "SET lock_timeout = '5s';",
      "SET statement_timeout = '60s';",
      'LOCK TABLE "entries" IN SHARE MODE;',
      'DO $$',
      'CREATE UNIQUE INDEX',
      5,
    ],
    '3b-0: the migration sets its timeouts, takes the SHARE lock, pre-checks, then builds, in that order',
  );

  await rolledBack(async (tx) => {
    const exec = asTx(tx);

    // (a) The shipped definition, as Postgres prints it: the key, the live-only filter and the metric
    //     literal, pinned against the shared const (the literal in schema.ts cannot import it).
    const [def] = (
      await tx.execute(
        sql`select indexdef from pg_indexes where indexname = ${PRACTICE_DAY_UNIQUE_INDEX}`,
      )
    ).rows as { indexdef: string }[];
    assert.equal(
      def?.indexdef,
      `CREATE UNIQUE INDEX ${PRACTICE_DAY_UNIQUE_INDEX} ON public.entries USING btree (profile_id, activity_date) WHERE ((deleted_at IS NULL) AND (metric_key = '${METRIC_KEYS.practice_minutes}'::text))`,
      '3b-0: the practice index is (profile, day), live practice rows only',
    );

    const [hh] = await tx
      .insert(schema.households)
      .values({ publicId: PRACTICE_HH_PUBLIC_ID, name: 'Verify 3b-0 HH' })
      .returning({ id: schema.households.id });
    const SCOPE = householdScopeForScript(hh.id);
    const [athlete, sibling] = await tx
      .insert(schema.profiles)
      .values([
        {
          publicId: PRACTICE_ATHLETE_PUBLIC_ID,
          name: 'Verify 3b-0 Athlete',
          kind: PROFILE_KIND.kid,
          householdId: hh.id,
        },
        {
          publicId: PRACTICE_SIBLING_PUBLIC_ID,
          name: 'Verify 3b-0 Sibling',
          kind: PROFILE_KIND.kid,
          householdId: hh.id,
        },
      ])
      .returning({ id: schema.profiles.id });
    const typeId = async (key: string) =>
      (
        await tx
          .select({ id: schema.activityTypes.id })
          .from(schema.activityTypes)
          .where(eq(schema.activityTypes.key, key))
      )[0]?.id;
    const practiceTypeId = await typeId(ACTIVITY_TYPE_KEYS.wrestling_practice);
    const habitTypeId = await typeId(ACTIVITY_TYPE_KEYS.brush_teeth);
    const weighInTypeId = await typeId(SEED_ACTIVITY_TYPE_KEYS.weighIn);
    assert.ok(
      practiceTypeId && habitTypeId && weighInTypeId,
      '3b-0: the activity types are seeded',
    );

    const practice = (day: string, clientId = newId()): CheckinInsertValue => ({
      publicId: newId(),
      clientId,
      activityDate: day,
      unit: 'min',
      valueNum: '90',
      activityTypeId: practiceTypeId,
      metricKey: METRIC_KEYS.practice_minutes,
      status: ENTRY_STATUS.done,
    });
    const habit = (day: string, clientId = newId()): CheckinInsertValue => ({
      publicId: newId(),
      clientId,
      activityDate: day,
      unit: 'count',
      valueNum: '1',
      activityTypeId: habitTypeId,
      metricKey: null,
      status: ENTRY_STATUS.done,
    });
    // A writer or restore that THROWS fails the named proof, not the run: a mutation that brings back
    // a bare 23505 must go red on the assertion that names it (the mutation gate reads the first one).
    const orFail = async <T>(what: string, run: () => Promise<T>): Promise<T> => {
      try {
        return await run();
      } catch (e) {
        assert.fail(`${what} (threw: ${String((e as Error).message).slice(0, 120)})`);
      }
    };
    const outcomes = async (profileId: number, values: CheckinInsertValue[], what: string) =>
      (await orFail(what, () => writeCheckinEntries(exec, { profileId, values }))).map(
        (r) => r.outcome,
      );
    // One message per proof, typed once: the mutation gate's `.expect` files match on it, whether the
    // mutation makes the writer throw or mis-classify.
    const expectOutcomes = async (
      profileId: number,
      values: CheckinInsertValue[],
      expected: readonly string[],
      what: string,
    ) => assert.deepEqual(await outcomes(profileId, values, what), expected, what);
    const livePractices = async (profileId: number, day: string) =>
      tx
        .select({ publicId: schema.entries.publicId, valueNum: schema.entries.valueNum })
        .from(schema.entries)
        .where(
          and(
            eq(schema.entries.profileId, profileId),
            eq(schema.entries.activityDate, day),
            eq(schema.entries.metricKey, METRIC_KEYS.practice_minutes),
            isNull(schema.entries.deletedAt),
          ),
        );

    // (b) The index itself, on raw inserts: a second live practice on one day is refused BY NAME;
    //     a hidden one, another day, another profile, and a weigh-in on the same day are allowed.
    const DAY = '2026-10-20';
    const raw = (profileId: number, v: CheckinInsertValue, deletedAt: Date | null = null) =>
      tx.insert(schema.entries).values({ ...v, profileId, deletedAt });
    await raw(athlete.id, practice(DAY));
    await expectRejectedBy(PRACTICE_DAY_UNIQUE_INDEX, () => raw(athlete.id, practice(DAY)), tx);
    await raw(athlete.id, practice(DAY), new Date('2026-10-20T12:00:00Z'));
    await raw(athlete.id, practice('2026-10-21'));
    await raw(sibling.id, practice(DAY));
    await tx.insert(schema.entries).values({
      publicId: newId(),
      clientId: newId(),
      profileId: athlete.id,
      activityDate: DAY,
      kind: ENTRY_KIND.bodyweight,
      unit: 'lb',
      valueNum: '84',
      activityTypeId: weighInTypeId,
      metricKey: SEED_METRIC_KEYS.bodyweight,
      status: ENTRY_STATUS.done,
    });

    // (c) The insert's classifier, in its order (plan Z4).
    const D1 = '2026-10-01';
    const first = practice(D1);
    await expectOutcomes(athlete.id, [first], ['created'], '3b-0: a first practice is created');
    const replayed = await orFail(
      '3b-0: the same client_id again is a replay of the same row',
      () =>
        writeCheckinEntries(exec, {
          profileId: athlete.id,
          values: [{ ...first, publicId: newId() }],
        }),
    );
    assert.deepEqual(
      replayed,
      [
        {
          clientId: first.clientId,
          outcome: 'replay',
          publicId: (await livePractices(athlete.id, D1))[0]!.publicId,
        },
      ],
      '3b-0: the same client_id again is a replay of the same row',
    );
    // Another phone, same day: refused as `day_taken`, the first row untouched, still one live row.
    const secondPhone = { ...practice(D1), valueNum: '45' };
    await expectOutcomes(
      athlete.id,
      [secondPhone],
      ['day_taken'],
      "3b-0: another phone's practice on a held day is day_taken, not a second row",
    );
    assert.deepEqual(
      (await livePractices(athlete.id, D1)).map((r) => Number(r.valueNum)),
      [90],
      '3b-0: day_taken leaves exactly one live practice, its value untouched',
    );
    // One batch: a habit beside a taken practice still inserts (target-less skips per row).
    await expectOutcomes(
      athlete.id,
      [habit(D1), practice(D1)],
      ['created', 'day_taken'],
      '3b-0: a habit in the same batch as a taken practice still inserts',
    );

    // After a hide, the day is free again: a new practice is created.
    const D2 = '2026-10-02';
    const toHide = practice(D2);
    await outcomes(athlete.id, [toHide], '3b-0: a practice to hide is created');
    const hiddenRow = (await livePractices(athlete.id, D2))[0]!;
    const hid = await hideEntries(exec, {
      profilePublicId: PRACTICE_ATHLETE_PUBLIC_ID,
      scope: SCOPE,
      day: D2,
      entryPublicIds: [hiddenRow.publicId],
    });
    assert.ok('hiddenAt' in hid, '3b-0: the practice hides');
    // The hidden row still holds its client_id: a replay of it, with the day free, is own_hidden.
    // The day is "free" of THIS athlete's live practice only: a sibling's practice and this
    // athlete's habit on the same day are there, so a lookup that lost its profile or metric
    // conjunct would read the day as taken.
    await raw(sibling.id, practice(D2));
    await raw(athlete.id, habit(D2));
    await expectOutcomes(
      athlete.id,
      [{ ...toHide, publicId: newId() }],
      ['own_hidden'],
      "3b-0: a hidden row's client_id with the day free is own_hidden (the slot lookup is live-only)",
    );
    const reentered = practice(D2);
    await expectOutcomes(
      athlete.id,
      [reentered],
      ['created'],
      '3b-0: after a hide, a new practice on that day is created',
    );
    // Now the hidden row's id AND a held day: the day decides (Z4: day_taken before own_hidden).
    await expectOutcomes(
      athlete.id,
      [{ ...toHide, publicId: newId() }],
      ['day_taken'],
      '3b-0: a hidden client_id on a re-entered day is day_taken',
    );
    // The metric pin alone: the practice's client_id reused for a habit on the SAME day is not a
    // replay of it (Z4 step 1).
    await expectOutcomes(
      athlete.id,
      [{ ...habit(D1), clientId: first.clientId }],
      ['conflict'],
      "3b-0: a practice's client_id reused for a habit is a conflict, never a replay",
    );
    // The day pin alone: the same practice's client_id on ANOTHER day is not a replay of it.
    await expectOutcomes(
      athlete.id,
      [{ ...practice('2026-10-05'), clientId: first.clientId }],
      ['conflict'],
      "3b-0: a practice's client_id reused on another day is a conflict, never a replay",
    );
    // No insert, no holder, no taken day: the throw (Z4 step 5). A reused public_id is skipped by the
    // target-less insert and no row holds the client_id. The throw is in JS, so the transaction lives.
    await assert.rejects(
      writeCheckinEntries(exec, {
        profileId: athlete.id,
        values: [{ ...habit(D1), publicId: hiddenRow.publicId }],
      }),
      /neither inserted nor held/,
      '3b-0: a non-insert with no holder and no taken day throws rather than inventing an outcome',
    );
    // Only a practice can be day_taken: a habit that did not insert, in a batch with a practice on a
    // held day, is still classified by its own holder (here a live row of another metric: conflict).
    await expectOutcomes(
      athlete.id,
      [{ ...habit(D1), clientId: first.clientId }, practice(D1)],
      ['conflict', 'day_taken'],
      '3b-0: only a practice can be day_taken',
    );

    // Another profile's HIDDEN row holding the id is a conflict, never this athlete's own_hidden:
    // `client_id` is globally unique, so a foreign tombstone must not read as "you deleted this".
    const foreignHidden = habit(D1);
    await raw(sibling.id, foreignHidden, new Date('2026-10-01T12:00:00Z'));
    await expectOutcomes(
      athlete.id,
      [{ ...foreignHidden, publicId: newId() }],
      ['conflict'],
      "3b-0: another profile's hidden row holding the id is a conflict, never own_hidden",
    );

    // (d) Restore all into a re-entered day: the practice answers slot_taken, a habit hidden by the
    //     same event restores, and the hidden practice restores once the live one is hidden.
    const D3 = '2026-10-04';
    const morningHabit = habit(D3);
    await outcomes(athlete.id, [practice(D3), morningHabit], '3b-0: a day to clear is logged');
    const ids = (
      await tx
        .select({ publicId: schema.entries.publicId, metricKey: schema.entries.metricKey })
        .from(schema.entries)
        .where(and(eq(schema.entries.profileId, athlete.id), eq(schema.entries.activityDate, D3)))
    ).map((r) => r.publicId);
    const clearDay = await hideEntries(exec, {
      profilePublicId: PRACTICE_ATHLETE_PUBLIC_ID,
      scope: SCOPE,
      day: D3,
      entryPublicIds: ids,
    });
    assert.ok('hiddenAt' in clearDay, '3b-0: the day clears as one event');
    const clearedPractice = (
      await tx
        .select({ publicId: schema.entries.publicId })
        .from(schema.entries)
        .where(
          and(
            eq(schema.entries.profileId, athlete.id),
            eq(schema.entries.activityDate, D3),
            eq(schema.entries.metricKey, METRIC_KEYS.practice_minutes),
          ),
        )
    )[0]!.publicId;
    await outcomes(athlete.id, [practice(D3)], '3b-0: a re-entry after the clear is created');
    const restored = await orFail('3b-0: Restore all into a re-entered day', () =>
      restoreHidden(exec, {
        profilePublicId: PRACTICE_ATHLETE_PUBLIC_ID,
        scope: SCOPE,
        day: D3,
        hiddenAt: clearDay.hiddenAt,
        entryPublicIds: ids,
      }),
    );
    assert.deepEqual(
      Object.fromEntries(restored.map((r) => [r.entryPublicId, r])),
      Object.fromEntries(
        ids.map((id) => [
          id,
          {
            entryPublicId: id,
            reason: id === clearedPractice ? RESTORE_REASON.slot_taken : RESTORE_REASON.ok,
          },
        ]),
      ),
      '3b-0: Restore all into a re-entered day: the practice is slot_taken (no heldBy), the habit restores',
    );
    const live = (await livePractices(athlete.id, D3))[0]!;
    const hideLive = await hideEntries(exec, {
      profilePublicId: PRACTICE_ATHLETE_PUBLIC_ID,
      scope: SCOPE,
      day: D3,
      entryPublicIds: [live.publicId],
    });
    assert.ok('hiddenAt' in hideLive, '3b-0: the re-entered practice hides');
    assert.deepEqual(
      (
        await restoreHidden(exec, {
          profilePublicId: PRACTICE_ATHLETE_PUBLIC_ID,
          scope: SCOPE,
          day: D3,
          hiddenAt: clearDay.hiddenAt,
          entryPublicIds: [clearedPractice],
        })
      ).map((r) => r.reason),
      [RESTORE_REASON.ok],
      '3b-0: the cleared practice restores once the day is free',
    );

    // (e) The migration's pre-check refuses a duplicate, with the index dropped inside a savepoint.
    //     The fixture makes a key without profile_id count differently: two profiles' single
    //     practices share 2026-09-02, so a day-only key would report 2 groups, not 1.
    let refusal = '';
    try {
      await tx.transaction(async (sp) => {
        await sp.execute(sql`DROP INDEX ${sql.identifier(PRACTICE_DAY_UNIQUE_INDEX)}`);
        await sp.insert(schema.entries).values([
          { ...practice('2026-09-01'), profileId: athlete.id },
          { ...practice('2026-09-01'), profileId: athlete.id },
          { ...practice('2026-09-02'), profileId: athlete.id },
          { ...practice('2026-09-02'), profileId: sibling.id },
        ]);
        await sp.execute(doBlock); // the migration's own text, verbatim, not interpolated input
      });
    } catch (e) {
      refusal = String(
        (e as { cause?: { message?: string } })?.cause?.message ?? (e as Error).message,
      );
    }
    assert.match(
      refusal,
      /V1-24 3b-0: 1 \(profile, day\) group/,
      '3b-0: the migration refuses a live duplicate practice, counted per (profile, day)',
    );

    console.log(
      '✓ V1-24 3b-0: one live practice per (profile, day): the index refuses by name and frees a hidden day; the insert answers replay (metric and day pinned), day_taken, own_hidden and conflict in order, per row in a batch; Restore all into a re-entered day answers slot_taken for the practice alone; the migration sets its timeouts, locks, pre-checks and builds in that order',
    );
  });
}

const AMEND_HH_PUBLIC_ID = '019826b4-0000-7000-8000-00000003b1a0';
const AMEND_ATHLETE_PUBLIC_ID = '019826b4-0000-7000-8000-00000003b1a1';
const AMEND_SIBLING_PUBLIC_ID = '019826b4-0000-7000-8000-00000003b1a2';

// ── V1-24 3b-life-a — change and clear a practice: the amend, its re-read, the pre-read (plan A6) ──
async function verifyPracticeAmend({ B_SCOPE }: VerifyContext): Promise<void> {
  await rolledBack(async (tx) => {
    const exec = asTx(tx);
    const [hh] = await tx
      .insert(schema.households)
      .values({ publicId: AMEND_HH_PUBLIC_ID, name: 'Verify 3b-life HH' })
      .returning({ id: schema.households.id });
    const SCOPE = householdScopeForScript(hh.id);
    const [athlete, sibling] = await tx
      .insert(schema.profiles)
      .values([
        {
          publicId: AMEND_ATHLETE_PUBLIC_ID,
          name: 'Verify 3b-life Athlete',
          kind: PROFILE_KIND.kid,
          householdId: hh.id,
        },
        {
          publicId: AMEND_SIBLING_PUBLIC_ID,
          name: 'Verify 3b-life Sibling',
          kind: PROFILE_KIND.kid,
          householdId: hh.id,
        },
      ])
      .returning({ id: schema.profiles.id });
    const [practiceType] = await tx
      .select({ id: schema.activityTypes.id })
      .from(schema.activityTypes)
      .where(eq(schema.activityTypes.key, ACTIVITY_TYPE_KEYS.wrestling_practice));
    // Another metric, written in MINUTES: so a refusal of it proves the METRIC pin, not the unit pin
    // (lessons: a negative fixture covered by two conjuncts proves neither).
    const [otherMetric] = await tx
      .select({ key: schema.metricDefinitions.key })
      .from(schema.metricDefinitions)
      .where(ne(schema.metricDefinitions.key, METRIC_KEYS.practice_minutes))
      .limit(1);
    assert.ok(
      practiceType && otherMetric,
      '3b-life: the practice type and another metric are seeded',
    );

    let n = 0;
    const row = async (
      profileId: number,
      day: string,
      minutes: number,
      extra: Partial<typeof schema.entries.$inferInsert> = {},
    ) => {
      n += 1;
      const publicId = `019826b4-0000-7000-8000-00000003b${String(200 + n).padStart(3, '0')}`;
      await tx.insert(schema.entries).values({
        publicId,
        clientId: newId(),
        profileId,
        activityDate: day,
        unit: PRACTICE_UNIT,
        valueNum: String(minutes),
        activityTypeId: practiceType.id,
        metricKey: METRIC_KEYS.practice_minutes,
        status: ENTRY_STATUS.done,
        ...extra,
      });
      return publicId;
    };
    const minutesOf = async (publicId: string) =>
      Number(
        (
          await tx
            .select({ v: schema.entries.valueNum })
            .from(schema.entries)
            .where(eq(schema.entries.publicId, publicId))
        )[0]!.v,
      );
    const asAthlete = { profilePublicId: AMEND_ATHLETE_PUBLIC_ID, scope: SCOPE };
    const update = (entryId: string, minutes: number, seenValue: number, as = asAthlete) =>
      updatePracticeEntryById(exec, { ...as, entryId, minutes, seenValue });

    const live = await row(athlete.id, '2026-10-10', 90);
    const sibs = await row(sibling.id, '2026-10-10', 60);
    const otherMetricMin = await row(athlete.id, '2026-10-11', 90, { metricKey: otherMetric.key });
    const otherUnit = await row(athlete.id, '2026-10-12', 90, { unit: 'sec' });

    // (a) The guarded UPDATE: it changes the owned, live practice it was shown, and nothing else.
    assert.deepEqual(
      await update(live, 45, 90),
      { publicId: live },
      '3b-life: the amend changes an owned live practice',
    );
    assert.equal(await minutesOf(live), 45, '3b-life: the amend writes the minutes');
    assert.equal(
      await update(live, 30, 90),
      null,
      '3b-life: the amend refuses a stale seenValue (another phone changed it)',
    );
    assert.equal(
      await update(otherMetricMin, 30, 90),
      null,
      "3b-life: the amend refuses another metric's entry, even in minutes — the metric is pinned",
    );
    assert.equal(
      await update(otherUnit, 30, 90),
      null,
      '3b-life: the amend refuses a practice in any unit but the metric’s own',
    );
    assert.equal(
      await update(sibs, 30, 60),
      null,
      "3b-life: the amend refuses a sibling's practice named under this athlete",
    );
    assert.equal(
      await update(live, 30, 45, { profilePublicId: AMEND_ATHLETE_PUBLIC_ID, scope: B_SCOPE }),
      null,
      "3b-life: the amend refuses from another household's scope",
    );

    // (b) The live-only re-read, for the action's three-way branch.
    assert.deepEqual(
      await findAmendablePractice(exec, { ...asAthlete, entryId: live }),
      { minutes: 45 },
      '3b-life: the re-read returns the live minutes',
    );
    for (const [what, entryId] of [
      ['another metric', otherMetricMin],
      ['a sibling', sibs],
    ] as const) {
      assert.equal(
        await findAmendablePractice(exec, { ...asAthlete, entryId }),
        null,
        `3b-life: the re-read returns null for ${what}`,
      );
    }

    // (c) The clear, through 3b-bw's core with the practice metric: refusals, then the clear.
    const clear = (entryId: string, seenValue: number, as = asAthlete) =>
      clearPractice(exec, { ...as, entryId, seenValue });
    assert.deepEqual(
      await clear(live, 90),
      { stale: true },
      '3b-life: a clear with a stale seenValue refuses',
    );
    assert.deepEqual(
      await clear(otherMetricMin, 90),
      { notFound: true },
      "3b-life: a clear refuses another metric's entry",
    );
    assert.deepEqual(
      await clear(otherUnit, 90),
      { stale: true },
      "3b-life: a clear refuses a practice in another unit (the unit is the metric's, pinned)",
    );
    assert.deepEqual(
      await clear(sibs, 60),
      { notFound: true },
      "3b-life: a clear refuses a sibling's practice",
    );
    assert.deepEqual(
      await clear(live, 45),
      { cleared: true },
      '3b-life: a clear hides an owned live practice',
    );
    assert.deepEqual(
      await clear(live, 45),
      { cleared: true },
      '3b-life: a replayed clear is a replay',
    );
    assert.equal(
      await findAmendablePractice(exec, { ...asAthlete, entryId: live }),
      null,
      '3b-life: the re-read returns null for a cleared practice',
    );

    // (d) The pre-read: the day, live or hidden, and nothing for anyone else's row.
    assert.deepEqual(
      await practiceRowForAmend(exec, { ...asAthlete, entryId: live }),
      { day: '2026-10-10' },
      "3b-life: the pre-read returns a hidden practice's day",
    );
    for (const [what, entryId] of [
      ['another metric', otherMetricMin],
      ['a sibling', sibs],
    ] as const) {
      assert.equal(
        await practiceRowForAmend(exec, { ...asAthlete, entryId }),
        null,
        `3b-life: the pre-read returns null for ${what}`,
      );
    }

    // (e) A replayed clear after the day was re-entered is stale, not a replay: the holder check is
    //     the practice index's own key.
    const reentered = await row(athlete.id, '2026-10-10', 75);
    assert.deepEqual(
      await clear(live, 45),
      { stale: true },
      '3b-life: a replayed practice clear after the day was re-entered is stale',
    );
    assert.equal(await minutesOf(reentered), 75, '3b-life: the re-entered practice is untouched');

    console.log(
      '✓ V1-24 3b-life-a: the practice amend changes only an owned, live practice in minutes (metric, unit, seenValue, profile and household pinned) and re-reads live only; the clear refuses the same and replays; a replayed clear after re-entry is stale; the pre-read returns only a day',
    );
  });
}
