import { globSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { SEED_FIXTURES_ENV } from '@mat-plan/db';
import { describe, expect, it } from 'vitest';

import { WEB_DIR } from './source-scan';

/** The repo root. `WEB_DIR` is `apps/web`, so workflows sit two levels up and outside every `appSources()` sweep. */
const REPO = resolve(WEB_DIR, '../..');

/**
 * 🔴 **The program-fixtures flag is contained — FAM-1 step 1 (plan D10).**
 *
 * `SEED_FIXTURES=1` makes `db:seed` write the seed household and its athletes (`OPS-2`), the authored
 * program and lane P's fixture programs.
 * `migrate.yml` seeds **production**, so the flag must never reach it. The seed refuses the flag
 * against a URL that is neither local nor the preview database (`packages/db/src/seed.ts` →
 * `assertFixturesTargetAllowed`); this is the other half: no workflow but the two test ones names it.
 * Modelled on `fixture-member-is-contained.test.ts`.
 */
describe('the program-fixtures flag is contained (FAM-1 D10)', () => {
  /** Imported, not re-typed. The workflows are YAML and spell it as a literal, which is what this checks. */
  const FLAG = SEED_FIXTURES_ENV;

  const workflows = globSync('.github/workflows/*.{yml,yaml}', { cwd: REPO });

  it('only the CI smoke job and the preview migration set it', () => {
    // Non-vacuity: a mis-rooted glob must fail loudly rather than pass by finding nothing.
    expect(workflows.length).toBeGreaterThan(3);
    const naming = workflows.filter((f) => readFileSync(join(REPO, f), 'utf8').includes(FLAG));
    expect(
      naming.sort(),
      'migrate.yml seeds PRODUCTION: the program fixtures must never be seeded from it',
    ).toEqual(['.github/workflows/ci.yml', '.github/workflows/migrate-preview.yml']);
  });

  it('no workflow that targets production names it', () => {
    const production = workflows.filter((f) =>
      /EXPECTED_DB_ENV:\s*production/.test(readFileSync(join(REPO, f), 'utf8')),
    );
    // Non-vacuity: migrate.yml declares production, so the set this checks is not empty.
    expect(production).toContain('.github/workflows/migrate.yml');
    for (const f of production) {
      expect(readFileSync(join(REPO, f), 'utf8'), f).not.toContain(FLAG);
    }
  });

  // OPS-2 PR 1 (D-S2): production's string is `PROD_DATABASE_URL_UNPOOLED`. Once the old secret is
  // deleted, an old run re-run from the Actions tab finds it empty and writes nothing; a workflow that
  // read the old name again would undo that.
  it('no workflow reads the old production secret name', () => {
    for (const f of workflows) {
      expect(readFileSync(join(REPO, f), 'utf8'), f).not.toMatch(
        /secrets\.DATABASE_URL_UNPOOLED\b/,
      );
    }
    const migrate = readFileSync(join(REPO, '.github/workflows/migrate.yml'), 'utf8');
    expect(migrate).toContain('secrets.PROD_DATABASE_URL_UNPOOLED');
    // The secret is an environment secret of "Production": the job must declare it, or it reads empty.
    expect(migrate).toMatch(/^\s+environment: Production$/m);
  });

  it('the local harness sets it after the environment spread, where a caller cannot unset it', () => {
    const harness = readFileSync(join(WEB_DIR, 'scripts/embedded-pg.ts'), 'utf8');
    // Inside `migrateAndSeed` only: the file has other `...process.env` spreads.
    const start = harness.indexOf('export async function migrateAndSeed(');
    const end = harness.indexOf('\nexport ', start + 1);
    expect(start).toBeGreaterThan(-1);
    const body = harness.slice(start, end === -1 ? undefined : end);
    const spread = body.indexOf('...process.env,');
    const flag = body.indexOf("[SEED_FIXTURES_ENV]: '1'");
    expect(spread).toBeGreaterThan(-1);
    expect(flag).toBeGreaterThan(spread);
  });
});

/**
 * 🔴 **CAT-3 K29 condition 1: every database the app reads with the test library is seeded with it.**
 *
 * The app reads `CATALOG_FIXTURE` on a local or preview-named database (`catalogLibraryNameFor`), and
 * the seed writes it only with `SEED_FIXTURES=1`. So every seed of such a database must set the flag,
 * or the app would match over a library the database does not hold. The sites: CI's e2e job, the
 * preview migration, the runbook's manual preview seed, and the local harness (above, `migrateAndSeed`,
 * which `dev-local`, `e2e-local` and `screenshot-ephemeral` all call). Production's one seed, in
 * `migrate.yml`, must not set it.
 */
describe('every fixtures-database seed sets the flag (CAT-3 K29)', () => {
  const FLAG = SEED_FIXTURES_ENV;
  const SEED = /\bdb:seed\b/;
  /** Lines that RUN the seed: a pnpm command, not prose that names it. */
  const seedRuns = (text: string) =>
    text.split('\n').filter((line) => SEED.test(line) && /\bpnpm\b/.test(line));

  it("each workflow seed line but production's sets SEED_FIXTURES=1", () => {
    const lines = globSync('.github/workflows/*.{yml,yaml}', { cwd: REPO }).flatMap((f) =>
      seedRuns(readFileSync(join(REPO, f), 'utf8')).map((line) => ({ f, line: line.trim() })),
    );
    const flagged = lines.filter((l) => l.line.startsWith(`${FLAG}=1 `)).map((l) => l.f);
    const bare = lines.filter((l) => !l.line.startsWith(`${FLAG}=1 `)).map((l) => l.f);
    expect(flagged.sort()).toEqual([
      '.github/workflows/ci.yml',
      '.github/workflows/migrate-preview.yml',
    ]);
    expect(bare, 'only production seeds without fixtures').toEqual([
      '.github/workflows/migrate.yml',
    ]);
  });

  it("the runbook's manual seed of the preview sets it", () => {
    const runs = seedRuns(readFileSync(join(REPO, 'docs/runbooks.md'), 'utf8')).filter((line) =>
      line.includes('PREVIEW'),
    );
    expect(runs.length).toBeGreaterThan(0);
    for (const line of runs) expect(line.trim().startsWith(`${FLAG}=1 `), line).toBe(true);
  });

  it('every local harness seeds through migrateAndSeed', () => {
    for (const script of ['dev-local.ts', 'e2e-local.ts', 'screenshot-ephemeral.ts']) {
      const text = readFileSync(join(WEB_DIR, 'scripts', script), 'utf8');
      expect(text, script).toMatch(/await migrateAndSeed\(/);
      expect(text, `${script} runs no seed of its own`).not.toMatch(/['"]db:seed['"]/);
    }
  });
});
