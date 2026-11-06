- **2026-11-05** — 🔴 **The published notice describes the waitlist, because production was switched
  to it** (`INVITE-1`'s privacy half, arriving ahead of its plan — the setting changed first).
  Clerk's access mode moved from `Invite-only` (`restricted`) to **`Waitlist`** (`waitlist`), so the
  sign-in card now offers _"Want early access? Join waitlist"_.
  ⚠️ **This is a new data category at an existing processor, not a copy change.** Clerk now stores
  **the email address of a person with no account and no household**. Every other identifier in
  `data-inventory.md` §7 belongs to someone who signed in; this one belongs to a stranger who did
  not — recorded there, with the retention gap, because the notice is held to a **zero-placeholder
  gate** and may carry no ⏳ of its own.
  🔴 **The join link LEAVES this app, and that is the finding worth keeping.** It goes to
  `accounts.mat-plan.dev/waitlist` — Clerk's hosted Account Portal. It sits on a sub-domain of this
  app's domain, so it reads as ours; it is Clerk's, it asks for an email address, it **carries no
  link to the privacy notice**, and its only way back is "Sign in". So a stranger would have
  disclosed an address having been told nothing. The disclosure therefore sits **above the card, on
  our side of that link** (`SIGN_IN_COPY.waitlist`) — this repo's own "put the fact next to the
  control" rule, applied where the control belongs to a vendor.
  ⚠️ **Two published claims were FALSE the moment the mode changed**, which is why this shipped
  before `PR C`: the notice said sign-up was "by invitation only" in two places, one of them the
  basis for how consent is recorded. Getting an _account_ still is by invitation; joining the list is
  not, and the notice now separates them — "it is you asking us, not us asking you".
  🔴 **The copy is COUPLED TO A DASHBOARD SETTING, and that coupling is stated loudly in three
  places** (`lib/constants.ts`, `runbooks.md`'s access-mode box, this entry). Nothing in the repo can
  read the Clerk access mode at runtime — `clerkIsConfigured()` only knows whether keys exist — so
  flipping the mode means changing the copy and the notice in the same breath, or the published
  document becomes false again. That is a real fragility, recorded rather than designed away.
  ⏳ **Still owed, and tracked in `data-inventory.md` §7:** the waitlist retention console read, and a
  decision on whether to mount Clerk's `<Waitlist />` on this app's **own** origin so the disclosure
  and the form live on the same page. That second one is `INVITE-1` proper.
