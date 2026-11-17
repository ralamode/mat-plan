# A workout can be copied, within its program or into another, and the copy is its own

FAM-1 step 6a-iii-b, lane P: the database side of "Copy to…". Nothing in the app calls it yet;
step 7a-ii wires it.

- `copyWorkout` copies a workout of one of the household's programs into one of its programs: its
  name, description and every item with its numbers. The copy is independent: editing it never
  changes the source. It records where it came from, and the source program's name as it was then.
- Its name is the one given, or else the workout's name with " (copy)" in its own program, cut to fit,
  and its own name in another. A name the program already has is refused: never two workouts of one
  name.
- It can go onto weekdays of the program's week, last on each, with a label. A retried copy adds
  nothing.
- Twelve new `db:mutations` patches (385–396) show the proofs fail when the copy loses its items or
  their numbers, names itself wrongly, checks the name before the retry, takes a removed program's
  workout or a removed card, loses the order or a range, records the wrong program, or takes a
  day's first place.

Also CAT-3's P11-i: each catalog item in the picker's list now carries its catalog key, so the server
can attach its details and "How to". A household's own items never carry one, and the key is never
sent to a page. Two more patches (397, 398) cover it.
