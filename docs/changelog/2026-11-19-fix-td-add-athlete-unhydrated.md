- **2026-11-19** — **A form tapped before the page has finished loading now saves, instead of
  silently doing nothing** ([plan](../plans/td-form-before-hydration.md); tech-debt entry paid off).
  On a slow phone, tapping Add athlete, Save on a rename or the routine, or Archive or Restore in
  Household settings, before the page's scripts arrived, sends the browser's own form submission, and the app's `Referrer-Policy: no-referrer` made browsers send it with no
  origin, which the framework's request check refuses. The policy is now `same-origin`: this site
  receives the page a request came from, and every other site still receives nothing. Clerk's relay
  through this site stays switched off (now tested) and error reports drop the header, so the page
  address does not reach either. The e2e smoke submits the add-athlete form with the page's scripts
  blocked. A refusal on the add or rename form made that way still loses what was typed; the
  tech-debt entry narrows to that.
