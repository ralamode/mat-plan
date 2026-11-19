import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/dal/session', () => ({ sessionUserOrNull: vi.fn() }));
vi.mock('@/lib/dal/profiles', () => ({ getProfileByPublicId: vi.fn() }));
vi.mock('@/lib/dal/export', () => ({ buildExportZip: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({
  checkExportLimit: vi.fn(),
  reportLimiterUnavailable: vi.fn(),
}));

import { buildExportZip } from '@/lib/dal/export';
import { getProfileByPublicId } from '@/lib/dal/profiles';
import { sessionUserOrNull } from '@/lib/dal/session';
import { checkExportLimit, reportLimiterUnavailable } from '@/lib/rate-limit';

import { GET } from './route';

const ID = '019826b4-0000-7000-8000-00000000e101';
const call = (id = ID) =>
  GET(new Request(`http://x/p/${id}/export`), { params: Promise.resolve({ profileId: id }) });

/** Status, body and headers: what a caller can tell one answer from another by. */
const answer = async (response: Response) => ({
  status: response.status,
  body: await response.text(),
  headers: [...response.headers.entries()].sort(),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sessionUserOrNull).mockResolvedValue({ userId: 'u' } as never);
  vi.mocked(checkExportLimit).mockResolvedValue({ allowed: true, reason: 'ok' });
});

describe('GET /p/[profileId]/export', () => {
  it('a hit: the zip, never cached', async () => {
    vi.mocked(getProfileByPublicId).mockResolvedValueOnce({ id: ID } as never);
    vi.mocked(buildExportZip).mockResolvedValueOnce(new Uint8Array([1, 2, 3]));
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/zip');
    expect(response.headers.get('cache-control')).toBe('no-store, private');
    // Counted once, on the principal, never on the URL's id.
    expect(checkExportLimit).toHaveBeenCalledTimes(1);
    expect(checkExportLimit).toHaveBeenCalledWith('u');
    expect(reportLimiterUnavailable).not.toHaveBeenCalled();
  });

  it('🔴 signed out, an unknown id and another household’s id answer byte-identically (ADR 0006)', async () => {
    vi.mocked(sessionUserOrNull).mockResolvedValueOnce(null);
    const signedOut = await answer(await call());
    expect(getProfileByPublicId).not.toHaveBeenCalled();
    // `getProfileByPublicId` is household-scoped: an unknown id and a foreign one both read null.
    vi.mocked(getProfileByPublicId).mockResolvedValueOnce(null);
    const unknown = await answer(await call());
    vi.mocked(getProfileByPublicId).mockResolvedValueOnce(null);
    const foreign = await answer(await call('019826b4-0000-7000-8000-00000000e102'));
    expect(signedOut.status).toBe(404);
    expect(unknown).toEqual(signedOut);
    expect(foreign).toEqual(signedOut);
    expect(signedOut.headers).toContainEqual(['cache-control', 'no-store, private']);
    expect(buildExportZip).not.toHaveBeenCalled();
    // 🔴 The only pin on the order (plan PR A): a miss is answered BEFORE the limit, so a made-up id
    // costs no Redis call and a cross-site page cannot spend a parent's budget with one.
    expect(checkExportLimit).not.toHaveBeenCalled();
  });

  it('🔴 past the limit: 429, never cached, and no zip is built', async () => {
    vi.mocked(getProfileByPublicId).mockResolvedValueOnce({ id: ID } as never);
    vi.mocked(checkExportLimit).mockResolvedValueOnce({ allowed: false, reason: 'limited' });
    const limited = await answer(await call());
    expect(limited.status).toBe(429);
    expect(limited.headers).toContainEqual(['cache-control', 'no-store, private']);
    // The body names nothing: no profile id, no count.
    expect(limited.body).not.toContain(ID);
    expect(buildExportZip).not.toHaveBeenCalled();
  });

  it('a dead limiter fails open, and reports it as the export limiter', async () => {
    vi.mocked(getProfileByPublicId).mockResolvedValueOnce({ id: ID } as never);
    vi.mocked(checkExportLimit).mockResolvedValueOnce({ allowed: true, reason: 'limiter-error' });
    vi.mocked(buildExportZip).mockResolvedValueOnce(new Uint8Array([1]));
    expect((await call()).status).toBe(200);
    expect(reportLimiterUnavailable).toHaveBeenCalledTimes(1);
    expect(reportLimiterUnavailable).toHaveBeenCalledWith('export');
  });
});
