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
  📌 **And the dashboard opens on the DEVELOPMENT instance**, where every page in the checklist looks
  plausible — a Domains page showing a `*.clerk.accounts.dev` primary badged _Development domain_ is
  the tell that the custom-domain work is happening in the wrong context. The checklist now says so,
  and carries the one command that separates _"Clerk is broken"_ from _"my domain is not
  provisioned"_: curl `/v1/client` on **both** Frontend APIs. The development host answering **200**
  while `clerk.<domain>` answers **000** is conclusive. A TLS `handshake failure` with no HTTP status
  is that same state, and it is not a CSP, CORS or key problem.
