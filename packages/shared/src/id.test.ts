import { globSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { hideEntriesSchema, restoreHiddenSchema } from './hide';
import { newId, uuidSchema } from './id';

/** A fresh id whose two spellings differ (one with no a–f letter would make each case vacuous). */
function lettered(): string {
  const id = newId();
  expect(id.toUpperCase(), 'the id must hold a letter').not.toBe(id);
  return id;
}

describe('uuidSchema folds case (one spelling after every parse)', () => {
  it('hands an upper-case id back in lower case, and is still a uuid check', () => {
    const id = lettered();
    expect(uuidSchema.parse(id.toUpperCase())).toBe(id);
    expect(uuidSchema.parse(id)).toBe(id);
    expect(uuidSchema.safeParse('P1').success).toBe(false);
    expect(uuidSchema.safeParse(` ${id}`).success).toBe(false);
    expect(uuidSchema.safeParse(`{${id}}`).success).toBe(false);
  });

  // The hide and restore writers count the rows an `IN` matches against the ids sent, so two
  // spellings of one entry used to read as a missing entry (`notFound`).
  it.each([
    ['hideEntriesSchema', hideEntriesSchema, {}],
    ['restoreHiddenSchema', restoreHiddenSchema, { hiddenAt: '2026-11-17T18:04:05.123456Z' }],
  ] as const)('%s: one entry sent in two spellings is one id', (_, schema, extra) => {
    const entry = lettered();
    const parsed = schema.parse({
      profilePublicId: newId(),
      day: '2026-11-19',
      entryPublicIds: [entry, entry.toUpperCase()],
      ...extra,
    });
    expect(parsed.entryPublicIds).toEqual([entry]);
  });
});

const REPO = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const SOURCES = ['packages/*/src/**/*.ts', 'packages/*/scripts/**/*.ts', 'apps/web/**/*.{ts,tsx}'];

describe('🔴 there is one uuid validator', () => {
  it('no source outside id.ts builds its own (it would keep the caller’s spelling)', () => {
    const offenders = SOURCES.flatMap((pattern) =>
      globSync(pattern, {
        cwd: REPO,
        exclude: (f) => /node_modules|\.next|\.test\.tsx?$/.test(f),
      }),
    )
      .filter((f) => f !== 'packages/shared/src/id.ts')
      .filter((f) => {
        // Comments out: a docblock may name `z.uuid()`.
        const code = readFileSync(join(REPO, f), 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
        return /\bz\s*\.\s*(uuid|uuidv\d|guid)\s*\(|\.uuid\s*\(\s*\)/.test(code);
      })
      .map((f) => relative(REPO, join(REPO, f)));
    expect(offenders).toEqual([]);
  });
});
