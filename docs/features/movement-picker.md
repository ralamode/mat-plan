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

## The map

| File                                                | What                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/movement-search.ts`            | `foldMovementQuery`, **`movementNameKey`** (THE "same movement" key), `matchMovementOptions`, and CAT-3's `searchMovementOptions`. Pure, no React, no DB. **Owned by [program-contract.md](./program-contract.md) since CAT-3 C0a**: the library's search is added beside it, so a change to this file goes through the contract owner. |
| `packages/shared/src/movement-picker-catalog.ts`    | `MOVEMENT_PICKER_GROUPS`, `MOVEMENT_PICKER_ENTRIES` (group + aliases per slug), `MOVEMENT_PICKER_ALIASES`, `RECENT_MOVEMENTS_LIMIT`.                                                                                                                                                                                                    |
| `apps/web/lib/movements/movement-option.ts`         | `MovementOptionDTO` (a union on `owner`; each option declares its `trackingType`), `MovementPickerData`. Types only — **not** `server-only`, so a client component may import them.                                                                                                                                                     |
| `apps/web/lib/movements/movement-picker-copy.ts`    | Every string the picker, the card hint and the Save line show.                                                                                                                                                                                                                                                                          |
| `apps/web/components/movements/movement-picker.tsx` | The component. `'use client'`, on U0's `Sheet`.                                                                                                                                                                                                                                                                                         |
| `apps/web/lib/i18n/plural.ts`                       | Not owned here, but every counted string above goes through it. See `I18N-1`.                                                                                                                                                                                                                                                           |
| `apps/web/lib/i18n/locale.ts`                       | Not owned here. `APP_LOCALE` — the one locale `plural()`, `Intl.ListFormat` and `<html lang>` all read.                                                                                                                                                                                                                                 |

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
   set once on the item ([FAM-1 plan](../plans/fam-1-family-program.md) D1, D25). The program
   builder's item picker (step 9) shows it under each name. ⚠️ **No read fills it yet.** The column
   arrives in step 3 and the picker's read in step 6a, homed in `packages/db/src/queries/program/`
   ([program-writers.md](./program-writers.md)), not in the `queries/movement-options.ts` this
   guide's frontmatter note expects. Until then only fixtures build the DTO: the tests here, and
   the contract's `picker-options` ([program-contract.md](./program-contract.md)).

4. **"Use as typed" is withheld on an exact or alias hit**, and that is the whole point. Typing `rdl`
   must offer Romanian Deadlift, never mint a household movement called "rdl". The rule lives in
   `matchMovementOptions`' `exact` / `aliasHit`, tested against the plan's vector table.

5. **Emptiness is tested on the RAW query, never on the fold.** `🙂` and `---` fold to `''`; a
   fold-based check drops them into browse mode and never renders the disabled footer that tells
   someone why they cannot create them. Probed: a fold-based check reddens the `aria-disabled` cases.

6. **A dead movement id THROWS until `C4m`.** `resolveMovementByPublicId` returns `null` and the
   resolver raises `MovementNotAvailableError`; no screen can produce one, because the picker offers
   only rows its read returned and movements are never deleted. ✅ **Ruled 2026-11-12: it stays a
   throw.** A review argued a crafted body makes it an _expected_ refusal owed a typed envelope; the
   maintainer kept Decision 2, and `C4m` (merge) — the chunk that makes a dead id genuinely reachable
   — owns turning it into one. ⚠️ The error surfaces at `app/error.tsx` and the form is lost; the
   docblock used to claim otherwise.

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

9. **The alias that hit comes OUT of the matcher.** `aliasHit` is the alias text (`'RDL'`), not a
   boolean, so the "also called RDL" tag tests plain identity on authored strings. The component
   used to re-run "fold both sides, compare keys" itself — a second copy of
   `movement-search.ts`'s rule, in a React component, that would drift the first time the fold
   changed.

10. **Every counted string goes through `plural()`, and every `one` form carries its count.** `one`
    is a CLDR category, not the number one: in Russian it covers 21, 31 and 101, so `'1 match.'`
    renders "1 match." for twenty-one of them. In English the two are indistinguishable, which is
    exactly why it is a rule here rather than something noticed later.

11. **The browse list shows only what the entries map groups.** A seeded row with no entry in
    `MOVEMENT_PICKER_ENTRIES` is not browsable — it still resolves by id and by typed name — and the
    key-set test fails until someone chooses a group. That is what makes "no `other` group" true by
    construction rather than by a test that happens to pass, and it is why `CAT-2` cannot add a
    movement without deciding where it lives.

12. **Multi-select is a second mode, not a change to the first** (FAM-1 step 9). The props are a
    union: `onPick` (single) or `multiple` (multi), never both. In multi mode:
    - a row is a `button role="checkbox"` with `aria-checked`, in two columns (name and its meta
      line, then a fixed box), so ticks line up at 360px; no `aria-current`;
    - a tap toggles and the sheet stays open; Enter selects the one unambiguous match (never
      deselects, never creates) and clears the search;
    - "create" is the caller's: the button sits at the TOP of the body (with the keyboard up, the
      footer is about 110 rows down), is withheld on an exact or alias hit as before (invariant 4),
      and hands the typed text to `onCreate`. The component still never writes (invariant 2);
    - the caller's own words come in through the props (create, no-match hint, search label, the tag's subject, the footer). The picker's general words stay its own: the counts ("2 movements match some of your words") and `movementNameSchema`'s messages;
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
      mapping, so the list, the item form and `newItem` agree on the three signals: an exact name,
      an exact alias, or what the text's short forms spell (`bb curl` is Barbell Curls). Any of the
      three withholds "use as typed", gives the status its "Already in the list as …", and is what
      Enter picks.
    - **Enter otherwise picks only a sole match found by its own name**: never one found through
      part of another name (P17), a similar name or a some-words row (P5). With nothing to pick it
      puts a touch screen's keyboard away so the rows show.
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

    ⚠️ **The heading is interim:** see `MOVEMENT_PICKER_COPY.near`. The picker's tests pin no
    result order beyond an exact hit first; the order is the contract's (C30). A near miss on a
    still-typing last word (`bulgara`) comes as a proposal. "Did you mean" on a new item's name is
    `PICK-2`'s (spec § Interactions).

## Traps

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
- ⚠️ **A fixture must come from `MOVEMENT_SEED_ROWS`.** The grouping, aliases and names are what PR
  4's DAL reads out of the real catalog; a suite over invented options passes while the catalog does
  something else.
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
- `enterKeyHint="search"`, `maxLength` on paste, `<summary>` ≥44px;
- Enter in the portaled input **not** submitting the form.

A test plan that promised these would be claiming coverage it cannot deliver, which is the defect
[lessons.md](../lessons.md) → "Guards that pass while guarding nothing" names.

## Changing it

The contract is [pick-1-movement-picker.md](../plans/pick-1-movement-picker.md) — read its
**§ Amendment** and **§ UX panel, round 2** first; the second is where the eight gaps in Decision 8
were decided, and each is marked `panel 2 · N` in the component. `MOV-1` imports `movementNameKey`;
`CAT-3` extends the search with fuzzy matching and relevance ranking on top of these rules rather
than replacing them.
