# CAT-3 B3 — the picker's browse list, by kind of training and then family

> Backlog: [plan.md](../plan.md) row `CAT-3`. Spec:
> [cat-3-movement-library](../specs/cat-3-movement-library.md), criterion **P12**, with **K22 to
> K24** and the B3 row of "Chunks, in order". Branch: `feat/cat-3-b3-browse-by-kind`. Lane B.
> **Approved** _(maintainer, 2026-11-19)_.

## Where this sits

- **Pillar:** the movement library. It is shared reference data, so it has no pillar in
  roadmap.md's table.
- **Milestone:** Beta 0, `CAT-3`'s picker chunks: B1 → B2-i → B2-ii (#575) and its follow-ups
  (#594, #596) → **B3**.
- **This PR:** B3, the last picker chunk. With no query, "All movements" opens to the kind of
  training and then a family, replacing the five legacy groups. Until the fresh start, the old
  built-ins with no library entry sit in one folded section after the tree (K24).
- **Build gate: after B2-ii only.** The spec owner decided this under the maintainer's overnight
  delegation on 2026-11-18.
  - P11-ii is not a gate. It is where the option payload is measured and where the taxonomy's
    source moves to the tables.
  - B3 builds on the preview and on the const-backed real read (`apps/web/lib/dal/program/picker.ts`).
  - The roadmap thread's docs PR changes the spec's B3 cell to "After B2-ii" and adds a
    **post-R2 cleanup (lane B)** row. **B3 merges only after that cell reads "After B2-ii" on
    `main`.**
- **After it:** F1 (fixtures), then R2 (the fresh start), then the post-R2 cleanup PR. That PR
  deletes K24's block, `BuiltInWithoutLibrary` and the legacy group code in one go.
- _Roadmap alignment (2026-11-18): advances `CAT-3` (chunk B3). It changes only how the catalog is
  presented and adds no column, scope or authority. `ID-1`'s six keep-open items are answered in the
  log below. Checked against the private roadmap; nothing to add here._

## Goal

1. **Every library row is reachable by browse.**
   - Today browse is built from the legacy `group` field, which only the 35 old built-ins carry
     (`apps/web/components/movements/movement-picker.tsx:690`). A library row with no old twin
     shows only in search.
   - On the preview, B3 closes that gap.
   - On the real read it closes fully once P11-ii lists catalog rows beyond the old allow-list
     (`packages/db/src/queries/program/movement-options.ts:46`, `PICKER_SLUGS`; see
     §Compatibility).
2. **The no-query list follows P12 and the accepted prototype** (K19), in this order:
   - "Your custom items";
   - "Recent" (no filter, and only when the screen passes recents);
   - "Today's program" (no filter, when passed, unchanged);
   - "All movements", opening to the kind and then the family, each with its count, biggest family
     first.
3. **The old built-ins stay findable by browsing** (K24): one folded section after the tree, **"Not
   sorted yet"**.
4. **A tick is never hidden, and a group never closes under the person's thumb** (movement-picker
   invariant 15).

**Until A2 seeds the library, the real picker's tree is small by design** (spec owner,
2026-11-18). Counted again on 2026-11-19 by running `browseTree` over the 35 old rows whose slug
has a `CATALOG_MOVEMENTS` entry (510 entries, batches 1 to 11): Strength · 11 and Conditioning · 1
(12 in the tree), with 23 rows in "Not sorted yet". At 12 rows the tree opens itself (K26), and so
does "Not sorted yet" (as built, below).

- The preview shows the test library's tree, **not the real library's**.
- So the PR description carries the real library's tree (kinds, families, counts and a few names
  each), from running `browseTree` over `CATALOG_MOVEMENTS`. That way the headings are judged
  against real data.

## Acceptance

The criterion is [spec P12](../specs/cat-3-movement-library.md) and K24, linked rather than copied,
because a pasted copy goes stale. Done when:

- **Order, with no query and no filter.** Any section with no rows is omitted.
  1. "Your custom items · N": open at ≤ `CUSTOM_OPEN_AT_MOST` (5) rows; above that, one folded
     line (H2, maintainer-decided).
  2. "Recent", with no count, as today.
  3. "Today's program", unchanged.
  4. "All movements · N", open. It holds each kind (folded, with its count) in `BROWSE_KINDS` order,
     and each kind's families (folded, with their counts), biggest first.
  5. After the kinds: "Not sorted yet · N", folded, shown when any listed row lacks library data.
- **N for "All movements":**
  - with no filter, the tree's rows plus the "Not sorted yet" rows;
  - under a filter, the tree's rows only;
  - in both cases it **equals `movementFilterCounts(...).total`**, pinned by a test, so the heading
    and the panel's "Show N movements" never disagree.
- **With a filter on:**
  - "Movements that fit your filters · N" holds the filtered tree, and empty kinds and families are
    dropped.
  - "Not sorted yet" is dropped, since no bare row passes a filter. Those rows are counted in the
    line after a search (#594).
  - Custom items fold to one line marked "not filtered" (P9, unchanged).
  - There is no Recent and no Today's program.
  - An empty tree shows `COPY.noneFit` with Clear filters (P10, unchanged).
- **Auto-open:** with a filter on, every kind and family opens when the tree holds
  ≤ `BROWSE_OPEN_AT_MOST` rows, **filter or not** (H3, maintainer-decided). One derived expression.
- **Open state:**
  - It lives in the picker. It survives the filter panel, the item-form takeover, a no-match query
    and clearing the search, and resets only when the sheet opens.
  - A person's tap always beats the derived default, **except that a new selection reopens the
    groups above it**: a row ticked, selected or created by the caller, or made current, opens its
    ancestors even if the person closed one earlier (round 2).
  - Every group on the path to a ticked row (multi mode) or to the current row (single mode)
    starts open: the family, its kind, All movements, or "Not sorted yet".
  - Unticking never closes a group.
- **No row carries a group tag.** `COPY.groupLabel`'s tag in `tagFor` is gone, so the second line
  is P14's alone.
- **No match at all:**
  - with no filter, the list beneath is All movements (tree plus "Not sorted yet"), sharing the open
    state, with no custom section (custom items were already searched);
  - with a filter, the filtered browse, unchanged (P10).
- **K23:** both rows of a pair are listed, the old row in "Not sorted yet" and the library row in
  the tree. Nothing hides either, and a test pins it.
- **e2e** (`movement-picker.a11y.spec.ts`, at `NARROW_VIEWPORT`), each step checked for axe, 44px
  targets and no sideways scroll, as `check()` does:
  - the existing filtered step expects the tree's headings;
  - a new step browses with no filter and opens a kind and a family;
  - a keyboard step: Tab to a kind, press Enter, see `aria-expanded="true"`, and focus stays;
  - an open family at 200% text, with no overlap inside the row.
- **Screenshots** at 390, 820 and 1280: one new state, `picker-browse-open` (a kind and a family
  open). The existing `picker-filter-*` states already show the filtered, auto-opened tree.

## Compatibility with P11-ii (to re-check when it lands)

1. **The option shape does not change.** A library option keeps `modality`, `pattern` and
   `primaryMuscle` (`CatalogOptionTaxonomy`); P11-ii changes their source, not their type.
2. **Old built-ins are still listed until R2** (K22).
3. **`hasLibraryData`** (`apps/web/lib/movements/movement-option.ts`) stays the one test for "has a
   kind". B3 partitions by it once and adds no second rule.
4. **P11-ii lists catalog rows beyond `MOVEMENT_PICKER_ENTRIES`.** Until then, only the 6 old rows
   with a library slug reach the real tree.

If P11-ii breaks any of these, the PR that breaks it updates the tree.

## Design

### Where the code lives

The code goes in two places, with no import cycle (reuse B1, architecture B1).

- **`apps/web/lib/movements/browse-view.ts` (NEW): pure, no DOM, unit-tested without one.**
  This is AGENTS.md's "push logic into the testable".
  - **Input:** the options, the filters, the selected and current ids, and the person's toggles.
  - **Output, a view model:** the custom rows; the tree (`browseTree(library)`); the bare rows,
    sorted with `byFoldedName`, which the roadmap thread exports from `families.ts` in its next
    contract PR (Q4b, decided); N; each node's key and id; and each node's open state.
  - **It partitions once:** `fitting` comes from `filterMovementOptions`, then
    `library = fitting.filter(hasLibraryData)`, and `bare` is the rest.
- **`movement-picker.tsx` (EDIT).** A module-scope `Browse` component renders that view model with
  the private `OptionList`. It sits beside `TodaysProgram`, which already takes `rowsFrom`.
  - It replaces `browseGroups`, `groupIndex` and `filteredBrowse`.
  - **One `browse` element**, parameterised by `filtersOn > 0`, is rendered at all three sites
    (`:1044`, `:1065`, `:1099`). The three constructions can't drift again; their own comment
    (`:686-688`) records that they already drifted once.

### The disclosure: a button, not `<details>`

Every group (the custom section, All movements, a kind, a family, Not sorted yet) uses the APG
disclosure pattern:

```tsx
<Group headingId={headingId}>
  {/* <section aria-labelledby> for the top sections only; a plain <div> for a kind, a family and
      Not sorted yet (round 2, a11y: one landmark per group floods VoiceOver's and NVDA's lists) */}
  <hN id={headingId}>
    <button
      type="button"
      aria-expanded={open}
      aria-controls={open ? bodyId : undefined}
      onClick={() => toggle(key)}
      className="focus-visible:ring-ring flex min-h-11 w-full items-center gap-2 text-left outline-none focus-visible:ring-3 focus-visible:ring-inset"
    >
      <Chevron aria-hidden className="motion-reduce:transition-none" />
      <span className="min-w-0 flex-1">{label}</span>
      <span aria-hidden className="shrink-0 tabular-nums">
        {n}
      </span>
      <span className="sr-only">, {COPY.movementCount(n)}</span>
    </button>
  </hN>
  {open ? <div id={bodyId}>{children}</div> : null}
</Group>
```

**Why not `<details>`,** which the prototype and `FoldedSection` use:

- A `toggle` event also fires on programmatic opens (auto-open, a tick, mounting open), so a state
  synced from `onToggle` stores what should be derived.
- When the person closes a group whose prop stays `true`, React writes nothing, so React and the DOM
  disagree.
- A heading inside `<summary>` is not reliably exposed. VoiceOver on iOS is the gym-floor device.

**What the button gets instead:**

- React controls it fully.
- It sits inside its heading, which every screen reader exposes.
- The 44px check measures it (`e2e/a11y-checks.ts` lists `button`).
- **Its focus ring is inset** (`ring-inset`), so the sheet's scroll container cannot clip it at the
  edges at 360px.
- The custom section moves onto the same component, so the picker has one disclosure.
  `FoldedSection` stays only where it is still used outside browse, keeping #596's tick latch.

**Closed groups render nothing.** Tab walks kind → family → rows rather than hundreds of rows, and
the search box serves as find.

- Scope S1 asked to always render the rows. **Rejected for this pattern:** S1's argument (three
  sources of open state drifting apart) goes away with the controlled button and the single state
  below, and rendering closed bodies would need `hidden` bookkeeping for no gain.

### Open state (one model, in the picker)

```ts
// in MovementPicker, reset where the query resets on sheet open (:425-436)
userChoice: Map<NodeKey, boolean>; // written ONLY by a tap
seeded: Set<NodeKey>; // a latch: ancestors of every ticked/current row at sheet open,
// plus ancestors of a row the caller selects or creates to focus;
// never shrinks while the sheet is open
open(key) = userChoice.get(key) ?? (auto || seeded.has(key) || defaultOpen(key));
```

- **`auto` is one expression:** `library.length <= BROWSE_OPEN_AT_MOST`, filter or not (H3).
- **Conditioning has no family level** (H4): its rows are listed by name (`byFoldedName`) directly
  under "Conditioning · N". Which kinds are flat is a contract rule: asked of the roadmap thread as
  a `BROWSE_FLAT_KINDS` const in `families.ts` that `browseTree` honours (one unnamed family), so
  the picker only renders what it is given.
- **`defaultOpen`** is true for All movements, and for custom items at ≤ `CUSTOM_OPEN_AT_MOST` (5; H2) and false
  for kinds, families and Not sorted yet.
- **As built (B3-i):** `auto` opens **kinds and families only**, never "Your custom items": the
  formula above would open twenty-four custom items whenever the tree was short and bury it, which
  is what K25 folds them for. **"Not sorted yet" opens with `auto` too** _(maintainer, 2026-11-19,
  via the board: "Open it while the tree is small")_, which overrides K24's "folded" only while the
  tree holds `BROWSE_OPEN_AT_MOST` rows or fewer: before the library is seeded most rows live
  there. On a longer tree it is folded, as K24 says. A tap still wins and the seed still applies.
- **A new selection reopens its ancestors** (round 2, correctness). When an id enters `selected`
  (the person's tick, or the caller's select or create) or becomes `currentId`, its ancestors are
  added to `seeded` **and their entries are deleted from `userChoice`**. So an earlier close never
  hides a row the caller is about to focus (the regression `FoldedSection`'s `holdsTicked` exists
  to stop, `movement-picker.tsx:1224-1227`), and a later tap can still close the group again.
  - This happens **during render**, by diffing the previous `selected` and `currentId` (the
    `wasOpen`/`wasTakeover` pattern at `:425-450`), never in an effect. The row is then in the same
    commit the caller's focus runs after.
  - It also closes S-S3: a tick made under an auto-opened filtered tree stays visible after the
    filter is cleared.
- **On a filter change, the `false` entries in `userChoice` are dropped**, so a group the person
  closed under one filter can auto-open under the next. `true` entries stay.
- **Keys and ids are kind-qualified**, because `core`, `back`, `hips_legs` and `whole_body` occur
  under more than one kind (`families.ts:41-43,102-105`). The key is `${kind}/${family}` and the DOM
  id is `${headingId}-${kind}-${family}`.

### Headings, How to, indent

- **Levels:**
  - The sheet title is `h2`, the top sections are `h3`, a kind is `h4`, a family is `h5`, and "Not
    sorted yet" is an `h4` sibling of the kinds.
  - No level is skipped, and NVDA and JAWS can jump between kinds (key 4) and families (key 5)
    (a11y lens).
- **How to's heading** follows its section: under an h3 it is h4, as today; under a family h5 it is
  h6. The level is passed through `OptionList` → `OptionRow` → `HowToSteps`; `:1460` hard-codes
  `h4` today.
- **Indent:** the disclosure buttons carry it (a kind's is `pl-3`, a family's `pl-6`). Rows sit at
  most `ml-3` in.
  - At 360px in multi mode with How to, the name column is 194 − 12 = **182px**.
  - Indenting rows along with their family (the prototype's 18px per level, 36px in total) would
    leave 158px, and 0px at the 195 CSS px zoom case the sheet guards (the a11y lens's math).
  - A family label is `min-w-0 flex-1` with its count in a `shrink-0` span. A long label wraps
    inside the tap target and the count never ends up alone on a line.

### "Not sorted yet" (K24)

- **Label** (lane B's to choose, per K24; from the trust lens): **"Not sorted yet"**, shown as "Not
  sorted yet · 29".
  - "Other movements" was rejected. Beside "Strength / Mobility / Conditioning" it reads as a fifth
    kind ("Back Squat is not strength"), and `families.ts:94-99` already rejected "Other" as not "a
    heading a person can use". It also reads as "leftovers".
  - "Not sorted yet" matches this group's other copy ("equipment and muscles not known yet").
- **One sibling block after the kinds, keyed only on `!hasLibraryData` and tagged
  `TODO(CAT-3 R)`.** That makes the post-R2 cleanup one deletion and one test block.
- **Sorted with `byFoldedName`**, the comparator `browseTree` uses.
- **No note inside the section** (trust lens N7, declined). Before R2 only the maintainer's household
  sees it, and each row's own second line already says what it lacks.

### Copy (`movement-picker-copy.ts`)

- **New:** `allMovements: 'All movements'`; `notSorted: 'Not sorted yet'` (⏳ chunk R); and
  `movementCount`, which already exists privately at `:12`, exposed for the `sr-only` count.
- **`COPY.groupLabel`: deleted.** Its last reader, `tagFor`, goes.
- **`foldedCount`:** kept as is, not renamed (reuse S8).
- **One separator const** (board, 2026-11-18): the `' · '` join is written three times in
  `movement-picker-copy.ts` (`ROW_META_JOIN`, `filters()`, `foldedCount`). B3 adds readers of it,
  so it becomes one `SEPARATOR` const that all three, and B3's headings, use.
- **Kind labels:** a bare lookup of the shared `MODALITY_LABELS`. **Changing a kind label means
  editing `MODALITY_LABELS` through the contract owner, never overriding it in the picker** (reuse
  S6).
- **`fitHeading`'s comment** ("until B3's tree") is updated.

### What happens to the legacy group code

| Symbol                                                                | Readers after B3                                                                         | Fate                                                                                                                |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `COPY.groupLabel`                                                     | none                                                                                     | **Deleted in B3.**                                                                                                  |
| `MOVEMENT_PICKER_GROUP_LABELS` (`movement-picker-catalog.ts`)         | tests only                                                                               | **Kept.** The post-R2 cleanup PR deletes it. It is in a seam file, and a seam turn before R2 isn't worth the churn. |
| The DTO's `group` (`movement-option.ts`, filled in `picker.ts:71,76`) | none (passed through, never read)                                                        | **Kept, with a `TODO(CAT-3 R)`** in `movement-option.ts`. Goes in the post-R2 cleanup PR.                           |
| `MOVEMENT_PICKER_ENTRIES`                                             | the DB read's allow-list and aliases (`movement-options.ts:46,135`), `verify/program.ts` | **Kept.** It belongs to P11-ii and R2, not to browse.                                                               |
| `interimGroupOf` (`picker-options.ts`, roadmap thread)                | the `group` field it fills                                                               | Goes when `group` goes.                                                                                             |

## File-by-file changes

| Path                                                             | Change  | What & why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/lib/movements/browse-view.ts`                          | **NEW** | The pure view model described above.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `apps/web/lib/movements/browse-view.test.ts`                     | **NEW** | Covers, without a DOM: <br>• the partition: tree, bare and custom rows each appear once, and together equal the options; <br>• N equals `movementFilterCounts(...).total` in both states; <br>• auto-open at `BROWSE_OPEN_AT_MOST` and at `+ 1`, with 2 custom rows that must not count; <br>• seeded ancestors (kind, family, Not sorted yet); <br>• a tap beats auto; <br>• `false` entries are dropped on a filter change; <br>• kind-qualified keys are unique with `core` under two kinds.                                                                                        |
| `apps/web/components/movements/movement-picker.tsx`              | EDIT    | <br>• `Browse` and the disclosure, as described above; <br>• the `userChoice`/`seeded` state; <br>• one `browse` element at three sites; <br>• `tagFor` loses the group tag; <br>• `HowToSteps` takes a heading level; <br>• `browseGroups`, `groupIndex` and `filteredBrowse` are deleted.                                                                                                                                                                                                                                                                                            |
| `apps/web/lib/movements/movement-picker-copy.ts`                 | EDIT    | As in §Copy.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `apps/web/lib/movements/movement-option.ts`                      | EDIT    | A TODO on `group`. The `:61-64` docblock loses "until B3's tree".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `apps/web/test/movement-picker-fixtures.ts`                      | EDIT    | <br>• `libraryOption(entry)`, built with `catalogOptionOf` over `CATALOG_FIXTURE`, with no `group`; <br>• `withoutLibraryData(option)`; <br>• the inline copies (`movement-picker-filters.test.tsx:326-339` and `:501`) point at these.                                                                                                                                                                                                                                                                                                                                                |
| `apps/web/components/movements/movement-picker.test.tsx`         | EDIT    | Browse tests move to the tree and use the new fixtures. The rendered `h4`/`h5` sequence and counts equal `browseTree(the same options)`, so the comparator isn't copied. Also tests: <br>• section order, Today's program included; <br>• a library-only option is reachable; <br>• no group tag, on Romanian Deadlift (which carries a `group`); <br>• the K23 pair appears in both places; <br>• the P6 import allowlist.                                                                                                                                                            |
| `apps/web/components/movements/movement-picker-filters.test.tsx` | EDIT    | <br>• filtered tree headings, matched with `COPY.foldedCount(COPY.fitHeading, n)`, never a re-typed regex; <br>• Not sorted yet absent; <br>• `noneFit` kept; <br>• the no-match fallback, with and without a filter; <br>• open state survives the panel and a no-match query.                                                                                                                                                                                                                                                                                                        |
| `apps/web/e2e/movement-picker.a11y.spec.ts`                      | EDIT    | As in Acceptance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `apps/web/scripts/screenshot-ephemeral.ts`                       | EDIT    | <br>• `PICKER_STATE_PREFIX = 'picker-'` replaces the two `startsWith('picker-filter-')` checks (`:1396-1397`); <br>• one new state, `picker-browse-open`, reusing `openPickerFilters`'s tap-until-open opener; <br>• the fit-heading wait matches the counted heading.                                                                                                                                                                                                                                                                                                                 |
| `docs/features/movement-picker.md`                               | EDIT    | Invariant 11 is overturned by name and replaced with the tree's invariant. Also updated: <br>• invariant 14's library-option bullet and its "Recent and its group" example; <br>• invariant 15's "filtered browse is interim" bullet; <br>• the fixture Trap, which becomes "library fixtures come from `CATALOG_FIXTURE`; the old seed rows only until F1"; <br>• "What this is"; <br>• the file map (`browse-view.ts`); <br>• `movement-picker.tsx:59`'s header. <br>It also says what `movement-picker-catalog.test.ts`'s key-set test still guards: the DB allow-list, not browse. |
| `docs/plan.md`                                                   | EDIT    | The `CAT-3` row links this plan.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `docs/roadmap.md`                                                | none    | Nothing moves; the PR says so.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `docs/changelog/<date>-feat-cat-3-b3-browse-by-kind.md`          | **NEW** | Fragment.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

**Size, and the split named now.** The estimate is about 350–450 lines of code plus about 350 lines
of tests, which is over the 400-line target. If the build confirms that, B3 ships as two PRs:

- **B3-i:** `browse-view.ts`, the disclosure, the open-state model, the no-filter tree, Not sorted
  yet, custom first, and no group tag.
- **B3-ii:** the filtered tree, auto-open, the no-match fallback, and the e2e and capture states.

**As built:** B3-i also shipped auto-open (filter or not, in `browseView`), the no-match fallback
with no filter (All movements, no custom section), the no-filter e2e steps (a kind from the
keyboard, a kind and a family open, at 360px) and the `picker-browse-open` capture state, with
`PICKER_STATE_PREFIX`. **B3-ii is now** the filtered tree under "Movements that fit your filters",
the filtered no-match fallback, the remaining e2e steps (the filtered headings, 200% text on an
open family), and moving the two remaining `FoldedSection`s (the filtered custom section and
Today's program, marked `TODO(CAT-3 B3-ii)`) onto `Group`, which deletes `FoldedSection`.

## Test plan

- **Vitest** (colocated), as listed in the table above. Each rule gets a test that fails without it.
  Each is mutation-probed with `pnpm probe` before the PR, as #586, #575, #594 and #596 were.
  Boundaries use `BROWSE_OPEN_AT_MOST` and `+ 1`, never literals.
- **e2e:** the steps above, run in CI's `e2e` job. `pnpm e2e:local` runs once, in the board's heavy-run slot.
- **Screenshots:** after the review round, viewport-only, with `waitUntil: 'load'`.
- **CI gates:** see AGENTS.md → "Local hooks vs CI merge-gates".

## Risks / rollback

- **INP when the sheet opens on a large library.**
  - Mitigation: closed groups render nothing.
  - Not measured; there is no per-PR CWV tooling.
  - The search path already draws every match, so this risk covers browse's share only.
- **The real tree is tiny until A2.** That is by design (K22 to K24), and it opens itself (H3).
- **Conditioning's families scattered on real data**; it is now flat (H4), through the contract's
  `BROWSE_FLAT_KINDS`. B3 renders whatever `browseTree` returns.
- **The same movement can be listed twice:**
  - by name (K23);
  - by meaning, e.g. BB Bench / Bench press, KB Swings / Kettlebell swing.

  Whichever row is picked, both log, and both go at R (K4). **No copy prefers either.** The seeded
  youth program uses the old rows, so steering parents to the twin would put two push-up rows into
  one day (trust lens N6).

- **Rollback:** a revert restores the legacy groups. No data or schema is touched.

## Out-of-scope / deferred

- **Deletions for the post-R2 cleanup PR** (its spec row is being added by the roadmap thread):
  `MOVEMENT_PICKER_GROUP_LABELS`, the DTO's `group`, K24's block and `BuiltInWithoutLibrary`.
  `MOVEMENT_PICKER_ENTRIES` goes with P11-ii and R2.
- **Remembering open groups across sheet openings.** If it is ever built, it must not key on
  (household, profile) (`ID-1` item 4), and it falls under the picker's storage ban (P6).
- **A flat "kind · muscle" view** (declined in K19).
- **Bare rows in the preview's test library.** Not asked for: K24 is unit-tested, and before R2 only
  the maintainer's household sees the section (scope S4).
- **The real pages that mount the picker** (FAM-1 7b).

## Open questions

**All decided by the maintainer, 2026-11-18 (orchestrator's chat), each as recommended:**

- ~~Q1~~ **H2:** "Your custom items" is open at ≤ `CUSTOM_OPEN_AT_MOST` (5), else one folded line.
- ~~Q2~~ **H3:** the tree opens itself at ≤ `BROWSE_OPEN_AT_MOST` (20) rows, filter or not.
- ~~Q3~~ **H4:** Conditioning has no family level; its rows are listed by name under
  "Conditioning · N". The `BROWSE_FLAT_KINDS` const and `browseTree`'s change are the roadmap
  thread's (contract).
- ~~Q4(a)~~ **H5:** the label becomes "Curls, raises and single muscles" (contract,
  `MOVEMENT_FAMILY_LABELS.isolation`; the roadmap thread's).
- ~~**Q4(b)**~~ **Decided (2026-11-18):** the roadmap thread exports `byFoldedName` from
  `families.ts`.

## Review-response log (adversarial panel)

> Panel cost: correctness 106k · 4m40s, scope 82k · 3m18s, architecture 125k · 5m24s, reuse 105k ·
> 4m02s, UX interaction 106k · 5m09s, UX a11y/360 95k · 5m11s, UX trust 101k · 5m20s.
> Models: high-stakes no · correctness, scope, architecture, reuse: opus · UX 1, 2, 3: opus (the
> Fable cap runs until 2026-11-19).

### Engineering panel (round 1)

| #                | Lens         | Critique (short)                                                                                                               | Verdict               | Resolution                                                                                                        |
| ---------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------ | --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| C-B1             | Correctness  | Open state is lost across the three mount sites; `toggle` stores derived opens                                                 | **accepted**          | One model in the picker: `userChoice` written by taps only, a `seeded` latch, derived `auto`; reset on sheet open |
| C-B2             | Correctness  | A tick inside a closed kind, or inside K24's section, is not in the DOM                                                        | **accepted**          | Every ancestor is seeded open; unticking never closes a group                                                     |
| C-S1             | Correctness  | Family keys and ids repeat across kinds                                                                                        | **accepted**          | `${kind}/${family}`, with a test                                                                                  |
| C-S2             | Correctness  | N and the auto-open count are undefined                                                                                        | **accepted**          | Both defined; N equals `movementFilterCounts.total`, with a test                                                  |
| C-S3             | Correctness  | Today's program has no slot                                                                                                    | **accepted**          | After Recent; never under a filter                                                                                |
| C-S4             | Correctness  | The no-match fallback's contents are unspecified                                                                               | **accepted**          | No filter: All movements (tree + K24) with no custom section. Filter: unchanged                                   |
| C-S5             | Correctness  | Empty filtered tree                                                                                                            | **accepted**          | `noneFit` with Clear filters kept                                                                                 |
| C-S6             | Correctness  | Some tests are named so they could pass vacuously                                                                              | **accepted**          | Group tag tested on Romanian Deadlift; partition test; constants at the boundary; fixture Trap rewritten          |
| C-N1 to N4       | Correctness  | The `groupLabel` contradiction; Recent's count; single mode's current row; a K23 test                                          | **accepted**          | All in the plan's text                                                                                            |
| S-S1             | Scope        | Cut lazy rendering of closed groups                                                                                            | **rejected**          | Its cause (three drifting open sources) is removed by the controlled button; closed bodies render nothing         |
| S-S2             | Scope        | Reuse `FoldedSection` rather than a second disclosure                                                                          | **accepted, adapted** | One disclosure component for every group, the custom section included                                             |
| S-S3             | Scope        | A tick is hidden by a closed kind after the filter is cleared                                                                  | **accepted**          | Same fix as C-B2                                                                                                  |
| S-S4             | Scope        | Drop K24's screenshot, the fixture ask and the label debate                                                                    | **accepted**          | Unit-tested; label decided once (trust lens); no preview fixture requested                                        |
| S-S5             | Scope        | Duplicate capture and e2e states; the `picker-filter-` prefix trap                                                             | **accepted**          | One new state; `PICKER_STATE_PREFIX`                                                                              |
| S-S6, S-S7, S-N1 | Scope        | Today's program; the plan.md link and roadmap; test layering and size                                                          | **accepted**          | Split named in advance (B3-i/ii)                                                                                  |
| R-B1             | Reuse        | `browse-tree.tsx` needs the picker's private row code (a cycle or a copy)                                                      | **accepted**          | Pure `browse-view.ts`, plus a module-scope `Browse` inside the picker                                             |
| R-S1             | Reuse        | Two browse constructions and three custom sections                                                                             | **accepted**          | One `browse` element at three sites                                                                               |
| R-S2 to R-S8     | Reuse        | One partition; tests compare against `browseTree`; fixtures; the prefix; labels via the contract; link P12; keep `foldedCount` | **accepted**          | All in the plan's text                                                                                            |
| A-B1             | Architecture | Same as R-B1                                                                                                                   | **accepted**          | Option (a), `browse-view.ts`                                                                                      |
| A-S2, A-S3       | Architecture | The open-state model; colliding ids                                                                                            | **accepted**          | Same fixes as C-B1 and C-S1                                                                                       |
| A-S4             | Architecture | "Not deleted here" lumped five symbols together                                                                                | **accepted**          | Symbol-by-symbol table                                                                                            |
| A-S5             | Architecture | New tests should be built from `CATALOG_FIXTURE`                                                                               | **accepted**          | New fixtures; Trap rewritten                                                                                      |
| A-S6             | Architecture | The guide edit covered 2 of 8 stale sites                                                                                      | **accepted**          | All 8 listed                                                                                                      |
| A-S7             | Architecture | No chunk owns the post-R2 deletion                                                                                             | **accepted**          | The roadmap thread is adding a spec row; K24 is one sibling block                                                 |
| A-N8             | Architecture | `ID-1` answers missing                                                                                                         | **accepted**          | Answered below                                                                                                    |

### UX panel (round 1)

| #          | Lens        | Critique (short)                                                        | Verdict                     | Resolution                                                                                          |
| ---------- | ----------- | ----------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------- |
| U1-1       | Interaction | 24 open custom items bury the tree at 390px                             | **maintainer-decided (H2)** | Fold above 5; recommended by the spec owner                                                         |
| U1-2       | Interaction | A family closes under the thumb on an untick                            | **accepted**                | Same fix as C-B2. The same latent bug in `FoldedSection` was confirmed by a probe and fixed in #596 |
| U1-3       | Interaction | N must include K24's rows                                               | **accepted**                | Same fix as C-S2                                                                                    |
| U1-4       | Interaction | The interim tree costs two taps per movement                            | **maintainer-decided (H3)** | Auto-open by tree size; recommended by the spec owner                                               |
| U1-5       | Interaction | K24's order and label                                                   | **accepted**                | `byFoldedName`; "Not sorted yet"                                                                    |
| U1-6, U1-7 | Interaction | The returning-user risk is moot; no-match fallback                      | **accepted**                | Risk removed; fallback specified                                                                    |
| U2-1       | a11y/360    | `<details>` + `onToggle` drift; focus loss                              | **accepted**                | Controlled APG button disclosure                                                                    |
| U2-2       | a11y/360    | Headings inside `<summary>` are unproven on iOS VoiceOver               | **accepted**                | The heading is now the button's parent                                                              |
| U2-3       | a11y/360    | How to's `h4` sits above its row under an `h5`                          | **accepted**                | The heading level is passed down                                                                    |
| U2-4       | a11y/360    | Indenting rows costs 19% of the name column; 200% zoom overflows by 7px | **accepted**                | Only the disclosure buttons indent; rows at most `ml-3`; a 200% e2e step                            |
| U2-5       | a11y/360    | The count is orphaned on wrap; screen-reader wording                    | **accepted**                | `shrink-0` count, `aria-hidden` dot, `sr-only` "N movements"                                        |
| U2-6       | a11y/360    | State is lost across the panel and the takeover                         | **accepted**                | Same fix as C-B1                                                                                    |
| U2-7, U2-8 | a11y/360    | Summaries are not measured by the 44px check; keyboard untested         | **accepted**                | A `<button>` is measured; keyboard e2e step                                                         |
| U3-1       | Trust       | "Other movements" reads as a fifth kind, or as leftovers                | **accepted**                | "Not sorted yet"                                                                                    |
| U3-2       | Trust       | "Arms, calves and single muscles" names nothing it holds                | **maintainer-decided (H5)** | Contract label; recommended by the spec owner                                                       |
| U3-3       | Trust       | Conditioning's families scatter                                         | **maintainer-decided (H4)** | The spec owner leans yes                                                                            |
| U3-4       | Trust       | The evidence is the fixture, not the library                            | **accepted**                | The real tree goes in the PR body; the plan's sentence is corrected                                 |
| U3-5       | Trust       | A tick must open its kind and K24's section                             | **accepted**                | Same fix as C-B2                                                                                    |
| U3-6       | Trust       | K23: say both rows log, and steer toward neither                        | **accepted**                | In Risks                                                                                            |
| U3-7       | Trust       | A note inside K24's section                                             | **rejected**                | Only the maintainer sees it before R2, and each row's second line already says what it lacks        |
| U3-8       | Trust       | Kind labels                                                             | **accepted (no change)**    | "Conditioning" kept; "Mobility and stretching" passed to the contract owner as an FYI               |

### Re-review (round 2)

> Light passes by the lenses whose blocking findings reshaped the plan: correctness 52k · 56s,
> UX a11y/360 42k · 37s. Models: opus, effort medium.

| #     | Lens        | Critique (short)                                                                                                                                               | Verdict      | Resolution                                                                                                                                             |
| ----- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C2-B1 | Correctness | An earlier close (`userChoice=false`) beats `seeded`, so a row the caller creates and focuses can be off the DOM; the plan's two rules contradicted each other | **accepted** | A new selection (any source) seeds its ancestors **and clears their `userChoice`**, during render. Tests in multi and single mode. Acceptance reworded |
| C2    | Correctness | R-B1/A-B1 and C-B1 resolved; focus on a person's own close is safe; the latch growing is harmless                                                              | —            | Confirmed                                                                                                                                              |
| U2-R1 | a11y/360    | U2-1 resolved; button-in-heading, the accessible name, levels, 44px and 360px math hold                                                                        | —            | Confirmed                                                                                                                                              |
| U2-R2 | a11y/360    | A `<section>` per kind and family floods the region landmarks                                                                                                  | **accepted** | `section` only for the top sections; `div` below                                                                                                       |
| U2-R3 | a11y/360    | `ring-3` may clip at the scroll container's edges                                                                                                              | **accepted** | `ring-inset`                                                                                                                                           |

No blocking concern survives round 2.

### `ID-1`'s six keep-open items

| #   | Item                                    | Answer                                                                                                   |
| --- | --------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1   | A profile tied to a login               | Untouched: no column or read is added.                                                                   |
| 2   | Access goes through the household scope | Untouched: no new read; B3 does not call `getHouseholdScope()`.                                          |
| 3   | One household per person                | "Your custom items" means the current household, as today. Nothing new assumes one household per person. |
| 4   | Keys on (household, profile)            | None added. The deferred "remember open groups" must not key on them (Out-of-scope).                     |
| 5   | Age logic                               | None. "A kid reads it as…" is a copy judgement, not a gate.                                              |
| 6   | Roles                                   | Untouched.                                                                                               |

`CAT-4` and `CAT-5`, the owning rows for catalog curation and variations, are compatible:

- The tree reads the taxonomy off the option, so a curator's change flows through after P11-ii.
- A "variation of" grouping would sit inside a family's rows.

### Found outside this plan

- **`FoldedSection` closed under the thumb on an untick** (from #575). A probe was red on `main`;
  fixed in #596.
- **The `' · '` join is written three times** in `movement-picker-copy.ts`. Folded into B3
  as one `SEPARATOR` const (board, 2026-11-18); see §Copy.
- **F1's list of `MOVEMENT_SEED_ROWS` readers** leaves out the fixtures file and
  `movement-picker-catalog.ts`. Minor: F1's import scan would find both.
