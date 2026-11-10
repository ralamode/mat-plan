import type { NameMatch } from '@mat-plan/db';

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
    // The writer's own type, imported — not a fourth hand-typed copy. A type-only import is erased,
    // so nothing from `@mat-plan/db` reaches the client bundle this module is part of (precedent:
    // `lib/entries/adherence.ts`, `lib/programming/program-day.ts`).
    match: NameMatch;
    /** The household is at `MAX_HOUSEHOLD_ATHLETES`, so "Add another" would be refused — hide it. */
    atCap: boolean;
    /** The folded name this warning was issued for. */
    folded: string;
  };
};

export const INITIAL_ACTION_STATE: ActionState = { ok: false, error: null };
