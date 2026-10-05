- **2026-10-05** — **Privacy is a review lens of its own, and names come out of the prose.** PR review
  gains a tenth rubric dimension and a `privacy-reviewer` agent, triggered when a diff touches the
  schema, the DAL, an export, logging, a new dependency or a third-party call. It asks a different
  question from the security lens: not whether an attacker can reach the data, but whether we should
  hold it and whether the person it belongs to can get it back or get rid of it. The app holds minors'
  health data in a public repo, so a committed real value is a P0. Alongside it, a standing convention:
  **no personal names in PRs, plans, ADRs, changelog fragments or commit messages** — the role and the
  date carry attribution instead. Going-forward only, and stated as such: the commit author and email
  are in every commit, and `git log -S` finds whatever a working-tree sweep removes.
