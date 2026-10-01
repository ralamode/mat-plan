import { and, eq, isNull } from 'drizzle-orm';

import { schema } from '../client';
import type { Executor } from './executor';

/**
 * The ownership predicates every guarded write shares (V1-24 PR 1b).
 *
 * ## Why these are named rather than re-typed
 *
 * `and(eq(profiles.publicId, …), isNull(profiles.deletedAt))` appeared **eleven** times across the
 * writers, the queries and the app DAL. `queries/program-day.ts` already argues the case against
 * itself, one function down:
 *
 * > *"THE ownership predicate … Named once and used by BOTH sub-selects below … so the two can never
 * > drift into scoping by different rules — which is exactly how a BOLA hole gets introduced by a
 * > later edit."*
 *
 * That reasoning does not stop at a function boundary. AGENTS.md: *"Reuse small logic too — a
 * validation/derivation used in two places becomes one exported helper, not a copy-paste."* This is a
 * **security** predicate, which is the strongest case there is for single-sourcing it.
 *
 * ⚠️ Extracted here with **two** consumers, not speculatively: `updateStrengthSetById` converts to a
 * caller in the same PR, so V1-9's existing `db:verify` cross-profile proof covers this helper for
 * free (and `db:verify` proves the profile soft-delete half for both writers). `listEntriesForDay`
 * (the app DAL's day read) and `weeklyAdherenceRows` joined in DAL-1 — the two sites that had
 * skipped the soft-delete half. Nine full hand-written copies remain, a separate sweep — see DAL-2 in
 * docs/plan.md.
 */

/** THE live-profile predicate. One definition, so no call site can scope by a weaker rule. */
export function isLiveProfile(profilePublicId: string) {
  return and(eq(schema.profiles.publicId, profilePublicId), isNull(schema.profiles.deletedAt));
}

/**
 * Internal ids of the LIVE entries owned by the profile named by `public_id`.
 *
 * Drizzle's `update()` cannot JOIN and `sql.raw` is banned (AGENTS.md), so every guarded UPDATE
 * proves parent ownership by riding this as `inArray(<fk>, ownedEntryIds(exec, id))`. Taking the
 * PUBLIC id — never an internal one from the request — is the seam itself.
 */
export function ownedEntryIds(exec: Executor, profilePublicId: string) {
  return exec
    .select({ id: schema.entries.id })
    .from(schema.entries)
    .innerJoin(schema.profiles, eq(schema.entries.profileId, schema.profiles.id))
    .where(and(isLiveProfile(profilePublicId), isNull(schema.entries.deletedAt)));
}
