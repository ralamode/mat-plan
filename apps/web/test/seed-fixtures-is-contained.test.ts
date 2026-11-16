import { globSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { WEB_DIR } from './source-scan';

/** The repo root. `WEB_DIR` is `apps/web`, so workflows sit two levels up and outside every `appSources()` sweep. */
const REPO = resolve(WEB_DIR, '../..');

/**
 * 🔴 **The program-fixtures flag is contained — FAM-1 step 1 (plan D10).**
 *
 * `SEED_FIXTURES=1` makes `db:seed` write the authored program and lane P's fixture programs.
 * `migrate.yml` seeds **production**, so the flag must never reach it. The seed refuses the flag
 * against a URL that is neither local nor the preview database (`packages/db/src/seed.ts` →
 * `assertFixturesTargetAllowed`); this is the other half: no workflow but the two test ones names it.
 * Modelled on `fixture-member-is-contained.test.ts`.
 */
describe('the program-fixtures flag is contained (FAM-1 D10)', () => {
  /**
   * Read from its definition, not re-typed: `packages/db` publishes only `"."`, so `apps/web` cannot
   * import the constant, which leaves the name a literal in the workflows and the harness.
   */
  const FLAG = (() => {
    const seed = readFileSync(join(REPO, 'packages/db/src/seed.ts'), 'utf8');
    const m = seed.match(/export const SEED_FIXTURES_ENV = '([A-Z_]+)'/);
    expect(m, 'SEED_FIXTURES_ENV must still be defined in seed.ts').not.toBeNull();
    return m![1];
  })();

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

  it('the local harness sets it after the environment spread, where a caller cannot unset it', () => {
    const harness = readFileSync(join(WEB_DIR, 'scripts/embedded-pg.ts'), 'utf8');
    const spread = harness.indexOf('...process.env,');
    const flag = harness.indexOf(`${FLAG}: '1'`);
    expect(spread).toBeGreaterThan(-1);
    expect(flag).toBeGreaterThan(spread);
  });
});
