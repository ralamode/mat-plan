import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { db, rolledBack, type VerifyTx } from './harness';

/**
 * `rolledBack` (FAM-1 contract change C2): a proof's writes never persist, and its failures still
 * fail.
 *
 * ⚠️ This runs against the harness's own PGlite, which here is EMPTY and unmigrated: the test makes
 * the one table it needs. `db:verify` is where the migrated database is; this only proves the
 * helper's own behaviour, which no proof module could assert about itself.
 */

const count = async (on: Pick<VerifyTx, 'execute'>) => {
  const res = await on.execute(sql`select count(*)::int as n from rolled_back_probe`);
  return (res as unknown as { rows: { n: number }[] }).rows[0].n;
};

describe('rolledBack', () => {
  beforeAll(async () => {
    await db.execute(sql`create table rolled_back_probe (n int primary key)`);
  });

  it('rolls back what the proof wrote, and resolves', async () => {
    let seenInside = -1;
    await expect(
      rolledBack(async (tx) => {
        await tx.execute(sql`insert into rolled_back_probe values (1), (2)`);
        seenInside = await count(tx);
      }),
    ).resolves.toBeUndefined();

    // The write was real inside the transaction, and is gone after it.
    expect(seenInside).toBe(2);
    expect(await count(db)).toBe(0);
  });

  it('rolls back and rethrows when the proof fails, with the proof’s own error', async () => {
    const failed = new Error('the proof’s own assertion');
    await expect(
      rolledBack(async (tx) => {
        await tx.execute(sql`insert into rolled_back_probe values (3)`);
        throw failed;
      }),
    ).rejects.toBe(failed);
    expect(await count(db)).toBe(0);
  });

  it('rolls back schema changes too, and leaves the database usable for the next proof', async () => {
    await rolledBack(async (tx) => {
      await tx.execute(sql`create table rolled_back_only_inside (n int)`);
    });
    const res = await db.execute(
      sql`select count(*)::int as n from information_schema.tables
          where table_name = 'rolled_back_only_inside'`,
    );
    expect((res as unknown as { rows: { n: number }[] }).rows[0].n).toBe(0);

    // A second call opens a fresh transaction: nothing is left aborted or open.
    await rolledBack(async (tx) => {
      await tx.execute(sql`insert into rolled_back_probe values (4)`);
      expect(await count(tx)).toBe(1);
    });
    expect(await count(db)).toBe(0);
  });
});
