import { expect, test } from '@playwright/test';

import { GATE_PATH } from '../lib/access-gate';
import { APP_HOME_PATH, BODYWEIGHT_COPY, PICKER_COPY } from '../lib/constants';

import { SEED_PROFILE_ROUTE } from './steps';

/**
 * SEC-1: a prefetch-flagged request must meet the gate like any other.
 *
 * The proxy matcher used to EXCLUDE requests carrying a prefetch header, and any client can send
 * one, so such a request skipped the gate and got the page. Pages and Server Actions now also
 * re-check the gate themselves (lib/dal/gate.ts), so this holds even if the matcher regresses.
 * A fresh context with no cookies: the project's storageState must not leak in.
 */
const PREFETCH_HEADERS: Record<string, string>[] = [
  { 'next-router-prefetch': '1' },
  { purpose: 'prefetch' },
];

/** Text only the gated app renders. If any reaches an un-gated response, household content leaked. */
const APP_CONTENT_MARKERS = [BODYWEIGHT_COPY.heading, PICKER_COPY.heading];

const GATED_ROUTES = [
  APP_HOME_PATH,
  SEED_PROFILE_ROUTE,
  `${SEED_PROFILE_ROUTE}/routine`,
  `${SEED_PROFILE_ROUTE}/export`,
];

for (const route of GATED_ROUTES) {
  for (const header of PREFETCH_HEADERS) {
    test(`un-gated ${route} with ${Object.keys(header)[0]} goes to the gate`, async ({
      browser,
    }) => {
      const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      const res = await context.request.get(route, { headers: header, maxRedirects: 0 });
      // The proxy layer: a real redirect to the gate.
      expect(res.status()).toBeGreaterThanOrEqual(300);
      expect(res.status()).toBeLessThan(400);
      expect(new URL(res.headers().location ?? '', 'http://x').pathname).toBe(GATE_PATH);
      // The outcome either layer must guarantee: none of the app's content. (With only the page
      // guard, Next streams a 200 whose body is just the in-band redirect; that still passes this.)
      const body = await res.text();
      for (const content of APP_CONTENT_MARKERS) expect(body).not.toContain(content);
      await context.close();
    });
  }
}

// OSS-2: `/` is PUBLIC, so a prefetch of it is served — and must carry none of the app's content.
for (const header of PREFETCH_HEADERS) {
  test(`un-gated / with ${Object.keys(header)[0]} is the public landing, with no app content`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const res = await context.request.get('/', { headers: header, maxRedirects: 0 });
    expect(res.status()).toBe(200);
    const body = await res.text();
    for (const content of APP_CONTENT_MARKERS) expect(body).not.toContain(content);
    await context.close();
  });
}
