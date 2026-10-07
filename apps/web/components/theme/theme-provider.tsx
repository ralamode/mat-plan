'use client';

import { ThemeProvider as NextThemeProvider } from 'next-themes';

import { THEME_STORAGE_KEY } from '@/lib/constants';

/**
 * The theme provider (UI-4) — one place that pins every decision, so none of them can be changed by
 * accident at a call site.
 *
 * ## Why a library at all
 *
 * The hard part of a theme switch is the **pre-paint script**: the stored choice lives in
 * `localStorage`, which only the browser can read, so the class must be on `<html>` *before* the
 * first paint or the viewer sees a flash of the wrong theme on every load. That script has to be
 * inline, and React's supported way to render inline script text is `dangerouslySetInnerHTML` —
 * which `AGENTS.md`'s don't-list forbids. `next-themes` does it inside its own package, from a
 * static string no request data can reach, which is the property that rule exists to protect.
 * (`next/script` can take inline children, so "the only way" would be too strong a claim; the
 * decisive argument is that the sink then sits in `app/layout.tsx`, the one file in the module graph
 * of the public landing.) It also owns the parts that are fiddly rather than hard: a `matchMedia`
 * listener so `Auto` follows the OS while the app is open, and a `storage` listener so two tabs
 * agree. 0.4.6 is ~2.5KB and has **zero** runtime dependencies (verified on install: `+1` package).
 *
 * ## The nonce is not optional
 *
 * `proxy.ts` emits `script-src 'self' 'nonce-…' 'strict-dynamic'` with no `unsafe-inline`, so an
 * un-nonced inline script is silently blocked and the theme applies only after hydration — the exact
 * flash this exists to prevent, with nothing visible to tell you. The root layout reads the proxy's
 * `x-nonce` request header and passes it here; `e2e/theme.spec.ts` asserts the nonce on the rendered
 * tag matches the one in the CSP header, and that the page raises no `securitypolicyviolation`, so a
 * regression fails a test rather than a reviewer's eye.
 *
 * ## `disableTransitionOnChange` is off, and NOT for a CSP reason
 *
 * An earlier draft of the plan claimed the flag's injected `<style>` would be CSP-blocked. **That is
 * false** — 0.4.6 sets the nonce on that element too (`dist/index.mjs`: `e && i.setAttribute("nonce",
 * e)`), and the panel caught the error. It is off because we do not need it: the only colour
 * transition in the app is the 150ms `transition-all` on `buttonVariants`, and a brief tint on a few
 * buttons while the theme changes is fine. Nothing here animates, so there is no
 * `prefers-reduced-motion` obligation to discharge.
 */
export function ThemeProvider({
  nonce,
  children,
}: {
  /** The proxy's per-request nonce, from the root layout. */
  nonce?: string;
  children: React.ReactNode;
}) {
  return (
    <NextThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      storageKey={THEME_STORAGE_KEY}
      nonce={nonce}
    >
      {children}
    </NextThemeProvider>
  );
}
