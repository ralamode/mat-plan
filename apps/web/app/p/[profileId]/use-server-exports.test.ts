import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

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

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (
      /\.(ts|tsx)$/.test(name) &&
      !name.endsWith('.test.ts') &&
      !name.endsWith('.test.tsx')
    ) {
      out.push(full);
    }
  }
  return out;
}

// Vitest runs with cwd = apps/web, so `app` is the route tree.
const appDir = join(process.cwd(), 'app');
const serverFiles = walk(appDir).filter((f) =>
  /^\s*['"]use server['"]/.test(readFileSync(f, 'utf8')),
);

describe("'use server' modules export only async functions", () => {
  it('finds at least the route actions module (sanity: the scan works)', () => {
    expect(serverFiles.length).toBeGreaterThan(0);
  });

  it.each(serverFiles.map((f) => [f.replace(process.cwd(), '.'), f]))(
    '%s exports only async functions',
    (_label, file) => {
      const badExports = readFileSync(file, 'utf8')
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
        );
      expect(badExports).toEqual([]);
    },
  );
});
