import { globSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * V1-9b B2-0: **every un-hide is `UNHIDE`** (`writers/hide.ts`), so the hide reason is cleared in the
 * same statement as `deleted_at`. A live row with a reason is refused by
 * `ENTRY_HIDE_REASON_HIDDEN_CHECK` (`23514`); this test stops a new un-hide (FAM-1 11c's D35 revive,
 * or any later one) from reaching that refusal in production first.
 *
 * It looks for the un-hide's LITERAL in code (comments skipped): `deletedAt: null`, or a SQL
 * `deleted_at = null`. A patch object or raw `sql` that names it is caught the same way; the one
 * allowed occurrence is `UNHIDE`'s own definition.
 */
const SRC = resolve(fileURLToPath(new URL('..', import.meta.url)));

const UNHIDE_LITERAL = /deletedAt:\s*null\b|deleted_at\s*=\s*null\b/i;
const UNHIDE_DEFINITION = /export const UNHIDE = \{ deletedAt: null, hideReason: null \} as const;/;

/** Code lines only: a `//` line or a block comment's `*` line describes, it does not write. */
const isComment = (line: string) => /^\s*(\/\/|\*|\/\*)/.test(line);

describe('every un-hide clears the hide reason (V1-9b B2-0)', () => {
  it('the only deletedAt: null in packages/db/src is UNHIDE', () => {
    const hits: string[] = [];
    for (const file of globSync('**/*.ts', { cwd: SRC })) {
      if (file.endsWith('.test.ts')) continue;
      readFileSync(join(SRC, file), 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (isComment(line) || !UNHIDE_LITERAL.test(line)) return;
          if (UNHIDE_DEFINITION.test(line)) return;
          hits.push(`${relative(SRC, join(SRC, file))}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(hits, 'set UNHIDE (writers/hide.ts) instead, so the hide reason is cleared too').toEqual(
      [],
    );
  });

  it('UNHIDE is defined exactly once, and clears the reason', () => {
    const hide = readFileSync(join(SRC, 'writers/hide.ts'), 'utf8');
    expect(hide.match(new RegExp(UNHIDE_DEFINITION, 'g'))).toHaveLength(1);
  });
});
