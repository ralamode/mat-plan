import assert from 'node:assert/strict';

import {
  ENTRY_KIND,
  ENTRY_STATUS,
  newId,
  PROFILE_KIND,
  SEED_ACTIVITY_TYPE_KEYS,
  SEED_METRIC_KEYS,
} from '@mat-plan/shared';
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';

import { schema } from '../../src/client';
import { lastBodyweightBefore } from '../../src/queries/last-bodyweight';
import { insertBodyweightEntry } from '../../src/writers/bodyweight';
import { householdScopeForScript } from '../../src/writers/household-scope-script';
import { bodyweightRowForAmend, clearBodyweight } from '../../src/writers/single-value';
import { asTx, rolledBack, type VerifyContext } from './harness';

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
    // A weigh-in of the WRONG SHAPE holding the value the form would post: non-`done`. Without the
    // status pin it would be found and cleared. (A text-valued weigh-in cannot be inserted at all:
    // the entries CHECKs refuse it, so the `value_text IS NULL` pin is unproven here and harmless.)
    const skippedBw = await weighInRow(athlete.id, '2026-10-11', 84.5, {
      status: ENTRY_STATUS.skipped,
    });
    const clear = (entryId: string, over: Partial<{ unit: string; seenValue: number }> = {}) =>
      clearBodyweight(exec, { ...asAthlete, entryId, unit: 'lb', seenValue: 84.5, ...over });

    assert.deepEqual(
      await clear(other, { unit: otherMetric.unit, seenValue: 7 }),
      { notFound: true },
      "3b-bw: clearBodyweight refuses another metric's entry — the metric is pinned, not posted",
    );
    for (const [id, why] of [[skippedBw, 'a non-done weigh-in']] as const) {
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
    await weighInRow(athlete.id, D, 73);
    await weighInRow(athlete.id, '2026-10-21', 74);
    assert.deepEqual(
      await lastBodyweightBefore(exec, { ...asAthlete, day: D }),
      { value: 70, unit: 'lb', day: '2026-10-15' },
      '3b-bw: "Last time" is the latest LIVE done weigh-in strictly before the day — a cleared one, a non-done one, the day itself and a later day are all skipped',
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
