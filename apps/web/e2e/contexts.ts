import type { Page } from '@playwright/test';

// Relative imports only: `gate-login.ts` imports this, and the tsx-run screenshot scripts import that.
import { PICKER_COPY } from '../lib/constants';

/**
 * Shared e2e context values (OSS-2). Kept dependency-light (no `@mat-plan/db`, unlike `steps.ts`) so the
 * gate-login helper can use it.
 */

/** A browser context with NO gate cookie. The premise of every un-gated assertion: with the project's
 *  storageState, a "public" page could just be a gated page the cookie let through. */
export const NO_GATE_STATE = { cookies: [], origins: [] };

/** ~iPhone 14, the primary device — the a11y spec, the landing's above-the-fold check. */
export const MOBILE_VIEWPORT = { width: 390, height: 844 };

/** The picker's `<h1>` — what "landed on the app home" looks like. */
export const pickerHeading = (page: Page) =>
  page.getByRole('heading', { name: PICKER_COPY.heading, exact: true, level: 1 });
