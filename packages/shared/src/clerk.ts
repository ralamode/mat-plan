/**
 * The shape of a Clerk user id (`user_…`), as every check in this repo applies it: the claim
 * correction, the household-creating correction, and `apps/web/lib/env.ts`'s bypass-principal
 * schema. One rule instead of three (`PRIV-3` RC, D2).
 *
 * **Bounded and anchored on purpose.** `startsWith('user_')` let a comma-pasted pair
 * (`user_a,user_b`) and a trailing zero-width character through, and `env.ts`'s own note asked for a
 * length bound. Letters and digits only after the prefix, 1 to 64 of them.
 *
 * ⚠️ A shape check, not an identity check: a development-instance id passes it exactly as a
 * production one does. Which instance an id came from is the operator's to get right.
 */
export const CLERK_USER_ID_PATTERN = /^user_[A-Za-z0-9]{1,64}$/;
