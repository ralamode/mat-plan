# mat-plan — Design language

The visual system for the app. **Adult-first and clean — not a kid aesthetic.** The kid ergonomics
(large tap targets, high contrast, numeric keypads, clear labels) come from good general design, not
cartoon styling. Built on **shadcn/ui (Radix primitives) + Tailwind v4**, themed entirely with
CSS-variable tokens so components adapt to light/dark automatically.

## Principles

- **Semantic + accessible first.** Correct native elements, labels, focus-visible, keyboard support
  (see the semantic-HTML rule in `AGENTS.md`). Radix/shadcn give this by default — don't regress it.
- **Token-driven.** Components never hardcode colors; they use the semantic tokens below. To reskin,
  change the tokens, not the components.
- **Restrained palette.** Neutral grayscale base (zero-chroma) keeps it calm and grown-up; color is
  reserved for meaning (primary actions, destructive, charts).
- **Kid ergonomics as defaults:** interactive targets ≥ 44px, `inputmode="numeric"` on number
  fields, high contrast, generous text size — applied everywhere, no separate "kid mode."

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

`.dark` class on the root toggles the dark token set (`@custom-variant dark`). A theme toggle lands
in a later PR; the tokens already support both.

## Reskinning

Change the OKLCH values in `globals.css` (`:root` / `.dark`) — every component follows. Keep contrast
ratios AA+ for text; verify with an a11y check (axe) as part of the a11y DoD.
