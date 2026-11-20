- **2026-11-19** — **The tests' "links are big enough to tap" check is one function** (tech-debt entry
  paid off). Two copies measured the same 44px rule two ways, and one spec ran its own loop that
  passed vacuously if its selector matched nothing. `expectLinkTargets(root, context, expected?)` in
  `e2e/a11y-checks.ts` now lists every undersized link by name, fails when a page renders no links
  (unless an exact count is given), and says which page or state broke.
