import type { Page } from '@playwright/test';

// Relative imports only: the tsx-run screenshot scripts reach this through `capture.ts`.
import { PICKER_COPY } from '../lib/constants';

/**
 * Shared e2e context values (OSS-2). Kept dependency-light (no `@mat-plan/db`, unlike `steps.ts`).
 *
 * ⚠️ **`NO_GATE_STATE` was deleted at AUTH-1 1d, not renamed.** It was `{ cookies: [], origins: [] }`
 * — an empty jar, used to opt a spec OUT of the gate-authenticated `storageState`. There is no
 * authenticated state to opt out of any more: the harness session comes from the process env
 * (`E2E_SESSION_BYPASS_USER_ID`), which a cookie jar cannot override. 🔴 Renaming it
 * `NO_SESSION_STATE` would have asserted exactly that false property, which is why it is gone
 * instead. A spec that needs an unauthenticated server needs a SECOND SERVER — see `tech-debt.md`.
 */

/** ~iPhone 14, the primary device — the a11y spec, the landing's above-the-fold check. */
export const MOBILE_VIEWPORT = { width: 390, height: 844 };

/**
 * The NARROWEST width AGENTS.md commits to ("every screen must work from ~360px up"). 390 is the
 * device; **360 is the contract**, and the two are not the same test — the strength set row's own
 * comments budget against the ~294px of usable width that only exists at 360.
 *
 * Lifted here at PROF-1 a-r, when `athletes.spec.ts` became the second spec to need it and declared
 * a copy whose comment read "mirrors `a11y.spec.ts`'s own constant" — a copy that knew it was one.
 */
export const NARROW_VIEWPORT = { width: 360, height: 780 };

/** The picker's `<h1>` — what "landed on the app home" looks like. */
export const pickerHeading = (page: Page) =>
  page.getByRole('heading', { name: PICKER_COPY.heading, exact: true, level: 1 });
