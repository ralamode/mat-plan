import { mkdir } from 'node:fs/promises';

import { chromium } from '@playwright/test';

import { gateLogin } from '../e2e/gate-login';

/**
 * Shared Playwright capture: log through the access gate (the SAME `gate-login.ts`
 * helper the E2E smoke uses), navigate to a route, and write a full-page PNG to the
 * gitignored `.screenshots/` folder. ONE capture path, two callers — the plain
 * `screenshot.ts` (server already running) and `screenshot-ephemeral.ts` (boots its
 * own throwaway server). Reads `ACCESS_GATE_PASSWORD` via `gateLogin`.
 */

/** Slugify a route into a stable screenshot filename (matches the pre-refactor script). */
export function routeSlug(route: string): string {
  return route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home';
}

export async function captureScreenshot(opts: {
  route: string;
  baseUrl: string;
  /** Filename stem (no extension). Defaults to a slug of the route. */
  name?: string;
}): Promise<string> {
  const name = opts.name ?? routeSlug(opts.route);
  await mkdir('.screenshots', { recursive: true });

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: opts.baseUrl });
    const page = await context.newPage();
    await gateLogin(page);
    await page.goto(opts.route, { waitUntil: 'networkidle' });
    const path = `.screenshots/${name}.png`;
    await page.screenshot({ path, fullPage: true });
    console.log(`✓ screenshot saved: ${path}`);
    return path;
  } finally {
    await browser.close();
  }
}
