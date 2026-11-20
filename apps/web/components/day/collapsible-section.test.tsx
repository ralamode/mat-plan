// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { CollapsibleSection, useSectionBusy } from './collapsible-section';
import { DAY_COPY } from './day-copy';

/**
 * FAM-1 12c-iii PR 2: the shell Bodyweight and Life fold in (plan `fam-1-12c-iii-collapse.md` §5).
 * The sections' own rules (what is finished, the summary, the key) are their test files'.
 */

afterEach(cleanup);

const NAME = 'Bodyweight';
const SUMMARY = '84.5 lb';
const LINE_NAME = `${NAME}, ${SUMMARY}`;

/** A part of the body that reports busy, as the editor and the island do. */
function Busy({ busy }: { busy: boolean }) {
  useSectionBusy(busy);
  return <button type="button">Inside</button>;
}

function shell({
  summary = SUMMARY,
  finished = true,
  busy = false,
  withBusy = true,
  profileId = 'p1',
  day = '2026-09-30',
}: {
  summary?: string | null;
  finished?: boolean;
  busy?: boolean;
  withBusy?: boolean;
  profileId?: string;
  day?: string;
} = {}) {
  return (
    <CollapsibleSection
      profileId={profileId}
      day={day}
      headingId="h"
      heading={NAME}
      line={summary === null ? null : { detail: null, count: summary }}
      finished={finished}
    >
      {withBusy ? <Busy busy={busy} /> : null}
    </CollapsibleSection>
  );
}

const line = () => screen.queryByRole('button', { expanded: false });
const collapse = () => screen.queryByRole('button', { name: DAY_COPY.collapseLabel(NAME) });
const inside = () => screen.queryByRole('button', { name: 'Inside' });
const nameSpan = () => document.getElementById('h')!;

describe('CollapsibleSection', () => {
  it('cannot fold (no line): today’s heading, the focus target, no line and no Collapse', () => {
    render(shell({ summary: null }));
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading.id).toBe('h');
    expect(heading.getAttribute('tabindex')).toBe('-1');
    expect(line()).toBeNull();
    expect(document.querySelector('[aria-controls]')).toBeNull();
    expect(inside()).not.toBeNull();
  });

  it('finished when it mounts: one line, named "name, summary", the body hidden, the region still bare', () => {
    render(shell());
    expect(line()!.getAttribute('aria-label')).toBe(LINE_NAME);
    expect(line()!.closest('h2')).not.toBeNull();
    const body = document.getElementById(line()!.getAttribute('aria-controls')!)!;
    expect(body.hidden).toBe(true);
    expect(inside()).toBeNull();
    expect(screen.getByRole('region', { name: NAME })).toBeTruthy();
    // Folded, the name is inside the line's button with no tab stop of its own (axe nested-interactive).
    expect(nameSpan().hasAttribute('tabindex')).toBe(false);
  });

  it('not finished when it mounts: open, and finishing during the visit leaves it open with Collapse', () => {
    const { rerender } = render(shell({ finished: false }));
    expect(line()).toBeNull();
    // The slot is held (in place, unusable) until finished.
    expect(collapse()).toBeNull();
    expect(document.querySelector('[aria-controls]')!.className).toMatch(/\binvisible\b/);
    rerender(shell({ finished: true }));
    expect(line()).toBeNull();
    expect(collapse()).not.toBeNull();
    expect(inside()).not.toBeNull();
  });

  it('a tap opens it with focus on Collapse; Collapse folds it with focus on the line', () => {
    render(shell());
    fireEvent.click(line()!);
    expect(document.activeElement).toBe(collapse());
    expect(collapse()!.getAttribute('aria-expanded')).toBe('true');
    expect(inside()).not.toBeNull();
    expect(nameSpan().getAttribute('tabindex')).toBe('-1');
    expect(screen.getByRole('region', { name: NAME })).toBeTruthy();
    fireEvent.click(collapse()!);
    expect(document.activeElement).toBe(line());
    expect(inside()).toBeNull();
  });

  it('busy holds Collapse; held while it has focus, focus moves to the name', () => {
    const { rerender } = render(shell());
    fireEvent.click(line()!);
    expect(document.activeElement).toBe(collapse());
    rerender(shell({ busy: true }));
    expect(collapse()).toBeNull();
    expect(document.activeElement).toBe(nameSpan());
    rerender(shell({ busy: false }));
    expect(collapse()).not.toBeNull();
  });

  it('a busy part that unmounts takes its count with it', () => {
    const { rerender } = render(shell());
    fireEvent.click(line()!);
    rerender(shell({ busy: true }));
    expect(collapse()).toBeNull();
    rerender(shell({ busy: true, withBusy: false }));
    expect(collapse()).not.toBeNull();
  });

  it('no longer finished while folded: it opens, and leaves focus where it was', () => {
    const { rerender } = render(shell());
    rerender(shell({ finished: false }));
    expect(line()).toBeNull();
    expect(inside()).not.toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  it('the line goes while it has focus: the open name takes focus', async () => {
    const { rerender } = render(shell());
    line()!.focus();
    await act(async () => {
      rerender(shell({ finished: false }));
    });
    expect(document.activeElement).toBe(nameSpan());
  });

  it('under StrictMode a mount moves no focus, and a tap still focuses Collapse', () => {
    render(<StrictMode>{shell()}</StrictMode>);
    expect(document.activeElement).toBe(document.body);
    fireEvent.click(line()!);
    expect(document.activeElement).toBe(collapse());
  });

  it('under StrictMode a part mounted busy still holds Collapse: its count survives the second run', () => {
    const strict = (busy: boolean) => <StrictMode>{shell({ busy })}</StrictMode>;
    const { rerender } = render(strict(true));
    fireEvent.click(line()!);
    expect(inside()).not.toBeNull();
    expect(collapse()).toBeNull();
    rerender(strict(false));
    expect(collapse()).not.toBeNull();
  });

  it('a new day or a new athlete is a new visit: keyed inside, it folds again', () => {
    const { rerender } = render(shell());
    fireEvent.click(line()!);
    expect(line()).toBeNull();
    rerender(shell({ day: '2026-10-01' }));
    expect(line()).not.toBeNull();
    fireEvent.click(line()!);
    rerender(shell({ day: '2026-10-01', profileId: 'p2' }));
    expect(line()).not.toBeNull();
  });

  it('outside a section, useSectionBusy does nothing', () => {
    render(<Busy busy />);
    expect(inside()).not.toBeNull();
  });
});
