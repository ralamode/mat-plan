---
feature: The movement picker (choose, or create by typing)
owns:
  - apps/web/components/movements/
  - apps/web/lib/movements/
  - packages/shared/src/movement-picker-catalog.ts
  # PR 4 adds `packages/db/src/queries/movement-options.ts` (Decision 5's two reads). It is NOT
  # listed yet: `guides:check` fails a guide that claims a path which does not exist, so the entry
  # arrives with the file.
---

# The movement picker

**Read this before changing how a movement is chosen or created.** The picker is the only screen that
can mint a row in a catalog the app cannot delete from, which is what makes its small decisions
load-bearing.

## What this is

Before `PICK-1`, the only way to name a movement was to type it, and a near-miss minted a second
catalog row: "Bulgarian Split Squats" against a catalog holding "Bulgarian Split Squat" split that
movement's history across two rows, with no delete in the app. The picker makes **choosing** the easy
path and **creating** the deliberate one.

- **PR 1 (U0, #364)** — `components/ui/sheet.tsx`, the surface. Not owned by this guide.
- **PR 2 (#372)** — the server takes a movement **public id**; the id decides the row, the name is a
  label. [write-path.md](./write-path.md) invariant 14 is the rule.
- **PR 3** — this guide's files: the fold and the search, the browse groups and aliases, the DTOs, the
  copy, and the component itself. **Unmounted** — nothing renders it yet.
- **FAM-1 step 9** — a multi-select mode (`multiple`), mounted by the program builder's item
  picker ([program-builder.md](./program-builder.md)). The single-pick mode is unchanged.
- **PR 4** — mounts it in the log form, adds Decision 5's two reads, and owes a UX panel plus
  three-width screenshots.
- **CAT-3 B1** — the list reads the library's search (short forms, similar names); invariant 13.
- **CAT-3 B2-i** — every row's second line, the supervision label and "How to"; invariant 14.
- **CAT-3 B2-ii** — the filters (equipment, main muscle) and the list under them; invariant 15.
- **CAT-3 B3-i** — with no query, "All movements" is the kind of training, then a family, with
  "Your custom items" first and the old built-ins with no library entry in "Not sorted yet";
  invariant 11 ([plan](../plans/cat-3-b3-browse-by-kind.md)).
- **CAT-3 B3-ii** — under a filter, "Movements that fit your filters" is the same tree; Today's
  program and the custom items move onto the one disclosure, and `FoldedSection` goes.

## The map

| File                                                      | What                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/movement-search.ts`                  | `foldMovementQuery`, **`movementNameKey`** (THE "same movement" key), `matchMovementOptions`, and CAT-3's `searchMovementOptions`. Pure, no React, no DB. **Owned by [program-contract.md](./program-contract.md) since CAT-3 C0a**: the library's search is added beside it, so a change to this file goes through the contract owner. |
| `packages/shared/src/movement-picker-catalog.ts`          | `MOVEMENT_PICKER_GROUPS`, `MOVEMENT_PICKER_ENTRIES` (group + aliases per slug), `MOVEMENT_PICKER_ALIASES`, `RECENT_MOVEMENTS_LIMIT`. Since B3 browse reads none of the groups: `movement-picker-catalog.test.ts`'s key-set test guards the DB read's allow-list, not browse. The post-R2 cleanup deletes the groups.                    |
| `apps/web/lib/movements/browse-view.ts`                   | The browse list as data (CAT-3 B3): `browseView` partitions the options once into the tree (`browseTree`), K24's rows and the custom items, with N; and the open-state model (`isBrowseOpen`, `seedBrowse`, `forgetClosed`, `CUSTOM_OPEN_AT_MOST`), Today's program included. Pure, no DOM.                                             |
| `apps/web/lib/movements/movement-option.ts`               | `MovementOptionDTO` (a union on `owner`; each option declares its `trackingType`), `MovementPickerData`. Types only — **not** `server-only`, so a client component may import them.                                                                                                                                                     |
| `apps/web/lib/movements/movement-picker-copy.ts`          | Every string the picker, the card hint and the Save line show.                                                                                                                                                                                                                                                                          |
| `apps/web/components/movements/movement-picker.tsx`       | The component. `'use client'`, on U0's `Sheet`.                                                                                                                                                                                                                                                                                         |
| `apps/web/components/movements/movement-filter-panel.tsx` | The filter panel's body and footer (CAT-3 B2-ii, invariant 15). Draws what the picker holds and reports each change.                                                                                                                                                                                                                    |
| `apps/web/test/movement-picker-fixtures.ts`               | The picker suites' fixtures, from the seeded catalog. Outside the folder because the P6 scan reads every non-test module in it.                                                                                                                                                                                                         |
| `apps/web/lib/i18n/plural.ts`                             | Not owned here, but every counted string above goes through it. See `I18N-1`.                                                                                                                                                                                                                                                           |
| `apps/web/lib/i18n/locale.ts`                             | Not owned here. `APP_LOCALE` — the one locale `plural()`, `Intl.ListFormat` and `<html lang>` all read.                                                                                                                                                                                                                                 |

## Invariants

1. 🔴 **`movementNameKey` is THE "same movement" rule, and it has more than one consumer.** The
   picker's `exact` test, its alias hit, `MOV-1`'s rename-collision check, and (FAM-1 contract
   change C8) the program builder's `newItem`, through `existingItem`
   ([program-contract.md](./program-contract.md) invariant 15), all fold by it. Two
   surfaces disagreeing about what a duplicate is would let a rename refuse a name the picker had
   just offered. It builds on PROF-1's `foldName` and adds only the movement-specific part (plurals,
   punctuation, the possessive's orphan `s`) — a source scan asserts the import, because a local
   `.toLowerCase().trim()` passes every behavioural vector while disagreeing on accents and
   zero-width characters.

2. 🔴 **The component NEVER writes.** It imports no Server Action and no `app/` module, pinned by a
   source scan. A typed name is created by the caller's save — the set's today, the program's at
   `D2` — which is what lets `D2`'s editor mount the same component (criterion 34).

3. 🔴 **A declaration is not a magnitude.** `MovementOptionDTO` carries `unitDefault`,
   `isBodyweight` and `trackingType` — what kind of thing the movement _is_ — and has no `load`,
   `reps` or `sets`, pinned by `@ts-expect-error`. Picking a movement may seed a card's unit, load
   mode and fields; it may never prefill a number. This is the app's one inviolable product rule
   (AGENTS.md; strength-logging invariant 1).

   **`trackingType`** (FAM-1 step 0b) is one of the seven `TRACKING_TYPES`: how the item is logged,
   set once on the item ([FAM-1 plan](../plans/fam-1-family-program.md) D1, D25). The
   movement picker shows it on each row's second line (invariant 14). **The program builder's read
   fills it** (FAM-1 7a-ii, `apps/web/lib/dal/program/picker.ts`, over lane P's
   `packages/db/src/queries/program/movement-options.ts`; [program-builder.md](./program-builder.md)
   invariant 19): from the DATABASE ROW, never from the library, since the row is what a save and a
   log use. The preview's fixtures still build it there (`picker-options`,
   [program-contract.md](./program-contract.md)).

4. **"Use as typed" is withheld when the text already names a movement**, and that is the whole
   point. Typing `rdl` must offer Romanian Deadlift, never mint a household movement called "rdl".
   Since C30 there are three signals, the server's `existingItem`'s: an exact name, an exact alias,
   or what the text's short forms spell (`bb curl`). They come from `searchMovementOptions`
   (`exact`, `aliasHit`, `shortFormHit`); invariant 13 says how the picker reads them.

5. **Emptiness is tested on the RAW query, never on the fold.** `🙂` and `---` fold to `''`; a
   fold-based check drops them into browse mode and never renders the disabled footer that tells
   someone why they cannot create them. Probed: a fold-based check reddens the `aria-disabled` cases.

6. **A dead movement id THROWS until `C4m`.** `resolveMovementByPublicId` returns `null` and the
   resolver raises `MovementNotAvailableError`; no screen can produce one, because the picker offers
   only rows its read returned and movements are never deleted. ✅ **Ruled 2026-11-12: it stays a
   throw.** A review argued a crafted body makes it an _expected_ refusal owed a typed envelope; the
   maintainer kept Decision 2, and `C4m` (merge) — the chunk that makes a dead id genuinely reachable
   — owns turning it into one. ⚠️ The error surfaces at `app/error.tsx` and the form is lost; the
   docblock used to claim otherwise. ⚠️ Since `V1-9b` B1-2 the DAL rethrows it as a `DbWriteError`
   (`logStrengthSession.resolveMovements failed (MovementNotAvailableError)`), so `C4m` must catch it
   inside the wrap or return it as a writer result; an `instanceof` in the action never matches.

7. ✅ **The `prescribed` match compares `movement_id` on BOTH sides, and a rename cannot move it.**
   **Closed, not pending.** This invariant used to read "after C4r renames a row, chunk 2's slug match
   must compare ids" — a future obligation. V1-22 chunk 2 (#367) shipped keyed on `movement_id` for
   the log-time writer and the export's live fallback alike, so there is no slug proxy left to
   switch and `MOV-1b` switches nothing.

8. 🔴 **One query reaches everything below the `<input>`: the DEFERRED one.** `query` itself is read
   only as the field's own `value`. React commits the urgent render with the old deferred value and
   corrects it in a second pass, so a render mixing the two shows states that are _wrong_, not
   merely stale — the first keystroke of every search announced "No matches." and then the count
   (which is criterion 46's read-once problem), and `rd` → `rdl` offered for one frame to create a
   duplicate of Romanian Deadlift. An earlier fix held creation while the two disagreed; that
   patched one symptom of two. ⚠️ **Not reproducible in jsdom**, where `useDeferredValue` settles
   synchronously — which is why it was found by reading the render and not by a red test.

9. **The alias a row was found by comes OUT of the matcher.** The search's `foundByAlias` maps
   each row found through another name (an exact alias, part of one, or a near miss of one) to that
   alias as authored, and the "also called" tag reads it. The component used to re-run "fold both
   sides, compare keys" itself — a second copy of `movement-search.ts`'s rule, in a React
   component, that would drift the first time the fold changed.

10. **Every counted string goes through `plural()`, and every `one` form carries its count.** `one`
    is a CLDR category, not the number one: in Russian it covers 21, 31 and 101, so `'1 match.'`
    renders "1 match." for twenty-one of them. In English the two are indistinguishable, which is
    exactly why it is a rule here rather than something noticed later.

11. **With no query, "All movements" is the kind of training, then a family, and so is what fits a
    filter** (CAT-3 B3; spec P12, K24 to K27). This **overturns** the old invariant 11 ("the browse list shows only what the
    entries map groups"): browse reads no legacy `group`, and every listed row is reachable by
    browsing. What lives between files:
    - **The tree is `browseTree`'s**, from the contract (`packages/shared/src/catalog/families.ts`):
      the kinds in `BROWSE_KINDS`' order, families biggest first, rows by `byFoldedName`, and no
      family level for a kind in `BROWSE_FLAT_KINDS` (Conditioning and Skill, K27 and K30). The
      picker draws what it is given; a label changes in `MODALITY_LABELS` or
      `MOVEMENT_FAMILY_LABELS`, never here.
    - **`browseView` partitions once**: `filterMovementOptions` over the picker's own `matchable`
      (`movement-option.ts`, the mapping the search and the filter counts read), then `hasLibraryData` (the one test
      for "has a kind") splits the tree's rows from K24's. **N for "All movements" is the tree plus
      K24's rows**, which is `movementFilterCounts(…).total`, pinned by a test.
    - ⏳ **K24: the old built-ins with no library entry are "Not sorted yet"**, an `h4` after the
      kinds, sorted by `byFoldedName`: folded on a long tree, and open by itself while the tree
      opens itself _(maintainer, 2026-11-19: "Open it while the tree is small")_. One sibling block tagged `TODO(CAT-3 chunk R)`, so the
      post-R2 cleanup deletes it whole. K23's pairs are listed in both places.
    - **The order**: "Your custom items" (open at `CUSTOM_OPEN_AT_MOST` or fewer, K25), Recent,
      Today's program, then All movements (open). A kind or a family starts closed, except that
      **every kind and family opens itself while the tree holds `BROWSE_OPEN_AT_MOST` rows or
      fewer** (K26), counted on the tree alone; never the custom items by that rule. No row carries
      a group tag (P12). With no match at all and no filter, the list beneath is All movements, with
      no custom section.
    - **Under a filter it is the same tree, from the same `browse` element** (B3-ii): the view is
      `browseView(options, filters)`, so the heading reads "Movements that fit your filters", the
      counts are the filtered ones, an empty kind or family is not there, and "Not sorted yet" is
      empty (no bare row passes a filter). **It opens itself on the FILTERED tree's rows**, so a
      filter that leaves `BROWSE_OPEN_AT_MOST` or fewer opens every kind and family. "Your custom
      items (not filtered)" comes first, **folded however few there are** (P9, K25), under a key of its
      own (`customFiltered`), so opening the custom items with no filter does not carry two dozen
      open rows above the filtered results; a household item names both keys, so a tick opens
      whichever is drawn. Nothing fits: `COPY.noneFit` with Clear filters.
      With no match at all under a filter, the list beneath is this one, custom items included (P10).
    - **Every group is a button inside its heading** (the APG disclosure, `Group`, the picker's only
      one since B3-ii: Today's program and the custom items too), never `<details>`:
      `aria-expanded`, `aria-controls` while open, and a closed group renders nothing. Headings: the
      top sections `h3`, a kind and "Not sorted yet" `h4`, a family `h5`, and "How to" one below its
      row's section. Only the top sections are landmarks.
    - 🔴 **The open state is ONE model, in the picker** (`browse-view.ts`): a tap's choice beats
      everything; a `seeded` latch holds the groups above every row ticked or current. It survives
      the filter panel, the takeover, a no-match query and clearing the search, and resets only when
      the sheet opens. **Today's program is a group in the same model**: open while any of it is not
      on a card or while it holds a ticked row (read live, so ids that arrive after the tick still
      open it), and a multi-mode tick in it seeds it, so unticking does not fold it under the thumb
      (what `FoldedSection`'s latch did). The current row (single mode) and a `reveal` do not open
      it: their card is already there. **A new selection reopens the groups above it even if the person closed one**
      (its taps are forgotten), adjusted during render, so the row a caller focuses after a create is
      in that commit; unticking closes nothing. **`reveal`** (`{ id, revision }`) does the same for
      a row whose selection does not change (Select on an item already ticked, a new item not
      ticked because the workout is full); a new revision reveals the same id again. A filter change forgets only the groups the person
      closed. Keys and ids are kind-qualified (`strength/core`, `mobility/core`).
    - **360px:** only the disclosure buttons indent (a kind `pl-3`, a family `pl-6`). Rows step in
      `ml-3` only from 400px (`min-[400px]:ml-3`): at 360px the name column keeps 194px in multi
      mode with "How to", and every pixel of indent is taken from it. A long family label wraps
      inside its tap target, its count in a `shrink-0` span (about 128px for the label at 200% text).
    - 🔴 **Large text and zoom (WCAG 1.4.4): a row stacks "How to" under its name** when its list
      is narrower than `@xs` (the list is an `@container`; the row `@max-xs:flex-col`, the empty
      spacer `@max-xs:hidden`). Side by side at 200% text the paddings, box and "How to" all scale,
      and the name column would be about 30px, a letter per line. Stacked it is about 174px at 200%
      text on a 360px phone, and about 101px on a page zoomed to 195 CSS px; at 360px and 100% text
      the list is 328px, so the row stays one line at 194px.
    - **e2e** (`e2e/movement-picker.a11y.spec.ts`): a kind (from the keyboard) and a family at
      360px; the filtered tree's headings; and the open Squats family at 200% text and at 195 CSS
      px: no text-bearing span wider than its box, Goblet squat's name at least 120px (90 at 195),
      "How to" under the name, the family's label ending before its count, nothing in the dialog
      wider than its box. (Not `expectNoHorizontalOverflow`: the page under the fixed sheet cannot
      scroll sideways.) `picker-browse-open` and `picker-filter-browse` are the captures.

12. **Multi-select is a second mode, not a change to the first** (FAM-1 step 9). The props are a
    union: `onPick` (single) or `multiple` (multi), never both. In multi mode:
    - a row is a `button role="checkbox"` with `aria-checked`, the box on the LEFT and the text
      after it (CAT-3 B2, the accepted prototype's), so ticks line up whether or not a row has
      "How to" beside it, and a thumb aimed at the box never lands on it; no `aria-current`;
    - a tap toggles and the sheet stays open; Enter selects the one unambiguous match (never
      deselects, never creates) and clears the search;
    - "create" is the caller's: the button sits at the TOP of the body (with the keyboard up, the
      footer is about 110 rows down), is withheld when the text already names a movement (invariants 4 and 13),
      and hands the typed text to `onCreate`. The component still never writes (invariant 2). `createDescribedBy` ties the button to a line of the caller's as well (FAM-1 7b-ii: the builder's household-full line, whose words also replace the no-match hint at the cap);
    - the caller's own words come in through the props (create, no-match hint, search label, the tag's subject, the footer). The picker's general words stay its own: the counts, `movementNameSchema`'s messages and the row's second line (invariant 14), which replaced the caller's `describe`;
    - the caller's `footerAction` sits **beside** the picker's own Close, which stays last, with the caller's `footerNote` lines above both: one row of buttons, so the list keeps its room with a phone's keyboard up, above the sheet's fixed compact threshold (`COMPACT_VIEWPORT_HEIGHT`, 480) _(maintainer, 2026-11-16)_;
    - `onReturned` passes through to the sheet: the caller's moment for a page-level message after a close;
    - `matchable` is the one place a `MovementOptionDTO` becomes what the matcher reads; `searchPickerOptions` and `listedAs` both read through it, and the caller's "is this already an item" asks `listedAs`, never a copy;
    - `onToggle` says how a row was ticked (`'enter'` from the search), so the caller can say what a focusless Enter did;
    - `notice` takes the status region until the caller clears it (`onQueryChange` fires on every
      search change); `takeover` replaces the search, the list AND the footer (the caller's form; its exits are the header's ✕ and the caller's own Cancel), and opening it clears the search, so the list is whole when the form closes and the row the caller focuses stays put;
    - the search's label and placeholder are the caller's (`searchLabel`, `searchPlaceholder`);
    - a ticked row is outlined (`aria-checked:border-foreground`), never filled: muted text on the
      accent fill is under AA. Rows carry `data-option-id`, and the create button has
      `PICKER_CREATE_ID`, so the caller can put focus back on them.

13. **The list reads the library's search, and "already listed" is the server's rule** (CAT-3 B1,
    after C30). What the list shows is [spec](../specs/cat-3-movement-library.md) P1 to P5 and P17;
    what lives between files here:
    - `searchPickerOptions` feeds the list. **`listedAs` IS `existingItem`** over the same
      mapping, and the list's own `listed` reads the same three signals from its search result, a
      test holding the two to one answer, so the list, the item form and `newItem` agree: an exact name,
      an exact alias, or what the text's short forms spell (`bb curl` is Barbell Curls). Any of the
      three withholds "use as typed", gives the status its "Already in the list as …", and is what
      Enter picks.
    - **Enter picks the search's `enterTarget`** (since B2-ii): a hit, whatever the filters, or a
      sole match found by its own name; never one found through part of another name (P17), a
      similar name or a some-words row (P5). With nothing to pick and rows on screen it puts a touch
      screen's keyboard away so the rows show.
    - **"Also called" reads the search's `foundByAlias`**: an exact alias, part of one, or a near
      miss of one. The component never re-derives which alias matched.
    - **The dedupe is the component's**, not the contract's: a row in `near` is dropped from
      `someWords` before anything (heading, count, hint, button) reads either.
    - **The create hint names a near miss only** (`similar = near[0]`), never the first of several
      some-words rows, which would point a new movement at an arbitrary one, and never a row already
      ticked in multi mode, where the tap it suggests would untick it. It is visible and tied to the
      button by `aria-describedby`: in multi mode the button sits above the list (invariant 12), so
      the hint is what reaches a keyboard first.
    - **The query stays in the picker** (P6). Its modules import only an allowlist, and a scan bans
      network, router, storage, logging and `new RegExp`. It reaches its callers through
      `createLabel` (every render, so it must be pure), `onQueryChange` (handed nothing) and, on a
      tap, the deliberate create (`onCreate`, `onPick({ kind: 'typed' })`), which is the caller's to
      send. `item-picker.test.tsx` holds that searching runs no action. ⚠️ It holds while the app has
      no browser Sentry.
    - **The `KB` and `DB bench` aliases are retired** (P3). ⚠️ So `kb` or `db bench` alone lists
      its movement (Enter picks the one match) but no longer withholds "use as typed": neither
      spells a whole movement once expanded.
    - **Cost:** before C30, `searchMovementOptions` over 500 options took at most about 7.6 ms a
      call on a desktop CPU (M1 Pro, Node 26), on the deferred value; not measured on a phone. C30's
      measure at 500 entries is the contract's.

    **The headings are the accepted prototype's**, "Did you mean" and "Has some of your words" (spec P5 as amended, 2026-11-17; B2-i). The picker's tests pin no
    result order beyond an exact hit first; the order is the contract's (C30). A near miss on a
    still-typing last word (`bulgara`) comes as a proposal. "Did you mean" on a new item's name is
    `PICK-2`'s (spec § Interactions).

14. **Every row says how it is logged and what it needs, and may carry "How to"** (CAT-3 B2-i;
    [spec](../specs/cat-3-movement-library.md) P13, P14, P16). In both modes:
    - **The second line is `rowMeta`:** the tracking label, then the equipment in words, "No
      equipment" for an empty set, or "Custom item" for a household's own item, which is never
      called "No equipment". The row's tag joins that line with " · ", so a row stays short enough
      that two fit with a phone's keyboard up. A household item carries no tag: its second line
      already says what it is.
    - **A library option IS the contract's `CatalogOption`** (the DTO's catalog arm), taxonomy
      required, plus the legacy `group` where an old built-in has one, which nothing reads since B3
      (it goes in the post-R2 cleanup). A library entry is found by search and by browsing its kind
      and family (invariant 11). ⚠️ A read that has not got the equipment set must not build a
      library option: `equipment: []` MEANS "No equipment" and passes that filter.
    - ⏳ **Until the catalog's fresh start (CAT-3 chunk R), an old built-in with no library entry is
      `BuiltInWithoutLibrary`** (FAM-1 7a-ii; maintainer, 2026-11-17: "Show all 35 until reset"): a
      catalog row with NO taxonomy field at all, never a placeholder. `hasLibraryData` tells the two
      catalog shapes apart: such a row's second line is its tracking label alone (no equipment is
      claimed), no filter passes it, and it has no "How to". The arm goes at chunk R.
    - **The supervision label** ("Learn with a coach present") is its own line between the name
      and the second line, at full contrast in every row state, and never replaced by a tag.
    - **The row's accessible name reads its parts apart** ("Pull-Up, Learn with a coach present,
      Reps · Pull-up bar"), with hidden separators: stacked spans carry no space between them.
    - **"How to" is the caller's loader, by public id** (`howTo(publicId)`, on `MovementPicker`,
      `ItemPicker` and `WorkoutEditorScreen`): the steps are read by slug on the server, and the
      picker imports no server action (invariant 2). A failure is a rejection. With no loader, no
      row shows the button; with one, it shows only on a library row whose entry
      `hasInstructions`, and a row without steps keeps the column empty so rows end at one edge.
    - **One box per row ON SCREEN**, keyed `${section}:${publicId}`: a movement listed twice
      (Recent and its family) opens one box, under the row tapped. Each load has a number, and an
      answer applies only while that load is still the open one, read from state, so a reopen, a
      search change (typing, Enter, the takeover) or opening another row drops a late answer.
    - **The box** is a region named by its `h4` ("How to do X"), busy while loading: **the
      supervision label first, read from the option** (so a loader that leaves it out cannot drop
      it, K17), then the steps; "No steps for this movement yet." for `null` or blank steps; on
      failure, "Try again". "Try again" and "Hide" put focus on "How to" before the box changes.
      `aria-controls` is set only while open.
    - **The failure is said in the sheet's one status region**, derived from the box: it stands
      through a retry (so the region does not fall back to re-reading the search count), goes with
      the box, and wins over the caller's `notice` until a tick silences it. When it ends (Hide, a successful retry), the region falls back to the search count or the notice, which is read again: one re-read on purpose, since the failure no longer stands.
    - **The production loader is a Route Handler** (FAM-1 7b): `howToLoader`
      (`components/program-builder/how-to-loader.ts`) fetches `howToPath(id)`, served by
      `app/programs/how-to/[optionId]/route.ts`, which resolves the id among the caller's own
      options (`getHowTo`, `lib/dal/program/picker.ts`) and answers the strict `CatalogHowTo` or
      one byte-identical 404. The loader keeps this invariant: a 404 is `null`; any other failure,
      or a body the schema refuses, **rejects**. A page supplies it through `WorkoutEditorPage`,
      because a Server Component cannot pass a function to a Client Component.

15. **Filters narrow the library; they never make a name new** (CAT-3 B2-ii;
    [spec](../specs/cat-3-movement-library.md) P7 to P10, P15). What lives between files:
    - **The state is the picker's**, so it lasts while the caller keeps the picker mounted (the
      builder's item picker does, for the editor's life) and goes when it unmounts: "kept while
      adding to the same workout" (P7). A reopen opens on the list, never the panel, and says once
      that filters are still on, after the sheet's region has mounted (Announcer's rule 1).
    - **The panel (`movement-filter-panel.tsx`) replaces the body and footer**, as the new-item
      form does; the search and the Filters button are hidden, not unmounted. **Escape closes the
      panel only**, through the sheet's `onEscapeKeyDown` (the consumer calls `preventDefault`); the
      back gesture and ✕ still close the sheet. Focus goes to the panel's heading on open and to
      Filters on close, through a ref the next render reads, since neither exists until it draws.
    - **One region**: while the panel is open the sheet's status is the panel's last change
      ("Lats on. 2 movements."), and the panel's visible count is plain text.
    - **Counts are `movementFilterCounts`'**, computed only while the panel is open. A choice whose
      count is 0 is `aria-disabled` unless it is ticked, so whatever is on can always be undone.
      🔴 **Never `disabled`**: a ticked choice can count 0, and unticking it would disable the control
      under focus. A ticked equipment item beyond the first ten stays listed after it is unticked,
      until the panel closes, and **the items' order is ranked with no muscle on**, so ticking a
      muscle never reshuffles the list above the muscles.
    - **The list under a filter reads the filtered search** (`searchPickerOptions(…, filters)`):
      an exact hit first with no heading, tagged "not in your filters" when outside them (P8);
      "More matches" after a hit; the household's items apart, "Your custom items (not filtered)"
      (P9); then the near misses and some-words; then how many more are outside, with its own
      Clear filters (P10). **With no match at all**, the list beneath is the filtered browse, never
      the whole list; with matches the filters hide, nothing else is listed (a kid reads a browse
      there as results for the query, and the accepted prototype shows it only when nothing
      matched). Browsing with a filter is invariant 11's tree, with no Recent and no Today's program.
    - ⏳ **A built-in with no library data is never "not in your filters"** (until CAT-3 chunk R;
      board call, 2026-11-17, after a UX lens): no filter can judge it, so its exact-hit tag is
      "equipment and muscles not known yet" (`tagNoLibraryData`, never starting "No equipment",
      which is a library row's equipment line) and the status says "whose equipment and muscles
      aren't known yet". The Filters button shows only when some row `hasLibraryData`. **The line
      after the results splits them out** (`COPY.outsideLine`, from the search's `outsideFilters`
      and `outsideWithoutData`, #590): "2 more are not in your filters. Your filters also hide 1
      more: its equipment and muscles aren't known yet." One function decides the whole line.
    - **The status counts each custom row as what it was found as**: a match when the unfiltered
      search matched anything, otherwise a near miss or a some-words row (P5, P9).
    - **The folded custom items open themselves for a ticked row**: the item form focuses the row
      it just made, and a closed group renders no row to focus. It is invariant 11's seed (since
      B3-ii; `FoldedSection` and its latch are gone): unticking closes nothing, and only a tap closes it.
    - 🔴 **The create button and its hint read the UNFILTERED search** (panel row 9): loud only
      when nothing at all matches, and a near miss the filters hide is still named ("… is listed
      but is not in your filters."). A filter that hid a match and turned the button loud would
      invite the permanent duplicate invariant 4 exists to prevent.

## Traps

- ⚠️ **The sheet's scroll lock needs `StyleNonce` in the root layout.** `RemoveScroll` locks the
  page by injecting a `<style>`, which the production CSP blocks unless it carries the request's nonce;
  `components/layout/style-nonce.tsx`, rendered in `app/layout.tsx`, supplies it. Without it the
  picker still opens, but the page behind it scrolls.
- ⚠️ **A copy key must not begin `use`.** `useAsTyped` reads as a React hook to
  `react-hooks/rules-of-hooks`, and the footer calls it inside a conditional — exactly what that rule
  forbids. They are `asTyped` / `asTypedHint`; the UI text is unchanged.
- ⚠️ **Do not reset the query in an effect.** `setQuery('')` in `useEffect` is a cascading render and
  this repo's lint refuses it; the sheet would paint once with the stale query. It is adjusted during
  render against the previous `open`, React's documented pattern for deriving state from a prop.
- ⚠️ **Do not define a section component inside the picker.** A component created during render is a
  new type every pass: it remounts its subtree and loses focus.
- ⚠️ **In a jsdom test, query the trigger from the DOM, not through `screen`.** Radix's modal puts
  `aria-hidden` on the rest of the document, so a role query stops finding the opener the moment the
  sheet opens — and fails with an error that reads as "the harness did not render".
- ⚠️ **Library fixtures come from `CATALOG_FIXTURE`** (`libraryOption`, `LIBRARY_OPTIONS`,
  `libraryNamed` in `test/movement-picker-fixtures.ts`), and **the old seed rows
  (`catalogOption`, from `MOVEMENT_SEED_ROWS`) only until F1**; `withoutLibraryData` makes a K24 row.
  A suite over invented options passes while the catalog does something else. The test library
  holds more than `BROWSE_OPEN_AT_MOST` rows, so its tree starts closed: open the groups a test needs
  (`expandBrowse`, in the fixtures file; the item picker's suite uses it too).
- ⚠️ **One bounded consequence lives in [write-path.md](./write-path.md) invariant 14, not here.** A
  household row whose slug a global row shadows is reachable by id, and freezes `''` for the
  `prescribed` snapshot. It stays in that guide — the behaviour is `resolveMovementByPublicId`'s, and
  moving it here would make a later PR edit a file PR 2 edited, which is a
  [parallel-work](../parallel-work.md) Gate 1 collision.

## What is NOT covered by jsdom — all PR 4, in a browser

The component's cases cover list composition, tag precedence, Enter semantics, the status shape,
the footer's states and the source scans. They deliberately **do not** claim:

- any of Decision 8's **360px width arithmetic** — jsdom applies no Tailwind, so `min-h-12`, the tag
  wrap and "Overhead Shoulder Press" beside a group tag are all unmeasured here;
- real `(pointer: coarse)`, and therefore **"no keyboard on open"** (criterion 18);
- `useDeferredValue` settling, and the status being read **once** by a screen reader (criterion 46).
  ⚠️ jsdom settles it synchronously, so invariant 8's bug class is **invisible** here in both
  directions: a regression that re-splits the query would not redden a single test;
- `enterKeyHint="search"`, `maxLength` on paste, the browse tree's 360px and 200%-text width math
  and its disclosure buttons' 44px (`movement-picker.a11y.spec.ts`);
- ⚠️ **Today's program's disclosure has no e2e step and no capture**: no caller passes
  `todaysProgram` yet (the preview's item picker does not). Its first caller adds both;
- Enter in the portaled input **not** submitting the form.

A test plan that promised these would be claiming coverage it cannot deliver, which is the defect
[lessons.md](../lessons.md) → "Guards that pass while guarding nothing" names.

## Changing it

The contract is [pick-1-movement-picker.md](../plans/pick-1-movement-picker.md) — read its
**§ Amendment** and **§ UX panel, round 2** first; the second is where the eight gaps in Decision 8
were decided, and each is marked `panel 2 · N` in the component. `MOV-1` imports `movementNameKey`;
`CAT-3` extends the search with fuzzy matching and relevance ranking on top of these rules rather
than replacing them.
