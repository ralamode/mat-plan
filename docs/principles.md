# Principles

The short list every plan, panel and PR is held to. Each principle says **what it means in a PR**
and **what enforces it**. The detailed rules live where they are enforced (AGENTS.md, `design.md`,
the ADRs); this page is the index of _why_, and it links rather than restates.

When two principles pull against each other, the order below breaks the tie: **safety, then
privacy, then accessibility, then scope, then performance polish, then the rest.** Scope sits above
performance on purpose ([ADR 0001](./decisions/0001-observability-and-web-vitals.md): follow web best
practice "wherever it doesn't fight scope discipline"); the Web Vitals budget itself still holds.

## 1 · Safety is not a feature

The model never authors loads or weights; it may draft definitions a human confirms
([AGENTS.md → What this is](../AGENTS.md#what-this-is)). The broader form: **the model extracts,
explains, drafts or classifies; a deterministic rule or a human decides.**

- **In a PR:** no code path lets generated text become a live prescription. Progressions are never
  presented as readiness.
- **Enforced by:** EVAL-0's write-path invariant; the security review lens.

## 2 · Private by default

Minors' data is the most sensitive thing here. Collect the least, show the least, and make every
share an explicit, revocable act ([privacy/](./privacy/), [ADR 0008](./decisions/0008-deletion.md)).

- **In a PR:** a new field is added to the data inventory in the same PR; nothing about a minor
  becomes visible outside the household by default; following never grants data access.
- **Enforced by:** the privacy review lens; `db:verify` tenancy proofs; PRIV-1's sign-off.

## 3 · Accessible by default

Accessibility is a property of the first version, not a later pass.

- **In a PR:** the correct semantic element first; keyboard-usable; focus visible; every control
  labelled; ≥ 44 px targets; numeric keypads on number fields; contrast to the tokens' AA pairs;
  anything done by dragging also has a non-drag way to do it
  ([AGENTS.md → UI PR rules](../AGENTS.md#ui-pr-rules)).
- **Enforced by:** the a11y lens on every UI panel; V1-12's zero-tolerance axe scan
  (`apps/web/e2e/a11y.spec.ts`) and ≥ 44 px check in CI. **A new main screen joins that scan in the
  PR that adds it.**

## 4 · Design for scale, build for now

**Choose the design that scales; build only the part needed today.** A design that has to be thrown
away at 100 households is a bug in the plan. Building for 100,000 households now is a bug in the
scope (AGENTS.md: scope discipline is a first-class constraint).

- **In a PR (data):** every query is household-scoped and served by an index; no N+1 queries (load a
  page's data in one round trip per entity, not per row); any list that can grow is paginated by
  cursor, not offset, once it passes a page; migrations follow expand → backfill → contract
  ([AGENTS.md → Schema & migration conventions](../AGENTS.md#schema--migration-conventions)).
- **In a PR (shape):** nothing assumes one household, one club or one guardian; the server holds no
  per-user state between requests; slow or heavy work (imports, exports, notifications) runs off the
  request path; business logic lives in `packages/` and the DAL, not in components, so a native
  client can call the same contracts through a versioned Route Handler.
- **In a plan:** name the one-way doors and what a 10× and a 100× version of this would change. If
  the answer is "a rewrite", redesign; if it is "add an index / a queue / a cache", note it and move on.
- **Enforced by:** the engineering panel (architecture lens); the database PR rules.

## 5 · Fast is a feature

The app is used on a phone, on a gym floor, often on poor signal. Speed is usability.

- **Budget** (p75, mobile): **LCP < 2.5 s · INP < 200 ms · CLS < 0.1**
  ([ADR 0001](./decisions/0001-observability-and-web-vitals.md)).
- **In a PR:** Server Components by default and `'use client'` only at the leaves that need it;
  server-render what can be; `next/image` and `next/font`; reserve space for anything that loads late
  (no layout shift); lazy-load what is below the fold or behind an interaction; no new dependency
  without checking what it adds to the client bundle and whether it tree-shakes; no render-blocking
  third-party scripts.
- **Enforced by:** review today. **Planned:** `PERF-1` — land ADR 0001's deferred real-user Web Vitals
  (production-only, per its 2026-08-11 amendment) and fail CI on a client-bundle size budget (before
  Beta 1); `PERF-2` — Lighthouse CI on the main app pages (before the pilot).

## 6 · Phone first, then wider

The kids log on phones and tablets; a parent plans on a laptop. Every screen works from 360 px up,
and the wide layout earns its extra space instead of stretching
([design.md](./design.md)).

- **In a PR:** design and review at ~360–390 px first; screenshots at three widths.
- **Enforced by:** the UI PR screenshot rule; the responsive lens.

## 7 · Simple, clean, usable

Adult-first and calm, not a kid aesthetic. Kid ergonomics (big targets, high contrast, clear labels)
come from good general design ([design.md → Principles](./design.md#principles)).

- **In a PR:** the fewest steps to the job (edit in place rather than a screen per item); one primary
  action per view; tokens, never hardcoded colours; colour only where it carries meaning; copy that a
  twelve-year-old reads correctly the first time.
- **Enforced by:** the interaction-design lens; the token inventory.

## 8 · Ready for other languages

English only for now, but nothing should make translation a rewrite (I18N-1, RTL-1).

- **In a PR:** counted and listed strings go through `lib/i18n/` (`plural()`, `formatList()`); dates,
  numbers and units are formatted with `Intl`, never by string concatenation; layout uses logical
  properties (`ms-`/`me-`, `start`/`end`), not left and right; no text baked into images.
- **Enforced by:** review. I18N-1 brings catalogs when a second locale is real.

## Adding or changing a principle

A principle changes by PR, with a reason, like an ADR. If a principle is added, say what enforces it;
a principle nothing enforces belongs in a backlog row until something does.
