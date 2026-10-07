# UI-4 — a light/dark theme switch, plus a token-set preview harness

> Backlog: [plan.md](../plan.md) row **UI-4** (the switch), and the apparatus row **UI-3** needs
> before it can start. Branch: `feat/ui-4-theme-switch`.

## Goal

`globals.css` has carried a 33-line `.dark` OKLCH palette since the scaffold and **nothing has ever
set `.dark`** — no provider, no toggle, no `prefers-color-scheme` fallback. So the dark palette has
never rendered for anyone, which [design.md](../design.md) states accurately today ("⚠️ The dark set
is not yet reachable … **UI-4** is the switch"). This PR makes it reachable: a provider that sets the
class on `<html>`, a three-state control with `system` as the default, per-device persistence, and a
nonced pre-paint script so there is no flash of the wrong theme.

It also lands what **UI-3 cannot start without**. That row's acceptance is "more than one option,
**reviewed side by side** … in **both themes** — which is why **UI-4 lands first**". The switch is
the prerequisite; `/design/tokens` is the apparatus, and it ships with four candidate sets whose
contrast is measured rather than asserted.

## Acceptance

**Verbatim from [plan.md](../plan.md) row UI-4:**

> both themes pass `e2e/a11y.spec.ts` (axe AA contrast is checked, so the dark palette gets its first
> real audit), no flash on load, the choice survives a reload, and screenshots at three widths in
> both themes.

Done when:

- `system` is the default, so a viewer whose phone is dark gets dark untouched.
- Three states, one tab stop (a native radio group), one accessible name per option, visible group
  label, and every option's activatable area ≥ `MIN_TAP_TARGET_PX`.
- The choice persists per **device** (`localStorage`, no DB column) and survives a reload.
- **No flash, proven by mechanism, not by end state** — see "The no-flash test is the hard part".
- No horizontal overflow at 360px, on the new page measured **per candidate set**.
- `/design/tokens` is behind `requireGatedPage()`, `noindex`, holds no data, and passes axe WCAG A/AA
  in **both** themes.
- `:root` and `.dark` in `globals.css` are **not edited at all**. The only live visual change is the
  switch itself, on one page.

## Decisions the row owed

| Question                   | Answer                                   | Why                                                                                                                                                                  |
| -------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Three states or two?       | **Three**, `system` default              | Two states strand a system-dark viewer in light until they find the control. `system` is also the only honest server-side default, which is what kills the flash.    |
| Per-device or per-profile? | **Per-device (`localStorage`)**          | A theme is a property of the room; the gym is lit differently from the kitchen. A DB column would make it a write path (action + ownership + migration) for nothing. |
| Where does the control go? | **The profile picker, and nowhere else** | See "Placement". The provider is global; the control is not.                                                                                                         |
| `next-themes` or hand-roll | **`next-themes@0.4.6`**, exact pin       | See below. Decisive reason: `AGENTS.md` bans `dangerouslySetInnerHTML`, and a pre-paint script needs it.                                                             |
| Storybook or a route?      | **A route**, `/design/tokens`            | Zero new dependencies, free Vercel preview per PR, real components in the real shell.                                                                                |
| How many candidate sets?   | **Four: one control + three scoped**     | The control declares nothing, so it cannot drift; "three distinct token sets" is UI-3's own number.                                                                  |

## Why `next-themes`, checked against the don't-list

`AGENTS.md`'s don't-list bans runtime CSS-in-JS and `dangerouslySetInnerHTML`, among others.

- **Not CSS-in-JS.** It ships no styling runtime and emits no styles; it toggles a class on `<html>`
  and reads `localStorage` + `matchMedia`. Tailwind + shadcn is untouched.
- **Not client-fetching-where-RSC-works.** There is nothing to fetch: the value is a device
  preference, unknowable on the server by construction.
- **It is how our own tree avoids `dangerouslySetInnerHTML`.** A pre-paint script must be inline (an
  external one is a round-trip after first paint, i.e. the flash), and React's supported way to render
  inline script text is `dangerouslySetInnerHTML`. Writing it ourselves puts that construct in
  `app/layout.tsx`, the single most security-sensitive file in the tree and one that is in the public
  landing's module graph. `next-themes` does it inside its own package from a **static,
  non-interpolated** string. Honest statement: the construct still exists one dependency away; what
  changes is that no request-derived value can reach it from our code. (`next/script` also accepts
  inline children, so "the only way" would be too strong — the panel caught that overstatement.)
- **Supply chain:** 0.4.6, ~2.5KB, **zero runtime dependencies** — verified on install, which reported
  `+1` package total. Exact pin, no caret, like `next` and `react`: a package that writes an inline
  script into the document is one whose minor bumps we want to read.

**Rejected: hand-rolled (~50 lines).** Beyond the banned construct, the fiddly parts are a
`matchMedia` listener (so `Auto` follows the OS while the app is open) and a `storage` listener (so two
tabs agree). That is the library's whole job, tested upstream.

**Rejected: a cookie + a server-rendered class.** No flash by construction and no client JS, but it
turns a device preference into request data on every request, `system` still needs client `matchMedia`,
and a first-time visitor is still a guess.

### CSP: the part that needed care, and the claim that was wrong

`proxy.ts` emits `script-src 'self' 'nonce-…' 'strict-dynamic'` and, in production,
`style-src 'self' 'nonce-…'` — no `unsafe-inline`.

- The provider is given the request nonce (`headers().get('x-nonce')`, set by the proxy); without it
  the inline script is blocked **silently** and the theme applies only after hydration. The root
  layout is already `force-dynamic`, so reading headers costs nothing.
- ⚠️ **An earlier draft of this plan said `disableTransitionOnChange` must stay off because its
  injected `<style>` would be CSP-blocked. That was false**, and the correctness lens disproved it from
  the installed source: 0.4.6 sets the nonce on that element too
  (`dist/index.mjs`: `e && i.setAttribute("nonce", e)`), and its `.d.ts` says "the inline script **and
  style elements**". The flag is off because we do not need it — the only colour transition in the app
  is the 150ms `transition-all` on `buttonVariants` — and the code comment now says that instead. The
  wrong reason mattered: the plan had proposed committing it to a comment in `layout.tsx` specifically
  so a future author would not question it.
- Nothing here animates, so there is no `prefers-reduced-motion` obligation to discharge.

### The no-flash test is the hard part

The obvious test ("navigate, assert `<html>` has `.dark`") is **vacuous**: `toHaveClass` is a retrying
assertion, so it polls until hydration adds the class anyway, and a CSP-blocked script produces an
identical pass — the test would be green while the flash was back, and it was the design's only guard
for the nonce. `e2e/theme.spec.ts` therefore asserts three things that cannot be satisfied after the
fact, in the `chromium` project, which keeps **CSP live** (only the `a11y` project sets `bypassCSP`):

1. the `nonce` on the rendered `<script>` equals the nonce in that response's own CSP header, read
   from the **raw HTML** (Chrome blanks the attribute in the DOM, so a DOM read would under-report);
2. the document raises **zero** `securitypolicyviolation` events;
3. the **first** class mutation on `<html>` already contains `dark` while `document.readyState` is
   still `'loading'` — captured by a `MutationObserver` installed via `addInitScript`, before any page
   script runs.

**Negative control, run before merge:** drop the `nonce` prop and confirm (1) and (2) go red. Result
recorded in the review-response log.

## Placement

The control lives on the **profile picker (`app/p/page.tsx`), at the bottom of the page, and nowhere
else.** The provider stays in the root layout, so the choice applies everywhere, and the gate and the
public landing still follow the device.

The first draft put a bar in the root layout. The arithmetic the UX panel did is why it moved: Today
already spends ~300px above the first logging surface at 390px (`py-12` + back link + `h1` + a
two-row `DayNav` + the export link + `gap-8`), and a ~52px bar would push the strength section — the
actual task after 6:30pm — fully below the fold **on every route**, to host a preference a household
sets once per device. The picker is the app's front door past the gate, every "← All profiles" tap
returns to it, it is not a task screen, and at the bottom of a short page the control takes nothing
from "who's logging today?".

Rejected, with reasons:

- **Root-layout bar** — one insertion point, but it charges every screen for a once-per-device choice,
  and in flow it also scrolls away, so it is absent at the one moment the room-lighting argument
  invokes. It would also be the only content outside a landmark on every page.
- **`fixed top-2 right-2`** — zero layout cost, but the overlap math fails: the picker's `<h1>` first
  line ends near x≈306 of 344 starting at y=48, against a 44px control at y 6–50. A 2–4px box overlap
  at default size and a guaranteed collision at 200% zoom.
- **A slot in all five page headers** — best-looking, but five files, it reflows the picker's `<h1>`
  to two lines at 360px, and it quietly restyles existing screens, which this PR promised not to do.

**Widget: three native radios in a `<fieldset>` with a visible `<legend>`.** Native radios give one
tab stop with arrow-key movement and platform-announced state, so no live region (which would
double-announce). The `sr-only`-input-inside-a-`min-h-11`-label construction is borrowed from
`set-mode-toggles.tsx`, which is what makes the a11y gate measure the **label** as the tap target.

Three things the panel changed about it:

- **The skin is deliberately NOT the logging chips'.** Those are filled `bg-secondary` pills that
  record what was actually lifted; a theme control that looked identical would read as another logging
  control. The selected option **inverts** (`bg-foreground text-background`) — unmistakably not a chip,
  and 19:1 in both themes by construction, since those two tokens are each other's contrast pair.
- **`has-[:focus-visible]`, not `focus-within`.** `focus-within` also matches a pointer tap, which
  leaves a ring stuck on the control after every thumb press. And `ring-offset-background`, because
  Tailwind's `--tw-ring-offset-color` defaults to `#fff` — invisible in light, a white band in dark,
  which is a thing nobody could have seen until this PR made dark reachable.
- **`flex-wrap`.** At 200% text size (WCAG 1.4.4) the three segments are ~390px against ~296px of
  usable width at 360px, so they must stack rather than overflow. The landing's CTA already does this.
- **"Auto", not "System"**, with a static hint line ("Auto follows this device. Saved on this device
  only."). "System" is OS-vendor vocabulary; the primary users are kids between sets. The visible word
  stays a substring of the accessible name, so WCAG 2.5.3 holds.

**Pre-mount render:** `theme` is `undefined` on the server, and the three options are not equivalent.
Returning `null` grows the page ~44px on hydration (a CLS regression). Rendering three unchecked radios
paints a segmented control with nothing selected. So the server renders the **default** (`Auto`) as
checked, the client's first render does the same (so hydration matches exactly), and the effect
reconciles immediately. Asserted from `renderToString`, which is the only place the pre-mount state is
observable.

## The four candidate token sets

Scoped CSS variable blocks only — `[data-tokens='<id>']` light, `.dark [data-tokens='<id>']` dark — in
`app/design/tokens/token-sets.css`, imported **only** by the preview page, so they are code-split into
that route and cannot reach a product screen. `globals.css` is untouched.

| Set        | Neutral ramp         | Accent (`--primary`)         | Radius     | Density | Rationale                                                                                                                       |
| ---------- | -------------------- | ---------------------------- | ---------- | ------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Chalk**  | chroma 0 (today)     | today's near-black           | `0.625rem` | 1.00×   | **The control** — declares nothing, inherits `:root`/`.dark`, so it is byte-faithful by construction.                           |
| **Forge**  | hue 45, chroma ≤0.02 | orange `oklch(0.54 0.19 34)` | `0.375rem` | 1.00×   | The mark's own orange made load-bearing; warm graphite and hard corners read as equipment. Button label **5.55:1**.             |
| **Tatami** | hue 255–265          | blue `oklch(0.49 0.17 262)`  | `1rem`     | 1.12×   | Mat blue over cool slate; the roomiest of the four, which is the easiest to thumb between sets. Button label **6.46:1**.        |
| **Clinch** | hue 150–160          | green `oklch(0.44 0.12 157)` | `0.5rem`   | 1.04×   | Single-hue green with deliberately stronger hairlines — the only set clearing SC 1.4.11's 3:1 in **both** themes (3.07 / 3.58). |

**Every text pair in all three scoped sets clears AA in both themes, measured, with margin** — the
worst is 5.47:1 against a 4.5 floor, and all three beat today's `muted-foreground`-on-`muted` (4.34:1,
which fails). The numbers are computed by `app/design/tokens/contrast.ts` (OKLCH → sRGB → WCAG, ~30
lines, no dependency), asserted in `token-sets.test.ts`, and printed on the page itself, so "reads in
a sunlit gym" is a number rather than an adjective. The helper's sanity check is that it returns
**3.50:1** for `--brand` on white — exactly what `globals.css`'s own comment records for the mark.

**Density has a hard floor, and finding it is a result.** Tailwind v4 derives the spacing scale from
`--spacing` (`p-4` → `calc(var(--spacing) * 4)`, verified by compiling this app's CSS with
tailwindcss 4.3.3), so a scoped `--spacing` is a real density knob that restyles no component. But
`min-h-11` — the 44px tap-target bar in `buttonVariants` and `INPUT_CLASS` — is
`calc(var(--spacing) * 11)` too, so `0.24rem` silently makes every control 42.24px. **Density only
goes up**; the accurate framing is that a compact set would require decoupling `min-h-11`/`h-11` from
the spacing scale, which is out of scope. The floor is asserted, derived from `MIN_TAP_TARGET_PX`
rather than typed as `0.25rem`.

**One radius caveat, stated because it is visible:** `buttonVariants`' `xs`/`sm`/`icon-xs`/`icon-sm`
sizes use `rounded-[min(var(--radius-md),10px)]`, and a custom property is substituted at its
_declaring_ element — so those sizes keep the `:root` radius and do **not** follow a scoped `--radius`.
The inventory renders one size, so it does not mislead, but UI-3 should know.

## Why a route and not Storybook

Decided, not re-opened: zero new dependencies (Storybook is a large devDependency tree with its own
build and supply-chain surface, in a repo that SHA-pins every action and gates on `audit --prod`);
every PR already gets a Vercel preview URL, so a route is previewable on a real phone for free; and it
renders the **real components** with the **real tokens** in the real app shell — same CSP, same fonts,
same `@theme inline` resolution, same `.dark` mechanism. Token and layout bugs hide in isolation, and
Storybook's iframe is exactly that isolation.

**The page is component-major**, which the panel insisted on and was right about: one section per
component family with four cells side by side (2-up at 360px, 4-up at `lg`), rather than four stacked
full inventories ≈3,000px each, where comparing Forge's button with Tatami's would be a 3,000px
scroll — comparison by memory, which is the failure the "side by side" criterion exists to prevent.
The two shapes that genuinely need full width — the **strength set row** and the **day card** — are
four adjacent full-width repeats instead.

**It renders the real components, not facsimiles.** `ProgramReference` is a prop-driven Server
Component, so it takes literal `ProgramDayDTO` rows; `SetRepsWeightFields` + `SetModeToggles` are
hosted by a 40-line `'use client'` state holder. Copies were the first draft and three lenses refused
them: both sources are guide-owned, the copies would be owned by no guide, `set-fields.tsx`'s own
docblock says it exists to be the single source for exactly those attributes, and UI-1 is scheduled to
rewrite the day card — so the copy would have been stale on arrival.

## Gating, exposure and lifetime

`requireGatedPage()` like every other page (enforced statically by `app/pages-are-gated.test.ts`),
plus `metadata.robots = { index: false, follow: false }`. **Not** excluded from production builds:
the Vercel preview _is_ a production build, so a `NODE_ENV` guard would delete the capability that
justified choosing a route. It holds **no data** — every value is a literal in its own module, no DAL
read beyond the gate — so there is nothing to leak.

⚠️ **It has an end date, written down here and in the UI-3 row:** the UI-3 PR that picks a set
**deletes `app/design/tokens/` and its entry in `e2e/a11y.spec.ts`'s `ROUTES`**. A harness kept past
its decision is a CI cost paid forever for a choice made once.

## File-by-file changes

| Path                                                  | Change | What & why                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/package.json`                               | EDIT   | `+ "next-themes": "0.4.6"` — exact pin.                                                                                                                                                                                                                                                               |
| `apps/web/lib/constants.ts`                           | EDIT   | `THEME_CHOICES`, `ThemeChoice`, `THEME_STORAGE_KEY`, `THEME_COPY`, `TOKEN_SETS_PATH`. **Here, not a new `components/theme/theme.ts`**: this is where all nine `*_COPY` objects and every route path live, and the module is deliberately dependency-free so a `'use client'` component can import it. |
| `apps/web/components/theme/theme-provider.tsx`        | NEW    | `'use client'` wrapper pinning `attribute="class"`, `defaultTheme="system"`, `enableSystem`, the explicit `storageKey`, and the `nonce`.                                                                                                                                                              |
| `apps/web/components/theme/theme-toggle.tsx`          | NEW    | The three-radio segmented control.                                                                                                                                                                                                                                                                    |
| `apps/web/components/theme/theme-toggle.test.tsx`     | NEW    | Three named radios, exactly one checked, `setTheme` forwarded, label-in-name holds, and the `renderToString` pre-mount assertion.                                                                                                                                                                     |
| `apps/web/app/layout.tsx`                             | EDIT   | `async`; `suppressHydrationWarning` on `<html>`; nonce from `headers()`; `<ThemeProvider>` around `{children}`.                                                                                                                                                                                       |
| `apps/web/app/p/page.tsx`                             | EDIT   | `<ThemeToggle />` at the bottom of the picker, with the placement reasoning in the docblock.                                                                                                                                                                                                          |
| `apps/web/app/design/tokens/page.tsx`                 | NEW    | The harness: gated, `noindex`, component-major sections, a measured-contrast table, a section nav.                                                                                                                                                                                                    |
| `apps/web/app/design/tokens/inventory.tsx`            | NEW    | `SetCell` (applies a set's palette; **no attribute for the control**) + `ButtonsCell` / `FieldsCell` / `SurfacesCell`, every `id`/`name` namespaced by `setId`.                                                                                                                                       |
| `apps/web/app/design/tokens/set-row-demo.tsx`         | NEW    | `'use client'` state host for the **real** set-row components.                                                                                                                                                                                                                                        |
| `apps/web/app/design/tokens/token-sets.ts`            | NEW    | The sets' metadata **and values**, plus `PALETTE_TOKENS` / `SHAPE_TOKENS` / `EXCLUDED_TOKENS`.                                                                                                                                                                                                        |
| `apps/web/app/design/tokens/token-sets.css`           | NEW    | The scoped blocks (~160 lines of data).                                                                                                                                                                                                                                                               |
| `apps/web/app/design/tokens/contrast.ts`              | NEW    | OKLCH → sRGB → WCAG, used by the page **and** the test.                                                                                                                                                                                                                                               |
| `apps/web/app/design/tokens/token-sets.test.ts`       | NEW    | 88 assertions: CSS ↔ TS equality both ways, same keys in both themes, nothing outside the allowlist, non-zero chroma, the density floor, every text pair ≥ AA in both themes, and the live palette's known failures pinned.                                                                           |
| `apps/web/e2e/theme.spec.ts`                          | NEW    | The four mechanism tests described above.                                                                                                                                                                                                                                                             |
| `apps/web/e2e/a11y.spec.ts`                           | EDIT   | `/design/tokens` added to `ROUTES`; a `dark theme` describe re-scanning every route with a **vacuity guard** first; the stale `expectControls: false` opt-out for the picker removed; a per-set 360px overflow test.                                                                                  |
| `apps/web/scripts/capture.ts`                         | EDIT   | `colorScheme?: 'light' \| 'dark'` → the browser context.                                                                                                                                                                                                                                              |
| `apps/web/scripts/screenshot-ephemeral.ts`            | EDIT   | `--theme light\|dark`, validated, its value index added to `consumed` (or `--theme dark /p` would capture the route `dark`), threaded to both call sites, `-dark` on the filename stem.                                                                                                               |
| `apps/web/scripts/screenshot.ts`                      | EDIT   | The same flag, so `capture.ts`'s "one path, two callers" stays true.                                                                                                                                                                                                                                  |
| `.claude/skills/ui-screenshot/SKILL.md`               | EDIT   | Documents `--theme` and the both-themes obligation.                                                                                                                                                                                                                                                   |
| `docs/design.md`                                      | EDIT   | "Dark mode" and "Reskinning" rewritten; the ⚠️ unreachable warning dropped; points here rather than restating.                                                                                                                                                                                        |
| `docs/plan.md`                                        | EDIT   | UI-4 → shipped, linked here; UI-3's row records what now exists and inherits the harness's deletion.                                                                                                                                                                                                  |
| `docs/changelog/2026-10-07-feat-ui-4-theme-switch.md` | NEW    | The fragment.                                                                                                                                                                                                                                                                                         |

**Not changed, deliberately:** `docs/status.md`'s "Where we are" pointer (it names SEC-5 and PICK-1;
UI-4 does not move either, and status.md carries no UI rows) and `docs/roadmap.md` (no theme rows).
`docs/architecture.md` gets the render/CSP sequence as a Mermaid diagram in the PR description.

## Test plan

| Tier      | Test                                     | Asserts                                                                                                                    |
| --------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Unit      | `app/design/tokens/token-sets.test.ts`   | CSS ↔ TS binding, key parity across themes, allowlist, chroma, density floor, every text pair ≥ AA, known failures pinned. |
| Component | `components/theme/theme-toggle.test.tsx` | The control's contract, including the pre-mount render via `renderToString`.                                               |
| Static    | `app/pages-are-gated.test.ts` (existing) | `/design/tokens` awaits `requireGatedPage()` — automatic, no edit.                                                         |
| E2E       | `e2e/theme.spec.ts`                      | Nonce match, zero CSP violations, pre-`DOMContentLoaded` class, reload persistence, system default both ways.              |
| E2E       | `e2e/a11y.spec.ts`                       | axe A/AA on 4 routes × 2 themes (guarded against auditing light by accident); per-set 360px overflow.                      |

Local: `pnpm verify`, `pnpm e2e:local`. **No axe allowlist is added** — the file deliberately has none.

## Risks / rollback

| Risk                                                 | Mitigation                                                                                                                                                                                            |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The inline script is CSP-blocked → silent flash      | Nonce passed; three mechanism assertions in the CSP-live project; negative control run before merge.                                                                                                  |
| The "no flash" test passes vacuously                 | It asserts the nonce from raw HTML and the first mutation at `readyState === 'loading'`, neither reachable by hydrating.                                                                              |
| The dark pass audits light and reports green         | `expect(html).toHaveClass(/dark/)` before any scan, and the stored key cleared — this file has shipped that failure before.                                                                           |
| A candidate set fails contrast                       | Computed and asserted in the fast tier, before a human looks; three sets × two themes × nine text pairs all pass with margin.                                                                         |
| A candidate shrinks every tap target via `--spacing` | Floor asserted from `MIN_TAP_TARGET_PX`, plus the a11y scan on the route.                                                                                                                             |
| Four inventories duplicate `id`s                     | `setId`-namespaced ids and radio `name`s. Four `label[for]` copies would resolve to the first input (axe `label`, `wcag2a`) — and `duplicate-id` would NOT have warned, being deprecated in axe 4.13. |
| Hydration mismatch / CLS on the control              | Server renders the default checked; the fieldset always renders, so nothing depends on hydration for layout.                                                                                          |
| A token set silently inherits an app token           | Key-parity and allowlist assertions; `--brand` explicitly excluded.                                                                                                                                   |

**Rollback:** remove `<ThemeProvider>` from `layout.tsx` and `<ThemeToggle />` from the picker — two
lines, and the app renders light for everyone exactly as today. `app/design/tokens/` is inert on its
own; nothing else imports it. No migration, no data.

## Out-of-scope / deferred

- **Choosing a set.** This PR builds the apparatus and proposes four. `:root`/`.dark` are untouched.
- **Fixing the live palette's three sub-AA pairs** (`muted-foreground` on `muted` 4.34:1; the
  `destructive` button variant 4.39:1 light / 3.04:1 dark on a card) and the sub-3:1 hairlines
  (1.26:1 light, 2.69:1 dark). **Reported, with numbers, pinned by a characterization test.** None is
  rendered by any route today, which is the only reason CI has been green; fixing them means changing
  `--destructive`/`--muted`/`--border`, which changes the live app's appearance — the one thing this PR
  promised not to do. They are UI-3's inputs. The preview therefore does not render those two pairs,
  and says so where it would have.
- **New shadcn primitives.** The app vendors `button`, `card`, `empty-state`, `error-state`,
  `skeleton`. Adding Radix Tabs/Dialog to make a preview page look complete would ship unused product
  components; the section nav plays the role tabs would, and a dialog trigger is a `Button`.
- **The button size axis in the inventory.** `min-h-11` is in `buttonVariants`' base, so all eight
  sizes render at 44px and differ only in padding — 48 near-identical buttons per set, 192 across the
  page, for almost no token signal.
- **A per-profile theme**, and **type pairing** (a UI-3 lever with its own layout-shift risk).
- **Applying a set to Today / the strength form.** UI-3's literal wording, and two lenses pushed for a
  `?tokens=` param on `app/p/`. Rejected here: it would import candidate CSS into the hottest route in
  the app and change what a product page can render, against this PR's stated constraint. What
  replaced it is better than the facsimile the lenses were objecting to — the harness renders the
  **real** day card and the **real** set row. UI-3's row now records that its first step is the
  `?tokens=`-on-real-screens mechanism, so the criterion is moved explicitly rather than silently.

## Open questions

None.

## Review-response log (adversarial panel)

Seven lenses, run in parallel on the committed draft, before any implementation code:
`correctness-reviewer`, `scope-reviewer`, `architecture-reviewer`, `reuse-reviewer`, and
`ux-reviewer` three times (interaction/first-run, a11y/360px, trust/data-entry). The draft was
reshaped substantially; three of its factual claims were wrong and the panel proved it.

### Engineering panel (round 1)

| #   | Lens                 | Critique (short)                                                                                                  | Verdict      | Resolution                                                                                                                                                                                                                                                                                                                                 |
| --- | -------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C1  | Correctness          | The `DOMContentLoaded` no-flash assertion is vacuous — `toHaveClass` retries until hydration                      | **accepted** | Replaced with three mechanism assertions (raw-HTML nonce match, zero `securitypolicyviolation`, first mutation at `readyState === 'loading'`) + a negative control before merge.                                                                                                                                                           |
| C2  | Correctness          | The `disableTransitionOnChange` CSP reason is **false**; 0.4.6 nonces its `<style>`                               | **accepted** | Claim removed from the plan and from the code comment; the flag stays off for the honest reason. This is why panels read the dependency's source.                                                                                                                                                                                          |
| C3  | Correctness          | Forge's accent is 4.486:1 — under AA by 0.014; the dark accents fail as `text-primary`                            | **accepted** | Every set now specifies `--primary` **and** `--primary-foreground` per theme, with light accents for dark mode. All nine text pairs × 3 sets × 2 themes measured ≥ 5.4:1.                                                                                                                                                                  |
| C4  | Correctness          | "Same key set as `:root`" is self-contradictory — `--spacing` is not a `:root` key, `.dark` has 29                | **accepted** | Replaced by three precise assertions: `PALETTE_TOKENS` present in both themes, light/dark key parity (equal specificity makes this load-bearing), an explicit extras allowlist.                                                                                                                                                            |
| C5  | Correctness          | Four `<Inventory/>` copies duplicate every `id`; `label`/`select-name` are `wcag2a`, `duplicate-id` is deprecated | **accepted** | `setId` is a required prop; every `id`, `htmlFor` and radio `name` is namespaced. Day cards take distinct day roles so `ProgramReference`'s internal heading id stays unique.                                                                                                                                                              |
| C6  | Correctness          | The pre-mount render is unspecified; `null` costs ~44px of CLS                                                    | **accepted** | Server renders the default checked; asserted via `renderToString`.                                                                                                                                                                                                                                                                         |
| C7  | Correctness          | No `THEME_STORAGE_KEY`; the spec would re-type next-themes' default                                               | **accepted** | `THEME_STORAGE_KEY = 'mp_theme'` in `lib/constants.ts`, passed explicitly, pinned by a contract test.                                                                                                                                                                                                                                      |
| C8  | Correctness          | `rounded-[min(var(--radius-md),10px)]` will not follow a scoped `--radius`                                        | **accepted** | Documented as a caveat; the inventory renders one size, so it cannot mislead.                                                                                                                                                                                                                                                              |
| S1  | Scope                | Split into two PRs: UI-4, then the harness                                                                        | **rejected** | The brief for this task is explicitly UI-4 **plus** the preview harness, and UI-3 cannot start without it. The lens's cost argument was taken seriously in a different way: the harness shrank by ~60% (the control declares nothing, ~16 tokens instead of 37, real components instead of copies, 5 buttons instead of 48, no size axis). |
| S2  | Scope                | No line budget; ~1,300 lines                                                                                      | **accepted** | Shrunk as above; ~160 of the remaining CSS is data, and the plan now states what each file costs.                                                                                                                                                                                                                                          |
| S3  | Scope + Arch         | "Chalk" hand-duplicates 67 live declarations to be "the control"                                                  | **accepted** | **The best critique of the round.** The control now declares _nothing_ — no `data-tokens` attribute — so it inherits `:root`/`.dark` and is byte-faithful by construction.                                                                                                                                                                 |
| S4  | Scope                | The all-of-`:root` key rule mandates ~120 dead declarations (`--sidebar-*`, `--chart-*`, `--popover`)             | **accepted** | `PALETTE_TOKENS` is the 16 tokens the inventory renders; `--brand` explicitly excluded as mark-only.                                                                                                                                                                                                                                       |
| S5  | Scope + Reuse + Arch | The inventory copies two guide-owned components                                                                   | **accepted** | Imports the real `ProgramReference` and the real `SetRepsWeightFields`/`SetModeToggles`. No guide-owned file is edited, so no guide churn — and no facsimile to drift.                                                                                                                                                                     |
| S6  | Scope + Arch         | `/theme` ships forever with no removal condition                                                                  | **accepted** | Renamed to `/design/tokens` and given an explicit end date, recorded here, in the page's docblock, in the `ROUTES` comment and in the UI-3 row.                                                                                                                                                                                            |
| S7  | Scope                | Scan the harness in one theme only, to halve the e2e cost                                                         | **rejected** | The dark half is where candidate dark palettes get audited, and the acceptance says both themes. Paid for by shrinking the page instead.                                                                                                                                                                                                   |
| S8  | Scope                | `--theme`'s value index must join `consumed`, or `--theme dark /p` captures route `dark`                          | **accepted** | Done, validated like `--tz`, threaded to both call sites.                                                                                                                                                                                                                                                                                  |
| A1  | Architecture         | The harness hands UI-3 an unmeetable criterion ("real screens")                                                   | **partly**   | Option (a) (`?tokens=` on `app/p/`) rejected — it changes a product route's CSS and contradicts the brief's constraint. Option (b) taken: the UI-3 row is amended in this PR, and the harness now renders the real components rather than copies.                                                                                          |
| A2  | Architecture         | Density has a floor assertion and no ceiling; the route gets no 360px check                                       | **accepted** | A dedicated 360px test measures overflow **per `[data-tokens]` section**, so it names the disqualified candidate instead of just "the page".                                                                                                                                                                                               |
| A3  | Architecture         | `components/theme/theme.ts` is the wrong home for constants                                                       | **accepted** | Moved to `lib/constants.ts`, beside the nine other `*_COPY` objects and `APP_HOME_PATH`.                                                                                                                                                                                                                                                   |
| A4  | Architecture         | `runtime = 'nodejs'` on the preview copies a rule whose reason (pg) does not apply                                | **accepted** | Dropped.                                                                                                                                                                                                                                                                                                                                   |
| A5  | Architecture         | No `architecture.md` update / Mermaid diagram for a new cross-cutting flow                                        | **accepted** | The proxy → nonce → layout → pre-paint → `<html>` sequence goes in the PR description as Mermaid.                                                                                                                                                                                                                                          |
| R1  | Reuse                | Extract a shared chip-label class from `set-mode-toggles.tsx`                                                     | **rejected** | Directly contradicts UX lens 3, which requires the theme control to look **unlike** the logging chips. Extracting a shared value whose two users must diverge would create the drift the rule exists to prevent — and it would have forced a guide edit for a worse result.                                                                |
| R2  | Reuse                | `routeSlug`, `MOBILE_VIEWPORT`, `INPUT_CLASS`, `MIN_TAP_TARGET_PX` already exist                                  | **accepted** | All imported; the spacing floor is derived from `MIN_TAP_TARGET_PX`, and `screenshot.ts` imports `routeSlug` rather than re-deriving it. (`MOBILE_VIEWPORT` into `capture.ts` **rejected** — pre-existing, and the shapes differ.)                                                                                                         |
| R3  | Reuse                | `token-sets.ts` metadata duplicates the CSS numbers with nothing cross-checking                                   | **accepted** | The test asserts CSS ↔ TS equality in both directions. The duplication is unavoidable without a build step; what makes it safe is that it cannot drift silently.                                                                                                                                                                           |
| R4  | Reuse                | Drop the jsdom `min-h-11` class assertion — the a11y gate measures the real box                                   | **accepted** | Dropped; the component test keeps only structural assertions.                                                                                                                                                                                                                                                                              |
| R5  | Reuse                | `robots: noindex` is a second occurrence; extract                                                                 | **rejected** | Two occurrences of a two-field literal, one of which is deleted with the harness. "Centralize for meaning and sync, not ceremony."                                                                                                                                                                                                         |

### UX panel (round 1)

| #   | Lens          | Critique (short)                                                                                 | Verdict        | Resolution                                                                                                                                                              |
| --- | ------------- | ------------------------------------------------------------------------------------------------ | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1  | 1 interaction | A once-per-device preference takes ~52px on every route; the one-home option was never priced    | **accepted**   | Moved to the picker only, with the Today arithmetic in "Placement". The landing, the gate, Today and the routine editor pay 0px.                                        |
| U2  | 1 + 3         | Four stacked inventories make side-by-side comparison impossible at every width                  | **accepted**   | Component-major layout, 2-up at 360px / 4-up at `lg`, with the two full-width shapes adjacent. Two lenses reached this independently.                                   |
| U3  | 1             | A section nav is referenced but appears in no file                                               | **accepted**   | A real `<nav>` of anchor links.                                                                                                                                         |
| U4  | 1             | Pre-mount render flashes an unselected control or shifts ~44px                                   | **accepted**   | Same fix as C6.                                                                                                                                                         |
| U5  | 1 + 3         | "System" is not a word these users have                                                          | **accepted**   | Visible label "Auto", plus a static hint line. Lens 3 thought "System" defensible; "Auto" + the hint satisfies both.                                                    |
| U6  | 1             | The inventory's 8-size button axis is 192 near-identical buttons                                 | **accepted**   | Five variants, one size.                                                                                                                                                |
| U7  | 1             | `?tokens=` on the real Today screen                                                              | **rejected**   | Same reason as A1 — and the real components in the harness answer the underlying objection.                                                                             |
| U8  | 2 a11y        | ~390px at 200% text zoom overflows 296px of usable width                                         | **accepted**   | `flex-wrap` on the segment container.                                                                                                                                   |
| U9  | 2             | `focus-within` is not `focus-visible`; `ring-offset` paints white in dark                        | **accepted**   | `has-[:focus-visible]:` + `ring-offset-background` on the new control. Not retrofitted to `set-mode-toggles.tsx` — a guide-owned file, pre-existing, and its own PR.    |
| U10 | 2             | Heading order and landmarks on the new page are unspecified, and axe's A/AA tags cannot see them | **accepted**   | One `<h1>`, `<h2>` per section with `aria-labelledby`, `<h3>` per set; the table in its own `overflow-x-auto`.                                                          |
| U11 | 2             | The dark pass can audit light and report green (storageState may carry a key)                    | **accepted**   | Vacuity guard asserting `.dark` before any scan, and the stored key cleared.                                                                                            |
| U12 | 2             | Forge 4.49:1; the `destructive` button variant is 3.99:1 on **today's** palette                  | **accepted**   | Forge re-derived. The destructive variant measured at 4.39:1 (and 3.04:1 dark on a card) and is **reported, not rendered and not silenced** — see Out-of-scope.         |
| U13 | 2             | "First real audit" overstates it — axe's contrast is text-only                                   | **accepted**   | The plan says text-contrast, and the sub-3:1 hairlines are handed to UI-3 with numbers.                                                                                 |
| U14 | 2             | The inventory renders every stateful control in one state                                        | **partly**     | Added a checked chip, a checked radio and an `aria-invalid` field. The `destructive` variant stays out for U12's reason, and `disabled` is exempt (axe skips it).       |
| U15 | 2             | A `<footer>` after `{children}` costs zero above-the-fold space                                  | **superseded** | A genuinely good fourth option. U1's picker placement dominates it: zero cost on the four task screens _and_ no new global chrome.                                      |
| U16 | 3 trust       | The theme chips are specified to look exactly like the logging chips                             | **accepted**   | Inverted-selected skin, visible legend. U1's placement also removes the co-location on Today entirely.                                                                  |
| U17 | 3             | Nothing proves a mis-tap can't discard unsaved form state                                        | **dissolved**  | With the control on the picker only, there is no form to lose: the toggle no longer shares a screen with any input. Recorded because it was the right question.         |
| U18 | 3             | Contrast mitigation rests on a non-required check; `--primary-foreground` unspecified            | **accepted**   | Moved into the required `quality` job as a unit test; every foreground pinned per theme.                                                                                |
| U19 | 3             | The page asks for a sunlit-legibility judgement and supplies adjectives                          | **accepted**   | Measured ratios printed on the page, light and dark, from the same helper the test uses.                                                                                |
| U20 | 3             | Nothing views the apparatus under the condition the sets are optimised for                       | **accepted**   | An acceptance line in the UI-3 hand-off: open the preview on the logging phone, in gym light and daylight, both themes, before choosing — and record device + lighting. |
| U21 | 3             | `design.md` should answer the shared-phone question in words                                     | **accepted**   | "One phone, one theme, whichever profile is open; it clears with site data."                                                                                            |
| U22 | 1 + 2 + 3     | The bar is the only content outside a landmark on every page                                     | **dissolved**  | The bar is gone; the control sits inside the picker's `<main>`.                                                                                                         |
| U23 | 1 + 2         | The toggle becomes the first tab stop before every page's `<h1>`, incl. the gate's password      | **dissolved**  | Gone from the gate and the landing. For the record the panel's framing was slightly off: a native radio group is **one** tab stop, not three.                           |

### Also corrected by the panel

Three of the draft's own citations were wrong, and leaving them would have undermined everything
around them: `docs/design.md` does **not** claim components "adapt automatically" (commit `0e0ff5b`,
this branch's base, already replaced that with an accurate warning — so the design.md edit shrank to
the "Dark mode" and "Reskinning" sections); several `proxy.ts` / `playwright.config.ts` line numbers
were off by a few lines; and `vitest.config.ts` needs a `// @vitest-environment jsdom` docblock for the
component test, which is the existing convention (`profile-tile.test.tsx:1`) rather than a config
change.
