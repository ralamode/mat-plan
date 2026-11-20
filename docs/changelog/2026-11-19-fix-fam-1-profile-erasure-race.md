# Adding an athlete while the household is being erased answers "refused", not a server error

FAM-1, lane P: `createProfile` read its household with a plain select, so an erasure running at the
same time could commit between that read and the insert, and the insert then failed its foreign key (a
500). The read now takes the household row `FOR KEY SHARE`, as `newItem` does (#714): it waits for the
erasure, finds no household and answers `refused`. The wait is bounded by the 5-second lock timeout.
Found in #714's review; the maintainer chose to fix it now.
