// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { THEME_CHOICES, THEME_COPY, THEME_STORAGE_KEY } from '@/lib/constants';

import { ThemeToggle } from './theme-toggle';

/**
 * COMPONENT TIER (RTL/jsdom). `next-themes` is mocked: what is under test is OUR contract — three
 * named radios, exactly one checked, the choice forwarded to `setTheme` — not the library's storage,
 * which belongs to the library and is proven end-to-end by `e2e/theme.spec.ts`.
 */

const setTheme = vi.fn();
let theme: string | undefined = 'system';
vi.mock('next-themes', () => ({ useTheme: () => ({ theme, setTheme }) }));

afterEach(() => {
  cleanup();
  setTheme.mockClear();
  theme = 'system';
});

describe('the control states the whole model', () => {
  it('renders one radio per choice, each with its own accessible name', () => {
    render(<ThemeToggle />);
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(THEME_CHOICES.length);
    for (const choice of THEME_CHOICES) {
      // RTL's getByRole name matching is already exact for a string matcher.
      expect(screen.getByRole('radio', { name: THEME_COPY.option(choice) })).toBeTruthy();
    }
  });

  it('labels the group visibly, so three bare words do not read as a logging control', () => {
    render(<ThemeToggle />);
    // A <legend> inside a <fieldset> gives the group its accessible name.
    expect(screen.getByRole('group', { name: THEME_COPY.legend })).toBeTruthy();
    expect(screen.getByText(THEME_COPY.hint)).toBeTruthy();
  });

  it('keeps the visible word a SUBSTRING of the accessible name (WCAG 2.5.3 Label in Name)', () => {
    for (const choice of THEME_CHOICES) {
      expect(THEME_COPY.option(choice)).toContain(THEME_COPY.labels[choice]);
    }
  });

  it('checks the stored choice, and only that one', () => {
    theme = 'dark';
    render(<ThemeToggle />);
    const checked = screen.getAllByRole('radio').filter((r) => (r as HTMLInputElement).checked);
    expect(checked).toHaveLength(1);
    expect(checked[0]).toHaveProperty('value', 'dark');
  });

  it('forwards a change to setTheme', () => {
    render(<ThemeToggle />);
    screen.getByRole('radio', { name: THEME_COPY.option('dark') }).click();
    expect(setTheme).toHaveBeenCalledWith('dark');
  });
});

describe('the pre-mount render — the one that decides whether the page shifts', () => {
  /**
   * `theme` is `undefined` on the server (a localStorage value is unknowable there), so the component
   * has three options and two of them are defects: returning `null` grows the page by ~44px on
   * hydration (a CLS regression on every route it appears on), and rendering three UNCHECKED radios
   * paints a segmented control with nothing selected — "reads as broken when it works".
   *
   * So the server renders the documented default, `Auto`. This asserts that, from the server
   * renderer rather than from jsdom, because jsdom runs the mount effect immediately and would show
   * the settled state instead.
   */
  it('renders Auto checked on the server even when a different theme is stored', () => {
    theme = 'dark';
    const html = renderToString(<ThemeToggle />);
    expect(html).not.toBe('');
    expect((html.match(/checked=""/g) ?? []).length).toBe(1);
    // The checked one is the `system` radio: its input carries that value.
    const systemInput = /<input[^>]*value="system"[^>]*>/.exec(html)?.[0] ?? '';
    expect(systemInput).toContain('checked');
  });
});

describe('the storage key is ours, not the library default', () => {
  it('is namespaced like the gate cookie', () => {
    // The sanctioned contract-test exception: pinning the literal exactly once, on the assertion
    // side. If this moves, the e2e that seeds it before navigation stops proving anything.
    expect(THEME_STORAGE_KEY).toBe('mp_theme');
  });
});
