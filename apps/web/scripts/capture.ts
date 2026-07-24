import { mkdir } from 'node:fs/promises';

import { chromium } from '@playwright/test';

import { gateLogin } from '../e2e/gate-login';

/**
 * Shared Playwright capture: log through the access gate (the SAME `gate-login.ts`
 * helper the E2E smoke uses), navigate to a route, and write a full-page PNG PER
 * VIEWPORT to the gitignored `.screenshots/` folder. ONE capture path, two callers —
 * the plain `screenshot.ts` (server already running) and `screenshot-ephemeral.ts`
 * (boots its own throwaway server). Reads `ACCESS_GATE_PASSWORD` via `gateLogin`.
 *
 * ADAPTIVE-BY-DEFAULT (AGENTS.md UI rules): the kids use this primarily on phones and
 * tablets, so every capture is taken at mobile + tablet + desktop widths — the reviewer
 * sees the primary experience, not just desktop. Files are suffixed `-mobile`/`-tablet`/
 * `-desktop`.
 */

/** The widths every UI screenshot is captured at. Phone/tablet get touch + a mobile UA. */
const VIEWPORTS = [
  { suffix: 'mobile', width: 390, height: 844, touch: true }, // ~iPhone 14
  { suffix: 'tablet', width: 820, height: 1180, touch: true }, // ~iPad Air portrait
  { suffix: 'desktop', width: 1280, height: 900, touch: false },
] as const;

/** Slugify a route into a stable screenshot filename (matches the pre-refactor script). */
export function routeSlug(route: string): string {
  return route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home';
}

/**
 * Capture `route` at every viewport in {@link VIEWPORTS}. Returns the written paths.
 * Each viewport is its own browser context (own login) so the mobile UA/touch flags
 * apply cleanly.
 */
export async function captureScreenshot(opts: {
  route: string;
  baseUrl: string;
  /** Filename stem (no extension). Defaults to a slug of the route. */
  name?: string;
}): Promise<string[]> {
  const name = opts.name ?? routeSlug(opts.route);
  await mkdir('.screenshots', { recursive: true });

  const browser = await chromium.launch();
  const paths: string[] = [];
  try {
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({
        baseURL: opts.baseUrl,
        // WIDTH drives the layout (Tailwind breakpoints are width-based). touch + mobile
        // emulation on phone/tablet make it realistic (chromium-only, which we launch).
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: vp.touch ? 2 : 1,
        isMobile: vp.touch,
        hasTouch: vp.touch,
      });
      const page = await context.newPage();
      await gateLogin(page);
      await page.goto(opts.route, { waitUntil: 'networkidle' });
      const path = `.screenshots/${name}-${vp.suffix}.png`;
      await page.screenshot({ path, fullPage: true });
      paths.push(path);
      console.log(`✓ ${vp.suffix} (${vp.width}px): ${path}`);
      await context.close();
    }
    return paths;
  } finally {
    await browser.close();
  }
}
