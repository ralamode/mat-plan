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
