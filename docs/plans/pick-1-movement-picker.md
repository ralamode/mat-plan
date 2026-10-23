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
> **Settled seams this plan follows** ([spec → "Seams the plans settled (2026-10-23)"](../specs/crud-1-fix-it-yourself.md),
> `crud-1-fix-it-yourself.md:525-552`): `foldName` is PROF-1's (`packages/shared/src/text.ts`,
> `prof-1-athletes.md:329`, `:374`) and PICK-1 imports it; PICK-1 **PR 2** creates `MOVEMENT_NAME_MAX`,
> `movementNameSchema` (`packages/shared/src/movements.ts`) and `hasALetter` (`text.ts`), which MOV-1 and
> V1-22 A4 import; the wire key is **`movementPublicId`** everywhere; **one** resolver by public id,
> taking an `Executor`, which A4 calls; **one** "same movement" key, `movementNameKey`, which MOV-1
> imports; U0's sheet owns the phone back gesture.
>
> Measured against the worktree at `8769c1b` (no `apps/`/`packages/` diff from `origin/main@27847ca`).
> ⚠️ **V1-22 chunk 2 and PROF-1 have not merged** — every `strength-form.tsx` / `strength-session.ts` /
> `text.ts` line cited below must be re-read on the SHA each PR starts from (see
> [Gates](#gates-and-what-to-re-verify)).

## Goal

Make choosing an **existing** movement the easy path on the strength form, and make the server
resolve a chosen movement **by its id**. Today the Movement field is a plain `<input type="text">`
(`apps/web/app/p/[profileId]/strength-form.tsx:812-823`) and every submitted name goes through
`findOrCreateMovementId` (`apps/web/lib/dal/entries.ts:497-502` →
`packages/db/src/writers/movement-catalog.ts:63`), whose slug is only `trim → lowercase → spaces to _`
(`packages/shared/src/movements.ts:34-36`), so "Bulgarian Split Squats" against the catalog's
"Bulgarian Split Squat" is a second row nobody can remove (`plan.md:163-176`).

**What PICK-1 does and does not close** _(narrowed, correctness S2)_: a pick can never mint a row, and
"Use as typed" is withheld whenever the typed text is the **same movement** as an existing one under
`movementNameKey` (case, accents, quotes, punctuation, spacing, a plural or possessive `s`) or is a known
alias. A typed name that is genuinely different ("farmers walk") can still create a household row —
that is the path, and C2 (PICK-2) narrows it with suggestions.

PICK-1 is also the first consumer of the shared modal sheet (U0), which ASSIGN-1, CLONE-1, V1-22 A4 and
the program editor's Add (D2, criterion 34) reuse, so the focus trap, scroll lock, back gesture and
in-sheet status region are written once.

## Acceptance

From the spec (criteria cited by number — the spec is the source):

- **17** _(C1)_ — picking a movement and submitting a set stores an entry that references **that
  movement's id**, with **no** `findOrCreateMovement` call for it, and **no** magnitude arrives
  prefilled. (Also the PICK-1 row's acceptance, `plan.md:183-188`.) _Lands: PR 2 (server), PR 4 (end to
  end)._
- **18** _(C1)_ — recent movements, then the catalog by picker group, today's prescribed movements
  folded away; no on-screen keyboard on open on touch; keyboard-operable; every option ≥44px at 360px.
  ⚠️ Wording: see [disagreement 9](#where-this-plan-disagrees-with-the-spec-or-a-row). _Lands: PR 3
  (component), PR 4 (browser)._
- **19, alias sentence only** — `RDL` offers Romanian Deadlift. _Lands: PR 3 (`matchMovementOptions`
  unit test), PR 4 (e2e)._ Its near-match/spelling sentences stay C2's.
- **34** _(D2's)_ — PICK-1 ships the **same** component D2 mounts, with an "already in" mark and
  caller-supplied save wording, and no write of its own. _Lands: PR 3._
- **37** _(U0's tests; ASSIGN-1's criterion)_ — full screen below 600px with title and actions pinned;
  from 600px a dialog capped at the viewport. _Structure: PR 1 (jsdom). Geometry: PR 4 (the first
  mounted sheet, e2e)._
- **46** _(U0, C1)_ — the match count is announced by a `role="status"` **inside** the sheet. _PR 1
  (structure), PR 4 (browser)._

Concrete "done when":

- The PICK-1 row's two-part test passes on a day whose program does **not** prescribe the movement.
- "Use as typed" is the only path that still reaches find-or-create, and a typed name is refused —
  disabled in the UI (with its reason) **and** by `movementNameSchema` — when it has no letter or has a
  comma or line break. **An id-resolved movement is never refused for its label** (correctness S1).
- A movement id from **another household**, or an unknown one, writes **nothing** — no session, no
  entry, no find-or-create insert for a typed sibling — and the two refusals are byte-identical.
- The phone back gesture closes the open sheet and keeps everything typed on the form.
- `pnpm verify` (incl. `db:verify`, `db:mutations`), `pnpm e2e:local`, `pnpm guides:check` green on
  every PR; screenshots at three widths on PR 4.

## Staging

Four PRs, one concern each, under ~400 source lines. No migration in any.

| PR  | Branch                            | What                                                                                                                                                                                                                                                                                                  | ~Lines (src / tests) | Gate                                                                                                                                                                                                                 |
| --- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `feat/u0-sheet`                   | **U0.** `components/ui/sheet.tsx` on Radix Dialog: layout, history/back gesture, visual-viewport tracking, compact mode, in-sheet status; jsdom tests; files the a11y-scan row (unowned 8). Plus this plan.                                                                                           | 200 / 220            | Nothing (spec: "any time"). No guide owns `components/ui/`; no AUTH-1 chunk names it.                                                                                                                                |
| 2   | `feat/pick-1a-movement-public-id` | **The server takes `movementPublicId`.** `movementNameSchema` + `hasALetter`; `resolveMovementByPublicId` + `resolveSessionMovements` in `packages/db`; the in-transaction re-check; the DAL becomes a pass-through; `db:verify` + two mutation patches; the architecture diagram. No visible change. | 220 / 300            | **V1-22 chunk 2 merged** (same schema, same `movementsJson`, both under `strength-logging.md`) **and PROF-1 step 1 merged** (`foldName` / `text.ts`). Serialized against V1-24 3a/3b on the strength surface.        |
| 3   | `feat/pick-1b-picker-component`   | **The picker, unmounted.** `movementNameKey` / `foldMovementQuery` / `matchMovementOptions`, the picker catalog (groups + aliases), the DTO types, the copy module, `MovementPicker` on U0, the new guide.                                                                                            | 340 / 300            | PR 1 and PROF-1 step 1. **Not** gated on PR 2: no shared file, any merge order.                                                                                                                                      |
| 4   | `feat/pick-1c-picker-in-the-form` | **Mounted.** The two reads (query + DAL), prescribed ids from `program-day.ts`, the form's Movement field becomes the picker button, "Add movement" opens the picker, the Save-line warning, e2e + the a11y scan's open-sheet state, `db:verify` "PICK-1 options" + a mutation patch, screenshots.    | 300 / 360            | PRs 2 and 3. ⚠️ Edits `app/p/[profileId]/page.tsx` (AUTH-1 1c, `auth-1-clerk-google.md:1708`) and `program-day.ts` (programming lane — [overlap](#gates-and-what-to-re-verify)): serialize behind whichever is open. |

**Every PR description** opens with the "Where this sits" block and embeds the CRUD-1 milestone chart
(`docs/milestones/crud-1-fix-it-yourself.md`) with its own step marked (AGENTS.md → Git; architecture
8). The PICK-1 sub-chart:

```mermaid
flowchart LR
  PF[PROF-1 step 1 · foldName] --> P2
  PF --> P3
  V2[V1-22 ch 2] --> P2
  P1[1 · U0 sheet] --> P3[3 · picker component]
  P2[2 · server takes an id] --> P4[4 · picker in the form]
  P3 --> P4
  P4 --> C2[C2 · PICK-2]
  P4 --> C4r[C4r · MOV-1 rename]
  P4 --> D2[D2 · editor Add uses it]
  AU[AUTH-1 1c] -. page.tsx, serial .- P4
```

## Design decisions (each with what was rejected)

### Decision 1 — the wire carries `movementPublicId` and a label; the id alone decides

`sessionMovementSchema` (`packages/shared/src/strength-session.ts:45-83`) gains
`movementPublicId: uuidSchema.optional()` (the settled wire key). When present, the movement is
resolved **by public id** and `movementName` is a **label only**: the writer receives the database's
`movements.name`, never the client's text. When absent, today's typed path runs.

- **The label stays on the wire** because the action names a failing movement by its submitted
  `movementName` (`apps/web/app/p/[profileId]/actions.ts:316-322`), and V1-30's review rejected
  "Movement N" (the index points at the submitted list, which drops untouched cards).
- **The name rules apply only to a typed name** _(correctness S1)_. The field keeps a label shape
  (`trim`, `1..MOVEMENT_NAME_MAX`). The session `superRefine` (`strength-session.ts:129-…`), for each
  movement **without** `movementPublicId`, runs `movementNameSchema` (no comma or line break, at least
  one letter) and re-adds its issues at `['movements', i, 'movementName']` — the path the comma refine
  uses today, so the action's message mapping is unchanged. An id-resolved row is never refused for its
  own name. The object stays a plain `ZodObject` (`strength-session.ts:74-79`).
- **`movementNameSchema` and `MOVEMENT_NAME_MAX` are created here** (`packages/shared/src/movements.ts`;
  `MOVEMENT_NAME_MAX = 100`, today's inline `.max(100)` at `strength-session.ts:57`), with **named**
  messages exported as `MOVEMENT_NAME_MESSAGES` (`missing`, `tooLong`, `commaOrLineBreak`, `noLetter`).
  `hasALetter` (`/\p{L}/u`) joins `hasCommaOrLineBreak` in `text.ts` (`:38`). MOV-1 and A4 import all
  three (seams).
- ⚠️ Behaviour change, deliberate: an emoji- or digit-only **typed** name is now refused (SUX-11); and
  `missing` reads **"Choose a movement."** (was "Enter a movement.", `strength-session.ts:56`), because
  the form no longer has a text box to enter into. Tests asserting the old string change with it.
- **Rejected: xor (`movementPublicId` xor `movementName`).** It costs the error label above; "the id
  decides" gives the same safety, pinned by a test.
- **Rejected: building `ResolvedSessionMovement` by spread** _(security S1)_. Today's DAL does
  `{ ...m, movementId }` (`entries.ts:499-502`), which would now carry `movementPublicId` and the
  client label into the writer's argument. The resolver builds each resolved movement **field by
  field**: `{ clientId, unit, sets, status, supersetClientId, supersetOrder, prescriptionId, movementId,
movementName }`, with `movementName` from the database on the id path. `prescriptionId` is V1-22
  chunk 2's (`v1-22-2-renderer-and-writer.md:189`, `:443`), which relies on today's spread to carry it
  (`:450`). Because every field of `ResolvedSessionMovement` is optional-tolerant, a dropped key still
  typechecks and the snapshot goes inert (the GAP-1 P0-1 lesson, `actions.ts:359-364`). So the builder
  returns `{ [K in keyof ResolvedSessionMovement]-?: ResolvedSessionMovement[K] | undefined }`, writing
  `undefined` explicitly: a key added to the type later is a compile error here, not a silent drop
  _(correctness round 2, B1)_.

### Decision 2 — resolution, and its ordering, live in `packages/db`, checked twice

_(Security B1, correctness B2.)_ Two functions in `packages/db/src/writers/movement-catalog.ts`, beside
`findOrCreateMovement` (`:63`):

- `resolveMovementByPublicId(exec: Executor, scope, publicId)` → `{ id, name, slug } | null` — the
  **one** resolver by public id (seams; A4 calls it). Matches only `movementIsGlobal()` **or**
  `movementInHousehold(scope)` (`packages/db/src/writers/ownership.ts:166-179`, the sanctioned
  predicates; `scope.householdId` stays read in one place, write-path invariant 2). It deliberately
  **accepts** a household row whose slug a global row shadows — it is the household's own row, and the
  list simply never offers it (correctness S3).
- `resolveSessionMovements(exec, scope, movements)` → the explicit resolved list. **Phase 1:** every
  `movementPublicId` through the resolver; any `null` throws `MovementNotAvailableError` whose message
  is the constant `MOVEMENT_NOT_AVAILABLE` (`'Movement not available'`) — **no** id, **no** name
  (`movement-catalog.ts:55-59`: a thrown value reaches Sentry verbatim) — so an unknown and a foreign
  id are byte-identical. **Phase 2,** only after phase 1 succeeds: `findOrCreateMovement` for the typed
  ones. A refused body therefore commits no typed sibling — the TEN-2b-1 residual
  (`entries.ts:486-491`) gains no new instance.
- **And inside the transaction** _(security B1 — the TOCTOU)_: `writeStrengthSession`
  (`packages/db/src/writers/strength-session.ts`) re-checks, after its in-transaction profile resolve,
  that every `movementId` it is about to write is global-or-own under the **same** scope — one
  `SELECT count(*)` over the distinct ids with the same two predicates — and throws the same
  `MovementNotAvailableError` otherwise, rolling the whole graph back. Phase 1 is a fast pre-check; the
  in-transaction check is the seam, the way the profile resolve already is (strength-logging guide,
  "`writeStrengthSession`'s in-transaction profile resolve").
- `apps/web/lib/dal/entries.ts` `logStrengthSession` (`:479-513`) becomes: scope → activity type →
  `resolveSessionMovements(db, scope, args.movements)` → `writeStrengthSession`. `findOrCreateMovementId`
  in `lib/dal/catalog.ts:105` loses its last caller and is deleted in the same PR (the `scoped.test.ts`
  dead-entry rule's spirit; it carries no allowlist entry today).
- **A refused id throws; it is not a typed envelope.** No screen can produce one (the picker offers only
  rows the read returned; movements are never deleted; no merge exists). AGENTS.md: "unexpected → throw".
  **C4m makes a dead id reachable** and owns turning it into a typed refusal — recorded in both guides.
  This also keeps `actions.ts` untouched (it collides with AUTH-1 1c and WP-1's shard): the new field
  rides `parsed.data.movements` (`actions.ts:353-375`), and an `actions.test.ts` case asserts the DAL
  **received** the value — chunk 2's strip-mode trap (`v1-22-2-renderer-and-writer.md:228-234`).
- **Rejected: resolution in `lib/dal`.** `db:verify` cannot import `server-only` code, and the
  cross-household refusal must be proved by running the real function (write-path invariant 3).

### Decision 3 — groups and aliases live in shared code, keyed by slug; the list shows only seeded globals

`packages/shared/src/movement-picker-catalog.ts`: `MOVEMENT_PICKER_GROUPS` (`as const`, the spec's
contract name, `crud-1-fix-it-yourself.md:490`) + `movementPickerGroupSchema` +
`MOVEMENT_PICKER_GROUP_LABELS` + a per-**slug** map `{ group, aliases }` over `MOVEMENT_SEED_ROWS` +
`RECENT_MOVEMENTS_LIMIT` (5).

- **Why not a column** (unowned 2's first option): the seed is `ON CONFLICT DO NOTHING`
  (`packages/db/src/seed.ts:249-252`), so a new column's seed values would never reach the 35 rows
  already in production without a backfill — for display metadata nothing edits.
- **Why not group by `pattern`**: `isolation`'s six rows split three ways (unowned 2), so it needs
  per-row overrides anyway.
- **A global row is listed only if its slug is in the map** _(correctness S5, security N1)_. Every
  global row already carries a curated `pattern` by the **validated** CHECK
  `movements_global_row_has_pattern` (`packages/db/src/schema.ts:571-582`, validated by `TEN-2d`'s
  0018), and a unit test pins the map's keys to exactly `MOVEMENT_SEED_ROWS`' slugs, so CAT-2 cannot add
  a row without choosing its group. A global row outside the map is not listed (it still resolves by id
  and by typed name). There is therefore **no `other` group** — empty by construction rather than by a
  test.
- **What ships before chunk 0**: the prototype's grouping, approved with v8/v9 (`index.html:1180-1232`)
  — Push 7, Pull 7, Legs 14, Core 7 over the 35 rows, `wrestling` declared and empty until C3. Judgement
  calls chunk 0 confirms: Farmer Carry and Med-Ball Slam → Core; Sled Push, KB Swings, Box Jump, Broad
  Jump, Calf Raises → Legs; the isolation split as the spec lists it. And the prototype's six aliases
  (`index.html:1235-1242`): `RDL`, `BSS`, `OHP`, `DB bench`, `KB`, `hip thrust`. Definitions, not
  loads; the docblock says "provisional until chunk 0" and names the maintainer's pass as the
  confirmation. Chunk 0 then edits a TypeScript map — no migration.

### Decision 4 — `movementNameKey`: one "same movement" key on top of `foldName`

`packages/shared/src/movement-search.ts` imports `foldName` (PROF-1, `text.ts`; accents, curly quotes,
spaces, case — `prof-1-athletes.md:329`) and adds only what is movement-specific _(reuse B1,
architecture 1)_:

- `foldMovementQuery(s)` — `foldName(s)`; every non-`\p{L}\p{N}` → space; drop a **lone** `s` word (the
  possessive, `farmer's` → `farmer s` → `farmer`); strip one trailing `s` from a word of **2+ letters
  before it** that does not end in `ss` (`ups` → `up`, `squats` → `squat`, `press` stays); collapse.
- `movementNameKey(s)` — `foldMovementQuery(s)` with the spaces removed (`pull ups`, `pullups`,
  `Pull-Ups` → `pullup`). **The** "same movement" key (seams): the picker's `exact`, MOV-1's rename
  collision (`mov-1-rename-movement.md:83-85`, `:139`, `:359` cite the earlier `foldMovementQuery`
  names; MOV-1 imports `movementNameKey`).
- `matchMovementOptions(options, query)` (pure) → `{ matches, someWords, aliasHit, exact }`:
  - an option **matches** when every query word is a substring of its folded name, **or** the query's
    compact form is a substring of the name's compact form (`trapbar` → Trap-Bar Deadlift, `medball` →
    Med-Ball Slam) _(UX3 B1, UX1 4, correctness S2)_;
  - `aliasHit` when the query's key equals an alias's key (exact only — `rd` does not hit);
  - `exact` when the query's key equals some option's key;
  - `someWords` — only when `matches` is empty: options matching **any** query word of 3+ letters
    _(UX3 6)_;
  - order: alias hit, exact, prefix, the rest by name; ties catalog-first. Deterministic, tested.
- **"Use as typed" is withheld when `exact` or `aliasHit`** _(UX3 B2, UX1 3)_. `rdl` must not mint a
  household "rdl".
- **Test vectors** (the table the test iterates):

  | Query                    | Matches                      | `exact` | Use as typed |
  | ------------------------ | ---------------------------- | ------- | ------------ |
  | `pull ups`               | Pull-Up                      | yes     | withheld     |
  | `pullups`                | Pull-Up                      | yes     | withheld     |
  | `pushups`                | Push-Ups                     | yes     | withheld     |
  | `push-up`                | Push-Ups                     | yes     | withheld     |
  | `push up`                | Push-Ups                     | yes     | withheld     |
  | `Farmer's carry`         | Farmer Carry                 | yes     | withheld     |
  | `farmers walk`           | — (some words: Farmer Carry) | no      | offered      |
  | `trapbar`                | Trap-Bar Deadlift            | no      | offered      |
  | `medball`                | Med-Ball Slam                | no      | offered      |
  | `rdl`                    | Romanian Deadlift (alias)    | no      | withheld     |
  | `bulgarian split squats` | Bulgarian Split Squat        | yes     | withheld     |
  | `press`                  | every "…Press"               | no      | offered      |

- **Rejected: the same fold on the server before find-or-create** — an auto-correct PICK-2's row forbids
  (`plan.md:226-230`), and it would change `findOrCreateMovement`'s pinned contract.

### Decision 5 — the reads: the household's list, and the athlete's recent, separately

_(Architecture 4.)_ `packages/db/src/queries/movement-options.ts`:

- `householdMovementOptions(db, scope)` — global rows **whose slug is in the picker map**, plus this
  household's rows that (i) no global slug shadows (the resolver's global-first precedence,
  `movement-catalog.ts:12-24`) and (ii) are **referenced by a live entry or a live prescription** in
  this household _(UX3 5, option (a))_: `EXISTS` over `entries` (`deleted_at IS NULL`,
  `idx_entries_movement`, `schema.ts:250`) or `prescriptions` (`deleted_at IS NULL`,
  `idx_prescriptions_movement`, `:835`). So a typo'd row nobody uses drops out of the list, and once
  V1-9b ships, **hiding the only entry that used it is the recovery** — no correction needed. Until
  V1-9b, a mis-typed row with one entry stays listed; the recovery is MOV-1 rename (C4r) or a
  correction. **Rejected: option (b), a correction row** — it treats each typo as an operator task
  forever, where (a) makes the app's own delete the fix.
- `recentMovementIds(db, { profilePublicId, scope, limit })` — distinct `entries.movement_id` for this
  profile (`isLiveProfile`, `ownership.ts:118`), `entries.deleted_at IS NULL`, movement global-or-own,
  newest `activity_date` then `entries.id` first. A **new reader of `entries.deleted_at`** — listed for
  B1's reader audit (spec Risks, `:901`).

`apps/web/lib/dal/movements.ts` (`server-only`), two functions:

- `listMovementOptions()` — `getHouseholdScope()`, the household list + the picker map → options.
- `listRecentMovementIds(profilePublicId)` — the recent ids, **intersected with** the listed options'
  ids (correctness S3), so Recent never shows a row the list would not.

`recentIds` is **optional** on the picker: D4c's editor at `/programs/new` has no athlete
(architecture 4). Both functions resolve their own scope (write-path invariant 2); `scoped.test.ts`
covers them with no allowlist entry.

- **Rejected: caching the catalog across requests** (FE-12): the household's rows are in the same list
  and AGENTS.md forbids per-user caching across users; it would save one indexed query over ≤110 rows.
  FE-12's intent is kept: the list, the recent ids and the prescribed ids are separate props, and
  filtering runs under `useDeferredValue`.

```ts
// apps/web/lib/movements/movement-option.ts — reuse N1: a discriminated union
type Declaration = { unitDefault: Unit | null; isBodyweight: boolean }; // the MOVEMENT's, never a magnitude
export type MovementOptionDTO = { publicId: string; name: string } & Declaration &
  (
    | { owner: 'catalog'; group: MovementPickerGroup; aliases: readonly string[] }
    | { owner: 'household' }
  );
export type MovementPickerData = {
  options: readonly MovementOptionDTO[];
  recentIds?: readonly string[]; // ⊆ options' publicIds; absent where there is no athlete (D4c)
};
```

This is the spec's `MovementOptionDTO` as the seams amended it (`crud-1-fix-it-yourself.md:548-552`):
no `prescribedToday`, plus `unitDefault` and `isBodyweight`.

### Decision 6 — a pick seeds the movement's declaration, never a number

Picking sets `movementPublicId`, `movementName` (the option's name) and the scaffold's transient hints
(`declaredLoaded`, `declaredDimension`, the unit), computed by **one** `declarationOf()` extracted in
**PR 4** from `strength-form-scaffold.ts` (`declaredUnit` / `declaredMass`, `:71-100`) _(scope N4)_. The
unit goes through `setDimensionUnit` (`strength-form.tsx:353-386`) so a cross-dimension pick clears the
load modes in the same update (strength-logging invariant 4b). Reps and weights are untouched.

- `MovementOptionDTO` has no `load`/`reps`/`sets`, pinned by `@ts-expect-error` (strength-logging
  invariant 1).
- A pick that changes the movement clears `scaffolded` and chunk 2's `prescriptionId` (its "rename
  clears it" rule, `v1-22-2-renderer-and-writer.md:210-215`, now in the pick handler). Re-picking the
  same movement is a no-op.
- "Use as typed" sets `movementName` to the trimmed text, clears `movementPublicId` and every
  declaration, and sets transient `created: true`.
- **The scaffold does not send ids** _(scope S1)_. Scaffolded cards keep resolving by name
  (global-first — correct for every seeded prescription). Handing the scaffold ids is deferred to
  C4r/MOV-1, the first change that can make a scaffolded name stop slugging to its row.

### Decision 7 — U0: Radix Dialog from the installed package; full screen below 600px; owns the back gesture

`apps/web/package.json:38` already depends on `radix-ui` `^1.8.1`, whose installed umbrella pins
`@radix-ui/react-dialog` `1.3.1` (in `pnpm-lock.yaml:1722`); `components/ui/button.tsx:3` imports
`Slot` from it. **No new dependency**, no lockfile change, no supply-chain item.

Radix gives the focus trap, `aria-modal`, `aria-labelledby` from `Dialog.Title`, Escape, scroll lock and
`aria-hidden` outside (why criterion 46's region must be inside).

```tsx
// apps/web/components/ui/sheet.tsx — the shape
type SheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string; // Dialog.Title (h2), tabIndex -1, outline-none, min-w-0 flex-1 break-words
  description?: string; // omitted → aria-describedby={undefined}
  status?: string; // criterion 46: role=status <p>, mounted WITH the sheet, sr-only
  headerExtra?: ReactNode; // pinned under the title (the picker's search)
  footer?: ReactNode; // pinned; flex-wrap; padded by env(safe-area-inset-bottom)
  initialFocus?: 'title' | RefObject<HTMLElement | null>;
  returnFocusTo: RefObject<HTMLElement | null>; // REQUIRED — see below
  children: ReactNode; // the ONLY scrolling region
};
```

- **Layout.** `Dialog.Content` below 600px: `fixed inset-x-0 flex flex-col`, `top: var(--sheet-vvt, 0)`,
  `height: var(--sheet-vvh, 100dvh)` — anchored to the **visual** viewport's top _(UX2 S4)_. From
  `min-[600px]:` a centred dialog, `w-[min(520px,calc(100vw-32px))]`,
  `max-h-[calc(var(--sheet-vvh,100dvh)-32px)]`. Header/footer `shrink-0`; body `min-h-0 flex-1
overflow-y-auto overscroll-contain`. The `600px` literal lives in one class string (no exported
  constant, _scope N3_); Tailwind needs it literal.
- **Full screen below 600px, for the picker too — answers Open question 1.** The prototype draws the
  picker as a bottom sheet (`index.html:994-1001`); the spec's U0 says full screen (`:150`). Full screen
  stands now that the back gesture is owned (below): a content-height bottom sheet changes height per
  keystroke, and its top edge lands under the iOS suggestion bar. Recorded as a departure from the
  prototype (disagreement 5).
- **The back gesture** _(UX1 B1, UX2 B2; seams)_. On open, `history.pushState({ sheet: id }, '')`; a
  `popstate` while open closes it **without** a second `back()`; a normal close (Close, Escape, a pick)
  calls `history.back()` once to drop the entry; where `CloseWatcher` exists it is used instead of the
  `popstate` listener (Android's back button). A `closingViaHistory` ref guards the double pop. The form
  under the sheet is never navigated, so typed reps survive (e2e `page.goBack()`). Next's router ignores
  a same-URL `pushState` with foreign state — **unverified on Next 16.4**; the e2e is the proof, and
  `node_modules/next/dist/docs/` is read before writing it (`apps/web/AGENTS.md`).
- **Keyboard-up geometry** _(UX2 B1, UX1 5)_. A ~30-line `useVisualViewport` (active only while open)
  writes `--sheet-vvh` (height) and `--sheet-vvt` (`offsetTop`), listening to `resize` **and**
  `scroll`, and sets `data-compact` on the content when the visual viewport is short (keyboard up, or
  landscape: `visualViewport.height < 480`). Compact: the header drops its padding, the footer's hint
  clamps to one line. **Not** a `max-height` media query: the layout viewport does not shrink when the
  iOS keyboard opens, so a media query never fires. Fallback without the API: `100dvh`, not compact.
  This is a real-phone check (spec `:929-932`).
- **No keyboard on open on touch (criterion 18).** `initialFocus` defaults to `'title'`; the picker
  passes its search ref only when `matchMedia('(pointer: coarse)')` is false (Radix `onOpenAutoFocus` +
  `preventDefault`).
- **`returnFocusTo` is required** _(UX2; scope S2 kept because the Safari point holds; architecture 7)_:
  Safari does not focus a `<button>` on click, so Radix's "the element focused before open" is `<body>`
  there. The caller names the element; the picker passes that card's Movement button.
- **Safe area.** The footer pads `env(safe-area-inset-bottom)`; the header pads
  `env(safe-area-inset-top)` below 600px (full screen covers the notch).
- **Name.** Kept `components/ui/sheet.tsx`, as the seams table and sibling plans cite it
  (architecture's `modal-sheet.tsx` suggestion declined on that ground). The hazard is that
  `shadcn add sheet` would overwrite it with a side drawer: the file's header says so (as
  `button.tsx:7-17` does), and `sheet.test.tsx`'s status-inside and history cases fail on any
  regenerated file.
- **Rejected: native `<dialog>`** (the prototype's) — its own scroll lock and focus return
  (`index.html:1757-1776`), and AGENTS.md → Stack is Radix/shadcn. **Rejected: shadcn's `sheet`** — a
  side drawer. **Rejected: a route** — the picker returns a value into unsaved client state.

### Decision 8 — the picker: reusable, never writes

`apps/web/components/movements/movement-picker.tsx` (`'use client'`), outside `app/p/[profileId]/` so
D2's editor imports the same component (criterion 34):

```ts
type MovementPickerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string; // "Choose a movement" | D2: "Add a movement to {workout label}"
  data: MovementPickerData;
  todaysProgram?: { ids: readonly string[]; onForm: ReadonlySet<string> }; // see below
  alreadyIn?: { ids: ReadonlySet<string>; label: string }; // D2
  currentId?: string; // marks the card's current movement
  createdWhen: 'set' | 'program';
  returnFocusTo: RefObject<HTMLElement | null>;
  onPick: (
    p: { kind: 'existing'; option: MovementOptionDTO } | { kind: 'typed'; name: string },
  ) => void;
};
```

It imports no Server Action and no `app/` module (a source-scan test), so it cannot write; a typed name
is written by the caller's save (the set's, later the program's — criterion 34).

**What it renders** (prototype `drawPicker`, minus PICK-2's "Did you mean"); every string from
`MOVEMENT_PICKER_COPY` _(reuse S4)_:

- **Header** (pinned): title + Close; a labelled `type="search"` (`maxLength={MOVEMENT_NAME_MAX}`,
  autocomplete/autocorrect/autocapitalize off, `enterKeyHint="search"`), `aria-describedby` the status.
  The query **resets on every open** (UX NIT).
- **Empty query:** **Recent** (omitted without `recentIds` or when empty) → **Today's program** →
  each group in `MOVEMENT_PICKER_GROUPS` order (empty groups omitted) → **Your household** (omitted when
  empty).
  - **Today's program** _(UX1 2)_ is computed from what is **on the form**: `todaysProgram.ids` are the
    prescribed movements (from `program-day.ts`, PR 4); `onForm` is the set already on a card (by id for
    a picked card, by `movementNameKey` for a scaffolded or typed one). A `<details>` that is **open**
    when any prescribed movement is not on a card, closed with "(already on your form)" when all are,
    absent without `todaysProgram` or with `alreadyIn` (D2).
- **A query:** **Matches**; if none, **Matches some of your words** (`someWords`); if none, the browse
  list under a "No matches" status.
- **One tag per row, by precedence** _(UX2 S2; UX3 4; UX1 8)_: `already in {label}` > `also called
{ALIAS}` > `current` > the **group label** for a catalog row in search results ("Legs") >
  `household` for a household row. The tag may wrap under the name. (The brief's "in the app" /
  "added by you" are replaced on the UX panel's finding — disagreement 10.)
- **Status:** `n matches` / `1 match` / `No matches.`, plus — when "Use as typed" is unavailable — its
  reason (`Already in the list as Pull-Up.`), written only when changed _(UX2 S6)_.
- **Footer** (pinned; only for a non-empty query that is not `exact`/`aliasHit`): **Use "{typed}" as
  typed**. With matches above it, a quieter control (ghost, still `min-h-11`) and a one-line hint; with
  none, the outline button and the full hint _(UX2 B1)_. `whitespace-normal h-auto break-words`
  (`button.tsx:19` is `whitespace-nowrap`). Unusable input (no letter, comma, line break) keeps it
  **`aria-disabled`** and focusable with the reason in the hint, the message from
  `MOVEMENT_NAME_MESSAGES` (reuse S4). Hint copy _(UX3 4)_: **"Adds "{name}" to the list for everyone in
  your household. It can't be deleted, so check the spelling."** — no "rename later" until C4r (MOV-1
  edits it).
- **Enter** in the search picks only when unambiguous (exactly one match, or an alias/exact hit) and
  **never** triggers "Use as typed" (UX3 N8).
- **Semantics:** `<section aria-labelledby>` + `<h3>` + `<ul>` of `<li><button type="button">`; no
  `listbox`/`option`; every option `min-h-12`, `focus-visible` ring; the current movement carries
  `aria-current="true"`.

**Width at 360px** (full screen): body `px-4` → 328px; option `px-3` → 304px; a group tag (`text-xs
px-2` + border, "Legs" ≈ 26px) ≈ 46px; longest tag "already in Strength A" ≈ 130px **wraps under the
name** rather than squeezing it. Longest seeded name "Overhead Shoulder Press" ≈ 196px at `text-base`,
one line beside a group tag (304 − 46 − 8 = 250px); longer names wrap (`min-w-0 break-words`), never
truncate. Header: the title is `min-w-0 flex-1 break-words`, Close `shrink-0` (≈ 64px), so a 40-character
D2 title wraps instead of pushing Close off (UX2 S3).

**The Movement field on the card** _(UX2 S1)_: the `<input>` at `strength-form.tsx:808-824` becomes a
`button type="button"` on **its own line** above the Measuring/Unit row — `min-h-11 h-auto w-full
text-left break-words` with `INPUT_CLASS`'s border/focus (`lib/constants.ts:287-288`),
`aria-haspopup="dialog"`, `aria-labelledby` = the "Movement" label + the value span ("Movement, Back
Squat" / "Movement, Choose a movement"). A long household name wraps inside it. Under it, while
`created`, the permanence hint survives until Save: **"New movement — saved for your household when you
log. It can't be deleted."**

**"Add movement"** _(UX1 6)_ opens the picker and **appends** a card on pick (none on cancel); focus moves
to the new card's first reps input. The initial blank card stays.

**By Save** _(UX3 3, answers Q3)_: when any card is `created`, a line joins the summary — **"Saving adds 1
new movement: "pullups". Check the spelling."** (plural form for several) — and its id joins Save's
`aria-describedby` (`strength-form.tsx:641-647`). No confirm dialog.

**The native-submit gap.** `required` on the input (`:817`) blocked a sendable card with no name; a
button is barred from constraint validation. The form gains `onSubmit`: when `firstBlocker` is a name
blocker (`strength-form-untouched.ts`), `preventDefault()`, focus that card's Movement button, show
`MOVEMENT_NAME_MESSAGES.missing` beside it via `aria-describedby` (A11Y-2; no `role=alert` racing focus).
⚠️ **Unverified:** that React 19's `<form action>` skips the action on `preventDefault()`; PR 4's first
test proves it. **Fallback, stated** _(scope N6)_: if it does not hold, the server's refusal ("Movement
1: Choose a movement.") stays the backstop, the plan returns to the panel, and the focus move is lost.
**Rejected:** a hidden `required` mirror input — the "silently dead form" trap (strength-logging Traps).

## File-by-file changes

### PR 1 — U0, `feat/u0-sheet`

| Path                                    | Change | What & why                                                                                                                                                                       |
| --------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/components/ui/sheet.tsx`      | NEW    | Decision 7: `Sheet`, `useVisualViewport`, the history hook. Header docblock: why Radix, full screen, status inside, back gesture, compact mode, "do not regenerate from shadcn". |
| `apps/web/components/ui/sheet.test.tsx` | NEW    | jsdom; Test plan.                                                                                                                                                                |
| `docs/plans/pick-1-movement-picker.md`  | NEW    | This plan and its review-response log.                                                                                                                                           |
| `docs/plan.md`                          | EDIT   | PICK-1 links this plan; **files unowned 8 as a row** (the a11y scan opens no dialog; tap targets measure height only) — spec `:690-694`, `:927`.                                 |
| `docs/roadmap.md`, `docs/status.md`     | EDIT   | U0 in flight / shipped.                                                                                                                                                          |
| `docs/changelog/<fragment>.md`          | NEW    | One fragment.                                                                                                                                                                    |

No guide owns `components/ui/`. No privacy change.

### PR 2 — the server takes an id, `feat/pick-1a-movement-public-id`

| Path                                                                         | Change | What & why                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/text.ts`                                                | EDIT   | `hasALetter` beside `hasCommaOrLineBreak` (`:38`).                                                                                                                                                                   |
| `packages/shared/src/movements.ts`                                           | EDIT   | `MOVEMENT_NAME_MAX`, `MOVEMENT_NAME_MESSAGES`, `movementNameSchema` (seams).                                                                                                                                         |
| `packages/shared/src/strength-session.ts`                                    | EDIT   | `movementPublicId: uuidSchema.optional()`; `movementName` → label shape; the typed-name rules in the session `superRefine` (Decision 1).                                                                             |
| `packages/db/src/writers/movement-catalog.ts`                                | EDIT   | `resolveMovementByPublicId`, `resolveSessionMovements`, `MovementNotAvailableError`, `MOVEMENT_NOT_AVAILABLE` (Decision 2). Already `export *`'d by `packages/db/src/index.ts:29`.                                   |
| `packages/db/src/writers/strength-session.ts`                                | EDIT   | The in-transaction global-or-own re-check of every `movementId` (Decision 2).                                                                                                                                        |
| `apps/web/lib/dal/entries.ts`                                                | EDIT   | `logStrengthSession` calls `resolveSessionMovements`; docblock's TEN-2b-1 note updated.                                                                                                                              |
| `apps/web/lib/dal/catalog.ts`                                                | EDIT   | Delete `findOrCreateMovementId` (`:105-107`), now uncalled; its docblock's history moves to the core's.                                                                                                              |
| `packages/db/scripts/verify.ts`                                              | EDIT   | "PICK-1: a movement id resolves only in its namespace" (Test plan).                                                                                                                                                  |
| `packages/db/scripts/mutations/NN-resolver-ignores-household.{patch,expect}` | NEW    | Drops the `movementInHousehold` conjunct from the resolver (widens to any owned row) → the foreign-id case goes red.                                                                                                 |
| `packages/db/scripts/mutations/NN-typed-before-ids.{patch,expect}`           | NEW    | Swaps the two phases → "a refused id commits no typed sibling" goes red. (`NN` = the next free numbers at merge; `README.md:120-123` procedure.)                                                                     |
| `packages/db/scripts/mutations/NN-drop-in-tx-recheck.{patch,expect}`         | NEW    | Removes `writeStrengthSession`'s in-transaction global-or-own `count(*)` → case (d) goes red _(correctness round 2, S2)_.                                                                                            |
| `apps/web/lib/dal/entries.test.ts`                                           | EDIT   | Emitted-SQL order test (Test plan).                                                                                                                                                                                  |
| `apps/web/app/p/[profileId]/actions.test.ts`                                 | EDIT   | Boundary tests. **`actions.ts` not edited.**                                                                                                                                                                         |
| `apps/web/app/p/[profileId]/strength-session-schema.test.ts`                 | EDIT   | Schema cases.                                                                                                                                                                                                        |
| `docs/architecture.md`                                                       | EDIT   | §2 "Write path": the id-path flowchart (resolve ids → typed find-or-create → tx with the re-check) _(architecture 6)_; embedded in PR 2's description.                                                               |
| `docs/features/strength-logging.md`                                          | EDIT   | Owns `strength-session.ts`, the writer: "the id decides; the name is a label"; the in-tx re-check; which path still reaches find-or-create.                                                                          |
| `docs/features/write-path.md`                                                | EDIT   | Owns `lib/dal/`, `writers/`: the resolver, ids-before-inserts, the TOCTOU re-check, "a dead id throws until C4m"; the stale `23505` sentence in its Files row (`write-path.md` `movement-catalog.ts` row) corrected. |
| `docs/roadmap.md`, `docs/status.md`, `docs/changelog/…`                      | EDIT   | Pointer + fragment.                                                                                                                                                                                                  |

### PR 3 — the picker, unmounted, `feat/pick-1b-picker-component`

| Path                                                                | Change | What & why                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/movement-search.ts` (+ `.test.ts`)             | NEW    | Decision 4, importing `foldName`.                                                                                                                                                                                                                          |
| `packages/shared/src/movement-picker-catalog.ts` (+ `.test.ts`)     | NEW    | Decision 3.                                                                                                                                                                                                                                                |
| `packages/shared/src/index.ts`                                      | EDIT   | Export both.                                                                                                                                                                                                                                               |
| `apps/web/lib/movements/movement-option.ts`                         | NEW    | The DTO types (Decision 5) — importable by a client component without `server-only`.                                                                                                                                                                       |
| `apps/web/lib/movements/movement-picker-copy.ts`                    | NEW    | `MOVEMENT_PICKER_COPY`: **every** picker, card-hint, Save-line and guard string _(reuse S4; architecture)_. Not `lib/constants.ts` (AUTH-1 1c edits it). ⚠️ MOV-1 cites `movement-copy.ts` (`mov-1-rename-movement.md:337`); one of the two plans renames. |
| `apps/web/components/movements/movement-picker.tsx` (+ `.test.tsx`) | NEW    | Decision 8, on `Sheet`.                                                                                                                                                                                                                                    |
| `docs/features/movement-picker.md`                                  | NEW    | Owns the five new files above and (PR 4) `packages/db/src/queries/movement-options.ts`. **Links** `lib/dal/movements.ts`, which `write-path.md` owns (`lib/dal/`) _(scope S3)_.                                                                            |
| `docs/features/README.md`                                           | EDIT   | List the guide.                                                                                                                                                                                                                                            |
| `docs/roadmap.md`, `docs/status.md`, `docs/changelog/…`             | EDIT   | Pointer + fragment.                                                                                                                                                                                                                                        |

The guide's invariants: (1) the list never offers a row `findOrCreateMovement` would not return; (2) no
magnitude crosses (the type); (3) `movementNameKey` is the one "same movement" rule — MOV-1 imports it;
(4) groups/aliases are code keyed by slug; a seeded row without a group fails a test; (5) the component
never writes; (6) a dead id throws until C4m; (7) after C4r renames a row, chunk 2's slug match must
compare ids (Gates).

### PR 4 — mounted, `feat/pick-1c-picker-in-the-form`

| Path                                                                         | Change | What & why                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/queries/movement-options.ts`                                | NEW    | Decision 5's two queries.                                                                                                                                                                                                                                                                                              |
| `packages/db/src/index.ts`                                                   | EDIT   | `export * from './queries/movement-options'` (the barrel's pattern, `:13-29`).                                                                                                                                                                                                                                         |
| `apps/web/lib/dal/movements.ts`                                              | NEW    | `listMovementOptions()`, `listRecentMovementIds(profilePublicId)`.                                                                                                                                                                                                                                                     |
| `packages/db/src/queries/program-day.ts`                                     | EDIT   | Select `movementPublicId` (no new join) — for `todaysProgram.ids` only; **not** carried onto `ScaffoldRow` (Decision 6).                                                                                                                                                                                               |
| `apps/web/lib/programming/program-day.ts`                                    | EDIT   | `ProgramDayDTO.movementPublicId` (`:18-46`).                                                                                                                                                                                                                                                                           |
| `apps/web/app/p/[profileId]/page.tsx`                                        | EDIT   | Both reads join the `Promise.all` (`:85-89`).                                                                                                                                                                                                                                                                          |
| `apps/web/app/p/[profileId]/strength-section.tsx`                            | EDIT   | Pass picker data and the prescribed ids; the scaffold map (`:84-90`) unchanged.                                                                                                                                                                                                                                        |
| `apps/web/app/p/[profileId]/strength-form-scaffold.ts`                       | EDIT   | Extract `declarationOf()` (Decision 6).                                                                                                                                                                                                                                                                                |
| `apps/web/app/p/[profileId]/strength-form.tsx`                               | EDIT   | The Movement button; one `MovementPicker` per form; `onPick`; `created`; "Add movement" via the picker; the Save line; the `onSubmit` guard; `movementPublicId` serialized when present (`movementsJson`, `:444-474`), "absent stays absent".                                                                          |
| `apps/web/app/p/[profileId]/strength-form.test.tsx`                          | EDIT   | 15 `nameInput()` uses (`:35`) → a `chooseMovement` helper; new cases.                                                                                                                                                                                                                                                  |
| `apps/web/e2e/steps.ts`                                                      | EDIT   | `chooseMovement(scope, name, { asTyped? })` — the one way a spec names a movement.                                                                                                                                                                                                                                     |
| `apps/web/e2e/a11y.spec.ts`                                                  | EDIT   | `:351`, `:467`, `:523`, `:527`, `:534`, `:547` → `chooseMovement`; the open picker scanned at 360/390/1280; tap targets inside it; a 390px case with long household names on the card.                                                                                                                                 |
| `apps/web/e2e/export-full-day.spec.ts`                                       | EDIT   | `:151` → `chooseMovement(…, { asTyped: true })`.                                                                                                                                                                                                                                                                       |
| `apps/web/e2e/movement-picker.spec.ts`                                       | NEW    | Test plan.                                                                                                                                                                                                                                                                                                             |
| `apps/web/scripts/screenshot-ephemeral.ts`                                   | EDIT   | `:445` (`Plank`, as typed) and `:558` (`Pull-up` — now **picked**).                                                                                                                                                                                                                                                    |
| `packages/db/scripts/verify.ts`                                              | EDIT   | "PICK-1 options" (Test plan).                                                                                                                                                                                                                                                                                          |
| `packages/db/scripts/mutations/07-picker-lists-any-household.{patch,expect}` | NEW    | Drops the household conjunct from the list → (a) goes red. (`NN` = the next free number at merge; PR 2 likely takes 07 and 08.)                                                                                                                                                                                        |
| `docs/features/strength-logging.md`                                          | EDIT   | The Movement field is a button on its own line; the `onSubmit` guard and why not a hidden input; the Save-line warning.                                                                                                                                                                                                |
| `docs/features/movement-picker.md`                                           | EDIT   | Owns the query; the `deleted_at` reader note; the referenced-rows rule.                                                                                                                                                                                                                                                |
| `docs/features/write-path.md`                                                | EDIT   | `lib/dal/movements.ts`.                                                                                                                                                                                                                                                                                                |
| `docs/features/programming.md`                                               | EDIT   | Owns `program-day.ts`, `lib/programming/`: the selected id and why it is not a magnitude.                                                                                                                                                                                                                              |
| `docs/privacy/data-inventory.md`                                             | EDIT   | §1b `:141-143` "the free-text movement-name box" → "Use as typed in the movement picker"; §1a `movements` row (`:131`): household movement names are now **listed** to everyone viewing any athlete in the household, and only while referenced by a live entry or prescription. No new field, processor or retention. |
| `docs/roadmap.md`, `docs/status.md`, `docs/plan.md`, `docs/changelog/…`      | EDIT   | PICK-1 done; PICK-2, C4r, D2 unblocked.                                                                                                                                                                                                                                                                                |

## Test plan

**PR 1 (U0)** — `sheet.test.tsx`, jsdom:

- `role="dialog"`, `aria-modal`, named by the title (37's structure).
- The `role="status"` element is a descendant of the dialog, mounted on open before any text, and
  updates when `status` changes (46).
- Close / Escape → `onOpenChange(false)`; focus goes to `returnFocusTo` (mocked as a non-focused
  button, the Safari case).
- `initialFocus: 'title'` focuses the title, not an input.
- **History:** open pushes one entry; a `popstate` closes the sheet and calls no `history.back`; a
  normal close calls `history.back` exactly once; open → pick → reopen leaves the stack at its original
  length; with a stubbed `CloseWatcher`, its `onclose` closes and no `popstate` listener is added.
- `useVisualViewport`: a mocked `visualViewport` (`height`, `offsetTop`, `resize`/`scroll`) writes
  `--sheet-vvh`/`--sheet-vvt` and toggles `data-compact` below 480; listeners removed on close.
- Body is the only `overflow-y-auto`; header/footer `shrink-0`; the title has `break-words` and Close
  `shrink-0` (a 40-character title).
- **Not provable in PR 1:** the geometry of 37 — PR 4's e2e on the first mounted sheet; ASSIGN-1 again
  on its own.

**PR 2 (server)** — the AGENTS.md boundary set:

- **`db:verify` "PICK-1"** runs `resolveSessionMovements` **and** `writeStrengthSession` (the real code)
  over two households: (a) B's own movement id + a typed sibling under A's scope → throws
  `MOVEMENT_NOT_AVAILABLE`, and **zero** new `sessions`, `entries` or `movements` rows; (b) a random
  UUID → the **identical** message (security N2); (c) A's own id and a global id → written, the entry's
  `movement_id` is that row and `movement_name` is the database's; (d) calling `writeStrengthSession`
  directly with B's internal `movementId` under A's scope (bypassing phase 1) → the in-transaction
  re-check throws and nothing commits (the TOCTOU seam); (e) **replay**: the same session `clientId`
  twice with ids → one session, one entry per movement, the same `sessionId`; the export row for the
  id-logged entry carries the global slug (security S2 — through the real path; the separate
  name-vs-id CSV block is dropped as tautological, scope N5).
- **Mutations:** the three PR 2 patches each make their named assertion go red (`db:mutations`). With the in-tx re-check in place, `NN-resolver-ignores-household` still throws the same message, so it goes red only through (a)'s "zero new `movements` rows"; (a)'s typed sibling is therefore a name that slugs to **no** global row, and its `.expect` says so.
- **`db:verify` (c) also** writes an id-path scaffolded card carrying a `prescriptionId` and asserts its `prescribedSnapshot` is written (correctness round 2, B1).
- **`entries.test.ts`** (recording DB): the resolver stub returns `null` for the id, and the
  find-or-create stub **would** insert if reached — so a wrong order emits an `INSERT INTO movements`
  before the throw; the test asserts no `INSERT` and no `BEGIN` is emitted. And an id-only session emits
  no `INSERT INTO movements` (17).
- **`actions.test.ts`:** unauth → `NO_PROFILE_LOG`, DAL not called; `movementPublicId: 'x'` → a named
  field error; a typed name with no letter / a comma → refused; an id-path card whose label has a comma
  → **accepted** (correctness S1); the DAL **received** `movementPublicId` with its value (strip-mode
  trap); `{ movementPublicId: <Back Squat>, movementName: 'Bench' }` → the DAL receives both and the
  writer gets Back Squat (the id decides).
- `strength-session-schema.test.ts`: `MOVEMENT_NAME_MESSAGES` strings asserted via the const; the
  contract test pins `MOVEMENT_NAME_MAX === 100` once.

**PR 3 (component)**:

- `movement-search.test.ts`: the Decision 4 vector table; `foldName` is imported, not re-implemented
  (a source-scan assertion); `movementNameKey` of every seeded name is unique (two seeded movements
  being "the same" would make `exact` ambiguous).
- `movement-picker-catalog.test.ts`: map keys = `MOVEMENT_SEED_ROWS` slugs exactly; groups ∈
  `MOVEMENT_PICKER_GROUPS`; alias keys unique, and none equals any movement's key.
- `movement-picker.test.tsx`: Recent → Today's program → groups → household; empty groups absent;
  `recentIds` absent → no Recent; Today's program open when a prescribed id is not `onForm`, closed when
  all are, absent with `alreadyIn`; one tag per row by precedence; query reset on reopen; the status
  updates once per change and carries the "Use as typed" reason; "Use as typed" absent for `rdl`,
  `pullups`, and present-but-`aria-disabled` for `🙂` and `a,b`; Enter picks the single match and never
  fires "Use as typed"; `onPick` gets a trimmed typed name; `aria-current` on `currentId`; the module
  imports no `'use server'` module; `@ts-expect-error` on `MovementOptionDTO['load']`.

**PR 4 (mounted)**:

- `strength-form.test.tsx`: the `onSubmit` guard test **first** (focus to the right card's button, the
  action not called); a pick on a blank card leaves every set blank (17); a pick on a scaffolded card
  clears `scaffolded`/`prescriptionId`; re-pick of the same id is a no-op; "use as typed" serializes no
  `movementPublicId`; "Add movement" appends only on pick; the Save line appears for a created card and
  is in Save's `aria-describedby`; `expectSummaryAgrees` after a pick.
- **`db:verify` "PICK-1 options"** _(correctness B1)_ over two households: (a) the list holds globals
  in the map + A's own only, never B's; (b) A's row whose slug a global row holds is excluded; (c) recent
  excludes a hidden entry, another profile's and another household's; (d) the order is deterministic
  across two runs; (e) A's unreferenced row is not listed and appears once an entry references it.
  `NN-picker-lists-any-household.patch` makes (a) go red.
- `e2e/movement-picker.spec.ts` (Chromium + the config's mobile project):
  - **The PICK-1 row's test**: on a day whose program does not prescribe it, type `rdl`, pick Romanian
    Deadlift, log a set; the day and the CSV show the existing movement and the typed numbers (17, 19).
  - **Geometry (37)** at 360×780, after typing a query and with the Today's-program `<details>` open:
    the dialog box equals the viewport; header top 0, footer bottom 780; scrolling the body moves
    neither; no horizontal overflow **inside** the dialog. At 1280×800: width ≤ 520, height ≤ 768.
  - **Back gesture:** type reps on a card, open the picker, `page.goBack()` → the sheet is closed, the
    URL unchanged, the reps still there; a second `goBack()` leaves the page as before.
  - **Keyboard only (18):** Tab → Movement button → Enter → search focused (fine pointer) → type → Tab →
    Enter picks → focus back on that button; Escape returns focus.
  - **Touch (18):** `hasTouch` + coarse pointer → on open the active element is not an input.
  - Every option and the `<summary>` (`min-h-11`) ≥ 44×44 at 360 (18); the status inside the dialog
    reads the count (46).
  - **Each geometry/overflow assertion is proven red once** on a seeded regression (e.g. removing
    `min-h-0` from the body) before the PR opens _(UX2 S5)_; the PR body records it.
- `a11y.spec.ts`: axe on the open picker at 360, 390 and 1280; tap targets inside it; the 390px card
  with a long household name.
- **Real-phone checks** (PR 4 body; spec `:929-932`): VoiceOver/TalkBack hear the count; no keyboard on
  open; "Use as typed" above the iOS keyboard (compact mode); swipe-back and Android back close the
  sheet and keep the form; landscape; the largest text size.

## Gates, and what to re-verify

- **V1-22 chunk 2 merged** before PR 2. Re-read: `sessionMovementSchema` (adds `prescriptionId`),
  `MovementVals` and the `movementsJson` spread, `onName`'s clear list, and `matchPrescribedSnapshot`,
  which compares `movementSlug(movement.movementName)` to the prescription's slug
  (`v1-22-2-renderer-and-writer.md:279-290`). That stays correct because the resolver hands the writer
  the **database's** name, and `movementSlug(name) === slug` holds for every global row
  (`catalog-movements.ts:336-338`) and every household row (minted from its name). **C4r breaks the
  second half**; MOV-1's plan already records switching that comparison to the id
  (`mov-1-rename-movement.md:125-135`).
- **PROF-1 step 1 merged** before PRs 2 and 3: `foldName` exists in `text.ts` with the shape
  `prof-1-athletes.md:329` gives. If PROF-1 slips, PICK-1 does **not** write its own fold — it waits
  (seams).
- **V1-24 3a / 3b** share the strength surface and its guide; serialize by merge order with PRs 2 and 4.
- **Programming-lane overlap** _(architecture 5)_: PR 4 edits `packages/db/src/queries/program-day.ts`
  and `programming.md`, which PROF-1a (the kid-only program predicate, seams), ASSIGN-1/ASSIGN-READ and
  V1-22 A4 also edit. Gate 1 fails for any of them in flight at once; PR 4's select is one column and
  goes after whichever is open.
- **AUTH-1.** PICK-1 is not gated on 1c. If 1c lands first, re-verify: (a) the action's first check is
  the session check, not `hasGateAccess` (`actions.ts:278`), and PR 2's unauth test asserts the new
  call; (b) `getHouseholdScope()`'s contract (null/throw) is unchanged — the two DAL reads rely only on
  it; (c) `e2e/login.ts` and `screenshot:ephemeral` follow 1c-pre's seam; (d) no new page or action, so
  `pages-are-gated.test.ts` needs nothing.
- **WP-1** (the `actions.ts` shard) — PICK-1 adds no action and does not edit `actions.ts`.
- **Chunk 0** does not gate PICK-1.

## Risks / rollback

| Risk                                                         | Mitigation                                                                                                                                                                             |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A crafted id reaches another household's movement.           | Global-or-own in the resolver **and** re-checked in the transaction; `db:verify` both directions with the real code; a mutation patch proves the proof can fail.                       |
| A refused body commits a typed sibling's row.                | Ids resolved before any insert, inside `packages/db`; the phase-swap mutation and the emitted-SQL test.                                                                                |
| `movementPublicId` silently stripped (strip mode).           | `actions.test.ts` asserts the DAL received it.                                                                                                                                         |
| "Use as typed" mints a same-movement duplicate.              | Withheld on `exact` / alias; the vector table pins the common spellings; the Save line asks for a spelling check; the spec's near-duplicate success signal (`:220`) measures the rest. |
| A typo'd household movement stays in everyone's list.        | Listed only while referenced (Decision 5); after V1-9b a hide removes it; before, MOV-1 rename or a correction.                                                                        |
| A household movement name is shown household-wide (privacy). | Same audience as the day pages that show it; inventory updated in PR 4.                                                                                                                |
| The form appears dead (nameless card, no native block).      | The `onSubmit` guard, tested first; the server's refusal as backstop.                                                                                                                  |
| The back gesture navigates away and loses the form.          | U0's history entry; the `goBack()` e2e; CloseWatcher on Android.                                                                                                                       |
| The footer sits under the iOS keyboard.                      | `--sheet-vvh`/`--sheet-vvt` + compact mode; a real-phone check before PR 4 merges.                                                                                                     |
| Groups and aliases were drafted in a model-built prototype.  | Definitions, not loads; approved with the prototype; marked provisional; chunk 0 is the human pass.                                                                                    |
| Export bytes change.                                         | The export groups by `movements.slug` (`export-month.ts:65`, `:83`) and selects no `movement_name` (`:60-78`); an id names the same row a matching name did.                           |
| A dead id after a future merge throws to `error.tsx`.        | Unreachable until C4m, which owns the typed refusal (both guides).                                                                                                                     |

**Rollback.** No migration, so each PR reverts cleanly. PR 2 is wire-compatible (an older page posts
names). Reverting PR 4 restores the text box with PR 2's server still accepting both. **Revert in
reverse order:** reverting PR 2 under PR 4 strips `movementPublicId` and resolves picks by label —
still the right row for a catalog pick, but it reopens find-or-create for every pick.

## Out of scope / deferred

- **PICK-2 (C2)**: near matches, spelling, edit distance (19's other sentences).
- **MOV-1 (C4r/C4m)**: rename, merge, the hint's "rename later", the typed dead-id refusal, the
  scaffold sending ids.
- **CAT-2 (C3)** and **chunk 0**'s confirmations.
- **D2** mounts the component; PICK-1 does not.
- **`TEN-2b-1`** (find-or-create inside the transaction) — phase 2 still runs before it.
- **Server-side fold before find-or-create** (rejected).
- **A typed movement's declared unit / bodyweight flag** — D8 / unowned 9.
- **Cross-request caching** of the catalog.

## Where this plan disagrees with the spec, or a row

1. **"The picker submits an id, not a name"** (`:516-519`): it submits `movementPublicId` **and** a
   label; only the id resolves (Decision 1).
2. **`MovementOptionDTO`**: settled by the seams amendment (`:548-552`); this plan adds the discriminated
   union (Decision 5).
3. **Unowned 2's options** (`:657-659`): a per-row value needs no column, and a column would not reach
   existing rows through the `ON CONFLICT DO NOTHING` seed (Decision 3).
4. **Criterion 19 is tagged (C2)**; Q2 puts aliases in PICK-1 — the table at `:228-229` should read
   "19 (C1 alias, C2 rest)".
5. **The prototype's picker is a bottom sheet under 600px**; full screen is used, with the back gesture
   owned by U0 (Decision 7).
6. **The prototype's "use as typed" hint promises a rename** that does not exist until C4r.
7. **FE-12's "cached catalog"** is declined; the payload split is kept.
8. **The PICK-1 row says "a plan comes later, in its own PR"** (`plan.md:216-219`); this plan rides U0.
9. **Criterion 18 says today's prescribed movements are "folded away (the form already fills them)"** —
   the form fills them only after "Fill in today's movements". The group is computed from what is on the
   form and is **open** while any prescribed movement is missing (Decision 8). The criterion should say
   so.
10. **The tags "in the app" / "added by you"** (SUX-11, the brief) are replaced by the group label and
    "household" on the UX panel's finding (UX3 4, UX1 8).
11. **MOV-1 cites `foldText`/`foldMovementQuery` and `movement-copy.ts`** (`mov-1-rename-movement.md:83-85`,
    `:337`); the seams make the key `movementNameKey` on PROF-1's `foldName`, and this plan names the copy
    module `movement-picker-copy.ts`. MOV-1 updates its citations.

## Open questions

_For the maintainer:_

1. **Recent: 5, and does a skipped movement count?** The plan says 5, and yes. The UX panel left it
   open.
2. **Listing a household movement only while referenced** (Decision 5, UX3 5 option (a)) means a row
   created by "Use as typed" and never saved cannot exist, but one logged once and then hidden vanishes
   from the list while staying in the database. Confirm that is the wanted recovery.

_Answered by the panels:_ Q1 (full screen — Decision 7), Q3 (no confirm; a Save-line warning — Decision
8), Q4 (PRs 3 and 4 stay separate; the merge clause is dropped, scope N1).

## Review-response log

### Engineering panel, round 1 (2026-10-23) — correctness, scope, architecture, reuse, security

| Id    | Lens         | Finding (short)                                                                                                    | Response                                                                                                                                                                                                                                                  |
| ----- | ------------ | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1    | Security     | Ids-before-inserts lived in the DAL; nothing in the transaction re-checked a `movementId` (TOCTOU)                 | **Accepted.** `resolveSessionMovements` in `packages/db`; `writeStrengthSession` re-checks global-or-own in-transaction; `db:verify` (a)–(e) through the real code; two mutation patches (Decision 2, PR 2 table, Test plan).                             |
| B2    | Correctness  | The ordering claim had no proof that could fail                                                                    | **Accepted** with B1: the phase-swap mutation, and the `entries.test.ts` stub that would insert on a wrong order.                                                                                                                                         |
| B1    | Correctness  | The list read had no two-household proof                                                                           | **Accepted.** PR 4 "PICK-1 options" (a)–(e) + `NN-picker-lists-any-household.patch`.                                                                                                                                                                      |
| S1    | Correctness  | The letter/comma rules would refuse an existing row's name on the id path                                          | **Accepted.** Typed-name rules run only without `movementPublicId` (Decision 1); a test with a comma label on the id path.                                                                                                                                |
| S2    | Correctness  | The fold missed `pullups`/`farmer's`; the Goal overclaimed                                                         | **Accepted.** Compact matching, possessive and 3-letter plural rules, the vector table; the Goal narrowed (Decision 4).                                                                                                                                   |
| S3    | Correctness  | Recent could show a row the list hides; the resolver accepts shadowed own rows silently                            | **Accepted.** Recent ∩ options; the resolver's acceptance recorded as deliberate (Decisions 2, 5).                                                                                                                                                        |
| S4    | Correctness  | Wire key name                                                                                                      | **Accepted** — `movementPublicId` (seams).                                                                                                                                                                                                                |
| S5    | Correctness  | `other` relied on `db:verify`, which never runs on prod                                                            | **Accepted.** A global row is listed only if its slug is in the map; `other` removed; the validated CHECK cited (Decision 3).                                                                                                                             |
| N2    | Correctness  | Message names                                                                                                      | **Accepted** — `MOVEMENT_NAME_MESSAGES` (Decision 1).                                                                                                                                                                                                     |
| S1    | Scope        | "The scaffold sends ids" is not PICK-1's concern                                                                   | **Accepted.** Cut from PR 2; deferred to MOV-1 (Decision 6).                                                                                                                                                                                              |
| S2    | Scope        | `returnFocusTo` is speculative                                                                                     | **Kept**, because UX2's Safari point holds (Safari does not focus a clicked button); now a required prop (Decision 7).                                                                                                                                    |
| S3    | Scope        | The new guide should not own `lib/dal/movements.ts`                                                                | **Accepted.** `write-path.md` owns it; the new guide links it.                                                                                                                                                                                            |
| N1–N6 | Scope        | Merge clause; PR 3 gated on PR 2; the 600 constant; `declarationOf` timing; the CSV block; the `onSubmit` fallback | **Accepted** all: no merge clause; PR 3 ungated on PR 2; constant dropped; `declarationOf` in PR 4; the name-vs-id CSV block dropped as tautological, the slug assertion kept inside the real replay proof (reconciles security S2); the fallback stated. |
| 1     | Architecture | A second fold beside PROF-1's                                                                                      | **Accepted** — imports `foldName` (Decision 4).                                                                                                                                                                                                           |
| 2     | Architecture | "Same movement" defined twice (picker, MOV-1)                                                                      | **Accepted** — `movementNameKey`, MOV-1 imports (disagreement 11).                                                                                                                                                                                        |
| 3     | Architecture | Name rules duplicated across MOV-1 / A4                                                                            | **Accepted** — `movementNameSchema` etc. created in PR 2.                                                                                                                                                                                                 |
| 4     | Architecture | One DAL read mixes household and athlete; D4c has no athlete                                                       | **Accepted** — two functions; `recentIds` optional (Decision 5).                                                                                                                                                                                          |
| 5     | Architecture | The programming-lane overlap on `program-day.ts` was unrecorded                                                    | **Accepted** — Gates.                                                                                                                                                                                                                                     |
| 6     | Architecture | No diagram for the id path                                                                                         | **Accepted** — `docs/architecture.md` §2 in PR 2.                                                                                                                                                                                                         |
| 7     | Architecture | `returnFocusTo` missing from `SheetProps`                                                                          | **Accepted.**                                                                                                                                                                                                                                             |
| 8     | Architecture | PR descriptions should embed the milestone chart; say where 19/37/46 actually land                                 | **Accepted** — Staging note; Acceptance lists the landing PR per criterion.                                                                                                                                                                               |
| also  | Architecture | `modal-sheet.tsx`? `movement-picker-copy.ts`                                                                       | **Copy module renamed.** **Sheet name kept** (`sheet.tsx`): the seams table and sibling plans cite it; the shadcn-overwrite hazard is handled by the header and tests (Decision 7). A decision, not a code-proven pushback.                               |
| B1    | Reuse        | `foldName` re-implemented                                                                                          | **Accepted** (as architecture 1).                                                                                                                                                                                                                         |
| B2    | Reuse        | Movement-name rules re-implemented                                                                                 | **Accepted** (as architecture 3).                                                                                                                                                                                                                         |
| B3    | Reuse        | Wire key diverged from siblings                                                                                    | **Accepted** — `movementPublicId`.                                                                                                                                                                                                                        |
| S1    | Reuse        | Two resolvers by public id                                                                                         | **Accepted** — one, taking an `Executor`; A4 calls it.                                                                                                                                                                                                    |
| S3    | Reuse        | MOV-1's collision check needs the same key                                                                         | **Accepted** — `movementNameKey`.                                                                                                                                                                                                                         |
| S4    | Reuse        | Strings split across modules; the client guard re-types the schema's message                                       | **Accepted** — one copy module; the guard uses `MOVEMENT_NAME_MESSAGES.missing`.                                                                                                                                                                          |
| N1    | Reuse        | DTO should be a discriminated union                                                                                | **Accepted** (Decision 5).                                                                                                                                                                                                                                |
| S1    | Security     | Spreading the wire movement into the writer's argument                                                             | **Accepted** — built field by field (Decision 1).                                                                                                                                                                                                         |
| S2    | Security     | Replay and CSV proofs bypassed the resolver                                                                        | **Accepted** — both run through `resolveSessionMovements` + `writeStrengthSession`.                                                                                                                                                                       |
| N1    | Security     | `other` group as a hiding place                                                                                    | **Accepted** with correctness S5.                                                                                                                                                                                                                         |
| N2    | Security     | Unknown vs foreign must be indistinguishable                                                                       | **Accepted** — `db:verify` (b) asserts identical messages.                                                                                                                                                                                                |

### UX panel, round 1 (2026-10-23) — interaction (UX1), a11y + 360px (UX2), trust + data entry (UX3)

| Id   | Lens | Finding (short)                                                                                                                                               | Response                                                                                                                |
| ---- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| B1   | UX1  | Full screen with no back gesture traps a phone user                                                                                                           | **Accepted** — U0's history mechanism + CloseWatcher; e2e `goBack()` keeps typed reps (Decision 7).                     |
| 2    | UX1  | "Today's program" folded away even when nothing was filled                                                                                                    | **Accepted** — computed from the form, open while any is missing; criterion 18's wording recorded (disagreement 9).     |
| 3    | UX1  | "Use as typed" offered for an alias                                                                                                                           | **Accepted** — withheld on `aliasHit`.                                                                                  |
| 4    | UX1  | `pullups`/`pushups` don't match                                                                                                                               | **Accepted** — compact matching (Decision 4).                                                                           |
| 5    | UX1  | Keyboard-up footer crowding                                                                                                                                   | **Accepted** with UX2 B1.                                                                                               |
| 6    | UX1  | "Add movement" makes a blank card, then a second tap                                                                                                          | **Accepted** — opens the picker, appends on pick.                                                                       |
| 8    | UX1  | Catalog matches should show their group                                                                                                                       | **Accepted** — group label as the tag.                                                                                  |
| B1   | UX2  | Keyboard-up geometry: a max-height query never fires on iOS                                                                                                   | **Accepted** — `visualViewport`-driven `data-compact`; quieter "Use as typed" when matches exist (Decision 7/8).        |
| B2   | UX2  | Back gesture                                                                                                                                                  | **Accepted** (as UX1 B1).                                                                                               |
| S1   | UX2  | Movement button sharing a row with two selects at 360                                                                                                         | **Accepted** — own line, `min-h-11 h-auto break-words`; a 390px a11y case.                                              |
| S2   | UX2  | Two tags per row overflow                                                                                                                                     | **Accepted** — one tag by precedence, may wrap.                                                                         |
| S3   | UX2  | A long D2 title pushes Close off                                                                                                                              | **Accepted** — `min-w-0 flex-1 break-words`, a 40-char test.                                                            |
| S4   | UX2  | `offsetTop` ignored; dialog not anchored to the visual viewport                                                                                               | **Accepted** — `--sheet-vvt`, `scroll` listener.                                                                        |
| S5   | UX2  | Geometry tests could pass vacuously                                                                                                                           | **Accepted** — in-dialog overflow, `<summary>` size, details opened, after typing; each proven red once.                |
| S6   | UX2  | A `disabled` button hides its reason from keyboard users                                                                                                      | **Accepted** — `aria-disabled`, focusable, reason in the hint and status.                                               |
| B1   | UX3  | `pullups` mints a duplicate                                                                                                                                   | **Accepted** (as UX1 4).                                                                                                |
| B2   | UX3  | `rdl` mints a household "rdl"                                                                                                                                 | **Accepted** (as UX1 3); `rdl` in the vector table.                                                                     |
| 3    | UX3  | Permanence is said once, then forgotten by Save (answers Q3)                                                                                                  | **Accepted** — card hint survives to Save; the Save line; no confirm dialog.                                            |
| 4    | UX3  | Footer copy not kid-readable; "added by you" is wrong when a sibling added it                                                                                 | **Accepted** — new copy; tag "household" (disagreement 10).                                                             |
| 5    | UX3  | A typo lives in everyone's list forever                                                                                                                       | **Accepted, option (a)** — listed only while referenced; (b) rejected (Decision 5); open question 2 for the maintainer. |
| 6    | UX3  | Zero matches is a dead end                                                                                                                                    | **Accepted** — "Matches some of your words", else the browse list.                                                      |
| NITs | all  | Enter never uses as typed (UX3 N8); reset query on open; mark current; explicit `returnFocusTo` (Safari); safe-area; title `outline-none`; option focus rings | **Accepted** all (Decisions 7, 8).                                                                                      |

No finding was pushed back on code grounds. One naming suggestion (`modal-sheet.tsx`) was declined as
a decision, recorded above.

### Engineering panel (round 2, correctness re-review)

| #   | Lens        | Critique (short)                                                                   | Verdict      | Resolution                                                                                                             |
| --- | ----------- | ---------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------- |
| B1  | Correctness | The field-by-field build drops chunk 2's `prescriptionId`; the snapshot goes inert | **Accepted** | Added to the list; the builder's return type makes a missing key a compile error; `db:verify` (c) asserts the snapshot |
| S1  | Correctness | "3+ letters" leaves `ups` unstripped; three vector rows contradict the rule        | **Accepted** | "2+ letters"; added the `push up` row                                                                                  |
| S2  | Correctness | The in-tx re-check has no mutation patch                                           | **Accepted** | `NN-drop-in-tx-recheck`; the resolver patch's `.expect` names (a)'s zero-new-rows assertion                            |
| N   | Correctness | PR 4's hard-coded `07` will collide with PR 2's patches                            | **Accepted** | `NN` throughout                                                                                                        |

Every round-1 blocker was confirmed resolved.
