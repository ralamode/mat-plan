# PRIV-1 — privacy review: notice, consent, retention, deletion

> Backlog: [plan.md](../plan.md) row PRIV-1. Branch: `docs/priv-1-privacy-review`.
> Milestone: [beta-1.md](../milestones/beta-1.md) §4 — scheduled **now**, because it is a hidden gate
> on `AUTH-1`.

## Goal

This app holds **minors' health data** in a **public repo**, which `AGENTS.md` calls "the least
forgiving combination there is". `.github/SECURITY.md` defers COPPA on the grounds that there are "no
child accounts, no third-party sharing" — and Beta 0 is multiple families plus Neon, Vercel, Sentry,
Upstash, Clerk, Google and GitHub Actions, so **that deferral's own trigger has fired**. Separately,
`AUTH-1` cannot be configured at all until a privacy-policy URL exists, because Clerk's and Google's
consent screens require one. So this row is upstream of auth, not a sibling of onboarding.

This PR does the review and writes its outputs: a plain-language **notice** that lists what is stored
and every processor, a **retention policy**, a **defined deletion** with the residuals stated
honestly, the **consent** requirements `AUTH-1` must wire, and `SECURITY.md`'s **threat model
rewritten for many households**.

It is **documents and policy only.** No schema change, no route, no script. The two code follow-ons it
names — serving the notice at `/privacy` (`PRIV-2`) and wrapping the deletion in a guarded script
(`PRIV-3`) — are separate PRs, because a privacy promise should be reviewed as prose before it is
reviewed as a diff.

> 🔴 **The panel escalated one finding above this PR.** Committed personal data about minors is far
> more extensive than `OSS-1`'s audit records — see **§P-4, raised to P0**. It is not fixed here
> (a rename is code and fixture churn), but this PR corrects the audit that understates it and moves
> it onto the Beta 0 blocker list. **Read that section before anything else.**

## Acceptance

From [plan.md](../plan.md) → PRIV-1 — quoted with one amendment this PR also makes to the row itself
(see `R-N7`): the row says "signed off by a **named** reviewer", which `AGENTS.md`'s no-personal-names
rule forbids satisfying. The row and `beta-1.md`'s exit criterion are both amended here to **"signed
off by the accountable role, with a date"**, which is the same accountability in the form this repo
permits.

> **PRIV-1 — privacy review, notice, consent, retention, deletion.** SECURITY.md's own trigger fires
> (multiple families + third-party processors). A notice listing data and processors, consent at
> sign-up, a written retention policy, a defined deletion (hard delete + Clerk users, residuals
> stated), run as a guarded correction for Beta 0 and self-serve with step-up in Beta 1, and
> SECURITY.md's threat model rewritten for many households. Signed off by ~~a named reviewer~~ **the
> accountable role, with a date**; not legal advice. _(Beta 0.)_

Done when:

- [ ] `docs/privacy/notice.md` exists, reads as plain language, and every factual claim traces to a
      cite in `docs/privacy/data-inventory.md`.
- [ ] `data-inventory.md` walks **all 18 tables** — including the ones that hold nothing personal,
      because absence is a claim a reader should be able to check rather than trust.
- [ ] The notice names **every** processor and what each receives, including **GitHub Actions**, which
      holds the production database credential.
- [ ] The notice states what the export **does not** contain, because the export is incomplete.
- [ ] The notice states retention where it can and **names the three vendor windows it cannot**.
- [ ] The notice states the deletion residuals once, in one list.
- [ ] `docs/runbooks.md` holds the deletion with literal `BEGIN;`/`COMMIT;`, a real dry run, the
      pre-flight integrity checks, the seed precondition, and the Clerk step.
- [ ] `.github/SECURITY.md`'s threat model describes many households **and keeps** the MCP/LLM clause,
      the one-household operational control, and the operator and unauthenticated-caller actors.
- [ ] The notice carries an **unsigned sign-off box** (role + date) and says it is **not legal advice**.
- [ ] `pnpm verify`, `pnpm guides:check` and `pnpm status:check` green.

**Expected size:** ~900–1,100 lines of markdown across ~17 files, most of them one-line pointer fixes
the panel required. Over `AGENTS.md`'s <400-line target, and deliberately not split: it is one
concern, and a privacy notice that lands without the documents it contradicts being corrected in the
same PR is the failure mode this whole row exists to prevent.

## The data inventory, and where it came from

**Derived from the schema and the code, not from memory.** Two `fact-sheet` passes over the worktree at
`38f62de`, then the panel's correctness and privacy lenses re-walked all 18 tables independently and
found columns both passes missed. The full column-by-column table lands in
`docs/privacy/data-inventory.md`; the findings that **shape the notice** are:

**Twelve of the 18 tables are household-reachable** and hold personal data: `households`, `profiles`,
`entries`, `entry_sets`, `entry_set_quantities`, `sessions`, `supersets`, `day_readiness`,
`ramp_targets`, `program_blocks`, `prescriptions`, `prescription_targets`. The other six are
reference/catalog tables — with **one exception that matters**, `movements`, which is global but
which a household **writes into** (below). Columns the first pass missed and the inventory must carry:
`households.name` (a family surname, and `profiles.name` is therefore **not** the only human
identifier), `day_readiness.note`, `supersets.label`/`note`, `program_blocks.name`/`notes`,
`entries.value_text`/`raw_reps`, `profiles.avatar`, `profiles.routine_config`.

Seven facts change what the notice has to say:

1. **There is no email, no Clerk user id and no account table.** Identity is a single shared password
   cookie, `mp_gate` (`apps/web/lib/access-gate.ts` → `GATE_COOKIE_NAME`), valid for a year
   (`apps/web/lib/constants.ts` → `COOKIE_MAX_AGE`). The notice must not describe per-person accounts.
   That same constant also sets a **second** year-long cookie, `tz`, holding the household's timezone —
   a coarse location signal — and `next-themes` writes a theme key to `localStorage`. Three stored
   items, not one.
2. **`profiles.birthdate` and `profiles.pin_hash` are dead** — no writer, reader, UI or seed value. The
   notice must not claim a date of birth is collected, and should say the column exists and is unused.
   ⚠️ But they are **not the same case**: `pin_hash` is _reserved_, owned by `PROF-1` under
   [ADR 0006](../decisions/0006-household-addressing.md), so calling it minimisation debt would
   contradict an accepted decision. And `profiles.avatar` is a _third_ unwritten personal column that
   is **already rendered** (`components/profiles/profile-tile.tsx`) — a column with a live read path
   and no writer is one that acquires a writer quietly, and what it would then hold is a picture of a
   child.
3. **"Delete" does not exist.** No hard `DELETE` anywhere in the app or the DAL; every uniqueness
   arbiter is `WHERE deleted_at IS NULL`, so a soft-deleted row **stays indefinitely**. The most
   surprising thing a reader will learn, so it goes in the notice in plain words.
4. **Export exists but is incomplete, and has no ownership boundary.** `GET /p/<profileId>/export`
   returns three CSVs per athlete per month, with the profile's `public_id` as the directory and **no
   `profiles.name` in any file** — all good. But `buildCheckins([])` is written **header-only, always**
   (`apps/web/lib/dal/export.ts`), and the month query inner-joins `movements`, so everything written
   by `logCheckinsAction` and `logLifeActivitiesAction` lands in **no CSV at all**. Also never
   exported: `day_readiness.gate_color`, `ramp_targets.target_value`, `sessions.feel`,
   `profiles.routine_config`, `prescription_targets` (only folded into a derived `prescribed` string).
   And authorization is the shared gate cookie plus "does this `public_id` resolve" — with
   `listProfiles()` handing every profile's `public_id` to every gated visitor, **anyone holding the
   household access code can download every athlete's complete training history as a zip.** The notice
   cannot call the export "how you get your data out" without both halves of that.
5. **The child is usually the one at the keyboard.** `docs/spec.md` — _"Real tool — hand it to them to
   log everything they do in a day on a phone/iPad"_; `AGENTS.md` — _"the kids log on the gym floor"_.
   The first draft of this plan said "the parent enters the data, chooses what to enter", and that is
   **wrong about this product**. The adult owns the account and is the one who can export or delete;
   the child is the primary data-entry user, typing into boxes with no filter.
6. **Two free-text boxes reach the UI, not one.** `sessions.feel`, and the **movement-name input**
   (`strength-form.tsx`) — and the movement name is the one that **leaves the household**, because
   `findOrCreateMovementId` (`apps/web/lib/dal/catalog.ts`) upserts it into the **global** `movements`
   catalog with no household scoping. That one sentence does double duty: it is also the clearest way
   to explain the `TEN-2` deletion residual to a parent.
7. **`db:seed` runs against production on every push to `main`** (`.github/workflows/migrate.yml`) and
   upserts the household and two kid profiles by fixed `public_id` with `onConflictDoNothing`. After a
   hard delete there is no conflict, **so it inserts** — the next merged PR re-creates them. Deletion
   does not stick for a seeded household. See the runbook's precondition.

## The processors, and what each receives

Derived from the code, the workflows and the CSP. The CSP (`apps/web/proxy.ts`) sets
`connect-src 'self'`, `font-src 'self'`, `img-src 'self' blob: data:` — so **no data egress from the
browser to any external host**. (The earlier claim "permits zero external hosts" was overstated:
`script-src` carries `'strict-dynamic'`, which makes a host allowlist inoperative for scripts by
design. The defensible claim is about data egress, and that one holds.)

| Processor     | Wired?               | What it receives                                                                                                                                                                                                                                         |
| ------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Neon**      | yes                  | **Everything.** It is the database.                                                                                                                                                                                                                      |
| **Vercel**    | yes                  | **The server that runs the app** — every request and **every value entered** passes through a Vercel function. It additionally retains platform logs with IP, time and URL path, and `/p/<profileId>` puts a profile id in that path.                    |
| **GitHub**    | yes, **two roles**   | (a) the public repository — source, fixtures, plans, screenshots; (b) **GitHub Actions holds the production database credential** (`DATABASE_URL_UNPOOLED`) and connects to the live database on every merge to `main`. The first draft listed only (a). |
| **Sentry**    | yes, **server only** | Server and edge errors. No client SDK, so **no visitor IP and no browser data**. `dataCollection` set off field by field (`frameContextLines` deliberately left at default); `tracesSampleRate: 0`.                                                      |
| **Upstash**   | yes, one endpoint    | The **visitor's IP**, in the plaintext key `mat-plan:gate:<ip>`, 10 attempts / 10 minutes. No training data.                                                                                                                                             |
| **Clerk**     | **not wired**        | Planned by `AUTH-1`: an email address and a Google account identifier.                                                                                                                                                                                   |
| **Google**    | **not wired**        | Planned by `AUTH-1` (sign-in). **Fonts do not reach Google at runtime** — `next/font/google` self-hosts at build.                                                                                                                                        |
| **Anthropic** | CI only, conditional | A PR's head and diff **only if `CLAUDE_CODE_OAUTH_TOKEN` is configured**; per the maintainer's own note DX-1 is dormant by choice, so today nothing reaches Anthropic. Repository content, never the production database.                                |

**Sentry is deliberately the thin case.** `apps/web/lib/sentry-scrub.ts` strips cookies, denied
headers, bodies, query strings, Server-Action form data, stack-frame variables, and everything after a
`params:` line (the SEC-3 fix). The honest claim is "designed and tested to carry no personal data",
**not** "cannot".

## Privacy rubric, dimension 10 — applied by the author, then attacked

> ⚠️ **The dedicated lens was not registered in this session, and this section records the gap plus
> its mitigation.** `AGENTS.md` and [review-pr](../../.claude/skills/review-pr/SKILL.md) rubric
> dimension 10 require the `privacy-reviewer` lens. The agent **is** defined, at
> `.claude/agents/privacy-reviewer.md` — but invoking it by name failed: _"Agent type
> 'privacy-reviewer' not found."_ So:
>
> 1. **The rubric was applied directly by the author** — the section below. Self-review, and the
>    weakest evidence in the panel.
> 2. **The lens was then run as an unnamed general agent carrying that file's committed checklist**,
>    severity scale and red flags. It attacked the self-review first, as instructed, and **it was
>    right to**: it raised P-4 from P1 to **P0**, found ~50 files the self-review missed, found the
>    child framing inverted, and found two processor rows materially wrong. Its findings are in the
>    review-response log, labelled as a stand-in.
>
> **A human reviewer should give this dimension more attention than usual.** Registering the agent is
> filed as a follow-up so the next schema/DAL/export PR gets the real thing.

**1. What personal data does this start holding?** The first draft answered **"none"** and banked it
as a pass. The security re-review showed that is wrong, and the error is instructive: a docs-only PR
makes the question _look_ trivially answerable, which is exactly when a self-review stops looking.

**It creates one store: the deletion ledger** — a household `public_id`, Clerk user ids and the
channel that verified a request, held outside git and outside the restorable database. That is data
about an identifiable family, and a permanent record that **this household asked to be deleted**,
which is not a thing someone asking to be deleted expects to be kept. It exists only because `OPS-3`
cannot make a deletion survive a database restore without it. So it gets what any other personal-data
store here gets: a stated purpose, a **retention period** (deleted once the restore windows that made
it necessary have passed), a minimal field list with **no names**, a row in the inventory, and a
sentence in the notice.

Beyond that: no column, no field, no log, no fixture. The other thing it creates is a written claim —
and a wrong claim is its own defect, which is why every factual sentence in the notice is cited and
the inventory was derived by walking the schema.

**2. Who can now read it?** Nobody new. But three existing reach problems the notice must not paper
over, all belonging to rows that already exist:

- `listProfiles()` returns **every** profile with no household predicate (`TEN-1`'s job). Until it
  lands, the notice cannot promise one family cannot see another's — **so it does not promise it.**
- The **export route** is a second unscoped surface, not just `listProfiles` — anyone with the shared
  access code can zip any athlete's full history. `TEN-1`'s scope line should name it explicitly.
- Profile tiles are a **UX switch, not a security boundary**. Concretely: **a child who taps a
  sibling's tile can read that sibling's weigh-in history.** The notice says that in those words,
  because "the tiles are a convenience" is too soft to land.

**3. Where does it leave to?** The eight rows above. Two the first pass missed — GitHub Actions
holding the prod credential, and Vercel being compute rather than metadata — plus two residual
channels: a household's **free-text movement name becomes a global `movements` row** that survives the
household's deletion (`TEN-2`'s defect from the privacy side), and **screenshot images on the public
`screenshots` branch** are captured against a seeded database whose fixture profiles carry minors'
given names. The images are pruned when the PR closes; the names are not.

**4. Can it still be exported and deleted?**

- **Exported: partially**, see fact 4. The notice says what the export omits and that a full copy is
  available on request.
- **Deleted: not yet, and that is the gap this PR closes on paper.** No delete path exists at any
  level. This PR writes the procedure; `PRIV-3` makes it guarded; `V1-9b` gives per-item delete; Beta 1
  makes it self-serve behind step-up. **A notice promising deletion without that procedure existing
  would be the defect** — which is why this row is a gate, not a formality.

### Findings against the repo as it stands

| #   | Finding                                                                                                                                                                                                 | Severity | Where it goes                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------- |
| P-1 | `profiles.birthdate` is unowned and holds nothing → minimisation. **Split from** `pin_hash`, which is reserved and **owned by `PROF-1` under ADR 0006**, and from `avatar`, which has a live read path. | P2       | `tech-debt.md`, worded as a product decision against `spec.md` §2 |
| P-2 | A soft-deleted row stays indefinitely; nothing purges it. "Delete" means "hidden".                                                                                                                      | P1       | Stated in the notice; `PRIV-3` + Beta 1 close it                  |
| P-3 | A household's typed movement names survive its deletion, in a global catalog.                                                                                                                           | P1       | Stated residual; `TEN-2` fixes the cause                          |
| P-4 | **Committed personal data about minors, across ~50 files.** See below.                                                                                                                                  | **P0**   | Audit corrected here; fix escalated to `OSS-1`                    |
| P-5 | The export route and the **seven** mutating Server Actions are unrate-limited; only the gate is. (`tech-debt.md` says "six" and is stale.)                                                              | P2       | Already tech debt; the stale count fixed here                     |
| P-6 | `db:seed` re-creates a hard-deleted seeded household on the next merge.                                                                                                                                 | P1       | Runbook precondition; `OPS-2` fixes the cause                     |

### P-4, raised to P0 — and why the existing audit understates it

The first draft filed this P1 and named two files. The privacy lens applied its own scale correctly —
_"**P0** — personal data committed to the repo"_ — and found **~50 files**, in five classes:

1. **Names bound to prescribed loads**, in shipped source (`packages/shared/src/programming.ts`) — a
   named minor wired to a per-child training load, across a workspace boundary.
2. **A whole per-minor program table** (`docs/programs/kids-sc-foundation-archived.md`) with
   per-child load and rep columns across a 37-line program. The largest committed per-minor dataset in
   the repo.
3. **Real log rows quoted verbatim as documentation examples** (`packages/shared/src/csv/row.ts`,
   `docs/csv-export-contract.md`) — named minors with performance values.
4. **Dated incidents about a named minor** in an **applied migration file**
   (`packages/db/migrations/0012_bodyweight_one_per_day.sql`), a **shipped component**
   (`strength-form.tsx`), and the corrections registry — weigh-in frequency and clock times.
5. **Names as exported API symbols** (`packages/db/src/index.ts`), so a rename is an API change, not a
   string edit.

**And the repo already contains an audit that says otherwise.** `docs/plan.md` (OSS-1) states: _"There
is no measurement history, no date of birth, no health record, and no log data… the audit does not
support it."_ That audit is dated 2026-08-11, its own blocker box says it is stale, and
`packages/db/scripts/corrections/registry.ts` landed committed log data about a named minor in
2026-10-01 — **after** it. So the public repo currently carries **two contradictory statements about
minors' data**, and this PR would have added a third.

**What this PR does about it:** corrects the OSS-1 audit rather than writing a competing one
(`data-inventory.md` becomes the live inventory; OSS-1's tables become a pointer; the "no log data"
sentence is explicitly reconciled), corrects the file list in OSS-1's follow-up row (it names three
files; it is ~50), and moves the rename from "follow-up" to a **Beta 0 blocker**.

**What it does not do:** the rename itself. It is fixture churn across ~50 files plus a public API
symbol, and it needs its own PR. ⚠️ **And a rename is not a removal** — `git log -S` finds it and the
commit author is in every commit. The notice says so, because it is the residual a reader of a public
repo is most entitled to know about.

**Unverified claim withdrawn.** The first draft asserted "no bodyweight **value** is committed". The
lens found `docs/samples/legacy-csv/` carrying weigh-in rows with values — and that folder's own README
**contradicts itself**, saying "SYNTHESISED from real files… values are replaced" in its provenance and
"Real data" in its summary table. The provenance reading is credible, so this is not being called
committed production data; but the plan will not assert the negative bare, and **the README's
self-contradiction is fixed in this PR** so the next reviewer does not have to re-litigate it.

## File-by-file changes

| Path                                                      | Change | What & why                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/privacy/notice.md`                                  | NEW    | **The user-facing notice.** The document the privacy-policy URL points at. Retention, deletion, residuals, and the unsigned sign-off box.                                                                                                                                         |
| `docs/privacy/data-inventory.md`                          | NEW    | The evidence: all 18 tables, the processor table, the committed-data inventory, the re-review triggers (as a **delta**, not a fourth copy), and the citation policy.                                                                                                              |
| `docs/runbooks.md`                                        | EDIT   | Two sections: **"Delete a household and everyone in it"** (literal `BEGIN;`/`COMMIT;`, dry run, pre-flight checks, seed precondition, Clerk step) and **the `AUTH-1` consent/dashboard checklist** that `beta-1.md` §3 already says is owed.                                      |
| `.github/SECURITY.md`                                     | EDIT   | Threat model for many households, **keeping** the MCP/LLM clause, the one-household operational control and the operator/unauthenticated actors; `:12` and `:14` marked as **target** rules with ⚠️ pointers; the COPPA paragraph brought in line and pointed at `docs/privacy/`. |
| `.claude/agents/privacy-reviewer.md`                      | EDIT   | Its hardcoded six-processor list (missing Google and GitHub) → a pointer at `data-inventory.md`, plus "check the inventory still matches" on its checklist.                                                                                                                       |
| `AGENTS.md`                                               | EDIT   | The privacy-lens paragraph and the `docs/` enumeration gain `docs/privacy/`.                                                                                                                                                                                                      |
| `packages/db/scripts/corrections/README.md`               | EDIT   | One bullet: a **deletion** correction inverts rules 2 and 5. The exception lives next to the rule it excuses.                                                                                                                                                                     |
| `docs/samples/legacy-csv/README.md`                       | EDIT   | The "Real data" cells → "synthesised from real data — shapes verbatim, values replaced", matching the file's own provenance paragraph.                                                                                                                                            |
| `docs/plan.md`                                            | EDIT   | OSS-1's audit reconciled + its file count corrected + rename escalated to a Beta 0 blocker; PRIV-1 row re-pointed and its "named reviewer" wording amended; **`PRIV-2`** and **`PRIV-3`** filed; the stale "ADR 0006 proposed/unsigned" string fixed.                             |
| `docs/milestones/beta-1.md`                               | EDIT   | §4's PRIV-1 bullet → a pointer; exit criteria gain `/privacy`, the four blanks, and the amended sign-off wording.                                                                                                                                                                 |
| `docs/tech-debt.md`                                       | EDIT   | P-1 (split per above); the stale "six Server Actions" count → seven.                                                                                                                                                                                                              |
| `docs/spec.md` · `docs/product-spec.md`                   | EDIT   | Two one-line pointers; both carry a COPPA deferral that goes stale the hour this merges.                                                                                                                                                                                          |
| `docs/architecture.md`                                    | EDIT   | §1 shows only Vercel + Neon; one line pointing at `data-inventory.md` as the complete egress list.                                                                                                                                                                                |
| `docs/status.md` · `docs/roadmap.md`                      | EDIT   | "Where we are"; Onboarding & Access next → `PRIV-2`.                                                                                                                                                                                                                              |
| `docs/changelog/2026-10-07-docs-priv-1-privacy-review.md` | NEW    | Changelog fragment.                                                                                                                                                                                                                                                               |

**Two files in `docs/privacy/`, not three.** The planned `README.md` had exactly two payloads, and the
panel showed both have better homes: the re-review triggers are **already written three times**
(`AGENTS.md`, `review-pr` rubric dimension 10, the agent's own frontmatter) so a fourth hand-typed copy
is the one that goes stale — it becomes a _delta_ in the inventory's header; and "what `AUTH-1` must
wire" belongs in the `runbooks.md` checklist `beta-1.md` §3 already designates. With both moved, the
README is an empty index.

**Citation policy** (adopted from [ADR 0006](../decisions/0006-household-addressing.md) R7, after that
ADR paid for ~20 cites resolving to unrelated text): the **living** documents cite **path + symbol**
(`access-gate.ts → PUBLIC_PATHS`), never `path:line`, because a line cite rots on the next edit above
it. This plan keeps `path:line` where it has one, since `docs/plans/README.md` freezes plans as-merged.
Two cites in the first draft were already wrong at authoring time and are corrected.

### `docs/privacy/notice.md` — the shape

Second person, short sentences, no legalese. **And it will be served unauthenticated** (`PRIV-2`), so
it separates _honest to the user_ from _useful to an attacker_: it says the maintainer can see
everything, the tiles are not a lock, treat the beta as if everyone invited could see everyone's log,
a deleted item is hidden not erased, and the git-history residual. It does **not** publish the name of
the unscoped function, the un-rate-limited endpoint list, the seed-id entropy, the cookie names and
lifetimes or the Upstash key shape — those are in `tech-debt.md` / `SEC-6` already, and the inventory
**links** them rather than restating them.

Sections: what this is · what we store · **children** (the corrected framing: the child is usually the
one logging; the adult owns the account; free-text boxes have no filter; a sibling's tile is readable)
· who can see it (**including the single shared access code with no per-person revocation** — that,
not `listProfiles`, is what makes "nobody else" untrue today) · who else it reaches · how long we keep
it · getting your data out (**and what the export omits**) · deleting it, with the **single** residual
list · what we are still confirming · how to ask · about this notice (sign-off box, not legal advice,
re-review).

### The retention policy

Training data: while the household uses the app; deleted on request, plus one sweep when the beta ends.
A soft-"deleted" item: **hidden, not erased** — it stays until the household is deleted. Both cookies
(`mp_gate` and `tz`): a year. The `localStorage` theme key: until the browser is cleared. Upstash: about
the limiter's window. CSV already downloaded: not ours. The public repository: permanently.

Three windows cannot be read from the repo — **Neon history retention, Sentry event retention, Vercel
log retention.** They are named as unconfirmed rather than guessed, and the gate on filling them sits
on **`PRIV-2`'s acceptance** (the PR that actually publishes the URL) and `beta-1.md`'s exit criteria —
not in this plan's §Open questions, which `docs/plans/README.md` freezes and nobody re-reads.

### `docs/runbooks.md` — "Delete a household and everyone in it"

Matches the file's **when · why manual · steps · safety** shape.

⛔ **Preconditions, both blocking:**

- **The requester is verified through the invitation channel** — the thread or address the invitation
  went out on, or a word agreed at invite time — **never whatever address the request arrived from.**
  Beta 0 has one shared password and no per-person identity, so there is otherwise nothing to
  authenticate an irreversible request against. A **7-day cooling-off window** between verified request
  and apply, named in the notice, and a **Neon restore branch cut immediately before apply and held for
  that window** (the notice already discloses the point-in-time residual, so this costs no new promise
  and makes a fraudulent deletion recoverable).
- **A household in the seed cannot be deleted until `OPS-2` lands.** `db:seed` runs against prod on
  every push to `main`; after a hard delete `onConflictDoNothing` finds no conflict and re-inserts. This
  applies to the maintainer's own household specifically — the one Beta 0 is most likely to delete at
  the end of the beta.

Steps: 0 verify + record · **0b record the household's Clerk user ids in the ledger _before_ the
transaction** (after `AUTH-1` the Clerk↔household mapping lives in exactly the rows step 4 destroys, so
a failure at step 6 otherwise leaves orphan Clerk accounts with nothing to identify them by) · 1 **the
household runs its own export, in the app, while it still has access** — never the operator emailing a
zip of a minor's training history · 2 resolve by `public_id` · 3 **dry run: an explicit `SELECT
count(*)` block per table, plus pre-flight integrity checks** · 4 apply · 5 verify · 6 delete the Clerk
users · 7 record completion and point the household at the notice's _Deleting it_ section.

**Step 3's pre-flight checks abort the run if non-zero** — cross-household `prescription_targets`
(whose prescription is in H but whose profile is not, and the reverse), and `entries`/`supersets`
referencing H's sessions from a profile outside H. Those FKs are unscoped in the schema and
writer-enforced only, so a stray row would otherwise abort the transaction mid-way _or_ delete a row
about another family's child. **All counts must omit `deleted_at`**, or a soft-deleted leftover reads
as zero and the proof passes on a household that still has rows.

**Step 4 is literally `BEGIN; … COMMIT;`** with `SET LOCAL lock_timeout` / `statement_timeout`, and
"if any count surprises you, `ROLLBACK`". The first draft credited the `db:correct` runner's dry run,
target-host print and one-transaction wrapper — **none of which exist until `PRIV-3`**, and every other
SQL runbook here is typed into the Neon SQL Editor, where nothing is transactional unless the operator
types `BEGIN`. A paste of 12 autocommitted `DELETE`s that aborts at step 7 destroys half a household
with no rollback, which is the exact outcome §Risks claimed was mitigated.

The delete order, child-before-parent, derived from the FK graph and **confirmed by two lenses**
independently (`entries` carries FKs to both `sessions` and `supersets`, so it must precede both — the
non-obvious one):

```
1  entry_set_quantities   6  day_readiness          11 profiles
2  entry_sets             7  ramp_targets           12 households
3  entries   ← before 4,5 8  prescription_targets
4  supersets              9  prescriptions
5  sessions               10 program_blocks
```

**`deleted_at` is deliberately in no `WHERE`** — the documented inversion of corrections README rule 5
(and rule 2: for a deletion, existence _is_ the guard). Declared in that README too, next to the rules.

**Blast radius:** every predicate chains to `households.id = H` **except** step 8's second disjunct,
which can name a profile outside H — hence the pre-flight abort. Every FK but the two cascades is `NO
ACTION`, so a table missed by the procedure aborts the transaction rather than orphaning rows: a good
property, stated rather than assumed.

**What this does NOT delete:** the notice's single residual list, referenced — not a second copy.

### The deletion ledger — defined here, because PRIV-1 is its first consumer

`OPS-3` names a deletion ledger in one clause and specifies nothing: no file, no fields, no location.
A runbook that writes to an undefined artifact is the "unwired gate cited as a safety argument" pattern,
and the natural default home — `docs/` or the corrections **Applied** table — would publish _"household
X asked to be deleted on date Y"_ permanently in the repo whose history the notice itself warns about.

So: **the ledger lives outside git and outside the restorable database**, with the operational
credentials, and the runbook names it. Fields: request date, household `public_id`, **the channel that
verified it**, Clerk user ids, apply date, restore-branch-deleted date. **No names, no email bodies, no
row counts about a child.** The one invariant `OPS-3` must honour: a per-household restore replays the
ledger before the data is served. A sentence in the `OPS-3` row points here so it inherits the shape
instead of inventing a second.

### `.github/SECURITY.md` — ownership split, and what must survive

`SECURITY.md` **owns and keeps in full**: the threat model, the bodyweight-is-privileged
classification, the logging rule, **the MCP/LLM clause** (the only place the scoped machine token is
named, and both `## Tokens / secrets` and the 403 carve-out depend on it), **the one-household
operational control** (the only thing preventing cross-household BOLA today is that prod has one
household — a rewrite to "many households" as the present state would silently retire the live control),
and **two actors the first draft dropped**: the operator/maintainer (full DB access, hand-run SQL, no
audit trail) and the unauthenticated internet caller (the `/api` matcher hole).

`SECURITY.md` **only points at**: the data inventory, the processor list, the retention periods, the
deletion procedure, and the COPPA status.

**The self-contradiction gets fixed rather than added to.** Adding "`listProfiles()` has no household
predicate" while leaving `:12` asserting "every query is scoped by `household_id`" makes the
authoritative security doc state both — and the transient status would then be false the day `TEN-1`
merges, in a file `TEN-1`'s PR has no reason to edit. So: `:12` and `:14` are marked as **target** rules
with ⚠️ pointers to `TEN-1` / `SEC-6` (the convention `AGENTS.md` already uses for unwired gates), and
the "not yet enforced" status lives in **one** place, `data-inventory.md`.

The **COPPA paragraph**: child accounts are still out; processors are **not** "no third-party sharing",
so that deferral's trigger has fired and the review has been done. No regulation is characterised
beyond naming it. The "not legal advice / may be health data under some laws" line is **kept here and
nowhere new** — it already exists in `beta-1.md`, `plan.md` and the privacy-reviewer agent; the notice
gets the one user-facing copy (it is the only place a non-engineer reads), and every repo-facing file
points rather than restates. Six copies was the alternative.

## Test plan

Nothing executable; the gates are the repo's own.

- `pnpm verify` — `skills:check` is the one that can fail on a docs PR (it checks that every path a
  skill cites exists, and this PR adds paths and edits an agent file).
- `pnpm guides:check` — green by construction; no file owned by a feature guide is touched.
- `pnpm status:check` — the changelog fragment.
- **The real check is human**: a reader asking "is this sentence true?" of each claim in the notice and
  finding it in `data-inventory.md`. That is why the inventory is committed rather than a scratch note.
- **The deletion proof is `PRIV-3`'s acceptance, not this PR's.** The correctness lens proposed a
  `db:verify` case — seed, delete household H in one transaction, assert zero rows reference H anywhere
  and `movements` is untouched. That is the right guard, and it is the _only_ thing that catches a 19th
  per-household table (`household_members`, `MOT-1`, `PUB-1`) silently escaping the runbook's
  hand-maintained list. But `db:verify` is code, and this PR is docs-only by hard constraint — so it is
  written into `PRIV-3`'s acceptance criterion instead of deferred to memory.

## Risks / rollback

| Risk                                                                                           | Mitigation                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The notice says something untrue.** Worse than no notice, because it is relied on.           | Every claim cited in `data-inventory.md`. Where the code does not support a promise, the notice says so (isolation, purging, the incomplete export). The panel already caught four false claims in the first draft.                                                                                                                       |
| **The notice goes stale.**                                                                     | Wired, not asserted: `AGENTS.md` and the `privacy-reviewer` agent both gain the pointer, the agent's competing processor list is replaced by one, and the inventory carries a literal staleness command (`git log --oneline <sha>..HEAD -- packages/db/src/schema.ts apps/web/lib/dal apps/web/proxy.ts`). No CI gate — see Alternatives. |
| **A guessed retention number.**                                                                | Named as unconfirmed; the gate sits on `PRIV-2`'s acceptance and the milestone's exit criteria.                                                                                                                                                                                                                                           |
| **The deletion SQL destroys the wrong rows.**                                                  | Order confirmed by two independent lenses; literal `BEGIN`/`COMMIT`; pre-flight integrity aborts; explicit count dry run; `public_id` targeting; rehearsal before any real family is deleted.                                                                                                                                             |
| **A deletion is undone.** Two vectors, not one.                                                | (a) a point-in-time restore → the ledger, replayed by `OPS-3`; (b) **`db:seed` on the next merge** → a blocking precondition in the runbook, fixed at root by `OPS-2`.                                                                                                                                                                    |
| **A fraudulent deletion request.** No identity exists to authenticate one.                     | Invitation-channel verification, a 7-day cooling-off window, and a restore branch held for that window. Named in the notice so it is a promise, not a hope.                                                                                                                                                                               |
| **Publishing the notice helps an attacker.** It will be unauthenticated.                       | Honest-to-the-user and useful-to-an-attacker separated explicitly; mechanism names stay in `tech-debt.md` and are linked, not restated.                                                                                                                                                                                                   |
| **This is read as legal compliance.** It is engineering hygiene in data-protection vocabulary. | Said in the notice and in `SECURITY.md`. No regulation characterised that has not been read; where a lawyer is needed the document says so.                                                                                                                                                                                               |

**Rollback:** revert the commit. Nothing deploys, nothing migrates, and the `/privacy` URL does not
exist yet.

## Alternatives considered, and rejected

| Option                                                                        | Rejected because                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Add the `/privacy` route here.**                                            | Implementation, and it needs a UX panel. ⚠️ **But `PRIV-2` is no longer "a ~1-file PR"** — there is **no markdown pipeline in the tree**, so it must add a renderer (most inject via `dangerouslySetInnerHTML`, on the "don't" list), read from outside the Next root, or hand-transcribe into JSX — which would make **two copies of the privacy notice**, the exact failure that kills a separate `retention.md`. Recommended and written into the `PRIV-2` row: `notice.md` stays the reviewed source of truth and `PRIV-2` generates the page from it with a drift test. **A maintainer decision**, not mine. |
| **One file, notice + evidence.**                                              | The notice must be plain language; a column table with cites is not. Two audiences, one derivation arrow.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **A third file, `docs/privacy/README.md`.**                                   | Was planned; cut. Both its payloads have existing homes, and a fourth copy of a trigger list is the one that goes stale.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **A separate `retention.md`.**                                                | Restating periods in two files is how they drift.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Copy a template privacy policy.**                                           | It would describe a company that does not exist and say false things about this app. The value of this document is that it is derived from this schema.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **A CI gate that fails when the schema changes without `data-inventory.md`.** | The inventory's ownership map is the whole schema, so **every** DB PR pays a toll, and a toll gets a skip label. That argument stands on its own, which matters: this PR _points_ the `privacy-reviewer` lens at the inventory, but the lens is **not currently registered** (see §Privacy rubric), so citing it as the substitute control would be the unwired-gate pattern `AGENTS.md` forbids. Registering it is a named follow-up. Revisit the gate if the inventory goes stale twice.                                                                                                                        |
| **A `db:verify` deletion proof in this PR.**                                  | It is the right guard and the lens was right to want it — but it is code, and the constraint on this PR is docs-only. Moved to `PRIV-3`'s acceptance, where the script it proves also lives.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Write a fresh committed-data inventory beside OSS-1's.**                    | Two contradictory audits of minors' data in one public repo is strictly worse than one stale audit. One owner: `data-inventory.md` is live, OSS-1 points at it.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Defer the deletion procedure to `PRIV-3`.**                                 | Then the notice promises deletion nobody has worked out how to do. The procedure is the deliverable; the script is the ergonomics.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

## Out-of-scope / deferred

- **Any code.** Three follow-ons filed:
  - **`PRIV-2`** — serve the notice at `/privacy`. Sized honestly per the Alternatives row above; its
    acceptance carries the three vendor windows and the contact route. **The real `AUTH-1` gate.** The
    page must be static or generated — never a file read keyed on a request param out of `docs/` — and
    its `PUBLIC_PATHS` addition is the #153 incident class.
  - **`PRIV-3`** — the guarded deletion script **plus its `db:verify` proof**. ⚠️ Not a drop-in registry
    entry: `Correction.run` takes no target and the runner ignores positional args, so it needs an
    explicit `--household <public_id>` flag — **a runner change, which needs its own plan** — and
    **no household id may be committed**, because `registry.ts` plus the public **Applied** table would
    publish a register of which families asked to be deleted.
  - **Register the `privacy-reviewer` agent** so the next schema/DAL/export PR gets the real lens.
- **The P-4 rename** (~50 files, including a public API symbol) — escalated to `OSS-1` as a Beta 0
  blocker. The scrub of the archived program table and the CSV-contract example rows is its own
  decision: a rename does not neutralise a per-child load column.
- **Dropping `profiles.birthdate`** — a contract migration, filed as tech debt against `spec.md` §2.
- **Purging soft-deleted rows.** Needs a decision about what "deleted" should mean before it needs code.
- **A consent timestamp column.** See Open questions.
- **Export completeness** (check-ins, readiness, `feel`) — the notice discloses the gap; closing it is a
  `V1-13c`-shaped row the maintainer may or may not want.
- **`PUB-1`, `SHARE-1`, `SOCIAL-1`, `COACH-1`.** Future enhancements, not scope — not designed, not
  raised as open questions, **and not edited.** The first draft promised "one line inside each existing
  entry"; the scope lens showed three of the four already carry it, so four edits to a 2,000-line shared
  file would buy roughly one line while conflicting with a parallel lane. Dropped.

## Open questions

The maintainer's to decide. Three gate the first invitation; the first two are tracked on **`PRIV-2`'s
acceptance**, not here, because a plan is frozen as-merged and nobody re-reads it.

1. **The three vendor retention windows** — Neon, Sentry, Vercel. ⛔ Before the first invite.
2. **The contact route.** ⚠️ The security lens ruled one option out: a **public GitHub issue must not
   be offered** — a parent will paste a household name, a child's name and a `public_id` into a
   permanently archived, search-indexed page. Recommended: a **role alias** email (rotatable, not the
   maintainer's personal address, which is itself personal data in a public repo). A form is not the
   Beta 0 answer — it starts holding new personal data and would falsify this PR's "adds no personal
   data". ⛔ Before the first invite.
3. **Where the privacy-policy URL points.** ⚠️ **Not asserted from memory:** whether Google's OAuth
   consent screen accepts a `github.com/...` URL or requires a verified domain must be read off
   Google's console when `AUTH-1` is configured. The plan assumes the app's own domain is required,
   because that is the assumption that is safe if wrong. ⛔ Before `AUTH-1`.
4. **How `PRIV-2` renders the notice** without making a second copy. See the Alternatives row.
5. **Does Beta 0 record consent of its own?** It cannot today. Sign-up is invitation-only, so the
   invitation is the record. **Recommendation: accept that and say so in the notice.** Whether Clerk's
   legal-consent setting exists and whether it _blocks_ sign-up must be read from Clerk's docs at the
   pinned version — not assumed — with an in-app consent step as the fallback.
6. **A fixed inactivity retention period, or on request only?** **Recommendation: on request, plus one
   sweep when the beta ends** — what the procedure supports and what one person at ~4h/week can
   honestly promise.
7. **Who signs the review off.** The milestone says "a named person"; `AGENTS.md` forbids names in docs.
   Reconciled here as **role + date**, the form ADR 0006 uses, and both documents are amended so the
   exit criterion is satisfiable. Flagged as a decision rather than an omission.
8. **Does this need a lawyer before the first invitation?** `beta-1.md` already says "get a second
   opinion before inviting anyone", and bodily measurements of minors may be treated as health data
   under some laws. **This plan does not answer that and must not.** The one question nobody in this
   repo can close.
9. **Is the P-4 rename a Beta 0 blocker?** This PR says yes and files it that way. It is the maintainer's
   to confirm, because it is the one finding that could delay the first invitation.

## What `AUTH-1` can rely on after this PR

1. **The notice exists**, with content `AUTH-1` does not have to write.
2. **The URL has one remaining dependency, `PRIV-2`** — now a _named and honestly sized_ PR rather than
   an undesigned document.
3. **The consent requirements are written down**, in the `runbooks.md` checklist `beta-1.md` §3 already
   says `AUTH-1` owes: that sign-up must show the notice link before the first write; that Clerk's
   legal-consent setting must be **verified against Clerk's docs, not assumed**, with an in-app step as
   fallback; and the Google consent screen's URL fields.
4. **Clerk deletion is specified** — and specified to capture the user ids **before** the database
   transaction, so `AUTH-1` knows household deletion reaches into Clerk and is not reversible by order.
5. **`SECURITY.md`'s threat model describes the world `AUTH-1` builds**, with the one-household control
   it is about to retire stated explicitly, so its plan has something to be reviewed against.

## Review-response log (adversarial panel)

Six lenses, in parallel, on the first draft. **Five BLOCKING, and the panel was right on all five.**
The draft's worst defect was the one it was least equipped to see: its own self-review understated
committed personal data by ~50 files and filed it one severity too low.

### Engineering panel + security + privacy stand-in (round 1)

| #   | Lens                 | Critique (short)                                                                                                                                      | Verdict      | Resolution                                                                                                                                    |
| --- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Correctness          | **BLOCKING.** "Export already works" is false — check-ins, readiness, `feel`, ramp targets never reach a CSV                                          | **accepted** | Fact 4 rewritten; the notice now states what the export omits. §Out-of-scope notes a `V1-13c`-shaped row.                                     |
| C2  | Correctness          | **BLOCKING.** Dry run + one-transaction are `PRIV-3`'s runner, credited in a docs-only PR                                                             | **accepted** | Runbook step 4 is literal `BEGIN;`/`COMMIT;` + timeouts; step 3 is an explicit per-table count block.                                         |
| C3  | Correctness          | Clerk user ids must be captured before the DB transaction, not after                                                                                  | **accepted** | New step 0b; the ledger carries them; named in §What AUTH-1 can rely on.                                                                      |
| C4  | Correctness          | "Six hold personal data" above an eight-row table; `households.name` absent                                                                           | **accepted** | Count dropped; inventory is all 18 tables, column by column.                                                                                  |
| C5  | Correctness          | Two cites wrong (`access-gate.ts:17`→`:16`, `:141`→`:127`)                                                                                            | **accepted** | Fixed, and the symbol-citation policy from ADR 0006 R7 adopted for the living docs.                                                           |
| C6  | Correctness          | "TLS forced to verify-full" overstates — it only upgrades an `sslmode` already present                                                                | **accepted** | Reworded; "confirm prod `DATABASE_URL` carries `sslmode`" added to the operator checklist.                                                    |
| C7  | Correctness          | The export has no ownership boundary at all — not just "a kid can tap a sibling's tile"                                                               | **accepted** | Q2 and the notice now say anyone with the access code can zip any athlete's history; `TEN-1` told to scope it.                                |
| C8  | Correctness          | Two residual lists in one section that disagree                                                                                                       | **accepted** | One list, in the notice; the runbook references it.                                                                                           |
| C9  | Correctness          | CSP "zero external hosts" overstated (`strict-dynamic`); seven Server Actions, not nine                                                               | **accepted** | Reframed as data egress; count fixed, and `tech-debt.md`'s stale "six" fixed too.                                                             |
| S1  | Security             | **BLOCKING.** Step 0's "only the household's own owner" is unverifiable in Beta 0                                                                     | **accepted** | Invitation-channel verification, 7-day cooling-off, a held restore branch, and the verifying channel in the ledger.                           |
| S2  | Security             | **BLOCKING.** `db:seed` resurrects a deleted seeded household on the next merge                                                                       | **accepted** | Blocking precondition in the runbook + a §Risks row. (Found independently by the author before the lens reported.)                            |
| S3  | Security             | **BLOCKING.** The threat-model rewrite drops the MCP clause, the one-household control and two actors; and leaves `SECURITY.md:12` self-contradicting | **accepted** | Ownership split written out; `:12`/`:14` marked as target rules with ⚠️ pointers rather than contradicted.                                    |
| S4  | Security             | The notice will be unauthenticated — separate honest-to-user from useful-to-attacker                                                                  | **accepted** | Explicit split in §notice shape; mechanism names stay in `tech-debt.md` and are linked.                                                       |
| S5  | Security             | Rule out the public GitHub issue as a contact route; no operator-emailed zips                                                                         | **accepted** | Open question 2 narrowed; runbook step 1 says the household runs its own export.                                                              |
| S6  | Security             | Step 8's OR arm deletes a row naming a profile outside H; cross-household FKs unscoped                                                                | **accepted** | Pre-flight integrity checks that abort; the blast-radius sentence corrected.                                                                  |
| A1  | Architecture         | **BLOCKING.** No markdown pipeline exists, so `PRIV-2` is not a 1-file PR and risks a second copy of the notice                                       | **accepted** | Alternatives row rewritten with the three real options; recommendation + drift test written into the `PRIV-2` row; raised as open question 4. |
| A2  | Architecture         | **BLOCKING.** The deletion ledger does not exist and `OPS-3` specifies nothing                                                                        | **accepted** | PRIV-1 defines it: outside git, outside the restorable DB, fields listed, the `OPS-3` invariant stated.                                       |
| A3  | Architecture         | **BLOCKING.** The staleness mitigation names a lens that cannot see the new file                                                                      | **accepted** | Three EDIT rows added: `AGENTS.md`, `.claude/agents/privacy-reviewer.md`, `docs/spec.md`.                                                     |
| A4  | Architecture         | Name the owner of each privacy rule, or `SECURITY.md` drifts again in the same clause                                                                 | **accepted** | The owns/points-at split is written into the plan.                                                                                            |
| A5  | Architecture / Scope | `PRIV-3` fights the runner contract; the rule-5 exception is declared in the wrong file                                                               | **accepted** | `corrections/README.md` added as an EDIT; the `PRIV-3` row states the runner change and that it needs its own plan.                           |
| R1  | Reuse                | **BLOCKING.** OSS-1 already holds a committed-data audit, and it contradicts this plan                                                                | **accepted** | One owner: the inventory is live, OSS-1 points at it, and its "no log data" sentence is explicitly reconciled.                                |
| R2  | Reuse                | "Not legal advice" would exist in six places                                                                                                          | **accepted** | The notice keeps the one user-facing copy; every repo-facing file points.                                                                     |
| R3  | Reuse                | The processor list would exist in five places, two already disagreeing                                                                                | **accepted** | `data-inventory.md` owns it; the agent's competing list becomes a pointer.                                                                    |
| R4  | Reuse                | `pin_hash` is owned by `PROF-1` under ADR 0006 — filing it as minimisation debt contradicts an accepted decision                                      | **accepted** | P-1 split three ways (`birthdate` debt, `pin_hash` owned, `avatar` live-rendered).                                                            |
| R5  | Reuse                | `spec.md`, `product-spec.md`, notice §6/§9, the CSV contract would gain duplicate copies                                                              | **accepted** | Pointer edits added; §9 folded into the retention table.                                                                                      |
| P1  | Privacy (stand-in)   | **P0.** P-4 understates committed data by ~50 files and is filed one severity too low                                                                 | **accepted** | Raised to P0, five classes named, OSS-1's file count corrected, rename escalated to a Beta 0 blocker.                                         |
| P2  | Privacy (stand-in)   | **P1.** GitHub Actions holds the prod DB credential; Vercel is compute, not metadata                                                                  | **accepted** | Both rows rewritten; `gitleaks-action` noted.                                                                                                 |
| P3  | Privacy (stand-in)   | **P1.** The child framing is inverted — the kid is the primary data-entry user                                                                        | **accepted** | Fact 5 rewritten; notice §3 reshaped, including the sibling-tile consequence in plain words.                                                  |
| P4  | Privacy (stand-in)   | **P1.** "No bodyweight value is committed" was never checked; `docs/samples/` README self-contradicts                                                 | **accepted** | Claim withdrawn rather than re-asserted; the README's State column fixed in this PR.                                                          |
| P5  | Privacy (stand-in)   | **P1.** A second year-long cookie (`tz`) and `localStorage` are missing from retention                                                                | **accepted** | Three stored items in the table and in notice §2.                                                                                             |
| P6  | Privacy (stand-in)   | **P2.** `feel` is not the only free-text box; the movement name is the one that leaves                                                                | **accepted** | Fact 6; it is now how the notice explains the `TEN-2` residual.                                                                               |
| Sc1 | Scope                | Drop the four forward-looking `plan.md` lines — three rows already carry them                                                                         | **accepted** | Dropped entirely, which is also what the task's scope discipline asked for.                                                                   |
| Sc2 | Scope                | Fold the third privacy file; its defence rebuts a strawman                                                                                            | **accepted** | Two files. Both README payloads moved to homes that already existed.                                                                          |
| Sc3 | Scope                | The four blanks are tracked only in a frozen plan                                                                                                     | **accepted** | Moved onto `PRIV-2`'s acceptance and the milestone exit criteria.                                                                             |
| Sc4 | Scope / Arch         | "Signed off by a named reviewer" survives in two files this PR edits                                                                                  | **accepted** | Both amended to role + date; the acceptance quote shows the amendment rather than hiding it.                                                  |
| Sc5 | Scope                | No size estimate; `status:check` missing from Done-when                                                                                               | **accepted** | Both added.                                                                                                                                   |

### Pushbacks

| #   | Critique                                                                                                    | Verdict      | Why                                                                                                                                                                                                                                                                                                                |
| --- | ----------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| X1  | Correctness + Reuse: add a `db:verify` deletion proof **in this PR**                                        | **rejected** | It is the right guard — and it is code. This PR is docs-only by hard constraint, and a proof added here would be the one thing in it nobody could review as prose. Written into **`PRIV-3`'s acceptance** instead, where the script it proves lives, so it is deferred to a row rather than to memory.             |
| X2  | Scope: keep `SHARE-1`'s forward-looking line, the one row that lacks it                                     | **rejected** | The instruction on this row is explicit that the four captured rows are not scope. One line of new information is not worth an edit to a shared 2,000-line file that a parallel lane is also editing. The staleness note has one home.                                                                             |
| X3  | Architecture: three files in `docs/privacy/` is consistent with the four `docs/` subdirs that have a README | **rejected** | True as far as it goes, but the scope and reuse lenses independently showed both of the README's payloads belong elsewhere — so the question is not "does a folder deserve an index", it is "does this index have content". It does not.                                                                           |
| X4  | Privacy stand-in: treat `docs/samples/legacy-csv/` as committed production data                             | **rejected** | The lens itself flagged its own red flag here, and the provenance paragraph is credible. The defensible action is to stop asserting the negative and fix the README that contradicts itself — both done. Calling it production data on a self-contradictory source would be the same error in the other direction. |

### Re-review (round 2 — correctness, security, architecture)

The revised plan went back to the three lenses that raised BLOCKING findings. **Correctness and
architecture: all clear. Security: one BLOCKING survived, and it was the rewrite's own new defect.**
Eleven further findings, all accepted.

| #     | Lens         | Critique                                                                                                                                                                                                                            | Verdict      | Resolution                                                                                                                                                                                                                                                                                                                                                                             |
| ----- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S-N1  | Security     | **BLOCKING.** "A held restore branch makes a fraudulent deletion recoverable" is an **unwired gate cited as a safety argument** — the restore runbook is a `_TODO_` stub, and a whole-DB restore would roll back every other family | **accepted** | The recoverability claim is **withdrawn.** The runbook now says plainly that until `OPS-3` exists and has been rehearsed once, a mistaken deletion is **not practically recoverable** — a reason to be slow at step 0, not a net. `OPS-3`'s rehearsal is a named precondition of the first real deletion. **The plan committed the exact sin it accused `OPS-3` of; worth recording.** |
| S-N2  | Security     | The hold duration is temporally incoherent, and the branch is a new operator-held copy of **every** household                                                                                                                       | **accepted** | 7 days **after apply**, its own window; deleting it is a required close-out, not a ledger field; added to the inventory's retention table and the notice's residual list.                                                                                                                                                                                                              |
| S-N3  | Security     | The cooling-off window has no notification, no re-verification and no cancel path — a TOCTOU gap                                                                                                                                    | **accepted** | Step 0 sends a cancellable notice on the verified channel; step 4 re-confirms on it immediately before the transaction.                                                                                                                                                                                                                                                                |
| S-N4  | Security     | Marking `SECURITY.md`'s "every query is scoped by `household_id`" a **target** rule downgrades the repo's #1 control                                                                                                                | **accepted** | Reworded: **mandatory for all new code**, with the two known violations named as `TEN-1`'s to fix and "do not read those exceptions as permission to add a third". The ⚠️ convention is for unwired _gates_, not for requirements new code may skip — a real distinction the first rewrite blurred.                                                                                    |
| S-N5  | Security     | The survive-list omits "no child accounts" and "bodyweight is the one sensitive field"; COPPA ends up with two owners                                                                                                               | **accepted** | Both clauses kept in the rewritten threat model; `SECURITY.md` **owns** the COPPA status outright and the inventory does not restate it.                                                                                                                                                                                                                                               |
| S-N6  | Security     | Step 1 hands over a **partial** copy immediately before irreversible destruction, while the notice promises a full one on request                                                                                                   | **accepted** | The runbook now says to ask, produce the full extract by hand before step 4, and deliver it **through the verified channel** — which is what S5's prohibition actually meant (no unverified recipient), not "never extract".                                                                                                                                                           |
| S-N7  | Security     | **The ledger is personal data this PR creates**, contradicting the rubric answer "none"                                                                                                                                             | **accepted** | Rubric answer 1 rewritten. The ledger gets a purpose, a retention period, a no-names field list, an inventory row and a line in the notice.                                                                                                                                                                                                                                            |
| C-N1  | Correctness  | One pre-flight check **cannot fire** — `supersets` has no profile column — and the direction that _can_ is unchecked                                                                                                                | **accepted** | Replaced with the reachable case: an **entry** from a profile outside H referencing one of H's supersets, with the join written out.                                                                                                                                                                                                                                                   |
| C-N2  | Correctness  | The dry run sits **outside** the transaction it protects, and the procedure creates its own write window (the export + the 7-day pause)                                                                                             | **accepted** | Step 4 re-runs both the integrity checks and the counts **inside** `BEGIN`, with explicit ROLLBACK conditions. With one shared code and no per-person revocation, that is the only mechanism available.                                                                                                                                                                                |
| C-N3  | Correctness  | The blast-radius sentence mis-attributes step 8 — **both** arms reach outside H, in opposite directions                                                                                                                             | **accepted** | Corrected; the pre-flight already checked both.                                                                                                                                                                                                                                                                                                                                        |
| A-N1  | Architecture | The ledger spec's only home is a frozen plan, and the `OPS-3` pointer is missing from the file table                                                                                                                                | **accepted** | The field list lives in `runbooks.md`, next to the procedure that writes it; the `OPS-3` pointer is in the `docs/plan.md` row.                                                                                                                                                                                                                                                         |
| A-N2  | Architecture | The CI-gate rejection still leans on a lens the same document reports as not invokable                                                                                                                                              | **accepted** | The rejection now rests on the toll-plus-skip-label argument, which stands alone; registering the agent is a named follow-up rather than an assumed control.                                                                                                                                                                                                                           |
| A-N3  | Architecture | `architecture.md` is a diagram file, and the plan patches a **wrong diagram with a footnote**                                                                                                                                       | **accepted** | §1's Mermaid gains the missing egress edges; a deletion-flow diagram is added and embedded in the PR description, per `AGENTS.md` → "Diagrams in the PR description".                                                                                                                                                                                                                  |
| A-nit | Architecture | Fixing the stale ADR-0006 status string in `plan.md` is drive-by work, inconsistent with pushback X2's own reasoning                                                                                                                | **accepted** | Dropped. X2 rejected four `plan.md` edits for exactly this reason; taking a fifth would have been the same inconsistency.                                                                                                                                                                                                                                                              |

**No BLOCKING finding survives.** Three things remain **test obligations rather than assumptions**,
and all three are already Open questions: Neon's branch/PITR behaviour, Clerk's legal-consent setting,
and whether Google's OAuth console accepts a non-domain policy URL.

**One honest note on the limits of this review.** Every lens said the same thing in different words:
the procedure's correctness cannot be established by reading. `C-N1` — a pre-flight check that could
never fire — is exactly the class of defect a human reviewer does not catch and the `PRIV-3`
`db:verify` deletion proof does. That proof is the single most valuable thing in `PRIV-3`, and it is
the reason `PRIV-3` is not optional polish.
