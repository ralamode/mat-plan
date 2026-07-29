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
};

export const INITIAL_ACTION_STATE: ActionState = { ok: false, error: null };
