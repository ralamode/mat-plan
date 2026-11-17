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
 * It looks for the un-hide's spellings in code (comments skipped), in `packages/db/src` and in the
 * app's DAL (`apps/web/lib/dal`, the other module that reaches `db`): `deletedAt: null`,
 * ``deletedAt: sql`null` ``, and a SQL `deleted_at = null` / `"deleted_at" = NULL` /
 * `${…deletedAt} = null`. The one allowed occurrence is `UNHIDE`'s own definition. ⚠️ It reads text,
 * so a value computed elsewhere and spread in is out of its reach; the CHECK still refuses that
 * (`23514`). Only files that write `entries` are read: another table's restore (a profile, a
 * movement) has no `hide_reason` and is not this rule's business.
 */
const SRC = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DAL = resolve(SRC, '../../../apps/web/lib/dal');

const UNHIDE_LITERAL =
  /deletedAt:\s*(sql`\s*)?null\b|deleted_?at"?\}?\s*=\s*null\b|deletedAt\}\s*=\s*null\b/i;
/** A file that names the entries table is one whose un-hide must clear the reason. */
const WRITES_ENTRIES = /schema\.entries\b|\bentries\b/;
const UNHIDE_DEFINITION = /export const UNHIDE = \{ deletedAt: null, hideReason: null \} as const;/;

/** Code lines only: a `//` line or a block comment's `*` line describes, it does not write. */
const isComment = (line: string) => /^\s*(\/\/|\*|\/\*)/.test(line);

describe('every un-hide clears the hide reason (V1-9b B2-0)', () => {
  it('the only deletedAt: null in packages/db/src is UNHIDE', () => {
    const hits: string[] = [];
    for (const root of [SRC, DAL]) {
      for (const file of globSync('**/*.ts', { cwd: root })) {
        if (file.endsWith('.test.ts')) continue;
        const text = readFileSync(join(root, file), 'utf8');
        if (!WRITES_ENTRIES.test(text)) continue;
        text.split('\n').forEach((line, i) => {
          if (isComment(line) || !UNHIDE_LITERAL.test(line)) return;
          if (UNHIDE_DEFINITION.test(line)) return;
          hits.push(`${relative(SRC, join(root, file))}:${i + 1}: ${line.trim()}`);
        });
      }
    }
    expect(hits, 'set UNHIDE (writers/hide.ts) instead, so the hide reason is cleared too').toEqual(
      [],
    );
  });

  it('the pattern catches every spelling it claims (the test of the test)', () => {
    for (const spelling of [
      '.set({ deletedAt: null })',
      '.set({ deletedAt: sql`null` })',
      'sql`update entries set deleted_at = null`',
      'sql`update "entries" set "deleted_at" = NULL`',
      'sql`set ${schema.entries.deletedAt} = null`',
    ]) {
      expect(UNHIDE_LITERAL.test(spelling), spelling).toBe(true);
    }
    expect(UNHIDE_LITERAL.test('.set({ deletedAt: sql`now()` })')).toBe(false);
  });

  it('UNHIDE is defined exactly once, and clears the reason', () => {
    const hide = readFileSync(join(SRC, 'writers/hide.ts'), 'utf8');
    expect(hide.match(new RegExp(UNHIDE_DEFINITION, 'g'))).toHaveLength(1);
  });
});
