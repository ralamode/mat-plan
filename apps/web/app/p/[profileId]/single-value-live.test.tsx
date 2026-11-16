// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AMEND_ERROR_COPY, BODYWEIGHT_COPY } from '@/lib/constants';

import { type Report, SingleValueLive, useSingleValueLive } from './single-value-live';

// COMPONENT TIER (RTL/jsdom). V1-24 3b-bw, plan W6: the island's own rules, apart from any row.
afterEach(cleanup);

let reportFn: (r: Report) => void = () => {};

/** A reporter, plus a target that mounts on demand, so both orders of result and mount are drivable. */
function Harness({ withTarget }: { withTarget: boolean }) {
  const live = useSingleValueLive();
  useEffect(() => {
    reportFn = live.report;
  });
  return withTarget ? (
    <button type="button" ref={live.focusRef('change')}>
      Change
    </button>
  ) : (
    <button type="button">Other</button>
  );
}

const tree = (withTarget: boolean, day = 'd1') => (
  <SingleValueLive key={day}>
    <Harness withTarget={withTarget} />
  </SingleValueLive>
);
const report = (r: Partial<Report> = {}) =>
  act(() =>
    reportFn({ message: BODYWEIGHT_COPY.announcedLogged, tone: 'sr', focus: ['change'], ...r }),
  );

describe('SingleValueLive', () => {
  it('a repeated message is a NEW text node, so it is read again', () => {
    render(tree(true));
    report();
    const first = screen.getByRole('status').firstChild;
    report();
    const second = screen.getByRole('status').firstChild;
    expect(second?.textContent).toBe(BODYWEIGHT_COPY.announcedLogged);
    expect(second).not.toBe(first);
  });

  it('focuses a target that is already mounted, at once', () => {
    render(tree(true));
    report();
    expect(document.activeElement?.textContent).toBe('Change');
  });

  it('a claim made before the target mounts is taken when it mounts', () => {
    const { rerender } = render(tree(false));
    report();
    expect(document.activeElement).toBe(document.body);
    rerender(tree(true));
    expect(document.activeElement?.textContent).toBe('Change');
  });

  it('a claim is used once: a later mount of the same target does not take focus again', () => {
    const { rerender } = render(tree(false));
    report();
    rerender(tree(true));
    (document.activeElement as HTMLElement).blur();
    rerender(tree(false));
    rerender(tree(true));
    expect(document.activeElement).toBe(document.body);
  });

  it('the person’s own tap ends a claim still waiting', () => {
    const { rerender } = render(tree(false));
    report();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Other' }));
    rerender(tree(true));
    expect(document.activeElement).toBe(document.body);
  });

  it('a result after the person moved on does not pull focus back', () => {
    render(
      <>
        <input aria-label="elsewhere" />
        {tree(true)}
      </>,
    );
    screen.getByLabelText('elsewhere').focus();
    report();
    expect(document.activeElement).toBe(screen.getByLabelText('elsewhere'));
  });

  it('dismiss drops a shown refusal', () => {
    let dismiss = () => {};
    function Dismisser() {
      const live = useSingleValueLive();
      useEffect(() => {
        dismiss = live.dismiss;
      });
      return null;
    }
    render(
      <SingleValueLive>
        <Harness withTarget />
        <Dismisser />
      </SingleValueLive>,
    );
    report({ tone: 'alert', message: AMEND_ERROR_COPY.staleWrite });
    expect(screen.getByRole('alert')).toBeTruthy();
    act(() => dismiss());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('throws outside its provider, so a row cannot lose its announcements silently', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Harness withTarget />)).toThrow(/SingleValueLive/);
    spy.mockRestore();
  });

  it('a day change drops a waiting claim', () => {
    const { rerender } = render(tree(false, 'd1'));
    report();
    rerender(tree(true, 'd2'));
    expect(document.activeElement).toBe(document.body);
  });

  it('a target focused just before it unmounts hands the claim to the one that replaces it', () => {
    function Swap() {
      const live = useSingleValueLive();
      useEffect(() => {
        reportFn = live.report;
      });
      const [old, setOld] = useState(true);
      return old ? (
        <input
          aria-label="old field"
          ref={live.focusRef('field')}
          onBlur={() => {}}
          data-swap
          onChange={() => setOld(false)}
        />
      ) : (
        <input aria-label="new field" ref={live.focusRef('field')} />
      );
    }
    render(
      <SingleValueLive>
        <Swap />
      </SingleValueLive>,
    );
    report({ focus: ['field'] });
    expect(document.activeElement).toBe(screen.getByLabelText('old field'));
    act(() => {
      fireEvent.change(screen.getByLabelText('old field'), { target: { value: 'x' } });
    });
    expect(document.activeElement).toBe(screen.getByLabelText('new field'));
  });

  it('a status is shown as well as spoken; a spoken-only one is sr-only', () => {
    render(tree(true));
    report({ tone: 'status', message: BODYWEIGHT_COPY.announcedCleared('84.5 lb') });
    expect(screen.getByRole('status').className).not.toContain('sr-only');
    report({ tone: 'sr' });
    expect(screen.getByRole('status').className).toContain('sr-only');
  });

  it('an alert is its own role="alert" element, and does not erase a shown status', () => {
    render(tree(true));
    report({ tone: 'status', message: BODYWEIGHT_COPY.announcedCleared('84.5 lb') });
    report({
      tone: 'alert',
      message: AMEND_ERROR_COPY.staleWrite,
    });
    expect(screen.getByRole('alert').textContent).toBe(AMEND_ERROR_COPY.staleWrite);
    expect(screen.getByRole('status').textContent).toBe(
      BODYWEIGHT_COPY.announcedCleared('84.5 lb'),
    );
  });
});
