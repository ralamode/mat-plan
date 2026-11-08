- **2026-11-08** — **The household scope carries a role, and owner authority becomes a type**
  (`PROF-1` b-s, [plan](../plans/prof-1-athletes.md) § Role authority). **Ships DARK** — nothing
  reads `role` yet but the guards and the proofs. `PROF-1 b`'s archive is its first consumer.
  `membershipHousehold` now returns `{ householdId, role }[]`, and **the role comes from the same
  row as the id**. 🔴 **That is a safety property, not a saved query.**
  `uq_household_members_clerk_user` is partial on `deleted_at IS NULL`, so one account can hold a
  **soft-deleted `owner` row in household X beside a live `member` row in Y** — a role read by a
  second lookup, or by one that forgot the `deleted_at` conjunct, returns the dead owner row and
  silently makes a member an owner. `db:verify` now **constructs that exact state** and asserts the
  resolver answers `member`; nothing proved it before.
  **`OwnerScope` is a second brand**, with `ownerScope(scope)` narrowing and `isOwnerOf(scope)` as
  the SQL conjunct. A writer needing owner authority takes `OwnerScope` **by parameter type**, so
  forgetting it is a compile error — `INVITE-1`'s minting, member removal and `PRIV-3`'s deletion
  inherit the check by signature rather than by a reviewer remembering.
  ⚠️ **The type is not the whole guard and is not sold as one.** A brand stops an accidental
  widening and an inline literal; a **one-word** `as OwnerScope` compiles, because `OwnerScope` is a
  subtype — so `scope.test.ts` guards that cast lexically (`ownerScope()` and one named `verify.ts`
  forgery are its only sites). The compile half is pinned by an `@ts-expect-error` that fails as
  **`TS2578`** if the brand erodes (probed).
  🔴 **`isOwnerOf` is NOT a database-side authority check**, and five documents in this PR's first
  round said it was. It emits `$1 = $2` over the scope's own `role` field: no column, no
  `household_members`, and a forgery that _writes_ `role: 'owner'` passes it. The **only** authority
  is `membershipHousehold`'s single live-row read. What the conjunct buys is narrower and still worth
  the line — a scope cast past `ownerScope()` while honestly holding `member` matches **0 rows**
  instead of writing, so a lost narrowing fails CLOSED and fails as a row count. `db:verify` asserts
  that; patch `14` reddens it; patch `15` pins where the role is read from. A principal-keyed
  `EXISTS` is the real database-side check and belongs to `INVITE-1`, when demotion goes live.
  **Both constructors take `role` positionally, with no default** — so every unconverted call site is
  a compile error rather than a silent downgrade to `member`. Three fired immediately.
  `householdScopeForScript` is the one exception and says why: every caller is a maintainer-run
  script with no principal to read a role from.
  🔴 **`scope.role` may be named by exactly TWO modules, each listed with its reason** —
  `scope.ts` narrows the type, `writers/ownership.ts` turns it into SQL — as a
  `Record<path, reason>` with a dead-entry assertion, the `scoped.test.ts` idiom, rather than a count
  that can quietly go from 2 to 3. The regex is case-insensitive from the start, because a
  `SCREAMING_CASE` constant walked past `[Ss]cope` on #350.
  ⚠️ **The two-scope guard (R5(1)) fired on this chunk's own proof, and was not widened.** A
  member-roled scope would have been a third mint; the fix was to **spread**
  `{ ...A_SCOPE, role: 'member' }` — which is a _better_ test, because the case under test is a
  forgery and a spread-and-overwrite is exactly that shape, while a minted member scope would have
  been a legitimately-made one. Also: **mutation patch `01` needed regenerating**, because adding
  `isOwnerOf` shifted the context its hunk matched. The runner reported "does not apply" rather than
  passing silently — the same context-sensitivity `DX-12`'s panel flagged for patch `02`, hitting
  for real a day later.
