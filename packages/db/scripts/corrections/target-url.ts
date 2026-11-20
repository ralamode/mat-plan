import {
  databaseNameOf,
  E2E_SESSION_BYPASS_USER,
  isLocalDbHost,
  namesPreviewDatabase,
  SEED_PUBLIC_IDS,
} from '@mat-plan/shared';

/**
 * 🔴 **The ONE expression that decides which database a correction touches.**
 *
 * It existed inline in `scripts/correct.ts` and nowhere else, which was fine while nothing else
 * needed to know. `AUTH-1` 1c-4a added a guard that must refuse on the target's host — and a guard
 * that resolves the target differently from the runner is not a guard, it is a second opinion.
 * `packages/shared/src/db-environment.ts` states the rule this is obeying, in the header of
 * `hasHostOverride`: _"A guard that inspects a different representation than the consumer is not a
 * guard"_ — the lesson from `?%68ost=` in `1c-3a`.
 *
 * ⚠️ **`DATABASE_URL_UNPOOLED` first, and that ordering is the whole hazard.** A developer running a
 * correction against production has a prod unpooled string on the command line (`runbooks.md`'s
 * claim-correction procedure puts it there) while `pnpm dev` may have left a **local**
 * `DATABASE_URL` in the environment. A guard reading `DATABASE_URL` would see `localhost`, pass, and
 * then watch the runner connect to Neon. Both must read this function.
 */
export function correctionTargetUrl({ kind }: { kind?: 'erasure' } = {}): string | undefined {
  // An erasure reads the direct string ONLY: no fallback, so a run with nothing but a pooled or a
  // leftover local `DATABASE_URL` resolves to "unset" and its gate refuses (PRIV-3 2b, panel 2S12;
  // brought forward by CAT-3 R0).
  if (kind === 'erasure') return process.env.DATABASE_URL_UNPOOLED;
  return process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
}

/**
 * Whether the target URL names NO database (`postgres://u:p@host`, no path). `pg` then connects to
 * `$PGDATABASE` or the user's name, so the URL alone cannot say which database is written (the
 * security lens confirmed it on `pg-connection-string@2.14.1`; CAT-3 R0, D1).
 *
 * ⚠️ **Each caller refuses on this in its OWN direction**, and it is not folded into a shared
 * local-or-preview helper: a refusal that counts an unnamed target as "preview" would let a
 * seed-household claim bind remotely. An unset URL is not "unnamed": it is unset.
 */
export function correctionTargetDatabaseIsUnnamed(url = correctionTargetUrl()): boolean {
  return url !== undefined && databaseNameOf(url) === null;
}

/**
 * 🔴 **May this Clerk id be bound to the database this run will connect to? (`AUTH-1` 1c-4a)**
 *
 * `true` for every real id — the maintainer's production claim is unaffected, and nothing here
 * constrains it. `false` only for the **committed e2e fixture principal** against a non-local
 * target, which is the one combination that can never be legitimate: that id exists solely so a
 * throwaway harness database can resolve a scope.
 *
 * ⚠️ **A separate function, exported, because the alternative was untestable.** Inline in the
 * correction it could only be exercised by standing up a database and a registry entry; here it is
 * two inputs and a boolean, and `target-url.test.ts` drives it directly — including the
 * `DATABASE_URL=localhost` + production `DATABASE_URL_UNPOOLED` case, which is a real environment
 * the runbook's own procedure produces, not a hypothetical one.
 */
export function fixtureBindIsAllowed(clerkUserId: string): boolean {
  if (clerkUserId !== E2E_SESSION_BYPASS_USER) return true;
  return correctionTargetIsLocal();
}

/**
 * Whether the database this run connects to is on this machine. Unset is NOT local: a correction run
 * with no target named is not a local one, and every caller treats unknown as the riskier case.
 */
export function correctionTargetIsLocal(): boolean {
  return isLocalDbHost(correctionTargetUrl() ?? '');
}

/**
 * Whether the database this run connects to is the preview estate's, by name (`seed.ts` applies the
 * same rule to fixtures). Unset or unparseable is NOT the preview.
 *
 * ⚠️ There is no positive test for PRODUCTION: its database is named `mat_plan`, like a local one.
 * This recognises the preview and nothing else.
 */
export function correctionTargetIsPreview(): boolean {
  return namesPreviewDatabase(databaseNameOf(correctionTargetUrl() ?? '') ?? '');
}

/**
 * 🔴 **May `household-claim-…` bind an account to the household with this `public_id`? (`PRIV-3` RC,
 * D6)**
 *
 * `true` for every household id outside `SEED_PUBLIC_IDS`. A SEED household id is allowed only on a
 * local or preview database, where the seed's fixtures may live: the e2e harness, CI's smoke step, a
 * developer's local claim and a preview claim all bind the seeded household on purpose. Anywhere else
 * it is refused, so after the fresh start no account can be bound to a seed-namespace household in
 * production again. Rows that already exist are not touched by this.
 *
 * ⚠️ **Compared as hex digits, not as the string typed.** `households.public_id` is a `uuid` column,
 * and Postgres reads `019826B4-…`, `{019826b4-…}` and the unhyphenated form as the same value, so a
 * plain `SEED_PUBLIC_IDS.has(input)` would let any of those spellings reach the seeded household.
 * Stripping to lower-case hex can only make more inputs match, which is the refusing direction.
 */
export function seedHouseholdClaimIsAllowed(householdPublicId: string): boolean {
  if (![...SEED_PUBLIC_IDS].some((id) => uuidHex(id) === uuidHex(householdPublicId))) return true;
  return correctionTargetIsLocal() || correctionTargetIsPreview();
}

/** A UUID's spelling reduced to the value Postgres reads: lower-case hex digits, nothing else. */
const uuidHex = (id: string) => id.toLowerCase().replace(/[^0-9a-f]/g, '');
