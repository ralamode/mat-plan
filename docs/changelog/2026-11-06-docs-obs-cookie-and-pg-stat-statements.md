- **2026-11-06** — **One cookie, not two — and `pg_stat_statements` is an operator step, because a
  migration would break `db:verify`** (`OBS-3`, [ADR 0001](../decisions/0001-observability-and-web-vitals.md) §4).
  **`OBS-3`'s premise was stale.** It read "the app's two cookies (`mp_gate`, `tz`) are strictly
  necessary". `AUTH-1` 1d deleted the access-code cookie — every surviving `mp_gate` reference under
  `apps/web` is a tombstone, a comment or a test, and `proxy.ts:18` only ever _clears_ it. The
  published notice had already been corrected (`notice.md:160`); the backlog row had not, and the
  consent argument rests on exactly which cookies exist. The conclusion is unchanged and stronger:
  one strictly-necessary cookie, still no banner.
  🔴 **The row now records that the bar on analytics is higher than "optional", because the notice
  already promises it.** `notice.md:138` tells people _"No tracking. No advertising network, no
  analytics product, no social buttons, no third-party fonts."_ Adopting a behavioural analytics
  product would make a **published statement false** — the `privacy-reviewer`'s P0 class — so any
  future version of `OBS-3` re-signs the notice in the same PR or does not ship. That is a stronger
  constraint than the cost/consent argument the row was carrying.
  🔴 **`pg_stat_statements` cannot be a migration, and this was measured rather than assumed.**
  `db:verify` replays every migration on **PGlite**, which ships no contrib extensions:
  `CREATE EXTENSION IF NOT EXISTS pg_stat_statements` raises _"extension … is not available"_ and
  `pg_available_extensions` holds no row for it (probed on `@electric-sql/pglite@0.5.13`). ⚠️ The
  `IF NOT EXISTS` does not help — it guards against already-installed, not against unavailable. So a
  migration would turn `db:verify` red on **every PR afterwards**, not only its own. It is also not
  schema the app depends on: nothing in `packages/db` or `apps/web` reads the extension, so there is
  nothing for a migration to keep in sync.
  **Shipped instead: the runbook procedure** — the unpooled connection, the preload check that says
  what to do if Neon has not preloaded it, the create, a verification that distinguishes _available_
  from _installed_, and the top-15 query to read a week later rather than the same minute.
  ⚠️ **With a privacy caveat on reading it:** `pg_stat_statements.query` is normalised but not
  guaranteed free of personal data, since an unparameterised literal appears verbatim. This app's
  writes are bound parameters via Drizzle, so in practice the text is shape-only — but the repo is
  public and holds minors' data, so the runbook truncates in the query itself and says never to paste
  the output into a PR or issue unread.
  ⚠️ **And it says what the extension does not buy:** cumulative server-side timing finds a slow
  query; it cannot tell you a page got slower for a person on a phone. That is Core Web Vitals, still
  blocked behind the `connect-src` decision in `OBS-1`.
  `docs/lessons.md` gains the general rule, because the next person reaches for a migration.
