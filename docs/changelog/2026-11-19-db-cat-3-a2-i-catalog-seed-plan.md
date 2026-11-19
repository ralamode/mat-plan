# The plan for the catalog seed's writer, not yet switched on

CAT-3 A2-i, now lane P's: the plan for the function that writes library movements, with their equipment
and muscles, into the database in one transaction. It never touches a row that already holds the slug,
or a row a household owns. Production's seed passes it an empty list until A2-ii. The plan also has the
seed's public log print counts only, never a slug a household typed, and has each insert skip itself
when it has nothing to write, so a deploy with every entry already present cannot fail.
