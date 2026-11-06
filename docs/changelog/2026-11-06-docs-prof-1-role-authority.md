- **2026-11-06** — **PROF-1 names its authority model: the owner archives, any member records**
  (`PROF-1` plan refresh, [plan](../plans/prof-1-athletes.md), no code yet). The plan was panelled in
  October, before `AUTH-1` existed; `1c` has since shipped `household_members.role` and `1d` made a
  Clerk session with a household the only boundary, so the plan's "any member" assumption needed a
  decision and its eight-item re-verification gate needed running.
  **The decision** _(maintainer, 2026-11-06)_: **add** and **rename** stay any-member; **archive**,
  **restore** and **delete** are **owner-only**. The reason that actually discriminates archive from
  rename is blast radius on someone else's screen — `listProfiles` drops archived athletes, so one
  adult can take a kid off the other adult's gym-floor picker mid-practice, while a rename is visible
  in place. The two generic arguments (tightening a permission later is breaking; the app records no
  author) are true of rename too, so they do not yield the split on their own.
  🔴 **The role rides the scope, from the same membership row, and that is a safety property rather
  than a tidiness one.** `uq_household_members_clerk_user` is partial on `deleted_at IS NULL`, so one
  account can hold a **soft-deleted `owner` row in one household beside a live `member` row in
  another** — a second lookup keyed on `clerk_user_id`, or one missing the `deleted_at` conjunct,
  returns the dead owner row and promotes a member. Reading the role in the query that already
  carries both conjuncts makes that unrepresentable and leaves no window between the role read and
  the write. `scope.ts` was built as a branded **record** for exactly this widening.
  **The authority is a type, not a convention:** a second brand `OwnerScope`, and writers that need
  owner authority take it **by parameter type**, so INVITE-1 minting, member removal and PRIV-3
  deletion inherit the check by signature instead of by a reviewer remembering. The seam lands dark
  as `b-s` ahead of PR b, with a `db:mutations` patch that drops the conjunct and must turn
  `db:verify` RED — a boundary test that cannot fail is worse than none.
  ⚠️ **What a member sees is part of the decision, not a detail after it.** A member is not a
  cross-household caller — they can already see every athlete — so the controls are absent rather
  than disabled, with one statement of fact instead of a dead button per row, and the server still
  refuses a crafted POST with its own named refusal after ownership resolves (ADR 0006's rule allows
  a distinct answer only there). The copy says **"the person who set up this household"**, never a
  name: `household_members` stores a Clerk id and a role and no name or email, so copy implying
  otherwise would be a promise the data model cannot keep.
  ⚠️ **A 2026-10-23 answer is superseded and kept rather than erased.** It read "the owner, **or the
  athlete themself when not a child**"; the second half is not expressible — `profiles` has no
  account column, and `household_members` links a person to a household, not to an athlete. It also
  sits against the published notice's twice-stated claim that children do not have accounts.
  Deferred with its cost written down, not rejected.
  **The re-verification found three of its own eight items wrong, and the panel found a fourth wrong
  in the correction.** Item 3 had been rewritten to claim four resolver outcomes and to instruct a
  rewrite of `AUTH-1`'s shipped § Design 3.2; the resolver has **five** (B′ `schema_missing` was
  dropped) and §3.2 is already titled "The five outcome states". Item 1's `enterMutation` is real but
  **cannot be imported from where this plan puts the actions** — the source guard pins the literal
  `'./mutation-entry'`, which does not resolve from `app/p/` — so the move and the three guard edits
  are now named instead of discovered mid-PR. A step-up "gap" was argued and withdrawn: delete is
  A3, deferred, already gated on Beta 1 step-up by this plan's own Out-of-scope.
  **Two questions go to the maintainer** rather than being settled here: whether **restore** should be
  any-member while archive stays owner-only (recommended — the owner can archive the wrong athlete at
  home and nothing recovers it on the gym floor until they are reachable), and whether the rule
  belongs to the household model rather than this plan, since `crud-1`'s M45 and `v1-9b` still bind
  two sibling plans to the superseded answer.
