# The program builder's item picker has its data, and a new item never duplicates one

FAM-1 step 6a-iii-a, lane P: the database side of the item picker and of "+ New item". Nothing in the
app calls them yet; step 7a-ii wires them.

- `movementOptions` lists every item a household can pick: the catalog's items, with their browse
  group and short names (`RDL`), then every item the household has made, used or not, except one a
  catalog item already covers. Each says how it is logged.
- `newItem` adds an item by name and type, unless the household already has it: a name spelled
  another way (`push ups` for Push-ups) or a short name (`RDL`) selects the existing item, adds
  nothing, and answers with that item's own name and type. A name the household has not used makes
  one new item of the type picked.
- Six new `db:mutations` patches (304–309) show the proofs fail when the list offers a covered,
  hidden or another household's item, or when `newItem` skips either check or answers with the typed
  name.
