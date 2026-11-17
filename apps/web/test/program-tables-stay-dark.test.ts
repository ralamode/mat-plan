import { globSync } from 'node:fs';
import { join, resolve } from 'node:path';
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
});
