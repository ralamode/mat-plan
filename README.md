# screenshots

PR screenshots, hosted so they render inside GitHub PR comments.

**This is an ORPHAN branch** — it shares no history with `main`, is never merged, and is not part
of a normal checkout. Do not branch from it or merge it anywhere.

Written by `pnpm --filter web screenshots:publish`. One directory per PR (`pr-<n>/`), so a merged
PR's images can be pruned by deleting its directory.

Why not `raw.githubusercontent.com`? On a private repo it needs an `Authorization` header a browser
never sends, so images 404. `github.com/<owner>/<repo>/raw/...` uses the viewer's session and works.
