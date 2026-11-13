import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // Generated from docs/privacy/notice.md (PRIV-2). `.prettierignore` alone is NOT enough: the
    // root package.json's lint-staged runs `eslint --fix` on `apps/web/**/*.{ts,tsx}` on every
    // commit, which would rewrite this file and fail the byte-exact drift test on a fix nobody made.
    'lib/privacy/notice-content.ts',
  ]),
  {
    rules: {
      /**
       * An argument named `_something` is documentation, not dead code — so it stops being a
       * warning (_maintainer, 2026-11-12_).
       *
       * The convention already had adherents here and the linter had never honoured it: of the
       * eight `no-unused-vars` warnings `#377` cleared, **four were underscore-prefixed on
       * purpose** — two mock parameters typing a call the assertions read as `calls[0][1]`, and two
       * in a middleware mock whose signature the handler shape requires. Writing `_exec` is how you
       * say "this argument exists because the signature needs it"; the linter answering "unused"
       * leaves the author with a bad choice between a wrong name and a suppression comment.
       *
       * ⚠️ **This silences nothing today.** `#377` fixed all eight by other means, so `pnpm lint`
       * was already clean when this landed. It is forward-looking on purpose, which is also why it
       * is its own PR rather than part of that one.
       *
       * 🔴 **Scoped to ARGUMENTS, deliberately.** `varsIgnorePattern` and
       * `caughtErrorsIgnorePattern` are NOT set: an unused local or an unused `catch` binding is
       * dead code with no signature forcing it to exist, and renaming one to `_x` to quiet the
       * linter is the shape this rule should keep catching. The preset passes severity only, so
       * every other default — `args: 'after-used'`, `caughtErrors: 'all'`,
       * `ignoreRestSiblings: true` — still applies.
       *
       * **Probed, three shapes, because a loosened rule that loosened more than intended would look
       * exactly like success:** `(used, _unused)` → silent; `(used, unused)` → still warns
       * (*"Allowed unused args must match /^_/u"*, so the rule is live rather than off); and a
       * `const _deadLocal` → still warns, which is the args-only scoping above, demonstrated rather
       * than asserted. Not kept as a committed test: pinning it needs a deliberately-bad fixture in
       * the tree that lint itself would then flag, which is disproportionate to one line of config.
       */
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
]);

export default eslintConfig;
