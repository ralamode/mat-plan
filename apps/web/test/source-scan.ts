import { globSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, extname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

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
 * **Glob-based on purpose.** `use-server-exports.test.ts` had a hand-rolled `readdirSync` recursion,
 * the only copy, while the guards this supports use `globSync` — promoting the recursion would have
 * added a third enumeration idiom to the repo rather than remove one. ✅ That file reads
 * `serverActionModules()` since FAM-1 step 0b, so this is the one enumeration.
 *
 * ⚠️ **Rooted at `apps/web`, not `apps/web/app`.** A `'use server'` module under `components/` or
 * `lib/` is a real Server Action and a real public endpoint, and the pre-existing guards rooted at
 * `app/` cannot see one. Today every such module is under `app/`, which is the only time widening the
 * domain costs nothing.
 */
export function appSources(): string[] {
  // ⚠️ **Not just `{ts,tsx}`.** Next's default `pageExtensions` is `['tsx','ts','jsx','js']` (read
  // from the pinned `next/dist/server/config-shared.js`), so `app/x/page.js` is a real route and
  // `lib/foo.js` really bundles — and every guard built on this helper was blind to both. That was
  // cosmetic while these guards policed conventions; AUTH-1 1c-3a made one of them contain an
  // **authentication bypass**, where a `.js` file reading `process.env` directly would skip the
  // containment AND the boot refusal, because it need not import `lib/env.ts` at all.
  // Widening is free today: the only non-TS sources under `apps/web` are two config `.mjs` files.
  return globSync('**/*.{ts,tsx,js,jsx,mjs,cjs}', { cwd: WEB_DIR })
    .filter((f) => !/(^|\/)(node_modules|\.next)\//.test(f))
    .filter((f) => !/\.test\.[jt]sx?$/.test(f))
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

/**
 * Each exported action with its own source: from its declaration to the next exported action's (or
 * EOF), comments stripped. A guard that looks inside one action's slice cannot be satisfied by a
 * call that sits in another action.
 *
 * Hoisted from `pages-need-a-session.test.ts` at FAM-1 step 0b, when the row-policy pin in
 * `mutating-actions.test.ts` became the second guard that needs it.
 * ⚠️ The LAST action's slice runs to the end of the file, so it includes any private helper declared
 * after it. That over-matches for a presence guard and for a "who names this" pin alike, which is
 * the safe direction for both.
 */
export function exportedActionSlices(file: string): { name: string; body: string }[] {
  const src = code(file);
  const starts = exportedActionNames(file).map((name) => ({
    name,
    at: src.search(new RegExp(`^export\\s+async\\s+function\\s+${name}\\b`, 'm')),
  }));
  return starts.map(({ name, at }, i) => ({
    name,
    body: src.slice(at, starts[i + 1]?.at ?? src.length),
  }));
}

// ── The TypeScript import graph (docs/plans/td-program-tables-import-graph.md, D2 and D4) ──────────
//
// The helpers above match text. These ask the compiler: which file does each specifier resolve to?
// An import pin built on them compares resolved files, so a spelling (a comment in the braces, a
// backtick, `require (`, a dot segment, an `@/` walking out of `apps/web`) cannot matter.

/**
 * The repo root and `apps/web` through `realpathSync.native`, so a symlinked checkout compares like
 * for like with the resolver's answers, which go through it too.
 */
export const REPO_DIR = realpathSync.native(resolve(WEB_DIR, '../..'));
const REAL_WEB_DIR = realpathSync.native(WEB_DIR);

const parsedOptions = new Map<string, ts.CompilerOptions>();
/** A project's compiler options, read the way `tsc` reads its `tsconfig.json`. Throws if unreadable. */
export function compilerOptionsOf(projectDir: string): ts.CompilerOptions {
  const cached = parsedOptions.get(projectDir);
  if (cached) return cached;
  const parsed = ts.getParsedCommandLineOfConfigFile(
    join(projectDir, 'tsconfig.json'),
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (d) => {
        throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n'));
      },
    },
  );
  if (!parsed) throw new Error(`${projectDir}/tsconfig.json: unreadable`);
  parsedOptions.set(projectDir, parsed.options);
  return parsed.options;
}

/**
 * The options a file's own project resolves it with: `packages/db` and `packages/shared` have their
 * own tsconfig; everything else (`apps/web`, and `packages/engine`, which has none) uses `apps/web`'s.
 */
export function optionsFor(file: string): ts.CompilerOptions {
  const rel = relative(REPO_DIR, file);
  for (const pkg of ['packages/db', 'packages/shared'])
    if (rel.startsWith(`${pkg}/`)) return compilerOptionsOf(join(REPO_DIR, pkg));
  return compilerOptionsOf(REAL_WEB_DIR);
}

const CODE_EXT = /\.[cm]?[jt]sx?$/;

/**
 * The file `spec` names from `from` (absolute), repo-relative and in its true case, or `null`.
 * `ts.resolveModuleName` decides, from an explicit project, never `process.cwd()`. One fallback: a
 * relative or `@/` specifier naming an existing NON-code file (`./globals.css`) is an asset, resolved
 * by path, because TypeScript does not resolve stylesheets.
 */
export function resolveFrom(
  spec: string,
  from: string,
  options: ts.CompilerOptions = optionsFor(from),
): string | null {
  const hit = ts.resolveModuleName(spec, from, options, ts.sys).resolvedModule;
  if (hit) return relative(REPO_DIR, realpathSync.native(hit.resolvedFileName));
  const target = spec.startsWith('@/')
    ? join(REAL_WEB_DIR, spec.slice(2))
    : spec.startsWith('.')
      ? resolve(dirname(from), spec)
      : null;
  if (!target || CODE_EXT.test(target) || !statSync(target, { throwIfNoEntry: false })?.isFile())
    return null;
  return relative(REPO_DIR, realpathSync.native(target));
}

/**
 * A specifier that is ours, so an unresolved one fails closed: relative, `@/`, `#`, `@mat-plan/`
 * (any case), or one that normalises through `node_modules` or `packages/db`. An unresolved
 * third-party specifier (`server-only`, `node:fs`) is not the graph's to judge.
 */
export const isFirstParty = (spec: string): boolean =>
  /^(?:\.|@\/|#|@mat-plan\/)/i.test(spec) ||
  /(?:^|\/)(?:node_modules|packages\/+db)(?:\/|$)/i.test(posix.normalize(spec));

export type ImportKind = 'static' | 'dynamic' | 'require' | 're-export' | 'star' | 'type';

export type ImportRef = {
  /** `null`: computed (`import(p)`). */
  spec: string | null;
  /** Repo-relative, through `realpathSync.native`; `null` when it does not resolve. */
  resolved: string | null;
  /** The names imported (`a as b` imports `a`); `'default'` for a default import. */
  names: string[];
  kind: ImportKind;
  /** `import type`, `export type … from`, or `typeof import(…)`: erased, no runtime edge. */
  typeOnly: boolean;
  line: number;
  /** The statement or call as written, comments inside it included. */
  text: string;
};

export type FileImports = {
  imports: ImportRef[];
  /** First-party refs that do not resolve, and every computed one: fail closed. */
  unresolved: ImportRef[];
  /** A loader the walk cannot follow (`require.context`, `createRequire`, …): refused. */
  unfollowable: { line: number; detail: string }[];
  /** The directive prologue holds `'use client'`. */
  client: boolean;
  sf: ts.SourceFile;
};

const SCRIPT_KIND: Record<string, ts.ScriptKind> = {
  '.ts': ts.ScriptKind.TS,
  '.mts': ts.ScriptKind.TS,
  '.cts': ts.ScriptKind.TS,
  '.tsx': ts.ScriptKind.TSX,
  '.js': ts.ScriptKind.JS,
  '.mjs': ts.ScriptKind.JS,
  '.cjs': ts.ScriptKind.JS,
  '.jsx': ts.ScriptKind.JSX,
};

/** A string literal or a no-substitution template literal is a specifier; anything else is computed. */
const literal = (n: ts.Node | undefined): string | null =>
  n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : null;

/** Through `( )`, `as`, `!`, `satisfies` and `<T>x`. */
export function unwrapExpression(e: ts.Expression): ts.Expression {
  while (
    ts.isParenthesizedExpression(e) ||
    ts.isAsExpression(e) ||
    ts.isNonNullExpression(e) ||
    ts.isSatisfiesExpression(e) ||
    ts.isTypeAssertionExpression(e)
  )
    e = e.expression;
  return e;
}

const LOADERS = new Set(['require', '__webpack_require__', '__non_webpack_require__']);

/** Is this identifier a reference, not a property name, a key or a label? */
function isReference(n: ts.Identifier): boolean {
  const p = n.parent;
  if (!p) return true;
  if (ts.isPropertyAccessExpression(p) && p.name === n) return false;
  if (ts.isQualifiedName(p) && p.right === n) return false;
  if (
    (ts.isPropertyAssignment(p) ||
      ts.isMethodDeclaration(p) ||
      ts.isPropertyDeclaration(p) ||
      ts.isPropertySignature(p) ||
      ts.isMethodSignature(p) ||
      ts.isGetAccessorDeclaration(p) ||
      ts.isSetAccessorDeclaration(p) ||
      ts.isEnumMember(p)) &&
    p.name === n
  )
    return false;
  if ((ts.isImportSpecifier(p) || ts.isExportSpecifier(p)) && p.propertyName === n) return false;
  if (ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p)) return false;
  return true;
}

const isImportMeta = (e: ts.Expression) =>
  ts.isMetaProperty(e) && e.keywordToken === ts.SyntaxKind.ImportKeyword;

/**
 * Every import a file makes, as the AST has it, each resolved (D2). `file` is absolute; `text`
 * defaults to the file's contents, so a fixture can be read as if it sat at any path.
 *
 * - **Read:** `import` (`import * as` is `star`); `export … from` (`export *` and `export * as` are
 *   `star`); `import x = require()`; `import(…)`; a call to `require`, `__webpack_require__` or
 *   `__non_webpack_require__` with a literal argument, its callee unwrapped through `( )`, `as`, `!`
 *   and `satisfies`; `typeof import(…)` (`type`).
 * - **Unfollowable:** a loader identifier anywhere but a direct callee with a literal argument
 *   (`require.resolve`, `const r = require`, `require(p)`); element access on `module` or
 *   `import.meta`; `module.require`; `import.meta.webpackContext`; any identifier `createRequire`.
 */
export function importsOf(
  file: string,
  text: string = readFileSync(file, 'utf8'),
  options: ts.CompilerOptions = optionsFor(file),
): FileImports {
  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    SCRIPT_KIND[extname(file)] ?? ts.ScriptKind.TS,
  );
  const imports: ImportRef[] = [];
  const found = new Map<string, { line: number; detail: string }>();
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const refuse = (n: ts.Node, detail: string) =>
    found.set(`${lineOf(n)} ${detail}`, { line: lineOf(n), detail });
  const add = (
    n: ts.Node,
    spec: string | null,
    kind: ImportKind,
    names: string[] = [],
    typeOnly = false,
  ) =>
    imports.push({
      spec,
      kind,
      names,
      typeOnly,
      line: lineOf(n),
      text: n.getText(sf),
      resolved: spec === null ? null : resolveFrom(spec, file, options),
    });
  /** Loader identifiers that are a direct callee with a literal argument: followed, not refused. */
  const followed = new Set<ts.Node>();

  const visit = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n)) {
      const clause = n.importClause;
      const names: string[] = [];
      let kind: ImportKind = 'static';
      if (clause?.name) names.push('default');
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) kind = 'star';
      else bindings?.elements.forEach((e) => names.push((e.propertyName ?? e.name).text));
      add(n, literal(n.moduleSpecifier), kind, names, !!clause?.isTypeOnly);
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier) {
      const clause = n.exportClause;
      if (!clause || ts.isNamespaceExport(clause))
        add(n, literal(n.moduleSpecifier), 'star', [], n.isTypeOnly);
      else
        add(
          n,
          literal(n.moduleSpecifier),
          're-export',
          clause.elements.map((e) => (e.propertyName ?? e.name).text),
          n.isTypeOnly,
        );
    } else if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference)) {
      add(n, literal(n.moduleReference.expression), 'require', [], n.isTypeOnly);
    } else if (ts.isCallExpression(n)) {
      const callee = unwrapExpression(n.expression);
      if (n.expression.kind === ts.SyntaxKind.ImportKeyword)
        add(n, literal(n.arguments[0]), 'dynamic');
      else if (
        ts.isIdentifier(callee) &&
        LOADERS.has(callee.text) &&
        literal(n.arguments[0]) !== null
      ) {
        followed.add(callee);
        add(n, literal(n.arguments[0]), 'require');
      }
    } else if (ts.isPropertyAccessExpression(n)) {
      const target = unwrapExpression(n.expression);
      if (
        (n.name.text === 'require' && ts.isIdentifier(target) && target.text === 'module') ||
        (n.name.text === 'webpackContext' && isImportMeta(target))
      )
        refuse(n, n.getText(sf));
    } else if (ts.isElementAccessExpression(n)) {
      const target = unwrapExpression(n.expression);
      if ((ts.isIdentifier(target) && target.text === 'module') || isImportMeta(target))
        refuse(n, n.getText(sf));
    } else if (ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument)) {
      add(n, literal(n.argument.literal), 'type', [], true);
    } else if (ts.isIdentifier(n) && n.text === 'createRequire') {
      refuse(n, 'createRequire');
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);

  const loaders = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && LOADERS.has(n.text) && isReference(n) && !followed.has(n)) {
      const p = n.parent;
      const onIt =
        (ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) && p.expression === n;
      refuse(onIt ? p : n, onIt ? p.getText(sf) : `${n.text} (not a direct call with a literal)`);
    }
    ts.forEachChild(n, loaders);
  };
  loaders(sf);

  const prologue: string[] = [];
  for (const st of sf.statements) {
    if (ts.isExpressionStatement(st) && ts.isStringLiteral(st.expression))
      prologue.push(st.expression.text);
    else break;
  }
  return {
    imports,
    unresolved: imports.filter(
      (i) => i.resolved === null && (i.spec === null || isFirstParty(i.spec)),
    ),
    unfollowable: [...found.values()],
    client: prologue.includes('use client'),
    sf,
  };
}

/**
 * The names an `export { … } from` barrel publishes (`a as b` publishes `b`; `type T` counts), what
 * it cannot read (any other top-level export), and its syntactic diagnostics (D4). A test asserts
 * the last two are empty rather than this throwing, so a malformed barrel fails with its statement.
 */
export function barrelNames(
  file: string,
  text: string = readFileSync(file, 'utf8'),
): { names: string[]; unreadable: string[]; diagnostics: string[] } {
  const diagnostics = (
    ts.transpileModule(text, { reportDiagnostics: true, fileName: file }).diagnostics ?? []
  ).map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '));
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const names: string[] = [];
  const unreadable: string[] = [];
  for (const st of sf.statements) {
    if (
      ts.isExportDeclaration(st) &&
      st.moduleSpecifier &&
      st.exportClause &&
      ts.isNamedExports(st.exportClause)
    )
      names.push(...st.exportClause.elements.map((e) => e.name.text));
    else if (
      ts.isExportDeclaration(st) ||
      ts.isExportAssignment(st) ||
      (ts.canHaveModifiers(st) &&
        ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword))
    )
      unreadable.push(st.getText(sf));
  }
  return { names, unreadable, diagnostics };
}
