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
    expect(err.message).toBe('saveWorkout failed (DrizzleQueryError, SQLSTATE 23505)');
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
    expect(thrown.message).toBe('createProgram failed (Error)');
    expect(inspect(thrown)).not.toContain(NOTE);
  });

  it('a bug inside a writer keeps its type and its frames, so it points at the line', async () => {
    function writerBug(): never {
      throw new TypeError(`cannot read 'unit' of ${NOTE}`);
    }
    const thrown = await quietDbErrors('saveWorkout', async () => writerBug()).catch(
      (error: unknown) => error as ProgramWriteError,
    );
    expect(thrown.message).toBe('saveWorkout failed (TypeError)');
    expect(thrown.stack).toMatch(/\n\s+at writerBug .*quiet-db-errors\.test\.ts:\d+:\d+/);
    expect(thrown.stack).not.toContain(NOTE);
  });

  it('a Node errno is not a SQLSTATE', async () => {
    const thrown = await quietDbErrors('saveWorkout', async () => {
      throw Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
    }).catch((error: unknown) => error as ProgramWriteError);
    expect(thrown.code).toBeNull();
    expect(thrown.message).toBe('saveWorkout failed (Error)');
  });

  it('a multi-line message never reaches the stack, even a line that starts with "at"', async () => {
    const thrown = await quietDbErrors('saveWorkout', async () => {
      throw new Error(`Failed query: insert\n    at ${NOTE}\nparams: ${NOTE}`);
    }).catch((error: unknown) => error as ProgramWriteError);
    expect(thrown.stack).not.toContain(NOTE);
    expect(thrown.stack).not.toContain('params');
  });

  it('a message line shaped like a frame is still dropped: the message is skipped by count', async () => {
    const value = 'warm up first\n    at the gym before 5:30:15';
    const thrown = await quietDbErrors('saveWorkout', async () => {
      throw new DrizzleQueryError(
        'insert into "prescriptions" ("notes") values ($1)',
        [value],
        new Error('x'),
      );
    }).catch((error: unknown) => error as ProgramWriteError);
    expect(thrown.stack).not.toContain('the gym');
    // Frames are still kept: the throw's own position survives.
    expect(thrown.stack).toMatch(/\n\s+at .*:\d+:\d+/);
  });
});
