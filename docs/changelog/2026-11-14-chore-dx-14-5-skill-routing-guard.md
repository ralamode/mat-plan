- **2026-11-14** — **DX-14 item 5a: `skills:check` fails when two skills share a trigger phrase**
  ([plan](../plans/dx-14-5-skill-routing-guard.md)). Each skill's triggers are the quoted phrases in
  its "Use when …" clause, read from the description itself, so there's no second list to keep in
  sync. A trigger that also appears, as whole words, in another skill's clause fails ("ship it" and
  "shipit" count as one). So does a description over 500 characters, or one that quotes no phrase.
  It found what it was built for: "shipit" now starts `keep-mergeable` only (the maintainer's call),
  four descriptions were trimmed back to triggers, and `ui-screenshot` gained phrases plus a
  correction (it no longer claims to log through the access gate deleted at AUTH-1 1d). The check is
  lexical; Claude Code's routing is semantic, and the README says so.
