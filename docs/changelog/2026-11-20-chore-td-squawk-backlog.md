# Every Squawk finding in the migrations on main is listed with the reason it was safe

Tech debt: "20 pre-existing Squawk findings on `main` are never linted", rewritten as "Squawk lints
new migrations only, and the CONCURRENTLY rule is review-enforced".

### Changed

- `docs/tech-debt.md` lists all 47 findings Squawk 2.66.0 reports over the 33 migrations: the 20
  under `.squawk.toml` (0001–0009, before Squawk was wired) and the 27 that
  `require-concurrent-index-creation` would add. Each has its migration and line, and the reason it
  was safe. The command that reproduces them is included. No migration changes; they are immutable.
- Every one of the 27 index findings is on a table that already existed; none is in 0027–0032.
- The item stays open, narrowed to the gate: a new migration's non-concurrent index is caught only
  by review. Proposed fix: stop excluding the rule, so each such index carries a
  `squawk-ignore` with its reason.
- `ci.yml`'s Squawk comment points to the list instead of summarising one migration's reason.
