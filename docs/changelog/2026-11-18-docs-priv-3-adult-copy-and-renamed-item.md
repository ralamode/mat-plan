- **2026-11-18** — **PRIV-3: a removal waits for an adult athlete's copy, and a typed name can be
  replaced on the household's own logs.** The maintainer's answers of 2026-11-18 are applied to
  `docs/runbooks.md` → "Remove one program, workout or typed item on request".
  - **Q11:** an adult athlete affected is sent their own copy, and the removal waits until they confirm
    it, at most 3 days.
  - **Q12:** a typed item that a log names still cannot be removed. On request, after the owner is told
    whose logs change and accepts, its name is replaced on the item and on every one of the household's
    logs of it, whatever the spelling. The logs, sets and numbers stay.
    - The new name is checked with the app's own name rules and its near-duplicate check.
    - The rename stops if the same words appear in a note or a superset label.
    - It runs under the household-items lock, and is re-checked after `COMMIT`.
    - Its ledger entry keeps the new, neutral name for a replay, and never the old text.
    - An adult athlete affected is told, with no copy and no wait, since nothing of theirs is deleted.

    `notice.md` says such a name can be replaced on request.

  `priv-3-guarded-deletion.md` records both decisions (9 and 12), and inventory §5 states them. Docs only.
