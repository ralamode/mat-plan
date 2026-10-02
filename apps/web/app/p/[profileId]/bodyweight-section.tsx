import { BODYWEIGHT_COPY, BODYWEIGHT_RECEIPT_ID, VALUE_JOINER } from '@/lib/constants';
import type { LoggedBodyweight } from '@/lib/entries/activity-totals';

import { BodyweightAmend } from './bodyweight-amend';
import { BodyweightForm } from './bodyweight-form';
import { BodyweightReceipt, formatLoggedWeights } from './bodyweight-receipt';
import { SavedAnnouncer } from './saved-announcer';

/**
 * The weigh-in section of Today (V1-24 PR 1a): the form on a writable day with nothing logged, the
 * receipt otherwise. Extracted from `page.tsx` so the state switch — and the two day keys that
 * make it safe across a day change — are unit-testable (`bodyweight-section.test.tsx`).
 *
 * ⚠️ **The receipt renders OUTSIDE the `writable` gate, deliberately.** A closed day can still be
 * READ, and the day's truth must show on every day.
 *
 * ⚠️ **And when a weight IS logged the form is not rendered at all.** An empty input over an existing
 * record is what invited the duplicate row (`logBodyweight` dedupes only on `client_id`, and the form
 * used to rotate that key on every success). This removes the second-submit path; it does NOT make a
 * duplicate impossible — two mounts submitting concurrently (two phones, two tabs) can still write
 * two rows until PR 1d's unique index lands, which is why the receipt lists every row.
 */
export function BodyweightSection({
  profileId,
  day,
  writable,
  logged,
}: {
  profileId: string;
  day: string;
  writable: boolean;
  logged: readonly LoggedBodyweight[];
}) {
  const values = formatLoggedWeights(logged);
  const announcement =
    values.length > 0 ? BODYWEIGHT_COPY.announced(values.join(VALUE_JOINER)) : null;

  return (
    <section aria-labelledby="log-bw-heading" className="flex flex-col gap-3">
      <h2 id="log-bw-heading" className="text-lg font-medium">
        {BODYWEIGHT_COPY.heading}
      </h2>
      {/* Rendered in BOTH states and at a stable position, so its `role="status"` exists before the
          save it announces. Keyed on the day: paging to a day that already has a weight is a first
          render, not a none→value transition, and must not announce a save nobody made.
          ⚠️ The two keys are PREFIXED because they are siblings: a bare `key={day}` on both is a
          duplicate key, and React then keeps a stale announcer beside the new one (caught by
          `bodyweight-section.test.tsx`). */}
      <SavedAnnouncer
        key={`announcer-${day}`}
        saved={announcement}
        focusId={BODYWEIGHT_RECEIPT_ID}
      />
      {logged.length === 0 && writable ? (
        // ⚠️ The day key is load-bearing. Day navigation (and a stale tab re-rendering after
        // midnight) is a client-side RSC transition, so without it this form survives a day change
        // with its `useState(newId)` client id. A key already sent for one day is then replayed for
        // another — an `ON CONFLICT DO NOTHING` no-op that reports success and saves nothing. One
        // mount per day makes "one key per day" structural, and drops the other day's typed value
        // and error with it.
        <BodyweightForm key={`form-${day}`} profileId={profileId} day={day} />
      ) : (
        <BodyweightReceipt
          logged={logged}
          writable={writable}
          // ⚠️ Passed on EVERY day, closed ones included — the amend has no day bound (Decision 5).
          // Gating it on `writable` would be that bound wearing a client-side hat, and would hide
          // the control on exactly the history days a typo is found on.
          //
          // ⚠️ ...but only when there is ONE row. The receipt renders duplicates as a single
          // `2 weights logged: 84.5 lb, 845 lb` line into a row that takes ONE control, and an
          // amend addresses ONE entryId — so a lone Change there would silently edit an unstated
          // one of them, most likely the correct one, leaving two wrong values where there was one.
          // `BODYWEIGHT_COPY.duplicates` keeps saying "ask a parent" until 1c/1d remove the extra
          // row, which an amend cannot do. A per-row control is a receipt-shape change, not a slot.
          control={
            logged.length === 1 ? (
              // ⚠️ Keyed on the ENTRY, like the create form is keyed on the day: paging days is a
              // client-side transition, so an unkeyed island would survive it with day A's typed
              // value while its hidden entryId/seenValue re-rendered to day B's — and Save would
              // amend B. A row replaced under the same day remounts it too.
              <BodyweightAmend
                key={`amend-${logged[0]!.entryId}`}
                profileId={profileId}
                logged={logged[0]!}
              />
            ) : undefined
          }
        />
      )}
    </section>
  );
}
