import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Reading this package's own source, for the tests that assert something about every file or about
 * what a module reaches: "client-safe code never reaches `csv/`", "the root barrel never reaches
 * the catalog's data". Lifted out of `program/quantity-text.test.ts` when a second test needed it
 * (CAT-3 C0a). Test support only: nothing in the package's exports imports this file.
 */

/** `packages/shared/src`. */
export const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Comments out, so a path a docblock mentions is not read as an import. */
export const code = (file: string) =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

/**
 * Every module specifier `file` names: `import … from`, a bare `import '…'`, `export … from`,
 * `import()` and `require()`, type-only ones included. Relative AND bare: a package name
 * (`node:fs`, `server-only`, `@mat-plan/shared/csv`) is as much a way out of client-safe code as a
 * relative path into `csv/`.
 */
export const specifiersOf = (file: string) =>
  [...code(file).matchAll(/\b(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g)].map(
    ([, specifier]) => specifier,
  );

const isRelative = (specifier: string) => specifier.startsWith('.');

/** The source file a relative specifier names. Throws on one it cannot find, so no import is skipped. */
function sourceOf(from: string, specifier: string): string {
  const base = resolve(dirname(from), specifier);
  const found = [`${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts')].find(existsSync);
  if (!found) throw new Error(`import scan: cannot resolve '${specifier}' from ${from}`);
  return found;
}

/**
 * What `entry` reaches, followed to the end: `files`, every first-party module (itself included),
 * and `packages`, every bare specifier any of them names, sorted. Type-only imports count too,
 * which over-reports, the safe direction for a "never reaches" check.
 */
export function reachedFrom(entry: string): { files: string[]; packages: string[] } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const visit = (file: string) => {
    if (files.has(file)) return;
    files.add(file);
    for (const specifier of specifiersOf(file)) {
      if (isRelative(specifier)) visit(sourceOf(file, specifier));
      else packages.add(specifier);
    }
  };
  visit(entry);
  return { files: [...files], packages: [...packages].sort() };
}
