- **2026-10-07** — **PRIV-1: the privacy review is done, and its documents are written**
  ([plan](../plans/priv-1-privacy-review.md), [docs/privacy/](../privacy/)). A plain-language
  [notice](../privacy/notice.md) listing what is stored and **every** processor, a retention policy, a
  defined household deletion ([runbooks.md](../runbooks.md)) with its residuals stated, the consent
  checklist `AUTH-1` owes, and `SECURITY.md`'s threat model rewritten for many households — keeping
  the MCP/LLM clause and the **operational** one-household control that is the only thing preventing a
  cross-household leak today. The evidence it is derived from, with cites, is
  [data-inventory.md](../privacy/data-inventory.md): all 18 tables, the eight processors, retention,
  and the committed-data inventory. **Why it matters:** `SECURITY.md` deferred COPPA only while there
  was "no third-party sharing", which was never true of the running system — and `AUTH-1` cannot be
  configured at all until a privacy-policy URL exists, which made this a **hidden gate** on the
  critical path rather than a sibling of onboarding.
- **2026-10-07** — **PRIV-1 raised a P0: committed personal data is ~50 files, not 3, and `OSS-1`'s
  audit was wrong.** That audit concluded there is "no measurement history… no health record, and no
  log data"; a correction merged 2026-10-01 — **after** it — committed weigh-in dates and clock times
  for a named minor, and names are bound to per-child prescribed loads in shipped source, in an
  applied migration, in a shipped component, and as **exported API symbols**. The audit is corrected
  in place rather than contradicted by a second one, and `OSS-1`'s rename is **re-scoped and raised to
  a Beta 0 blocker**. **Why it matters:** two contradictory audits of minors' data in one public repo
  is worse than one stale audit — and a rename is not a removal, because `git log -S` finds it.
- **2026-10-07** — **`PRIV-2` and `PRIV-3` filed as PRIV-1's two code follow-ons.** `PRIV-2` serves
  the notice at `/privacy` and is the real `AUTH-1` gate — **and is not the one-file PR it looked
  like**: there is no markdown pipeline in the tree, so it generates the page from `notice.md` with a
  drift test rather than keeping two copies of a privacy notice. `PRIV-3` makes the deletion a guarded
  script **with a `db:verify` proof**, which is the only thing that catches a future per-household
  table escaping the runbook's hand-maintained delete order — the panel found exactly that class of
  defect by reading, and could not have been relied on to.
