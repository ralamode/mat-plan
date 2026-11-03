import { E2E_SESSION_BYPASS_USER, isLocalDbHost } from '@mat-plan/shared';

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
export function correctionTargetUrl(): string | undefined {
  return process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
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
  return isLocalDbHost(correctionTargetUrl() ?? '');
}
