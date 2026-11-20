# The check-in writer's id refusal names what it refuses

`V1-9b` follow-up to #651 (its review's P2 R2; the board: a fix, not a debt row).

- `writeCheckinEntries` throws `CHECKIN_CLIENT_ID_NOT_UUID`, "check-in client_id is not a
  hyphenated RFC 9562 uuid". The old "not a hyphenated uuid" undersold the parse: zod 4's `z.uuid()`
  also refuses a hyphenated id whose version or variant digit is outside the RFC.
- The writer test uses the constant (and `CHECKIN_CLIENT_IDS_REPEAT` for the repeated-id throw), and
  a third case proves a non-RFC variant digit is refused.
- Mutation 424 is re-cut against the new line; `write-path.md` says the same.
