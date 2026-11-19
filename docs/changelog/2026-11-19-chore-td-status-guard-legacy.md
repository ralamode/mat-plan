- **2026-11-19** — **The changelog guard drops its pre-fragment rule** (tech-debt entry paid off). It
  used to accept an edit to `docs/status.md` as the changelog entry on a branch with no
  `docs/changelog/README.md`, for branches cut before fragments existed. No open PR is that old any
  more, so the guard now always asks for a fragment, and a tree without that README stops with an
  error instead of falling back. Its self-test checks the same branch types against fragments.
