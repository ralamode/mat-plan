import { inspect } from 'node:util';

import { DrizzleQueryError } from 'drizzle-orm/errors';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { ProgramWriteError, quietDbErrors } from './quiet-db-errors';

// A note an adult might type about a child; it must not survive the rethrow.
const NOTE = 'knee sore after practice, keep it light';

function failedSave() {
  const driver = Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
    detail: `Key (notes)=(${NOTE}) already exists.`,
  });
  return new DrizzleQueryError('insert into "prescriptions" ("notes") values ($1)', [NOTE], driver);
}

describe('quietDbErrors (FAM-1 7a: a failed query’s params never reach the runtime log)', () => {
  it('the real error carries the note, in its message and its cause (the leak this closes)', () => {
    const err = failedSave();
    expect(err.message).toContain(NOTE);
    expect(inspect(err, { depth: 5 })).toContain(NOTE);
  });

  it('rethrows an error with no params, no detail and no cause, keeping the SQLSTATE', async () => {
    const thrown = await quietDbErrors('saveWorkout', async () => {
      throw failedSave();
    }).catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(ProgramWriteError);
    const err = thrown as ProgramWriteError;
    expect(err.code).toBe('23505');
    expect(err.message).toBe('saveWorkout failed (SQLSTATE 23505)');
    expect(err.cause).toBeUndefined();
    // Everything Next or Node could print of it.
    for (const printed of [
      String(err),
      err.stack ?? '',
      inspect(err, { depth: 5 }),
      JSON.stringify(err),
    ]) {
      expect(printed).not.toContain(NOTE);
      expect(printed).not.toContain('params');
    }
  });

  it('passes a result through untouched', async () => {
    await expect(quietDbErrors('renameProgram', async () => ({ ok: true }))).resolves.toEqual({
      ok: true,
    });
  });

  it('an error with no SQLSTATE says only which operation failed', async () => {
    const thrown = await quietDbErrors('createProgram', async () => {
      throw new Error(`connection lost while writing ${NOTE}`);
    }).catch((error: unknown) => error as ProgramWriteError);
    expect(thrown.message).toBe('createProgram failed');
    expect(inspect(thrown)).not.toContain(NOTE);
  });
});
