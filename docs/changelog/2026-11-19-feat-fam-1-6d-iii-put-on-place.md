# A put-on program takes its place in the household's Programs-list order

FAM-1 step 6d-iii, lane P (D41; ADR 0007 A2 §7). Put on no longer puts every program last in an
athlete's order. Nothing in the app calls it yet; step 15 wires it.

- A new program goes before the first program the athlete keeps that comes later in the household's
  Programs list, or last. A hidden program is never "later".
- A Put on that undoes a same-day Take off goes back to its old place: after the programs that were
  ahead of it. If a program earlier in the list was put on in between, or the athlete had reordered, it
  takes its old number instead; the athlete can fix that with the reorder (the maintainer,
  2026-11-18).
- Take off counts a row as logged only when its session is the athlete's too.
- Mutation patch 410 (`seed-fixtures-reverses-the-order`) is retired: the seed's order comes from
  Put on's rule, not its loop, so a reversed loop cannot fail.
