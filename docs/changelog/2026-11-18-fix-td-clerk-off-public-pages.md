- **2026-11-18** — **The home page and the privacy notice no longer load the sign-in provider's code**
  ([plan](../plans/td-clerk-off-public-pages.md); tech-debt entry paid off). Until now, opening the
  privacy notice to decide whether to trust the app was enough for Clerk, the sign-in provider, to see
  the visitor's IP address, because its code loaded on every page. It now loads on the sign-in screen
  and on the pages you see once signed in, and not on `/` or `/privacy` opened directly. The privacy
  notice and the data inventory say so, with the two edges stated exactly. The landing page's sign-in
  button and the not-found page's link now do a full page load, which keeps the sign-in card styled
  under the security policy; a test fails if either link goes back to a client-side link.
