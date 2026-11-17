import { globSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { code, WEB_DIR } from '@/test/source-scan';

/**
 * 🔴 **Who may reach the day's reads and writers, and who may reach the row actions** (FAM-1 12b;
 * lane E's #527 review, relayed by the board, 2026-11-17). Modelled on
 * `test/program-tables-stay-dark.test.ts`.
 *
 * 1. **Only `lib/dal/day/` imports them from `@mat-plan/db`.** `resolveDayPlan`, the row writers and
 *    the scoped existence reads take a `HouseholdScope` or, for the reads, answer "is this id here"
 *    for whatever scope they are given. An action, a page or a component reaches them through the
 *    day DAL, which resolves the caller's household first (AGENTS.md → DAL). The names are matched
 *    as an import FROM THE PACKAGE, since `logRow`, `untickRow` and `retickRow` are also `DayActions`
 *    members the screen and the preview's fake implement. The reads are listed before they exist
 *    (lane P's `workoutInHousehold`, lane E's `prescriptionLiveIn`, #527), so they are pinned the
 *    moment they land.
 * 2. **No page or component imports `row-actions.ts` until 12c.** Next registers a Server Action only
 *    when the module graph reaches it, so until then no request can write a row and no action id is
 *    in the build's manifest (the security lens's owed check, made structural). 12c lifts this pin.
 */

const REPO = resolve(WEB_DIR, '../..');
const DAY_DAL = 'apps/web/lib/dal/day/';
const DAY_DB_NAMES = [
  'resolveDayPlan',
  'logRow',
  'untickRow',
  'retickRow',
  'prescriptionLiveIn',
  'workoutInHousehold',
];

const files = globSync('apps/web/**/*.{ts,tsx}', { cwd: REPO }).filter(
  (f) => !f.includes('node_modules') && !f.includes('/.next/'),
);
const nonTest = files.filter((f) => !/\.test\.tsx?$/.test(f));

const fromDb = new RegExp(
  `(?:import|export)\\s*(?:type\\s*)?\\{[^}]*\\b(?:${DAY_DB_NAMES.join('|')})\\b[^}]*\\}\\s*from\\s*['"]@mat-plan\\/db['"]`,
);

/** Every module specifier a source names: `from`, a side-effect import, `import()`, `require()`. */
const SPECIFIER = /(?:\bfrom\s*|\bimport\s+|\bimport\(\s*|\brequire\(\s*)['"]([^'"]+)['"]/g;
const ACTIONS = 'apps/web/app/p/[profileId]/row-actions';
const namesActions = (file: string, source: string) =>
  [...source.matchAll(SPECIFIER)].some(([, spec]) => {
    if (spec === '@/app/p/[profileId]/row-actions') return true;
    if (!spec!.startsWith('.')) return false;
    return relative(REPO, resolve(dirname(join(REPO, file)), spec!)) === ACTIONS;
  });
const THE_MODULE = new Set([`${ACTIONS}.ts`, `${ACTIONS}.registry.ts`]);

describe('the day DAL is the only way in (FAM-1 12b)', () => {
  it('scans a real tree', () => {
    expect(nonTest.length).toBeGreaterThan(100);
  });

  it('only lib/dal/day/ imports the day reads and row writers from @mat-plan/db', () => {
    const importing = nonTest.filter((f) => fromDb.test(code(join(REPO, f))));
    expect(importing.filter((f) => !f.startsWith(DAY_DAL))).toEqual([]);
    // Non-vacuity: the DAL does import them, so the scan sees an import where there is one.
    expect(importing).toContain(`${DAY_DAL}day.ts`);
  });

  it('the import pattern catches each form, and not a DayActions member', () => {
    expect(fromDb.test("import { db, logRow } from '@mat-plan/db';")).toBe(true);
    expect(fromDb.test("import {\n  prescriptionLiveIn,\n} from '@mat-plan/db';")).toBe(true);
    expect(fromDb.test("export { resolveDayPlan } from '@mat-plan/db';")).toBe(true);
    expect(fromDb.test("import { logRow } from '@/lib/dal/day/day';")).toBe(false);
    expect(fromDb.test('day.actions.logRow({ clientId })')).toBe(false);
  });

  it('no page or component imports the row actions until 12c', () => {
    const reaching = nonTest.filter(
      (f) => !THE_MODULE.has(f) && namesActions(f, code(join(REPO, f))),
    );
    expect(reaching, '12c lifts this pin when it mounts the day screen').toEqual([]);
  });

  it('the row-actions pin sees an import by alias and by relative path (non-vacuity)', () => {
    expect(namesActions(`${ACTIONS}.test.ts`, code(join(REPO, `${ACTIONS}.test.ts`)))).toBe(true);
    const page = 'apps/web/app/p/[profileId]/page.tsx';
    for (const form of [
      "import { logRowAction } from '@/app/p/[profileId]/row-actions';",
      "import { logRowAction } from './row-actions';",
      "const m = await import('./row-actions');",
    ])
      expect(namesActions(page, form), form).toBe(true);
    expect(namesActions(page, "import { x } from './row-actions.registry';")).toBe(false);
  });
});
