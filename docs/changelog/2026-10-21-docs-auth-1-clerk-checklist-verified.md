- **2026-10-21** — **Four of the AUTH-1 checklist's "verify, do not assume" boxes are answered from
  Clerk's current docs, and one of them went against us.** [runbooks.md](../runbooks.md) → the AUTH-1
  checklist deliberately refused to guess at vendor behaviour; this reads the answers off
  [Clerk's docs](https://clerk.com/docs/guides/secure/restricting-access) at the pinned `7.9.15` and
  records them with sources.
  **Good news.** Invite-only sign-up **exists, is called `Invite-only`** (API `restricted`, on the
  **Access mode** page) **and blocks** — _"users who don't have access will see a message indicating
  that they need an invitation"_ — so the "no household #2" question does not re-open on it. The legal
  consent setting exists too, as _"Require express consent to legal documents"_ on the **Legal** page,
  and needs no code because it renders inside the prebuilt `<SignUp />`. And the
  development/production credential separation is **automatic rather than a discipline**: a dev
  instance uses Clerk's _"preconfigured shared OAuth credentials"_, so it cannot use this app's and
  there is no Google Cloud Console work for dev at all — which also makes the verified-domain worry a
  production-only question.
  **Bad news, and it is the 🔴 scope box.** Clerk's default Google scopes are `openid email profile`,
  and the dashboard's **Scopes** field only appears with **Use custom credentials** — so dev cannot
  narrow them at all, and even on production the field **adds** scopes rather than subtracting them,
  because Clerk pre-configures the essential set each provider needs. The box's own premise — that a
  narrower list exists to pin — is **false**, so its conditional (_"if `profile`/`picture` is
  unavoidable"_) has resolved to **unavoidable**, and `notice.md`'s **"no photos"** plus
  `data-inventory.md` §7's pin to _"an email address and a Google account identifier"_ are both too
  narrow for what is **received**. The honest edit separates **receiving** a claim from **storing** it,
  and the standing prohibition on writing `profiles.avatar` becomes the load-bearing control instead of
  a scope setting. Those edits land in the chunk that configures the instance, which is where the
  original conditional already sent them.
  **Still open on purpose:** whether the consent checkbox **blocks** sign-up until ticked. Clerk's 2024
  changelog says it does; the current guide describes only that a checkbox appears and never states the
  mechanism, and a two-year-old changelog is not a behavioural guarantee at `7.9.15`. The box now says
  to test it in the development instance — attempt a sign-up without ticking — which is the cheapest
  possible test of exactly the thing the checklist warned against assuming.
  Also recorded: the list never had a "create the instance" step because **there isn't one** — creating
  the application _is_ creating the development instance; and 🔴 **allowlist/blocklist apply only in
  `Open` mode**, so Invite-only has **no second layer**, making the code-side exit criterion
  load-bearing rather than redundant.
