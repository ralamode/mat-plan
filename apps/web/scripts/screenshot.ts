import { APP_HOME_PATH } from '../lib/constants';
import { captureScreenshot, routeSlug } from './capture';

/**
 * Capture a full-page screenshot of a mat-plan route for a PR, using the SAME
 * gate-login helper the E2E smoke uses. This is the committed graduation of the
 * `ui-screenshot` MCP procedure — no MCP required.
 *
 * Assumes a prod server is ALREADY running (this script does not manage one) and
 * reads that server's own env (`apps/web/.env.local` → live Neon). Prefer
 * `screenshot:ephemeral` (scripts/screenshot-ephemeral.ts), which boots a throwaway
 * embedded Postgres so a capture never touches the live kids' log. Use this only
 * against a server you have deliberately pointed at a DB:
 *   pnpm build && pnpm --filter web exec next start -p 3996
 *   ACCESS_GATE_PASSWORD=<code> pnpm --filter web screenshot /   # or any route
 *
 * Writes to the gitignored `.screenshots/` folder; attach the PNG to the PR
 * (never commit it). See docs/plans/v0-11-ci-postgres-playwright.md and
 * .claude/skills/ui-screenshot/SKILL.md.
 *
 * Body is wrapped in an async main() (not top-level await): apps/web is a CJS
 * package, and tsx transforms this to CJS where top-level await is unsupported.
 */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  // `--theme light|dark` (UI-4), threaded through here too: `capture.ts` is deliberately ONE capture
  // path with two callers, and a flag only the other caller can reach makes that claim false.
  const themeIdx = argv.indexOf('--theme');
  const rawTheme = themeIdx >= 0 ? argv[themeIdx + 1] : undefined;
  if (themeIdx >= 0 && rawTheme !== 'light' && rawTheme !== 'dark') {
    throw new Error(`--theme requires light|dark, got: ${rawTheme ?? ''}`);
  }
  const colorScheme = rawTheme as 'light' | 'dark' | undefined;
  const route = argv.filter((a, i) => !a.startsWith('-') && i !== themeIdx + 1)[0] ?? APP_HOME_PATH;
  const baseUrl = process.env.SCREENSHOT_BASE_URL ?? 'http://localhost:3996';
  // The theme rides the stem, so a light/dark pair sits side by side in `.screenshots/`. `routeSlug`
  // is imported rather than re-derived — it is already the one definition of this filename rule.
  await captureScreenshot({
    route,
    baseUrl,
    colorScheme,
    ...(colorScheme === 'dark' ? { name: `${routeSlug(route)}-dark` } : {}),
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
