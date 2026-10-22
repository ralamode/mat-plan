- **2026-10-22** — **The picker gets a "Lock this device" control, and it is deliberately not called
  "Log out".** The ask was a logout button in the footer of `/p`. The UX panel rejected both halves,
  and the reasons are worth keeping.
  🔴 **The footer cannot host it.** `app/layout.tsx` renders `SiteFooter` on every route, and
  `pages-are-gated.test.ts` → _"public pages pull no Server Action into their module graph"_ asserts
  that a `'use server'` module is unreachable from `/`, `/privacy`, `/sign-in` and `/gate`. A footer
  import would have put the action in all four graphs — its docblock names the threat: _"invokable by
  an unauthenticated POST to it with only its own gate check in the way."_ The trick that was supposed
  to keep the footer a server component is exactly what trips the guard.
  🔴 **"Log out" would have been a lie.** There is **one access code for the whole household** and
  profile tiles are _"a UX switch, not a security boundary"_, so the act does not end a person's
  session — it **locks the device for everyone**. To an eight-year-old "log out" reads as "finish my
  turn", and the next kid on the gym floor could not log a set. The label now names the object it acts
  on, and the cost is stated in the second person **before** the tap: _"Anyone using this phone will
  need the household code to log again."_ The gate then explains itself (`?locked=1`) and names the
  recovery — ask a parent — mirroring `AMEND_COPY.lockedRecovery`, because the person most likely to
  mis-tap is the one who does not hold the code.
  **Placement follows a decision that already existed.** `docs/design.md` says of the theme switch:
  _"The control lives on the profile picker, and only there … a settings-grade preference set once per
  device."_ A device lock is the same category, so it joined the theme in the `mt-auto` block, now a
  **`This device`** group — which is what makes "later move it into settings" a move of two JSX nodes.
  **Two guards did their jobs within a day of shipping.** 1b-bis's enumeration scan went red on the new
  `'use server'` module _by design_ ("a visible test edit rather than a silent gap"), and it is **not**
  allowlisted: the gate action is excused because it cannot require the thing it is about to grant,
  and this one can — it re-checks `hasGateAccess()` before clearing. The boundary test then caught a
  real fragility: the action's safety depended on `redirect()` **throwing**, so with that stubbed, an
  ungated caller cleared the cookie anyway. Now it `return`s explicitly.
  ⚠️ All of this is **deleted at AUTH-1 1d** with the rest of the gate, and that is written where the
  code is rather than only in a plan.
