- **2026-11-15** — **UI-6 backlog row: a 404 page that renders under the production CSP**
  ([plan.md](../plan.md)). The app has no `not-found.tsx`, so unknown URLs get Next's built-in
  fallback, whose inline style attributes and un-nonced `<style>` the nonce-only `style-src` blocks.
  The row scopes the fix: an app-owned not-found page, plus an e2e check for CSP errors on a 404,
  with the policy left as it is.
