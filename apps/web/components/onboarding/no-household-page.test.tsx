// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { APP_HOME_PATH, HOME_LINK, NO_HOUSEHOLD_COPY } from '@/lib/constants';

import { NoHouseholdPage } from './no-household-page';

afterEach(cleanup);

describe('NoHouseholdPage', () => {
  it('supplies the h1 NoHouseholdState needs, and a way back to the picker above it', () => {
    render(<NoHouseholdPage />);
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings.map((h) => h.textContent)).toEqual([NO_HOUSEHOLD_COPY.heading]);
    const home = screen.getByRole('link', { name: HOME_LINK });
    expect(home.getAttribute('href')).toBe(APP_HOME_PATH);
    // Above the heading: the way out comes first in reading and tab order.
    expect(
      home.compareDocumentPosition(headings[0]!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
