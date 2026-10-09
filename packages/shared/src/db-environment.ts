/**
 * OPS-1 — one rule: a deployment's environment must agree with the database it is pointed at.
 *
 * Plan: docs/plans/ops-1-preview-isolation.md. Procedure: docs/runbooks.md → OPS-1.
 *
 * Until OPS-1, every Vercel scope shared one `DATABASE_URL`, so a preview deployment of any pull
 * request read and wrote **production** — two minors' logged bodyweight. Previews now get a separate,
 * seed-only Neon project whose database is named with `preview` in it, and this module is what makes
 * a mis-wiring fail **loudly** instead of silently reaching production.
 *
 * Lives here (not in `apps/web/lib/`) because there are two consumers in two packages: the app's
 * `lib/env.ts` and `packages/db`'s migrate/seed scripts, which hold DDL rights and previously took
 * whatever connection string they were handed.
 *
 * ## The rule
 *
 *   databaseUrl absent                  -> pass   (nothing to connect to)
 *   database name unparseable or empty  -> THROW  (fail closed)
 *   VERCEL_ENV === 'production'         -> the name must NOT contain 'preview'
 *   VERCEL_ENV set, anything else       -> the name MUST contain 'preview'
 *   VERCEL_ENV absent, host is local    -> pass   (dev, CI, e2e, PGlite, screenshots)
 *   VERCEL_ENV absent, host NOT local   -> THROW  unless allowLiveDb
 *
 * **The last line is why this is fail-CLOSED.** `VERCEL_ENV` is a Vercel *system* environment
 * variable, gated on the project's "Enable access to System Environment Variables" toggle — so a
 * rule keyed only on `VERCEL_ENV` would silently no-op if that toggle were ever off, leaving exactly
 * the hole OPS-1 exists to close. Keying the "no environment declared" case off database *locality*
 * removes that dependency: off Vercel every caller in this repo already targets localhost, so the
 * only process needing `ALLOW_LIVE_DB=1` is `pnpm dev:prod`, which exists to hit live Neon on purpose.
 *
 * Note that anything other than `production` must name a preview database — `development` included,
 * because Vercel's Development scope held the same production values and `vercel env pull` would hand
 * them to a laptop.
 *
 * ## No message ever says anything about DATABASE_URL
 *
 * These throws happen at module import, so a message becomes a Vercel build-log line and, in a live
 * deployment, a Sentry event. Every message is one of the `DB_ENV_MESSAGE` builders below and
 * interpolates only non-secret values (`VERCEL_ENV`, a caller-supplied context label) — never the
 * host, the user, the password, or even the database name. They carry the *rule* instead of the
 * observed value, which is just as actionable. The colocated test asserts message **equality**
 * against these constants, because `expect(msg).not.toContain(password)` passes vacuously.
 *
 * Zero-dependency and pure on purpose: no env reads, no `server-only`, no zod, so both consumers and
 * the unit test can call it directly.
 */

/** The two estates the migrator can be aimed at. `development` is not a migration target. */
export const MIGRATION_TARGETS = ['production', 'preview'] as const;
export type MigrationTarget = (typeof MIGRATION_TARGETS)[number];

/**
 * The preview database's name, and the token the rule actually matches on.
 *
 * **Load-bearing, not a style preference:** the guard compares `VERCEL_ENV` against the database name
 * because that is the only thing available inside a deployment that inspects the *real connection
 * string* rather than another declaration. The runbook names the Neon database `mat_plan_preview` for
 * this reason. Consequence, stated plainly: the rule cannot catch a preview database someone named
 * like production, nor a production database renamed to contain `preview`.
 */
export const PREVIEW_DB_NAME = 'mat_plan_preview';
export const PREVIEW_DB_NAME_TOKEN = 'preview';

/**
 * Hosts that mean "this is a throwaway database on this machine".
 *
 * `[::1]` as well as `::1`: the WHATWG `URL` parser returns IPv6 hostnames **bracketed**, so a set
 * holding only the bare form would miss `postgres://u:p@[::1]:5432/db`.
 */
const LOCAL_DB_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

/** The database name from a connection string, or `null` when there isn't one. Fail closed. */
export function databaseNameOf(connectionString: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(connectionString).pathname;
  } catch {
    return null;
  }
  // A Postgres URL has exactly one path segment: `postgres://user:pass@host:port/<database>`.
  // Both `postgres://u:p@h` and `postgres://u:p@h/` parse fine and yield '' — a string with no
  // database selected at all, which must fail rather than quietly satisfy a `production` check.
  const name = pathname.replace(/^\//, '');
  return name.length > 0 ? name : null;
}

/** Whether the connection string points at this machine. Unparseable => not local (fail closed). */
export function isLocalDbHost(connectionString: string): boolean {
  try {
    return LOCAL_DB_HOSTS.has(new URL(connectionString).hostname);
  } catch {
    return false;
  }
}

/** Whether a database NAME (not a URL) is a preview database's. */
export function namesPreviewDatabase(databaseName: string): boolean {
  return databaseName.toLowerCase().includes(PREVIEW_DB_NAME_TOKEN);
}

const RUNBOOK = 'docs/runbooks.md -> OPS-1';

/**
 * Every message this module can throw. Builders, not bare strings, because each names the rule it
 * enforces — but they interpolate only non-secret values. Nothing derived from `DATABASE_URL`,
 * including the database name, appears in any of them. The test pins this key set, so adding a
 * message forces a test edit.
 */
export const DB_ENV_MESSAGE = {
  unknownDatabase: (context: string) =>
    `${context}: refusing to connect — the connection string names no database. ` +
    `It must end in /<database>. (${RUNBOOK})`,

  expectedPreviewDatabase: (vercelEnv: string) =>
    `Refusing to boot: VERCEL_ENV=${vercelEnv}, but DATABASE_URL does not name a preview database ` +
    `— its database name must contain "${PREVIEW_DB_NAME_TOKEN}". A non-production deployment must ` +
    `never hold the production connection string. Fix the Vercel ${vercelEnv} scope; do NOT set ` +
    `SKIP_ENV_VALIDATION. (${RUNBOOK})`,

  unexpectedPreviewDatabase: () =>
    `Refusing to boot: VERCEL_ENV=production, but DATABASE_URL names a preview database (its ` +
    `database name contains "${PREVIEW_DB_NAME_TOKEN}"), so production would serve preview data. ` +
    `(${RUNBOOK})`,

  remoteDatabaseWithoutEnvironment: (context: string) =>
    `${context}: refusing to connect to a NON-LOCAL database when VERCEL_ENV is not set, because ` +
    `the environment cannot be verified. On Vercel this means "Enable access to System Environment ` +
    `Variables" is OFF — turn it on. Off Vercel, set ALLOW_LIVE_DB=1 to target a live database ` +
    `deliberately (that is what \`pnpm dev:prod\` does). (${RUNBOOK})`,

  migrationTargetMismatch: (expected: MigrationTarget) =>
    `Refusing to migrate: EXPECTED_DB_ENV=${expected}, but the connection string does not name a ` +
    `${expected} database (a preview database's name contains "${PREVIEW_DB_NAME_TOKEN}"; ` +
    `production's must not). Check which secret this job was given. (${RUNBOOK})`,

  unknownMigrationTarget: (expected: string) =>
    `EXPECTED_DB_ENV=${expected} is not a migration target. Use one of: ` +
    `${MIGRATION_TARGETS.join(', ')}. (${RUNBOOK})`,
} as const;

/**
 * The app-side guard. Called UNCONDITIONALLY from `apps/web/lib/env.ts` — deliberately outside the
 * `SKIP_ENV_VALIDATION` gate, because leaving it inside would make one Vercel environment variable a
 * silent kill switch for the whole of OPS-1, and a red build is exactly the moment someone reaches
 * for that flag. (`pnpm preview:check` also fails if `SKIP_ENV_VALIDATION` exists in any scope.)
 */
export function assertDatabaseEnvironment(input: {
  /** `process.env.VERCEL_ENV` — set by the platform at build AND runtime; absent off Vercel. */
  vercelEnv: string | undefined;
  /** `process.env.DATABASE_URL`. Absent => nothing to connect to => nothing to check. */
  databaseUrl: string | undefined;
  /** The deliberate opt-in for a non-local database off Vercel (`pnpm dev:prod`). */
  allowLiveDb: boolean;
  context?: string;
}): void {
  const context = input.context ?? 'lib/env.ts';
  if (!input.databaseUrl) return;

  const databaseName = databaseNameOf(input.databaseUrl);
  if (databaseName === null) throw new Error(DB_ENV_MESSAGE.unknownDatabase(context));

  const vercelEnv = input.vercelEnv?.trim();
  if (vercelEnv) {
    // A Vercel CUSTOM environment reports its own slug here, outside the documented three. Treating
    // anything that is not 'production' as needing a preview database is the safe direction.
    if (vercelEnv === 'production') {
      if (namesPreviewDatabase(databaseName)) {
        throw new Error(DB_ENV_MESSAGE.unexpectedPreviewDatabase());
      }
      return;
    }
    if (!namesPreviewDatabase(databaseName)) {
      throw new Error(DB_ENV_MESSAGE.expectedPreviewDatabase(vercelEnv));
    }
    return;
  }

  if (isLocalDbHost(input.databaseUrl)) return;
  if (input.allowLiveDb) return;
  throw new Error(DB_ENV_MESSAGE.remoteDatabaseWithoutEnvironment(context));
}

/**
 * The migrator-side guard, for `packages/db/scripts/migrate.ts` and `seed.ts`.
 *
 * Those scripts took whatever `DATABASE_URL_UNPOOLED` they were handed. OPS-1 adds a SECOND migrator
 * secret, so the mis-paste is now live in both directions, and the quieter one is worse: the
 * production string in `PREVIEW_DATABASE_URL_UNPOOLED` DDLs and seeds production (the seed is
 * `ON CONFLICT DO NOTHING`, so it is silent), while the preview string in `DATABASE_URL_UNPOOLED`
 * leaves the production job **green** as production stops being migrated and drifts.
 *
 * `expected` is `EXPECTED_DB_ENV`, set by each workflow. Unset => no check, so local runs, CI and
 * `db:verify` are untouched.
 */
export function assertMigrationTarget(
  expected: string | undefined,
  connectionString: string,
  context = 'migrator',
): void {
  const want = expected?.trim();
  if (!want) return;
  if (!(MIGRATION_TARGETS as readonly string[]).includes(want)) {
    throw new Error(DB_ENV_MESSAGE.unknownMigrationTarget(want));
  }
  const target = want as MigrationTarget;

  const databaseName = databaseNameOf(connectionString);
  if (databaseName === null) throw new Error(DB_ENV_MESSAGE.unknownDatabase(context));

  if (namesPreviewDatabase(databaseName) !== (target === 'preview')) {
    throw new Error(DB_ENV_MESSAGE.migrationTargetMismatch(target));
  }
}
