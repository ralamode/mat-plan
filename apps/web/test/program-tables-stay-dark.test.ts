import { globSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { code, WEB_DIR } from './source-scan';

/** The repo root: this scan reaches `packages/db/src` as well as `apps/web`. */
const REPO = resolve(WEB_DIR, '../..');

/**
 * 🔴 **The program tables stay dark until lane P's writers — FAM-1 step 4a-i** (the A4-1 check,
 * `docs/plans/v1-22-a4-create-program.md` → "A4-1 lands before ONB-2's writer").
 *
 * Drizzle names EVERY schema column on an insert, and a bare `.select()` or a column-less
 * `.returning()` names them too. So once `schema.ts` declares `program_blocks.kind`/`client_id`,
 * `workouts` and `block_day_workouts`, any request-path code doing one of those fails `42703` on a
 * deploy that races `migrate.yml`. Migration 0023 is "dark" only while nothing outside the allowlist
 * does: the seed (which runs after migrate), the two ownership helpers lane P's writers call, lane P's
 * own writer directory, and the `packages/db` scripts.
 *
 * It also pins that `apps/web` names neither ownership helper yet: the privacy docs say no app path
 * writes these tables, and this is what keeps that sentence true until lane P changes it.
 */
describe('the program tables stay dark (FAM-1 4a-i, 4b, 5)', () => {
  // `prescriptions` and `prescriptionQuantities` since FAM-1 4b: 0025 adds six columns and a table,
  // and its header's "no request-path statement in the deploy window" is this scan.
  const TABLES =
    'programBlocks|workouts|blockDayWorkouts|prescriptions|prescriptionQuantities|programAssignments|programAssignmentWeekdays';
  /**
   * 🔴 FAM-1 step 5's two tables are NEW, so even a named-column read of one fails `42P01` in a deploy
   * that races `migrate.yml`. The patterns above catch only whole-row shapes, so for these two ANY
   * reference outside the allowlist is refused, the snake_case name in raw SQL included. Lane P's
   * writers (`writers/program/`) are allowlisted already; 6c's reads elsewhere (`queries/program/`) are
   * what relax it.
   */
  const NEW_TABLES =
    /\b(?:(?:schema\.)?(?:programAssignments|programAssignmentWeekdays)|program_assignments|program_assignment_weekdays)\b/;
  const NEW_TABLES_ALLOWED = [
    'packages/db/src/schema.ts',
    'packages/db/src/queries/program-assignments.ts',
    'packages/db/src/writers/program/',
    // FAM-1 11b's "on the program that day" check (`isOnProgramThatDay`) and 12a's day resolver's
    // assignment read (`dayAssignments`), both named-column reads on `onProgramOn` /
    // `assignmentOnDay`. Both merge only after 0027 is applied (11b's plan M7), and no request path
    // calls the row writer or the resolver until 12b, so neither read can race the deploy window.
    'packages/db/src/queries/day/scheduled.ts',
    // PRIV-3's household graph names every program table as a value (`{ table: schema.workouts }`),
    // which is no query and runs on no request path: nothing re-exports `src/erasure/` from the barrel
    // and no `apps/web` file imports it (pinned below), so it cannot race migrate.yml. The FILE, not
    // the directory: a later module there (the delete core) justifies its own entry.
    'packages/db/src/erasure/graph.ts',
    // PRIV-3 2a's pre-flights (a) and (h) name `program_assignments` in raw SQL (named columns only,
    // `a.id`, `a.profile_id`, `a.block_id`). Same reason as the graph: no barrel re-export, no
    // `apps/web` import (pinned below), and only an operator's correction or `db:verify` runs them.
    'packages/db/src/erasure/preflight.ts',
  ];
  const PATTERNS: Record<string, RegExp> = {
    insert: new RegExp(`\\.insert\\(\\s*(?:schema\\.)?(?:${TABLES})\\b`),
    'bare select': new RegExp(
      `\\.select\\(\\s*\\)[\\s\\S]{0,200}?\\.from\\(\\s*(?:schema\\.)?(?:${TABLES})\\b`,
    ),
    'relational query': new RegExp(`\\.query\\.(?:${TABLES})\\b`),
    'column-less returning': new RegExp(
      `\\.(?:insert|update|delete)\\(\\s*(?:schema\\.)?(?:${TABLES})\\b[\\s\\S]{0,400}?\\.returning\\(\\s*\\)`,
    ),
    // A bare or whole-table select that reaches a program table through a join, or names the table
    // itself as a selected field: both list every column.
    'bare select through a join': new RegExp(
      `\\.select(?:Distinct)?\\(\\s*\\)[\\s\\S]{0,300}?\\.(?:inner|left|right|full)Join\\(\\s*(?:schema\\.)?(?:${TABLES})\\b`,
    ),
    'whole table as a field': new RegExp(`:\\s*(?:schema\\.)?(?:${TABLES})\\s*[,}]`),
    'bare selectDistinct': new RegExp(
      `\\.selectDistinct\\(\\s*\\)[\\s\\S]{0,200}?\\.from\\(\\s*(?:schema\\.)?(?:${TABLES})\\b`,
    ),
  };
  const ALLOWED = [
    'packages/db/src/seed.ts',
    'packages/db/src/writers/ownership.ts',
    'packages/db/src/writers/program/',
    // PRIV-3's household graph: see NEW_TABLES_ALLOWED.
    'packages/db/src/erasure/graph.ts',
  ];
  const HELPERS =
    /\b(insertProgramBlockOwnedBy|insertWorkoutOwnedBy|programBlockByClientId|liveTemplateBlockIn)\b/;

  const files = [
    ...globSync('apps/web/**/*.{ts,tsx}', { cwd: REPO }),
    ...globSync('packages/db/src/**/*.ts', { cwd: REPO }),
  ].filter(
    (f) =>
      !f.includes('node_modules') &&
      !f.includes('/.next/') &&
      !/\.test\.tsx?$/.test(f) &&
      !f.endsWith('test/program-tables-stay-dark.test.ts'),
  );

  it('scans a real tree', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it.each(Object.keys(PATTERNS))('no %s on a program table outside the allowlist', (name) => {
    const hits = files.filter(
      (f) => PATTERNS[name]!.test(code(join(REPO, f))) && !ALLOWED.some((a) => f.startsWith(a)),
    );
    expect(hits, `${name} on a program table: a deploy racing migrate.yml would 42703`).toEqual([]);
  });

  // Non-vacuity: each pattern must catch the shape it names. The seed's insert is the one real hit.
  it('each pattern catches its shape', () => {
    expect(PATTERNS.insert!.test(code(join(REPO, 'packages/db/src/seed.ts')))).toBe(true);
    expect(PATTERNS['bare select']!.test('db.select().from(schema.workouts)')).toBe(true);
    expect(PATTERNS['bare select']!.test('db.select({ id: x }).from(schema.workouts)')).toBe(false);
    expect(PATTERNS['relational query']!.test('db.query.programBlocks.findMany()')).toBe(true);
    expect(
      PATTERNS['column-less returning']!.test(
        'tx.insert(schema.blockDayWorkouts).values(v).returning()',
      ),
    ).toBe(true);
    expect(
      PATTERNS['column-less returning']!.test(
        'tx.insert(workouts).values(v).returning({ id: workouts.id })',
      ),
    ).toBe(false);
    expect(
      PATTERNS['column-less returning']!.test('tx.update(schema.workouts).set(v).returning()'),
    ).toBe(true);
    expect(
      PATTERNS['column-less returning']!.test('tx.delete(schema.workouts).where(w).returning()'),
    ).toBe(true);
    expect(
      PATTERNS['bare select through a join']!.test(
        'db.select().from(schema.sessions).innerJoin(schema.programBlocks, on)',
      ),
    ).toBe(true);
    expect(
      PATTERNS['whole table as a field']!.test('db.select({ b: schema.programBlocks }).from(x)'),
    ).toBe(true);
    expect(
      PATTERNS['whole table as a field']!.test('db.select({ b: schema.programBlocks.id })'),
    ).toBe(false);
    expect(PATTERNS['bare selectDistinct']!.test('db.selectDistinct().from(schema.workouts)')).toBe(
      true,
    );
  });

  it("no code outside the allowlist names step 5's tables yet", () => {
    const hits = files.filter(
      (f) =>
        NEW_TABLES.test(code(join(REPO, f))) && !NEW_TABLES_ALLOWED.some((a) => f.startsWith(a)),
    );
    expect(hits, 'a read of a table 0027 creates fails 42P01 in the deploy window').toEqual([]);
    // Non-vacuity: the pattern sees the one module that does name them.
    expect(
      NEW_TABLES.test(code(join(REPO, 'packages/db/src/queries/program-assignments.ts'))),
    ).toBe(true);
  });

  it('no request path reaches the erasure graph (what its allowlist entry rests on)', () => {
    const web = files.filter((f) => f.startsWith('apps/web/'));
    expect(web.filter((f) => /\berasure\//.test(code(join(REPO, f))))).toEqual([]);
    expect(code(join(REPO, 'packages/db/src/index.ts'))).not.toMatch(/\berasure\b/);
  });

  it('apps/web calls none of the ownership helpers yet', () => {
    const web = files.filter((f) => f.startsWith('apps/web/'));
    expect(web.filter((f) => HELPERS.test(code(join(REPO, f))))).toEqual([]);
  });

  // FAM-1 6a-ii (the board's seam turn): `@mat-plan/db` exports lane P's writers and reads through
  // the lane's two barrels. Their names are also `ProgramActions` members, which the screens and the
  // preview's fake implement, so the scan matches an import or re-export of one FROM THE PACKAGE, not
  // the bare name. The names are read from the barrels, so a later step's export is covered without
  // an edit here.
  const LANE_P_BARRELS = [
    'packages/db/src/writers/program/index.ts',
    'packages/db/src/queries/program/index.ts',
  ];
  /** The names an `export { … } from` barrel publishes: `a as b` publishes `b`. */
  const published = (src: string) =>
    [...src.matchAll(/export\s*\{([^}]*)\}\s*from/g)].flatMap((m) =>
      m[1]!
        .split(',')
        .map((n) =>
          n
            .trim()
            .split(/\s+as\s+/)
            .at(-1)!,
        )
        .filter(Boolean),
    );
  const laneP = LANE_P_BARRELS.flatMap((b) => published(code(join(REPO, b))));
  const fromDb = (names: readonly string[]) =>
    new RegExp(
      `(?:import|export)\\s*(?:type\\s*)?\\{[^}]*\\b(?:${names.join('|')})\\b[^}]*\\}\\s*from\\s*['"]@mat-plan\\/db['"]`,
    );
  // The forms that would reach a writer without naming it in braces: nowhere in apps/web, the DAL
  // included, so containment below can be checked by name.
  const WHOLE_PACKAGE =
    /import\s*\*\s*as\s+\w+\s+from\s*['"]@mat-plan\/db['"]|import\(\s*['"]@mat-plan\/db['"]\s*\)|export\s*\*\s*(?:as\s+\w+\s*)?from\s*['"]@mat-plan\/db['"]/;

  // FAM-1 7a-i: lane P's writers and reads are wired, and only the program DAL may import them: an
  // action, a page or a component reaches them through `lib/dal/program/`, which resolves the
  // caller's household first (AGENTS.md → DAL). Its tests mock them, so they may name them too.
  const PROGRAM_DAL = 'apps/web/lib/dal/program/';
  // The day DAL (12b) may import ONE lane P read: whether a workout id is the household's, for its
  // scope-miss report. Lane C's importer pin (#528, open: `lib/dal/day/importers.test.ts`) names the same.
  const DAY_DAL = 'apps/web/lib/dal/day/';
  const DAY_DAL_MAY_IMPORT = ['workoutInHousehold'];

  it("only the program DAL imports lane P's writers and reads; the day DAL, only workoutInHousehold", () => {
    for (const barrel of LANE_P_BARRELS) {
      // A barrel that re-exports a whole module publishes names this scan cannot read.
      expect(code(join(REPO, barrel)), `${barrel} names what it publishes`).not.toMatch(
        /export\s*\*/,
      );
    }
    expect(laneP, 'the barrels name what they publish').toEqual(
      expect.arrayContaining(['createProgram', 'renameProgram', 'saveWorkout', 'readWorkoutDraft']),
    );
    const named = fromDb(laneP);
    const web = files.filter((f) => f.startsWith('apps/web/'));
    const importing = web.filter((f) => named.test(code(join(REPO, f))));
    const notForTheDay = fromDb(laneP.filter((n) => !DAY_DAL_MAY_IMPORT.includes(n)));
    // Which file may import what: the program DAL, any lane P name; the day DAL, workoutInHousehold
    // and nothing else beside it.
    const mayImport = (f: string, src: string) =>
      f.startsWith(PROGRAM_DAL) || (f.startsWith(DAY_DAL) && !notForTheDay.test(src));
    expect(importing.filter((f) => !mayImport(f, code(join(REPO, f))))).toEqual([]);
    // Neither DAL hands a lane P name on: a re-export (from the package, or of a local binding)
    // would let any file reach it through the DAL without naming `@mat-plan/db`.
    const reexports = new RegExp(
      `export\\s*(?:type\\s*)?\\{[^}]*\\b(?:${laneP.join('|')})\\b[^}]*\\}\\s*from\\s*['"]@mat-plan\\/db['"]`,
    );
    const localReexport = new RegExp(
      `export\\s*(?:type\\s*)?\\{[^}]*\\b(?:${laneP.join('|')})\\b[^}]*\\}(?!\\s*from)|export\\s+(?:const|let|var)\\s+\\w+\\s*=\\s*(?:${laneP.join('|')})\\b`,
    );
    expect(
      web.filter((f) => {
        if (!f.startsWith(PROGRAM_DAL) && !f.startsWith(DAY_DAL)) return false;
        const src = code(join(REPO, f));
        return reexports.test(src) || localReexport.test(src);
      }),
    ).toEqual([]);
    const one = "import { workoutInHousehold } from '@mat-plan/db';";
    const two = "import { workoutInHousehold, saveWorkout } from '@mat-plan/db';";
    expect(mayImport('apps/web/lib/dal/day/x.ts', one)).toBe(true);
    expect(mayImport('apps/web/lib/dal/day/x.ts', two)).toBe(false);
    expect(mayImport('apps/web/app/p/x.ts', one)).toBe(false);
    expect(mayImport('apps/web/lib/dal/dayx/x.ts', one)).toBe(false);
    expect(mayImport('apps/web/lib/dal/program/x.ts', two)).toBe(true);
    expect(reexports.test("export { workoutInHousehold } from '@mat-plan/db';")).toBe(true);
    expect(reexports.test("import { workoutInHousehold } from '@mat-plan/db';")).toBe(false);
    expect(localReexport.test('export { workoutInHousehold as isOurs };')).toBe(true);
    expect(localReexport.test('export const alsoOurs = workoutInHousehold;')).toBe(true);
    expect(localReexport.test("export { workoutInHousehold } from '@mat-plan/db';")).toBe(false);
    expect(localReexport.test('export const dayRows = readDayRows;')).toBe(false);
    // The day DAL's allowance is that one name: any other lane P name there, alone or beside it,
    // still fails.
    expect(laneP).toEqual(expect.arrayContaining(DAY_DAL_MAY_IMPORT));
    expect(notForTheDay.test("import { workoutInHousehold } from '@mat-plan/db';")).toBe(false);
    expect(notForTheDay.test("import { saveWorkout } from '@mat-plan/db';")).toBe(true);
    expect(
      notForTheDay.test("import { workoutInHousehold, readWorkoutDraft } from '@mat-plan/db';"),
    ).toBe(true);
    expect(web.filter((f) => WHOLE_PACKAGE.test(code(join(REPO, f))))).toEqual([]);
    // Non-vacuity: the DAL does import them, so the scan sees an import where there is one.
    expect(importing.some((f) => f.startsWith(PROGRAM_DAL))).toBe(true);
    // Non-vacuity: each form is caught, and a ProgramActions member is not.
    expect(named.test("import { db, saveWorkout } from '@mat-plan/db';")).toBe(true);
    expect(named.test("export { readWorkoutDraft } from '@mat-plan/db';")).toBe(true);
    expect(named.test('async saveWorkout(draft) {')).toBe(false);
    expect(WHOLE_PACKAGE.test("import * as db from '@mat-plan/db';")).toBe(true);
    expect(WHOLE_PACKAGE.test("const m = await import('@mat-plan/db');")).toBe(true);
    expect(WHOLE_PACKAGE.test("export * from '@mat-plan/db';")).toBe(true);
    expect(WHOLE_PACKAGE.test("export * as db from '@mat-plan/db';")).toBe(true);
    // The scan's own parser: an alias publishes its right-hand name. ⚠️ It reads `export { … } from`
    // only; a barrel's local `export function` or `export { x }` would publish a name it cannot see,
    // so the barrels keep to that one form.
    expect(published("export { readA as readB, readC } from './x';")).toEqual(['readB', 'readC']);
  });

  /**
   * FAM-1 7a-i wires the actions and 7a-ii assembles them as `PROGRAM_ACTIONS` (`actions.contract.ts`).
   * **Since 7b-i the builder's pages import it**, so every action is reachable (Next registers a
   * Server Action once the module graph reaches it). The pin that held them dark until then lifted in
   * that PR, with the privacy list it owed (`docs/plans/fam-1-7b-builder-pages.md` §Privacy). What it
   * still holds: **only a page under `app/programs/` imports the module** (a component gets the
   * actions as props), and the two privacy sentences that stopped being true stay gone.
   */
  /** The module itself, as a path from the repo root without its extension. */
  const ACTIONS = 'apps/web/app/programs/actions';
  /**
   * 🔴 **The object that holds every action is the module too** (7a-ii): a page that imports it
   * reaches every action without naming `actions`, so the pin reads both paths.
   */
  const CONTRACT = `${ACTIONS}.contract`;
  const MODULES = new Set([ACTIONS, CONTRACT]);
  /**
   * Every module specifier a source names: `from '…'` (an import or a re-export), a bare
   * side-effect `import '…'`, and a dynamic `import('…')` or `require('…')`. Any of them puts the
   * module in the graph, which is what registers its actions.
   */
  const SPECIFIER = /(?:\bfrom\s*|\bimport\s+|\bimport\(\s*|\brequire\(\s*)['"]([^'"]+)['"]/g;
  /** Does a source at `file` import the actions module, by the `@/` alias or by a relative path? */
  const namesActions = (file: string, source: string) =>
    [...source.matchAll(SPECIFIER)].some(([, spec]) => {
      if (spec!.startsWith('@/')) return MODULES.has(`apps/web/${spec!.slice(2)}`);
      if (!spec!.startsWith('.')) return false;
      return MODULES.has(relative(REPO, resolve(dirname(join(REPO, file)), spec!)));
    });
  const importsActions = (file: string) => namesActions(file, code(join(REPO, file)));
  /** The module and its registry are the module, not a page reaching it; tests are skipped below. */
  const THE_MODULE = new Set([`${ACTIONS}.ts`, `${ACTIONS}.registry.ts`, `${CONTRACT}.ts`]);

  /** A page of the program builder: the one kind of file that may import the actions module. */
  const PROGRAM_PAGE = /^apps\/web\/app\/programs\/(?:.+\/)?page\.tsx$/;

  it('only a page under app/programs/ imports the program actions (since 7b-i)', () => {
    const web = files.filter(
      (f) => f.startsWith('apps/web/') && !/\.test\.tsx?$/.test(f) && !THE_MODULE.has(f),
    );
    const importing = web.filter(importsActions);
    expect(importing.filter((f) => !PROGRAM_PAGE.test(f))).toEqual([]);
    // Non-vacuity: the four pages (7b-i, 7b-ii) do import it.
    expect(importing).toEqual(
      expect.arrayContaining([
        'apps/web/app/programs/page.tsx',
        'apps/web/app/programs/[programId]/page.tsx',
        'apps/web/app/programs/[programId]/workouts/[workoutId]/page.tsx',
        'apps/web/app/programs/[programId]/workouts/new/page.tsx',
      ]),
    );
    expect(PROGRAM_PAGE.test('apps/web/app/programs/[programId]/workouts/new/page.tsx')).toBe(true);
    expect(PROGRAM_PAGE.test('apps/web/components/program-builder/program-screen.tsx')).toBe(false);
    expect(PROGRAM_PAGE.test('apps/web/app/programs/actions.form.tsx')).toBe(false);
  });

  /** The program DAL's directory, as a path from the repo root. */
  const PROGRAM_DAL_DIR = 'apps/web/lib/dal/program';
  /**
   * Does a source at `file` import lane P's package (`@mat-plan/db`, or a subpath of it) or the
   * program DAL, by the `@/` alias or a relative path, in any form `SPECIFIER` reads?
   */
  const readsLaneP = (file: string, source: string) =>
    [...source.matchAll(SPECIFIER)].some(([, spec]) => {
      if (spec === '@mat-plan/db' || spec!.startsWith('@mat-plan/db/')) return true;
      const path = spec!.startsWith('@/')
        ? `apps/web/${spec!.slice(2)}`
        : spec!.startsWith('.')
          ? relative(REPO, resolve(dirname(join(REPO, file)), spec!))
          : null;
      return !!path && (path === PROGRAM_DAL_DIR || path.startsWith(`${PROGRAM_DAL_DIR}/`));
    });

  it("no client component imports lane P's reads or the program DAL", () => {
    const clients = files.filter(
      (f) => f.startsWith('apps/web/') && /^\s*['"]use client['"]/.test(code(join(REPO, f))),
    );
    // Non-vacuity: the builder's screens are client components.
    expect(clients).toContain('apps/web/components/program-builder/program-screen.tsx');
    expect(clients.filter((f) => readsLaneP(f, code(join(REPO, f))))).toEqual([]);
    // Non-vacuity: every import form, by alias, by relative path and by package subpath.
    const screen = 'apps/web/components/program-builder/x.tsx';
    for (const form of [
      "import { readProgramView } from '@mat-plan/db';",
      "import { readProgramView } from '@mat-plan/db/queries/program';",
      "import { getProgramView } from '@/lib/dal/program/reads';",
      "import { getProgramView } from '@/lib/dal/program';",
      "import { getProgramView } from '../../lib/dal/program/reads';",
      "export { getProgramView } from '../../lib/dal/program/reads';",
      "const m = await import('../../lib/dal/program/reads');",
      "const m = require('@/lib/dal/program/reads');",
    ])
      expect(readsLaneP(screen, form), form).toBe(true);
    expect(readsLaneP(screen, "import { x } from '@/lib/dal/programs-extra';")).toBe(false);
    expect(readsLaneP(screen, "import { x } from '@mat-plan/dbx';")).toBe(false);
    expect(readsLaneP(screen, "import { x } from '../../lib/dal/day/day';")).toBe(false);
  });

  it('the privacy docs no longer say the builder is coming (the list 7b-i owed)', () => {
    const notice = readFileSync(join(REPO, 'docs/privacy/notice.md'), 'utf8');
    expect(notice).not.toContain('(coming; the app cannot save one yet)');
    // Every "7b" left in the inventory is dated history (its header's blockquote), never a promise.
    const inventory = readFileSync(join(REPO, 'docs/privacy/data-inventory.md'), 'utf8');
    const FORWARD =
      /until (?:step )?7b\b|from 7b\b|\(7b\) owns|reaches it until 7b|no page serves it/;
    const promises = inventory
      .split('\n')
      .filter((line) => !line.startsWith('>') && FORWARD.test(line));
    expect(promises).toEqual([]);
    expect(FORWARD.test('no screen reaches them until step 7b')).toBe(true);
    expect(FORWARD.test('the PR that makes it reachable from a screen (7b) owns it')).toBe(true);
  });

  it('the pin sees every form of import, by alias and by relative path (non-vacuity)', () => {
    // The test file itself imports it relatively: the resolver must see that.
    expect(importsActions('apps/web/app/programs/actions.test.ts')).toBe(true);
    const page = 'apps/web/app/programs/page.tsx';
    for (const form of [
      "import { saveWorkoutAction } from '@/app/programs/actions';",
      "export { saveWorkoutAction } from './actions';",
      "import './actions';",
      "const { saveWorkoutAction } = await import('@/app/programs/actions');",
      "const m = require('./actions');",
      "import { PROGRAM_ACTIONS } from '@/app/programs/actions.contract';",
      "export { PROGRAM_ACTIONS } from './actions.contract';",
      "import '../programs/actions.contract';",
      "const { PROGRAM_ACTIONS } = await import('./actions.contract');",
    ])
      expect(namesActions(page, form), form).toBe(true);
    expect(namesActions(page, "import { x } from '@/app/programs/actions.registry';")).toBe(false);
    expect(namesActions(page, "import { x } from './actions-copy';")).toBe(false);
    // A sibling of the module is not the module: it is scanned like any page.
    expect(THE_MODULE.has(`${ACTIONS}.form.tsx`)).toBe(false);
  });
});

/**
 * 🔴 **The movement library's tables stay dark until P11-ii** (`CAT-3` A1, spec S6). Migration 0032
 * creates `equipment`, `muscles`, `movement_equipment` and `movement_muscles`, so any read of one in
 * a deploy that races `migrate.yml` fails `42P01`. Its own `describe`, not the step-5 list above: the
 * bare words `equipment` and `muscles` are everyday identifiers (a design token's copy, the picker's
 * `option.equipment`), so only the schema object, the join tables' names and a raw-SQL table
 * reference count. `movements.modality` is a column on an existing table, which this scan cannot hold;
 * 0032's deploy-window header covers it.
 *
 * Relaxed by A2 (the seed's catalog writer and `movementIsCatalog`) and P11-ii (the option read in
 * `queries/program/`), each adding its own entry.
 */
describe('the movement library tables stay dark (CAT-3 A1)', () => {
  const CATALOG_TABLES =
    /\bschema\.(?:equipment|muscles|movementEquipment|movementMuscles)\b|\b(?:movementEquipment|movementMuscles|movement_equipment|movement_muscles)\b|\b(?:from|join|into|update)\s+"?(?:equipment|muscles)\b/i;
  const ALLOWED = [
    'packages/db/src/schema.ts',
    'packages/db/src/seed.ts',
    // As above: the household graph names the tables as values, on no request path.
    'packages/db/src/erasure/graph.ts',
  ];
  const files = [
    ...globSync('apps/web/**/*.{ts,tsx}', { cwd: REPO }),
    ...globSync('packages/db/src/**/*.ts', { cwd: REPO }),
  ].filter(
    (f) => !f.includes('node_modules') && !f.includes('/.next/') && !/\.test\.tsx?$/.test(f),
  );

  it('no code outside the allowlist names the library tables yet', () => {
    const hits = files.filter(
      (f) => CATALOG_TABLES.test(code(join(REPO, f))) && !ALLOWED.some((a) => f.startsWith(a)),
    );
    expect(hits, 'a read of a table 0032 creates fails 42P01 in the deploy window').toEqual([]);
  });

  it('the pattern catches each shape, and not an everyday word', () => {
    expect(CATALOG_TABLES.test(code(join(REPO, 'packages/db/src/seed.ts')))).toBe(true);
    expect(CATALOG_TABLES.test('tx.select().from(schema.movementMuscles)')).toBe(true);
    expect(CATALOG_TABLES.test('SELECT code FROM "equipment"')).toBe(true);
    expect(CATALOG_TABLES.test('join movement_equipment j on true')).toBe(true);
    expect(CATALOG_TABLES.test('option.equipment.length')).toBe(false);
    expect(CATALOG_TABLES.test("'read as equipment'")).toBe(false);
  });
});
