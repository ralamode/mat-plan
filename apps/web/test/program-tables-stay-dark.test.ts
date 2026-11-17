import { globSync } from 'node:fs';
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
    // FAM-1 11b's "on the program that day" check (`isOnProgramThatDay`, a named-column read on
    // `assignmentOnDay`). 11b merges only after 0027 is applied (its plan M7), and no request path
    // calls the row writer until 12b, so this read cannot race the deploy window.
    'packages/db/src/queries/day/scheduled.ts',
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
  const laneP = LANE_P_BARRELS.flatMap((b) =>
    [...code(join(REPO, b)).matchAll(/export\s*\{([^}]*)\}\s*from/g)].flatMap((m) =>
      m[1]!
        .split(',')
        .map((n) => n.trim())
        .filter(Boolean),
    ),
  );
  const fromDb = (names: readonly string[]) =>
    new RegExp(
      `(?:import|export)\\s*(?:type\\s*)?\\{[^}]*\\b(?:${names.join('|')})\\b[^}]*\\}\\s*from\\s*['"]@mat-plan\\/db['"]`,
    );
  // The forms that would reach a writer without naming it in braces: nowhere in apps/web, the DAL
  // included, so containment below can be checked by name.
  const WHOLE_PACKAGE =
    /import\s*\*\s*as\s+\w+\s+from\s*['"]@mat-plan\/db['"]|import\(\s*['"]@mat-plan\/db['"]\s*\)/;

  // FAM-1 7a-i: lane P's writers and reads are wired, and only the program DAL may import them: an
  // action, a page or a component reaches them through `lib/dal/program/`, which resolves the
  // caller's household first (AGENTS.md → DAL). Its tests mock them, so they may name them too.
  const PROGRAM_DAL = 'apps/web/lib/dal/program/';

  it("only the program DAL imports lane P's program writers and reads (step 7a-i wires them there)", () => {
    expect(laneP, 'the barrels name what they publish').toEqual(
      expect.arrayContaining(['createProgram', 'renameProgram', 'saveWorkout', 'readWorkoutDraft']),
    );
    const named = fromDb(laneP);
    const web = files.filter((f) => f.startsWith('apps/web/'));
    const importing = web.filter((f) => named.test(code(join(REPO, f))));
    expect(importing.filter((f) => !f.startsWith(PROGRAM_DAL))).toEqual([]);
    expect(web.filter((f) => WHOLE_PACKAGE.test(code(join(REPO, f))))).toEqual([]);
    // Non-vacuity: the DAL does import them, so the scan sees an import where there is one.
    expect(importing.some((f) => f.startsWith(PROGRAM_DAL))).toBe(true);
    // Non-vacuity: each form is caught, and a ProgramActions member is not.
    expect(named.test("import { db, saveWorkout } from '@mat-plan/db';")).toBe(true);
    expect(named.test("export { readWorkoutDraft } from '@mat-plan/db';")).toBe(true);
    expect(named.test('async saveWorkout(draft) {')).toBe(false);
    expect(WHOLE_PACKAGE.test("import * as db from '@mat-plan/db';")).toBe(true);
    expect(WHOLE_PACKAGE.test("const m = await import('@mat-plan/db');")).toBe(true);
  });

  /**
   * FAM-1 7a-i wires the actions, and **no page imports them until 7b**: Next registers a Server
   * Action only when the module graph reaches it, so until then no request can write a program. The
   * privacy notice and the data inventory still say so, truthfully. The PR that imports this module
   * from a page (7b) lifts this pin and owes, in the same PR (privacy lens, 2026-11-16):
   */
  const OWED_AT_7B = [
    'notice.md "Programs you build yourself … (coming; the app cannot save one yet)" made true now',
    'notice.md "Three text boxes have no filter": recount with a prescription\'s notes',
    'notice.md "Technical bits": a client id per item card (inventory §2, prescriptions.client_id)',
    'notice.md export omissions: built programs are not in the export (inventory §6)',
    'notice.md: a swapped item is hidden, not erased (inventory §8, D19)',
    'data-inventory.md: every "until step 7b" sentence (§1 to §3, §8), rewritten as reachable',
  ];
  /** The module itself, as a path from the repo root without its extension. */
  const ACTIONS = 'apps/web/app/programs/actions';
  /** Does `file` import the actions module, by the `@/` alias or by a relative path? */
  const importsActions = (file: string) =>
    [...code(join(REPO, file)).matchAll(/from\s*['"]([^'"]+)['"]/g)].some(([, spec]) => {
      if (spec === '@/app/programs/actions') return true;
      if (!spec!.startsWith('.')) return false;
      return relative(REPO, resolve(dirname(join(REPO, file)), spec!)) === ACTIONS;
    });

  it('no page or component imports the program actions until 7b (see OWED_AT_7B)', () => {
    const web = files.filter(
      (f) =>
        f.startsWith('apps/web/') &&
        !/\.test\.tsx?$/.test(f) &&
        // The module and its registry are the module, not a page reaching it.
        !f.startsWith(`${ACTIONS}.`) &&
        f !== 'apps/web/app/programs/actions.registry.ts',
    );
    expect(
      web.filter(importsActions),
      `lifting this pin owes, in the same PR:\n- ${OWED_AT_7B.join('\n- ')}`,
    ).toEqual([]);
  });

  it('the pin sees an import by alias and by relative path (non-vacuity)', () => {
    // The test file itself imports it relatively: the resolver must see that.
    expect(importsActions('apps/web/app/programs/actions.test.ts')).toBe(true);
  });
});
