# A weekly check that the live sign-in screen still renders, styled and usable

_Tech debt: "Clerk's browser runtime is fetched from a CDN at a floating major, so nothing in CI sees
it" (`docs/tech-debt.md`). Status: **plan approved** (the maintainer, 2026-11-20; § Decisions), after a five-lens panel._

## Where this sits

- **Owning row:** the tech-debt entry above. The decision it serves is the maintainer's
  _(maintainer, 2026-11-19, relayed by the board)_: "Don't pin; check it periodically".
  `@clerk/clerk-js@6` and `@clerk/ui@1` float, so they take Clerk's security fixes automatically.
  Nothing in the tree records that decision yet, so this PR writes it into the entry and links this
  plan.
- **Standalone tech debt.** It gates nothing. #745 (the `@clerk/nextjs` bump plus a Dependabot group)
  is independent, and #746 (one shared link check) is a dependency, because this check uses its
  `expectLinkTargets(root, …)`.
- _Roadmap alignment (2026-11-20): checked against the private roadmap; nothing to add here. No `ID-1`
  keep-open item is touched: there is no identity, scope, role or sharing change._ Roadmap: none moved.

## Goal

Find out within a week, without anyone having to look, when a new Clerk CDN build breaks production
`/sign-in`:

- the card stops rendering;
- the production CSP starts refusing anything Clerk loads;
- the card loses its own styling;
- or the page loses the a11y properties this repo holds every screen to (one `<h1>`, no overflow at
  360px, 44px targets).

## Acceptance

1. **A scheduled workflow loads production `/sign-in` weekly, and on demand. It needs no secrets.**
   The page is public, and Clerk's publishable key ships in the page.
2. **With the production CSP live** (what people get), one test:
   - **waits for the card:** the Google button, found by role and name, within 20s. That is longer
     than the page's own 15s loader timeout. On a timeout it reports which of `SIGN_IN_COPY.failed`
     or `.loading` is showing, so a Clerk outage reads differently from drift;
   - **CSP:** asserts the page's **full** CSP violation list is empty apart from exactly one known
     entry, zod's `script-src eval` probe (`e2e/csp.ts`). There is no host filter: a refused injected
     `<style>` records as `style-src-elem inline`, with no host in it. The list is read first and
     printed in full;
   - **Clerk's own styling:** asserts the card has a computed property that only Clerk's CSS supplies.
     The candidate is the card container's `box-shadow` or a non-zero `padding-top`, which Tailwind's
     preflight would leave at none or 0. The exact property is fixed from the first production run;
   - **our appearance key:** asserts the Google button is ≥ 44px, which proves `SIGN_IN_APPEARANCE`'s
     `min-h-11` still reaches it and still wins. ⚠️ This is **not** a styling check: the class's rule
     ships in our own stylesheet, so an unstyled card still measures 44px;
   - **one `<h1>`:** asserts exactly one in the a11y tree;
   - **360px:** asserts no horizontal overflow at `NARROW_VIEWPORT`;
   - **tap targets:** asserts `expectTapTargets` passes, and `expectLinkTargets(page.getByRole('main'),
…, <exact count>)` passes, with the count taken from the first production run. Production went to
     Waitlist on 2026-11-05 and gained a link nobody has measured. Any vendor link that cannot meet
     44px (for example "Secured by Clerk", measured 48×14 on 2026-11-04 on the development instance)
     is added **then**, as a named exception with that run's output as evidence. Each exception must
     match exactly one element, and one that matches nothing fails.
3. **The axe A/AA scan, run with `expectNoAxeViolations` unchanged.** It runs under the live CSP if a
   probe shows axe injects there (the 4.14.0 adapter injects through `page.evaluate`). Otherwise it
   runs in a second context with `bypassCSP`, after the same card wait.
4. **Proven red before it is trusted** (§ Test plan): every assertion above, under a route that makes
   it fail.
5. **On a red scheduled or dispatched run:** one issue titled `sign-in drift check red` is opened, or
   commented on if it is open. The body is fixed text: the run URL, plus two triage sentences.
   - **Drift or our change:** the printed violation list names the directive and source; check
     whether a production deploy landed since the last green run.
   - **A dashboard change:** a Clerk dashboard change (access mode, the application name in the `<h1>`,
     bot protection) also reads as drift.
6. **What it touches:**
   - **This app:** it writes nothing to this app's data. It never signs in, clicks Google or submits
     a form.
   - **Clerk:** it is **not** write-free there. Rendering the card calls Clerk's Frontend API, which
     mints a signed-out client and its cookies on each run. That is unverified, and the first run
     records the actual request list.

## Design

- **The spec is `apps/web/e2e/signin.drift.ts`, with its own config,
  `apps/web/playwright.drift.config.ts`.**
  - The config sets `testMatch: /\.drift\.ts$/`, has no `webServer`, and runs one chromium project.
  - The main config's `testMatch: '**/*.spec.ts'` can never see the spec, so the main config is not
    edited.
  - The drift config **throws** unless `DRIFT_BASE_URL` is an `https://` URL. It prints the resolved
    origin first.
  - The spec uses `SIGN_IN_PATH` only and never reads the env var.
  - There is no skip anywhere, because a skip exits 0, which would be the vacuous pass.
  - `retries: 1`, with the reason in the config: one network read of a third party.
  - `trace: 'off'` and `screenshot: 'only-on-failure'`, because a trace would carry Clerk's
    `Set-Cookie` for the minted client.
  - `launchOptions: { chromiumSandbox: true }`, if it launches on the runner (§ Decisions 5).
- **The workflow is `.github/workflows/signin-drift.yml`**, with a "NOT A PULL-REQUEST CHECK" header
  like `codeql.yml`'s. It notes GitHub's 60-day auto-disable of schedules on an inactive public repo.
  - **Triggers:**
    - `schedule` (weekly, off the hour);
    - `workflow_dispatch`, with an optional `url` input;
    - `pull_request`, filtered to the spec, the drift config, the workflow and the script, so an edit
      to the check runs the check.
  - **The URL:** the committed default `https://mat-plan.dev` (already public in `README.md`), in the
    workflow's `env`. The dispatch input overrides it for that run only. It reaches the step only
    through `env:`.
  - **Permissions and settings:**
    - top-level `permissions: {}`;
    - the check job has `contents: read`, `persist-credentials: false`, `timeout-minutes: 10`, a
      concurrency group, and `cancel-in-progress: false` (SEC-5b's convention for scheduled
      workflows);
    - the browser install copies `ci.yml`'s two steps;
    - every action is SHA-pinned, reusing `ci.yml`'s SHAs.
  - **The failure upload:** screenshots and the text report only, `if: failure()`, with
    `retention-days: 7`. `E2E_SESSION_BYPASS_USER_ID` is never set.
  - **The report job:**
    - its condition is `if: always() && needs.check.result != 'success' && github.event_name !=
'pull_request'`;
    - its permissions are `contents: read` and `issues: write`;
    - it checks out **the default branch's** script only (sparse, `persist-credentials: false`), so a
      dispatched branch never supplies the code that holds `issues: write`.
- **The issue script is `.github/scripts/open-or-comment-issue.sh <title> <body-file>`.**
  - It passes the title as data (`jq --arg`).
  - It matches only open issues authored by `app/github-actions`, so a same-titled issue anyone opens
    on this public repo is ignored.
  - It posts with `--body-file`.
  - Its self-test, `open-or-comment-issue.test.sh`, stubs `gh` (as `review-post.test.sh` does) and is
    added to `guards:test`. It covers: open; comment on the bot's issue; ignore another author's
    same-titled issue; a title containing `"`; a body with `@` and a newline.
  - No text from the page (CSP samples, DOM labels, axe help) ever leaves the check job's log and
    artefact. Printed strings are `JSON.stringify`'d, so a line cannot forge a workflow command.
- **`ci.yml` is not touched.** Its `mutations-red-on-main` step is the first copy of this logic, and it
  has the same squattable title-only lookup. Adopting the script there is a ~15-line follow-up for the
  lane that holds `ci.yml`, after #724 (§ Out of scope).
- **Reuse, by location:**
  - `recordCspViolations` and `cspViolations` (`e2e/csp.ts`);
  - `expectTapTargets`, `expectLinkTargets` (after #746) and `expectNoAxeViolations`
    (`e2e/a11y-checks.ts`);
  - `expectNoHorizontalOverflow`, `MOBILE_VIEWPORT` and `NARROW_VIEWPORT` (`e2e/contexts.ts`);
  - `SIGN_IN_PATH`, `SIGN_IN_COPY` and `MIN_TAP_TARGET_PX` (`lib/constants.ts`);
  - `lib/clerk.ts` is **not** importable: it imports the server-only env.

## File-by-file changes

| File                                                 | Change                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/e2e/signin.drift.ts`                       | NEW. The card wait, then the CSP-live test (Acceptance 2), then axe (Acceptance 3).                                                                                                                                                                                                         |
| `apps/web/playwright.drift.config.ts`                | NEW. As Design.                                                                                                                                                                                                                                                                             |
| `apps/web/package.json`                              | EDIT. `e2e:drift`: `playwright test -c playwright.drift.config.ts`. App-only, deliberately (no root alias: it is not a local gate).                                                                                                                                                         |
| `.github/workflows/signin-drift.yml`                 | NEW. As Design.                                                                                                                                                                                                                                                                             |
| `.github/scripts/open-or-comment-issue.sh`           | NEW. As Design.                                                                                                                                                                                                                                                                             |
| `.github/scripts/open-or-comment-issue.test.sh`      | NEW. As Design.                                                                                                                                                                                                                                                                             |
| `package.json`                                       | EDIT. `guards:test` lists the new self-test.                                                                                                                                                                                                                                                |
| `docs/tech-debt.md`                                  | EDIT, inside the one entry: the maintainer's decision, attributed; "sign-in UI drift accepted, checked weekly by `signin-drift.yml`"; a link to this plan; and the dated observations corrected from the first production run (its `<h1>` note contradicts `sign-in/[[...rest]]/page.tsx`). |
| `apps/web/e2e/a11y.spec.ts`, `apps/web/lib/clerk.ts` | EDIT, comments only: the "nothing measures the lit card" sentences point at the check. `runbooks.md`, `status.md` and `theme.spec.ts` are left: they are open in other PRs and describe history.                                                                                            |
| `docs/changelog/…`                                   | NEW fragment.                                                                                                                                                                                                                                                                               |

Estimated at about 300 lines, plus this plan.

## Test plan

- **Before merge, from CI:** the `pull_request` trigger runs the check on this PR, so the first green
  run against production is CI's, not a local one.
- **Red proofs**, each run once on the branch through a temporary flag in the drift config. The flag
  is removed in the last commit, and each red output is pasted in the PR:
  - **Styles refused:** a `page.route` on `/sign-in` that swaps the `style-src` nonce. The CSP
    assertion and the styling assertion must both go red. The 44px assertion is expected to stay
    green, which proves it is not a styling check.
  - **Card absent:** `PRIVACY_PATH` in place of `SIGN_IN_PATH`. The card wait goes red.
  - **Link count wrong:** off by one. That assertion goes red.
  - **No URL set:** `DRIFT_BASE_URL` unset. The config throws, which is a red run, not a skip.
- **Axe under CSP:** a throwaway probe settles whether axe runs under the live policy, which decides
  whether a second context is needed. It is not committed.
- **The issue path:**
  - the script's self-test (`guards:test`);
  - after merge, one dispatched run with the forced-red flag, to watch the issue open, then close it.
    A dispatch cannot run before the file is on `main` (`metrics.yml`'s note).
- **What Clerk receives:** the first run's request list and cookie names are recorded in the PR. The
  first failing artefact is unzipped and checked for `__client` / `__session`.

### As built, 2026-11-20 (from CI's runs against production)

- **The sandbox:** Chromium's sandbox failed on the first run, because Ubuntu 24.04's AppArmor
  restricts unprivileged user namespaces. The workflow lifts that on the throwaway runner, which is
  Chromium's documented fix, so the browser runs **sandboxed**. § Decisions 5's fallback was not
  needed and no SECURITY.md residual is recorded.
- **Links:** production has **4** links in `<main>`. Two are Clerk's and under 44px: the Clerk logo
  ("Secured by Clerk") at 14px and **"Join waitlist" at 18px**. Both are named exceptions
  (`VENDOR_LINK_EXCEPTIONS`), each of which must match exactly one link. "Join waitlist" could be
  sized by an appearance key of its own, which is a UI change for its own PR.
- **Clerk's styling, our 44px key, one `<h1>`, 360px, tap targets, axe:** all green.
- 🔴 **The CSP finds real drift on most runs:** Clerk's bot-protection bootstrap
  (`cdn.protect.clerk.com/…/bootstrap.js`) loads and its `connect-src` probes to
  `*.client.protect.clerk.com` (five ports) are refused. `runbooks.md` records bot protection as
  turned off on the production instance on 2026-10-29. Raised to the maintainer; it is not allowlisted.
- **Red proofs**, each through a temporary CI matrix, since removed:
  - **Card absent** (`/privacy`): "did not render within 20000ms". ✅
  - **Link count off by one:** "link count". ✅
  - **Style-src nonce swapped:** CSP red (`style-src-elem inline … ui.browser.js`) and "Clerk's card is
    unstyled". ✅ The 44px check went red too, because the swap also refused our own stylesheet
    chunk, so this run does not show 44px staying green on an unstyled card. That claim rests on the
    reasoning in § Acceptance 2.
  - **No URL:** the config throws; checked locally. ✅
- **Every section is a soft assertion**, so one red run lists every kind of drift.

### The protect probe, decided (the maintainer, 2026-11-21)

- **The maintainer checked the Clerk dashboard:** every relevant protection is INACTIVE, yet the
  bootstrap still loads.
- **The decision:** the probe's `connect-src` refusals are a **known, expected finding**
  (`isKnownProtectProbe`). They are matched exactly, by directive, probe host, the five recorded
  ports and the bootstrap script, so any other violation still fails, and they are printed rather
  than silenced.
- **What it does not cover:** the sign-UP consent step, which cannot be reached without creating an
  account. That is a manual check the maintainer owes before the first invite, in `runbooks.md`
  ("The sign-up consent step under Clerk's protect script"), with its decision table.

## Alternatives considered

- **Pin clerk-js:** rejected by the maintainer. It rolled production back five releases and ends
  automatic vendor fixes.
- **Run it in the PR `e2e` job:** CI has no Clerk keys, and drift happens between deploys, so it must
  run on a clock. The path-filtered PR trigger only tests edits to the check itself.
- **A repository variable for the URL:** rejected after the panel. It hides nothing (the domain is in
  `README.md`), and it lets a settings change repoint the check with no review. A preview cannot be
  loaded anonymously anyway: previews sit behind Vercel Authentication and use the development Clerk
  instance.
- **A host filter on CSP violations:** rejected. A refused inline style names no host.
- **Extracting into `ci.yml` in this PR:** deferred. It is a second concern in a file #724 holds, and
  its only caller fires on a red `main`, so this PR could not exercise it.
- **A vendor allowlist up front:** rejected. Neither helper measures that link today, so it would be
  an exception for a failure nothing can see. It gets added from evidence instead.
- **A vendor's synthetic monitoring:** a new third party for one page.

## Risks / rollback

- **Flakes would make the issue untrusted.** The mitigations are the 20s card wait, `retries: 1`, and
  a comment rather than a new issue on a repeat. If it is still noisy, disable the workflow; never
  weaken an assertion.
- **The schedule auto-disables after 60 days with no repository activity.** That is noted in the
  workflow header and the tech-debt entry. In this repo's rhythm that is unlikely.
- **It runs live, floating third-party JS in CI**, for the first time. That is why it runs
  sandboxed if possible, with no secrets in the job and a write token only in the separate report
  job.
- **Rollback:** delete the workflow file. Nothing else depends on it.

## Out-of-scope / deferred

- **`ci.yml`'s `mutations-red-on-main` adopting the script:** this also fixes its squattable
  title-only lookup, which is live today. Follow-up after #724, offered to the Tech Debt lane.
- **A lit check of the signed-in flow:** needs a real Google account in CI.
- **`theme.spec.ts:106` and `:205` filtering on `script-src inline`:** Chromium probably reports
  `script-src-elem`, which would make those two guards vacuous. Unverified; offered to the Tech Debt
  lane with the reviewers' probe.

## Decisions (the maintainer, 2026-11-20, relayed by the board)

All five went as recommended:

1. **Target:** production, `https://mat-plan.dev`, weekly, with a per-run override ("Production,
   weekly").
2. **Alert:** a GitHub issue on a red run ("Open a GitHub issue"), through the bot-author-filtered
   script.
3. **Frequency:** weekly.
4. **Testing production:** AGENTS.md's "never tests against production" gains this weekly read-only
   `/sign-in` load as its one named exception ("Yes, named exception").
5. **The sandbox:** if Chromium's sandbox will not launch on the runner, the unsandboxed browser is
   recorded as a residual in `.github/SECURITY.md` ("Yes, record it").

## Review-response log (adversarial panel)

### Engineering panel (round 1), 2026-11-20

> Models: Fable for all five lenses (plan-with-panel's sanctioned model).

| #   | Lens                                    | Critique (short)                                                                                                       | Verdict                 | Resolution                                                                                                                                                                 |
| --- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Correctness (BLOCKING)                  | The 44px "styled" check passes on an unstyled card: `min-h-11`'s rule ships in our own CSS.                            | **accepted**            | Renamed to what it proves (our key wins). A separate Clerk-only computed property is added. The red proof shows the difference.                                            |
| C2  | Correctness (BLOCKING)                  | A host filter misses a refused inline style (`style-src-elem inline`, no host) and hides `img`/`connect`/`font` drift. | **accepted**            | The full violation list, minus the one zod probe. No host filter.                                                                                                          |
| C3  | Correctness/Arch/Reuse/Scope (BLOCKING) | Skip-when-unset is a vacuous pass, and contradicted the fail-loud design.                                              | **accepted**            | No skip. The config throws unless the URL is `https://`. A `.drift.ts` suffix keeps the main config unedited.                                                              |
| C4  | Correctness/Reuse/Scope (BLOCKING)      | The vendor allowlist matches nothing: `expectTapTargets` skips `<a>`, and axe does not scan target-size.               | **accepted**            | No allowlist up front. Links are measured by `expectLinkTargets` (#746) with an exact count. Exceptions come from the first run.                                           |
| C5  | Correctness                             | Geometry under `bypassCSP` measures a page users do not get; the need for the bypass is unverified for axe.            | **accepted**            | All geometry is in the CSP-live test. A probe decides axe's context.                                                                                                       |
| C6  | Correctness                             | No "card rendered" precondition: axe could audit our loading text.                                                     | **accepted**            | A shared 20s card wait, with outage reporting.                                                                                                                             |
| S1  | Security (BLOCKING)                     | Third-party text could flow into the write-token job, as shell, outputs or markdown.                                   | **accepted**            | A fixed-text body (run URL plus triage). Nothing leaves the check job. Every value goes through `env:` and `--body-file`.                                                  |
| S2  | Security (BLOCKING)                     | The extracted lookup is jq-injectable and squattable by title.                                                         | **accepted**            | `--arg` title, bot-author filter, a stubbed self-test with the squat case.                                                                                                 |
| S3  | Security/Arch                           | A checkout in the write job; unstated permissions; a branch could supply the script.                                   | **accepted**            | Top-level `{}`, per-job least privilege, the default branch's script, sparse, `persist-credentials: false`.                                                                |
| S4  | Security                                | "Zero risk" overstated: an unsandboxed browser, Clerk mints a client, the 60-day auto-disable.                         | **accepted**            | Stated in Acceptance 6 and Risks. The sandbox is attempted, with § Decisions 5 if it fails.                                                                                |
| S5  | Security/Privacy                        | The trace artefact could carry Clerk's client cookie on a public repo.                                                 | **accepted**            | `trace: 'off'`, screenshots and text only, 7-day retention, the first artefact grepped.                                                                                    |
| S6  | Security/Arch/Scope                     | A repo variable hides nothing and removes review from the target.                                                      | **accepted**            | A committed default with a per-run dispatch override.                                                                                                                      |
| S7  | Security                                | Printed third-party strings can forge workflow commands.                                                               | **accepted**            | `JSON.stringify` on print.                                                                                                                                                 |
| A1  | Arch/Scope/Security                     | `workflow_dispatch` cannot run before merge; the issue path is unproven.                                               | **accepted**            | A path-filtered `pull_request` trigger runs the check pre-merge. The issue path is proven by the self-test, and after merge by one forced-red dispatch.                    |
| A2  | Arch/Scope                              | The `ci.yml` edit contradicts "stays out of that queue", can't be exercised, and #724 holds the file.                  | **accepted**            | `ci.yml` is not touched. Adoption is a follow-up.                                                                                                                          |
| A3  | Arch                                    | AGENTS.md "never tests against production".                                                                            | **accepted**            | The maintainer approved a named exception (§ Decisions 4), written into that sentence.                                                                                     |
| A4  | Arch/Reuse                              | Stale "nothing measures the lit card" statements.                                                                      | **accepted (narrowed)** | The comments in `a11y.spec.ts` and `clerk.ts`, plus the tech-debt entry. The runbooks, status and theme.spec mentions are left: they are historical and held by other PRs. |
| A5  | Arch                                    | SEC-5b's scheduled-workflow conventions (concurrency, `cancel-in-progress: false`, header, `timeout-minutes`).         | **accepted**            | In Design.                                                                                                                                                                 |
| P1  | Scope                                   | A runbook section and an AGENTS.md CI-checks line cost more than they buy.                                             | **accepted**            | Triage goes in the issue body. AGENTS.md gains the exception (§ Decisions 4).                                                                                              |
| P2  | Scope                                   | The branch type and size: about 590 lines as drafted.                                                                  | **accepted**            | Re-cut as `chore/td-signin-drift-check`, at about 300 lines.                                                                                                               |
| P3  | Scope                                   | Acceptance quoted a row wording that is not in the tree.                                                               | **accepted**            | Marked as relayed. This PR writes the decision into the entry.                                                                                                             |
| R1  | Reuse                                   | A fourth hand-written CSP directive filter.                                                                            | **accepted**            | There is no directive filter at all (the full list minus one), so there is nothing to extract.                                                                             |
| R2  | Reuse                                   | Re-typed viewports, paths and copy.                                                                                    | **accepted**            | `NARROW_VIEWPORT`, `PRIVACY_PATH`, `SIGN_IN_COPY`.                                                                                                                         |
| N   | All                                     | NITs: the `td-` filename, helper locations, chromium install steps, `retries` reasoning, one env name.                 | **accepted**            | Applied.                                                                                                                                                                   |
| X1  | Reuse/Correctness (outside)             | `theme.spec.ts`'s `script-src inline` prefix may never match.                                                          | **deferred**            | Offered to the Tech Debt lane, with the probe.                                                                                                                             |
| X2  | Security (outside)                      | `ci.yml`'s mutation issue lookup is squattable today.                                                                  | **deferred**            | Offered to the Tech Debt lane. The fix is the script adoption above.                                                                                                       |
