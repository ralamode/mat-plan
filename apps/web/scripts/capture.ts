import { mkdir } from 'node:fs/promises';

import { chromium, type Page } from '@playwright/test';

import { gateLogin } from '../e2e/gate-login';
import { GATE_PATH, isPublicPath } from '../lib/access-gate';
import { COOKIE_MAX_AGE, TZ_COOKIE_NAME } from '../lib/constants';

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
  /**
   * IANA zone to emulate in the browser (V1-10). The app derives "today" — and therefore the day's
   * PROGRAM — from the device's local calendar date (V1-6c: `TimeZoneSync` reports the browser zone via
   * the `tz` cookie, and the RSC re-renders on it). Setting this captures a screen as it renders on a
   * chosen local day, which is the only way to shoot a weekday-conditional surface (the Mon/Wed/Fri
   * program card) without waiting for that weekday. Omitted → the host's zone, the normal case.
   */
  timeZone?: string;
  /**
   * Optional post-navigation interaction, run before the shot. Some states only exist AFTER a tap —
   * GAP-1 P1-1c's "Skipped checked" collapses the set rows, and a set marked sub-failure — and a
   * reviewer approving a UI change needs to see those, not just the pristine load. Runs once per
   * viewport (each gets a fresh context), so it must be idempotent from a clean page.
   */
  interact?: (page: Page) => Promise<void>;
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
        ...(opts.timeZone ? { timezoneId: opts.timeZone } : {}),
      });
      if (opts.timeZone) {
        // Seed the `tz` cookie DIRECTLY, don't rely on `TimeZoneSync` writing it. `timezoneId` only
        // changes what the BROWSER reports; the RSC reads the cookie. The gate login lands on the
        // picker (`APP_HOME_PATH`), which doesn't render TimeZoneSync, so without this the first paint uses DEFAULT_TIME_ZONE and
        // the correct day arrives only via a post-hydration `router.refresh()` — a race against
        // `networkidle` that, when lost, silently yields a screenshot of the WRONG WEEKDAY. That is the
        // one failure this flag exists to prevent, on the artifact a reviewer approves from.
        await context.addCookies([
          {
            name: TZ_COOKIE_NAME,
            value: opts.timeZone,
            url: opts.baseUrl,
            expires: Math.floor(Date.now() / 1000) + COOKIE_MAX_AGE,
            sameSite: 'Lax',
          },
        ]);
      }
      const page = await context.newPage();
      // A public route — and the gate itself — is captured as a stranger sees it: logged in, the proxy
      // sends both `/` and `/gate` to the picker.
      const pathname = new URL(opts.route, opts.baseUrl).pathname;
      if (!isPublicPath(pathname) && pathname !== GATE_PATH) await gateLogin(page);
      await page.goto(opts.route, { waitUntil: 'networkidle' });
      if (opts.interact) await opts.interact(page);
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
