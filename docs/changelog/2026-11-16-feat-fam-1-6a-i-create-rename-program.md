# The program writers can create and rename a program

FAM-1 step 6a-i, lane P's first PR: the database side of the builder's "New program" and "Rename".
Nothing in the app calls these writers yet; step 7a wires them into the Programs page.

- `createProgram` stores a program as a template block of the household, named as typed. A retried
  create with the same client id answers with the first program and adds nothing, even when it
  races its first attempt. A name the household already uses (compared folded, so "heavy a" matches
  "Heavy A") answers `name_taken`, and a bad input answers `invalid`. The slug takes a `-2`, `-3`
  suffix past any live block's slug, the seeded program's included.
- `renameProgram` answers `not_found` for anything that isn't one of the household's live programs
  (another household's, the seeded block, a removed one), then `name_taken`. It re-derives the slug
  from the new name, so a renamed program keeps no copy of its old name.
- Two writes that pick one slug at the same moment no longer throw: the loser answers as a replay
  or with `retry`.
- `db:verify` proves both across two households, and five new `db:mutations` patches (93–97) show
  the proofs fail when the fold, the replay order, or one of the three slug rules is broken.
