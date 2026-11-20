import { describe, expect, it } from 'vitest';

import type { MovementForeignKey } from '../../src/queries/movement-ownership';
import {
  deletedCountIssue,
  legacyMovementDeletionIssue,
  legacyMovementTargetIssue,
  parseExpectedLegacyCounts,
  type LegacyMovementCounts,
} from './movement-gates';

const fk = (table: string, over: Partial<MovementForeignKey> = {}): MovementForeignKey => ({
  name: `${table}_movement_id_movements_id_fk`,
  schemaName: 'public',
  table,
  columns: ['movement_id'],
  referencedColumns: ['id'],
  deleteRule: 'a',
  ...over,
});

const TODAY = [
  fk('entries'),
  fk('movement_equipment'),
  fk('movement_muscles'),
  fk('prescriptions'),
];
const FOUND: LegacyMovementCounts = { movements: 35, equipment: 2, muscles: 3 };
const UNREFERENCED = [
  { table: 'entries', column: 'movement_id', rows: 0 },
  { table: 'prescriptions', column: 'movement_id', rows: 0 },
];
const issue = (over: Partial<Parameters<typeof legacyMovementDeletionIssue>[0]> = {}) =>
  legacyMovementDeletionIssue({
    foreignKeys: TODAY,
    references: UNREFERENCED,
    expected: { ...FOUND },
    found: FOUND,
    ...over,
  });

describe('step 5 deletes legacy movements only while nothing references them (CAT-3 R1, D2)', () => {
  it("passes today's keys, no references and the dry run's three counts", () => {
    expect(issue()).toBeNull();
  });

  it('a dry run skips the expected counts but not the refusals', () => {
    expect(issue({ expected: 'dry-run' })).toBeNull();
    expect(
      issue({
        expected: 'dry-run',
        references: [{ table: 'entries', column: 'movement_id', rows: 1 }],
      }),
    ).toMatch(/entries\.movement_id: 1 row/);
  });

  it('refuses any reference, naming the table, the column and the count', () => {
    const why = issue({
      references: [
        { table: 'entries', column: 'movement_id', rows: 4 },
        { table: 'prescriptions', column: 'movement_id', rows: 0 },
        { table: 'scratch', column: 'mv', rows: 1 },
      ],
    });
    expect(why).toMatch(
      /entries\.movement_id: 4 row\(s\), scratch\.mv: 1 row\(s\) still reference/,
    );
    expect(why).not.toMatch(/prescriptions/);
  });

  it.each([
    ['a multi-column key', fk('pairs', { columns: ['movement_id', 'slug'] })],
    ['a key onto another column', fk('by_slug', { referencedColumns: ['slug'] })],
  ])('refuses %s, never skips it', (_what, key) => {
    expect(issue({ foreignKeys: [...TODAY, key] })).toMatch(
      new RegExp(`from ${key.table} into movements is not one column onto movements\\.id`),
    );
  });

  it('names a key outside public with its schema', () => {
    expect(
      issue({ foreignKeys: [fk('pairs', { schemaName: 'other', columns: ['a', 'b'] })] }),
    ).toMatch(/from other\.pairs into/);
  });

  it.each(['c', 'n', 'd'])('refuses a key whose delete rule is %s', (deleteRule) => {
    expect(issue({ foreignKeys: [...TODAY, fk('cascading', { deleteRule })] })).toMatch(
      /from cascading into movements does not abort a delete/,
    );
  });

  it('accepts RESTRICT as well as NO ACTION', () => {
    expect(issue({ foreignKeys: [...TODAY, fk('restricted', { deleteRule: 'r' })] })).toBeNull();
  });

  it('under --apply, refuses a missing count, naming each one missing', () => {
    expect(issue({ expected: { movements: 35, equipment: 'unset', muscles: 'unset' } })).toMatch(
      /--apply needs EXPECT_LEGACY_EQUIPMENT, EXPECT_LEGACY_MUSCLES/,
    );
  });

  it.each([
    ['movements', { movements: 34, equipment: 2, muscles: 3 }, /35 movements.*MOVEMENTS is 34/],
    ['equipment', { movements: 35, equipment: 3, muscles: 3 }, /2 equipment.*EQUIPMENT is 3/],
    ['muscles', { movements: 35, equipment: 2, muscles: 0 }, /3 muscles.*MUSCLES is 0/],
  ])('under --apply, refuses when the %s count differs', (_what, expected, why) => {
    expect(issue({ expected })).toMatch(why);
    expect(issue({ expected })).toMatch(/rolled back, nothing deleted/);
  });

  it('refuses keys before references, and references before the expected counts', () => {
    const all = {
      foreignKeys: [...TODAY, fk('cascading', { deleteRule: 'c' })],
      references: [{ table: 'entries', column: 'movement_id', rows: 1 }],
      expected: { movements: 'unset', equipment: 'unset', muscles: 'unset' } as const,
    };
    expect(issue(all)).toMatch(/does not abort/);
    expect(issue({ ...all, foreignKeys: TODAY })).toMatch(/still reference/);
  });
});

describe("step 5's --apply inputs", () => {
  it('refuses a malformed count, naming it', () => {
    expect(issue({ expected: { movements: 35, equipment: 'malformed', muscles: 3 } })).toMatch(
      /^EXPECT_LEGACY_EQUIPMENT is not a whole number; nothing deleted$/,
    );
  });

  it('calls the counts a restatement of the current counts, not a sitting', () => {
    const why = issue({ expected: { movements: 'unset', equipment: 2, muscles: 3 } }) ?? '';
    expect(why).toMatch(/a restatement of the current count/);
    expect(why).not.toMatch(/sitting/);
  });

  it('parses each EXPECT_LEGACY_* as unset, malformed or a whole number', () => {
    const env: Record<string, string> = {
      EXPECT_LEGACY_MOVEMENTS: ' 35 ',
      EXPECT_LEGACY_EQUIPMENT: '2.5',
    };
    expect(parseExpectedLegacyCounts((n) => env[n])).toEqual({
      movements: 35,
      equipment: 'malformed',
      muscles: 'unset',
    });
    expect(parseExpectedLegacyCounts(() => '')).toEqual({
      movements: 'unset',
      equipment: 'unset',
      muscles: 'unset',
    });
  });

  it('refuses --apply without the direct string', () => {
    expect(legacyMovementTargetIssue(undefined)).toMatch(/DATABASE_URL_UNPOOLED is not set/);
    expect(legacyMovementTargetIssue('')).toMatch(/DATABASE_URL_UNPOOLED is not set/);
    expect(legacyMovementTargetIssue('postgres://u:secret@h.invalid/x')).toBeNull();
  });

  it('refuses a delete that removed fewer rows than it locked, naming each count', () => {
    expect(deletedCountIssue(FOUND, FOUND)).toBeNull();
    expect(deletedCountIssue(FOUND, { ...FOUND, movements: 34, muscles: 2 })).toMatch(
      /removed 34 movements, 2 muscles, not the locked count: rolled back/,
    );
  });
});
