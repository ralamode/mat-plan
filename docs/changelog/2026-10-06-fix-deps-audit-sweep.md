- **2026-10-06** — **Eleven of thirteen `pnpm audit` findings are gone, nine of them without an
  override.** The one `audit --prod` flagged was `fast-uri` (GHSA-hrr3-gc8f-f4qj, reached through
  `@sentry/nextjs > @sentry/webpack-plugin > … > ajv`); checking whether `ajv`'s own `^3.0.1` range
  already admitted the patch turned a permanent pin into a **four-line lockfile bump**. The same check
  cleared eight more, including a **critical** `proxy-addr` under the `shadcn` CLI's MCP SDK, and
  `ip-address` needed one in-range `overrides` entry. **`audit --prod` is now clean.** Two resist and are
  in [tech-debt](../tech-debt.md): `esbuild@0.18.20`, pinned by a deprecated `@esbuild-kit/*` inside
  `drizzle-kit`, and `braces@3.0.3` — whose advisory names `>=3.0.4` as the fix, **a version that does not
  exist**, so pinning it makes the install unresolvable. Worth remembering before trusting a "patched
  versions" field: in-range is not the same as published.
