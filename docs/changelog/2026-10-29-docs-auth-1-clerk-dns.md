- **2026-10-29** — **The `AUTH-1` console checklist gains the Clerk production domain: the two CNAMEs
  that gate sign-in, and three diagnostics for when it does not come up.** `clerk.<domain>` and
  `accounts.<domain>` must CNAME to Clerk before a production instance serves anything, and the
  dashboard opens on the **development** instance, where every page in the checklist renders
  plausibly.
  The diagnostics are the durable part, because from the app's side the failure modes look identical
  — a missing card and a console full of CORS errors: a non-existent subdomain that still resolves
  means a **wildcard** is answering for `clerk.*` (the app host then 404s on a name it does not
  know); development answering **200** while `clerk.<domain>` answers **000** means Clerk is healthy
  and the custom hostname has no certificate, which is neither CSP nor CORS nor the key; and an empty
  certificate-transparency result means issuance never started, so waiting will not help.
  ⚠️ **The `style-src` question remains open**, and this is what unblocks reaching it: nothing had
  rendered yet to violate a style policy. A resolved 404 is not a cleared CSP.
