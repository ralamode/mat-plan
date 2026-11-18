// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { readdirSync, readFileSync } from 'node:fs';
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
    const dir = 'components/program-builder';
    const sources = readdirSync(dir, { recursive: true, encoding: 'utf8' })
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && f !== 'route-link.tsx')
      .filter((f) => /from ['"]next\/link['"]/.test(readFileSync(`${dir}/${f}`, 'utf8')));
    expect(sources).toEqual([]);
  });
});
