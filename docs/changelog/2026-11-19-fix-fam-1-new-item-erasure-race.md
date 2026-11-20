# Adding an item while the household is being erased answers "not found", not a server error

FAM-1, lane P: `newItem` read its household with a plain select, so an erasure running at the same
time could commit between that read and the insert, and the insert then failed its foreign key (a 500).
The read now takes the household row `FOR KEY SHARE`, so it waits for the erasure, finds no household
and answers `not_found`. The wait is bounded by the 5-second lock timeout. The cap check also moves to
the shared `householdItemsFull`, so the server, the picker and the preview count items the same way.
Found by Native Scaling's PRIV-3 2a review.
