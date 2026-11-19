### Security

- **Only the household owner can download an athlete's export** (FAM-1 export follow-up,
  [plan](../plans/fam-1-export-owner-only.md) PR B; the maintainer's decision, 2026-11-19).
  - Any other login gets the export route's one `404`, before a month is read, and the export
    control is not shown to it.
  - `isOwnerOf` on `loggedMonths` makes a scope cast past the owner check read zero months, proved in `db:verify` and by mutation 610.
  - Every member still sees every athlete's rows in the app, weigh-ins included.
  - **Today every login is an owner**, so nobody's access changes yet.
  - The privacy notice, inventory, SECURITY.md and runbooks say so.
