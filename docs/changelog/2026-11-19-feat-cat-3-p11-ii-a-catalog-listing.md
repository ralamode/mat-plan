# The program builder's picker lists every library movement

CAT-3 P11-ii-a, lane P ([plan](../plans/cat-3-p11-ii-option-taxonomy.md)): the picker's option read now
lists every library row as well as the old built-ins, each built by one mapping (`catalogArmOption`):
the database row's name and type, the library's aliases joined with the old ones, and the library's
kind, equipment, muscles, coach label and "How to". `newItem` matches over the same list, so typing a
library movement's other name ("Strict press", "Hex-bar deadlift") selects it instead of making a
duplicate. The web layer only copies what the read built. Production holds no library rows until the
seed switch (A2-ii), so nothing changes there yet.
