# V1-12 — a11y + tap-target / numeric-keypad pass

> Backlog: [plan.md](../plan.md) row V1-12. Branch: `feat/v1-12-a11y` (stacked on
> `feat/v1-10-strength-prefill`). **Pure app code — no migration.** Significant (adds a CI-run spec +
> a dev dependency) → committed plan + panel before implementation.

## Goal

AGENTS.md states the a11y bar as a **rule**, not an aspiration: "keyboard-usable, focus-visible, labeled
controls, **≥44px tap targets**, numeric `inputmode` on number fields", used "primarily on phones and
tablets… the kids log on the gym floor". Today that bar is **asserted in prose and enforced nowhere** —
there is no axe run, no tap-target check, nothing in CI. This PR makes it **executable**: a real
accessibility scan in the existing Playwright job, plus the fixes for what's already broken.

## What is ALREADY broken (surveyed, not assumed)

| Finding                                                         | Evidence                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Secondary buttons are 28–32px tall**, under the mandated 44px | `components/ui/button.tsx:24-34` — `default: h-8` (32px), `sm: h-7` (28px), `lg: h-9` (36px). "Add set" (`strength-form.tsx:401`) and "Add movement" use `size="sm"`; the routine editor's ▲▼ reorder buttons and the V1-9 Edit/Cancel are also sub-44.                                                         |
| **The compliant size is achieved by repeating a literal 5×**    | `className="h-11 text-base"` is copy-pasted in `gate-form.tsx:38`, `life-form.tsx:53`, `strength-form.tsx:233`, `checkin-form.tsx:219`, `bodyweight-form.tsx:71`. AGENTS.md: "the second occurrence of a literal is the trigger to extract." A sixth form that forgets it silently ships a 32px primary button. |
| **Check-in checkboxes render at 20px**                          | `checkin-form.tsx:122` — `size-5`. The hit area depends on the `<label>` wrapping; needs measuring, not assuming.                                                                                                                                                                                               |
| Inputs are **compliant** — `INPUT_CLASS` is `h-11`              | `lib/constants.ts:31` (already single-sourced, already 44px).                                                                                                                                                                                                                                                   |
| `inputMode` is **present on every number field**                | `bodyweight-form` (decimal), `checkin-form` ×2 (numeric), `set-fields` (numeric + decimal). No gap found — the backlog's "numeric inputmode" item is already satisfied; this PR PINS it so it can't regress.                                                                                                    |

So the slice is smaller than the backlog row implies on inputs, and larger on buttons.

## Design decisions

**E1 — `@axe-core/playwright` in the existing `e2e` job, not a new CI job.** One new spec,
`e2e/a11y.spec.ts`, scans the app's real routes with the real prod build (the `webServer` already boots
it) and the real gate-authenticated `storageState`. No new workflow, no new service container — the
marginal CI cost is seconds. Dev dependency only.

**E2 — Scan every route the household actually uses, at mobile width first.** `/` (picker), `/p/[id]`
(Today — the dense one), `/p/[id]/routine` (coach editor). At **390px**, because that is the primary
device and a11y defects (overlap, truncation, tap-target collisions) surface at small widths, not desktop.

**E3 — Assert ZERO violations at `wcag2a` + `wcag2aa`, and fail the build on any.** Not a warning, not a
report artifact. A skipped/known-violations allowlist is deliberately NOT introduced: there is nothing to
grandfather yet (this is the first scan), so starting at zero keeps it honest. If the first run surfaces
something genuinely unfixable in this slice, it gets an explicit, commented `.disableRules([...])` with a
tech-debt entry — never a silent filter.

**E4 — Tap targets get their own explicit assertion, because axe will NOT catch this.** WCAG 2.2's
"Target Size (Minimum)" is **24×24px** and is not in `wcag2a`/`wcag2aa` rulesets; the project's bar is
**44px**, which is stricter than anything axe ships. So a passing axe run would give false comfort. The
spec measures every interactive element's rendered `boundingBox()` on each route and asserts
**height ≥ 44** (the AGENTS.md number, imported as a named const, not a re-typed `44`).

**E5 — Fix the buttons at the VARIANT, not the call site.** Add a `size="touch"` variant (h-11,
text-base) to `button.tsx` and replace the five `className="h-11 text-base"` copies with it; retarget the
sub-44 secondary buttons (`Add set`, `Add movement`, ▲▼, Edit/Cancel) to it or to a 44px icon variant.
Fixing the five call sites without touching the variant would leave the trap in place for form six.
**Open Q1:** should `default` itself become 44px (blast radius: every button, incl. shadcn-generated
ones) or is an explicit `touch` variant the right seam?

**E6 — Keyboard + focus-visible are asserted, not eyeballed.** One spec walks the strength form by `Tab`
and asserts focus reaches every control in DOM order and that `:focus-visible` renders a ring. This is
the part of the bar most likely to regress silently.

**E7 — No visual redesign.** Making a 28px button 44px changes layout; screenshots will differ. That is
the point, and the tri-viewport captures show it. Anything beyond "meet the stated bar" (colour-contrast
retuning, new focus styles, motion prefs) is out of scope.

## Acceptance

- `pnpm --filter web e2e` runs an axe scan on `/`, `/p/[id]`, `/p/[id]/routine` at 390px and reports
  **zero** wcag2a/wcag2aa violations.
- Every interactive element on those routes measures **≥44px** tall, asserted in CI.
- The five `h-11 text-base` copies are gone, replaced by one variant.
- Tri-viewport screenshots show the resized controls.

## Out of scope (→ later)

Screen-reader narration testing (needs a real AT, not axe); colour-contrast redesign beyond fixing
violations; `prefers-reduced-motion`; the gate page's own a11y beyond the scan; a Lighthouse/CWV budget
in CI (that's the V1-14 / observability ADR lane).

## Open questions for the panel

1. **E5** — `size="touch"` variant vs. making `default` 44px outright?
2. **E4** — is a bespoke bounding-box assertion the right tool, or does it produce false positives on
   inline `<a>` links (the "← All profiles" back-link is text, not a control with a box to grow)? What is
   the correct rule for inline text links under a 44px bar?
3. **E3** — zero-violations-or-fail from day one: right call, or does it risk blocking unrelated PRs on a
   pre-existing violation the first run happens to surface?
4. Should the a11y spec run at **all three** viewports (3× the assertions, slower `e2e`) or is mobile-only
   the right cost/benefit given desktop is the secondary case?
5. Is `e2e` the right home at all, given it is **still non-blocking until PR 28** — i.e. would a11y
   failures be invisible until then? Should this instead go in the **required** `quality` job as a
   headless-Chromium step?
