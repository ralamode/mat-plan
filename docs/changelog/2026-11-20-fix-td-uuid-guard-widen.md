### Changed

- **The test that keeps one uuid validator now catches a uuid regex by its shape** (tech debt, from
  #667's second pass). Before, it caught only a regex named like `UUID_RE`, so a regex named `UUID`,
  one written inline, or the `uuid` package's `validate` reached through a namespace import or
  `require` all passed. It now checks the shape (a hex class quantified `{8}`, the first group of a
  uuid), whatever the name. Three files that hold such a regex but parse no input are allowed, each
  with its reason; the Sentry scrubber and two `db:verify` proofs. A stale entry fails.
- **The id schema's docblock and the write-path guide** now say the case gap shipped in two schemas
  (check-in, strength session). The hide and restore schemas held it with no endpoint yet.
- **Two TEN-1 cross-household proofs** in `db:verify` match the refusal by the shared
  `PROFILE_NOT_FOUND` constant, exactly, instead of a `/Profile not found/` pattern (from #747's
  review).
