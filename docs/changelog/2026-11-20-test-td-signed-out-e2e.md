### Planned

- **A signed-out visitor is refused, proved at runtime again** (tech debt, AUTH-1 1d;
  [plan](../plans/td-signed-out-e2e.md)). A second, un-bypassed test server, run from the same build,
  and four proofs restored where the deleted ones stood:
  - every protected page redirects to sign-in;
  - a real Server Action POST is refused and writes nothing;
  - the export answers a member and refuses a stranger;
  - the public pages stay public.

  The plan was reviewed by five lenses, then re-reviewed. Implementation follows its approval.
