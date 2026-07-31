# V1-12 — a11y + tap-target / numeric-keypad pass

> Backlog: [plan.md](../plan.md) row V1-12. Branch: `feat/v1-12-a11y` (stacked on
> `feat/v1-10-strength-prefill`). **Pure app code — no migration.** Significant (adds a CI-run spec +
> a dev dependency) → committed plan + panel before implementation.

## Goal

AGENTS.md states the a11y bar as a **rule**: "keyboard-usable, focus-visible, labeled controls, **≥44px
tap targets**, numeric `inputmode` on number fields", on an app used "primarily on phones and tablets…
the kids log on the gym floor". Today that bar is **asserted in prose and enforced nowhere**. This PR
makes it **executable** — an axe scan in the existing Playwright job, a tap-target assertion axe cannot
provide, and a structural fix so the 44px rule can't be forgotten rather than merely discouraged.

## What is ACTUALLY broken (survey v2 — the first draft was wrong; see the review log)

| Control                                       | State                                                                                                                                                                                                                                                            |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `strength-form.tsx:404` **"Add set"**         | `size="sm"` (h-7 = 28px), no override → **broken**, always rendered                                                                                                                                                                                              |
| `strength-form.tsx:366` **"Remove movement"** | `size="sm"`, no override → **broken**, rendered only when `canRemove` (≥2 movements)                                                                                                                                                                             |
| `strength-form.tsx:391` **"Remove set"**      | `size="sm"`, no override → **broken**, rendered only when `sets.length > 1`                                                                                                                                                                                      |
| `app/error.tsx:31`                            | `size="default"` (h-8 = 32px) → **broken**, but off the scanned routes                                                                                                                                                                                           |
| Check-in checkbox                             | box is `size-5` (20px), but `rowClass` is `min-h-11` and the `<label>` is `flex-1`/`htmlFor`-bound. The row is 44px; the **label's own** height is ~24px because `items-center` doesn't stretch a flex child → the defect is **vertical**, and only on the label |
| ▲▼ reorder, Edit/Cancel, "Add movement"       | **already compliant** — carry `min-h-11`                                                                                                                                                                                                                         |
| Inputs (`INPUT_CLASS`)                        | **already compliant** — `h-11`, already single-sourced                                                                                                                                                                                                           |
| `inputMode` on every number field             | **already present** (decimal/numeric across bodyweight, check-ins, sets). This PR only PINS it                                                                                                                                                                   |

**The duplication is worse than "5 copies".** `h-11 text-base` appears **6×** (incl. `routine-editor:152`),
and `min-h-11` is hand-written **12×** more. That is 18 literal spellings of one rule, in two idioms.

## Design decisions

**E1 — Fix it in the cva BASE, not with a new variant.** Add `min-h-11` to `buttonVariants`' base string
(`button.tsx:8`) and **delete all 18 literals**. `min-height` beats the size variants' `h-8`/`h-7`/`h-9`,
and `min-h-*` / `h-*` are different tailwind-merge groups so caller overrides still work. Every button
becomes ≥44px **structurally** — "form six forgets it" becomes impossible, not merely discouraged.
A `size="touch"` variant (the first draft's plan) is the wrong seam: it is **opt-in**, and opt-in is
precisely the failure mode being closed. It would also leave the 12 `min-h-11` literals in place — a
_third_ idiom, strictly worse than today's two. `size` keeps owning padding/text/gap only. Add `min-w-11`
to the `icon*` sizes, and a comment that this is a deliberate divergence from upstream shadcn so a
regeneration doesn't silently revert it.

**E2 — `@axe-core/playwright`, EXACTLY pinned, in the existing `e2e` job.** One spec, `e2e/a11y.spec.ts`,
against the real prod build and gate-authenticated `storageState` the job already provides. **No caret** on
the dep: a minor bump ships new rules, which would turn an unrelated PR red under E4's zero-tolerance.

**E3 — Mobile only (390px), three routes:** `/`, `/p/[id]`, `/p/[id]/routine`. The `wcag2a`/`wcag2aa`
findings here are DOM/label/contrast rules that are width-invariant, and control _height_ doesn't change
with viewport width — 3× the runtime would buy near-zero marginal signal.

**E4 — Zero violations at `wcag2a` + `wcag2aa`, failing the build.** No allowlist: nothing to grandfather
on a first scan. The first run happens **on the branch before the PR opens**, so any surprise is triaged
as planned work rather than discovered in review.

**E5 — A separate tap-target assertion, because axe genuinely cannot do this.** Verified: axe-core's
`target-size` rule is tagged `wcag22aa` (not in the `wcag2a`/`wcag2aa` sets being scanned) and its
threshold is 24×24px. The project's bar is 44. So a green axe run would give false comfort.
Rules, each closing a real false-positive source found in the code:

- Selector: `button, [role="button"], select, textarea, input:not([type="hidden"])`, filtered to
  `isVisible()`. Hidden inputs (`routine-editor:59,60`, `checkin-form:198`, `gate-form:16`) return a
  `null` bounding box and would throw, not assert.
- **Inline text links are EXEMPT** — WCAG 2.2 SC 2.5.8 has an explicit inline exception. "← All profiles"
  (`page.tsx:100`) is `text-sm` inline text; growing it to 44px is a visual regression, not a fix.
  Link _cards_ (`ProfileTile`, already `min-h-24`) are measured via an explicit opt-in.
- The 20px checkboxes are covered by asserting the **label row**, not the box.

**E6 — The spec must EXPAND the form before measuring.** Two of the three broken buttons are conditionally
rendered ("Remove movement" needs ≥2 movements, "Remove set" needs ≥2 sets). A scan of the default DOM
finds only "Add set", goes green after that one fix, and **ships the other two**. The spec therefore clicks
"Add movement" and "Add set" first. This is the single most important line in the plan.

**E7 — Focus-visible is pinned by a UNIT test, not a Playwright pseudo-class walk.** The thing at risk is
one literal in `buttonVariants`' base (`focus-visible:ring-3 focus-visible:ring-ring/50`) plus the same in
`INPUT_CLASS`. A three-line Vitest assertion on `buttonVariants()` output catches that regression for ~1%
of the cost of computed-style introspection. (The first draft's keyboard-walk spec is **cut** — it was
gold-plating and matched no acceptance criterion.)

**E8 — No visual redesign.** Resizing controls changes layout; the tri-viewport screenshots show it. Colour
retuning, new focus styles and motion prefs are out of scope.

## File-by-file changes

| File                                                            | Change                                                                                                                           |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/components/ui/button.tsx`                             | `min-h-11` into the cva base; `min-w-11` on `icon*`; divergence comment                                                          |
| `apps/web/app/p/[profileId]/strength-form.tsx`                  | delete 3 `min-h-11` + 1 `h-11 text-base`; the 3 broken `size="sm"` buttons need no override once E1 lands                        |
| `apps/web/app/p/[profileId]/editable-set.tsx`                   | delete 3 `min-h-11`                                                                                                              |
| `apps/web/app/p/[profileId]/routine/routine-editor.tsx`         | delete 4 `min-h-11`/`min-w-11` + 1 `h-11 text-base`                                                                              |
| `apps/web/app/p/[profileId]/{checkin,bodyweight,life}-form.tsx` | delete 3 `h-11 text-base`; fix the check-in **label** vertical target                                                            |
| `apps/web/app/gate/gate-form.tsx`                               | delete 1 `h-11 text-base`; **import `INPUT_CLASS`** instead of its verbatim copy at `:30`                                        |
| `apps/web/lib/constants.ts`                                     | `MIN_TAP_TARGET_PX = 44`, commented as the test-side mirror of `min-h-11` (it does not drive the CSS — only the test binds them) |
| `apps/web/e2e/a11y.spec.ts`                                     | **new** — axe scan + tap-target assertion                                                                                        |
| `apps/web/components/ui/button.test.tsx`                        | **new** — focus-visible + min-h-11 pinned in the variant output                                                                  |
| `apps/web/package.json`                                         | `@axe-core/playwright` exact pin (dev)                                                                                           |
| `docs/plan.md`, `docs/status.md`                                | backlog row + link + status (AGENTS.md: status rides with the work)                                                              |

## Test plan

- **Vitest:** `buttonVariants()` contains `min-h-11` and the focus-visible ring at every `size`.
- **Playwright (`e2e/a11y.spec.ts`):** axe zero-violations on 3 routes @390px; tap-target ≥44 on all visible
  interactive elements, **with the strength form expanded** (E6).
- **Manual:** tri-viewport screenshots of Today + routine editor showing the resized controls.

## Risks / rollback

- **CSP may block axe injection.** `proxy.ts:24` emits a strict nonce `script-src` and Playwright boots the
  **production** build. `AxeBuilder` injects via `page.evaluate` (normally exempt), but this is a known
  failure mode → mitigate with `bypassCSP: true` scoped to the a11y project only; the smoke keeps CSP live.
- **`min-h-11` in the base is app-wide.** Any button relying on being short changes height. Grep shows no
  `size="icon"` call sites and no compact button rows, so blast radius is the three known buttons.
- Rollback is reverting one cva string; nothing is persisted.

## Out of scope (→ later)

Screen-reader narration (needs real AT); colour-contrast redesign beyond fixing violations;
`prefers-reduced-motion`; a Lighthouse/CWV budget (the observability ADR lane). `/gate` is **not scanned** —
the `chromium` project loads `storageState` so navigation lands past it, and scanning it needs a
storage-state-free context; deliberately deferred rather than half-done.

---

## Panel review log — reconciled

Single-pass panel, three lenses (correctness · simplicity/scope · architecture), scaled to risk per
[plans/README.md](./README.md). **The panel found the first draft's central survey to be wrong**, and the
plan above is the rewrite.

- **BLOCKING — the survey was wrong on 3 of 4 rows.** The draft listed the ▲▼ reorder buttons, the V1-9
  Edit/Cancel, and "Add movement" as sub-44; all three already carry `min-h-11`. It missed the three that
  are genuinely broken (`Add set`, `Remove movement`, `Remove set`) and `app/error.tsx`. **Verified
  independently before accepting** (`grep -c min-h-11` → 12; the three `size="sm"` buttons confirmed by
  reading them). Survey rewritten.
- **BLOCKING — a naive scan would have shipped 2 of the 3 defects.** Both `Remove` buttons are
  conditionally rendered, so the default DOM contains only one violation. → E6.
- **BLOCKING — the duplication count was wrong (6, not 5) and the bigger duplication was unaddressed**
  (12 further `min-h-11` literals). A `touch` variant fixing only the 6 would have created a _third_
  idiom. → E1 changed from a new variant to the cva base.
- **BLOCKING — the plan didn't follow `plans/README.md`** (no file-by-file table, test plan, or risks). Added.
- **Q1** → neither `touch` nor changing `default`: `min-h-11` in the base (E1).
- **Q2** → real false positives from five sources; inline text links are exempt under SC 2.5.8 (E5).
- **Q3** → zero-or-fail is right _provided_ the dep is exactly pinned and the first run happens on the
  branch (E2/E4). The risk isn't a pre-existing violation, it's a rule-set bump.
- **Q4** → mobile-only (E3).
- **Q5 — the premise was false twice over.** (a) A non-required `e2e` still **runs and reports** on every
  PR; non-blocking means "won't stop a merge", not "won't show". (b) The auto-skip would NOT skip this —
  `ci.yml`'s inert allowlist is docs/markdown/`.claude`/templates/images and requires **every** changed
  file to match; this PR touches `components/ui/button.tsx` and `package.json`. (c) Moving it to
  `quality` is architecturally wrong: that job has **no Postgres service and no Playwright browsers**, and
  all three routes read the DB. → Keep it in `e2e`.
- **Accepted, cut:** the keyboard-walk + focus-ring Playwright spec → a Vitest assertion (E7).
- **Accepted, minor:** `gate-form.tsx:30` is a verbatim copy of `INPUT_CLASS` — the same defect class this
  PR fixes for buttons, in a file already being touched. Folded in.
- **Flagged for Ray, outside this PR:** "e2e becomes required at **PR 28**" is almost certainly **stale** —
  the repo is at PR #68. Either it was promoted and the docs weren't updated, or it was forgotten ~40 PRs
  ago. Branch protection couldn't be read (403 / private-repo ruleset gating). **Promoting `e2e` to
  required is a zero-code settings change that delivers more enforcement value than anything in this plan.**
