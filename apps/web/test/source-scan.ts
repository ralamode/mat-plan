import { globSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Source-text scanning shared by the guards that assert an invariant across every file, rather than
 * over one module's behaviour (AUTH-1 1b-bis).
 *
 * ⚠️ **A source-text guard proves a call is PRESENT, not that it is REACHED** before the DAL. That
 * second half is `actions.test.ts`'s job — its `expect(getProfileByPublicId).not.toHaveBeenCalled()`
 * on an unauthenticated call. Both halves together are the claim; neither alone is. Said here because
 * this module is what a future author will read when they reach for it.
 *
 * `code()` lands here because the same helper had **five** copies, which `docs/tech-debt.md` records;
 * AGENTS.md makes the second occurrence the trigger to extract. The copies convert as the PRs that
 * touch them land, rather than in one sweep nobody reviews.
 */

/** `apps/web`. Derived from this file, not `process.cwd()`, so it holds wherever the runner starts. */
export const WEB_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Comments out, strings kept — good enough for matching calls and directives in this app's source. */
export function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

/**
 * Is this module a Server Action module? **Anchored**, so the directive must be the first thing in the
 * file — which is what React requires of it. Run against `code()`, never raw source: both `actions.ts`
 * and `action-state.ts` mention the directive inside a docblock, and `action-state.ts` must NOT be
 * treated as an action module (it exports a type and a const, and demanding a session call inside
 * `INITIAL_ACTION_STATE` is nonsense). Comment-stripping and the anchor are belt and braces.
 */
export const USE_SERVER_RE = /^\s*['"]use server['"]/;

/**
 * Does this file mention the directive ANYWHERE? Deliberately unanchored and deliberately separate
 * from `USE_SERVER_RE`: the public-graph guard asks "could this module graph pull in a Server Action",
 * where **over-matching is the safe direction**, while module selection asks "is this a Server Action
 * module", where over-matching would demand auth calls in files that have none. Two questions, two
 * regexes; collapsing them weakens whichever one loses.
 */
export const USE_SERVER_MENTION_RE = /['"]use server['"]/;

/**
 * Every first-party TypeScript source file under `apps/web`, tests excluded.
 *
 * **Glob-based on purpose.** `use-server-exports.test.ts` has a hand-rolled `readdirSync` recursion
 * and it is the only copy, while the guards this supports use `globSync` — promoting the recursion
 * would add a third enumeration idiom to the repo rather than remove one.
 *
 * ⚠️ **Rooted at `apps/web`, not `apps/web/app`.** A `'use server'` module under `components/` or
 * `lib/` is a real Server Action and a real public endpoint, and the pre-existing guards rooted at
 * `app/` cannot see one. Today every such module is under `app/`, which is the only time widening the
 * domain costs nothing.
 */
export function appSources(): string[] {
  return globSync('**/*.{ts,tsx}', { cwd: WEB_DIR })
    .filter((f) => !/(^|\/)(node_modules|\.next)\//.test(f))
    .filter((f) => !/\.test\.tsx?$/.test(f))
    .map((f) => join(WEB_DIR, f))
    .sort();
}

/** The subset of {@link appSources} that are Server Action modules, by {@link USE_SERVER_RE}. */
export function serverActionModules(): string[] {
  return appSources().filter((f) => USE_SERVER_RE.test(code(f)));
}

/**
 * The names a `'use server'` module exports. Only the `export async function <name>` form is matched,
 * which is exactly what `use-server-exports.test.ts` already forces every such export to be — so a
 * re-export (`export { x } from './y'`) is not a gap here, it is a **red build there**. Anonymous
 * `export default async function` has no name to enumerate and is listed as a known limitation.
 */
export function exportedActionNames(file: string): string[] {
  return [...code(file).matchAll(/^export\s+async\s+function\s+([A-Za-z0-9_$]+)/gm)].map(
    (m) => m[1]!,
  );
}
