import { describe, expect, it } from 'vitest';

import {
  assertDatabaseEnvironment,
  assertMigrationTarget,
  databaseNameOf,
  DB_ENV_MESSAGE,
  isLocalDbHost,
  MIGRATION_TARGETS,
  PREVIEW_DB_NAME,
  PREVIEW_DB_NAME_TOKEN,
} from './db-environment';

/**
 * OPS-1's guard (docs/plans/ops-1-preview-isolation.md).
 *
 * Two things this file is careful about, both from the review panel:
 *
 * 1. **Messages are asserted by EQUALITY against the exported builder**, never with
 *    `not.toContain(password)` — a denylist assertion over one fixture substring passes for any
 *    message, including one a later edit extends with the host or the whole URL.
 * 2. **The fixture URLs are the shapes this repo really produces** (the embedded-Postgres harness,
 *    ci.yml's build placeholder and e2e service, vitest.config.ts, a Neon pooled string with a
 *    percent-encoded password), so a pass here means the real callers pass.
 */

// Shapes the repo actually produces — see the module doc for why each one matters.
const EMBEDDED = `postgresql://postgres:local-dev@127.0.0.1:54329/mat_plan`;
const CI_BUILD_PLACEHOLDER = `postgres://user:pass@localhost:5432/db`;
const CI_E2E_SERVICE = `postgres://mat:mat@localhost:5432/mat_plan_test`;
const VITEST = `postgres://user:pass@localhost:5432/mat_plan_test`;
const IPV6_LOCAL = `postgres://u:p@[::1]:5432/mat_plan`;
const NEON_PROD = `postgres://user:p%40ss@ep-cool-1234-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require`;
const NEON_PREVIEW = `postgres://user:p%40ss@ep-calm-9876-pooler.us-east-1.aws.neon.tech/${PREVIEW_DB_NAME}?sslmode=require`;

const LOCAL_SHAPES = [
  ['embedded postgres (pnpm dev / e2e:local / screenshots)', EMBEDDED],
  ["ci.yml's next build placeholder", CI_BUILD_PLACEHOLDER],
  ["ci.yml's e2e service", CI_E2E_SERVICE],
  ['vitest.config.ts', VITEST],
  ['bracketed IPv6 loopback', IPV6_LOCAL],
] as const;

describe('databaseNameOf', () => {
  it('reads the database name out of every shape the repo produces', () => {
    expect(databaseNameOf(EMBEDDED)).toBe('mat_plan');
    expect(databaseNameOf(CI_BUILD_PLACEHOLDER)).toBe('db');
    expect(databaseNameOf(CI_E2E_SERVICE)).toBe('mat_plan_test');
    expect(databaseNameOf(NEON_PROD)).toBe('neondb');
    expect(databaseNameOf(NEON_PREVIEW)).toBe(PREVIEW_DB_NAME);
  });

  it('returns null when there is no database to name — both shapes parse, so both must fail', () => {
    expect(databaseNameOf('postgres://u:p@host.neon.tech')).toBeNull();
    expect(databaseNameOf('postgres://u:p@host.neon.tech/')).toBeNull();
  });

  it('returns null for an unparseable string rather than throwing', () => {
    expect(databaseNameOf('not a url')).toBeNull();
    expect(databaseNameOf('')).toBeNull();
  });
});

describe('isLocalDbHost', () => {
  it.each(LOCAL_SHAPES)('is local: %s', (_label, url) => {
    expect(isLocalDbHost(url)).toBe(true);
  });

  it('is not local for Neon, and not local for garbage (fail closed)', () => {
    expect(isLocalDbHost(NEON_PROD)).toBe(false);
    expect(isLocalDbHost('not a url')).toBe(false);
  });
});

describe('assertDatabaseEnvironment — off Vercel (local dev, CI, e2e, screenshots)', () => {
  it.each(LOCAL_SHAPES)('passes with no VERCEL_ENV and a local database: %s', (_label, url) => {
    expect(() =>
      assertDatabaseEnvironment({ vercelEnv: undefined, databaseUrl: url, allowLiveDb: false }),
    ).not.toThrow();
  });

  it('passes when DATABASE_URL is absent — there is nothing to connect to', () => {
    expect(() =>
      assertDatabaseEnvironment({
        vercelEnv: undefined,
        databaseUrl: undefined,
        allowLiveDb: false,
      }),
    ).not.toThrow();
  });

  // The fail-closed case the review panel added: without it, a Vercel project whose
  // "system environment variables" toggle is off would boot against production in silence.
  it('THROWS for a non-local database with no VERCEL_ENV and no opt-in', () => {
    expect(() =>
      assertDatabaseEnvironment({
        vercelEnv: undefined,
        databaseUrl: NEON_PROD,
        allowLiveDb: false,
        context: 'lib/env.ts',
      }),
    ).toThrow(DB_ENV_MESSAGE.remoteDatabaseWithoutEnvironment('lib/env.ts'));
  });

  it('passes for a non-local database when ALLOW_LIVE_DB opted in (pnpm dev:prod)', () => {
    expect(() =>
      assertDatabaseEnvironment({
        vercelEnv: undefined,
        databaseUrl: NEON_PROD,
        allowLiveDb: true,
      }),
    ).not.toThrow();
  });
});

describe('assertDatabaseEnvironment — on Vercel', () => {
  // This is the configuration that existed before OPS-1: one DATABASE_URL for every scope.
  it('THROWS on a preview deployment holding the production string (the pre-OPS-1 state)', () => {
    expect(() =>
      assertDatabaseEnvironment({
        vercelEnv: 'preview',
        databaseUrl: NEON_PROD,
        allowLiveDb: false,
      }),
    ).toThrow(DB_ENV_MESSAGE.expectedPreviewDatabase('preview'));
  });

  it('THROWS on the development scope holding the production string', () => {
    expect(() =>
      assertDatabaseEnvironment({
        vercelEnv: 'development',
        databaseUrl: NEON_PROD,
        allowLiveDb: false,
      }),
    ).toThrow(DB_ENV_MESSAGE.expectedPreviewDatabase('development'));
  });

  it('treats a custom-environment slug as non-production, so the preview rule applies', () => {
    expect(() =>
      assertDatabaseEnvironment({
        vercelEnv: 'staging-demo',
        databaseUrl: NEON_PROD,
        allowLiveDb: false,
      }),
    ).toThrow(DB_ENV_MESSAGE.expectedPreviewDatabase('staging-demo'));
  });

  it('THROWS on production holding the preview string', () => {
    expect(() =>
      assertDatabaseEnvironment({
        vercelEnv: 'production',
        databaseUrl: NEON_PREVIEW,
        allowLiveDb: false,
      }),
    ).toThrow(DB_ENV_MESSAGE.unexpectedPreviewDatabase());
  });

  it('passes the two correct wirings', () => {
    expect(() =>
      assertDatabaseEnvironment({
        vercelEnv: 'preview',
        databaseUrl: NEON_PREVIEW,
        allowLiveDb: false,
      }),
    ).not.toThrow();
    expect(() =>
      assertDatabaseEnvironment({
        vercelEnv: 'production',
        databaseUrl: NEON_PROD,
        allowLiveDb: false,
      }),
    ).not.toThrow();
  });

  it('THROWS when the string names no database at all, under either declaration', () => {
    for (const vercelEnv of ['production', 'preview']) {
      expect(() =>
        assertDatabaseEnvironment({
          vercelEnv,
          databaseUrl: 'postgres://u:p@host.neon.tech',
          allowLiveDb: false,
          context: 'lib/env.ts',
        }),
      ).toThrow(DB_ENV_MESSAGE.unknownDatabase('lib/env.ts'));
    }
  });

  it('ignores whitespace-only VERCEL_ENV rather than treating it as an environment', () => {
    // '   ' must fall through to the locality rule, not be compared as an environment name.
    expect(() =>
      assertDatabaseEnvironment({ vercelEnv: '   ', databaseUrl: EMBEDDED, allowLiveDb: false }),
    ).not.toThrow();
  });
});

describe('assertMigrationTarget', () => {
  it('passes when EXPECTED_DB_ENV is unset — local runs, CI and db:verify are untouched', () => {
    expect(() => assertMigrationTarget(undefined, NEON_PROD)).not.toThrow();
    expect(() => assertMigrationTarget('', EMBEDDED)).not.toThrow();
  });

  it('passes the two correct pairings', () => {
    expect(() => assertMigrationTarget('production', NEON_PROD)).not.toThrow();
    expect(() => assertMigrationTarget('preview', NEON_PREVIEW)).not.toThrow();
  });

  // The loud direction: the preview job would otherwise DDL + seed production silently.
  it('THROWS when the preview job is handed the production string', () => {
    expect(() => assertMigrationTarget('preview', NEON_PROD)).toThrow(
      DB_ENV_MESSAGE.migrationTargetMismatch('preview'),
    );
  });

  // The quiet direction, which is worse: production stops being migrated and the job goes green.
  it('THROWS when the production job is handed the preview string', () => {
    expect(() => assertMigrationTarget('production', NEON_PREVIEW)).toThrow(
      DB_ENV_MESSAGE.migrationTargetMismatch('production'),
    );
  });

  it('THROWS on an EXPECTED_DB_ENV that is not a migration target', () => {
    expect(() => assertMigrationTarget('development', NEON_PROD)).toThrow(
      DB_ENV_MESSAGE.unknownMigrationTarget('development'),
    );
  });

  it('THROWS when the string names no database', () => {
    expect(() => assertMigrationTarget('preview', 'postgres://u:p@h/', 'db:migrate')).toThrow(
      DB_ENV_MESSAGE.unknownDatabase('db:migrate'),
    );
  });
});

describe('the message contract', () => {
  const EVERY_MESSAGE = [
    DB_ENV_MESSAGE.unknownDatabase('ctx'),
    DB_ENV_MESSAGE.expectedPreviewDatabase('preview'),
    DB_ENV_MESSAGE.unexpectedPreviewDatabase(),
    DB_ENV_MESSAGE.remoteDatabaseWithoutEnvironment('ctx'),
    DB_ENV_MESSAGE.migrationTargetMismatch('production'),
    DB_ENV_MESSAGE.unknownMigrationTarget('nope'),
  ];

  // Pinned so that ADDING a message forces an edit here, which is where the no-leak rule is checked.
  it('is exactly this set of builders', () => {
    expect(Object.keys(DB_ENV_MESSAGE).sort()).toEqual([
      'expectedPreviewDatabase',
      'migrationTargetMismatch',
      'remoteDatabaseWithoutEnvironment',
      'unexpectedPreviewDatabase',
      'unknownDatabase',
      'unknownMigrationTarget',
    ]);
  });

  // These throws land in a Vercel build log and, at runtime, a Sentry event. Nothing derived from
  // DATABASE_URL may appear — not the password, not the host, not even the database name. Asserted
  // against the *distinctive* parts of a real connection string rather than a whole-URL substring.
  it('leaks nothing derived from a connection string', () => {
    const forbidden = [
      'p%40ss',
      'ep-cool-1234-pooler.us-east-1.aws.neon.tech',
      'neondb',
      'mat_plan_preview',
      NEON_PROD,
      NEON_PREVIEW,
    ];
    for (const message of EVERY_MESSAGE) {
      for (const secret of forbidden) {
        expect(message).not.toContain(secret);
      }
    }
  });

  // The bare token is the RULE, so it is allowed — and it must be there, or the message cannot be
  // acted on. `mat_plan_preview` (the name itself) is forbidden above; `preview` is not.
  it('states the rule it enforces', () => {
    expect(DB_ENV_MESSAGE.expectedPreviewDatabase('preview')).toContain(PREVIEW_DB_NAME_TOKEN);
    expect(DB_ENV_MESSAGE.unknownMigrationTarget('nope')).toContain(MIGRATION_TARGETS.join(', '));
    // Every message points at the procedure that fixes it.
    for (const message of EVERY_MESSAGE) {
      expect(message).toContain('docs/runbooks.md');
    }
  });
});
