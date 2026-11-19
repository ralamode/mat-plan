import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { NO_STORE, notFound } = await import('./route-miss');

describe('notFound — the one miss answer for a per-user route', () => {
  it('is a 404 with a fixed body, never cached', async () => {
    const res = notFound();
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('Not found');
    expect(res.headers.get('cache-control')).toBe('no-store, private');
  });

  it('pins the header both routes send on success too', () => {
    expect(NO_STORE).toEqual({ 'cache-control': 'no-store, private' });
  });
});
