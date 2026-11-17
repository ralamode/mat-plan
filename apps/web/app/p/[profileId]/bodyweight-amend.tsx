'use client';

import { parseTypedWeight } from '@mat-plan/shared';

import { AMEND_COPY, AMEND_ERROR_COPY, BODYWEIGHT_COPY } from '@/lib/constants';
import type { LoggedBodyweight } from '@/lib/entries/activity-totals';

import { INITIAL_ACTION_STATE } from './action-state';
import { editBodyweightAction } from './actions';
import { SingleValueAmend } from './single-value-amend';

/**
 * Change an already-logged bodyweight (V1-24 PR 1b), or clear it with a blank ✓ (3b-bw, plan W5).
 * The editor itself is `SingleValueAmend`, shared with practice since 3b-life; its docblock holds the
 * reasoning. This wrapper is bodyweight's: a decimal keypad, the unit posted as a guard (the bound is
 * per unit, and the writer pins it), and the form action's envelope mapped to the editor's outcome.
 */
export function BodyweightAmend({
  profileId,
  logged,
  canClear,
}: {
  profileId: string;
  logged: LoggedBodyweight;
  /** False for an archived athlete: Change stays, a clear does not (plan W5). */
  canClear: boolean;
}) {
  return (
    <SingleValueAmend
      logged={logged}
      canClear={canClear}
      copy={BODYWEIGHT_COPY}
      fieldLabel={AMEND_COPY.valueLabel(logged.unit)}
      inputMode="decimal"
      parse={parseTypedWeight}
      hiddenFields={{ profileId, entryId: logged.entryId, unit: logged.unit }}
      submit={async (formData) => {
        const result = await editBodyweightAction(INITIAL_ACTION_STATE, formData);
        if (result.ok) return { ok: true };
        const field = result.fieldErrors?.value?.[0];
        // A zod refusal on a field this editor does not show (a tampered `unit` or `seenValue`, or a
        // stale bundle) has no "errors below" to point at; say what is true instead.
        if (result.fieldErrors && !field) {
          return { ok: false, error: AMEND_ERROR_COPY.notFound(BODYWEIGHT_COPY.changeSubject) };
        }
        return { ok: false, error: result.error ?? '', field };
      }}
    />
  );
}
