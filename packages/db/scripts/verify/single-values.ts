import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

import {
  ACTIVITY_TYPE_KEYS,
  ENTRY_KIND,
  ENTRY_STATUS,
  HIDE_REASON,
  HIDE_REASONS,
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
import {
  ENTRY_HIDE_REASON_CHECK,
  ENTRY_HIDE_REASON_HIDDEN_CHECK,
  PRACTICE_DAY_UNIQUE_INDEX,
} from '../../src/schema';
import { writeCheckinEntries, type CheckinInsertValue } from '../../src/writers/checkin';
import { clearDay, hideEntries, restoreClear, restoreHidden } from '../../src/writers/hide';
import { clearEventsForDay, hiddenAtText } from '../../src/queries/clear-events';
import { hiddenEntriesForDay } from '../../src/queries/hidden-entries';
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
import {
  assertCheckCoversConst,
  asTx,
  columnCatalogShape,
  expectRejectedBy,
  orFail,
  rolledBack,
  type VerifyContext,
  type VerifyTx,
} from './harness';
import { programRowFixture, PROGRAM_ROW_FIXTURE_DAY } from './day';

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
  await verifyClearDay();
  await verifyClearDayProgramRows();
  await verifyDayTakenRace();
}

const HH_PUBLIC_ID = '019826b4-0000-7000-8000-00000003b000';
const ATHLETE_PUBLIC_ID = '019826b4-0000-7000-8000-00000003b001';
const SIBLING_PUBLIC_ID = '019826b4-0000-7000-8000-00000003b002';

/**
 * A household of its own with an athlete and a sibling (each section's world, built once here). The
 * labels name the section, so a failure's rows are recognisable; every caller is inside `rolledBack`.
 */
async function singleValueWorld(
  tx: VerifyTx,
  ids: { hh: string; athlete: string; sibling: string },
  label: string,
) {
  const [hh] = await tx
    .insert(schema.households)
    .values({ publicId: ids.hh, name: `Verify ${label} HH` })
    .returning({ id: schema.households.id });
  const [athlete, sibling] = await tx
    .insert(schema.profiles)
    .values([
      {
        publicId: ids.athlete,
        name: `Verify ${label} Athlete`,
        kind: PROFILE_KIND.kid,
        householdId: hh.id,
      },
      {
        publicId: ids.sibling,
        name: `Verify ${label} Sibling`,
        kind: PROFILE_KIND.kid,
        householdId: hh.id,
      },
    ])
    .returning({ id: schema.profiles.id });
  const scope = householdScopeForScript(hh.id);
  return { hh, scope, athlete, sibling };
}

// ── V1-24 3b-bw — Clear a weigh-in, the pre-read, and "Last time" (plan W9, W10) ─────────────────────
async function verifyBodyweightClear({ B_SCOPE }: VerifyContext): Promise<void> {
  // Every write here is rolled back (`rolledBack`), so no later module counts these rows.
  await rolledBack(async (tx) => {
    const exec = asTx(tx);
    const {
      hh,
      scope: S_SCOPE,
      athlete,
      sibling,
    } = await singleValueWorld(
      tx,
      { hh: HH_PUBLIC_ID, athlete: ATHLETE_PUBLIC_ID, sibling: SIBLING_PUBLIC_ID },
      '3b-bw',
    );

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

    const {
      hh,
      scope: SCOPE,
      athlete,
      sibling,
    } = await singleValueWorld(
      tx,
      {
        hh: PRACTICE_HH_PUBLIC_ID,
        athlete: PRACTICE_ATHLETE_PUBLIC_ID,
        sibling: PRACTICE_SIBLING_PUBLIC_ID,
      },
      '3b-0',
    );
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
    const {
      hh,
      scope: SCOPE,
      athlete,
      sibling,
    } = await singleValueWorld(
      tx,
      {
        hh: AMEND_HH_PUBLIC_ID,
        athlete: AMEND_ATHLETE_PUBLIC_ID,
        sibling: AMEND_SIBLING_PUBLIC_ID,
      },
      '3b-life',
    );
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

// ── V1-9b B2-0 — the clear's reason: Clear this day, Restore all, and every other hide (plan § B2-0) ──

const CLEAR_HH_PUBLIC_ID = '019826b4-0000-7000-8000-0000000b2000';
const CLEAR_ATHLETE_PUBLIC_ID = '019826b4-0000-7000-8000-0000000b2001';
const CLEAR_SIBLING_PUBLIC_ID = '019826b4-0000-7000-8000-0000000b2002';
const OTHER_HH_PUBLIC_ID = '019826b4-0000-7000-8000-0000000b2010';
const OTHER_ATHLETE_PUBLIC_ID = '019826b4-0000-7000-8000-0000000b2011';
const OTHER_SIBLING_PUBLIC_ID = '019826b4-0000-7000-8000-0000000b2012';

/**
 * ⚠️ **One transaction, one `now()`.** Every hide in this section runs inside `rolledBack`, so every
 * `now()` is the same instant: two events made by writers here would share a token. Where a proof
 * needs two events to differ, the EARLIER one's `deleted_at` is written by hand, older than `now()`
 * (lessons → "A microsecond-precision proof cannot fail on PGlite").
 */
async function verifyClearDay(): Promise<void> {
  // 1 · Shape and parity. Outside `rolledBack`: these read through the module-level `db`, which would
  //     wait forever on PGlite's one connection inside a transaction.
  assert.deepEqual(
    await columnCatalogShape('entries', 'hide_reason'),
    { data_type: 'text', is_nullable: 'YES', column_default: null },
    'B2-0: entries.hide_reason is a nullable text with no default',
  );
  await assertCheckCoversConst(ENTRY_HIDE_REASON_CHECK, HIDE_REASONS);

  await rolledBack(async (tx) => {
    const exec = asTx(tx);
    const {
      scope: SCOPE,
      athlete,
      sibling,
    } = await singleValueWorld(
      tx,
      {
        hh: CLEAR_HH_PUBLIC_ID,
        athlete: CLEAR_ATHLETE_PUBLIC_ID,
        sibling: CLEAR_SIBLING_PUBLIC_ID,
      },
      'B2-0',
    );
    const other = await singleValueWorld(
      tx,
      {
        hh: OTHER_HH_PUBLIC_ID,
        athlete: OTHER_ATHLETE_PUBLIC_ID,
        sibling: OTHER_SIBLING_PUBLIC_ID,
      },
      'B2-0 other',
    );
    const typeId = async (key: string) =>
      (
        await tx
          .select({ id: schema.activityTypes.id })
          .from(schema.activityTypes)
          .where(eq(schema.activityTypes.key, key))
      )[0]!.id;
    const weighInType = await typeId(SEED_ACTIVITY_TYPE_KEYS.weighIn);
    const practiceType = await typeId(ACTIVITY_TYPE_KEYS.wrestling_practice);
    // A habit check-in has no one-per-day index, so a day can hold as many as proof 9 needs.
    const habitType = await typeId(ACTIVITY_TYPE_KEYS.brush_teeth);

    let n = 0;
    const entry = async (
      profileId: number,
      day: string,
      values: Partial<typeof schema.entries.$inferInsert>,
    ) => {
      n += 1;
      const publicId = `019826b4-0000-7000-8000-0000000b2${String(100 + n).padStart(3, '0')}`;
      await tx.insert(schema.entries).values({
        publicId,
        clientId: newId(),
        profileId,
        activityDate: day,
        status: ENTRY_STATUS.done,
        unit: 'count',
        valueNum: '1',
        activityTypeId: habitType,
        metricKey: null,
        ...values,
      });
      return publicId;
    };
    const weighIn = (profileId: number, day: string, lb: number) =>
      entry(profileId, day, {
        kind: ENTRY_KIND.bodyweight,
        unit: 'lb',
        valueNum: String(lb),
        activityTypeId: weighInType,
        metricKey: SEED_METRIC_KEYS.bodyweight,
      });
    const practice = (profileId: number, day: string, minutes: number) =>
      entry(profileId, day, {
        unit: PRACTICE_UNIT,
        valueNum: String(minutes),
        activityTypeId: practiceType,
        metricKey: METRIC_KEYS.practice_minutes,
      });
    /** A row's state, the token as microsecond TEXT (hide.ts's rule). */
    const stateOf = async (publicId: string) =>
      (
        await tx
          .select({
            hiddenAt: sql<string | null>`${hiddenAtText}`,
            reason: schema.entries.hideReason,
          })
          .from(schema.entries)
          .where(eq(schema.entries.publicId, publicId))
      )[0]!;
    /** Back-date a hidden row's token, so it differs from this transaction's `now()`. */
    const backDate = (publicId: string, token: string) =>
      tx
        .update(schema.entries)
        .set({ deletedAt: sql`${token}::timestamptz` })
        .where(eq(schema.entries.publicId, publicId));
    const asAthlete = { profilePublicId: CLEAR_ATHLETE_PUBLIC_ID, scope: SCOPE };
    const asOther = { profilePublicId: OTHER_ATHLETE_PUBLIC_ID, scope: other.scope };
    const clear = (day: string, as = asAthlete) =>
      orFail(`B2-0: clearDay ${day}`, () => clearDay(exec, { ...as, day }));
    const restore = (day: string, hiddenAt: string, as = asAthlete) =>
      orFail(`B2-0: restoreClear ${day}`, () => restoreClear(exec, { ...as, day, hiddenAt }));
    const tokenOf = (r: Awaited<ReturnType<typeof clearDay>>) => {
      assert.ok('hiddenAt' in r, 'B2-0: the clear answered an event');
      return r;
    };
    const OLDER = '2026-01-01T00:00:00.000001Z';
    const OLDEST = '2025-12-31T00:00:00.000001Z';

    // 2 · The CHECKs refuse: a reason that is not a HIDE_REASONS value; a reason on a live row; an
    //     un-hide that leaves the reason (the maintainer's proof, 2026-11-17).
    const checked = await weighIn(athlete.id, '2026-11-01', 80);
    await expectRejectedBy(
      ENTRY_HIDE_REASON_CHECK,
      () =>
        tx
          .update(schema.entries)
          .set({ deletedAt: sql`now()`, hideReason: sql`'oops'` }) // not a HideReason, on purpose
          .where(eq(schema.entries.publicId, checked)),
      tx,
    );
    await expectRejectedBy(
      ENTRY_HIDE_REASON_HIDDEN_CHECK,
      () =>
        tx
          .update(schema.entries)
          .set({ hideReason: HIDE_REASON.clear_day })
          .where(eq(schema.entries.publicId, checked)),
      tx,
    );
    // The reason written by hand, so this proof is about the CHECK and a mutation of the clear's
    // writer dies on proof 3, which is the one about it.
    await tx
      .update(schema.entries)
      .set({ deletedAt: sql`now()`, hideReason: HIDE_REASON.clear_day })
      .where(eq(schema.entries.publicId, checked));
    await expectRejectedBy(
      ENTRY_HIDE_REASON_HIDDEN_CHECK,
      () =>
        tx
          .update(schema.entries)
          .set({ deletedAt: null })
          .where(eq(schema.entries.publicId, checked)),
      tx,
    );

    // 3 · A clear is ONE event with the reason, over the day's LIVE entries only. A weigh-in hidden
    //     earlier by a blank clear keeps its own token and no reason, and is not counted.
    const D3 = '2026-11-02';
    const earlier = await weighIn(athlete.id, D3, 79);
    await clearBodyweight(exec, { ...asAthlete, entryId: earlier, unit: 'lb', seenValue: 79 });
    await backDate(earlier, OLDER);
    const w3 = await weighIn(athlete.id, D3, 81);
    const p3 = await practice(athlete.id, D3, 90);
    const sib3 = await practice(sibling.id, D3, 60);
    const c3 = tokenOf(await clear(D3));
    assert.equal(c3.count, 2, 'B2-0 proof 3: the clear counts the two live entries it hid');
    for (const id of [w3, p3]) {
      assert.deepEqual(
        await stateOf(id),
        { hiddenAt: c3.hiddenAt, reason: HIDE_REASON.clear_day },
        'B2-0 proof 3: every live entry of the day is hidden under one token, with the reason',
      );
    }
    assert.deepEqual(
      await stateOf(earlier),
      { hiddenAt: OLDER, reason: null },
      'B2-0 proof 3: an entry hidden before the clear keeps its own token and no reason',
    );
    assert.deepEqual(
      await stateOf(sib3),
      { hiddenAt: null, reason: null },
      "B2-0 proof 3: a sibling's entry on the same day is untouched",
    );
    const read = Object.fromEntries(
      (await hiddenEntriesForDay(exec, { ...asAthlete, day: D3 })).map((r) => [
        r.entryPublicId,
        r.hideReason,
      ]),
    );
    assert.deepEqual(
      read,
      { [w3]: HIDE_REASON.clear_day, [p3]: HIDE_REASON.clear_day, [earlier]: null },
      "B2-0 proof 3: the hidden-entries read reports each row's reason",
    );

    // 4 · Every other hide carries NO reason: a blank clear of a weigh-in (proof 3's `earlier`) or a
    //     practice, a hide through `hideEntries`, and a bodyweight swap's holder.
    const D4 = '2026-11-03';
    const p4 = await practice(athlete.id, D4, 45);
    assert.deepEqual(
      await clearPractice(exec, { ...asAthlete, entryId: p4, seenValue: 45 }),
      { cleared: true },
      'B2-0 proof 4: the blank practice clear hid it',
    );
    const afterBlank = await stateOf(p4);
    assert.ok(afterBlank.hiddenAt !== null, 'B2-0 proof 4: the blank practice clear hid it');
    assert.equal(afterBlank.reason, null, 'B2-0 proof 4: a blank clear writes no reason');
    const swapped = await weighIn(athlete.id, D4, 82);
    const hidden4 = await hideEntries(exec, { ...asAthlete, day: D4, entryPublicIds: [swapped] });
    assert.ok('hiddenAt' in hidden4, 'B2-0 proof 4: hideEntries hid the weigh-in');
    assert.equal(
      (await stateOf(swapped)).reason,
      null,
      'B2-0 proof 4: hideEntries writes no reason',
    );
    await backDate(swapped, OLDER);
    const holder = await weighIn(athlete.id, D4, 83);
    assert.deepEqual(
      (
        await restoreHidden(exec, {
          ...asAthlete,
          day: D4,
          hiddenAt: OLDER,
          entryPublicIds: [swapped],
          keepInsteadOf: holder,
        })
      ).map((r) => r.reason),
      [RESTORE_REASON.ok],
      'B2-0 proof 4: the swap restored the weigh-in',
    );
    const swappedHolder = await stateOf(holder);
    assert.ok(swappedHolder.hiddenAt !== null, 'B2-0 proof 4: the swap hid the holder');
    assert.equal(
      swappedHolder.reason,
      null,
      "B2-0 proof 4: a swap's hidden holder carries no reason",
    );

    // 5 · Restore clears the reason with the token, for every item of the clear.
    const r5 = await restore(D3, c3.hiddenAt);
    assert.ok('items' in r5, 'B2-0 proof 5: restoreClear found the clear');
    assert.deepEqual(
      r5.items.map((i) => i.reason),
      [RESTORE_REASON.ok, RESTORE_REASON.ok],
      'B2-0 proof 5: every item of the clear is restored',
    );
    for (const id of [w3, p3]) {
      assert.deepEqual(
        await stateOf(id),
        { hiddenAt: null, reason: null },
        'B2-0 proof 5: a restored entry is live with no reason',
      );
    }
    assert.equal(
      (await stateOf(earlier)).hiddenAt,
      OLDER,
      "B2-0 proof 5: Restore all brings back the clear's entries, not an earlier hide's",
    );

    // 6 · A partial restore: the items whose place was retaken stay hidden WITHOUT the reason (the
    //     weigh-in through the pre-check, the practice through the catch), so the banner does not
    //     return; a second Restore all answers `notFound` (the replay contract). A row under the
    //     token with no reason (written by hand: no writer makes one) is not the clear's.
    const D6 = '2026-11-04';
    const w6 = await weighIn(athlete.id, D6, 84);
    const p6 = await practice(athlete.id, D6, 60);
    const c6 = tokenOf(await clear(D6));
    const stray = await entry(athlete.id, D6, {
      deletedAt: sql`${c6.hiddenAt}::timestamptz` as unknown as Date,
    });
    await weighIn(athlete.id, D6, 85);
    await practice(athlete.id, D6, 75);
    const r6 = await restore(D6, c6.hiddenAt);
    assert.ok('items' in r6, 'B2-0 proof 6: restoreClear found the clear');
    assert.deepEqual(
      Object.fromEntries(r6.items.map((i) => [i.entryPublicId, i.reason])),
      { [w6]: RESTORE_REASON.slot_taken, [p6]: RESTORE_REASON.slot_taken },
      "B2-0 proof 6: Restore all names exactly the clear's entries; both places were retaken",
    );
    for (const id of [w6, p6]) {
      assert.deepEqual(
        await stateOf(id),
        { hiddenAt: c6.hiddenAt, reason: null },
        'B2-0 proof 6: an item left hidden by a partial restore loses the reason',
      );
    }
    assert.deepEqual(
      await restore(D6, c6.hiddenAt),
      { notFound: true },
      'B2-0 proof 6: a second Restore all answers notFound (nothing of the clear is left)',
    );
    assert.equal(
      (await stateOf(stray)).hiddenAt,
      c6.hiddenAt,
      'B2-0 proof 6: a row under the token without the reason is not restored with the clear',
    );

    // 7 · Replay: the same token and count, even with a NEWER hide of another kind on the day; a day
    //     hidden only by blank clears, or with nothing logged, answers notFound.
    const D7 = '2026-11-05';
    const w7 = await weighIn(athlete.id, D7, 86);
    tokenOf(await clear(D7));
    await backDate(w7, OLDEST);
    const later = await weighIn(athlete.id, D7, 87);
    await clearBodyweight(exec, { ...asAthlete, entryId: later, unit: 'lb', seenValue: 87 });
    assert.deepEqual(
      await clear(D7),
      { hiddenAt: OLDEST, count: 1 },
      "B2-0 proof 7: a replayed clear answers the clear's token and count, not a newer blank clear's",
    );
    const D7b = '2026-11-06';
    const blank = await weighIn(athlete.id, D7b, 88);
    await clearBodyweight(exec, { ...asAthlete, entryId: blank, unit: 'lb', seenValue: 88 });
    assert.deepEqual(
      await clear(D7b),
      { notFound: true },
      'B2-0 proof 7: a day hidden only by blank clears has no clear to replay',
    );
    assert.deepEqual(
      await clear('2026-11-07'),
      { notFound: true },
      'B2-0 proof 7: a day with nothing logged answers notFound',
    );

    // 8 · Scope, both directions, on days the owner has ALREADY cleared: the other household gets
    //     notFound and no token, and the owner's rows keep the clear.
    const D8 = '2026-11-08';
    const mine = await weighIn(athlete.id, D8, 89);
    const theirs = await weighIn(other.athlete.id, D8, 90);
    const mineCleared = tokenOf(await clear(D8));
    const theirsCleared = tokenOf(await clear(D8, asOther));
    for (const [as, owner, token] of [
      [{ ...asAthlete, scope: other.scope }, mine, mineCleared.hiddenAt],
      [{ ...asOther, scope: SCOPE }, theirs, theirsCleared.hiddenAt],
    ] as const) {
      assert.deepEqual(
        await clear(D8, as),
        { notFound: true },
        "B2-0 proof 8: another household's clear of a cleared day answers notFound, no token",
      );
      assert.deepEqual(
        await restore(D8, token, as),
        { notFound: true },
        "B2-0 proof 8: another household's Restore all answers notFound",
      );
      assert.equal(
        (await stateOf(owner)).reason,
        HIDE_REASON.clear_day,
        "B2-0 proof 8: the owner's cleared row is untouched",
      );
    }

    // 9 · No cap: 51 entries (one over HIDE_ROW_MAX) clear and restore whole.
    const D9 = '2026-11-09';
    for (let i = 0; i < 51; i += 1) await entry(athlete.id, D9, {});
    const c9 = tokenOf(await clear(D9));
    assert.equal(c9.count, 51, 'B2-0 proof 9: a clear has no cap');
    const r9 = await restore(D9, c9.hiddenAt);
    assert.ok('items' in r9 && r9.items.every((i) => i.reason === RESTORE_REASON.ok));
    assert.equal(r9.items.length, 51, 'B2-0 proof 9: Restore all has no cap');

    // ── V1-9b B1-2 — the day's clear events (`clearEventsForDay`, the banner's read) ──
    const events = (day: string, as = asAthlete) =>
      orFail(`B1-2: clearEventsForDay ${day}`, () => clearEventsForDay(exec, { ...as, day }));

    // 10 · One clear is one event with its count. A blank clear's hide on the day is not an event, and
    //      a row under the clear's token without the reason (written by hand) is not counted.
    const D10 = '2026-11-10';
    const blank10 = await weighIn(athlete.id, D10, 80);
    await clearBodyweight(exec, { ...asAthlete, entryId: blank10, unit: 'lb', seenValue: 80 });
    await backDate(blank10, OLDEST);
    await weighIn(athlete.id, D10, 81);
    await practice(athlete.id, D10, 90);
    await practice(sibling.id, D10, 60);
    const c10 = tokenOf(await clear(D10));
    await entry(athlete.id, D10, {
      deletedAt: sql`${c10.hiddenAt}::timestamptz` as unknown as Date,
    });
    assert.deepEqual(
      await events(D10),
      [{ hiddenAt: c10.hiddenAt, count: 2 }],
      "B1-2 proof 10: a day's clear is one event with its count; other hides are not events",
    );

    // 11 · Two clears of one day: two events, newest first, the older one's six-digit token VERBATIM.
    //      Restore all by the READ's token brings back exactly that event; the other is left.
    const D11 = '2026-11-11';
    const w11 = await weighIn(athlete.id, D11, 82);
    const p11 = await practice(athlete.id, D11, 45);
    tokenOf(await clear(D11));
    await backDate(w11, OLDER);
    await backDate(p11, OLDER);
    const w11b = await weighIn(athlete.id, D11, 83);
    tokenOf(await clear(D11));
    // Every clear in this one transaction shares one now() (as on any Postgres), and PGlite's is in
    // milliseconds, so the newer event gets its own six-digit token too.
    const NEWER = '2026-01-02T00:00:00.000002Z';
    await backDate(w11b, NEWER);
    const two = await events(D11);
    assert.deepEqual(
      two,
      [
        { hiddenAt: NEWER, count: 1 },
        { hiddenAt: OLDER, count: 2 },
      ],
      'B1-2 proof 11: two clears are two events, newest first, each token as hide.ts prints it',
    );
    const r11 = await restore(D11, two[1]!.hiddenAt);
    assert.ok(
      'items' in r11 &&
        r11.items.length === 2 &&
        r11.items.every((i) => i.reason === RESTORE_REASON.ok),
      "B1-2 proof 11: Restore all by the read's token restores that event's entries",
    );
    assert.deepEqual(
      await events(D11),
      [{ hiddenAt: NEWER, count: 1 }],
      'B1-2 proof 11: once restored, only the other event is left',
    );

    // 12 · The token is tied to its day: the right athlete, another day, this day's token → notFound,
    //      and the cleared row keeps the clear. The action's window check rests on this.
    assert.deepEqual(
      await restore(D10, NEWER),
      { notFound: true },
      "B1-2 proof 12: Restore all on another day with this day's token answers notFound",
    );
    assert.equal(
      (await events(D11))[0]?.count,
      1,
      "B1-2 proof 12: the other day's clear is untouched by a restore on the wrong day",
    );

    // 13 · Scope, both directions, on a day both owners have cleared (D8): another household reads
    //      no events; the owner reads its own.
    assert.deepEqual(
      await events(D8),
      [{ hiddenAt: mineCleared.hiddenAt, count: 1 }],
      "B1-2 proof 13: the owner reads its own cleared day's event, and only its own entry",
    );
    assert.deepEqual(
      await events(D8, asOther),
      [{ hiddenAt: theirsCleared.hiddenAt, count: 1 }],
      'B1-2 proof 13: the other household reads its own, and only its own entry',
    );
    assert.deepEqual(
      await events(D8, { ...asAthlete, scope: other.scope }),
      [],
      'B1-2 proof 13: another household reads no clear events for this athlete',
    );
    assert.deepEqual(
      await events(D8, { ...asOther, scope: SCOPE }),
      [],
      'B1-2 proof 13: and the reverse',
    );
  });

  console.log(
    "✓ V1-9b B2-0: entries.hide_reason holds only clear_day and never on a live row; a clear hides the day's live entries as one event with the reason (no cap) and replays its own token; every other hide writes none; Restore all brings back exactly the clear, clears the reason, drops it from items left hidden, and answers notFound once done; both are household-scoped",
  );
  console.log(
    "✓ V1-9b B1-2: a day's clear events are one per clear, newest first, counted without other hides, each token restoring exactly its own entries on its own day only; household-scoped both ways",
  );
}

/**
 * B2-0 on a PROGRAM row (FAM-1 11b's writer), through lane E's exported fixture (`./day`, #507):
 * proofs 3, 4 and 5's program-row halves. A clear hides a ticked row with the reason; an earlier
 * un-tick keeps its own token and none; and Clear day, then un-tick (which answers the clear's token),
 * then re-tick is ok and leaves the row live with no reason (lane E, 2026-11-17).
 */
async function verifyClearDayProgramRows(): Promise<void> {
  await rolledBack(async (tx) => {
    const f = await programRowFixture(tx);
    const day = PROGRAM_ROW_FIXTURE_DAY;
    const okEntry = (r: Awaited<ReturnType<typeof f.tick>>, what: string) => {
      assert.ok('ok' in r && r.ok, `${what} — got ${JSON.stringify(r)}`);
      return r;
    };
    const stateOf = async (publicId: string) =>
      (
        await tx
          .select({
            hiddenAt: sql<string | null>`${hiddenAtText}`,
            reason: schema.entries.hideReason,
          })
          .from(schema.entries)
          .where(eq(schema.entries.publicId, publicId))
      )[0]!;

    const ticked = okEntry(
      await f.tick({ prescriptionPublicId: f.p.check.publicId }),
      'B2-0 program: a ✓',
    );
    const unticked = okEntry(
      await f.tick({ prescriptionPublicId: f.p.reps.publicId }),
      'B2-0 program: a second ✓',
    );
    okEntry(await f.untick(unticked.entryPublicId), 'B2-0 program: un-tick the second');
    assert.equal(
      (await stateOf(unticked.entryPublicId)).reason,
      null,
      'B2-0 proof 4: an un-tick writes no reason',
    );
    // Back-dated so the clear's token differs from the un-tick's (one transaction, one `now()`).
    const OLDER = '2026-01-01T00:00:00.000001Z';
    await tx
      .update(schema.entries)
      .set({ deletedAt: sql`${OLDER}::timestamptz` })
      .where(eq(schema.entries.publicId, unticked.entryPublicId));

    const cleared = await orFail('B2-0 program: clearDay', () =>
      clearDay(f.exec, { profilePublicId: f.athlete.publicId, scope: f.H_SCOPE, day }),
    );
    assert.ok('hiddenAt' in cleared, 'B2-0 program: the clear answered an event');
    assert.deepEqual(
      await stateOf(ticked.entryPublicId),
      { hiddenAt: cleared.hiddenAt, reason: HIDE_REASON.clear_day },
      'B2-0 proof 3: a clear hides a program row with the reason',
    );
    assert.deepEqual(
      await stateOf(unticked.entryPublicId),
      { hiddenAt: OLDER, reason: null },
      'B2-0 proof 3: an earlier un-tick keeps its own token and no reason',
    );

    const untickAfter = okEntry(
      await f.untick(ticked.entryPublicId),
      'B2-0 program: un-tick the cleared row',
    );
    assert.equal(
      (untickAfter as { hiddenAt?: string }).hiddenAt,
      cleared.hiddenAt,
      "B2-0 proof 5: un-tick of a cleared row answers the clear's token",
    );
    okEntry(
      await f.retick(ticked.entryPublicId, cleared.hiddenAt),
      'B2-0 proof 5: Clear day, then re-tick, is ok',
    );
    assert.deepEqual(
      await stateOf(ticked.entryPublicId),
      { hiddenAt: null, reason: null },
      'B2-0 proof 5: the re-ticked row is live with no reason',
    );
  });

  console.log(
    '✓ V1-9b B2-0 on a program row: a clear hides a ticked row with the reason; an un-tick writes none; Clear day, then re-tick, is ok and leaves the row live with no reason',
  );
}

// ── A day-taken insert whose holder is cleared in the same instant (tech-debt row, 2026-11-16) ─────────
const RACE_HH_PUBLIC_ID = '019826b4-0000-7000-8000-00000003b0a0';
const RACE_ATHLETE_PUBLIC_ID = '019826b4-0000-7000-8000-00000003b0a1';
const RACE_SIBLING_PUBLIC_ID = '019826b4-0000-7000-8000-00000003b0a2';
const RACE_DAY = '2026-11-16';

/**
 * The race, staged on one connection: a statement-level `AFTER INSERT` trigger hides the day's live
 * holder INSIDE the insert that the holder just skipped. Statement triggers fire on a statement that
 * inserted nothing, so the writer's re-reads find no insert, no holder and no taken day, exactly as a
 * second phone's clear landing between the statements would leave them. Before the retry each writer
 * threw ("neither inserted nor held"), which the person saw as `error.tsx`. The trigger hides only the
 * one row named in a temp table and is idempotent, so the retry's own insert passes through it. It all
 * rolls back with the section.
 */
async function verifyDayTakenRace(): Promise<void> {
  await rolledBack(async (tx) => {
    const exec = asTx(tx);
    const { athlete } = await singleValueWorld(
      tx,
      { hh: RACE_HH_PUBLIC_ID, athlete: RACE_ATHLETE_PUBLIC_ID, sibling: RACE_SIBLING_PUBLIC_ID },
      'race',
    );
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
      'race: the activity types are seeded',
    );

    await tx.execute(sql`create temp table race_target (public_id uuid not null)`);
    await tx.execute(sql`create function verify_race_hide() returns trigger language plpgsql as $$
      begin
        update entries set deleted_at = now()
          where public_id in (select public_id from race_target) and deleted_at is null;
        return null;
      end $$`);
    await tx.execute(
      sql`create trigger race_hide after insert on entries for each statement execute function verify_race_hide()`,
    );
    const holdThenClear = async (publicId: string) => {
      await tx.execute(sql`delete from race_target`);
      await tx.execute(sql`insert into race_target values (${publicId}::uuid)`);
    };
    const liveOnDay = async (metricKey: string) =>
      (
        await tx
          .select({ publicId: schema.entries.publicId, clientId: schema.entries.clientId })
          .from(schema.entries)
          .where(
            and(
              eq(schema.entries.profileId, athlete.id),
              eq(schema.entries.activityDate, RACE_DAY),
              eq(schema.entries.metricKey, metricKey),
              isNull(schema.entries.deletedAt),
            ),
          )
      ).map((r) => r.clientId);

    // (a) A practice: the day's live practice skips the insert and is cleared inside it. The new one
    //     lands, and the answer keeps submit order with the retried item FIRST, so a writer that
    //     appended retried results would fail. (A habit inserted once is `uq_entries_client_id`'s
    //     doing, not the retry's, so it is not asserted here.)
    const holder = {
      publicId: newId(),
      clientId: newId(),
      activityDate: RACE_DAY,
      unit: 'min',
      valueNum: '60',
      activityTypeId: practiceTypeId,
      metricKey: METRIC_KEYS.practice_minutes,
      status: ENTRY_STATUS.done,
    } satisfies CheckinInsertValue;
    const [held] = await writeCheckinEntries(exec, { profileId: athlete.id, values: [holder] });
    assert.equal(held?.outcome, 'created', 'race: the holder practice is logged');
    await holdThenClear(holder.publicId);

    const practice = { ...holder, publicId: newId(), clientId: newId(), valueNum: '90' };
    const habit = {
      publicId: newId(),
      clientId: newId(),
      activityDate: RACE_DAY,
      unit: 'count',
      valueNum: '1',
      activityTypeId: habitTypeId,
      metricKey: null,
      status: ENTRY_STATUS.done,
    } satisfies CheckinInsertValue;
    const raced = await writeCheckinEntries(exec, {
      profileId: athlete.id,
      values: [practice, habit],
    }).catch((error: unknown) => ({ threw: (error as Error).message }));
    assert.deepEqual(
      Array.isArray(raced) ? raced.map((r) => [r.clientId, r.outcome]) : raced,
      [
        [practice.clientId, 'created'],
        [habit.clientId, 'created'],
      ],
      'race: a practice whose day is cleared during its insert is created, in submit order, never a throw',
    );
    assert.deepEqual(
      await liveOnDay(METRIC_KEYS.practice_minutes),
      [practice.clientId],
      'race: the day holds the new practice only',
    );

    // (b) A weigh-in: the same race on the bodyweight day slot answers the new weigh-in's id.
    const weighIn = (clientId: string) => ({
      profileId: athlete.id,
      publicId: newId(),
      clientId,
      day: RACE_DAY,
      unit: 'lb',
      value: 112,
      notes: null,
      activityTypeId: weighInTypeId,
      kind: ENTRY_KIND.bodyweight,
    });
    const firstWeighIn = weighIn(newId());
    const wrote = await insertBodyweightEntry(exec, firstWeighIn);
    assert.ok('id' in wrote, 'race: the holder weigh-in is logged');
    await holdThenClear(firstWeighIn.publicId);

    const secondWeighIn = weighIn(newId());
    const racedWeighIn = await insertBodyweightEntry(exec, secondWeighIn).catch(
      (error: unknown) => ({ threw: (error as Error).message }),
    );
    assert.deepEqual(
      racedWeighIn,
      { id: secondWeighIn.publicId },
      'race: a weigh-in whose day is cleared during its insert is saved, never a throw',
    );
    assert.deepEqual(
      await liveOnDay(SEED_METRIC_KEYS.bodyweight),
      [secondWeighIn.clientId],
      "race: the day's weigh-in is the new one",
    );
  });
}
