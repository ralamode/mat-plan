# PICK-1 — the movement picker (with U0, the shared sheet)

> Backlog: [plan.md](../plan.md) → [PICK-1](../plan.md#pick-1) (`plan.md:161-219`) · Spec:
> [crud-1-fix-it-yourself.md](../specs/crud-1-fix-it-yourself.md) chunks **U0** and **C1** · Milestone:
> [CRUD-1](../milestones/crud-1-fix-it-yourself.md) · Branch: `feat/pick-1-movement-picker` (one branch
> per PR, named in [Staging](#staging)).
>
> Prototype: [`docs/prototypes/crud-1/index.html`](../prototypes/crud-1/index.html) (v9), screen
> **`log` — "CRUD-1 · PICK-1 (+ PICK-2 later) · Pick a movement"** (`index.html:1793`; `vLog` at
> `:2828-2850`, `openPicker` / `drawPicker` at `:2855-3120`, the sheet CSS at `:683-760` and
> `:986-1030`).
>
> Measured against the worktree at `8769c1b` (no `apps/`/`packages/` diff from `origin/main@27847ca`).
> ⚠️ **V1-22 chunk 2 has not merged** — every `strength-form.tsx` / `strength-session.ts` line cited
> below is pre-chunk-2 and must be re-read on the SHA each PR starts from (see
> [Gates](#gates-and-what-to-re-verify)).

## Goal

Make choosing an **existing** movement the easy path on the strength form, and make the server
resolve a chosen movement **by its id**, so a near-miss name can no longer mint a duplicate
`movements` row nobody can remove (`plan.md:163-176`). Today the Movement field is a plain
`<input type="text">` (`apps/web/app/p/[profileId]/strength-form.tsx:812-823`) and every submitted
name goes through `findOrCreateMovementId` (`apps/web/lib/dal/entries.ts:497-502` →
`packages/db/src/writers/movement-catalog.ts:63`), whose slug is only `trim → lowercase → spaces to
_` (`packages/shared/src/movements.ts:34-36`) — so "Bulgarian Split Squats" against the catalog's
"Bulgarian Split Squat" is a second row. PICK-1 is also the first consumer of a shared modal sheet
(U0), which the assignment sheet (ASSIGN-1), the program editor's Add (D2, criterion 34) and every
later confirm reuse, so the focus trap, scroll lock and in-sheet status region are written once.

Why now: it is Logging's next item (`plan.md:174-176`), AI-1 is parked on its usage data
(`plan.md:243-245`), and C2 (PICK-2), C4r (MOV-1 rename), C3 (CAT-2) and D2 (V1-22 chunk 6) all
extend or depend on it (spec chunk table, `crud-1-fix-it-yourself.md:150-157`).

## Acceptance

From the spec (criteria cited by number, text abbreviated — the spec is the source):

- **17** _(C1)_ — picking a movement and submitting a set stores an entry that references **that
  movement's id**, with **no** `findOrCreateMovement` call for it, and **no** magnitude arrives
  prefilled. (Also the PICK-1 row's own acceptance, `plan.md:183-188`.)
- **18** _(C1)_ — order: the athlete's recent movements, then the catalog grouped by picker group,
  with today's prescribed movements folded away; no on-screen keyboard on open on a touch device;
  operable by keyboard alone; every option a ≥44px target at 360px.
- **19, first sentence only** _(C1 by Q2 — see [Where the spec disagrees](#where-this-plan-disagrees-with-the-spec-or-a-row))_
  — a known alias (`RDL`) offers the movement it names. Its near-match / spelling sentences stay
  **C2's**. Its last sentence ("a movement created that way is written when the set is saved, not when
  it is picked") is **already true** of the typed-name path and PICK-1 keeps it true.
- **34** _(D2's criterion; PICK-1 owes the component it uses)_ — the editor's "+ Add a movement" opens
  **the same** picker: PICK-1 ships it as a reusable component with an "already in this workout" mark
  and caller-supplied save wording, and with no write of its own.
- **37** _(U0's tests, ASSIGN-1's criterion)_ — below 600px the sheet fills the screen with its title
  and actions pinned and only the middle scrolling; from 600px a dialog capped at the viewport height
  with the same pinned actions. (The weekday-toggle and contrast clauses are ASSIGN-1's.)
- **46** _(U0, C1)_ — a sheet whose text changes as the person edits (here: the match count) announces
  it through a `role="status"` region **inside** the sheet.

Concrete "done when", beyond the criteria:

- The PICK-1 row's two-part test passes **on a day whose program does not prescribe the movement**:
  the stored `entries.movement_id` is the existing row, and every set's reps/weight are what the
  athlete typed (`plan.md:183-188`).
- **Use as typed** is the only path that still reaches `findOrCreateMovementId`; it is refused —
  disabled in the UI **and** by the shared schema — for a name with no letter (SUX-11) or with a comma
  or line break (the existing refine, `packages/shared/src/strength-session.ts:58-61`).
- A movement id from **another household**, or one that does not exist, writes **nothing** — no
  session, no entry, no find-or-create insert for any sibling movement — and is indistinguishable
  from an unknown id.
- A scaffolded card ("Fill in today's movements") also submits its movement **by id**, so the whole
  form, not only the picker, stops depending on a name round-trip.
- The CSV export is **byte-identical** for any movement that already resolved to an existing row by
  name: the export groups by `movements.slug` (`packages/db/src/queries/export-month.ts:65`, `:83`),
  and an id resolves to the same row a matching name did.
- `pnpm verify`, `pnpm e2e:local`, `pnpm guides:check` green on every PR; screenshots at three widths
  on PR 4.

## Staging

Four PRs, each one concern and under ~400 lines (tests counted separately in the estimate). No
migration in any of them — see [Decision 3](#decision-3--groups-and-aliases-live-in-shared-code-not-a-column).

| PR  | Branch                            | What                                                                                                                                                                  | ~Lines (src / tests) | Gate                                                                                                                                                                                                 |
| --- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `feat/u0-sheet`                   | **U0.** `components/ui/sheet.tsx` on Radix Dialog + the visual-viewport hook; jsdom tests for 37/46's structure; files the a11y-scan row (unowned 8). Plus this plan. | 140 / 180            | Nothing (spec: "any time"). New file in `components/ui/`, which no guide owns and no AUTH-1 chunk names.                                                                                             |
| 2   | `feat/pick-1a-movement-id`        | **The server takes a movement id.** Schema field, the resolve core, the DAL id path, the scaffold sends ids, `db:verify` proof. No visible change.                    | 170 / 230            | **V1-22 chunk 2 merged** (same schema field list, same `MovementVals`, same `movementsJson`, both under `strength-logging.md`). Serialized against V1-24 3a/3b on the strength surface (spec E row). |
| 3   | `feat/pick-1b-picker-component`   | **The picker, unmounted.** `fold`, the picker catalog (groups + aliases), the `MovementPicker` component on U0, its copy, its tests, and the new feature guide.       | 330 / 260            | PR 1. No shared file with PR 2, so it may be **reviewed** in parallel; it merges after PR 2 only to keep one strength-surface PR in flight.                                                          |
| 4   | `feat/pick-1c-picker-in-the-form` | **Mounted.** The options read (query + DAL + DTO), the form's Movement field becomes the picker button, e2e + the a11y scan's open-sheet state, screenshots.          | 260 / 300            | PRs 2 and 3. ⚠️ Edits `app/p/[profileId]/page.tsx`, which **AUTH-1 1c** also edits (`auth-1-clerk-google.md:1708`): if 1c is open, this PR goes after it.                                            |

If PR 3 and PR 4 together come in under ~400 source lines when written, merge them; the split exists
only to keep the read path's review separate from the component's.

```mermaid
flowchart LR
  V2[V1-22 ch 2 ✅ first] --> P2
  P1[1 · U0 sheet] --> P3[3 · picker component]
  P2[2 · server takes an id] --> P4[4 · picker in the form]
  P3 --> P4
  P4 --> C2[C2 · PICK-2]
  P4 --> C4r[C4r · MOV-1 rename]
  P4 --> D2[D2 · editor Add uses it]
  AU[AUTH-1 1c] -. page.tsx, serial .- P4
```

## Design decisions (each with what was rejected)

### Decision 1 — the wire carries an id **and** a label; the id alone decides

`sessionMovementSchema` (`packages/shared/src/strength-session.ts:45-83`) gains
`movementId: uuidSchema.optional()`. When present, the DAL resolves the movement **by public id** and
ignores `movementName` for resolution; it writes the **database's** `movements.name` into
`entries.movement_name`, never the client's text. When absent, today's path runs unchanged
(`findOrCreateMovementId`, global-first).

`movementName` stays **required** on the wire, as the card's display label.

- **Why keep the label.** The action names a failing movement by its submitted `movementName`
  (`apps/web/app/p/[profileId]/actions.ts:316-322`), and V1-30's review rejected "Movement N" because
  `path[1]` indexes the _submitted_ list, which drops untouched scaffolded cards, so the number can
  point at the wrong card. An id-only wire would bring that defect back for every picked card.
- **Rejected: an exactly-one-of (`movementId` xor `movementName`).** Cleaner on paper, but it moves a
  rule into the session `superRefine` (the object must stay a plain `ZodObject`,
  `strength-session.ts:74-79`), changes the "Enter a movement." path every existing test pins, and
  costs the error label above. The xor's only benefit — a body cannot send conflicting values — is
  delivered by "the id decides, the name is ignored", which a test pins.
- **Rejected: a new `movementPublicId` name.** V1-22 chunk 2 already chose `prescriptionId` with no
  `PublicId` suffix and argued it (`docs/plans/v1-22-2-renderer-and-writer.md:195-198`); one
  convention per schema.
- **New server-side refine on `movementName`: at least one letter** (`/\p{L}/u`), the server half of
  SUX-11. A field-level `.refine` keeps the object a `ZodObject` (the existing comma refine is the
  precedent, `strength-session.ts:58-61`). ⚠️ This is a behaviour change: an emoji- or digit-only name
  that was accepted is now refused. Every catalog name has a letter; the change is deliberate.

### Decision 2 — the id is resolved in `packages/db`, under the same namespace rule as find-or-create

New core `resolveMovementByPublicId(exec, scope, publicId)` beside `findOrCreateMovement` in
`packages/db/src/writers/movement-catalog.ts`, returning `{ id, name, slug } | null`. A row resolves
only if it is **global** (`movementIsGlobal()`) **or** in **this** household
(`movementInHousehold(scope)`), both already exported from `packages/db/src/writers/ownership.ts:166-179`
and the only sanctioned way to say either (write-path invariant 2: `scope.householdId` is read in one
place).

- **Why `packages/db` and not `lib/dal`.** `db:verify` cannot import `server-only` DAL code
  (`catalog.ts` docblock; `movement-catalog.ts:47-53`), and the cross-household refusal must be
  **proved** by running the real function in both directions, the way the catalog verdict does
  (`packages/db/scripts/verify.ts:5310`, `:5565`). A DAL-only guard is a guard no proof covers
  (write-path invariant 3).
- **No `deleted_at` filter is needed, and none is added to the arbiter.** Nothing may set
  `movements.deleted_at` (`packages/db/src/schema.ts:536-543`); the read adds `isNull(deletedAt)`
  anyway as a harmless belt, which does **not** trigger the three-part lift that note demands (that is
  for indexes and the resolver's natural key, and for the PR that first _writes_ the column — C4r/C4m).
- **Order in `logStrengthSession`** (`entries.ts:479-513`): resolve **every id first** (reads), then
  find-or-create the typed names. If any id fails to resolve the DAL **throws before any insert**, so a
  refused body cannot leave a typed sibling's row committed — the residual TEN-2b-1 documents
  (`entries.ts:486-491`) does not get a new instance.
- **A failed id throws; it does not return a typed envelope.** No screen can produce one: the picker
  offers only rows the read returned, movements are never deleted, and there is no merge yet. AGENTS.md
  → Server conventions: "unexpected → throw → error.tsx". The message is a constant with **no**
  interpolated id or name (`movement-catalog.ts:55-59`: a thrown value reaches Sentry verbatim).
  **C4m (merge) changes this** — after a merge a stale page _can_ hold a dead id — and its plan owns
  turning it into a typed refusal. Recorded in the guide.
  - **Rejected: a typed `movement_not_found` envelope now.** It needs `actions.ts` edits
    (`:350-375`), which collide with AUTH-1 1c and every CRUD-1 action-adding chunk on
    `write-path.md` (spec `:199-206`), for a state no user can reach.
- **`actions.ts` is not edited.** The new optional field rides `parsed.data.movements` through to the
  DAL unchanged (`actions.ts:353-375`). The trap chunk 2 names — `z.object` is strip-mode, so a field
  missing from the schema arrives **removed** while every gate stays green
  (`v1-22-2-renderer-and-writer.md:228-234`) — is answered the same way: an `actions.test.ts` case
  asserts the **value** the DAL received.

### Decision 3 — groups and aliases live in shared code, not a column

`packages/shared/src/movement-picker-catalog.ts` holds `MOVEMENT_PICKER_GROUPS` (the spec's contract
name, `crud-1-fix-it-yourself.md:490`) and one entry per seeded movement, keyed by **slug**:
`{ group, aliases }`. The DAL attaches it to global rows; household rows have no entry and render
under "Added by your household".

- **Why not a column** (the spec's first option, unowned 2, `:652-660`): the seed is
  `ON CONFLICT DO NOTHING` (`packages/db/src/seed.ts:249-252`), so a new `picker_group` column's seed
  values would **never reach the 35 rows already in production** — it would need a backfill migration
  as well, for display metadata no screen edits. A code map is total over the global catalog by
  construction: `db:verify`'s layer 2 already pins the global set to exactly `MOVEMENT_SEED_PUBLIC_IDS`
  (`packages/db/src/schema.ts:575-579`), and a test pins the map to
  exactly `MOVEMENT_SEED_ROWS`'s slugs, so CAT-2 cannot add a row without choosing its group.
- **Why not "group by `pattern` under friendlier names"** (the spec's second option): `isolation`'s six
  rows split three ways (spec unowned 2), so a pattern map needs per-row overrides anyway, and two
  sources for one fact drift.
- **What PICK-1 ships before chunk 0** (the maintainer's human pass): the **prototype's grouping**,
  which the maintainer approved with v8/v9 (`index.html:1180-1232`) — Push 7, Pull 7, Legs 14, Core 7
  over the 35 seeded rows (`packages/shared/src/catalog-movements.ts`), `wrestling` declared and empty
  until C3 seeds the drills. Judgement calls the prototype made and chunk 0 confirms: Farmer Carry and
  Med-Ball Slam → **Core**; Sled Push, KB Swings, Box Jump, Broad Jump → **Legs**; Calf Raises → Legs;
  the isolation split as the spec lists it. And the prototype's **six aliases** (`index.html:1235-1242`):
  `RDL`, `BSS`, `OHP`, `DB bench`, `KB`, `hip thrust`. Both are **definitions a human confirms**, never
  loads (AGENTS.md's inviolable rule is about loads; still, the map's docblock says "provisional
  until chunk 0" and names who confirms it).
- **Chunk 0 then edits a TypeScript map** — one reviewed PR, no migration, no seed change.
- An unknown group cannot render as a crash: a global row missing from the map (impossible while the
  two tests above hold) falls into `other`, labelled "More", which the coverage test asserts is empty.

### Decision 4 — one normaliser, `fold`, shared; matching is substring-per-word, no edit distance

`packages/shared/src/movement-search.ts`:

- `foldText(s)` — NFD then drop combining marks (diacritics); `‘ ’ ʼ` → `'`; lower-case; collapse
  whitespace; trim. **Exported separately** because A3's typed-name confirm (SUX-9) needs exactly this
  and **not** the plural rule below.
- `foldMovementQuery(s)` — `foldText`, then every non-letter/non-digit (Unicode `\p{L}\p{N}`) → space,
  collapse, then strip **one trailing `s`** from each word of four or more letters that does not end in
  `ss` (`squats` → `squat`, `raises` → `raise`, `press` stays). Nothing else: no stemming, no edit
  distance — that is PICK-2 (`plan.md:224-242`).
- `matchMovementOptions(options, query)` — pure; returns `{ matches, aliasHit, exact }`:
  - an option matches when **every** folded query word is a substring of its folded name (so
    `split squat` and `db row` both work);
  - `aliasHit` when the folded query **equals** a folded alias (exact only — `rd` must not surface
    Romanian Deadlift);
  - `exact` when the folded query equals some option's folded name.
  - Order: alias hit, exact, prefix-of-name, then the rest by name; ties by owner (`catalog` first) —
    deterministic, tested.
- **"Use as typed" is hidden when `exact` is true.** Typing `bulgarian split squats` folds equal to the
  catalog row, and "use as typed" would mint `bulgarian_split_squats` — the exact duplicate this row
  exists to stop. Nothing is lost: the two names differ only by case, accents, quotes, punctuation or a
  plural `s`. The prototype does the same (`index.html:2996-2998`, foot hidden when `exact`).
- **Rejected: the same fold on the server before find-or-create** (silently resolve
  `Bulgarian Split Squats` to the catalog row). It is an auto-correct PICK-2's row explicitly forbids
  ("the athlete can always keep what they typed", `plan.md:226-230`), and it would change
  `findOrCreateMovement`'s contract, which `db:verify`'s catalog verdict pins.
- The prototype's `norm`/`lev` are illustrations (FE-12, `crud-1-fix-it-yourself.md:922`); these
  functions are the spec.

### Decision 5 — the read: one query for the catalog the household can see, one for the athlete's recent

`packages/db/src/queries/movement-options.ts` (single-sourced so `db:verify` proves it):

- `householdMovementOptions(db, scope)` — `public_id, name, slug, household_id IS NOT NULL as owned,
unit_default, is_bodyweight` where `movementIsGlobal() OR movementInHousehold(scope)`, **minus**
  household rows whose slug equals a global slug. That is the resolver's own **global-first**
  precedence (`movement-catalog.ts:12-24`): the picker never offers a row `findOrCreateMovement` would
  never return, so the list and the typed path cannot disagree about which "Back Squat" is real.
- `recentMovementIds(db, { profilePublicId, scope, limit })` — distinct `entries.movement_id` for this
  profile (`isLiveProfile(publicId, scope)`, `ownership.ts:118`), `entries.deleted_at IS NULL`, the
  movement itself global-or-own-household, ordered by `max(activity_date) desc, max(entries.id) desc`,
  `limit RECENT_MOVEMENTS_LIMIT` (5, in `movement-picker-catalog.ts`). Served by
  `idx_entries_profile_date` (`schema.ts:246`). ⚠️ It is a **new reader of `entries.deleted_at`** — it
  joins B1's reader audit (spec Risks, `:901`), and filters now so B1 has nothing to add.
- **Rejected: caching the catalog across requests** (FE-12's "cached catalog"). The household's own
  rows are in the same list, AGENTS.md forbids caching per-user data across users, and splitting the
  global half into a cross-request cache saves one indexed query over ≤110 rows (35 now, ~107 after
  CAT-2). What FE-12 is actually after is kept: the **payload is split** (the household catalog is one
  prop, the athlete's recent ids and today's prescribed ids are two small arrays), and filtering runs
  under `useDeferredValue`.

`apps/web/lib/dal/movements.ts` (`server-only`): `listMovementOptions(profilePublicId)` resolves
`getHouseholdScope()` itself (write-path invariant 2 — nothing above `lib/dal` holds a scope), runs
both queries in parallel, attaches group/aliases, and returns the DTO. `scoped.test.ts`'s structural
guard covers it with no allowlist entry (it resolves a scope and builds no ownership predicate).

```ts
// apps/web/lib/movements/movement-option.ts — the DTO (the spec's contract, :499-500, extended — see below)
export type MovementOptionDTO = {
  publicId: string;
  name: string;
  group: MovementPickerGroup | null; // null ⇔ owner === 'household'
  aliases: readonly string[];
  owner: 'catalog' | 'household';
  // The MOVEMENT's declaration — what kind of number it is measured in. Never a magnitude.
  unitDefault: Unit | null;
  isBodyweight: boolean;
};
export type MovementPickerData = {
  options: readonly MovementOptionDTO[];
  recentIds: readonly string[]; // ⊆ options' publicIds, newest first
};
```

`prescribedToday` is **not** a DTO field (the spec has it on `MovementOptionDTO`): it is derived on
the client from the scaffold rows the form already holds, so the read does not call `programDayRows` a
second time. The extension to the spec's DTO is `unitDefault` + `isBodyweight`, see Decision 6.

### Decision 6 — a pick seeds the movement's **declaration**, never a number

Picking an option on a card sets `movementId`, `movementName` (the option's name), and the same three
transient hints the scaffold sets (`declaredLoaded`, `declaredDimension` and the unit), computed by
**one** helper extracted from `strength-form-scaffold.ts` (`declaredUnit` / `declaredMass`, used at
`:71-100`) so the scaffold and the picker cannot disagree about what a declaration means. The unit is
applied through the existing `setDimensionUnit` path (`strength-form.tsx:353-386`) so a cross-dimension
pick clears the load modes in the same update — the guarantee the strength-logging guide's invariant
4b and its first trap rely on. Reps and weights are **untouched**: a blank card stays blank, and a card
whose sets were already typed keeps them (they are the athlete's numbers, not prefilled ones).

- `MovementOptionDTO` has **no** `load`, `reps` or `sets` field, asserted by a `@ts-expect-error`
  test the way `ScaffoldRow`'s containment is (strength-logging invariant 1).
- **Rejected: the spec's DTO without the declaration.** Then a picked "Back Squat" would open on the
  household default unit while the same movement scaffolded from the program opens on its declared
  `lb` — two paths to one movement disagreeing, exactly what V1-26 PR-A fixed for the scaffold.
- A pick **clears** `scaffolded` and V1-22 chunk 2's `prescriptionId` whenever the picked id differs
  from the card's current one (chunk 2's "rename clears it" rule,
  `v1-22-2-renderer-and-writer.md:210-215`, now lives in the pick handler, since there is no rename
  by typing). Re-picking the same movement is a no-op.
- "Use as typed" sets `movementName` to the trimmed text, clears `movementId` and every declaration,
  and sets a transient `created: true` that drives the hint under the button.

### Decision 7 — U0 is Radix Dialog from the package already installed, full screen below 600px

`apps/web/package.json:38` already depends on `radix-ui` `^1.8.1`; the installed umbrella
(`apps/web/node_modules/radix-ui/package.json`) pins `@radix-ui/react-dialog` `1.3.1`, which is in
`pnpm-lock.yaml:1722`. `components/ui/button.tsx:3` already imports `Slot` from it. So
`import { Dialog } from 'radix-ui'` is **no new dependency**, no lockfile change and no supply-chain
review item. (Checked, not assumed.)

What Radix gives and the sheet must not undo: focus trap, `aria-modal`, `aria-labelledby` from
`Dialog.Title`, Escape to close, scroll lock, `aria-hidden` on everything outside (which is _why_
criterion 46's live region must be inside), and focus return to the element focused before open.

```tsx
// apps/web/components/ui/sheet.tsx — the shape, not the code
export const SHEET_FULLSCREEN_BELOW_PX = 600; // criterion 37; the class string below repeats it ONCE

type SheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string; // rendered as Dialog.Title (an h2), tabIndex -1
  description?: string; // Dialog.Description; omitted → aria-describedby={undefined}
  status?: string; // criterion 46: a role=status <p>, mounted WITH the sheet, sr-only
  headerExtra?: ReactNode; // pinned under the title (the picker's search field)
  footer?: ReactNode; // pinned; wraps; padded by env(safe-area-inset-bottom)
  initialFocus?: 'title' | RefObject<HTMLElement | null>; // see "no keyboard on open"
  children: ReactNode; // the ONLY scrolling region
};
```

- **Layout.** `Dialog.Content` is `fixed inset-0 flex flex-col` with `height: var(--sheet-vvh, 100dvh)`
  below 600px; `min-[600px]:` a centred dialog, `w-[min(520px,calc(100vw-32px))]`,
  `max-h-[calc(var(--sheet-vvh,100dvh)-32px)]`, rounded. Header and footer `shrink-0`, the body
  `min-h-0 flex-1 overflow-y-auto overscroll-contain`. The 600px literal appears in exactly one class
  string and one exported const; a test pins that they agree (Tailwind needs the literal).
- **Full screen, not the prototype's bottom sheet, for the picker too.** The prototype draws the
  picker as a bottom sheet under 600px (`index.html:994-1001`) and reserves full screen for ASSIGN-1
  (`.full`, `:1003-1012`); the spec's U0 says full screen below 600px (`:150`). One behaviour is
  chosen: a content-height bottom sheet **changes height on every keystroke** as matches filter, and on
  iOS a bottom sheet's top edge lands under the keyboard's suggestion bar. **Open question 1** asks the
  UX panel to confirm.
- **The keyboard (U13, criterion 19's "visible above the keyboard").** iOS Safari does not shrink
  `100dvh` when the keyboard opens; only `window.visualViewport.height` does. A ~20-line
  `useVisualViewportHeight` (in `sheet.tsx`, effect active only while open) writes `--sheet-vvh`, so
  the pinned footer — where "Use as typed" lives — sits on top of the keyboard. Fallback when the API is
  missing: `100dvh`. This is a **real-phone check** (spec `:929-932`), not something jsdom or Chromium
  can prove.
- **Landscape and 200% zoom (A11Y-8).** At a 360px-tall viewport the pinned header (~128px with a
  search field) plus footer (~108px) would leave ~124px to scroll. Under `[@media(max-height:480px)]`
  the header and footer stop being pinned and the **whole** sheet scrolls as one. The footer is
  `flex-wrap`.
- **No keyboard on open on touch (criterion 18).** `initialFocus` defaults to `'title'`; the picker
  passes its search ref only when `matchMedia('(pointer: coarse)')` is false, via Radix
  `onOpenAutoFocus` + `preventDefault`. Focus on the title (tabIndex -1) keeps the screen reader
  oriented without raising the keyboard.
- **Focus return.** On close the caller may pass `returnFocusTo`; the default is Radix's (the element
  focused before open). The picker returns focus to **that card's** Movement button, which stays
  mounted across the pick (same `clientId` key).
- **Rejected: native `<dialog>` + `showModal()`** (the prototype's choice). It needs its own scroll
  lock and focus return (the prototype hand-rolls `opener`, `:1757-1776`), and the repo's components
  are Radix/shadcn by rule (AGENTS.md → Stack). **Rejected: shadcn's generated `sheet`** — it is a
  side drawer with a fixed width, not this shape; generating it and rewriting it would leave a
  regeneration hazard like `button.tsx`'s (`:7-17`). **Rejected: a route** (`/p/[id]/pick`, the
  alternative M12 weighed) — the picker returns a value into unsaved client form state, which a
  navigation would discard.

### Decision 8 — the picker is a reusable component that never writes

`apps/web/components/movements/movement-picker.tsx` (`'use client'`), not under
`app/p/[profileId]/`, because D2's editor lives at `/p/<id>/program` and must import the **same**
component (criterion 34). Its props carry everything context-specific:

```ts
type MovementPickerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string; // "Choose a movement" | D2: "Add a movement to {workout label}"
  data: MovementPickerData;
  prescribedIds?: readonly string[]; // folded into "Today's program (already on your form)"
  alreadyIn?: { ids: ReadonlySet<string>; label: string }; // D2: tag "already in {label}"
  createdWhen: 'set' | 'program'; // the hint's wording: written when the set / program is saved
  onPick: (
    pick: { kind: 'existing'; option: MovementOptionDTO } | { kind: 'typed'; name: string },
  ) => void;
};
```

It imports no Server Action and no `app/` module (a source-scan test pins it), so it **cannot** write;
a typed name is returned to the caller, which writes it when **its** save runs — the set's, or later
the program's (criterion 34's "written when the program is saved").

**What it renders** (prototype `drawPicker`, `index.html:2914-3120`, minus PICK-2's "Did you mean"):

- Header (pinned): title + **Close**; a labelled `type="search"` (`maxLength` = the schema's 100,
  `autoComplete/autoCorrect/autoCapitalize` off, `enterKeyHint="search"`), `aria-describedby` the
  status.
- Empty query: **Recent** (from `recentIds`, omitted when empty) → each picker group in
  `MOVEMENT_PICKER_GROUPS` order (empty groups omitted, so `wrestling` is invisible until C3) →
  **Added by your household** (omitted when empty) → a `<details>` "Today's program (already on your
  form)" when `prescribedIds` is non-empty and `alreadyIn` is absent.
- A query: one **Matches** section; each option tagged `in the app` (catalog) or `added by you`
  (household); an alias hit carries `also called {ALIAS}`. Status text: `n matches` / `1 match` /
  `No matches.`, written only when it changes (the prototype's `lastStatus`, `:3115-3118`).
- Footer (pinned, only when the query is non-empty and not `exact`): **Use "{typed}" as typed** — a
  full-width outline `Button` with `whitespace-normal h-auto break-words` (the base class is
  `whitespace-nowrap`, `button.tsx:19`, so a long name would overflow 328px without it), and a hint:
  usable → `Added to your household's list when you save the set. It can't be removed from the app yet.`;
  no letter → `A movement name needs at least one letter.`; a comma or line break → the schema's own
  message (`hasCommaOrLineBreak`, `packages/shared/src/text.ts:38`, reused). Disabled states carry
  `aria-describedby` to the hint (A11Y-2).
- ⚠️ **The hint does not say "you can rename it later".** The prototype does (`index.html:3092-3095`),
  but C4r has not shipped; promising a control that does not exist is the trust failure U14 named. C4r's
  PR changes the sentence.
- Semantics (U4, `crud-1-fix-it-yourself.md` review log): groups are `<section aria-labelledby>` with
  an `<h3>` and a `<ul>` of `<li><button type="button">`; **no** `listbox`/`option` roles, no
  permanent `aria-expanded`. Every option `min-h-12` (48px).

**Width at 360px** (full-screen sheet): body `px-4` → **328px**; option `px-3` → **304px**; tag
`text-xs px-2 border` ≈ 12+16+2 = 30px + "added by you" ≈ 66px ⇒ **≈ 96px**, `shrink-0`; `gap-2` 8px ⇒
**≈ 200px** for the name. The longest seeded name, "Overhead Shoulder Press" (23 characters at
`text-base`, ≈ 8.5px each ≈ 196px), fits on one line; anything longer **wraps** (`min-w-0
break-words`, the row grows past 48px) rather than truncating, since a truncated movement name is the
mis-pick this row exists to stop. Header: title "Choose a movement" (`text-lg`, ≈ 160px) + Close (ghost
`Button`, ≈ 64px) + `gap-2` = 232px ≤ 328px. Search: `INPUT_CLASS` (`lib/constants.ts:287-288`,
`h-11 text-base` — `text-base` is load-bearing against iOS zoom-on-focus) at 328px.

**The Movement field on the card** (prototype `vLog`, `index.html:2836-2845`): the `<input>` at
`strength-form.tsx:808-824` becomes a `button type="button"` with `INPUT_CLASS` sizing,
`aria-haspopup="dialog"`, `aria-labelledby` = the visible "Movement" label **and** the value span, so
it reads "Movement, Back Squat" (or "Movement, Choose a movement"). Same flex slot, same 44px height, so
the row's width budget is unchanged (strength-logging guide, "The row already wraps at 360px", ~294px).
Below it, when `created`, the hint `New movement — added to your household's list when you save.`

**The one thing a button cannot do that the input did: block the native submit.** `required` on the
input (`:817`, `nameRequired`) made the browser refuse a sendable card with no name; a button is
barred from constraint validation. The form gains an `onSubmit` that, when `firstBlocker` is a name
blocker (the same predicate the summary line already reads, `strength-form-untouched.ts`), calls
`preventDefault()`, moves focus to **that card's** Movement button, and shows `Choose a movement.`
beside it with `aria-describedby` (A11Y-2; no `role=alert` racing the focus move).

- **Rejected: a visually hidden `required` input mirroring the name** — that is the "hidden-but-present
  `required` input makes the form silently dead" trap the guide records twice (`strength-logging.md`
  Traps). **Rejected: letting the server refuse** — it works (the action's "Enter a movement." names
  the card) but costs a round trip and loses the focus move.
- ⚠️ **Unverified:** that React 19's `<form action={fn}>` skips the action when `onSubmit` calls
  `preventDefault()`. PR 4's first test proves it in jsdom and `e2e` proves it in a browser; if it does
  not hold, the fallback is the server refusal above, and the plan returns to the panel.

## File-by-file changes

### PR 1 — U0, `feat/u0-sheet`

| Path                                    | Change | What & why                                                                                                                                                                                                                       |
| --------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/components/ui/sheet.tsx`      | NEW    | Decision 7. `Sheet` + `useVisualViewportHeight` + `SHEET_FULLSCREEN_BELOW_PX`. Docblock: why Radix, why full screen, why the status region is inside, the landscape rule, and "do not regenerate from shadcn" (as `button.tsx`). |
| `apps/web/components/ui/sheet.test.tsx` | NEW    | jsdom; see Test plan.                                                                                                                                                                                                            |
| `docs/plans/pick-1-movement-picker.md`  | NEW    | This plan, with its review-response log (README: the plan rides with the first PR it plans).                                                                                                                                     |
| `docs/plan.md`                          | EDIT   | PICK-1 row links this plan. **Files unowned 8 as a row** (the a11y scan opens no dialog; `expectTapTargets` measures height only), as the spec assigns to U0's plan (`:690-694`, `:927`).                                        |
| `docs/roadmap.md`, `docs/status.md`     | EDIT   | U0 → in flight / shipped; the pointer.                                                                                                                                                                                           |
| `docs/changelog/<fragment>.md`          | NEW    | One fragment.                                                                                                                                                                                                                    |

No feature guide owns `components/ui/` (`docs/features/*.md` `owns:`), so `guides:check` is
untouched. No privacy change: a primitive with no data.

### PR 2 — the server takes an id, `feat/pick-1a-movement-id`

| Path                                                                                  | Change | What & why                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/strength-session.ts`                                             | EDIT   | `sessionMovementSchema` + `movementId: uuidSchema.optional()` (reuses `uuidSchema`, `:64`); `movementName` + the at-least-one-letter refine (Decision 1). Docblock: the id decides; the name is a label; strip-mode makes the field silently droppable.                                             |
| `packages/db/src/writers/movement-catalog.ts`                                         | EDIT   | `resolveMovementByPublicId(exec, scope, publicId)` → `{ id, name, slug } \| null`, global-or-own-household via `movementIsGlobal()` / `movementInHousehold(scope)`. Docblock cross-links `findOrCreateMovement`'s precedence. No throw interpolates the id.                                         |
| `apps/web/lib/dal/catalog.ts`                                                         | EDIT   | `resolveMovementId(scope, publicId)` — the thin `db`-binding wrapper, mirroring `findOrCreateMovementId` (`:105-107`). Takes a scope, so `scoped.test.ts` needs no entry.                                                                                                                           |
| `apps/web/lib/dal/entries.ts`                                                         | EDIT   | `logStrengthSession` (`:479-513`): resolve all ids first, throw `MOVEMENT_NOT_AVAILABLE` (a module constant) on any miss **before** any find-or-create; then find-or-create the typed ones; `movementName` passed to the writer is the DB's for an id. Docblock updates the TEN-2b-1 residual note. |
| `packages/db/src/queries/program-day.ts`                                              | EDIT   | Select `movementPublicId: schema.movements.publicId` (no new join; `movements` is already inner-joined).                                                                                                                                                                                            |
| `apps/web/lib/programming/program-day.ts`                                             | EDIT   | `ProgramDayDTO` + `movementPublicId`; `toProgramDay` maps it (`:18-46`).                                                                                                                                                                                                                            |
| `apps/web/app/p/[profileId]/strength-form-scaffold.ts`                                | EDIT   | `ScaffoldRow` + `movementId` — the next deliberate widening, an **identity**, with its reason beside chunk 2's; `scaffoldMovements` maps it. Extract `declarationOf(row)` (from `declaredUnit`/`declaredMass`) for PR 4 to reuse (Decision 6).                                                      |
| `apps/web/app/p/[profileId]/strength-section.tsx`                                     | EDIT   | The narrowing map (`:84-90`) passes `movementPublicId` as `movementId`; `load` still absent.                                                                                                                                                                                                        |
| `apps/web/app/p/[profileId]/strength-form.tsx`                                        | EDIT   | `MovementVals.movementId?` — **serialized** (`movementsJson`, `:444-474`, spread only when present, "absent stays absent"); `onName` (`:551-558`) clears it. No visible change.                                                                                                                     |
| `packages/db/scripts/verify.ts`                                                       | EDIT   | New block "PICK-1: a movement id resolves only in its namespace" (Test plan).                                                                                                                                                                                                                       |
| `apps/web/lib/dal/entries.test.ts`                                                    | EDIT   | Emitted-SQL proofs via `recording-db.ts`: an id path emits **no** movement `INSERT`; a failed id emits no `INSERT` and no `BEGIN`.                                                                                                                                                                  |
| `apps/web/app/p/[profileId]/actions.test.ts`                                          | EDIT   | The boundary tests (Test plan). **`actions.ts` itself is not edited** (Decision 2).                                                                                                                                                                                                                 |
| `apps/web/app/p/[profileId]/strength-session-schema.test.ts`                          | EDIT   | Schema cases.                                                                                                                                                                                                                                                                                       |
| `apps/web/app/p/[profileId]/strength-form-scaffold.test.ts`, `strength-form.test.tsx` | EDIT   | The id rides a scaffolded card; omitted on a hand-added one; cleared on rename; the no-`load` guard unmodified.                                                                                                                                                                                     |
| `docs/features/strength-logging.md`                                                   | EDIT   | Owns `strength-form.tsx`, `-scaffold.ts`, `strength-session.ts`: invariant 1 gains "a movement **identity** may cross, never a magnitude"; a new invariant "a movement id decides; the name is a label"; the Traps line on `findOrCreateMovementId` says which path still reaches it.               |
| `docs/features/write-path.md`                                                         | EDIT   | Owns `lib/dal/`, `writers/`: the resolve core, its namespace rule, "ids before inserts", and that a dead id **throws** until C4m.                                                                                                                                                                   |
| `docs/features/programming.md`                                                        | EDIT   | Owns `program-day.ts` and `lib/programming/`: the extra selected column and why it is not a magnitude.                                                                                                                                                                                              |
| `docs/roadmap.md`, `docs/status.md`, `docs/changelog/…`                               | EDIT   | Pointer + fragment.                                                                                                                                                                                                                                                                                 |

### PR 3 — the picker, unmounted, `feat/pick-1b-picker-component`

| Path                                                                | Change | What & why                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/movement-search.ts` (+ `.test.ts`)             | NEW    | Decision 4: `foldText`, `foldMovementQuery`, `matchMovementOptions`, `hasALetter`.                                                                                                                                                                    |
| `packages/shared/src/movement-picker-catalog.ts` (+ `.test.ts`)     | NEW    | Decision 3: `MOVEMENT_PICKER_GROUPS` (`as const`) + `movementPickerGroupSchema` + `MOVEMENT_PICKER_GROUP_LABELS` + the per-slug `{ group, aliases }` map + `RECENT_MOVEMENTS_LIMIT`. "Provisional until chunk 0" docblock.                            |
| `packages/shared/src/index.ts`                                      | EDIT   | Export both.                                                                                                                                                                                                                                          |
| `apps/web/lib/movements/movement-option.ts`                         | NEW    | `MovementOptionDTO`, `MovementPickerData` (Decision 5) — beside the feature, not in `lib/dal`, so a client component can import the **type** without touching `server-only`.                                                                          |
| `apps/web/lib/movements/picker-copy.ts`                             | NEW    | `MOVEMENT_PICKER_COPY` — every string above. **Not** `lib/constants.ts`: AUTH-1 1c edits that file (`auth-1-clerk-google.md:1602`, `:1736`), and the copy has one feature (AGENTS.md → constants: "the feature's `lib` module").                      |
| `apps/web/components/movements/movement-picker.tsx` (+ `.test.tsx`) | NEW    | Decision 8, on `Sheet`.                                                                                                                                                                                                                               |
| `docs/features/movement-picker.md`                                  | NEW    | A new guide — the feature now spans `shared` (2 files), `db` (PR 4's query), `lib/dal`, `lib/movements` and `components/movements`, past the "four files across two packages" bar (AGENTS.md → Feature guides). Owns the new files; invariants below. |
| `docs/features/README.md`                                           | EDIT   | List the guide.                                                                                                                                                                                                                                       |
| `docs/roadmap.md`, `docs/status.md`, `docs/changelog/…`             | EDIT   | Pointer + fragment.                                                                                                                                                                                                                                   |

The new guide's invariants (the things that live **between** files):

1. The picker never offers a row `findOrCreateMovement` would not return (global-first, mirrored in
   the list query).
2. No magnitude crosses: `MovementOptionDTO` has no load/reps/sets, enforced by the type.
3. `foldText` is the only text normaliser for typed-name comparison; A3 reuses it, C2 builds on it.
4. Groups and aliases are code, keyed by slug; adding a seeded movement without a group fails a test.
5. The component never writes; the caller's save writes a typed name.
6. Every UI string is in `picker-copy.ts`; the e2e asserts against it.

### PR 4 — mounted, `feat/pick-1c-picker-in-the-form`

| Path                                                                    | Change | What & why                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/queries/movement-options.ts`                           | NEW    | Decision 5's two queries. Owned by the new guide (and listed there, since `queries/` is owned by name, `write-path.md` Files table).                                                                                                                                                                                                                                                                      |
| `packages/db/src/index.ts`                                              | EDIT   | `export * from './queries/movement-options'` (the barrel re-exports by module, `index.ts:13-29`; PR 2's core needs no edit, `movement-catalog` is already `export *`'d at `:29`).                                                                                                                                                                                                                         |
| `apps/web/lib/dal/movements.ts`                                         | NEW    | `listMovementOptions(profilePublicId)` — resolves the scope, both queries in parallel, attaches the picker catalog, returns `MovementPickerData`.                                                                                                                                                                                                                                                         |
| `apps/web/app/p/[profileId]/page.tsx`                                   | EDIT   | `listMovementOptions(profile.id)` joins the existing `Promise.all` (`:85-89`) — one round trip, not a waterfall.                                                                                                                                                                                                                                                                                          |
| `apps/web/app/p/[profileId]/strength-section.tsx`                       | EDIT   | Pass `pickerData` through to `StrengthForm`.                                                                                                                                                                                                                                                                                                                                                              |
| `apps/web/app/p/[profileId]/strength-form.tsx`                          | EDIT   | The Movement button + `MovementPicker` (one instance per form, opened for a card's `clientId`); `onPick` (Decision 6); `created` (transient, never serialized); the `onSubmit` name guard; `prescribedIds` from the scaffold rows.                                                                                                                                                                        |
| `apps/web/app/p/[profileId]/strength-form-scaffold.ts`                  | EDIT   | Only if PR 2's `declarationOf` needs a second caller shape.                                                                                                                                                                                                                                                                                                                                               |
| `apps/web/app/p/[profileId]/strength-form.test.tsx`                     | EDIT   | 15 `nameInput()` uses (`:35`) move to a `chooseMovement` test helper; new cases (Test plan).                                                                                                                                                                                                                                                                                                              |
| `apps/web/e2e/steps.ts`                                                 | EDIT   | `chooseMovement(scope, name, { asTyped? })` — the ONE way specs name a movement.                                                                                                                                                                                                                                                                                                                          |
| `apps/web/e2e/a11y.spec.ts`                                             | EDIT   | `fill()` on the Movement textbox at `:351`, `:467`, `:523`, `:527`, `:534`, `:547` → `chooseMovement`; **the open picker joins the scan** at 360 and 1280 (unowned 8 / spec `CI` row, `:927`); tap targets inside the sheet.                                                                                                                                                                              |
| `apps/web/e2e/export-full-day.spec.ts`                                  | EDIT   | `:151` → `chooseMovement(…, { asTyped: true })` (its probe name must stay unique, `:55`).                                                                                                                                                                                                                                                                                                                 |
| `apps/web/e2e/movement-picker.spec.ts`                                  | NEW    | The picker's own browser test (Test plan).                                                                                                                                                                                                                                                                                                                                                                |
| `apps/web/scripts/screenshot-ephemeral.ts`                              | EDIT   | `:445` (`Plank`) and `:558` (`Pull-up`) type into the old textbox; switch to the picker (`Pull-up` should now be **picked** — it is a catalog row).                                                                                                                                                                                                                                                       |
| `docs/features/strength-logging.md`                                     | EDIT   | The Movement field is a button; the `onSubmit` guard and why not a hidden `required` input; the 360px row arithmetic is unchanged.                                                                                                                                                                                                                                                                        |
| `docs/features/movement-picker.md`                                      | EDIT   | Owns the query and DAL file; adds the `deleted_at` reader note.                                                                                                                                                                                                                                                                                                                                           |
| `docs/features/write-path.md`                                           | EDIT   | `lib/dal/` is owned there: the new read module.                                                                                                                                                                                                                                                                                                                                                           |
| `docs/privacy/data-inventory.md`                                        | EDIT   | §1b's "the only catalog table with a user-reachable writer (the free-text movement-name box)" (`:141-143`) → "…("Use as typed" in the movement picker)"; §1a's `movements` row (`:131`) gains: a household's own movement names are now **listed** to everyone viewing any athlete in the household (they were already readable on the day pages that logged them). No new field, processor or retention. |
| `docs/roadmap.md`, `docs/status.md`, `docs/plan.md`, `docs/changelog/…` | EDIT   | PICK-1 done; PICK-2, C4r and D2 unblocked on it; the pointer; a fragment.                                                                                                                                                                                                                                                                                                                                 |

## Test plan

**PR 1 (U0)** — `sheet.test.tsx`, jsdom:

- Opens as `role="dialog"` with `aria-modal="true"`, named by the title. (structure of 37)
- The `role="status"` element is a **descendant** of the dialog, is mounted on open **before** any
  status text is set, and its text updates when the `status` prop changes (46).
- Escape and Close both call `onOpenChange(false)`; focus returns to the opener (and to
  `returnFocusTo` when passed).
- `initialFocus: 'title'` focuses the title, not an input; a ref focuses that element.
- The body is the only element with `overflow-y-auto`; header and footer are `shrink-0`.
- Contract: the class string contains `min-[600px]:` and `SHEET_FULLSCREEN_BELOW_PX === 600`, so the
  two cannot drift silently.
- `useVisualViewportHeight` writes `--sheet-vvh` from a mocked `visualViewport` and removes its
  listener on close.
- **What PR 1 cannot prove:** the geometry of 37 needs a real layout engine and a consumer; it is
  asserted in PR 4's e2e on the first real sheet, and again by ASSIGN-1 on its own.

**PR 2 (server)** — the AGENTS.md boundary set, tested against the real action as a plain async
function (DAL mocked where the existing suite mocks it):

- **unauth → reject**: no gate access → `NO_PROFILE_LOG`, the DAL not called (the existing suite's
  shape, now with a `movementId` body).
- **wrong owner → as unknown**: `db:verify` "PICK-1": two households; household B's own movement id
  submitted under A's scope → `resolveMovementByPublicId` returns `null`, `logStrengthSession` throws
  the same constant as for a random UUID, and **no** `sessions`, `entries` or `movements` row exists
  afterwards — including for a **typed** sibling movement in the same body (ids-before-inserts). And
  the converse: A's id under A's scope and a global id under either scope resolve.
- **bad body → zod-reject**: `movementId: 'not-a-uuid'` → a named field error; a name with no letter →
  refused; a name with a comma → refused as today.
- **replay → one effect**: the same session `clientId` submitted twice with ids → one session, one
  entry per movement, the same `sessionId` (per-row `ON CONFLICT`, strength-logging invariant 6).
- **The id decides**: body `{ movementId: <Back Squat>, movementName: 'Bench' }` → the entry's
  `movement_id` is Back Squat's and `movement_name` is `Back Squat`.
- **The strip-mode trap**: `actions.test.ts` asserts the DAL **received** `movementId` with its value.
- **No find-or-create on the id path** (criterion 17): `entries.test.ts` on the emitted SQL — an
  id-only session emits no `INSERT INTO movements`.
- **CSV bytes**: `db:verify` logs the same movement once by name (today's path) and once by id and
  asserts `exportMonth` rows are identical apart from their dates.
- Scaffold: `strength-form-scaffold.test.ts` — the id rides; `load` still absent (unmodified test).

**PR 3 (component)** — `movement-search.test.ts`, `movement-picker-catalog.test.ts`,
`movement-picker.test.tsx`:

- `fold`: `Crème` = `creme`; `Farmer’s` = `farmer's`; `Bulgarian Split Squats` = `bulgarian split
squat`; `press` unchanged; `Pull-Ups` = `pull up`; an emoji-only string folds to `''`.
- Matching: word order (`squat split` matches), alias exact-only (`rdl` hits, `rd` does not), the order
  rule, `exact` true for the plural case.
- Catalog: the map's slugs equal `MOVEMENT_SEED_ROWS`' exactly; every group is in
  `MOVEMENT_PICKER_GROUPS`; `other` is empty; aliases are unique and none folds equal to any movement
  name (an alias that **is** another movement's name would be ambiguous).
- Component (criteria 18, 46, 34): Recent before the groups; an empty group renders nothing; the
  prescribed `<details>` is closed by default and absent when `alreadyIn` is given; `alreadyIn` tags
  `already in {label}`; typing updates the in-sheet status once per change; "Use as typed" absent on an
  exact fold match, disabled with the hint for no-letter and comma input; `onPick` gets
  `{kind:'typed', name}` trimmed; a source scan proves the module imports no `'use server'` module.
- Type: `@ts-expect-error` on `MovementOptionDTO['load']`.

**PR 4 (mounted)**:

- `strength-form.test.tsx`: a pick on a blank card leaves every set blank (17); a pick on a
  scaffolded card clears `scaffolded` / `prescriptionId` (Decision 6); re-picking the same id is a
  no-op; "use as typed" serializes `movementName` and no `movementId`; the `onSubmit` guard focuses the
  right card's button and **does not** call the action (the unverified React 19 behaviour — this test
  goes first); the V1-27 summary line agrees with the payload after a pick (`expectSummaryAgrees`).
- `e2e/movement-picker.spec.ts` (Chromium + the mobile project the config defines):
  - **The PICK-1 row's test**, on the seeded athlete, on a day whose program does **not** prescribe
    it: pick "Romanian Deadlift" by typing `rdl`, log one set, then read the day back and the CSV
    export: the existing movement, the typed numbers (17, 19).
  - 360×780: the dialog's box equals the viewport; the header's top is 0 and the footer's bottom is
    780; scrolling the body moves neither (37). 1280×800: width ≤ 520, height ≤ 768.
  - Keyboard only: Tab to the Movement button, Enter opens, focus is on the search (fine pointer), type,
    Tab to an option, Enter picks, focus is back on the button; Escape closes and returns focus (18).
  - `hasTouch` + coarse pointer: on open, `document.activeElement` is not an input (18).
  - Every option's box ≥ 44×44 at 360 (18).
  - The status region inside the dialog reads "2 matches" for `rdl`-style input as the prototype
    verified (46).
- `a11y.spec.ts`: the open picker is scanned (axe) at 360 and 1280, and its tap targets measured.
- `pnpm e2e:local` before opening; `pnpm verify` on every PR.
- **Real-phone checks** (spec `:929-932`; recorded in the PR body, not CI): VoiceOver and TalkBack
  hear the match count while the sheet is open; the keyboard does not rise on open; "Use as typed"
  stays above the iOS keyboard; swipe-back on a full-screen sheet closes it without losing the form;
  landscape; the largest text size.

## Gates, and what to re-verify

- **V1-22 chunk 2 merged** before PR 2 (spec `:151`). Re-read on PR 2's base:
  `sessionMovementSchema`'s field list (chunk 2 adds `prescriptionId`), `MovementVals` and the
  `movementsJson` spread (chunk 2 adds a serialized field there), `onName`'s clear list, and chunk 2's
  `matchPrescribedSnapshot`, which compares `movementSlug(movement.movementName)` against the
  prescription's slug (`v1-22-2-renderer-and-writer.md:279-290`). ⚠️ That match stays correct only
  because PR 2 hands the writer the **database's** name for an id-resolved movement, and
  `movementSlug(name) === slug` holds for every global row (the coverage test,
  `catalog-movements.ts:336-338`) and for every household row (its slug is minted from its name,
  `movement-catalog.ts:63-104`). **C4r breaks the second half** — a rename changes `name`, not `slug`
  — so C4r's plan must switch that comparison to the movement id. Recorded in the new guide.
- **V1-24 3a / 3b** edit the strength surface under the same guide (spec `:155`); serialize with PR 2
  and PR 4 by merge order.
- **AUTH-1.** PICK-1 is **not** gated on 1c and edits no file 1c's table names until PR 4's
  `page.tsx` (`auth-1-clerk-google.md:1708`). If 1c lands first, re-verify: (a) the action's first line
  is the session check, not `hasGateAccess` (`actions.ts:278`), so PR 2's unauth test asserts the new
  call; (b) `getHouseholdScope()`'s body changed but its signature and null/throw contract did not
  (`write-path.md` invariant 2) — `listMovementOptions` relies only on that; (c) the e2e login helper
  (`e2e/login.ts`) and `screenshot:ephemeral` follow 1c-pre's seam; (d) `pages-are-gated.test.ts` — no
  new page or action here, so nothing to add.
- **Chunk 0** does not gate PICK-1: the provisional map ships, and chunk 0 edits it.

## Risks / rollback

| Risk                                                                                             | Mitigation                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A crafted id reaches another household's movement** (BOLA on a new resolver).                  | Global-or-own via the two shared predicates; `db:verify` proves both directions with the real function; an unknown and a foreign id throw the same constant.                                                                                                                                             |
| **A refused body commits a typed sibling's movement row** (a new TEN-2b-1).                      | Ids resolve before any insert; `entries.test.ts` pins the order on the emitted SQL.                                                                                                                                                                                                                      |
| **`movementId` silently stripped** — feature inert, gates green (chunk 2's named trap).          | `actions.test.ts` asserts the DAL received the value.                                                                                                                                                                                                                                                    |
| **The picker raises a near-duplicate anyway** via "use as typed" on a fold-equal name.           | Hidden on an exact fold match; the spec's success signal ("near-duplicate household movements", `:220`) measures what is left; C2 narrows it further.                                                                                                                                                    |
| **A household movement typed by one athlete is listed to the whole household** (privacy).        | Same audience as the day pages that already show it; the inventory says so (PR 4). A name typed into a movement box is the hazard the notice already warns about; the picker does not widen who sees it.                                                                                                 |
| **The form appears dead** — a nameless sendable card with no native block.                       | The `onSubmit` guard (tested first); the server's "Enter a movement." stays the backstop.                                                                                                                                                                                                                |
| **The sheet's footer sits under the iOS keyboard**, so "use as typed" is unreachable mid-search. | `--sheet-vvh` from `visualViewport`; a real-phone check before PR 4 merges; the fallback is moving the button under the search field.                                                                                                                                                                    |
| **LLM authorship**: the group map and aliases were drafted in a model-built prototype.           | They are definitions, not loads; the maintainer approved the prototype; the map is marked provisional and chunk 0 is the human pass that confirms each row.                                                                                                                                              |
| **Export bytes change**.                                                                         | They do not for any name that already resolved: the export groups by `movements.slug` and the id names the same row; `db:verify` asserts identity. `entries.movement_name` now holds the catalog spelling for a pick, which no export column reads (`export-month.ts:60-78` selects no `movement_name`). |
| **A dead id after a future merge** throws to `error.tsx` and loses the form.                     | Unreachable until C4m; the write-path guide and the new guide both say C4m owns the typed refusal.                                                                                                                                                                                                       |

**Rollback.** No migration in any PR, so each reverts cleanly. PR 2 is backward-compatible on the wire
(a page built before it posts names, and the name path is unchanged). Reverting PR 4 restores the text
input while PR 2's server keeps accepting both shapes. **Revert in reverse order:** reverting PR 2
while PR 4 is live makes the server strip `movementId` and resolve every pick by its label — still the
right row for a catalog pick (the label is the catalog name, and `movementSlug(name) === slug`), but
it reopens find-or-create for every pick, which is the behaviour PICK-1 exists to remove.

## Out of scope / deferred

- **PICK-2 (C2)**: near matches, spelling suggestions, edit distance, a word list (criterion 19's second
  and third sentences). PICK-1's `matchMovementOptions` returns a shape C2 extends.
- **MOV-1 rename (C4r)** and **merge (C4m)** — including the hint's "rename it later" sentence and
  the typed dead-id refusal.
- **CAT-2 (C3)** — the drills and the `wrestling` group's rows.
- **Chunk 0's confirmations** of groups and aliases (a later edit to the map).
- **The program editor's Add (D2)** — PICK-1 ships the component; D2 mounts it.
- **Moving find-or-create inside the transaction** (`TEN-2b-1`).
- **Server-side fold before find-or-create** (Decision 4, rejected).
- **A new movement's declared unit or bodyweight flag** — "use as typed" still writes
  `is_bodyweight: false` and no `unit_default`, as `findOrCreateMovement` always has; D8 / unowned 9
  own movement-declared quantities.
- **Cross-request caching** of the catalog.

## Where this plan disagrees with the spec, or a row

1. **"The picker submits an id, not a name"** (contract rules, `:516-519`). The plan submits an id
   **and** a display label; resolution uses the id only. Reason: the action's error labels
   (Decision 1).
2. **`MovementOptionDTO`** (`:499-500`) gains `unitDefault` + `isBodyweight` and loses
   `prescribedToday` (Decisions 5, 6). Additive in substance; the spec's shape would make a pick and a
   scaffold disagree about the unit.
3. **Unowned 2's options** (`:657-659`): "a per-row value in `MOVEMENT_SEED_ROWS` (a column, a
   migration)" — a per-row value needs **no** column, and a column would not reach the existing rows
   through the `ON CONFLICT DO NOTHING` seed (Decision 3).
4. **Criterion 19 is tagged (C2)** but Q2 and this chunk's brief put aliases in PICK-1. The plan
   delivers 19's alias sentence and leaves the rest to C2; the spec's criterion-to-chunk table
   (`:228-229`) should say "19 (C1 alias, C2 rest)".
5. **The prototype's picker is a bottom sheet under 600px**; U0's spec line says full screen. The plan
   uses full screen for both (Decision 7, Open question 1).
6. **The prototype's "use as typed" hint promises a rename** that does not exist until C4r (Decision 8).
7. **FE-12's "cached catalog"** is declined; the payload split is kept (Decision 5).
8. **The PICK-1 row says "a plan comes later, in its own PR"** (`plan.md:216-219`); this plan is
   committed with U0, the first PR it plans, per `docs/plans/README.md`.

## Open questions

1. **Full screen or bottom sheet for the picker below 600px?** The plan says full screen (stable
   height while filtering, the keyboard). The UX panel decides; the change is one prop on `Sheet`.
2. **Recent: how many, and does a skipped movement count?** The plan says 5, and any non-hidden entry
   with a movement (a skip is still "something I do"). The UX panel decides.
3. **Does "Use as typed" need a second tap to confirm** that the name cannot be removed yet? The plan
   says no — the hint says it, and the movement is created only on save, which has its own summary
   line. The trust lens decides.
4. **One PR or two for PRs 3 and 4** — decided by line count when written (Staging).

## Review-response log

_Pending: engineering panel + UX panel (round 1)._
