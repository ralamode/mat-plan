# mat-plan — Design language

The visual system for the app. **Adult-first and clean — not a kid aesthetic.** The kid ergonomics
(large tap targets, high contrast, numeric keypads, clear labels) come from good general design, not
cartoon styling. Built on **shadcn/ui (Radix primitives) + Tailwind v4**, themed entirely with
CSS-variable tokens, so a reskin is a token change and both themes are already defined — and since
**UI-4** both of them actually render.

## Principles

- **Semantic + accessible first.** Correct native elements, labels, focus-visible, keyboard support
  (see the semantic-HTML rule in `AGENTS.md`). Radix/shadcn give this by default — don't regress it.
- **Token-driven.** Components never hardcode colors; they use the semantic tokens below. To reskin,
  change the tokens, not the components.
- **Restrained palette.** Neutral grayscale base (zero-chroma) keeps it calm and grown-up; color is
  reserved for meaning (primary actions, destructive, charts, a logged row).
- **Kid ergonomics as defaults:** interactive targets ≥ 44px, `inputmode="numeric"` on number
  fields, high contrast, generous text size — applied everywhere, no separate "kid mode."
- **Adaptive / mobile-first:** the kids use this **primarily on phones and tablets**, so design at the
  narrow width first and let it scale up. Fluid, responsive layouts (Tailwind breakpoints); no
  desktop-only fixed widths; content wraps/stacks gracefully from ~360px through desktop. UI PRs are
  screenshotted at mobile + tablet + desktop (AGENTS.md) — a layout that only works wide is a defect.

## Layout — the app shell

Every authenticated **app screen** is rendered inside **`apps/web/components/layout/app-shell.tsx`**
(UI-5). A page writes its own content and nothing about its frame. (Two routes opt out by design:
`/design/tokens` and the root error boundary — see [architecture.md](./architecture.md) § 2e.)

| Width       | What the shell renders                                                     |
| ----------- | -------------------------------------------------------------------------- |
| below `lg`  | one centred column, `max-w-2xl` — today's layout, unchanged                |
| `lg` and up | a 16rem nav rail, then the page; the content keeps its `max-w-2xl` measure |

- **The rail is the athlete switcher**, not a menu: it lists the household's live athletes plus
  Settings, so a laptop can change kid without a round trip through `/p`. It invents no destination.
- **The content stays at `max-w-2xl` in the wide cell.** A measured form at ~1000px grows a movement
  input to ~650px for a ten-character name; the principle above says scale **up**, not stretch.
- **`/p` renders no rail** — it is itself the athlete switcher, so a rail there would link every
  athlete twice on one page.
- `<main id="main">` and the one `<footer>` are declared **only** in the shell, which is what makes
  the skip link and the sheet's focus fallback deterministic. `app/pages-need-a-session.test.ts`
  fails a page that declares its own.
- **The rail is a column, not a page.** It wraps names (never truncates — PROF-1 D11), shows each
  athlete's kind as the picker tile does, and scrolls itself when a large household outgrows the
  viewport. The **open row is outlined, not filled**: a muted line on `--accent` measures 4.34:1 in
  the light palette, under AA.
- **Tailwind v4 breakpoints are `rem`-based**, so `lg` is 64rem — not 1024 device pixels for a reader
  at enlarged browser text. Design the switch as "when there is room", not "on a laptop".

Plan and the alternatives that were rejected: [plans/ui-5-app-shell.md](./plans/ui-5-app-shell.md).
Regions in context: [architecture.md](./architecture.md).

## Tokens

Defined as CSS variables in `apps/web/app/globals.css` (`:root` = light, `.dark` = dark), exposed to
Tailwind via `@theme inline`. Colors are **OKLCH**.

### Semantic colors (use the Tailwind classes, e.g. `bg-background`, `text-muted-foreground`)

| Token                                    | Role                                                                          |
| ---------------------------------------- | ----------------------------------------------------------------------------- |
| `background` / `foreground`              | page surface / default text                                                   |
| `card` / `card-foreground`               | card surface / text on card                                                   |
| `popover` / `popover-foreground`         | overlays                                                                      |
| `primary` / `primary-foreground`         | primary actions/emphasis                                                      |
| `secondary` / `secondary-foreground`     | secondary actions                                                             |
| `muted` / `muted-foreground`             | subdued surfaces / secondary text                                             |
| `accent` / `accent-foreground`           | hover/selected accents                                                        |
| `destructive` / `destructive-foreground` | destructive actions/errors / the label on a solid destructive button          |
| `done` / `done-foreground`               | a ticked ✓'s fill and a done card's edge / the glyph on the fill              |
| `done-surface`                           | a logged row's tint; text on it is `card-foreground`, never `done-foreground` |
| `done-muted-foreground`                  | secondary text on `done-surface` (hints, PREVIOUS, "Last time")               |
| `border` · `input` · `ring`              | hairlines · field borders · focus ring                                        |
| `chart-1..5`                             | data-viz series (grayscale ramp for now)                                      |
| `brand`                                  | the mark's orange — **the mark ONLY**                                         |

`brand` (OSS-2) is 3.5:1 on white: enough for a graphic, not for text. Never use it as a text or button
colour; a brand-coloured control would need its own, darker token. It needs no `.dark` value (about 6:1
on the dark background).

`done` (FAM-1) is the app's only success colour, and it means **logged**. (The prototype also
paints the item picker's selected rows with it; whether the picker follows is step 9's call, against
the same rules.) The rules a logged row follows, with the ratios pinned in `app/done-tokens.test.ts`
in both themes:

- **The fill carries the state, not the hue.** A ticked ✓ is filled with `done` and is at least 3:1
  against the un-ticked control (`muted`), so it reads in greyscale and to a red-green colour-blind
  eye. It also sets `aria-pressed` and keeps its accessible name. Under `forced-colors` the fill
  disappears, so a ticked ✓ needs a second cue there (a thicker border or a different glyph).
- **The tint is decoration.** `done-surface` is about 1.1:1 against a card in light and 1.3:1 in
  dark. A done card keeps a `border-done` edge, which is what shows the row's boundary.
- **Text on the tint** is `card-foreground`, or `done-muted-foreground` for secondary text:
  `muted-foreground` is 4.27:1 there in light, under AA. `done` is never text on its own; a word or
  the ✓ goes with it ("Done ✓").
- **Focus on a ✓ is a full-opacity `ring-foreground` ring OUTSIDE the ✓**, offset onto the tint or
  the card, where it is at least 3:1 in both themes. Never inset it on the fill: there it is 2.0:1
  in dark. `ring` now clears 3:1 on the tint too (4.27 light, 5.16 dark), but the ✓ keeps
  `foreground` because the ring sits offset over a `done` fill, where `foreground` is the stronger
  edge.

The prototype's light fill was 3.7:1 under white, so the app's is darker. A reskin (UI-3) re-measures
these pairs, since the candidate sets don't declare them.

### Scales

- **Radius:** base `--radius: 0.625rem`, with `sm/md/lg/xl/2xl/3xl/4xl` derived from it.
- **Type:** `--font-sans` = Geist, `--font-mono` = Geist Mono (via `next/font`). Headings use the
  sans stack; sizes come from Tailwind's default type scale.
- **Spacing:** Tailwind's default spacing scale.

## Components

- shadcn components are **copied into** `apps/web/components/ui/` (we own them). Add more with
  `pnpm dlx shadcn@latest add <name> -c apps/web`.
- App/feature components live in `apps/web/components/<feature>/` and compose the `ui/` primitives.
- Charts (later) use Recharts via shadcn's chart wrapper, colored from the `chart-*` tokens.

## Dark mode

`.dark` on `<html>` selects the dark token set (`@custom-variant dark`). Since **UI-4** a provider
sets it: three states (**Auto / Light / Dark**) with **Auto as the default**, so a viewer's device
preference is honoured before anyone touches anything. Full reasoning — the placement, the nonce,
and why the no-flash test asserts a mechanism rather than an end state — is in
[plans/ui-4-theme-switch.md](./plans/ui-4-theme-switch.md); the three things worth knowing here:

- **The control lives on the profile picker, and only there.** A theme is a settings-grade preference
  set once per device, and the logging screens cannot spare the vertical space.
- **Per device, not per profile.** One phone, one theme, whichever profile is open — a theme is a
  property of the room, and the gym is lit differently from the kitchen. It is stored in
  `localStorage` (`THEME_STORAGE_KEY`), so it never leaves the device and **it clears with site
  data**.
- **No flash, and it is tested as such.** A nonced pre-paint script sets the class before first
  paint; `e2e/theme.spec.ts` asserts the nonce matches the response's CSP header and that the first
  class mutation lands while `readyState === 'loading'`.

Both themes are scanned by `e2e/a11y.spec.ts` on the routes the household uses. ⚠️ **Not on the
public ones** — the dark pass loops `ROUTES` (the picker, Today, the routine editor, token sets), so
`/`, `/privacy` and `/sign-in` get the light pass only. For `/` and `/privacy` that is defensible and
the spec says why: they carry app tokens and no colour of their own. **`/sign-in` is the exception
worth knowing about**, because the lit Clerk card ships its own palette from a CDN, so its dark
rendering is pinned by nothing here.

## Reskinning

Change the OKLCH values in `globals.css` (`:root` / `.dark`) — every component follows. Keep contrast
ratios AA+ for text; verify with an a11y check (axe) as part of the a11y DoD.

**Candidates are reviewed at `/design/tokens`** (gated, `noindex`), which renders the app's real
components under four token sets × both themes, with **measured** WCAG ratios printed beside them.
A set is a scoped block of CSS variables — `@theme inline` resolves every colour, radius and spacing
utility at its use site, so re-declaring the variables on an ancestor re-themes the subtree and no
component changes. Two constraints that came out of building it:

- **Two red treatments, one rule.** The solid `destructive` button (`bg-destructive
text-destructive-foreground`, 4.76:1 light / 6.19:1 dark) is for the one button that commits a
  removal after a confirmation, such as Clear this day's "Clear day". An outline button with red text
  is for an inline choice beside a safe default (the workout editor's Discard). Its focus is the
  ✓'s offset outline, since `foreground` inside the dark fill is under 3:1. Inactive (`aria-disabled`, `PENDING_CLASS` at 60%) it is
  only about 1.55:1 from its live fill in light, and its label about 3:1, so a screen that keeps it
  inactive says why in words; the state alone does not carry it.
- **Density only goes up.** Tailwind derives the spacing scale from `--spacing`, and `min-h-11` — the
  44px tap-target bar — is `calc(var(--spacing) * 11)`. Below `0.25rem` every control drops under the
  bar.
- **Two pairs in the current palette are already under AA** (`muted-foreground` on `muted`, and red
  text on a red tint, the `destructive` button's old look), and the hairlines miss SC 1.4.11. None is
  rendered by a route today, which is why CI is green. They are pinned in
  `app/design/tokens/token-sets.test.ts` as inputs to the reskin, not background noise, measured as a
  browser composites them (gamma-encoded sRGB); they are not restated here.

⚠️ The harness is temporary: the PR that picks a set deletes `app/design/tokens/`, **except
`contrast.ts` (with its `contrast.test.ts`) and `css-block.ts`**, which `app/done-tokens.test.ts`
imports; that PR moves them to `lib/` rather than deleting the pins with them.
