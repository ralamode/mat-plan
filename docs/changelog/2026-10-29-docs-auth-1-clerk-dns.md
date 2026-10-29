- **2026-10-29** — **The `AUTH-1` console checklist never asked anyone to point the domain at Clerk,
  and a wildcard DNS record made the omission look like a CSP bug.** The first production sign-in
  attempt rendered the page's own copy and no Clerk card. The CSP header was consistent with a
  plausible wrong answer — `style-src 'self' 'nonce-…'` with no `'unsafe-inline'`, which this repo
  already predicts would drop Clerk's runtime-injected styles — but the console said something else
  entirely: `clerk.<domain>/npm/@clerk/clerk-js@6/…` returning **404**, with the CORS complaint that
  a 404 page always produces.
  🔴 **A wildcard `*.<domain>` record was answering for `clerk.*` and `accounts.*`**, sending both to
  the app host, which does not recognise those names and 404s. So the subdomain resolved, answered,
  and was wrong — no DNS error anywhere. The tell is a deliberately non-existent subdomain resolving
  to the same IP range. The checklist now carries the two CNAMEs that block sign-in
  (`clerk.<domain>` → `frontend-api.clerk.services`, `accounts.<domain>` → `accounts.clerk.services`),
  the wildcard trap, and a shell verification that does not trust the dashboard's checkmark —
  `curl` on `/v1/client` must return anything but 404, since 401 means Clerk answered.
  ⚠️ **The `style-src` question is still open, not answered.** It could not be reached: nothing had
  rendered yet to violate a style policy. The box now says so rather than letting a fixed 404 read as
  a cleared CSP.
