- **2026-11-06** — **The exclusion type now rejects what five documents said it rejected**, plus five
  smaller findings from a retrospective review of #339, #345 and #346.
  🔴 **WP-1's headline claim shipped false.** `mutating-actions.ts`, `write-path.md`, the changelog,
  the commit and the PR body all said _"an entry cannot carry both `scope` and `excluded` — it is a
  type error."_ It was not: TypeScript's excess-property check on a **non-discriminated** union only
  requires each property to exist in _some_ member, so `{ refusal, scope, excluded }` compiled
  (probed: `tsc --strict`, exit 0, zero errors). The mapped filter then classified it as excluded, so
  it got **no binding and no refusal matrix** — the dangerous direction — leaving only the runtime
  `excludedActionNames()` pin, which is the shape the claim said it had replaced. ⚠️ **The plan had
  it right first:** its Risks row read "prose and review, not a type" before a later panel round
  claimed otherwise and was accepted unverified. Fixed with `excluded?: never` /
  `scope?: never; refusal?: never`; probed RED (2 errors) and green.
  🔴 **A first draft of this PR then shipped a SECOND unprobed claim, inside the PR about the first.**
  Its new test file said exclusivity "cannot be asserted" because a `@ts-expect-error` "would pass
  whether or not the union is exclusive, since the directive only needs _an_ error". **Probed, and
  false:** against the pre-fix union the exact literal that used to compile produces no error at all,
  so the directive goes unused and `tsc` fails with **TS2578**; against the post-fix union it passes.
  Caught by the pre-merge lenses — the practice that was missing when #345 shipped. The file now
  carries a real **exclusivity pin**: two `@ts-expect-error` literals that start compiling the moment
  either `never` is deleted (probed RED, two TS2578s), plus two shapes that must still be accepted so
  the pin cannot pass by rejecting everything. ⚠️ It is held by **`pnpm typecheck`**, not
  `vitest run` — a green test run is not the proof, and the file says so.
  🔴 **WP-1 also shipped the option its own panel REJECTED.** S3 ("defer the household suite") was
  rejected in the log; the diff deferred it anyway and recorded no deviation. A `household` entry
  today would meet unauth + rate-limit only — **no wrong-owner proof**, which AGENTS.md calls
  mandatory. A tripwire now pins that set empty with the reason attached (probed RED), the suite is
  still owed by a-1, and WP-1's plan gains a **Deviations as shipped** table — because a plan the
  code does not match is worse than no plan.
  **a-g's program note had no wrap rule.** It renders `profile.name`, and D11 gives every name
  renderer `overflow-wrap`; this `<p>` was created after that list and was not on it. At 360px `main`
  leaves 328px and a 40-char unbroken name in wide glyphs is ~500px — sideways scroll. ⚠️ a-r's
  narrow e2e adds the 40-char athlete as a **kid**, so the adult-only line is never measured by it;
  D11 now says to flip that fixture.
  **`data-inventory.md` gains the §2 rows and trigger-3 entries #339's own plan required** and did
  not ship — so the file's "an old column wakes up" mechanism was blind for a-1. ⚠️ The §1a wording
  **"device-linkable"** was copied from `entries.client_id` rather than derived, and overstates it: a
  UUIDv7's first 48 bits are the **device's clock when the form opened**, not a device identifier
  (v7 carries no node id), the server never verifies the version, and nothing persists the key
  client-side before v1.5. The §2 row says what it actually encodes.
  **Also:** the plan's runbook citation pointed at the wrong section, and its three-check set was
  weaker than `0019`'s — it admitted a **non-unique** index and omitted the
  `drizzle.__drizzle_migrations` ledger row, which is `0020`'s **only** re-run guard (the index has
  no `IF NOT EXISTS` by design, so a re-run wedges prod). A personal name in a source comment became
  the role. The mutations README gains rows for patches 11 and 12.
