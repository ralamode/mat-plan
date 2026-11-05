import { expect, test } from '@playwright/test';

import {
  APP_HOME_PATH,
  FOOTER_COPY,
  GITHUB_REPO_URL,
  MIN_TAP_TARGET_PX,
  PRIVACY_PATH,
} from '../lib/constants';
import { NOTICE_TITLE } from '../lib/privacy/notice-content';

import { MOBILE_VIEWPORT } from './contexts';

/**
 * PRIV-2 — `/privacy`, the URL the Clerk and Google consent screens point at.
 *
 * ⚠️ **The empty-cookie-jar context is gone (AUTH-1 1d).** It existed because the project's gate
 * cookie made a "public" page indistinguishable from a gated page the cookie let through. There is
 * no such cookie, and the harness session is an environment variable no context can drop — so these
 * cases assert what the PAGE renders, not what a stranger sees. See `e2e/contexts.ts`.
 */

const noticeHeading = { level: 1 as const, name: NOTICE_TITLE, exact: true };

test.describe('public', () => {
  test.use({ viewport: MOBILE_VIEWPORT });

  test('a stranger can read the notice, with no code and no redirect', async ({ page }) => {
    await page.goto(PRIVACY_PATH);
    await expect(page).toHaveURL(PRIVACY_PATH);
    await expect(page.getByRole('heading', noticeHeading)).toBeVisible();
    // The landmarks acceptance 9 names, in the DOM rather than in the plan.
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('contentinfo')).toBeVisible();
  });

  test('every section of the source notice is on the page', async ({ page }) => {
    await page.goto(PRIVACY_PATH);
    // Two spot checks a reviewer can hold in their head: the first heading after the lead, and the
    // ordered-list cross-reference whose markers Tailwind's preflight removes by default. The
    // exhaustive comparison against `notice.md` is the unit test's job.
    await expect(
      page.getByRole('heading', { level: 2, name: 'How long we keep it' }),
    ).toBeVisible();
    await expect(page.getByText('That follows from (1) and')).toBeVisible();
  });

  test('the data-inventory link points at the real file in the public repo', async ({ page }) => {
    await page.goto(PRIVACY_PATH);
    await expect(page.getByRole('link', { name: 'data-inventory.md' }).first()).toHaveAttribute(
      'href',
      `${GITHUB_REPO_URL}/blob/main/docs/privacy/data-inventory.md`,
    );
  });

  test(`${PRIVACY_PATH}/ canonicalises to ${PRIVACY_PATH}`, async ({ page }) => {
    // ⚠️ NOT a boundary assertion. Next's trailing-slash redirect issues a 308 to `/privacy` BEFORE
    // the proxy runs, so `/privacy/` never reaches `isPublicPath` over HTTP — which is why the
    // acceptance says "canonicalises". `isPublicPath('/privacy/') === false` is pinned in
    // `lib/public-paths.test.ts`. ⚠️ This comment used to cite `lib/access-gate.test.ts`, which
    // `1d` deletes and which never held that pin in the first place.
    await page.goto(`${PRIVACY_PATH}/`);
    await expect(page).toHaveURL(PRIVACY_PATH);
  });

  // 🔴 **The runtime arm of the subtree proof is RETIRED at `1d`, and the reason is that it decayed
  // into a tautology.** It asserted `${PRIVACY_PATH}/x` → `/gate?from=…`, i.e. that the subtree is
  // not public. After `1d` there is no bounce: the route simply does not exist, so the only
  // observable outcome is a 404 — which cannot distinguish "not public" from "no such page", and
  // would pass even if `PUBLIC_PATH_TREES` were widened to the whole subtree tomorrow.
  // The claim still holds and is still proved, statically and exactly, by `lib/public-paths.test.ts`
  // (`isPublicPath('/privacy/x') === false`). A test that cannot fail for its stated reason is worse
  // than no test, so this one is removed rather than repointed at the 404.

  test('the footer marks the current page and offers a way out', async ({ page }) => {
    await page.goto(PRIVACY_PATH);
    const footer = page.getByRole('contentinfo');
    const here = footer.getByRole('link', { name: FOOTER_COPY.privacy, exact: true });
    const home = footer.getByRole('link', { name: FOOTER_COPY.home, exact: true });
    await expect(here).toHaveAttribute('aria-current', 'page');
    await expect(home).not.toHaveAttribute('aria-current', 'page');

    // `expectTapTargets`/`expectLinkTapTargets` are deliberately NOT used on this route (the first
    // matches nothing here, the second measures prose links covered by SC 2.5.8's inline
    // exception), so the footer's two links are measured directly.
    for (const link of [here, home]) {
      expect((await link.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(MIN_TAP_TARGET_PX);
    }

    await home.click();
    await expect(page).toHaveURL('/');
  });
});

test.describe('gated', () => {
  test('a gated caller reads the same page — /privacy does not bounce to the app', async ({
    page,
  }) => {
    // The assertion that pins `proxy.ts`'s `pathname === '/'` arm against a careless change to
    // `isPublicPath`: `/` sends the family to the picker, `/privacy` must not.
    await page.goto(PRIVACY_PATH);
    await expect(page).toHaveURL(PRIVACY_PATH);
    await expect(page.getByRole('heading', noticeHeading)).toBeVisible();
  });

  test('the footer reaches the notice from inside the app', async ({ page }) => {
    await page.goto(APP_HOME_PATH);
    await page
      .getByRole('contentinfo')
      .getByRole('link', { name: FOOTER_COPY.privacy, exact: true })
      .click();
    await expect(page).toHaveURL(PRIVACY_PATH);
    await expect(page.getByRole('heading', noticeHeading)).toBeVisible();
  });
});
