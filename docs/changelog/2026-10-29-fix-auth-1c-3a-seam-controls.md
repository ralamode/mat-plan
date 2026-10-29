- **2026-10-29** — **Four controls shipped with `1c-3a` did not control what they claimed.** Found by
  a second security pass that arrived after the merge, each proven by probe rather than argued.
  🔴 **The `?host=` guard was one percent-encoding from useless.** It matched raw text while
  `pg-connection-string` **decodes** the key, so `?%68ost=ep-prod.aws.neon.tech` read as a local
  database — and `isLocalDbHost` is what decides whether the session bypass may arm. It now decodes
  via `URL.searchParams` and keeps the raw scan only as the unparseable fallback. ⚠️ And it shipped
  with **no tests at all**: `db-environment.test.ts` was never touched, so the new security control
  in a round whose lesson was _"a stated protection turned out not to protect"_ was itself unpinned.
  Six cases now cover it, including the three that must stay `true` so the guard cannot cry wolf.
  🔴 **The bypass accepted any Clerk-shaped id**, so `'user_' + 'a'.repeat(100_000)` and — worse — a
  **real** Clerk id both passed. `seed-ids.ts` argues at length that the principal must never be a
  real one. The control is now **equality with the committed fixture**, which bounds the length,
  makes a real id impossible, and needs no `SKIP_ENV_VALIDATION` carve-out because it never relied on
  zod. The regex stays as documentation of the shape.
  🔴 **The workflow sweep missed all three realistic evasions** — a second step writing to
  `$GITHUB_ENV` (the name sits mid-line, so a line-anchored pattern never saw it), a `.yaml` file,
  and moving the block from the step to the **job**, which reaches every step including
  `upload-artifact`. It now counts every mention anywhere, then pins the single survivor's form and
  indentation. All three go RED.
  **The harnesses' own locality proof was a second, un-hardened copy** of the predicate — no
  host-override check and no `[::1]` — while both injectors cite it as the proof the bypass may arm.
  One shared helper now.
  Also: `appSources()` globbed `{ts,tsx}` only, but Next's default `pageExtensions` includes `js` and
  `jsx`, so a `.js` route could read the variable directly and skip **both** the containment and the
  boot refusal; `preview:check`'s forbidden keys now carry their own remediation, because telling
  whoever set an authentication bypass to go fix a `DATABASE_URL` sends them the wrong way; and the
  `''`-not-`undefined` blanking mechanism finally has a test of its own rather than relying on a
  one-way egress assertion.
  ⚠️ **A comment claimed the shape regex was applied in three places. It was two.** Corrected rather
  than quietly amended — a comment asserting a control count the code does not have is the same
  defect class, in the one file where a reader will grep for exactly that.
