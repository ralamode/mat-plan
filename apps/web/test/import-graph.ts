import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, extname, join, posix, relative, resolve } from 'node:path';

import ts from 'typescript';

import { WEB_DIR } from './source-scan';

/**
 * The TypeScript import graph, for the guards that pin who imports what
 * (docs/plans/td-program-tables-import-graph.md, D2 and D4; the guard is `program-imports.test.ts`).
 *
 * `source-scan.ts` matches text; this module asks the compiler which file each specifier resolves to.
 * A pin built on it compares resolved files, so a spelling (a comment in the braces, a backtick,
 * `require (`, a dot segment, an `@/` walking out of `apps/web`) cannot matter. Its own module, so the
 * tests that import `source-scan.ts` do not load `typescript`.
 */

/**
 * The repo root and `apps/web` through `realpathSync.native`, so a symlinked checkout compares like
 * for like with the resolver's answers, which go through it too.
 */
export const REPO_DIR = realpathSync.native(resolve(WEB_DIR, '../..'));
const REAL_WEB_DIR = realpathSync.native(WEB_DIR);

/** A code file, by extension: what the guards scan and what the asset fallback never resolves. */
export const CODE_EXT = /\.[cm]?[jt]sx?$/;
/**
 * The non-code files a relative or `@/` specifier may name, by path: the extensions `apps/web`
 * tracks today. TypeScript does not resolve a stylesheet (`app/layout.tsx`'s `./globals.css`).
 */
export const ASSET_EXT = /\.(?:css|svg|json|png|ico)$/;

/** The 1-based line a node starts on. */
export const lineOf = (sf: ts.SourceFile, n: ts.Node): number =>
  sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

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

/**
 * The file `spec` names from `from` (absolute), repo-relative and in its true case, or `null`.
 * `ts.resolveModuleName` decides, from an explicit project, never `process.cwd()`. One fallback: a
 * relative or `@/` specifier naming an existing file with an {@link ASSET_EXT} extension is an asset,
 * resolved by path.
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
  if (!target || !ASSET_EXT.test(target) || !statSync(target, { throwIfNoEntry: false })?.isFile())
    return null;
  return relative(REPO_DIR, realpathSync.native(target));
}

const FIRST_PARTY_PREFIX = /^(?:\.|@\/|#|@mat-plan\/)/i;
/**
 * A specifier that is ours, so an unresolved one fails closed: relative, `@/`, `#`, `@mat-plan/`
 * (any case), as written OR once normalised (`react/../@mat-plan/db`), or one that normalises through
 * `node_modules` or `packages/db`. An unresolved third-party specifier (`server-only`, `node:fs`) is
 * not the graph's to judge.
 */
export function isFirstParty(spec: string): boolean {
  const normal = posix.normalize(spec);
  return (
    FIRST_PARTY_PREFIX.test(spec) ||
    FIRST_PARTY_PREFIX.test(normal) ||
    /(?:^|\/)(?:node_modules|packages\/+db)(?:\/|$)/i.test(normal)
  );
}

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

/** One refusal: what every guard on this graph reports. */
export type GraphRefusal = { line: number; rule: string; detail: string };

/**
 * What the graph could not follow in one file, as refusals: each unresolved first-party or computed
 * specifier, and each unfollowable loader. The one formatter for both, for every guard.
 */
export const blindSpots = ({ unresolved, unfollowable }: FileImports): GraphRefusal[] => [
  ...unresolved.map((u) => ({
    line: u.line,
    rule: 'unresolved first-party',
    detail: u.spec === null ? `computed ${u.text}` : `'${u.spec}'`,
  })),
  ...unfollowable.map((u) => ({ line: u.line, rule: 'unfollowable', detail: u.detail })),
];

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

/** The value an expression hands on: through `( )`, `as`, `!`, `satisfies` and `.bind(…)`. */
export function bound(e: ts.Expression): ts.Expression {
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
}

const LOADERS = new Set(['require', '__webpack_require__', '__non_webpack_require__']);
/** Node's module system: `createRequire`, `Module._load`. Importing it at all is refused. */
const NODE_MODULE = new Set(['module', 'node:module']);

/** Is this identifier a reference, not a property name, a key or a label? */
export function isReference(n: ts.Identifier): boolean {
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

const isImportMeta = (e: ts.Node): e is ts.MetaProperty =>
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
 *   `import.meta`; `module.require`; `import.meta.webpackContext`; `import.meta` other than as the
 *   object of a property access; any identifier `createRequire`; any import of `module` or
 *   `node:module`.
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
  const refuse = (n: ts.Node, detail: string) =>
    found.set(`${lineOf(sf, n)} ${detail}`, { line: lineOf(sf, n), detail });
  const add = (
    n: ts.Node,
    spec: string | null,
    kind: ImportKind,
    names: string[] = [],
    typeOnly = false,
  ) => {
    if (spec !== null && NODE_MODULE.has(spec)) refuse(n, `import of '${spec}'`);
    imports.push({
      spec,
      kind,
      names,
      typeOnly,
      line: lineOf(sf, n),
      text: n.getText(sf),
      resolved: spec === null ? null : resolveFrom(spec, file, options),
    });
  };
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
    } else if (
      isImportMeta(n) &&
      !(ts.isPropertyAccessExpression(n.parent) && n.parent.expression === n) &&
      !(ts.isElementAccessExpression(n.parent) && n.parent.expression === n)
    ) {
      refuse(n, 'import.meta (not a member access)');
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

/** Where a published name is defined: its file (repo-relative) and its name there. */
export type Origin = { file: string; name: string };

/**
 * Every name a module publishes, mapped to its ORIGIN (repo-relative `file`): followed through
 * `export *`, `export { a as b } from`, and a local `export { x }` of an imported binding, while the
 * target stays under `inside`. A target outside it (third-party, a sibling package) is the origin
 * itself, not walked. `null` is a name whose origin cannot be traced: a specifier that does not
 * resolve, or two `export *` chains publishing one name from different origins. A guard keyed on the
 * origin fails closed on `null`, so a renamed re-export keeps its identity. `texts` reads a file's
 * text from a fixture.
 */
export function originsOf(
  file: string,
  texts: Readonly<Record<string, string>> = {},
  inside = 'packages/db/src/',
  memo = new Map<string, Map<string, Origin | null>>(),
): Map<string, Origin | null> {
  const cached = memo.get(file);
  if (cached) return cached;
  const out = new Map<string, Origin | null>();
  memo.set(file, out); // a cycle reads what is known so far
  const { imports, sf } = importsOf(join(REPO_DIR, file), texts[file]);
  const refOf = (st: ts.Node) => imports.find((i) => i.text === st.getText(sf));
  /** The origin of `name` as published by `target` (a resolved path, or null). */
  const through = (target: string | null, name: string): Origin | null => {
    if (target === null) return null;
    if (!target.startsWith(inside)) return { file: target, name };
    if (name === '*') return { file: target, name };
    return originsOf(target, texts, inside, memo).get(name) ?? null;
  };
  /**
   * Local bindings that come from an import: local name → (resolved target, imported name). `*` is a
   * namespace. `import x = require('…')` is a namespace; `import x = P.y` is `y` of `P`'s target.
   */
  const imported = new Map<string, { target: string | null; name: string }>();
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && st.importClause) {
      const target = refOf(st)?.resolved ?? null;
      const clause = st.importClause;
      if (clause.name) imported.set(clause.name.text, { target, name: 'default' });
      const b = clause.namedBindings;
      if (b && ts.isNamespaceImport(b)) imported.set(b.name.text, { target, name: '*' });
      else
        b?.elements.forEach((e) =>
          imported.set(e.name.text, { target, name: (e.propertyName ?? e.name).text }),
        );
    } else if (ts.isImportEqualsDeclaration(st)) {
      const ref = st.moduleReference;
      if (ts.isExternalModuleReference(ref))
        imported.set(st.name.text, { target: refOf(st)?.resolved ?? null, name: '*' });
      else {
        const ns =
          ts.isQualifiedName(ref) && ts.isIdentifier(ref.left)
            ? imported.get(ref.left.text)
            : undefined;
        imported.set(st.name.text, {
          target: ns?.name === '*' ? ns.target : null,
          name: ts.isQualifiedName(ref) ? ref.right.text : ref.text,
        });
      }
    }
  }
  /** Top-level `const`/`let`/`var` initializers, and names destructured from an identifier. */
  const values = new Map<string, ts.Expression>();
  const picked = new Map<string, { from: string; name: string } | null>();
  for (const st of sf.statements)
    if (ts.isVariableStatement(st))
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) {
          if (d.initializer) values.set(d.name.text, d.initializer);
          continue;
        }
        const from = d.initializer && unwrapExpression(d.initializer);
        const names = (n: ts.BindingName): string[] =>
          ts.isIdentifier(n)
            ? [n.text]
            : n.elements.flatMap((e) => (ts.isOmittedExpression(e) ? [] : names(e.name)));
        if (ts.isObjectBindingPattern(d.name) && from && ts.isIdentifier(from))
          for (const e of d.name.elements) {
            const key = e.propertyName ?? e.name;
            const flat =
              ts.isIdentifier(e.name) &&
              !e.dotDotDotToken &&
              (ts.isIdentifier(key) || ts.isStringLiteral(key));
            for (const n of names(e.name))
              picked.set(n, flat ? { from: from.text, name: (key as ts.Identifier).text } : null);
          }
        else for (const n of names(d.name)) picked.set(n, null);
      }
  const set = (name: string, origin: Origin | null) => {
    const had = out.get(name);
    const same = (a: Origin | null | undefined, b: Origin | null) =>
      !!a && !!b && a.file === b.file && a.name === b.name;
    out.set(name, had === undefined || same(had, origin) ? origin : null);
  };
  /** Does `e` hand on an in-package import as a value (not as a direct callee, not in a type)? */
  const handsOnImport = (e: ts.Node): boolean => {
    let hit = false;
    const walk = (n: ts.Node): void => {
      if (hit) return;
      if (ts.isIdentifier(n) && isReference(n) && imported.has(n.text)) {
        const from = imported.get(n.text)!;
        const callee = ts.isCallExpression(n.parent) && n.parent.expression === n;
        if (from.target?.startsWith(inside) && !callee && !ts.isTypeNode(n.parent)) hit = true;
      }
      ts.forEachChild(n, walk);
    };
    walk(e);
    return hit;
  };
  /**
   * The origin of the value `e`, published as `name`: through `( )`, `as`, `!`, `satisfies` and
   * `.bind`, an identifier is traced as a local binding and `ns.x` through a namespace import. Any
   * other value that hands on an in-package import (`{ saveWorkout }`, `wrap(saveWorkout)`) cannot be
   * traced; anything else is defined here.
   */
  const valueOrigin = (e: ts.Expression, name: string, seen: Set<string>): Origin | null => {
    const x = bound(e);
    if (ts.isIdentifier(x)) return local(x.text, seen);
    if (ts.isPropertyAccessExpression(x) && ts.isIdentifier(x.expression)) {
      const ns = imported.get(x.expression.text);
      if (ns) return ns.name === '*' ? through(ns.target, x.name.text) : null;
    }
    return handsOnImport(x) ? null : { file, name };
  };
  const local = (name: string, seen = new Set<string>()): Origin | null => {
    if (seen.has(name)) return null;
    seen.add(name);
    const from = imported.get(name);
    if (from) return through(from.target, from.name);
    const pick = picked.get(name);
    if (pick === null) return null;
    if (pick) {
      const ns = imported.get(pick.from);
      return ns?.name === '*' ? through(ns.target, pick.name) : ns ? null : { file, name };
    }
    const value = values.get(name);
    return value ? valueOrigin(value, name, seen) : { file, name };
  };
  const modifiers = (st: ts.Statement) =>
    ts.canHaveModifiers(st) ? ts.getModifiers(st) : undefined;
  const exportedHere = (st: ts.Statement) =>
    !!modifiers(st)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  for (const st of sf.statements) {
    if (ts.isExportDeclaration(st)) {
      const clause = st.exportClause;
      const target = st.moduleSpecifier ? (refOf(st)?.resolved ?? null) : undefined;
      if (clause && ts.isNamedExports(clause))
        for (const e of clause.elements) {
          const name = (e.propertyName ?? e.name).text;
          set(e.name.text, target === undefined ? local(name) : through(target, name));
        }
      else if (clause && ts.isNamespaceExport(clause))
        set(clause.name.text, through(target ?? null, '*'));
      else if (target === null || target === undefined) set('*', null);
      else if (!target.startsWith(inside)) set(`* from ${target}`, null);
      else
        for (const [name, origin] of originsOf(target, texts, inside, memo))
          if (name !== 'default') set(name, origin);
    } else if (ts.isExportAssignment(st)) {
      set('default', valueOrigin(st.expression, 'default', new Set()));
    } else if (ts.isImportEqualsDeclaration(st) && exportedHere(st)) {
      set(st.name.text, local(st.name.text));
    } else if (exportedHere(st)) {
      const isDefault = modifiers(st)?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
      if (ts.isVariableStatement(st))
        st.declarationList.declarations.forEach((d) => {
          const names = (n: ts.BindingName): string[] =>
            ts.isIdentifier(n)
              ? [n.text]
              : n.elements.flatMap((e) => (ts.isOmittedExpression(e) ? [] : names(e.name)));
          for (const n of names(d.name)) set(n, local(n));
        });
      else if (
        (ts.isFunctionDeclaration(st) ||
          ts.isClassDeclaration(st) ||
          ts.isInterfaceDeclaration(st) ||
          ts.isTypeAliasDeclaration(st) ||
          ts.isEnumDeclaration(st) ||
          ts.isModuleDeclaration(st)) &&
        st.name
      ) {
        const name = isDefault ? 'default' : st.name.text;
        set(name, { file, name });
      }
    }
  }
  return out;
}
