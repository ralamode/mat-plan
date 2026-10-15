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
]);

export default eslintConfig;
