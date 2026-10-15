- **2026-10-15** — **PRIV-2: the privacy notice is served at `/privacy`, generated from the reviewed
  markdown and unable to drift from it** ([plan](../plans/priv-2-serve-the-notice.md)). This is the
  last gate on configuring `AUTH-1`'s production Clerk instance and Google's OAuth consent screen,
  both of which take a privacy-policy **URL** — and
  [`docs/privacy/notice.md`](../privacy/notice.md) is a file in a repository, not a URL. The notice
  is now the **second** entry in `PUBLIC_PATHS`, reachable with no access code, and a global
  `<footer>` reaches it from every screen rather than only from a typed URL. ⏳ Its
  `robots: noindex` comes off in the `AUTH-1` PR that arms real auth: until the gate's brute-force
  limiter is actually armed in production, an honest inventory of the beta's weaknesses should not
  also be a search result. `noindex` costs nothing here — the response is still a 200 for the consent
  screen and for any reader with the link.

  **One source of truth, enforced mechanically.** `pnpm privacy:generate` renders `notice.md` into a
  committed TypeScript module and `pnpm test` fails, **byte-exactly**, if the two disagree — so the
  served page can never become the second copy of a privacy notice that `PRIV-1` rejected a separate
  `retention.md` for. The parser (`marked`, pinned exactly, dependency-free, no install scripts) is a
  **devDependency** used only by the script: nothing enters the production tree `audit:check` gates,
  and nothing enters the bundle but data and JSX — no runtime parser, no `fs`, no
  `dangerouslySetInnerHTML`. The page takes no `params` and no `searchParams`, so "static or
  generated — never a file read keyed on a request param" is a property of the code rather than a
  promise.

  **Three guards exist because, without them, a test would pass while the page was wrong.** The
  generator **throws** — on a markdown construct it does not understand, on a third table column, on
  a blank table header, and on any link target that is not `https://` or the one mapped relative
  rewrite (`mailto:` and `http://` included) — rather than dropping it silently from a privacy notice.
  Every string it emits goes through `JSON.stringify`, never a template literal: prose becomes
  compiled source here, and a `${process.env.ACCESS_GATE_PASSWORD}` in the notice would otherwise
  compile to the live access code in a file served to anyone. And the content test derives **every**
  expectation from `notice.md` — the `##` headings asserted in order, both tables' row counts and
  both header rows, the block kinds present — because the drift test compares the generator to the
  module and can never notice that the two agree on something the source never said.

  🔴 **The notice's two tables kept their column headings only because the model carries them.**
  `marked` returns a table's `header` separately from its `rows`; a `dl` model without a `head` field
  drops `| Who it reaches | What they get |` and `| What | How long |` with every test green, leaving
  a parent to infer what "Neon — the database, everything stored" is a column of. 🔴 **And the
  renderer's per-block classes are load-bearing, not decoration.** Tailwind's preflight zeroes every
  margin, removes list markers, flattens heading weight and strips link underlines — so one shared
  class string would have shipped a 200-line notice as a single unbroken block with no bullets and no
  numbers, while the paragraph telling a parent the **worst-case exposure** says _"that follows from
  (1) and (2)"_. The page rules derive from `--muted-foreground`, not `--border`, which is ≈ 1.2:1 on
  white and therefore invisible in the lighter of the two themes.

  **`PUBLIC_PATHS` grew in the shape that survives `AUTH-1`.** `isPublicPath` keeps **exact**
  membership and a separate `PUBLIC_PATH_TREES` holds routes that own their subtree — empty today,
  with its matcher (`matchesPathTree`) exported and tested, `/sign-inevil` included, **before** any
  entry needs it. `AUTH-1` chunk 1a's committed arm generalises the prefix match across every
  `PUBLIC_PATHS` entry, which would have made `/privacy/x` public and turned two of this PR's
  negative tests red, where the cheapest fix at that keyboard is deleting them. Now 1a adds one
  string to the opt-in list instead. `/privacy/x` bounces to the gate; `/privacy/` **canonicalises**
  to `/privacy` (Next's trailing-slash 308 runs before the proxy, so claiming it "stays gated"
  end-to-end would be a false criterion — the unit level pins `isPublicPath('/privacy/') === false`
  instead). A gated caller **reads the notice in place**: the proxy's redirect arm is
  `pathname === '/'` by design, now asserted rather than assumed.

  ⚠️ **One item the plan assigned to PR 1 did not land, and it is recorded rather than quietly
  absorbed.** `notice.md:21` and `:29` ("About the people in your household", "What gets logged") are
  still **bold-only faux headings** a screen-reader user cannot reach by heading, and the sign-off is
  bold prose rather than a blockquote. The model, generator and renderer all handle `###` and `>`; the
  source uses neither, so `notice-content.test.ts` pins the gap as a visible assertion and exercises
  both branches directly. Promoting the two lines is a one-line markup change that the `###`
  assertion will pick up automatically.
