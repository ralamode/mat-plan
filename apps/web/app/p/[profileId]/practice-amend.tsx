'use client';

import {
  PRACTICE_AMEND_REFUSAL,
  PRACTICE_UNIT,
  parsePracticeMinutes,
  type PracticeAmendRefusal,
} from '@mat-plan/shared';

import { AMEND_ERROR_COPY, PRACTICE_COPY, RATE_LIMITED } from '@/lib/constants';

import { editPracticeAction } from './actions';
import { type AmendOutcome, SingleValueAmend } from './single-value-amend';

/** Each refusal's copy. A field error stays under the open editor; the rest go to the island. */
function outcomeFor(reason: PracticeAmendRefusal): AmendOutcome {
  switch (reason) {
    case PRACTICE_AMEND_REFUSAL.bad_value:
      return { ok: false, error: PRACTICE_COPY.outOfRange, field: PRACTICE_COPY.outOfRange };
    case PRACTICE_AMEND_REFUSAL.archived_blank:
      return { ok: false, error: PRACTICE_COPY.blankSave, field: PRACTICE_COPY.blankSave };
    case PRACTICE_AMEND_REFUSAL.closed_day:
      return { ok: false, error: AMEND_ERROR_COPY.dayReadOnly(PRACTICE_COPY.noun) };
    case PRACTICE_AMEND_REFUSAL.stale:
      return { ok: false, error: AMEND_ERROR_COPY.staleWrite };
    case PRACTICE_AMEND_REFUSAL.retry:
      return { ok: false, error: RATE_LIMITED };
    case PRACTICE_AMEND_REFUSAL.not_found:
      return { ok: false, error: AMEND_ERROR_COPY.notFound(PRACTICE_COPY.noun) };
  }
}

/**
 * Change a logged wrestling practice, or clear it with a blank ✓ (V1-24 3b-life A3). The editor is
 * `SingleValueAmend`; this is practice's wrapper: a numeric keypad, the unit as the metric's own (the
 * writers pin it, so nothing posts it), and **the edge** of the FAM-1 contract `editPracticeAction`
 * speaks: FormData stops here, the action takes typed input, and each refusal reason becomes copy.
 */
export function PracticeAmend({
  profileId,
  logged,
  canClear,
}: {
  profileId: string;
  logged: { entryId: string; minutes: number };
  /** False for an archived athlete: Change stays, a clear does not. */
  canClear: boolean;
}) {
  return (
    <SingleValueAmend
      logged={{ entryId: logged.entryId, value: logged.minutes, unit: PRACTICE_UNIT }}
      canClear={canClear}
      copy={PRACTICE_COPY}
      fieldLabel={PRACTICE_COPY.fieldLabel}
      inputMode="numeric"
      parse={parsePracticeMinutes}
      hiddenFields={{}}
      submit={async (formData) => {
        // ⚠️ Only a STRING reaches the action: a missing field must never become `''`, which is a
        // blank, which is a CLEAR (the schema refuses an absent value for exactly this reason).
        const value = formData.get('value');
        if (typeof value !== 'string') return outcomeFor(PRACTICE_AMEND_REFUSAL.bad_value);
        const result = await editPracticeAction({
          profilePublicId: profileId,
          entryId: logged.entryId,
          value,
          seenValue: logged.minutes,
        });
        return result.ok ? { ok: true } : outcomeFor(result.reason);
      }}
    />
  );
}
