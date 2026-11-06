- **2026-11-05** — **The boundary guard is named for what it guards** (`AUTH-1` **1d PR C**, the last
  step of the chunk). `app/pages-are-gated.test.ts` → **`app/pages-need-a-session.test.ts`**, by
  `git mv`, plus the citation sweep that `1d` deliberately held back so its own diff stayed about
  behaviour. **Zero behaviour change.**
  ⚠️ **The sweep is split by what a reader would DO with the text, not by file type.** 41 live files
  are updated — code, `.claude/skills/`, `.github/SECURITY.md`, the feature guides,
  `architecture.md`, `runbooks.md`, `tech-debt.md`, `plan.md`, the specs and milestones, **and the
  nine plans whose work has not shipped yet** (`PICK-1`, `PROF-1`, `WP-1`, `MOV-1`, `ASSIGN-1`,
  `CLONE-1`, `HIST-1`, `RETIRE-1`, `V1-22 A4`) — because a future implementer following one of those
  would be sent to a file that does not exist. 15 are left alone as **dated history**: changelog
  fragments, ADRs, the prototypes, and the eight plans whose work has shipped.
  🔴 **Four live setup documents still told you to set `ACCESS_GATE_PASSWORD`**, a variable `1d`
  deleted and `lib/env.ts` no longer declares — `docs/deploy.md` (an env table, a `.env.local`
  example and a prose line), `docs/service-setup.md` (two tables and the Sentry-incident step, which
  told an operator under pressure to rotate a secret that does not exist — now the Clerk key),
  `README.md`, and `.local-secrets/README.md`. ⚠️ **They were outside `1d`'s enumeration**, which
  scoped to `apps packages .github .claude docs/features`; the sweep had a blind spot and these four
  are it.
  ✅ **Lit-panel finding 5 is ANSWERED, and it was the last thing `1d` left open.** On production
  2026-11-05, an address that had never touched the instance signed in under `Invite-only`: the
  refusal rendered **on this app's origin** — verbatim _"New sign-ups are currently restricted."_ —
  with the mark and both disclosure paragraphs still on screen. No Account Portal, no off-origin dead
  end, so the outcome the finding existed to catch does not occur and `signUpUrl` is belt rather than
  braces on that path. An invited-and-accepted address signs in and lands on `NO_HOUSEHOLD_COPY`,
  exactly as `SIGN_IN_COPY.invitation` is worded not to over-promise.
  ⚠️ **Bound to the mode it was taken under.** Production moved to `Waitlist` hours later, which
  replaces that refusal with a "Join waitlist" link that **does** leave the origin — recorded in
  #336. The observation is not retracted by that; it is bounded, and the runbook says to re-observe
  if the mode changes. ⏳ Still unobserved and still tracked in `data-inventory.md` §7: whether Clerk
  **retains** a user record for a refusal. The screen does not say and the app cannot tell.
