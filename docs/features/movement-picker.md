---
feature: The movement picker (choose, or create by typing)
owns:
  - apps/web/components/movements/
  - apps/web/lib/movements/
  - packages/shared/src/movement-search.ts
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
- **PR 4** — mounts it in the log form, adds Decision 5's two reads, and owes a UX panel plus
  three-width screenshots.

## The map

| File                                                | What                                                                                                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/shared/src/movement-search.ts`            | `foldMovementQuery`, **`movementNameKey`** (THE "same movement" key), `matchMovementOptions`. Pure, no React, no DB.                       |
| `packages/shared/src/movement-picker-catalog.ts`    | `MOVEMENT_PICKER_GROUPS`, `MOVEMENT_PICKER_ENTRIES` (group + aliases per slug), `MOVEMENT_PICKER_ALIASES`, `RECENT_MOVEMENTS_LIMIT`.       |
| `apps/web/lib/movements/movement-option.ts`         | `MovementOptionDTO` (a union on `owner`), `MovementPickerData`. Types only — **not** `server-only`, so a client component may import them. |
| `apps/web/lib/movements/movement-picker-copy.ts`    | Every string the picker, the card hint and the Save line show.                                                                             |
| `apps/web/components/movements/movement-picker.tsx` | The component. `'use client'`, on U0's `Sheet`.                                                                                            |
| `apps/web/lib/i18n/plural.ts`                       | Not owned here, but every counted string above goes through it. See `I18N-1`.                                                              |

## Invariants

1. 🔴 **`movementNameKey` is THE "same movement" rule, and it has more than one consumer.** The
   picker's `exact` test, its alias hit, and `MOV-1`'s rename-collision check all fold by it. Two
   surfaces disagreeing about what a duplicate is would let a rename refuse a name the picker had
   just offered. It builds on PROF-1's `foldName` and adds only the movement-specific part (plurals,
   punctuation, the possessive's orphan `s`) — a source scan asserts the import, because a local
   `.toLowerCase().trim()` passes every behavioural vector while disagreeing on accents and
   zero-width characters.

2. 🔴 **The component NEVER writes.** It imports no Server Action and no `app/` module, pinned by a
   source scan. A typed name is created by the caller's save — the set's today, the program's at
   `D2` — which is what lets `D2`'s editor mount the same component (criterion 34).

3. 🔴 **A declaration is not a magnitude.** `MovementOptionDTO` carries `unitDefault` and
   `isBodyweight` — what kind of thing the movement _is_ — and has no `load`, `reps` or `sets`, pinned
   by `@ts-expect-error`. Picking a movement may seed a card's unit and load mode; it may never
   prefill a number. This is the app's one inviolable product rule (AGENTS.md; strength-logging
   invariant 1).

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

8. **The browse list shows only what the entries map groups.** A seeded row with no entry in
   `MOVEMENT_PICKER_ENTRIES` is not browsable — it still resolves by id and by typed name — and the
   key-set test fails until someone chooses a group. That is what makes "no `other` group" true by
   construction rather than by a test that happens to pass, and it is why `CAT-2` cannot add a
   movement without deciding where it lives.

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

The component's 41 cases cover list composition, tag precedence, Enter semantics, the status shape,
the footer's states and the two source scans. They deliberately **do not** claim:

- any of Decision 8's **360px width arithmetic** — jsdom applies no Tailwind, so `min-h-12`, the tag
  wrap and "Overhead Shoulder Press" beside a group tag are all unmeasured here;
- real `(pointer: coarse)`, and therefore **"no keyboard on open"** (criterion 18);
- `useDeferredValue` settling, and the status being read **once** by a screen reader (criterion 46);
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
