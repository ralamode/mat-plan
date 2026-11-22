# A refused program order checks its ids in one query

Tech debt, lane P. When the Program order save is refused, the DAL reports the first id that is not
one of the household's live programs. It used to find that out by reading the whole Programs list,
2 plus one query per live athlete (up to 27), and loading names and assignments only to keep the
ids. It now asks one query, `programIdsIn` (`packages/db/src/queries/program/exists.ts`), with the
same scope `programIn` uses. `db:verify` proves the scope (mutations `630`–`632`, one per conjunct); the paid
tech-debt row is deleted. `report-miss.ts` is lane B's file, edited as a guest with the board's
clearance.
