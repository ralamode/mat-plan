- **2026-11-11** — **PICK-1, MOV-1 and ASSIGN-1: the three plans downstream of V1-22 chunk 2 catch up
  to the identity it dropped** ([PICK-1](../plans/pick-1-movement-picker.md),
  [MOV-1](../plans/mov-1-rename-movement.md), [ASSIGN-1](../plans/assign-1-assignments.md)). Chunk 2
  shipped with D1 applied — no prescription identity on the wire, the match keyed on `movement_id` —
  and three unimplemented plans still instructed their implementers to send, clear, carry or
  re-key a field that does not exist, in eleven passages between them. PICK-1 gets a dated
  § Amendment naming each superseded passage, the replaced gate (**its PR 2 must keep movement
  resolution pre-transaction, or every session silently stops freezing a snapshot**) and its
  invariant 7 recorded as already satisfied. MOV-1's reciprocal note is discharged: it switches
  nothing, under either outcome of its open question. ASSIGN-1's failure mode was re-stated — a
  stale candidate set no longer leaves a visible NULL, it freezes the **wrong block's numbers**
  permanently — and the justification for not sending the "Which workout?" choice is struck, which
  leaves one question for the maintainer before READ-2a ships.
