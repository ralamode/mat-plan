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
  reserved for meaning (primary actions, destructive, charts).
- **Kid ergonomics as defaults:** interactive targets ≥ 44px, `inputmode="numeric"` on number
  fields, high contrast, generous text size — applied everywhere, no separate "kid mode."
- **Adaptive / mobile-first:** the kids use this **primarily on phones and tablets**, so design at the
  narrow width first and let it scale up. Fluid, responsive layouts (Tailwind breakpoints); no
  desktop-only fixed widths; content wraps/stacks gracefully from ~360px through desktop. UI PRs are
  screenshotted at mobile + tablet + desktop (AGENTS.md) — a layout that only works wide is a defect.

## Tokens

Defined as CSS variables in `apps/web/app/globals.css` (`:root` = light, `.dark` = dark), exposed to
Tailwind via `@theme inline`. Colors are **OKLCH**.

### Semantic colors (use the Tailwind classes, e.g. `bg-background`, `text-muted-foreground`)

| Token                                | Role                                     |
| ------------------------------------ | ---------------------------------------- |
| `background` / `foreground`          | page surface / default text              |
| `card` / `card-foreground`           | card surface / text on card              |
| `popover` / `popover-foreground`     | overlays                                 |
| `primary` / `primary-foreground`     | primary actions/emphasis                 |
| `secondary` / `secondary-foreground` | secondary actions                        |
| `muted` / `muted-foreground`         | subdued surfaces / secondary text        |
| `accent` / `accent-foreground`       | hover/selected accents                   |
| `destructive`                        | destructive actions/errors               |
| `border` · `input` · `ring`          | hairlines · field borders · focus ring   |
| `chart-1..5`                         | data-viz series (grayscale ramp for now) |
| `brand`                              | the mark's orange — **the mark ONLY**    |

`brand` (OSS-2) is 3.5:1 on white: enough for a graphic, not for text. Never use it as a text or button
colour; a brand-coloured control would need its own, darker token. It needs no `.dark` value (about 6:1
on the dark background).

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

Both themes are scanned by `e2e/a11y.spec.ts` on every route.

## Reskinning

Change the OKLCH values in `globals.css` (`:root` / `.dark`) — every component follows. Keep contrast
ratios AA+ for text; verify with an a11y check (axe) as part of the a11y DoD.

**Candidates are reviewed at `/design/tokens`** (gated, `noindex`), which renders the app's real
components under four token sets × both themes, with **measured** WCAG ratios printed beside them.
A set is a scoped block of CSS variables — `@theme inline` resolves every colour, radius and spacing
utility at its use site, so re-declaring the variables on an ancestor re-themes the subtree and no
component changes. Two constraints that came out of building it:

- **Density only goes up.** Tailwind derives the spacing scale from `--spacing`, and `min-h-11` — the
  44px tap-target bar — is `calc(var(--spacing) * 11)`. Below `0.25rem` every control drops under the
  bar.
- **Three pairs in the current palette are already under AA** (`muted-foreground` on `muted` 4.34:1,
  the unused `destructive` button variant 4.39:1 light / 3.04:1 dark) and the hairlines miss SC
  1.4.11 (1.26:1 light, 2.69:1 dark). None is rendered by a route today, which is why CI is green.
  They are pinned with their measured values in `app/design/tokens/token-sets.test.ts` and are inputs
  to the reskin, not background noise.

⚠️ The harness is temporary: the PR that picks a set deletes `app/design/tokens/`.
