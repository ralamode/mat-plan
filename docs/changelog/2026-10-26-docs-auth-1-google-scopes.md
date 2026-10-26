- **2026-10-26** — **The OAuth scope box is closed, and it went against us.** `AUTH-1`'s checklist had
  flagged this in red for weeks: a conventional `openid email profile` request also returns `name` and
  `picture`, while [notice.md](../privacy/notice.md) claimed **"no photos"** and
  [data-inventory.md](../privacy/data-inventory.md) §7 pinned the claim to _"an email address and a
  Google account identifier"_. The production instance's custom-credentials screen settles it:
  `openid` · `userinfo.email` · `userinfo.profile`, and **`userinfo.profile` cannot be removed** — it
  is part of Google's basic sign-in set. Confirmed **in the console by the maintainer**, not inferred
  from documentation, which is what the box asked for.
  **So the notice now says what is true rather than what was convenient.** The old line was a flat
  list of things "we never ask for" with photos in it. It now separates the two things that were being
  conflated: Google **sends** Clerk an email address, a name and a profile picture — that set is the
  minimum Google issues to sign someone in, not a choice this app made — and this app **reads none of
  it except to know which account signed in**, stores none of it, and cannot display a photo at all.
  ⚠️ What it must never say again is _"Google sends us nothing but an email address."_ That is false at
  the token and falsifiable by anyone who looks, which is the worst kind of privacy claim: wrong in a
  way a reader can check.
  The **standing prohibition is now the load-bearing control** rather than a scope setting: nothing may
  ever write `profiles.avatar` — §2 of the inventory already flags that column, because what it would
  hold is a picture of a child.
  Also corrected: the AUTH-1 checklist's console paths. Google has reorganised the OAuth console into
  **Google Auth Platform** — Branding (app name, authorized domains, **privacy-policy URL**), Audience
  (user type, publishing status, test users), Data Access (scopes), Clients — so the single "OAuth
  consent screen" page the checklist described no longer exists.
