# Definition of Done (per PR)

Every PR must satisfy:

- [ ] Typecheck (`tsc --noEmit`) + lint (ESLint) + `prettier --check` pass
- [ ] Unit / integration test for new logic (see test pyramid below)
- [ ] Loading / empty / error states present for any new UI
- [ ] Semantic HTML: correct native elements (button/a/nav/main/ul-li/label), proper heading order — no div-soup
- [ ] A11y basics: keyboard-usable, focus-visible, labels, ≥44px tap targets, numeric `inputmode` on number fields
- [ ] Migration + idempotent seed updated if the schema changed (see DB rules in AGENTS.md)
- [ ] `client_id` stamped on writes
- [ ] Playwright updated if a critical flow changed
- [ ] Preview deploy manually verified
- [ ] Conventional Commit PR title; PR template filled
- [ ] All required CI checks green

## Backend / API additions

- [ ] Auth **and** ownership re-checked inside the action/handler
- [ ] Input zod-validated; DTO-only returns (never a raw row)
- [ ] DAL boundary respected (no `db` / `process.env` outside `lib/dal`)
- [ ] Boundary tests: unauth → reject, wrong-owner → forbid, bad body → zod-reject
- [ ] Idempotency handled for mutations; typed errors + structured logging + Sentry
- [ ] zod schema / types updated; breaking changes flagged + versioned

## Database additions

- [ ] Generated SQL committed and reviewed (never `drizzle-kit push` to prod)
- [ ] Forward-only (no edits to applied migrations); one migration per PR
- [ ] Squawk lint passes; migration applies on empty Docker PG + a Neon branch; drift check clean
- [ ] Expand → contract for breaking changes; `lock_timeout` set; concurrent index isolated
- [ ] Backfill plan + rollback plan documented in the PR

## Test pyramid

- **Unit:** zod schemas, CSV re-aggregation, progression engine, pure utils
- **Integration:** Server Actions / Route Handlers against a test DB
- **Component:** React Testing Library for the log forms
- **E2E:** a few critical flows only (Playwright)
