- **2026-10-07** — **Added gate 3b to [parallel-work.md](../parallel-work.md): read the repo from
  `origin/main`, not from a working tree.** Same rule as gate 3 pointed the other way — _"merged" is
  not "what my checkout has."_ ⚠️ **Earned the hard way.** The main checkout was parked on a stale
  branch and then on a local `main` that had **diverged** (one local commit, sixty-five behind), so
  `git pull --ff-only` refused rather than fixing it and the tree looked ordinary while being ~70
  commits old. Reading it produced a **confidently wrong collision analysis**: `app/page.tsx` appeared
  to import `listProfiles`, making ONB-0 look like it collided with TEN-1's scoping seam, when OSS-2
  had long since moved the app behind a landing page and that import no longer existed. The lanes were
  never at risk — AGENTS.md already requires a worktree cut from `origin/main` — only the reads were,
  which is why the discipline needed its own entry: fetch first and read `origin/main:<path>`, prefer
  `path:symbol` over a working-tree line number, and re-derive against `origin/main` before acting on
  any conclusion that rests on a file's contents. The gate also records what the tooling cannot do:
  `guard-main-checkout.mjs` blocks writes from a Claude session but cannot stop a human committing to
  `main` from their own terminal and says nothing about reads, so detection is the only real control —
  and `session-context.mjs` currently warns about the wrong **branch**, not about being on `main` and
  **ahead** of `origin/main`, which is the state that actually bit.
