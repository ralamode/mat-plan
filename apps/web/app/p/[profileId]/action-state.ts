import type { ProfileKind } from '@mat-plan/shared';

/**
 * The typed result envelope every Server Action in this route returns, plus its initial value for
 * `useActionState`. Extracted so the shape AND the `{ ok:false, error:null }` seed live in ONE place —
 * the five form components all start from the same state instead of each re-declaring it. This lives
 * outside `actions.ts` on purpose: a `'use server'` module may only export async functions, so a plain
 * type + const belong in a sibling module (which `actions.ts` re-exports the type from).
 */
export type ActionState = {
  ok: boolean;
  error: string | null;
  fieldErrors?: Record<string, string[] | undefined>;
  /**
   * V1-24 3a-ii — the PUBLIC id of the record a successful create wrote (a strength session), so the
   * island can announce THIS save and focus its receipt. Set only on success; never an internal id.
   */
  savedId?: string;
  /**
   * PROF-1 a-1d — the add form's duplicate WARNING. Set only by `addAthleteAction`, and only on the
   * `{ ok: false, error: null }` branch: a name that already exists is not an error the parent made,
   * so it carries no `error` string and no `fieldErrors`.
   *
   * ⚠️ **A deliberate extension of the shared envelope, not an accident.** It sits here rather than
   * in a fork because `useActionState` needs one state type per form, and the add form produces both
   * ordinary refusals and this. `folded` is what the client compares `foldName(name)` against, so the
   * callout disappears the moment the typed name moves on instead of hanging over a field that has
   * changed underneath it.
   */
  duplicate?: {
    match: { publicId: string; name: string; kind: ProfileKind; archived: boolean };
    /** The household is at `MAX_HOUSEHOLD_ATHLETES`, so "Add another" would be refused — hide it. */
    atCap: boolean;
    /** The folded name this warning was issued for. */
    folded: string;
    /**
     * **What the parent typed and the kind they chose, so a render with no client state can rebuild
     * the form.** Without these, an island that mounts fresh with this answer already in `state` has
     * `name === ''`, so `foldName(name) !== folded` and the callout is discarded — the parent would
     * see an empty form and no message. Every other refusal on this form renders from `state` alone;
     * this was the one that did not. `name` is the PARSED value (trimmed, collapsed), so it folds to
     * `folded` by construction. ⚠️ The scenario (a JS-less or pre-hydration submit) is **not
     * demonstrated** — see `add-athlete-form.tsx` for why the harness cannot drive it, and
     * `docs/tech-debt.md` for the measurement.
     */
    typed: string;
    chosenKind: ProfileKind;
  };
};

export const INITIAL_ACTION_STATE: ActionState = { ok: false, error: null };
