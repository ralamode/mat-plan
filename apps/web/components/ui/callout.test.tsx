// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { Callout } from './callout';

afterEach(cleanup);

/**
 * `Callout` is presentation, so most of it is not worth a test. What IS worth one is the **a11y
 * wiring**, because the add form's entire announcement strategy rests on it: the form moves focus
 * here instead of using `role="alert"`, and a focused `<div>` with no role and no accessible name
 * announces as silence on some screen readers. Three props have to agree for that to work — the
 * `role`, the `aria-labelledby`, and the id on the message paragraph — and nothing else in the repo
 * would notice if one of them were dropped or renamed.
 */
describe('Callout', () => {
  it('announces as a NAMED group, so a programmatic focus move is not silence', () => {
    render(<Callout messageId="m" message="That looks like Ada." />);

    const group = screen.getByRole('group');
    // 🔴 The name comes from the message paragraph via `aria-labelledby`. A bare `role="group"` with
    // no name is the silence this exists to prevent, so assert the NAME, not just the role. There is
    // no `jest-dom` in this repo, so resolve the label by hand — which also pins the indirection
    // rather than trusting a matcher to follow it.
    const labelledBy = group.getAttribute('aria-labelledby');
    expect(labelledBy).toBe('m');
    expect(document.getElementById(labelledBy!)?.textContent).toBe('That looks like Ada.');
  });

  it('is focusable, since focus is how the message gets announced at all', () => {
    render(<Callout message="That looks like Ada." />);

    const group = screen.getByRole('group');
    expect(group.getAttribute('tabindex')).toBe('-1');

    // Not merely focus*able* — actually focused, which is what the form does to it.
    group.focus();
    expect(document.activeElement).toBe(group);
  });

  it('carries NO role="alert": the warning must not interrupt a parent mid-typing', () => {
    render(<Callout message="That looks like Ada." />);

    // A deliberate absence, and the kind of decision a later "make it louder" edit would quietly
    // reverse. The reasoning is recorded in this component's own docblock and in the plan's C6 row
    // (`docs/plans/prof-1-athletes.md`). ⚠️ An earlier version of this comment cited `docs/design.md`
    // too; that file records the border-contrast measurement and nothing about announcement.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('group').getAttribute('aria-live')).toBeNull();
  });

  it('puts the message id on the PARAGRAPH, so aria-describedby reads the sentence not the buttons', () => {
    render(
      <Callout messageId="dupe-msg" message="That looks like Ada.">
        <button type="submit">Add another</button>
      </Callout>,
    );

    // The field points `aria-describedby` at this id. If it landed on the container instead, a
    // screen reader would read "Add another" as part of the field's description.
    const described = document.getElementById('dupe-msg');
    expect(described?.tagName).toBe('P');
    expect(described?.textContent).toBe('That looks like Ada.');
    expect(described?.querySelector('button')).toBeNull();
  });

  it('forwards `ref` to the focusable container, which is how the form reaches it', () => {
    const ref = createRef<HTMLDivElement>();
    render(<Callout ref={ref} message="That looks like Ada." />);

    // React 19 passes `ref` as an ordinary prop — no `forwardRef`. The form holds this ref and calls
    // `.focus()` on it, so it has to be the element carrying `tabindex`, not a wrapper.
    expect(ref.current).toBe(screen.getByRole('group'));
    expect(ref.current?.getAttribute('tabindex')).toBe('-1');
  });

  it('renders no actions container when given no children', () => {
    const { container } = render(<Callout message="That looks like Ada." />);

    // The `children ? … : null` guard. Without it an empty flex row adds a stray gap under every
    // callout that only carries a message.
    expect(container.querySelectorAll('div')).toHaveLength(2); // the group + the mark/message row
  });
});
