### Changed

- **A signed-out visitor is refused, proved at runtime again** (tech debt, AUTH-1 1d;
  [plan](../plans/td-signed-out-e2e.md)). The e2e harness now starts a second server from the same
  build with the session bypass disarmed (`E2E_SESSION_BYPASS_USER_ID: ''`), so its visitors are
  genuinely signed out. What replaced each proof AUTH-1 1d deleted:
  - **"the app itself is still gated"** (`/p` only) → every protected page, design previews included,
    sends a stranger to sign-in in one hop, with nothing of the household on the wire
    (`landing.spec.ts`);
  - **variant 1 of the action replay** → the captured Save, sent as-is to the routine path and every
    public path on the signed-out server, is refused with the exact no-session copy, and the routine is
    unchanged afterwards (`landing.spec.ts`);
  - **"the export is gated"** → Athlete Two's export answers 200 to a member and 404 to a stranger
    (`export-csv.spec.ts`).

  Also:
  - the public pages' tests (`landing.spec.ts`, `privacy.spec.ts`) now run as a stranger;
  - a new check shows every public path answers without a redirect;
  - the bypass containment test gains a `DISARMS` category, which pins the config to one empty-valued
    mention;
  - the route list is one helper (`test/app-routes.ts`), shared with the static session guard.

  The tech-debt row is narrowed, not closed. The configured-Clerk branch is still unit-proved only, and
  "no unauthenticated request reaches the database" is still not a property this suite shows.
