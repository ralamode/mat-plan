# The program writers can create and rename a program

FAM-1 step 6a-i, lane P's first PR: the database side of the builder's "New program" and "Rename".
Nothing in the app calls these writers yet; step 7a wires them into the Programs page.

- `createProgram` stores a program as a template block of the household, named as typed. A retried
  create with the same client id answers with the first program and adds nothing. A name the
  household already uses (compared folded, so "heavy a" matches "Heavy A") answers `name_taken`, and
  a bad input answers `invalid`. The slug takes a `-2`, `-3` suffix past any live block's slug,
  the seeded program's included.
- `renameProgram` answers `not_found` for anything that isn't one of the household's live programs
  (another household's, the seeded block, a removed one), then `name_taken`, and keeps the slug.
- `db:verify` proves both across two households, and three new `db:mutations` patches (82–84) show
  the proofs fail when the fold, the replay order or the removed-slug rule is broken.
