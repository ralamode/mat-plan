// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

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

  /** The default is invisible-but-announced; a no-JS surface overrides it to be seen as well. */
  it('defaults to sr-only and lets a caller make it visible', () => {
    const { container } = render(<Announcer message="x" />);
    expect(container.querySelector('[role="status"]')?.className).toBe('sr-only');
    cleanup();
    const visible = render(<Announcer message="x" className="text-muted-foreground text-sm" />);
    expect(visible.container.querySelector('[role="status"]')?.className).not.toContain('sr-only');
  });
});
