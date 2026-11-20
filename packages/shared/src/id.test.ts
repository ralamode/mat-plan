import { globSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { hideEntriesSchema, restoreHiddenSchema } from './hide';
import { newId, uuidSchema } from './id';
import { code } from './test-support/source-graph';

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
  // spellings of one entry would read as a missing entry (`notFound`). No endpoint parses these
  // schemas yet, so the gap was latent here.
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
const SOURCES = [
  'packages/*/src/**/*.{ts,tsx,js,mjs,cjs}',
  'packages/*/scripts/**/*.{ts,js,mjs,cjs}',
  'apps/web/**/*.{ts,tsx,js,jsx,mjs,cjs}',
];
/** zod's uuid builders, as a call or a method, with or without arguments; a regex named for a uuid;
 *  and the `uuid` package's `validate`, imported by name, by namespace or through `require`.
 *  Over-matching is the safe direction here. */
const SECOND_VALIDATOR = [
  /\bz\s*\.\s*(uuid|uuidv\d|guid)\s*\(/,
  /\.\s*(uuid|uuidv\d|guid)\s*\(/,
  /\bimport\s*\{[^}]*\b(uuid|guid|uuidv\d)\b[^}]*\}\s*from\s*['"]zod['"]/,
  /\bimport\s*\{[^}]*\bvalidate\b[^}]*\}\s*from\s*['"]uuid['"]/,
  /\bimport\s*\*\s*as\s+\w+\s+from\s*['"]uuid['"]/,
  /\brequire\s*\(\s*['"]uuid['"]\s*\)/,
  /\b[A-Z_]*UUID[A-Z_]*_RE\b|\buuidRe(gex)?\b/,
];
/**
 * A uuid's SHAPE, however the regex is named or written (a literal, a `RegExp` string, inside
 * `.regex()` or `.refine()`): a hex class quantified `{8}`, the first group of 8-4-4-4-12. A name test
 * alone let `const UUID = /^[0-9a-f]{8}-…$/i` through (lane E's #667 review, P2-1).
 */
const UUID_SHAPE = /\[[^\]\n]*a-f[^\]\n]*\]\{8\}/i;
/**
 * The files that hold a uuid-shaped regex that parses NO input, each with why. Pinned both ways below:
 * a new file fails the scan, and an entry whose file no longer holds the shape fails as stale.
 */
const UUID_SHAPE_ALLOWED: Record<string, string> = {
  'apps/web/lib/sentry-scrub.ts':
    'masks every id in an outgoing Sentry event; it rewrites output, it never accepts an id',
  'packages/db/scripts/verify/day-plan.ts':
    'db:verify maps a fixture’s ids to the seeded ones; a proof, on no request path',
  'packages/db/scripts/verify/erasure.ts':
    'db:verify asserts a log line carries no id; a proof, on no request path',
};

/** Every scanned source but `id.ts`, with comments out (a docblock may name `z.uuid()`). */
const scanned = () =>
  SOURCES.flatMap((pattern) =>
    globSync(pattern, {
      cwd: REPO,
      exclude: (f) => /node_modules|\.next|\.test\.tsx?$|playwright-report|test-results/.test(f),
    }),
  )
    .filter((f) => f !== 'packages/shared/src/id.ts')
    .map((f) => ({ file: relative(REPO, join(REPO, f)), source: code(join(REPO, f)) }));

describe('🔴 there is one uuid validator', () => {
  it('no source outside id.ts builds its own (it would keep the caller’s spelling)', () => {
    const offenders = scanned()
      .filter(
        ({ file, source }) =>
          SECOND_VALIDATOR.some((re) => re.test(source)) ||
          (UUID_SHAPE.test(source) && !(file in UUID_SHAPE_ALLOWED)),
      )
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it('every allowed uuid-shaped file still holds one (an entry is never left stale)', () => {
    const holding = new Set(
      scanned()
        .filter(({ source }) => UUID_SHAPE.test(source))
        .map(({ file }) => file),
    );
    expect(Object.keys(UUID_SHAPE_ALLOWED).filter((file) => !holding.has(file))).toEqual([]);
  });

  it('catches each way to write one, and not an everyday word', () => {
    const caught = (source: string) =>
      SECOND_VALIDATOR.some((re) => re.test(source)) || UUID_SHAPE.test(source);
    for (const source of [
      'const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;',
      'z.string().regex(/^[0-9A-F]{8}-[0-9A-F]{4}/)',
      "new RegExp('[0-9a-fA-F]{8}-[0-9a-f]{4}')",
      'z.string().refine((s) => /^[\\da-f]{8}-/.test(s))',
      "import * as uuid from 'uuid'; uuid.validate(x);",
      "const { validate } = require('uuid');",
      "import { validate } from 'uuid';",
      'z.uuid()',
      'z.string().uuid()',
      'const UUID_RE = SOMETHING;',
    ])
      expect(caught(source), source).toBe(true);
    for (const source of [
      'const day = /^\\d{4}-\\d{2}-\\d{2}$/;',
      'const hex = /^[0-9a-f]{6}$/i;',
      'option.uuid',
      "import { v7 as uuidv7 } from 'uuid';",
    ])
      expect(caught(source), source).toBe(false);
  });
});
