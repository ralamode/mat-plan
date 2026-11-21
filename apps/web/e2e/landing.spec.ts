import { join } from 'node:path';

import { newId, SEED_PROFILE_2_NAME, SEED_PROFILE_NAME } from '@mat-plan/shared';
import { expect, test, type Page, type Request } from '@playwright/test';

import { PUBLIC_PATH_TREES, PUBLIC_PATHS } from '../lib/public-paths';
import { MIN_PROTECTED_PAGES, protectedPageFiles, routeOf } from './app-routes';
import {
  APP_HOME_PATH,
  APP_NAME,
  FOOTER_COPY,
  GITHUB_REPO_URL,
  LANDING_COPY,
  NO_PROFILE_SAVE,
  PICKER_COPY,
  ROUTINE_COPY,
  SIGN_IN_PATH,
} from '../lib/constants';

import { MOBILE_VIEWPORT } from './contexts';
import { APP_ORIGIN, SIGNED_OUT_ORIGIN } from '../playwright.config';
import { SEED_PROFILE_ROUTE } from './steps';

/**
 * OSS-2 §A — the public landing at `/`.
 *
 * 🔴 **The `public` cases run on the SIGNED-OUT server** (`SIGNED_OUT_ORIGIN`,
 * `docs/plans/td-signed-out-e2e.md`): the same build with the bypass disarmed, so "a stranger sees
 * this" is what they assert. Before that server existed (AUTH-1 1d until 2026-11-20) the harness
 * armed a principal process-wide, and these cases could only assert what the page rendered.
 */

/** What must never reach a stranger: the seeded athletes, the app home, and internals. */
const STRANGER_MUST_NOT_SEE = [
  SEED_PROFILE_NAME,
  SEED_PROFILE_2_NAME,
  PICKER_COPY.heading,
  ' at ',
  'node_modules',
  '/apps/web/',
];

/** Each dynamic segment (`[id]`, `[...rest]`, `[[...rest]]`) filled with a fresh id. */
const withFreshIds = (route: string) => route.replace(/\[\[?(\.\.\.)?[^\]]+\]\]?/g, () => newId());

test.describe('public', () => {
  test.use({ viewport: MOBILE_VIEWPORT, baseURL: SIGNED_OUT_ORIGIN });

  test('/ is the landing, with both CTAs above the fold', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL('/');
    await expect(
      page.getByRole('heading', { level: 1, name: APP_NAME, exact: true }),
    ).toBeVisible();
    await expect(page.getByText(LANDING_COPY.lead, { exact: true })).toBeVisible();

    const source = page.getByRole('link', { name: LANDING_COPY.sourceCta, exact: true });
    const signIn = page.getByRole('link', { name: LANDING_COPY.signInCta, exact: true });
    await expect(source).toHaveAttribute('href', `${GITHUB_REPO_URL}${LANDING_COPY.sourceAnchor}`);
    // Before any scroll: a stranger on a phone sees what they can do without hunting for it.
    await expect(source).toBeInViewport();
    await expect(signIn).toBeInViewport();
  });

  // 🔴 **The successor to "sign-in leads to the gate, which links back" (AUTH-1 1d).** The CTA now
  // points at `/sign-in` instead of `/gate`, and the way back is the mark rather than a text link —
  // the sign-in screen hides `SiteFooter` and carries its own copies of both links, so this is also
  // the round-trip proof for that decision.
  test('Household sign-in leads to /sign-in, which links back', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: LANDING_COPY.signInCta, exact: true }).click();
    await expect(page).toHaveURL(SIGN_IN_PATH);
    // The mark's SVG is aria-hidden, so the link's accessible name is its sr-only text.
    await page.getByRole('link', { name: FOOTER_COPY.home, exact: true }).click();
    await expect(page).toHaveURL('/');
  });

  /**
   * 🔴 **Proof 1: every protected page refuses a stranger** (`docs/plans/td-signed-out-e2e.md`). The
   * successor to "the app itself is still gated", deleted at AUTH-1 1d, which checked `/p` alone.
   *
   * - **The pages** are every `page.tsx` under `app/` whose route is not `isPublicPath()`, read from
   *   the file system (`e2e/app-routes.ts`, the list `app/pages-need-a-session.test.ts` checks
   *   statically). The design previews are included.
   * - **(a) Where it lands:** the redirect chain is exactly `[route, SIGN_IN_PATH]`. A chain with
   *   an extra hop fails: `/programs` with its session check deleted bounces through `/p`.
   * - **(b) What is on the wire:** the first response's body holds none of `STRANGER_MUST_NOT_SEE`,
   *   so a 200 shell is checked too.
   *
   * ⚠️ **Followed over HTTP, not read from the browser** (a deviation from the plan, after two CI
   * runs). The browser's navigation events leaked a late hop from the previous page into the next
   * page's chain, and lost a 307's history. Over HTTP, each hop is a 3xx `Location`, or the
   * `__next-page-redirect` meta Next streams when a redirect is thrown under a `loading.tsx`. That
   * meta is what a browser follows, so the chain is the same one a visitor takes.
   *
   * Soft, so one failing page names every other one. The redirect proves the page refused. It cannot
   * show the session check ran before any data read, which stays unit-owned.
   */
  test('every protected page sends a stranger to sign-in, with nothing on the wire', async ({
    request,
  }) => {
    const appDir = join(__dirname, '..', 'app');
    const files = protectedPageFiles(appDir);
    expect(files.length, 'an empty glob would pass every page').toBeGreaterThanOrEqual(
      MIN_PROTECTED_PAGES,
    );
    for (const file of files) {
      const route = withFreshIds(routeOf(appDir, file));
      const chain = [route];
      let body = '';
      for (let url = route, hop = 0; hop < 5; hop++) {
        const res = await request.get(url, { maxRedirects: 0 });
        const text = await res.text();
        if (hop === 0) body = text;
        const meta = text.match(/<meta[^>]*__next-page-redirect[^>]*>/)?.[0];
        const next =
          res.status() >= 300 && res.status() < 400
            ? res.headers()['location']
            : meta?.match(/content="\d+;\s*url=([^"]+)"/)?.[1];
        if (!next) break;
        url = new URL(next, SIGNED_OUT_ORIGIN).pathname;
        chain.push(url);
      }
      expect.soft(chain, `${route}: lands on sign-in in one hop`).toEqual([route, SIGN_IN_PATH]);
      for (const secret of STRANGER_MUST_NOT_SEE)
        expect.soft(body, `${route} sends a stranger "${secret}"`).not.toContain(secret);
    }
  });

  /**
   * 🔴 **Proof 4: the public paths stay public to a stranger.** `app/pages-need-a-session.test.ts`
   * accepts `sessioned || isPublic`, so a public page that gained a session check would pass it, and
   * pass the bypassed suite too. Each leaf of `PUBLIC_PATHS` and each root of `PUBLIC_PATH_TREES`
   * answers 200 with no redirect in the stream (a followed redirect to `/sign-in` would also render
   * an `<h1>`), then stays put in a browser.
   */
  test('every public path answers a stranger itself, with no redirect', async ({
    page,
    request,
  }) => {
    for (const path of [...PUBLIC_PATHS, ...PUBLIC_PATH_TREES]) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect.soft(res.status(), `${path}: status`).toBe(200);
      expect
        .soft(await res.text(), `${path}: redirects from the stream`)
        .not.toContain('__next-page-redirect');
      await page.goto(path);
      await expect.soft(page, `${path}: navigated away`).toHaveURL(path);
    }
  });
});

test.describe('authenticated', () => {
  /**
   * 🔴 **Inverted by AUTH-1 1c-3b, and the inversion is the regression guard.** The proxy used to
   * forward a cookie-holder from `/` to the picker. Once the pages also require a session that
   * became a loop — `/p` → `requireSession()` → `/sign-in`, whose forward controls lead back here —
   * and it meant a visitor holding only the gate cookie could never see the landing at all.
   *
   * ⚠️ Asserted as "the landing renders", not "a sessionless visitor sees the landing": the harness
   * arms a principal process-wide (1c-3a), so no spec here can establish "no session". The proxy
   * reads no session either way, so this still catches the regression it is named for.
   */
  test('/ renders the landing — no forward to the picker', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL('/');
    await expect(
      page.getByRole('link', { name: LANDING_COPY.signInCta, exact: true }),
    ).toBeVisible();
  });
});

/** The routine's labels, in order — the whole routine, not just one row. */
async function routineOrder(page: Page): Promise<string[]> {
  const items = page
    .getByRole('region', { name: ROUTINE_COPY.orderHeading, exact: true })
    .getByRole('listitem');
  await expect(items.first()).toBeVisible();
  return items.evaluateAll((lis) => lis.map((li) => li.querySelector('span')?.textContent ?? ''));
}

/**
 * `/` is an unauthenticated POST endpoint too: Server Actions post to the current URL, and Next
 * forwards an action id the page doesn't own to the page that does. Capture a real action request
 * (the routine editor's Save, on the bypassed server), aborted so it never runs. Then replay it two
 * ways:
 *
 * - **Spoofed, on the bypassed server.** With `x-action-forwarded: 1`, Next skips forwarding and
 *   looks in that page's OWN action map, which must be empty: `pages-need-a-session.test.ts` keeps it
 *   so statically, and this proves it at runtime. Nothing may run: no `"ok":` of either value.
 * - **🔴 As-is, on the SIGNED-OUT server** (proof 2, `docs/plans/td-signed-out-e2e.md`). This is the
 *   arm AUTH-1 1d deleted, back now that a genuinely signed-out server exists. It goes to the routine
 *   path and every public path, with only `next-action`, `content-type` and `accept`: a copied
 *   `origin` would meet Next's CSRF check and 500 before the action. It must be refused with the
 *   exact `NO_PROFILE_SAVE` copy, with nothing a stranger may not see.
 *
 * Its checks are **soft**, so the tail always runs. The tail ("a fresh load still has the original
 * order") is the no-write proof.
 *
 * ⚠️ **What this cannot show:** that no data was read. A missing session and a missing permission are
 * refused byte-identically by design (`app/p/mutation-entry.ts`), so "the entry check runs before any
 * lookup" stays unit-owned (`app/p/[profileId]/actions.test.ts`). Do not cite "no unauthenticated
 * request does DB work" as a runtime property of this suite.
 *
 * ✅ **To be probed red** (recorded when run): drop the second server's `''` override, so it is
 * armed. The Save really runs, and both the soft copy check and the tail ("a replay ran: the routine
 * was saved") go red. Run that probe under `e2e:local` only, because it writes to the seed.
 */
test('a real Server Action replayed by a stranger, or spoofed onto a public path, runs nothing', async ({
  page,
  browser,
}) => {
  const routine = `${SEED_PROFILE_ROUTE}/routine`;
  await page.goto(routine, { waitUntil: 'networkidle' });
  const before = await routineOrder(page);

  let captured: Request | null = null;
  await page.route(routine, async (route) => {
    const request = route.request();
    if (request.method() === 'POST' && request.headers()['next-action']) {
      captured = request;
      await route.abort();
    } else {
      await route.continue();
    }
  });
  // FAM-1 12f PR 5: the seeded athlete's routine now lists one item, whose arrows are `aria-disabled`,
  // so the edit before Save is a Remove. It is still the editor's real Save with a real `next-action`
  // id, captured and aborted; the posted routine turns practice off, so the last assertion below (a
  // fresh load still shows the original order) still fails if any replay ran.
  await page
    .getByRole('button', { name: `Remove ${before[0]} from the routine`, exact: true })
    .click();
  await page.getByRole('button', { name: ROUTINE_COPY.save, exact: true }).click();
  await expect.poll(() => captured).not.toBeNull();
  const request = captured as unknown as Request;
  const headers = request.headers();
  const data = request.postDataBuffer();
  expect(data, 'the captured Save has a body to replay').not.toBeNull();
  const actionHeaders = {
    'next-action': headers['next-action']!,
    'content-type': headers['content-type']!,
    accept: 'text/x-component',
  };

  const replayCtx = await browser.newContext();
  // Every public path, not just `/` (PRIV-2): each one is an unauthenticated POST endpoint on the
  // same terms, so a new entry in `PUBLIC_PATHS` inherits this runtime proof.
  for (const publicPath of PUBLIC_PATHS) {
    const label = `${publicPath} spoofed-forwarded replay`;
    const res = await replayCtx.request.post(`${APP_ORIGIN}${publicPath}`, {
      headers: { ...actionHeaders, 'x-action-forwarded': '1' },
      data: data!,
      maxRedirects: 0,
    });
    const body = await res.text();
    expect(body, `${label}: the action ran`).not.toMatch(/"ok":(true|false)/);
    for (const leak of [' at ', 'node_modules', '/apps/web/', PICKER_COPY.heading]) {
      expect(body, `${label} leaks "${leak}"`).not.toContain(leak);
    }
  }
  for (const target of [routine, ...PUBLIC_PATHS]) {
    const label = `${target} as-is replay by a stranger`;
    const res = await replayCtx.request.post(`${SIGNED_OUT_ORIGIN}${target}`, {
      headers: actionHeaders,
      data: data!,
      maxRedirects: 0,
    });
    const body = await res.text();
    expect.soft(res.status(), `${label}: status`).toBe(200);
    expect
      .soft(res.headers()['x-nextjs-action-not-found'], `${label}: action not found`)
      .toBeUndefined();
    expect.soft(body, `${label}: not refused with the no-session copy`).toContain(NO_PROFILE_SAVE);
    for (const secret of STRANGER_MUST_NOT_SEE)
      expect.soft(body, `${label} sends a stranger "${secret}"`).not.toContain(secret);
  }
  await replayCtx.close();

  // Changes nothing: a fresh load still has the original order.
  await page.unroute(routine);
  await page.goto(routine, { waitUntil: 'networkidle' });
  // Named first, so a replay that ran fails here with its cause: the posted routine (practice removed)
  // leaves the editor empty, and `routineOrder` would otherwise just time out waiting for a row.
  await expect(
    page.getByText('No activities yet', { exact: false }),
    'a replay ran: the routine was saved',
  ).toHaveCount(0);
  expect(await routineOrder(page)).toEqual(before);
});

/**
 * 🔴 **SEC-1's runtime witness, and it is a REPLACEMENT for a proof `1d` deleted.**
 *
 * `e2e/gate-prefetch.spec.ts` was the only runtime evidence that a request carrying a prefetch
 * header still goes through the proxy. SEC-1's scar was a `missing:` matcher condition that let any
 * such request skip the proxy entirely, and that spec proved it by watching the gate bounce. `1d`
 * deletes the bounce, so the spec had to go — but its SUBJECT did not, and deleting it without this
 * would have left the regression caught by nothing at runtime.
 *
 * ⚠️ **After `1d` the regression fails QUIETLY, which is why a runtime witness still matters.**
 * `auth()` throws when `clerkMiddleware()` did not run, so a re-introduced exclusion makes the route
 * 500 or refuse — which an ordinary spec reads as "redirected to sign-in" and passes.
 *
 * 🔴 **The witness is the CSP header, not page content.** `withSecurityHeaders` is called from
 * nowhere but `proxy()` (verified: an unconditional early `return` in `proxy()` makes the header
 * `undefined`), so its presence proves the proxy ran on THIS request — a claim that survives the
 * harness bypass, where "no app content on the wire" cannot be asserted at all because every request
 * is authenticated. `proxy.test.ts` pins the matcher's SHAPE; this pins that nothing skips the proxy
 * at any other layer, such as an early `return` keyed on the header.
 *
 * ✅ **Probed RED two ways.** (a) **SEC-1's own regression**: re-adding
 * `missing: [{ type: 'header', key: 'next-router-prefetch' }]` to the `config.matcher` entry makes
 * this test fail — the proxy stops running on a prefetch-flagged request and the CSP header
 * disappears. (b) An early `return NextResponse.next()` inside `proxy()` — the "skips the proxy at
 * some other layer" case the matcher pin cannot see.
 * ⚠️ **(a) needs one cast to run, and the reason matters.** An object-form matcher entry is rejected
 * by `proxy.test.ts`'s own typing — `getMiddlewareMatchers(config.matcher, …)` takes
 * `readonly string[]` — not by Next, whose `MiddlewareMatcherInputSchema` still accepts `has`/
 * `missing`. ⚠️ **An earlier version of this comment blamed `next build` for rejecting the shape.
 * That was wrong**: the config SEC-1 *fixed* used exactly this shape and shipped. The real barrier is a
 * test's parameter type, which is a thinner guarantee than it sounded — hence this arm.
 */
test('a prefetch-flagged request still goes through the proxy (SEC-1)', async ({ browser }) => {
  const context = await browser.newContext();

  // 🔴 **BOTH headers, and the first one is the whole point — a correction to an earlier version of
  // this test.** That version sent only `purpose: prefetch`, on the committed claim that
  // `next-router-prefetch` "never reaches the server". **That claim was wrong**, and wrong in the
  // direction that matters: it told the next author SEC-1's actual header was not attacker-settable.
  //
  // What is true, read off the installed Next 16.4.3: `next-router-prefetch` is in `FLIGHT_HEADERS`
  // (`client/components/app-router-headers.js:104-110`), and `server/web/adapter.js:147-157` deletes
  // those from the request — under the comment **"Headers should only be stripped for middleware"**.
  // So it is invisible INSIDE `proxy()`, which is why an echo probe from there reports `false`.
  // ⚠️ **The matcher sees it.** `shared/lib/router/utils/middleware-route-matcher.js:20` evaluates
  // `matchHas(req, query, matcher.has, matcher.missing)` on the raw request, BEFORE the adapter builds
  // the middleware request — and the matcher is exactly where SEC-1's `missing:` condition lived.
  // Dropping this arm would have left the one regression this test is named for undetectable.
  const PREFETCH_HEADERS: Record<string, string>[] = [
    { 'next-router-prefetch': '1' },
    { purpose: 'prefetch' },
    { 'next-router-prefetch': '1', purpose: 'prefetch' },
  ];
  for (const headers of PREFETCH_HEADERS) {
    for (const route of [APP_HOME_PATH, SEED_PROFILE_ROUTE]) {
      const label = `${route} with ${Object.keys(headers).join('+')}`;
      const res = await context.request.get(route, { headers, maxRedirects: 0 });
      expect(
        res.headers()['content-security-policy'],
        `${label}: no CSP — the proxy did not run on a prefetch-flagged request`,
      ).toContain("frame-ancestors 'none'");
      expect(res.headers()['x-content-type-options'], `${label}: no nosniff`).toBe('nosniff');
    }
  }

  // 🔴 **Non-vacuity control.** A matcher-EXCLUDED path must carry no CSP — otherwise this test would
  // pass even if the header came from somewhere other than the proxy, and would assert nothing.
  const excluded = await context.request.get('/_next/static/nonexistent.js', { maxRedirects: 0 });
  expect(excluded.headers()['content-security-policy']).toBeUndefined();
  await context.close();
});
