import { afterEach, describe, expect, it, vi } from 'vitest';

import { howToLoader } from './how-to-loader';
import { howToPath } from './routes';

const HOW_TO = { name: 'Pull-up', instructions: 'Hang.\nPull.', supervision: null };
const reply = (status: number, body: unknown) =>
  vi.fn(async (_url: string) => new Response(JSON.stringify(body), { status }));

afterEach(() => vi.unstubAllGlobals());

describe('howToLoader: a failure is a rejection (movement-picker invariant 14)', () => {
  it('a 200 is the parsed steps, fetched from the route', async () => {
    const fetchSpy = reply(200, HOW_TO);
    vi.stubGlobal('fetch', fetchSpy);
    expect(await howToLoader('o')).toEqual(HOW_TO);
    expect(fetchSpy.mock.calls[0]![0]).toBe(howToPath('o'));
  });

  it('a 404 is null: "No steps for this movement yet"', async () => {
    vi.stubGlobal('fetch', reply(404, 'Not found'));
    expect(await howToLoader('o')).toBeNull();
  });

  it.each([500, 401, 302])('🔴 a %i rejects, so the picker offers Try again', async (status) => {
    vi.stubGlobal('fetch', reply(status, {}));
    await expect(howToLoader('o')).rejects.toThrow();
  });

  it('a 200 whose body is not the strict shape rejects', async () => {
    vi.stubGlobal('fetch', reply(200, { ...HOW_TO, slug: 'x' }));
    await expect(howToLoader('o')).rejects.toThrow();
  });

  it('offline rejects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
    );
    await expect(howToLoader('o')).rejects.toThrow();
  });
});
