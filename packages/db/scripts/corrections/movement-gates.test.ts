import { describe, expect, it } from 'vitest';

import type { MovementForeignKey } from '../../src/queries/movement-ownership';
import { legacyMovementDeletionIssue, type LegacyMovementCounts } from './movement-gates';

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
    expect(issue({ expected: { movements: 35, equipment: null, muscles: null } })).toMatch(
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
      expected: { movements: null, equipment: null, muscles: null },
    };
    expect(issue(all)).toMatch(/does not abort/);
    expect(issue({ ...all, foreignKeys: TODAY })).toMatch(/still reference/);
  });
});
