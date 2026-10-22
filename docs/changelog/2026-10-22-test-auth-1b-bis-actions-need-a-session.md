- **2026-10-22** — **"A new action without the gate check fails CI" was a request, not an invariant.
  Now it is enforced.** `docs/features/write-path.md` invariant 1 admitted the hole in writing: _"A new
  action without it fails the unauth suite in `actions.test.ts` **only if you add it to that suite:
  do.**"_ The behavioural coverage was a hand-maintained array of seven tuples that nothing
  cross-checked against the module's real exports.
  `beta-1.md` §3 asked for this by _"extending the existing export-enumeration test"_, but that test
  (`use-server-exports.test.ts`) is an export-**shape** guard — it would pass
  `export async function evilAction()` with no auth, no zod and no gate check. The shape guard stays
  where it is; the auth assertion landed in `pages-are-gated.test.ts`, whose job already is _"every
  entry point re-checks the boundary itself"_.
  **Two guards, and neither alone is the claim.** The new one is a **source-text** guard: it enumerates
  every `'use server'` module and asserts the boundary call appears **inside each exported function**,
  sliced per function so one check cannot cover a whole module. It proves the call is _present_, not
  that it runs _before_ the DAL — that is `actions.test.ts`'s
  `expect(getProfileByPublicId).not.toHaveBeenCalled()`. Both halves are stated in the test's own
  docblock, along with the three things it does **not** cover (an inline `'use server'` closure, an
  anonymous default export, and Route Handlers, covered separately). Re-exports are **not** a gap:
  `use-server-exports.test.ts` already fails any export that is not `export async function`.
  ⚠️ **The enumeration domain was narrower than the attack surface.** Both pre-existing guards are
  rooted at `apps/web/app`, so a `'use server'` module under `components/` or `lib/` would be a real
  Server Action invisible to everything. The new scan is rooted at `apps/web`. Today every such module
  is under `app/`, which is the only time widening it costs nothing.
  The action list now has **one** source (`mutating-actions.ts`, a non-`'use server'` sibling on the
  `action-state.ts` precedent): omitting an action there turns the filesystem cross-check red, and
  omitting its function binding is a **type** error. Both new assertions were proved by mutation —
  dropping one action from the list, and stripping the gate check from **one** action — and both went
  red. ⚠️ **1c switches the asserted call to the session check; it must never widen it to an
  alternation**, which would pass on either and prove neither.
  Also narrows `docs/tech-debt.md`'s `code()`-helper entry from **five copies to two**: three were
  converted to the new `apps/web/test/source-scan.ts`. The two left are named with the reason each is
  still standing — one is free for whoever next edits that file, and `packages/db`'s cannot import from
  `apps/web/test/` at all, so it waits for a second consumer rather than a speculative shared module.
