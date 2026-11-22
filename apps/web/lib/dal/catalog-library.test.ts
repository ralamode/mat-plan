import { CATALOG_MOVEMENTS } from '@mat-plan/shared/catalog/data';
import { CATALOG_FIXTURE } from '@mat-plan/shared/catalog/fixture';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const name = vi.hoisted(() => ({ value: 'catalog' as 'catalog' | 'fixture' }));
vi.mock('@/lib/env', () => ({ catalogLibraryName: () => name.value }));

/** CAT-3 K29: the name `lib/env.ts` decides maps to its list, both ways. */
describe('CATALOG_LIBRARY follows the name in effect (CAT-3 K29)', () => {
  afterEach(() => vi.resetModules());

  it.each([
    ['catalog', CATALOG_MOVEMENTS],
    ['fixture', CATALOG_FIXTURE],
  ] as const)('%s', async (which, list) => {
    name.value = which;
    vi.resetModules();
    const { CATALOG_LIBRARY } = await import('./catalog-library');
    expect(CATALOG_LIBRARY.map((e) => e.slug)).toEqual(list.map((e) => e.slug));
  });
});
