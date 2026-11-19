import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The mutation gate's README is the one place that says what each patch breaks and which assertion
 * must go red (`mutations/README.md`). Six patches (326–329, 500–501) reached `main` with no row, and
 * nothing noticed: a patch without a row is a proof nobody can read. This pins the two lists to each
 * other in both directions.
 */
const DIR = join(dirname(fileURLToPath(import.meta.url)), 'mutations');
const patches = readdirSync(DIR).filter((f) => f.endsWith('.patch'));
const readme = readFileSync(join(DIR, 'README.md'), 'utf8');
const rows = [...readme.matchAll(/^\|\s*`([^`]+\.patch)`[^|]*\|([^|]*)\|([^|]*)\|/gm)];
const listed = rows.map((m) => m[1]!);

describe('mutations/README.md lists every patch, and only real ones', () => {
  it('finds both lists (an empty one would pass everything below)', () => {
    expect(patches.length).toBeGreaterThan(100);
    expect(listed.length).toBeGreaterThan(100);
  });

  it('every patch file has a row', () => {
    expect(patches.filter((p) => !listed.includes(p))).toEqual([]);
  });

  it('every row names a patch that exists', () => {
    expect(listed.filter((p) => !patches.includes(p))).toEqual([]);
  });

  it('every row says what must go red', () => {
    const blank = rows.filter((m) => !/[a-z]/i.test(m[3]!)).map((m) => m[1]);
    expect(blank).toEqual([]);
  });

  it('no patch has two rows', () => {
    expect(listed.filter((p, i) => listed.indexOf(p) !== i)).toEqual([]);
  });
});
