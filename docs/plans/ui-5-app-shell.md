# UI-5 — an app shell that uses the width

**Branch:** `feat/ui-5-app-shell` · **Row:** [docs/plan.md](../plan.md) → `UI-5` ·
**Pillar:** Product & Spec

> ⚠️ **This is a seam: it touches every authenticated page.** Nothing else may be in flight on
> `apps/web/app/**` while it lands.
>
> 🔴 **This plan was cut roughly in half by its panel.** The first draft shipped the context rail as
> an empty slot; six lenses said independently that the slot belongs to `PICK-1` PR 4. What survives
> is the grid every page sits in. § Review-response log has the reasoning and the two claims the
> panel found false.

## Goal

**Make a wide screen worth having.** Every screen today is one `max-w-2xl` column centred on the
viewport, so a 1280px display shows ~672px of content between two empty margins and no way to move
between athletes without going back to `/p`.

`UI-5` lands **the grid and the nav rail**. At `lg` and up: a nav rail and the page. Below `lg`:
exactly today's single column.

🔴 **The context rail — the third region — is NOT in this PR.** It is `PICK-1` PR 4's, which is where
its first real consumer lives. See Decision 1.

## Acceptance

Verbatim from the row:

> _"One responsive shell. At `lg` and up it has three regions: a nav rail, the page, and a context
> rail whose content each page supplies. Below `lg` it is today's single column…"_

⚠️ **This PR delivers the first two regions.** The third is Decision 1's deferral, and the row's
sentence is discharged by PR 4, not abandoned.

1. At ≥`lg` an authenticated page renders a persistent nav rail beside the page.
2. **The page content keeps its reading measure at every width** — the log form does not stretch
   (Decision 2).
3. **Below `lg` the rendered geometry is unchanged**, pinned by measurement rather than by a scan
   that cannot see it (Decision 5).
4. **No public route gets a nav rail**, at any width — "public" read from `PUBLIC_PATHS` /
   `PUBLIC_PATH_TREES`, never re-listed here.
5. The 360px floor, ≥44px targets and phone-first ordering are unchanged.

## What the row assumes that is not true yet

| The row says                                                           | Reality                                    |
| ---------------------------------------------------------------------- | ------------------------------------------ |
| "the program editor's rail is `PICK-1`'s movement picker, always open" | The editor is `V1-22` chunks 4–6, unbuilt. |
| "Today's rail is this week's schedule and what's next"                 | `SCHED-1` is unbuilt.                      |
| "an athlete's rail is their calendar and a per-movement chart"         | `V1-16` and `HIST-1` are unbuilt.          |

**Every named consumer of the context rail is unbuilt**, which is why Decision 1 defers it.

## Decisions

### Decision 1 · 🔴 The context rail moves to `PICK-1` PR 4, and the sequencing still holds

The first draft shipped the rail as an empty slot so PR 4 would "not have to retrofit it". The panel
found that backwards, and the architecture lens found the reason:

**A page-level `rail={…}` prop cannot host the picker.** `PICK-1` PR 4 mounts the picker inside
`app/p/[profileId]/strength-form.tsx`, which is `'use client'`; the picker takes `onPick` closures
over form state and renders U0's `<Sheet>` itself (`movement-picker.tsx:265`). An RSC page does not
own that state and cannot pass it upward. So the slot would have served the two consumers that are
RSC data — both unbuilt — and **not** the one the sequencing argument was built around.

Three more findings pointed the same way:

- `docs/plans/pick-1-movement-picker.md` contains **zero** occurrences of "rail" or "UI-5". PR 4 as
  planned is a sheet at every width. The retrofit this PR was to prevent is not yet designed.
- The slot is the only thing forcing a `'use client'` boundary with a `matchMedia` subscription onto
  **every authenticated page** — to choose between two hosts, neither of which has content.
- A jsdom test of "rail children render once" would assert that a `ReactNode` passed through a prop
  renders once. A passthrough, not the invariant.

**The row's sequencing is satisfied anyway.** What must land first is **the grid every page sits in**
— the seam. With it in place, PR 4 adds the third track and mounts the picker in one PR, and no
retrofit occurs.

⚠️ **PR 4 owes an amendment** naming the slot, its width, who owns the sheet trigger and the
mount-once rule, before its implementation. The analysis the first draft did for it is preserved
under § For PR 4 so it is not re-derived.

### Decision 2 · 🔴 The main column keeps its measure. "Uses the width" is the rail's job, not the form's.

The first draft removed the 672px cap and asserted "wider" without saying what the width was _for_.
Two UX lenses measured what that does, and it is worse than today:

At 1280 the main cell would be ~1000px. `strength-form.tsx:807` lays the movement row out as
`flex flex-wrap items-end gap-3` with the name field `flex-1`, so **the Movement text input grows to
~650–700px** — half a screen for a ten-character name — with the unit selects pushed to the far
right of the same row. Set inputs stay `w-24` and left-align inside a fieldset spanning ~1000px.
List rows are `flex justify-between`, so a label sits at x=0 and its value at x≈992.

`design.md` says _"design at the narrow width first and let it scale up"_. Scaling up is not
stretching.

**So:** `<AppShell>`'s main cell is wide; the content inside it keeps `max-w-2xl` and left-aligns
within the cell. The form's internal layout is byte-identical at every width, which also makes
acceptance 3 nearly free.

⚠️ **If the form itself should be wider, that is `UI-1`'s call** — it owns the form's shape. A seam
PR must not change a form's measure as a side effect.

### Decision 3 · The shell is a COMPONENT each page renders, and the guard already exists

No nested `layout.tsx` files exist. Rejected: a route group (a layout **cannot** take content from
its page — Next 16's `layout.md:366` — which is the whole point of a rail), and parallel routes (a
`default.tsx` per slot, plus slots keeping their last active subpage across soft navigation, which is
a stale-rail trap on this app's picker → Today → settings hops).

**The scan is five lines in an existing file, not a new one.**
`apps/web/app/pages-need-a-session.test.ts` already globs every `app/**/page.tsx`, derives the route
with `routeOf()`, strips comments with `code()`, and classifies each page by `isPublicPath(route)`.
"Needs a session" and "gets the shell" are the same set:

```ts
expect(/\bAppShell\b/.test(code(src)) || isPublicPath(routeOf(file))).toBe(true);
```

⚠️ **Two positive assertions are not enough.** `settings/page.tsx` and `p/new/page.tsx` each have
**two** `<main className={PAGE_SHELL_CLASS}>` return branches, so `includes('<AppShell')` is satisfied
by wrapping one. The scan pairs it with a negative: no page that needs a session still imports
`PAGE_SHELL_CLASS` or contains a bare `<main`. `app/p/loading.tsx` is asserted by name — the glob is
`page.tsx`.

### Decision 4 · 🔴 The nav rail IS the athlete switcher (maintainer, 2026-11-13)

**Rail v1: the household's athletes, then Settings.** The interaction lens proposed it and the
maintainer chose it over two static links.

**Why it is the better rail.** The app's real structure is _who is logging today_ — `/p` is the one
top-level place and everything hangs off an athlete. A rail listing athletes therefore gives a laptop
the one thing a phone cannot: **switch kid without a round trip through `/p`**, which is exactly the
maintainer's stated laptop case (log a missed day for one kid, then build next week for another). Two
static links would have put "the page you are already on" at the top of `/p` and `/settings` both,
which is what the lens called furniture.

**It invents no destination.** Every item is a link `/p` already renders, so Decision 4's original
"no new destinations" rule still holds.

**The data is free on `/p` and one query elsewhere.** `listProfiles()` (`lib/dal/profiles.ts:106`) is
household-scoped, drops archived athletes (PROF-1 b criterion 5) and returns
`{ id, name, kind, avatar }` — no bodyweight. It is wrapped in React `cache()`, so a page that
already calls it (`/p`) pays nothing and every other authenticated page pays one query per request.

🔴 **And it removes the plan's only client component.** The obvious `aria-current` implementation is
`usePathname()`, which would make the rail `'use client'`. It does not need to: **every page already
knows what it is**. The day page knows its `profileId`; `/settings` knows it is settings. So the rail
takes `current: { athlete: string } | 'settings' | undefined` as a prop and stays a server component.
One fewer client boundary than the two-link version would have had.

⚠️ **`/p` in the no-household state renders no rail.** `NoHouseholdState` has no athletes and no
settings link, so a rail there would be an empty region or a single item pointing at the page you are
on. That branch passes `nav={false}`.

⚠️ **Privacy, stated because the surface widens:** every sibling's name now appears on every
authenticated page rather than only on `/p`. Same data, same household scope, no new category and no
bodyweight — but on a shared laptop it is visible from the day page too. Recorded, not blocking.

**The export link stays in the page, at every width, in both of its states.** It is a GET that
downloads a minor's full history, not a destination; and `page.tsx:209-220` renders
`NOTHING_TO_EXPORT` when there is no history under a comment reading _"maintainer decision N3 applies
to BOTH surfaces"_. Hiding the inline row at `lg` and showing a rail link only when history exists
would leave a parent with a new athlete seeing nothing about export anywhere — and put the two N3
surfaces back out of agreement. It is also an action on the current record, which a switcher is not.

**Only two inline links get `lg:hidden`:** `p/[profileId]/page.tsx:176` and `p/page.tsx:131`.
⚠️ **Everything else stays at every width**, and the panel listed what the first draft had not
counted: `p/new/page.tsx:98` and `:117`, `p/[profileId]/edit/page.tsx:90` and `:128`, and
`p/[profileId]/page.tsx:254`. Each is either the exit from a writing screen or a recovery sentence,
and `e2e/athletes.spec.ts:437` asserts one of them. A breadcrumb beside a nav rail is a different
pattern, not a duplicate.

⚠️ **Name collision.** If the rail's item reads `SETTINGS_COPY.heading` ("Household settings"), then
`/p/new`, `/edit` and the archived day page each show two visible links with the same accessible
name at ≥`lg` — the strict-mode class #333 already shipped once. The rail's label is **"Settings"**,
distinct from the prose links.

**One IA change, recorded rather than denied.** Today a kid's day page has no route to Settings. At
`lg` the rail puts it one click from the logging screen, and under the household login that is one
click from Archive. `settings/page.tsx` put archive on an administrative screen deliberately.
Acceptable — archive is reversible, with a real Undo — but it is a change, and the first draft's "no
information-architecture change" was not quite true.

### Decision 4a · Landmarks, and the skip link the app has never had

The shell is where `<main>` becomes one element instead of nine, so it is the cheap moment for the
landmark work.

- `<nav aria-label="Primary">` — distinct from the two `<nav>`s that already exist
  (`day-nav.tsx:55` "Change day", `p/page.tsx:130` "Household").
- `<main id="main" tabIndex={-1}>`, bare of other attributes. ⚠️ The `tabIndex` is not decoration:
  `sheet.tsx:433` patches it onto `<main>` at runtime for its focus fallback, and setting it here
  makes that deterministic.
- `<footer>` as a **grid sibling of `<main>`**, never a child (Decision 5).

🔴 **A skip link, because there is none anywhere in the app.** With the rail first in the DOM a
keyboard user tabs through navigation before reaching the form on every page. axe will not ask for
one — `bypass` is satisfied by landmarks alone — so this would pass every gate and still be worse
than today. `sr-only focus:not-sr-only` as `AppShell`'s first child, targeting `#main`.

⚠️ **Why now rather than later:** the regression is _order_, not count, and it compounds with every
item the rail gains. Adding it while `<main>` is being centralised costs a few lines; adding it after
means touching the shell again.

### Decision 5 · 🔴 Acceptance 3 gets a guard that can fail

The first draft wrote _"asserted rather than eyeballed: the 390px a11y scan and screenshots must not
move."_ The trust lens checked: `a11y.spec.ts` runs axe (DOM, labels, contrast) and tap-target
**height**. It reads no position, no padding, no `gap`, and does not know where the footer sits.
Screenshots go to a gitignored directory and are never diffed. **The guard goes green on any spacing
or ordering change** — the "gate that isn't" this repo names four times in that very file.

And two edits in the first draft's own table could shift the phone layout:

- **The footer.** Moved inside `<main>` it inherits `gap-8`, sits inside `py-12`, and becomes a
  `contentinfo` nested in `main` — axe `landmark-contentinfo-is-top-level`, which is tagged
  `best-practice` and **not in the scanned rule sets**.
- **`flex-1`.** `PAGE_SHELL_CLASS` carries it, and `constants.ts:556` says why: `<body>` is a flex
  column, so without it a short page's `<main>` collapses and the footer rides up. If `<main>`
  becomes a grid cell, `flex-1` has to move with it or `/settings` and `/p/new` shift on a phone.

**So:** the footer stays a **sibling after `<main>`**, inside the main column, never inside the
landmark. ⚠️ A `<footer>` nested in `<main>` is not exposed as `contentinfo` at all, and
`privacy.spec.ts:108` clicks `getByRole('contentinfo')` on an authenticated page — so that one is
caught by an existing test, unlike the spacing. `expectLinkTapTargets` also counts links inside
`main` (`a11y.spec.ts:725`), which `site-footer.tsx:43` records as the reason the footer sits
outside. `flex-1` stays on `<main>`. And acceptance 3 is pinned by geometry: at 390px, for Today,
`/settings` and `/p/new` — main's box, computed padding and `row-gap`, the `h1` y, the first input's
y, the footer's y relative to main's bottom, and `documentElement.scrollHeight` — recorded on
`origin/main` and asserted on the branch.

### Decision 6 · `UI-3` ordering is already settled — a correction, not a question

The first draft asked the maintainer to choose. Three lenses found the answer recorded:
`docs/roadmap.md:53` (U0) and `:59` (PICK-1) both state **"`UI-3` must not land before `PICK-1`
PR 4"** — U0's only mounted sheet is the `/design/tokens` cell `UI-3` deletes. Since `UI-5` precedes
PR 4, the order `UI-3 → UI-5 → PR 4` is **forbidden by an existing constraint**.

`roadmap.md:103`'s "`UI-4` → `UI-3` (then `UI-5`…)" is stale and inconsistent with its own rows. This
PR corrects it.

## File-by-file changes

| Path                                                                                                                                                        | Change | What & why                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/components/layout/app-shell.tsx`                                                                                                                  | NEW    | **Server component, no client boundary.** Props: `children`. Below `lg`: a `flex-1` flex column — `PAGE_SHELL_CLASS`'s spacing by composition, not restatement. At `lg`: `lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]`, content capped per Decision 2. One `<main>`, bare — `sheet.tsx:434` and `sheet.test.tsx:265` depend on no `<main>` carrying a `tabIndex`. Footer rendered as a sibling after `<main>` (Decision 5). |
| `apps/web/components/layout/nav-rail.tsx`                                                                                                                   | NEW    | Decision 4's two links, `hidden lg:flex`. `aria-current` needs `usePathname`, so this is the one `'use client'` leaf — the idiom `site-footer.tsx` already uses, and for the same recorded reason (a server-rendered pathname is stale after a soft nav).                                                                                                                                                                  |
| `apps/web/lib/constants.ts`                                                                                                                                 | EDIT   | Split once: `PAGE_COLUMN_CLASS` (spacing, no width) and `PAGE_SHELL_CLASS = \`mx-auto max-w-2xl ${PAGE_COLUMN_CLASS}\``— unchanged value, pinned by a contract test.`AppShell` composes the spacing instead of re-typing it; the constant's own docblock forbids a ninth literal. Plus the rail's label.                                                                                                                   |
| `apps/web/app/p/page.tsx`, `p/[profileId]/page.tsx`, `p/[profileId]/edit/page.tsx`, `p/[profileId]/routine/page.tsx`, `p/new/page.tsx`, `settings/page.tsx` | EDIT   | `PAGE_SHELL_CLASS` wrapper → `<AppShell>`. ⚠️ `settings` and `p/new` have **two** return branches each.                                                                                                                                                                                                                                                                                                                    |
| `apps/web/app/p/loading.tsx`                                                                                                                                | EDIT   | Same wrapper, and it must carry `aria-busy` as today.                                                                                                                                                                                                                                                                                                                                                                      |
| `apps/web/app/p/[profileId]/page.tsx`, `app/p/page.tsx`                                                                                                     | EDIT   | `lg:hidden` on **two** links only (Decision 4).                                                                                                                                                                                                                                                                                                                                                                            |
| `apps/web/app/layout.tsx`, `app/page.tsx`, `app/privacy/page.tsx`                                                                                           | EDIT   | Remove `<SiteFooter />` from the root layout; render it in `AppShell` and in the two public pages that show it. A layout cannot know the pathname (Next 16 `layout.md:238`), so the alternative is two `contentinfo` landmarks. `/sign-in`'s `null` branch becomes dead — delete it.                                                                                                                                       |
| `apps/web/components/layout/site-footer.tsx`                                                                                                                | EDIT   | Takes its width from its container rather than re-typing `max-w-2xl`.                                                                                                                                                                                                                                                                                                                                                      |
| `apps/web/app/pages-need-a-session.test.ts`                                                                                                                 | EDIT   | Decision 3's scan, positive **and** negative.                                                                                                                                                                                                                                                                                                                                                                              |
| `apps/web/components/layout/app-shell.test.tsx`                                                                                                             | NEW    | jsdom: one `<main>`, bare of `tabIndex`; nav present at `lg` markup; footer outside the landmark. Plus `renderToString` — the shell must server-render with no hook in the tree.                                                                                                                                                                                                                                           |
| `apps/web/e2e/a11y.spec.ts`                                                                                                                                 | EDIT   | Decision 5's 390px geometry pin, and a 1280px case: rail visible, `/sign-in` has none, **plus `expectNoAxeViolations`** — the nav adds a landmark and heading order at `lg` is currently unscanned.                                                                                                                                                                                                                        |
| `docs/design.md`                                                                                                                                            | EDIT   | A pointer: where the shell lives and what its regions are. Not a third copy of the responsive rule.                                                                                                                                                                                                                                                                                                                        |
| `docs/architecture.md`                                                                                                                                      | EDIT   | A short diagram — a seam on every authenticated page earns one (AGENTS.md).                                                                                                                                                                                                                                                                                                                                                |
| `docs/plan.md`, `docs/roadmap.md`, `docs/status.md`, `docs/changelog/…`                                                                                     | EDIT   | `UI-5` done; `roadmap.md:103` corrected per Decision 6.                                                                                                                                                                                                                                                                                                                                                                    |

**Not edited:** `app/sign-in/**`, `app/error.tsx`, `app/design/tokens/**`.

**Free coverage, worth knowing:** the `chromium` project runs at `devices['Desktop Chrome']` =
**1280×720**, which is ≥`lg`. Every existing functional flow will run under the new shell without a
new spec — and that is where a duplicate accessible name would surface.

## Test plan

1. **jsdom** — one bare `<main>`; footer outside the landmark; `renderToString` emits the shell with
   no client hook in the tree.
2. **The page scan**, positive and negative (Decision 3). Probe by wrapping only one of
   `settings/page.tsx`'s two branches and confirming red.
3. **390px geometry pin** (Decision 5) — recorded on `origin/main`, asserted on the branch. This is
   acceptance 3, and it is the assertion the first draft lacked.
4. **1280px e2e** — ⚠️ **in a `test.describe` with `test.use({ isMobile: false, hasTouch: false })`.**
   The `a11y` project pins `isMobile: true` (`playwright.config.ts:71`), and `setViewportSize` does
   not clear it, so a "desktop" test there is a 1280px _phone_. It asserts: exactly one `main`;
   `navigation[name="Primary"]` visible and **outside** `main`; one `contentinfo`; every rail link
   ≥ `MIN_TAP_TARGET_PX` with a visible focus ring; `expectNoAxeViolations` — the suite's first
   desktop axe run; and no `navigation[name="Primary"]` on `/` or `/sign-in`.
   🔴 **The rail's links are currently measured by nothing**: `expectLinkTapTargets` scopes to
   `getByRole('main')` and its `INTERACTIVE` list excludes `<a>`, and the rail sits outside `main`.
5. **Positive phone assertions at 390, 360 and 820** — `navigation[name="Primary"]` is hidden and
   `main`'s box is the expected width. 820 must still be the phone layout. Acceptance 5's guard
   ("the existing scan passes unedited") is necessary and **not sufficient**: a rail that leaked into
   the phone layout with 44px links would pass axe, tap targets and overflow.
6. **The existing 390px a11y scan passes unedited.**
7. **Screenshots** at 390 / 820 / 1280. ⚠️ `screenshot:ephemeral` **reuses `.next`**, so delete it
   before the capture pass or the pictures show the old render.

## Risks / rollback

| Risk                                                              | Mitigation                                                                                  |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| The phone layout moves.                                           | Decision 5's geometry pin. The first draft's guard could not see it.                        |
| `flex-1` lost in the move → footer rides up on short pages.       | Named in Decision 5; the geometry pin covers `/settings` and `/p/new`, the two short pages. |
| Two `contentinfo` landmarks from a half-done footer move.         | The footer leaves the root layout entirely; three call sites, stated.                       |
| A duplicate accessible name at `lg` ("Household settings" twice). | Decision 4's distinct rail label; the chromium project runs at 1280 and would surface it.   |
| **Rollback**                                                      | Revert. Layout only — no schema, no data, no migration, and public routes untouched.        |

## Out of scope / deferred

### For PR 4 — the context rail, with the first draft's analysis preserved

So it is not re-derived. PR 4 adds the third grid track and mounts the picker in the same PR.

- 🔴 **Rail content must mount ONCE, and the primary reason is ids, not live regions.** Rendering it
  twice and hiding one duplicates every derived id — the picker derives `movement-picker-search` and
  `movement-picker-typed-hint` from one `SHEET_ID` — so `htmlFor` and `aria-describedby` resolve to
  whichever copy is first in the DOM. If that is the hidden one, **the visible search box is
  unlabelled**: axe `label`, which is `wcag2a` and therefore scanned. The live-region argument
  (`announcer.tsx` rule 3) is the second reason, not the first. ⚠️ The first draft claimed
  `announcer.test.tsx` tests for this; **it does not** — see the log.
- **The hosts are genuinely different.** `Sheet` portals to `document.body`
  (`sheet.tsx:391`) and, with no `forceMount`, a **closed sheet renders its children nowhere**. So a
  "renders once" test only discriminates at narrow width **with the sheet open**.
- **Grid tracks from the server, mount host from the client.** The third track must be reserved in
  the server HTML from the page's declaration; only the content's host is runtime-chosen. Otherwise
  the main column narrows by 352px after hydration — a CLS event on the one screen where a parent
  may already be typing.
- **The host needs a client door**, not a prop: the picker lives inside a client form. A
  `RailProvider` / `useRailHost()` leaf in `components/layout/` exposing the cell via context, with
  the consumer doing `wide ? createPortal(body, host) : <Sheet>{body}</Sheet>`. It must live in
  `components/`, not `app/`, or it breaks `movement-picker.md` invariant 2.
- **The picker owes a host-agnostic body.** It bakes `<Sheet>` in at `:265`; "the same component
  renders in the rail and in the sheet" is not an API until that is split.
- **State is lost on a host swap.** Crossing the breakpoint remounts the content under a new parent;
  the picker's `query` dies. An iPad rotating between 1180 and 820 crosses it. Either lift the state
  to the owner or accept the loss, explicitly.
- 🔴 **The rail needs `xl`, not `lg`, and the arithmetic says why.** Fixed furniture is 16rem + 22rem
  = 608px. Subtracting page padding, grid gaps and card padding, the strength set row gets:

  | Viewport                           | What the set row gets |
  | ---------------------------------- | --------------------- |
  | 1024 (`lg`, iPad mini landscape)   | **304px**             |
  | 1024 with a 17px classic scrollbar | **287px**             |
  | 1280 (`xl`)                        | 560px                 |

  A 390px phone gives that row 358px, and it is budgeted against ~296px (`strength-form.tsx:937`).
  **So at `lg` a laptop would hand the form less than a kid's phone**, and under a desktop scrollbar
  less than its own budget. Breakeven for "at least as wide as today's 672px box" is **1360px**.
  Nav rail at `lg`; context rail at `xl`. Between them the content stays in the sheet.

- **The media query must be in `rem`, not `px`.** Tailwind v4 compiles `lg:` to
  `@media (width >= 64rem)`, and `rem` in a media query tracks the **browser's** font setting. A
  reader using a 20px default gets `lg` at 1280 while `matchMedia('(min-width: 1024px)')` flips at
  1024 — and between them the JS mounts content into a grid column that does not exist yet.
  `matchMedia('(min-width: 80rem)')`, from a named constant, with a contract test.
- 🔴 **Never unmount an OPEN sheet on the swap.** The consumer renders `<Sheet open={open && !isWide}>`
  so the sheet _closes_ rather than disappearing: `useBackGesture`'s pop runs on the open→closed
  transition and `onCloseAutoFocus` returns focus. Unmounting it instead **strands its history
  entry** — the pop has no unmount cleanup — so the next Back press is swallowed and the one after
  leaves the page. Wide→narrow with focus inside the rail moves focus to the sheet's trigger, not to
  `<body>`.
- **The rail host must render the status region the sheet does.** `movement-picker.tsx:306` points
  `aria-describedby` at `sheetStatusId(SHEET_ID)`, an id **rendered by `Sheet`** (`sheet.tsx:522`).
  In a rail there is no Sheet, so the attribute dangles — axe `aria-valid-attr-value`, which is
  `wcag2a` and _is_ scanned.
- **The sheet centres on the viewport** (`sheet.tsx:450`), so it sits off-centre beside a rail. It
  gets _easier_ if the rail cell is a real DOM host, since the dialog can position against `<main>`.

### Also out of scope

- The programs-list screen (no row, no design).
- Rail content for Today and the athlete page — blocked on `SCHED-1` / `V1-16`.
- New navigation destinations.
- `/design/tokens` — a dev harness, and `UI-3` deletes its sheet cell.
- Native apps. The row says it: web only.

## Open questions

**None.** The one that was open — whether the nav rail should be the athlete switcher rather than two
links — was **decided by the maintainer on 2026-11-13 in favour of the switcher**, and is now
Decision 4. The other two the first draft carried are closed: `/design/tokens` is excluded by
Decision 3's scan, and the `UI-3` ordering was never a choice (Decision 6).

## Roadmap alignment (2026-11-13)

Checked by capability, not by id: **`UI-5` is the only row that owns this.** It gates `PICK-1` PR 4
and nothing else; `UI-3` is ordered after PR 4 by `roadmap.md:53,59` (Decision 6). It takes
constraints from `U0` (the sheet is the phone host when PR 4 adds the rail) and from `UI-1` (which
deletes the day page's program card, so this plan does not move it, and which owns the form's
measure — Decision 2).

## Review-response log — seven lenses, 2026-11-13 (before implementation)

Correctness, scope, architecture and reuse (the four standing lenses), plus the UX panel the row
requires at full depth — interaction, a11y/responsive, trust. All seven ran in parallel against the
first draft.

**The panel cut the plan roughly in half and found two claims in it false.** The convergence is the
part worth recording: **six lenses independently reached the same cut** (defer the context rail),
each from a different direction — scope by line count, architecture by the prop API, correctness by
the untestable assertion, interaction by what a user would see, trust by the data-entry cost, reuse
by the client boundary.

### The two false claims

| Claim in the first draft                                                                     | What the code says                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "`announcer.test.tsx` scans every consumer for exactly this" (the `lg:hidden` double-render) | **False.** `announcer.test.tsx:49-60` matches `/<Announcer[^>]*>/` — the component's own props, only in files containing that tag. An ancestor's class in another file is invisible to it. And the draft's own example, `<Sheet className="lg:hidden">`, is not expressible: `Sheet` has no `className` prop and portals to `document.body`. Rule 3 is real; the gate is not. The conclusion survives on the duplicate-id argument, which is now stated first. |
| "its content stays mounted when closed" (the sheet)                                          | **False.** `Dialog.Content` is `Presence present={forceMount \|\| open}` and `sheet.tsx` passes no `forceMount` — a closed sheet renders its children **nowhere**. The draft's "renders once" test would therefore have passed against the broken implementation, since the count is 1 at wide _and_ at narrow-closed. It only discriminates at narrow **with the sheet open**.                                                                                |

Both were the defect this repo names most often: an assertion that cannot fail, written confidently.

### Findings and verdicts

| #   | Lens(es)                                                    | Critique                                                                                                                                                                                                                                                                                                                                                          | Verdict                                           | Resolution                                                                                                                                                                                                                    |
| --- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | scope, architecture, correctness, interaction, trust, reuse | 🔴 **The context rail belongs to PR 4, not here.** A page-level `rail` prop cannot host the picker (it lives in a `'use client'` form and closes over form state); `pick-1`'s plan has never heard of the slot; the slot is the only thing forcing a client boundary onto every authenticated page; and the "renders once" test would be a passthrough assertion. | **accepted**                                      | Decision 1. The whole slot, the hook and the sheet host move to § For PR 4 with the analysis preserved. Code+tests fall from ~450–500 to ~300.                                                                                |
| 2   | interaction, trust, scope                                   | **The plan never said what the main column does with the width** — and measured, it stretches a log form: the Movement input grows to ~650–700px, list rows put label and value ~992px apart.                                                                                                                                                                     | **accepted**                                      | Decision 2. Content keeps `max-w-2xl` inside a wide cell. Also makes acceptance 3 nearly free. ⚠️ If the form should be wider, that is `UI-1`'s call.                                                                         |
| 3   | a11y                                                        | 🔴 **At `lg` with a rail the form gets 336px — narrower than a 390px phone** (287px with a desktop scrollbar, under the set row's own 296px budget). Breakeven is 1360px.                                                                                                                                                                                         | **accepted**                                      | The arithmetic is in § For PR 4: nav rail at `lg`, context rail at `xl`. The row's "at `lg`" needs a one-word amendment, which this is the evidence for.                                                                      |
| 4   | trust                                                       | 🔴 **Acceptance 2's guard could not detect what it guarded.** The 390px scan is axe plus tap-target _height_; it reads no position, padding, gap or footer placement, and screenshots are never diffed — while two of the draft's own edits (the footer move, `flex-1` migration) could shift the phone layout.                                                   | **accepted**                                      | Decision 5: a geometry pin recorded on `origin/main` and asserted on the branch, plus the footer staying outside `<main>` and `flex-1` staying on it.                                                                         |
| 5   | a11y                                                        | **No skip link exists anywhere in the app**, and the rail puts nav before content on every page. axe's `bypass` is satisfied by landmarks, so no gate would ask.                                                                                                                                                                                                  | **accepted**                                      | Decision 4a. Added now because the shell is the moment `<main>` is centralised; `tabIndex={-1}` also makes `sheet.tsx:433`'s runtime patch deterministic.                                                                     |
| 6   | a11y                                                        | **A 1280px test in the `a11y` project inherits `isMobile: true`** — it would be a 1280px phone — and `expectLinkTapTargets` scopes to `main` and excludes `<a>`, so the rail's links are measured by nothing.                                                                                                                                                     | **accepted**                                      | Test plan 4: its own `test.use({ isMobile: false })`, explicit nav-link measurement, and the suite's first desktop axe run.                                                                                                   |
| 7   | trust, scope, architecture                                  | **The export link does not belong in the rail.** It is a download, not a destination; it depends on `hasHistory`, so the rail would not be static; and hiding the inline row at `lg` drops decision N3's "nothing to export" state, putting the two N3 surfaces back out of agreement.                                                                            | **accepted**                                      | Decision 4: rail is two static links; export stays in the page in both states at every width.                                                                                                                                 |
| 8   | trust                                                       | **Decision 4 undercounted the inline links** — five more exist, each an exit from a writing screen or a recovery sentence, one asserted by `athletes.spec.ts:437`. And a rail labelled "Household settings" collides with prose links of the same accessible name.                                                                                                | **accepted**                                      | Decision 4 lists the two that get `lg:hidden` by `path:line`, states the rest are untouched, and gives the rail the distinct label "Settings".                                                                                |
| 9   | scope, architecture, interaction                            | **Decision 5 (UI-3 ordering) was not a question.** `roadmap.md:53,59` already state "`UI-3` must not land before `PICK-1` PR 4"; `:103` is stale.                                                                                                                                                                                                                 | **accepted**                                      | Decision 6 — a correction made in this PR, not a decision asked of the maintainer. The draft's open question 1 is deleted.                                                                                                    |
| 10  | reuse, architecture                                         | **Two width definitions.** The draft had `AppShell` re-type the spacing while `PAGE_SHELL_CLASS`'s own docblock says "append rather than fork … rather than writing a ninth literal".                                                                                                                                                                             | **accepted**                                      | `PAGE_COLUMN_CLASS` / `PAGE_SHELL_CLASS` split; the shell composes. Acceptance 3 becomes true by construction rather than by resemblance.                                                                                     |
| 11  | reuse                                                       | **The breakpoint was written twice in two units** — `matchMedia('1024px')` against Tailwind's `lg` = `64rem`, which diverge the moment a reader enlarges their browser font.                                                                                                                                                                                      | **accepted, and then dissolved**                  | With the hook deferred (finding 1) there is no second expression left in this PR — everything is CSS `lg:`. The constraint is recorded in § For PR 4, where the hook returns.                                                 |
| 12  | reuse, scope, architecture, correctness                     | **The source scan already exists.** `pages-need-a-session.test.ts` globs `app/**/page.tsx`, derives routes and classifies by `isPublicPath`; "needs a session" and "gets the shell" are the same set. A new file with a hand-written glob is the allowlist shape this repo rejected before.                                                                       | **accepted**                                      | Decision 3: five lines in the existing file. Acceptance 4 is now derived from `PUBLIC_PATHS` instead of restated.                                                                                                             |
| 13  | correctness                                                 | **Two positive assertions would not be enough** — `settings/page.tsx` and `p/new/page.tsx` each have two `<main>` return branches, so wrapping one satisfies a substring check.                                                                                                                                                                                   | **accepted**                                      | Decision 3 pairs the positive with a negative: no page keeps `PAGE_SHELL_CLASS` or a bare `<main`. `loading.tsx` asserted by name.                                                                                            |
| 14  | architecture, trust, a11y                                   | **The footer move was under-specified and impossible from the root layout** (a layout cannot know the pathname), and a footer inside `<main>` is not exposed as `contentinfo` — which `privacy.spec.ts:108` would catch.                                                                                                                                          | **accepted**                                      | The footer leaves the root layout for three explicit call sites and sits as a grid sibling of `<main>`.                                                                                                                       |
| 15  | architecture, trust                                         | **Grid tracks must be server-decided**, not chosen by the same runtime hook, or the main column narrows by 352px after hydration — a CLS event while a parent may already be typing.                                                                                                                                                                              | **accepted, deferred**                            | Recorded in § For PR 4, which is where tracks and hosts both arrive.                                                                                                                                                          |
| 16  | a11y                                                        | **The breakpoint crossing has no state machine**: an unmounted open sheet strands its history entry (the pop has no unmount cleanup), and focus drops to `<body>`.                                                                                                                                                                                                | **accepted, deferred**                            | § For PR 4: `open={open && !isWide}` so the sheet _closes_ rather than disappearing, with the wide→narrow focus target stated.                                                                                                |
| 17  | a11y                                                        | **The rail host must render the sheet's status region**, or PR 4 ships a dangling `aria-describedby` (`sheetStatusId` is rendered by `Sheet`).                                                                                                                                                                                                                    | **accepted, deferred**                            | § For PR 4.                                                                                                                                                                                                                   |
| 18  | interaction                                                 | **The nav rail should be the athlete switcher**, not two links — the app's real structure is "who is logging today", and a rail listing athletes gives a laptop the one thing a phone cannot.                                                                                                                                                                     | **escalated → ACCEPTED** (maintainer, 2026-11-13) | Decision 4. It cost less than it looked: `listProfiles()` is React-`cache()`d so `/p` pays nothing, and passing `current` as a prop instead of reaching for `usePathname` leaves this PR with **no client component at all**. |
| 19  | trust                                                       | Decision 4's "no information-architecture change" was not quite true — the rail puts Settings, and so Archive, one click from the logging screen.                                                                                                                                                                                                                 | **accepted**                                      | Decision 4 records it as deliberate rather than denying it.                                                                                                                                                                   |

### Pushbacks

| #   | Critique                                                                                                                                    | Why not                                                                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1  | interaction: ship `UI-5` **with** its first consumer instead (option B), so there is no visible desktop change until a real consumer exists | **Rejected.** That is PR 4 doing the seam and the feature in one PR, on every authenticated page — the thing the seam exists to avoid. The grid and the nav rail are a standalone, reviewable change, and the nav rail is a real improvement on its own once finding 18 is settled.              |
| P2  | scope: drop the nav rail too, leaving only a wider main column                                                                              | **Rejected**, and the lens agreed it was the floor rather than the recommendation. A wider column alone is finding 2's problem with nothing to use the width.                                                                                                                                    |
| P3  | architecture: adopt parallel routes (`@rail`) as the idiomatic Next answer                                                                  | **Rejected**, and the lens concurred after reading the bundled docs: a `default.tsx` per slot, and slots keep their last active subpage across soft navigation — a stale-rail trap on this app's picker → Today → settings hops. A page can get independent streaming with its own `<Suspense>`. |

### Standing obligations

`ID-1`'s six keep-open items: **not engaged.** This plan adds no column, no scope field and no
authority check; it changes layout only, and touches no identity, household, role, sharing or
catalog surface. Recorded so the next reader sees the check ran rather than wondering.

## What implementation changed — the plan was wrong in four places

Recorded here rather than silently absorbed, because three of the four were found by the test suite
on the first run and one by reading the code the plan had reasoned about.

| #   | The plan said                                                                                   | What shipped, and why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | `/p` gets the rail like every other authenticated page (only the no-household branch opts out)  | **`/p` renders no rail in any of its three states.** The rail IS the athlete switcher and `/p` is the athlete switcher, so the rail rendered a second link to every athlete — same accessible name, same `href` — beside the tile it duplicated. ⚠️ **The plan anticipated exactly this collision class for the _Settings_ label and did not count it for the athletes themselves.** `e2e/steps.ts:64` (`selectProfile`, a regex on the name) failed on the first run at the setup project's 1280px, before any test of this PR's own ran. |
| D2  | Two inline links get `lg:hidden`: `p/[profileId]/page.tsx:176` and `p/page.tsx:131`             | **Neither does; nothing is hidden at any width.** That bullet was written for the two-static-link rail, where `← All athletes` would have duplicated a "Home" item. The rail that shipped replaces the SWITCHING function of `/p`, not `/p`: that page is the only home of sign out, the theme toggle, Add an athlete and the archived count. Hiding the way there at `lg` would have stranded all four on a laptop — and with D1 there is no rail on `/p` to make its own settings row redundant either.                                  |
| D3  | `site-footer.tsx`'s `/sign-in` suppression stays; `nav-rail.tsx` is the one `'use client'` leaf | **The suppression is deleted and the PR ships no client component.** The footer left the root layout, so `/sign-in` never mounts it — a `return null` for a tree it is not in is a branch no render can reach, and `a11y.spec.ts` already asserts the zero `contentinfo` count structurally. `usePathname()` stays for `aria-current`, which is unrelated. The rail needed no hook at all: `current` is a prop.                                                                                                                            |
| D4  | The 1280px case belongs in `a11y.spec.ts`; the 390px geometry pin goes there too                | Split. The geometry pin is its own file (`e2e/ui5-geometry.spec.ts`) because it runs in the `chromium` project and its baselines had to be recorded on the pre-shell commit; the 1280px block is in `a11y.spec.ts` where axe lives. `expectLinkTapTargets` took a `root` parameter on the way — it scoped to `getByRole('main')` internally, which is exactly where the rail is not.                                                                                                                                                       |

**One addition the plan did not ask for:** an 820px case asserting the tablet is still the single
centred column, as _properties_ (`main` is 672px wide, centred) rather than a snapshot — so it needed
no baseline from the pre-shell commit and can never go stale against a content change.

**Both new tests were probed RED** before being trusted: the footer moved inside `<main>` reddens the
jsdom nesting assertion, and a `<main>` added to `settings/page.tsx` reddens the source scan.

### One defect the tests did not find, and the test that now does

**`/p` at 1280 lost its centring.** The shell's `lg:` classes — `lg:mx-0 lg:max-w-none lg:px-8` —
exist to turn a centred column into the grid's **second cell**, and they were written
unconditionally. On the one page that renders no rail there is no grid for them to belong to, so
they pinned the picker against the left edge of a 1280px window with ~600px of nothing beside it,
and left the footer centred on the window instead of under the content.

Every gate was green: `verify`, 113 e2e tests, the geometry pin (which measures 390 and 360, where
no `lg:` class applies), and axe (which has no opinion about where a column sits). **A desktop
screenshot is what showed it** — the one artifact in this repo's UI process that a human reads.

The classes are now gated on `showRail`, and `a11y.spec.ts`'s 1280px block measures the picker:
`main` is 672px wide, centred, with the footer at the same x. The general rule it illustrates, worth
carrying into PR 4 where a third track arrives: **a width-conditional class and a
presence-conditional region have to agree, and only a measurement says whether they do.**
