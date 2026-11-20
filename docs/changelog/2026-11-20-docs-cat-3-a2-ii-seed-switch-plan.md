# The plan for the seed switch to the movement library (with K29)

CAT-3 A2-ii, lane P: the plan for the moment production's movement library changes. Without the fixtures
flag the seed writes the approved library and stops writing the 35 old built-ins; with it, the test
library in their place, then the old fixtures. The app reads the test library exactly on a database the
same rule seeds with fixtures, and never in production. The plan also has the seed check it owns a
database before writing any fixture, keeps the shadow report running, and lists the rehearsal the
maintainer runs on a branch of production before the merge.
