# V1-5 — Check-ins / habits form driven by `metric_definition`

> Backlog: [plan.md](../plan.md) row V1-5. Branch: `feat/v1-5-checkins-form`.

> **This plan was hardened by a four-lens adversarial panel** (correctness/data-integrity,
> simplicity/scope, architecture/consistency, security+a11y) and **cut roughly in half** — the draft
> proposed an a/b split totalling ~850 lines with machinery for value types the seeded catalog does
> not contain. See the [review-response log](#review-response-log-adversarial-panel). Two of the
> draft's headline claims were **falsified** by the panel and are corrected here.

## Goal

The Today view can log a weigh-in (metric) and a strength lift (movement); the other nine seeded
activities have no write path. V1-5 adds the **check-ins / habits** write path, **derived from the
seeded catalogs** (`activity_types.input_shape` + `ACTIVITY_METRIC_MAP` + `metric_definitions`)
rather than hand-coded per habit — so a new habit needs **no component, action, or DAL edit**.

This is the **consumer of V1-1c**: `entries.kind` went NULLABLE specifically so a metric-only /
boolean check-in could insert. V1-5 is the first writer to insert `kind = NULL`, and the first to
insert a **neither-source** row (`movement_id` and `metric_key` both NULL). It inherits the write
path and form work that [V1-4](./v1-4-weigh-ins.md) deferred here.

**Scope-claim correction (panel B2/architecture).** The draft billed this as proof of spec §4b's
🟢 "Pure data (**no deploy**)" tier. That is false: the catalogs are compiled TypeScript in
`packages/shared`, and adding a boolean activity also forces an edit to `activity-metric-map.ts`
(its `Record<ActivityTypeKey, …>` is exhaustive — omitting a key is a typecheck failure), plus a PR,
CI, a redeploy, and a `db:seed`. The honest and still-valuable claim is **"derived, not hand-coded:
no UI/action/DAL change."** A runtime DB-driven catalog is deferred to V1-10, when the catalog first
becomes genuinely dynamic.

## Acceptance

- **Backlog criterion (plan.md V1-5), verbatim:** _"Log a brush-teeth day + habit checkboxes"_
- Done when:
  - `/p/[profileId]` renders a **Check-ins** section with two fieldsets, both **derived from seed
    data**: _Habits_ (the three `inputShape === 'boolean'` activities — rice bucket, splits, brain
    rep) and _Brush teeth_ (the seven `ACTIVITY_METRIC_MAP.brush_teeth` metrics: 4 `bool` checkboxes,
    2 `scale_10` numbers, 1 `count` number). **No activity or metric key appears in JSX.**
  - Submitting writes one `entries` row per checked/filled field: `kind = NULL`, `activity_type_id`
    set, `metric_key` set (or NULL for a bare habit), `value_num` always populated (bool → `1`),
    `unit` **resolved from the DB catalog row**, `status = 'done'`, client-stamped UUIDv7 `client_id`.
  - Today's list labels them from the model discriminant: `bool` → `Stance`, `scale_10` →
    `Pressure — 7/10`, bare habit → `Rice bucket`. The e2e's `Bodyweight — 72.5 lb` is unchanged.
  - The form submits the **day the page rendered** (hidden field); the action rejects a day more than
    ±1 from `todayIso()`, so an evening log can't silently land on the wrong date (see
    [Timezone](#timezone-decision-accepted-risk)).
  - Mandatory boundary tests ship in this PR: missing/malformed `profileId` → zod-reject with no DAL
    call; unknown profile → `{ ok:false }`, no write; empty submission → reject; an unknown POST key
    (`v:evil_key`) is **ignored**; out-of-range `scale_10` (0, 11, `'abc'`) → reject.
  - `db:verify` proves the two genuinely-new DB facts (see [db:verify](#dbverify-additions)).
  - All gates green (typecheck · lint · prettier · vitest · `db:verify` · `next build` · e2e).

## Migration: **NOT needed**

No `schema.ts` change, no migration file. Every column exists and is already constrained as needed:
`entries.kind` NULLABLE (0003/V1-1c), `activity_type_id` NOT NULL CHECK (0003), `metric_key` FK +
`entries_value_source_check` **at-most-one** (0002), `value_num numeric(8,3)` (0000), `units` FK rows
incl. `bool`/`count` (0000 + seed), `uq_entries_client_id` partial UNIQUE (0000). Opening DDL here
would drag Squawk + the Neon-branch gate into a UI PR.

### ⚠️ The `entries_shape_check` trap (read before writing the DAL)

`entries_shape_check` (`0000_busy_lockheed.sql:26-27`, retained past V1-1c, dropped at V1-1d):

```sql
(kind = 'bodyweight' AND value_num IS NOT NULL AND movement_name IS NULL)
OR (kind = 'strength' AND movement_name IS NOT NULL)
```

With `kind IS NULL` both `kind = …` terms are NULL. The **complete** truth table (the draft omitted
row 3, which is why its stated derivation was wrong — panel correctness M3):

| `value_num` | `movement_name` | term A            | term B          | A OR B    | result     |
| ----------- | --------------- | ----------------- | --------------- | --------- | ---------- |
| NOT NULL    | NULL            | `NULL∧T∧T` = NULL | F               | **NULL**  | ✅ passes  |
| NULL        | NULL            | `NULL∧F` = F      | F               | **FALSE** | ❌ rejects |
| NULL        | NOT NULL        | F                 | `NULL∧T` = NULL | **NULL**  | ✅ passes  |

So the true invariant for a kind-less row is **`value_num IS NOT NULL OR movement_name IS NOT NULL`**
— _not_ "value_num set AND movement_name NULL". Our prescription (**always set `value_num`, never set
`movement_name`**) is a safe subset of that, and it is the right encoding on its own merits: `1`/`0`
is what V1-6's `sum`/`last` aggregation and V1-13's CSV pivot both want. `entries_kind_check`
(`kind in ('bodyweight','strength')`) is NULL on a NULL kind → passes. **Do not re-derive a
constraint from this table without re-reading the SQL** — a later PR (V1-7 timing, V1-1d prep) that
assumes "movement_name must be NULL" would be reasoning from a false premise.

### Timezone decision (accepted risk)

`todayIso()` is UTC (`apps/web/lib/date.ts:8`). Rice bucket / splits / brain rep are **evening**
activities: at 19:00 CDT the UTC day rolls over, so a habit logged Wednesday night would land on
Thursday. **Decision: the form carries the day the page rendered** as a hidden field, and the action
validates it is within ±1 day of `todayIso()` and re-derives nothing from the clock. This guarantees
the render and the write agree — the user's row lands on the date they were looking at. It does
**not** fix the Today header's own UTC derivation; a real per-profile timezone is its own backlog
item and is out of scope here.

## File-by-file changes

| Path                                               | Change | What & why                                                                                                                                                                |
| -------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/lib/checkins/checkin-fields.ts`          | NEW    | **The registry** (~50 lines). Pure; derives `CHECKIN_FIELDS` from the seeded catalogs. Exports the two field-name helpers. No DB, no `server-only`.                       |
| `apps/web/lib/checkins/checkin-fields.test.ts`     | NEW    | Derivation asserted against the seed arrays directly (no injectable seam).                                                                                                |
| `apps/web/app/p/[profileId]/checkin-form.tsx`      | NEW    | Client shell. Receives `fields` **as a prop** from the RSC page (type-only import) → the catalog crosses as JSON, not bundled code. Owns `useActionState` + field errors. |
| `apps/web/app/p/[profileId]/actions.ts`            | EDIT   | Add `logCheckinsAction` — walks the **registry**, accumulates all field errors, validates the day, re-resolves the profile, calls the DAL.                                |
| `apps/web/app/p/[profileId]/actions.test.ts`       | EDIT   | Mandatory boundary tests + happy path, driven through a **real `FormData`** (see the `z.literal` trap).                                                                   |
| `apps/web/lib/dal/entries.ts`                      | EDIT   | `EntryDTO.kind` → nullable (the `as EntryKind` cast at `:111` currently lies); LEFT JOIN `activity_types`; NEW `logCheckinEntries` returning **per-item results**.        |
| `apps/web/lib/dal/catalog.ts`                      | EDIT   | Widen `assertMetricKeyExists` → `getMetricDefinition(key)` returning `{ key, unit, valueType }`, so the written `unit` comes from the **DB row**, not a compiled const.   |
| `apps/web/lib/entries/entry-label.ts`              | EDIT   | Fill the reserved `bool` / `scale_10` cases; add a final `activityLabel` branch over **disjoint** discriminants (see below — ordering is _not_ load-bearing).             |
| `apps/web/lib/entries/entry-label.test.ts`         | EDIT   | `bool`, `scale_10`, bare-habit cases + the branch-1 case the e2e actually exercises.                                                                                      |
| `apps/web/app/p/[profileId]/page.tsx`              | EDIT   | New `<section aria-labelledby>` + `<h2>`; passes `CHECKIN_FIELDS`, the rendered `day`, and `loggedFieldKeys` (derived from the already-fetched entries — no extra query). |
| `packages/db/scripts/verify.ts`                    | EDIT   | **Two** new assertions only (the rest already exist at `:512-545`).                                                                                                       |
| `apps/web/e2e/steps.ts` · `log-bodyweight.spec.ts` | EDIT   | ~5 lines appended to the existing warm smoke: check a habit + one brush-teeth field, assert both render.                                                                  |
| `docs/architecture.md`                             | EDIT   | §2 write-path diagram: the first **batch multi-row** write + the first `kind = NULL` writer. Embedded in the PR description per AGENTS.md.                                |
| `docs/spec.md`                                     | EDIT   | Fix `:95` — documents the tagged union as "exactly-one-of", but the DB is **at-most-one** (`0002:79`) and V1-5 is the first to ship a **neither** row.                    |
| `docs/plans/v1-5-checkins-form.md`                 | NEW    | This plan.                                                                                                                                                                |
| `docs/plan.md` · `docs/status.md`                  | EDIT   | Link the plan; backlog row + pointer + changelog.                                                                                                                         |

**Deliberately NOT created** (all deleted from the draft by the panel): `packages/shared/src/checkins.ts`
and its barrel edit; `logCheckinsSchema` / `checkinItemSchema` / `CHECKIN_MAX_ITEMS`;
`checkinValueSchemaFor`'s `duration` / `number` / `text` branches; `CONTROL_BY_VALUE_TYPE` + the
`CheckinControl` union; `CHECKIN_METRIC_ACTIVITY_KEYS`; `checkinFieldByKey`; `ACTIVITY_TYPE_BY_KEY` /
`METRIC_DEFINITION_BY_KEY`; the injectable-rows test seam; the jsdom component-test file.

---

### `apps/web/lib/checkins/checkin-fields.ts`

```ts
export type CheckinField = {
  key: string; // `${activityKey}` (habit) | `${activityKey}:${metricKey}` (metric)
  activityKey: ActivityTypeKey;
  metricKey: MetricKey | null;
  label: string;
  unit: Unit; // display only — the DAL writes the unit from the DB row
  valueType: MetricValueType | null; // null → bare habit checkbox
  min?: number;
  max?: number;
};

export const CHECKIN_FIELDS: readonly CheckinField[] = [
  ...ACTIVITY_TYPE_SEED_ROWS.filter((a) => a.inputShape === ACTIVITY_INPUT_SHAPE.boolean).map(
    habitField,
  ),
  ...ACTIVITY_METRIC_MAP[ACTIVITY_TYPE_KEYS.brush_teeth].map(metricField),
];

export const valueInputName = (k: string) => `v:${k}`;
export const clientIdInputName = (k: string) => `c:${k}`;
```

`metricField` sets `min: 1, max: 10` for `scale_10` and `min: 0` for `count`; `bool` gets neither.
Control choice is one ternary in JSX (`valueType === 'bool' || valueType === null` → checkbox, else
number) — no dispatch table, because the seeded catalog contains exactly three value types and the
second real caller (V1-6 calisthenics) is where a table should be _extracted_ from two examples
rather than guessed from one. Order is catalog-seed order → stable DOM for e2e + screenshots.

### The `z.literal(1)` trap (blocking bug in the draft, found independently by two reviewers)

`FormData.get()` returns `FormDataEntryValue` — the **string** `"1"`, never the number `1`. zod's
`ZodLiteral` is a strict `===` with no coercion, so the draft's `z.literal(1)` rejected **every
checkbox**, making the PR's happy path unreachable. It was masked from typecheck by a declared
`z.ZodType<number>` return type erasing the input type.

```ts
const BOOL_VALUE = z.literal('1').transform(() => 1);
const scaleValue = (f: CheckinField) => z.coerce.number().int().min(f.min!).max(f.max!);
const countValue = (f: CheckinField) => z.coerce.number().int().min(0).max(VALUE_NUM_MAX);
```

`VALUE_NUM_MAX = 99999.999` is derived from the `numeric(8,3)` column so an out-of-range value is a
typed envelope, not an unhandled `22003` overflow escaping to `error.tsx`. **A required test passes a
real `FormData` (not a hand-built object) and asserts the string `"1"` parses to numeric `1`.**

### `logCheckinsAction`

```ts
// 1. Walk the TRUSTED registry — never enumerate the body. Unknown keys are inert,
//    and neither `unit` nor `activity_type_id` is ever read from the request.
const items = [];
const fieldErrors: Record<string, string[]> = {};
for (const f of CHECKIN_FIELDS) {
  const raw = formData.get(valueInputName(f.key));
  if (raw === null || String(raw).trim() === '') continue; // unchecked / blank
  const value = valueSchemaFor(f).safeParse(raw);
  const clientId = uuidSchema.safeParse(formData.get(clientIdInputName(f.key)));
  if (!value.success) {
    fieldErrors[f.key] = value.error.issues.map((i) => i.message);
    continue;
  }
  if (!clientId.success) {
    fieldErrors[f.key] = ['Could not submit this item.'];
    continue;
  }
  items.push({ field: f, clientId: clientId.data, value: value.data }); // carry `f` — no re-lookup
}
if (Object.keys(fieldErrors).length)
  return { ok: false, error: 'Please fix the errors below.', fieldErrors };
if (items.length === 0) return { ok: false, error: 'Check at least one thing.' };

// 2. Untrusted scalars: profileId + the rendered day.
const profileId = uuidSchema.safeParse(formData.get('profileId'));
const day = isoDaySchema.safeParse(formData.get('day'));
if (!profileId.success || !day.success) return { ok: false, error: 'Please fix the errors below.' };
if (Math.abs(daysBetween(day.data, todayIso())) > 1)
  return { ok: false, error: 'That day is no longer open.' };

// 3. Re-resolve the profile server-side — see the authZ note below.
const profile = await getProfileByPublicId(profileId.data);
if (!profile) return { ok: false, error: 'No profile found to log against.' };

// 4. Write, then surface a partial result rather than swallowing it.
const results = await logCheckinEntries({ profilePublicId: profile.id, day: day.data, items });
revalidatePath(`/p/${profile.id}`);
const created = results.filter((r) => r.created).length;
if (created === 0) return { ok: false, error: 'Those check-ins were already logged.' };
return { ok: true, error: null };
```

Errors **accumulate** across the whole loop (the draft returned on the first bad field — a
one-error-at-a-time form for a kid on a phone), and the descriptor `f` is carried into `items` rather
than re-derived by re-encoding a key and re-parsing it through a Map behind a `!` assertion.

### `logCheckinEntries` (`lib/dal/entries.ts`)

Returns **per-item results**, per AGENTS.md ("client UUIDv7 per item + DB UNIQUE + ON CONFLICT;
per-item results") — a bare `{ count }` cannot distinguish a full replay from a partial conflict, and
v1.5's `/api/sync` is specified around per-item results and would tear it out.

```ts
export async function logCheckinEntries(args: {
  profilePublicId: string;
  day: string;
  items: readonly CheckinItem[];
}): Promise<readonly { clientId: string; publicId: string | null; created: boolean }[]>;
```

1. Resolve the profile by `public_id`; throw if unknown.
2. Resolve each **distinct** `activityKey` via the cached `getActivityTypeIdByKey`, and each distinct
   `metricKey` via the widened `getMetricDefinition` — **outside** the transaction (cached reads of
   immutable reference data). The resolved row is also where `unit` comes from: writing the unit from
   a compiled const while only checking the key's _existence_ in the DB is exactly the drift the
   draft claimed to prevent.
3. One multi-row insert, `.onConflictDoNothing({ target: clientId, where: isNull(deletedAt) })`,
   `.returning({ publicId, clientId })`. Row shape: `kind: null`, `valueNum: String(value)` (**always
   set** — see the trap), `movementName` omitted, `activityTypeId`, `metricKey`, `unit` from the
   catalog row, `status: ENTRY_STATUS.done`. Verified: drizzle 0.45.2 emits the `where` in the
   index-predicate position, so it correctly matches the partial UNIQUE.
4. Map returned rows back onto the input `clientId`s → `created: true/false` per item.

**No `db.transaction`.** A single multi-row INSERT is already atomic; `logStrengthEntry`'s tx exists
because it spans two tables. (Panel architecture m6.)

**Read path:** `EntryDTO.kind: EntryKind | null`, plus a LEFT JOIN on `activity_types` (PK join → at
most one match → no fan-out; LEFT so nothing is dropped; `desc(createdAt)` unchanged).

### `entryLabel` — dispatch is over disjoint discriminants, **not** ordered

The draft claimed branch order was load-bearing because "V1-1b backfilled `activity_type_id` onto
every legacy row." **Two reviewers falsified this independently.** Migration `0002` step 4a backfilled
**both** columns:

```sql
UPDATE "entries" SET "activity_type_id" = (…'weigh_in'), "metric_key" = 'bodyweight'
WHERE "kind" = 'bodyweight' AND "activity_type_id" IS NULL;
```

So every legacy bodyweight row carries `metric_key` and is caught by **branch 1** — which is where
`Bodyweight — 72.5 lb` actually comes from (`entry-label.ts:22`), not the legacy `kind` branch. Every
strength row has `movement_name NOT NULL` (forced by `entries_shape_check`) → branch 2. **The legacy
`kind` branches are unreachable in the database** and have been since V1-4 shipped them. The draft's
proposed regression test would have pinned a row shape the schema cannot emit — and passed regardless
of branch placement.

```
1. metricKey !== null → switch (valueType):
     'bool'     → metricLabel                        // "Stance"
     'scale_10' → `${metricLabel} — ${value}/10`     // "Pressure — 7/10"
     'number' | 'count' | default → value === null ? metricLabel : `${metricLabel} — ${value} ${unit}`
2. movementName !== null → movementName
3. activityLabel → activityLabel                     // NEW: bare habit ("Rice bucket")
4. legacy kind fallbacks — DEAD IN THE DB; deleted at V1-1d
```

The three live branches key on **mutually exclusive** columns (`entries_value_source_check` is
at-most-one; a habit has neither), so this is discriminant dispatch, not an ordered ladder — which is
what V1-4's panel asked for. The test asserts branch 1 still wins for a metric-carrying bodyweight
row: the case the e2e actually exercises.

### `db:verify` additions

`verify.ts:512-545` **already** asserts a `kind = NULL` row with `metricKey: 'stance'` round-trips
(added by V1-1c). The draft re-specified it. Only two assertions are genuinely new:

1. A **neither-source** habit row (`activity_type_id` set, `metric_key` **and** `movement_id` NULL,
   `kind` NULL, `value_num = '1'`) inserts and round-trips — the shape V1-5 introduces.
2. `kind = NULL` + `value_num` omitted + `movement_name` NULL is **rejected by constraint name**
   (`entries_shape_check`), following the `rejectedConstraint` pattern at `verify.ts:549-568` rather
   than a bare `assert.rejects`.

## Test plan

All Vitest tests live under `apps/web` (the required root `test` job is `pnpm --filter web test`).

- **Unit — `checkin-fields.test.ts` (node).** Habit fields equal
  `ACTIVITY_TYPE_SEED_ROWS.filter(inputShape === 'boolean').map(a => a.key)` — asserted against the
  seed array itself, so a seed change flips the test with no synthetic fixture and no injectable
  parameter. Brush-teeth yields exactly `ACTIVITY_METRIC_MAP.brush_teeth.length` fields; `scale_10`
  carries `min`/`max` from the shared consts; key encoding round-trips.
- **Integration — `actions.test.ts` (node, DAL + `next/cache` mocked).** **Driven through a real
  `FormData` object**, not a hand-built record — that is what catches the `z.literal` class of bug.
  Boundary: missing/malformed `profileId` → reject, `getProfileByPublicId` never called; unknown
  profile → `ok:false`, no write, no `revalidatePath`; empty submit → reject; `v:evil_key` ignored;
  `scale_10` = 0 / 11 / `'abc'` → reject; a stale `day` (±2) → reject. Happy path: two checked boxes
  → one `logCheckinEntries` call with those two items, `value: 1`, each `clientId` threaded, and
  `revalidatePath('/p/<id>')`. Multi-error: two bad fields → **both** keys present in `fieldErrors`.
- **Unit — `entry-label.test.ts` (node).** `bool` → `Stance`; `scale_10` → `Pressure — 7/10`; bare
  habit → `Rice bucket`; and the metric-carrying bodyweight row → `Bodyweight — 72.5 lb`. Labels
  derived from the seed consts.
- **DB — `pnpm db:verify`** (PGlite, required `quality` job): the two new assertions above.
- **E2E** — ~5 lines on the existing warm smoke. Locators use `exact: true` + section scoping via
  `getByRole('region', { name })` (lessons.md: substring matching bit us in V0-11; `shot` vs `shots`
  is a live collision here).
- **Screenshots** (AGENTS.md UI PR rules, missed by the draft): `pnpm --filter web screenshot` for
  four states — empty, filled, validation-error, already-logged — in the PR description.
- **Local:** `pnpm typecheck && pnpm lint && pnpm test && pnpm format:check && pnpm --filter @mat-plan/db db:verify && pnpm build`.

## UI notes (a11y)

- `<section aria-labelledby>` + `<h2 id>` matching `page.tsx:42-53`; two `<fieldset>/<legend>`s;
  `<ul>/<li>` rows; `<label htmlFor>` per control.
- ≥44px tap target via a padded label row — **plus** a `has-[:focus-visible]:ring` style on that row,
  since the focus ring otherwise lands on the ~16px native checkbox (meets tap-target, fails
  focus-visible).
- `inputMode="numeric"` on `scale_10`/`count`; `autoComplete="off"`.
- Per-field errors render next to their control with `aria-invalid` + `aria-describedby` (mirroring
  `bodyweight-form.tsx:77-85`), not just one top-level paragraph — otherwise "fix the errors below"
  points at nothing.
- Already-logged fields use **`aria-disabled` + readOnly presentation**, not `disabled`: disabled
  controls leave the tab order and their `aria-describedby` explanation becomes unreachable. They are
  also **controlled** (`checked` from state seeded by `loggedFieldKeys`), because `defaultChecked` is
  not reconciled after mount — the draft's `defaultChecked disabled` would render a just-logged habit
  greyed-out and _unchecked_, the exact "my tap did nothing" failure it claimed to design out.
- An `aria-live="polite"` status announces "Logged N check-ins" — this form logs up to 10 things at
  once and the results appear elsewhere on the page.
- Empty state: if the registry yields no fields the section is omitted (DoD checklist item).

## Risks / rollback

| Risk                                                                                                                                                                                                                                                                                                                                                        | Mitigation                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entries_shape_check` rejects a kind-less insert                                                                                                                                                                                                                                                                                                            | Always write `value_num`, never `movement_name`; pinned by `db:verify` in both directions, rejection asserted **by constraint name**.                                                                                                                                                                                                                                                             |
| **Duplicate rows** — random UUIDv7 per render means a re-submit writes a second row (**accepted**, see below)                                                                                                                                                                                                                                               | Already-logged fields are `aria-disabled` + not submitted. Residual accepted: a crafted POST or a second device can duplicate. **See the V1-9 debt note.**                                                                                                                                                                                                                                        |
| **V1-9's natural-key UNIQUE may fail to create** if duplicates exist in prod by then                                                                                                                                                                                                                                                                        | Documented debt, not a silent trap: V1-9 must run a dedupe/soft-delete pre-check before `CREATE UNIQUE INDEX … (profile_id, activity_date, activity_type_id, metric_key)`.                                                                                                                                                                                                                        |
| Evening habit lands on the wrong UTC day                                                                                                                                                                                                                                                                                                                    | The rendered `day` rides in the form and is validated ±1 in the action, so the write matches what the user saw. Header timezone remains a separate backlog item.                                                                                                                                                                                                                                  |
| `client_id` UNIQUE is **global**, not profile-scoped (`0000:71`) — a colliding id silently suppresses a write                                                                                                                                                                                                                                               | Per-item `created` flags surface it; the action reports "already logged" instead of a false success. Client ids are random and never leave the server (`EntryDTO` doesn't expose them). Follow-up: scope the index to `(profile_id, client_id)`.                                                                                                                                                  |
| `numeric(8,3)` overflow → unhandled 500                                                                                                                                                                                                                                                                                                                     | Every numeric branch clamped to `VALUE_NUM_MAX`; boundary test at the limit.                                                                                                                                                                                                                                                                                                                      |
| **Deploy-order race on the new `ladder` seed row** — Vercel's deploy and the `migrate + seed` workflow both fire on the same push to `main`, with no ordering between them. If the app deploys first, the form renders a `Ladder` checkbox whose `metric_definition` row isn't seeded yet, and submitting it throws in `getMetricDefinition` → `error.tsx`. | Window is ~1-2 min and **self-healing** (the seed lands, then it works). Failure mode is a visible error, not corrupt data — the row is never written. Ticked as accepted for a 2-user dogfood app; the general fix (gate the deploy on the seed job) belongs with the V1-14 hardening pass. **Merge during a quiet window, and confirm the seed job is green before logging a brush-teeth day.** |
| **No rate limiting** — this PR writes up to 10 rows/POST vs V0-8's 1                                                                                                                                                                                                                                                                                        | Inherited gap (no rate limiting exists anywhere in the repo yet), explicitly recorded here rather than silently widened. Closes at **V1-14**.                                                                                                                                                                                                                                                     |
| **No authN/authZ in the action** — `getProfileByPublicId` scopes on `publicId` + `deletedAt` only, and the two seeded profile ids are hardcoded in `seed.ts:31`                                                                                                                                                                                             | **Stated plainly, not called an "ownership seam."** Pre-existing since V1-3, not worsened here. The gate is middleware-only, which `.github/SECURITY.md:15` explicitly disclaims as the auth boundary. Closes at v1.5 (Clerk + household scoping).                                                                                                                                                |
| No Sentry `withServerActionInstrumentation`                                                                                                                                                                                                                                                                                                                 | Consistent with the existing actions; recorded as V1-14 debt.                                                                                                                                                                                                                                                                                                                                     |

**Rollback:** revert the PR. No migration, no DDL, no data transform.

## Out-of-scope / deferred

- **V1-6** — calisthenics totals, `aggregation` rollups, ramp/adherence. Note for V1-6: with
  duplicates permitted, `aggregation: 'last'` on the bool check-ins is only well-defined if it
  aggregates defensively over `desc(created_at)`.
- **V1-7** — `timing` activities. Note: `CHECKIN_FIELDS` is **not** a one-line seam for these —
  `wake` has an empty `ACTIVITY_METRIC_MAP` entry, so it matches neither source, and
  `wrestling_practice` needs `event_at` semantics plus a non-numeric value shape.
- **V1-8** — sessions, supersets, per-set strength. Check-ins write `session_id = NULL`, which
  `spec.md:92` already declares optional; this does not constrain V1-8.
- **V1-9** — edit / uncheck / delete / LWW and the natural-key UNIQUE (**with the dedupe pre-check
  above**). **Accepted for now: a mis-tapped habit is uneditable in-app until then.**
- **V1-10** — runtime DB-driven catalog.
- **V1-13** — CSV pivot. Two notes: `shot` belongs to both `brush_teeth` and `shots`, so the label
  alone doesn't disambiguate (the field key does); and with `status = 'done'` only, "didn't do it"
  and "didn't log it" are the same state.
- No new seed rows, no `schema.ts` change, no Clerk, no offline/TanStack Query, no i18n.

## Open questions

_(Resolved — kept for the record.)_

1. **`ladder` vs `footwork` — RESOLVED: the seed is wrong, not the spec.** Domain ruling from Ray
   (2026-07-22): **ladder and footwork are genuinely separate things**, but in the daily
   "brush your teeth" context it "almost always means **ladder drills**." So `spec.md:147` was
   correct and V1-2's `footwork` substitution was the error.

   **Fix (in this PR, and this is the cheapest moment it will ever be):** check-ins have no write
   path until now, so **zero `entries` rows reference `footwork`** — no FK to migrate, no
   expand→contract, no DDL. Add a `ladder` `metric_definition` seed row and point
   `ACTIVITY_METRIC_MAP.brush_teeth` at it. **`footwork` stays in the catalog** as a distinct metric
   (unreferenced for now, available to a later activity) rather than being deleted — per the ruling
   that the two are separate concepts. Seeding is `ON CONFLICT (key) DO NOTHING`, so this is
   reference data, not a migration.

   This is the one deviation from the plan's "no new seed rows" line, and it is deliberate: V1-5 is
   the first PR to put these seven labels in front of a user, so shipping the wrong one would mean
   correcting live reference data later, once `entries` rows point at it.

## Review-response log (adversarial panel)

Four independent lenses. The draft was cut from ~850 to ~450 lines of code and lost its a/b split.

| #   | Lens                      | Critique                                                                                                                                                                                                                                                                                          | Resolution                                                                                                                                                                                                                                                                            |
| --- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Correctness; Security     | **BLOCKING, found independently by two lenses:** `z.literal(1)` cannot parse `FormData`'s string `"1"` — the happy path always failed. Masked from typecheck by the declared return type.                                                                                                         | **Accepted.** `z.literal('1').transform(() => 1)`; a required test drives a real `FormData` and asserts the string→number parse.                                                                                                                                                      |
| 2   | Correctness; Architecture | **BLOCKING, found independently by two lenses:** the "branch ordering is load-bearing" rationale is **false** — `0002` step 4a backfilled `metric_key` too, so legacy rows hit branch 1 and the legacy `kind` branches are dead in the DB. The proposed regression test pinned an impossible row. | **Accepted.** Rewritten as order-independent dispatch over disjoint discriminants; legacy branches marked dead; the test now pins the case the e2e actually exercises.                                                                                                                |
| 3   | Simplicity                | **BLOCKING:** the plan re-inflated exactly what V1-4's panel cut — "deferred ≠ blessed." ~450 of ~850 lines served value types the seeded catalog does not contain (`duration`, `number`, `text` all have zero check-in metrics).                                                                 | **Accepted in full.** Deleted `packages/shared/src/checkins.ts`, `CONTROL_BY_VALUE_TYPE`, `checkinValueSchemaFor`'s dead branches, `CHECKIN_MAX_ITEMS`, `CHECKIN_METRIC_ACTIVITY_KEYS`, `checkinFieldByKey`, both `*_BY_KEY` maps, the injectable test seam, and the jsdom test file. |
| 4   | Simplicity; Architecture  | **BLOCKING:** the a/b split is a bisection, not a seam — 7 of 14 non-doc files were edited twice, 5a didn't satisfy the verbatim criterion, and one plan doc covering two PRs violates `plans/README.md`.                                                                                         | **Accepted.** Collapsed to **one PR**, one plan, one backlog row.                                                                                                                                                                                                                     |
| 5   | Architecture              | **BLOCKING:** the "adding a habit = pure data, no deploy" headline is false — it also forces an `activity-metric-map.ts` edit (exhaustive Record), plus a redeploy and a seed run.                                                                                                                | **Accepted.** Goal and acceptance reworded to "derived, not hand-coded — no UI/action/DAL change"; the spec §4b 🟢 claim dropped.                                                                                                                                                     |
| 6   | Architecture              | **BLOCKING:** splitting one concept across `packages/shared` + `apps/web` was justified by the test runner, not blast radius — and that premise is a one-line vitest config gap.                                                                                                                  | **Accepted.** The shared module is gone entirely; the registry is app-local (its only consumers are the colocated form and action).                                                                                                                                                   |
| 7   | Correctness               | The `entries_shape_check` truth table omitted the `value_num NULL, movement_name NOT NULL` row, so the stated derivation ("movement_name MUST be NULL") didn't follow.                                                                                                                            | **Accepted.** Table corrected to 3 rows; invariant restated as the OR; our encoding documented as a deliberate safe subset, with a warning against re-deriving from it.                                                                                                               |
| 8   | Correctness; Security     | `client_id` UNIQUE is **global**, not profile-scoped: a colliding id silently suppresses a write while returning `ok:true`.                                                                                                                                                                       | **Accepted.** DAL returns per-item `created` flags; the action reports "already logged" rather than false success. Index-scoping follow-up recorded.                                                                                                                                  |
| 9   | Correctness               | `todayIso()` is UTC; V1-5 is the first feature about _evening_ habits.                                                                                                                                                                                                                            | **Accepted (user decision).** The rendered `day` rides in the form and is validated ±1 server-side. Per-profile timezone deferred as its own item.                                                                                                                                    |
| 10  | Architecture              | Proposed deterministic UUIDv5 `client_id` — would make double-tap server-side impossible and set up V1-9's LWW.                                                                                                                                                                                   | **Rejected (user decision):** deviates from the AGENTS.md `client_id = UUIDv7` convention and the v1.5 offline-outbox model. **Consequence accepted and recorded**: duplicates remain possible, so V1-9 needs a dedupe pre-check before creating its natural-key UNIQUE.              |
| 11  | Security                  | `logCheckinsAction` fails 4 of 7 AGENTS.md mandates; calling `getProfileByPublicId` "the ownership seam" overstates it — it's an existence check with no household scope, and the seeded profile ids are hardcoded in the repo.                                                                   | **Accepted.** Rewritten as an explicit accepted-risk row naming the gap, its V1-3 provenance, the SECURITY.md:15 conflict, and the v1.5 close.                                                                                                                                        |
| 12  | Security; Simplicity      | Return-on-first-error; `fieldErrors` computed but never rendered; `defaultChecked disabled` renders a just-logged habit unchecked; `disabled` breaks keyboard/SR access.                                                                                                                          | **Accepted.** Errors accumulate and render per-field with `aria-invalid`/`aria-describedby`; already-logged fields are controlled + `aria-disabled`.                                                                                                                                  |
| 13  | Simplicity                | Cut the already-logged UX entirely (~60 lines) — a duplicate row is cosmetic for a dogfood app.                                                                                                                                                                                                   | **Rejected.** Interacts with #10: having kept random UUIDv7 _and_ deferred edit to V1-9, this is the only defense against the duplicates that would block V1-9's index. Kept, but rebuilt per #12.                                                                                    |
| 14  | Correctness; Architecture | One of the proposed `db:verify` assertions **already exists** at `verify.ts:512-545` (added by V1-1c).                                                                                                                                                                                            | **Accepted.** Scoped to the two genuinely-new facts; rejection asserted by constraint name.                                                                                                                                                                                           |
| 15  | Architecture              | `logCheckinEntries → { count }` discards per-item results AGENTS.md requires and v1.5's `/api/sync` is specified around.                                                                                                                                                                          | **Accepted.** Returns `{ clientId, publicId, created }[]`.                                                                                                                                                                                                                            |
| 16  | Architecture              | `unit` written from a compiled const while the DAL only checked key _existence_ — the exact drift the plan claimed to prevent.                                                                                                                                                                    | **Accepted.** `assertMetricKeyExists` widened to `getMetricDefinition`; the DB row supplies the unit.                                                                                                                                                                                 |
| 17  | Architecture; Security    | Missing `docs/architecture.md` diagram (first batch multi-row + first `kind = NULL` write path) and missing PR screenshots.                                                                                                                                                                       | **Accepted.** Both added to the file-by-file table and the test plan.                                                                                                                                                                                                                 |
| 18  | Architecture; Correctness | `spec.md:95` documents the tagged union as "exactly-one-of"; the DB is at-most-one, and V1-5 is the first to ship **neither**. Higher priority than the cosmetic `ladder`/`footwork` mismatch.                                                                                                    | **Accepted.** `spec.md:95` fixed in this PR; `ladder`/`footwork` split out to a standalone docs PR rather than gating implementation.                                                                                                                                                 |
| 19  | Architecture; Security    | Client component pulled the whole shared barrel (no `sideEffects: false`) into the bundle.                                                                                                                                                                                                        | **Accepted.** The RSC page passes `CHECKIN_FIELDS` as a **prop**; the client shell imports the type only, so the catalog crosses as JSON.                                                                                                                                             |
| 20  | Architecture              | `db.transaction` around a single multi-row INSERT buys nothing; profile resolved outside the tx unlike `logStrengthEntry`.                                                                                                                                                                        | **Accepted.** Transaction dropped, with the rationale recorded.                                                                                                                                                                                                                       |
| 21  | Correctness               | `z.number().finite()` is a deprecated no-op in zod 4; `.flatten()` also deprecated.                                                                                                                                                                                                               | **Accepted** for `.finite()` (removed). `.flatten()` retained for consistency with the two existing actions; repo-wide migration is its own chore.                                                                                                                                    |
| 22  | Simplicity                | 570-line plan for a ~400-line PR; median plan in this repo is ~90 lines.                                                                                                                                                                                                                          | **Partially accepted.** Cut substantially, but this plan keeps the two falsified-claim autopsies and the full review log — that reasoning is the artifact's value.                                                                                                                    |
