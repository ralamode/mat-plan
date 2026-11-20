import { CATALOG_LIBRARY_FIXTURE_NOTICE } from '@mat-plan/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CAT-3 K29 — **which movement library this process reads, and the line that says so.** `lib/env.ts`
 * decides it once at import, so each case re-imports the module. The rule's own cases (every URL
 * shape, the production pins) are `catalogLibraryNameFor`'s, in `packages/shared`; this pins that the
 * app passes it the right two values and logs the fixed notice only for the test library.
 */

const LOCAL_DB = 'postgres://mat:mat@127.0.0.1:5432/mat_plan_test';
const PREVIEW_DB = 'postgres://u:p@ep-example-123.us-east-2.aws.neon.tech/mat_plan_preview';
const PROD_DB = 'postgres://u:p@ep-example-123.us-east-2.aws.neon.tech/neondb';

async function importEnv() {
  vi.resetModules();
  return import('./env');
}

describe('the movement library this process reads (CAT-3 K29)', () => {
  let info: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.stubEnv('E2E_SESSION_BYPASS_USER_ID', '');
    vi.stubEnv('VERCEL', '');
    vi.stubEnv('VERCEL_ENV', '');
    vi.stubEnv('ALLOW_LIVE_DB', '');
    info = vi.spyOn(console, 'info').mockImplementation(() => {});
  });
  afterEach(() => {
    info.mockRestore();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('a local database off Vercel reads the test library, and logs the notice once, exactly', async () => {
    vi.stubEnv('DATABASE_URL', LOCAL_DB);
    const { catalogLibraryName } = await importEnv();
    expect(catalogLibraryName()).toBe('fixture');
    expect(info.mock.calls).toEqual([[CATALOG_LIBRARY_FIXTURE_NOTICE]]);
  });

  it('a preview deployment on the preview database reads the test library', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('DATABASE_URL', PREVIEW_DB);
    const { catalogLibraryName } = await importEnv();
    expect(catalogLibraryName()).toBe('fixture');
  });

  it('🔴 production reads the real library and logs nothing', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('DATABASE_URL', PROD_DB);
    const { catalogLibraryName } = await importEnv();
    expect(catalogLibraryName()).toBe('catalog');
    expect(info).not.toHaveBeenCalled();
  });

  it('a live database off Vercel (dev:prod, ALLOW_LIVE_DB=1) reads the real library', async () => {
    vi.stubEnv('ALLOW_LIVE_DB', '1');
    vi.stubEnv('DATABASE_URL', PROD_DB);
    const { catalogLibraryName } = await importEnv();
    expect(catalogLibraryName()).toBe('catalog');
    expect(info).not.toHaveBeenCalled();
  });

  it('🔴 SKIP_ENV_VALIDATION does not change the choice', async () => {
    vi.stubEnv('SKIP_ENV_VALIDATION', '1');
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('DATABASE_URL', PROD_DB);
    const { catalogLibraryName } = await importEnv();
    expect(catalogLibraryName()).toBe('catalog');
  });
});
