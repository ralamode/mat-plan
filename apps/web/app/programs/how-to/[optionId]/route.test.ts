import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/dal/session', () => ({ sessionUserOrNull: vi.fn() }));
vi.mock('@/lib/dal/program/picker', () => ({ getHowTo: vi.fn() }));

import { getHowTo } from '@/lib/dal/program/picker';
import { sessionUserOrNull } from '@/lib/dal/session';

import { GET } from './route';

const ID = '019826b4-0000-7000-8000-00000000e001';
const HOW_TO = { name: 'Pull-up', instructions: 'Hang.\nPull.', supervision: null };
const call = (id = ID) =>
  GET(new Request(`http://x/programs/how-to/${id}`), { params: Promise.resolve({ optionId: id }) });

/** Status, body and headers: what a caller can tell one answer from another by. */
const answer = async (response: Response) => ({
  status: response.status,
  body: await response.text(),
  headers: [...response.headers.entries()].sort(),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sessionUserOrNull).mockResolvedValue({ userId: 'u' });
});

describe('GET /programs/how-to/[optionId] (FAM-1 7b)', () => {
  it('a hit: the steps, never cached', async () => {
    vi.mocked(getHowTo).mockResolvedValueOnce(HOW_TO as never);
    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(HOW_TO);
    expect(response.headers.get('cache-control')).toBe('no-store, private');
  });

  it('🔴 signed out, and every miss, answer byte-identically: a 404 that says nothing (ADR 0006)', async () => {
    vi.mocked(sessionUserOrNull).mockResolvedValueOnce(null);
    const signedOut = await answer(await call());
    expect(getHowTo).not.toHaveBeenCalled();
    vi.mocked(getHowTo).mockResolvedValueOnce(null);
    const miss = await answer(await call());
    vi.mocked(getHowTo).mockResolvedValueOnce(null);
    const notUuid = await answer(await call('not-a-uuid'));
    expect(signedOut.status).toBe(404);
    expect(miss).toEqual(signedOut);
    expect(notUuid).toEqual(signedOut);
    expect(signedOut.headers).toContainEqual(['cache-control', 'no-store, private']);
  });

  it('a body the strict schema refuses never leaves (no slug or id rides along)', async () => {
    vi.mocked(getHowTo).mockResolvedValueOnce({ ...HOW_TO, slug: 'pull-up' } as never);
    await expect(call()).rejects.toThrow();
  });
});
