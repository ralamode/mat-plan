# The P11-ii plan's amendment after its post-merge review

CAT-3 P11-ii, lane P: the plan merged before its review, so a retroactive review and a four-lens
re-review shaped an amendment. The setting that picks the fixture library on test databases (K29)
becomes its own PR, landing with the seed switch, so CI never reads the fixture library before a
fixture row exists. Each row of the picker's option read now has a defined shape, the old built-ins'
library aliases included, so the picker and `newItem` match the same names. The amendment also records
the maintainer's approval.
