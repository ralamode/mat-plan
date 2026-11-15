import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { code, serverActionModules, USE_SERVER_RE, WEB_DIR } from '@/test/source-scan';

/**
 * Regression guard (V1-9): a `'use server'` module's runtime exports must all be async functions. The
 * Server Actions compiler registers every export as an action reference, so a re-exported TYPE via the
 * SPECIFIER form (`export type { ActionState }`) or any value export leaks a runtime
 * `ReferenceError: <name> is not defined` when the route first loads — the app's error boundary. Crucially
 * `tsc`/`next build` do NOT catch it (types erase at compile; the failure is at runtime registration).
 *
 * A type/interface DECLARATION (`export type GateState = {…}`, `export interface X`) is fine — it erases
 * fully and names no runtime binding (the gate has shipped one since V0-4). The dangerous forms are the
 * `export type { … }` re-export specifier and any `export const`/`{ … }`/class/non-async export. Keep
 * `ActionState`/`INITIAL_ACTION_STATE` in ./action-state, never re-exported from a 'use server' file.
 */

/**
 * 🔴 **Which files are Server Action modules is `serverActionModules()`'s answer, not this file's own
 * (FAM-1 step 0b).** Until then this guard walked `app/` and tested the directive against RAW source:
 * `/^\s*['"]use server['"]/`. Every other guard strips comments first (`test/source-scan.ts`), and the
 * difference was a hole: **a module that opens with a docblock or a `//` line above its directive did
 * not match here**, so it was a Server Action module to the boundary guards and to Next, and no
 * module at all to the one guard that checks what it exports. Its non-async export would have
 * reached the runtime `ReferenceError` this file exists to prevent. Both of today's modules happen to
 * open with the directive, which is the only reason it never bit.
 *
 * Two consequences of using the shared scan, both in the safe direction: the domain is `apps/web`,
 * not `app/` (a `'use server'` module under `components/` or `lib/` is a real endpoint), and the
 * source set is the one `pages-need-a-session.test.ts` pins, so the two guards cannot disagree about
 * what a Server Action module is.
 */
const serverFiles = serverActionModules();

/**
 * The export lines of a module that are NOT allowed in a `'use server'` file.
 *
 * ⚠️ **Read from RAW source, on purpose, though detection is comment-stripped.** The two questions
 * fail in opposite directions. Stripping comments to find the directive makes more files count as
 * modules. Stripping them here could only make fewer lines count as exports (the stripper is a
 * regex, and a string that happens to hold a comment opener would swallow real code after it), and
 * a guard that under-reports exports is the unsafe one. A line inside a docblock that starts with
 * `export ` is flagged; that is a false alarm with an obvious fix.
 */
function badExportsOf(file: string): string[] {
  return (
    readFileSync(file, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('export '))
      // Permitted: async functions (the real actions) + type/interface DECLARATIONS (erased, no runtime
      // binding). Flagged: `export type { … }` specifier re-exports, `export const/{ … }`/class/etc.
      .filter(
        (l) =>
          !/^export (default )?async function /.test(l) &&
          !/^export type [A-Za-z]/.test(l) &&
          !/^export interface /.test(l),
      )
  );
}

describe("'use server' modules export only async functions", () => {
  it('finds at least the route actions module (sanity: the scan works)', () => {
    expect(serverFiles.length).toBeGreaterThan(0);
    expect(serverFiles.map((f) => relative(WEB_DIR, f))).toContain('app/p/[profileId]/actions.ts');
  });

  it.each(serverFiles.map((f) => [relative(WEB_DIR, f), f]))(
    '%s exports only async functions',
    (_label, file) => {
      expect(badExportsOf(file)).toEqual([]);
    },
  );
});

/**
 * The case the raw-source detector missed, planted and run through the detector and the export
 * check this file now uses. In the OS temp directory, never in the tree: a real module with a bad
 * export would be a real finding in every Server Action guard for as long as the test ran.
 */
describe('a module that opens with a comment is still a Server Action module (FAM-1 step 0b)', () => {
  /** The detector this file used before: the directive must be the first thing in the RAW source. */
  const RAW_DIRECTIVE = /^\s*['"]use server['"]/;

  const LEAKY_EXPORTS = 'export const leaked = 1;\nexport type { ActionState };\n';
  const ACTION = 'export async function fineAction() {\n  return { ok: true, error: null };\n}\n';

  function withModule(source: string, check: (file: string) => void): void {
    const dir = mkdtempSync(join(tmpdir(), 'mat-plan-use-server-'));
    try {
      const file = join(dir, 'planted-actions.ts');
      writeFileSync(file, source);
      check(file);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it.each([
    ['a docblock', "/**\n * What this module is for.\n */\n'use server';\n\n"],
    ['a line comment', "// What this module is for.\n'use server';\n\n"],
  ])(
    'opened by %s: the old detector skipped it, this one checks its exports',
    (_label, opening) => {
      withModule(opening + ACTION + LEAKY_EXPORTS, (file) => {
        // The miss, kept as an assertion so the reason for the change stays executable.
        expect(RAW_DIRECTIVE.test(readFileSync(file, 'utf8'))).toBe(false);
        // The detector `serverActionModules()` applies to every source file.
        expect(USE_SERVER_RE.test(code(file))).toBe(true);
        expect(badExportsOf(file)).toEqual([
          'export const leaked = 1;',
          'export type { ActionState };',
        ]);
      });
    },
  );

  it('a module with nothing but async functions and declared types passes', () => {
    withModule("'use server';\n\n" + ACTION + 'export type Local = { a: 1 };\n', (file) => {
      expect(USE_SERVER_RE.test(code(file))).toBe(true);
      expect(badExportsOf(file)).toEqual([]);
    });
  });

  it('a file that only MENTIONS the directive in a comment is not a module', () => {
    withModule(
      "/** Not a module: it says 'use server' here only. */\nexport const x = 1;\n",
      (file) => {
        expect(USE_SERVER_RE.test(code(file))).toBe(false);
      },
    );
  });
});
