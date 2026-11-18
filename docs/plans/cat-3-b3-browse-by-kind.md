# CAT-3 B3 — the picker's browse list, by kind of training and then family

> Backlog: [plan.md](../plan.md) row `CAT-3`. Spec:
> [cat-3-movement-library](../specs/cat-3-movement-library.md), criterion **P12**, with **K23** and
> **K24**, and the B3 row of "Chunks, in order". Branch: `feat/cat-3-b3-browse-by-kind`. Lane B.
> **Plan only:** no code until the maintainer approves it.

## Where this sits

- **Pillar:** the movement library. It is shared reference data and has no pillar in roadmap.md's
  table.
- **Milestone:** Beta 0, `CAT-3`'s picker chunks (B1 → B2-i → B2-ii → **B3**).
- **This PR:** B3, the last picker chunk. With no query, "All movements" opens to the kind of
  training and then a family, instead of the five legacy groups. Until the fresh start, the old
  built-ins with no library entry get one folded section at its end (K24).
- **Before it:** B2-ii (#575, merged 2026-11-18). The C0b-2 contract (`browseTree`,
  `MOVEMENT_FAMILY_LABELS`, `BROWSE_OPEN_AT_MOST` in `packages/shared/src/catalog/families.ts`) is
  already on `main`.
- **Build gates:** the spec's B3 row reads "After B2-ii and **P11-ii**", and P11-ii comes "After
  P11-i and **A2**". Neither P11-ii nor A2 is on `main` on 2026-11-18. This plan is written now,
  plan only, on the board's sequencing call. Whether B3 may build before P11-ii is a question put to
  the spec owner (Open questions, Q1). §Assumptions lists what this plan takes from P11-ii's text
  as #587 left it.
- **After it:** F1 (fixtures), then R (the fresh start), which deletes K24's section and the legacy
  `group` with its constants.
- _Roadmap alignment (2026-11-18): advances `CAT-3` (chunk B3). It touches the movement catalog's
  presentation only, and adds no column, no scope and no authority, so `ID-1`'s keep-open items are
  answered as untouched in the log below. Checked against the private roadmap; nothing to add here._

## Goal

Make the no-query list read the way the accepted prototype
([`picker.html`](../prototypes/beta-0/picker.html), K19) and P12 say:

1. "Your custom items", then "Recent" (no filter only), then "All movements".
2. All movements opens to the **kind**, then the **family**.
3. Every heading carries its count.
4. The two top sections start open; a kind or a family starts folded, except that **every group
   opens itself when a filter leaves `BROWSE_OPEN_AT_MOST` (20) or fewer**.

Today's browse is built from the legacy `group` field, which only the 35 old built-ins carry
(`apps/web/components/movements/movement-picker.tsx:690`). So a library row with no old twin
**never appears in browse at all**, only in search. That gap grows with every catalog batch once A2
seeds them. B3 closes it.

Until the fresh start, the ~29 old built-ins with no library entry have no kind. They go into one
folded section at the end of All movements (K24), so nothing search can find is missing from
browse. The six old/library pairs are listed twice (K23); in B3 that falls out with no code,
because the old row is a bare built-in (in K24's section) and its library twin has a kind (in the
tree).

## Acceptance

From the spec, verbatim (P12):

> With no query, the picker shall show **two sections that fold like a tree** _(maintainer,
> 2026-11-17)_: "Your custom items"; then, with no filter on, recent items where the screen has
> them; then "All movements". All movements open to **the kind of training, then a family**: for
> strength the lift pattern under a plain label ("Pull-ups and pulldowns", "Rows", "Core"), for the
> other kinds a body area from the primary muscle ("Hips and legs"). The family labels are a
> contract const (C0b-2). Each heading shows its count. The two sections start open; a kind or a
> family is collapsed until opened, the biggest family first; when a filter leaves 20 or fewer
> movements the groups are open. With a filter on, "All movements" reads "Movements that fit your
> filters", the counts are the filtered ones, an empty heading is dropped, the custom section
> starts folded (P9) and "Recent" is not shown. **A row carries no heading tag**: its second line
> is P14's.

And K24: _"one folded section at the end of 'All movements' (its label is lane B's, in the picker's
copy; 'Other movements' is the working name), with its count."_

Done when:

- **No query, no filter:** headings in this order: "Your custom items · N" (open); "Recent" (when
  the screen passes recents); "All movements · N" (open), holding each kind in `BROWSE_KINDS`
  order (folded, with its count), each kind holding its families biggest first (folded, with
  their counts); then K24's section (folded, with its count) when any row is a bare built-in.
- **Every library row is reachable by browse**, including one with no legacy `group`. A test lists
  a library-only option and finds it under its kind and family.
- **With a filter on:** "Movements that fit your filters · N" holds the filtered tree. Empty kinds
  and families are dropped. K24's section is dropped, since no bare row passes a filter. Custom
  items are folded to one line, "not filtered" (P9, as today). No Recent. At **20 or fewer** fitting
  movements, every kind and family is open.
- **A family holding a ticked row starts open** (multi mode), as `FoldedSection` already does for
  its own rows, so a tick is never hidden behind a fold.
- **No row carries a group tag.** `COPY.groupLabel` as a search-result tag is gone, and the second
  line is P14's alone.
- **No match at all** (the empty-search fallback at `movement-picker.tsx:1099`): the tree is shown,
  filtered when a filter is on (P10), never the legacy groups.
- **The e2e accessibility spec** (`movement-picker.a11y.spec.ts`) adds browse with no filter (a
  kind and a family opened) and browse with the 20-or-fewer auto-open, at `NARROW_VIEWPORT`: axe,
  44px targets, no sideways scroll inside the sheet.
- **Screenshots** at 390/820/1280: the browse tree closed, a kind and a family open, the filtered
  tree auto-opened, and K24's section open (the last on a fixture that has bare rows; see
  §File-by-file, `picker-options.ts`).

## Assumptions taken from P11-ii's text (to re-check when P11-ii lands)

1. **The option shape does not change.** A library option keeps `modality`, `pattern` and
   `primaryMuscle` (`CatalogOptionTaxonomy`). P11-ii changes their source, from the const to the
   tables, not their type.
2. **Old built-ins are still listed until R2** (K22, the P11-ii row as #587 rewrote it). One with a
   library slug carries the entry's taxonomy (so it sits in the tree), and one without is
   `BuiltInWithoutLibrary` (K24's section).
3. **`hasLibraryData`** (`apps/web/lib/movements/movement-option.ts`) stays the one test for "has a
   kind". B3 adds no second rule.

If any of these is false when P11-ii merges, this plan is re-panelled before code.

## File-by-file changes

| Path                                                             | Change    | What & why                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web/components/movements/browse-tree.tsx`                  | **NEW**   | The tree as a component: `BrowseTree({ options, filtered, mode, headingId, rowsFrom })`. One `<details>` per kind and per family, the `h4`/`h5` heading inside each `summary` (see "Headings" below), counts from `browseTree`'s `count` and `options.length`. Its own file: `movement-picker.tsx` is ~1,500 lines, and the tree is self-contained.    |
| `apps/web/components/movements/movement-picker.tsx`              | EDIT      | Replace `browseGroups` (`:690`) with `<BrowseTree>` at both sites (`:1065`, `:1099`); replace `filteredBrowse`'s flat "fit" section (`:715-745`) with the filtered tree; move "Your custom items" FIRST and fold it like the prototype (`:1066`); drop the `groupLabel` tag from `tagFor` (`:547-549`) and `groupIndex` (`:709`).                      |
| `apps/web/lib/movements/movement-picker-copy.ts`                 | EDIT      | `allMovements: 'All movements'`; `otherMovements` (K24's label, working name "Other movements", to be settled by the UX panel); `kindLabel` read from the shared `MODALITY_LABELS` (no re-typed words); `headingCount(heading, n)` replacing `foldedCount` if the panel keeps one shape for all counts. Remove `groupLabel` once its last reader goes. |
| `apps/web/components/movements/movement-picker.test.tsx`         | EDIT      | The browse tests move from the legacy groups to the tree. **New:** order of the top sections; a library-only option reachable by browse; families biggest first; K24's section last and folded; a ticked row's family starts open; no group tag on any row.                                                                                            |
| `apps/web/components/movements/movement-picker-filters.test.tsx` | EDIT      | Filtered tree: the heading text; filtered counts; empty headings dropped; K24's section absent; auto-open at 20 or fewer (and not at 21, the boundary); the no-match fallback shows the filtered tree.                                                                                                                                                 |
| `apps/web/components/movements/browse-tree.test.tsx`             | **NEW**   | The component alone: the heading levels, the counts in each summary, the open/closed state, and that a closed family renders no rows (see "Rendering" below).                                                                                                                                                                                          |
| `apps/web/e2e/movement-picker.a11y.spec.ts`                      | EDIT      | Two steps: browse with a kind and a family opened; browse auto-opened under a filter. Same `check()`.                                                                                                                                                                                                                                                  |
| `apps/web/app/design/program/picker-options.ts`                  | **EDIT?** | The preview's library has no bare built-in, so K24's section never shows on the preview. Adding two or three bare rows here is the roadmap thread's file (the test library, F1). **Asked, not assumed** (Q2). Without it, K24 is unit-tested only and the PR says so.                                                                                  |
| `apps/web/scripts/screenshot-ephemeral.ts`                       | EDIT      | Three interaction states: `picker-browse`, `picker-browse-open`, `picker-filter-auto-open`.                                                                                                                                                                                                                                                            |
| `docs/features/movement-picker.md`                               | EDIT      | Invariant 11 (the legacy groups) is **overturned by name**, as P12 requires, and replaced with the tree's invariant. Invariant 15's "browse under a filter" bullet points at the tree.                                                                                                                                                                 |
| `docs/changelog/<date>-feat-cat-3-b3-browse-by-kind.md`          | **NEW**   | Fragment.                                                                                                                                                                                                                                                                                                                                              |

**Not deleted here:** `MOVEMENT_PICKER_ENTRIES`, `MOVEMENT_PICKER_GROUPS`, the `group` field and
`COPY.groupLabel`'s constant. P12 says they go "in the chunk that removes their last reader", and B3
removes only the picker's. `packages/db/src/queries/program/movement-options.ts:52,134` (the global
rows' allow-list and their group), `packages/db/src/writers/program/new-item.ts` and
`packages/db/scripts/verify/program.ts` still read them, and those go with R2. B3's PR says so, so
nobody reads "B3 overturns invariant 11" as "the constants are gone".

### Headings

The sheet's title is the `h2`. Today every section heading is an `h3`, and `FoldedSection` nests
its `h3` inside the `summary` so it stays in the heading list (`movement-picker.tsx:1251-1257`).
The prototype uses `h3` at all three levels. **This plan uses `h3` for the top sections, `h4` for a
kind and `h5` for a family**, so a screen reader's heading list shows the nesting and no level is
skipped (AGENTS.md → semantic HTML: "correct heading order"). The a11y lens is asked to confirm or
overturn this against the prototype's flat `h3`s.

### Rendering, and why closed groups render nothing

A closed `<details>` hides its content, but React still renders it. With a few hundred library rows
after A2, each with a "How to" control, rendering every row in every closed family costs INP when
the sheet opens on a phone. The prototype renders a group's inside only when it is open
(`picker.html:3866`, `(open ? inner() : '')`). `BrowseTree` does the same: the open groups are a
`Set` in state, and a `summary` click toggles it (`onToggle` on the `details`).

- **Find-in-page** cannot reach a closed family's rows. That is accepted: the search box is the
  find.
- **Auto-open** (20 or fewer) is derived, not stored, so clearing the filter folds the tree back as
  it was.

### Copy

- "All movements", K24's label, and the kind labels come from shared `MODALITY_LABELS` if they read
  plainly to a kid: today they are "Strength", "Conditioning", "Mobility" and "Skill and drills"
  (`packages/shared/src/catalog/vocabulary.ts:224`). The trust lens is asked about "Conditioning"
  on a gym floor.
- Each count is a number after the heading, as `FoldedSection` already shows one
  (`COPY.foldedCount`, "Heading · N"). Screen readers hear "N movements" (the prototype's `sr` span).

## Test plan

- **Vitest** (jsdom, colocated): the tests in the table above.
  - Each new rule gets a test that fails without it: the order, reachability, biggest first, the
    auto-open boundary at 20 and 21, a ticked row's family open, and no group tag.
  - Each is mutation-probed with `pnpm probe` before the PR.
- **e2e:** the two new steps in `movement-picker.a11y.spec.ts` run in CI's `e2e` job.
  `pnpm e2e:local` runs once before the PR, in the board's heavy-run slot.
- **Screenshots:** after the review round (ui-screenshot). Viewport-only, `waitUntil: 'load'`, as
  B2-ii's states.
- **CI gates** as usual. Where each runs: AGENTS.md → "Local hooks vs CI merge-gates".

## Risks / rollback

- **INP on open with a large library.** Mitigated by rendering closed groups empty (above). Not
  measured: no CWV tooling runs per PR, and the PR says _not measured_.
- **The order changes under a returning user.** Custom items move from last to first: someone who
  scrolled to the bottom for their own items now finds them at the top. That is the prototype's
  order and the maintainer's (K19), so it is intended. The interaction lens is asked whether it
  needs a word on screen.
- **Two rows with one name** (K23) side by side in search, and in two different places in browse
  (K24's section and the tree). Intended until R2; nothing to build.
- **A filter hides K24's section entirely.** Under a filter, the bare rows are counted in the "N
  more" line (B2-ii, then the split line owed before 7b). Browse under a filter never shows them,
  which is true: no filter can judge them.
- **Rollback:** a revert restores the legacy groups. No data and no schema are touched.

## Out-of-scope / deferred

- Deleting `MOVEMENT_PICKER_ENTRIES`, `group` and their constants (R2, their last readers).
- The split "N more" line (`outsideWithoutData`, #590), which is its own follow-up before 7b.
- Remembering which groups were open across sheet openings. The prototype does not; a later PR
  may.
- A flat "kind · muscle" view (the prototype's declined alternative, K19).
- The real pages that mount the picker (FAM-1 7b).

## Open questions

- **Q1 (spec owner, asked 2026-11-18):** may B3 **build** before P11-ii? Its grouping reads only
  fields every library option already has from the const. Until answered, the gate is as written.
- **Q2 (roadmap thread):** may the preview's test library (`picker-options.ts`, F1's file) gain two
  or three bare built-ins, so K24's section can be seen and captured on the preview? If not, it is
  unit-tested and described in the PR.
- **Q3 (UX panel):** K24's label. "Other movements" is the working name; the trust lens weighs
  whether a kid reads it as "the ones that don't count".

## Review-response log (adversarial panel)

_(Filled in after the engineering panel — correctness, scope, architecture, reuse — and the UX
panel's three lenses: interaction and first-run, a11y and 360px, trust.)_
