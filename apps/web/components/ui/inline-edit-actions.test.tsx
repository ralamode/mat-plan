// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InlineEditActions } from './inline-edit-actions';

afterEach(cleanup);

// Neutral fixtures: the primitive takes any names; the app's copy is tested where it is used.
const SAVE = 'Confirm thing';
const CANCEL = 'Cancel thing';

describe('InlineEditActions', () => {
  it('renders ✓ then ✕, each 44px icon-lg with its name, the ✕ a neutral outline', () => {
    render(
      <InlineEditActions confirm={{ label: SAVE }} cancelLabel={CANCEL} onCancel={() => {}} />,
    );
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([SAVE, CANCEL]);
    expect(buttons.map((b) => b.dataset.size)).toEqual(['icon-lg', 'icon-lg']);
    expect(buttons[0]!.getAttribute('type')).toBe('submit');
    expect(buttons[1]!.getAttribute('type')).toBe('button');
    expect(buttons[1]!.dataset.variant).toBe('outline');
    // Never red: no destructive text, fill or edge (the base's `aria-invalid:` state aside).
    expect(buttons[1]!.className).not.toMatch(/(^|\s)(text|bg|border)-destructive/);
  });

  it('without confirm, the ✕ renders alone', () => {
    render(<InlineEditActions cancelLabel={CANCEL} onCancel={() => {}} />);
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      CANCEL,
    ]);
  });

  it('passes the pointer handlers through, and onClick still cancels', () => {
    const onCancel = vi.fn();
    const onPointerDown = vi.fn();
    const onPointerCancel = vi.fn();
    render(
      <InlineEditActions
        cancelLabel={CANCEL}
        onCancel={onCancel}
        cancelHandlers={{ onPointerDown, onPointerCancel }}
      />,
    );
    const x = screen.getByRole('button', { name: CANCEL });
    fireEvent.pointerDown(x);
    fireEvent.pointerCancel(x);
    fireEvent.click(x);
    expect([onPointerDown, onPointerCancel, onCancel].map((f) => f.mock.calls.length)).toEqual([
      1, 1, 1,
    ]);
  });

  it('pending: the ✓ keeps its name, busy and disabled; the ✕ is hidden, not disabled', () => {
    render(
      <InlineEditActions
        confirm={{ label: SAVE }}
        cancelLabel={CANCEL}
        onCancel={() => {}}
        pending
      />,
    );
    const tick = screen.getByRole('button', { name: SAVE });
    expect(tick.getAttribute('aria-busy')).toBe('true');
    expect((tick as HTMLButtonElement).disabled).toBe(true);
    const x = screen.getByRole('button', { name: CANCEL, hidden: true });
    // Hidden at once: no ~150ms `transition-all` window in which it is still painted and clickable.
    expect(x.className).toMatch(/\binvisible\b/);
    expect(x.className).toMatch(/\bpointer-events-none\b/);
    expect(x.className).toMatch(/\btransition-none\b/);
    expect((x as HTMLButtonElement).disabled).toBe(false);
  });

  it('describes both buttons and applies the focus class to both', () => {
    render(
      <InlineEditActions
        confirm={{ label: SAVE }}
        cancelLabel={CANCEL}
        onCancel={() => {}}
        describedBy="line-1"
        focusClassName="focus-on-tint"
      />,
    );
    for (const b of screen.getAllByRole('button')) {
      expect(b.getAttribute('aria-describedby')).toBe('line-1');
      expect(b.className).toMatch(/\bfocus-on-tint\b/);
    }
  });
});
