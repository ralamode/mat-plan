# The a11y tap-target and axe checks exist once

`a11y.spec.ts` now imports `expectNoAxeViolations`, `expectTapTargets` and `describeControl` from
`e2e/a11y-checks.ts`, and its private copies are deleted. The reasoning for each rule (the selector,
the label-measured checkbox, explicit and implicit label association) moved to that module with
them. No rule changes: a change to the 44px bar or the selector now reaches every spec at once.
Pays down the tech-debt entry "The a11y checks have two copies"; the two link checks, which
merging would edit a contract spec, are recorded as a new entry.
