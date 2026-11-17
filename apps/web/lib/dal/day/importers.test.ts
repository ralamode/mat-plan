import { globSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { code, WEB_DIR } from '@/test/source-scan';

/**
 * 🔴 **Who may reach the day's reads and writers, and who may reach the row actions** (FAM-1 12b;
 * lane E's #527 review, relayed by the board, 2026-11-17). Modelled on
 * `test/program-tables-stay-dark.test.ts`.
 *
 * 1. **Only `lib/dal/day/` imports them from `@mat-plan/db`** (`workoutInHousehold` also from
 *    `lib/dal/program/`; `ALLOWED_IN`). `resolveDayPlan`, the row writers and
 *    the scoped existence reads take a `HouseholdScope` or, for the reads, answer "is this id here"
 *    for whatever scope they are given. An action, a page or a component reaches them through the
 *    day DAL, which resolves the caller's household first (AGENTS.md → DAL). The names are matched
 *    as an import FROM THE PACKAGE, since `logRow`, `untickRow` and `retickRow` are also `DayActions`
 *    members the screen and the preview's fake implement. The reads are listed before they exist
 *    (lane P's `workoutInHousehold`, lane E's `prescriptionLiveIn`, #527), so they are pinned the
 *    moment they land.
 * 2. **Only the day page imports `row-actions.ts`** (FAM-1 12c). Next registers a Server Action only
 *    when the module graph reaches it, so the day page is the one route that serves them; another
 *    importer would need its own review (the security lens's check, made structural at 12b, with
 *    "no importer" as its rule until 12c mounted the screen).
 */

const REPO = resolve(WEB_DIR, '../..');
const DAY_DAL = 'apps/web/lib/dal/day/';
const PROGRAM_DAL = 'apps/web/lib/dal/program/';
/**
 * Each name, and the directories that may import it. `workoutInHousehold` is lane P's, and lane B's
 * program DAL needs it too: copy's `CopyDraft` carries a workout id but no source program, so its miss
 * report asks by workout alone (board, 2026-11-17). Every other name is the day DAL's only.
 */
const ALLOWED_IN: Record<string, readonly string[]> = {
  resolveDayPlan: [DAY_DAL],
  logRow: [DAY_DAL],
  untickRow: [DAY_DAL],
  retickRow: [DAY_DAL],
  prescriptionLiveIn: [DAY_DAL],
  workoutInHousehold: [DAY_DAL, PROGRAM_DAL],
};
const DAY_DB_NAMES = Object.keys(ALLOWED_IN);

const files = globSync('apps/web/**/*.{ts,tsx}', { cwd: REPO }).filter(
  (f) => !f.includes('node_modules') && !f.includes('/.next/'),
);
const nonTest = files.filter((f) => !/\.test\.tsx?$/.test(f));

const fromDb = new RegExp(
  `(?:import|export)\\s*(?:type\\s*)?\\{[^}]*\\b(?:${DAY_DB_NAMES.join('|')})\\b[^}]*\\}\\s*from\\s*['"]@mat-plan\\/db['"]`,
);
/** Every `{ … } from '@mat-plan/db'` list in a source, as the names it imports (`a as b` imports `a`). */
const dbImports = (source: string) =>
  [
    ...source.matchAll(
      /(?:import|export)\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"]@mat-plan\/db['"]/g,
    ),
  ].flatMap((m) =>
    m[1]!
      .split(',')
      .map(
        (n) =>
          n
            .trim()
            .replace(/^type\s+/, '')
            .split(/\s+as\s+/)[0]!,
      )
      .filter(Boolean),
  );
/** The pinned names `file` imports from the package but may not. */
const notAllowed = (file: string, source: string) =>
  dbImports(source).filter(
    (name) => name in ALLOWED_IN && !ALLOWED_IN[name]!.some((dir) => file.startsWith(dir)),
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

  it('each day read and row writer is imported from @mat-plan/db only where it is allowed', () => {
    const wrong = nonTest.flatMap((f) =>
      notAllowed(f, code(join(REPO, f))).map((name) => `${f}: ${name}`),
    );
    expect(wrong).toEqual([]);
    // Non-vacuity: the DAL does import them, so the scan sees an import where there is one.
    expect(nonTest.filter((f) => fromDb.test(code(join(REPO, f))))).toContain(`${DAY_DAL}day.ts`);
  });

  it('the program DAL may import workoutInHousehold, and no day-only read', () => {
    const program = `${PROGRAM_DAL}report-miss.ts`;
    expect(
      notAllowed(program, "import { programIn, workoutInHousehold } from '@mat-plan/db';"),
    ).toEqual([]);
    expect(
      notAllowed(program, "import { resolveDayPlan, workoutInHousehold } from '@mat-plan/db';"),
    ).toEqual(['resolveDayPlan']);
    expect(notAllowed(program, "import { prescriptionLiveIn as p } from '@mat-plan/db';")).toEqual([
      'prescriptionLiveIn',
    ]);
    expect(
      notAllowed(
        'apps/web/app/p/[profileId]/page.tsx',
        "import { workoutInHousehold } from '@mat-plan/db';",
      ),
    ).toEqual(['workoutInHousehold']);
    expect(
      notAllowed(
        `${DAY_DAL}day.ts`,
        "import {\n  logRow,\n  type ResolvedDayPlan,\n} from '@mat-plan/db';",
      ),
    ).toEqual([]);
  });

  it('the import pattern catches each form, and not a DayActions member', () => {
    expect(fromDb.test("import { db, logRow } from '@mat-plan/db';")).toBe(true);
    expect(fromDb.test("import {\n  prescriptionLiveIn,\n} from '@mat-plan/db';")).toBe(true);
    expect(fromDb.test("export { resolveDayPlan } from '@mat-plan/db';")).toBe(true);
    expect(fromDb.test("import { logRow } from '@/lib/dal/day/day';")).toBe(false);
    expect(fromDb.test('day.actions.logRow({ clientId })')).toBe(false);
  });

  it('only the day page imports the row actions (FAM-1 12c)', () => {
    const reaching = nonTest.filter(
      (f) => !THE_MODULE.has(f) && namesActions(f, code(join(REPO, f))),
    );
    expect(reaching).toEqual(['apps/web/app/p/[profileId]/page.tsx']);
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
