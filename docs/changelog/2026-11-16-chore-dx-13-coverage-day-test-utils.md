# Coverage no longer counts the day page's test helpers

`apps/web/components/day/day-test-utils.tsx` holds the day page's test fixtures and render helpers, and only test files import it. The post-merge coverage number counted it as app code, which inflated the figure. It's now excluded, the same way `lib/dal/recording-db.ts` already is (DX-13).
