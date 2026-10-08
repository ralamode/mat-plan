import { globSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * **ADR 0006 obligation 2** — nothing household-scoped may enter a cache without the household id in
 * the key, and `force-dynamic` is now load-bearing for TENANCY.
 *
 * Under option A (session-only) `/p` and `/p/<id>` are **byte-identical URLs for every household on
 * earth**, so *nothing in any cache key distinguishes tenants.* The only thing between that and a
 * leak is `export const dynamic = 'force-dynamic'` in `app/layout.tsx` — whose own comment justifies
 * it by the **CSP nonce**, not by tenancy, and which no test pinned. Add `unstable_cache` /
 * `'use cache'` to a household-scoped read, or a CDN rule on `/p`, and household A's athletes are
 * served to household B. Under a path-addressed design the path key would contain the mistake; here
 * there is no key to contain it.
 *
 * ⚠️ **A Route Handler does NOT inherit a layout's segment config.** The export handler is dynamic
 * only because it calls `cookies()`. That is why it gets its own assertion rather than riding the
 * layout's.
 *
 * `revalidatePath` is deliberately **not** affected: profile public ids are globally unique, so the
 * 12 call sites cannot collide across households. Non-obvious, and the reason TEN-1 needed no route
 * sweep at all.
 *
 * Source is matched with comments STRIPPED (the `pages-are-gated.test.ts` idiom), so this docblock's
 * own mention of `unstable_cache` cannot trip the guard.
 */

const APP_DIR = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = resolve(APP_DIR, '..');

/** Comments out, strings kept — so a `// TODO: force-dynamic` cannot satisfy this. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

const webSources = globSync('**/*.{ts,tsx}', { cwd: WEB_DIR })
  .filter((f) => !f.includes('node_modules') && !f.startsWith('.next'))
  .filter((f) => !/\.test\.tsx?$/.test(f))
  .map((f) => join(WEB_DIR, f));

describe('tenancy depends on dynamic rendering (ADR 0006 obligation 2)', () => {
  it('finds the sources (an empty glob would pass everything below)', () => {
    expect(webSources.length).toBeGreaterThan(50);
  });

  it("app/layout.tsx declares dynamic = 'force-dynamic'", () => {
    expect(code(join(APP_DIR, 'layout.tsx'))).toMatch(
      /export\s+const\s+dynamic\s*=\s*'force-dynamic'/,
    );
  });

  it('…and says that tenancy depends on it, not only the CSP nonce', () => {
    // The comment is the thing a future author reads before deleting the directive. Deliberately
    // asserted on the RAW file: this is the one case where the comment IS the artifact.
    expect(readFileSync(join(APP_DIR, 'layout.tsx'), 'utf8')).toMatch(/tenancy|TEN-1/);
  });

  it('the export Route Handler is dynamic on its own (a handler inherits no segment config)', () => {
    const handler = code(join(APP_DIR, 'p', '[profileId]', 'export', 'route.ts'));
    expect(
      /\bcookies\(\)/.test(handler) ||
        /export\s+const\s+dynamic\s*=\s*'force-dynamic'/.test(handler),
      'the export handler must call cookies() or declare force-dynamic, or it can be served from a cache with no tenant in the key',
    ).toBe(true);
  });

  it('nothing in apps/web caches a read without a household id in the key', () => {
    // No household-scoped read exists behind any of these today, so the honest guard is that NONE of
    // them appears. The day one legitimately does, this test is the place that argues the key.
    const cachers = webSources.filter((f) => {
      const src = code(f);
      return (
        /\bunstable_cache\b/.test(src) ||
        /['"]use cache['"]/.test(src) ||
        /\bcacheTag\b/.test(src) ||
        /\bexport\s+const\s+revalidate\b/.test(src)
      );
    });
    expect(
      cachers.map((f) => relative(WEB_DIR, f)),
      'a household-scoped read entering a cache needs the household id in its key — under ADR 0006 the URL carries no tenant',
    ).toEqual([]);
  });
});
