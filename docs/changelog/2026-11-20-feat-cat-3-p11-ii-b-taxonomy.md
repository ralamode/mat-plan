### Changed

- **The program builder's picker reads a library movement's equipment and muscles from the database**
  (CAT-3 P11-ii-b, [plan](../plans/cat-3-p11-ii-option-taxonomy.md)).
  - **Where it comes from:** a library row's modality and pattern come from its `movements` row, and its
    equipment and muscles from `movement_equipment` and `movement_muscles`, instead of from the library
    entry in code. An old built-in keeps its library entry's taxonomy, or none.
  - **How it is read:** the join tables are read for the library rows the picker listed, and nothing
    else. Equipment and secondary muscles are listed in the vocabulary's order (spec K31), every code is
    parsed, and a join row for any other movement stops the read.
  - **Nothing a person sees changes today:** the seed writes the join rows from the same entries, and
    production holds no library rows until the seed switch (A2-ii).
  - **Measured:** the picker's data is 208 KB over the real library and the 35 old built-ins (610 options; 12 library slugs are old built-ins), and 347 KB at 1,000 options. A test now fails if either grows by about 15%.
  - **The stays-dark scan for the library tables is retired;** this read's `db:verify` proofs and
    mutations `605`–`609` replace it.
