import { existsSync, globSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { GATE_PATH, isPublicPath } from '@/lib/access-gate';

/**
 * SEC-1's invariant as a test, not a sentence (OSS-2). The proxy is NOT the boundary: every page re-checks
 * the gate itself with `requireGatedPage()`. OSS-2 made the first exception (the public landing), and a
 * prose rule plus a unit test of a string function would not notice a future page that forgets the call —
 * DUALS-1's merge accident (#153) was exactly that kind of silent loss.
 */

const APP_DIR = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = resolve(APP_DIR, '..');

/** `app/p/[profileId]/page.tsx` → `/p/[profileId]`; route groups `(x)` add no segment. */
function routeOf(pageFile: string): string {
  const segments = relative(APP_DIR, dirname(pageFile))
    .split('/')
    .filter((s) => s !== '' && !/^\(.*\)$/.test(s));
  return `/${segments.join('/')}`;
}

const pages = globSync('**/page.tsx', { cwd: APP_DIR }).map((f) => join(APP_DIR, f));

describe('every page is gated or deliberately public', () => {
  it('finds the pages (an empty glob would pass everything below)', () => {
    expect(pages.length).toBeGreaterThan(2);
  });

  // The gate page is the one other exemption, and the proxy names it separately for the same reason: it
  // is how a caller GETS the cookie. Its action is the rate-limited password check (gate/actions.ts).
  it.each(pages.map((f) => [routeOf(f), f]))('%s', (route, file) => {
    const gated = readFileSync(file, 'utf8').includes('requireGatedPage(');
    expect(
      gated || isPublicPath(route) || route === GATE_PATH,
      `${route} neither calls requireGatedPage() nor is listed in PUBLIC_PATHS`,
    ).toBe(true);
  });
});

/**
 * Server Actions POST to the current URL and Next's action map is global, so a `'use server'` module in a
 * PUBLIC page's import graph (root layout included) is invokable by an unauthenticated POST to that URL
 * with only its own gate check in the way. Public pages import none. Follows local imports only (`@/…` and
 * relative) — a package cannot contain this app's actions.
 */
const IMPORT_RE = /^\s*import\s[^'"]*?['"]([^'"]+)['"]/gm;

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

function localGraph(entry: string): string[] {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const [, spec] of readFileSync(file, 'utf8').matchAll(IMPORT_RE)) {
      const next = resolveLocal(spec!, file);
      if (next) stack.push(next);
    }
  }
  return [...seen];
}

describe('public pages pull no Server Action into their module graph', () => {
  const publicEntries = pages.filter((f) => isPublicPath(routeOf(f)));

  it('has at least one public page to check', () => {
    expect(publicEntries.length).toBeGreaterThan(0);
  });

  it.each(publicEntries.map((f) => [routeOf(f), f]))(
    '%s (with the root layout)',
    (_route, file) => {
      const graph = [...localGraph(file), ...localGraph(join(APP_DIR, 'layout.tsx'))];
      expect(graph.length).toBeGreaterThan(1);
      const actions = graph.filter((f) => /^\s*['"]use server['"]/.test(readFileSync(f, 'utf8')));
      expect(actions.map((f) => relative(WEB_DIR, f))).toEqual([]);
    },
  );
});
