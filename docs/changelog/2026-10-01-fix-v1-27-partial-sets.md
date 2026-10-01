- **2026-10-01** — **V1-27 planned: doing some of a movement's sets will submit**
  ([plan](../plans/v1-27-partial-sets.md)). An untouched set inside a movement that has at least one
  entered set stops being `required` and is not submitted — the rule the form already applies to an
  untouched movement, one level down. Half-entered sets still block; a named movement with no sets
  still blocks; the server contract is unchanged. Implementation lands after #201 (V1-30).
