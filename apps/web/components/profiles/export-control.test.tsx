// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  EXPORT_CSV_LABEL,
  NAV_LINK_CLASS,
  NOTHING_TO_EXPORT,
  athleteExportPath,
} from '@/lib/constants';

import { EXPORT_REASON_CLASS, ExportControl } from './export-control';

const ID = '019826b4-0000-7000-8000-00000000e201';

afterEach(cleanup);

/**
 * The export control's three states (FAM-1 export follow-up, plan PR B). The day page is an async
 * Server Component and no e2e can sign in as a member, so this is the one check that a non-owner
 * sees neither the link nor the reason.
 */
describe('ExportControl', () => {
  it('the owner, history logged: the download link, and nothing else', () => {
    const { container } = render(
      <ExportControl profileId={ID} hasHistory canExport surface="day" />,
    );
    const link = container.querySelector('a[download]');
    expect(link?.getAttribute('href')).toBe(athleteExportPath(ID));
    expect(link?.textContent).toBe(EXPORT_CSV_LABEL);
    // The owner's rendering is the one this PR must not change: the 44px bar's class, exactly.
    expect(link?.className).toBe(NAV_LINK_CLASS);
    expect(container.textContent).not.toContain(NOTHING_TO_EXPORT);
  });

  it('the owner, nothing logged: the reason, never a link (decision N3), styled per surface', () => {
    for (const surface of ['day', 'settings'] as const) {
      const { container } = render(
        <ExportControl profileId={ID} hasHistory={false} canExport surface={surface} />,
      );
      expect(container.querySelector('a')).toBeNull();
      expect(container.textContent).toBe(NOTHING_TO_EXPORT);
      expect(container.querySelector('p')?.className).toBe(EXPORT_REASON_CLASS[surface]);
      cleanup();
    }
    // The day page's reason is its bar's class plus centring, exactly as before this PR.
    expect(EXPORT_REASON_CLASS.day).toBe(`${NAV_LINK_CLASS} flex items-center`);
  });

  it('🔴 not the owner: neither the link nor the reason, whatever the history', () => {
    for (const hasHistory of [true, false]) {
      const { container } = render(
        <ExportControl profileId={ID} hasHistory={hasHistory} canExport={false} surface="day" />,
      );
      expect(container.querySelector('a')).toBeNull();
      expect(container.textContent).toBe('');
      cleanup();
    }
  });

  it('carries the caller’s accessible name, which contains the visible text (SC 2.5.3)', () => {
    const { container } = render(
      <ExportControl
        profileId={ID}
        hasHistory
        canExport
        surface="settings"
        ariaLabel={`${EXPORT_CSV_LABEL} for A`}
      />,
    );
    expect(container.querySelector('a')?.getAttribute('aria-label')).toBe(
      `${EXPORT_CSV_LABEL} for A`,
    );
  });
});
