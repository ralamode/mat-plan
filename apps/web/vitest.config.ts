import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Unit / integration runner (pulled forward ahead of V0-8 so the first Server
 * Action can ship its boundary tests in-PR — see docs/plan.md). Node env covers
 * the mandatory layers: zod schemas, pure utils, and Server Actions exercised as
 * plain async functions (mock the DAL — AGENTS.md testing gotcha). Component
 * (RTL/jsdom) and E2E (Playwright, V0-11) are added when a UI flow needs them.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.{ts,tsx}'],
    // Valid values so modules that import lib/env.ts don't fail boot validation
    // under test. Individual tests override/mock as needed.
    env: {
      ACCESS_GATE_PASSWORD: 'test-access-code-1234',
      DATABASE_URL: 'postgres://user:pass@localhost:5432/mat_plan_test',
    },
  },
  resolve: {
    alias: {
      // Mirror the `@/*` tsconfig path so tests import the same way app code does.
      '@': here,
      // `import 'server-only'` throws outside an RSC bundle; stub it under Node.
      'server-only': join(here, 'test/server-only-stub.ts'),
    },
  },
});
