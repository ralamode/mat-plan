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
describe('the program tables stay dark (FAM-1 4a-i)', () => {
  const TABLES = 'programBlocks|workouts|blockDayWorkouts';
  const PATTERNS: Record<string, RegExp> = {
    insert: new RegExp(`\\.insert\\(\\s*(?:schema\\.)?(?:${TABLES})\\b`),
    'bare select': new RegExp(
      `\\.select\\(\\s*\\)[\\s\\S]{0,200}?\\.from\\(\\s*(?:schema\\.)?(?:${TABLES})\\b`,
    ),
    'relational query': new RegExp(`\\.query\\.(?:${TABLES})\\b`),
    'column-less returning': new RegExp(
      `\\.insert\\(\\s*(?:schema\\.)?(?:${TABLES})\\b[\\s\\S]{0,400}?\\.returning\\(\\s*\\)`,
    ),
  };
  const ALLOWED = [
    'packages/db/src/seed.ts',
    'packages/db/src/writers/ownership.ts',
    'packages/db/src/writers/program/',
  ];
  const HELPERS = /\b(insertProgramBlockOwnedBy|insertWorkoutOwnedBy|programBlockByClientId)\b/;

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
  });

  it('apps/web calls none of the ownership helpers yet', () => {
    const web = files.filter((f) => f.startsWith('apps/web/'));
    expect(web.filter((f) => HELPERS.test(code(join(REPO, f))))).toEqual([]);
  });
});
