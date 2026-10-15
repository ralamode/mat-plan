- **2026-10-15** — **PRIV-1: the privacy notice has no blanks left, and three of its sentences were
  wrong** ([notice](../privacy/notice.md)). The three vendor retention windows are **confirmed and
  dated** rather than `⏳`: Sentry **30 days** (Developer plan), Vercel runtime logs **24 hours** (Pro,
  no log drains), Neon point-in-time **6 hours** — each recorded in
  [data-inventory.md](../privacy/data-inventory.md) §8 with its plan tier, because a number that lives
  only in the notice has no trace. ⚠️ **Neon's 6 hours is not in conflict with the 7-day restore
  branch** the deletion section promises: 6h is how far back a branch can be cut _from_, and the
  restore branch is cut explicitly and persists on its own — both the table and §8 now say so, because
  a parent reading one screen apart would otherwise see a contradiction. A **real contact address** —
  `matplandev@gmail.com`, deliberately **plain text, not a `mailto:` link**, because `PRIV-2`'s
  generator allowlists `https://` only. The sign-off form is **filled as prose** rather than published
  as an empty `Role: ___ Date: ___`, which announced a review step and visibly showed it not taken; the
  convention paragraph explaining why there is no name went with it, since a filled role needs no
  excuse. 🔴 **Three sentences were factually wrong and are corrected here, not at `PRIV-2`:** the
  notice claimed _"there are no public pages"_ (`PRIV-2` creates one, and `:221` lists "anything is
  made publicly visible" as a re-review trigger — so that PR would have pulled the notice's own trigger
  while publishing the sentence it falsifies); the deletion section promised _"a restore point is held
  for that window. After that it is gone"_, which contradicts both `runbooks.md`'s procedure (the
  branch is cut immediately **before** the apply, held 7 days **after**) and the notice's own next
  paragraph — the one place the notice **quantifies** a retention promise; and the contact section told
  everyone to _"use the contact route given in your invitation"_, which answers nobody who was never
  invited, i.e. exactly who an indexed `/privacy` reaches. 🔴 **Found while gathering the numbers:
  `SENTRY_DSN` was absent from Vercel's Production scope**, so `Sentry.init` was a silent no-op and
  Sentry had never received anything — publishing "30 days" against it would have been a false
  retention claim. Now set (a redeploy carries it). That is the **second** instance of the shape
  `OPS-1` found with Upstash: `env.ts` makes the two variables that protect users (`SENTRY_DSN`, the
  Upstash pair) **optional and silently inert**, while the two that would corrupt data
  (`ACCESS_GATE_PASSWORD`, `DATABASE_URL`) are required and fail the build. Nothing distinguishes
  "legitimately unconfigured" from "production, unconfigured" — filed as its own row. **This PR lands
  before `PRIV-2`** so that PR opens green: a zero-`⏳` assertion red for a PR's life would disarm
  `pre-push`, six `verify` steps and `next build`.
