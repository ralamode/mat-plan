'use client';

import { useState } from 'react';

import type { ActionState } from './action-state';

/**
 * Run `onSuccess` once, on the render where a `useActionState` result first turns `ok` (V1-24 PR 1b).
 *
 * ## The during-render idiom, single-sourced
 *
 * This is React's documented "adjust state while rendering" pattern, not an effect: the collapse
 * happens in the SAME commit as the new state, so an editor never flashes open over its saved value.
 * It was copy-pasted four times before this: in three log forms that FAM-1 12f deleted, and in
 * `routine-editor.tsx`, whose own comment called itself *"the strength-form during-render idiom"*: a
 * copy that knew it was a copy. The routine editor and Household settings' archive/restore use this. AGENTS.md: *"Reuse small logic too — a
 * validation/derivation used in two places becomes one exported helper."*
 *
 * ⚠️ `onSuccess` must only touch the CALLER'S OWN state. Reaching into a parent mid-render is the
 * thing this pattern is legal only without.
 *
 * ⚠️ Compared by IDENTITY, not by `.ok`. `useActionState` returns a fresh object per submit, so two
 * consecutive successful saves each fire — which is what makes a second correction collapse the
 * editor too. The day page's single values do not use this either: they report from the action's own
 * result through `single-value-live.tsx`.
 */
export function useOnActionSuccess(state: ActionState, onSuccess: () => void): void {
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state.ok) onSuccess();
  }
}
