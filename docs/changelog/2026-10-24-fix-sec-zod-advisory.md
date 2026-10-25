- **2026-10-24** — **A high-severity `zod` advisory landed in the production tree and turned every PR
  red**, including two that had nothing to do with it. `GHSA-mrhx-c7xc-m3w5` / CVE-2023-54404 (CVSS
  8.2) is a memory-exhaustion DoS: `$ZodArray` accumulates one issue object per failing element with
  no cap, so an oversized untrusted array validated against an unbounded array schema can OOM the
  process. Patched in **4.6.6**.
  **Our own zod was never affected** — `apps/web`, `packages/shared` and `packages/evals` all declare
  `^4.6.7`, so every Server Action and shared schema was already patched. The vulnerable copy was
  `zod@4.1.11`, reached through `@vercel/functions > @vercel/oidc > @vercel/cli-config`, which serves
  cli-config's local-config reading and parses no untrusted arrays. **Low practical exposure — and the
  gate is deliberately blunt about the `--prod` tree, which is right.** "Low exposure" is an argument
  for calm, not for an exception.
  ⚠️ **A bump does not fix it.** `@vercel/cli-config` pins `zod: 4.1.11` **exactly**, and the latest
  `@vercel/functions@3.10.3` still resolves `cli-config@0.3.3`, which still pins `4.1.11`. An override
  is the only lever.
  🔴 **And it had to be SCOPED.** A bare `zod:` entry would also have hit `zod@3.25.76`, which serves
  the shadcn CLI chain (`@modelcontextprotocol/sdk`, `zod-to-json-schema` — the latter built against
  zod 3) — dragging a dev toolchain across a **major** version to fix a transitive advisory somewhere
  else entirely. `'@vercel/cli-config>zod': '>=4.6.6'` moves exactly one edge: `zod@4.1.11` disappears,
  cli-config resolves `4.6.7`, and the seven `zod@3.25.76` references are untouched.
  Audit after: **`high 0 · critical 0`**, 197 prod deps.
