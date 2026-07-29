# V1-8-3d — Superset UI + read bracketing (closes V1-8) — Staff plan

> Backlog: [plan.md](../plan.md) **V1-8-3d**, the LAST slice of **V1-8** (remainder plan:
> [v1-8-3-remainder-feel-and-supersets.md](./v1-8-3-remainder-feel-and-supersets.md), Part C; ADR:
> [0003](../decisions/0003-superset-log-grouping.md)). 3c (#57) shipped the superset **write core** (schema
>
> - writer + `db:verify`), proven but with no app UI. This slice **wires it end-to-end**: the form lets a
>   kid group 2+ movements into a superset, the write path forwards it, and the day view **brackets** the
>   superset's members within the session block. Closes V1-8 "+ light superset". Branch:
>   `feat/v1-8-3d-superset-ui` (off 3c until 3c merges).

## Goal

Two user-visible things: (1) in the strength form, select 2+ movement cards and **"Group as superset"** —
they log as a superset (alternating), the same interaction for kids' light superset and Ray's v2 PPL
pairing; (2) on the day's log, a session's superset members read as a **labeled sub-bracket** within the
session block, in their alternating order; standalone movements stay individual. No migration.

## Design decisions

**D1 — Action + DAL: forward the supersets end-to-end (additive on 3c).** The `movements` JSON already
carries `supersetClientId`/`supersetOrder` per movement (3c schema); the form starts populating them. Add a
**second sibling hidden field** `<input name="supersets">` (its own `JSON.parse` + try/catch, symmetric to
`movements` — NOT folded into the movements array; the "movements field IS the array" invariant, panel A2).
The action parses it into the safeParse input; `logStrengthSession` gains `supersets` on
`LogStrengthSessionArgs` and passes it to `writeStrengthSession` (3c already accepts `supersets?`). One
pass-through line + one JSON parse — the writer branch already exists.

**D2 — Read: add `supersetId`(public_id)/`supersetOrder` to `EntryDTO` + a `supersets` LEFT JOIN.** Mirror
the 3a `sessions` join: `leftJoin(supersets, and(eq(entries.supersetId, supersets.id), isNull(supersets.
deletedAt)))` — PK join (≤1, no fan-out), `deleted_at` in the **ON** so a soft-deleted superset degrades
its members to standalone (not dropped). Select `supersetId: supersets.publicId` (public_id — anti-IDOR,
never the internal id) + `supersetOrder: entries.supersetOrder` (+ `supersetLabel: supersets.label`). Add
to `EntryDTO` (additive/nullable). **Fix the stale `entries.ts` comment** that mis-attributes these to
"V1-8-3b" (panel A2 — this is the 3d it named).

**D3 — Read grouping: refactor `SessionRow.movements` → a two-level `items: SessionItem[]`.** In
`activity-totals.ts` (the pure module — grouping stays out of the RSC):

```
type SessionItem =
  | { kind: 'movement'; entry: EntryDTO }
  | { kind: 'superset'; superset: { id: string; label: string | null }; members: EntryDTO[] };
SessionRow = { kind:'session'; session: {id, type, feel}; items: SessionItem[] };
```

Within a session's members (already gathered by the 3a full-pass `sessionId` map): group by **`supersetId
!== null`** (NOT `supersetOrder` — a soft-deleted superset yields `supersetId` NULL + a live `supersetOrder`;
keying on order would bracket an orphan — panel A4). A superset item's `members` sorted by `supersetOrder`
asc; standalone members become `{kind:'movement'}`. **Item order = earliest member `id`** (the 3a anchor
idiom — a superset block sits at its earliest member's position). This is the honest non-additive refactor
the 3a plan flagged — contained to the pure module + `page.tsx`'s session arm + its test.

**D4 — `page.tsx`: render the sub-bracket.** The session block's `<ul>` maps `items`: a `{kind:'movement'}`
via the shared `<MovementLine>` (reused, no copy-paste); a `{kind:'superset'}` as a labeled container
(a nested `<li>` with a small "Superset" heading — `label ?? 'Superset'`, the null-label fallback mirroring
`?? DEFAULT_SESSION_TYPE`) + a nested `<ul>` of its members via the **same** `<MovementLine>`. **Fix the
header count** — it was `movements.length`; after the two-level refactor `items.length` ≠ movement count, so
count the movements (sum standalone + all superset members).

**D5 — Form: "group as superset".** A checkbox-select + "Group as superset" button (the simplest adaptive
interaction — not drag). Parent-owned state (the existing `movements` array): each `MovementCard` gains a
`selected` checkbox (`onToggleSelect`); "Group" tags 2+ selected cards with a shared `supersetClientId`
(minted via `newId()` in parent state) + a 1-based `supersetOrder` (their order among the group); an
"Ungroup" affordance clears them. A parallel `supersets` state (`{clientId}[]`) serializes to the new hidden
field; the per-movement `supersetClientId`/`supersetOrder` serialize into the existing `movements` JSON.
**Dissolve a superset when its membership drops below 2** — on `removeMovement` AND explicit ungroup (strip
the members' `supersetClientId`/`supersetOrder` + drop the `supersets[]` entry), or the ≥2 `superRefine`
rejects on submit (panel architecture A1). Reuse `inputClass` + the key-remount reset (the `gen` bump clears
superset state for free). No stored label from the form (leave NULL — the read shows "Superset"; panel S3).

**D6 — Deferred (unchanged):** stored superset label (NULL; derive at read), set edit/delete (V1-9/9b),
`next_day_soreness` (v2). No migration, no writer change (3c's branch is complete).

## File-by-file

| Path                                           | Change | What                                                                                                                                                                                           |
| ---------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/app/p/[profileId]/actions.ts`        | EDIT   | Parse the second sibling `supersets` JSON field (try/catch); thread to `logStrengthSession` (D1).                                                                                              |
| `apps/web/lib/dal/entries.ts`                  | EDIT   | `LogStrengthSessionArgs.supersets` + pass-through; `supersetId`(public_id)/`supersetOrder`/`supersetLabel` on `EntryDTO` + the `supersets` LEFT JOIN (D1/D2); fix the stale "V1-8-3b" comment. |
| `apps/web/lib/entries/activity-totals.ts`      | EDIT   | The two-level `SessionItem` refactor + sub-bracketing (D3).                                                                                                                                    |
| `apps/web/app/p/[profileId]/page.tsx`          | EDIT   | Render the superset sub-bracket via `<MovementLine>`; fix the header count (D4).                                                                                                               |
| `apps/web/app/p/[profileId]/strength-form.tsx` | EDIT   | Group-as-superset UI + dissolve-below-2 + the `supersets` hidden field (D5).                                                                                                                   |
| `apps/web/app/p/[profileId]/actions.test.ts`   | EDIT   | Supersets thread to the DAL; a boundary case.                                                                                                                                                  |
| `apps/web/lib/entries/activity-totals.test.ts` | EDIT   | Two-level grouping: bracket order; mixed superset + standalone; soft-deleted-superset orphan → standalone.                                                                                     |
| `docs/plan.md`, `docs/status.md`               | EDIT   | 3c → merged; 3d done → **V1-8 complete**.                                                                                                                                                      |

**Not touched:** `packages/*` (3c's schema + writer are complete — 3d is app-only), migrations, `db:verify`
(the write is already proven in 3c). **No migration.**

## Test plan

- **Grouping unit** (`activity-totals.test.ts`, pure): a session with a 2-movement superset → one
  `{kind:'superset'}` item (members ordered by `supersetOrder`) + standalone `{kind:'movement'}` items;
  item order by earliest id; a soft-deleted superset (members' `supersetId` NULL, `supersetOrder` live) →
  the members render as `{kind:'movement'}` standalone (parallels the 3a soft-deleted-session test).
- **Action** (`actions.test.ts`): a valid supersets body threads `supersets` + the per-movement tags to the
  DAL; a malformed `supersets` JSON → typed `{ok:false}` (the `movements` try/catch idiom).
- **e2e** green; **tri-viewport screenshots** of the group-as-superset form + a logged superset bracket
  (extend the `strength-session` screenshot fixture with a superset).
- **Code review** — the standing round + code-reuse lens; iterate to no critical/blocking.

## Reuse obligations

- The `supersets` LEFT JOIN reuses the 3a `sessions`-join idiom (PK join + `deleted_at` in the ON);
  `supersetId` is a **public_id** (anti-IDOR). `EntryDTO` additions are additive/nullable.
- The read reuses the shared `<MovementLine>` for BOTH standalone and superset members — no copy-paste; the
  superset bracket adds only container markup.
- The form reuses `inputClass`, the parent-owned `movements` state, the key-remount reset, and `newId()` for
  the `supersetClientId` (no bespoke rotation). The `supersets` hidden field mirrors the `movements` JSON
  idiom (a parallel `JSON.parse` in the action, panel A2).
- Null-label fallback mirrors the `SESSION_TYPE_LABELS[... ?? DEFAULT_SESSION_TYPE]` pattern.

## Risks / rollback

- **R1 — the two-level refactor churns 3a's render arm + its grouping test.** Contained to the pure module +
  `page.tsx`'s session arm + the grouping test (the 3a-flagged non-additive change). Mitigated by the
  grouping unit tests.
- **R2 — the form's dissolve-below-2 invariant.** A remove/ungroup that leaves a lone tagged member would
  fail the ≥2 `superRefine` on submit; the parent-state logic must dissolve the superset. Covered by D5 +
  (ideally) a form-logic unit or an e2e.
- **R3 — a soft-deleted superset brackets an orphan.** Mitigated: group on `supersetId !== null` (D3) + a
  test.
- No migration / no writer change → fix-forward.

## Open questions (for the panel)

- **Q1 — group-as-superset interaction:** checkbox-select + "Group" button (D5, recommended) vs a per-card
  "add to superset" dropdown vs drag.
- **Q2 — superset bracket visual:** a labeled nested container ("Superset" heading + indented members) vs a
  subtle left-border/badge on adjacent members. Recommend the labeled container (clearest for "these were
  alternated").
- **Q3 — `supersetOrder` assignment:** the order among the selected cards at group time (recommended) vs a
  user-set order. Recommend card-order (kids' light superset doesn't need manual ordering).
- **Q4 — dissolve vs block on <2 members:** dissolve automatically (D5, recommended) vs surface an error.
  Recommend auto-dissolve (a lone member isn't a superset).

## 10. Review-response log (adversarial panel — 4 lens)

No blocking defect. **Kept the two-level bracket** (architecture + correctness endorsed, ADR-0003-designed,
clearer for a headline feature — 3/4 lenses comfortable; simplicity's badge is a valid lower-cost V1 altitude,
noted in the PR for Ray to redirect). Adopted the cost-trims that don't change the approach: cut the dead
label, derive supersets from movements, and closed the two correctness UX gaps.

| #   | Lens(es)                                             | Critique                                                                                                                                                                                                                                                                    | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | simplicity + architecture + correctness              | Badge vs two-level container. Simplicity: a badge/border on `supersetId!==null` members meets spec §4 with near-zero churn. Architecture/correctness: the two-level container is faithful, ADR-aligned, and correct (replay-append + soft-delete + order gaps all handled). | **Keep the two-level bracket** (clearer for the headline feature; contained churn). Flag the badge alternative in the PR so Ray can request it.                                                                                                                                                                                                                                                                                                                                                                         |
| S3  | simplicity + code-reuse + architecture + correctness | `supersetLabel` is dead in v1 (the form never writes one; the bracket always renders "Superset").                                                                                                                                                                           | **Cut `supersetLabel`** from the select/DTO/item. The bracket renders a hoisted `DEFAULT_SUPERSET_LABEL` const (in `sessions.ts`, mirroring `DEFAULT_SESSION_TYPE`).                                                                                                                                                                                                                                                                                                                                                    |
| S2  | simplicity                                           | A parallel `supersets` form state (+ a second hidden field) is redundant (no label → it's just the distinct movement `supersetClientId`s) and re-creates the dissolve-sync bug (R2).                                                                                        | **Derive `supersets` in the action** from the parsed movements' distinct `supersetClientId`s (before `safeParse`, so membership passes). No second hidden field, no parallel state. Dissolve-below-2 = strip the lone member's tags.                                                                                                                                                                                                                                                                                    |
| B1  | correctness                                          | The DAL must forward `supersets` to `writeStrengthSession` or a tagged movement throws `superset not found` (raw 500, not a typed envelope).                                                                                                                                | The **derive** (S2) always passes a `supersets` array matching the tagged movements → the writer never throws. `LogStrengthSessionArgs.supersets` + pass-through; + an `actions.test` assertion that a tagged body reaches the DAL with a non-empty `supersets`.                                                                                                                                                                                                                                                        |
| B2  | correctness                                          | Superset-level `superRefine` errors (≥2, distinct-order) land in `fieldErrors.supersets`, which the form never renders → a locked "Please fix the errors below." dead-end.                                                                                                  | **Surface `fieldErrors.supersets`** — fold `path[0]==='supersets'` issues into a rendered message (the action remap) + render them in the form.                                                                                                                                                                                                                                                                                                                                                                         |
| B3  | correctness                                          | The dissolve-below-2 logic (highest-risk new code) has no unit test; a bug rejects on submit (the B2 dead-end).                                                                                                                                                             | **Extract a pure group/ungroup/remove-with-dissolve reducer** next to the form and unit-test the transitions (2→remove→dissolved; 3→remove→gap-but-grouped; ungroup; two-supersets drop-correct-entry).                                                                                                                                                                                                                                                                                                                 |
| A1  | architecture + correctness                           | Only 1 of **3** stale "V1-8-3b" superset comments is fixed; the other two (`activity-totals.ts`, `page.tsx`) are in files 3d rewrites.                                                                                                                                      | **Fix all three** — retarget to V1-8-3d.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| A4  | architecture                                         | The header count derived in the RSC re-introduces grouping into the view (D3 says grouping lives in the pure module).                                                                                                                                                       | Expose `SessionRow.movementCount` computed in `todayRows` (sum standalone + superset members); the view reads a field.                                                                                                                                                                                                                                                                                                                                                                                                  |
| N1  | correctness                                          | The bracket `<li>` key from the label collides (all "Superset").                                                                                                                                                                                                            | Key on `superset.id` (public_id), mirroring the session block's `key`.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| R5  | code-reuse + architecture                            | `'Superset'` fallback is a re-typed literal a test also asserts; `selected` must not serialize.                                                                                                                                                                             | `DEFAULT_SUPERSET_LABEL` const (S3); the movements serialize map cherry-picks `supersetClientId`/`supersetOrder` only — `selected` stays transient parent state.                                                                                                                                                                                                                                                                                                                                                        |
| A5  | architecture                                         | `EntryDTO` is now a ~13-field wide denormalized DTO; the per-kind refactor is deferred.                                                                                                                                                                                     | Proceed additively (the established pattern; last V1-8 slice) + a one-line `docs/tech-debt.md` entry recording the deferred per-kind DTO split.                                                                                                                                                                                                                                                                                                                                                                         |
| —   | all (confirmations)                                  | —                                                                                                                                                                                                                                                                           | **Confirmed:** the `supersets` LEFT JOIN (PK, no fan-out, `deleted_at`-in-ON) degrades a soft-deleted superset to standalone (group on `supersetId!==null`, not order); replay-append lands in-bracket (full-pass map + `supersetOrder` sort); order gaps are harmless (don't re-pack); `<MovementLine>` reuse for both member kinds; the thin-DAL passthrough; the schema/writer untouched (3c complete); the first-encounter-Set within-session grouping (reuse, no generic collapse helper); no 5th revalidate copy. |
