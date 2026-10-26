# HIST-1 — an athlete's program history

> Backlog: [plan.md](../plan.md) row **HIST-1** (`plan.md:1987-2000`) · Spec:
> [crud-1-fix-it-yourself.md](../specs/crud-1-fix-it-yourself.md) chunk **D7** · Milestone:
> [PROG-1](../milestones/prog-1-programs-and-scheduling.md) (step 9, after step 7 · CLONE-1) ·
> Branch: `feat/hist-1-program-history`, preceded by `fix/hist-1-pre-past-day-program-card` (see
> Staging).
>
> **Status: draft, round 1 of both panels reconciled (log at the bottom). Gated on D5 (CLONE-1).**
> Nothing here can be implemented before `program_assignments` (SCHED-1 1c), its writer (ASSIGN-1,
> D4b) and CLONE-1 (D5) exist. Every claim below about those chunks is a claim about **their plans**,
> not shipped code, and is listed again under [Re-verify at start](#re-verify-at-start) so the
> implementer checks it against `main`.

## Goal

Answer _"what was this athlete doing in March, and how did it go?"_ on one read-only page,
`/p/<id>/program/history`: the athlete's programs **newest first**, each opening **what was
actually asked of them in that period** and linking to the days they logged in it, with a date box
underneath that names the program(s) open on any date (Q4, `spec:848`: _"Timeline first; each
period opens the program as it was and links to the days logged in it"_).

It is gated on CLONE-1 because before it no athlete changes program, so there is one period and
nothing to look back on (`spec:164`). It is **read-only**: no Server Action, no migration, no
Route Handler.

**The honest limit, stated up front, because the prototype hides it.** Nothing in this design
versions a program. A prescription edited **in place** — V1-22 chunk 4's value edit, or "save for
everyone" (criterion 22) — overwrites the row (`schema.ts:816-857`, no history table; `timestamps`
has no `$onUpdate`, `schema.ts:35-40`). So the page **cannot** show a whole program as it stood on a
past date, and it does not try. It shows the one true record of the past:

- **What each logged movement was asked** — `entries.prescribed_snapshot`, the rendered prescription
  frozen when the entry was written (ADR 0005 decision 5; column shipped dark in `0013`,
  `schema.ts:203-218`; written by V1-22 chunk 2, backfilled by chunk 3). That is what criterion 28
  means by _"the prescriptions as snapshotted"_ (`spec:338-341`).
- ⚠️ **"When written" is not always "when logged".** For a batch replayed through `/api/sync`, the
  snapshot is taken at **server receipt** against the program as it then stands (V1-22 spec
  acceptance 9, `v1-22-authoring-program-editing.md:65-68`). An offline session replayed after an
  edit carries the post-edit string. The page cannot detect this; the copy does not claim "exactly".
- **A prescription that was never logged has no snapshot**, so a skipped movement does not appear.
  The page says so in one line under "What was asked".

The program **as it is today** is one link per period ("Open {program} as it is today →"), to the
program page. It is never re-printed inside a past period. **A past version is genuinely
recoverable only through CLONE-1:** "save as a copy" + move leaves the source block untouched
(`plan.md:1934-1940`), so opening the old program shows what that athlete ran. "Save for everyone"
does not, which is why the link says "as it is today".

## Acceptance

Verbatim from the backlog row (`plan.md:1989-2000`):

> **HIST-1 — see what program an athlete was running on any past date.** _(Maintainer, 2026-10-08.)_
> "What was this athlete doing in March, and how did it go?" The data will exist once CLONE-1 ships
> (assignment rows with start and end dates, plus each entry's snapshotted prescription), but no screen
> shows it. Two candidate surfaces, for the UX panel to choose between or combine:
>
> - **a dashboard widget** (with V1-16 / DASH-1): a timeline of the athlete's programs; or
> - **a date selector on the program page:** pick a date and see that day's program as it was then.
> - **Gated on CLONE-1** (no assignment history exists before it). Which surface wins decides the
>   roadmap pillar: Insight for the widget, Authoring & Scheduling for the program page. It is filed
>   under Insight until then. **Owes** a UX panel and a plan.

And the spec criterion this chunk carries (`spec:338-341`):

> 28. **When** a parent opens an athlete's program history, the system **shall** list their
>     assignments newest first with start and end dates, each opening the prescriptions as snapshotted
>     and linking to the days logged in that period; **and when** they pick a date, **shall** name the
>     program(s) open on it, or say nothing was assigned. **(R1)** _(D7)_

Plus FE-9 (`spec:922`): _"A session logged before a move keeps the snapshot it was logged against;
HIST-1 attributes by snapshot, not by today's assignment."_

**Done when** (observable):

- `/p/<id>/program/history` lists the athlete's live assignment periods newest first. **Consecutive
  periods on the same program with no gap merge into one card** (a change of days is a new period,
  criterion 21, but to a parent it is still one program); a weekday change shows as a line inside it
  ("Days changed to Mon · Wed · Fri on Oct 3"). The raw periods stay in the DTO for the date answer.
- Each card's `<summary>` carries the program name, its inclusive dates (`active_to` NULL → "now"),
  its current weekdays Monday-first, and "{n} days logged". **All cards start closed**, except when
  there is exactly one.
- Opened, a card shows **"What was asked"**: per movement, the **latest** snapshot first and earlier
  ones as a compact run with their dates; `''` reads "no target recorded"; all NULL (never
  snapshotted) entries collapse into **one** line, "not recorded for {n} entries", never filled from
  the live program; and a line saying movements not logged are not shown.
- Opened, a card links to every day in it with at least one **live** entry, newest first, as
  `/p/<id>?d=<day>`, and to the program as it is today.
- A `GET` form underneath answers a date: it names the date, names the program(s) whose period
  contains it with a link to that card's `#period-<cardId>` (rendered open; `cardId` = the card's
  **first assignment's** public id, since one program can have two cards — a gap, or A → B → A),
  says whether the date was one of the athlete's days on it, or says nothing was assigned. On a
  move day it names the new program and adds "moved from {old} that day", matching where that
  day's entries sit (below). A malformed or future `?on` shows a
  visible line ("Pick a date up to today"), never a 500.
- A foreign or soft-deleted profile is a **404** (from `getProfileByPublicId`, ADR 0006).
- `apps/web/lib/dal/export.ts` and `packages/db/src/queries/export-month.ts` are **untouched**.
- **Prerequisite, HIST-1-pre:** the day page shows the live program card only on a writable day
  (±1) **whose program is the one the athlete is on now** — a closed past day, or yesterday when
  the athlete moved today, shows none — so a history day link never lands on today's prescription
  captioned as that day's.

## Staging

| PR             | Branch                                 | What                                                                                                                                                                          | ~lines (non-test / test) | Gate                                                                                     |
| -------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------- |
| **HIST-1-pre** | `fix/hist-1-pre-past-day-program-card` | The day page renders the live `ProgramReference` only on a writable day inside the athlete's current period. One condition in `page.tsx`, tests, screenshots of a closed day. | ~30 / ~40                | ASSIGN-READ (D4), whose read supplies the open assignment. Must merge **before** HIST-1. |
| **HIST-1**     | `feat/hist-1-program-history`          | The two scoped queries, the DAL, the pure shaping, `db:verify` proofs, the containment-guard amendment, the page, the date form, the link in, `dayHref`, the a11y test.       | ~360 / ~300              | D5 merged; [Re-verify](#re-verify-at-start) done; this plan's UX panel reconciled.       |

**Why HIST-1 is now one PR** (it was two). Cutting "This program now" and its staleness machinery
removed a query, a DTO branch, a writer-driven proof and their copy; the read is ~150 non-test lines
and the page ~210, under the ~400 target. A dark read PR would now review a ~150-line query with no
screen to judge it against.

**Why HIST-1-pre is its own PR.** It changes the day page every athlete opens, which is a
different review (the strength surface, its own screenshots) from a new page. Without it, a history
day link is a trap: `page.tsx:81-88` reads `getProgramDay(profile.id, resolveDayRole(day))` for **any**
viewed day, and `program-reference.tsx` renders it as that day's program, so a parent following
"Oct 3" sees today's loads under Oct 3's header. **Yesterday is the same trap** after a move: it is
writable (±1, `declared-day.ts:37`; `page.tsx:75`), and `getProgramDay` reads the live block
(`page.tsx:85-88`), so the card would show today's program for a day spent on the old one. So the
card is shown only when the viewed day is writable **and** on or after the `active_from` of the
athlete's open assignment(s) (ASSIGN-READ's read, D4). **Known limit, recorded:** a value edited
in place today still shows on yesterday's card when the program did not change — one day, on a day
the form below can still log, and the same block.

**No migration in either PR.**

## Design

### The read: an RSC page over the DAL, not a Route Handler

Server Component page → `lib/dal/program-history.ts` → single-sourced queries in
`packages/db/src/queries/program-history.ts`. That is the `getProgramDay` shape
(`apps/web/lib/dal/programming.ts:29-41`): `getHouseholdScope()`, a `uuidSchema` guard, the query, a
pure DTO mapper — and, like it, the **empty shape** (`{ periods: [] }`) for a null scope or a
malformed id. The 404 comes from the page's own `getProfileByPublicId` (`profiles.ts`, "This is the
gate"), as on the day page (`page.tsx:57-58`).

- **Rejected: a Route Handler.** AGENTS.md → Server conventions routes reads that are _external or
  batch_ to handlers; this has no external consumer, and a handler adds a public endpoint plus the
  client fetching the "don't" list forbids where an RSC works.
- **Rejected: a Server Action for the date box.** It is a read. A `GET` form gives a shareable URL,
  back-button behaviour, and zero client JS.
- **Rejected: a client island that answers as the date changes** (the prototype). Zero JS wins on a
  static page; the answer's placement is solved by a fragment instead (below).

### Two queries, both scoped

Both take `(profilePublicId, scope)` and use `isLiveProfile(profilePublicId, scope)`
(`packages/db/src/writers/ownership.ts:118-124`), the single-sourced BOLA predicate (programming
guide invariant 4; `program-day.ts:57-62`).

1. **`programPeriodRows`** — `program_assignments ⋈ program_blocks ⋈ profiles`, filtered
   `isLiveProfile(…)`, `program_assignments.deleted_at IS NULL`, and **`program_blocks.household_id =
profiles.household_id`** (SCHED-1's docblock admits that pairing is writer-enforced only,
   `sched-1-scheduling-model.md:297-299`; re-asserting it in the read means a mis-written assignment
   cannot surface another household's program name). Selects block public id + name, assignment public id (the card key),
   `active_from`, `active_to`, `created_at`, and the weekdays as `array_agg(weekday) FILTER (WHERE
weekday IS NOT NULL)` (a drizzle `sql` template over bound columns, never `sql.raw`). **The SQL
   owns the order** — `active_from DESC, program_assignments.id DESC` — and the pure layer preserves
   it.
   - **Block `deleted_at` is not filtered, on purpose.** A period that happened stays visible even if
     its block is later hidden; an Undo meant to erase a period must hide the **assignment** (FE-8,
     `spec:921`). Re-verify item 3 checks D4c/D5's Undo does.
   - **Archived blocks are not filtered** (criterion 27: the past renders as before). No `archived`
     field is added: an archived program's name is still its name, and RETIRE-1 can add a tag later.
2. **`periodEntryRows`** — one row **per live entry** of the profile with `activity_date` in
   `[(SELECT min(active_from) FROM the profile's live assignments), today + WRITABLE_DAY_RADIUS]`:
   `activity_date`, `created_at`, `movements.name` (LEFT JOIN, NULL for a non-movement entry) and
   `prescribed_snapshot`. Ordered `activity_date DESC, created_at DESC`. On
   `idx_entries_profile_date` (`schema.ts:246`).
   - **The upper bound is a constant, not `coalesce(max(active_to), today)`.** `max()` skips NULLs,
     so that expression ended the range at the newest **closed** period whenever one existed, and the
     open period lost every entry after it (correctness B1). `today + WRITABLE_DAY_RADIUS`
     (`declared-day.ts:37`) covers tomorrow's legal write; a day after `today` renders as text, not a
     link.
   - **Rows, not `(movement, snapshot)` groups.** Grouping with `min/max(activity_date)` would draw
     one line across every period between the first and last time a string appeared, including
     periods where nothing was asked (correctness B2). Per-entry rows are tens to hundreds at this
     household's scale; runs are merged in TS.
   - **Bodyweight values are never selected.** A weigh-in-only day contributes its date and nothing
     else (`SECURITY.md:118`).

Logged days come from the same rows, so there is **no third query**. `today` is
`getActiveLocalDay()` (`apps/web/lib/active-timezone.ts:23`), the athlete-local day — the same value
the day page computes inline (`page.tsx:64-65`).

### The second selector of `prescribed_snapshot` — a conflict, resolved openly

V1-22 acceptance 12 says _"Exactly one query selects it"_
(`v1-22-authoring-program-editing.md:74-76`), and chunk 2's plan enforces that with a source-scan
allow-list of five files and _"nothing under `apps/web/app/`"_
(`v1-22-2-renderer-and-writer.md:83-88`). `periodEntryRows` is a second selector, so HIST-1 **must**
amend that guard, and says so rather than dodging it (e.g. by renaming through a view):

- **The allow-list gains exactly one file**, `packages/db/src/queries/program-history.ts`, with the
  reason in the guard's comment: **display-only, read-only, never an input**. The acceptance's intent
  is that no **second meaning** of the snapshot exists (a second renderer, or a value reaching the
  form); a read for display keeps the one meaning. `apps/web/app/` still never names it — the DTO
  field is `asked`, mapped in `lib/programming/`.
- **The type wall gains a case.** A `@ts-expect-error` assertion (chunk 2's idiom) that
  `ProgramHistoryDTO` is not assignable to anything the log form, `ScaffoldRow` or a progression
  input accepts, and an import-scan case that nothing under `app/p/[profileId]/` except
  `program/history/` imports `lib/programming/program-history`.
- Recorded under [disagreements](#where-this-plan-disagrees-with-the-spec-the-row-or-the-prototype);
  the V1-22 spec's wording should become "exactly one **writer**; selectors are allow-listed".

### Attribution: by date, with the move day settled by `created_at`

FE-9 asks to attribute "by snapshot". A snapshot is a string with no program reference (`entries`
has no `block_id`; `sessions.day_role` names a workout role, `schema.ts:657`), so attribution is by
**date**:

- An entry belongs to each period whose dates contain its `activity_date`.
- **The move day.** A move closes the old period the day before and opens the new one today
  (`spec:312-320`), so an entry logged that morning **before** the move would land in the new period.
  An entry on a period's `active_from` whose `created_at` is earlier than the opening assignment's
  `created_at` is attributed to the period that ended the day before instead (correctness S1) —
  **only if such a period exists**. With no period ending the day before (the athlete's first
  assignment, or after a gap), the entry stays in the new period. Its snapshot is still the string
  written with it, which is FE-9's guarantee.
- **The date answer on a move day** names the new program (the only period whose dates contain
  it) and adds "moved from {old} that day" whenever a period ended the day before. It does not
  try to split the day by time: a date has no time, and the line points the parent at both cards,
  where that morning's entries already sit.
- **Overlapping periods** (criterion 43 allows two programs on one day): entries show under every
  period open on their date, and each overlapping card carries one line, "Overlapped with {other}
  from {date} to {date}". No block-membership guess (scope S1): it would be right most of the time
  and silently wrong the rest. If V1-22 chunk 6 ships a prescription-identity column on `entries`,
  attribution can become exact; that is a follow-up, not a branch here (Re-verify item 5).

The page never says "exact"; the cards say "logged while on {program}".

### The page

Implements the prototype's **history** screen (`docs/prototypes/crud-1/index.html:4199-4296`, route
`/p/<id>/program/history` at `:2003`), departing where the panels and criterion 28 require: no
"As prescribed then" caption over the live program (`:4290`), every logged day rather than one
(`:4291`), cards closed by default, and an answer you can see. **The prototype does not approve this
page's layout** (PM-5: `index.html:1805`, `:1876`; `spec:1088`); this plan's UX panel round 1 is
the review it owed.

Structure (semantic HTML, zero client JS, `export const runtime = 'nodejs'` as the sibling routes
do, `page.tsx:43`, `routine/page.tsx:12`):

- `<main>` with the day page's container (`max-w-2xl px-4`, `page.tsx:128`); a back link to the
  athlete's program page; one `<h1>` "{name}'s program history".
- `<section aria-labelledby>` `<h2>` "Programs", then `<ol role="list">` (Safari drops list
  semantics on `list-style: none`). Each `<li id="period-<cardId>">` is a card holding a native
  `<details>` (the `program-reference.tsx` idiom, `:20-28`). The **`<summary>` holds the `<h3>`**
  (program name), so the heading exists whether the card is open or closed — the dangling-label trap
  `program-reference.tsx:36-40` records. Subsections inside are `<h4>`: "What was asked", "Days
  logged". Summary and day links carry the focus-visible ring classes `INPUT_CLASS` uses
  (`constants.ts:287-288`).
- `<section aria-labelledby>` `<h2>` "Find a date": `<form method="get" action="#date-answer">`, a
  labelled `<input type="date" name="on" defaultValue={on} max={today}>` styled with `INPUT_CLASS`,
  and a `Button` "Show". Below it `<p id="date-answer" tabIndex={-1}>`.
  - **Why the fragment.** Q4 put the box under the timeline (the maintainer's decision); after a
    submit the answer would render off-screen below a long list. `action="#date-answer"` makes the
    browser scroll to and focus the answer on load. **Fallback,** if the real-phone probe (iOS Safari,
    Chrome Android) shows the fragment is not honoured after a GET submit: when `?on` is present,
    also render the answer as a banner above the timeline. The probe is a checklist item in HIST-1's PR, not a
    guess.
- **Empty state:** no periods → one sentence and a link back to the program page (PUX-4,
  `spec:1089`).

**360px width math.** Main content is 360 − 2 × 16 = 328px; a card's inner width is **294px** (the
spec's measured figure for a card at 360, `spec:787-792`). Arithmetic is against 294:

- **Summary:** stacked lines — name (`overflow-wrap: anywhere; min-width: 0`, U27, `spec:1004`),
  dates, weekdays, "{n} days logged". The longest date line, "Sep 24, 2026 – Oct 22, 2026", is 26
  characters ≈ 26 × 7.5 = **195px** at `text-sm`; fits. Summary `min-h-11` (44px).
- **Day links: two columns, not three.** (294 − 8 gap) / 2 = **143px** per cell. The visible label
  is short ("Wed Oct 22" ≈ 10 × 7.5 = 75px + 16px padding = **91px**), the full date with year in a
  `<time dateTime>` and the link's accessible name ("Wednesday, October 22, 2026"). Each cell
  `min-h-11`. The `<ul role="list">` has no indent, so the grid gets all 294px.
- **"What was asked":** "Overhead Shoulder Press — 3x8 @ 45 · Oct 1 – Oct 14" wraps to two lines at
  294px; acceptable, and the compact earlier-run lines are one line each.
- **Date form** (in the 328px section, not a card): input `flex-1 min-w-0` + `gap-2` (8) + button
  (~72) → **248px** for the input; a native date input needs ~150px. Both 44px tall.

### The link in

From the athlete's program page (`/p/<id>/program`, V1-22 chunk 4 / ASSIGN-1): a "Program history"
nav row shown whenever the athlete has **any** period, so it is reachable with no current program
(PUX-4) and before a first move.

## File-by-file changes

### HIST-1-pre

| Path                                                                        | Change | What & why                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/app/p/[profileId]/page.tsx`                                       | EDIT   | Skip `getProgramDay` (and the card) unless `writable` (`:75`) **and** the viewed day ≥ the open assignment's `active_from`. The card is the live plan; on a closed day, or yesterday after a move, it is not that day's plan. |
| `apps/web/app/p/[profileId]/strength-section.test.tsx` or a page-level test | EDIT   | A closed day renders no card; yesterday renders it; yesterday after a move today renders none.                                                                                                                                |
| `docs/features/programming.md`                                              | EDIT   | Owns `program-reference.tsx`; a trap line: the card is shown only on writable days.                                                                                                                                           |
| `docs/changelog/<date>-fix-hist-1-pre-past-day-program-card.md`             | NEW    | `status:check`.                                                                                                                                                                                                               |

### HIST-1

| Path                                                         | Change | What & why                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/queries/program-history.ts`                 | NEW    | `programPeriodRows`, `periodEntryRows`, each `(db, { profilePublicId, scope, … })`. Single-sourced so the DAL and `db:verify` run identical SQL (`program-day.ts:9-13`). Docblock: the attribution rule, the deliberate block `deleted_at` non-filter, why the bound is not `max(active_to)`.                                            |
| `packages/db/src/index.ts`                                   | EDIT   | `export * from './queries/program-history'` beside `program-day` (`index.ts:15`).                                                                                                                                                                                                                                                        |
| `apps/web/lib/programming/program-history.ts`                | NEW    | Pure: `toProgramHistory(periods, entries, today): ProgramHistoryDTO` — merges same-block consecutive periods into cards, attributes entries (move-day rule), merges snapshot runs, collapses NULLs, computes overlap lines, days newest-first; `answerDate(history, day)` for the date box. No IO.                                       |
| `apps/web/lib/programming/program-history-copy.ts`           | NEW    | `PROGRAM_HISTORY_COPY` — the feature's copy, in its own `lib` (AGENTS.md: app-only values in the feature's lib), not `constants.ts`.                                                                                                                                                                                                     |
| `apps/web/lib/programming/program-history.test.ts`           | NEW    | Unit tests (below), including the `@ts-expect-error` containment case.                                                                                                                                                                                                                                                                   |
| `apps/web/lib/dal/program-history.ts`                        | NEW    | `import 'server-only'`; `getProgramHistory(profilePublicId, today)` — scope, `uuidSchema` guard, both queries in one `Promise.all`, `toProgramHistory`. Empty shape on a null scope or malformed id.                                                                                                                                     |
| `packages/shared/src/<SCHED-1 1b's resolver module>`         | EDIT   | `isOpenOn(period, day)` — the inclusive date-range test — **if ASSIGN-READ has not already added it**; HIST-1 and ASSIGN-READ's Today read must share one. The Monday-first weekday display helper is likewise imported from ASSIGN-1 (criterion 29), never re-declared.                                                                 |
| `apps/web/lib/constants.ts`                                  | EDIT   | `dayHref(profileId, day, today)` beside `APP_HOME_PATH` (`:42`), which it composes. **Not** in `declared-day.ts`: that module is `server-only` (`:1`), and a URL builder must stay importable by a client island if the date box ever gets one.                                                                                          |
| `apps/web/lib/entries/declared-day.ts`                       | EDIT   | Extract `viewableFloor(today, firstDay)` from `resolveViewedDay` (`:59-79`) and add `resolvePickedDay(on, today)` (the `?on` parse: `isoDaySchema`, ≤ today, else `{ invalid: true }`) beside it — the same "validate an ISO day, clamp against today" family its docblock says belongs together.                                        |
| `apps/web/app/p/[profileId]/day-nav.tsx`                     | EDIT   | Use `dayHref` (`:34`). No behaviour change.                                                                                                                                                                                                                                                                                              |
| `apps/web/app/p/[profileId]/program/history/page.tsx`        | NEW    | Server Component; `runtime = 'nodejs'`; page guard; `getProfileByPublicId` → `notFound()`; `getActiveLocalDay()`; `resolvePickedDay`; `getProgramHistory`; render.                                                                                                                                                                       |
| `apps/web/app/p/[profileId]/program/history/period-card.tsx` | NEW    | One `<li><details>` card. No `'use client'`.                                                                                                                                                                                                                                                                                             |
| `apps/web/app/p/[profileId]/program/page.tsx`                | EDIT   | The "Program history" nav row.                                                                                                                                                                                                                                                                                                           |
| `<V1-22 chunk 2's containment guard>.test.ts`                | EDIT   | Allow-list `packages/db/src/queries/program-history.ts` with its reason; add the import-scan case (above).                                                                                                                                                                                                                               |
| `packages/db/scripts/verify.ts`                              | EDIT   | Proofs (below).                                                                                                                                                                                                                                                                                                                          |
| `apps/web/e2e/program-history.spec.ts`                       | NEW    | A **narrow** test at 360px: open a closed card, run axe, measure each `<summary>` and each day-link `<a>` at ≥44 × 44, assert no horizontal overflow, follow a day link to its `?d=`. Separate from `a11y.spec.ts`'s `ROUTES` loop, which runs at **390px** (`:55-61`) and does not measure `<a>` or the inside of a closed `<details>`. |
| `docs/features/programming.md`                               | EDIT   | **Required by `guides:check`** (owns `apps/web/lib/programming/`). Add `packages/db/src/queries/program-history.ts` and `apps/web/app/p/[profileId]/program/history/` to `owns:`; a map node; invariant: "history never re-prints the live program as a past one; the snapshot is the only past record".                                 |
| `docs/features/write-path.md`                                | EDIT   | **Required** (owns `apps/web/lib/dal/`): the DAL file map line.                                                                                                                                                                                                                                                                          |
| `docs/architecture.md`                                       | EDIT   | A flowchart: page → DAL → two scoped queries → assignments / entries.                                                                                                                                                                                                                                                                    |
| `docs/plan.md`                                               | EDIT   | HIST-1 row links this plan; marked shipped.                                                                                                                                                                                                                                                                                              |
| `docs/status.md`                                             | EDIT   | The "where we are" pointer.                                                                                                                                                                                                                                                                                                              |
| `docs/roadmap.md`                                            | EDIT   | **Move HIST-1 from Insight (`roadmap.md:34`) to Authoring & Scheduling**: by the row's own rule (`plan.md:1997-1999`) Q4's choice of the program page decides it, and every file here is `programming.md`'s.                                                                                                                             |
| `docs/changelog/<date>-feat-hist-1-program-history.md`       | NEW    | `status:check`.                                                                                                                                                                                                                                                                                                                          |

**DTO shape** (in `apps/web/lib/programming/program-history.ts`; no internal id crosses):

```ts
type ProgramCardDTO = {
  cardId: string; // first assignment's public id — the fragment key; unique even when a program has two cards
  blockPublicId: string;
  blockName: string;
  activeFrom: string; // first period's start
  activeTo: string | null; // last period's end; null = open
  weekdays: Weekday[]; // the newest period's, Monday-first via ASSIGN-1's helper
  weekdayChanges: Array<{ on: string; weekdays: Weekday[] }>; // merged periods
  overlaps: Array<{ blockName: string; from: string; to: string }>;
  asked: Array<{
    movementName: string;
    runs: Array<{ asked: string; from: string; to: string }>; // latest first; '' → "no target recorded"
  }>;
  notRecordedCount: number; // NULL snapshots, one line
  loggedDays: string[]; // newest first
};
type ProgramHistoryDTO = {
  cards: ProgramCardDTO[]; // newest first, in SQL order
  periods: Array<AssignmentDTO & { cardId: string }>; // raw, for answerDate — ASSIGN-1's DTO (spec:503), reused
};
```

## Test plan

**Unit (`program-history.test.ts`, Vitest, pure):**

- Order: cards follow the SQL order; a tie on `active_from` keeps the newest assignment first.
- Merge: two same-block periods with no gap → one card with a `weekdayChanges` line; a gap of one
  day → two cards; a different block between → three cards.
- Snapshots: **an absent snapshot draws no line** (a period with no entries for a movement has no
  run for it); **A → B → A gives two A runs**, latest first; `''` → "no target recorded"; NULLs →
  one count, never the live prescription.
- Move day: an entry on `active_from` created before the opening assignment goes to the previous
  period; one created after stays; **with no period ending the day before** (first assignment, or a
  gap) an early entry stays in the new period.
- **Card ids:** A, a gap, A again → two cards with distinct `cardId`s; a date in the second period
  answers with the **second** card's fragment.
- Overlap: entries appear under both; each card has one "Overlapped with" line with the right dates.
- **Closed + open:** a closed period followed by an open one — entries after the closed period's end
  land in the open card (the B1 regression).
- A day after `today` is returned as non-linkable.
- `answerDate`: inside, on each inclusive boundary, in a gap (none), on a two-period day (both, in
  opened order), before the first period (none), on a weekday outside the set ("not one of their
  days"), on a move day (the new program, plus "moved from"). Weekdays asserted via `WEEKDAYS`, not a re-typed list.
- `resolvePickedDay`: malformed → invalid; future → invalid; today → valid.
- **Containment:** `@ts-expect-error` that `ProgramHistoryDTO['cards'][number]['asked']` is not
  assignable to `ScaffoldRow` (chunk 2's idiom).

**`db:verify` (PGlite, real SQL):**

- **Wrong owner:** a second household's scope returns **zero** rows from **each** query for the first
  household's profile.
- **A mis-written assignment** (profile of H, block of ¬H) never surfaces in `programPeriodRows`.
- **Closed + open periods:** `periodEntryRows` returns an entry dated after the closed period's end.
- **Hidden entries:** an entry with `deleted_at` set is absent (Q7).
- **A soft-deleted assignment** is absent; a soft-deleted **block** with a live assignment is present.
- **Bodyweight:** a weigh-in in range returns its date and NULL movement / snapshot, and no value
  column exists in the projection.

**Boundary tests (the read-only subset of AGENTS.md → Backend rules):** unauth → the page guard
(`pages-are-gated.test.ts` globs `**/page.tsx`, so the new page is covered with no edit); wrong owner
→ `getProfileByPublicId` returns null → 404, plus the DAL returning the empty shape under a mocked
foreign scope (`programming.ts` precedent) and the `db:verify` row; bad input → malformed profile id
→ empty shape, malformed / future `?on` → the visible line. **No replay test:** nothing mutates.

**E2E / screenshots:** the narrow `program-history.spec.ts` above; `pnpm e2e:local`; three-width
screenshots with `screenshot:ephemeral`, including an open card and a date answer; and the
**real-phone fragment probe** (iOS Safari, Chrome Android) recorded in the PR.

**HIST-1-pre:** the unit test above; a closed-day screenshot at three widths; `pnpm e2e:local` (the
smoke visits yesterday, `a11y.spec.ts:383`).

**Commands:** `pnpm verify`, `pnpm guides:check`, `pnpm e2e:local`.

## Risks / rollback

| Risk                                                                                                                                                                | Mitigation                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A parent reads today's load as a past one** — injury-relevant if "what worked in March" is restored from it                                                       | The live program never appears inside a period; the link says "as it is today"; HIST-1-pre removes the live card from closed days the history links to.                                |
| **A synced batch's snapshot reflects the program at receipt, not at logging**                                                                                       | Stated in the honest limit; the copy never says "exactly". Fixing it needs the client to carry a prescription version — V1-22's concern, not this page's.                              |
| **The second snapshot selector erodes V1-22's containment**                                                                                                         | One allow-listed file with its reason, the type assertion and an import scan; the disagreement is named so the V1-22 spec's wording is fixed rather than silently contradicted.        |
| **Overlapping periods list the same entry twice**                                                                                                                   | Labelled with an "Overlapped with" line; exact attribution waits on an identity column, if chunk 6 ships one.                                                                          |
| **Pre-chunk-2 entries with a NULL snapshot** read as "not recorded"                                                                                                 | True, not a bug: chunk 3's backfill fills them; the residual count is re-verified (item 2). The export's live fallback is **not** copied here — it is the value that may have changed. |
| **A day link before `profile.firstDay` is silently clamped** (`resolveViewedDay`, `declared-day.ts:59-79`; `firstDay` = `created_at`'s UTC date, `profiles.ts:140`) | `dayHref` is rendered only for days ≥ `viewableFloor`; an earlier day is plain text. Whether any exist is re-verified (item 8).                                                        |
| **The fragment does not scroll on a phone after a GET submit**                                                                                                      | The banner fallback; decided by the probe, not assumed.                                                                                                                                |
| **Gate-1 collision with RETIRE-1 (D6)** — both follow D5 and touch the program page and `programming.md`                                                            | Run [parallel-work.md](../parallel-work.md) before starting; serialize if both are ready.                                                                                              |

**Rollback.** No migration, no writer: either PR is a plain revert. Reverting HIST-1-pre alone
restores the live card on past days, which is today's behaviour.

## Re-verify at start

This plan is written against plans, not code. Before HIST-1, against `origin/main`:

1. **SCHED-1 1c/1d shipped** with `program_assignments(block_id, profile_id, active_from NOT NULL,
active_to, created_at, deleted_at)` and `program_assignment_weekdays`
   (`sched-1-scheduling-model.md:305-345`); `active_to` is inclusive ("the day before", `spec:313`).
2. **V1-22 chunks 2–3 shipped**, and the count of strength entries with `prescribed_snapshot IS NULL`
   after the backfill — read from the chunk 3 correction's recorded output or a one-off query by the
   maintainer; **no new correction file** for a count.
3. **ASSIGN-1 (D4b) and D4c/D5:** where `AssignmentDTO` and the Monday-first weekday helper live;
   whether `isOpenOn` already exists (ASSIGN-READ); that a same-day change of days updates the period
   in place and a same-day move leaves no live zero-length row; that every Undo soft-deletes the
   **assignment** rows it opened.
4. **V1-22 chunk 2's containment guard**: its file and allow-list, to amend as above.
5. **Whether `entries` has a prescription-identity column** (chunk 6). If yes, file exact attribution
   as a follow-up row; do not branch in this PR.
6. **The move-day rule's premise**: ASSIGN-1 writes the opening assignment's `created_at` in the
   same transaction as the move (so the comparison with an entry's `created_at` is meaningful).
7. **AUTH-1 1c** (gates D3 via Beta 1, so landed by D7 in practice): the page guard is
   `requireSession()` not `requireGatedPage()` (`auth-1-clerk-google.md:655`) and
   `pages-are-gated.test.ts` asserts the new name; `getHouseholdScope()` resolves the session's
   household (`household.ts` → "What AUTH-1 changes"), so this plan's calls do not change. Pages are
   globbed, so 1b-bis's action list needs no entry.
8. **`firstDay` vs logged days:** whether any live entry predates its profile's `created_at` date.

## Out-of-scope / deferred

- **Versioning a program** — a prescription history table, an audit trigger, a version-compare
  screen (`plan.md:1958`; `spec:896`).
- **Re-printing the program as it is today inside a period** — cut in round 1; one link instead.
- **"How did it go"** beyond the days — totals, adherence, PRs per period. V1-16 / DASH-1 (Insight).
- **The dashboard-widget surface** — Q4 chose the program page.
- **Which workout was due on a picked date** — the answer says whether it was one of the athlete's
  days, not which workout.
- **Editing or deleting a period** — ASSIGN-1's Undo is the only correction path.
- **The CSV export** — untouched.
- **A household-wide history.**

## Open questions

1. **(D4c / D5 plans)** Does every Undo that erases an assignment soft-delete the **assignment** row?
   This plan shows a period whose block alone is hidden.
2. **(Maintainer)** The V1-22 spec's "exactly one query selects it" (acceptance 12): accept the
   reading "one writer, allow-listed display selectors", or should HIST-1 show no snapshot at all?
   Criterion 28 needs it, so the plan assumes the former.

## Where this plan disagrees with the spec, the row, or the prototype

- **The prototype captions the current program "As prescribed then"** (`index.html:4290`), which is
  false after an in-place edit. Not implemented.
- **The prototype links one day per period** (`:4291`); criterion 28 says "the days". This follows
  the criterion.
- **The backlog row says "the data will exist once CLONE-1 ships"** (`plan.md:1990-1991`). True for a
  copy-and-move; not for "save for everyone" or a chunk-4 value edit.
- **FE-9 says "attributes by snapshot"**; a snapshot carries no program reference, so attribution is
  by date, with the move day settled by `created_at`.
- **V1-22 acceptance 12 says exactly one query selects `prescribed_snapshot`**
  (`v1-22-authoring-program-editing.md:74-76`; enforced at `v1-22-2-renderer-and-writer.md:83-88`).
  HIST-1 is a second, display-only selector and amends the guard openly (open question 2).
- **The row files HIST-1 under Insight** (`plan.md:1999`, `roadmap.md:34`); by its own rule Q4 moves
  it to Authoring & Scheduling, and this PR's file table does it.
- **The spec's data contract** (`spec:457-524`) has no history DTO; `ProgramHistoryDTO` reuses its
  `AssignmentDTO` for raw periods.
- **The day page shows today's program on any past day** (`page.tsx:81-88`) — a latent bug the
  history links would expose; HIST-1-pre fixes it first.

## Review-response log (adversarial panel)

### Engineering panel, round 1 (2026-10-23) — correctness, scope, architecture, reuse

| #   | Lens                                         | Critique (short)                                                                                                                                                | Verdict         | Resolution                                                                                                                                                                       |
| --- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | Corr B1                                      | `coalesce(max(active_to), today)` drops the open period when a closed one exists (`max` skips NULL)                                                             | accepted        | Bound is `today + WRITABLE_DAY_RADIUS` (`declared-day.ts:37`); a future day renders as text; closed+open unit and `db:verify` cases.                                             |
| E2  | Corr B2                                      | Grouping by (movement, snapshot) with min/max fabricates lines in periods where nothing was asked                                                               | accepted        | `periodEntryRows` returns per-entry rows; runs merged in TS; tests "absent → no line", "A→B→A → two runs".                                                                       |
| E3  | Corr B3 · Reuse 1 · Arch 1                   | A second `prescribed_snapshot` selector breaks V1-22 acceptance 12 and chunk 2's allow-list                                                                     | accepted        | Named as a disagreement; the guard gains one allow-listed file with its reason, a type assertion and an import scan; Re-verify 4; open question 2.                               |
| E4  | Scope B1 · Arch 2–4 · Reuse 2–3 · Corr S2–S4 | "This program now" + staleness: unasked for, no query behind it, `formatPrescription` (no load) not comparable to snapshots, TGT-1/D4c tables would make it lie | accepted        | Cut entirely (DTO fields, subquery, UTC rule, tests, risk rows, old Re-verify 4 and OQ5). One "Open {program} as it is today →" link per card.                                   |
| E5  | Corr S1                                      | Move-day entries logged before the move land in the new period                                                                                                  | accepted        | Attributed by `created_at` vs the opening assignment's; "exact" dropped from the copy; Re-verify 6.                                                                              |
| E6  | Corr S5                                      | NULL snapshots one line per movement is noise                                                                                                                   | accepted        | One "not recorded for {n} entries" line.                                                                                                                                         |
| E7  | Scope S1                                     | Block-membership attribution on overlap is a guess                                                                                                              | accepted        | Date-only plus one "Overlapped with" line; no branch.                                                                                                                            |
| E8  | Scope S2                                     | Recount after cuts; one PR if ≤ ~400                                                                                                                            | accepted        | HIST-1 is one PR (~360 non-test); HIST-1-pre stays separate because it changes the day page (Staging says why).                                                                  |
| E9  | Scope S3 · Arch 7                            | The shipping PR owes plan.md, status.md, roadmap.md (pillar move) and an architecture.md diagram                                                                | accepted        | In the file table; OQ6 and the pillar-drift risk removed.                                                                                                                        |
| E10 | Arch 5 · Reuse 4–6                           | Weekday display, `isOpenOn`, the floor and the `?on` parse must be shared, not re-written                                                                       | accepted        | Imported from ASSIGN-1 / shared with ASSIGN-READ; `viewableFloor` + `resolvePickedDay` beside `resolveViewedDay`.                                                                |
| E11 | Arch NIT · Reuse 6                           | `dayHref` home: `declared-day.ts` vs beside `APP_HOME_PATH`                                                                                                     | accepted (one)  | Beside `APP_HOME_PATH` in `constants.ts` — `declared-day.ts` is `server-only` (`:1`) and a URL builder must stay client-importable. The day **parsers** go in `declared-day.ts`. |
| E12 | Arch NIT                                     | `runtime = 'nodejs'`; use `getActiveLocalDay()`                                                                                                                 | accepted        | Both. Note: the day page itself computes the same value inline (`page.tsx:64-65`); `getActiveLocalDay` (`active-timezone.ts:23`) is the shared form.                             |
| E13 | Arch 6                                       | The DAL should return the empty shape, the 404 comes from `getProfileByPublicId`                                                                                | accepted        | Design and boundary tests changed (`programming.ts:29-41` precedent).                                                                                                            |
| E14 | Reuse 7                                      | SQL owns order; the pure layer must not re-sort                                                                                                                 | accepted        | Stated in the query and the test.                                                                                                                                                |
| E15 | Reuse 8                                      | Copy in the feature's lib, not `constants.ts`                                                                                                                   | accepted        | `program-history-copy.ts`.                                                                                                                                                       |
| E16 | NITs (N1–N3, misc)                           | Drop `archived`; firstDay → Re-verify; no correction file for a count; `array_agg FILTER`; days newest-first; block note                                        | accepted, batch | All applied.                                                                                                                                                                     |

### UX panel, round 1 (2026-10-23) — interaction (UX1), a11y + 360px (UX2), trust + data entry (UX3)

| #   | Lens            | Critique (short)                                                                                                                             | Verdict  | Resolution                                                                                                                                                                                                                                                                                   |
| --- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| X1  | UX1 #1 (B)      | A day link lands on `/p/<id>?d=` which shows the **live** program card captioned as that day's (`page.tsx:81-88`)                            | accepted | Verified in code. HIST-1-pre: no live card on a closed past day; gates HIST-1.                                                                                                                                                                                                               |
| X2  | UX1 #2 · UX2 #1 | The date answer renders off-screen below the timeline                                                                                        | accepted | Q4's order kept; `action="#date-answer"` + `tabIndex={-1}` answer; banner fallback decided by a real-phone probe. The answer names the date, the program(s) with a link to the opened card, and whether it was one of the athlete's days; `defaultValue={on}`; a visible line for bad input. |
| X3  | UX1 #3 · UX3 B1 | Today's loads beside the past behind one muted line                                                                                          | accepted | Cut (E4).                                                                                                                                                                                                                                                                                    |
| X4  | UX1 #4          | A change of days splits one program into several cards                                                                                       | accepted | Consecutive same-block periods merge; weekday changes as lines; raw periods kept for the date answer.                                                                                                                                                                                        |
| X5  | UX1 #5          | Newest open by default makes a long page; summary lacks a count                                                                              | accepted | All closed unless exactly one; summary adds "{n} days logged".                                                                                                                                                                                                                               |
| X6  | UX1 #6          | Every snapshot line equal weight; "no target set" implies a choice                                                                           | accepted | Latest first, earlier as a compact run; "no target recorded".                                                                                                                                                                                                                                |
| X7  | UX2             | Heading order inside `<details>`; focus ring; width math against the wrong width; three columns too tight; `list-style:none` drops semantics | accepted | `<h3>` in `<summary>`, `<h4>` inside; ring classes; math redone at the card's 294px with two columns and short labels + full date in `<time>`/accessible name; `INPUT_CLASS` + `Button`; `role="list"`.                                                                                      |
| X8  | UX2             | `ROUTES` runs at 390px and skips `<a>` and closed `<details>`; "scan at 360px" was wrong                                                     | accepted | Verified (`a11y.spec.ts:55-61`, `:182`). A separate narrow `program-history.spec.ts` measures summaries and day links at 360px.                                                                                                                                                              |
| X9  | UX3 S3          | A parent will read a missing movement as "not prescribed"                                                                                    | accepted | One line under "What was asked": movements not logged are not shown.                                                                                                                                                                                                                         |
| X10 | UX3 S4          | A synced batch's snapshot is taken at server receipt (V1-22 acceptance 9)                                                                    | accepted | In the honest limit and Risks; copy avoids "exactly".                                                                                                                                                                                                                                        |

**Pushbacks this round:** none. Every finding checked against the cited code held; the one choice
the panels left open (`dayHref`'s home, E11) is decided above with its reason.

### Re-review (round 2, 2026-10-23)

| #   | Lens        | Critique (short)                                                                                              | Verdict  | Resolution                                                                                                                                                                                     |
| --- | ----------- | ------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Corr (B)    | Cards keyed `period-<blockPublicId>`: one program can have two cards (gap; A→B→A) → duplicate ids, wrong jump | accepted | Keyed by `cardId` = the card's first assignment's public id (selected in `programPeriodRows`); raw periods carry it for `answerDate`; unit case "A, gap, A → second card's fragment".          |
| R2  | UX1         | HIST-1-pre still shows the live card on yesterday after a move (`page.tsx:75`, `:85-88`)                      | accepted | Card shown only on a writable day ≥ the open assignment's `active_from` (ASSIGN-READ's read, now HIST-1-pre's gate). Same-block, in-place edit on yesterday recorded as a one-day known limit. |
| R3  | Corr        | Move-day rule has no fallback without a period ending the day before; `answerDate` inconsistent with it       | accepted | No such period → the entry stays in the new period (unit case). The answer names the new program plus "moved from {old} that day"; it does not split the day by time, and says why.            |
| R4  | Scope (NIT) | "a 1b checklist item" — HIST-1 is one PR                                                                      | accepted | "a checklist item in HIST-1's PR".                                                                                                                                                             |
