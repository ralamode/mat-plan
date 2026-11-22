import { globSync, readFileSync } from 'node:fs';
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
 * ⚠️ **The import pins moved to `test/program-imports.test.ts`**, which checks them on the resolved
 * import graph rather than on specifier text (docs/plans/td-program-tables-import-graph.md): who may
 * import lane P's names and the ownership helpers (none in `apps/web`), that nothing in `apps/web`
 * reaches `packages/db/src/erasure/`, and who may import the program actions. This file keeps the
 * table shapes and the privacy-docs test, which reads `docs/privacy/` and so runs on every change,
 * unscoped.
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
    // and no `apps/web` file imports it (both held by `test/program-imports.test.ts`), so it cannot
    // race migrate.yml. The FILE, not the directory: a later module there (the delete core) justifies
    // its own entry.
    'packages/db/src/erasure/graph.ts',
    // PRIV-3 2a's pre-flights (a) and (h) name `program_assignments` in raw SQL (named columns only,
    // `a.id`, `a.profile_id`, `a.block_id`). Same reason as the graph: no barrel re-export, no
    // `apps/web` import (`test/program-imports.test.ts`), and only an operator's correction or
    // `db:verify` runs them.
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
});
