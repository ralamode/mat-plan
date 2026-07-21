# V1-3 — Profile tiles; scope Today to a profile

> Backlog: [plan.md](../plan.md) row V1-3. Branch: `feat/v1-3-profile-tiles`.

## Goal

`/` becomes a **profile picker** — a "Who's logging today?" screen of tiles, one per household
profile. Tapping a tile routes to `/p/[profileId]` (the profile's `public_id`, UUIDv7), a Today view
**scoped to that profile**. The logging forms move under that route and carry the `profileId` in a
hidden field that the Server Actions **re-validate server-side** via `getProfileByPublicId`. This is
the ownership seam v1.5's Clerk household scoping plugs into — but per spec §2, **profile tiles are a
UX switch, not a security boundary**: the id is always re-checked on the server, never trusted from
the form or URL.

## Acceptance

- **Tap tile → Today scoped** (verbatim from plan.md).
- `/` lists a tile per non-deleted profile (empty state when none); tile is a semantic anchor to
  `/p/<publicId>`.
- `/p/<publicId>` renders that profile's Today (name in the header, back-link to the picker) and
  re-validates the id — unknown/malformed id → `notFound()` (404), never a 500.
- Both log Server Actions require a valid `profileId` (zod `uuid`), re-resolve it via the DAL, and
  `revalidatePath('/p/<id>')`. Boundary tests: missing/malformed `profileId` → zod-reject (no DAL
  call); unknown profile → `{ ok:false }` (no write).
- Seed: two kid profiles (Liam + Scarlett) under the root household, idempotent.

## File-by-file changes

| Path                                                                  | Change    | What & why                                                                                                                                                                                   |
| --------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/lib/dal/profiles.ts`                                        | EDIT      | Add `avatar` to `ProfileDTO`; `listProfiles()` selects `avatar` + `orderBy(asc(id))`; add `getProfileByPublicId(publicId)` (UUID-guarded → null on bad shape); delete `getDefaultProfile()`. |
| `apps/web/app/page.tsx`                                               | REWRITE   | Profile picker (RSC, `runtime='nodejs'`): `listProfiles()` → `<h1>` + `<ul>` of `ProfileTile`; empty state.                                                                                  |
| `apps/web/components/profiles/profile-tile.tsx`                       | NEW       | Sync Server Component — a large `next/link` card (avatar bubble + name + kind badge), semantic anchor, focus-visible ring, tap target ≫44px.                                                 |
| `apps/web/components/profiles/profile-tile.test.tsx`                  | NEW       | RTL/jsdom (first component test): href = `/p/<publicId>`, is an `<a>`, renders name + kind.                                                                                                  |
| `apps/web/app/p/[profileId]/page.tsx`                                 | NEW       | Moved Today: resolve `profileId` → `getProfileByPublicId` → `notFound()` if null → `listEntriesForDay`; header = profile name + back-link; forms get `profileId={profile.id}`.               |
| `apps/web/app/p/[profileId]/{bodyweight,strength}-form.tsx`           | MOVE+EDIT | Relocated from `app/`; add `profileId: string` prop + hidden `<input name="profileId">`.                                                                                                     |
| `apps/web/app/p/[profileId]/actions.ts`                               | MOVE+EDIT | Relocated; parse `profileId` (shared schema), re-resolve via `getProfileByPublicId`, `revalidatePath('/p/<id>')`.                                                                            |
| `apps/web/app/p/[profileId]/actions.test.ts`                          | MOVE+EDIT | Mock `getProfileByPublicId`; thread `profileId`; assert scoped revalidate path; add missing/malformed/unknown boundary cases.                                                                |
| `packages/shared/src/{bodyweight,strength}.ts`                        | EDIT      | Add `profileId: uuidSchema` to both input schemas.                                                                                                                                           |
| `packages/shared/src/id.ts`                                           | EDIT      | Add `uuidSchema` (one UUID validator shared by the input schemas + the DAL id guard).                                                                                                        |
| `packages/db/src/seed.ts`                                             | EDIT      | Rename "Athlete One" → Liam (keep `SEED_PROFILE_PUBLIC_ID`); add Scarlett (`SEED_PROFILE_2_PUBLIC_ID`); both kid, root household, `ON CONFLICT DO NOTHING`.                                  |
| `packages/db/scripts/verify.ts`                                       | EDIT      | Assert 2 profiles (Liam + Scarlett), both scoped to the root household.                                                                                                                      |
| `apps/web/e2e/{gate-login,steps,global.setup,log-bodyweight.spec}.ts` | EDIT      | Post-login lands on the picker; `selectProfile` step; smoke = picker → Liam tile → scoped Today → log; 404 check on `/p/does-not-exist`.                                                     |
| `apps/web/package.json`                                               | EDIT      | Add `@testing-library/react` + `@testing-library/dom` + `jsdom` (the component-test deps the vitest config anticipated).                                                                     |

## Test plan

- **Vitest (node):** action boundary + happy-path + ownership, re-scoped to `getProfileByPublicId` and
  `/p/<id>` revalidate; new missing/malformed `profileId` and unknown-profile cases.
- **Vitest (jsdom, new tier):** `profile-tile.test.tsx` renders the tile and asserts it is an anchor
  with `href=/p/<publicId>` and shows name/kind. Uses a per-file `// @vitest-environment jsdom`
  docblock, so the default node env (all existing tests) is untouched.
- **db:verify (PGlite):** idempotent seed now yields exactly 2 profiles, both household-scoped.
- **Playwright smoke:** picker heading → tap Liam → scoped Today (name asserted) → log bodyweight →
  renders; plus a 404 assertion for an unknown id. Local: `pnpm --filter web e2e` (needs real PG; runs
  in CI). Unit/verify: `pnpm --filter web test` · `pnpm --filter @mat-plan/db db:verify`.

## Risks / rollback

- **Route move breaks imports** — the forms/actions are relocated with `git mv` and the only importer
  (the Today page) moves with them; typecheck + build gate it. → verified `next build` lists `/` and
  `/p/[profileId]`.
- **Non-UUID URL segment 500s** — a garbage `/p/xxx` would make Postgres throw on the `uuid` compare.
  Mitigated: `getProfileByPublicId` shape-checks with `uuidSchema` and returns null → clean 404.
- **Prod seed rename** — `ON CONFLICT DO NOTHING` means prod's existing "Athlete One" row keeps its
  name (rename applies to fresh DBs only); a prod rename is deliberately out of scope.
- Rollback: revert the PR (no migration; schema unchanged — `avatar` already existed from V1-1a).

## V1-3 ↔ V1-4 coordination

V1-4 (bodyweight/measurement on the generalized model) builds on the **moved** forms/actions under
`app/p/[profileId]/`. Land V1-3 first (or rebase V1-4 onto it) so V1-4 edits the new locations, not
the old `app/*` paths this PR deletes. V1-2 runs concurrently but only touches the seed **catalog**
section; this PR touches only the seed **profiles** section (no overlap).

## Out-of-scope / deferred

No auth (Clerk is v1.5); no PIN gate (`pin_hash` column stays unused); no per-profile avatar upload
(the bubble shows the name initial); no profile CRUD (seed-only); prod data rename.

## Open questions

None (resolved).
