import { captureScreenshot } from './capture';

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
  const route = process.argv[2] ?? '/';
  const baseUrl = process.env.SCREENSHOT_BASE_URL ?? 'http://localhost:3996';
  await captureScreenshot({ route, baseUrl });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
