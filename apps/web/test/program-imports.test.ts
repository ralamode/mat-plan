import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
  barrelNames,
  compilerOptionsOf,
  importsOf,
  REPO_DIR,
  unwrapExpression,
  type ImportKind,
  type ImportRef,
} from './source-scan';

/**
 * 🔴 **Who may import what from `@mat-plan/db` and the action modules, checked on the resolved
 * import graph** (docs/plans/td-program-tables-import-graph.md). One guard for the import pins that
 * `program-tables-stay-dark.test.ts`, `lib/dal/day/importers.test.ts` and `lib/dal/entries.test.ts`
 * held as regexes on specifier text.
 *
 * Every specifier is resolved the way the compiler resolves it (`importsOf`, `test/source-scan.ts`),
 * so a pin compares FILES: a comment in the braces, a backtick, `require (`, a dot segment
 * (`@mat-plan/./db`), a path through `node_modules` or an `@/` walking out of `apps/web` all land on
 * the same file and get the same answer. A first-party specifier that does not resolve fails closed.
 *
 * - **The pins:** `apps/web` reaches `packages/db` only through its entry; the entry publishes nothing
 *   from `erasure/`; each name in `ALLOWED_IN` is imported only where it lists; no whole-package form
 *   (`import * as`, `export *`, `import()`, `require`, `typeof import`); neither DAL re-exports a lane
 *   P name; each module in `MODULES` has only its listed importers; no `'use client'` file reaches
 *   the package or the program DAL; no non-test file reaches a test file; `packages/shared` and
 *   `packages/engine` do not reach `packages/db`.
 * - **The premises** the resolver's answer rests on (the alias, the resolution options, the
 *   manifests' `exports`/`imports`, `next.config`'s bundler keys) are assertions: if one breaks, the
 *   resolver may disagree with the bundler, and this file says so.
 * - ⚠️ **Not covered** (docs/tech-debt.md, "The import pins hold names by barrel and by direct
 *   import, not by origin"): a lane P writer re-published by another `packages/db` module under a new
 *   name, and a DAL passing one on through a local binding (`export { s }` of an aliased import, an
 *   object literal, `cache(x)`).
 *
 * **Scoped** (D7): CI and pre-push skip it only when `.github/scripts/changed-scopes.mjs`'s
 * `importPinsInScope` finds no changed file it reads (`RUN_IMPORT_PINS=false`). Anything else runs it,
 * and every run on `main` does.
 */

/** The package's one entry: `packages/db/package.json`'s `exports['.']`, pinned below. */
const DB_INDEX = 'packages/db/src/index.ts';
const DB_DIR = 'packages/db/';
const ERASURE = 'packages/db/src/erasure/';
const LANE_P_BARRELS = [
  'packages/db/src/writers/program/index.ts',
  'packages/db/src/queries/program/index.ts',
] as const;
const PROGRAM_DAL = 'apps/web/lib/dal/program/';
const DAY_DAL = 'apps/web/lib/dal/day/';
const ENTRIES_DAL = 'apps/web/lib/dal/entries.ts';
const WEB_TEST = 'apps/web/test/';
const DAY_PAGE = 'apps/web/app/p/[profileId]/page.tsx';

const CODE = /\.[cm]?[jt]sx?$/;
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;
/** A path segment that is exactly one of these is not source. */
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
  prescriptionLiveIn: [DAY_DAL],
  readLiveSets: [ENTRIES_DAL],
  insertProgramBlockOwnedBy: [],
  insertWorkoutOwnedBy: [],
  programBlockByClientId: [],
  liveTemplateBlockIn: [],
};

/**
 * Each name, and where in `apps/web` it may be imported from `@mat-plan/db`: a directory (ending
 * `/`) or one file. The one home of every allowance. A `Map`, so a name such as `constructor` cannot
 * hit the prototype.
 */
const ALLOWED_IN = new Map<string, readonly string[]>([
  ...LANE_P.map((n) => [n, [PROGRAM_DAL]] as const),
  ...Object.entries(OVERRIDES),
]);

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
      /^apps\/web\/app\/programs\/actions(?:\.registry|\.contract)?\.ts$/.test(f),
  },
  {
    files: ['apps/web/app/p/[profileId]/row-actions.ts'],
    may: (f) => f === DAY_PAGE || f === 'apps/web/app/p/[profileId]/row-actions.registry.ts',
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

type Violation = { file: string; line: number; rule: string; detail: string };
const message = (v: Violation) => `${v.file}:${v.line} ${v.rule}: ${v.detail}`;
const within = (file: string, where: string) =>
  where.endsWith('/') ? file.startsWith(where) : file === where;

const tracked = (...paths: string[]) =>
  execFileSync('git', ['ls-files', '-z', '--', ...paths], { cwd: REPO_DIR, encoding: 'utf8' })
    .split('\0')
    .filter((f) => f && CODE.test(f) && !NOT_SOURCE.test(f));

/** The scan's domain: every tracked non-test code file under `apps/web`. */
const webDomain = () => tracked('apps/web').filter((f) => !TEST_FILE.test(f));

/** `export { x }`, `export const v = x` (unwrapped, `.bind` too) and `export default x` of a name. */
function reexportsOf(sf: ts.SourceFile, names: readonly string[]) {
  const hits: { line: number; name: string }[] = [];
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const bound = (e: ts.Expression): ts.Expression => {
    for (;;) {
      e = unwrapExpression(e);
      if (
        ts.isCallExpression(e) &&
        ts.isPropertyAccessExpression(e.expression) &&
        e.expression.name.text === 'bind'
      )
        e = e.expression.expression;
      else return e;
    }
  };
  const hit = (n: ts.Node, name: string) =>
    names.includes(name) && hits.push({ line: lineOf(n), name });
  for (const st of sf.statements) {
    if (ts.isExportDeclaration(st) && st.exportClause && ts.isNamedExports(st.exportClause))
      for (const e of st.exportClause.elements) hit(e, (e.propertyName ?? e.name).text);
    else if (
      ts.isVariableStatement(st) &&
      st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    )
      for (const d of st.declarationList.declarations) {
        const x = d.initializer && bound(d.initializer);
        if (x && ts.isIdentifier(x)) hit(d, x.text);
      }
    else if (ts.isExportAssignment(st)) {
      const x = bound(st.expression);
      if (ts.isIdentifier(x)) hit(st, x.text);
    }
  }
  return hits;
}

/** Every pin, for one `apps/web` file (repo-relative), read from disk or from `text`. */
function violations(file: string, text?: string): Violation[] {
  const { imports, unresolved, unfollowable, client, sf } = importsOf(join(REPO_DIR, file), text);
  const out: Violation[] = [];
  const v = (line: number, rule: string, detail: string) => out.push({ file, line, rule, detail });
  for (const u of unresolved)
    v(u.line, 'unresolved first-party', u.spec === null ? `computed ${u.text}` : `'${u.spec}'`);
  for (const u of unfollowable) v(u.line, 'unfollowable', u.detail);
  for (const i of imports) {
    const r = i.resolved;
    if (r === null) continue;
    if (r.startsWith(DB_DIR) && r !== DB_INDEX) v(i.line, 'deep packages/db', r);
    if (r === DB_INDEX) {
      if (WHOLE_PACKAGE.has(i.kind)) v(i.line, 'whole-package', i.kind);
      else
        for (const n of i.names) {
          const where = ALLOWED_IN.get(n);
          if (where && !where.some((w) => within(file, w)))
            v(i.line, 'name', `${n} → ${where.length ? `only ${where.join(', ')}` : 'nowhere'}`);
        }
    }
    if (client && (r.startsWith(DB_DIR) || r.startsWith(PROGRAM_DAL))) v(i.line, 'client', r);
    for (const m of MODULES) if (m.files.includes(r) && !m.may(file)) v(i.line, 'module', r);
    if (TEST_FILE.test(r)) v(i.line, 'test file', r);
    else if (r.startsWith(WEB_TEST) && !file.startsWith(WEB_TEST)) v(i.line, 'test helper', r);
  }
  if (within(file, PROGRAM_DAL) || within(file, DAY_DAL))
    for (const h of reexportsOf(sf, LANE_P)) v(h.line, 're-export', h.name);
  return out;
}

/** The rule and detail of each violation: what a fixture asserts (D6). */
const found = (file: string, text: string) =>
  violations(file, text).map((x) => `${x.rule}: ${x.detail}`);

/** A packages/shared or packages/engine file: it reaches no `packages/db` file, and resolves. */
function packageViolations(file: string, text?: string): string[] {
  const { imports, unresolved, unfollowable } = importsOf(join(REPO_DIR, file), text);
  return [
    ...unresolved.map((u) => `${file}:${u.line} unresolved first-party: ${u.spec ?? u.text}`),
    ...unfollowable.map((u) => `${file}:${u.line} unfollowable: ${u.detail}`),
    ...imports
      .filter((i) => i.resolved?.startsWith(DB_DIR))
      .map((i) => `${file}:${i.line} packages/db: ${i.resolved}`),
  ];
}

/** An edge that exists at run time: not `import type`, `export type … from` or `typeof import`. */
const isRuntimeEdge = (i: ImportRef) => !i.typeOnly && i.kind !== 'type';

/** `index.ts`'s runtime import closure inside `packages/db/src/`, and what it could not follow. */
function dbClosure() {
  const seen = new Set<string>();
  const stack = [DB_INDEX];
  const intoErasure: string[] = [];
  const blind: string[] = [];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const { imports, unresolved, unfollowable } = importsOf(join(REPO_DIR, file));
    blind.push(
      ...unresolved.map((u) => `${file}:${u.line} ${u.spec ?? u.text}`),
      ...unfollowable.map((u) => `${file}:${u.line} ${u.detail}`),
    );
    for (const i of imports) {
      if (!i.resolved?.startsWith('packages/db/src/') || !isRuntimeEdge(i)) continue;
      if (i.resolved.startsWith(ERASURE)) intoErasure.push(`${file}:${i.line} → ${i.resolved}`);
      stack.push(i.resolved);
    }
  }
  return { seen, intoErasure, blind };
}

let treeScan: Violation[] | undefined;
/** The whole domain's violations, computed once and only by a test that runs. */
const tree = () => (treeScan ??= webDomain().flatMap((f) => violations(f)));
const isException = (x: Violation) =>
  x.file === EXCEPTION.file && x.rule === EXCEPTION.rule && x.detail === EXCEPTION.detail;

const C = 'apps/web/components/program-builder/x.tsx';
const PROGRAM_X = `${PROGRAM_DAL}x.ts`;
const DAY_X = `${DAY_DAL}x.ts`;
const ONLY_PROGRAM = `only ${PROGRAM_DAL}`;
const ONLY_DAY = `only ${DAY_DAL}`;
/** U1: on a case-insensitive filesystem (macOS) a miscased specifier resolves; on Linux it does not. */
const CASE_INSENSITIVE = !ts.sys.useCaseSensitiveFileNames;

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

      it('next.config.ts configures no bundler alias', () => {
        const file = join(REPO_DIR, 'apps/web/next.config.ts');
        const sf = ts.createSourceFile(
          file,
          readFileSync(file, 'utf8'),
          ts.ScriptTarget.Latest,
          true,
        );
        const keys: string[] = [];
        const walk = (n: ts.Node): void => {
          if (
            (ts.isPropertyAssignment(n) ||
              ts.isShorthandPropertyAssignment(n) ||
              ts.isMethodDeclaration(n)) &&
            /^['"]?(?:webpack|turbopack|resolveAlias|alias)['"]?$/.test(n.name.getText(sf))
          )
            keys.push(n.name.getText(sf));
          ts.forEachChild(n, walk);
        };
        walk(sf);
        expect(keys, BUNDLER_MAY_DISAGREE).toEqual([]);
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
      it('scans a real tree', () => {
        expect(webDomain().length).toBeGreaterThan(200);
      });

      it('apps/web is clean, apart from the one reviewed computed import', () => {
        const all = tree();
        expect(all.filter((x) => !isException(x)).map(message)).toEqual([]);
        expect(
          all.filter(isException),
          'the exception is keyed on file, text and count',
        ).toHaveLength(1);
      });

      it('packages/shared and packages/engine reach no packages/db file', () => {
        // Tests excluded: nothing may import one (the "no non-test file reaches a test file" row).
        const files = tracked('packages/shared/src', 'packages/engine/src').filter(
          (f) => !TEST_FILE.test(f),
        );
        expect(files.length).toBeGreaterThan(50);
        expect(files.flatMap((f) => packageViolations(f))).toEqual([]);
        expect(
          packageViolations('packages/shared/src/x.ts', "import { db } from '../../db/src/index';"),
        ).toEqual(['packages/shared/src/x.ts:1 packages/db: packages/db/src/index.ts']);
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

      it('a type-only import is no edge; a value import is (fixtures and the real one)', () => {
        const file = join(REPO_DIR, 'packages/db/src/queries/movement-ownership.ts');
        const real = importsOf(file).imports.find((i) => i.resolved === `${ERASURE}graph.ts`);
        expect(real?.line).toBe(3);
        expect(isRuntimeEdge(real!)).toBe(false);
        const value = importsOf(file, "import { IdIn } from '../erasure/graph';").imports[0]!;
        expect(value.resolved).toBe(`${ERASURE}graph.ts`);
        expect(isRuntimeEdge(value)).toBe(true);
      });
    });

    describe('every spelling lands on the file it names (fixtures, § Probes)', () => {
      it.each([
        '@mat-plan/db',
        '@mat-plan/./db',
        '@mat-plan/x/../db',
        '@mat-plan//db',
        '@mat-plan/db/',
        '../../node_modules/@mat-plan/db',
        '@/../../packages/db/src',
      ])("'%s' is the package: its names are checked", (spec) => {
        expect(found(C, `import { saveWorkout } from '${spec}';`)).toEqual([
          `name: saveWorkout → ${ONLY_PROGRAM}`,
        ]);
      });

      it.each([
        '@mat-plan/./db/src/erasure/graph',
        '../../node_modules/@mat-plan/db/src/erasure/graph',
        '@/../../packages/./db/src/erasure/graph',
      ])("'%s' is a deep packages/db import", (spec) => {
        expect(found(C, `import { x } from '${spec}';`)).toEqual([
          `deep packages/db: ${ERASURE}graph.ts`,
        ]);
      });

      it.each([
        '@mat-plan/db/.',
        '@mat-plan/db/src/erasure/graph',
        '#internal/x',
        './nope',
        './nope.css',
      ])("'%s' does not resolve: fail closed", (spec) => {
        expect(found(C, `import { x } from '${spec}';`)).toEqual([
          `unresolved first-party: '${spec}'`,
        ]);
      });

      it('a miscased specifier: the package on a case-insensitive filesystem, else unresolved (U1)', () => {
        expect(found(C, "import { saveWorkout } from '@mat-plan/DB';")).toEqual(
          CASE_INSENSITIVE
            ? [`name: saveWorkout → ${ONLY_PROGRAM}`]
            : ["unresolved first-party: '@mat-plan/DB'"],
        );
        expect(found(C, "import { a } from '@/App/Programs/actions';")).toEqual(
          CASE_INSENSITIVE
            ? ['module: apps/web/app/programs/actions.ts']
            : ["unresolved first-party: '@/App/Programs/actions'"],
        );
      });

      it.each([
        'import { saveWorkout } from `@mat-plan/db`;',
        "import { /* a */ saveWorkout /* b */ } from /* c */ '@mat-plan/db';",
        "import {\n  // a\n  saveWorkout,\n} from '@mat-plan/db';",
        "import { 'saveWorkout' as s } from '@mat-plan/db';",
        "export { saveWorkout } from '@mat-plan/db';",
      ])('%s: names checked', (text) => {
        expect(found(C, text)).toEqual([expect.stringMatching(/^name: saveWorkout → /)]);
      });

      it.each([
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
      ])('%s: whole-package %s, everywhere, the DALs included', (text, kind) => {
        expect(found(C, text)).toEqual([`whole-package: ${kind}`]);
        expect(found(PROGRAM_X, text)).toEqual([`whole-package: ${kind}`]);
      });

      it("(require)('…erasure/graph') is resolved like require", () => {
        expect(found(C, "const g = (require)('@mat-plan/./db/src/erasure/graph');")).toEqual([
          `deep packages/db: ${ERASURE}graph.ts`,
        ]);
      });

      it('a computed import fails closed', () => {
        expect(found(C, 'const m = await import(p);')).toEqual([
          'unresolved first-party: computed import(p)',
        ]);
      });
    });

    describe('a loader the graph cannot follow is refused (fixtures)', () => {
      it.each([
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
      ])('%s', (text, detail) => {
        expect(found(C, text)).toEqual([`unfollowable: ${detail}`]);
      });

      it('createRequire, named or through the default import', () => {
        expect(found(C, "import { createRequire } from 'node:module';")).toEqual([
          'unfollowable: createRequire',
        ]);
        expect(found(C, "import mod from 'node:module';\nconst r = mod.createRequire(x);")).toEqual(
          ['unfollowable: createRequire'],
        );
      });

      it('a property or method named require is not a loader', () => {
        expect(
          found(C, 'const o = { require: 1 };\no.require;\nclass K {\n  require() {}\n}'),
        ).toEqual([]);
      });
    });

    describe('ALLOWED_IN: each name, only where it lists (fixtures)', () => {
      it('the day DAL: its own names and workoutInHousehold, and nothing else of lane P', () => {
        expect(found(DAY_X, "import { workoutInHousehold, logRow } from '@mat-plan/db';")).toEqual(
          [],
        );
        expect(
          found(DAY_X, "import { workoutInHousehold, saveWorkout } from '@mat-plan/db';"),
        ).toEqual([`name: saveWorkout → ${ONLY_PROGRAM}`]);
      });

      it("the program DAL: lane P's names, not the day's, and no ownership helper", () => {
        expect(
          found(PROGRAM_X, "import { workoutInHousehold, saveWorkout } from '@mat-plan/db';"),
        ).toEqual([]);
        expect(found(PROGRAM_X, "import { resolveDayPlan } from '@mat-plan/db';")).toEqual([
          `name: resolveDayPlan → ${ONLY_DAY}`,
        ]);
        expect(found(PROGRAM_X, "import { liveTemplateBlockIn } from '@mat-plan/db';")).toEqual([
          'name: liveTemplateBlockIn → nowhere',
        ]);
      });

      it('a sibling directory is not the DAL; readLiveSets is entries.ts alone', () => {
        expect(
          found('apps/web/lib/dal/dayx/x.ts', "import { workoutInHousehold } from '@mat-plan/db';"),
        ).toEqual([`name: workoutInHousehold → only ${PROGRAM_DAL}, ${DAY_DAL}`]);
        expect(found(C, "import { readLiveSets } from '@mat-plan/./db';")).toEqual([
          `name: readLiveSets → only ${ENTRIES_DAL}`,
        ]);
        expect(found(ENTRIES_DAL, "import { readLiveSets } from '@mat-plan/db';")).toEqual([]);
      });

      it('a type counts; an unlisted name is free', () => {
        expect(found(C, "import type { MovementOption } from '@mat-plan/db';")).toEqual([
          `name: MovementOption → ${ONLY_PROGRAM}`,
        ]);
        expect(found(C, "import { db, profiles } from '@mat-plan/db';")).toEqual([]);
      });
    });

    describe('neither DAL re-exports a lane P name (fixtures)', () => {
      const IMPORT = "import { workoutInHousehold } from '@mat-plan/db';\n";
      it.each([
        "export { workoutInHousehold as 'isOurs' };",
        'export { workoutInHousehold as isOurs };',
        'export const a = workoutInHousehold as typeof workoutInHousehold;',
        'export const a = workoutInHousehold.bind(null);',
        'export const a = workoutInHousehold!;',
        'export default workoutInHousehold;',
      ])('%s', (text) => {
        expect(found(DAY_X, IMPORT + text)).toEqual(['re-export: workoutInHousehold']);
      });

      it('from the package too; a wrapper call is not unwrapped', () => {
        expect(found(DAY_X, "export { workoutInHousehold } from '@mat-plan/db';")).toEqual([
          're-export: workoutInHousehold',
        ]);
        expect(
          found(
            PROGRAM_X,
            "import { readWorkoutDraft } from '@mat-plan/db';\nexport const getX = cache(readWorkoutDraft);",
          ),
        ).toEqual([]);
      });
    });

    describe('MODULES: only the listed importers (fixtures)', () => {
      it.each([
        ["import { a } from '@/app/programs/actions';", 'actions.ts'],
        ["import { a } from '@/../web/app/programs/actions';", 'actions.ts'],
        ["import { a } from '@/./lib/../app/programs/actions.contract';", 'actions.contract.ts'],
        ["import { a } from '../../app/programs/actions.ts';", 'actions.ts'],
        ["import '../../app/programs/actions';", 'actions.ts'],
      ])('%s from a component', (text, target) => {
        expect(found(C, text)).toEqual([`module: apps/web/app/programs/${target}`]);
      });

      it('a page under app/programs/ may; the layout may not', () => {
        expect(
          found(
            'apps/web/app/programs/[programId]/page.tsx',
            "import { P } from '../actions.contract';",
          ),
        ).toEqual([]);
        expect(
          found('apps/web/app/programs/layout.tsx', "import { P } from './actions.contract';"),
        ).toEqual(['module: apps/web/app/programs/actions.contract.ts']);
      });

      it('the row actions: the day page only', () => {
        expect(found(C, "import { a } from '@/app/p/[profileId]/row-actions';")).toEqual([
          'module: apps/web/app/p/[profileId]/row-actions.ts',
        ]);
        expect(found(DAY_PAGE, "import { a } from './row-actions';")).toEqual([]);
      });
    });

    describe("a 'use client' file reaches neither the package nor the program DAL (fixtures)", () => {
      const READS = "import { g } from '@/lib/dal/program/reads';";
      it.each([
        `'use client';\n${READS}`,
        `// a comment\n/* another */\n'use client';\n${READS}`,
        `'use strict'\n"use client"\n${READS}`,
      ])('%s', (text) => {
        expect(found(C, text)).toEqual(['client: apps/web/lib/dal/program/reads.ts']);
      });

      it('the package, from a client file', () => {
        expect(found(C, "'use client';\nimport { db } from '@mat-plan/db';")).toEqual([
          `client: ${DB_INDEX}`,
        ]);
      });

      it.each([
        `${READS}\n'use client';`,
        `const s = 'use client';\n${READS}`,
        `'use client';\nimport { g } from '@/lib/dal/day/day';`,
      ])('not a client import of the program DAL: %s', (text) => {
        expect(found(C, text)).toEqual([]);
      });
    });

    describe('a non-test file reaches no test file (fixtures)', () => {
      it('a *.test.* file, or apps/web/test/ from outside it', () => {
        expect(found(C, "import { a } from '@/app/programs/actions.test';")).toEqual([
          'test file: apps/web/app/programs/actions.test.ts',
        ]);
        expect(found(C, "import { code } from '@/test/source-scan';")).toEqual([
          'test helper: apps/web/test/source-scan.ts',
        ]);
        expect(found('apps/web/test/x.ts', "import { code } from './source-scan';")).toEqual([]);
      });
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
