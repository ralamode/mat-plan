- **2026-11-12** — **UI-5: a laptop gets a nav rail and the page, instead of a phone column with
  empty margins** ([plan](../plans/ui-5-app-shell.md), [regions](../architecture.md) § 2e,
  [design](../design.md) § Layout). At `lg` and up every authenticated screen is now a 16rem rail
  plus the page; below it, the single centred column is **byte-for-byte what shipped yesterday**,
  pinned by a geometry guard recorded on the pre-shell commit — `main`'s box, its computed padding,
  its `row-gap`, the `h1`'s x, the first control's x and the footer's offset from `main`'s bottom, at
  390 and 360 across three pages. The first draft of that guard could not fail: it proposed the
  390px axe scan and the screenshots, and neither reads a position, a `gap` or a footer placement.
  **The rail is the athlete switcher, not two links** — a laptop changes kid without a round trip
  through `/p`, which is the whole stated laptop case. It invents no destination and ships **no
  client component**: `aria-current` wants `usePathname()`, but every page already knows what it is,
  so `current` arrives as a prop. `<main>`, the one `<footer>` and the app's **first skip link** are
  declared in one file instead of nine, which makes the sheet's `querySelector('main')` focus
  fallback deterministic — and a second `<main>` is invisible to every check this repo runs, since
  axe's `landmark-no-duplicate-main` is `best-practice` and the scan is `wcag2a`/`wcag2aa`, so a
  source scan fails a page that declares its own. The content keeps its `max-w-2xl` measure inside
  the wide cell: measured, an uncapped region gives the log form ~1000px and grows the movement input
  to ~650px for a ten-character name. **Two things the plan got wrong, both found by the suite rather
  than by review:** `/p` renders no rail at all (it _is_ the switcher, so a rail there linked every
  athlete twice — `selectProfile`'s regex collided on the first run), and **no** inline link became
  `lg:hidden`, because `/p` is more than switching — it is the only home of sign out, the theme
  toggle, Add an athlete and the archived count, and hiding the way there would have stranded all
  four on a laptop. The footer's `/sign-in` suppression is **deleted** rather than preserved: it left
  the root layout, so that screen never mounts it, and a `return null` for a tree it is not in would
  be a branch no render can reach. ⚠️ **The context rail is not in this PR** — a page-level prop
  cannot host a picker that lives inside a client form and closes over its state, so the third track
  lands with `PICK-1` PR 4 and its first real consumer. Seven lenses reviewed the plan; two of its
  claims were false and are recorded as pushbacks, and `expectLinkTapTargets` grew a `root`
  parameter because the rail is, by design, outside `main`.
  **A four-lens panel then read the built code, after CI was green, and that is the half worth
  reading.** Every finding below had passed `pnpm verify`, 114 e2e tests and axe. Three assertions
  could not fail: the geometry guard pinned a `row-gap` on an element with one child (so the gap a
  phone sees could change with the guard green); `footerOffset` could not detect the `flex-1`
  regression the plan's Risks table named it for, because the footer is the next flex sibling
  either way; and the skip link's `toBeVisible()` passes on a 1×1 `sr-only` clip — which mattered,
  because `not-sr-only` resets `padding: 0` and the focused link was a 24px box of bare text. All
  three are now probed RED. The rail **truncated athlete names**, which `PROF-1` D11 forbids for
  every element that renders one, and showed no **kind**, which is how this app tells two
  same-named athletes apart — adding it then failed axe at 1280, because muted text on `--accent`
  measures 4.34:1 in the light palette, so the open row is outlined rather than filled. Its
  `<h2>Athletes</h2>` preceded every page's `<h1>` and was a second identical heading on
  `/settings`; it is a `<p>` with `aria-labelledby` now. A `sticky` rail with no max-height hid its
  own Settings row for any household past eleven athletes. `app/p/loading.tsx` dropped the rail, so
  every desktop navigation into a day page shifted the column — on the one interaction this feature
  adds — which is why the day subtree now has its own skeleton and the grid is reserved while busy.
  `current` passed the raw URL segment, and `z.uuid()` accepts upper-case. And a comment this PR
  wrote confidently — that the grid avoids `transform`/`overflow` because they break the sheet's
  `position: fixed` — was **wrong on both counts**: the sheet portals to `body`, and `overflow`
  never changes a fixed element's containing block. ⚠️ **`PRIV-2`'s "one `<footer>` in the root
  layout, not three use sites" is superseded**, recorded in its own plan: a layout cannot read the
  pathname, so once `/sign-in` needed the footer absent that choice was a client component on every
  route or two `contentinfo` landmarks. The root error boundary renders the footer again — a
  database outage had been showing a screen with no route to the privacy notice.
