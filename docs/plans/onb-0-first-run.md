# ONB-0 — first run is broken today

> Backlog: [plan.md](../plan.md) row ONB-0. Branch: `fix/onb-0-first-run`.
> Milestone: [beta-1.md](../milestones/beta-1.md) — pulled out of step 4 on 2026-10-07, runs now.
> Prior art: **[onb-0-first-run-ux-panel.md](./onb-0-first-run-ux-panel.md)** (2026-08-26, panel
> complete, four questions left open). This plan answers all four and reconciles every critique in
> that file — including a reversal of one of its accepted BLOCKING resolutions. See the log.

## Goal

A brand-new household's first two screens are honest. Today neither is:

1. **The picker's empty state tells a human to run a database command.**
   `apps/web/app/p/page.tsx:37` renders `No profiles found. Seed the database to get started.`
   ⚠️ The backlog row cites `apps/web/app/page.tsx:25`; OSS-2 moved the app behind the public landing,
   so the string lives at `app/p/page.tsx` now. The row's citation is corrected in this PR.
2. **A new athlete inherits the maintainer's family's whole catalog.** `routine_config = null` →
   `resolveRoutine` → `buildDefaultRoutine(ROUTINE_CATALOG)` (`apps/web/lib/dal/profiles.ts:94`;
   `packages/shared/src/routine.ts:100` for null/garbage and `:117` for all-items-stale), and
   `ROUTINE_CATALOG` is the **entire** seeded catalog (`apps/web/lib/routine/catalog.ts:16`). The
   committed UX panel counted it: **~17 controls** — 3 habit checkboxes (Rice bucket · Brain rep ·
   Splits), 7 numeric fields grouped under the label **"Brush teeth"** (a wrestling drill block a new
   coach reads as dental hygiene), 4 calisthenics counters, 2 life controls — on the first screen a
   stranger ever sees. Its lens A was blunt: _"Even if every label were perfect, this is the wrong
   first screen. Renaming fixes nothing."_

P0, blocks any stranger using the app, depends on nothing.

## Acceptance

The backlog row's criterion, verbatim — its spec is [ONB-1's R2](./onb-1-self-serve-onboarding-prd.md):

> an **explained empty state** (what this app is, what happens next) plus a control that routes to — or
> inlines — the movement/workout editor, and a **neutral** default routine. **Not** a questionnaire.

Done when:

- `/p` with zero profiles renders an explained empty state: what mat-plan is, what happens next, one
  control. No developer-facing string, no "seed the database".
- A profile with `routine_config = null` resolves to a **neutral** routine — nothing in it belongs to
  any household.
- An **existing** profile whose authored `routine_config` names household keys still renders them: the
  membership set stays the full catalog; only the _fallback_ narrows.
- No profile that exists today loses a control: the seeded fixture gets an explicit config, and a
  guarded correction writes one to any live `NULL` row **before** the deploy.
- `pnpm verify`, `pnpm e2e:local`, `pnpm guides:check` green. Screenshots at 390/820/1280 in **both**
  themes, captured from a real render (new `--state no-profiles`).

## The design

### Defect 2 — "neutral default routine" = `['strength']`

The committed panel's **A2** (accepted, blocking) reframed this: the question is not "rename the
defaults" but **"what is the smallest defensible default?"**, with the candidate _"weigh-in + strength
only — everything else opt-in via the editor."_ Its open question 3 asked the maintainer to settle it.
**This plan takes A2's own candidate as the answer**, because seven independent findings from the
2026-10-07 panel collapse into it.

```ts
// apps/web/lib/routine/catalog.ts
/**
 * The first-run routine (ONB-0) — what a profile with `routine_config = NULL` renders.
 *
 * `strength` ALONE, which together with the pinned weigh-in is exactly the UX panel's A2 candidate
 * ("weigh-in + strength only"): `bodyweight` is deliberately not a legal `order` member, so the
 * weigh-in is pinned by construction and this list is the whole of the rest.
 *
 * Why nothing else, item by item — each exclusion was its own panel finding:
 *  - the 3 habits and the 7 `brush_teeth` metrics are the maintainer's household's, which IS the defect;
 *  - the calisthenics counters twin the `push-ups` / `pull-up` / `v-sit_crunches` MOVEMENTS and
 *    double-count adherence (CAT-1, whose trap (2) says "the default needs the criterion too") — and
 *    ONB-2's Daily Five prescribes push-ups and pull-ups, so shipping them here too would hand every
 *    new household the same work loggable two ways on day one;
 *  - `life:wrestling_practice`'s one tap writes `DEFAULT_PRACTICE_MINUTES = 90`, the maintainer's
 *    club's session length, invisibly and with no in-app undo. plan.md's standing ruling names THIS
 *    row as the owner of that distinction: "it is Ray's number for his kids, not a default for a
 *    stranger's first session (ONB-0/ONB-2 own that)".
 * Everything excluded stays fully authorable in the shipped editor, which Today links to.
 *
 * READ-TIME FALLBACK, NEVER WRITTEN. `routine_config = NULL` *is* the representation of "the neutral
 * default", so a profile creator leaves it NULL. If PROF-1 / TEN-1 / ONB-2 ever needs to WRITE a
 * starter routine from `packages/db`, this const and the two registries it derives from move to
 * `packages/shared` first — `packages/db` cannot import `apps/web`.
 */
export const NEUTRAL_DEFAULT_ROUTINE: readonly string[] = [STRENGTH_KEY];
```

A one-element array still earns its name: it is the answer to "what does a new household start with",
it is imported by the resolver wrapper and by the tests, and it is the single line ONB-2 edits.

**Membership must NOT narrow.** `resolveRoutine(raw, orderedCatalogKeys)` uses one list for two jobs —
the membership set _and_ the fallback. Only the fallback narrows; narrowing membership would strip the
maintainer's household's authored `brush_teeth` items on the next read, which is a data-visible
regression, not a fix.

```ts
// packages/shared/src/routine.ts — DEFAULTED, not required.
export function resolveRoutine(
  raw: unknown,
  orderedCatalogKeys: readonly string[],
  defaultOrderedKeys: readonly string[] = orderedCatalogKeys,
): RoutineConfig;
```

Inside, the fallback is built **once** and intersected with the membership set, which restores both
postconditions the split would otherwise retire (`routine.ts:84-91` documents them today):

```ts
// `default ⊆ catalog` is no longer true by construction, so enforce it; and never return a BLANK
// routine (a kid with an empty Today), so an empty/all-stale default falls back to the catalog.
const fallbackKeys = defaultOrderedKeys.filter((k) => allow.has(k));
const fallback = () =>
  buildDefaultRoutine(fallbackKeys.length > 0 ? fallbackKeys : orderedCatalogKeys);
```

Then **one** place pairs the two lists, so no caller ever passes either by hand:

```ts
// apps/web/lib/routine/catalog.ts — the ONLY production pairing of membership with first-run default.
export const resolveProfileRoutine = (raw: unknown): RoutineConfig =>
  resolveRoutine(raw, ROUTINE_CATALOG, NEUTRAL_DEFAULT_ROUTINE);
```

`apps/web/lib/dal/profiles.ts:94` becomes `routine: resolveProfileRoutine(row.routineConfig)` — which
also _shrinks_ the diff in a file TEN-1 chunk 1b rewrites. `validateRoutineForWrite`
(`routine.ts:141`) and `apps/web/app/p/[profileId]/actions.ts:609` stay byte-identical: the write side
has no first-run semantics, the defaulted parameter preserves its current contract exactly, and all
nine existing `contract.test.ts` call sites keep working. A one-line comment goes on `routine.ts:141`
saying catalog-as-default is **correct** there, so the next reader does not "fix" it by threading the
neutral list through a reject contract that compares against the catalog.

#### The two rows that exist today, and the prod regression

⚠️ **Seed profile 1's `routine_config` IS NULL** (`packages/db/src/seed.ts:112-119` — only profile 2
gets one, and `seed.ts:25-26` says so deliberately). Three consequences, all handled here:

1. **The e2e suite would go red, entirely.** `apps/web/e2e/global.setup.ts:43-55` selects profile 1 and
   submits the `Splits` habit; the V0-11 smoke (`log-bodyweight.spec.ts:41`, the check that becomes
   required at PR 28) drives `Rice bucket` and `Pressure` (a `brush_teeth` metric) on the same profile.
   A setup failure fails the whole chromium project, not one spec.
   **Fix:** `packages/db/src/seed.ts` gains `SEED_FULL_ROUTINE` — today's full catalog order, written
   explicitly onto profile 1 — so every existing spec passes with **zero spec edits**. `packages/db`
   cannot import the app-side catalog, so an app-side test binds the literal to `ROUTINE_CATALOG` and
   fails if they ever diverge (the pattern `contract.test.ts:198-201` already uses for profile 2).
2. **The live household would silently lose four logging surfaces.** The prod row seeded as
   `SEED_PROFILE_PUBLIC_ID` is `NULL`, so on deploy its Today loses the habits and all seven
   brush-teeth controls. Already-logged entries still display (the list is built from `entries`, not
   the routine) but can no longer be logged.
   **Fix:** a correction in `packages/db/scripts/corrections/registry.ts` writes `SEED_FULL_ROUTINE`
   to every live profile with `routine_config IS NULL`. Guarded by `IS NULL` (so a second run matches
   nothing), targeted by `public_id`, dry-run by default, one transaction.
3. **A seed fix alone cannot reach prod:** `seed.ts:128` is
   `onConflictDoNothing({ target: profiles.publicId })`, so the existing row is never updated.
   **Deploy order: run the correction BEFORE merging/deploying.** It writes the routine the app renders
   _today_, so it is a no-op from the household's point of view and is safe on the current code — which
   is what makes "before" the easy ordering rather than a race.

### Defect 1 — the explained empty state

```
┌──────────────────────────────────────────────┐
│ Who's logging today?                    (h1) │
│ Nobody is set up to log yet.      ← BRANCHED │
│                                              │
│ No athletes yet                         (h2) │
│                                              │
│ mat-plan is a logbook: you write down what   │
│ an athlete did — strength sets, rep counts,  │
│ time at practice — one day at a time. It     │
│ doesn't write the plan.                      │
│                                              │
│ When an athlete exists, their day starts     │
│ with a weigh-in and strength, and you add    │
│ the rest from their routine editor.          │
│                                              │
│ Adding an athlete isn't in the app yet — it  │
│ takes a change to this deployment's seed     │
│ data.                                        │
│                                              │
│ [ ⌗ How athletes get added — on GitHub ]     │
│                                              │
│ Theme  (Auto|Light|Dark)        ← unchanged  │
└──────────────────────────────────────────────┘
```

**Who is actually on this screen.** `/p` is gated (`requireGatedPage()`), `PUBLIC_PATHS = ['/']`, and
there is exactly one shared `ACCESS_GATE_PASSWORD` — so the reader either deployed this or was handed
the code by whoever did. `pnpm dev` re-seeds on every boot, so locally the state is unreachable
entirely. The committed panel's **A5** reached the same conclusion and drew the right consequence: the
copy addresses that reader honestly rather than pretending to onboard a family who cannot yet exist.

**1. What this app is.** One sentence. The landing already says who it is _for_
(`LANDING_COPY.lead`), so this one says what it _does_ and what it does **not** do — the half the
landing cannot say, and the half that matters on a screen about to show somebody an empty app.

**2. What happens next.** Branched into the page's own subhead too: `PICKER_COPY.subhead` is
_"Pick a profile to start logging."_ — an imperative with no object in this branch, instructing the
reader to pick from an empty list 40px above the box that says there is nothing to pick. A screen
reader hears all three statements in a row with nothing to supersede the false one. So the subhead
branches to _"Nobody is set up to log yet."_ The `<h1>` does **not** change: `e2e/contexts.ts:19`
resolves `pickerHeading` from `PICKER_COPY.heading` and the gate helper plus four specs assert through
it, so touching it unconditionally breaks the suite.

**One noun: "athlete".** The screen currently uses "profile" (schema vocabulary) while the block would
say "athletes"; a reader should not have to infer they are the same object. The populated-state copy is
left alone — an app-wide rename is PROF-1's.

**3. A control.** R2 wants it to route to the movement/workout editor. **It cannot, honestly** — the
editor is `/p/[profileId]/routine` and there is no profile, and `packages/db/src/seed.ts` is still the
only writer of `profiles` (PROF-1). The committed panel's **A4** already settled this: _"R2 is not
buildable as written… It becomes an explanation of what to do, with no fake affordance."_ So the
explanation carries the answer, and one secondary link points the only person who can act at the only
place that documents it: a new `## Adding an athlete` section in the public README, which says it needs
a code change today, **warns that the committed seed rows are the maintainer's own fixtures**, points
at `## Local development` + `docs/deploy.md` rather than restating commands, and links PROF-1 as the
row that makes it in-app.

Rejected, with reasons: a disabled **Add athlete** button (nothing could ever enable it, and PROF-1 has
already designed the real affordance — a dashed `+` tile at the bottom of the picker — so shipping a
dead version burns it); linking the landing `/` (it answers "what is this", which this block answers,
and the reader just came through it); linking `#local-development` (that section is about `pnpm dev`);
printing `pnpm db:seed` in-app (it is the _wrong_ instruction — it would install the maintainer's named
minors into a stranger's deployment, re-entering the exact defect this row exists to fix).

**Markup and tokens, pinned here rather than left to implementation.** The panel's **B1** is why the
block is not an `EmptyState`: that primitive renders a `<p>` (`components/ui/empty-state.tsx:12`),
which cannot legally contain an `<h2>`, sibling `<p>`s and a button. Its two existing callers keep it
unchanged.

- `<section className="flex max-w-prose flex-col gap-3">` — **no box.** The only token that draws one
  is `border`, which measures **1.26:1** light / 2.69:1 dark against the page and is pinned as failing
  SC 1.4.11 in `app/design/tokens/token-sets.test.ts`. A container whose edge nobody can see is not a
  container; grouping comes from the `<h2>` + `gap-3`, as the landing does. **No `aria-labelledby`**,
  so the component carries no `id` and is safely renderable more than once per document.
- `<h2 className="text-lg font-medium">` — the house section shape (`bodyweight-section.tsx:40-41`).
  `h1 → h2` skips nothing and keeps one `<h1>`.
- The two explanatory `<p>`s use **`text-foreground`** (21:1 light, 19:1 dark), not
  `text-muted-foreground` (4.74:1 — AA by 0.24, the wrong default for three paragraphs read once,
  cold, on a gym floor). Only the short follow-up line is muted.
  **`bg-muted` / `bg-accent` / `bg-secondary` under `text-muted-foreground` is forbidden here** — that
  pair measures 4.34:1, and `token-sets.test.ts` asserts in prose that no screen does it.
- The link is a `Button asChild variant="outline"` with `GitHubMark`, matching the landing's idiom for
  the same destination type, **same tab** (so the back button is the recovery path) and therefore no
  `target="_blank"` and no `rel` needed.

**360px width math, done before implementation** (panel **B4**). Page shell is
`mx-auto w-full max-w-2xl px-4`, so at 360px the column is 360 − 32 = **328px**; with no box that is
328px of content. Tailwind paddings are `rem`-derived, so under text-only scaling the usable width is
328 / 312 / 296px at 100 / 150 / 200%.

⚠️ `buttonVariants`' base is **`whitespace-nowrap`** (`components/ui/button.tsx:20`), so an unwrapped
label overflows: "How athletes get added — on GitHub" ≈ 15.5em → 15.5 × 28 + 40 = **474px** at 200%,
against 296px. The landing already solved exactly this on the same column with
`CTA_CLASS = 'h-auto w-full py-2.5 text-center text-base whitespace-normal'` and a comment explaining
why (`app/page.tsx:14-16`). **This is the second occurrence, so `CTA_CLASS` moves to
`lib/constants.ts` and both screens import it.** `h-auto` does not cost the tap target: `min-h-11` is
in the button base and `min-h-*`/`h-*` are different tailwind-merge groups. With `whitespace-normal`
the binding constraint is the longest unbreakable word — `deployment's` ≈ 6.2em → 199px at 200% —
which clears 296px.

**Where it lives.** `apps/web/components/profiles/picker-empty-state.tsx`, exporting
`PickerEmptyState`, beside `profile-tile.tsx` — same folder, same single consumer, which is AGENTS.md's
feature-folder split. Named for the surface, not for "first run": ONB-2 adds first-run copy on
**Today**, which will not live here, and `components/onboarding/` is the home when that second surface
lands.

### Seeing it, and keeping it seen

The empty state is unreachable from every committed path — `scripts/embedded-pg.ts:143` seeds
unconditionally for both the e2e and the screenshot harness, and `--state` only ever seeds _more_ rows.
So today it cannot be screenshotted, which would mean a reviewer approving an all-copy change they have
never seen rendered. Two cheap pieces:

1. **`--state no-profiles`** in `scripts/screenshot-ephemeral.ts` — one seeder that
   `UPDATE profiles SET deleted_at = now()` (a soft delete; `listProfiles` filters on it, and a hard
   `DELETE` would hit FKs from `entries` / `ramp_targets`). Buys the required screenshots at three
   widths × both themes.
2. **`<PickerEmptyState />` inside `SurfacesCell`** in `app/design/tokens/inventory.tsx` — one import
   and one line. That route is already in `a11y.spec.ts`'s `ROUTES`, so it is already axe-scanned in
   **both themes**, and it is the one route with a per-cell **360px overflow** assertion. `SurfacesCell`
   takes no `setId` and already renders `EmptyState`, so the block needs no props and this is its
   natural neighbour. The coverage expires with the harness when UI-3 deletes it — a dated expiry, not
   an open-ended gap.

⚠️ **The obvious third idea is a trap and must not be tried:** soft-deleting the profiles inside an
e2e spec. `playwright.config.ts:22` is `fullyParallel: true` and the `a11y` and `chromium` projects
share one database, so emptying `profiles` mid-run breaks `selectProfile` in every other spec.

And one false claim to retire: the picker's `a11y.spec.ts` entry runs axe + tap targets **only** —
`expectNoHorizontalOverflow` is opt-in per test and no call site is the picker, so the picker has no
360px coverage at all today. This PR adds that assertion (4 lines) rather than citing a gate that does
not exist.

## File-by-file changes

| Path                                                       | Change | What & why                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/routine.ts`                           | EDIT   | `resolveRoutine` gains a **defaulted** 3rd `defaultOrderedKeys`; fallback intersected with membership + never-blank; doc comments at `:84-91`/`:128-129` rewritten; one comment on `:141` on why catalog-as-default is right there.                                                                                                                                             |
| `apps/web/lib/routine/catalog.ts`                          | EDIT   | `NEUTRAL_DEFAULT_ROUTINE` (= `[STRENGTH_KEY]`) + `resolveProfileRoutine` — the one pairing site.                                                                                                                                                                                                                                                                                |
| `apps/web/lib/dal/profiles.ts`                             | EDIT   | One line: `routine: resolveProfileRoutine(row.routineConfig)`. Comment updated.                                                                                                                                                                                                                                                                                                 |
| `apps/web/lib/constants.ts`                                | EDIT   | `PICKER_EMPTY_COPY` (static strings, incl. `setupAnchor`) + `CTA_CLASS` moved here from `app/page.tsx`.                                                                                                                                                                                                                                                                         |
| `apps/web/app/page.tsx`                                    | EDIT   | Import `CTA_CLASS` instead of declaring it (second occurrence → extract).                                                                                                                                                                                                                                                                                                       |
| `apps/web/components/profiles/picker-empty-state.tsx`      | NEW    | The explained empty state. Pure sync Server Component, no ids, no props.                                                                                                                                                                                                                                                                                                        |
| `apps/web/app/p/page.tsx`                                  | EDIT   | ~5 lines: branch the subhead, swap `<EmptyState>…` → `<PickerEmptyState />`. Deliberately small — TEN-1 1b rewrites this file.                                                                                                                                                                                                                                                  |
| `packages/db/src/seed.ts`                                  | EDIT   | `SEED_FULL_ROUTINE` written onto profile 1 (NULL today) so every e2e fixture keeps its surfaces.                                                                                                                                                                                                                                                                                |
| `packages/db/scripts/corrections/registry.ts`              | EDIT   | `null-routine-to-full-2026-10-07` — guarded, idempotent, dry-run; writes `SEED_FULL_ROUTINE` to live `NULL` rows.                                                                                                                                                                                                                                                               |
| `packages/db/scripts/corrections/README.md`                | EDIT   | The new row in the Applied table (`pending`).                                                                                                                                                                                                                                                                                                                                   |
| `apps/web/scripts/screenshot-ephemeral.ts`                 | EDIT   | `--state no-profiles` (soft-delete seeder) so the screen can be captured.                                                                                                                                                                                                                                                                                                       |
| `apps/web/app/design/tokens/inventory.tsx`                 | EDIT   | `<PickerEmptyState />` in `SurfacesCell` → real axe in both themes + the 360px overflow check.                                                                                                                                                                                                                                                                                  |
| `apps/web/e2e/a11y.spec.ts`                                | EDIT   | A 360px `expectNoHorizontalOverflow` for the picker (the coverage the first draft wrongly claimed existed).                                                                                                                                                                                                                                                                     |
| `apps/web/app/p/[profileId]/routine/page.tsx`              | EDIT   | Delete the comment false since V1-23 D3 ("Reachable by URL only — NOT linked from the kid's Today").                                                                                                                                                                                                                                                                            |
| `apps/web/components/profiles/picker-empty-state.test.tsx` | NEW    | jsdom/RTL (`profile-tile.test.tsx` pattern): structure, one `<h2>`, one link, its href, no `target`.                                                                                                                                                                                                                                                                            |
| `apps/web/lib/routine/catalog.test.ts`                     | EDIT   | The neutral default + `resolveProfileRoutine`'s two behaviours.                                                                                                                                                                                                                                                                                                                 |
| `apps/web/lib/routine/contract.test.ts`                    | EDIT   | The defaulted arg: 2-arg back-compat, explicit default, default∩membership, never-blank.                                                                                                                                                                                                                                                                                        |
| `apps/web/lib/constants.test.ts`                           | EDIT   | The one literal-pinning contract test: `README.md` contains the heading `setupAnchor` points at.                                                                                                                                                                                                                                                                                |
| `README.md`                                                | EDIT   | `## Adding an athlete` — the honest answer the control links to.                                                                                                                                                                                                                                                                                                                |
| `docs/features/programming.md`                             | EDIT   | Owns `shared/routine.ts` + `app/p/[profileId]/routine/`: the membership-vs-default split, the never-written invariant, the Mermaid node, the stale V1-18/V1-23 line. Also **adds `apps/web/lib/routine/` to `owns:`** — the most invariant-dense file in the feature is guarded by no guide today.                                                                              |
| `docs/features/write-path.md`                              | EDIT   | Owns `apps/web/lib/dal/`: `getProfileByPublicId` now resolves against two lists. (CI-enforced — the first draft would have failed `guides:check`.)                                                                                                                                                                                                                              |
| `docs/plan.md`                                             | EDIT   | ONB-0 row: fix the stale citation, mark done, record what PROF-1 / ONB-2 / CAT-1 / OPS-2 must finish. **ONB-2's row** (it claims ONB-0 delivers "a neutral routine that includes `shot`", which it does not) and **TEN-1's first-run sub-bullet** (stale twice: OSS-2 moved the empty state to `/p`, and ADR 0006 was accepted session-only, so there is no `/<household-id>`). |
| `docs/tech-debt.md`                                        | EDIT   | One entry: the light-mode focus ring measures ~2.59:1 against `background`, under SC 1.4.11, and the test that looks like it checks this only iterates the candidate sets.                                                                                                                                                                                                      |
| `docs/status.md`, `docs/roadmap.md`                        | EDIT   | Pointer + the Onboarding & Access "Next" row.                                                                                                                                                                                                                                                                                                                                   |
| `docs/changelog/2026-10-07-fix-onb-0-first-run.md`         | NEW    | The fragment.                                                                                                                                                                                                                                                                                                                                                                   |
| `docs/plans/onb-0-first-run.md`                            | NEW    | This file.                                                                                                                                                                                                                                                                                                                                                                      |

Untouched on purpose: `validateRoutineForWrite`'s behaviour, `apps/web/app/p/[profileId]/actions.ts`,
the routine editor, the write path, every catalog, `components/ui/empty-state.tsx`, and all nine
existing `contract.test.ts` call sites.

## Test plan

Unit (`pnpm verify` → vitest, node + jsdom):

- `catalog.test.ts` — the exact ordered list (`[STRENGTH_KEY]`) as the **one** sanctioned
  literal-pinning assertion; a strict subset of `ROUTINE_CATALOG`; contains **no** key whose
  `CheckinField.activityKey` is `brush_teeth` / `rice_bucket` / `brain_rep` / `splits` and no `life:`
  key, asserted through `ACTIVITY_TYPE_KEYS` rather than re-typed strings;
  `resolveProfileRoutine(null)` → exactly the neutral default, and `resolveProfileRoutine(<a config
naming brush_teeth>)` keeps it (the maintainer's-household guard).
  _Deliberately not asserted:_ "every key is in `ROUTINE_CATALOG`" and "the order is the catalog's" —
  both tautological against a list this small, so they test nothing.
- `contract.test.ts` — a 2-arg call behaves exactly as today (back-compat); an explicit third list is
  used for the null / garbage / wrong-version / all-stale paths; a default key outside the catalog is
  dropped; an **empty** default falls back to the catalog, so Today is never blank.
- `SEED_FULL_ROUTINE`'s keys equal `ROUTINE_CATALOG` exactly, so the hand-authored literal in
  `packages/db` cannot drift from the app-side catalog.
- `picker-empty-state.test.tsx` — exactly one `<h2>` (not an `<h1>`), three paragraphs, exactly one
  link, its `href` is `${GITHUB_REPO_URL}${PICKER_EMPTY_COPY.setupAnchor}`, no `target` attribute.
- `constants.test.ts` — `README.md` contains the `## Adding an athlete` heading the anchor slugifies
  to. This is a real guard, unlike the first draft's claim that `pnpm verify` link-checks markdown: it
  does not (`format:check · lint · typecheck · test · db:verify · skills:check · actions:check ·
guards:test · audit:check`), and `skills:check` only validates paths cited by `.claude/skills/`.

e2e (`pnpm e2e:local`): the whole suite must stay green — which is the real test of the seed fix, since
`global.setup.ts` and the V0-11 smoke both drive habits and a `brush_teeth` metric on profile 1. Plus
the new picker 360px overflow assertion, and `/design/tokens` (already axe-scanned in both themes, now
including this block).

Manual: `pnpm --filter web screenshot:ephemeral /p --state no-profiles --build`, and again with
`--theme dark`.

## Risks / rollback

| Risk                                                                      | Mitigation                                                                                                                                                                      |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Narrowing the fallback also narrows membership and strips authored items. | Membership stays `ROUTINE_CATALOG`; two separate parameters; `contract.test.ts` + `catalog.test.ts` assert an authored non-default key survives.                                |
| **Seed profile 1 / the live household is `NULL` and loses 16 controls.**  | **Verified NULL** (`seed.ts:112-119`). Explicit `SEED_FULL_ROUTINE` in the seed + the correction run **before** the deploy.                                                     |
| The correction runs twice, or on the wrong row.                           | `WHERE routine_config IS NULL AND deleted_at IS NULL`, targeted by `public_id`, one transaction, dry-run by default.                                                            |
| A new catalog row rejoins first run automatically.                        | The default is an explicit one-element list, not a filter over a namespace. A new activity reaches first run only by editing that line.                                         |
| The README anchor rots.                                                   | `constants.test.ts` pins the heading. (The first draft cited a markdown link check that does not exist.)                                                                        |
| PROF-1 deletes this control and the README section rots into a lie.       | Recorded on the ONB-0 row as PROF-1's to remove, alongside PROF-1's already-designed dashed `+` tile. This is **content** rot, which a link check would not have caught anyway. |
| The block ships unseen, or regresses unnoticed.                           | `--state no-profiles` for the screenshots; the `/design/tokens` cell for axe in both themes + 360px overflow.                                                                   |

**Rollback:** two independent reverts. The empty state is one component plus two lines in
`app/p/page.tsx`. The default is one wrapper — `resolveProfileRoutine` passing `ROUTINE_CATALOG` as the
third argument restores today's behaviour exactly. The correction is not rolled back and does not need
to be: it writes the routine the app renders today.

## Out-of-scope / deferred (and recorded on the rows)

- **PROF-1 — creating an athlete.** This PR routes to an explanation, not a creation path, and PROF-1
  removes both the explanation and the link when its dashed `+` tile lands.
- **ONB-2 — a curated default program (The Daily Five).** "Neutral" here means _nobody's routine_, not
  _a good routine_. Two amendments ONB-2 needs: its row claims ONB-0 delivers "a neutral routine that
  includes `shot`" — it does not (`shot` is only reachable as `checkin:brush_teeth:shot`, whose group
  label is the offending string; the `shots` activity exists but is outside `CHECKIN_FIELDS`' render
  scope, so giving it a neutral home is a render-scope change) — and ONB-2 must decide whether its
  prescribed push-ups / pull-ups co-exist with the calisthenics counters, which **CAT-1** says they
  must not.
- **CAT-1 — the metric/movement twins.** Excluding the counters here is consistent with CAT-1's trap
  (2) ("the default needs the criterion too") and deliberately does not pre-empt its named exclusion
  const, which belongs beside `CALISTHENICS_METRIC_KEYS`.
- **OPS-2 — splitting the reference seed from the household fixture.** `migrate.yml` seeds prod on
  every push to `main`, and the seed inserts two named fixture profiles — so a stranger who forks and
  deploys by the documented route reaches a picker with _two of the maintainer's kids_ on it, not this
  empty state. The empty state is correct and reachable (a migrate-only deployment, and every
  post-OPS-2 one); OPS-2 is what makes it the normal first screen.
- **`DEFAULT_PRACTICE_MINUTES`'s one-tap 90.** Dropping `life:wrestling_practice` from the default
  keeps it out of a stranger's day; it rejoins once the button states what it writes
  (`Wrestling practice · 90 min`) or takes a duration.
- **The `ring` token's light-mode contrast** (~2.59:1 vs `background`, under SC 1.4.11) — pre-existing,
  affects every focusable control, recorded in `docs/tech-debt.md` rather than fixed here.
- **No auth, scoping or DAL household behaviour.** TEN-1 / AUTH-1.

## Open questions

None. The committed UX panel's four questions for the maintainer are answered in the log below (Q1
pushed back, Q2 accepted, Q3 answered with the panel's own candidate, Q4 deferred to CAT-1 / ONB-2).

## Review-response log (adversarial panels)

### UX panel, round 1 (2026-08-26, [committed](./onb-0-first-run-ux-panel.md))

That panel ran before implementation and left four questions open. Reconciled here, including its two
BLOCKING resolutions — one of which this plan **pushes back on**.

| #      | Lens  | Critique → this plan's verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------ | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A1** | ID    | **PUSHED BACK** (the panel had accepted splitting into ONB-0a / ONB-0b). Three reasons: (a) the row was re-stated on 2026-10-07 when ONB-0 was pulled forward, and it bundles both halves as one P0; (b) A1's premise — "defect (b) is unreachable until profile CRUD" — is **false on `main`**: seed profile 1's `routine_config` is NULL, so the inherited default has a live user today; (c) the default half is one wrapper and one const, and splitting it costs a review cycle and a second panel for ~10 lines. The halves also share the seed + correction work, which cannot be split. |
| **A2** | ID    | **Accepted, and taken as the answer to Q3.** The default is `['strength']` — A2's own candidate ("weigh-in + strength only"), since the weigh-in is pinned by construction. Not a rename: ~17 controls → 1.                                                                                                                                                                                                                                                                                                                                                                                     |
| **A3** | ID    | **Accepted as folded.** `brush_teeth` is not renamed (a CSV-facing key); it simply leaves the default. Rename stays ONB-1 open question 3 / CAT-2 territory.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **A4** | ID    | **Accepted.** No fake affordance: the explanation carries the answer and the one link names its destination. Note A4's "the editor is unreachable anyway (V1-20)" is itself now stale — V1-23 D3 linked it from Today.                                                                                                                                                                                                                                                                                                                                                                          |
| **A5** | ID    | **Accepted** — the copy addresses the person who deployed it ("this deployment's seed data"), not a parent who cannot yet reach the screen.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **B1** | a11y  | **Accepted, resolved differently.** The panel's fix was "CTA as phrasing content or a sibling, inside `EmptyState`". This plan leaves `EmptyState` entirely: a `<p>` cannot host an `<h2>` + sibling paragraphs, and the explained state needs them. `EmptyState`'s two callers are untouched.                                                                                                                                                                                                                                                                                                  |
| **B2** | a11y  | **Accepted.** No inline text link: a `Button asChild` with `min-h-11` in its base, and `expectLinkTapTargets` already measures links on the picker with no `expected` count, so it covers this one for free once the state is reachable.                                                                                                                                                                                                                                                                                                                                                        |
| **B3** | a11y  | **Accepted.** `<h2>` under the existing `<h1>`, no skipped level, one `<h1>`. The `<h1>` string is unchanged because the gate helper and four specs assert through it; the **subhead** is what branches.                                                                                                                                                                                                                                                                                                                                                                                        |
| **B4** | resp. | **Accepted, done above.** 328 / 312 / 296px at 100 / 150 / 200%, and it found a real defect: the button's inherited `whitespace-nowrap` overflows at 150%, fixed by reusing the landing's `CTA_CLASS`.                                                                                                                                                                                                                                                                                                                                                                                          |
| **B5** | a11y  | **Accepted, and its scope note is now spent.** The panel allowed a bare `<p>` "if ONB-0a's content is short enough"; this content is three paragraphs, so it gets real markup, exactly as B5 required for that case.                                                                                                                                                                                                                                                                                                                                                                            |
| **C1** | trust | **Accepted.** Every string is phraseable as a statement of fact (R20). "It doesn't write the plan" is the strongest honest line available and it is literally true.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **C2** | trust | **Accepted** — resolves with A2. The burden goes from ~17 unexplained controls to a weigh-in and a strength form.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **C3** | trust | **Noted.** Round 2's lens 3 did find purchase (U13–U17), so it is no longer true that this lens has little.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

### Engineering panel, round 2 (2026-10-07) — correctness · scope · architecture · reuse

| #   | Lens                               | Critique (short)                                                                                                                                                                                  | Verdict      | Resolution                                                                                                                                                                                                                                                                                        |
| --- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | Correctness · Scope · Architecture | Seed profile 1's `routine_config` IS NULL; the draft's risk row claimed otherwise. Breaks `global.setup.ts` + the V0-11 smoke, and regresses the live household.                                  | **accepted** | The headline fix of this revision: explicit `SEED_FULL_ROUTINE` on profile 1, a guarded correction for live `NULL` rows, deploy order stated. Risk row rewritten to the truth.                                                                                                                    |
| E2  | All four                           | `validateRoutineForWrite` calls `resolveRoutine` with two args, so a required 3rd arg does not compile — and the draft called it "untouched".                                                     | **accepted** | Parameter is **defaulted**. The write validator and `actions.ts` are now genuinely untouched, and all nine existing test call sites keep working.                                                                                                                                                 |
| E3  | Scope                              | A required 3rd arg is 11 call sites of churn and does not buy the safety claimed — `resolveRoutine(raw, CATALOG, CATALOG)` typechecks and _is_ the bug.                                           | **accepted** | Defaulted param + a single `resolveProfileRoutine` wrapper, so no caller passes either list by hand. Also shrinks the diff in the TEN-1-1b file.                                                                                                                                                  |
| E4  | Architecture                       | Better still: return `RoutineConfig \| null` and let the caller own the fallback — no transposable pair, and the `??` is a type error if forgotten.                                               | **rejected** | Genuinely cleaner, but it is a return-type change to a `shared` export touching 11 sites including the write validator whose contract existing tests pin. The hazard it removes has **one** production call site, and that site is the wrapper. Revisit if a second consumer appears.             |
| E5  | Correctness · Architecture         | The split retires two documented postconditions: `default ⊆ catalog`, and "never a blank Today".                                                                                                  | **accepted** | The fallback is intersected with the membership set and falls back to the catalog when empty — both postconditions structural again, plus two `contract.test.ts` cases.                                                                                                                           |
| E6  | Correctness · Architecture         | `guides:check` fails: `write-path.md` owns `apps/web/lib/dal/`.                                                                                                                                   | **accepted** | Added. Architecture also found `apps/web/lib/routine/` is owned by **no** guide — added to `programming.md`'s `owns:`.                                                                                                                                                                            |
| E7  | Correctness                        | Catalog-derived labels in `lib/constants.ts` would break that module's zero-dependency rule and risk dragging the catalog into the Edge proxy bundle.                                             | **accepted** | Moot: the label preview is cut (E9). `PICKER_EMPTY_COPY` is static strings only.                                                                                                                                                                                                                  |
| E8  | All four                           | "`pnpm verify`'s link checks cover committed markdown" is false — there is no markdown link check.                                                                                                | **accepted** | Claim deleted; replaced with a real `constants.test.ts` assertion binding the anchor to the README heading.                                                                                                                                                                                       |
| E9  | Scope · Reuse · UX 1 · UX 2        | The routine-label preview is a feature the row did not ask for, and it drags in a label-lookup helper, a magic `3`, a joiner and a literal ellipsis.                                              | **accepted** | Cut entirely. "What happens next" is one generic sentence. This also removes E7 and Reuse's parameterised-`routineCatalogItems` ask — and, as architecture noted, it removes a copy string CAT-1 would later have silently rewritten.                                                             |
| E10 | Scope                              | The draft attributed a "closest honest destination" clause to the ONB-0 row; `grep` finds it nowhere in `docs/`.                                                                                  | **accepted** | Removed. The judgement is now stated as this plan's own, and the committed UX panel's **A4** is cited instead — which actually does settle it.                                                                                                                                                    |
| E11 | Scope                              | Delete the README section + the external link; the sentence alone stops the reader hunting for a button.                                                                                          | **rejected** | R2 asks for a control, the DoD asks an empty state to be complete, and two UX lenses wanted a destination-named link kept. The rot concern is answered with a real test (E8), and the section is the only documented answer for the one person who can act.                                       |
| E12 | Scope · Reuse                      | Drop the tautological assertions (⊆-catalog, catalog order, re-asserting rendered copy).                                                                                                          | **accepted** | Dropped, and the remaining list names what each one can actually fail on.                                                                                                                                                                                                                         |
| E13 | Reuse                              | `ATHLETE_SETUP_URL` invents a second spelling of "repo URL + anchor".                                                                                                                             | **accepted** | `PICKER_EMPTY_COPY.setupAnchor`, composed at the use site exactly like `LANDING_COPY.sourceAnchor`.                                                                                                                                                                                               |
| E14 | Reuse                              | The allowlist re-derives two of `ROUTINE_CATALOG`'s segments instead of using `classifyRoutineKey`.                                                                                               | **accepted** | Moot in the better form: the default is an explicit one-element list, so nothing is derived or re-derived.                                                                                                                                                                                        |
| E15 | Reuse                              | The new block is a fourth bespoke container; widen `EmptyState` or site it beside `ErrorState`.                                                                                                   | **rejected** | UX lens 2 measured the only container token at 1.26:1 — the box is cut, so there is no container to reuse. The component is copy and structure only; `EmptyState` keeps both its callers.                                                                                                         |
| E16 | Reuse                              | Interpolate `APP_NAME`; match the house "can't be fixed in the app yet" phrasing family.                                                                                                          | **accepted** | Both.                                                                                                                                                                                                                                                                                             |
| E17 | Architecture                       | The app-side home for the list is right, **but only if** the neutral default is never written — otherwise it must migrate to `shared` with its registries.                                        | **accepted** | The invariant is now in the plan, in the const's doc comment, and in `programming.md`: `routine_config = NULL` _is_ the neutral default; PROF-1 / TEN-1 / ONB-2 leave it NULL. Architecture also named the counter-precedent that makes this easy to break by accident (`SEED_SCARLETT_ROUTINE`). |
| E18 | Architecture                       | **CAT-1 corner:** the calisthenics counters twin the movements and double-count adherence; CAT-1's trap (2) says the default needs the criterion too, and ONB-2 prescribes push-ups and pull-ups. | **accepted** | Dissolved by the `['strength']` default. Recorded on the ONB-2 row, since ONB-2 must still decide the co-existence question.                                                                                                                                                                      |
| E19 | Architecture · UX 1 · UX 3         | `...LIFE_ACTIVITY_KEYS.map(...)` is a default-**open** hole inside a default-closed argument.                                                                                                     | **accepted** | Moot: no `life:` key is in the default.                                                                                                                                                                                                                                                           |
| E20 | Architecture                       | `first-run.tsx` in `components/profiles/` over-claims; ONB-2 adds first-run copy on Today.                                                                                                        | **accepted** | Renamed `picker-empty-state.tsx` / `PickerEmptyState`; `components/onboarding/` noted as the home when a second first-run surface lands. Folder confirmed right.                                                                                                                                  |
| E21 | Architecture                       | `programming.md`'s Mermaid node says "resolveRoutine — NULL → the default", now ambiguous.                                                                                                        | **accepted** | Node updated; the PR-description diagram agrees with it.                                                                                                                                                                                                                                          |
| E22 | Scope · Architecture · UX 1        | The empty state is uncapturable by any committed tooling, so acceptance demands screenshots that cannot be taken.                                                                                 | **accepted** | `--state no-profiles` added to the file-by-file table.                                                                                                                                                                                                                                            |
| E23 | Architecture                       | PROF-1 has already designed the real affordance (a dashed `+` tile at the picker's foot) and will delete this control.                                                                            | **accepted** | Recorded on the row, and used as the argument against shipping a disabled button now.                                                                                                                                                                                                             |
| E24 | Correctness                        | The draft's "fails loudly if a catalog key is renamed" test is a tautology against the filter that produces the list.                                                                             | **accepted** | Replaced with one exact-list assertion (the sanctioned literal) plus the exclusion assertions, which can fail.                                                                                                                                                                                    |
| E25 | Correctness                        | Line-number drift: `:36` vs `:37` for the empty-state string; `:117` vs `:100` for the null path.                                                                                                 | **accepted** | Both corrected; both `routine.ts` fallback lines now cited.                                                                                                                                                                                                                                       |
| E26 | Architecture                       | TEN-1's first-run sub-bullet is stale twice over (the empty state moved to `/p` at OSS-2; ADR 0006 was accepted session-only, so there is no household path segment).                             | **accepted** | Corrected in `docs/plan.md` while that file is open — it is the note TEN-1 will read.                                                                                                                                                                                                             |
| E27 | Architecture                       | With the parameter defaulted, `validateRoutineForWrite` keeps catalog-as-default, which is correct and should say so.                                                                             | **accepted** | One comment on `routine.ts:141`, so nobody threads the neutral list through a reject contract that compares against the catalog.                                                                                                                                                                  |

### UX panel, round 2 (2026-10-07) — three lenses, one each

| #   | Lens         | Critique (short)                                                                                                                                                                       | Verdict             | Resolution                                                                                                                                                                                                       |
| --- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1  | 1 · 3 · arch | Open question 1 (link the routine editor from Today) is **already shipped** — `app/p/[profileId]/page.tsx:350-363`, V1-23 D3. The draft reasoned from a stale docstring.               | **accepted**        | Question and out-of-scope bullet deleted; the stale comment at `routine/page.tsx:16-17` is fixed in this PR. Measured recovery: 1 tap to the editor, then 1 toggle per item, and Save is disabled at zero items. |
| U2  | 1            | `PICKER_COPY.subhead` instructs the reader to pick from an empty list, and the screen uses three nouns for one object.                                                                 | **accepted**        | The subhead branches to `PICKER_EMPTY_COPY.subhead`; "athlete" throughout the block; the `<h1>` left alone because five specs assert through it.                                                                 |
| U3  | 1            | The control's copy addresses a parent while its destination addresses a developer; and "run `db:seed`" would install the maintainer's named minors into a stranger's deployment.       | **accepted**        | Copy addresses the deployer (A5); the README section warns explicitly that the committed rows are fixtures and points at the existing sections rather than restating commands.                                   |
| U4  | 1            | `vsit_skill_step` is a max-aggregated _level_ in a scheme that lives in one household's head — the same class as `rice_bucket`. The unit of neutrality is the field, not the activity. | **accepted**        | Moot and then some: no calisthenics metric is in the default. The "unit of neutrality" point is what killed the per-activity allowlist.                                                                          |
| U5  | 1 · 2 · 3    | The "what this app is" sentence is a third paraphrase of `LANDING_COPY.lead` and silently changes the audience noun.                                                                   | **partly accepted** | Rewritten to say what the landing **cannot**: what the app _does_, and that it does not write the plan. Not a paraphrase of the audience claim, and it earns its line on this screen.                            |
| U6  | 2            | The draft claimed the picker has "no 360px overflow" coverage; `expectNoHorizontalOverflow` is opt-in and no call site is the picker.                                                  | **accepted**        | Claim corrected, and the assertion added rather than the claim deleted.                                                                                                                                          |
| U7  | 2            | No classes were specified, and every default an implementer would reach for is a measured-failing pair; the box's only token is 1.26:1.                                                | **accepted**        | Tokens and classes pinned in the plan: no box, `text-foreground` for the explanatory paragraphs, muted only for the short line, `bg-muted` under `text-muted-foreground` forbidden with the reason.              |
| U8  | 2            | The CTA inherits `whitespace-nowrap` and overflows at 150% text size; the landing already solved it.                                                                                   | **accepted**        | `CTA_CLASS` extracted to `lib/constants.ts` and imported by both screens; the arithmetic is in the plan.                                                                                                         |
| U9  | 2            | "Component test + already-gated primitives" is not an adequate axe mitigation, and the obvious e2e fix is a `fullyParallel` race.                                                      | **accepted**        | `<PickerEmptyState />` in `SurfacesCell` buys real axe in both themes and the 360px per-cell overflow check. The e2e trap is written into the plan so nobody tries it.                                           |
| U10 | 2            | Add a jsdom `axe-core` run to the component test as well.                                                                                                                              | **rejected**        | `axe-core` is not hoisted into `apps/web/node_modules` (pnpm strict), so it means a new direct devDependency for structural coverage the harness cell already gets in a real browser, with contrast.             |
| U11 | 2            | Name the destination in the link text; same tab, no `rel` needed.                                                                                                                      | **accepted**        | "— on GitHub", same tab, which also makes U8's wrap fix mandatory rather than optional.                                                                                                                          |
| U12 | 2 · 3        | `max-w-prose` on the prose.                                                                                                                                                            | **accepted**        | On the section.                                                                                                                                                                                                  |
| U13 | 1 · 3 · arch | `life:wrestling_practice` gives every new household a one-tap, invisible, unrecoverable 90-minute claim on a minor's health record, with no in-app undo.                               | **accepted**        | Dropped from the default. `plan.md`'s standing ruling names ONB-0 as the owner of exactly this distinction, so it was this row's call to make, not a panel question — which closes draft open question 2.        |
| U14 | 3            | "A day starts with X" is phraseable as neither "your sheet says X" nor "you logged X" — it fails R20's own test.                                                                       | **accepted**        | Rewritten so the subject is the _setting_, not the day: "their day starts with a weigh-in and strength, and you add the rest from their routine editor."                                                         |
| U15 | 3            | "Add an athlete and their day shows up here" is an imperative for an action the app does not have, two lines before admitting it.                                                      | **accepted**        | Leads with the state; the imperative is gone.                                                                                                                                                                    |
| U16 | 3            | Verified the counters carry no dose (`CALISTHENICS_RAMP_SCHEDULE = []`), so the app authors nothing — only the copy could imply one.                                                   | **noted**           | Kept as the reason the copy was the only place a dose could leak, which U14 fixes. Moot for the default itself now.                                                                                              |
| U17 | 1 · 3        | "daily reps" implies a cadence the app is not prescribing; "practice time" was only honest once the app stopped supplying the minutes.                                                 | **accepted**        | "rep counts" and "time at practice".                                                                                                                                                                             |

### Round 3 — re-review

The two reshapes that moved the plan materially are A2 / E18 / U4 / U13 (the default collapsing to
`['strength']`) and E1 (the seed + correction). Both were raised by more than one independent lens, and
each resolution is _narrower_ than the draft, so no reviewer's blocking concern survives in a form that
needs another round. Five pushbacks are deliberate and stand on the record: **A1** (do not split the
row), **E4**, **E11**, **E15** and **U10**.
