# A put-on program takes its place in the household's Programs-list order

FAM-1 step 6d-iii, lane P (D41; ADR 0007 A2 §7). Put on no longer puts every program last in an
athlete's order. Nothing in the app calls it yet; step 15 wires it.

- A new program goes before the first program the athlete keeps that comes later in the household's
  Programs list, or last. A hidden program is never "later".
- A Put on that undoes a same-day Take off goes back to its old place (or last, if fewer programs
  remain). If a program earlier in the list was put on in between, it takes its old number instead;
  the athlete can fix that with the reorder (the maintainer, 2026-11-18).
- Mutation patches 407 (`put-on-leaves-the-gap`) and 410 (`seed-fixtures-reverses-the-order`) are
  retired. One writer now numbers every open row, so "leaves the gap" has no separate fault. The
  seed's order comes from Put on's rule, not its loop, so a reversed loop cannot fail.
