import { mkdir } from 'node:fs/promises';

import { chromium } from '@playwright/test';

import { gateLogin } from '../e2e/gate-login';

/**
 * Capture a full-page screenshot of a mat-plan route for a PR, using the SAME
 * gate-login helper the E2E smoke uses. This is the committed graduation of the
 * `ui-screenshot` MCP procedure — no MCP required.
 *
 * Assumes a prod server is already running (mirrors the skill's flow):
 *   pnpm build && pnpm --filter web start -- -p 3996
 *   pnpm --filter web screenshot /            # or any route
 *
 * Writes to the gitignored `.screenshots/` folder; attach the PNG to the PR
 * (never commit it). See docs/plans/v0-11-ci-postgres-playwright.md and
 * .claude/skills/ui-screenshot/SKILL.md.
 */
const route = process.argv[2] ?? '/';
const base = process.env.SCREENSHOT_BASE_URL ?? 'http://localhost:3996';
const name = route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home';

await mkdir('.screenshots', { recursive: true });

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ baseURL: base });
  const page = await context.newPage();
  await gateLogin(page);
  await page.goto(route, { waitUntil: 'networkidle' });
  const path = `.screenshots/${name}.png`;
  await page.screenshot({ path, fullPage: true });
  console.log(`✓ screenshot saved: ${path}`);
} finally {
  await browser.close();
}
