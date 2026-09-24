# V1-15 — Day navigation

> Backlog: [plan.md](../plan.md) row V1-15. Branch: `feat/v1-15-day-navigation`.
> Executes the staging in
> [day-navigation-and-dashboard-brainstorm.md](./day-navigation-and-dashboard-brainstorm.md).
> **Revised after a two-panel review (UX + engineering); the log is at the end.**

## Goal

Page back through previous days to see what was logged — **and fix what you find.** Ray's ask, and
the brainstorm's **N1**, which is two sentences and this plan originally shipped only the first:

> _"did Scarlett log her weigh-in yesterday?"_ · _"I mistyped Tuesday's squat"_

Scope is that one need. N2 (what's coming) is inert until day-grained programming exists; N3
(progress over time) is V1-16 and looks empty without accumulated data.

## The correction that reshaped this plan

My first draft made **all** history read-only, citing the V1-6c write bound. Both panels checked the
code and the rationale does not survive:

- **`declared-day.ts:26` bounds a write to `Math.abs(isoDayDiff(day, today)) > 1`.** Yesterday is
  **already an accepted write day.** The "that day is no longer open" collision starts at day −2.
- **`editStrengthSetAction` never calls `resolveDeclaredDay` at all** (`actions.ts:441`) — set editing
  has no day bound, only ownership.

So blanket read-only would have removed an affordance the **server already honours**, turning V1-9's
edit path off on every past day for no safety gain. The parent's real sequence — page back, find the
gap, fix it — dead-ended on a screen with no input and no explanation.

**The writable window now mirrors the server exactly**, and the bound is imported, never re-typed:

| Day        | Forms                    | Edit a logged set           |
| ---------- | ------------------------ | --------------------------- |
| today      | ✅                       | ✅                          |
| yesterday  | ✅                       | ✅                          |
| −2 or more | ❌ + an explicit message | ✅ (no server bound exists) |

**And the safety claim is reworded.** Removing a form proves an **affordance, not a boundary** — every
Server Action is a public POST ([write-path](../features/write-path.md) invariant 1), so a crafted
body still writes whatever `resolveDeclaredDay` permits regardless of the DOM. The e2e asserts what
the athlete can reach, not what the endpoint accepts. No code change: ±1 is deliberate, for midnight
rollover.

## Shape

### Route: `?d=YYYY-MM-DD` on the existing page

Kept, but **re-argued** — the panel called my original reasoning ("two route files that must not
drift") a strawman, correctly: the brainstorm's shape is one `DayView({profileId, day})` plus two
five-line callers, where drift is impossible. The real reasons:

1. **`revalidatePath('/p/' + id)` (`actions.ts:103`) keeps working unchanged.** A `/d/[date]` subtree
   needs a broadened revalidate — which the brainstorm itself flags.
2. **`searchParams` costs no cacheability here**, because the tree is already `force-dynamic`
   (`layout.tsx:23`).

`page.tsx` is one RSC whose day is a single local; every read and render keys off it.

```ts
// Next 16: searchParams is a Promise, and `?d=a&d=b` arrives as string[].
const { d } = await searchParams;
const day = resolveViewedDay(typeof d === 'string' ? d : undefined, timeZone);
```

### The resolver lives next to the one that already exists

`resolveViewedDay` goes in **`lib/entries/declared-day.ts`**, beside `resolveDeclaredDay` — which is
already "`isoDaySchema.safeParse` → `isoDayDiff` against the active-tz today → clamp". A second
near-identical resolver in a different directory is the duplication AGENTS.md's constants rule names.
That deletes two files from my first draft (`day-resolver.ts` + its test); the existing test file
extends instead.

```ts
/** Today, or the validated `?d=` day — never the future, never malformed, never before `floor`. */
export function resolveViewedDay(
  requested: string | undefined,
  today: string,
  floor: string,
): string;
```

**Malformed → today, not 404.** A stale or hand-edited URL should land on a usable page; every date is
a legal day, we just have nothing logged for most.

**`floor` is the profile's `created_at` day** (UX Q1). `getProfileByPublicId` already runs the SELECT,
so this is **zero extra queries** — versus unbounded, which lets a kid tap into 2019 and conclude the
app is broken.

### Navigation: arrows **and** a week strip

The week strip was v1.x in the brainstorm. It comes forward, because two chevrons make the stated
need cost **9 taps** from Thursday to last Tuesday — and each tap is a full dynamic render. The strip
makes it **2**, and it is **pure date arithmetic: zero new queries, zero new DAL.** (Dots showing
which days have data need `listEntryDatesForWeek`; those stay deferred. A dotless strip is still worth
shipping.)

```
‹   Tue, Sep 22   ›        [Today]
 M   T   W   T   F   S   S          ← the viewed day's week, 7 links
```

**Width, done as arithmetic rather than hope.** 360px − `px-4` ×2 = **328px**.

- Strip: 328 / 7 = 46.9px. `gap-2` (6 × 8 = 48px) → 40px each — **fails the 44px bar.** `gap-0.5`
  (12px) → **45.1px each. Passes, barely.** This number is why the strip is specified here and not
  left to the implementation.
- Nav row: `formatDayLong` ("Wednesday, September 24, 2026") is ~240px and overflows before the
  arrows. **Off-today uses a new `formatDayShort`** ("Tue, Sep 22", ~90px) with the same UTC-anchored
  discipline; today keeps the long form. `[Today]` moves to its own line if it does not fit.

### Copy: the page currently says "today" three times

None of these were in my first draft's file list, and on an empty past day they are what makes the
screen read as broken — a header claiming it is today above an empty state saying nothing was logged
today.

| `page.tsx` | Now                            | Off-today                        |
| ---------- | ------------------------------ | -------------------------------- |
| `:109`     | `Today · {formatDayLong(day)}` | `Yesterday · …` / just the date  |
| `:203`     | `Calisthenics today`           | `Calisthenics`                   |
| `:230`     | `No entries logged today.`     | `Nothing logged on Tue, Sep 22.` |

`weekly-adherence.tsx:18`'s `This week` → `Week of Sep 21` off-today.

**Two booleans, not one.** `isToday` drives copy; `isWritable` (`|diff| ≤ 1`) drives forms. My draft
conflated them, which is how the writable-yesterday bug got in.

## Open questions — both answered in-plan

1. ~~How far back may `‹` go?~~ **Clamped at the profile's `created_at`**, zero extra queries.
2. ~~Does weekly adherence belong on a past day?~~ **Yes, unchanged — my premise was wrong.**
   `page.tsx:58` already derives `weekStart = localWeekStartIso(day)` from the **viewed** day, so it is
   already that week's adherence, correct by construction. A finished past week is the _more_
   meaningful version of the block. Heading copy only. _(The engineering panel argued to hide it; the
   UX panel checked the line and was right. Verified before accepting.)_

## Acceptance

- `?d=<past date>` renders that day; `‹`/`›` and the week strip move between days.
- **Yesterday keeps its forms**; day −2 and back show an explicit _"Logging closed for this day."_
  where the forms were — never a silent absence.
- **A logged set stays editable on every past day** (the server has no bound; V1-9 is not regressed).
- `›` is inert on today, `‹` inert at the floor — both as `<button disabled>`, dimmed with a muted
  **token** (a 40%-opacity chevron is a live `color-contrast` failure the gate does catch).
- Arrows carry the date in their accessible name (`Previous day, Tuesday September 22`) — an
  icon-only `‹` passes axe's `link-name` and still fails voice control.
- `generateMetadata` sets `<title>` to `${profile.name} · ${date}` — Next's route announcer reads the
  title on soft nav, and it is currently the static `'mat-plan'` (`layout.tsx:15`), so paging back
  announces nothing.
- No horizontal overflow at **360px**, and the nav controls actually measured — see the gate note.
- Today is unchanged: same DOM, same forms, no `?d=` in the URL.
- `pnpm verify` + `pnpm e2e:local` green.

## The CI gate is blind to this feature twice over

Both must be fixed **in this PR** or the a11y claims above are unenforced:

1. **`a11y.spec.ts:61` — `INTERACTIVE` deliberately excludes `<a>`** (the SC 2.5.8 inline exception).
   The arrows and all 7 strip links are `<Link>`s, so **nothing measures them.** They need the
   explicit opt-in the profile tiles already get (`a11y.spec.ts:300-312`).
2. **`expectNoHorizontalOverflow` is called only from the strength-form test.** The `ROUTES` loop runs
   at 390px and never measures overflow. Add `?d=` to `ROUTES` **and** a 360px overflow case.

## Out of scope — and one thing explicitly removed

- **~~Deleting the scaffold test's `PROGRAMMED_TZ` workaround.~~ CUT.** My draft promised it; both
  panels showed the promise is self-contradictory. That test asserts the scaffold button is _visible_
  (`a11y.spec.ts:274`), and a past day renders no strength form — so `?d=<a past Monday>` makes it
  **red, not green**. The workaround's real exit is seeding programming for every weekday. It was also
  a second concern in a one-concern PR.
- Dots on the week strip (needs `listEntryDatesForWeek`), the month calendar, forward navigation into
  programmed days, V1-16 entirely.

## Risks

| Risk                                                                                                                                                                                                                                                                                                  | Mitigation                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A form renders on a day the server will reject** (−2 or older).                                                                                                                                                                                                                                     | `isWritable` imports the **same bound** `declared-day.ts` uses — a re-typed `1` in `page.tsx` is exactly the drift the constants rule exists to stop. Hoist it to one exported const.                                                                                                 |
| **Every `‹` tap swaps the whole page for the root skeleton.** The only Suspense boundary is `app/loading.tsx`; a searchParams-only nav on the same segment may not re-trigger it at all.                                                                                                              | Verify in the e2e which actually happens. If no boundary fires, the arrows get a small client island using `useLinkStatus` for a pending state — a kid who taps and sees nothing taps three more times. **This is a real cost of `?d=` my first draft did not weigh.**                |
| **Cost per navigation is 4–7 queries, not the "two" I wrote.** `getProfileByPublicId` + `listEntriesForDay` (up to 3 since GAP-3) + `getWeeklyAdherence` (2) + `getProgramDay` on Mon/Wed/Fri.                                                                                                        | Bounded and index-covered, but Ray's constraint is explicit. The week strip matters here: it turns a 9-tap journey into 2, which is a **~5× reduction in real query volume** for the stated need. Stated honestly — I corrected one stale number in the draft and introduced another. |
| `prefetch={false}` was justified with the mechanism backwards.                                                                                                                                                                                                                                        | On a `force-dynamic` route with a root `loading.tsx`, a prefetch fetches **layout-to-first-boundary only** — none of the queries run. The flag prevents nothing. Keep or drop it; drop the justification.                                                                             |
| **TimeZoneSync + `?d=`**: `router.refresh()` re-requests the URL including `?d=`, so the param survives. Edge: on first paint before the `tz` cookie exists, a device west of the default can make a `?d=` equal to that paint's "today" a _future_ day, which then clamps — header and URL disagree. | The nav's hrefs derive from the **resolved** `day`, never the raw param, so the next tap is computed from truth.                                                                                                                                                                      |
| `isToday`/`isWritable` must thread deeper than a top-level gate.                                                                                                                                                                                                                                      | The editable branch is chosen inside `MovementLine` (`page.tsx:360-368`), reached from three call sites via `SessionMovementItem`. Thread an explicit `editable` prop; do not re-derive.                                                                                              |
| Three chevrons in a ~100px band (`← All profiles` sits directly above).                                                                                                                                                                                                                               | Day arrows get visible chrome (bordered 44px buttons) so they do not read as siblings of the back link.                                                                                                                                                                               |

## File-by-file

| Path                                                  | Change | What & why                                                                                                                                          |
| ----------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/app/p/[profileId]/page.tsx`                 | EDIT   | `await searchParams`; `day` from the resolver; `isToday` + `isWritable`; off-today copy at `:109/:203/:230`; thread `editable` into `MovementLine`. |
| `apps/web/lib/entries/declared-day.ts`                | EDIT   | `resolveViewedDay` beside `resolveDeclaredDay`; export the ±1 bound as a named const both use.                                                      |
| `apps/web/lib/entries/declared-day.test.ts`           | EDIT   | Clamp future / floor / malformed / absent; the shared-bound contract.                                                                               |
| `apps/web/lib/date.ts`                                | EDIT   | `addDays` + `formatDayShort`; **refactor `localWeekStartIso` onto `addDays`** so the `…T00:00:00Z` idiom lives once.                                |
| `apps/web/lib/date.test.ts`                           | EDIT   | `addDays` month/year rollover; keep the existing DST pin and note it already covers the UTC-epoch case.                                             |
| `apps/web/app/p/[profileId]/day-nav.tsx`              | NEW    | Arrows + week strip. Server component; `gap-0.5` per the width math.                                                                                |
| `apps/web/app/p/[profileId]/weekly-adherence.tsx`     | EDIT   | Heading copy off-today.                                                                                                                             |
| `apps/web/app/p/[profileId]/layout.tsx` or `page.tsx` | EDIT   | `generateMetadata` for the route announcer.                                                                                                         |
| `apps/web/e2e/day-navigation.spec.ts`                 | NEW    | Page back; yesterday writable; −2 shows the closed message; a past set is still editable; `›` inert on today.                                       |
| `apps/web/e2e/a11y.spec.ts`                           | EDIT   | Opt the nav links into `INTERACTIVE`; add `?d=` to `ROUTES`; 360px overflow case. **No `PROGRAMMED_TZ` change.**                                    |
| `docs/features/strength-logging.md`                   | EDIT   | Gate requires it; record the writable-window rule.                                                                                                  |
| `docs/plan.md`, `docs/status.md`                      | EDIT   | Status rides with the work.                                                                                                                         |

## Review-response log

Two panels, run **before implementation**: a combined UX lens (interaction + first-run + a11y/responsive,
REQUIRED by AGENTS.md on any UI PR) and a combined engineering lens. Both read the code rather than the
plan's prose, which is why three of my claims did not survive.

### Blocking — all accepted

| Finding                                                                                                                                                                                         | Response                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Both panels: the `PROGRAMMED_TZ` deletion contradicts read-only history.** A past Monday has no strength form, so the test that asserts the scaffold button is visible goes red.              | **Accepted, cut from scope.** It was also a second concern in a one-concern PR. Its real exit is seeding every weekday.                  |
| **UX: read-only history is a trap and stricter than the server.** Yesterday is already writable (`declared-day.ts:26`); `editStrengthSetAction` has no day bound at all. It shipped half of N1. | **Accepted — reshaped the feature.** Writable window now mirrors the server; `EditableSet` stays on all past days; a closed day says so. |
| **UX: the nav row does not fit 360px, and no gate catches it.** `<a>` is excluded from `INTERACTIVE`; overflow is asserted only in the strength test.                                           | **Accepted.** `formatDayShort` off-today, the width arithmetic is in the plan, and both gate holes are fixed in this PR.                 |

### Major — accepted

- **The "today" copy in three places** (UX M4) — absent from my file list; the biggest cause of a past day reading as broken.
- **`resolveRequestedDay` duplicated `resolveDeclaredDay`** (Eng 3) — reuse; two files deleted.
- **`searchParams` is a `Promise` and can be `string[]`** (Eng 2) — my sketch did not typecheck.
- **4–7 queries per navigation, not 2** (Eng 5) — I corrected one stale number and introduced another.
- **The prefetch justification is backwards** (Eng 6) — a dynamic-route prefetch stops at the first loading boundary.
- **My `/d/[date]` rejection was a strawman** (Eng 10) — same conclusion, re-argued on `revalidatePath` and `force-dynamic`.
- **No `generateMetadata`** (UX M6) — the route announcer reads a static `'mat-plan'`, so paging is silent to a screen reader.
- **No pending feedback on tap** (UX M7) — and a searchParams-only nav may not re-trigger the root boundary. A real `?d=` cost.
- **Icon-only chevrons pass axe and fail voice control** (UX M8); disabled `<button>` over `<span>`; muted token over opacity.
- **`isToday` threads into `MovementLine`** (Eng 11).
- **The week strip comes forward into v1** (UX M5) — zero queries, 9 taps → 2, and it is the discoverability answer.

### Rejected, with reason

- **Eng 7: hide weekly adherence off-today.** Rejected — `page.tsx:58` derives `weekStart` from the
  **viewed** day, so it is already that week's adherence. The UX panel checked the line and was right;
  verified directly before accepting. Hiding it would have deleted working code to fix a bug that does
  not exist.
- **Eng 9: the DST test is near-vacuous.** Partially — kept as an explicit regression pin, with a note
  that `date.test.ts:97-102` already covers the UTC-epoch case.
