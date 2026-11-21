/**
 * The two e2e servers' origins, defined once and imported by `playwright.config.ts` and every spec
 * that needs both (`docs/plans/td-signed-out-e2e.md`).
 *
 * - `APP_ORIGIN`: the bypassed server, where every request carries the fixture principal.
 * - `SIGNED_OUT_ORIGIN`: the same build with the bypass disarmed, so its visitors are genuinely
 *   signed out. With no Clerk keys in the harness it takes the dark branch (`lib/dal/session.ts:77`,
 *   `proxy.ts:172`); everything after the session comes back `null` is the code under test.
 *
 * ⚠️ **No imports**, so the config can load it before anything else; `e2e/contexts.ts` imports
 * `@playwright/test` and `lib/constants`. `e2e-local.ts` passes both ports from `freePort()`; the
 * defaults are CI's.
 */
export const APP_PORT = Number(process.env.E2E_PORT ?? 3100);
export const SIGNED_OUT_PORT = Number(process.env.E2E_SIGNED_OUT_PORT ?? 3101);
export const APP_ORIGIN = `http://localhost:${APP_PORT}`;
export const SIGNED_OUT_ORIGIN = `http://localhost:${SIGNED_OUT_PORT}`;
