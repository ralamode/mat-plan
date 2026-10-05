import { existsSync, globSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { isPublicPath, isUngatedPath } from '@/lib/access-gate';

/**
 * SEC-1's invariant as a test, not a sentence (OSS-2). The proxy is NOT the boundary: every page and
 * Route Handler re-checks the gate itself. OSS-2 made the first exception (the public landing), and a
 * prose rule plus a unit test of a string function would not notice a future page that forgets the call —
 * DUALS-1's merge accident (#153) was exactly that kind of silent loss.
 *
 * Source is matched with comments STRIPPED, so a `// TODO: requireGatedPage()` cannot satisfy it.
 */

const APP_DIR = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = resolve(APP_DIR, '..');

/** Comments out, strings kept — good enough for matching calls and directives in this app's source. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

/** `app/p/[profileId]/page.tsx` → `/p/[profileId]`; route groups `(x)` add no segment. */
function routeOf(file: string): string {
  const segments = relative(APP_DIR, dirname(file))
    .split('/')
    .filter((s) => s !== '' && !/^\(.*\)$/.test(s));
  return `/${segments.join('/')}`;
}

const app = (pattern: string) =>
  globSync(pattern, { cwd: APP_DIR })
    .filter((f) => !/\.test\.tsx?$/.test(f))
    .map((f) => join(APP_DIR, f));

const pages = app('**/page.tsx');
const handlers = app('**/route.ts');

describe('every page is gated or deliberately un-gated', () => {
  it('finds the pages (an empty glob would pass everything below)', () => {
    expect(pages.length).toBeGreaterThan(2);
  });

  it.each(pages.map((f) => [routeOf(f), f]))('%s', (route, file) => {
    const gated = /\bawait\s+requireGatedPage\(\)/.test(code(file));
    expect(
      gated || isUngatedPath(route),
      `${route} neither awaits requireGatedPage() nor is an ungated path (PUBLIC_PATHS or the gate)`,
    ).toBe(true);
  });
});

describe('every Route Handler checks the gate itself', () => {
  it.each(handlers.map((f) => [routeOf(f), f]))('%s', (route, file) => {
    expect(
      /\b(?:isValidGateCookie|hasGateAccess)\(/.test(code(file)),
      `${route}/route.ts never checks the gate cookie`,
    ).toBe(true);
  });
});

/**
 * A `'use server'` function reachable from a PUBLIC page's module graph — root layout, error boundary and
 * every other root-segment file included — would be bundled for that page, and so invokable by an
 * unauthenticated POST to it with only its own gate check in the way. Public pages reach none.
 *
 * Follows local imports only (`@/…` and relative), including `export … from` re-exports and dynamic
 * `import()`; a package cannot contain this app's actions. The directive is matched ANYWHERE (inline
 * `'use server'` inside a function counts too) — over-matching is the safe direction here.
 */
const SPECIFIER_RE =
  /(?:^\s*(?:import|export)\s[^'"]*?from\s*|^\s*import\s*|\bimport\(\s*)['"]([^'"]+)['"]/gm;
const USE_SERVER_RE = /['"]use server['"]/;

function resolveLocal(spec: string, from: string): string | null {
  const base = spec.startsWith('@/')
    ? join(WEB_DIR, spec.slice(2))
    : spec.startsWith('.')
      ? resolve(dirname(from), spec)
      : null;
  if (!base) return null;
  const candidates = /\.tsx?$/.test(base)
    ? [base]
    : ['.ts', '.tsx', '/index.ts', '/index.tsx'].map((ext) => base + ext);
  return candidates.find((c) => existsSync(c)) ?? null;
}

function localGraph(entries: string[]): string[] {
  const seen = new Set<string>();
  const stack = [...entries];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const [, spec] of code(file).matchAll(SPECIFIER_RE)) {
      const next = resolveLocal(spec!, file);
      if (next) stack.push(next);
    }
  }
  return [...seen];
}

/** The segment's own non-page files (layout, error, not-found, template, loading) render with it. */
const segmentFiles = (dir: string) =>
  globSync('*.tsx', { cwd: dir })
    .filter((f) => f !== 'page.tsx' && !/\.test\.tsx$/.test(f))
    .map((f) => join(dir, f));

describe('public pages pull no Server Action into their module graph', () => {
  const publicPages = pages.filter((f) => isPublicPath(routeOf(f)));

  it('has at least one public page to check', () => {
    expect(publicPages.length).toBeGreaterThan(0);
  });

  it('can see an action module (the detector is not vacuous)', () => {
    expect(USE_SERVER_RE.test(code(join(APP_DIR, 'gate', 'actions.ts')))).toBe(true);
  });

  it.each(publicPages.map((f) => [routeOf(f), f]))('%s (with its segment files)', (_r, file) => {
    // The root segment's files render with EVERY page, so they are always in the graph.
    const graph = localGraph([file, ...segmentFiles(APP_DIR), ...segmentFiles(dirname(file))]);
    expect(graph.length).toBeGreaterThan(2);
    const actions = graph.filter((f) => USE_SERVER_RE.test(code(f)));
    expect(actions.map((f) => relative(WEB_DIR, f))).toEqual([]);
  });
});
