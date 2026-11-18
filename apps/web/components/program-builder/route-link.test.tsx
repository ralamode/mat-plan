// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { join } from 'node:path';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Next's Link, as what it was handed: the prefetch prop is the whole contract here.
vi.mock('next/link', () => ({
  default: ({ prefetch, href, children }: ComponentProps<'a'> & { prefetch?: boolean | null }) => (
    <a href={String(href)} data-prefetch={String(prefetch)}>
      {children}
    </a>
  ),
}));

import { appSources, code, WEB_DIR } from '@/test/source-scan';

import { BuilderLink, BuilderLinkPrefetch } from './route-link';

afterEach(cleanup);

describe('the builder’s links and the preview’s prefetch switch (FAM-1 7a-ii)', () => {
  it('a real page provides nothing: Next’s own default, untouched', () => {
    render(<BuilderLink href="/programs">Programs</BuilderLink>);
    expect(screen.getByRole('link').getAttribute('data-prefetch')).toBe('undefined');
  });

  it('the preview provides false: no link prefetches a fixture id’s 404', () => {
    render(
      <BuilderLinkPrefetch value={false}>
        <BuilderLink href="/programs/019826b4-0000-7000-8000-000200000001">Back</BuilderLink>
      </BuilderLinkPrefetch>,
    );
    expect(screen.getByRole('link').getAttribute('data-prefetch')).toBe('false');
  });

  it('🔴 every builder screen links through BuilderLink, never next/link itself', () => {
    const dir = join(WEB_DIR, 'components/program-builder/');
    const screens = appSources().filter((f) => f.startsWith(dir));
    expect(screens.length).toBeGreaterThan(5);
    const sources = screens
      .filter((f) => f !== join(dir, 'route-link.tsx'))
      .filter((f) => /from ['"]next\/link['"]/.test(code(f)));
    expect(sources).toEqual([]);
  });
});
