# A check-in submit refuses a repeated id, and an upper-case id is no longer misreported

- **Fixed:** `logCheckinsAction` refuses a submit whose fields share a `client_id`, marking each
  sharing field, instead of writing one row and answering `created` twice. Ids are compared lower-cased.
- **Fixed:** `writeCheckinEntries` folds each `client_id` to lower case before it classifies what it
  wrote, so an id sent in upper case is answered `created`, not a throw (a habit) or `day_taken`
  against its own row (a practice). It throws before any statement on a repeated id, a precondition
  the action keeps.
- **Proved:** the race retry meets a third phone that holds the day again before the retry's insert
  (`verifyRetryLandsOnTakenDay`): a practice answers `day_taken` and a weigh-in `{ dayTaken: true }`.
  Today's retry passes it trivially; it guards a later change to the retry. Mutations 422–424.
- **Docs:** `hiddenAtSchema`'s docblock gives the right reason for refusing hour 24 and second 60 (a
  second spelling of an instant, not a failed cast).

Plan: [v1-9b-checkin-distinct-ids.md](../plans/v1-9b-checkin-distinct-ids.md). Both input defects need
a crafted request; the app's forms mint one lower-case id per item.
