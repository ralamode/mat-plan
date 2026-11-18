# FAM-1 7b — the program builder's real pages

> Backlog: [plan.md](../plan.md) row `FAM-1`; plan row **7b** in
> [fam-1-family-program](./fam-1-family-program.md). Lane B. Branches `feat/fam-1-7b-i-…`,
> `-7b-ii-…`, `-7b-iii-…`. **Plan only:** no code until the maintainer approves it.

## Where this sits

- **Pillar:** FAM-1 (the family program), lane B (builder).
- **Milestone:** [FAM-1](../milestones/fam-1-family-program.md), step 7b, "Wiring II". The builder's
  screens (8a to 10b) and its actions (7a-i, 7a-ii) are merged and run only on the design preview.
  7b puts them on real, session-gated pages.
- **Gates:** 7a-ii (merged, #586), 8a and 8 (merged), C35 (merged, #595), and **6c-ii** (lane P;
  the list and view reads, plus `readProgramsByAthlete` for step 15). Lane P's caps in the writers
  are not a gate for 7b: the fake and the actions already answer `limit_reached`.
- **After it:** 15 (put on and take off), which also puts each athlete's programs on their Home tile.
  That moved from 7b, a decision by the spec owner under the maintainer's overnight delegation on
  2026-11-18; see the review log.
- _Roadmap alignment (2026-11-18): advances FAM-1 (step 7b). It adds no column or scope. Every new
  read goes through `getHouseholdScope()`, and `ID-1`'s six items are answered in the log. Checked
  against the private roadmap; nothing to add here._

## Goal

A parent can open **Programs** from Home and, on real pages backed by the household's own data:

- see their programs;
- open one and see its workouts and its week;
- create, rename and copy;
- open a workout, edit it in the full-screen picker (with "How to" on library rows) and save it.

They do this with the screens and actions already merged and tested on the preview. Nobody can be
put on a program yet (step 15), so nothing here changes what an athlete's day page shows.

## Acceptance

From plan row 7b (`fam-1-family-program.md:594`), as amended by the spec owner on 2026-11-18 (Home
tiles move to step 15): four thin pages, the list and view reads behind the DAL, and Home's Programs
link. Owed tests: an e2e on a phone that builds a program, and the a11y scan. Done when:

- **`/programs`, `/programs/[programId]`, `/programs/[programId]/workouts/[workoutId]` and
  `/programs/[programId]/workouts/new` exist**, each a Server Component that:
  1. calls `await requireSession()`, which `pages-need-a-session.test.ts` enforces;
  2. loads through `lib/dal/program/`;
  3. mounts one lane B screen with `PROGRAM_ACTIONS`.
- **A program or workout id that is not the household's**, or not a uuid, gives `notFound()`. The DAL
  reports the miss once (`reportProgramMiss`), as 7a-i does.
- **Home** (`app/p/page.tsx`) gains a "Programs" link in its `Household` nav, beside Settings.
- **"How to" works on real pages.** The workout pages pass a loader backed by a session-gated Route
  Handler that resolves the id among the caller's own picker options. See §How to; this was decided
  by the spec owner on 2026-11-18.
- **Every `limit_reached` reaches the person in that screen's own words** (§Caps). **The week editor
  stops "+ Add" on a day that holds `MAX_DAY_SLOTS`**, so the screen never offers what the server
  refuses.
- **The stay-dark pin lifts** (`program-tables-stay-dark.test.ts:318`). Its `OWED_AT_7B` list is
  delivered in the same PR that first imports the actions from a page (§Privacy).
- **e2e** `apps/web/e2e/program-builder.spec.ts`: on a phone, create a program, add a workout with
  two items, save, rename, and copy the workout. `program-builder.a11y.spec.ts` (or `ROUTES` in
  `a11y.spec.ts`) scans the four routes at `NARROW_VIEWPORT`. The guide's `owns:` gains the spec
  file.
- **The owed `it.todo`s** for 7b in `components/program-builder/owed.test.ts` (`:21`, `:23`, `:24`,
  `:36`) become tests. The Put-on half of `:39` moves to step 15, because the dialog cannot open
  without `putOn`.

## The split (three PRs, one concern each)

| PR                                      | What                                                                                                                                                                                                                                                                                                    | Why this order                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **7b-i: the list and program pages**    | The DAL wrappers for 6c-ii's list and view reads. `/programs` and `/programs/[programId]`. Home's Programs link. The stay-dark pin lifts and **the whole privacy `OWED_AT_7B` list** ships here, because this is the first page to import `PROGRAM_ACTIONS` (create, rename and copy become reachable). | The smallest page that makes writes real; the privacy debt must ride with it |
| **7b-ii: the workout pages**            | `/programs/[id]/workouts/[workoutId]` and `/new`. The "How to" Route Handler. `program` passed to the editor. Per-screen `limit_reached` words and the week editor's day stop. `getWorkoutDraft` through `quietDbErrors`.                                                                               | Needs 7b-i's layout and links                                                |
| **7b-iii: the e2e and the a11y routes** | `program-builder.spec.ts`, the four routes in the a11y scan, the guide's `owns:`, and the e2e-only `it.todo`s (the "n items added." timing; the Copy dialog at 360px).                                                                                                                                  | Runs on all four pages                                                       |

Each PR is under 400 lines; the estimate is about 250, 300 and 200 lines of code and tests.

## Design

### Pages (Server Components, thin)

```tsx
// app/programs/page.tsx (7b-i)
export default async function ProgramsPage() {
  await requireSession();
  const today = localDayIso(await getActiveTimeZone()); // the day page's pattern
  const programs = await getProgramList(today); // lib/dal/program/reads.ts
  return <ProgramsListScreen programs={programs} actions={PROGRAM_ACTIONS} />;
}
```

- **Time:** the page reads the time zone and passes the day and time zone to the DAL. AGENTS.md says
  only routes and actions read the tz cookie, never `lib/dal`.
- **`[programId]`:** `getProgramView(programId, { today, tz })`, and `notFound()` on `null`.
- **The workout page:**
  - `getWorkoutDraft(programId, workoutId)` (7a-i);
  - `getItemPickerData()` (7a-ii, its first consumer);
  - `program` = the `ProgramListEntry` for this id, taken from `getProgramList(today)`; this
    discharges `owed.test.ts:21`;
  - `howTo` = the client loader (§How to).
- **The new-workout page:**
  - `newWorkoutDraft(programPublicId)` (**NEW**, `lib/dal/program/reads.ts`): a pure builder of the
    contract's empty draft, with a fresh `newId()` client id;
  - it checks the program is the household's first (`programIn`), so a foreign id gives `notFound()`.
- **Layout:** `app/programs/layout.tsx` (**NEW**) holds the shared `AppShell` with `nav` and
  `PROGRAMS_PATH` as the current section. `revalidatePath(PROGRAMS_PATH, 'layout')` (7a-i) already
  targets it.
- **`BuilderLinkPrefetch`:** real pages provide nothing, so Next's default prefetch applies (#593).

### DAL (`lib/dal/program/reads.ts`, lane B; following 7a-i's pattern)

```ts
export const getProgramList = cache(async (today: string): Promise<ProgramList | null> => …);
export const getProgramView = cache(async (programPublicId: string, at: { today: string; tz: string }): Promise<ProgramView | null> => …);
```

- **Order of checks:** `'server-only'`, then `getHouseholdScope()` (`null` without one), then a
  uuid check before any query (a bad id is `null` and reports nothing), then lane P's read through
  `quietDbErrors(op, …)`, then `reportProgramMiss` on a miss, then return the contract DTO (6c-ii
  parses it with the contract's schema).
- **The P2 found here:** `getWorkoutDraft` (7a-i, `reads.ts:23-33`) never went through
  `quietDbErrors`, which plan row 7a-i promised. 7b-ii fixes it, with a test that a failed read's
  parameters stay out of the thrown error.

### How to (7b-ii; decided by the spec owner, 2026-11-18)

- **Route:** `app/api/programs/how-to/[optionId]/route.ts` (**NEW**, `GET`), a read, so a Route
  Handler (AGENTS.md).
  1. It runs `requireSession()`, then `getHowTo(optionId)` (**NEW**, `lib/dal/program/picker.ts`).
  2. `getHowTo` resolves the id **among `getItemPickerData()`'s options for the caller's household**,
     finds the library entry by the DAL-only slug, and returns `catalogHowToOf(entry)`. The response
     is `{ name, instructions, supervision } | null`.
- **Not-found cases:** another household's id, an unknown id, a household item and a built-in with no
  library entry (K22) all give `null` (200, `null`). None of them is told apart from the others.
- **The slug never leaves the DAL**, and the option list still carries no instructions (P16, rule 11).
- **Logging:** none beyond the fact of a failure. No movement name and no id reach Sentry.
- **Client loader:** `howToLoader` (**NEW**, `components/program-builder/how-to-loader.ts`) is
  `(id) => fetch(…).then(r => r.ok ? r.json() : null)`. A failure gives `null`, and the picker
  already handles a `null` loader result.
- **Tests:**
  - the household scope (two households, one id);
  - `null` for the three no-entry cases;
  - the option list still has no `instructions` key;
  - unauthenticated → 401 or `null`, matching the other reads' boundary (security lens to confirm).
- **When it merges**, the test's name goes to the roadmap thread, which deletes its owed line in
  `catalog/owed.test.ts` ("P16: 'How to' reads the steps by slug").

### Caps (7b-ii): each screen's words for `limit_reached` (C35)

| Screen                      | Reachable when                                                        | Proposed words (for the trust lens)                                                                                                                                                     | Helper                  |
| --------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Workout editor, new workout | the program holds `MAX_PROGRAM_WORKOUTS` (50)                         | "This program has 50 workouts, the most it can hold. Nothing was saved."                                                                                                                | `saveRefusal`           |
| Copy dialog                 | copying into a program that holds 50                                  | "{Program} has 50 workouts, the most it can hold. Choose another program." It stays open; this replaces today's stale path, which wrongly says "changed somewhere else" (#603's review) | the dialog's own branch |
| Week editor                 | a day past `MAX_DAY_SLOTS` (30); unreachable once "+ Add" stops there | "A day holds up to 30 workouts."                                                                                                                                                        | `weekRefusal`           |
| "+ New item"                | the household holds `MAX_HOUSEHOLD_ITEMS` (500) own items             | "Your household has 500 items of its own, the most it can keep. Pick one from the list."                                                                                                | `newItemRefusal`        |
| Create or rename program    | never (no cap)                                                        | stays the generic failure                                                                                                                                                               | `nameRefusal`           |

- **No word offers a delete**, because none exists yet (the guide: "No deleting a workout or a program
  yet"). The numbers come from the shared consts, never re-typed.
- **The week editor's stop:** a day holding `MAX_DAY_SLOTS` shows "+ Add" `aria-disabled` (never
  `disabled`, which would drop focus), with the line above as its described hint. That matches the
  workout editor's `MAX_WORKOUT_ITEMS` stop.

### Privacy (7b-i; the `OWED_AT_7B` list, delivered in full)

Each of the six items in `program-tables-stay-dark.test.ts:285-292` is rewritten in `notice.md`,
`notice-content.ts` and `data-inventory.md`:

1. "Programs you build yourself": "coming" is removed.
2. "Three text boxes have no filter": recounted with a prescription's notes.
3. "Technical bits": a client id per item card.
4. Export omissions: built programs are not in the export.
5. A swapped item is hidden, not erased (D19).
6. Every inventory "until step 7b" sentence becomes "reachable".

Two more items:

- **The §4 re-read that 6c-ii's note asks for:** who is on each program, and since and through which
  day. The list and view now show it to every household member.
- **The `notice-content.ts` drift test** stays green.

The privacy lens reviews this PR's text against the code.

## Test plan

- **Vitest:**
  - DAL wrappers: no scope gives `null`; a bad uuid gives `null` and no report; a miss gives one
    report and `null`; the DTO passes through.
  - Pages: `requireSession` (the scan), and `notFound` on `null`, as async server components through
    the existing page-test pattern or e2e (AGENTS.md: async Server Components → Playwright).
  - How to's DAL and route.
  - Caps copy per screen, with the shared consts.
  - The week editor's day stop is `aria-disabled` at `MAX_DAY_SLOTS` and enabled at one less.
  - The stay-dark pin's replacement: pages may import the actions; no client component imports
    lane P's reads.
- **e2e (7b-iii):** as in Acceptance, in CI's `e2e` job, plus `pnpm e2e:local` once in the board's
  slot, on the seeded fixture world (`SEED_FIXTURES=1`).
- **Probes** for every new rule, before each PR.

## Risks / rollback

- **Writes become reachable (7b-i).** Mitigations:
  - every action re-checks the session, the household and its zod schema, with boundary matrices
    (7a-i, 7a-ii);
  - the rate limiter applies;
  - lane P's caps in the writers bound the growth.

  If 7b-i ships before lane P's caps PR, the actions' schemas still refuse a long day. The workout
  and item caps are then unenforced on the server (only the fake has them) until lane P's PR, so
  **7b-i waits for lane P's caps PR, or the board records that it doesn't.**

- **The real picker's tree is tiny until A2** (B3 plan, K22 to K24), which is expected.
- **Home's link is one more nav item.** The UX lens checks the 360px width math.
- **Rollback:** each PR reverts on its own. The pages are additive, and the stay-dark pin comes back
  with a revert.

## Out-of-scope / deferred

- Each athlete's programs on their Home tile: **step 15**, which `readProgramsByAthlete` (lane P,
  6c-ii) serves.
- `putOn` and `takeOff`, and the Put-on dialog's e2e: **step 15**.
- `programsHref` on the day page's "Not on a program yet" notice (`program-contract.md:243`). It is
  in **lane C's file**, so it is raised with the board and done in lane C's next PR.
- Deleting a workout or a program.

## Open questions

- ~~Q1: who builds "How to"?~~ **Decided (2026-11-18):** 7b-ii.
- ~~Q2: Home tiles?~~ **Decided (2026-11-18):** the Programs link only; tiles move to step 15.
- **Q3 (board):** does 7b-i wait for lane P's caps in the writers (§Risks)? Recommended: yes, if the
  caps PR is open by then; otherwise the board records the gap and its end date.

## Review-response log (adversarial panel)

_(Filled in after the engineering panel (correctness, scope, architecture, reuse, security,
privacy) and the UX panel (interaction, a11y/360, trust).)_
