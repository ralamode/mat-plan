- **2026-10-08** — **TEN-1 1b: one household can no longer reach another's data**
  ([plan](../plans/ten-1-household-scope.md), [ADR 0006](../decisions/0006-household-addressing.md)).
  `getHouseholdScope()` is the one place a household is derived for a request, `isLiveProfile` takes a
  **required** `HouseholdScope` — so a missed call site is a compile error, not a review miss — and
  the three profile-resolution sites plus everything `ownedEntryIds` reaches now emit
  `profiles.household_id = $n`. The picker was the whole hole: `listProfiles()` returned **every
  profile in the database**, which is `.github/SECURITY.md`'s #1 risk stated as a query, and under ADR
  0006's session-only addressing `/p` is byte-identical for every household, so nothing else stood
  between two families. `db:verify` now drives **two households through the picker, both scoped reads
  and all three amend writers, in both directions**, and `pnpm db:mutations` proves those assertions
  can fail by breaking the predicate on purpose. A wrong-household id is the 404 an unknown id already
  was; a wrong-household **server** (≥2 live households before AUTH-1) throws rather than telling a
  parent their data does not exist. ⚠️ **Consistent scoping, not authorization** — the principal is
  still a shared access code until AUTH-1. `logCheckinEntries`, `writeStrengthSession`,
  `programDayRows`, `export-month` and the seed convert in **1c**; the guards, the corrections and the
  `findOrCreateMovementId` / TEN-2 verdict are **1d**.
