- **2026-11-07** — **The pre-invite privacy sign-off becomes one gate, and screenshots move after the
  review round** (`PRIV-4`; `ship-pr` and `ui-screenshot`; a sign-in diagnostic in
  [runbooks.md](../runbooks.md)).
  **`PRIV-4`** _(maintainer, 2026-11-07)_: the human sign-off on the published notice is batched to
  **one read before the first outside family is invited**, after CRUD-1's athlete and workout chunks.
  ⚠️ **It does not defer keeping the notice TRUE** — each PR still edits `notice.md` and the inventory
  in the same PR, as AGENTS.md requires; what it batches is reading the whole document aloud. The
  reason it is safe: nobody outside the maintainer's household has been invited, and will not be until
  a household can CRUD athletes and workouts, so `/privacy` has exactly one reader. By then `b`'s
  archive writer, `a-1`'s `client_id` writer and `V1-9b`'s delete will each have changed it; signing a
  document nobody has read, four times, is ceremony. The row names what will have accumulated and
  pairs the read with `TEN-2c-1`'s re-measure and `PRIV-3`'s deletion rehearsal.
  **Also recorded there:** a rename needs **no "there is no undo" warning**. Nothing requires
  disclosing what is _not_ retained; a rename is the exercise of the rectification right, not an event
  needing a caveat; and renaming without an undo is the ordinary behaviour of every product people
  already use. The retention answer lives in the inventory's §8, which is evidence, not in the notice,
  which is for what a person needs to know.
  🔴 **Screenshots now come AFTER the review round on a PR deep enough to have one.** `PROF-1` a-r
  captured and published first, then a six-lens panel changed the heading, the kind block and the
  error copy — so three capture-and-publish cycles went into one screen, each a prod build plus an
  ephemeral Postgres, and any reviewer who opened an early image reviewed a screen that no longer
  existed. The sequence is **build → panel / review → reconcile → capture → open the PR**. ⚠️ The UX
  panel still runs BEFORE implementation; it is the camera that waits.
  **And a sign-in diagnostic**, because four causes present identically and production can be healthy
  while two of them are broken: (1) `localhost:3000` may be a **different project** — `dev-local.ts`
  spawns `next dev` with no explicit port, so a taken 3000 silently moves mat-plan to 3001 and every
  route on 3000 404s, which reads exactly like broken auth; (2) a **missing key** in that environment's
  scope renders the dark page by design, and `pnpm preview:check` audits Preview for production
  credentials leaking IN, not for Clerk keys being absent; (3) **production Clerk keys cannot work on a
  `*.vercel.app` preview** at all — a production instance is domain-locked, so previews need the
  `pk_test_` instance; (4) a preview answering `<title>Login – Vercel</title>` is **Deployment
  Protection**, not our app. Each step is a command that separates two causes; the publishable key is
  public by design and encodes its own Frontend API host, so "which instance is this?" is answerable
  without revealing a secret.
