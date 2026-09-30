// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { BODYWEIGHT_COPY } from '@/lib/constants';

import { SavedAnnouncer } from './saved-announcer';

// COMPONENT TIER (RTL/jsdom — the profile-tile.test.tsx idiom). V1-24 PR 1a, plan acceptance 6.
afterEach(cleanup);

const FOCUS_ID = 'saved-target';
const SAVED = BODYWEIGHT_COPY.announced('84.5 lb');

/** The announcer plus a focus target standing in for the server-rendered receipt. */
function Harness({ saved }: { saved: string | null }) {
  return (
    <>
      <SavedAnnouncer saved={saved} focusId={FOCUS_ID} />
      {saved ? (
        <div id={FOCUS_ID} tabIndex={-1}>
          receipt
        </div>
      ) : (
        <button type="submit">Log weight</button>
      )}
    </>
  );
}

describe('SavedAnnouncer', () => {
  it('owns a status region that exists BEFORE the save (a region mounted with the news is not read)', () => {
    render(<Harness saved={null} />);
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('announces on the none → value transition, and moves focus to the saved row', () => {
    const { rerender } = render(<Harness saved={null} />);
    screen.getByRole('button', { name: 'Log weight' }).focus();

    rerender(<Harness saved={SAVED} />);

    expect(screen.getByRole('status').textContent).toBe(SAVED);
    // Not <body>: the submit button that held focus has unmounted.
    expect(document.activeElement?.id).toBe(FOCUS_ID);
  });

  it('does NOT announce or steal focus on first render — opening a logged day is silent', () => {
    render(<Harness saved={SAVED} />);
    expect(screen.getByRole('status').textContent).toBe('');
    expect(document.activeElement).toBe(document.body);
  });

  it('does not re-announce when an already-saved value merely re-renders', () => {
    const { rerender } = render(<Harness saved={SAVED} />);
    rerender(<Harness saved={SAVED} />);
    expect(screen.getByRole('status').textContent).toBe('');
  });
});
