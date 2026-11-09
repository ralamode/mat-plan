// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const WEB_ROOT = join(import.meta.dirname, '..', '..');

import { Announcer } from './announcer';

afterEach(cleanup);

/**
 * COMPONENT TIER. The two properties a caller depends on and could not see going wrong: the region is
 * `role="status"` (polite, not an alert), and it is PRESENT while empty — a region that mounts with
 * its text is never announced, which is the failure this component exists to make hard.
 */
describe('Announcer', () => {
  it('is a polite status region, present and empty before anything is announced', () => {
    render(<Announcer message="" />);
    const region = screen.getByRole('status');
    expect(region).toBeDefined();
    expect(region.textContent).toBe('');
  });

  it('carries the message once there is one', () => {
    render(<Announcer message="Name saved." />);
    expect(screen.getByRole('status').textContent).toBe('Name saved.');
  });

  /**
   * 🔴 **Rule 3, as a scan of every consumer rather than a sentence in a docblock.**
   *
   * The prose rule ("render it in both states, mounted before the message exists") was already
   * there when `rename-font`'s only consumer shipped `empty:hidden` — because `empty:hidden` does
   * not *look* like mounting. It is the same bug by a different mechanism: `:empty` →
   * `display:none` takes the region out of the accessibility tree while it is silent, so the text
   * arriving un-hides and fills it in one commit, which is a region that mounts with its text.
   * Silent.
   *
   * A class scan is crude, and deliberately so: the alternative is asserting computed styles in
   * jsdom, which does not apply Tailwind at all, so it would pass on anything.
   */
  it('🔴 no consumer hides the region — a hidden live region is a silent one', () => {
    const consumers = globSync('{app,components}/**/*.tsx', { cwd: WEB_ROOT })
      .map((f) => ({ f, src: readFileSync(join(WEB_ROOT, f), 'utf8') }))
      .filter(({ src }) => src.includes('<Announcer'));

    // An empty glob would pass this test while checking nothing.
    expect(consumers.length).toBeGreaterThan(0);

    const offenders = consumers.flatMap(({ f, src }) => {
      const props = src.match(/<Announcer[^>]*>/g) ?? [];
      return props.some((p) => /empty:hidden|\bhidden\b|\binvisible\b/.test(p)) ? [f] : [];
    });

    expect(
      offenders,
      'a class that removes the region from the accessibility tree while empty defeats rule 1 by ' +
        'another route — use min-h-* or h-0 if the empty line must not take space',
    ).toEqual([]);
  });

  /** The default is invisible-but-announced; a no-JS surface overrides it to be seen as well. */
  it('defaults to sr-only and lets a caller make it visible', () => {
    const { container } = render(<Announcer message="x" />);
    expect(container.querySelector('[role="status"]')?.className).toBe('sr-only');
    cleanup();
    const visible = render(<Announcer message="x" className="text-muted-foreground text-sm" />);
    expect(visible.container.querySelector('[role="status"]')?.className).not.toContain('sr-only');
  });
});
