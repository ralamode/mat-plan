- **2026-11-15** — **UI-6: a missing page now shows the app's own 404, styled, with a way back**
  ([plan.md](../plan.md), [lessons](../lessons.md) → Next.js 16). Every unknown URL, and every
  athlete id a household can't see, used to get Next's built-in fallback, which styles itself with an
  un-nonced `<style>` and inline attributes that the production CSP blocks, so it rendered without
  its layout and logged errors. `app/not-found.tsx` replaces it: "Page not found", one sentence that
  doesn't reveal whether another household's athlete exists, a full-width "← All athletes" button to
  `/p`, and the footer. The blocked style's hash, `sha256-Z5XT…`, is the CSP error seen intermittently
  on Today captures on 2026-11-14, so that report is explained too.
