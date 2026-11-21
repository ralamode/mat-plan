import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
  ASSET_EXT,
  barrelNames,
  bound,
  blindSpots,
  CODE_EXT,
  compilerOptionsOf,
  importsOf,
  isReference,
  lineOf,
  originsOf,
  REPO_DIR,
  type FileImports,
  type GraphRefusal,
  type Origin,
  type ImportKind,
  type ImportRef,
} from './import-graph';

/**
 * 🔴 **Who may import what from `@mat-plan/db` and the action modules, checked on the resolved
 * import graph** (docs/plans/td-program-tables-import-graph.md). One guard for the import pins that
 * `program-tables-stay-dark.test.ts`, `lib/dal/day/importers.test.ts` and `lib/dal/entries.test.ts`
 * held as regexes on specifier text.
 *
 * Every specifier is resolved the way the compiler resolves it (`importsOf`, `test/import-graph.ts`),
 * so a pin compares FILES: a comment in the braces, a backtick, `require (`, a dot segment
 * (`@mat-plan/./db`), a path through `node_modules` or an `@/` walking out of `apps/web` all land on
 * the same file and get the same answer. A first-party specifier that does not resolve fails closed.
 *
 * - **Where an import may land is an allow-list.** From `apps/web`: its own scanned files and tracked
 *   assets, third-party `node_modules/`, `packages/shared/src/`, `packages/engine/src/`, and
 *   `packages/db/src/index.ts`. From `packages/shared` and `packages/engine`: their own `src/` and
 *   third-party `node_modules/`. From `packages/db/src/index.ts`'s closure: `packages/db/src/`,
 *   shared and engine `src/`, third-party. Anything else (`packages/evals`, `packages/db/scripts`,
 *   `.github/scripts`, a test file) is refused, so the graph never stops at a package boundary.
 * - **The pins:** the entry publishes nothing from `erasure/`; each name `ALLOWED_IN` restricts is
 *   imported only where it lists; no whole-package form (`import * as`, `export *`, `import()`,
 *   `require`, `typeof import`); in a file `ALLOWED_IN` permits, such a name is used only as the
 *   direct callee of a call, never passed on (exported, put in an object, handed to a wrapper);
 *   each module in `MODULES` has only its listed importers; no `'use client'` file reaches the
 *   package or the program DAL.
 * - **Names are keyed by ORIGIN** (`originsOf`): each name `index.ts` publishes is traced through
 *   its re-export graph to the file and name that define it, so a lane P writer re-published under a
 *   new name by another barrel is still lane P's. A name whose origin cannot be traced fails closed.
 *   The walk is per form, so it is backed by a structural pin: inside `packages/db/src`, restricted
 *   code has exactly the importers it has today (`DB_IMPORTERS`), so a form the walk misses still
 *   needs a new import, and fails.
 * - **The premises** the resolver's answer rests on (the alias, the resolution options, the
 *   manifests' `exports`/`imports`, `next.config`'s bundler keys) are assertions: if one breaks, the
 *   resolver may disagree with the bundler, and this file says so.
 *
 * **Scoped** (D7): CI and pre-push skip it only when `.github/scripts/changed-scopes.mjs`'s
 * `runImportPins` says no changed file can change its answer. Anything else runs it, and every run
 * on `main` does.
 */

/** The package's one entry: `packages/db/package.json`'s `exports['.']`, pinned below. */
const DB_INDEX = 'packages/db/src/index.ts';
const DB_DIR = 'packages/db/';
const DB_SRC = 'packages/db/src/';
const ERASURE = 'packages/db/src/erasure/';
const LANE_P_BARRELS = [
  'packages/db/src/writers/program/index.ts',
  'packages/db/src/queries/program/index.ts',
] as const;
const PROGRAM_DAL = 'apps/web/lib/dal/program/';
const DAY_DAL = 'apps/web/lib/dal/day/';
const ENTRIES_DAL = 'apps/web/lib/dal/entries.ts';
const WEB = 'apps/web/';
const WEB_TEST = 'apps/web/test/';
const DAY_PAGE = 'apps/web/app/p/[profileId]/page.tsx';
/**
 * The one reviewed landing outside the packages: `apps/web/scripts/` (the local e2e and screenshot
 * runners, never bundled) take the machine-wide heavy-run slot from `.github/scripts/heavy-slot.mjs`
 * (DX-18). Keyed on the importing directory and the exact target.
 */
const SCRIPTS_MAY_LAND = { from: 'apps/web/scripts/', to: '.github/scripts/heavy-slot.mjs' };
/**
 * Only the runners themselves and the end-to-end specs may reach `apps/web/scripts/`. Without this,
 * a bundled file importing a runner would carry `SCRIPTS_MAY_LAND`'s target, and its whole closure,
 * into a route (security re-check of #785).
 */
const SCRIPTS_REACHED_FROM = [SCRIPTS_MAY_LAND.from, 'apps/web/e2e/'];
/** Shared code any package may import, and third-party code (a realpath under the root store). */
const SHARED_SOURCES = ['packages/shared/src/', 'packages/engine/src/'];
const THIRD_PARTY = 'node_modules/';

const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;
/** A path segment that is exactly one of these is not source, and is never tracked. */
const NOT_SOURCE = /(?:^|\/)(?:node_modules|\.next)(?:\/|$)/;

/** Lane P's names, read from the two barrels (D4). Asserted readable below, never thrown on. */
const BARRELS = LANE_P_BARRELS.map((file) => ({ file, ...barrelNames(join(REPO_DIR, file)) }));
const LANE_P = BARRELS.flatMap((b) => b.names);

/**
 * The exceptions to "lane P's names, from the program DAL only". `workoutInHousehold` is lane P's,
 * and the day DAL's scope-miss report (12b) needs it too; the day's reads and row writers are the day
 * DAL's (12b); `readLiveSets` is `lib/dal/entries.ts`'s (#766); the ownership helpers lane P's
 * writers call are imported nowhere in `apps/web`.
 */
const OVERRIDES: Record<string, readonly string[]> = {
  workoutInHousehold: [PROGRAM_DAL, DAY_DAL],
  resolveDayPlan: [DAY_DAL],
  logRow: [DAY_DAL],
  untickRow: [DAY_DAL],
  retickRow: [DAY_DAL],
  amendRow: [DAY_DAL],
  prescriptionLiveIn: [DAY_DAL],
  readLiveSets: [ENTRIES_DAL],
  insertProgramBlockOwnedBy: [],
  insertWorkoutOwnedBy: [],
  programBlockByClientId: [],
  liveTemplateBlockIn: [],
};

/** Where lane P's writers and reads are defined: a name that ORIGINATES here is lane P's. */
const LANE_P_DIRS = ['packages/db/src/writers/program/', 'packages/db/src/queries/program/'];
const originKey = (o: Origin) => `${o.file}#${o.name}`;
type Published = Map<string, Origin | null>;
/** What a map was built from, so a namespace origin's contents are read from the same texts. */
const builtFrom = new WeakMap<
  Published,
  { texts: Record<string, string>; memo: Map<string, Published> }
>();
/** Each name `index.ts` publishes, and its origin (`null`: untraceable); `texts` from a fixture. */
function publish(texts: Record<string, string> = {}): Published {
  const memo = new Map<string, Published>();
  const names = originsOf(DB_INDEX, texts, DB_SRC, memo);
  builtFrom.set(names, { texts, memo });
  return names;
}
let publishedCache: Published | undefined;
const published = () => (publishedCache ??= publish());

/**
 * Where in `apps/web` each ORIGIN may be imported from `@mat-plan/db`, as a directory (ending `/`) or
 * one file: an `OVERRIDES` row by its name's origin, else the program DAL for a lane P origin. The one
 * home of every allowance; keyed `file#name`, so a re-publication under another name is the same row.
 */
function allowedIn(names: Published): Map<string, readonly string[]> {
  const rows = new Map<string, readonly string[]>();
  for (const origin of names.values())
    if (origin && under(origin.file, LANE_P_DIRS)) rows.set(originKey(origin), [PROGRAM_DAL]);
  for (const [name, where] of Object.entries(OVERRIDES)) {
    const origin = names.get(name);
    if (origin) rows.set(originKey(origin), where);
  }
  return rows;
}
const allowedCache = new WeakMap<Published, Map<string, readonly string[]>>();
const ALLOWED_IN = (names: Published) => {
  let rows = allowedCache.get(names);
  if (!rows) allowedCache.set(names, (rows = allowedIn(names)));
  return rows;
};
/**
 * Where `name`, as `index.ts` publishes it, may be imported. `'untraceable'` fails closed: a name the
 * walk did not publish, a name it could not trace, and a namespace of a `packages/db` module holding
 * any restricted or untraceable name (`export * as ns`), which is refused everywhere rather than
 * given the intersection of its members' rows.
 */
function restriction(
  name: string,
  names: Published,
): readonly string[] | 'untraceable' | undefined {
  const origin = names.get(name);
  if (!origin) return 'untraceable'; // `null`: not traced; `undefined`: not published
  if (origin.name === '*' && origin.file.startsWith(DB_SRC)) {
    const from = builtFrom.get(names);
    const inner = originsOf(origin.file, from?.texts, DB_SRC, from?.memo);
    const rows = ALLOWED_IN(names);
    const restricted = (o: Origin | null) =>
      !o || o.name === '*' || rows.has(originKey(o)) || under(o.file, LANE_P_DIRS);
    return [...inner.values()].some(restricted) ? 'untraceable' : undefined;
  }
  return ALLOWED_IN(names).get(originKey(origin));
}
/** Every file or directory some row permits: where the direct-callee rule applies. */
const permitted = (names: Published) => [...new Set([...ALLOWED_IN(names).values()].flat())];

/** A program builder page: the one kind of file outside the module that may import its actions. */
const PROGRAM_PAGE = /^apps\/web\/app\/programs\/(?:.+\/)?page\.tsx$/;
/**
 * Modules with a closed set of importers. An importer puts a Server Action in the build's manifest,
 * and Next then forwards a POST naming one from any App Router path, so a new importer is a reviewed
 * change. `actions.contract.ts` holds every program action (7a-ii): it is the module too.
 */
const MODULES: readonly { files: readonly string[]; may: (file: string) => boolean }[] = [
  {
    files: ['apps/web/app/programs/actions.ts', 'apps/web/app/programs/actions.contract.ts'],
    may: (f) =>
      PROGRAM_PAGE.test(f) ||
      // The contract assembles the actions (7a-ii), so it imports `./actions`; the module's own
      // files may name each other. Neither registry imports either module, so neither is listed.
      /^apps\/web\/app\/programs\/actions(?:\.contract)?\.ts$/.test(f),
  },
  {
    files: ['apps/web/app/p/[profileId]/row-actions.ts'],
    // The day page alone, as `importers.test.ts`'s exact importer set held (lane C, #785).
    may: (f) => f === DAY_PAGE,
  },
];

/** The kinds that reach the package without naming what they take: refused everywhere. */
const WHOLE_PACKAGE = new Set<ImportKind>(['star', 'dynamic', 'require', 'type']);

/** The one reviewed computed import (D3): the action registry loads a module by its path. */
const EXCEPTION = {
  file: 'apps/web/test/action-registry.ts',
  rule: 'unresolved first-party',
  detail: 'computed import(/* @vite-ignore */ registryFile)',
};

type Violation = GraphRefusal & { file: string };
const message = (v: Violation) => `${v.file}:${v.line} ${v.rule}: ${v.detail}`;
const within = (file: string, where: string) =>
  where.endsWith('/') ? file.startsWith(where) : file === where;
const under = (file: string, dirs: readonly string[]) => dirs.some((d) => file.startsWith(d));

const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: REPO_DIR, encoding: 'utf8' }).split('\0').filter(Boolean);
/** Every tracked path under `paths`, whatever its kind. */
const trackedAll = (...paths: string[]) => git('ls-files', '-z', '--', ...paths);
/** The tracked code files under `paths`. A tracked `node_modules` or `.next` path fails a test below. */
const tracked = (...paths: string[]) =>
  trackedAll(...paths).filter((f) => CODE_EXT.test(f) && !NOT_SOURCE.test(f));

let domainCache: string[] | undefined;
/** The scan's domain: every tracked non-test code file under `apps/web`. */
const webDomain = () => (domainCache ??= tracked('apps/web').filter((f) => !TEST_FILE.test(f)));
let landingCache: Set<string> | undefined;
/** Where an `apps/web` import may land inside `apps/web`: the domain and its tracked assets. */
const webLanding = () =>
  (landingCache ??= new Set([
    ...webDomain(),
    ...trackedAll('apps/web').filter((f) => ASSET_EXT.test(f) && !NOT_SOURCE.test(f)),
  ]));

/** Inside a type (`typeof s`): no value is passed. */
const inType = (n: ts.Node): boolean => {
  for (let p = n.parent; p && !ts.isStatement(p) && !ts.isSourceFile(p); p = p.parent) {
    // A class's `extends (…)` is evaluated: a value, though its node is a type node.
    if (
      ts.isExpressionWithTypeArguments(p) &&
      ts.isHeritageClause(p.parent) &&
      p.parent.token === ts.SyntaxKind.ExtendsKeyword &&
      ts.isClassLike(p.parent.parent)
    )
      return false;
    if (ts.isTypeNode(p)) return true;
  }
  return false;
};
/** `s(…)`, through parentheses and `!`: the one use of a restricted binding that passes nothing on. */
const isDirectCallee = (n: ts.Node): boolean => {
  let e = n;
  while (ts.isParenthesizedExpression(e.parent) || ts.isNonNullExpression(e.parent)) e = e.parent;
  return ts.isCallExpression(e.parent) && e.parent.expression === e;
};

/**
 * In a file a row permits, every use of a restricted name other than as a direct callee, so a
 * writer is never handed on by a local binding (closed tech-debt, 2026-11-20). An
 * export of one (`export { s }`, `export const x = s`, `export default s`, `export { s } from
 * '@mat-plan/db'`) is a `re-export`; any other value use (an object literal, an argument such as
 * `cache(s)`, an assignment, `.call`, a spread, a return, a class's `extends (…)`) is `not a direct
 * call`. Type positions are free.
 *
 * ⚠️ **A forwarding wrapper passes, by design**: `export const persist = (...a) => saveWorkout(...a)`
 * calls the writer directly, the same shape as the allowed `cache(async (id) => saveWorkout(id))`,
 * so this rule cannot tell them apart without call-graph analysis (docs/tech-debt.md, "A DAL can
 * forward a writer through a wrapper function"). Every writer still takes a `HouseholdScope` that
 * only the DAL resolves.
 */
function valueUses(graph: FileImports, names: Published): GraphRefusal[] {
  const { sf } = graph;
  const hits: GraphRefusal[] = [];
  const toDb = (st: ts.Node) =>
    graph.imports.find((i) => i.text === st.getText(sf))?.resolved === DB_INDEX;
  const restricted = (name: string) => restriction(name, names) !== undefined;
  /** Local binding → the name `index.ts` publishes. */
  const locals = new Map<string, string>();
  const exported = new Set<ts.Node>();
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && !st.importClause?.isTypeOnly && toDb(st)) {
      const b = st.importClause?.namedBindings;
      if (b && ts.isNamedImports(b))
        for (const e of b.elements) {
          const name = (e.propertyName ?? e.name).text;
          if (!e.isTypeOnly && restricted(name)) locals.set(e.name.text, name);
        }
    } else if (
      ts.isExportDeclaration(st) &&
      st.exportClause &&
      ts.isNamedExports(st.exportClause)
    ) {
      if (st.moduleSpecifier) {
        if (toDb(st))
          for (const e of st.exportClause.elements) {
            const name = (e.propertyName ?? e.name).text;
            if (restricted(name))
              hits.push({ line: lineOf(sf, e), rule: 're-export', detail: name });
          }
      } else st.exportClause.elements.forEach((e) => exported.add(e.propertyName ?? e.name));
    } else if (
      ts.isVariableStatement(st) &&
      st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    )
      st.declarationList.declarations.forEach(
        (d) => d.initializer && exported.add(bound(d.initializer)),
      );
    else if (ts.isExportAssignment(st)) exported.add(bound(st.expression));
  }
  const walk = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && locals.has(n.text) && !ts.isImportSpecifier(n.parent)) {
      const name = locals.get(n.text)!;
      if (exported.has(n)) hits.push({ line: lineOf(sf, n), rule: 're-export', detail: name });
      else if (isReference(n) && !inType(n) && !isDirectCallee(n))
        hits.push({ line: lineOf(sf, n), rule: 'not a direct call', detail: name });
    }
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return hits;
}

/**
 * Every pin, for one `apps/web` file (repo-relative), read from disk or from `text`. `landing` is
 * where an import may land inside `apps/web`; a fixture passes its own.
 */
function violations(
  file: string,
  text?: string,
  landing = webLanding(),
  names: Published = published(),
): Violation[] {
  const graph = importsOf(join(REPO_DIR, file), text);
  const out: Violation[] = blindSpots(graph).map((b) => ({ file, ...b }));
  const v = (line: number, rule: string, detail: string) => out.push({ file, line, rule, detail });
  for (const i of graph.imports) {
    const r = i.resolved;
    if (r === null) continue;
    if (TEST_FILE.test(r)) v(i.line, 'test file', r);
    else if (r === DB_INDEX) {
      if (WHOLE_PACKAGE.has(i.kind)) v(i.line, 'whole-package', i.kind);
      else
        for (const n of i.names) {
          const where = restriction(n, names);
          if (where === 'untraceable') v(i.line, 'untraceable name', n);
          else if (where && !where.some((w) => within(file, w)))
            v(i.line, 'name', `${n} → ${where.length ? `only ${where.join(', ')}` : 'nowhere'}`);
        }
    } else if (r.startsWith(DB_DIR)) v(i.line, 'deep packages/db', r);
    else if (r.startsWith(WEB)) {
      if (r.startsWith(WEB_TEST) && !file.startsWith(WEB_TEST)) v(i.line, 'test helper', r);
      else if (r.startsWith(SCRIPTS_MAY_LAND.from) && !under(file, SCRIPTS_REACHED_FROM))
        v(i.line, 'local runner', r);
      else if (!landing.has(r)) v(i.line, 'outside the domain', r);
    } else if (
      !under(r, [THIRD_PARTY, ...SHARED_SOURCES]) &&
      !(file.startsWith(SCRIPTS_MAY_LAND.from) && r === SCRIPTS_MAY_LAND.to)
    )
      v(i.line, 'outside the graph', r);
    if (graph.client && (r.startsWith(DB_DIR) || r.startsWith(PROGRAM_DAL))) v(i.line, 'client', r);
    for (const m of MODULES) if (m.files.includes(r) && !m.may(file)) v(i.line, 'module', r);
  }
  if (permitted(names).some((w) => within(file, w)))
    for (const h of valueUses(graph, names)) v(h.line, h.rule, h.detail);
  return out;
}

/** The rule and detail of each violation: what a fixture asserts (D6). */
const found = (file: string, text: string) =>
  violations(file, text).map((x) => `${x.rule}: ${x.detail}`);

/**
 * A packages/shared or packages/engine file: it may land only in their own `src/` and third-party
 * code, never on a test file, and it must resolve.
 */
function packageViolations(file: string, text?: string): string[] {
  const graph = importsOf(join(REPO_DIR, file), text);
  const out = blindSpots(graph).map((b) => `${file}:${b.line} ${b.rule}: ${b.detail}`);
  for (const i of graph.imports) {
    const r = i.resolved;
    if (r === null) continue;
    if (TEST_FILE.test(r)) out.push(`${file}:${i.line} test file: ${r}`);
    else if (!under(r, [THIRD_PARTY, ...SHARED_SOURCES]))
      out.push(`${file}:${i.line} outside the graph: ${r}`);
  }
  return out;
}

/** An edge that exists at run time: not `import type`, `export type … from` or `typeof import`. */
const isRuntimeEdge = (i: ImportRef) => !i.typeOnly && i.kind !== 'type';

/**
 * 🔴 **The backstop to the origin walk: who inside `packages/db/src` imports restricted code.** The
 * walk (`originsOf`) traces the forms it knows; a file can still hand a writer on through one it does
 * not (a later reassignment of an `export let`, `Object.assign` onto an exported object, a function
 * or namespace body that returns it, an alias of a namespace import). Every such form needs an
 * IMPORT of the writer first, so this pins the importers instead of chasing the forms.
 *
 * A **publisher** is a `packages/db/src` file that publishes a restricted origin: every file under
 * the lane P directories (all its names), and any other file whose `originsOf` maps a name to a
 * restricted origin (that name). An **importer** of it is any tracked `packages/db/src` file with a
 * ref (any kind) resolving to it that names one of those names, or names nothing (`export *`, a
 * namespace or side-effect import), unless both sit under lane P's directories. The map is
 * `publisher → importer → kinds`; a test compares it
 * with {@link DB_IMPORTERS}, so a new importer, or a new kind of import, fails the guard whatever
 * form follows it. `texts` reads a file's text (or a new file) from a fixture.
 */
function dbImporters(texts: Record<string, string> = {}): Record<string, Record<string, string>> {
  const memo = new Map<string, Published>();
  const rows = ALLOWED_IN(published());
  const restrictedOrigin = (o: Origin | null) =>
    !!o && (under(o.file, LANE_P_DIRS) || rows.has(originKey(o)));
  const files = [...new Set([...tracked('packages/db/src'), ...Object.keys(texts)])].sort();
  const ALL = 'all';
  const publishers = new Map<string, Set<string> | typeof ALL>();
  for (const f of files) {
    if (TEST_FILE.test(f)) continue;
    if (under(f, LANE_P_DIRS)) {
      publishers.set(f, ALL);
      continue;
    }
    const names = [...originsOf(f, texts, DB_SRC, memo)]
      .filter(([, o]) => restrictedOrigin(o))
      .map(([n]) => n);
    if (names.length > 0) publishers.set(f, new Set(names));
  }
  const map: Record<string, Record<string, string>> = {};
  for (const f of files)
    for (const i of importsOf(join(REPO_DIR, f), texts[f]).imports) {
      const names = i.resolved === null ? undefined : publishers.get(i.resolved);
      if (!names) continue;
      // Lane P inside lane P is exempt: what is defined there is lane P's by origin wherever it is
      // re-published, so such an edge cannot launder a name, and pinning it would churn per writer.
      if (under(f, LANE_P_DIRS) && under(i.resolved!, LANE_P_DIRS)) continue;
      if (names !== ALL && i.names.length > 0 && !i.names.some((n) => names.has(n))) continue;
      const row = (map[i.resolved!] ??= {});
      row[f] = [...new Set([...(row[f]?.split('|') ?? []), i.kind])].sort().join('|');
    }
  return map;
}

const LP_W = 'packages/db/src/writers/program/';
const LP_Q = 'packages/db/src/queries/program/';
/**
 * Every importer of restricted code inside `packages/db/src` today, with how it imports
 * ({@link dbImporters}). A change here is a reviewed change to who can reach a writer.
 */
const DB_IMPORTERS: Record<string, Record<string, string>> = {
  // resolveDayPlan, through the day queries' barrel.
  'packages/db/src/queries/day/day-plan.ts': {
    'packages/db/src/queries/day/index.ts': 're-export',
  },
  'packages/db/src/queries/day/index.ts': { [DB_INDEX]: 're-export' },
  'packages/db/src/queries/day/prescription-live-in.ts': {
    'packages/db/src/queries/day/index.ts': 'star',
  },
  // readLiveSets: the entry for entries.ts, and the day's stored row values (one read, #766).
  'packages/db/src/queries/live-sets.ts': {
    [DB_INDEX]: 're-export',
    'packages/db/src/queries/day/stored-row-values.ts': 'static',
  },
  // logRow, untickRow, retickRow, amendRow: the day writers' barrel, then the entry.
  'packages/db/src/writers/day/amend-row.ts': {
    'packages/db/src/writers/day/index.ts': 're-export',
  },
  'packages/db/src/writers/day/log-row.ts': { 'packages/db/src/writers/day/index.ts': 're-export' },
  'packages/db/src/writers/day/index.ts': { [DB_INDEX]: 'star' },
  // The ownership helpers: the entry, and lane P's writers and reads, which compose them; the day
  // query that reuses the template-block rule.
  'packages/db/src/writers/ownership.ts': {
    [DB_INDEX]: 'star',
    'packages/db/src/queries/day/prescription-live-in.ts': 'static',
    [`${LP_Q}exists.ts`]: 'static',
    [`${LP_Q}program-list.ts`]: 'static',
    [`${LP_Q}program-view.ts`]: 'static',
    [`${LP_Q}workout.ts`]: 'static',
    [`${LP_W}assign.ts`]: 'static',
    [`${LP_W}copy-workout.ts`]: 'static',
    [`${LP_W}create-program.ts`]: 'static',
    [`${LP_W}program-name.ts`]: 'static',
    [`${LP_W}rename-program.ts`]: 'static',
    [`${LP_W}save-week.ts`]: 'static',
    [`${LP_W}save-workout.ts`]: 'static',
    [`${LP_W}seed-fixtures.ts`]: 'static',
  },
  // Lane P's code, from outside lane P: the entry, the test beside a lane P file, and the fixtures
  // seed. Edges inside lane P are exempt (dbImporters).
  [`${LP_Q}index.ts`]: { [DB_INDEX]: 'star' },
  [`${LP_W}index.ts`]: { [DB_INDEX]: 'star' },
  [`${LP_W}seed-fixtures.ts`]: { 'packages/db/src/seed.ts': 'static' }, // seedProgramFixtures
};

/**
 * `index.ts`'s import closure inside `packages/db/src/`: what it reaches at run time in `erasure/`,
 * and what it could not follow, which includes any edge out of `packages/db/src/` other than into
 * shared or engine `src/` or third-party code. `overrides` reads a file's text from a fixture.
 */
function dbClosure(overrides: Record<string, string> = {}) {
  const seen = new Set<string>();
  const stack = [DB_INDEX];
  const intoErasure: string[] = [];
  const blind: string[] = [];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const graph = importsOf(join(REPO_DIR, file), overrides[file]);
    blind.push(...blindSpots(graph).map((b) => `${file}:${b.line} ${b.rule}: ${b.detail}`));
    for (const i of graph.imports) {
      const r = i.resolved;
      if (r === null || under(r, [THIRD_PARTY, ...SHARED_SOURCES])) continue;
      if (!r.startsWith(DB_SRC)) {
        blind.push(`${file}:${i.line} out of packages/db/src: ${r}`);
        continue;
      }
      if (!isRuntimeEdge(i)) continue;
      if (r.startsWith(ERASURE)) intoErasure.push(`${file}:${i.line} → ${r}`);
      stack.push(r);
    }
  }
  return { seen, intoErasure, blind };
}

/** Every name `next.config.ts` could configure a bundler alias through, anywhere in its AST (S5). */
const BUNDLER_KEY =
  /^(?:webpack|turbopack|resolveAlias|alias|modularizeImports|transpilePackages)$/;
function bundlerKeys(text: string): string[] {
  const file = ts.createSourceFile('next.config.ts', text, ts.ScriptTarget.Latest, true);
  const keys: string[] = [];
  const walk = (n: ts.Node): void => {
    if (
      (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) &&
      BUNDLER_KEY.test(n.text)
    )
      keys.push(n.text);
    ts.forEachChild(n, walk);
  };
  walk(file);
  return keys;
}

let treeScan: Violation[] | undefined;
/** The whole domain's violations, computed once and only by a test that runs. */
const tree = () => (treeScan ??= webDomain().flatMap((f) => violations(f)));
const isException = (x: Violation) =>
  x.file === EXCEPTION.file && x.rule === EXCEPTION.rule && x.detail === EXCEPTION.detail;

const C = 'apps/web/components/program-builder/x.tsx';
const PROGRAM_X = `${PROGRAM_DAL}x.ts`;
const DAY_X = `${DAY_DAL}x.ts`;
const SHARED_X = 'packages/shared/src/x.ts';
const ONLY_PROGRAM = `only ${PROGRAM_DAL}`;
const ONLY_DAY = `only ${DAY_DAL}`;
const GRAPH = `${ERASURE}graph.ts`;
/** U1: on a case-insensitive filesystem (macOS) a miscased specifier resolves; on Linux it does not. */
const CASE_INSENSITIVE = !ts.sys.useCaseSensitiveFileNames;

/** One fixture: a file's text, read as if it sat at `at`, and exactly what it is refused for. */
type Fixture = { at: string; text: string; want: string[] };
const fixture = (at: string, text: string, ...want: string[]): Fixture => ({ at, text, want });

describe.skipIf(process.env.RUN_IMPORT_PINS === 'false')(
  'the program-tables import pins, on the resolved import graph',
  () => {
    describe('the premises the resolver rests on (D5)', () => {
      const BUNDLER_MAY_DISAGREE = 'the resolver may now disagree with the bundler';
      const json = (f: string) => JSON.parse(readFileSync(join(REPO_DIR, f), 'utf8'));

      it("apps/web's alias is exactly @/* → ./*, with no baseUrl", () => {
        const options = compilerOptionsOf(join(REPO_DIR, 'apps/web'));
        expect(options.paths, BUNDLER_MAY_DISAGREE).toEqual({ '@/*': ['./*'] });
        expect(options.baseUrl, BUNDLER_MAY_DISAGREE).toBeUndefined();
      });

      it.each(['apps/web', 'packages/db', 'packages/shared'])(
        '%s resolves as Bundler, with nothing that bends it',
        (project) => {
          const options = compilerOptionsOf(join(REPO_DIR, project));
          expect(options.moduleResolution, BUNDLER_MAY_DISAGREE).toBe(
            ts.ModuleResolutionKind.Bundler,
          );
          for (const key of ['customConditions', 'moduleSuffixes', 'rootDirs', 'preserveSymlinks'])
            expect(options[key], `${project}: ${key}; ${BUNDLER_MAY_DISAGREE}`).toBeUndefined();
        },
      );

      it('no manifest maps "imports", and packages/db exports only its entry', () => {
        for (const f of ['apps/web/package.json', 'packages/db/package.json'])
          expect(json(f), `${f}: ${BUNDLER_MAY_DISAGREE}`).not.toHaveProperty('imports');
        expect(json('packages/db/package.json').exports, BUNDLER_MAY_DISAGREE).toEqual({
          '.': './src/index.ts',
        });
      });

      it('next.config.ts names no bundler key, anywhere in its AST', () => {
        const text = readFileSync(join(REPO_DIR, 'apps/web/next.config.ts'), 'utf8');
        expect(bundlerKeys(text), BUNDLER_MAY_DISAGREE).toEqual([]);
      });

      it.each([
        ['const c = { webpack(c) { return c; } };', 'webpack'],
        ["const c = { ['webpack']: (c) => c };", 'webpack'],
        ['const c = {}; c.webpack = (c) => c;', 'webpack'],
        ["const k = 'turbopack'; const c = { [k]: 1 };", 'turbopack'],
        ['const c = { experimental: { turbo: { resolveAlias: {} } } };', 'resolveAlias'],
        ["const c = { modularizeImports: { '@mat-plan/db': {} } };", 'modularizeImports'],
        ["const c = { transpilePackages: ['x'] };", 'transpilePackages'],
        ['const c = { get alias() { return {}; } };', 'alias'],
      ])('the bundler-key walk sees %s', (text, key) => {
        expect(bundlerKeys(text)).toEqual([key]);
      });
    });

    describe("lane P's names, from the barrels (D4)", () => {
      it.each(LANE_P_BARRELS.map((f) => [f]))('%s publishes only by export { … } from', (file) => {
        const barrel = BARRELS.find((b) => b.file === file)!;
        expect(barrel.unreadable, `${file}: a form this guard cannot read`).toEqual([]);
        expect(barrel.diagnostics, `${file}: does not parse`).toEqual([]);
      });

      it('the barrels publish the sentinels, and only workoutInHousehold has an override', () => {
        expect(LANE_P).toEqual(
          expect.arrayContaining([
            'createProgram',
            'renameProgram',
            'saveWorkout',
            'readWorkoutDraft',
            'workoutInHousehold',
          ]),
        );
        expect(Object.keys(OVERRIDES).filter((n) => LANE_P.includes(n))).toEqual([
          'workoutInHousehold',
        ]);
      });

      it('every OVERRIDES name is one the package publishes, so no row guards nothing', () => {
        const names = published();
        expect(Object.keys(OVERRIDES).filter((n) => !names.get(n))).toEqual([]);
        expect(names.has('saveWorkout')).toBe(true);
        expect(names.has('notAPublishedName')).toBe(false);
      });

      it("every name the package publishes has a traced origin, and lane P's are lane P's", () => {
        const names = published();
        expect([...names].filter(([, o]) => o === null).map(([n]) => n)).toEqual([]);
        expect(LANE_P.filter((n) => !under(names.get(n)?.file ?? '', LANE_P_DIRS))).toEqual([]);
        expect(names.get('saveWorkout')).toEqual({
          file: 'packages/db/src/writers/program/save-workout.ts',
          name: 'saveWorkout',
        });
        expect(names.get('insertWorkoutOwnedBy')?.file).toBe(
          'packages/db/src/writers/ownership.ts',
        );
      });

      it('reads an alias, a type, and refuses what it cannot read (fixtures)', () => {
        const at = join(REPO_DIR, LANE_P_BARRELS[0]);
        expect(barrelNames(at, "export { a as b, type T } from './x';")).toEqual({
          names: ['b', 'T'],
          unreadable: [],
          diagnostics: [],
        });
        expect(
          barrelNames(at, "export * from './x';\nexport const y = 1;\nexport { z };").unreadable,
        ).toEqual(["export * from './x';", 'export const y = 1;', 'export { z };']);
        // U2: a malformed barrel reports a syntactic diagnostic.
        expect(barrelNames(at, 'export { a ').diagnostics).not.toEqual([]);
      });
    });

    describe('the tree', () => {
      it('scans a real tree, and tracks nothing under node_modules or .next', () => {
        expect(webDomain().length).toBeGreaterThan(200);
        expect(trackedAll('apps/web').filter((f) => NOT_SOURCE.test(f))).toEqual([]);
      });

      it('apps/web is clean, apart from the one reviewed computed import', () => {
        const all = tree();
        expect(all.filter((x) => !isException(x)).map(message)).toEqual([]);
        expect(
          all.filter(isException),
          'the exception is keyed on file, text and count',
        ).toHaveLength(1);
      });

      it('packages/shared and packages/engine land only in their own src/ and third-party code', () => {
        // Their tests are skipped: a test is in no graph until a file imports it, and the
        // `test file` rule refuses that, here and in apps/web.
        const files = tracked('packages/shared/src', 'packages/engine/src').filter(
          (f) => !TEST_FILE.test(f),
        );
        expect(files.length).toBeGreaterThan(50);
        expect(files.flatMap((f) => packageViolations(f))).toEqual([]);
      });

      it.each([
        ["import { db } from '../../db/src/index';", 'outside the graph: packages/db/src/index.ts'],
        ["export { a } from './units.test';", 'test file: packages/shared/src/units.test.ts'],
        [
          "export { a } from '../../evals/src/index';",
          'outside the graph: packages/evals/src/index.ts',
        ],
        [
          "export { a } from '../../../apps/web/lib/dal/program/reads';",
          'outside the graph: apps/web/lib/dal/program/reads.ts',
        ],
      ])('a shared file: %s', (text, want) => {
        expect(packageViolations(SHARED_X, text)).toEqual([`${SHARED_X}:1 ${want}`]);
      });
    });

    describe('inside packages/db/src, restricted code has exactly the importers it has today', () => {
      it('the importer map is DB_IMPORTERS', () => {
        expect(dbImporters()).toEqual(DB_IMPORTERS);
      });

      it('a new importer inside lane P, of lane P code, does not change the map', () => {
        expect(
          dbImporters({
            [`${LP_W}helper.ts`]:
              "import { refuse } from './refuse';\nimport { readWeek } from '../../queries/program/week';\nexport const h = [refuse, readWeek];",
          }),
        ).toEqual(DB_IMPORTERS);
      });

      it('the entry imports nothing: it only re-exports, by export * and export { … } from', () => {
        const kinds = importsOf(join(REPO_DIR, DB_INDEX)).imports.map((i) => i.kind);
        expect(kinds.filter((k) => k !== 'star' && k !== 're-export')).toEqual([]);
        expect(kinds.length).toBeGreaterThan(10);
      });

      // One form from each group the origin walk cannot follow (security re-check of #790). Each
      // needs a new import of restricted code, which the map refuses.
      const DAY_BARREL = 'packages/db/src/writers/day/index.ts';
      const dayBarrel = readFileSync(join(REPO_DIR, DAY_BARREL), 'utf8');
      const PI = "import { saveWorkout } from '../program';\n";
      it.each([
        [
          'a later reassignment of an export let',
          { [DAY_BARREL]: `${dayBarrel}\n${PI}export let persist: any;\npersist = saveWorkout;` },
          `${LP_W}index.ts`,
          DAY_BARREL,
          'static',
        ],
        [
          'Object.assign onto an exported object',
          {
            'packages/db/src/writers/day/tools.ts':
              "import { logRow } from './log-row';\nexport const tools: any = {};\nObject.assign(tools, { logRow });",
          },
          'packages/db/src/writers/day/log-row.ts',
          'packages/db/src/writers/day/tools.ts',
          'static',
        ],
        [
          'a function body that returns the writer',
          {
            'packages/db/src/queries/leak.ts':
              "import { readLiveSets } from './live-sets';\nexport function f() {\n  return readLiveSets;\n}",
          },
          'packages/db/src/queries/live-sets.ts',
          'packages/db/src/queries/leak.ts',
          'static',
        ],
        [
          'an alias of a namespace import',
          {
            [DAY_BARREL]: `${dayBarrel}\nimport * as P from '../program';\nconst a = P;\nexport const persist = a.saveWorkout;`,
          },
          `${LP_W}index.ts`,
          DAY_BARREL,
          'star',
        ],
        [
          'a lane P writer imported from outside lane P, next door',
          {
            'packages/db/src/writers/day/x.ts':
              "import { saveWorkout } from '../program/save-workout';\nexport const n = saveWorkout.length;",
          },
          `${LP_W}save-workout.ts`,
          'packages/db/src/writers/day/x.ts',
          'static',
        ],
        [
          'a new kind of import by an existing importer',
          {
            [DAY_BARREL]: `${dayBarrel}\nimport { logRow as l } from './log-row';\nexport let x: any;\nx = l;`,
          },
          'packages/db/src/writers/day/log-row.ts',
          DAY_BARREL,
          're-export|static',
        ],
      ] as const)('%s', (_label, texts, publisher, importer, kinds) => {
        const map = dbImporters({ ...texts });
        expect(map[publisher]?.[importer]).toBe(kinds);
        expect(map).not.toEqual(DB_IMPORTERS);
      });
    });

    describe('packages/db/src/index.ts publishes nothing from erasure/', () => {
      it('its two lane P specifiers resolve to the barrels', () => {
        const refs = importsOf(join(REPO_DIR, DB_INDEX)).imports;
        for (const [spec, barrel] of [
          ['./writers/program', LANE_P_BARRELS[0]],
          ['./queries/program', LANE_P_BARRELS[1]],
        ])
          expect(refs.find((i) => i.spec === spec)?.resolved, spec).toBe(barrel);
      });

      it('its runtime closure has no edge into erasure/, and is fully followed', () => {
        const { seen, intoErasure, blind } = dbClosure();
        expect(seen.size).toBeGreaterThan(30);
        expect(intoErasure).toEqual([]);
        expect(blind).toEqual([]);
      });

      it('an edge out of packages/db/src is blind, and an erasure edge is found (fixtures)', () => {
        const index = readFileSync(join(REPO_DIR, DB_INDEX), 'utf8');
        const plus = (line: string) => dbClosure({ [DB_INDEX]: `${index}\n${line}` });
        const out = plus("export { x } from '../scripts/corrections/registry';");
        expect(out.blind).toEqual([
          expect.stringMatching(
            /^packages\/db\/src\/index\.ts:\d+ out of packages\/db\/src: packages\/db\/scripts\/corrections\/registry\.ts$/,
          ),
        ]);
        expect(plus("export { x } from './erasure/graph';").intoErasure).toEqual([
          expect.stringMatching(/ → packages\/db\/src\/erasure\/graph\.ts$/),
        ]);
      });

      it('a type-only import is no edge; a value import is (fixtures and the real one)', () => {
        const file = join(REPO_DIR, 'packages/db/src/queries/movement-ownership.ts');
        const real = importsOf(file).imports.find((i) => i.resolved === GRAPH);
        expect(real).toBeDefined();
        expect(isRuntimeEdge(real!)).toBe(false);
        const value = importsOf(file, "import { IdIn } from '../erasure/graph';").imports[0]!;
        expect(value.resolved).toBe(GRAPH);
        expect(isRuntimeEdge(value)).toBe(true);
      });
    });

    const NAME_SAVE = `name: saveWorkout → ${ONLY_PROGRAM}`;
    const ROWS: Record<string, Fixture[]> = {
      'every spelling of the package has its names checked': [
        '@mat-plan/db',
        '@mat-plan/./db',
        '@mat-plan/x/../db',
        '@mat-plan//db',
        '@mat-plan/db/',
        '../../node_modules/@mat-plan/db',
        '@/../../packages/db/src',
      ].map((spec) => fixture(C, `import { saveWorkout } from '${spec}';`, NAME_SAVE)),
      'a deep packages/db import, however spelled': [
        '@mat-plan/./db/src/erasure/graph',
        '../../node_modules/@mat-plan/db/src/erasure/graph',
        '@/../../packages/./db/src/erasure/graph',
      ].map((spec) => fixture(C, `import { x } from '${spec}';`, `deep packages/db: ${GRAPH}`)),
      'an unresolved first-party specifier fails closed': [
        '@mat-plan/db/.',
        '@mat-plan/db/src/erasure/graph',
        '#internal/x',
        './nope',
        './nope.css',
        '@/README.md',
        'react/../@mat-plan/db',
      ].map((spec) =>
        fixture(C, `import { x } from '${spec}';`, `unresolved first-party: '${spec}'`),
      ),
      'outside the graph: no landing beyond the allow-list': [
        fixture(
          C,
          "import { x } from '@/../../packages/evals/src/index';",
          'outside the graph: packages/evals/src/index.ts',
        ),
        fixture(
          C,
          "import { x } from '@/../../.github/scripts/changed-scopes.mjs';",
          'outside the graph: .github/scripts/changed-scopes.mjs',
        ),
        fixture(
          C,
          "import { x } from '@/../../packages/db/scripts/corrections/registry';",
          'deep packages/db: packages/db/scripts/corrections/registry.ts',
        ),
        fixture(
          C,
          "import { slot } from '@/../../.github/scripts/heavy-slot.mjs';",
          'outside the graph: .github/scripts/heavy-slot.mjs',
        ),
        fixture(
          'apps/web/scripts/x.ts',
          "import { slot } from '../../../.github/scripts/heavy-slot.mjs';",
        ),
        // A bundled file may not reach a runner, by any spelling: the runner's closure holds the slot.
        fixture(
          C,
          "import { r } from '@/scripts/e2e-local';",
          'local runner: apps/web/scripts/e2e-local.ts',
        ),
        fixture(
          C,
          "import { r } from '@/./scripts/e2e-local';",
          'local runner: apps/web/scripts/e2e-local.ts',
        ),
        fixture(
          C,
          "import { r } from '@/lib/../scripts/e2e-local';",
          'local runner: apps/web/scripts/e2e-local.ts',
        ),
        fixture(
          'apps/web/app/programs/page.tsx',
          'const m = await import(`@/scripts/e2e-local`);',
          'local runner: apps/web/scripts/e2e-local.ts',
        ),
        fixture('apps/web/scripts/x.ts', "import { r } from './e2e-local';"),
        fixture('apps/web/e2e/x.spec.ts', "import { r } from '../scripts/e2e-local';"),
        fixture(C, "import { x } from '@mat-plan/shared';"),
        fixture(C, "import styles from '@/app/globals.css';"),
      ],
      'every form of the package as a whole': (
        [
          ["const m = require ('@mat-plan/db');", 'require'],
          ['const m = require(`@mat-plan/db`);', 'require'],
          ["import m = require('@mat-plan/db');", 'require'],
          ["const m = (require as any)('@mat-plan/db');", 'require'],
          ["const m = require!('@mat-plan/db');", 'require'],
          ["const m = await import('@mat-plan/db');", 'dynamic'],
          ['const m = await import(`@mat-plan/db`);', 'dynamic'],
          ["type M = typeof import('@mat-plan/db');", 'type'],
          ["import * as db from '@mat-plan/db';", 'star'],
          ["export * from '@mat-plan/db';", 'star'],
          ["export * as db from '@mat-plan/db';", 'star'],
        ] as const
      ).flatMap(([text, kind]) =>
        [C, PROGRAM_X].map((at) => fixture(at, text, `whole-package: ${kind}`)),
      ),
      'every spelling of an import: names checked': [
        'import { saveWorkout } from `@mat-plan/db`;',
        "import { /* a */ saveWorkout /* b */ } from /* c */ '@mat-plan/db';",
        "import {\n  // a\n  saveWorkout,\n} from '@mat-plan/db';",
        "import { 'saveWorkout' as s } from '@mat-plan/db';",
        "export { saveWorkout } from '@mat-plan/db';",
      ].map((text) => fixture(C, text, NAME_SAVE)),
      'a loader the graph cannot follow': [
        fixture(
          C,
          "const g = (require)('@mat-plan/./db/src/erasure/graph');",
          `deep packages/db: ${GRAPH}`,
        ),
        fixture(C, 'const m = await import(p);', 'unresolved first-party: computed import(p)'),
        ...(
          [
            ["const p = require.resolve('x');", 'require.resolve'],
            ["const c = require.context('.');", 'require.context'],
            ["const c = import.meta.webpackContext('.');", 'import.meta.webpackContext'],
            ["const m = module.require('x');", 'module.require'],
            ["const r = require['resolve'];", "require['resolve']"],
            ["const r = module['require'];", "module['require']"],
            ["const c = import.meta['webpackContext'];", "import.meta['webpackContext']"],
            ['const r = require;', 'require (not a direct call with a literal)'],
            ['type R = typeof require;', 'require (not a direct call with a literal)'],
            ['const m = require(p);', 'require (not a direct call with a literal)'],
            [
              'const m = __non_webpack_require__(p);',
              '__non_webpack_require__ (not a direct call with a literal)',
            ],
            ["import { createRequire } from 'some-shim';", 'createRequire'],
            ["import { builtinModules } from 'node:module';", "import of 'node:module'"],
            ["import Module from 'module';", "import of 'module'"],
            ['const m = import.meta;', 'import.meta (not a member access)'],
          ] as const
        ).map(([text, detail]) => fixture(C, text, `unfollowable: ${detail}`)),
        fixture(
          C,
          "import mod from 'node:module';\nconst r = mod.createRequire(x);",
          "unfollowable: import of 'node:module'",
          'unfollowable: createRequire',
        ),
        fixture(
          C,
          "const m = (import.meta as any).webpackContext('.');",
          'unfollowable: (import.meta as any).webpackContext',
          'unfollowable: import.meta (not a member access)',
        ),
        fixture(C, 'const o = { require: 1 };\no.require;\nclass K {\n  require() {}\n}'),
        fixture(C, 'const u = import.meta.url;'),
      ],
      'ALLOWED_IN: each name, only where it lists': [
        fixture(DAY_X, "import { workoutInHousehold, logRow } from '@mat-plan/db';"),
        // Change's row writer (12d) is the day DAL's, like logRow, untickRow and retickRow.
        fixture(DAY_X, "import { amendRow } from '@mat-plan/db';"),
        fixture(C, "import { amendRow } from '@mat-plan/db';", `name: amendRow → ${ONLY_DAY}`),
        fixture(
          DAY_X,
          "import { workoutInHousehold, saveWorkout } from '@mat-plan/db';",
          NAME_SAVE,
        ),
        fixture(PROGRAM_X, "import { workoutInHousehold, saveWorkout } from '@mat-plan/db';"),
        fixture(
          PROGRAM_X,
          "import { resolveDayPlan } from '@mat-plan/db';",
          `name: resolveDayPlan → ${ONLY_DAY}`,
        ),
        fixture(
          PROGRAM_X,
          "import { liveTemplateBlockIn } from '@mat-plan/db';",
          'name: liveTemplateBlockIn → nowhere',
        ),
        fixture(
          'apps/web/lib/dal/dayx/x.ts',
          "import { workoutInHousehold } from '@mat-plan/db';",
          `name: workoutInHousehold → only ${PROGRAM_DAL}, ${DAY_DAL}`,
        ),
        fixture(
          C,
          "import { readLiveSets } from '@mat-plan/./db';",
          `name: readLiveSets → only ${ENTRIES_DAL}`,
        ),
        fixture(ENTRIES_DAL, "import { readLiveSets } from '@mat-plan/db';"),
        fixture(
          C,
          "import type { MovementOption } from '@mat-plan/db';",
          `name: MovementOption → ${ONLY_PROGRAM}`,
        ),
        fixture(C, "import { schema, createDb } from '@mat-plan/db';"),
        // A name the package does not publish fails closed.
        fixture(C, "import { db } from '@mat-plan/db';", 'untraceable name: db'),
      ],
      'neither DAL re-exports a lane P name': [
        ...[
          "export { workoutInHousehold as 'isOurs' };",
          'export { workoutInHousehold as isOurs };',
          'export const a = workoutInHousehold as typeof workoutInHousehold;',
          'export const a = workoutInHousehold.bind(null);',
          'export const a = workoutInHousehold!;',
          'export default workoutInHousehold;',
        ].map((text) =>
          fixture(
            DAY_X,
            `import { workoutInHousehold } from '@mat-plan/db';\n${text}`,
            're-export: workoutInHousehold',
          ),
        ),
        fixture(
          DAY_X,
          "export { workoutInHousehold } from '@mat-plan/db';",
          're-export: workoutInHousehold',
        ),
        // An aliased import exported by its local name, and entries.ts, which a row permits too.
        fixture(
          DAY_X,
          "import { workoutInHousehold as w } from '@mat-plan/db';\nexport { w };",
          're-export: workoutInHousehold',
        ),
        fixture(
          ENTRIES_DAL,
          "import { readLiveSets } from '@mat-plan/db';\nexport const r = readLiveSets;",
          're-export: readLiveSets',
        ),
      ],
      'in a permitted file, a restricted name is only ever called': [
        ...[
          'export const api = { saveWorkout };',
          'export const api = { save: saveWorkout };',
          'export const getX = cache(saveWorkout);',
          'wrap(saveWorkout);',
          'let s;\ns = saveWorkout;',
          'saveWorkout.call(null, x);',
          'saveWorkout.apply(null, [x]);',
          'const f = saveWorkout.bind(null);',
          'const o = { ...saveWorkout };',
          'const xs = [saveWorkout];',
          'function f() {\n  return saveWorkout;\n}',
          'const n = new saveWorkout();',
          // A class's `extends (…)` runs (security review of #790, P2-1).
          'export class X extends ((leak = saveWorkout), Object) {}',
        ].map((text) =>
          fixture(
            PROGRAM_X,
            `import { saveWorkout } from '@mat-plan/db';\n${text}`,
            'not a direct call: saveWorkout',
          ),
        ),
        fixture(
          DAY_X,
          "import { logRow as log } from '@mat-plan/db';\nexport const actions = { log };",
          'not a direct call: logRow',
        ),
        ...[
          'await saveWorkout(x);',
          'saveWorkout(x);',
          '(saveWorkout)(x);',
          'saveWorkout!(x);',
          'saveWorkout?.(x);',
          'type T = typeof saveWorkout;',
          'let p: Parameters<typeof saveWorkout>[0];',
          // `reads.ts`'s shape: a wrapper around a function that calls it.
          'export const getX = cache(async function g(id) {\n  return saveWorkout(id);\n});',
          'export const getY = cache(async (id) => saveWorkout(id));',
          'const o = { saveWorkout: 1 };',
        ].map((text) => fixture(PROGRAM_X, `import { saveWorkout } from '@mat-plan/db';\n${text}`)),
        // An unrestricted name is free to pass on.
        fixture(
          PROGRAM_X,
          "import { schema } from '@mat-plan/db';\nexport const api = { schema };",
        ),
      ],
      'MODULES: only the listed importers': [
        ...(
          [
            ["import { a } from '@/app/programs/actions';", 'actions.ts'],
            ["import { a } from '@/../web/app/programs/actions';", 'actions.ts'],
            [
              "import { a } from '@/./lib/../app/programs/actions.contract';",
              'actions.contract.ts',
            ],
            ["import { a } from '../../app/programs/actions.ts';", 'actions.ts'],
            ["import '../../app/programs/actions';", 'actions.ts'],
          ] as const
        ).map(([text, target]) => fixture(C, text, `module: apps/web/app/programs/${target}`)),
        fixture(
          'apps/web/app/programs/[programId]/page.tsx',
          "import { P } from '../actions.contract';",
        ),
        fixture(
          'apps/web/app/programs/layout.tsx',
          "import { P } from './actions.contract';",
          'module: apps/web/app/programs/actions.contract.ts',
        ),
        fixture(
          'apps/web/app/programs/actions.registry.ts',
          "import { a } from './actions';",
          'module: apps/web/app/programs/actions.ts',
        ),
        fixture(
          C,
          "import { a } from '@/app/p/[profileId]/row-actions';",
          'module: apps/web/app/p/[profileId]/row-actions.ts',
        ),
        fixture(DAY_PAGE, "import { a } from './row-actions';"),
        // Its registry is not an importer either (lane C, #785).
        fixture(
          'apps/web/app/p/[profileId]/row-actions.registry.ts',
          "import { a } from './row-actions';",
          'module: apps/web/app/p/[profileId]/row-actions.ts',
        ),
      ],
      "a 'use client' file reaches neither the package nor the program DAL": [
        ...[
          "'use client';\n",
          "// a comment\n/* another */\n'use client';\n",
          '\'use strict\'\n"use client"\n',
        ].map((prologue) =>
          fixture(
            C,
            `${prologue}import { g } from '@/lib/dal/program/reads';`,
            'client: apps/web/lib/dal/program/reads.ts',
          ),
        ),
        fixture(C, "'use client';\nimport { schema } from '@mat-plan/db';", `client: ${DB_INDEX}`),
        fixture(C, "import { g } from '@/lib/dal/program/reads';\n'use client';"),
        fixture(C, "const s = 'use client';\nimport { g } from '@/lib/dal/program/reads';"),
        fixture(C, "'use client';\nimport { g } from '@/lib/dal/day/day';"),
      ],
      'a non-test file reaches no test file': [
        fixture(
          C,
          "import { a } from '@/app/programs/actions.test';",
          'test file: apps/web/app/programs/actions.test.ts',
        ),
        fixture(
          C,
          "import { a } from '@/../../packages/shared/src/units.test';",
          'test file: packages/shared/src/units.test.ts',
        ),
        fixture(
          C,
          "import { code } from '@/test/source-scan';",
          'test helper: apps/web/test/source-scan.ts',
        ),
        fixture('apps/web/test/x.ts', "import { code } from './source-scan';"),
      ],
    };

    describe('names are keyed by origin (fixtures)', () => {
      const DAY_BARREL = 'packages/db/src/writers/day/index.ts';
      const dayBarrel = readFileSync(join(REPO_DIR, DAY_BARREL), 'utf8');
      /** The package as if `writers/day/index.ts` also held `line`. */
      const withDay = (line: string) => publish({ [DAY_BARREL]: `${dayBarrel}\n${line}` });
      it.each([
        [
          "export { saveWorkout as persistWorkout } from '../program';",
          'persistWorkout',
          C,
          [`name: persistWorkout → ${ONLY_PROGRAM}`],
        ],
        [
          "export { saveWorkout as persistWorkout } from '../program';",
          'persistWorkout',
          PROGRAM_X,
          [],
        ],
        [
          "export { insertWorkoutOwnedBy as insertW } from '../ownership';",
          'insertW',
          PROGRAM_X,
          ['name: insertW → nowhere'],
        ],
        [
          "export { readLiveSets as liveSets } from '../../queries/live-sets';",
          'liveSets',
          C,
          [`name: liveSets → only ${ENTRIES_DAL}`],
        ],
        ["export { lost } from './nope';", 'lost', C, ['untraceable name: lost']],
      ])('%s, then %s imported', (line, name, at, want) => {
        const names = withDay(line);
        const text = `import { ${name} } from '@mat-plan/db';\n${name}(x);`;
        expect(
          violations(at, text, webLanding(), names).map((x) => `${x.rule}: ${x.detail}`),
        ).toEqual(want);
      });

      it('a renamed lane P writer is still only ever called in the program DAL', () => {
        const names = withDay("export { saveWorkout as persistWorkout } from '../program';");
        // Traced past the barrel it was re-published from, to the file that defines it.
        expect(names.get('persistWorkout')).toEqual({
          file: 'packages/db/src/writers/program/save-workout.ts',
          name: 'saveWorkout',
        });
        const text =
          "import { persistWorkout } from '@mat-plan/db';\nexport const api = { persistWorkout };";
        expect(violations(PROGRAM_X, text, webLanding(), names).map((x) => x.rule)).toEqual([
          'not a direct call',
        ]);
      });

      const P_IMPORT = "import { saveWorkout } from '../program';\n";
      const P_NS = "import * as P from '../program';\n";
      const INDEX_TEXT = readFileSync(join(REPO_DIR, DB_INDEX), 'utf8');
      const UNTRACEABLE = (name: string) => [`untraceable name: ${name}`];
      it.each([
        // A value alias is the value it aliases (security review of #790, P1-1).
        [
          'day',
          `${P_IMPORT}export const persist = saveWorkout;`,
          'persist',
          [`name: persist → ${ONLY_PROGRAM}`],
        ],
        [
          'day',
          `${P_IMPORT}export const persist = saveWorkout.bind(null);`,
          'persist',
          [`name: persist → ${ONLY_PROGRAM}`],
        ],
        [
          'day',
          `${P_IMPORT}const p2 = saveWorkout;\nexport { p2 as persist };`,
          'persist',
          [`name: persist → ${ONLY_PROGRAM}`],
        ],
        [
          'index',
          "import { saveWorkout as s9 } from './writers/program';\nexport const persist = s9;",
          'persist',
          [`name: persist → ${ONLY_PROGRAM}`],
        ],
        [
          'day',
          `${P_NS}export const persist = P.saveWorkout;`,
          'persist',
          [`name: persist → ${ONLY_PROGRAM}`],
        ],
        // Forms a name-only walk never published (P1-2): traced, or absent and so untraceable.
        [
          'day',
          `${P_NS}export const { saveWorkout: persist } = P;`,
          'persist',
          [`name: persist → ${ONLY_PROGRAM}`],
        ],
        [
          'day',
          `${P_NS}export import persist = P.saveWorkout;`,
          'persist',
          [`name: persist → ${ONLY_PROGRAM}`],
        ],
        ['day', `${P_IMPORT}export const tools = { saveWorkout };`, 'tools', UNTRACEABLE('tools')],
        // A namespace holding a restricted name is refused everywhere (P1-3).
        ['index', "export * as dayNs from './writers/day';", 'dayNs', UNTRACEABLE('dayNs')],
        ['index', "export * as ownNs from './writers/ownership';", 'ownNs', UNTRACEABLE('ownNs')],
      ] as const)('%s: %s, then %s imported by a component', (where, line, name, want) => {
        const names =
          where === 'day' ? withDay(line) : publish({ [DB_INDEX]: `${INDEX_TEXT}\n${line}` });
        const text = `import { ${name} } from '@mat-plan/db';\n${name}.call(x);`;
        expect(
          violations(C, text, webLanding(), names).map((x) => `${x.rule}: ${x.detail}`),
        ).toEqual(want);
      });

      it('a name the walk did not publish is untraceable', () => {
        expect(restriction('notPublished', published())).toBe('untraceable');
      });

      it('the walk publishes exactly the names the TypeScript checker sees', () => {
        const file = join(REPO_DIR, DB_INDEX);
        const program = ts.createProgram({
          rootNames: [file],
          options: { ...compilerOptionsOf(join(REPO_DIR, 'packages/db')), noEmit: true },
        });
        const checker = program.getTypeChecker();
        const entry = checker.getSymbolAtLocation(program.getSourceFile(file)!)!;
        const names = checker.getExportsOfModule(entry).map((x) => x.name);
        expect([...published().keys()].sort()).toEqual(names.sort());
      });

      it('two export * chains publishing one name from different origins: untraceable', () => {
        const names = publish({
          [DAY_BARREL]: `${dayBarrel}\nexport const saveWorkout = 1;`,
        });
        expect(names.get('saveWorkout')).toBeNull();
      });
    });

    describe.each(Object.keys(ROWS))('%s (fixtures)', (group) => {
      it.each(ROWS[group]!)('$text @ $at', ({ at, text, want }) => {
        expect(found(at, text)).toEqual(want);
      });
    });

    it('an apps/web file outside the domain and its assets is refused (fixture)', () => {
      const text = "import { g } from '@/lib/dal/day/day';";
      expect(violations(C, text).map(message)).toEqual([]);
      expect(violations(C, text, new Set()).map((x) => `${x.rule}: ${x.detail}`)).toEqual([
        'outside the domain: apps/web/lib/dal/day/day.ts',
      ]);
    });

    it('a miscased specifier: the package on a case-insensitive filesystem, else unresolved (U1)', () => {
      expect(found(C, "import { saveWorkout } from '@mat-plan/DB';")).toEqual(
        CASE_INSENSITIVE ? [NAME_SAVE] : ["unresolved first-party: '@mat-plan/DB'"],
      );
      expect(found(C, "import { a } from '@/App/Programs/actions';")).toEqual(
        CASE_INSENSITIVE
          ? ['module: apps/web/app/programs/actions.ts']
          : ["unresolved first-party: '@/App/Programs/actions'"],
      );
    });

    describe('the real files the pins rest on (non-vacuity)', () => {
      it("the program DAL's reads, read as a component, are refused by name", () => {
        const text = readFileSync(join(REPO_DIR, `${PROGRAM_DAL}reads.ts`), 'utf8');
        // Its relative imports do not resolve from the component's directory: those fail closed,
        // and every other violation is a lane P name.
        const hits = violations(C, text).filter((h) => !/^'\.\.?\//.test(h.detail));
        expect(new Set(hits.map((h) => h.rule))).toEqual(new Set(['name']));
        expect(hits.length).toBeGreaterThanOrEqual(5);
      });

      it.each([
        'apps/web/app/programs/page.tsx',
        'apps/web/app/programs/[programId]/page.tsx',
        'apps/web/app/programs/[programId]/workouts/[workoutId]/page.tsx',
        'apps/web/app/programs/[programId]/workouts/new/page.tsx',
      ])('%s imports the actions contract, and is clean', (page) => {
        expect(importsOf(join(REPO_DIR, page)).imports.map((i) => i.resolved)).toContain(
          'apps/web/app/programs/actions.contract.ts',
        );
        expect(violations(page).map(message)).toEqual([]);
      });

      it('the builder screen is a client file', () => {
        expect(
          importsOf(join(REPO_DIR, 'apps/web/components/program-builder/program-screen.tsx'))
            .client,
        ).toBe(true);
      });

      it('the day DAL imports its names from the package, and is clean', () => {
        const file = `${DAY_DAL}day.ts`;
        const ref = importsOf(join(REPO_DIR, file)).imports.find((i) => i.resolved === DB_INDEX);
        expect(ref?.names).toEqual(expect.arrayContaining(['logRow', 'resolveDayPlan']));
        expect(violations(file).map(message)).toEqual([]);
      });

      it('entries.ts imports readLiveSets from the package, and is clean', () => {
        const ref = importsOf(join(REPO_DIR, ENTRIES_DAL)).imports.find((i) =>
          i.names.includes('readLiveSets'),
        );
        expect(ref?.resolved).toBe(DB_INDEX);
        expect(violations(ENTRIES_DAL).map(message)).toEqual([]);
      });

      it("the day page's ./row-actions is the module, and its only non-test importer", () => {
        const row = 'apps/web/app/p/[profileId]/row-actions.ts';
        expect(
          importsOf(join(REPO_DIR, DAY_PAGE)).imports.find((i) => i.spec === './row-actions')
            ?.resolved,
        ).toBe(row);
        const importers = webDomain().filter((f) =>
          importsOf(join(REPO_DIR, f)).imports.some((i) => i.resolved === row),
        );
        expect(importers).toEqual([DAY_PAGE]);
      });
    });
  },
);
